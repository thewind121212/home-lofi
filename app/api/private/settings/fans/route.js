import { ownerOf, sameOriginJson } from '../../../../../lib/gate.js'
import { fanStatus, fansOn, okFan, okSpeed, setFans } from '../../../../../lib/fans.js'

// The router's fans (lib/fans.js: fan-control on the Razer). Owner-only, reading included: the proxy's
// /api/private/settings location always asks for the Authelia login, even on the LAN, and guests never learn the fans
// exist.
//   GET                                  -> { reachable, ok, fans: [{ id, name, speed }] }
//   POST { fan: 1 | 2 | 'both', speed }  -> { ok: true, reachable, fans } (speed: a whole number 0-100)
// 404 = not set up (no FAN_URL) / not through that location, 403 = someone else, 400 = a bad body, 502 = the fan
// service unreachable or the Arduino not answering.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 256

export async function GET(request) {
  const who = ownerOf(request)
  if (typeof who === 'number') return json({ error: 'no fans' }, who)
  if (!fansOn()) return json({ error: 'no fans' }, 404)
  return json(await fanStatus())
}

export async function POST(request) {
  const who = ownerOf(request)
  if (typeof who === 'number') return json({ error: 'no fans' }, who)
  if (!fansOn()) return json({ error: 'no fans' }, 404)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  const fan = body?.fan
  if (fan !== 'both' && !okFan(fan)) return json({ error: "fan: 1, 2 or 'both'", field: 'fan' }, 400)
  if (!okSpeed(body?.speed)) return json({ error: 'speed: a whole number from 0 to 100', field: 'speed' }, 400)
  try {
    return json({ ok: true, ...(await setFans(fan, body.speed)) })
  } catch {
    return json({ error: 'fan service unreachable' }, 502)
  }
}
