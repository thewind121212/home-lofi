// The owner's habits route (app/api/private/settings/habits): who gets in, the editor's PUT, and that every check-in
// is judged by the server's clock (on time / late, which days, the undo window), whatever the page sends. No database:
// the store is lib/habits-store.js memoryStore() (globalThis.__homeHabitsStore); the clock is node:test's mock.timers.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { GET, POST, PUT } from '../app/api/private/settings/habits/route.js'
import { memoryStore } from './habits-store.js'
import { liveBus } from './live.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// Wednesday 14 October 2026, 06:20 in Ho Chi Minh City (23:20 UTC the day before)
const T0 = Date.UTC(2026, 9, 13, 23, 20)
const at = (h, m, day = 14) => Date.UTC(2026, 9, day, h - 7, m) // a local time that day, as a moment
test.beforeEach(() => {
  env(true)
  globalThis.__homeHabitsStore = memoryStore()
  mock.timers.enable({ apis: ['Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())
test.after(() => {
  env(false)
  delete globalThis.__homeHabitsStore
})

const call = async (fn, method, body, headers = OWNER) => {
  const init = { method, headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) } }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const r = await fn(new Request('http://home.test/api/private/settings/habits', init))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}
const get = (headers) => call(GET, 'GET', undefined, headers)
const put = (body, headers) => call(PUT, 'PUT', body, headers)
const post = (body, headers) => call(POST, 'POST', body, headers)

const WORKOUT = { name: 'Workout', icon: 'Dumbbell', when: { kind: 'time', at: '06:15' }, minutes: 45, days: [1, 2, 3, 4, 5, 6], identity: 'I show up at 6:15.' }
const READ = { name: 'Read', when: { kind: 'any' }, minutes: 20, days: [1, 2, 3, 4, 5, 6, 7] }
async function setUp() {
  const r = await put({ tz: 'Asia/Ho_Chi_Minh', habits: [WORKOUT, READ] })
  assert.equal(r.status, 200)
  return Object.fromEntries(r.body.habits.map((h) => [h.name, h.id]))
}

test('guests: nothing (404 / 403), so the page shows no card', async () => {
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await get({ ...OWNER, 'x-home-sync': 'x'.repeat(32) })).status, 404)
  assert.equal((await post({ action: 'check', habitId: 'aaaaaa', day: '2026-10-14' }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  delete process.env.DATABASE_URL
  assert.equal((await get()).status, 404)
})

test('GET: an owner with no habits yet gets an empty list and the server\'s today', async () => {
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.deepEqual(r.body, { tz: 'Asia/Ho_Chi_Minh', today: '2026-10-14', now: 380, at: T0, habits: [], checkins: [], streaks: {} })
})

test('PUT: the editor\'s list, checked; writes only same-origin JSON', async () => {
  const ids = await setUp()
  const r = await get()
  assert.equal(r.body.habits.length, 2)
  assert.equal(r.body.habits[0].since, '2026-10-14')
  assert.equal((await put({ habits: [{ ...WORKOUT, id: ids.Workout }] })).body.field, 'habits') // Read left out
  assert.equal((await put({ habits: [{ ...WORKOUT, days: [] }] })).status, 400)
  assert.equal((await put('{nope')).status, 400)
  const tz = await put({ tz: 'Nowhere/Land', habits: [] }) // a bad zone is the editor's mistake, not the database's
  assert.deepEqual([tz.status, tz.body.field], [400, 'tz'])
  assert.deepEqual([(await put({ tz: 5, habits: [] })).status], [400])
  assert.equal((await put('x'.repeat(40_000))).status, 413)
  const cross = await PUT(new Request('http://home.test/x', { method: 'PUT', headers: { ...OWNER, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' }))
  assert.equal(cross.status, 403)
})

test('check: the server stamps the time and decides on time / late; what the page says about time is ignored', async () => {
  const ids = await setUp()
  const r = await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14', at: 0, late: true, doneAt: 1 })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.checkins, [{ habitId: ids.Workout, day: '2026-10-14', doneAt: T0, late: false, rating: null, note: null, undoneAt: null, reason: null }])
  // the next day at 08:01: past 07:00 + the hour's grace
  mock.timers.setTime(at(8, 1, 15))
  const late = await post({ action: 'check', habitId: ids.Workout, day: '2026-10-15', late: false })
  assert.equal(late.body.checkins.find((c) => c.day === '2026-10-15').late, true)
  const any = await post({ action: 'check', habitId: ids.Read, day: '2026-10-15' })
  assert.equal(any.body.checkins.find((c) => c.habitId === ids.Read).late, false) // any time: never late today
})

test('check: today and up to 2 days back, by the server\'s calendar; never the future, never before it existed', async () => {
  const ids = await setUp()
  mock.timers.setTime(at(9, 0, 16)) // Friday the 16th
  const back = await post({ action: 'check', habitId: ids.Read, day: '2026-10-14' })
  assert.equal(back.status, 200)
  assert.equal(back.body.checkins[0].late, true)
  assert.equal((await post({ action: 'check', habitId: ids.Read, day: '2026-10-13' })).status, 409) // before its first day
  assert.equal((await post({ action: 'check', habitId: ids.Read, day: '2026-10-17' })).status, 409) // tomorrow
  mock.timers.setTime(at(9, 0, 18))
  const old = await post({ action: 'check', habitId: ids.Read, day: '2026-10-15' })
  assert.equal(old.status, 409)
  assert.equal(old.body.today, '2026-10-18') // a 409 brings the fresh state too
  assert.equal((await post({ action: 'check', habitId: 'ffffffffffff', day: '2026-10-18' })).body.field, 'habitId')
})

test('undo within the window (server clock), then only untick with a reason, kept on record', async () => {
  const ids = await setUp()
  await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14' })
  mock.timers.setTime(T0 + 8_000)
  const u = await post({ action: 'undo', habitId: ids.Workout, day: '2026-10-14' })
  assert.equal(u.status, 200)
  assert.deepEqual(u.body.checkins, [])
  await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14' })
  mock.timers.setTime(T0 + 8_000 + 60_000)
  assert.equal((await post({ action: 'undo', habitId: ids.Workout, day: '2026-10-14' })).status, 409)
  assert.equal((await post({ action: 'untick', habitId: ids.Workout, day: '2026-10-14' })).status, 400) // no reason
  const t = await post({ action: 'untick', habitId: ids.Workout, day: '2026-10-14', reason: 'not-done' })
  assert.equal(t.status, 200)
  assert.deepEqual([t.body.checkins[0].undoneAt, t.body.checkins[0].reason], [T0 + 68_000, 'not-done'])
  assert.equal((await post({ action: 'rate', habitId: ids.Workout, day: '2026-10-14', rating: 'great' })).status, 409) // taken back: nothing to rate
  // kept again: done again, the old reason gone
  const again = await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14', rating: 'okay' })
  assert.deepEqual([again.body.checkins[0].undoneAt, again.body.checkins[0].rating], [null, 'okay'])
})

test('rate and note after keeping it', async () => {
  const ids = await setUp()
  await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14' })
  const r = await post({ action: 'rate', habitId: ids.Workout, day: '2026-10-14', rating: 'great', note: 'legs, 3x10 squats' })
  assert.deepEqual([r.body.checkins[0].rating, r.body.checkins[0].note], ['great', 'legs, 3x10 squats'])
  assert.equal((await post({ action: 'rate', habitId: ids.Read, day: '2026-10-14', rating: 'okay' })).status, 409)
})

test('the owner\'s other tabs hear "habits" (not the tab that did it)', async () => {
  const ids = await setUp()
  const heard = []
  const off1 = liveBus().subscribe('owner', 'tab-aaaaaaaa', (e) => heard.push(['a', e.kind]))
  const off2 = liveBus().subscribe('owner', 'tab-bbbbbbbb', (e) => heard.push(['b', e.kind]))
  await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14' }, { ...OWNER, 'x-home-client': 'tab-aaaaaaaa' })
  off1()
  off2()
  assert.deepEqual(heard, [['b', 'habits']])
})

test('check: a day already kept stays as it was (another tab, a stale one): 409, the first time and rating stand', async () => {
  const ids = await setUp()
  await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14', rating: 'great' })
  mock.timers.setTime(at(9, 0))
  const again = await post({ action: 'check', habitId: ids.Workout, day: '2026-10-14' })
  assert.equal(again.status, 409)
  assert.deepEqual([again.body.checkins[0].doneAt, again.body.checkins[0].late, again.body.checkins[0].rating], [T0, false, 'great'])
  assert.equal((await post({ action: 'undo', habitId: ids.Workout, day: '2026-10-14' })).status, 409) // and no new undo window
})

test('streaks come from the server, over more than the 120 days of check-ins the card gets', async () => {
  const ids = await setUp()
  const store = globalThis.__homeHabitsStore
  // Read every day for 200 days (its first day moved back so they count)
  const doc = await store.getDoc('owner')
  doc.habits.find((h) => h.id === ids.Read).since = '2026-01-01'
  await store.putDoc('owner', doc)
  for (let i = 1; i <= 200; i++) {
    const d = new Date(Date.UTC(2026, 9, 14) - i * 86400_000).toISOString().slice(0, 10)
    await store.check('owner', { habitId: ids.Read, day: d, at: T0, late: false })
  }
  const r = await get()
  assert.deepEqual(r.body.streaks[ids.Read], { count: 200, atRisk: false })
  assert.equal(r.body.checkins.length, 120) // what the card itself gets stays small
  assert.deepEqual(r.body.streaks[ids.Workout], { count: 0, atRisk: false })
})
