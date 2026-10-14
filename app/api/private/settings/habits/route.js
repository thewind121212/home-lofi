import { randomBytes } from 'node:crypto'
import { sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { BACK_DAYS, DEFAULT_TZ, addDays, canUndo, checkable, cleanAction, cleanDoc, isLate, localNow } from '../../../../../lib/habits.js'
import { HISTORY_DAYS, habitsStore } from '../../../../../lib/habits-store.js'

// The owner's habits (app/habits.js), in the owner-only zone like the settings next door (lib/gate.js ownerOf): the
// proxy's /api/private/settings location covers this path, Authelia login included. Guests get 404 / 403 and the page
// shows no card.
//   GET                                       -> the state below
//   PUT  { tz, habits }                       the editor's whole list (lib/habits.js cleanDoc)
//   POST { action: 'check', habitId, day, rating? }    kept (held on the card)
//        { action: 'rate', habitId, day, rating, note? }
//        { action: 'undo', habitId, day }      right after a check (UNDO_MS): as if it never happened
//        { action: 'untick', habitId, day, reason }   later: taken back, with why
//   -> the fresh state { tz, today, now (minutes since midnight), at (the server's ms: the card runs its chips on this
//      clock, not the device's), habits, checkins (the last HISTORY_DAYS) }; the owner's other tabs hear
//      'habits' on the live stream and pull.
// Every time is the server's: when it was kept, which day "today" is, on time or late, the undo window. The page only
// says what was done; it never sends a time.
// 404 = not set up (no gate / no database), 403 = someone else, 400 = a bad body ({ error, field }), 409 = not
// possible now (not that day / the undo window passed / nothing to rate), 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 32_768 // 20 habits are ~6 KB
const mkId = () => randomBytes(6).toString('hex')

const EMPTY = { tz: DEFAULT_TZ, habits: [] }
async function state(store, who, ms = Date.now()) {
  const doc = (await store.getDoc(who)) ?? EMPTY
  const now = localNow(ms, doc.tz)
  const checkins = await store.checkins(who, addDays(now.day, -HISTORY_DAYS))
  return { tz: doc.tz, today: now.day, now: now.min, at: ms, habits: doc.habits, checkins }
}
const tell = (who, request) => liveBus().publish(who, { kind: 'habits', at: Date.now(), from: clientId(request.headers.get('x-home-client')) })

async function body(request) {
  const text = await request.text()
  if (text.length > MAX_BODY) return { status: 413, out: { error: 'too large' } }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return { status: 400, out: { error: 'not JSON' } }
  }
}

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no habits' }, who)
  try {
    return json(await state(habitsStore(), who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function PUT(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no habits' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  try {
    const store = habitsStore()
    const old = (await store.getDoc(who)) ?? EMPTY
    const c = cleanDoc(b.value, { old, today: localNow(Date.now(), b.value?.tz ?? old.tz).day, mkId })
    if (c.error) return json({ error: c.error, field: c.field }, 400)
    await store.putDoc(who, c.doc)
    tell(who, request)
    return json(await state(store, who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function POST(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no habits' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  const c = cleanAction(b.value)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  const { action, habitId, day } = c.act
  try {
    const store = habitsStore()
    const ms = Date.now() // the one clock that counts
    const doc = (await store.getDoc(who)) ?? EMPTY
    const habit = doc.habits.find((h) => h.id === habitId)
    if (!habit) return json({ error: 'habitId: no such habit', field: 'habitId' }, 400)
    const now = localNow(ms, doc.tz)
    const conflict = async (error) => json({ error, ...(await state(store, who, ms)) }, 409)
    if (action === 'check') {
      if (!checkable(habit, day, now)) return conflict(`day: today or up to ${BACK_DAYS} days back, while the habit exists`)
      await store.check(who, { habitId, day, at: ms, late: isLate(habit, day, now), rating: c.act.rating ?? null })
    } else if (action === 'rate') {
      if (!(await store.rate(who, { habitId, day, rating: c.act.rating, note: c.act.note }))) return conflict('not kept that day')
    } else if (action === 'undo') {
      const cur = await store.get(who, habitId, day)
      if (!cur || cur.undoneAt != null || !canUndo(cur.doneAt, ms)) return conflict('the undo window has passed: take it back with a reason')
      await store.remove(who, habitId, day)
    } else {
      if (!(await store.untick(who, { habitId, day, at: ms, reason: c.act.reason }))) return conflict('not kept that day')
    }
    tell(who, request)
    return json(await state(store, who, ms))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
