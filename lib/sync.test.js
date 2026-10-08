import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS } from './settings.js'
import { SYNC_KEYS, clean, cleanDoc, merge } from './sync.js'

const LOC = { id: 1566083, name: 'Ho Chi Minh City', region: 'Ho Chi Minh', country: 'Vietnam', lat: 10.8231, lon: 106.6297, tz: 'Asia/Ho_Chi_Minh' }

test('clean: settings fields only when already valid', () => {
  assert.equal(clean('settings.theme', 'ocean'), 'ocean')
  assert.equal(clean('settings.unit', 'F'), 'F')
  assert.equal(clean('settings.dim', 80), 80)
  assert.equal(clean('settings.custom', '#a1b2c3'), '#a1b2c3')
  // the Sounds mix (an object): valid as it is, or not at all (no silent rounding of another device's values)
  const mix = { ...DEFAULTS.sounds, timer: 60, layers: { ...DEFAULTS.sounds.layers, fire: { on: true, level: 0.75 } } }
  assert.deepEqual(clean('settings.sounds', mix), mix)
  assert.deepEqual(clean('settings.sounds', JSON.parse(JSON.stringify(mix))), mix)
  for (const bad of [null, 'x', { ...mix, timer: 45 }, { ...mix, master: 0.123 }, { ...mix, layers: { ...mix.layers, fire: { on: 'yes', level: 0.5 } } }, { ...mix, layers: { ...mix.layers, x: { on: true, level: 1 } } }]) {
    assert.equal(clean('settings.sounds', bad), undefined, JSON.stringify(bad))
  }
  for (const [k, v] of [['settings.theme', 'neon'], ['settings.dim', 33.6], ['settings.dim', '70'], ['settings.idle', 45], ['settings.clock', '12'], ['settings.__proto__', 1], ['settings.nope', 1], ['nope', 1]]) {
    assert.equal(clean(k, v), undefined, `${k}=${v}`)
  }
})

test('clean: scene and location', () => {
  assert.equal(clean('scene', 'tokyo'), 'tokyo')
  assert.equal(clean('scene', '../etc'), undefined)
  assert.deepEqual(clean('location', LOC), LOC)
  const { region, country, ...bare } = LOC
  assert.deepEqual(clean('location', bare), bare) // optional fields stay absent
  assert.deepEqual(clean('location', { ...LOC, id: '1566083', extra: 'x' }), LOC) // id normalised, unknown fields dropped
  for (const bad of [null, 'x', { ...LOC, lat: 'a' }, { ...LOC, tz: 5 }, { ...LOC, id: '1; drop' }]) assert.equal(clean('location', bad), undefined)
  assert.equal(clean('location', { ...LOC, name: 'x'.repeat(200) }).name, '') // oversized text is dropped, not stored
})

test('cleanDoc: drops invalid keys and stamps, caps future stamps', () => {
  const now = 1_000_000
  const raw = {
    v: { 'settings.theme': 'ocean', 'settings.unit': 'K', scene: 'tokyo', location: LOC, junk: 1 },
    t: { 'settings.theme': 500, 'settings.unit': 600, scene: 9_999_999, location: -1, junk: 5 },
  }
  assert.deepEqual(cleanDoc(raw, now), { v: { 'settings.theme': 'ocean', scene: 'tokyo' }, t: { 'settings.theme': 500, scene: now } })
  for (const junk of [null, undefined, 'x', [], { v: 1, t: 2 }]) assert.deepEqual(cleanDoc(junk, now), { v: {}, t: {} })
})

test('merge: newer side wins per key, ties keep base', () => {
  const base = { v: { 'settings.theme': 'ocean', 'settings.clock': 24, scene: 'tokyo' }, t: { 'settings.theme': 10, 'settings.clock': 30, scene: 5 } }
  const inc = { v: { 'settings.theme': 'matcha', 'settings.clock': 12, scene: 'paris', location: LOC }, t: { 'settings.theme': 20, 'settings.clock': 20, scene: 5, location: 1 } }
  const { doc, changed } = merge(base, inc)
  assert.deepEqual(doc.v, { 'settings.theme': 'matcha', 'settings.clock': 24, scene: 'tokyo', location: LOC })
  assert.deepEqual(changed.sort(), ['location', 'settings.theme'])
  assert.deepEqual(base.v['settings.theme'], 'ocean') // inputs untouched
  assert.deepEqual(merge(doc, doc).changed, [])
})

test('every synced key accepts its default value; volume and tab stay per device', () => {
  const defaults = { scene: 'london', location: LOC, ...Object.fromEntries(Object.entries(DEFAULTS).map(([f, v]) => [`settings.${f}`, v])) }
  for (const k of SYNC_KEYS) assert.deepEqual(clean(k, defaults[k]), defaults[k], k)
  assert.ok(!SYNC_KEYS.includes('volume') && !SYNC_KEYS.includes('tab'))
})
