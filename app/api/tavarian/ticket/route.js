import { clientIp, windowLimit } from '../../../../lib/limits'
import { sameOriginJson } from '../../../../lib/gate'
import { failure, tavarianOn, ticketFor } from '../../../../lib/tavarian'

// Public: a listen ticket for one browser tab. POST { clientId } -> { ticket, expiresAt, streamUrl }; the audio is
// `${streamUrl}?streamId=<state.streamId>&clientId=<clientId>&ticket=<ticket>`, straight from Tavarian (10 minutes).
// Only from this page (same-origin JSON), 10 a minute per IP.
const HEADERS = { 'cache-control': 'no-store' }
const json = (body, status = 200, extra) => Response.json(body, { status, headers: { ...HEADERS, ...extra } })
const hit = windowLimit(10, 60_000)

export async function POST(request) {
  if (!tavarianOn()) return json({ error: 'tavarian_off' }, 503)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  if (!hit(clientIp(request))) return json({ error: 'Too many tickets: try again in a minute', code: 'rate_limited' }, 429, { 'retry-after': '60' })
  const { clientId } = await request.json().catch(() => ({}))
  const r = await ticketFor(clientId)
  if (r.ok) return json(r.data)
  const f = failure(r)
  return json(f.body, f.status, f.retryAfter != null ? { 'retry-after': String(f.retryAfter) } : undefined)
}
