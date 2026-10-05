import { ownerOf, sameOriginJson } from '../../../../../lib/gate'
import { control, isControl, spotifyOn } from '../../../../../lib/spotify'

// The owner's Spotify controls (Premium): { action: play | pause | next | previous } -> the fresh now-playing state.
// Lives in the owner-only zone (lib/gate.js ownerOf): the proxy's /api/private/settings location covers this path too.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })

export async function POST(request) {
  const who = spotifyOn() ? ownerOf(request) : 404
  if (typeof who === 'number') return json({ error: 'not available' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const { action } = await request.json().catch(() => ({}))
  if (!isControl(action)) return json({ error: 'unknown action' }, 400)
  try {
    const now = await control(action)
    return json({ enabled: true, ...now, ageMs: Date.now() - now.at })
  } catch (e) {
    return json({ error: e.reason ?? 'spotify' }, 502)
  }
}
