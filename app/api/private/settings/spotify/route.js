import { ownerOf, sameOriginJson } from '../../../../../lib/gate'
import { control, device, isControl, setVolume, spotifyOn, volumeOf } from '../../../../../lib/spotify'

// The owner's Spotify controls (Premium). Lives in the owner-only zone (lib/gate.js ownerOf): the proxy's
// /api/private/settings location covers this path too.
//   GET                                   -> { enabled: true, device } (the active device: name, volume; or null)
//   POST { action: play | pause | next | previous } -> the fresh now-playing state
//   POST { action: 'volume', percent: 0-100 }       -> { enabled: true, device } (the device at its new volume)
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const gate = (request) => {
  const who = spotifyOn() ? ownerOf(request) : 404
  return typeof who === 'number' ? json({ error: 'not available' }, who) : null
}

export async function GET(request) {
  const no = gate(request)
  if (no) return no
  try {
    return json({ enabled: true, device: await device() })
  } catch (e) {
    return json({ error: e.reason ?? 'spotify' }, 502)
  }
}

export async function POST(request) {
  const no = gate(request)
  if (no) return no
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const { action, percent } = (await request.json().catch(() => null)) ?? {}
  if (action === 'volume') {
    const v = volumeOf(percent)
    if (v === null) return json({ error: 'bad volume' }, 400)
    try {
      return json({ enabled: true, device: await setVolume(v) })
    } catch (e) {
      return json({ error: e.reason ?? 'spotify' }, 502)
    }
  }
  if (!isControl(action)) return json({ error: 'unknown action' }, 400)
  try {
    const now = await control(action)
    return json({ enabled: true, ...now, ageMs: Date.now() - now.at })
  } catch (e) {
    return json({ error: e.reason ?? 'spotify' }, 502)
  }
}
