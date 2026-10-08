import { parseWeatherParams, wmo, uvLabel, aqiBand, sunToday } from '../../../lib/weather'
import { upstream } from '../../../lib/upstream'

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
    const aqi = aq?.current?.us_aqi == null ? null : Math.round(aq.current.us_aqi)
    return Response.json({
      name: p.name,
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      code: c.weather_code,
      ...wmo(c.weather_code, isDay),
      isDay,
      ...sunToday(w), // the scene's day / night (lib/settings.js isDaytime)
      humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m),
      rainChance,
      uv,
      uvLabel: uv == null ? null : uvLabel(uv),
      aqi,
      aqiLabel: aqiBand(aqi)?.label ?? null,
      // near Ho Chi Minh City the weather API uses Tan Son Nhat airport's report (METAR) for current, not the model
      station: c.source?.name ? { name: c.source.name, at: c.source.observed } : null,
    })
  } catch {
    // ponytail: never forward upstream bodies/stack to the public page
    return Response.json({ error: 'weather unavailable' }, { status: 502 })
  }
}
