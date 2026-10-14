// Habits' rules (lib/habits.js): days in the habits' zone, a routine's span, on time / late, what can be checked,
// never-miss-twice streaks, and what the editor and the card may send.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACK_DAYS, GRACE_MIN, MAX_HABITS, UNDO_MS, UNDO_SLACK, addDays, canUndo, checkable, cleanAction, cleanDoc, daysBetween, dowOf, dueOn, fmtMin,
  isDay, isLate, localNow, spanOf, streakOf, toMin, validTz,
} from './habits.js'

const HCM = 'Asia/Ho_Chi_Minh'
const workout = { id: 'workout01', name: 'Workout', when: { kind: 'time', at: '06:15' }, minutes: 45, days: [1, 2, 3, 4, 5, 6], since: '2026-09-01' }
const piano = { id: 'piano0001', name: 'Piano', when: { kind: 'window', from: '19:30', to: '22:00' }, minutes: 30, days: [1, 2, 3, 4, 5, 6, 7], since: '2026-09-01' }
const read = { id: 'read00001', name: 'Read', when: { kind: 'any' }, minutes: 20, days: [1, 2, 3, 4, 5, 6, 7], since: '2026-09-01' }
let n = 0
const mkId = () => `new${String(++n).padStart(6, '0')}`

test('times and days', () => {
  assert.equal(toMin('06:15'), 375)
  assert.equal(toMin('24:00'), null)
  assert.equal(toMin('6:15'), null)
  assert.equal(fmtMin(375), '06:15')
  assert.equal(isDay('2026-10-14'), true)
  assert.equal(isDay('2026-02-30'), false)
  assert.equal(dowOf('2026-10-14'), 3) // a Wednesday
  assert.equal(dowOf('2026-10-18'), 7) // Sunday is 7, not 0
  assert.equal(addDays('2026-10-01', -1), '2026-09-30')
  assert.equal(daysBetween('2026-10-12', '2026-10-14'), 2)
  assert.equal(validTz(HCM), true)
  assert.equal(validTz('Mars/Olympus'), false)
})

test('localNow: the habits zone, not the server clock', () => {
  // 23:20 UTC on the 13th is 06:20 on Wednesday the 14th in Ho Chi Minh City
  assert.deepEqual(localNow(Date.UTC(2026, 9, 13, 23, 20), HCM), { day: '2026-10-14', min: 380, dow: 3 })
  assert.deepEqual(localNow(Date.UTC(2026, 9, 13, 23, 20), 'UTC'), { day: '2026-10-13', min: 1400, dow: 2 })
})

test('a routine: its span and its days', () => {
  assert.deepEqual(spanOf(workout), [375, 420])
  assert.deepEqual(spanOf({ ...workout, minutes: null }), [375, 405]) // no length: half an hour
  assert.deepEqual(spanOf(piano), [1170, 1320])
  assert.deepEqual(spanOf(read), [0, 1440])
  assert.equal(dueOn(workout, '2026-10-18'), false) // Sunday off
  assert.equal(dueOn(workout, '2026-10-17'), true)
  assert.equal(dueOn({ ...workout, archived: true }, '2026-10-17'), false)
})

test('on time or late: early counts, the grace after the end counts, an earlier day is late', () => {
  const at = (min) => ({ day: '2026-10-14', min })
  assert.equal(isLate(workout, '2026-10-14', at(350)), false) // 05:50, before 06:15: early is fine
  assert.equal(isLate(workout, '2026-10-14', at(420 + GRACE_MIN)), false) // 08:00 sharp
  assert.equal(isLate(workout, '2026-10-14', at(420 + GRACE_MIN + 1)), true)
  assert.equal(isLate(piano, '2026-10-14', at(1320 + GRACE_MIN)), false)
  assert.equal(isLate(read, '2026-10-14', at(1439)), false) // any time: never late today
  assert.equal(isLate(read, '2026-10-13', at(10)), true) // yesterday's, ticked today
})

test('checkable: today and up to BACK_DAYS back, from the habit\'s first day, never archived', () => {
  const now = { day: '2026-10-14', min: 600 }
  assert.equal(checkable(workout, '2026-10-14', now), true)
  assert.equal(checkable(workout, addDays('2026-10-14', -BACK_DAYS), now), true)
  assert.equal(checkable(workout, addDays('2026-10-14', -BACK_DAYS - 1), now), false)
  assert.equal(checkable(workout, '2026-10-15', now), false)
  assert.equal(checkable({ ...workout, since: '2026-10-14' }, '2026-10-13', now), false)
  assert.equal(checkable({ ...workout, archived: true }, '2026-10-14', now), false)
  assert.equal(checkable(workout, '2026-13-01', now), false)
})

test('undo: only right after, by the server clock', () => {
  assert.equal(canUndo(1000, 1000 + UNDO_MS), true)
  assert.equal(canUndo(1000, 1000 + UNDO_MS + UNDO_SLACK), true)
  assert.equal(canUndo(1000, 1000 + UNDO_MS + UNDO_SLACK + 1), false)
  assert.equal(canUndo(5000, 1000), false) // a check-in from the future: no
})

test('streak: never miss twice', () => {
  const daily = { ...read, since: '2026-09-01' }
  const done = (...days) => new Set(days)
  // today not done yet is open, not a miss
  assert.deepEqual(streakOf(daily, done('2026-10-13', '2026-10-12', '2026-10-11'), '2026-10-14'), { count: 3, atRisk: false })
  // one miss (the 12th) is forgiven, and the next one would end it
  assert.deepEqual(streakOf(daily, done('2026-10-13', '2026-10-11', '2026-10-10'), '2026-10-14'), { count: 3, atRisk: false })
  assert.deepEqual(streakOf(daily, done('2026-10-12', '2026-10-11'), '2026-10-14'), { count: 2, atRisk: true })
  // two in a row end it
  assert.deepEqual(streakOf(daily, done('2026-10-11', '2026-10-10'), '2026-10-14'), { count: 0, atRisk: false })
  // days off are not misses: Mon–Sat, the Sunday between doesn't count against it
  assert.deepEqual(streakOf(workout, done('2026-10-13', '2026-10-12', '2026-10-10'), '2026-10-14'), { count: 3, atRisk: false })
  // a day off done counts too; nothing before the first day
  assert.deepEqual(streakOf(workout, done('2026-10-11', '2026-10-10'), '2026-10-12'), { count: 2, atRisk: false })
  assert.deepEqual(streakOf({ ...daily, since: '2026-10-13' }, done('2026-10-13', '2026-10-12'), '2026-10-14'), { count: 1, atRisk: false })
})

test('cleanDoc: new habits get an id and a first day, known ones keep theirs', () => {
  const r = cleanDoc({ tz: HCM, habits: [{ name: '  Workout  ', when: { kind: 'time', at: '06:15' }, minutes: 45, days: [6, 1, 1, 2] }] }, { today: '2026-10-14', mkId })
  assert.equal(r.error, undefined)
  const h = r.doc.habits[0]
  assert.match(h.id, /^new\d{6}$/)
  assert.deepEqual({ name: h.name, days: h.days, since: h.since, icon: h.icon, remind: h.remind, archived: h.archived }, { name: 'Workout', days: [1, 2, 6], since: '2026-10-14', icon: 'Sprout', remind: true, archived: false })
  const again = cleanDoc({ habits: [{ ...h, name: 'Gym' }] }, { old: r.doc, today: '2026-11-01', mkId })
  assert.equal(again.doc.habits[0].since, '2026-10-14')
  assert.equal(again.doc.tz, HCM)
})

test('cleanDoc: what it refuses', () => {
  const old = { tz: HCM, habits: [workout] }
  const bad = (raw, field) => assert.equal(cleanDoc(raw, { old, today: '2026-10-14', mkId }).field, field)
  bad({ habits: [] }, 'habits') // leaving one out: archive it instead
  bad({ habits: [workout, { ...piano }] }, 'habits[1].id') // an id it never handed out
  bad({ habits: [workout, workout] }, 'habits[1].id')
  bad({ habits: [{ ...workout, name: '  ' }] }, 'habits[0].name')
  bad({ habits: [{ ...workout, when: { kind: 'window', from: '22:00', to: '19:30' } }] }, 'habits[0].when.to')
  bad({ habits: [{ ...workout, when: { kind: 'time', at: '25:00' } }] }, 'habits[0].when.at')
  bad({ habits: [{ ...workout, when: { kind: 'sometimes' } }] }, 'habits[0].when.kind')
  bad({ habits: [{ ...workout, days: [] }] }, 'habits[0].days')
  bad({ habits: [{ ...workout, days: [0] }] }, 'habits[0].days')
  bad({ habits: [{ ...workout, minutes: 0 }] }, 'habits[0].minutes')
  bad({ tz: 'Nowhere/Land', habits: [workout] }, 'tz')
  bad({ habits: Array.from({ length: MAX_HABITS + 1 }, () => ({ ...workout, id: undefined })) }, 'habits')
  assert.deepEqual(cleanDoc({ habits: [{ ...workout, archived: true }] }, { old, today: '2026-10-14', mkId }).doc.habits[0].archived, true)
})

test('cleanAction: the card says what was done, never when', () => {
  assert.deepEqual(cleanAction({ action: 'check', habitId: 'workout01', day: '2026-10-14', at: 1, late: false }).act, { action: 'check', habitId: 'workout01', day: '2026-10-14' })
  assert.deepEqual(cleanAction({ action: 'rate', habitId: 'workout01', day: '2026-10-14', rating: 'great', note: ' legs\r\nday ' }).act, { action: 'rate', habitId: 'workout01', day: '2026-10-14', rating: 'great', note: 'legs\nday' })
  assert.equal(cleanAction({ action: 'rate', habitId: 'workout01', day: '2026-10-14' }).field, 'rating')
  assert.equal(cleanAction({ action: 'check', habitId: 'workout01', day: '2026-10-14', rating: 'meh' }).field, 'rating')
  assert.equal(cleanAction({ action: 'untick', habitId: 'workout01', day: '2026-10-14' }).field, 'reason')
  assert.equal(cleanAction({ action: 'delete', habitId: 'workout01', day: '2026-10-14' }).field, 'action')
  assert.equal(cleanAction({ action: 'check', habitId: '../x', day: '2026-10-14' }).field, 'habitId')
  assert.equal(cleanAction({ action: 'check', habitId: 'workout01', day: 'today' }).field, 'day')
})
