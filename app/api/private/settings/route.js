import { gateOk, secretOk } from '../../../../lib/gate'
import { readDoc, writeDoc } from '../../../../lib/cloud'

// The owner's synced settings (app/cloud.js). Same proxy gate as /api/private, plus a second header that only the
// proxy's Authelia-protected /api/private/settings location adds (x-home-sync = SYNC_SECRET). Remote-User is trusted
// only together with it: on a path without the login check a client could send its own Remote-User.
// Then Remote-User must be OWNER_USER. Everyone else keeps settings in their own browser only.
// 404 = not set up / no gate (the client treats it as "off"), 403 = someone else, 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 16_384 // a full doc is ~1 KB

function owner(request) {
  if (!gateOk(request.headers.get('x-home-gate')) || !secretOk(request.headers.get('x-home-sync'), process.env.SYNC_SECRET)) return 404
  const name = process.env.OWNER_USER
  if (!name || !process.env.DATABASE_URL) return 404
  return request.headers.get('remote-user') === name ? name : 403
}

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
  // only this page may write: same-origin fetch with a JSON body (a cross-site form or image can't send either)
  const site = request.headers.get('sec-fetch-site')
  if ((site && site !== 'same-origin') || !request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  try {
    return json({ doc: await writeDoc(who, body) })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
