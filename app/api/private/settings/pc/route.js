import { ownerOf, sameOriginJson } from '../../../../../lib/gate.js'
import { pcOn, wakeOn, wakePc } from '../../../../../lib/pc.js'

// Wake the gaming PC (Wake-on-LAN through moni-relay, lib/pc.js). Owner-only like the settings next door: the proxy's
// /api/private/settings location always asks for the Authelia login, even on the LAN (where /api/private itself is
// open), so nobody at home wakes the PC without signing in.
//   POST { action: 'wake' } -> { ok: true, sent } (sent false: it was on already)
// 404 = not set up (no PC_URL / PC_WAKE_TOKEN) / not through that location, 403 = someone else, 400 = a bad body,
// 502 = the relay unreachable or refusing.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 256

export async function POST(request) {
  const who = ownerOf(request)
  if (typeof who === 'number') return json({ error: 'no pc' }, who)
  if (!pcOn() || !wakeOn()) return json({ error: 'no pc' }, 404)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  if (body?.action !== 'wake') return json({ error: 'unknown action', field: 'action' }, 400)
  try {
    return json({ ok: true, ...(await wakePc()) })
  } catch {
    return json({ error: 'pc relay unreachable' }, 502)
  }
}
