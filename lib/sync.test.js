import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS } from './settings.js'
import { SYNC_KEYS, clean, cleanDoc, merge, takeKeys } from './sync.js'

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
  for (const bad of [null, 'x', { ...mix, timer: 45 }, { ...mix, master: 0.123 }, { ...mix, layers: { ...mix.layers, fire: { on: 'yes', level: 0.5 } } }, { ...mix, layers: { ...mix.layers, x: 'loud' } }, { ...mix, layers: [] }, { ...mix, extra: 1 }, { ...mix, layers: { ...mix.layers, rain: { on: true, level: 0.5, x: 1 } } }]) {
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

test('retired settings (the mini window\'s miniWeather / miniDate): kept by the server for old tabs, never taken by new ones', () => {
  // the server keeps them (booleans only), so a tab still on the old page gets them echoed back and stops pushing
  const raw = { v: { 'settings.miniWeather': false, 'settings.miniDate': true, 'settings.clock': 12 }, t: { 'settings.miniWeather': 5, 'settings.miniDate': 5, 'settings.clock': 6 } }
  assert.deepEqual(cleanDoc(raw, 10), raw)
  assert.equal(clean('settings.miniWeather', false), false)
  assert.equal(clean('settings.miniDate', 'off'), undefined)
  const { doc } = merge(cleanDoc(raw, 10), cleanDoc({ v: { 'settings.miniDate': false }, t: { 'settings.miniDate': 9 } }, 10))
  assert.equal(doc.v['settings.miniDate'], false) // an old tab's change still lands, and comes back to it the same
  // the new page doesn't sync them (no setting, no stamp of its own) and doesn't take them: no change on every pull
  assert.ok(!SYNC_KEYS.some((k) => k.startsWith('settings.mini')))
  const local = { v: { 'settings.clock': 12 }, t: { 'settings.clock': 6 } }
  assert.deepEqual(takeKeys(doc, local), [])
  assert.deepEqual(merge(doc, local).changed, []) // and nothing newer here to push
})

test('takeKeys: newer in the cloud, or the same stamp with another value (changed while signed out)', () => {
  const remote = { v: { 'settings.theme': 'ocean', 'settings.clock': 12, scene: 'tokyo', 'settings.unit': 'F' }, t: { 'settings.theme': 20, 'settings.clock': 5, scene: 7, 'settings.unit': 3 } }
  const local = { v: { 'settings.theme': 'matcha', 'settings.clock': 24, scene: 'paris', 'settings.unit': 'F' }, t: { 'settings.theme': 10, 'settings.clock': 9, scene: 7, 'settings.unit': 3 } }
  assert.deepEqual(takeKeys(remote, local), ['settings.theme', 'scene'])
  assert.deepEqual(takeKeys(remote, { v: {}, t: {} }), ['settings.theme', 'settings.clock', 'scene', 'settings.unit'])
  assert.deepEqual(takeKeys({ v: { junk: 1 }, t: { junk: 99 } }, { v: {}, t: {} }), [])
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

// Postgres jsonb hands objects back with their keys reordered (shorter keys first, then bytewise), at every level
const jsonb = (v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, jsonb(v[k])]))
    : v

test('the Sounds mix survives the cloud copy: key order, older / newer layer sets', () => {
  const mix = { ...DEFAULTS.sounds, master: 0.55, timer: 30, layers: { ...DEFAULTS.sounds.layers, rain: { on: true, level: 0.7 }, ocean: { on: true, level: 0.35 } } }
  const stored = jsonb(mix)
  assert.notEqual(JSON.stringify(stored.layers), JSON.stringify(mix.layers)) // really reordered, layers too
  assert.deepEqual(Object.keys(stored), ['timer', 'layers', 'master'])
  assert.deepEqual(clean('settings.sounds', stored), mix)
  assert.equal(JSON.stringify(clean('settings.sounds', stored)), JSON.stringify(mix)) // back in the canonical order
  // a stored doc reads back with the mix, and sending the same stamps again changes nothing (no rewrite every PUT)
  const fresh = () => cleanDoc({ v: { 'settings.sounds': mix }, t: { 'settings.sounds': 500 } }, 1000)
  const doc = cleanDoc(jsonb({ v: { 'settings.sounds': mix }, t: { 'settings.sounds': 500 } }), 1000)
  assert.deepEqual(doc, { v: { 'settings.sounds': mix }, t: { 'settings.sounds': 500 } })
  assert.deepEqual(merge(doc, fresh()).changed, [])
  assert.deepEqual(merge(fresh(), doc).changed, [])
  // saved before some layers existed: the rest get the default
  const { brown, fire, city, ...older } = mix.layers
  assert.deepEqual(clean('settings.sounds', { ...mix, layers: older }), mix)
  // a newer device's (or a since-removed) layer, well formed: dropped, the rest kept
  assert.deepEqual(clean('settings.sounds', { ...mix, layers: { ...mix.layers, vinyl: { on: true, level: 0.4 } } }), mix)
})
