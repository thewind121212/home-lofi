import { notifyOn, sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { cleanName, cleanSubscription } from '../../../../../lib/push.js'
import { pushStore } from '../../../../../lib/push-store.js'

// The owner's push devices (app/push.js), in the owner-only zone like the notifications next door (lib/gate.js
// ownerOf: the proxy's /api/private/settings location, Authelia login included). Push rides on the hub, so it's off
// (404) whenever the hub is (lib/gate.js notifyOn).
//   GET                                                   -> { publicKey, devices: [{ endpoint, name, at, fails }] }
//   POST { action: 'add', subscription, name }            this browser's PushSubscription (toJSON()), turned on
//        { action: 'remove', endpoint }                   turned off (one of the owner's own)
//   -> the fresh { publicKey, devices }
// 404 = off, 403 = someone else, 400 = a bad body ({ error, field }), 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 4096
const owner = (request) => (notifyOn() ? syncOwner(request) : 404)

async function state(store, who) {
  const [keys, devices] = await Promise.all([store.keys(), store.list(who)])
  return { publicKey: keys.publicKey, devices: devices.map(({ endpoint, name, at, fails }) => ({ endpoint, name, at, fails })) }
}

export async function GET(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no push' }, who)
  try {
    return json(await state(pushStore(), who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function POST(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no push' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let b
  try {
    b = JSON.parse(text)
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  const action = b?.action
  if (!['add', 'remove'].includes(action)) return json({ error: 'action: one of add, remove', field: 'action' }, 400)
  const store = pushStore()
  try {
    if (action === 'add') {
      const c = cleanSubscription(b.subscription)
      if (c.error) return json({ error: c.error, field: c.field }, 400)
      await store.add(who, c.sub, cleanName(b.name))
      return json(await state(store, who))
    }
    if (typeof b.endpoint !== 'string' || !b.endpoint) return json({ error: 'endpoint: one of your devices', field: 'endpoint' }, 400)
    await store.remove(who, b.endpoint)
    return json(await state(store, who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
