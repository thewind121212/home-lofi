import { stationStreams } from '../../../lib/youtube'

// { stationId: { v, title, watching } | null }: each YouTube station's live stream right now (lib/youtube.js, hourly)
export async function GET() {
  try {
    return Response.json(await stationStreams(), { headers: { 'cache-control': 'public, max-age=600' } })
  } catch {
    return Response.json({ error: true }, { status: 502, headers: { 'cache-control': 'no-store' } })
  }
}
