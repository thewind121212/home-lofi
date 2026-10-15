// Focus sessions: pure rules shared by the owner's route (app/api/private/settings/focus), its store
// (lib/focus-store.js), the server's ticker (lib/focus-ticker.js) and the page (app/focus.js: the header icon, its sheet,
// Ambient's chip, the lock screen's). No React, no database, so node:test checks all of it.
//
// A small Pomodoro whose value is that it's the SAME on every device: one session per owner, kept on the server. The
// owner starts it on the PC and the phone's icon is already counting down; paused on the phone, the PC pauses too.
// - Presets: 25 / 5 and 50 / 10 (focus / break, minutes). Rounds go on (focus, break, focus, …) until stopped: no long
//   break, no round limit. One safety: a session left alone for MAX_SESSION_MS (no start, pause, resume or skip since)
//   ends at its next change (not a phone buzzing every 25 minutes all night; one paused over lunch or overnight and
//   resumed goes on).
// - A session: { id, preset, phase ('focus' | 'break'), round (1, 2, …: a break keeps its focus's number), startedAt,
//   touchedAt (the owner's last start / pause / resume / skip), phaseMs (this phase's length), phaseEndsAt (ms, the
//   server's clock) | null, pausedLeft (ms) | null }: running has phaseEndsAt, paused has pausedLeft instead. None: null.
// - The phases change on the SERVER (lib/focus-ticker.js), at phaseEndsAt, whether or not a page is open: the hub notice
//   and the phone's push go from there. Each change is claimed once in the database (transitionKey), so a restart or two
//   servers never count or buzz twice. A focus phase that runs out counts (🍅, per day in the owner's zone: the Habits
//   doc's, the day it ended); one skipped doesn't.
// - Pages never trust their own clock: every answer carries the server's `now`, the page keeps the difference, and the
//   countdown is phaseEndsAt − (the device's clock + that difference), so every device shows the same mm:ss.
import { localNow } from './habits.js'

export const PRESETS = { '25/5': [25, 5], '50/10': [50, 10] } // focus, break: minutes
export const PRESET_IDS = Object.keys(PRESETS)
export const DEFAULT_PRESET = '25/5'
export const ACTIONS = ['start', 'pause', 'resume', 'skip', 'stop']
export const MINUTE = 60_000
// the ticker this late at a phase's end (the server was down): the next one starts now. Above the ticker's own worst
// case (its minute's check, lib/focus-ticker.js CHECK_MS, when the second's timer was lost), so only a real outage
// moves the phases
export const LATE_MS = 90_000
export const MAX_SESSION_MS = 12 * 3600_000 // left alone this long, a session ends at its next change instead of going on

// A minute's length. FOCUS_TEST_MINUTE_MS (1000–59999) makes the presets seconds long, for a local check of a phase's
// end (the notice, the push, the count) without waiting 25 minutes: `npm run dev` (and node --test) only. A production
// server (NODE_ENV=production: `next start`, the container) ignores it unless FOCUS_TEST_IN_PRODUCTION=1 is set too, so a
// stray variable in a deployment can't shorten a real session
export function minuteMs(env = process.env) {
  const v = Number(env?.FOCUS_TEST_MINUTE_MS)
  if (!(Number.isInteger(v) && v >= 1000 && v < MINUTE)) return MINUTE
  return env.NODE_ENV !== 'production' || env.FOCUS_TEST_IN_PRODUCTION === '1' ? v : MINUTE
}

export const isPreset = (p) => typeof p === 'string' && Object.hasOwn(PRESETS, p)
// a phase's length in a preset
export const phaseLen = (preset, phase, minute = MINUTE) => PRESETS[preset][phase === 'focus' ? 0 : 1] * minute

// a POST from the page -> { act } | { error, field }
// { action: 'start', preset } | { action: 'pause' | 'resume' | 'skip' | 'stop' }
export function cleanAction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  const { action } = raw
  if (!ACTIONS.includes(action)) return { error: `action: one of ${ACTIONS.join(', ')}`, field: 'action' }
  if (action !== 'start') return { act: { action } }
  return isPreset(raw.preset) ? { act: { action, preset: raw.preset } } : { error: `preset: one of ${PRESET_IDS.join(', ')}`, field: 'preset' }
}

// ---- a session's moves ----

export const running = (s) => Boolean(s && s.phaseEndsAt != null)
export const paused = (s) => Boolean(s && s.phaseEndsAt == null)
// the phase has run out (the ticker's cue)
export const ended = (s, ms) => running(s) && s.phaseEndsAt <= ms

// a new one: focus, round 1, from now
export function startSession(preset, ms, id, minute = MINUTE) {
  const phaseMs = phaseLen(preset, 'focus', minute)
  return { id, preset, phase: 'focus', round: 1, startedAt: ms, touchedAt: ms, phaseMs, phaseEndsAt: ms + phaseMs, pausedLeft: null }
}

// the phase after this one, starting at `from` (running): focus -> break (same round), break -> focus (the next round)
export function nextPhase(s, from, minute = MINUTE) {
  const phase = s.phase === 'focus' ? 'break' : 'focus'
  const phaseMs = phaseLen(s.preset, phase, minute)
  return { ...s, phase, round: phase === 'focus' ? s.round + 1 : s.round, phaseMs, phaseEndsAt: from + phaseMs, pausedLeft: null }
}

// The owner's action on the session `cur` (null: none) at the server's `ms` -> { session } (null: stopped) | { error }.
// id: a new session's (start). The page runs the same rule on its own copy to draw the tap at once (optimistic), then
// takes the server's answer.
// - start: a fresh session in that preset (one running is replaced: a new id, round 1)
// - pause: running only; the time left is kept. resume: paused only; it runs on from there
// - skip: ends this phase now (not counted), the next one starts running (paused too: skipping means "go on")
// - stop: no session
export function act(cur, { action, preset }, ms, { id, minute = MINUTE } = {}) {
  if (action === 'start') return { session: startSession(preset, ms, id, minute) }
  if (!cur) return { error: 'no focus session running' }
  if (action === 'stop') return { session: null }
  if (action === 'skip') return { session: { ...nextPhase(cur, ms, minute), touchedAt: ms } }
  if (action === 'pause') {
    if (!running(cur)) return { error: 'already paused' }
    return { session: { ...cur, touchedAt: ms, phaseEndsAt: null, pausedLeft: Math.max(0, cur.phaseEndsAt - ms) } }
  }
  if (action === 'resume') {
    if (running(cur)) return { error: 'already running' }
    return { session: { ...cur, touchedAt: ms, phaseEndsAt: ms + cur.pausedLeft, pausedLeft: null } }
  }
  return { error: 'unknown action' }
}

// The ticker's move once a phase has ended -> { session (the next phase, or null: ended for good), counted (a focus
// phase ran out: 🍅 +1) }. The next phase starts when this one ended, so every device's countdown carries straight on;
// a ticker more than LATE_MS late (the server was down) starts it now instead (a break that would be over already is no
// break). A session left alone for MAX_SESSION_MS (since touchedAt; a row from before that field: startedAt) ends here.
export function advance(s, ms, minute = MINUTE) {
  const from = ms - s.phaseEndsAt > LATE_MS ? ms : s.phaseEndsAt
  const counted = s.phase === 'focus'
  if (from - (s.touchedAt ?? s.startedAt) >= MAX_SESSION_MS) return { session: null, counted }
  return { session: nextPhase(s, from, minute), counted }
}

// each phase change, once ever: claimed in the database before it's made (lib/focus-store.js claim)
export const transitionKey = (s) => `focus:${s.id}:${s.round}:${s.phase}`
// the hub notice's tag: a session's next notice replaces its last one, and stopping takes it off
export const noticeTag = (id) => `focus:${id}`
// the day a focus phase counts on: the day it ended, in the owner's zone
export const dayOf = (ms, tz) => localNow(ms, tz).day

// ---- the server's clock, as a device knows it ----

// Each answer is a sample { skew (the server's `now` − the device's clock at the middle of the trip), rtt, at (when, on
// the device's monotonic clock) }. The quickest recent trip is the surest (its middle is within rtt / 2 of the truth), so
// one slow answer doesn't shift every countdown; a sample that disagrees with it by more than both trips' doubt (the
// device's clock was set, or it slept) starts over from itself. -> the samples to keep; skewOf(them) -> the skew to use
export const SKEW_KEEP = 6
export const SKEW_AGE = 10 * MINUTE
const quickest = (list) => list.reduce((b, s) => (!b || s.rtt < b.rtt ? s : b), null)
export function addSkew(samples, x) {
  const fresh = samples.filter((s) => x.at - s.at < SKEW_AGE)
  const best = quickest(fresh)
  if (best && Math.abs(x.skew - best.skew) > (x.rtt + best.rtt) / 2 + 250) return [x]
  return [...fresh, x].slice(-SKEW_KEEP)
}
export const skewOf = (samples) => quickest(samples)?.skew ?? 0

// ---- what the page draws ----

// the time left in this phase at `ms` (the server's clock, as the device knows it)
export const leftOf = (s, ms) => (!s ? 0 : running(s) ? Math.max(0, s.phaseEndsAt - ms) : Math.max(0, s.pausedLeft ?? 0))
// how much of the phase has gone, 0–100 (the header icon's ring)
export function ringOf(s, ms) {
  if (!s || !(s.phaseMs > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((1 - leftOf(s, ms) / s.phaseMs) * 100)))
}
// ms -> 'mm:ss', rounded up (the last second shows 00:01, never 00:00 while any time is left)
export function fmtLeft(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}
// how long until the shown mm:ss changes (the countdown re-draws on that edge, so every device turns over together)
export const nextTickIn = (left) => (left <= 0 ? null : left % 1000 || 1000)
export const phaseName = (s) => (s?.phase === 'break' ? 'Break' : 'Focus')
// the header icon's label (and tooltip)
export function iconLabel(s, ms) {
  if (!s) return 'Focus: start a session'
  const left = fmtLeft(leftOf(s, ms))
  return paused(s) ? `${phaseName(s)} · paused, ${left} left` : `${phaseName(s)} · ${left} left`
}
// the phase line under the sheet's countdown
export function phaseLine(s) {
  if (!s) return 'Pick a length to start'
  const [f, b] = PRESETS[s.preset] ?? []
  const what = s.phase === 'focus' ? `Focus · round ${s.round}` : `Break · ${b} min`
  return `${what}${paused(s) ? ' · paused' : ''}${s.phase === 'focus' && f ? ` · ${f} min` : ''}`
}
export const countText = (n) => `🍅 ${Number.isInteger(n) && n > 0 ? n : 0} today`

// A session as the page gets it -> the same, or null if anything's off (an old server's answer, a hand-made row)
export function cleanSession(s) {
  if (!s || typeof s !== 'object') return null
  const num = (v) => Number.isFinite(v) && v >= 0
  if (typeof s.id !== 'string' || !s.id || s.id.length > 40 || !isPreset(s.preset) || !['focus', 'break'].includes(s.phase)) return null
  if (!Number.isInteger(s.round) || s.round < 1 || !num(s.startedAt) || !(s.phaseMs > 0)) return null
  if (s.phaseEndsAt != null ? !num(s.phaseEndsAt) || s.pausedLeft != null : !num(s.pausedLeft)) return null
  const touchedAt = num(s.touchedAt) ? s.touchedAt : s.startedAt
  return { id: s.id, preset: s.preset, phase: s.phase, round: s.round, startedAt: s.startedAt, touchedAt, phaseMs: s.phaseMs, phaseEndsAt: s.phaseEndsAt ?? null, pausedLeft: s.pausedLeft ?? null }
}

// ---- the notice at each change (lib/notify.js cleanNotice's input) ----

// cur: the phase that ended, next: what follows (null: the session ended, MAX_SESSION_MS), count: 🍅 today after it,
// tz: the owner's zone (the next end's clock time). Short-lived (the next phase's length): the next change replaces it
// (the same tag), stopping takes it off
export function phaseNotice(cur, next, { count = 0, tz } = {}) {
  const [f, b] = PRESETS[cur.preset]
  const until = (ms) => {
    const m = localNow(ms, tz).min
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }
  const today = `${count} focus session${count === 1 ? '' : 's'} today`
  const base = { source: 'Focus', tag: noticeTag(cur.id) }
  if (!next) return { ...base, title: 'Focus session ended', body: `Left alone for ${MAX_SESSION_MS / 3600_000} hours, so it stopped. ${today}.`, icon: 'fa-solid fa-stopwatch', color: 'muted', ttl: 3600 }
  const ttl = Math.max(60, Math.ceil(next.phaseMs / 1000) + 60)
  if (cur.phase === 'focus')
    return { ...base, title: `Focus done · ${b} min break`, body: `Round ${cur.round} done · ${today}. Back to focus at ${until(next.phaseEndsAt)}.`, icon: 'fa-solid fa-mug-hot', color: 'green', level: 'success', ttl }
  return { ...base, title: 'Break over · back to focus', body: `Round ${next.round} · ${f} min, until ${until(next.phaseEndsAt)}.`, icon: 'fa-solid fa-stopwatch', color: 'primary', ttl }
}
