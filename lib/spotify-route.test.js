// The owner's Spotify route (app/api/private/settings/spotify/route.js): who gets in, what's refused, and that a device
// read crossing a volume change doesn't put the old level back. Spotify itself is a stub (globalThis.fetch).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GET, POST } from '../app/api/private/settings/spotify/route.js'

const URL_ = 'http://home.test/api/private/settings/spotify'
const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const get = (headers = OWNER) => GET(new Request(URL_, { headers }))
const post = (body, headers = {}) =>
  POST(new Request(URL_, { method: 'POST', headers: { ...OWNER, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret', SPOTIFY_REFRESH_TOKEN: 'refresh' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}

// Spotify, stubbed: a token, GET /me/player (the device; `slow` holds the answer until released), PUT volume
let player = { volume: 30 }, slow = null
const calls = []
const realFetch = globalThis.fetch, realNow = Date.now
let offset = 0
test.before(() => {
  Date.now = () => realNow() + offset
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url)
    calls.push(`${opts.method ?? 'GET'} ${u.pathname}${u.search}`)
    if (u.host === 'accounts.spotify.com') return Response.json({ access_token: 'token', expires_in: 3600 })
    if (u.pathname === '/v1/me/player' && !opts.method) {
      const body = { device: { id: 'secret-device-id', name: 'Kitchen', type: 'Speaker', volume_percent: player.volume, supports_volume: true }, is_playing: true }
      if (slow) await slow.promise
      return Response.json(body)
    }
    if (u.pathname === '/v1/me/player/volume' && opts.method === 'PUT') return (player.volume = Number(u.searchParams.get('volume_percent'))), new Response(null, { status: 204 })
    return new Response(null, { status: 500 })
  }
})
test.after(() => {
  globalThis.fetch = realFetch
  Date.now = realNow
  env(false)
})

test('Spotify not set up: 404 for everyone, owner included', async () => {
  env(false)
  assert.equal((await get()).status, 404)
  assert.equal((await post({ action: 'volume', percent: 10 })).status, 404)
})

test('the owner gate: no proxy secrets -> 404, someone else -> 403, on GET and POST', async () => {
  env(true)
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'x-home-sync': 'wrong-wrong-wrong-wrong' })).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'eve' })).status, 403)
  assert.equal((await post({ action: 'volume', percent: 10 }, { 'remote-user': 'eve' })).status, 403)
  assert.equal(calls.length, 0) // Spotify never asked
})

test('POST volume: cross-site or not JSON -> 403, a bad level -> 400, before Spotify is asked', async () => {
  env(true)
  assert.equal((await post({ action: 'volume', percent: 10 }, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await post({ action: 'volume', percent: 10 }, { 'content-type': 'text/plain' })).status, 403)
  for (const percent of [150, -1, 50.5, '50', null, undefined]) {
    const r = await post({ action: 'volume', percent })
    assert.equal(r.status, 400, String(percent))
    assert.deepEqual(await r.json(), { error: 'bad volume' })
  }
  assert.equal((await post('null')).status, 400) // a body that isn't an object: unknown action, no crash
  assert.equal((await post({ action: 'louder' })).status, 400)
  assert.equal(calls.length, 0)
})

test('GET: the active device, never its id; the answer is private and not cached', async () => {
  env(true)
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'no-store, private')
  assert.deepEqual(await r.json(), { enabled: true, device: { name: 'Kitchen', type: 'Speaker', volume: 30, supportsVolume: true } })
})

test('a device read that began before a volume change keeps the new level (no 10 s of the old one)', async () => {
  env(true)
  offset += 11_000 // the cached device is stale: the next GET asks Spotify
  let release
  slow = { promise: new Promise((ok) => (release = ok)) }
  const reading = get() // its answer will say 30: Spotify read before the change
  await new Promise((ok) => setTimeout(ok, 10))
  const set = await post({ action: 'volume', percent: 80 })
  assert.equal(set.status, 200)
  assert.equal((await set.json()).device.volume, 80)
  release()
  slow = null
  assert.equal((await (await reading).json()).device.volume, 80) // settled: the level that was set
  assert.equal((await (await get()).json()).device.volume, 80) // and cached as such
  assert.ok(calls.includes('PUT /v1/me/player/volume?volume_percent=80'))
})
