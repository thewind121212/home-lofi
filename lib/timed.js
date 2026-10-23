// Timed reminders: the ones with a time ("7pm call mom", "every day 9pm take the pills"). They live in the owner's
// reminders API on the Razer (REMIND_URL, lib/timed-fetch.js: a small model reads the sentence, SQLite keeps them);
// this server is the only one that talks to it (LAN only, no auth there: never the browser). The ones without a time
// stay in Reminders' own carry-over list (lib/reminders.js): one box adds to either, by whether the sentence has a time.
// Pure rules: what the API's answers may contain, the groups and time labels the sheet shows, and the due notice.
// No React, no database, no network.

export const ZONE = 'Asia/Ho_Chi_Minh' // the API's zone: every time it sends and reads is +07:00
const OFFSET = '+07:00'
const OFFSET_MS = 7 * 3600_000 // (no daylight saving there)
export const REPEATS = ['none', 'daily', 'weekly', 'monthly']
export const SNOOZE_MIN = 10
export const MAX_TITLE = 140
export const HISTORY = 50

const CTRL = /[\u0000-\u001f\u007f]/g
const line = (s) => String(s).replace(CTRL, ' ').replace(/\s+/g, ' ').trim()
const ms = (v) => {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

// One reminder as the API sends it -> what the page gets, or null. Whatever it sends is checked: known fields only,
// the title one line and cut, times as epoch ms.
//   { id, title, due (ms | null), allDay, repeat, status ('open' | 'done'), doneAt, snoozed (ms | null), created }
export function cleanTimed(r) {
  if (!r || typeof r !== 'object') return null
  if (!Number.isSafeInteger(r.id) || r.id <= 0) return null
  const title = typeof r.title === 'string' ? line(r.title).slice(0, MAX_TITLE) : ''
  if (!title) return null
  const status = r.status === 'done' ? 'done' : r.status === 'open' ? 'open' : null
  if (!status) return null
  return {
    id: r.id,
    title,
    due: ms(r.due_at),
    allDay: r.all_day === true,
    repeat: REPEATS.includes(r.repeat) ? r.repeat : 'none',
    status,
    doneAt: ms(r.done_at),
    snoozed: ms(r.snoozed_until),
    created: ms(r.created_at),
  }
}
export const cleanList = (list) => (Array.isArray(list) ? list.map(cleanTimed).filter(Boolean) : [])

// when it rings: the snooze if there is one, else its time
export const ringAt = (i) => i?.snoozed ?? i?.due ?? null
export const isDue = (i, now) => i?.status === 'open' && ringAt(i) != null && ringAt(i) <= now

// the calendar day of a moment in the API's zone: 'YYYY-MM-DD'
export const dayOf = (t) => new Date(t + OFFSET_MS).toISOString().slice(0, 10)
const hhmm = (t) => new Date(t + OFFSET_MS).toISOString().slice(11, 16)
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)

// The sheet's groups (open ones): due now, later today, coming up (by time), no time
export function groupsOf(items, now) {
  const today = dayOf(now)
  const out = { due: [], today: [], soon: [], none: [] }
  for (const i of items) {
    if (i.status !== 'open') continue
    const at = ringAt(i)
    if (at == null) out.none.push(i)
    else if (at <= now) out.due.push(i)
    else if (dayOf(at) === today) out.today.push(i)
    else out.soon.push(i)
  }
  const byTime = (a, b) => ringAt(a) - ringAt(b) || a.id - b.id
  out.due.sort(byTime)
  out.today.sort(byTime)
  out.soon.sort(byTime)
  return out
}

// A time as the sheet says it: '19:00 today', 'tomorrow 08:00', 'yesterday 19:00', 'Fri 31/10 19:00'; a whole-day one
// without the hour ('today', 'Wed 5/11')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function whenLabel(t, allDay, now) {
  if (t == null) return 'no time'
  const day = dayOf(t)
  const today = dayOf(now)
  const time = allDay ? '' : hhmm(t)
  if (day === today) return allDay ? 'today' : `${time} today`
  if (day === addDays(today, 1)) return allDay ? 'tomorrow' : `tomorrow ${time}`
  if (day === addDays(today, -1)) return allDay ? 'yesterday' : `yesterday ${time}`
  const d = new Date(`${day}T00:00:00Z`)
  const date = `${WD[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`
  return allDay ? date : `${date} ${time}`
}
export const REPEAT_LABEL = { none: '', daily: 'every day', weekly: 'every week', monthly: 'every month' }

// ---- what the page sends (app/api/private/settings/reminders/timed) ----

const ID = (v) => Number.isSafeInteger(v) && v > 0
// the edit form's time: 'YYYY-MM-DD' (a whole day) or 'YYYY-MM-DDTHH:MM', read in the API's zone -> its ISO, or null
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/
export function isoOf(v) {
  const m = typeof v === 'string' ? LOCAL.exec(v) : null
  if (!m) return null
  const [, y, mo, d, h = '08', mi = '00'] = m // (a whole day is 08:00 that day, as the API keeps it)
  const iso = `${y}-${mo}-${d}T${h}:${mi}:00${OFFSET}`
  const t = Date.parse(iso)
  return Number.isFinite(t) && dayOf(t) === `${y}-${mo}-${d}` && Number(h) < 24 && Number(mi) < 60 ? iso : null
}
// epoch ms -> the edit form's value in the API's zone
export const localOf = (t, allDay) => (t == null ? '' : allDay ? dayOf(t) : `${dayOf(t)}T${hhmm(t)}`)

// a POST -> { act } | { error, field }
//   { action: 'add', text, plain? }  a sentence: with a time -> the API, without -> the carry-over list (plain: straight there)
//   { action: 'done' | 'reopen' | 'delete', id }
//   { action: 'snooze', id, minutes? }  (SNOOZE_MIN by default, 1 to 10080)
//   { action: 'edit', id, title?, when? ('YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM' | null = no time), repeat? }
export function cleanTimedAction(raw, maxText = MAX_TITLE) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  const { action } = raw
  const bad = (field, error) => ({ error: `${field}: ${error}`, field })
  if (action === 'add') {
    const text = typeof raw.text === 'string' ? line(raw.text) : ''
    if (!text) return bad('text', 'say what to remember')
    if (text.length > maxText) return bad('text', `at most ${maxText} characters`)
    return { act: { action, text, plain: raw.plain === true } }
  }
  if (!['done', 'reopen', 'delete', 'snooze', 'edit'].includes(action)) return bad('action', 'one of add, done, reopen, delete, snooze, edit')
  if (!ID(raw.id)) return bad('id', 'a reminder id')
  const act = { action, id: raw.id }
  if (action === 'snooze') {
    const m = raw.minutes ?? SNOOZE_MIN
    if (!Number.isInteger(m) || m < 1 || m > 10080) return bad('minutes', '1 to 10080')
    act.minutes = m
  }
  if (action === 'edit') {
    const patch = {}
    if (raw.title !== undefined) {
      const t = typeof raw.title === 'string' ? line(raw.title) : ''
      if (!t) return bad('title', 'say what to remember')
      if (t.length > maxText) return bad('title', `at most ${maxText} characters`)
      patch.title = t
    }
    if (raw.when !== undefined) {
      if (raw.when === null) Object.assign(patch, { due_at: null, all_day: false })
      else {
        const iso = isoOf(raw.when)
        if (!iso) return bad('when', 'a date (YYYY-MM-DD) or a date and time (YYYY-MM-DDTHH:MM)')
        Object.assign(patch, { due_at: iso, all_day: !raw.when.includes('T') })
      }
    }
    if (raw.repeat !== undefined) {
      if (!REPEATS.includes(raw.repeat)) return bad('repeat', REPEATS.join(', '))
      patch.repeat = raw.repeat
    }
    if (!Object.keys(patch).length) return bad('edit', 'nothing to change')
    act.patch = patch
  }
  return { act }
}

// What the model read (POST /api/parse) -> { title, due_at, all_day, repeat } to save, or null: no time in it (the
// carry-over list takes the sentence as typed: the model's title is Vietnamese even for an English line)
export function parsedTime(p) {
  if (!p || typeof p !== 'object' || ms(p.due_at) == null) return null
  const title = typeof p.title === 'string' ? line(p.title).slice(0, MAX_TITLE) : ''
  if (!title) return null
  return { title, due_at: p.due_at, all_day: p.all_day === true, repeat: REPEATS.includes(p.repeat) ? p.repeat : 'none' }
}

// ---- the due notice (lib/timed-ticker.js): once per time it rings ----

// claimed once ever (lib/reminders-store.js claimNudge): the same reminder rings again after a snooze or, repeating,
// at its next time, each a new key
export const dueKey = (i) => `due:${i.id}:${ringAt(i)}`
export const dueTag = (id) => `remind:${id}`
export function dueNotice(i, now) {
  const when = whenLabel(ringAt(i), i.allDay && !i.snoozed, now)
  const rep = REPEAT_LABEL[i.repeat]
  return {
    title: i.title,
    body: `${i.snoozed ? 'Snoozed, now' : 'Due'} ${when}${rep ? ` · repeats ${rep}` : ''}\nDone or snooze it under Reminders.`,
    level: 'warning',
    source: 'Reminders',
    icon: 'fa-solid fa-bell',
    color: 'highlight',
    tag: dueTag(i.id),
    ttl: 86400,
  }
}
