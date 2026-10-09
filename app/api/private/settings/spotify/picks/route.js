import { ownerOf } from '../../../../../../lib/gate.js'
import { spotifyOn, stationPicks } from '../../../../../../lib/spotify.js'

// The home station's next Spotify autoplay songs, for the owner's Player card while autoplay runs (lib/spotify.js
// stationPicks). Lives in the owner-only zone (lib/gate.js ownerOf): the proxy's /api/private/settings location
// covers this path too; Spotify not set up -> 404 for everyone.
//   GET -> { nowUri, picks: [{ title, artists, album, cover, spotifyUri, durationSeconds }] } (picks [] when Spotify
//          has nothing to say right now)
const HEADERS = { 'cache-control': 'no-store, private' }

export async function GET(request) {
  const who = spotifyOn() ? ownerOf(request) : 404
  if (typeof who === 'number') return Response.json({ error: 'not available' }, { status: who, headers: HEADERS })
  return Response.json(await stationPicks(), { headers: HEADERS })
}
