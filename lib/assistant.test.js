// The owner's assistant on the LAN (app/api/private/assistant/*: Jade on the Razer): who gets in (the proxy's
// /api/private gate, no token; never a browser on another site), adding a reminder (with a time: the reminders API;
// without: the carry-over list as typed), adding a habit (the editor's checks, add only), and the music signal down the
// owner's live stream. No database, no network: the memory stores, a stand-in reminders API, the live bus itself.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { POST as remind } from '../app/api/private/assistant/remind/route.js'
import { POST as habit } from '../app/api/private/assistant/habit/route.js'
import { POST as music } from '../app/api/private/assistant/music/route.js'
import { daysOf, habitOf, plainField } from './assistant.js'
import { MAX_HABITS } from './habits.js'
import { memoryStore as habitsMemory } from './habits-store.js'
import { memoryStore as remindersMemory } from './reminders-store.js'
import { liveBus } from './live.js'

const GATE = 'gate-secret-for-tests-0123456789'
const IN = { 'x-home-gate': GATE, 'content-type': 'application/json' }
const VARS = { GATE_SECRET: GATE, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
let heard, unsub
beforeEach(() => {
  Object.assign(process.env, VARS)
  delete process.env.REMIND_URL
  delete globalThis.__homeTimedFetch
  globalThis.__homeHabitsStore = habitsMemory()
  globalThis.__homeRemindersStore = remindersMemory()
  unsub?.()
  heard = []
  unsub = null
})
after(() => {
  for (const k of Object.keys(VARS)) delete process.env[k]
  for (const k of ['__homeHabitsStore', '__homeRemindersStore', '__homeTimedFetch']) delete globalThis[k]
  unsub?.()
})
// an open page of the owner's, listening on the live stream
const openPage = () => (unsub = liveBus().subscribe('owner', 'tab0000001', (e) => heard.push(e)))
const call = async (fn, body, headers = IN) => {
  const r = await fn(new Request('http://home.test/api/private/assistant/x', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}

test('days and habits as the assistant may say them', () => {
  assert.deepEqual(daysOf('daily'), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(daysOf('Weekdays'), [1, 2, 3, 4, 5])
  assert.deepEqual(daysOf(['Mon', 'wednesday', 'Sun']), [1, 3, 7])
  assert.deepEqual(daysOf([1, 3]), [1, 3])
  assert.equal(daysOf('sometimes'), 'sometimes') // (cleanHabit says what's wrong)
  assert.deepEqual(habitOf({ id: 'mine0001', name: 'Walk', days: 'weekends', archived: true, since: '2020-01-01' }), { name: 'Walk', icon: undefined, when: undefined, minutes: undefined, days: [6, 7], identity: undefined, remind: undefined })
  assert.equal(plainField('habits[3].when.at: HH:MM'), 'when.at: HH:MM')
})

test('who gets in: the gate, JSON, never a browser on another site', async () => {
  for (const fn of [remind, habit, music]) {
    assert.equal((await call(fn, {}, { 'content-type': 'application/json' })).status, 404) // not through /api/private
    assert.equal((await call(fn, {}, { ...IN, 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await call(fn, {}, { 'x-home-gate': GATE, 'content-type': 'text/plain' })).status, 403) // (a form)
    assert.equal((await call(fn, 'nope')).status, 400)
  }
  delete process.env.DATABASE_URL
  assert.equal((await call(music, { action: 'play' })).status, 404)
})

test('a reminder: without a time on the list as typed; with one in the reminders API', async () => {
  openPage()
  const a = await call(remind, { text: 'buy milk' }) // no REMIND_URL: the list
  assert.deepEqual([a.status, a.body.added], [201, { kind: 'todo', title: 'buy milk' }])
  assert.deepEqual((await globalThis.__homeRemindersStore.open('owner')).map((i) => i.text), ['buy milk'])
  assert.equal(heard.at(-1).kind, 'reminders') // the open page pulls
  assert.equal((await call(remind, { text: '  ' })).status, 400)

  process.env.REMIND_URL = 'http://reminders.test'
  const sent = []
  globalThis.__homeTimedFetch = async (url, init) => {
    sent.push([new URL(url).pathname, init.method])
    const body = new URL(url).pathname === '/api/parse'
      ? { title: 'Gọi mẹ', due_at: '2026-10-27T19:00:00+07:00', all_day: false, repeat: 'none' }
      : { id: 7, title: 'Gọi mẹ', due_at: '2026-10-27T19:00:00+07:00', all_day: false, repeat: 'none', status: 'open', created_at: '2026-10-27T10:00:00+07:00' }
    return Response.json(body)
  }
  const t = await call(remind, { text: '7pm call mom' })
  assert.deepEqual([t.status, t.body.added.kind, t.body.added.due], [201, 'timed', Date.parse('2026-10-27T19:00:00+07:00')])
  assert.deepEqual(sent, [['/api/parse', 'POST'], ['/api/reminders', 'POST']])
  // the model down: 503 plain, and plain goes straight onto the list
  globalThis.__homeTimedFetch = async () => { throw new Error('down') }
  const d = await call(remind, { text: 'water plants' })
  assert.deepEqual([d.status, d.body.plain], [503, true])
  assert.deepEqual((await call(remind, { text: 'water plants', plain: true })).body.added, { kind: 'todo', title: 'water plants' })
})

test('a habit: checked like the editor, added at the end, add only', async () => {
  openPage()
  const h = await call(habit, { name: 'Evening walk', when: { kind: 'time', at: '18:30' }, minutes: 20, days: ['Mon', 'Wed', 'Fri'], identity: 'I walk after work.', icon: 'Footprints', id: 'sneaky01' })
  assert.equal(h.status, 201)
  assert.match(h.body.habit.id, /^[a-f0-9]{12}$/) // a new id, never the one sent
  assert.deepEqual([h.body.habit.name, h.body.habit.days, h.body.habit.when, h.body.habit.remind, h.body.habit.archived], ['Evening walk', [1, 3, 5], { kind: 'time', at: '18:30' }, true, false])
  assert.equal(heard.at(-1).kind, 'habits')
  const w = await call(habit, { name: 'Read', when: { kind: 'window', from: '21:00', to: '20:00' }, days: 'daily' })
  assert.deepEqual([w.status, w.body.field], [400, 'when.to'])
  assert.equal((await call(habit, { name: 'Read', when: { kind: 'any' }, days: [] })).body.field, 'days')
  const doc = await globalThis.__homeHabitsStore.getDoc('owner')
  assert.deepEqual(doc.habits.map((x) => x.name), ['Evening walk'])
  for (let i = 1; i < MAX_HABITS; i++) assert.equal((await call(habit, { name: `H${i}`, when: { kind: 'any' }, days: 'daily' })).status, 201)
  assert.equal((await call(habit, { name: 'One more', when: { kind: 'any' }, days: 'daily' })).status, 409)
})

test("music: down the owner's live stream to the open pages; none open: 409", async () => {
  const none = await call(music, { action: 'play' })
  assert.deepEqual([none.status, none.body.sent], [409, 0])
  openPage()
  const p = await call(music, { action: 'play' })
  assert.deepEqual([p.status, p.body.sent], [200, 1])
  assert.deepEqual([heard.at(-1).kind, heard.at(-1).action], ['remote', 'play'])
  for (const action of ['pause', 'toggle', 'next']) assert.equal((await call(music, { action })).status, 200)
  assert.deepEqual([(await call(music, { action: 'louder' })).status], [400])
})
