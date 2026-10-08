import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wmo, uvLabel, aqiBand, aqiPos, compass, shapeDetail, chartPoints, spread, parseWeatherParams, parseGeoQuery, shapeGeo, memoCache, sunToday, nowRain } from './weather.js'

test('wmo mapping', () => {
  assert.deepEqual(wmo(0, true), { desc: 'Clear Sky', icon: 'fa-sun' })
  assert.deepEqual(wmo(0, false), { desc: 'Clear Sky', icon: 'fa-moon' })
  assert.equal(wmo(2, false).icon, 'fa-cloud-moon')
  assert.equal(wmo(3, false).icon, 'fa-cloud') // no night variant -> day icon
  assert.equal(wmo(95).icon, 'fa-cloud-bolt')
  assert.equal(wmo(1234).desc, 'Unknown')
})

test('uv bands', () => {
  assert.deepEqual([0, 2.9, 3, 5.9, 6, 8, 11].map(uvLabel), ['Low', 'Low', 'Mod', 'Mod', 'High', 'Very High', 'Extreme'])
  assert.equal(uvLabel(Math.round(5.96)), 'High') // route rounds before labelling
})

test('aqi bands', () => {
  const at = (n) => aqiBand(n)?.label ?? null
  assert.deepEqual([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 999].map(at), [
    'Good', 'Good', 'Moderate', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy for Sensitive Groups',
    'Unhealthy', 'Unhealthy', 'Very Unhealthy', 'Very Unhealthy', 'Hazardous', 'Hazardous',
  ])
  assert.equal(aqiBand(null), null)
  assert.equal(aqiBand(undefined), null)
  assert.match(aqiBand(62).color, /^#[0-9a-f]{6}$/)
  assert.equal(aqiPos(0), 0)
  assert.equal(aqiPos(50).toFixed(2), '16.67') // end of 1st of 6 segments
  assert.equal(aqiPos(9999), 100) // clamped
  assert.equal(aqiPos(null), null)
})

test('compass', () => {
  assert.deepEqual([0, 45, 359, 180, 22, 23, 270, 720, -90].map(compass), ['N', 'NE', 'N', 'S', 'N', 'NE', 'W', 'N', 'W'])
  assert.equal(compass(null), null)
})

test('detail shaping', () => {
  // 48 hourly slots from 00:00 on day 1; now = 20:15 -> strip starts at 20:00
  const hourly = Array.from({ length: 48 }, (_, i) => `2026-10-0${4 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`)
  const days = Array.from({ length: 8 }, (_, i) => `2026-10-${String(4 + i).padStart(2, '0')}`)
  const w = {
    timezone: 'Asia/Ho_Chi_Minh',
    current: { time: '2026-10-04T20:15', temperature_2m: 27.6, is_day: 0, weather_code: 0, surface_pressure: 1009.4, cloud_cover: 96, wind_speed_10m: 6.8, wind_direction_10m: 299, wind_gusts_10m: 25.9 },
    hourly: { time: hourly, temperature_2m: hourly.map((_, i) => i), precipitation_probability: hourly.map((_, i) => i % 100), weather_code: hourly.map(() => 0) },
    daily: {
      time: days, weather_code: days.map(() => 3),
      temperature_2m_min: [25, 24.6, 23.4, 24, 24, 24, 24, 10], temperature_2m_max: [32, 33.5, 30, 30, 30, 30, 30, 40],
      precipitation_probability_max: days.map(() => 50),
      sunrise: days.map((d) => `${d}T05:42`), sunset: days.map((d) => `${d}T17:42`),
    },
  }
  const air = { current: { us_aqi: 116.4, pm2_5: 30.5, pm10: 30.7, ozone: 125 } }
  const out = shapeDetail(w, air, { name: 'HCMC', tz: 'Asia/Ho_Chi_Minh' })
  assert.equal(out.hours.length, 24)
  assert.equal(out.hours[0].t, '2026-10-04T20:00')
  assert.deepEqual(out.hours[0], { t: '2026-10-04T20:00', temp: 20, code: 0, icon: 'fa-moon', isDay: false, rain: 20 })
  assert.equal(out.hours[10].t, '2026-10-05T06:00')
  assert.equal(out.hours[10].icon, 'fa-sun') // after next day's sunrise
  assert.equal(out.days.length, 7)
  assert.deepEqual(out.days[0], { date: '2026-10-04', code: 3, icon: 'fa-cloud', min: 25, max: 32, rain: 50 })
  assert.deepEqual(out.range, { min: 23, max: 34 }) // 8th day (10..40) ignored
  assert.deepEqual(out.now, { temp: 28, code: 0, desc: 'Clear Sky', icon: 'fa-moon', isDay: false, aqi: 116, aqiLabel: 'Unhealthy for Sensitive Groups' })
  assert.deepEqual(out.air, { aqi: 116, label: 'Unhealthy for Sensitive Groups', pm25: 30.5, pm10: 30.7, o3: 125 })
  assert.deepEqual(out.sun, { sunrise: '05:42', sunset: '17:42' })
  assert.deepEqual(out.wind, { speed: 7, gust: 26, dir: 299, compass: 'NW' })
  assert.equal(out.pressure, 1009)

  // null-safety: no air quality, no hourly/daily, unknown current hour
  const bare = shapeDetail({ current: { time: '2026-10-04T20:15', temperature_2m: 27 } }, null, { name: 'X', tz: 'UTC' })
  assert.deepEqual(bare.hours, [])
  assert.deepEqual(bare.days, [])
  assert.equal(bare.range, null)
  assert.equal(bare.tz, 'UTC')
  assert.deepEqual(bare.air, { aqi: null, label: null, pm25: null, pm10: null, o3: null })
  assert.deepEqual(bare.wind, { speed: null, gust: null, dir: null, compass: null })
  assert.equal(shapeDetail({ ...w, current: { ...w.current, time: '2030-01-01T00:00' } }, air, {}).hours.length, 0)

  // station observation (near Ho Chi Minh City): "Now" is what the station sees, the next hours stay the forecast
  const obs = { ...w.current, temperature_2m: 25.4, weather_code: 80, source: { station: 'VVTS' } }
  const st = shapeDetail({ ...w, current: obs }, air, { name: 'HCMC', tz: 'Asia/Ho_Chi_Minh' })
  assert.deepEqual(st.hours[0], { t: '2026-10-04T20:00', temp: 25, code: 80, icon: 'fa-cloud-showers-heavy', isDay: false, rain: 100 })
  assert.deepEqual(st.hours[1], out.hours[1])
  const dry = shapeDetail({ ...w, current: { ...obs, weather_code: 2 } }, air, {})
  assert.deepEqual([dry.hours[0].code, dry.hours[0].icon, dry.hours[0].rain], [2, 'fa-cloud-moon', 10]) // model 20 / 2
})

test('rain chance now: raining at the station = 100, dry = model / 2, no station = model', () => {
  assert.equal(nowRain({ source: {}, weather_code: 61 }, 20), 100)
  assert.equal(nowRain({ source: {}, weather_code: 95 }, 20), 100)
  assert.equal(nowRain({ source: {}, weather_code: 45 }, 63), 32) // fog isn't rain
  assert.equal(nowRain({ source: {}, weather_code: 2 }, 63), 32)
  assert.equal(nowRain({ source: {}, weather_code: 2 }, 0), 0)
  assert.equal(nowRain({ source: {}, weather_code: 2 }, undefined), 0)
  assert.equal(nowRain({ weather_code: 2 }, 63), 63)
  assert.equal(nowRain({ weather_code: 2 }, undefined), null)
})

test('chart points', () => {
  const temps = [25, 26, 28, 31, 30, 27, null, 24]
  const c = chartPoints(temps.map((temp, i) => ({ temp, rain: i * 10 })), 80, 100, { top: 20, bottom: 60 })
  assert.equal(c.pts.length, 8) // every hour gets a column, even without a temp
  assert.deepEqual(c.pts.map((p) => p.x), [5, 15, 25, 35, 45, 55, 65, 75]) // column centers
  assert.deepEqual([c.lo, c.hi, c.iLo, c.iHi], [24, 31, 7, 3])
  assert.equal(c.pts[3].y, 20) // hottest at top
  assert.equal(c.pts[7].y, 60) // coolest at bottom
  assert.equal(c.pts[6].y, null)
  assert.match(c.line, /^M5,/)
  assert.equal(c.line.split('C').length - 1, 6) // 7 real points -> 6 segments, null skipped
  // monotone: no control point above the hottest point or below the coolest
  const ys = c.line.match(/-?[\d.]+,-?[\d.]+/g).map((p) => Number(p.split(',')[1]))
  assert.ok(Math.min(...ys) >= 20 && Math.max(...ys) <= 60)
  assert.match(c.area, /L75,100L5,100Z$/) // closed down to the bottom edge
  const flat = chartPoints([{ temp: 20 }, { temp: 20 }], 10, 10)
  assert.deepEqual(flat.pts.map((p) => p.y), [5, 5]) // flat line, no divide by zero
  assert.deepEqual(chartPoints([], 10, 10), { pts: [], line: '', area: '', lo: 0, hi: 0, iLo: -1, iHi: -1 })
})

test('label spreading', () => {
  assert.deepEqual([...spread([5, 0, 3, 6, 9], 2)], [5, 0, 3, 9]) // 6 too close to 5
  assert.deepEqual([...spread([-1, 2, 2], 1)], [2])
})

test('weather params', () => {
  const ok = { lat: '10.8231', lon: '106.6297', tz: 'Asia/Ho_Chi_Minh', id: '1566083', name: 'Ho Chi Minh City' }
  assert.deepEqual(parseWeatherParams(ok), { ...ok, lat: 10.82, lon: 106.63 })
  assert.equal(parseWeatherParams({ ...ok, lat: '10.823149' }).lat, 10.82)
  assert.ok(parseWeatherParams({ ...ok, tz: 'Etc/GMT+10' }))
  assert.ok(parseWeatherParams({ ...ok, tz: 'America/Argentina/Buenos_Aires' }))
  assert.ok(parseWeatherParams({ ...ok, name: null }))
  for (const bad of [
    { lat: '91' }, { lat: '' }, { lat: null }, { lat: '1e2' }, { lat: '0x10' },
    { lon: '-180.5' }, { lon: 'abc' },
    { tz: '' }, { tz: '../etc' }, { tz: 'Asia/Ho Chi Minh' }, { tz: 'a/b/c/d' },
    { id: '12a' }, { id: '' }, { id: '-1' },
    { name: 'x'.repeat(81) },
  ]) assert.equal(parseWeatherParams({ ...ok, ...bad }), null, JSON.stringify(bad))
})

test('geo query', () => {
  assert.equal(parseGeoQuery(' Tokyo '), 'Tokyo')
  assert.equal(parseGeoQuery(''), null)
  assert.equal(parseGeoQuery('   '), null)
  assert.equal(parseGeoQuery(null), null)
  assert.equal(parseGeoQuery('x'.repeat(81)), null)
})

test('geo shaping', () => {
  const r = (i, extra) => ({ id: i, name: 'N' + i, latitude: 1, longitude: 2, timezone: 'UTC', country: 'C', ...extra })
  const out = shapeGeo([r(1, { admin1: 'England', population: 9 }), r(2, { timezone: undefined }), r(3), r(4), r(5), r(6), r(7)])
  assert.deepEqual(out[0], { id: 1, name: 'N1', region: 'England', country: 'C', lat: 1, lon: 2, tz: 'UTC' })
  assert.equal(out[1].region, undefined) // missing admin1 omitted
  assert.deepEqual(out.map((x) => x.id), [1, 3, 4, 5, 6]) // no-timezone dropped, top 5
  assert.deepEqual(shapeGeo(undefined), [])
})

test('memo cache: ttl + oldest eviction', () => {
  let t = 0
  const c = memoCache(2, 100, () => t)
  c.set('a', 1)
  c.set('b', 2)
  c.set('a', 1) // refresh a -> b is now oldest
  c.set('c', 3)
  assert.equal(c.get('b'), undefined)
  assert.equal(c.get('a'), 1)
  assert.equal(c.get('c'), 3)
  t = 101
  assert.equal(c.get('a'), undefined) // expired
})

test('sunToday: local ISO times + UTC offset -> epoch ms; missing -> null', () => {
  const w = { utc_offset_seconds: 28800, daily: { sunrise: ['2026-10-06T06:16', '2026-10-07T06:16'], sunset: ['2026-10-06T18:06'] } }
  assert.deepEqual(sunToday(w), { sunrise: Date.UTC(2026, 9, 5, 22, 16), sunset: Date.UTC(2026, 9, 6, 10, 6) })
  assert.deepEqual(sunToday({ daily: w.daily }), { sunrise: null, sunset: null }) // no offset: can't place them
  assert.deepEqual(sunToday({ utc_offset_seconds: 0, daily: { sunrise: [null], sunset: ['junk'] } }), { sunrise: null, sunset: null })
})
