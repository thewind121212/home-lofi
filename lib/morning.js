// The morning summary: pure rules for the one notice that goes out at 06:00 (the owner's zone: the Habits doc's) in
// place of Reminders' reminders-only notice. Shared by its sender (lib/morning-summary.js, server-only) and the
// owner's switch (app/api/private/settings/morning). No React, no database, no network, so node:test checks all of it.
//
// It's a phone notification first: a title and a few short lines, each one there only when it has something to say.
//   Good morning · Thu 15 Oct
//   29° now · 24–33° · rain from 15:00          the weather at the owner's synced location (lib/weather.js's upstream)
//   2 reminders: renew the domain · call mum    the ones open at 06:00 (lib/reminders.js openAtSix), the first few
//   4 routines today · first: Workout 06:15     the Habits due today (lib/habits.js dueOn)
//   All servers up                              the Server card's other machines (lib/host.js agentStats)
// Weather away, nothing open, no habits, no host agents: that line is left out; the summary still goes (every
// morning, while it's on). Off (Settings › Notifications › Morning summary): Reminders' own 06:00 notice instead, as
// before (lib/reminders-nudge.js), only when something is open.
import { dowOf, dueOn, isDay, spanOf, toMin } from './habits.js'
import { NUDGE_AT, NUDGE_LATE, SHOW_MAX } from './reminders.js'

export const MORNING_AT = NUDGE_AT // 06:00, the same minute the reminders' pop-up starts
export const MORNING_LATE = NUDGE_LATE // a server down at 06:00 still sends it until 06:30, not later
export const RAIN_CHANCE = 50 // % in an hour: rain is likely enough to say so
export const TEXT_MAX = 40 // a reminder's text in the summary's line (the full one is on the card)

// the summary now? -> its key (claimed once ever in the database) | null. 06:00–06:29 only, every day
export const morningKey = (now) => (now.min >= MORNING_AT && now.min < MORNING_AT + MORNING_LATE ? `morning:${now.day}` : null)
export const morningTag = (day) => `morning:${day}`

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// '2026-10-15' -> 'Good morning · Thu 15 Oct'
export function morningTitle(day) {
  if (!isDay(day)) return 'Good morning'
  const [, m, d] = day.split('-').map(Number)
  return `Good morning · ${WEEKDAYS[dowOf(day) - 1]} ${d} ${MONTHS[m - 1]}`
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
// doc, none today). "First": the earliest with a time or a window that hasn't ended yet (any-time ones have none)
export function routinesLine(doc, now) {
  const due = (doc?.habits ?? []).filter((h) => dueOn(h, now.day) && !(isDay(h.since) && now.day < h.since))
  if (!due.length) return null
  const timed = due
    .filter((h) => h.when?.kind !== 'any' && spanOf(h)[1] > now.min)
    .sort((a, b) => spanOf(a)[0] - spanOf(b)[0])
  const first = timed[0]
  const at = first && (first.when.kind === 'time' ? first.when.at : first.when.from)
  const head = `${due.length} routine${due.length === 1 ? '' : 's'} today`
  return first && toMin(at) != null ? `${head} · first: ${first.name} ${at}` : head
}

// the Server card's other machines ([{ name, stats }], stats null = not answering: lib/host.js agentStats) -> 'All
// servers up' | 'razer down' | 'razer, nas down' | null (none set up: this one is up, it's the one sending)
export function serversLine(hosts) {
  if (!Array.isArray(hosts) || !hosts.length) return null
  const down = hosts.filter((h) => !h?.stats).map((h) => h?.name ?? '?')
  return down.length ? `${down.join(', ')} down` : 'All servers up'
}

// The notice (lib/notify.js cleanNotice's input). Each line is a string or null (left out). It's today's (tag): a
// second one the same day (the reminders line put right) replaces it, and it goes at midnight (ttl)
export function morningNotice({ now, weather = null, reminders = null, routines = null, servers = null }) {
  const lines = [weather, reminders, routines, servers].filter(Boolean)
  return {
    title: morningTitle(now.day),
    body: lines.length ? lines.join('\n') : 'Nothing on the list today.',
    source: 'Morning',
    icon: 'fa-solid fa-mug-hot',
    color: 'highlight',
    tag: morningTag(now.day),
    ttl: Math.max(600, (1440 - now.min) * 60),
  }
}

// the switch's PUT body -> { morning } | { error, field }
export function cleanPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  if (typeof raw.morning !== 'boolean') return { error: 'morning: true or false', field: 'morning' }
  return { morning: raw.morning }
}
