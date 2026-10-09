// The owner's Spotify picks route (app/api/private/settings/spotify/picks/route.js): who gets in, the 10 s cache, and
// what Spotify's 204 / 401 / 429 / 5xx answers become. Spotify itself is a stub (globalThis.fetch).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../app/api/private/settings/spotify/picks/route.js'
import { _resetPicksForTests } from './spotify.js'

const URL_ = 'http://home.test/api/private/settings/spotify/picks'
const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const get = async (headers = OWNER) => {
  const r = await GET(new Request(URL_, { headers }))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret', SPOTIFY_REFRESH_TOKEN: 'refresh' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}

// Spotify, stubbed: a token, and GET /me/player/queue answering `next` (a Response maker)
const QUEUE = {
  currently_playing: { type: 'track', name: 'Now', uri: 'spotify:track:nowNOW123' },
  queue: [
    { type: 'track', name: 'Next one', uri: 'spotify:track:next111aa', artists: [{ name: 'A' }], album: { name: 'B', images: [{ url: 'https://i.scdn.co/image/n', width: 300 }] }, duration_ms: 200000 },
    { type: 'episode', name: 'A podcast', uri: 'spotify:episode:pod111aa' },
  ],
}
let next = () => Response.json(QUEUE)
let queueCalls = 0
const realFetch = globalThis.fetch, realNow = Date.now
let offset = 0
const later = (ms) => (offset += ms)
test.before(() => {
  Date.now = () => realNow() + offset
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    if (u.host === 'accounts.spotify.com') return Response.json({ access_token: 'token', expires_in: 3600 })
    if (u.pathname === '/v1/me/player/queue') return queueCalls++, next()
    return new Response(null, { status: 500 })
  }
})
test.beforeEach(() => {
  _resetPicksForTests()
  next = () => Response.json(QUEUE)
  queueCalls = 0
})
test.after(() => {
  globalThis.fetch = realFetch
  Date.now = realNow
  env(false)
})

test('Spotify not set up: 404 for everyone, owner included', async () => {
  env(false)
  assert.equal((await get()).status, 404)
  assert.equal(queueCalls, 0)
})

test('owner only: no proxy secrets -> 404, someone else (a visitor) -> 403; Spotify never asked', async () => {
  env(true)
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'x-home-gate': 'wrong-wrong-wrong-wrong' })).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'eve' })).status, 403)
  assert.equal((await get({ 'x-home-gate': GATE, 'remote-user': 'owner' })).status, 404) // not through the owner's location
  assert.equal(queueCalls, 0)
})

test('the owner: the next tracks (episodes left out) and what plays now; private, cached 10 s', async () => {
  env(true)
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.deepEqual(r.body, {
    nowUri: 'spotify:track:nowNOW123',
    picks: [{ title: 'Next one', artists: ['A'], album: 'B', cover: 'https://i.scdn.co/image/n', spotifyUri: 'spotify:track:next111aa', durationSeconds: 200 }],
  })
  await get()
  later(5000)
  await get()
  assert.equal(queueCalls, 1) // within 10 s: one question to Spotify
  later(6000)
  await get()
  assert.equal(queueCalls, 2)
})

test('nothing playing (204), a refused token (401), Spotify down (5xx): an empty list, never an error', async () => {
  env(true)
  for (const status of [204, 401, 500, 502, 503]) {
    _resetPicksForTests()
    next = () => new Response(null, { status })
    const r = await get()
    assert.equal(r.status, 200, String(status))
    assert.deepEqual(r.body, { nowUri: null, picks: [] }, String(status))
  }
  _resetPicksForTests()
  next = () => new Response('not json', { status: 200 })
  assert.deepEqual((await get()).body, { nowUri: null, picks: [] }) // an answer we can't read
})

test('a failure is kept 10 s too (no hammering a Spotify that is down)', async () => {
  env(true)
  next = () => new Response(null, { status: 503 })
  await get()
  await get()
  assert.equal(queueCalls, 1)
})

test('429: an empty list, and Spotify is not asked again until Retry-After has passed', async () => {
  env(true)
  next = () => new Response(null, { status: 429, headers: { 'retry-after': '40' } })
  assert.deepEqual((await get()).body, { nowUri: null, picks: [] })
  next = () => Response.json(QUEUE)
  later(11_000) // past the 10 s cache, still inside Retry-After
  assert.deepEqual((await get()).body, { nowUri: null, picks: [] })
  later(20_000)
  await get()
  assert.equal(queueCalls, 1)
  later(10_000) // 41 s after
  assert.equal((await get()).body.picks.length, 1)
  assert.equal(queueCalls, 2)
})

test('429 without Retry-After: waits 30 s', async () => {
  env(true)
  next = () => new Response(null, { status: 429 })
  await get()
  next = () => Response.json(QUEUE)
  later(29_000)
  await get()
  assert.equal(queueCalls, 1)
  later(2000)
  assert.equal((await get()).body.picks.length, 1)
})

test('an odd answer (a null cover entry) neither breaks this call nor the next ones', async () => {
  env(true)
  next = () => Response.json({ ...QUEUE, queue: [{ ...QUEUE.queue[0], album: { name: 'B', images: [null, 7] } }] })
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.body.picks[0].cover, null)
  next = () => Response.json(QUEUE)
  later(11_000)
  const again = await get()
  assert.equal(again.status, 200)
  assert.equal(again.body.picks[0].cover, 'https://i.scdn.co/image/n')
  assert.equal(queueCalls, 2)
})
