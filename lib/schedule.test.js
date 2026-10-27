// The schedule for other machines on the LAN (lib/schedule.js, app/api/private/schedule and its routines): one day's
// habits with ISO times in the habits' zone and whether each was kept, every routine with how it's gone, and who gets
// in (through the proxy's /api/private gate: the LAN with no login, nothing else). No database: the memory stores; the clock is mocked.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { GET as day } from '../app/api/private/schedule/route.js'
import { GET as routinesGet } from '../app/api/private/schedule/routines/route.js'
import { dayItems, dayParam, daysParam, offsetOf, repeatOf, routines } from './schedule.js'
import { memoryStore } from './habits-store.js'
import { memoryStore as remindersMemory } from './reminders-store.js'

const GATE = 'gate-secret-for-tests-0123456789'
const IN = { 'x-home-gate': GATE }
const env = (on) => {
  const vars = { GATE_SECRET: GATE, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// Tuesday 27 October 2026, 10:00 in Ho Chi Minh City
const T0 = Date.UTC(2026, 9, 27, 3, 0)
const at = (day, h, m) => Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`)

const workout = { id: 'workout01', name: 'Workout', icon: 'Dumbbell', when: { kind: 'time', at: '06:15' }, minutes: 45, days: [1, 2, 3, 4, 5, 6], identity: 'I show up at 6:15.', since: '2026-10-14' }
const piano = { id: 'piano0001', name: 'Piano', icon: 'Piano', when: { kind: 'window', from: '19:30', to: '22:00' }, minutes: 30, days: [1, 2, 3, 4, 5, 6, 7], since: '2026-10-14' }
const read = { id: 'read00001', name: 'Read', icon: 'BookOpen', when: { kind: 'any' }, minutes: 20, days: [1, 2, 3, 4, 5], since: '2026-10-20' }
const old = { id: 'old000001', name: 'Old', icon: 'Sprout', when: { kind: 'time', at: '05:00' }, minutes: 10, days: [1, 2, 3, 4, 5, 6, 7], since: '2026-10-01', archived: true }
const DOC = { tz: 'Asia/Ho_Chi_Minh', habits: [piano, workout, read, old] }
const kept = (habitId, day, late = false, rating = null) => ({ habitId, day, doneAt: at(day, 7, 0), late, rating, note: null, undoneAt: null, reason: null })

test('offsets, repeats and the query values', () => {
  assert.equal(offsetOf('Asia/Ho_Chi_Minh', '2026-10-27'), '+07:00')
  assert.equal(offsetOf('UTC', '2026-10-27'), '+00:00')
  assert.equal(offsetOf('America/New_York', '2026-07-01'), '-04:00')
  assert.equal(repeatOf([1, 2, 3, 4, 5, 6, 7]), 'daily')
  assert.equal(repeatOf([1, 2, 3, 4, 5]), 'weekdays')
  assert.equal(repeatOf([6, 7]), 'weekends')
  assert.equal(repeatOf([1, 3]), 'weekly')
  assert.deepEqual(dayParam('', '2026-10-27'), { day: '2026-10-27' })
  assert.deepEqual(dayParam('2026-11-02', '2026-10-27'), { day: '2026-11-02' })
  assert.ok(dayParam('2026-02-30', '2026-10-27').error)
  assert.ok(dayParam('2030-01-01', '2026-10-27').error)
  assert.deepEqual(daysParam(undefined), { n: 14 })
  assert.deepEqual(daysParam('30'), { n: 30 })
  assert.ok(daysParam('0').error && daysParam('61').error && daysParam('1.5').error)
})

test("a day: that day's habits by start, ISO times in the zone, kept or not", () => {
  const items = dayItems(DOC, [kept('workout01', '2026-10-27', false, 'great'), { ...kept('piano0001', '2026-10-27'), undoneAt: at('2026-10-27', 8, 0) }], '2026-10-27')
  assert.deepEqual(items.map((i) => i.title), ['Read', 'Workout', 'Piano']) // any time first; the archived one never
  const [r, w, p] = items
  assert.deepEqual([r.all_day, r.start, r.end, r.repeat, r.days], [true, '2026-10-27T00:00:00+07:00', null, 'weekdays', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']])
  assert.deepEqual([w.start, w.end, w.minutes, w.window, w.done, w.late, w.rating, w.identity], ['2026-10-27T06:15:00+07:00', '2026-10-27T07:00:00+07:00', 45, false, true, false, 'great', 'I show up at 6:15.'])
  assert.equal(w.done_at, '2026-10-27T00:00:00.000Z')
  assert.deepEqual([p.start, p.end, p.window, p.done, p.done_at], ['2026-10-27T19:30:00+07:00', '2026-10-27T22:00:00+07:00', true, false, null]) // taken back: not kept
  // Sunday: no workout (Mon–Sat), no read (weekdays); before a habit's first day: not there
  assert.deepEqual(dayItems(DOC, [], '2026-11-01').map((i) => i.title), ['Piano'])
  assert.deepEqual(dayItems(DOC, [], '2026-10-19').map((i) => i.title), ['Workout', 'Piano'])
})

test('routines: every habit, the last N days, the streak', () => {
  const today = '2026-10-27'
  const checkins = [kept('workout01', '2026-10-27', false, 'great'), kept('workout01', '2026-10-26', true, 'hard'), kept('workout01', '2026-10-24'), kept('piano0001', '2026-10-25')]
  const done = { workout01: new Set(['2026-10-27', '2026-10-26', '2026-10-24']), piano0001: new Set(['2026-10-25']) }
  const [p, w, r, o] = routines(DOC, checkins, done, today, 4) // 24–27 Oct (Sat–Tue)
  assert.deepEqual([w.title, w.repeat, w.when, w.streak, w.at_risk], ['Workout', 'weekly', { kind: 'time', at: '06:15' }, 3, false])
  assert.deepEqual(w.last, { days: 4, due: 3, kept: 3, on_time: 2, late: 1, missed: 0, ratings: { hard: 1, okay: 0, great: 1 } }) // Sunday off
  // today's still open: not due yet, not missed; one miss is forgiven (never miss twice), so the streak holds, at risk
  assert.deepEqual([p.last.due, p.last.kept, p.last.missed, p.streak, p.at_risk], [3, 1, 2, 1, true])
  assert.deepEqual([r.last.due, r.last.missed, r.when], [1, 1, { kind: 'any' }]) // Mon only (today open)
  assert.deepEqual([o.archived, o.streak], [true, 0])
})

test('the routes: only through the gate; the day and the routines', async () => {
  env(true)
  mock.timers.enable({ apis: ['Date'], now: T0 })
  try {
    const store = (globalThis.__homeHabitsStore = memoryStore())
    globalThis.__homeRemindersStore = remindersMemory()
    await store.putDoc('owner', DOC)
    await store.check('owner', { habitId: 'workout01', day: '2026-10-27', at: at('2026-10-27', 6, 20), late: false, rating: 'great' })
    await globalThis.__homeRemindersStore.add('owner', { id: 'aaaaaa1', text: 'buy milk', day: '2026-10-26', at: at('2026-10-26', 9, 0) }, 50)
    const call = async (fn, q = '', headers = IN) => {
      const r = await fn(new Request(`http://home.test/api/private/schedule${q}`, { headers }))
      return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
    }
    // no gate, or a wrong one (not through the proxy's /api/private): 404
    assert.equal((await call(day, '', {})).status, 404)
    assert.equal((await call(day, '', { 'x-home-gate': 'gate-secret-for-tests-0123456780' })).status, 404)
    assert.equal((await call(routinesGet, '', {})).status, 404)

    const d = await call(day)
    assert.equal(d.status, 200)
    assert.equal(d.cache, 'no-store, private')
    assert.deepEqual([d.body.date, d.body.today, d.body.tz, d.body.now], ['2026-10-27', '2026-10-27', 'Asia/Ho_Chi_Minh', '2026-10-27T10:00:00+07:00'])
    assert.deepEqual(d.body.items.map((i) => [i.title, i.done]), [['Read', false], ['Workout', true], ['Piano', false]])
    assert.deepEqual(d.body.todos, [{ title: 'buy milk', added: '2026-10-26' }])
    const sun = await call(day, '?date=2026-11-01')
    assert.deepEqual([sun.status, sun.body.date, sun.body.items.map((i) => i.title)], [200, '2026-11-01', ['Piano']])
    assert.equal((await call(day, '?date=tomorrow')).status, 400)

    const r = await call(routinesGet, '?days=7')
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.today, r.body.days, r.body.habits.length], ['2026-10-27', 7, 4])
    assert.deepEqual(r.body.habits.find((h) => h.id === 'workout01').streak, 1)
    assert.equal((await call(routinesGet, '?days=99')).status, 400)

    // off without a database
    delete process.env.DATABASE_URL
    assert.equal((await call(day)).status, 404)
  } finally {
    mock.timers.reset()
    env(false)
    delete globalThis.__homeHabitsStore
    delete globalThis.__homeRemindersStore
  }
})
