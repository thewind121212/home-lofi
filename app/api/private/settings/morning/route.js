import { notifyOn, sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { fmtMin } from '../../../../../lib/habits.js'
import { habitsStore } from '../../../../../lib/habits-store.js'
import { MORNING_AT, SLOTS, cleanPrefs } from '../../../../../lib/morning.js'
import { zoneOf } from '../../../../../lib/reminders.js'
import { remindersStore } from '../../../../../lib/reminders-store.js'

// The owner's daily summaries switch (Settings › Notifications; the summaries themselves: lib/morning.js and their sender
// lib/morning-summary.js), in the owner-only zone like the notifications next door (lib/gate.js ownerOf: the proxy's
// /api/private/settings location, Authelia login included). It's a notice of the hub, so it's off (404) whenever the
// hub is (lib/gate.js notifyOn), and the Settings sheet shows no switch then. Kept in the database
// (lib/reminders-store.js prefs), not in the browser's settings: the server's ticker reads it each time.
//   GET                   -> { morning (on: the three summaries; off: only Reminders' own 06:00 notice, with something
//                              open), at ('06:00': the morning one), times (['06:00', '13:00', '18:00']), tz (the
//                              owner's zone: the Habits doc's) }
//   PUT { morning }       on / off -> the same (another tab's sheet asks again each time it opens)
// 404 = off / not set up, 403 = someone else, 400 = a bad body ({ error, field }), 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 1024
const owner = (request) => (notifyOn() ? syncOwner(request) : 404)

async function state(who, prefs) {
  const [p, doc] = await Promise.all([prefs ?? remindersStore().prefs(who), habitsStore().getDoc(who)])
  return { morning: p.morning, at: fmtMin(MORNING_AT), times: SLOTS.map((s) => fmtMin(s.at)), tz: zoneOf(doc) }
}

export async function GET(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no morning summary' }, who)
  try {
    return json(await state(who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function PUT(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no morning summary' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let b
  try {
    b = JSON.parse(text)
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  const c = cleanPrefs(b)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  try {
    const p = await remindersStore().setPrefs(who, { morning: c.morning })
    return json(await state(who, p))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
