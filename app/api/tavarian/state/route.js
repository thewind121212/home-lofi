import { failure, freshen, readHome, tavarianOn } from '../../../../lib/tavarian'
import { hub } from '../../../../lib/tavarian-hub'

// Public { state, queue } for the Player tab's first paint, and the fallback when the event stream can't stay open.
// From the live hub when it's connected, else one cached call to Tavarian (shared by every visitor, 3 s).
export const dynamic = 'force-dynamic'

const HEADERS = { 'cache-control': 'no-store' }

export async function GET() {
  if (!tavarianOn()) return Response.json({ error: 'tavarian_off' }, { status: 503, headers: HEADERS })
  const snap = hub().snapshot()
  if (snap.live && snap.state && snap.queue) return Response.json({ state: snap.state, queue: snap.queue, live: true }, { headers: HEADERS })
  const r = await readHome()
  if (r.ok) return Response.json({ state: freshen(r.state, r.at), queue: r.queue, live: false, ...(r.stale && { stale: true }) }, { headers: HEADERS })
  const f = failure(r)
  return Response.json(f.body, { status: f.status, headers: { ...HEADERS, ...(f.retryAfter != null && { 'retry-after': String(f.retryAfter) }) } })
}
