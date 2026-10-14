// The owner's reminders route (app/api/private/settings/reminders): who gets in, add / done / undo / delete, that the
// server decides the day, the undo window and whether the pop-up is due, races between tabs, and the live stream. No
// database: the stores are memoryStore()s (globalThis.__home*Store); the clock is node:test's mock.timers.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DELETE, GET, POST } from '../app/api/private/settings/reminders/route.js'
import { memoryStore } from './reminders-store.js'
import { memoryStore as habitsMemory } from './habits-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { liveBus } from './live.js'
import { MAX_OPEN } from './reminders.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', NOTIFY_TOKEN: 'notify-token-for-tests-0123456789' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026 (Wednesday the 14th)
const at = (h, m, day = 14) => Date.UTC(2026, 9, day, h - 7, m)
const T0 = at(7, 0)
let notes
test.beforeEach(() => {
  env(true)
  globalThis.__homeRemindersStore = memoryStore()
  globalThis.__homeHabitsStore = habitsMemory()
  notes = globalThis.__homeNotifyStore = notifyMemory()
  mock.timers.enable({ apis: ['Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())
test.after(() => {
  env(false)
  delete globalThis.__homeRemindersStore
  delete globalThis.__homeHabitsStore
  delete globalThis.__homeNotifyStore
})

const call = async (fn, method, body, headers = OWNER) => {
  const init = { method, headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) } }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const r = await fn(new Request('http://home.test/api/private/settings/reminders', init))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}
const get = (headers) => call(GET, 'GET', undefined, headers)
const post = (body, headers) => call(POST, 'POST', body, headers)
const del = (body, headers) => call(DELETE, 'DELETE', body, headers)
const add = async (text) => {
  const r = await post({ action: 'add', text })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.items.find((i) => i.text === text).id
}

test('guests: nothing (404 / 403), so the page shows no card and no pop-up', async () => {
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await get({ ...OWNER, 'x-home-sync': 'x'.repeat(32) })).status, 404)
  assert.equal((await post({ action: 'add', text: 'x' }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await post({ action: 'add', text: 'x' }, {})).status, 404)
  assert.equal((await del({ id: 'a1b2c3d4e5f6' }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  delete process.env.DATABASE_URL
  assert.equal((await get()).status, 404)
})

test('GET: the server\'s day and clock, and whether the pop-up is due (06:00 in the owner\'s zone)', async () => {
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.deepEqual(r.body, { tz: 'Asia/Ho_Chi_Minh', today: '2026-10-14', now: 420, at: T0, due: true, from: 360, max: MAX_OPEN, items: [] })
  mock.timers.setTime(at(5, 59))
  assert.deepEqual([(await get()).body.due, (await get()).body.now], [false, 359])
  // the Habits doc's zone counts: 13:00 in Ho Chi Minh City is 08:00 in Berlin (CEST), 10:59 is 05:59 there
  mock.timers.setTime(at(13, 0))
  await globalThis.__homeHabitsStore.putDoc('owner', { tz: 'Europe/Berlin', habits: [] })
  const b = (await get()).body
  assert.deepEqual([b.tz, b.today, b.now, b.due], ['Europe/Berlin', '2026-10-14', 480, true])
  mock.timers.setTime(at(10, 59)) // 05:59 in Berlin
  assert.equal((await get()).body.due, false)
})

test('add: the server stamps the day; the text is cleaned; same-origin JSON only', async () => {
  const r = await post({ action: 'add', text: '  renew  the domain ', day: '2020-01-01', at: 1 })
  assert.equal(r.status, 200)
  assert.equal(r.body.items.length, 1)
  const [i] = r.body.items
  assert.match(i.id, /^[a-f0-9]{12}$/)
  assert.deepEqual([i.text, i.day, i.at], ['renew the domain', '2026-10-14', T0])
  assert.equal(i.doneAt, undefined) // (open ones don't carry it)
  assert.equal((await post({ action: 'add', text: '   ' })).body.field, 'text')
  assert.equal((await post({ action: 'add', text: 'x'.repeat(141) })).status, 400)
  assert.equal((await post('{nope')).status, 400)
  assert.equal((await post('x'.repeat(5000))).status, 413)
  const cross = await POST(new Request('http://home.test/x', { method: 'POST', headers: { ...OWNER, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ action: 'add', text: 'x' }) }))
  assert.equal(cross.status, 403)
  const form = await POST(new Request('http://home.test/x', { method: 'POST', headers: { ...OWNER, 'content-type': 'text/plain' }, body: JSON.stringify({ action: 'add', text: 'x' }) }))
  assert.equal(form.status, 403)
  assert.equal((await get()).body.items.length, 1)
})

test('carry-over: open ones stay, oldest first, day after day, until done', async () => {
  const a = await add('renew the domain')
  mock.timers.setTime(at(9, 0, 15))
  await add('call mum')
  mock.timers.setTime(at(5, 0, 18)) // days later, before 06:00: still there, the pop-up not due yet
  let r = await get()
  assert.deepEqual(r.body.items.map((i) => [i.text, i.day]), [['renew the domain', '2026-10-14'], ['call mum', '2026-10-15']])
  assert.equal(r.body.due, false)
  mock.timers.setTime(at(6, 0, 18))
  assert.equal((await get()).body.due, true)
  r = await post({ action: 'done', id: a })
  assert.deepEqual(r.body.items.map((i) => i.text), ['call mum'])
  mock.timers.setTime(at(6, 0, 19))
  assert.deepEqual((await get()).body.items.map((i) => i.text), ['call mum']) // done ones never come back
})

test('done: off the list; a second "done" (another tab) is 409 with the fresh state', async () => {
  const a = await add('renew the domain')
  await add('call mum')
  const r = await post({ action: 'done', id: a })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.items.map((i) => i.text), ['call mum'])
  const again = await post({ action: 'done', id: a })
  assert.equal(again.status, 409)
  assert.deepEqual(again.body.items.map((i) => i.text), ['call mum'])
  assert.equal((await post({ action: 'done', id: 'ffffffffffff' })).status, 409) // gone (deleted elsewhere)
})

test('two holds at once (two devices): exactly one marks it done, the other hears 409', async () => {
  const a = await add('renew the domain')
  const [x, y] = await Promise.all([post({ action: 'done', id: a }), post({ action: 'done', id: a })])
  assert.deepEqual([x.status, y.status].sort(), [200, 409])
  assert.deepEqual((await get()).body.items, [])
})

test('undo: within the window by the server\'s clock, back as it was; not after', async () => {
  const a = await add('renew the domain')
  mock.timers.setTime(T0 + 60_000)
  await post({ action: 'done', id: a })
  mock.timers.setTime(T0 + 60_000 + 8_000)
  const u = await post({ action: 'undo', id: a })
  assert.equal(u.status, 200)
  assert.deepEqual(u.body.items.map((i) => [i.id, i.text, i.day, i.at]), [[a, 'renew the domain', '2026-10-14', T0]])
  assert.equal((await post({ action: 'undo', id: a })).status, 409) // open: nothing to undo
  await post({ action: 'done', id: a })
  mock.timers.setTime(T0 + 60_000 + 8_000 + 16_000)
  const late = await post({ action: 'undo', id: a })
  assert.equal(late.status, 409)
  assert.deepEqual(late.body.items, [])
})

test('delete: a mistaken entry goes for good (not done); only open ones; same-origin JSON', async () => {
  const a = await add('typo entry')
  const b = await add('call mum')
  assert.equal((await del({ id: 'NOPE' })).status, 400)
  assert.equal((await del({})).status, 400)
  const cross = await DELETE(new Request('http://home.test/x', { method: 'DELETE', headers: { ...OWNER, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ id: a }) }))
  assert.equal(cross.status, 403)
  const r = await del({ id: a })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.items.map((i) => i.text), ['call mum'])
  assert.equal(await globalThis.__homeRemindersStore.get('owner', a), null) // gone, not in the done log
  assert.equal((await del({ id: a })).status, 409)
  await post({ action: 'done', id: b })
  assert.equal((await del({ id: b })).status, 409) // the done log isn't edited
  assert.equal((await globalThis.__homeRemindersStore.get('owner', b)).doneAt, T0)
})

test('at most 50 open: the 51st is 409; done ones make room', async () => {
  const ids = []
  for (let i = 0; i < MAX_OPEN; i++) ids.push(await add(`thing ${i}`))
  const full = await post({ action: 'add', text: 'one more' })
  assert.equal(full.status, 409)
  assert.equal(full.body.items.length, MAX_OPEN)
  await post({ action: 'done', id: ids[0] })
  assert.equal((await post({ action: 'add', text: 'one more' })).status, 200)
})

test('the owner\'s other tabs hear "reminders" (not the tab that did it)', async () => {
  const heard = []
  const off1 = liveBus().subscribe('owner', 'tab-aaaaaaaa', (e) => heard.push(['a', e.kind]))
  const off2 = liveBus().subscribe('owner', 'tab-bbbbbbbb', (e) => heard.push(['b', e.kind]))
  const r = await post({ action: 'add', text: 'call mum' }, { ...OWNER, 'x-home-client': 'tab-aaaaaaaa' })
  await del({ id: r.body.items[0].id }, { ...OWNER, 'x-home-client': 'tab-bbbbbbbb' })
  await post({ action: 'done', id: 'ffffffffffff' }) // a 409: nothing changed, nobody hears
  off1()
  off2()
  assert.deepEqual(heard, [['b', 'reminders'], ['a', 'reminders']])
})

test('the last one done (or deleted) takes this morning\'s notice off the inbox; not before', async () => {
  const a = await add('renew the domain')
  const b = await add('call mum')
  await notes.add({ title: '2 reminders today', tag: 'todo:2026-10-14', ttl: 3600 })
  await notes.add({ title: 'something else', tag: 'claude:x' })
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-cccccccc', (e) => heard.push(e.kind))
  await post({ action: 'done', id: a })
  assert.equal((await notes.list('owner')).items.length, 2) // one still open
  await del({ id: b })
  off()
  assert.deepEqual((await notes.list('owner')).items.map((n) => n.tag), ['claude:x'])
  assert.deepEqual(heard, ['reminders', 'reminders', 'notify'])
})

test('the database away: 503, never a crash', async () => {
  const broken = new Proxy({}, { get: () => async () => { throw new Error('down') } })
  globalThis.__homeRemindersStore = broken
  assert.equal((await get()).status, 503)
  assert.equal((await post({ action: 'add', text: 'x' })).status, 503)
  assert.equal((await del({ id: 'a1b2c3d4e5f6' })).status, 503)
})
