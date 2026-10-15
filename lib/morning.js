// The daily summaries: pure rules for the three notices that go out at 06:00, 13:00 and 18:00 (the owner's zone: the
// Habits doc's); the 06:00 one in place of Reminders' reminders-only notice. Shared by their sender
// (lib/morning-summary.js, server-only) and the owner's switch (app/api/private/settings/morning). No React, no
// database, no network, so node:test checks all of it.
//
// Each is a phone notification first: a title and a few short lines, each one there only when it has something to say.
//   Good morning · Thu 15 Oct
//   29° now · 24–33° · rain from 15:00          the weather at the owner's synced location (lib/weather.js's upstream)
//   2 reminders: renew the domain · call mum    the ones open at 06:00 (lib/reminders.js openAtSix), the first few
//   4 routines today · first: Workout 06:15     the Habits due today (lib/habits.js dueOn)
//   All servers up                              the Server card's other machines (lib/host.js agentStats)
// 13:00 (Good afternoon) and 18:00 (Good evening) look ahead from there: the weather from now to midnight (18:00 adds
// tomorrow's), every reminder still open, and the routines left today (the check-ins so far: '2 routines left · 1
// done · next: Piano 19:00'). Weather away, nothing open, no habits, no host agents: that line is left out; the summary
// still goes (all three, every day, while it's on). Off (Settings › Notifications › Daily summaries): none of them;
// only Reminders' own 06:00 notice, as before (lib/reminders-nudge.js), when something is open.
import { GRACE_MIN, dowOf, dueOn, isDay, spanOf, toMin } from './habits.js'
import { NUDGE_AT, NUDGE_LATE, SHOW_MAX } from './reminders.js'

export const MORNING_AT = NUDGE_AT // 06:00, the same minute the reminders' pop-up starts
export const MORNING_LATE = NUDGE_LATE // a server down at its time still sends a summary until half past, not later
export const RAIN_CHANCE = 50 // % in an hour (or tomorrow): rain is likely enough to say so
export const TEXT_MAX = 40 // a reminder's text in the summary's line (the full one is on the card)

// the three a day: id (its key and tag: '<id>:<day>'), its minute, its greeting and inbox icon
export const SLOTS = [
  { id: 'morning', at: MORNING_AT, hello: 'Good morning', icon: 'fa-solid fa-mug-hot' },
  { id: 'afternoon', at: 13 * 60, hello: 'Good afternoon', icon: 'fa-solid fa-sun' },
  { id: 'evening', at: 18 * 60, hello: 'Good evening', icon: 'fa-solid fa-moon' },
]
export const MORNING = SLOTS[0]
// the summary due now (its first half hour) -> its slot | null
export const slotOf = (now) => SLOTS.find((s) => now.min >= s.at && now.min < s.at + MORNING_LATE) ?? null
// the summary now? -> its key (claimed once ever in the database) | null. Each slot's half hour only, every day
export const summaryKey = (now) => {
  const s = slotOf(now)
  return s ? summaryTag(s, now.day) : null
}
export const summaryTag = (slot, day) => `${slot.id}:${day}`

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// '2026-10-15' -> 'Good morning · Thu 15 Oct' (the slot's greeting)
export function summaryTitle(day, slot = MORNING) {
  if (!isDay(day)) return slot.hello
  const [, m, d] = day.split('-').map(Number)
  return `${slot.hello} · ${WEEKDAYS[dowOf(day) - 1]} ${d} ${MONTHS[m - 1]}`
}

const deg = (c, unit) => (Number.isFinite(c) ? `${unit === 'F' ? Math.round((c * 9) / 5 + 32) : Math.round(c)}°` : null)
// what falls in an hour, by its WMO code (lib/weather.js wmo): storms, snow, else rain (drizzle and showers too)
const fallWord = (code) => (code >= 95 ? 'storms' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : 'rain')

// The weather API's /weather data (lib/upstream.js: current, hourly, daily, in the location's own time) -> one line,
// or null when there's nothing to go on. Now (the station's report near Ho Chi Minh City), today's low–high, and the
// first hour from now to midnight with something falling (its code) or a likely chance of it (RAIN_CHANCE).
export function weatherLine(w, unit = 'C') {
  const c = w?.current
  const now = deg(c?.temperature_2m, unit)
  if (!now || typeof c.time !== 'string') return null
  const today = c.time.slice(0, 10)
  const parts = [`${now} now`]
  const d = w.daily ?? {}
  const di = d.time?.indexOf(today) ?? -1
  const lo = deg(d.temperature_2m_min?.[di], unit), hi = deg(d.temperature_2m_max?.[di], unit)
  if (di >= 0 && lo && hi) parts.push(`${lo.slice(0, -1)}–${hi}`)
  const h = w.hourly ?? {}
  const start = h.time?.indexOf(`${c.time.slice(0, 13)}:00`) ?? -1
  if (start >= 0) {
    let wet = null
    for (let i = start; i < h.time.length && h.time[i].startsWith(today); i++) {
      const code = h.weather_code?.[i]
      if (code >= 51 || h.precipitation_probability?.[i] >= RAIN_CHANCE) {
        wet = { t: h.time[i].slice(11, 16), word: fallWord(code), now: i === start }
        break
      }
    }
    // (raining now by the station's report counts as now, whatever the model says about this hour)
    if (c.weather_code >= 51) wet = { word: fallWord(c.weather_code), now: true }
    parts.push(!wet ? 'no rain' : wet.now ? `${wet.word} now` : `${wet.word} from ${wet.t}`)
  }
  return parts.join(' · ')
}

// The evening's look at tomorrow (the same /weather data, its daily rows) -> 'Tomorrow 23–31° · rain likely' |
// 'Tomorrow 23–31° · storms likely' | 'Tomorrow 23–31° · dry' (the chance under RAIN_CHANCE) | null (no row for it)
export function tomorrowLine(w, unit = 'C') {
  const today = typeof w?.current?.time === 'string' ? w.current.time.slice(0, 10) : null
  const d = w?.daily
  const i = today && Array.isArray(d?.time) ? d.time.findIndex((t) => t > today) : -1
  if (i < 0) return null
  const lo = deg(d.temperature_2m_min?.[i], unit), hi = deg(d.temperature_2m_max?.[i], unit)
  if (!lo || !hi) return null
  const code = d.weather_code?.[i], chance = d.precipitation_probability_max?.[i]
  const wet = chance >= RAIN_CHANCE || (!Number.isFinite(chance) && code >= 51)
  return `Tomorrow ${lo.slice(0, -1)}–${hi} · ${wet ? `${code >= 51 ? fallWord(code) : 'rain'} likely` : 'dry'}`
}

// cut at a word where there is one (a word cut in half reads as a typo)
function short(s) {
  if (s.length <= TEXT_MAX) return s
  const cut = s.slice(0, TEXT_MAX - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > TEXT_MAX / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`
}
// the reminders open at 06:00 (oldest first) -> '2 reminders: renew the domain · call mum' (+N more) | null
export function remindersLine(items) {
  const n = items?.length ?? 0
  if (!n) return null
  const names = items.slice(0, SHOW_MAX).map((i) => short(i.text))
  return `${n} reminder${n === 1 ? '' : 's'}: ${names.join(' · ')}${n > SHOW_MAX ? ` +${n - SHOW_MAX} more` : ''}`
}

// the Habits doc ({ tz, habits }) -> the routines due today: '4 routines today · first: Workout 06:15' | null (no
// doc, none today). "First": the earliest with a time or a window that hasn't ended yet (any-time ones have none).
// Later in the day (done: the ids of the habits checked in today, a Set) it's what's left: '2 routines left · 1 done ·
// next: Piano 19:00'; left = not checked in and not over (its end, plus the grace a late check-in still gets; "next" is
// one still ahead); none left: 'All 3 routines done today' | '2 of 3 routines done today' (the rest missed)
export function routinesLine(doc, now, done = null) {
  const due = (doc?.habits ?? []).filter((h) => dueOn(h, now.day) && !(isDay(h.since) && now.day < h.since))
  if (!due.length) return null
  const plural = (n) => `routine${n === 1 ? '' : 's'}`
  const next = (list) => {
    const first = list.filter((h) => h.when?.kind !== 'any' && spanOf(h)[1] > now.min).sort((a, b) => spanOf(a)[0] - spanOf(b)[0])[0]
    const at = first && (first.when.kind === 'time' ? first.when.at : first.when.from)
    return first && toMin(at) != null ? `${first.name} ${at}` : null
  }
  if (!done) {
    const first = next(due)
    const head = `${due.length} ${plural(due.length)} today`
    return first ? `${head} · first: ${first}` : head
  }
  const kept = due.filter((h) => done.has(h.id)).length
  const left = due.filter((h) => !done.has(h.id) && spanOf(h)[1] + GRACE_MIN > now.min)
  if (!left.length) return kept < due.length ? `${kept} of ${due.length} ${plural(due.length)} done today` : due.length === 1 ? '1 routine done today' : `All ${due.length} routines done today`
  const after = next(left)
  return [`${left.length} ${plural(left.length)} left`, kept ? `${kept} done` : null, after ? `next: ${after}` : null].filter(Boolean).join(' · ')
}

// the Server card's other machines ([{ name, stats }], stats null = not answering: lib/host.js agentStats) -> 'All
// servers up' | 'razer down' | 'razer, nas down' | null (none set up: this one is up, it's the one sending)
export function serversLine(hosts) {
  if (!Array.isArray(hosts) || !hosts.length) return null
  const down = hosts.filter((h) => !h?.stats).map((h) => h?.name ?? '?')
  return down.length ? `${down.join(', ')} down` : 'All servers up'
}

// The notice (lib/notify.js cleanNotice's input). Each line is a string or null (left out). It's that slot's of that
// day (tag): a second one (the reminders line put right) replaces it, and it goes when the next one comes (ttl; the
// evening's at midnight), so the inbox holds the latest only
export function morningNotice({ slot = MORNING, now, weather = null, tomorrow = null, reminders = null, routines = null, servers = null }) {
  const lines = [weather, tomorrow, reminders, routines, servers].filter(Boolean)
  const until = SLOTS[SLOTS.indexOf(slot) + 1]?.at ?? 1440
  return {
    title: summaryTitle(now.day, slot),
    body: lines.length ? lines.join('\n') : slot === MORNING ? 'Nothing on the list today.' : 'Nothing left on the list today.',
    source: 'Summary',
    icon: slot.icon,
    color: 'highlight',
    tag: summaryTag(slot, now.day),
    ttl: Math.max(600, (until - now.min) * 60),
  }
}

// the switch's PUT body -> { morning } | { error, field }
export function cleanPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  if (typeof raw.morning !== 'boolean') return { error: 'morning: true or false', field: 'morning' }
  return { morning: raw.morning }
}
