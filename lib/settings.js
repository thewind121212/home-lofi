// Per-browser settings (one localStorage key) and the small pure helpers behind them.

export const SETTINGS_KEY = 'home-lofi:settings'

// [accent, accent-2, highlight] -> --color-lofi-primary / secondary / highlight
export const THEMES = {
  sunset: ['#ff8a5c', '#e56b6f', '#fce38a'],
  sakura: ['#ff8fb1', '#d16ba5', '#ffd6e7'],
  matcha: ['#8fd694', '#4fa37a', '#e3f2c1'],
  ocean: ['#5cc8ff', '#4f7cff', '#bfe9ff'],
  lavender: ['#b69cff', '#8a6bd1', '#e6dcff'],
  lemon: ['#ffd166', '#f4a259', '#fff1b8'],
}

// scene weather variants: files at <SCENES_URL>/<mode>/<id>.*; signature = the plain <id>.* files
export const SCENE_WEATHER = ['signature', 'live', 'clear', 'drizzle', 'rain', 'thunderstorm', 'snow', 'leaves']
export const IDLE_SECONDS = [0, 30, 60, 120, 300]

export const DEFAULTS = {
  theme: 'sunset',
  custom: '#ff8a5c',
  idle: 0,
  idleShow: 'clock', // screensaver: 'scene' only, or scene + 'clock'
  // the lock screen's own look (the screensaver keeps the plain one)
  lockClock: 'big', // 'big' | 'small' | 'off'
  lockDate: true, // the date under the clock
  lockOverlay: 'soft', // darken the scene behind it: 'off' | 'soft' | 'dark'
  lockBlur: 'off', // blur the scene behind it: 'off' | 'soft' | 'strong'
  lockMusic: 'bright', // what's playing (radio or Spotify), above the unlock slider: 'bright' | 'dim' (fades when idle) | 'hide'
  lockWeather: true, // the weather under the date
  // ⧉ Mini window (Picture-in-Picture): under its clock
  miniWeather: true,
  miniDate: true,
  dim: 50, // 50 = the original overlay
  clock: 24,
  unit: 'C',
  motion: 'system',
  weather: 'signature',
  onLoad: 'keep',
}

const oneOf = (v, list, d) => (list.includes(v) ? v : d)
const HEX = /^#[0-9a-f]{6}$/i

// Stored JSON string (or anything) -> a complete, valid settings object. Bad or missing fields get the default.
export function parseSettings(raw) {
  let s
  try {
    s = JSON.parse(raw)
  } catch {}
  if (!s || typeof s !== 'object') s = {}
  return {
    theme: oneOf(s.theme, [...Object.keys(THEMES), 'custom'], DEFAULTS.theme),
    custom: typeof s.custom === 'string' && HEX.test(s.custom) ? s.custom.toLowerCase() : DEFAULTS.custom,
    idle: oneOf(s.idle, IDLE_SECONDS, DEFAULTS.idle),
    idleShow: oneOf(s.idleShow === 'small' ? 'clock' : s.idleShow, ['scene', 'clock'], DEFAULTS.idleShow), // 'small' was briefly the lock's
    lockClock: oneOf(s.lockClock, ['big', 'small', 'off'], DEFAULTS.lockClock),
    lockDate: oneOf(s.lockDate, [true, false], DEFAULTS.lockDate),
    lockOverlay: oneOf(s.lockOverlay, ['off', 'soft', 'dark'], DEFAULTS.lockOverlay),
    lockBlur: oneOf(s.lockBlur, ['off', 'soft', 'strong'], DEFAULTS.lockBlur),
    lockMusic: oneOf({ true: 'bright', false: 'hide' }[s.lockMusic] ?? s.lockMusic, ['bright', 'dim', 'hide'], DEFAULTS.lockMusic), // was Show / Hide
    lockWeather: oneOf(s.lockWeather, [true, false], DEFAULTS.lockWeather),
    miniWeather: oneOf(s.miniWeather, [true, false], DEFAULTS.miniWeather),
    miniDate: oneOf(s.miniDate, [true, false], DEFAULTS.miniDate),
    dim: Number.isFinite(s.dim) ? Math.min(100, Math.max(0, Math.round(s.dim))) : DEFAULTS.dim,
    clock: oneOf(s.clock, [24, 12], DEFAULTS.clock),
    unit: oneOf(s.unit, ['C', 'F'], DEFAULTS.unit),
    motion: oneOf(s.motion, ['system', 'reduce'], DEFAULTS.motion),
    weather: oneOf(s.weather, SCENE_WEATHER, DEFAULTS.weather),
    onLoad: oneOf(s.onLoad, ['keep', 'random'], DEFAULTS.onLoad),
  }
}

// One picked accent -> [accent, darker accent-2, light highlight] (sRGB mix with black / white).
// Self-contained on purpose: app/layout.js inlines its source into the pre-paint script.
export function customTheme(hex) {
  const mix = (to, t) =>
    '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + to * t).toString(16).padStart(2, '0')).join('')
  return [hex, mix(0, 0.2), mix(255, 0.65)]
}

// Runs inline in <head> before the first paint (source inlined by app/layout.js, so no outer references): applies the
// saved theme and reduced motion, so a non-default theme doesn't flash the default colors until React's effects run.
export function prePaint(key, themes, custom) {
  try {
    const s = JSON.parse(localStorage.getItem(key)), r = document.documentElement
    const c = s.theme === 'custom' && /^#[0-9a-f]{6}$/i.test(s.custom) ? custom(s.custom) : themes[s.theme]
    if (Array.isArray(c)) ['primary', 'secondary', 'highlight'].forEach((k, i) => r.style.setProperty('--color-lofi-' + k, c[i]))
    if (s.motion === 'reduce') r.dataset.motion = 'reduce'
  } catch {}
}

export const themeColors = (s) => (s.theme === 'custom' ? customTheme(s.custom) : THEMES[s.theme] ?? THEMES.sunset)

// API temps are °C; round after converting. null stays null.
export const toUnit = (c, unit) => (c == null ? null : unit === 'F' ? Math.round((c * 9) / 5 + 32) : c)

const pad = (n) => String(n).padStart(2, '0')
// 24h: { time: '21:05', ampm: '' }, 12h: { time: '9:05', ampm: 'PM' }
export function clockParts(d, clock) {
  const h = d.getHours(), m = pad(d.getMinutes())
  if (clock !== 12) return { time: `${pad(h)}:${m}`, ampm: '' }
  return { time: `${h % 12 || 12}:${m}`, ampm: h < 12 ? 'AM' : 'PM' }
}

// The mini window draws on a canvas, where Font Awesome icons would need their glyph codes: emoji instead
const WX_EMOJI = {
  'fa-sun': '☀️',
  'fa-moon': '🌙',
  'fa-cloud-sun': '⛅',
  'fa-cloud-moon': '☁️',
  'fa-cloud': '☁️',
  'fa-smog': '🌫️',
  'fa-cloud-rain': '🌧️',
  'fa-cloud-showers-heavy': '🌧️',
  'fa-cloud-showers-water': '🌧️',
  'fa-snowflake': '❄️',
  'fa-cloud-bolt': '⛈️',
}
// The mini window's text: { time, ampm, date: 'TUE, OCT 6' ('' = hidden), weather: { icon, temp: '27°C', place } | null }
export function miniText(now, s, wx) {
  return {
    ...clockParts(now, s.clock),
    date: s.miniDate ? now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() : '',
    weather: s.miniWeather && wx?.temp != null ? { icon: WX_EMOJI[wx.icon] ?? '☁️', temp: `${toUnit(wx.temp, s.unit)}°${s.unit}`, place: wx.name ?? '' } : null,
  }
}

// WMO weather_code -> scene variant ('signature' when nothing fits)
export function sceneWeather(code) {
  if (!Number.isInteger(code)) return 'signature'
  if (code >= 0 && code <= 3) return 'clear'
  if (code === 45 || code === 48 || (code >= 51 && code <= 57)) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95 && code <= 99) return 'thunderstorm'
  return 'signature'
}

// Day or night for the scene at `now` (a Date): between today's sunrise and sunset (epoch ms, from /api/weather) at
// the Weather card's location; its isDay when the sun times are missing; the local clock (06:00-18:00) while the
// weather hasn't loaded or failed (wx undefined / null).
export function isDaytime(wx, now) {
  if (Number.isFinite(wx?.sunrise) && Number.isFinite(wx?.sunset)) return +now >= wx.sunrise && +now < wx.sunset
  if (typeof wx?.isDay === 'boolean') return wx.isDay
  return now.getHours() >= 6 && now.getHours() < 18
}

// What plays for night variant `mode` ('signature', 'rain'...): by day (day = a DAY_SCENES id in daytime) its day/
// twin ('day/rain', 'day/signature'), unless that one already failed to load for this scene (bad: '<variant>/<id>').
export const dayVariant = (mode, id, day, bad) => (day && !bad.has(`day/${mode}/${id}`) ? `day/${mode}` : mode)

// A variant's files, without the extension: <url>[/day][/<weather>]/<id> (signature has no weather folder)
export const sceneBase = (url, id, variant) => [url, ...variant.split('/').filter((p) => p !== 'signature'), id].join('/')

// 'rome-colosseum' -> 'Rome Colosseum'
export const sceneName = (id) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
