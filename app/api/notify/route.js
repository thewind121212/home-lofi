import { notifyOn, senderOk } from '../../../lib/gate.js'
import { clientIp, windowLimit } from '../../../lib/limits.js'
import { liveBus } from '../../../lib/live.js'
import { MAX_BODY, cleanNotice } from '../../../lib/notify.js'
import { notifyStore } from '../../../lib/notify-store.js'
import { pushNotice } from '../../../lib/push.js'

// The notification hub's inbox for machines (lib/notify.js has the fields and rules, README "Notifications" the
// examples). A LAN script, n8n or a cron job POSTs one notice; it's stored and the owner's open tabs hear about it at
// once (the live stream, event 'notify'). Meant for the LAN: the external proxy blocks this path, and the token is
// the lock either way.
//   POST  Authorization: Bearer <NOTIFY_TOKEN>, Content-Type: application/json, { title, body?, level?, source?, icon?,
//         color?, url?, tag?, silent?, ttl? }
//   201 { id, at, warnings? }   400 { error, field }   401 bad token   404 hub not set up   413 / 415 / 429 / 503
// 60 a minute per IP, 300 a minute in all: a runaway loop can't bury the inbox (the store keeps the newest 200 anyway).
const HEADERS = { 'cache-control': 'no-store' }
const json = (body, status = 200, extra) => Response.json(body, { status, headers: { ...HEADERS, ...extra } })
const perIp = windowLimit(60, 60_000)
const total = windowLimit(300, 60_000)

export async function POST(request) {
  if (!notifyOn()) return json({ error: 'notifications are not set up' }, 404)
  if (!perIp(clientIp(request)) || !total('all')) return json({ error: 'too many notifications: try again in a minute' }, 429, { 'retry-after': '60' })
  if (!senderOk(request)) return json({ error: 'bad or missing token' }, 401, { 'www-authenticate': 'Bearer' })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'send JSON (Content-Type: application/json)' }, 415)
  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY) return json({ error: `too large: ${MAX_BODY} bytes at most` }, 413)
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return json({ error: 'invalid JSON', field: null }, 400)
  }
  const r = cleanNotice(raw)
  if (r.error) return json({ error: r.error, field: r.field }, 400)
  let saved
  try {
    saved = await notifyStore().add(r.notice)
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
  liveBus().publish(process.env.OWNER_USER, { kind: 'notify', at: saved.at })
  // and to the owner's phones (lib/push.js): in the background, so the sender doesn't wait on Apple / Google
  void pushNotice(process.env.OWNER_USER, r.notice)
  return json({ ...saved, ...(r.warnings.length && { warnings: r.warnings }) }, 201)
}
