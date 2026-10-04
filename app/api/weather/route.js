import { parseWeatherParams, wmo, uvLabel } from '../../../lib/weather'

const BASE = process.env.WEATHER_API_URL || 'https://api.weather.wliafdew.dev'

async function upstream(path, p) {
  const url = new URL(path, BASE)
  url.search = new URLSearchParams({
    latitudeRequest: p.lat,
    longitudeRequest: p.lon,
    manualTimezone: p.tz,
    locationIdRequest: p.id,
  })
  const res = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  return (await res.json()).data
}

export async function GET(request) {
  const s = request.nextUrl.searchParams
  const p = parseWeatherParams({ lat: s.get('lat'), lon: s.get('lon'), tz: s.get('tz'), id: s.get('id'), name: s.get('name') })
  if (!p) return Response.json({ error: 'invalid parameters' }, { status: 400 })

  try {
    const [w, aq] = await Promise.all([upstream('/weather', p), upstream('/air-quality', p).catch(() => null)])
    const c = w.current
    const hourIdx = w.hourly?.time?.indexOf(`${c.time?.slice(0, 13)}:00`) ?? -1
    const rainChance = w.hourly?.precipitation_probability?.[hourIdx] ?? w.daily?.precipitation_probability_max?.[0] ?? null
    const uvRaw = aq?.current?.uv_index ?? w.daily?.uv_index_max?.[0]
    const uv = uvRaw == null ? null : Math.round(uvRaw)
    const isDay = c.is_day === 1
    return Response.json({
      name: p.name,
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      code: c.weather_code,
      ...wmo(c.weather_code, isDay),
      isDay,
      humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m),
      rainChance,
      uv,
      uvLabel: uv == null ? null : uvLabel(uv),
    })
  } catch {
    // ponytail: never forward upstream bodies/stack to the public page
    return Response.json({ error: 'weather unavailable' }, { status: 502 })
  }
}
