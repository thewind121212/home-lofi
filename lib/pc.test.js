// The gaming PC (lib/pc.js) and its Wake route (app/api/private/settings/pc) with moni-relay stood in
// (globalThis.__homePcFetch): what reaches the browser, the shared cache, a stopped relay, and who may wake the PC.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { cleanPc, pcStatus, resetPc, wakePc } from './pc.js'
import { POST } from '../app/api/private/settings/pc/route.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const TOKEN = 'wake-token-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', PC_URL: 'http://relay.test:5007/', PC_WAKE_TOKEN: TOKEN }
const env = (on) => {
  for (const [k, v] of Object.entries(VARS)) on ? (process.env[k] = v) : delete process.env[k]
}
const ONLINE = {
  status: 'Online', online: true, waking: false, can_wake: true, last_seen: 'now', parts: true, sender: '10.10.0.92',
  n: { cpu: 30.2, ct: 59, gpu: 97, gt: 69, mt: 48, st: 59, ram: 57.9, ramgb: 31.1, vram: 9.2, vramgb: 11.9, sysw: 294.06, up: 113539, fan: 1467, pf: 3149 },
}
const OFFLINE = { status: 'Offline', online: false, waking: false, can_wake: true, last_seen: '21:40', cpu: '–' }
let relay, calls
const stand = async (url, init = {}) => {
  const u = new URL(url)
  calls.push(`${init.method ?? 'GET'} ${u.pathname} ${init.headers?.authorization ?? ''}`.trim())
  if (relay.down) throw new TypeError('fetch failed')
  if (u.pathname === '/status') return Response.json(relay.status)
  if (u.pathname === '/wake') return Response.json(relay.wake ?? { ok: true, sent: true }, { status: relay.wakeStatus ?? 200 })
  return new Response('', { status: 404 })
}
test.beforeEach(() => {
  env(true)
  resetPc()
  calls = []
  relay = { status: ONLINE }
  globalThis.__homePcFetch = stand
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
})
test.afterEach(() => {
  env(false)
  mock.timers.reset()
  delete globalThis.__homePcFetch
})

const wake = (headers = OWNER, body = { action: 'wake' }) =>
  POST(new Request('http://home.test/api/private/settings/pc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))

test('online: numbers only, the relay\'s extra fields and 0 = no sensor dropped', () => {
  const pc = cleanPc({ ...ONLINE, n: { ...ONLINE.n, mt: 0, evil: '<script>' }, sender: 'x', host: 'y' })
  assert.deepEqual(Object.keys(pc).sort(), ['canWake', 'lastSeen', 'online', 'parts', 'reachable', 'stats', 'waking'])
  assert.equal(pc.online, true)
  assert.equal(pc.canWake, false, 'no Wake button while it is on')
  assert.equal(pc.stats.ct, 59)
  assert.equal(pc.stats.mt, null)
  assert.equal(pc.stats.evil, undefined)
  assert.equal(pc.parts, true)
})

test('offline: last seen, no stats, Wake only with a token here and on the relay', () => {
  const pc = cleanPc(OFFLINE)
  assert.equal(pc.online, false)
  assert.equal(pc.stats, undefined)
  assert.equal(pc.lastSeen, '21:40')
  assert.equal(pc.canWake, true)
  assert.equal(cleanPc({ ...OFFLINE, can_wake: false }).canWake, false)
  delete process.env.PC_WAKE_TOKEN
  assert.equal(cleanPc(OFFLINE).canWake, false)
  assert.equal(cleanPc({ ...OFFLINE, waking: true }).waking, true)
  assert.deepEqual(cleanPc('nope'), { reachable: false })
})

test('status: off without PC_URL; shared for TTL; a stopped relay is remembered, not waited on', async () => {
  delete process.env.PC_URL
  assert.equal(await pcStatus(), null)
  process.env.PC_URL = VARS.PC_URL
  assert.equal((await pcStatus()).online, true)
  await pcStatus()
  assert.equal(calls.length, 1, 'two tabs within 2 s: one ask')
  mock.timers.setTime(1_000_000 + 2500)
  relay.down = true
  assert.deepEqual(await pcStatus(), { reachable: false })
  mock.timers.setTime(1_000_000 + 2500 + 10_000)
  await pcStatus()
  assert.equal(calls.length, 2, 'the failure is kept for a while')
  assert.equal(calls[0], 'GET /status')
})

test('wake: the owner only, through the settings location', async () => {
  relay.status = OFFLINE
  assert.equal((await wake({ 'x-home-gate': GATE })).status, 404, 'the open /api/private location (LAN): no')
  assert.equal((await wake({ ...OWNER, 'remote-user': 'guest' })).status, 403)
  assert.equal((await wake({ ...OWNER, 'x-home-gate': 'wrong-gate-secret-0123456789' })).status, 404)
  assert.equal(calls.length, 0)
  const r = await wake()
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: true, sent: true })
  assert.deepEqual(calls, [`POST /wake Bearer ${TOKEN}`])
})

test('wake: off without a token or PC_URL; bad bodies and cross-site posts refused', async () => {
  assert.equal((await wake(OWNER, { action: 'reboot' })).status, 400)
  assert.equal((await wake(OWNER, '{nope')).status, 400)
  assert.equal((await wake({ ...OWNER, 'sec-fetch-site': 'cross-site' })).status, 403)
  delete process.env.PC_WAKE_TOKEN
  assert.equal((await wake()).status, 404)
  process.env.PC_WAKE_TOKEN = 'short'
  assert.equal((await wake()).status, 404, 'a token under 16 characters counts as none')
  process.env.PC_WAKE_TOKEN = TOKEN
  delete process.env.PC_URL
  assert.equal((await wake()).status, 404)
  assert.equal(calls.length, 0)
})

test('wake: the relay down or refusing is a 502; online already is sent: false', async () => {
  relay.down = true
  assert.equal((await wake()).status, 502)
  relay = { status: ONLINE, wake: { ok: false, error: 'unauthorized' }, wakeStatus: 401 }
  assert.equal((await wake()).status, 502)
  relay = { status: ONLINE, wake: { ok: true, sent: false } }
  assert.deepEqual(await wakePc(), { sent: false })
})
