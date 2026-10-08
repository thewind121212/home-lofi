import { test } from 'node:test'
import assert from 'node:assert/strict'
import { done, failReason, shape, shapeDevice, spotifyOn, volumeOf } from './spotify.js'

test('shape: only public track info, the ~300 px cover', () => {
  const track = {
    name: 'Snowman',
    artists: [{ name: 'WYS', id: 'x' }, { name: 'Sweet Dreams' }],
    album: { name: 'Snowman', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] },
    external_urls: { spotify: 'https://open.spotify.com/track/1' },
    duration_ms: 180000,
    available_markets: ['VN'],
  }
  assert.deepEqual(shape(track), { track: 'Snowman', artists: ['WYS', 'Sweet Dreams'], album: 'Snowman', art: 'mid', url: 'https://open.spotify.com/track/1', durationMs: 180000 })
  assert.deepEqual(shape({ name: 'x' }), { track: 'x', artists: [], album: null, art: null, url: null, durationMs: null })
  assert.equal(shape({ name: 'x', album: { images: [{ url: 'only' }] } }).art, 'only') // no sizes given
})

test('spotifyOn: needs all three env vars', () => {
  const keys = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN']
  const saved = keys.map((k) => process.env[k])
  keys.forEach((k) => delete process.env[k])
  assert.equal(spotifyOn(), false)
  process.env.SPOTIFY_CLIENT_ID = 'a'
  process.env.SPOTIFY_CLIENT_SECRET = 'b'
  assert.equal(spotifyOn(), false)
  process.env.SPOTIFY_REFRESH_TOKEN = 'c'
  assert.equal(spotifyOn(), true)
  keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])))
})

test('done: Spotify reports the change (paused / playing / another track)', () => {
  const a = { playing: true, track: 'A', url: 'u1' }
  assert.equal(done('pause', null, { ...a, playing: false }), true)
  assert.equal(done('pause', null, a), false) // still playing: not yet
  assert.equal(done('play', null, { ...a, playing: false }), false)
  assert.equal(done('play', null, a), true)
  assert.equal(done('next', a, { playing: true, track: 'B', url: 'u2' }), true)
  assert.equal(done('next', a, a), false) // same track: not yet
  assert.equal(done('previous', a, { playing: false }), false) // nothing playing: not confirmed
})

test('volumeOf: a whole percent 0-100, nothing else', () => {
  for (const v of [0, 1, 37, 100]) assert.equal(volumeOf(v), v)
  for (const v of [-1, 101, 50.5, '50', '', null, undefined, NaN, Infinity, true, [50], { v: 50 }]) assert.equal(volumeOf(v), null, String(v))
})

test('shapeDevice: name, type, volume, whether it can be set; never the id', () => {
  const d = { id: 'abc123', is_active: true, is_private_session: false, name: 'Kitchen', type: 'Speaker', volume_percent: 42, supports_volume: true }
  assert.deepEqual(shapeDevice(d), { name: 'Kitchen', type: 'Speaker', volume: 42, supportsVolume: true })
  // an iPhone: Spotify won't let anyone else set its volume
  assert.deepEqual(shapeDevice({ name: 'iPhone', type: 'Smartphone', volume_percent: 100, supports_volume: false }), { name: 'iPhone', type: 'Smartphone', volume: 100, supportsVolume: false })
  // no level reported: nothing to show on the slider either
  assert.equal(shapeDevice({ name: 'TV', type: 'TV', volume_percent: null, supports_volume: true }).supportsVolume, false)
  assert.deepEqual(shapeDevice({}), { name: 'Spotify', type: null, volume: null, supportsVolume: false })
  assert.equal(shapeDevice(null), null)
  assert.equal(shapeDevice(undefined), null)
})

test('failReason: what the page says when Spotify refuses a command', () => {
  assert.equal(failReason(403, 'PREMIUM_REQUIRED'), 'premium')
  assert.equal(failReason(403, 'VOLUME_CONTROL_DISALLOW'), 'volume') // a 403, but not the token's fault
  assert.equal(failReason(404, 'NO_ACTIVE_DEVICE'), 'device')
  assert.equal(failReason(404), 'device')
  assert.equal(failReason(401), 'scope')
  assert.equal(failReason(403), 'scope')
  assert.equal(failReason(429), 'spotify')
  assert.equal(failReason(502), 'spotify')
  assert.equal(failReason(undefined), 'spotify') // a timeout, no answer at all
})
