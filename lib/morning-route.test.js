// The owner's morning summary switch (app/api/private/settings/morning): who gets in, on by default, off and on again,
// what it accepts. No database: the stores are memoryStore()s (globalThis.__home*Store).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GET, PUT } from '../app/api/private/settings/morning/route.js'
import { memoryStore } from './reminders-store.js'
import { memoryStore as habitsMemory } from './habits-store.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', NOTIFY_TOKEN: 'notify-token-for-tests-0123456789' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
let store
test.beforeEach(() => {
  env(true)
  store = globalThis.__homeRemindersStore = memoryStore()
  globalThis.__homeHabitsStore = habitsMemory()
})
test.after(() => {
  env(false)
  delete globalThis.__homeRemindersStore
  delete globalThis.__homeHabitsStore
})

const call = async (fn, method, body, headers = OWNER, site = 'same-origin') => {
  const init = { method, headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json', 'sec-fetch-site': site }) } }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const r = await fn(new Request('http://home.test/api/private/settings/morning', init))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}
const get = (headers) => call(GET, 'GET', undefined, headers)
const put = (body, headers, site) => call(PUT, 'PUT', body, headers, site)

test('guests: nothing (404 / 403), so the Settings sheet shows no switch; nothing changes', async () => {
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await get({ ...OWNER, 'x-home-sync': 'x'.repeat(32) })).status, 404) // (not through the login's location)
  assert.equal((await get({ ...OWNER, 'x-home-gate': 'y'.repeat(32) })).status, 404)
  assert.equal((await put({ morning: false }, {})).status, 404)
  assert.equal((await put({ morning: false }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await put({ morning: false }, { ...OWNER, 'remote-user': '' })).status, 403)
  assert.deepEqual(await store.prefs('owner'), { morning: true })
})

test('the hub off (no token / database / owner): 404, the switch would do nothing', async () => {
  delete process.env.NOTIFY_TOKEN
  assert.equal((await get()).status, 404)
  assert.equal((await put({ morning: false })).status, 404)
  env(true)
  delete process.env.DATABASE_URL
  assert.equal((await get()).status, 404)
})

test('on by default; off and on again, kept on the server', async () => {
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.deepEqual(r.body, { morning: true, at: '06:00', times: ['06:00', '13:00', '18:00'], tz: 'Asia/Ho_Chi_Minh' })
  const off = await put({ morning: false })
  assert.equal(off.status, 200)
  assert.deepEqual(off.body, { morning: false, at: '06:00', times: ['06:00', '13:00', '18:00'], tz: 'Asia/Ho_Chi_Minh' })
  assert.deepEqual(await store.prefs('owner'), { morning: false }) // (what the ticker reads)
  assert.equal((await get()).body.morning, false)
  assert.equal((await put({ morning: true })).body.morning, true)
  // the owner's zone: the Habits doc's
  await globalThis.__homeHabitsStore.putDoc('owner', { tz: 'Europe/Berlin', habits: [] })
  assert.equal((await get()).body.tz, 'Europe/Berlin')
})

test('a bad body: 400 (413 too large); same-origin JSON only', async () => {
  assert.equal((await put({ morning: 'off' })).body.field, 'morning')
  assert.equal((await put({})).status, 400)
  assert.equal((await put('{nope')).status, 400)
  assert.equal((await put('x'.repeat(2000))).status, 413)
  assert.equal((await put({ morning: false }, OWNER, 'cross-site')).status, 403)
  const form = await PUT(new Request('http://home.test/x', { method: 'PUT', headers: { ...OWNER, 'content-type': 'text/plain' }, body: JSON.stringify({ morning: false }) }))
  assert.equal(form.status, 403)
  assert.equal((await get()).body.morning, true)
})

test('the database away: 503, never a crash', async () => {
  globalThis.__homeRemindersStore = new Proxy({}, { get: () => async () => { throw new Error('down') } })
  assert.equal((await get()).status, 503)
  assert.equal((await put({ morning: false })).status, 503)
})
