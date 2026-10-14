// Reminders: pure rules shared by the owner's route (app/api/private/settings/reminders), its store
// (lib/reminders-store.js), the 06:00 nudge (lib/reminders-nudge.js) and the card / pop-up (app/reminders.js). No
// React, no database, so node:test checks all of it.
//
// A reminder is a short line the owner wants to get done ("renew the domain"). It carries over from day to day until
// it's confirmed done (held, not tapped): then it leaves the list. From 06:00 each day (the owner's time zone: the
// Habits doc's, lib/habits.js) the open ones pop up over the dashboard and won't go away until each is done, and one
// notice goes out at 06:00 if any are open. Nothing open: no pop-up, no notice. Every time is the server's.
import { DEFAULT_TZ, daysBetween, isDay, localNow, validTz } from './habits.js'

export const MAX_TEXT = 140
export const MAX_OPEN = 50 // open at once (done ones don't count)
export const NUDGE_AT = 6 * 60 // 06:00: the pop-up from then on, and the morning notice
export const NUDGE_LATE = 30 // a server that was down at 06:00 still sends the notice until 06:30, not later
export const UNDO_MS = 10_000 // right after "done" it can just be undone (back on the list as it was)
export const UNDO_SLACK = 5_000 // the server's allowance for the trip there
export const SHOW_MAX = 3 // the notice lists this many, then "+N more"

const CTRL = /[\u0000-\u001f\u007f]/g
const ID = /^[a-z0-9]{6,24}$/

// the zone the days are counted in: the Habits doc's (one zone for the owner's whole day), else Ho Chi Minh City
export const zoneOf = (habitsDoc) => (validTz(habitsDoc?.tz) ? habitsDoc.tz : DEFAULT_TZ)

// the text the owner typed -> { text } | { error, field }: one line, spaces collapsed, 1–MAX_TEXT characters
export function cleanText(v) {
  if (typeof v !== 'string') return { error: 'text: a line of text', field: 'text' }
  const text = v.replace(CTRL, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return { error: 'text: say what to remember', field: 'text' }
  if (text.length > MAX_TEXT) return { error: `text: at most ${MAX_TEXT} characters`, field: 'text' }
  return { text }
}

// a POST from the card / pop-up -> { act } | { error, field }
// { action: 'add', text } | { action: 'done', id } | { action: 'undo', id }
export function cleanAction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  const { action } = raw
  if (!['add', 'done', 'undo'].includes(action)) return { error: 'action: one of add, done, undo', field: 'action' }
  if (action === 'add') {
    const t = cleanText(raw.text)
    return t.error ? t : { act: { action, text: t.text } }
  }
  return cleanId(raw.id) ? { act: { action, id: raw.id } } : { error: 'id: a reminder id', field: 'id' }
}
export const cleanId = (id) => typeof id === 'string' && ID.test(id)

// the pop-up's hours: from 06:00 to midnight (the server's clock in the owner's zone decides; the page only asks)
export const popupDue = (now) => now.min >= NUDGE_AT
// the morning notice now? -> its key (claimed once ever in the database) | null. Only with something open, only
// 06:00–06:29: a server down all morning sends nothing that day (the pop-up is there anyway)
export const nudgeKey = (now, open) => (open > 0 && now.min >= NUDGE_AT && now.min < NUDGE_AT + NUDGE_LATE ? `todo:${now.day}` : null)
export const nudgeTag = (day) => `todo:${day}`
// what the morning notice is about: the ones already open at 06:00 that day (carried over, or added before 06:01). One
// added at 06:10 to an empty list is the owner at the screen, not something to be woken up about: it doesn't send it
export const openAtSix = (items, now, tz) =>
  items.filter((i) => isDay(i.day) && (i.day < now.day || (i.day === now.day && Number.isFinite(i.at) && localNow(i.at, tz).min <= NUDGE_AT)))

// how many days a reminder has been carried (0: added today)
export const carried = (item, today) => (isDay(item?.day) && isDay(today) ? Math.max(0, daysBetween(item.day, today)) : 0)

// the notice (lib/notify.js cleanNotice's input): how many, the first few, the oldest's age. It's today's (tag), and
// it goes at midnight (ttl): tomorrow brings its own if anything is still open
export function nudgeNotice(items, now) {
  const n = items.length
  const lines = items.slice(0, SHOW_MAX).map((i) => `• ${i.text}`)
  if (n > SHOW_MAX) lines.push(`+${n - SHOW_MAX} more`)
  const oldest = Math.max(0, ...items.map((i) => carried(i, now.day)))
  lines.push(oldest > 0 ? `Carried for ${oldest} day${oldest === 1 ? '' : 's'}. Hold each one when it's done.` : "Hold each one when it's done.")
  return {
    title: `${n} reminder${n === 1 ? '' : 's'} today`,
    body: lines.join('\n'),
    source: 'Reminders',
    icon: 'fa-solid fa-list-check',
    color: 'highlight',
    tag: nudgeTag(now.day),
    ttl: Math.max(600, (1440 - now.min) * 60),
  }
}

// the undo right after "done"
export const canUndo = (doneAt, nowMs) => Number.isFinite(doneAt) && nowMs - doneAt >= 0 && nowMs - doneAt <= UNDO_MS + UNDO_SLACK
