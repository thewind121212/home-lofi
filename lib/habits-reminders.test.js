// Habits' reminders (lib/habits-reminders.js + the rules in lib/habits.js): what goes when, once ever, never for a habit
// already kept, through the notification hub. No database: both stores are memoryStore()s; the clock is the `ms` passed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remindTick } from './habits-reminders.js'
import { memoryStore as habitsMemory } from './habits-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { liveBus } from './live.js'
import { remindAt, weekSummary } from './habits.js'
import { POST as act } from '../app/api/private/settings/habits/route.js'
import { CLAIM_LEASE } from './habits-store.js'

const env = (on) => {
  const vars = { NOTIFY_TOKEN: 'notify-token-for-tests-0123456789', OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', GATE_SECRET: 'gate-secret-for-tests-0123456789', SYNC_SECRET: 'sync-secret-for-tests-0123456789' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026 (the 14th is a Wednesday, the 18th a Sunday)
const at = (h, m, day = 14) => Date.UTC(2026, 9, day, h - 7, m)
const WORKOUT = { id: 'workout00001', name: 'Workout', icon: 'Dumbbell', when: { kind: 'time', at: '06:15' }, minutes: 45, days: [1, 2, 3, 4, 5, 6, 7], identity: 'I show up at 6:15.', remind: true, archived: false, since: '2026-10-01' }
const PIANO = { id: 'piano0000001', name: 'Piano practice', icon: 'Piano', when: { kind: 'window', from: '19:30', to: '22:00' }, minutes: 30, days: [1, 2, 3, 4, 5, 6, 7], identity: '', remind: true, archived: false, since: '2026-10-01' }
const READ = { id: 'read00000001', name: 'Read', icon: 'BookOpen', when: { kind: 'any' }, minutes: 20, days: [1, 2, 3, 4, 5, 6, 7], identity: '', remind: true, archived: false, since: '2026-10-01' }

let habits, notes
test.beforeEach(async () => {
  env(true)
  habits = globalThis.__homeHabitsStore = habitsMemory()
  notes = globalThis.__homeNotifyStore = notifyMemory()
  await habits.putDoc('owner', { tz: 'Asia/Ho_Chi_Minh', habits: [WORKOUT, PIANO, READ] })
})
test.after(() => {
  env(false)
  delete globalThis.__homeHabitsStore
  delete globalThis.__homeNotifyStore
})
const inbox = async () => (await notes.list('owner')).items

test('when: 5 min before a time, at a window\'s opening, never for any time or with the switch off', () => {
  assert.equal(remindAt(WORKOUT), 370) // 06:10
  assert.equal(remindAt(PIANO), 1170) // 19:30
  assert.equal(remindAt(READ), null)
  assert.equal(remindAt({ ...WORKOUT, remind: false }), null)
  assert.equal(remindAt({ ...WORKOUT, archived: true }), null)
  assert.equal(remindAt({ ...WORKOUT, when: { kind: 'time', at: '00:02' } }), 0)
})

test('06:10: "Workout in 5 min" goes once, with its identity line, icon, tag and a ttl to the end of its time', async () => {
  assert.deepEqual(await remindTick(at(6, 9)), [])
  assert.deepEqual(await remindTick(at(6, 10)), ['start:workout00001:2026-10-14'])
  const [n] = await inbox()
  assert.equal(n.title, 'Workout in 5 min')
  assert.equal(n.body, '“I show up at 6:15.”\n06:15 · 45 min. Hold to keep it on the Habits card.')
  assert.deepEqual([n.source, n.tag, n.icon, n.color], ['Habits', 'habit:workout00001', { fa: 'fa-solid fa-dumbbell' }, 'primary'])
  assert.ok(n.exp > n.at) // it goes once its time has passed
  // the same minute again, and later minutes: never twice
  assert.deepEqual(await remindTick(at(6, 10)), [])
  assert.deepEqual(await remindTick(at(6, 20)), [])
  assert.equal((await inbox()).length, 1)
})

test('a window: "your window is open" at its start', async () => {
  assert.deepEqual(await remindTick(at(19, 30)), ['start:piano0000001:2026-10-14'])
  assert.equal((await inbox())[0].title, 'Piano practice: your window is open')
  assert.equal((await inbox())[0].body, '19:30–22:00 · 30 min. Hold to keep it on the Habits card.')
})

test('kept already, not its day, or before it existed: no reminder', async () => {
  await habits.check('owner', { habitId: 'workout00001', day: '2026-10-14', at: at(5, 50), late: false })
  assert.deepEqual(await remindTick(at(6, 10)), [])
  await habits.putDoc('owner', { tz: 'Asia/Ho_Chi_Minh', habits: [{ ...WORKOUT, days: [1, 2] }, { ...PIANO, since: '2026-10-15' }] })
  assert.deepEqual(await remindTick(at(6, 10)), []) // a Wednesday: not one of its days
  assert.deepEqual(await remindTick(at(19, 30)), []) // starts tomorrow
})

test('a server restart that missed the minute still sends within 15 min (saying what is true), not after', async () => {
  assert.deepEqual(await remindTick(at(6, 24)), ['start:workout00001:2026-10-14'])
  assert.equal((await inbox())[0].title, 'Workout: time to start') // 06:15 has passed: not "in 5 min"
  assert.deepEqual(await remindTick(at(19, 45)), []) // piano's minute was 19:30: too late now
})

test('the next day is a new reminder', async () => {
  await remindTick(at(6, 10))
  assert.deepEqual(await remindTick(at(6, 10, 15)), ['start:workout00001:2026-10-15'])
})

test('the hub off (no token / database / owner): nothing sent, nothing claimed', async () => {
  delete process.env.NOTIFY_TOKEN
  assert.deepEqual(await remindTick(at(6, 10)), [])
  env(true)
  assert.deepEqual(await remindTick(at(6, 10)), ['start:workout00001:2026-10-14'])
})

test('a send that fails gives the key back: the next tick sends it', async () => {
  const real = notes.add
  notes.add = async () => {
    throw new Error('database away')
  }
  assert.deepEqual(await remindTick(at(6, 10)), [])
  notes.add = real
  assert.deepEqual(await remindTick(at(6, 11)), ['start:workout00001:2026-10-14'])
})

test('the owner\'s open pages hear "notify" when one goes', async () => {
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-reminder01', (e) => heard.push(e.kind))
  await remindTick(at(6, 10))
  await remindTick(at(6, 11))
  off()
  assert.deepEqual(heard, ['notify'])
})

test('Sunday 20:00: the weekly review, once', async () => {
  // Mon 12 – Sun 18: workout 6 of 7 (one late), piano 5 of 7, read twice
  const put = (id, day, extra = {}) => habits.check('owner', { habitId: id, day, at: at(7, 0, Number(day.slice(8))), late: false, ...extra })
  for (const d of [12, 13, 14, 15, 16, 17]) await put('workout00001', `2026-10-${d}`, { late: d === 16, rating: d === 12 ? 'okay' : 'great' })
  for (const d of [12, 13, 15, 16, 18]) await put('piano0000001', `2026-10-${d}`, { rating: 'great' })
  for (const d of [14, 18]) await put('read00000001', `2026-10-${d}`)
  // a habit taken back doesn't count
  await habits.untick('owner', { habitId: 'read00000001', day: '2026-10-18', at: at(21, 0, 18), reason: 'not-done' })
  // the morning reminders of that Sunday aside, the review goes at 20:00
  const sent = await remindTick(at(20, 0, 18))
  assert.deepEqual(sent, ['week:2026-10-18'])
  const review = (await inbox()).find((n) => n.tag === 'habits:week')
  // Sunday is still open at 20:00: it counts only where it's kept already (piano), not as a miss
  assert.equal(review.title, 'Your week: 12 of 19 kept')
  assert.equal(review.body, ['Workout 6/6 · 5 on time · mostly great', 'Piano practice 5/7 · 5 on time · mostly great', 'Read 1/6 · 1 on time', 'One miss is fine; never miss twice.'].join('\n'))
  assert.deepEqual(await remindTick(at(20, 30, 18)), [])
  assert.deepEqual(await remindTick(at(20, 0, 17)), []) // Saturday: no review
})

test('weekSummary: due days start at a habit\'s first day; archived habits are left out', () => {
  const doc = { habits: [{ ...WORKOUT, since: '2026-10-16' }, { ...READ, archived: true }] }
  const w = weekSummary(doc, [], '2026-10-18')
  assert.deepEqual(w, { kept: 0, due: 2, lines: ['Workout 0/2 · 0 on time'] })
  // done on a day that isn't one of its days: not "on time" against what was due
  const off = weekSummary({ habits: [{ ...WORKOUT, days: [1, 2] }] }, [{ habitId: WORKOUT.id, day: '2026-10-14', late: false, undoneAt: null }], '2026-10-18')
  assert.deepEqual(off.lines, ['Workout 0/2 · 0 on time'])
})

test('a claim never marked sent (a crash between claim and send) lapses: a later tick sends it; once sent, never again', async () => {
  const t0 = 1_000_000
  assert.equal(await habits.claimReminder('owner', 'k1', t0), true)
  assert.equal(await habits.claimReminder('owner', 'k1', t0 + 60_000), false) // still someone's
  assert.equal(await habits.claimReminder('owner', 'k1', t0 + CLAIM_LEASE + 1), true) // lapsed: taken again
  await habits.sentReminder('owner', 'k1')
  assert.equal(await habits.claimReminder('owner', 'k1', t0 + 10 * CLAIM_LEASE), false)
})

test('keeping the habit takes its reminder off the inbox (and tells the open pages)', async () => {
  await remindTick(at(6, 10))
  assert.equal((await inbox()).length, 1)
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-reminder02', (e) => heard.push(e.kind))
  const headers = { 'x-home-gate': process.env.GATE_SECRET, 'x-home-sync': process.env.SYNC_SECRET, 'remote-user': 'owner', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
  const realNow = Date.now
  Date.now = () => at(6, 12)
  try {
    const r = await act(new Request('http://home.test/api/private/settings/habits', { method: 'POST', headers, body: JSON.stringify({ action: 'check', habitId: 'workout00001', day: '2026-10-14' }) }))
    assert.equal(r.status, 200)
  } finally {
    Date.now = realNow
  }
  off()
  assert.equal((await inbox()).length, 0)
  assert.deepEqual(heard, ['notify', 'habits'])
})
