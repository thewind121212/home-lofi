// Focus sessions' rules (lib/focus.js): what a POST may ask, each action's move, the server's phase change (on time,
// late, the 12-hour stop), the countdown every device draws (mm:ss, the ring, the label, when it turns over), the keys
// and the notice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanNotice } from './notify.js'
import {
  LATE_MS, MAX_SESSION_MS, MINUTE, PRESET_IDS, act, addSkew, advance, cleanAction, cleanSession, countText, dayOf, ended, fmtLeft, iconLabel, leftOf, minuteMs,
  nextPhase, nextTickIn, noticeTag, paused, phaseLen, phaseLine, phaseNotice, ringOf, running, skewOf, startSession, transitionKey,
} from './focus.js'

// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026 (Wednesday the 14th)
const at = (h, m, day = 14, s = 0) => Date.UTC(2026, 9, day, h - 7, m, s)
const T0 = at(10, 0)
const TZ = 'Asia/Ho_Chi_Minh'
const s0 = () => startSession('25/5', T0, 'a1b2c3d4e5f6')

test('cleanAction: start (with a preset), pause, resume, skip, stop, and nothing else', () => {
  assert.deepEqual(cleanAction({ action: 'start', preset: '25/5' }), { act: { action: 'start', preset: '25/5' } })
  assert.deepEqual(cleanAction({ action: 'start', preset: '50/10', at: 1 }), { act: { action: 'start', preset: '50/10' } })
  for (const a of ['pause', 'resume', 'skip', 'stop']) assert.deepEqual(cleanAction({ action: a, preset: 'x', phaseEndsAt: 1 }), { act: { action: a } }) // (times from the page: ignored)
  assert.equal(cleanAction({ action: 'start' }).field, 'preset')
  assert.equal(cleanAction({ action: 'start', preset: '15/3' }).field, 'preset')
  assert.equal(cleanAction({ action: 'start', preset: 'toString' }).field, 'preset') // (own keys only)
  assert.equal(cleanAction({ action: 'restart' }).field, 'action')
  for (const raw of [null, 'start', [], 5]) assert.equal(cleanAction(raw).field, null)
  assert.deepEqual(PRESET_IDS, ['25/5', '50/10'])
})

test('lengths: 25 / 5 and 50 / 10 minutes; a test minute only from FOCUS_TEST_MINUTE_MS, within bounds', () => {
  assert.equal(phaseLen('25/5', 'focus'), 25 * MINUTE)
  assert.equal(phaseLen('25/5', 'break'), 5 * MINUTE)
  assert.equal(phaseLen('50/10', 'focus'), 50 * MINUTE)
  assert.equal(phaseLen('50/10', 'break', 1000), 10_000)
  assert.equal(minuteMs({}), MINUTE)
  assert.equal(minuteMs({ FOCUS_TEST_MINUTE_MS: '1000' }), 1000)
  assert.equal(minuteMs({ FOCUS_TEST_MINUTE_MS: '2000', NODE_ENV: 'development' }), 2000)
  for (const v of ['0', '999', '60000', '1e9', 'x', '1500.5']) assert.equal(minuteMs({ FOCUS_TEST_MINUTE_MS: v }), MINUTE, v)
})

test('a production server ignores the test minute unless told twice (a stray variable can\'t shorten a session)', () => {
  assert.equal(minuteMs({ FOCUS_TEST_MINUTE_MS: '2000', NODE_ENV: 'production' }), MINUTE)
  assert.equal(minuteMs({ FOCUS_TEST_MINUTE_MS: '2000', NODE_ENV: 'production', FOCUS_TEST_IN_PRODUCTION: 'true' }), MINUTE)
  assert.equal(minuteMs({ FOCUS_TEST_MINUTE_MS: '2000', NODE_ENV: 'production', FOCUS_TEST_IN_PRODUCTION: '1' }), 2000)
  assert.equal(minuteMs({ NODE_ENV: 'production', FOCUS_TEST_IN_PRODUCTION: '1' }), MINUTE)
})

test('start: focus, round 1, ending a phase\'s length from the server\'s now', () => {
  assert.deepEqual(s0(), { id: 'a1b2c3d4e5f6', preset: '25/5', phase: 'focus', round: 1, startedAt: T0, touchedAt: T0, phaseMs: 25 * MINUTE, phaseEndsAt: T0 + 25 * MINUTE, pausedLeft: null })
  // one running is replaced: a fresh id, round 1
  const mid = nextPhase(nextPhase(s0(), T0), T0)
  const r = act(mid, { action: 'start', preset: '50/10' }, T0 + 5000, { id: 'ffffffffffff' })
  assert.deepEqual([r.session.id, r.session.round, r.session.phase, r.session.phaseEndsAt], ['ffffffffffff', 1, 'focus', T0 + 5000 + 50 * MINUTE])
})

test('pause keeps the time left; resume runs on from there; neither twice', () => {
  const p = act(s0(), { action: 'pause' }, T0 + 6 * MINUTE).session
  assert.deepEqual([p.phaseEndsAt, p.pausedLeft, running(p), paused(p)], [null, 19 * MINUTE, false, true])
  assert.equal(act(p, { action: 'pause' }, T0 + 7 * MINUTE).error, 'already paused')
  // an hour on the pause: still 19 minutes when it resumes
  const r = act(p, { action: 'resume' }, T0 + 66 * MINUTE).session
  assert.deepEqual([r.phaseEndsAt, r.pausedLeft], [T0 + 85 * MINUTE, null])
  assert.equal(act(r, { action: 'resume' }, T0).error, 'already running')
  // a phase that ran out but isn't changed yet (the ticker's second): paused at 0
  assert.equal(act(s0(), { action: 'pause' }, T0 + 30 * MINUTE).session.pausedLeft, 0)
})

test('skip: the next phase now (break after focus, the next round after a break), running even from a pause', () => {
  const b = act(s0(), { action: 'skip' }, T0 + 60_000).session
  assert.deepEqual([b.phase, b.round, b.phaseMs, b.phaseEndsAt], ['break', 1, 5 * MINUTE, T0 + 6 * MINUTE])
  const f = act(b, { action: 'skip' }, T0 + 2 * MINUTE).session
  assert.deepEqual([f.phase, f.round, f.phaseEndsAt], ['focus', 2, T0 + 27 * MINUTE])
  const p = act(f, { action: 'pause' }, T0 + 3 * MINUTE).session
  const n = act(p, { action: 'skip' }, T0 + 9 * MINUTE).session
  assert.deepEqual([n.phase, n.round, running(n), n.phaseEndsAt], ['break', 2, true, T0 + 14 * MINUTE])
  assert.equal(n.id, s0().id) // the same session
})

test('stop: none; nothing to pause / resume / skip / stop without a session', () => {
  assert.deepEqual(act(s0(), { action: 'stop' }, T0), { session: null })
  for (const action of ['pause', 'resume', 'skip', 'stop']) assert.equal(act(null, { action }, T0).error, 'no focus session running')
})

test('the ticker\'s change: on time, the next phase starts when this one ended (the countdowns carry straight on)', () => {
  const s = s0()
  assert.equal(ended(s, T0 + 25 * MINUTE - 1), false)
  assert.equal(ended(s, T0 + 25 * MINUTE), true)
  const a = advance(s, T0 + 25 * MINUTE + 1200) // (the push lands a second late: the break still ends at :30)
  assert.equal(a.counted, true)
  assert.deepEqual([a.session.phase, a.session.round, a.session.phaseEndsAt], ['break', 1, T0 + 30 * MINUTE])
  const b = advance(a.session, T0 + 30 * MINUTE + 40_000)
  assert.equal(b.counted, false) // a break doesn't count
  assert.deepEqual([b.session.phase, b.session.round, b.session.phaseEndsAt], ['focus', 2, T0 + 55 * MINUTE])
  assert.equal(ended(act(s, { action: 'pause' }, T0).session, T0 + 99 * MINUTE), false) // paused: never ends
  assert.equal(ended(null, T0), false)
})

test('the ticker late (the server was down): the next phase starts now, not in the past', () => {
  const late = T0 + 25 * MINUTE + LATE_MS + 1
  const a = advance(s0(), late)
  assert.deepEqual([a.counted, a.session.phase, a.session.phaseEndsAt], [true, 'break', late + 5 * MINUTE])
})

test('a session forgotten for 12 hours ends at its next change (no buzz every 25 minutes all night)', () => {
  let s = s0()
  let ms = s.phaseEndsAt
  let changes = 0
  for (;;) {
    const a = advance(s, ms)
    changes++
    if (!a.session) break
    s = a.session
    ms = s.phaseEndsAt
  }
  assert.ok(ms - T0 >= MAX_SESSION_MS && ms - T0 < MAX_SESSION_MS + 30 * MINUTE)
  assert.equal(changes, 48) // 24 rounds of 30 minutes
})

test('paused overnight and resumed in the morning, a session goes on (12 hours counts from the owner\'s last touch)', () => {
  const p = act(s0(), { action: 'pause' }, T0 + 10 * MINUTE).session
  const r = act(p, { action: 'resume' }, T0 + 14 * 3600_000).session // (the next morning)
  const a = advance(r, r.phaseEndsAt)
  assert.deepEqual([a.counted, a.session?.phase], [true, 'break'])
  // a skip counts as a touch too; a row from before touchedAt falls back to startedAt
  const k = act(s0(), { action: 'skip' }, T0 + 11 * 3600_000).session
  assert.equal(advance(k, k.phaseEndsAt).session?.phase, 'focus')
  const { touchedAt, ...old } = s0()
  assert.equal(advance({ ...old, phaseEndsAt: T0 + MAX_SESSION_MS }, T0 + MAX_SESSION_MS).session, null)
  assert.equal(cleanSession(old).touchedAt, T0)
})

test('the server\'s clock: the quickest recent trip wins; a clock that jumped starts over', () => {
  // the server is 2 s ahead; trips of 80, 900 and 60 ms (each sample within rtt / 2 of the truth)
  let list = addSkew([], { skew: 2010, rtt: 80, at: 0 })
  list = addSkew(list, { skew: 1600, rtt: 900, at: 1000 })
  assert.equal(skewOf(list), 2010) // (the slow answer doesn't move it)
  list = addSkew(list, { skew: 1995, rtt: 60, at: 2000 })
  assert.equal(skewOf(list), 1995)
  // this device's clock was set back an hour: the next sample disagrees with all of them, so it alone counts
  list = addSkew(list, { skew: 3600_000 + 2000, rtt: 300, at: 3000 })
  assert.deepEqual([list.length, skewOf(list)], [1, 3602_000])
  // old ones age out; at most SKEW_KEEP
  for (let i = 0; i < 10; i++) list = addSkew(list, { skew: 3602_000, rtt: 100 + i, at: 4000 + i })
  assert.equal(list.length, 6)
  assert.equal(addSkew(list, { skew: 3602_000, rtt: 500, at: 4000 + 11 * MINUTE }).length, 1)
  assert.equal(skewOf([]), 0)
})

test('keys and tags: one per change, one per session', () => {
  const s = s0()
  assert.equal(transitionKey(s), 'focus:a1b2c3d4e5f6:1:focus')
  assert.equal(transitionKey(nextPhase(s, T0)), 'focus:a1b2c3d4e5f6:1:break')
  assert.equal(transitionKey(nextPhase(nextPhase(s, T0), T0)), 'focus:a1b2c3d4e5f6:2:focus')
  assert.equal(noticeTag('a1b2c3d4e5f6'), 'focus:a1b2c3d4e5f6')
  // a focus that ends at 00:10 counts on the new day (the owner's zone)
  assert.equal(dayOf(at(0, 10, 15), TZ), '2026-10-15')
  assert.equal(dayOf(at(0, 10, 15), 'Europe/Berlin'), '2026-10-14')
})

test('the countdown: mm:ss rounded up, turning over on the second\'s edge; the ring; paused stays put', () => {
  assert.equal(fmtLeft(25 * MINUTE), '25:00')
  assert.equal(fmtLeft(25 * MINUTE - 1), '25:00')
  assert.equal(fmtLeft(24 * MINUTE + 59_000), '24:59')
  assert.equal(fmtLeft(1), '00:01')
  assert.equal(fmtLeft(0), '00:00')
  assert.equal(fmtLeft(-5000), '00:00')
  assert.equal(fmtLeft(50 * MINUTE), '50:00')
  assert.equal(nextTickIn(1500), 500)
  assert.equal(nextTickIn(2000), 1000)
  assert.equal(nextTickIn(0), null)
  const s = s0()
  // two devices whose clocks are 400 ms apart but both corrected to the server's: the same mm:ss
  assert.equal(fmtLeft(leftOf(s, T0 + 6 * MINUTE + 18_300)), fmtLeft(leftOf(s, T0 + 6 * MINUTE + 18_700)))
  assert.equal(leftOf(s, T0 + 30 * MINUTE), 0)
  assert.equal(ringOf(s, T0), 0)
  assert.equal(ringOf(s, T0 + 5 * MINUTE), 20)
  assert.equal(ringOf(s, T0 + 99 * MINUTE), 100)
  assert.equal(ringOf(null, T0), 0)
  const p = act(s, { action: 'pause' }, T0 + 10 * MINUTE).session
  assert.equal(leftOf(p, T0 + 99 * MINUTE), 15 * MINUTE)
  assert.equal(ringOf(p, T0 + 99 * MINUTE), 40)
})

test('labels: the icon\'s, the sheet\'s phase line, the day\'s count', () => {
  const s = s0()
  assert.equal(iconLabel(null, T0), 'Focus: start a session')
  assert.equal(iconLabel(s, T0 + 6 * MINUTE + 18_000), 'Focus · 18:42 left')
  const b = nextPhase(s, T0)
  assert.equal(iconLabel(b, T0 + 110_000), 'Break · 03:10 left')
  assert.equal(iconLabel(act(s, { action: 'pause' }, T0 + 60_000).session, T0 + 9e9), 'Focus · paused, 24:00 left')
  assert.equal(phaseLine(null), 'Pick a length to start')
  assert.equal(phaseLine(s), 'Focus · round 1 · 25 min')
  assert.equal(phaseLine(b), 'Break · 5 min')
  assert.equal(phaseLine(act(b, { action: 'pause' }, T0).session), 'Break · 5 min · paused')
  assert.equal(countText(3), '🍅 3 today')
  assert.equal(countText(0), '🍅 0 today')
  assert.equal(countText(undefined), '🍅 0 today')
})

test('cleanSession: a session as the page gets it, or null', () => {
  const s = s0()
  assert.deepEqual(cleanSession(s), s)
  const p = act(s, { action: 'pause' }, T0).session
  assert.deepEqual(cleanSession({ ...p, extra: 1 }), p)
  for (const bad of [null, 5, {}, { ...s, preset: '1/1' }, { ...s, phase: 'nap' }, { ...s, round: 0 }, { ...s, phaseMs: 0 }, { ...s, phaseEndsAt: null }, { ...s, pausedLeft: 5 }, { ...s, id: '' }])
    assert.equal(cleanSession(bad), null, JSON.stringify(bad))
})

test('the notice at each change: what ended, what\'s next and until when, the day\'s count; short-lived, one per session', () => {
  const s = s0()
  const b = advance(s, s.phaseEndsAt).session
  const n1 = phaseNotice(s, b, { count: 3, tz: TZ })
  assert.deepEqual(n1, {
    source: 'Focus', tag: 'focus:a1b2c3d4e5f6', title: 'Focus done · 5 min break', body: 'Round 1 done · 3 focus sessions today. Back to focus at 10:30.',
    icon: 'fa-solid fa-mug-hot', color: 'green', level: 'success', ttl: 360,
  })
  const f = advance(b, b.phaseEndsAt).session
  const n2 = phaseNotice(b, f, { count: 3, tz: TZ })
  assert.deepEqual([n2.title, n2.body, n2.tag, n2.ttl], ['Break over · back to focus', 'Round 2 · 25 min, until 10:55.', 'focus:a1b2c3d4e5f6', 25 * 60 + 60])
  assert.equal(phaseNotice(s, b, { count: 1, tz: TZ }).body, 'Round 1 done · 1 focus session today. Back to focus at 10:30.')
  const end = phaseNotice(s, null, { count: 24, tz: TZ })
  assert.deepEqual([end.title, end.body], ['Focus session ended', 'Left alone for 12 hours, so it stopped. 24 focus sessions today.'])
  // all of them go through the hub as they are
  for (const n of [n1, n2, end]) assert.deepEqual(cleanNotice(n).warnings, [])
})
