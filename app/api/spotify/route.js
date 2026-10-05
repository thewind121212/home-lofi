import { nowPlaying, spotifyOn } from '../../../lib/spotify'

// Public "now playing" for the music card's Spotify tab: { enabled: false } until the three SPOTIFY_* env vars are set.
export async function GET() {
  if (!spotifyOn()) return Response.json({ enabled: false }, { headers: { 'cache-control': 'public, max-age=300' } })
  try {
    const np = await nowPlaying()
    // ageMs: how old the answer is, so the pill can run the progress bar from the right spot
    return Response.json({ enabled: true, ...np, ageMs: Date.now() - np.at }, { headers: { 'cache-control': 'public, max-age=10' } })
  } catch {
    return Response.json({ enabled: true, error: true }, { status: 502, headers: { 'cache-control': 'no-store' } })
  }
}
