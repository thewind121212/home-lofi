// The owner's focus route (app/api/private/settings/focus): who gets in, start / pause / resume / skip / stop on the
// server's clock, the count of the day, races (two devices at once, the ticker in between), the live stream, and the
// stopped session's notice leaving the inbox. No database: the stores are memoryStore()s (globalThis.__home*Store); the
// clock is node:test's mock.timers.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { GET, POST } from '../app/api/private/settings/focus/route.js'
import { memoryStore } from './focus-store.js'
import { memoryStore as habitsMemory } from './habits-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { liveBus } from './live.js'
import { MINUTE } from './focus.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', NOTIFY_TOKEN: 'notify-token-for-tests-0123456789' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026 (Wednesday the 14th)
const at = (h, m, day = 14) => Date.UTC(2026, 9, day, h - 7, m)
const T0 = at(10, 0)
let store, notes
test.beforeEach(() => {
  env(true)
  store = globalThis.__homeFocusStore = memoryStore()
  globalThis.__homeHabitsStore = habitsMemory()
  notes = globalThis.__homeNotifyStore = notifyMemory(() => Date.now())
  mock.timers.enable({ apis: ['Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())
test.after(() => {
  env(false)
  delete globalThis.__homeFocusStore
  delete globalThis.__homeHabitsStore
  delete globalThis.__homeNotifyStore
})

const call = async (fn, method, body, headers = OWNER) => {
  const init = { method, headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) } }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const r = await fn(new Request('http://home.test/api/private/settings/focus', init))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}
const get = (headers) => call(GET, 'GET', undefined, headers)
const post = (body, headers) => call(POST, 'POST', body, headers)
const later = (ms) => mock.timers.setTime(Date.now() + ms)

test('guests: nothing (404 / 403), so the page shows no icon; nothing changes', async () => {
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await get({ ...OWNER, 'x-home-sync': 'x'.repeat(32) })).status, 404)
  assert.equal((await post({ action: 'start', preset: '25/5' }, {})).status, 404)
  assert.equal((await post({ action: 'start', preset: '25/5' }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  delete process.env.DATABASE_URL
  assert.equal((await get()).status, 404)
  env(true)
  assert.equal((await store.get('owner')).session, null)
})

test('GET: no session yet; the server\'s clock and day, the presets', async () => {
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.deepEqual(r.body, { session: null, today: { day: '2026-10-14', n: 0 }, now: T0, tz: 'Asia/Ho_Chi_Minh', minute: MINUTE, presets: ['25/5', '50/10'] })
})

test('start: the server stamps the times (a time from the page is ignored); same-origin JSON only', async () => {
  const r = await post({ action: 'start', preset: '25/5', phaseEndsAt: 1, startedAt: 1 })
  assert.equal(r.status, 200)
  const s = r.body.session
  assert.match(s.id, /^[a-f0-9]{12}$/)
  assert.deepEqual({ ...s, id: 'x' }, { id: 'x', preset: '25/5', phase: 'focus', round: 1, startedAt: T0, touchedAt: T0, phaseMs: 25 * MINUTE, phaseEndsAt: T0 + 25 * MINUTE, pausedLeft: null })
  assert.equal(r.body.now, T0)
  assert.deepEqual((await get()).body.session, s) // kept on the server: every device gets the same
  assert.equal((await post({ action: 'start', preset: '15/3' })).body.field, 'preset')
  assert.equal((await post({ action: 'nap' })).status, 400)
  assert.equal((await post('{nope')).status, 400)
  assert.equal((await post('x'.repeat(2000))).status, 413)
  const cross = await POST(new Request('http://home.test/x', { method: 'POST', headers: { ...OWNER, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ action: 'stop' }) }))
  assert.equal(cross.status, 403)
  const form = await POST(new Request('http://home.test/x', { method: 'POST', headers: { ...OWNER, 'content-type': 'text/plain' }, body: JSON.stringify({ action: 'stop' }) }))
  assert.equal(form.status, 403)
  assert.deepEqual((await get()).body.session, s)
})

test('pause / resume on the server\'s clock; twice is 409 with the fresh state; skip; stop', async () => {
  await post({ action: 'start', preset: '50/10' })
  later(10 * MINUTE)
  let r = await post({ action: 'pause' })
  assert.deepEqual([r.status, r.body.session.phaseEndsAt, r.body.session.pausedLeft], [200, null, 40 * MINUTE])
  const again = await post({ action: 'pause' })
  assert.equal(again.status, 409)
  assert.equal(again.body.error, 'already paused')
  assert.equal(again.body.session.pausedLeft, 40 * MINUTE)
  later(60 * MINUTE)
  r = await post({ action: 'resume' })
  assert.equal(r.body.session.phaseEndsAt, Date.now() + 40 * MINUTE)
  assert.equal((await post({ action: 'resume' })).status, 409)
  r = await post({ action: 'skip' })
  assert.deepEqual([r.body.session.phase, r.body.session.round, r.body.session.phaseEndsAt], ['break', 1, Date.now() + 10 * MINUTE])
  assert.equal(r.body.today.n, 0) // a skipped focus doesn't count
  r = await post({ action: 'stop' })
  assert.deepEqual([r.status, r.body.session], [200, null])
  const twice = await post({ action: 'stop' })
  assert.deepEqual([twice.status, twice.body.session], [409, null])
})

test('two devices at once: both "pause" -> one wins, the other hears 409 with the same paused state', async () => {
  await post({ action: 'start', preset: '25/5' })
  later(5 * MINUTE)
  const [x, y] = await Promise.all([post({ action: 'pause' }), post({ action: 'pause' })])
  assert.deepEqual([x.status, y.status].sort(), [200, 409])
  assert.deepEqual(x.body.session, y.body.session)
})

test('a write that loses to another (the ticker changed the phase in between) reads again and applies to the new state', async () => {
  await post({ action: 'start', preset: '25/5' })
  const real = store.put
  let first = true
  store.put = async (owner, rev, session, o) => {
    if (first) {
      first = false
      const cur = await store.get(owner)
      await real(owner, cur.rev, { ...cur.session, phase: 'break', round: 1, phaseMs: 5 * MINUTE, phaseEndsAt: Date.now() + 5 * MINUTE }) // (the ticker, just now)
    }
    return real(owner, rev, session, o)
  }
  const r = await post({ action: 'pause' })
  assert.equal(r.status, 200)
  assert.deepEqual([r.body.session.phase, r.body.session.pausedLeft], ['break', 5 * MINUTE])
})

test('the day\'s count and zone: the Habits doc\'s zone, the server\'s day', async () => {
  await store.put('owner', 0, null, { count: '2026-10-14' })
  await store.put('owner', 1, null, { count: '2026-10-14' })
  assert.deepEqual((await get()).body.today, { day: '2026-10-14', n: 2 })
  mock.timers.setTime(at(0, 30, 15)) // past midnight: a new day, nothing yet
  assert.deepEqual((await get()).body.today, { day: '2026-10-15', n: 0 })
  await globalThis.__homeHabitsStore.putDoc('owner', { tz: 'Europe/Berlin', habits: [] }) // 19:30 the day before there
  const b = (await get()).body
  assert.deepEqual([b.tz, b.today], ['Europe/Berlin', { day: '2026-10-14', n: 2 }])
})

test('the owner\'s other tabs hear "focus" (not the tab that did it); a 409 says nothing', async () => {
  const heard = []
  const off1 = liveBus().subscribe('owner', 'tab-aaaaaaaa', (e) => heard.push(['a', e.kind]))
  const off2 = liveBus().subscribe('owner', 'tab-bbbbbbbb', (e) => heard.push(['b', e.kind]))
  await post({ action: 'start', preset: '25/5' }, { ...OWNER, 'x-home-client': 'tab-aaaaaaaa' })
  await post({ action: 'pause' }, { ...OWNER, 'x-home-client': 'tab-bbbbbbbb' })
  await post({ action: 'pause' }) // 409
  off1()
  off2()
  assert.deepEqual(heard, [['b', 'focus'], ['a', 'focus']])
})

test('stop (or a fresh start) takes the old session\'s notice off the inbox; others stay', async () => {
  const id = (await post({ action: 'start', preset: '25/5' })).body.session.id
  await notes.add({ title: 'Focus done · 5 min break', tag: `focus:${id}`, ttl: 360 })
  await notes.add({ title: 'something else', tag: 'claude:x' })
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-cccccccc', (e) => heard.push(e.kind))
  await post({ action: 'pause' })
  assert.equal((await notes.list('owner')).items.length, 2) // (paused: still the same session)
  await post({ action: 'stop' })
  off()
  assert.deepEqual((await notes.list('owner')).items.map((n) => n.tag), ['claude:x'])
  assert.deepEqual(heard, ['focus', 'focus', 'notify'])
})

test('the database away: 503, never a crash', async () => {
  globalThis.__homeFocusStore = new Proxy({}, { get: () => async () => { throw new Error('down') } })
  assert.equal((await get()).status, 503)
  assert.equal((await post({ action: 'start', preset: '25/5' })).status, 503)
})
