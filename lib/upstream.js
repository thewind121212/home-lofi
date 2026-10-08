// Server-only: GET a weather-API endpoint for validated params (see parseWeatherParams), returns its `data`.

const BASE = process.env.WEATHER_API_URL || 'https://api.weather.wliafdew.dev'

export async function upstream(path, p) {
  const url = new URL(path, BASE)
  url.search = new URLSearchParams({
    latitudeRequest: p.lat,
    longitudeRequest: p.lon,
    manualTimezone: p.tz,
    locationIdRequest: p.id,
  })
  const res = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  return (await res.json()).data
}
