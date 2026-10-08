import { sameOriginJson, syncOwner } from '../../../../lib/gate'
import { readDoc, writeDoc } from '../../../../lib/cloud'
import { clientId, liveBus } from '../../../../lib/live'

// The owner's synced settings (app/cloud.js), in the owner-only zone (lib/gate.js ownerOf). Everyone else keeps
// settings in their own browser only. A save that changes something tells the owner's other open tabs to pull
// (lib/live.js; the tab that saved sends its id in x-home-client and isn't told).
// 404 = not set up / no gate (the client treats it as "off"), 403 = someone else, 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 16_384 // a full doc is ~1 KB

const owner = syncOwner

export async function GET(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no sync' }, who)
  try {
    return json({ doc: await readDoc(who) })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function PUT(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no sync' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  try {
    const { doc, changed } = await writeDoc(who, body)
    if (changed.length) liveBus().publish(who, { at: Date.now(), from: clientId(request.headers.get('x-home-client')) })
    return json({ doc })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
