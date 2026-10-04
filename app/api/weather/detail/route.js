import { parseWeatherParams, shapeDetail } from '../../../../lib/weather'
import { upstream } from '../../../../lib/upstream'

// Details panel data: same params, validation, caching and timeout as /api/weather.
export async function GET(request) {
  const s = request.nextUrl.searchParams
  const p = parseWeatherParams({ lat: s.get('lat'), lon: s.get('lon'), tz: s.get('tz'), id: s.get('id'), name: s.get('name') })
  if (!p) return Response.json({ error: 'invalid parameters' }, { status: 400 })

  try {
    // ponytail: air quality is optional, like on the card; only a weather failure is a 502
    const [w, aq] = await Promise.all([upstream('/weather', p), upstream('/air-quality', p).catch(() => null)])
    return Response.json(shapeDetail(w, aq, p))
  } catch {
    return Response.json({ error: 'weather unavailable' }, { status: 502 })
  }
}
