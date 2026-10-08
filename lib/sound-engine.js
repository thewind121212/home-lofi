// Sounds: the Web Audio side (the graph, no React). app/sounds.js drives it from the page; anything with a
// BaseAudioContext can use it, so an OfflineAudioContext can render a layer to check its level.
//
//   layer voice ─► voice gain (the layer's level, faded) ─┐
//   layer voice ─► voice gain ────────────────────────────┼─► master gain (volume, mute, stop) ─► limiter ─► speakers
//
// A voice is a few looped sample buffers (lib/sounds.js renders them: noise beds, rain drops, fire crackle) through
// filters, into a "mod" gain. Slow random envelopes (gusts, swells, the fire breathing) are AudioParam ramps scheduled a
// minute and a half ahead, so the browser's audio thread does all the work: no JavaScript runs per sample or per drop,
// and a hidden tab (timers throttled) keeps sounding the same. Every loop starts at a random point at a slightly random
// speed, so two layers sharing a buffer never line up.
import { brown, crackle, drops, envelope, lerp, loopBounds, loopable, pink } from './sounds.js'

export const TAU = 0.4 // s: fades are setTargetAtTime with this time constant (~1.5 s to all but there; 5 x TAU = done)
export const SLEEP_TAU = 2.5 // the sleep timer's slow fade out (~10 s)
export const AHEAD = 90 // s of envelope scheduled ahead; app/sounds.js tops it up every 20 s
const NOISE_SR = 24000 // the noise beds are dark: 24 kHz is plenty, at a quarter of the memory of 48 kHz

// The engine for one context: master gain into a gentle limiter (five layers at full tilt mustn't clip).
export function createEngine(ctx, rand = Math.random) {
  const master = ctx.createGain()
  master.gain.value = 0
  const limit = ctx.createDynamicsCompressor()
  limit.threshold.value = -6
  limit.knee.value = 6
  limit.ratio.value = 8
  limit.attack.value = 0.005
  limit.release.value = 0.25
  master.connect(limit).connect(ctx.destination)
  return { ctx, rand, master, voices: new Map(), bufs: new Map(), files: new Map() }
}

// Fade an AudioParam to v from wherever it is now (even mid-fade: the running setTarget carries on until the new one
// takes over, so there's never a jump)
export function ramp(ctx, param, v, tau = TAU) {
  const t = ctx.currentTime
  param.cancelScheduledValues(t)
  param.setTargetAtTime(v, t, tau)
}

// --- buffers ---------------------------------------------------------------------------------------------------------
function stereo(ctx, sr, [L, R]) {
  const b = ctx.createBuffer(2, L.length, sr)
  b.getChannelData(0).set(L)
  b.getChannelData(1).set(R)
  return b
}
// rendered on first use, then shared by every voice in this context. Odd lengths in seconds (see lib/sounds.js)
const BUFFERS = {
  pink: (ctx, r) => stereo(ctx, NOISE_SR, [0, 1].map(() => loopable(pink, Math.round(7.3 * NOISE_SR), NOISE_SR / 2, r))),
  brown: (ctx, r) => stereo(ctx, NOISE_SR, [0, 1].map(() => loopable(brown, Math.round(9.1 * NOISE_SR), NOISE_SR / 2, r))),
  drops: (ctx, r) => stereo(ctx, ctx.sampleRate, drops(Math.round(8.9 * ctx.sampleRate), ctx.sampleRate, r)),
  crackle: (ctx, r) => stereo(ctx, ctx.sampleRate, crackle(Math.round(11.3 * ctx.sampleRate), ctx.sampleRate, r)),
}
function buffer(en, key) {
  if (!en.bufs.has(key)) en.bufs.set(key, BUFFERS[key](en.ctx, en.rand))
  return en.bufs.get(key)
}

// --- small graph helpers -----------------------------------------------------------------------------------------------
function loop(en, key, rate = 1) {
  const s = en.ctx.createBufferSource()
  s.buffer = buffer(en, key)
  s.loop = true
  s.playbackRate.value = rate * (0.97 + en.rand() * 0.06)
  return s
}
function filt(ctx, type, frequency, Q = 0.7) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = Q
  return f
}
function gain(ctx, v) {
  const g = ctx.createGain()
  g.gain.value = v
  return g
}
const chain = (...nodes) => nodes.reduce((a, b) => (a.connect(b), b))
// a slow random envelope driving one or more params together: targets = [param, [lo, hi], delay s?]
const auto = (opts, ...targets) => ({ opts, targets, until: 0, last: 0.5 })

// --- the generated layers ------------------------------------------------------------------------------------------------
// Each wires its sources into `mod` and returns { sources, autos }. Levels inside are balanced by ear-free arithmetic:
// the registry's trim (lib/sounds.js) evens out what's left between layers.
const GEN = {
  // Rain: a steady hiss of pink noise (band-limited, its top end drifting), a bed of drops (each a tiny falling-pitch
  // "plink", panned all round) and a low body of brown noise, the whole swelling gently every 5-12 s.
  rain(en, mod) {
    const { ctx } = en
    const bed = loop(en, 'pink'), drp = loop(en, 'drops'), body = loop(en, 'brown')
    const top = filt(ctx, 'lowpass', 6000, 0.5)
    chain(bed, filt(ctx, 'highpass', 450), top, gain(ctx, 0.55), mod)
    chain(drp, filt(ctx, 'lowpass', 7500), gain(ctx, 0.5), mod)
    chain(body, filt(ctx, 'lowpass', 350), gain(ctx, 0.35), mod)
    return { sources: [bed, drp, body], autos: [auto({ every: [5, 12] }, [mod.gain, [0.72, 1]], [top.frequency, [4500, 7500]])] }
  },
  // Wind: pink noise through a wide band-pass whose centre and level gust together (2-6 s swings), a faint narrow
  // whistle wandering on its own, and a soft low body so the lulls aren't empty.
  wind(en, mod) {
    const { ctx } = en
    const air = loop(en, 'pink'), low = loop(en, 'brown')
    const band = filt(ctx, 'bandpass', 500, 0.8), gust = gain(ctx, 0.6)
    const whistle = filt(ctx, 'bandpass', 1100, 6), wg = gain(ctx, 0)
    chain(air, band, gust, mod)
    chain(air, whistle, wg, mod)
    chain(low, filt(ctx, 'lowpass', 220), gain(ctx, 0.25), mod)
    return {
      sources: [air, low],
      autos: [
        auto({ every: [2, 6], lowMax: 0.3, highMin: 0.55 }, [gust.gain, [0.2, 1.8]], [band.frequency, [280, 850]]),
        auto({ every: [3, 8], lowMax: 0.5, highMin: 0.5 }, [wg.gain, [0, 0.9]], [whistle.frequency, [700, 1500]]),
      ],
    }
  },
  // Brown noise: just that, steady (it's for focus), the very bottom and the very top rolled off.
  brown(en, mod) {
    const { ctx } = en
    const s = loop(en, 'brown')
    chain(s, filt(ctx, 'highpass', 30), filt(ctx, 'lowpass', 1200, 0.5), gain(ctx, 1), mod)
    return { sources: [s], autos: [] }
  },
  // Fireplace: a low roar (brown noise under 220 Hz) breathing every 1-3 s, a faint fizz, and two crackle loops of
  // different lengths and speeds (one bright, one softer and deeper) so the pops never fall into a pattern.
  fire(en, mod) {
    const { ctx } = en
    const roar = loop(en, 'brown'), hiss = loop(en, 'pink'), c1 = loop(en, 'crackle'), c2 = loop(en, 'crackle', 0.8)
    const rg = gain(ctx, 0.6), hg = gain(ctx, 0.03)
    chain(roar, filt(ctx, 'lowpass', 220), filt(ctx, 'highpass', 35), rg, mod)
    chain(hiss, filt(ctx, 'highpass', 2500), hg, mod)
    chain(c1, filt(ctx, 'highpass', 350), gain(ctx, 0.8), mod)
    chain(c2, filt(ctx, 'highpass', 250), filt(ctx, 'lowpass', 4000), gain(ctx, 0.4), mod)
    return {
      sources: [roar, hiss, c1, c2],
      autos: [auto({ every: [0.8, 3] }, [rg.gain, [0.4, 0.85]]), auto({ every: [0.5, 2] }, [hg.gain, [0.01, 0.06]])],
    }
  },
  // Ocean: brown + pink noise through a low-pass; each wave (two swings, 7-13 s) opens the filter and the level as it
  // builds and breaks, and a bright foam of hissing pink noise follows a second behind as it washes back.
  ocean(en, mod) {
    const { ctx } = en
    const deep = loop(en, 'brown'), wash = loop(en, 'pink'), foam = loop(en, 'pink', 1.1)
    const lp = filt(ctx, 'lowpass', 600, 0.6), swell = gain(ctx, 0.3), fg = gain(ctx, 0)
    chain(deep, gain(ctx, 0.8), lp)
    chain(wash, gain(ctx, 0.35), lp)
    chain(lp, swell, mod)
    chain(foam, filt(ctx, 'highpass', 1800), fg, mod)
    return {
      sources: [deep, wash, foam],
      autos: [auto({ every: [3.5, 6.5], lowMax: 0.25, highMin: 0.65 }, [swell.gain, [0.08, 1]], [lp.frequency, [300, 2000]], [fg.gain, [0, 0.35], 1])],
    }
  },
}

// Schedule a voice's envelopes up to AHEAD s from now (a no-op while more than half of that is still queued). The first
// time, or after falling behind, each param starts from where its envelope left off, so there's no jump.
export function pump(en, voice) {
  const now = en.ctx.currentTime
  for (const a of voice.autos) {
    if (a.until > now + AHEAD / 2) continue
    if (a.until <= now) {
      for (const [param, range, delay = 0] of a.targets) {
        param.cancelScheduledValues(now)
        param.setValueAtTime(lerp(range, a.last), now + delay)
      }
    }
    const pts = envelope(en.rand, Math.max(a.until, now), now + AHEAD, a.opts, a.last)
    for (const [t, x] of pts) for (const [param, range, delay = 0] of a.targets) param.linearRampToValueAtTime(lerp(range, x), t + delay)
    if (pts.length) [a.until, a.last] = pts.at(-1)
  }
}

// Fetch + decode a recorded layer's loop, once (a failure is forgotten, so turning it on again retries).
// -> Promise<{ buffer, start, end }> (loop points in s, past the encoder's padding)
export function loadFile(en, layer) {
  if (!en.files.has(layer.id)) {
    const p = fetch(layer.src)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${layer.src}: ${r.status}`))))
      .then((data) => new Promise((ok, bad) => en.ctx.decodeAudioData(data, ok, bad)))
      .then((buffer) => {
        const [a, b] = loopBounds(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)))
        const f = { buffer, start: a / buffer.sampleRate, end: b / buffer.sampleRate }
        en.files.set(layer.id, f)
        return f
      })
      .catch((err) => {
        en.files.delete(layer.id)
        throw err
      })
    en.files.set(layer.id, p)
  }
  return Promise.resolve(en.files.get(layer.id))
}

// A playing voice for `layer`, silent (its gain at 0, for the caller to fade in), or null for a recorded layer whose
// file isn't decoded yet (call loadFile, then again). voice = { gain, sources, autos, stop() }
export function buildVoice(en, layer) {
  const { ctx } = en
  let sources, autos = []
  const out = gain(ctx, 0)
  if (layer.kind === 'file') {
    const f = en.files.get(layer.id)
    if (!f?.buffer) return null
    const s = ctx.createBufferSource()
    s.buffer = f.buffer
    s.loop = true
    s.loopStart = f.start
    s.loopEnd = f.end
    s.connect(out)
    sources = [s]
  } else {
    const mod = gain(ctx, 1)
    mod.connect(out)
    ;({ sources, autos } = GEN[layer.id](en, mod))
  }
  out.connect(en.master)
  const t = ctx.currentTime
  for (const s of sources) {
    const from = s.loopEnd > 0 ? s.loopStart : 0, len = (s.loopEnd > 0 ? s.loopEnd : s.buffer.duration) - from
    s.start(t, from + en.rand() * len)
  }
  const voice = {
    gain: out,
    sources,
    autos,
    stop() {
      for (const s of sources) {
        try {
          s.stop()
        } catch {}
      }
      out.disconnect()
    },
  }
  pump(en, voice)
  return voice
}
