// The owner's schedule for other machines on the LAN: Jade, the voice assistant on the Razer, reads the habits'
// routines and how they've gone, to talk about the day and help plan new ones. Read-only. The routes are
// app/api/private/schedule (one day) and app/api/private/schedule/routines (every habit, with how it's gone); this is
// what they answer, as pure rules over the habits doc (lib/habits.js) and its check-ins. No database, no network.
// Times go out as ISO 8601 in the habits' zone ("2026-10-27T06:15:00+07:00"), days as 'YYYY-MM-DD' there.
import { addDays, daysBetween, dowOf, fmtMin, isDay, spanOf, streakOf } from './habits.js'

export const MAX_DAYS = 60 // how far back routines' stats can look
export const DEFAULT_DAYS = 14
export const MAX_AHEAD = 366 // a day's schedule: at most this far from today, either way
export const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// the zone's offset on that day, '+07:00' (at noon: clear of any daylight-saving switch)
export function offsetOf(tz, day) {
  const [y, m, d] = day.split('-').map(Number)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(Date.UTC(y, m - 1, d, 12))
    .find((p) => p.type === 'timeZoneName')?.value
  const o = /GMT([+-]\d{2}:\d{2})/.exec(name ?? '')
  return o ? o[1] : '+00:00' // ('GMT' alone is UTC)
}
// minutes since that day's midnight -> its ISO time (1440: the next midnight)
export const isoAt = (day, min, off) => (min >= 1440 ? `${addDays(day, 1)}T00:00:00${off}` : `${day}T${fmtMin(min)}:00${off}`)

// the days it's on, as said out loud
export function repeatOf(days) {
  const k = days.join()
  return k === '1,2,3,4,5,6,7' ? 'daily' : k === '1,2,3,4,5' ? 'weekdays' : k === '6,7' ? 'weekends' : 'weekly'
}

// the routine itself: when, how long, which days
function routine(h) {
  const w = h.when
  return {
    when: w.kind === 'time' ? { kind: 'time', at: w.at } : w.kind === 'window' ? { kind: 'window', from: w.from, to: w.to } : { kind: 'any' },
    minutes: h.minutes ?? null,
    repeat: repeatOf(h.days),
    days: h.days.map((d) => WEEKDAY[d]),
  }
}
// kept that day (taken back doesn't count) -> the check-in, or null
const keptOn = (checkins, id, day) => checkins.find((c) => c.habitId === id && c.day === day && c.undoneAt == null) ?? null
const startMin = (h) => (h.when.kind === 'any' ? -1 : spanOf(h)[0])

// One day: the habits due that day, by start (any-time ones first), each with whether it was kept.
//   doc: { tz, habits }; checkins: that day's (lib/habits-store.js checkins rows: { habitId, day, doneAt, late, rating,
//   undoneAt }); today: the habits' today
//   -> [{ id, kind: 'habit', title, icon, identity, start, end (null: any time), all_day, window, minutes, repeat, days,
//         done, done_at, late, rating }]
export function dayItems(doc, checkins, day) {
  const off = offsetOf(doc.tz, day)
  return doc.habits
    .filter((h) => !h.archived && h.days.includes(dowOf(day)) && !(isDay(h.since) && day < h.since))
    .sort((a, b) => startMin(a) - startMin(b))
    .map((h) => {
      const [s, e] = spanOf(h)
      const any = h.when.kind === 'any'
      const kept = keptOn(checkins, h.id, day)
      const r = routine(h)
      return {
        id: h.id,
        kind: 'habit',
        title: h.name,
        icon: h.icon,
        identity: h.identity || null,
        start: any ? `${day}T00:00:00${off}` : isoAt(day, s, off),
        end: any ? null : isoAt(day, e, off),
        all_day: any,
        window: h.when.kind === 'window',
        minutes: r.minutes,
        repeat: r.repeat,
        days: r.days,
        done: Boolean(kept),
        done_at: kept ? new Date(kept.doneAt).toISOString() : null,
        late: kept ? kept.late : null,
        rating: kept?.rating ?? null,
      }
    })
}

// Every habit (archived ones too, said so) with how the last `n` days went (today not counted until it's kept):
//   checkins: from today - n on; done: { habitId: Set(days kept) } over the streak window (for the streak)
//   -> [{ id, title, icon, identity, archived, since, when, minutes, repeat, days, remind, streak, at_risk,
//         last: { days, due, kept, on_time, late, missed, ratings: { hard, okay, great } } }]
export function routines(doc, checkins, done, today, n = DEFAULT_DAYS) {
  return doc.habits.map((h) => {
    const last = { days: n, due: 0, kept: 0, on_time: 0, late: 0, missed: 0, ratings: { hard: 0, okay: 0, great: 0 } }
    for (let i = 0; i < n; i++) {
      const day = addDays(today, -i)
      if (isDay(h.since) && day < h.since) break
      const kept = keptOn(checkins, h.id, day)
      const due = h.days.includes(dowOf(day))
      if (kept) {
        last.kept++
        last[kept.late ? 'late' : 'on_time']++
        if (kept.rating in last.ratings) last.ratings[kept.rating]++
      }
      // today still open isn't a miss
      if (due && (day !== today || kept)) last.due++
      if (due && !kept && day !== today) last.missed++
    }
    const s = h.archived ? null : streakOf(h, done[h.id] ?? new Set(), today)
    return {
      id: h.id,
      title: h.name,
      icon: h.icon,
      identity: h.identity || null,
      archived: Boolean(h.archived),
      since: h.since ?? null,
      ...routine(h),
      remind: h.remind !== false,
      streak: s?.count ?? 0,
      at_risk: s?.atRisk ?? false,
      last,
    }
  })
}

// ?date= -> the day, or { error }. Empty: today
export function dayParam(v, today) {
  if (v == null || v === '') return { day: today }
  if (!isDay(v)) return { error: 'date: YYYY-MM-DD' }
  if (Math.abs(daysBetween(today, v)) > MAX_AHEAD) return { error: `date: within ${MAX_AHEAD} days of today` }
  return { day: v }
}
// ?days= -> how many days back routines' stats look, or { error }
export function daysParam(v) {
  if (v == null || v === '') return { n: DEFAULT_DAYS }
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) return { error: `days: 1 to ${MAX_DAYS}` }
  return { n }
}
