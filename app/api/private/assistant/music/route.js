import { assistantOk, assistantWrite } from '../../../../../lib/gate.js'
import { liveBus } from '../../../../../lib/live.js'
import { MUSIC, readJson } from '../../../../../lib/assistant.js'

// The owner's assistant plays music on the home page: the owner's page that's showing (a tab in the background, or
// none open, doesn't play) presses its music card's ⏯ / ⏭, whatever it plays now (the radio, Spotify, the home
// station: app/page.js, the same as Quick actions' "Play"). From the LAN, no login (lib/gate.js assistantOk).
//   POST { action: 'play' | 'pause' | 'toggle' | 'next' }   (next: Spotify / the home station; the radio has none)
//   -> { sent: how many of the owner's pages heard it }, 409 when none is open
// It goes down the owner's live stream (app/api/private/settings/events: event 'remote'). A page that was never
// tapped may not be allowed to start sound (the browser's autoplay rule): tap it once after loading.
// 404 = not through the proxy's /api/private location (or off), 403 = a browser on another site, 400 = a bad action.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })

export async function POST(request) {
  if (!assistantOk(request)) return json({ error: 'not found' }, 404)
  if (!assistantWrite(request)) return json({ error: 'forbidden: send JSON (content-type: application/json)' }, 403)
  const b = await readJson(request)
  if (b.error) return json({ error: b.error }, b.status)
  const action = b.value.action
  if (!MUSIC.includes(action)) return json({ error: `action: one of ${MUSIC.join(', ')}`, field: 'action' }, 400)
  const sent = liveBus().publish(process.env.OWNER_USER, { kind: 'remote', action, at: Date.now() })
  if (!sent) return json({ error: 'no home page is open right now', sent }, 409)
  return json({ sent })
}
