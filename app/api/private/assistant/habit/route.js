import { randomBytes } from 'node:crypto'
import { assistantOk, assistantWrite } from '../../../../../lib/gate.js'
import { liveBus } from '../../../../../lib/live.js'
import { habitOf, plainField, readJson } from '../../../../../lib/assistant.js'
import { DEFAULT_TZ, MAX_HABITS, cleanDoc, localNow } from '../../../../../lib/habits.js'
import { habitsStore } from '../../../../../lib/habits-store.js'

// The owner's assistant adds a habit (a routine) to the Habits card, checked like the card's editor (lib/habits.js
// cleanHabit). Add only: changing or archiving one stays on the card. From the LAN, no login (lib/gate.js assistantOk).
//   POST { name, when: { kind: 'time', at: 'HH:MM' } | { kind: 'window', from, to } | { kind: 'any' }, days: [1..7] |
//          ['Mon', …] | 'daily' | 'weekdays' | 'weekends', minutes? (1–600), identity? ("I show up at 6:15."),
//          icon? (lib/habits.js ICONS), remind? (default true) }
//   -> 201 { habit } (with its id and first day); the owner's open pages pull
// 404 = not through the proxy's /api/private location (or off), 403 = a browser on another site, 400 = a bad habit
// ({ error, field }), 409 = MAX_HABITS already, 503 = the database.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const mkId = () => randomBytes(6).toString('hex')

export async function POST(request) {
  if (!assistantOk(request)) return json({ error: 'not found' }, 404)
  if (!assistantWrite(request)) return json({ error: 'forbidden: send JSON (content-type: application/json)' }, 403)
  const b = await readJson(request)
  if (b.error) return json({ error: b.error }, b.status)
  const who = process.env.OWNER_USER
  try {
    // checked against the stored list with its row locked, like the card's saves
    const c = await habitsStore().updateDoc(who, (stored) => {
      const old = stored ?? { tz: DEFAULT_TZ, habits: [] }
      if (old.habits.length >= MAX_HABITS) return { error: `at most ${MAX_HABITS} habits: archive one on the card first`, field: null, full: true }
      return cleanDoc({ tz: old.tz, habits: [...old.habits, habitOf(b.value)] }, { old, today: localNow(Date.now(), old.tz).day, mkId })
    })
    if (c.error) return json({ error: plainField(c.error), field: plainField(c.field) }, c.full ? 409 : 400)
    liveBus().publish(who, { kind: 'habits', at: Date.now() })
    return json({ habit: c.doc.habits.at(-1) }, 201)
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
