// Habits: pure rules shared by the owner's route (app/api/private/settings/habits), its store (lib/habits-store.js),
// the reminders and the card. No React, no database, so node:test checks all of it.
//
// A habit is a promise with a time: "06:15 · 🏋️ Workout · 45 min, Mon–Sat, 'I show up at 6:15.'". The owner sets
// each one's routine (a fixed time, a window, or any time that day; the days; how long). A check-in is that day's
// promise kept: confirmed on purpose (held, not tapped), on time or late, with how it felt. Days are the owner's own
// calendar days in the habits' time zone (doc.tz), never the server's clock.

export const KINDS = ['time', 'window', 'any'] // 06:15 / 19:00–22:00 / any time that day
export const DAYS = [1, 2, 3, 4, 5, 6, 7] // ISO: Monday 1 … Sunday 7
export const RATINGS = ['hard', 'okay', 'great'] // 😮‍💨 🙂 🔥
export const REASONS = ['mistake', 'not-done'] // why a check-in was taken back after its undo window
export const MAX_HABITS = 20
export const MAX = { name: 40, identity: 100, note: 200 }
// the icons a habit can have (Lucide's names; app/habits.js imports these from lucide-react)
export const ICONS = ['Dumbbell', 'Piano', 'BookOpen', 'Guitar', 'Music', 'Brain', 'PenLine', 'Code', 'Languages', 'Footprints', 'Bike', 'PersonStanding',
  'Waves', 'Droplet', 'Salad', 'Coffee', 'Moon', 'BedDouble', 'Sunrise', 'Sprout', 'Leaf', 'Heart', 'Timer', 'Activity']
export const DEFAULT_ICON = 'Sprout'
export const MINUTES = [1, 600] // how long one takes
export const BACK_DAYS = 2 // a check-in for up to 2 days ago (forgot to tap): late, never further back
export const UNDO_MS = 10_000 // right after a check-in it can just be undone (as if it never happened)
export const UNDO_SLACK = 5_000 // the server's allowance for the trip there
export const GRACE_MIN = 60 // after a habit's time / window ends, it still counts as on time for this long
export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh'
export const STREAK_DAYS = 400 // how far back a streak is counted

const CTRL = /[\u0000-\u001f\u007f]/g
const oneLine = (s) => s.replace(/\s+/g, ' ').replace(CTRL, '').trim()
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const ID = /^[a-z0-9]{6,24}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

// 'HH:MM' <-> minutes since midnight
export const toMin = (s) => {
  const m = HHMM.exec(s ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export const fmtMin = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

export function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// ---- days: 'YYYY-MM-DD' in the habits' zone ----

// a moment -> that zone's { day, min (since midnight), dow (1 Mon … 7 Sun) }
const fmts = new Map()
export function localNow(ms, tz = DEFAULT_TZ) {
  let f = fmts.get(tz)
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })))
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]))
  const day = `${p.year}-${p.month}-${p.day}`
  return { day, min: Number(p.hour) * 60 + Number(p.minute), dow: dowOf(day) }
}
const utc = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
export const isDay = (s) => typeof s === 'string' && DAY.test(s) && new Date(utc(s)).toISOString().startsWith(s)
export const dowOf = (day) => new Date(utc(day)).getUTCDay() || 7
export const addDays = (day, n) => new Date(utc(day) + n * 86400_000).toISOString().slice(0, 10)
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400_000) // b - a

// ---- a habit's routine ----

// when it happens, in minutes since midnight: [start, end] (any time: the whole day)
export function spanOf(h) {
  const w = h.when
  if (w.kind === 'time') {
    const s = toMin(w.at)
    return [s, Math.min(1440, s + (h.minutes ?? 30))]
  }
  if (w.kind === 'window') return [toMin(w.from), toMin(w.to)]
  return [0, 1440]
}
export const dueOn = (h, day) => !h.archived && h.days.includes(dowOf(day))

// can `day` be checked now? Today or up to BACK_DAYS before; never the future, never before the habit existed, never
// an archived habit
export function checkable(h, day, now) {
  if (h.archived || !isDay(day) || (isDay(h.since) && day < h.since)) return false
  const back = daysBetween(day, now.day)
  return back >= 0 && back <= BACK_DAYS
}
// a check-in now for `day`: late if it's for an earlier day, or today past the end (+ GRACE_MIN). Any-time: never late
// today. Early (06:00 for 06:15) is on time: doing it sooner is still keeping it
export function isLate(h, day, now) {
  if (day < now.day) return true
  if (h.when.kind === 'any') return false
  return now.min > spanOf(h)[1] + GRACE_MIN
}
// the undo right after a check-in (then taking it back needs a reason)
export const canUndo = (doneAt, nowMs) => Number.isFinite(doneAt) && nowMs - doneAt >= 0 && nowMs - doneAt <= UNDO_MS + UNDO_SLACK

// ---- streak: never miss twice ----
// Back from today: every day done counts (a day off done too: the work happened); a due day missed is forgiven once,
// a second due day missed in a row ends the streak. Today not done yet is still open, not a miss. Nothing before the
// habit's first day (since) counts. -> { count, atRisk: the last due day was missed, so the next miss ends it }
export function streakOf(h, done, today) {
  let count = 0
  let missed = 0
  let atRisk = null
  const first = isDay(h.since) ? h.since : addDays(today, -STREAK_DAYS)
  for (let i = 0, d = today; i < STREAK_DAYS && d >= first; i++, d = addDays(d, -1)) {
    if (done.has(d)) {
      count++
      missed = 0
      atRisk ??= false
    } else if (d !== today && h.days.includes(dowOf(d))) {
      if (++missed >= 2) break
      atRisk ??= true
    }
  }
  return { count, atRisk: Boolean(atRisk) && count > 0 }
}

// ---- the owner's habits doc ({ tz, habits }), as the editor sends it ----

const str = (v, max) => (typeof v === 'string' ? oneLine(v).slice(0, max) : null)

function cleanWhen(w, at) {
  const k = w?.kind
  if (!KINDS.includes(k)) return { error: `${at}.kind: one of ${KINDS.join(', ')}`, field: `${at}.kind` }
  if (k === 'time') return toMin(w.at) == null ? { error: `${at}.at: HH:MM`, field: `${at}.at` } : { when: { kind: k, at: w.at } }
  if (k === 'window') {
    const f = toMin(w.from), t = toMin(w.to)
    if (f == null) return { error: `${at}.from: HH:MM`, field: `${at}.from` }
    if (t == null || t <= f) return { error: `${at}.to: HH:MM after from (the same day)`, field: `${at}.to` }
    return { when: { kind: k, from: w.from, to: w.to } }
  }
  return { when: { kind: k } }
}

// one habit -> { habit } | { error, field }. old: the stored one with this id (keeps its first day)
export function cleanHabit(raw, i, { old, today, mkId }) {
  const at = `habits[${i}]`
  const bad = (f, e) => ({ error: `${at}.${f}: ${e}`, field: `${at}.${f}` })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${at}: an object`, field: at }
  if (raw.id != null && !ID.test(raw.id)) return bad('id', 'unknown id')
  const name = str(raw.name, MAX.name)
  if (!name) return bad('name', `1–${MAX.name} characters`)
  const w = cleanWhen(raw.when, `${at}.when`)
  if (w.error) return w
  let minutes = null
  if (raw.minutes != null) {
    if (!Number.isInteger(raw.minutes) || raw.minutes < MINUTES[0] || raw.minutes > MINUTES[1]) return bad('minutes', `a whole number ${MINUTES[0]}–${MINUTES[1]}`)
    minutes = raw.minutes
  }
  if (!Array.isArray(raw.days) || !raw.days.length || raw.days.some((d) => !DAYS.includes(d))) return bad('days', 'at least one of 1 (Mon) … 7 (Sun)')
  const identity = str(raw.identity ?? '', MAX.identity) ?? ''
  return {
    habit: {
      id: raw.id ?? mkId(),
      name,
      icon: ICONS.includes(raw.icon) ? raw.icon : DEFAULT_ICON,
      when: w.when,
      minutes,
      days: [...new Set(raw.days)].sort((a, b) => a - b),
      identity,
      remind: raw.remind !== false,
      archived: raw.archived === true,
      since: old?.since ?? today,
    },
  }
}

// the editor's whole doc -> { doc } | { error, field }. Habits keep their order (the card's); ids must be known (old)
// or absent (new: mkId gives one); none may be left out (archive instead: its check-ins stay meaningful)
export function cleanDoc(raw, { old = { tz: DEFAULT_TZ, habits: [] }, today, mkId }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  const tz = raw.tz ?? old.tz
  if (!validTz(tz)) return { error: 'tz: an IANA time zone', field: 'tz' }
  if (!Array.isArray(raw.habits)) return { error: 'habits: a list', field: 'habits' }
  if (raw.habits.length > MAX_HABITS) return { error: `habits: at most ${MAX_HABITS}`, field: 'habits' }
  const byId = new Map(old.habits.map((h) => [h.id, h]))
  const seen = new Set()
  const habits = []
  for (const [i, r] of raw.habits.entries()) {
    if (r?.id != null && !byId.has(r.id)) return { error: `habits[${i}].id: unknown id`, field: `habits[${i}].id` }
    if (r?.id != null && seen.has(r.id)) return { error: `habits[${i}].id: twice`, field: `habits[${i}].id` }
    const c = cleanHabit(r, i, { old: byId.get(r?.id), today, mkId })
    if (c.error) return c
    seen.add(c.habit.id)
    habits.push(c.habit)
  }
  const gone = old.habits.find((h) => !seen.has(h.id))
  if (gone) return { error: `habits: ${gone.name} is missing (archive it instead)`, field: 'habits' }
  return { doc: { tz, habits } }
}

// ---- a check-in action from the card ----
// { action: 'check', habitId, day, rating? } | { action: 'rate', habitId, day, rating, note? }
// | { action: 'undo', habitId, day } | { action: 'untick', habitId, day, reason } -> { act } | { error, field }
export function cleanAction(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'the body must be a JSON object', field: null }
  const { action, habitId, day } = raw
  if (!['check', 'rate', 'undo', 'untick'].includes(action)) return { error: 'action: one of check, rate, undo, untick', field: 'action' }
  if (typeof habitId !== 'string' || !ID.test(habitId)) return { error: 'habitId: a habit id', field: 'habitId' }
  if (!isDay(day)) return { error: 'day: YYYY-MM-DD', field: 'day' }
  const act = { action, habitId, day }
  if (raw.rating != null || action === 'rate') {
    if (!RATINGS.includes(raw.rating)) return { error: `rating: one of ${RATINGS.join(', ')}`, field: 'rating' }
    act.rating = raw.rating
  }
  if (action === 'rate' && raw.note != null) {
    if (typeof raw.note !== 'string') return { error: 'note: text', field: 'note' }
    act.note = raw.note.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX.note) || null
  }
  if (action === 'untick') {
    if (!REASONS.includes(raw.reason)) return { error: `reason: one of ${REASONS.join(', ')}`, field: 'reason' }
    act.reason = raw.reason
  }
  return { act }
}

// ---- reminders (lib/habits-reminders.js sends them, once a minute, through the notification hub) ----
// - before start: a timed habit REMIND_BEFORE minutes before its time; a window when it opens. Only on its days, only
//   with its reminder on, never once it's kept today. A restart that misses the minute still sends within REMIND_LATE.
// - the weekly review: Sunday at REVIEW_AT, Monday to Sunday in a few lines.
// Each one has a key (the habit and the day, or the week) that the sender claims before it sends: once, ever.
export const REMIND_BEFORE = 5
export const REMIND_LATE = 15
export const REVIEW_DOW = 7
export const REVIEW_AT = 20 * 60
// the hub's icons are Font Awesome (lib/notify.js): each habit icon's nearest free one
export const FA_ICON = {
  Dumbbell: 'dumbbell', Piano: 'music', BookOpen: 'book-open', Guitar: 'guitar', Music: 'music', Brain: 'brain', PenLine: 'pen', Code: 'code',
  Languages: 'language', Footprints: 'shoe-prints', Bike: 'bicycle', PersonStanding: 'person', Waves: 'water', Droplet: 'droplet', Salad: 'bowl-food',
  Coffee: 'mug-hot', Moon: 'moon', BedDouble: 'bed', Sunrise: 'sun', Sprout: 'seedling', Leaf: 'leaf', Heart: 'heart', Timer: 'stopwatch', Activity: 'heart-pulse',
}

// when today's reminder goes (minutes since midnight), or null (none for this habit)
export function remindAt(h) {
  if (h.archived || h.remind === false) return null
  if (h.when.kind === 'time') return Math.max(0, toMin(h.when.at) - REMIND_BEFORE)
  if (h.when.kind === 'window') return toMin(h.when.from)
  return null
}

// what's due now: [{ key, kind: 'start', habit } | { key, kind: 'week' }]. kept: the ids kept today
export function remindersDue(doc, kept, now) {
  const out = []
  for (const h of doc.habits) {
    const at = remindAt(h)
    if (at == null || !dueOn(h, now.day) || (isDay(h.since) && now.day < h.since) || kept.has(h.id)) continue
    if (now.min >= at && now.min < at + REMIND_LATE) out.push({ key: `start:${h.id}:${now.day}`, kind: 'start', habit: h })
  }
  if (now.dow === REVIEW_DOW && now.min >= REVIEW_AT && now.min < REVIEW_AT + 60 && doc.habits.some((h) => !h.archived)) out.push({ key: `week:${now.day}`, kind: 'week' })
  return out
}

// the notice for a habit about to start (lib/notify.js cleanNotice's input). It goes when the habit's time has passed
// (ttl), and a newer one for the same habit replaces it (tag)
export function startNotice(h, now) {
  const end = spanOf(h)[1] + GRACE_MIN
  const len = h.minutes ? ` · ${h.minutes} min` : ''
  // (a restart's late send, or a time just after midnight, isn't "in 5 min": it says what's true)
  const left = h.when.kind === 'time' ? toMin(h.when.at) - now.min : 0
  const title = h.when.kind === 'window' ? `${h.name}: your window is open` : left > 0 ? `${h.name} in ${left} min` : `${h.name}: time to start`
  const when = h.when.kind === 'time' ? `${h.when.at}${len}` : `${h.when.from}–${h.when.to}${len}`
  return {
    title,
    body: [h.identity ? `“${h.identity}”` : null, `${when}. Hold to keep it on the Habits card.`].filter(Boolean).join('\n'),
    source: 'Habits',
    icon: `fa-solid fa-${FA_ICON[h.icon] ?? 'seedling'}`,
    color: 'primary',
    tag: `habit:${h.id}`,
    ttl: Math.max(600, (end - now.min) * 60),
  }
}

const RATING_WORD = { hard: 'hard', okay: 'okay', great: 'great' }
// the week (Monday to `today`, a Sunday) in numbers: per habit kept / due, on time, the rating it got most
export function weekSummary(doc, checkins, today) {
  const monday = addDays(today, 1 - dowOf(today))
  const lines = []
  let kept = 0, due = 0
  for (const h of doc.habits) {
    if (h.archived) continue
    const days = []
    const mine = checkins.filter((c) => c.habitId === h.id && c.undoneAt == null && c.day >= monday && c.day <= today)
    // today is still open (the review goes at 20:00, piano's window runs to 22:00): it counts only once kept
    const keptToday = mine.some((c) => c.day === today)
    for (let d = monday; d <= today; d = addDays(d, 1)) if (h.days.includes(dowOf(d)) && !(isDay(h.since) && d < h.since) && (d < today || keptToday)) days.push(d)
    const onDue = mine.filter((c) => days.includes(c.day))
    if (!days.length && !mine.length) continue
    kept += onDue.length
    due += days.length
    const onTime = onDue.filter((c) => !c.late).length
    const count = {}
    for (const c of mine) if (c.rating) count[c.rating] = (count[c.rating] ?? 0) + 1
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0]
    lines.push(`${h.name} ${onDue.length}/${days.length} · ${onTime} on time${top ? ` · mostly ${RATING_WORD[top]}` : ''}`)
  }
  return { kept, due, lines }
}
export function weekNotice(doc, checkins, today) {
  const w = weekSummary(doc, checkins, today)
  return {
    title: w.due ? `Your week: ${w.kept} of ${w.due} kept` : 'Your week',
    body: [...w.lines, w.due && w.kept === w.due ? 'Every one kept. That is who you are now.' : 'One miss is fine; never miss twice.'].join('\n'),
    source: 'Habits',
    icon: 'fa-solid fa-calendar-check',
    color: 'primary',
    tag: 'habits:week',
    ttl: 3 * 86400,
  }
}
