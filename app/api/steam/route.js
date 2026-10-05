import { steamStatus } from '../../../lib/steam'

// Public Steam status for the Steam card (lib/steam.js): status, the game being played, games owned, hours.
export async function GET() {
  try {
    return Response.json(await steamStatus(), { headers: { 'cache-control': 'public, max-age=60' } })
  } catch {
    return Response.json({ error: true }, { status: 502, headers: { 'cache-control': 'no-store' } })
  }
}
