import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, THEMES, parseSettings, customTheme, prePaint, themeColors, toUnit, clockParts, miniText, sceneWeather, sceneName, isDaytime, dayVariant, sceneBase } from './settings.js'
import { DAY_SCENES, SCENES } from './data.js'

test('parseSettings: junk -> defaults', () => {
  for (const raw of [null, undefined, '', 'not json', '42', '"x"', '[]', 'null']) assert.deepEqual(parseSettings(raw), DEFAULTS)
})

test('parseSettings: keeps valid fields, drops bad ones', () => {
  const ok = { theme: 'ocean', custom: '#A1B2C3', idle: 60, idleShow: 'scene', lockClock: 'small', lockDate: false, lockOverlay: 'dark', lockBlur: 'strong', lockMusic: 'dim', lockWeather: false, miniWeather: false, miniDate: false, dim: 80, clock: 12, unit: 'F', motion: 'reduce', weather: 'live', onLoad: 'random' }
  assert.deepEqual(parseSettings(JSON.stringify(ok)), { ...ok, custom: '#a1b2c3' })
  const bad = { theme: 'neon', custom: 'red', idle: 45, idleShow: 'both', lockClock: 'huge', lockDate: 'no', lockOverlay: 'black', lockBlur: 9, lockMusic: 'yes', lockWeather: 'no', miniWeather: 1, miniDate: 'off', dim: '70', clock: '12', unit: 'K', motion: 'off', weather: 'hail', onLoad: 'never' }
  assert.deepEqual(parseSettings(JSON.stringify(bad)), DEFAULTS)
  assert.equal(parseSettings('{"dim":150}').dim, 100)
  assert.equal(parseSettings('{"dim":-3}').dim, 0)
  assert.equal(parseSettings('{"dim":33.6}').dim, 34)
  assert.equal(parseSettings('{"dim":true}').dim, DEFAULTS.dim)
  assert.equal(parseSettings('{"theme":"custom"}').theme, 'custom')
  assert.equal(parseSettings('{"theme":"__proto__"}').theme, 'sunset')
})

test('parseSettings: the lock\'s old idleShow "small" becomes the screensaver clock', () => {
  assert.equal(parseSettings('{"idleShow":"small"}').idleShow, 'clock')
  assert.equal(parseSettings('{"idleWake":"hold"}').idleWake, undefined) // gone
  assert.equal(parseSettings('{"lockMusic":true}').lockMusic, 'bright') // was Show / Hide
  assert.equal(parseSettings('{"lockMusic":false}').lockMusic, 'hide')
})

test('custom theme: darker accent-2, lighter highlight', () => {
  assert.deepEqual(customTheme('#000000'), ['#000000', '#000000', '#a6a6a6'])
  assert.deepEqual(customTheme('#ffffff'), ['#ffffff', '#cccccc', '#ffffff'])
  assert.deepEqual(customTheme('#5cc8ff'), ['#5cc8ff', '#4aa0cc', '#c6ecff'])
  const [a, a2, hi] = customTheme('#336699')
  const sum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
  assert.ok(sum(a2) < sum(a) && sum(hi) > sum(a))
  assert.deepEqual(themeColors({ theme: 'custom', custom: '#5cc8ff' }), customTheme('#5cc8ff'))
  assert.deepEqual(themeColors({ theme: 'sunset' }), ['#ff8a5c', '#e56b6f', '#fce38a'])
  // the pre-paint script inlines its source: it must work with no outer scope
  assert.deepEqual(new Function(`return ${customTheme}`)()('#5cc8ff'), customTheme('#5cc8ff'))
})

test('pre-paint script (inlined source) applies theme + motion', () => {
  const run = (saved) => {
    const props = {}, root = { style: { setProperty: (k, v) => (props[k] = v) }, dataset: {} }
    const ls = { getItem: () => saved }
    new Function('localStorage', 'document', `(${prePaint})('k', ${JSON.stringify(THEMES)}, ${customTheme})`)(ls, { documentElement: root })
    return [props, root.dataset.motion]
  }
  assert.deepEqual(run('{"theme":"ocean","motion":"reduce"}'), [
    { '--color-lofi-primary': '#5cc8ff', '--color-lofi-secondary': '#4f7cff', '--color-lofi-highlight': '#bfe9ff' },
    'reduce',
  ])
  assert.equal(run('{"theme":"custom","custom":"#5cc8ff"}')[0]['--color-lofi-secondary'], '#4aa0cc')
  for (const bad of [null, 'junk', '{"theme":"custom","custom":"red"}', '{"theme":"__proto__"}']) assert.deepEqual(run(bad), [{}, undefined])
})

test('°C -> °F', () => {
  assert.equal(toUnit(0, 'F'), 32)
  assert.equal(toUnit(100, 'F'), 212)
  assert.equal(toUnit(-40, 'F'), -40)
  assert.equal(toUnit(27, 'F'), 81) // 80.6
  assert.equal(toUnit(27, 'C'), 27)
  assert.equal(toUnit(null, 'F'), null)
})

test('clock 24h / 12h', () => {
  const at = (h, m) => new Date(2026, 9, 4, h, m)
  assert.deepEqual(clockParts(at(21, 5), 24), { time: '21:05', ampm: '' })
  assert.deepEqual(clockParts(at(0, 5), 24), { time: '00:05', ampm: '' })
  assert.deepEqual(clockParts(at(21, 5), 12), { time: '9:05', ampm: 'PM' })
  assert.deepEqual(clockParts(at(0, 5), 12), { time: '12:05', ampm: 'AM' })
  assert.deepEqual(clockParts(at(12, 0), 12), { time: '12:00', ampm: 'PM' })
  assert.deepEqual(clockParts(at(11, 59), 12), { time: '11:59', ampm: 'AM' })
})

test('mini window text: clock format, unit, toggles', () => {
  const at = new Date(2026, 9, 6, 21, 5) // a Tuesday
  const wx = { temp: 27, icon: 'fa-cloud-rain', name: 'Da Lat' }
  assert.deepEqual(miniText(at, DEFAULTS, wx), { time: '21:05', ampm: '', date: 'TUE, OCT 6', weather: { icon: '🌧️', temp: '27°C', place: 'Da Lat' } })
  const t = miniText(at, { ...DEFAULTS, clock: 12, unit: 'F' }, { temp: 27, icon: 'fa-new' })
  assert.deepEqual([t.time, t.ampm, t.weather], ['9:05', 'PM', { icon: '☁️', temp: '81°F', place: '' }])
  const off = miniText(at, { ...DEFAULTS, miniDate: false, miniWeather: false }, wx)
  assert.deepEqual([off.date, off.weather], ['', null])
  for (const w of [undefined, null, { temp: null }]) assert.equal(miniText(at, DEFAULTS, w).weather, null)
})

test('WMO code -> scene weather', () => {
  const m = (codes) => codes.map(sceneWeather)
  assert.deepEqual(m([0, 1, 2, 3]), Array(4).fill('clear'))
  assert.deepEqual(m([45, 48, 51, 53, 55, 56, 57]), Array(7).fill('drizzle'))
  assert.deepEqual(m([61, 63, 65, 66, 67, 80, 81, 82]), Array(8).fill('rain'))
  assert.deepEqual(m([71, 73, 75, 77, 85, 86]), Array(6).fill('snow'))
  assert.deepEqual(m([95, 96, 99]), Array(3).fill('thunderstorm'))
  assert.deepEqual(m([4, 44, 60, 68, 90, 100, -1, null, undefined, '61', 2.5]), Array(11).fill('signature'))
})

test('scene name', () => {
  assert.equal(sceneName('rome-colosseum'), 'Rome Colosseum')
  assert.equal(sceneName('london'), 'London')
})

test('isDaytime: sun times, then isDay, then the 06:00-18:00 clock', () => {
  const rise = Date.UTC(2026, 9, 6, 22, 16), set = Date.UTC(2026, 9, 7, 10, 6) // Hong Kong 06:16 / 18:06, seen from UTC
  const wx = { sunrise: rise, sunset: set, isDay: false } // sun times win over a stale isDay
  assert.equal(isDaytime(wx, new Date(rise - 1)), false)
  assert.equal(isDaytime(wx, new Date(rise)), true)
  assert.equal(isDaytime(wx, new Date(set - 1)), true)
  assert.equal(isDaytime(wx, new Date(set)), false)
  assert.equal(isDaytime({ sunrise: null, sunset: null, isDay: true }, new Date(2026, 0, 1, 23)), true)
  assert.equal(isDaytime({ isDay: false }, new Date(2026, 0, 1, 12)), false)
  for (const w of [undefined, null, {}]) {
    assert.deepEqual([5, 6, 12, 17, 18, 23].map((h) => isDaytime(w, new Date(2026, 0, 1, h, 59))), [false, true, true, true, false, false])
  }
})

test('dayVariant + sceneBase: day/night x weather, failed day files fall back to night', () => {
  const bad = new Set(['day/rain/rome'])
  const path = (mode, id, day) => sceneBase('/s', id, dayVariant(mode, id, day, bad))
  assert.equal(path('signature', 'hong-kong', true), '/s/day/hong-kong')
  assert.equal(path('signature', 'hong-kong', false), '/s/hong-kong')
  assert.equal(path('thunderstorm', 'rome', true), '/s/day/thunderstorm/rome')
  assert.equal(path('thunderstorm', 'rome', false), '/s/thunderstorm/rome')
  assert.equal(path('rain', 'rome', true), '/s/rain/rome') // day/rain/rome failed
  assert.equal(path('rain', 'hong-kong', true), '/s/day/rain/hong-kong')
  assert.ok(DAY_SCENES.every((id) => SCENES.includes(id)))
})
