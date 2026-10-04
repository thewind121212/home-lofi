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
  idleShow: 'clock',
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
    idleShow: oneOf(s.idleShow, ['scene', 'clock'], DEFAULTS.idleShow),
    dim: Number.isFinite(s.dim) ? Math.min(100, Math.max(0, Math.round(s.dim))) : DEFAULTS.dim,
    clock: oneOf(s.clock, [24, 12], DEFAULTS.clock),
    unit: oneOf(s.unit, ['C', 'F'], DEFAULTS.unit),
    motion: oneOf(s.motion, ['system', 'reduce'], DEFAULTS.motion),
    weather: oneOf(s.weather, SCENE_WEATHER, DEFAULTS.weather),
    onLoad: oneOf(s.onLoad, ['keep', 'random'], DEFAULTS.onLoad),
  }
}

// sRGB mix of two #rrggbb colors, t = share of `to` (0..1)
export function mix(hex, to, t) {
  const c = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(c(hex, i) + (c(to, i) - c(hex, i)) * t).toString(16).padStart(2, '0')).join('')
}

// one picked accent -> [accent, darker accent-2, light highlight]
export const customTheme = (hex) => [hex, mix(hex, '#000000', 0.2), mix(hex, '#ffffff', 0.65)]

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

// 'rome-colosseum' -> 'Rome Colosseum'
export const sceneName = (id) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
