import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, parseSettings, mix, customTheme, themeColors, toUnit, clockParts, sceneWeather, sceneName } from './settings.js'

test('parseSettings: junk -> defaults', () => {
  for (const raw of [null, undefined, '', 'not json', '42', '"x"', '[]', 'null']) assert.deepEqual(parseSettings(raw), DEFAULTS)
})

test('parseSettings: keeps valid fields, drops bad ones', () => {
  const ok = { theme: 'ocean', custom: '#A1B2C3', idle: 60, idleShow: 'scene', dim: 80, clock: 12, unit: 'F', motion: 'reduce', weather: 'live', onLoad: 'random' }
  assert.deepEqual(parseSettings(JSON.stringify(ok)), { ...ok, custom: '#a1b2c3' })
  const bad = { theme: 'neon', custom: 'red', idle: 45, idleShow: 'both', dim: '70', clock: '12', unit: 'K', motion: 'off', weather: 'hail', onLoad: 'never' }
  assert.deepEqual(parseSettings(JSON.stringify(bad)), DEFAULTS)
  assert.equal(parseSettings('{"dim":150}').dim, 100)
  assert.equal(parseSettings('{"dim":-3}').dim, 0)
  assert.equal(parseSettings('{"dim":33.6}').dim, 34)
  assert.equal(parseSettings('{"dim":true}').dim, DEFAULTS.dim)
  assert.equal(parseSettings('{"theme":"custom"}').theme, 'custom')
  assert.equal(parseSettings('{"theme":"__proto__"}').theme, 'sunset')
})

test('custom theme: darker accent-2, lighter highlight', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(mix('#ff8a5c', '#000000', 0), '#ff8a5c')
  assert.deepEqual(customTheme('#5cc8ff'), ['#5cc8ff', '#4aa0cc', '#c6ecff'])
  const [a, a2, hi] = customTheme('#336699')
  const sum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
  assert.ok(sum(a2) < sum(a) && sum(hi) > sum(a))
  assert.deepEqual(themeColors({ theme: 'custom', custom: '#5cc8ff' }), customTheme('#5cc8ff'))
  assert.deepEqual(themeColors({ theme: 'sunset' }), ['#ff8a5c', '#e56b6f', '#fce38a'])
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
