import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AHEAD, buildVoice, createEngine, pump } from './sound-engine.js'
import { LAYERS, rng } from './sounds.js'

// Just enough of a BaseAudioContext to build the graph and see what gets scheduled (no sound is made)
function fakeCtx() {
  const ctx = { currentTime: 0, sampleRate: 8000, started: [], stopped: 0 }
  const param = (value) => ({
    value,
    ramps: [],
    cancelScheduledValues() {},
    setValueAtTime(v) {
      this.value = v
    },
    setTargetAtTime() {},
    linearRampToValueAtTime(v, t) {
      this.ramps.push([t, v])
    },
  })
  const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra })
  ctx.destination = node()
  ctx.createGain = () => node({ gain: param(1) })
  ctx.createBiquadFilter = () => node({ type: '', frequency: param(350), Q: param(1) })
  ctx.createDynamicsCompressor = () => node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map((k) => [k, param(0)])))
  ctx.createBuffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length))
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] }
  }
  ctx.createBufferSource = () => {
    const s = node({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), onended: null })
    s.start = (t) => ctx.started.push([s, t])
    s.stop = () => {
      ctx.stopped++
      s.onended?.()
    }
    return s
  }
  return ctx
}

const gen = LAYERS.filter((l) => l.kind === 'gen')

test('every generated layer builds, starts its loops and schedules its envelopes', () => {
  const ctx = fakeCtx(), en = createEngine(ctx, rng(1))
  for (const l of gen) {
    const v = buildVoice(en, l)
    assert.ok(v.sources.length > 0, l.id)
    assert.ok(v.autos.every((a) => a.until >= AHEAD - 15), `${l.id}: envelopes reach about ${AHEAD} s ahead`)
  }
})

test('rain and fire scatter their events a minute and a half ahead, from grain banks, and stop them all', () => {
  for (const id of ['rain', 'fire']) {
    const ctx = fakeCtx(), en = createEngine(ctx, rng(2))
    const v = buildVoice(en, LAYERS.find((l) => l.id === id))
    const grains = ctx.started.filter(([s]) => !s.loop)
    assert.ok(grains.length > 100, `${id}: ${grains.length} events`)
    assert.ok(grains.every(([s, t]) => t > 0 && t < AHEAD && s.buffer.length < ctx.sampleRate * 0.1))
    assert.equal(v.live.size, grains.length)
    // a pump with most of it still queued adds nothing; once half has played, it tops up to AHEAD again
    pump(en, v)
    assert.equal(ctx.started.filter(([s]) => !s.loop).length, grains.length)
    ctx.currentTime = AHEAD / 2 + 1
    pump(en, v)
    const more = ctx.started.filter(([s]) => !s.loop)
    assert.ok(more.length > grains.length && more.at(-1)[1] < ctx.currentTime + AHEAD)
    v.stop()
    assert.equal(v.live.size, 0)
    assert.equal(ctx.stopped, v.sources.length + more.length)
  }
})

test('ocean waves build slowly and wash back quicker, through eased ramps', () => {
  const ctx = fakeCtx(), en = createEngine(ctx, rng(3))
  const v = buildVoice(en, LAYERS.find((l) => l.id === 'ocean'))
  const [a] = v.autos
  const ramps = a.targets[0][0].ramps
  assert.ok(ramps.length > 6 * 10, `${ramps.length} ramp points`) // eased: several points per swing
  assert.ok(ramps.every(([, x]) => x >= 0.08 - 1e-9 && x <= 1 + 1e-9))
})
