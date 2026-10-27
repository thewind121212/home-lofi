import { gateOk, readerOk, scheduleOn } from '../../../../../lib/gate.js'
import { DEFAULT_TZ, STREAK_DAYS, addDays, localNow } from '../../../../../lib/habits.js'
import { habitsStore } from '../../../../../lib/habits-store.js'
import { daysParam, routines } from '../../../../../lib/schedule.js'

// Every habit's routine and how it's gone, for other machines on the LAN (Jade on the Razer, helping plan new ones).
// Read-only. Rules: lib/schedule.js routines.
//   GET ?days=N (1–60, default 14)   Authorization: Bearer <SCHEDULE_TOKEN>
//   -> { today, tz, days, habits: [{ id, title, …the routine, streak, at_risk, last: { due, kept, on_time, late,
//        missed, ratings } }] }
// 404 / 401 / 400 / 503 as next door (../route.js).
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200, extra) => Response.json(body, { status, headers: { ...HEADERS, ...extra } })

export async function GET(request) {
  if (!scheduleOn() || !gateOk(request.headers.get('x-home-gate'))) return json({ error: 'not found' }, 404)
  if (!readerOk(request)) return json({ error: 'bad or missing token' }, 401, { 'www-authenticate': 'Bearer' })
  const p = daysParam(new URL(request.url).searchParams.get('days'))
  if (p.error) return json({ error: p.error }, 400)
  const who = process.env.OWNER_USER
  try {
    const store = habitsStore()
    const doc = (await store.getDoc(who)) ?? { tz: DEFAULT_TZ, habits: [] }
    const today = localNow(Date.now(), doc.tz).day
    const [checkins, kept] = await Promise.all([store.checkins(who, addDays(today, -(p.n - 1))), store.doneDays(who, addDays(today, -STREAK_DAYS))])
    const done = {}
    for (const d of kept) (done[d.habitId] ??= new Set()).add(d.day)
    return json({ today, tz: doc.tz, days: p.n, habits: routines(doc, checkins, done, today, p.n) })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
