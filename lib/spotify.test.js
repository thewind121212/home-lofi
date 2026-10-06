import { test } from 'node:test'
import assert from 'node:assert/strict'
import { done, shape, spotifyOn } from './spotify.js'

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
