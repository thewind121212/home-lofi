// The owner's assistant on the LAN (Jade, the voice assistant on the Razer): what its writes may contain
// (app/api/private/assistant/*). Who gets in is lib/gate.js assistantOk / assistantWrite. Pure: node:test checks it.
export const MAX_BODY = 4096
export const MUSIC = ['play', 'pause', 'toggle', 'next'] // what the page showing does (app/page.js): its music card's ⏯ / ⏭
const WEEKDAYS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }
const SETS = { daily: [1, 2, 3, 4, 5, 6, 7], weekdays: [1, 2, 3, 4, 5], weekends: [6, 7] }

// a request's JSON body -> { value } | { status, error }
export async function readJson(request) {
  const text = await request.text()
  if (text.length > MAX_BODY) return { status: 413, error: 'too large' }
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 400, error: 'the body must be a JSON object' }
    return { value }
  } catch {
    return { status: 400, error: 'not JSON' }
  }
}

// days as the assistant may say them: [1..7] (Mon 1), ['Mon', 'Wed'], or 'daily' / 'weekdays' / 'weekends' -> the
// numbers, or the value as it was (lib/habits.js cleanHabit then says what's wrong)
export function daysOf(v) {
  if (typeof v === 'string' && SETS[v.toLowerCase()]) return SETS[v.toLowerCase()]
  if (!Array.isArray(v)) return v
  return v.map((d) => (typeof d === 'string' ? (WEEKDAYS[d.slice(0, 3).toLowerCase()] ?? d) : d))
}
// a new habit as the assistant sends it -> the editor's shape (lib/habits.js cleanHabit checks it): only these fields,
// never an id (it's new)
export function habitOf(raw) {
  const { name, icon, when, minutes, days, identity, remind } = raw
  return { name, icon, when, minutes, days: daysOf(days), identity, remind }
}
// cleanDoc's field names are the editor's ("habits[3].when.at"): the assistant sent one habit
export const plainField = (s) => (typeof s === 'string' ? s.replace(/^habits\[\d+\]\.?/, '') : s)
