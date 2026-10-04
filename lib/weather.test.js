import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wmo, uvLabel, parseWeatherParams, parseGeoQuery, shapeGeo, memoCache } from './weather.js'

test('wmo mapping', () => {
  assert.deepEqual(wmo(0, true), { desc: 'Clear Sky', icon: 'fa-sun' })
  assert.deepEqual(wmo(0, false), { desc: 'Clear Sky', icon: 'fa-moon' })
  assert.equal(wmo(2, false).icon, 'fa-cloud-moon')
  assert.equal(wmo(3, false).icon, 'fa-cloud') // no night variant -> day icon
  assert.equal(wmo(95).icon, 'fa-cloud-bolt')
  assert.equal(wmo(1234).desc, 'Unknown')
})

test('uv bands', () => {
  assert.deepEqual([0, 2.9, 3, 5.9, 6, 8, 11].map(uvLabel), ['Low', 'Low', 'Mod', 'Mod', 'High', 'Very High', 'Extreme'])
  assert.equal(uvLabel(Math.round(5.96)), 'High') // route rounds before labelling
})

test('weather params', () => {
  const ok = { lat: '10.8231', lon: '106.6297', tz: 'Asia/Ho_Chi_Minh', id: '1566083', name: 'Ho Chi Minh City' }
  assert.deepEqual(parseWeatherParams(ok), { ...ok, lat: 10.82, lon: 106.63 })
  assert.equal(parseWeatherParams({ ...ok, lat: '10.823149' }).lat, 10.82)
  assert.ok(parseWeatherParams({ ...ok, tz: 'Etc/GMT+10' }))
  assert.ok(parseWeatherParams({ ...ok, tz: 'America/Argentina/Buenos_Aires' }))
  assert.ok(parseWeatherParams({ ...ok, name: null }))
  for (const bad of [
    { lat: '91' }, { lat: '' }, { lat: null }, { lat: '1e2' }, { lat: '0x10' },
    { lon: '-180.5' }, { lon: 'abc' },
    { tz: '' }, { tz: '../etc' }, { tz: 'Asia/Ho Chi Minh' }, { tz: 'a/b/c/d' },
    { id: '12a' }, { id: '' }, { id: '-1' },
    { name: 'x'.repeat(81) },
  ]) assert.equal(parseWeatherParams({ ...ok, ...bad }), null, JSON.stringify(bad))
})

test('geo query', () => {
  assert.equal(parseGeoQuery(' Tokyo '), 'Tokyo')
  assert.equal(parseGeoQuery(''), null)
  assert.equal(parseGeoQuery('   '), null)
  assert.equal(parseGeoQuery(null), null)
  assert.equal(parseGeoQuery('x'.repeat(81)), null)
})

test('geo shaping', () => {
  const r = (i, extra) => ({ id: i, name: 'N' + i, latitude: 1, longitude: 2, timezone: 'UTC', country: 'C', ...extra })
  const out = shapeGeo([r(1, { admin1: 'England', population: 9 }), r(2, { timezone: undefined }), r(3), r(4), r(5), r(6), r(7)])
  assert.deepEqual(out[0], { id: 1, name: 'N1', region: 'England', country: 'C', lat: 1, lon: 2, tz: 'UTC' })
  assert.equal(out[1].region, undefined) // missing admin1 omitted
  assert.deepEqual(out.map((x) => x.id), [1, 3, 4, 5, 6]) // no-timezone dropped, top 5
  assert.deepEqual(shapeGeo(undefined), [])
})

test('memo cache: ttl + oldest eviction', () => {
  let t = 0
  const c = memoCache(2, 100, () => t)
  c.set('a', 1)
  c.set('b', 2)
  c.set('a', 1) // refresh a -> b is now oldest
  c.set('c', 3)
  assert.equal(c.get('b'), undefined)
  assert.equal(c.get('a'), 1)
  assert.equal(c.get('c'), 3)
  t = 101
  assert.equal(c.get('a'), undefined) // expired
})
