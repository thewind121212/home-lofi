import { notifyOn, sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { liveBus } from '../../../../../lib/live.js'
import { notifyStore } from '../../../../../lib/notify-store.js'

// The owner's notifications (app/notify.js), in the owner-only zone like the settings next door (lib/gate.js ownerOf):
// the proxy's /api/private/settings location covers this path, Authelia login included. Senders post to /api/notify.
//   GET                                   -> { items: the newest 50 still alive, newest first, read: last read id }
//   POST { action: 'read', upTo: id }     everything up to id is read (on all devices)
//        { action: 'dismiss', id }        that one is gone
//        { action: 'clear', upTo: id }    everything up to id is gone (one that arrived meanwhile stays)
//   -> the fresh { items, read }; the owner's other tabs hear 'notify' on the live stream and pull too.
// 404 = not set up (no gate, or the hub is off: lib/gate.js notifyOn; the page shows no bell then), 403 = someone
// else, 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const isId = (v) => Number.isSafeInteger(v) && v > 0
const owner = (request) => (notifyOn() ? syncOwner(request) : 404)

export async function GET(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no notifications' }, who)
  try {
    return json(await notifyStore().list(who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function POST(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no notifications' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const body = await request.json().catch(() => null)
  const { action } = body ?? {}
  const id = action === 'dismiss' ? body.id : body?.upTo
  if (!['read', 'dismiss', 'clear'].includes(action) || !isId(id)) return json({ error: 'bad request' }, 400)
  try {
    const store = notifyStore()
    if (action === 'read') await store.markRead(who, id)
    else if (action === 'dismiss') await store.dismiss(id)
    else await store.clear(id)
    const out = await store.list(who)
    liveBus().publish(who, { kind: 'notify', at: Date.now() })
    return json(out)
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
