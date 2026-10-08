import { ownerOf, sameOriginJson } from '../../../../../lib/gate'
import { ACTIONS, failure, forget, isAction, READS, tavarianOn } from '../../../../../lib/tavarian'
import { hub } from '../../../../../lib/tavarian-hub'

// The owner's Player controls: POST { action, ...args } (see ACTIONS in lib/tavarian.js) -> { song | queue | state |
// results | playlists | songs | added + skipped (+ source, found, truncated for an import) | removed + skipped + queue
// (remove-bulk, clear) | token | revoked }, or
// { error, code }. An import can take up to 2 minutes (lib/tavarian.js IMPORT_TIMEOUT); everything else 5 s.
// Lives in the owner-only zone (lib/gate.js ownerOf): the proxy's /api/private/settings location covers this path too.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200, extra) => Response.json(body, { status, headers: { ...HEADERS, ...extra } })

export async function POST(request) {
  const who = tavarianOn() ? ownerOf(request) : 404
  if (typeof who === 'number') return json({ error: 'not available' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const body = await request.json().catch(() => null)
  const action = body?.action
  if (!isAction(action)) return json({ error: 'unknown action' }, 400)
  const r = await ACTIONS[action](body)
  if (!r.ok) {
    const f = failure(r)
    // the server log (docker logs): which command failed and Tavarian's code, never a token or a request body
    console.warn(`[tavarian] ${action} failed: ${f.body.code} (Tavarian ${r.status || 'no answer'}, sent ${f.status})`)
    return json(f.body, f.status, f.retryAfter != null ? { 'retry-after': String(f.retryAfter) } : undefined)
  }
  if (!READS.has(action)) forget() // the next /api/tavarian/state asks Tavarian again
  if (action === 'revoke') hub().revoked() // no more stream: every open Player tab hears `revoked`
  return json(r.data)
}
