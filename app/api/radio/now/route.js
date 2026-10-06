import { nowPlaying } from '../../../../lib/radio-now'

// ?id=<stream station>: { artist, title } of what it plays now, or 204 when its API doesn't say (lib/radio-now.js)
export async function GET(req) {
  const id = new URL(req.url).searchParams.get('id') ?? ''
  try {
    const v = await nowPlaying(id)
    return v ? Response.json(v, { headers: { 'cache-control': 'public, max-age=15' } }) : new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  }
}
