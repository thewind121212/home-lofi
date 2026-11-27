// The router's fans (lib/fans.js) and their route (app/api/private/settings/fans) with fan-control stood in
// (globalThis.__homeFansFetch): what reaches the browser, the shared cache, a service that's off or whose Arduino
// doesn't answer, setting one fan or both, and who may read or set them.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { cleanFans, fanStatus, resetFans, setFans } from './fans.js'
import { GET, POST } from '../app/api/private/settings/fans/route.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', FAN_URL: 'http://razer.test:8088/' }
const env = (on) => {
  for (const [k, v] of Object.entries(VARS)) on ? (process.env[k] = v) : delete process.env[k]
}
let svc, calls
const stand = async (url, init = {}) => {
  const u = new URL(url)
  calls.push(`${init.method ?? 'GET'} ${u.pathname}${init.body ? ` ${init.body}` : ''}`)
  if (svc.down) throw new TypeError('fetch failed')
  if (u.pathname === '/api/status') return Response.json(svc.status)
  if (u.pathname === '/api/fan' && init.method === 'POST') {
    if (svc.setError) return Response.json({ error: svc.setError }, { status: 500 })
    const { fan, speed } = JSON.parse(init.body)
    svc.status = { ...svc.status, [`fan${fan}`]: speed }
    return Response.json(svc.status)
  }
  return Response.json({ error: 'not found' }, { status: 404 })
}
test.beforeEach(() => {
  env(true)
  resetFans()
  calls = []
  svc = { status: { fan1: 75, fan2: 50 } }
  globalThis.__homeFansFetch = stand
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
})
test.afterEach(() => {
  env(false)
  mock.timers.reset()
  delete globalThis.__homeFansFetch
})

const req = (method, body, headers = OWNER) =>
  new Request('http://home.test/api/private/settings/fans', {
    method,
    headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })

test('cleanFans: the two speeds as whole numbers 0-100 with their names, nothing else', () => {
  assert.deepEqual(cleanFans({ fan1: 75, fan2: 0, port: '/dev/ttyUSB0' }), {
    reachable: true,
    ok: true,
    fans: [{ id: 1, name: 'Switch fan', speed: 75 }, { id: 2, name: 'Router fan', speed: 0 }],
  })
  assert.deepEqual(cleanFans({ error: 'serial port closed' }), { reachable: true, ok: false })
  assert.equal(cleanFans({ fan1: 101, fan2: 50 }).ok, false)
  assert.equal(cleanFans({ fan1: 50.5, fan2: 50 }).fans[0].speed, null)
  assert.deepEqual(cleanFans(null), { reachable: false, ok: false })
})

test('fanStatus: off without FAN_URL, shared for 2 s, an unreachable service remembered for 10 s', async () => {
  delete process.env.FAN_URL
  assert.equal(await fanStatus(), null)
  process.env.FAN_URL = VARS.FAN_URL
  assert.equal((await fanStatus()).fans[0].speed, 75)
  await fanStatus()
  assert.equal(calls.length, 1)
  mock.timers.tick(2001)
  await fanStatus()
  assert.equal(calls.length, 2)

  resetFans()
  svc.down = true
  assert.deepEqual(await fanStatus(), { reachable: false, ok: false })
  svc.down = false
  mock.timers.tick(5000)
  assert.equal((await fanStatus()).reachable, false) // still remembered
  mock.timers.tick(5001)
  assert.equal((await fanStatus()).ok, true)
})

test('setFans: one fan, or both one after the other; the answer refreshes the cache', async () => {
  assert.equal((await setFans(2, 30)).fans[1].speed, 30)
  assert.deepEqual(calls, ['POST /api/fan {"fan":2,"speed":30}'])
  calls = []
  const both = await setFans('both', 100)
  assert.deepEqual(both.fans.map((f) => f.speed), [100, 100])
  assert.deepEqual(calls, ['POST /api/fan {"fan":1,"speed":100}', 'POST /api/fan {"fan":2,"speed":100}'])
  calls = []
  assert.deepEqual((await fanStatus()).fans.map((f) => f.speed), [100, 100])
  assert.equal(calls.length, 0) // from the cache
  svc.setError = 'serial timeout'
  await assert.rejects(setFans(1, 10))
})

test('GET: the owner reads the speeds; anyone else, or no FAN_URL, is a 403 / 404', async () => {
  const r = await GET(req('GET'))
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'no-store, private')
  assert.deepEqual((await r.json()).fans.map((f) => f.speed), [75, 50])
  assert.equal((await GET(req('GET', undefined, { ...OWNER, 'remote-user': 'guest' }))).status, 403)
  assert.equal((await GET(req('GET', undefined, { 'x-home-gate': GATE }))).status, 404) // not through /settings
  delete process.env.FAN_URL
  assert.equal((await GET(req('GET'))).status, 404)
})

test('POST: the owner sets a fan or both; a bad body never reaches the service', async () => {
  const r = await POST(req('POST', { fan: 1, speed: 60 }))
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.equal(d.ok, true)
  assert.equal(d.fans[0].speed, 60)
  assert.equal((await (await POST(req('POST', { fan: 'both', speed: 0 }))).json()).fans[1].speed, 0)

  calls = []
  for (const bad of [{ fan: 3, speed: 50 }, { fan: '1', speed: 50 }, { fan: 1, speed: 101 }, { fan: 1, speed: -1 }, { fan: 1, speed: 40.5 }, { fan: 1 }]) {
    assert.equal((await POST(req('POST', bad))).status, 400, JSON.stringify(bad))
  }
  assert.equal((await POST(req('POST', '{nope'))).status, 400)
  assert.equal((await POST(req('POST', { fan: 1, speed: 50, pad: 'x'.repeat(300) }))).status, 413)
  assert.equal((await POST(req('POST', { fan: 1, speed: 50 }, { ...OWNER, 'remote-user': 'guest' }))).status, 403)
  assert.equal((await POST(req('POST', { fan: 1, speed: 50 }, { ...OWNER, 'sec-fetch-site': 'cross-site' }))).status, 403)
  assert.deepEqual(calls, [])

  svc.down = true
  assert.equal((await POST(req('POST', { fan: 1, speed: 50 }))).status, 502)
})
