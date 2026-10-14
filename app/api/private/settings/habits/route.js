import { randomBytes } from 'node:crypto'
import { notifyOn, sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { BACK_DAYS, DEFAULT_TZ, STREAK_DAYS, addDays, canUndo, checkable, cleanAction, cleanDelete, cleanDoc, isLate, localNow, streakOf, validTz } from '../../../../../lib/habits.js'
import { HISTORY_DAYS, habitsStore } from '../../../../../lib/habits-store.js'
import { notifyStore } from '../../../../../lib/notify-store.js'

// The owner's habits (app/habits.js), in the owner-only zone like the settings next door (lib/gate.js ownerOf): the
// proxy's /api/private/settings location covers this path, Authelia login included. Guests get 404 / 403 and the page
// shows no card.
//   GET                                       -> the state below
//   PUT  { tz, habits }                       the editor's whole list (lib/habits.js cleanDoc)
//   POST { action: 'check', habitId, day, rating? }    kept (held on the card)
//        { action: 'rate', habitId, day, rating, note? }
//        { action: 'undo', habitId, day }      right after a check (UNDO_MS): as if it never happened
//        { action: 'untick', habitId, day, reason }   later: taken back, with why
//   DELETE { habitId, confirm: 'delete' }   an archived habit for good, its check-ins and reminders too (409: archive
//                                           it first)
//   -> the fresh state { tz, today, now (minutes since midnight), at (the server's ms: the card runs its chips on this
//      clock, not the device's), habits, checkins (the last HISTORY_DAYS), streaks ({ id: { count, atRisk } }) }; the
//      owner's other tabs hear
//      'habits' on the live stream and pull.
// Every time is the server's: when it was kept, which day "today" is, on time or late, the undo window. The page only
// says what was done; it never sends a time.
// 404 = not set up (no gate / no database), 403 = someone else, 400 = a bad body ({ error, field }), 409 = not
// possible now (not that day / already kept / the undo window passed / nothing to rate), 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 32_768 // 20 habits are ~6 KB
const mkId = () => randomBytes(6).toString('hex')

const EMPTY = { tz: DEFAULT_TZ, habits: [] }
// doc: the habits doc when the caller has it already (one read less)
async function state(store, who, ms = Date.now(), doc) {
  doc ??= (await store.getDoc(who)) ?? EMPTY
  const now = localNow(ms, doc.tz)
  const [checkins, done] = await Promise.all([store.checkins(who, addDays(now.day, -HISTORY_DAYS)), store.doneDays(who, addDays(now.day, -STREAK_DAYS))])
  // never miss twice, over the whole streak window (the card only gets HISTORY_DAYS of check-ins)
  const days = new Map()
  for (const d of done) (days.get(d.habitId) ?? days.set(d.habitId, new Set()).get(d.habitId)).add(d.day)
  const streaks = Object.fromEntries(doc.habits.filter((h) => !h.archived).map((h) => [h.id, streakOf(h, days.get(h.id) ?? new Set(), now.day)]))
  return { tz: doc.tz, today: now.day, now: now.min, at: ms, habits: doc.habits, checkins, streaks }
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
    // checked against the stored list with its row locked: two saves at once go one after the other
    const c = await store.updateDoc(who, (stored) => {
      const old = stored ?? EMPTY
      // (the zone is checked before it's used: a bad one is the editor's 400, not a 503)
      const tz = b.value?.tz ?? old.tz
      if (!validTz(tz)) return { error: 'tz: an IANA time zone', field: 'tz' }
      return cleanDoc(b.value, { old, today: localNow(Date.now(), tz).day, mkId })
    })
    if (c.error) return json({ error: c.error, field: c.field }, 400)
    tell(who, request)
    return json(await state(store, who, Date.now(), c.doc))
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
    const conflict = async (error) => json({ error, ...(await state(store, who, ms, doc)) }, 409)
    if (action === 'check') {
      if (!checkable(habit, day, now)) return conflict(`day: today or up to ${BACK_DAYS} days back, while the habit exists`)
      // already kept (another tab, a stale one, two holds at once): the first record stands, its time and its rating
      if (!(await store.check(who, { habitId, day, at: ms, late: isLate(habit, day, now), rating: c.act.rating ?? null }))) return conflict('already kept that day')
      // its reminder ("Workout in 5 min … hold to keep it") is done with: off the inbox and the lock screen
      if (day === now.day && notifyOn() && (await notifyStore().dropTag(`habit:${habitId}`).catch(() => false))) liveBus().publish(who, { kind: 'notify', at: ms })
    } else if (action === 'rate') {
      if (!(await store.rate(who, { habitId, day, rating: c.act.rating, note: c.act.note }))) return conflict('not kept that day')
    } else if (action === 'undo') {
      const cur = await store.get(who, habitId, day)
      const gone = 'the undo window has passed: take it back with a reason'
      if (!cur || cur.undoneAt != null || !canUndo(cur.doneAt, ms)) return conflict(gone)
      if (!(await store.remove(who, habitId, day, cur.doneAt))) return conflict(gone) // it changed meanwhile
    } else {
      if (!(await store.untick(who, { habitId, day, at: ms, reason: c.act.reason }))) return conflict('not kept that day')
    }
    tell(who, request)
    return json(await state(store, who, ms, doc))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function DELETE(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no habits' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  const c = cleanDelete(b.value)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  try {
    const store = habitsStore()
    const out = await store.deleteHabit(who, c.habitId)
    if (out.error === 'none') return json({ error: 'habitId: no such habit', field: 'habitId' }, 400)
    if (out.error === 'active') return json({ error: 'archive it first', ...(await state(store, who)) }, 409)
    // a reminder of it still in the inbox / on the lock screen goes too
    if (notifyOn() && (await notifyStore().dropTag(`habit:${c.habitId}`).catch(() => false))) liveBus().publish(who, { kind: 'notify', at: Date.now() })
    tell(who, request)
    return json(await state(store, who, Date.now(), out.doc))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
