// WMO weather_code -> label + Font Awesome icon, plus input validation for the API routes.

const WMO = {
  0: ['Clear Sky', 'fa-sun', 'fa-moon'],
  1: ['Mainly Clear', 'fa-sun', 'fa-moon'],
  2: ['Partly Cloudy', 'fa-cloud-sun', 'fa-cloud-moon'],
  3: ['Overcast', 'fa-cloud'],
  45: ['Fog', 'fa-smog'],
  48: ['Rime Fog', 'fa-smog'],
  51: ['Light Drizzle', 'fa-cloud-rain'],
  53: ['Drizzle', 'fa-cloud-rain'],
  55: ['Dense Drizzle', 'fa-cloud-rain'],
  56: ['Freezing Drizzle', 'fa-cloud-rain'],
  57: ['Freezing Drizzle', 'fa-cloud-rain'],
  61: ['Light Rain', 'fa-cloud-rain'],
  63: ['Rain', 'fa-cloud-rain'],
  65: ['Heavy Rain', 'fa-cloud-showers-heavy'],
  66: ['Freezing Rain', 'fa-cloud-rain'],
  67: ['Freezing Rain', 'fa-cloud-showers-heavy'],
  71: ['Light Snow', 'fa-snowflake'],
  73: ['Snow', 'fa-snowflake'],
  75: ['Heavy Snow', 'fa-snowflake'],
  77: ['Snow Grains', 'fa-snowflake'],
  80: ['Rain Showers', 'fa-cloud-showers-heavy'],
  81: ['Rain Showers', 'fa-cloud-showers-heavy'],
  82: ['Violent Showers', 'fa-cloud-showers-water'],
  85: ['Snow Showers', 'fa-snowflake'],
  86: ['Snow Showers', 'fa-snowflake'],
  95: ['Thunderstorm', 'fa-cloud-bolt'],
  96: ['Thunderstorm, Hail', 'fa-cloud-bolt'],
  99: ['Thunderstorm, Hail', 'fa-cloud-bolt'],
}

export function wmo(code, isDay = true) {
  const [desc, day, night] = WMO[code] ?? ['Unknown', 'fa-cloud']
  return { desc, icon: isDay ? day : night ?? day }
}

// WHO UV index bands
export function uvLabel(uv) {
  if (uv < 3) return 'Low'
  if (uv < 6) return 'Mod'
  if (uv < 8) return 'High'
  if (uv < 11) return 'Very High'
  return 'Extreme'
}

const NUM = /^-?\d{1,3}(\.\d{1,10})?$/
const TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/

// All inputs are strings (or null). Returns normalized params, or null if anything is invalid.
export function parseWeatherParams({ lat, lon, tz, id, name }) {
  if (!NUM.test(lat ?? '') || !NUM.test(lon ?? '')) return null
  // ponytail: 2 decimals (~1km) bounds cache keys and upstream calls
  const la = Math.round(Number(lat) * 100) / 100, lo = Math.round(Number(lon) * 100) / 100
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null
  if (!tz || tz.length > 64 || !TZ.test(tz)) return null
  if (!/^\d{1,12}$/.test(id ?? '')) return null
  name = (name ?? '').trim()
  if (name.length > 80) return null
  return { lat: la, lon: lo, tz, id, name }
}

export function parseGeoQuery(q) {
  q = (q ?? '').trim()
  return q.length >= 1 && q.length <= 80 ? q : null
}

// Upstream geo_search results -> compact public shape (top 5, must have a timezone).
export function shapeGeo(results = []) {
  return results
    .filter((r) => r.timezone)
    .slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, region: r.admin1 || undefined, country: r.country, lat: r.latitude, lon: r.longitude, tz: r.timezone }))
}

// ponytail: per-process in-memory cache; ceiling = `max` entries per server process, lost on restart,
// not shared between replicas. Swap for Redis / a shared cache if search traffic ever needs it.
export function memoCache(max, ttl, now = Date.now) {
  const m = new Map()
  return {
    get(k) {
      const e = m.get(k)
      if (e && now() - e.t <= ttl) return e.v
      m.delete(k)
    },
    set(k, v) {
      m.delete(k) // re-insert so Map order = insertion age
      m.set(k, { v, t: now() })
      if (m.size > max) m.delete(m.keys().next().value) // evict oldest
    },
  }
}
