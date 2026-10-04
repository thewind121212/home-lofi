import { parseGeoQuery, shapeGeo, memoCache } from '../../../lib/weather'

const BASE = process.env.WEATHER_API_URL || 'https://api.weather.wliafdew.dev'
const cache = memoCache(500, 24 * 60 * 60 * 1000)

export async function GET(request) {
  const q = parseGeoQuery(request.nextUrl.searchParams.get('q'))
  if (!q) return Response.json({ error: 'invalid query' }, { status: 400 })

  const key = q.toLowerCase()
  const hit = cache.get(key)
  if (hit) return Response.json(hit)

  try {
    const res = await fetch(new URL('/geo_search', BASE), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geoQuery: q }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    const results = shapeGeo((await res.json()).data?.results)
    cache.set(key, results)
    return Response.json(results)
  } catch {
    return Response.json({ error: 'search unavailable' }, { status: 502 })
  }
}
