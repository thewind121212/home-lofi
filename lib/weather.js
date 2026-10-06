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

// US EPA AQI bands: [upper bound, label, color, health advice]
export const AQI_BANDS = [
  [50, 'Good', '#4ade80', 'Air is clean, enjoy outdoor time'],
  [100, 'Moderate', '#facc15', 'Unusually sensitive people: take it easier outdoors'],
  [150, 'Unhealthy for Sensitive Groups', '#fb923c', 'Sensitive groups: limit long outdoor effort'],
  [200, 'Unhealthy', '#f87171', 'Everyone: limit long outdoor effort'],
  [300, 'Very Unhealthy', '#c084fc', 'Avoid outdoor effort, sensitive groups stay inside'],
  [Infinity, 'Hazardous', '#be123c', 'Stay indoors and keep windows closed'],
]

export function aqiBand(aqi) {
  if (aqi == null || !Number.isFinite(aqi)) return null
  const i = AQI_BANDS.findIndex(([max]) => aqi <= max)
  const [, label, color, advice] = AQI_BANDS[i]
  return { i, label, color, advice }
}

// 0-100 position on a bar of 6 equal band segments (Hazardous segment spans 301-500)
export function aqiPos(aqi) {
  const b = aqiBand(aqi)
  if (!b) return null
  const lo = b.i ? AQI_BANDS[b.i - 1][0] : 0, hi = b.i === 5 ? 500 : AQI_BANDS[b.i][0]
  return ((b.i + Math.min(1, Math.max(0, (aqi - lo) / (hi - lo)))) / 6) * 100
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compass = (deg) => (Number.isFinite(deg) ? DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] : null)

const round = (v) => (v == null ? null : Math.round(v))
const at = (arr, i) => arr?.[i] ?? null

// Upstream weather + air-quality payloads -> compact details-panel shape. `air` may be null (endpoint down).
export function shapeDetail(w, air, { name, tz }) {
  const c = w.current, h = w.hourly ?? {}, d = w.daily ?? {}, a = air?.current ?? {}
  const aqi = round(a.us_aqi)
  const aqiLabel = aqiBand(aqi)?.label ?? null
  const isDay = c.is_day === 1
  // same current-hour match as /api/weather; no match -> no strip rather than a wrong one
  const start = h.time?.indexOf(`${c.time?.slice(0, 13)}:00`) ?? -1
  const hours = (start < 0 ? [] : h.time.slice(start, start + 24)).map((t, k) => {
    const i = start + k, di = d.time?.indexOf(t.slice(0, 10)) ?? -1
    // ISO local times compare as strings; no sun data for that day -> treat as day
    const day = di < 0 || !d.sunrise?.[di] || (t >= d.sunrise[di] && t < d.sunset?.[di])
    const code = at(h.weather_code, i)
    return { t, temp: round(at(h.temperature_2m, i)), code, icon: wmo(code, day).icon, isDay: day, rain: at(h.precipitation_probability, i) }
  })
  const days = (d.time ?? []).slice(0, 7).map((date, i) => {
    const code = at(d.weather_code, i)
    return { date, code, icon: wmo(code).icon, min: round(at(d.temperature_2m_min, i)), max: round(at(d.temperature_2m_max, i)), rain: at(d.precipitation_probability_max, i) }
  })
  const mins = days.map((x) => x.min).filter((v) => v != null), maxs = days.map((x) => x.max).filter((v) => v != null)
  return {
    name,
    tz: w.timezone ?? tz,
    now: { temp: round(c.temperature_2m), code: c.weather_code, ...wmo(c.weather_code, isDay), isDay, aqi, aqiLabel },
    hours,
    days,
    // one shared scale for all 7 range bars
    range: mins.length && maxs.length ? { min: Math.min(...mins), max: Math.max(...maxs) } : null,
    air: { aqi, label: aqiLabel, pm25: a.pm2_5 ?? null, pm10: a.pm10 ?? null, o3: a.ozone ?? null },
    sun: { sunrise: at(d.sunrise, 0)?.slice(11, 16) ?? null, sunset: at(d.sunset, 0)?.slice(11, 16) ?? null },
    wind: { speed: round(c.wind_speed_10m), gust: round(c.wind_gusts_10m), dir: c.wind_direction_10m ?? null, compass: compass(c.wind_direction_10m) },
    pressure: round(c.surface_pressure),
    cloud: c.cloud_cover ?? null,
  }
}

// Today's sunrise / sunset at the location as epoch ms (upstream gives local ISO times + the UTC offset), so the
// browser can compare them with its own clock whatever its time zone. null when missing (polar day / night).
export function sunToday(w) {
  const off = w.utc_offset_seconds
  const ms = (t) => (typeof t === 'string' && Number.isFinite(off) ? Date.parse(`${t}Z`) - off * 1000 : NaN)
  const sunrise = ms(w.daily?.sunrise?.[0]), sunset = ms(w.daily?.sunset?.[0])
  return { sunrise: Number.isFinite(sunrise) ? sunrise : null, sunset: Number.isFinite(sunset) ? sunset : null }
}

const r1 = (v) => Math.round(v * 10) / 10

// Monotone cubic (Fritsch-Carlson) through points sorted by x: smooth, but never overshoots the data,
// so the curve's peak is the real max.
function monotonePath(p) {
  if (!p.length) return ''
  const n = p.length, d = [], m = []
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x))
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b
    if (s > 9) (m[i] = (3 / Math.sqrt(s)) * a * d[i]), (m[i + 1] = (3 / Math.sqrt(s)) * b * d[i])
  }
  let path = `M${r1(p[0].x)},${r1(p[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1].x - p[i].x) / 3
    path += `C${r1(p[i].x + h)},${r1(p[i].y + m[i] * h)} ${r1(p[i + 1].x - h)},${r1(p[i + 1].y - m[i + 1] * h)} ${r1(p[i + 1].x)},${r1(p[i + 1].y)}`
  }
  return path
}

// Hourly strip -> chart geometry in a w x h box. Each hour gets an equal column, points sit at column centers;
// temps map into [top, bottom] (hottest at top). Null temps get y: null and are left out of the curve.
export function chartPoints(hours, w, h, { top = 0, bottom = h } = {}) {
  const temps = hours.map((x) => x.temp).filter((t) => t != null)
  const lo = temps.length ? Math.min(...temps) : 0, hi = temps.length ? Math.max(...temps) : 0
  const pts = hours.map((x, i) => ({
    x: ((i + 0.5) / hours.length) * w,
    y: x.temp == null ? null : hi === lo ? (top + bottom) / 2 : bottom - ((x.temp - lo) / (hi - lo)) * (bottom - top),
    temp: x.temp,
    rain: x.rain,
  }))
  const ok = pts.filter((p) => p.y != null)
  const line = monotonePath(ok)
  return {
    pts,
    line,
    area: ok.length ? `${line}L${r1(ok.at(-1).x)},${h}L${r1(ok[0].x)},${h}Z` : '',
    lo,
    hi,
    iLo: hours.findIndex((x) => x.temp === lo),
    iHi: hours.findIndex((x) => x.temp === hi),
  }
}

// Greedy label thinning: keep indices in priority order unless one already kept is closer than `gap`.
export function spread(order, gap) {
  const kept = []
  for (const i of order) if (i >= 0 && kept.every((k) => Math.abs(k - i) >= gap)) kept.push(i)
  return new Set(kept)
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
