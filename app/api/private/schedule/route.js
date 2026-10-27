import { assistantOk } from '../../../../lib/gate.js'
import { DEFAULT_TZ, localNow } from '../../../../lib/habits.js'
import { habitsStore } from '../../../../lib/habits-store.js'
import { remindersStore } from '../../../../lib/reminders-store.js'
import { dayItems, dayParam, isoAt, offsetOf } from '../../../../lib/schedule.js'

// One day of the owner's schedule, for other machines on the LAN (Jade on the Razer). Read-only. Rules: lib/schedule.js.
//   GET ?date=YYYY-MM-DD (empty: today)   from the LAN, no login, no token (lib/gate.js assistantOk)
//   -> { date, today, tz, now, items: the habits due that day (dayItems), todos: the Reminders carry-over list (what's
//        open now, no time: [{ title, added }]) }
// The timed reminders aren't here: they live in the reminders API on the Razer itself.
// 404 = off (no database / owner) or not through the proxy's /api/private location, 400 = a bad date, 503 = database
// unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })

export async function GET(request) {
  if (!assistantOk(request)) return json({ error: 'not found' }, 404)
  const who = process.env.OWNER_USER
  try {
    const store = habitsStore()
    const doc = (await store.getDoc(who)) ?? { tz: DEFAULT_TZ, habits: [] }
    const now = localNow(Date.now(), doc.tz)
    const p = dayParam(new URL(request.url).searchParams.get('date'), now.day)
    if (p.error) return json({ error: p.error }, 400)
    const [checkins, open] = await Promise.all([store.checkins(who, p.day), remindersStore().open(who).catch(() => [])])
    return json({
      date: p.day,
      today: now.day,
      tz: doc.tz,
      now: isoAt(now.day, now.min, offsetOf(doc.tz, now.day)),
      items: dayItems(doc, checkins.filter((c) => c.day === p.day), p.day),
      todos: open.map((t) => ({ title: t.text, added: t.day })),
    })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
