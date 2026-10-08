import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LAYERS, LAYER_IDS, PRESETS, SOUND_TIMERS, SOUNDS_DEFAULT, applyPreset, audibleLayers, brown, cleanSounds, crackle, curve, drops, envelope, layerById, lerp,
  loopBounds, loopEvent, loopPlan, loopable, minutesLeft, mixGains, parseSounds, pink, presetOf, quietWav, rng, setLayer, shownLayers, soundsLabel, soundsMedia,
  timerEnd,
} from './sounds.js'

const on = (mix, levels) => Object.entries(levels).reduce((m, [id, level]) => setLayer(m, id, { on: true, level }), mix)

test('registry: unique ids, generated + recorded, recorded ones hidden until their files exist', () => {
  assert.equal(new Set(LAYER_IDS).size, LAYERS.length)
  for (const l of LAYERS) {
    assert.ok(['gen', 'file'].includes(l.kind), l.id)
    assert.match(l.icon, /^fa-[a-z-]+$/)
    assert.ok(l.trim > 0 && l.trim <= 1, l.id)
    if (l.kind === 'file') assert.match(l.src, new RegExp(`^/sounds/${l.id}\\.m4a$`))
  }
  assert.deepEqual(shownLayers().map((l) => l.id), ['rain', 'wind', 'brown', 'fire', 'ocean'])
  assert.deepEqual(['cafe', 'birds', 'thunder', 'city'].map((id) => [layerById(id).kind, layerById(id).ready]), Array(4).fill(['file', false]))
  // Phase C flips the flag: the layer shows up and can play
  const later = LAYERS.map((l) => (l.id === 'cafe' ? { ...l, ready: true } : l))
  assert.ok(shownLayers(later).some((l) => l.id === 'cafe'))
})

test('presets: known layers, sane levels, each has something that plays today', () => {
  assert.equal(new Set(PRESETS.map((p) => p[0])).size, PRESETS.length)
  for (const [id, name, icon, levels] of PRESETS) {
    assert.ok(name && /^fa-/.test(icon), id)
    for (const [l, v] of Object.entries(levels)) assert.ok(LAYER_IDS.includes(l) && v > 0 && v <= 1, `${id}.${l}`)
    assert.ok(Object.keys(levels).some((l) => layerById(l).ready), id)
  }
})

test('applyPreset: exactly its layers on, others off with their level kept; presetOf recognises it', () => {
  const start = on(SOUNDS_DEFAULT, { wind: 0.9, brown: 0.3 })
  const m = applyPreset(start, 'cozy-fire')
  assert.deepEqual(m.layers.fire, { on: true, level: 0.75 })
  assert.deepEqual(m.layers.rain, { on: true, level: 0.25 })
  assert.deepEqual(m.layers.wind, { on: true, level: 0.15 })
  assert.deepEqual(m.layers.brown, { on: false, level: 0.3 }) // off, level remembered
  assert.equal(presetOf(m), 'cozy-fire')
  assert.equal(presetOf(setLayer(m, 'fire', { level: 0.7 })), null) // moved a slider: no longer the preset
  assert.equal(presetOf(SOUNDS_DEFAULT), null)
  assert.equal(applyPreset(start, 'nope'), start)
  assert.deepEqual(start.layers.fire, SOUNDS_DEFAULT.layers.fire) // input untouched
  // a preset naming a hidden recorded layer: it's turned on in the mix but makes no sound, and still counts as the preset
  const cafe = applyPreset(SOUNDS_DEFAULT, 'rainy-cafe')
  assert.deepEqual(cafe.layers.cafe, { on: true, level: 0.45 })
  assert.deepEqual(audibleLayers(cafe), ['rain'])
  assert.equal(presetOf(cafe), 'rainy-cafe')
  assert.equal(presetOf(setLayer(cafe, 'cafe', { on: false })), 'rainy-cafe') // (only playable layers count)
})

test('parseSounds: garbage -> the default mix; fields validated one by one', () => {
  for (const junk of [undefined, null, 'x', 5, [], true]) assert.equal(parseSounds(junk), SOUNDS_DEFAULT)
  assert.deepEqual(parseSounds({}), SOUNDS_DEFAULT)
  assert.deepEqual(Object.keys(parseSounds({}).layers), LAYER_IDS)
  const p = parseSounds({
    master: 0.456,
    timer: 30,
    layers: { rain: { on: true, level: 1.7 }, wind: { on: 'yes', level: -1 }, fire: 'hot', brown: { level: 0.25 }, nope: { on: true, level: 1 }, __proto__: { on: true } },
  })
  assert.equal(p.master, 0.46)
  assert.equal(p.timer, 30)
  assert.deepEqual(p.layers.rain, { on: true, level: 1 })
  assert.deepEqual(p.layers.wind, { on: false, level: 0 })
  assert.deepEqual(p.layers.fire, SOUNDS_DEFAULT.layers.fire)
  assert.deepEqual(p.layers.brown, { on: false, level: 0.25 })
  assert.ok(!('nope' in p.layers))
  for (const t of [45, '30', null, -15]) assert.equal(parseSounds({ timer: t }).timer, 0)
  for (const m of ['1', NaN, null]) assert.equal(parseSounds({ master: m }).master, SOUNDS_DEFAULT.master)
  assert.deepEqual(SOUND_TIMERS, [0, 15, 30, 60, 90])
  // a parsed mix parses to itself (what cloud sync relies on)
  assert.deepEqual(parseSounds(JSON.parse(JSON.stringify(p))), p)
})

test('mixGains: squared levels x trim, silent when stopped / muted / off / not ready', () => {
  const m = on({ ...SOUNDS_DEFAULT, master: 0.5 }, { rain: 0.5, ocean: 1, cafe: 1 })
  const g = mixGains(m, { playing: true })
  assert.equal(g.master, 0.25)
  assert.equal(g.layers.rain, 0.25 * layerById('rain').trim)
  assert.equal(g.layers.ocean, layerById('ocean').trim)
  assert.equal(g.layers.wind, 0)
  assert.equal(g.layers.cafe, 0) // not ready yet
  assert.equal(mixGains(m, { playing: false }).master, 0)
  assert.equal(mixGains(m, { playing: true, muted: true }).master, 0)
  assert.equal(mixGains(m, { playing: false }).layers.rain, g.layers.rain) // layers keep their level; master does the stop
  assert.deepEqual(Object.keys(g.layers), LAYER_IDS)
  assert.deepEqual([curve(0), curve(0.5), curve(1)], [0, 0.25, 1])
  assert.deepEqual(audibleLayers(setLayer(m, 'rain', { level: 0 })), ['ocean'])
})

test('sleep timer: end time, minutes left (rounded up, never negative)', () => {
  const t0 = Date.UTC(2026, 9, 8, 22, 0)
  assert.equal(timerEnd(t0, 0), null)
  assert.equal(timerEnd(t0, 30), t0 + 30 * 60_000)
  const end = timerEnd(t0, 15)
  assert.equal(minutesLeft(end, t0), 15)
  assert.equal(minutesLeft(end, t0 + 1), 15)
  assert.equal(minutesLeft(end, end - 61_000), 2)
  assert.equal(minutesLeft(end, end - 1), 1)
  assert.equal(minutesLeft(end, end), 0)
  assert.equal(minutesLeft(end, end + 5000), 0)
  assert.equal(minutesLeft(null, t0), null)
})

const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

test('noise: deterministic, bounded, pink brighter than brown', () => {
  const p = pink(20000, rng(7)), b = brown(20000, rng(7))
  assert.deepEqual(pink(20000, rng(7)), p)
  assert.notDeepEqual(pink(20000, rng(8)), p)
  for (const x of [p, b]) assert.ok(peak(x) <= 0.9 + 1e-6 && rms(x) > 0.05)
  // brightness: how much the signal moves sample to sample, relative to its level
  const step = (x) => rms(x.slice(1).map((v, i) => v - x[i])) / rms(x)
  assert.ok(step(p) > 2 * step(b), `${step(p)} vs ${step(b)}`)
})

test('loopable: the end runs straight on into the start (no click at the loop point)', () => {
  // a ramp 0 -> 1 would jump from ~1 back to 0 every loop; looped, the seam is a step like any other
  const ramp = (m) => Float32Array.from({ length: m }, (_, i) => i / m)
  const n = 1000, x = loopable(ramp, n, 100)
  assert.equal(x.length, n)
  const steps = x.slice(1).map((v, i) => Math.abs(v - x[i]))
  assert.ok(Math.abs(x[0] - x[n - 1]) <= 2 * Math.max(...steps.slice(200)), `${x[0]} ${x[n - 1]}`)
  // and noise beds: the seam step is an ordinary one
  const b = loopable(brown, 24000, 2400, rng(3))
  const st = b.slice(1).map((v, i) => Math.abs(v - b[i]))
  assert.ok(Math.abs(b[0] - b.at(-1)) <= Math.max(...st))
})

test('event buffers: stereo, the right density, bounded, circular (grains wrap round)', () => {
  const sr = 8000, n = sr * 3
  const [L, R] = drops(n, sr, rng(1))
  assert.equal(L.length, n)
  assert.equal(R.length, n)
  assert.ok(peak(L) <= 0.8 + 1e-6 && peak(R) <= 0.8 + 1e-6 && peak(L) > 0)
  assert.notDeepEqual(L, R) // panned, not mono
  const [cl] = crackle(n, sr, rng(2))
  assert.ok(peak(cl) <= 0.9 + 1e-6 && peak(cl) > 0)
  // crackle is sparse (mostly silence between bursts), rain is dense
  const busy = (x) => x.filter((v) => Math.abs(v) > 0.01).length / x.length
  assert.ok(busy(cl) < busy(L), `${busy(cl)} vs ${busy(L)}`)
})

test('envelope: swings low / high, steps within `every`, covers the span, continues from `last`', () => {
  const pts = envelope(rng(5), 10, 100, { every: [4, 6], lowMax: 0.3, highMin: 0.7 }, 0)
  assert.ok(pts.at(-1)[0] >= 100 && pts.at(-2)[0] < 100)
  let t = 10
  pts.forEach(([at, x], i) => {
    assert.ok(at - t >= 4 && at - t <= 6)
    assert.ok(i % 2 ? x <= 0.3 : x >= 0.7) // from last = 0 (low), the first swing goes up
    t = at
  })
  assert.ok(envelope(rng(5), 0, 10, {}, 0.9)[0][1] <= 0.35) // after a high, down
  assert.deepEqual(envelope(rng(5), 50, 50), [])
  assert.equal(lerp([200, 1000], 0.5), 600)
})

test('loopBounds: skips the encoder padding at both ends', () => {
  const a = new Float32Array([0, 0, 0.5, -0.2, 0.3, 0, 0]), b = new Float32Array([0, 0, 0, 0.1, 0, 0.00001, 0])
  assert.deepEqual(loopBounds([a, b]), [2, 5])
  assert.deepEqual(loopBounds([new Float32Array(4)]), [0, 4]) // all silent: the whole thing
  assert.deepEqual(loopBounds([]), [0, 0])
})

test('cleanSounds: strict but order-free; subsets and unknown well-formed layers are fine', () => {
  const mix = on({ ...SOUNDS_DEFAULT, master: 0.3, timer: 90 }, { wind: 0.45 })
  const flipped = { layers: Object.fromEntries(Object.entries(mix.layers).reverse().map(([k, v]) => [k, { level: v.level, on: v.on }])), timer: 90, master: 0.3 }
  assert.deepEqual(cleanSounds(flipped), mix)
  assert.deepEqual(cleanSounds({ master: 0.3, timer: 90, layers: { wind: { on: true, level: 0.45 } } }), mix)
  assert.deepEqual(cleanSounds({ ...mix, layers: { ...mix.layers, rain2: { on: false, level: 0 } } }), mix)
  const bads = [
    null, [], 'x', {}, { ...mix, master: 0.333 }, { ...mix, master: '0.3' }, { ...mix, timer: 20 }, { ...mix, layers: null }, { ...mix, nope: true },
    { ...mix, layers: { ...mix.layers, wind: { on: 1, level: 0.4 } } }, { ...mix, layers: { ...mix.layers, wind: { on: true, level: 1.5 } } },
    { ...mix, layers: { 'Bad Id': { on: true, level: 0.5 } } },
  ]
  for (const bad of bads) assert.equal(cleanSounds(bad), undefined, JSON.stringify(bad))
})

test('soundsMedia: hold the phone\'s playback session while sounds play; the lock screen only when no music plays', () => {
  assert.deepEqual(soundsMedia({ playing: true, audible: 2, music: false }), { hold: true, claim: true })
  assert.deepEqual(soundsMedia({ playing: true, audible: 1, music: true }), { hold: true, claim: false }) // the radio keeps it
  assert.deepEqual(soundsMedia({ playing: false, audible: 2, music: false }), { hold: false, claim: false }) // paused / stopped
  assert.deepEqual(soundsMedia({ playing: true, audible: 0, music: false }), { hold: false, claim: false }) // every tile off
  assert.deepEqual(soundsMedia({ playing: undefined, audible: undefined, music: undefined }), { hold: false, claim: false })
})

test('soundsLabel: the preset, else what is on, else nothing', () => {
  assert.equal(soundsLabel(applyPreset(SOUNDS_DEFAULT, 'cozy-fire')), 'Cozy fireplace')
  assert.equal(soundsLabel(applyPreset(SOUNDS_DEFAULT, 'rainy-cafe')), 'Rainy café') // the café loop isn't ready: still the preset
  assert.equal(soundsLabel(on(SOUNDS_DEFAULT, { rain: 0.5, wind: 0.3 })), 'Rain, Wind')
  assert.equal(soundsLabel(setLayer(applyPreset(SOUNDS_DEFAULT, 'deep-focus'), 'brown', { level: 0.9 })), 'Rain, Brown noise') // a preset, changed
  assert.equal(soundsLabel(on(SOUNDS_DEFAULT, { ocean: 0 })), '') // on, but at 0
  assert.equal(soundsLabel(SOUNDS_DEFAULT), '')
})

test('quietWav: a valid mono 16-bit WAV, 5 s or more, too quiet to hear but not all zeros', () => {
  const b = quietWav()
  const v = new DataView(b.buffer)
  const text = (o, n) => String.fromCharCode(...b.slice(o, o + n))
  assert.equal(text(0, 4), 'RIFF')
  assert.equal(text(8, 8), 'WAVEfmt ')
  assert.equal(text(36, 4), 'data')
  assert.equal(v.getUint32(4, true), b.length - 8)
  const [fmt, ch, rate, byteRate, align, bits, data] = [v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint32(28, true), v.getUint16(32, true), v.getUint16(34, true), v.getUint32(40, true)]
  assert.deepEqual([fmt, ch, bits, align, byteRate], [1, 1, 16, 2, rate * 2])
  assert.equal(data, b.length - 44)
  assert.ok(data / byteRate >= 5) // Android's media notification wants 5 s or more
  let peak = 0, zeros = 0
  for (let o = 44; o < b.length; o += 2) {
    const x = v.getInt16(o, true)
    peak = Math.max(peak, Math.abs(x))
    zeros += x === 0
  }
  assert.equal(peak, 1)
  assert.equal(zeros, 0)
  assert.equal(quietWav(1, 8000).length, 44 + 16000)
})

test('loopEvent: the system pausing the held loop stops the sounds; playing it after that brings them back', () => {
  // a call / Siri / another app pauses it while sounds play
  assert.equal(loopEvent('pause', { held: true, paused: true, cut: false }), 'cut')
  // our own pause (held already let go), or a pause event overtaken by a newer play of ours
  assert.equal(loopEvent('pause', { held: false, paused: true, cut: false }), null)
  assert.equal(loopEvent('pause', { held: true, paused: false, cut: false }), null)
  // the system plays it again after the interruption
  assert.equal(loopEvent('play', { held: false, paused: false, cut: true }), 'resume')
  // it plays though nobody asked and nothing was cut: paused again
  assert.equal(loopEvent('play', { held: false, paused: false, cut: false }), 'refuse')
  // our own play, or a play event overtaken by a newer pause
  assert.equal(loopEvent('play', { held: true, paused: false, cut: false }), null)
  assert.equal(loopEvent('play', { held: false, paused: true, cut: true }), null)
  assert.equal(loopEvent('ended', { held: true, paused: true, cut: false }), null)
})

test('loopPlan: hold while sounds play, let go after the stop\'s fade (slow for the sleep timer), nothing without a loop', () => {
  assert.deepEqual(loopPlan({ hold: true, made: false, tau: 0.4 }), { hold: true })
  assert.deepEqual(loopPlan({ hold: true, made: true, tau: 0.4 }), { hold: true })
  assert.deepEqual(loopPlan({ hold: false, made: true, tau: 0.4 }), { release: 2200 }) // ~1.5 s fade + a margin
  assert.deepEqual(loopPlan({ hold: false, made: true, tau: 2.5 }), { release: 12700 }) // the sleep timer's slow fade
  assert.deepEqual(loopPlan({ hold: false, made: false, tau: 0.4 }), {}) // never started: nothing to let go
})
