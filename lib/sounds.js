// Sounds: the ambient-sound mixer (rain, wind, a fireplace... under the music). The pure half: the layer registry, the
// presets, the saved mix (a setting: lib/settings.js parseSettings, cloud-synced for the owner), mix -> gains, the
// sleep timer's math and the generated sounds' raw samples. No Web Audio and no React here, so node:test can check it
// all; app/sounds.js turns these into an AudioContext graph and the panel.
//
// A layer is either generated (kind 'gen': noise shaped by filters and slow random envelopes, rendered in the
// browser, no files) or recorded (kind 'file': a loop fetched from `src` and decoded the first time it's turned on).
// `ready: false` keeps a layer out of the panel and silent (the recorded ones, until their files exist), while a saved
// mix or a preset can still name it, so flipping the flag is all it takes to bring it in.

// id, name, Font Awesome icon, kind, trim (loudness calibration: each layer at the same slider level sounds about as
// loud as the others), and for files the loop's URL (served from public/sounds/)
export const LAYERS = [
  { id: 'rain', name: 'Rain', icon: 'fa-cloud-rain', kind: 'gen', trim: 1, ready: true },
  { id: 'wind', name: 'Wind', icon: 'fa-wind', kind: 'gen', trim: 1, ready: true },
  { id: 'brown', name: 'Brown noise', icon: 'fa-brain', kind: 'gen', trim: 0.45, ready: true },
  { id: 'fire', name: 'Fireplace', icon: 'fa-fire-flame-curved', kind: 'gen', trim: 0.9, ready: true },
  { id: 'ocean', name: 'Ocean', icon: 'fa-water', kind: 'gen', trim: 1, ready: true },
  // Phase C: drop the files in, then ready: true (app/sounds.js fetches, decodes and loops them gaplessly)
  { id: 'cafe', name: 'Café', icon: 'fa-mug-hot', kind: 'file', src: '/sounds/cafe.m4a', trim: 1, ready: false },
  { id: 'birds', name: 'Birds', icon: 'fa-dove', kind: 'file', src: '/sounds/birds.m4a', trim: 1, ready: false },
  { id: 'thunder', name: 'Thunder', icon: 'fa-cloud-bolt', kind: 'file', src: '/sounds/thunder.m4a', trim: 1, ready: false },
  { id: 'city', name: 'City', icon: 'fa-city', kind: 'file', src: '/sounds/city.m4a', trim: 1, ready: false },
]
export const LAYER_IDS = LAYERS.map((l) => l.id)
export const layerById = (id) => LAYERS.find((l) => l.id === id)
// the tiles in the panel: the layers that can play
export const shownLayers = (layers = LAYERS) => layers.filter((l) => l.ready)

// Presets: [id, name, icon, { layer: level }]. Picking one turns exactly these layers on (at these levels) and the
// rest off; a layer that isn't ready yet is simply skipped, so Rainy café is just the rain until the café loop exists.
export const PRESETS = [
  ['rainy-cafe', 'Rainy café', 'fa-mug-saucer', { rain: 0.6, cafe: 0.45 }],
  ['cozy-fire', 'Cozy fireplace', 'fa-fire', { fire: 0.75, rain: 0.25, wind: 0.15 }],
  ['storm-night', 'Storm night', 'fa-cloud-showers-heavy', { rain: 0.85, wind: 0.5, thunder: 0.6 }],
  ['seaside', 'Seaside', 'fa-umbrella-beach', { ocean: 0.75, wind: 0.25, birds: 0.3 }],
  ['deep-focus', 'Deep focus', 'fa-brain', { brown: 0.6, rain: 0.2 }],
]

// The sleep timer: off, or stop after this many minutes (the panel's pills)
export const SOUND_TIMERS = [0, 15, 30, 60, 90]

// The saved mix: every layer's switch and level (a switched-off layer keeps its level for next time), the master
// volume, the sleep timer. Whether sounds are playing right now isn't saved: browsers don't let a page start sound by
// itself, so a reload restores the mix and a tap starts it.
export const SOUNDS_DEFAULT = Object.freeze({
  master: 0.8,
  timer: 0,
  layers: Object.freeze(Object.fromEntries(LAYER_IDS.map((id) => [id, Object.freeze({ on: false, level: 0.5 })]))),
})

const unit = (v, d) => (Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : d) // 0-1, 2 decimals

// Anything -> a complete, valid mix (the settings parser's `sounds` field). Unknown layers are dropped, missing or
// broken ones get the default; anything that isn't an object at all is the default mix.
export function parseSounds(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return SOUNDS_DEFAULT
  const ls = s.layers && typeof s.layers === 'object' ? s.layers : {}
  return {
    master: unit(s.master, SOUNDS_DEFAULT.master),
    timer: SOUND_TIMERS.includes(s.timer) ? s.timer : SOUNDS_DEFAULT.timer,
    layers: Object.fromEntries(
      LAYER_IDS.map((id) => {
        const l = Object.hasOwn(ls, id) && ls[id] && typeof ls[id] === 'object' ? ls[id] : {}
        const d = SOUNDS_DEFAULT.layers[id]
        return [id, { on: typeof l.on === 'boolean' ? l.on : d.on, level: unit(l.level, d.level) }]
      }),
    ),
  }
}

// A mix from another device or the cloud copy (lib/sync.js clean) -> the parsed mix, or undefined when anything in it
// is broken (no silent rounding of another device's values). Checked field by field, so key order doesn't matter
// (Postgres jsonb hands objects back with their keys reordered). Layers may be a subset of today's (a mix saved
// before a layer existed: the rest get the default) or name ones this version doesn't know (a newer device's, or a
// layer since removed: dropped), as long as each entry is a well-formed { on, level }.
const exact = (v) => Number.isFinite(v) && unit(v) === v
export function cleanSounds(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  if (Object.keys(v).some((k) => !['master', 'timer', 'layers'].includes(k))) return undefined
  if (!exact(v.master) || !SOUND_TIMERS.includes(v.timer)) return undefined
  const ls = v.layers
  if (!ls || typeof ls !== 'object' || Array.isArray(ls)) return undefined
  const ok = (l) => l && typeof l === 'object' && !Array.isArray(l) && Object.keys(l).length === 2 && typeof l.on === 'boolean' && exact(l.level)
  if (!Object.keys(ls).every((id) => /^[a-z][a-z0-9-]{0,31}$/.test(id) && ok(ls[id]))) return undefined
  return parseSounds(v)
}

// mix edits (each returns a new mix; the old one is left alone)
export const setLayer = (mix, id, patch) => ({ ...mix, layers: { ...mix.layers, [id]: { ...mix.layers[id], ...patch } } })
export function applyPreset(mix, id) {
  const p = PRESETS.find((x) => x[0] === id)
  if (!p) return mix
  return { ...mix, layers: Object.fromEntries(LAYER_IDS.map((l) => [l, Object.hasOwn(p[3], l) ? { on: true, level: p[3][l] } : { ...mix.layers[l], on: false }])) }
}
// the preset the mix is right now (the same layers on, at the same levels, counting only layers that can play), or null
export function presetOf(mix, layers = LAYERS) {
  const on = (want) => layers.filter((l) => l.ready).every((l) => {
    const m = mix.layers[l.id]
    return Object.hasOwn(want, l.id) ? m.on && m.level === want[l.id] : !m.on
  })
  return PRESETS.find((p) => Object.keys(p[3]).some((l) => layers.find((x) => x.id === l)?.ready) && on(p[3]))?.[0] ?? null
}
// the layers that would make sound: switched on, above 0, and able to play
export const audibleLayers = (mix, layers = LAYERS) => layers.filter((l) => l.ready && mix.layers[l.id]?.on && mix.layers[l.id].level > 0).map((l) => l.id)

// A slider position (0-1) -> a gain. Loudness isn't linear in gain: squared, the middle of the slider sounds like the
// middle (a plain linear slider does all its work in the first quarter).
export const curve = (x) => x * x

// The mix -> what each GainNode should be: { master, layers: { id: gain } }. Silent (0) when it isn't playing or is
// muted (master), or for a layer that's off or not ready.
export function mixGains(mix, { playing = false, muted = false, layers = LAYERS } = {}) {
  return {
    master: playing && !muted ? curve(mix.master) : 0,
    layers: Object.fromEntries(layers.map((l) => [l.id, l.ready && mix.layers[l.id]?.on ? curve(mix.layers[l.id].level) * l.trim : 0])),
  }
}

// The mix -> what the engine does with each layer, whoever changed the mix (a tap here, or the owner's other device
// through cloud sync, app/cloud.js): { master: its gain, steps: { id: { do, gain } } }, where do is
//   'fade'    a voice that exists glides to its new level (one fading out comes back): never rebuilt, so no restart
//   'start'   a new voice, only while playing: a mix arriving on a page that isn't playing starts nothing
//   'release' fade out, then stop (a voice already on its way out is left alone)
// voices: { id: 'on' | 'stopping' } for the voices the engine has.
export function mixPlan(mix, { playing = false, muted = false, voices = {}, layers = LAYERS } = {}) {
  const g = mixGains(mix, { playing, muted, layers })
  const steps = {}
  for (const l of layers) {
    const v = voices[l.id], want = g.layers[l.id]
    if (want > 0 && (v || playing)) steps[l.id] = { do: v ? 'fade' : 'start', gain: want }
    else if (v === 'on') steps[l.id] = { do: 'release', gain: 0 }
  }
  return { master: g.master, steps }
}

// The sleep timer: when it ends (epoch ms) for a start at `from`, null when off; and the minutes left to show (rounded
// up, so "1 min" until the very end)
export const timerEnd = (from, minutes) => (minutes > 0 ? from + minutes * 60_000 : null)
export const minutesLeft = (end, now) => (end == null ? null : Math.max(0, Math.ceil((end - now) / 60_000)))

// --- playing on with the screen off (phones) ---------------------------------------------------------------------------
// Web Audio alone is "ambient" sound to a phone: iOS mutes it with the silent switch and stops it when the screen locks,
// Android shows no controls for it. While sounds play, app/sounds.js makes the page a media player instead: it asks iOS
// for a 'playback' audio session (navigator.audioSession, Safari 16.4+) and plays a quiet <audio> loop (quietWav) next
// to the Web Audio graph; that real media element is what keeps the session alive in the background, gets Android's
// audio focus and puts the lock screen's / notification's controls up.
//   hold:  the playback session and the quiet loop: sounds playing with something switched on (muted too: a mute is a
//          moment's pause, not a stop)
//   claim: the Media Session (title, ⏯ on the lock screen, media keys), only while no music of this page plays: the
//          radio or the Player's Listen keep it then, and take it back when they start. Spotify isn't counted: it plays
//          on one of the owner's devices, never in this page, so it has no Media Session here to lose.
export function soundsMedia({ playing, audible, music }) {
  const hold = Boolean(playing && audible > 0)
  return { hold, claim: hold && !music }
}
// The quiet loop's own events -> what the sounds do. held: the page wants the loop playing; paused: the element is
// paused right now (an event can arrive after a newer play / pause of ours has overtaken it); cut: the system paused it.
//   'cut':    the system paused it while held (a call, Siri, another app taking the audio): the sounds stop, as music
//             would, and the lock screen shows ▶
//   'resume': the system played it again after a cut: the sounds come back with it
//   'refuse': it plays without being asked and without a cut before: pause it again
//   null:     our own play / pause, or an event a newer one overtook: nothing
export function loopEvent(type, { held, paused, cut }) {
  if (type === 'pause') return held && paused ? 'cut' : null
  if (type === 'play') return held || paused ? null : cut ? 'resume' : 'refuse'
  return null
}
// The sounds -> the quiet loop: { hold: true } while they play (play it, the playback session); else let it go
// `release` ms later, once a stop's fade (tau, s) is over (any sooner, a locked phone could cut the fade short), also
// after a cut (the session goes back to 'auto'); {} when there's no loop yet (made: false)
export function loopPlan({ hold, made, tau }) {
  if (hold) return { hold: true }
  return made ? { release: tau * 5000 + 200 } : {}
}
// The lock screen's line under "Sounds": the preset when the mix is one, else what's on ("Rain, Wind"), else ''
export function soundsLabel(mix, layers = LAYERS) {
  const p = presetOf(mix, layers)
  if (p) return PRESETS.find((x) => x[0] === p)[1]
  return audibleLayers(mix, layers).map((id) => layers.find((l) => l.id === id).name).join(', ')
}
// The quiet loop: a mono 16-bit WAV, `seconds` long at `rate` Hz, every sample ±1 of 32767 (about -90 dB: nobody can
// hear it, and it isn't exact digital zero, so nothing along the way can take it for an empty track). Six seconds:
// Android Chrome only puts up its media notification for media of 5 s or more. ~96 KB, made in the page (a Blob URL).
export function quietWav(seconds = 6, rate = 8000) {
  const n = Math.round(seconds * rate), size = 44 + n * 2
  const b = new Uint8Array(size), v = new DataView(b.buffer)
  const str = (o, t) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)))
  str(0, 'RIFF'), v.setUint32(4, size - 8, true), str(8, 'WAVE'), str(12, 'fmt '), v.setUint32(16, 16, true)
  v.setUint16(20, 1, true), v.setUint16(22, 1, true), v.setUint32(24, rate, true), v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true), v.setUint16(34, 16, true), str(36, 'data'), v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i & 1 ? 1 : -1, true)
  return b
}

// --- the generated sounds' raw material -----------------------------------------------------------------------------
// Sample buffers rendered once per page (cheap: a few tens of ms) and then looped by the browser's audio thread, so a
// generated layer costs no JavaScript while it plays. Every buffer loops without a click: noise beds crossfade their own
// tail into their head (loopable), event buffers (rain drops, fire crackle) write each grain round the end back to the
// start (circular). Lengths are odd numbers of seconds that don't divide each other, so layered loops drift against each
// other and the whole never audibly repeats.

// seeded random (mulberry32): the same seed, the same sound; the page seeds it from Math.random
export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// scale so the loudest sample is at `peak`
function normalize(x, peak = 0.9) {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m
  return x
}

// Pink noise (Paul Kellet's filter): equal energy per octave, the soft "shhh" under rain, wind and waves.
export function pink(n, rand) {
  const x = new Float32Array(n)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
  }
  return normalize(x)
}

// Brown noise: a leaky running sum of white noise, the deep rumble people focus to (and the fire's roar, the surf).
// The leak keeps it from wandering off; what DC is left goes through the graph's high-pass.
export function brown(n, rand) {
  const x = new Float32Array(n)
  let b = 0
  for (let i = 0; i < n; i++) {
    b = (b + 0.02 * (rand() * 2 - 1)) / 1.02
    x[i] = b
  }
  return normalize(x)
}

// A noise bed of n samples that loops seamlessly: render n + fade samples, then crossfade the extra tail into the head
// (equal power: the two are unrelated noise). The last sample now runs straight on into the first.
export function loopable(render, n, fade, rand) {
  const x = render(n + fade, rand)
  const out = x.slice(0, n)
  for (let i = 0; i < fade; i++) {
    const t = (i + 0.5) / fade
    out[i] = x[i] * Math.sin((t * Math.PI) / 2) + x[n + i] * Math.cos((t * Math.PI) / 2)
  }
  return out
}

// Add `grain` into the circular buffer x at `at` (wrapping round the end), times gain
function addCircular(x, grain, at, gain) {
  for (let i = 0; i < grain.length; i++) x[(at + i) % x.length] += grain[i] * gain
}

// One raindrop: a tiny tick of noise, then a short "plink" whose pitch falls as the drop's bubble rings out.
function drop(sr, rand) {
  const len = Math.round(sr * 0.03)
  const g = new Float32Array(len)
  const f0 = 1800 + rand() * 3200
  const tau = sr * (0.003 + rand() * 0.007)
  let ph = 0
  for (let i = 0; i < len; i++) {
    const e = Math.exp(-i / tau)
    ph += (2 * Math.PI * f0 * (1 + 0.6 * Math.exp(-i / (sr * 0.004)))) / sr
    g[i] = e * (0.55 * Math.sin(ph) + (i < sr * 0.001 ? 0.6 * (rand() * 2 - 1) : 0))
  }
  return g
}

// One crackle: a sharp burst of noise, a little darker or brighter each time (one-pole low-pass of random strength)
function pop(sr, rand) {
  const len = Math.round(sr * (0.001 + rand() * 0.007))
  const g = new Float32Array(len)
  const k = 0.2 + rand() * 0.7
  let y = 0
  for (let i = 0; i < len; i++) {
    y += k * (rand() * 2 - 1 - y)
    g[i] = y * Math.exp((-5 * i) / len)
  }
  return g
}

// Stereo event buffers: [left, right], n samples each, every grain at a random place and pan.
// Rain drops: `rate` drops a second, mostly faint (cubed random), a few close and clear.
export function drops(n, sr, rand, rate = 28) {
  const L = new Float32Array(n), R = new Float32Array(n)
  const count = Math.round((n / sr) * rate)
  for (let k = 0; k < count; k++) {
    const g = drop(sr, rand), at = Math.floor(rand() * n), a = 0.04 + 0.5 * rand() ** 3, p = rand()
    addCircular(L, g, at, a * Math.cos((p * Math.PI) / 2))
    addCircular(R, g, at, a * Math.sin((p * Math.PI) / 2))
  }
  return [normalize(L, 0.8), normalize(R, 0.8)]
}

// Fire crackle: pops come in little bursts (a log splitting: 1-6 pops a few ms to tens of ms apart), `rate` bursts a
// second, mostly small, now and then a loud snap.
export function crackle(n, sr, rand, rate = 1.6) {
  const L = new Float32Array(n), R = new Float32Array(n)
  const bursts = Math.round((n / sr) * rate)
  for (let k = 0; k < bursts; k++) {
    let at = Math.floor(rand() * n)
    const p = 0.2 + rand() * 0.6
    const big = rand() < 0.12
    const pops = 1 + Math.floor(rand() * 6)
    for (let j = 0; j < pops; j++) {
      const a = (big && !j ? 0.9 : 0.08 + 0.45 * rand() ** 2)
      const g = pop(sr, rand)
      addCircular(L, g, at, a * Math.cos((p * Math.PI) / 2))
      addCircular(R, g, at, a * Math.sin((p * Math.PI) / 2))
      at += Math.floor(sr * (0.004 + rand() * 0.06))
    }
  }
  return [normalize(L, 0.9), normalize(R, 0.9)]
}

// Slow random envelopes (gusts of wind, swells of the sea, the fire breathing): points [t, x] with x in 0..1 that swing
// between a low (0..lowMax) and a high (highMin..1), each swing taking a random `every` seconds. app/sounds.js ramps
// AudioParams through them (linearRampToValueAtTime), a minute or so ahead, so nothing repeats and nothing needs a
// timer to be on time. `last`: where the previous batch ended (the next swing goes the other way).
export function envelope(rand, from, until, { every = [3, 7], lowMax = 0.35, highMin = 0.6 } = {}, last = 0) {
  const pts = []
  let t = from, x = last
  while (t < until) {
    t += every[0] + rand() * (every[1] - every[0])
    x = x >= 0.5 ? rand() * lowMax : highMin + rand() * (1 - highMin)
    pts.push([t, x])
  }
  return pts
}
// an envelope point mapped onto a parameter's range
export const lerp = ([lo, hi], x) => lo + (hi - lo) * x

// A recorded loop's playable part [start, end) in samples: without the digital silence an encoder pads the start and the
// end with (AAC / MP3 priming), which would be a gap every time round. channels: the decoded Float32Arrays.
export function loopBounds(channels, threshold = 1e-4) {
  const n = channels[0]?.length ?? 0
  const loud = (i) => channels.some((c) => Math.abs(c[i]) > threshold)
  let start = 0, end = n
  while (start < n && !loud(start)) start++
  while (end > start && !loud(end - 1)) end--
  return end > start ? [start, end] : [0, n]
}
