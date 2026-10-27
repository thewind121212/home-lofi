import { assistantOk, assistantWrite } from '../../../../../lib/gate.js'
import { liveBus } from '../../../../../lib/live.js'
import { readJson } from '../../../../../lib/assistant.js'
import { MAX_TEXT } from '../../../../../lib/reminders.js'
import { addSentence } from '../../../../../lib/remind-add.js'
import { cleanTimedAction } from '../../../../../lib/timed.js'

// The owner's assistant adds a reminder, the way the Reminders box does (lib/remind-add.js): the model reads the
// sentence; with a time it rings then (on the page and the owner's phone), without one it goes on the carry-over list
// as typed. From the LAN, no login (lib/gate.js assistantOk).
//   POST { text, plain? }   (plain: true = no time, straight onto the list)
//   -> 201 { added: { kind: 'timed' | 'todo', title, due? (ms), allDay?, repeat? } }; the owner's open pages pull
// 404 = not through the proxy's /api/private location (or off), 403 = a browser on another site, 400 = a bad body,
// 409 = the list is full, 502 = the reminders API is down, 503 = the model couldn't read it ({ plain: true }: send it
// again with plain) or the database is down.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })

export async function POST(request) {
  if (!assistantOk(request)) return json({ error: 'not found' }, 404)
  if (!assistantWrite(request)) return json({ error: 'forbidden: send JSON (content-type: application/json)' }, 403)
  const b = await readJson(request)
  if (b.error) return json({ error: b.error }, b.status)
  const c = cleanTimedAction({ action: 'add', text: b.value.text, plain: b.value.plain }, MAX_TEXT)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  const who = process.env.OWNER_USER
  const r = await addSentence(who, c.act.text, c.act.plain)
  if (r.error) return json({ error: r.error, ...(r.plain && { plain: true }) }, r.status)
  liveBus().publish(who, { kind: 'reminders', at: Date.now() })
  return json({ added: r.added }, 201)
}
