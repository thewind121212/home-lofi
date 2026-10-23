import { randomBytes } from 'node:crypto'
import { notifyOn, sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { localNow } from '../../../../../lib/habits.js'
import { habitsStore } from '../../../../../lib/habits-store.js'
import { MAX_OPEN, NUDGE_AT, canUndo, cleanAction, cleanId, nudgeTag, popupDue, zoneOf } from '../../../../../lib/reminders.js'
import { remindersStore } from '../../../../../lib/reminders-store.js'
import { notifyStore } from '../../../../../lib/notify-store.js'

// The owner's reminders (app/reminders.js), in the owner-only zone like Habits next door (lib/gate.js ownerOf): the
// proxy's /api/private/settings location covers this path, Authelia login included. Guests get 404 / 403 and the page
// shows nothing (no card, no pop-up).
//   GET                                -> the state below
//   POST { action: 'add', text }       a new one (409 at MAX_OPEN open)
//        { action: 'done', id }        held done: off the list (409: done already, by another tab / device)
//        { action: 'undo', id }        right after done (UNDO_MS): back on the list
//        { action: 'reopen', id }      a done one back on the list, any time later (the sheet's Done section; 409 at MAX_OPEN)
//   DELETE { id }                      a mistaken entry, gone for good (not "done": it never was)
//   -> the fresh state { tz, today, now (minutes since midnight), at (the server's ms), due (the pop-up's hours have
//      begun: 06:00 in the owner's zone), from (06:00 in minutes), max, items (the open ones, oldest first) }; the
//      owner's other tabs hear 'reminders' on the live stream and pull.
// Every time is the server's: the day a reminder was added, when it was done, the undo window, and whether the pop-up
// is due. The page only says what was done.
// 404 = not set up (no gate / no database), 403 = someone else, 400 = a bad body ({ error, field }), 409 = not possible
// now (fresh state with it), 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 4096
const mkId = () => randomBytes(6).toString('hex')

// the owner's zone (the Habits doc's) and the moment, as the owner's calendar sees it
const clock = async (who, ms) => {
  const tz = zoneOf(await habitsStore().getDoc(who))
  return { tz, now: localNow(ms, tz) }
}
async function state(who, ms = Date.now(), c) {
  c ??= await clock(who, ms)
  const items = await remindersStore().open(who)
  return { tz: c.tz, today: c.now.day, now: c.now.min, at: ms, due: popupDue(c.now), from: NUDGE_AT, max: MAX_OPEN, items }
}
const tell = (who, request) => liveBus().publish(who, { kind: 'reminders', at: Date.now(), from: clientId(request.headers.get('x-home-client')) })
// nothing left open: this morning's notice is done with (off the inbox and the lock screen; the pages hear 'notify')
async function allDone(who, st) {
  if (st.items.length || !notifyOn()) return
  if (await notifyStore().dropTag(nudgeTag(st.today)).catch(() => false)) liveBus().publish(who, { kind: 'notify', at: st.at })
}

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
  if (typeof who === 'number') return json({ error: 'no reminders' }, who)
  try {
    return json(await state(who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function POST(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no reminders' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  const c = cleanAction(b.value)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  const { action, id } = c.act
  try {
    const store = remindersStore()
    const ms = Date.now() // the one clock that counts
    const k = await clock(who, ms)
    const conflict = async (error) => json({ error, ...(await state(who, ms, k)) }, 409)
    if (action === 'add') {
      if (!(await store.add(who, { id: mkId(), text: c.act.text, day: k.now.day, at: ms }, MAX_OPEN))) return conflict(`at most ${MAX_OPEN} open: get some done first`)
    } else if (action === 'done') {
      // done already (another tab, a stale one, two holds at once): the first one stands
      if (!(await store.done(who, id, ms))) return conflict('already done (or gone)')
    } else if (action === 'reopen') {
      if (!(await store.reopen(who, id, MAX_OPEN))) return conflict(`can't bring it back: not done, gone, or ${MAX_OPEN} open already`)
    } else {
      const cur = await store.get(who, id)
      const gone = 'the undo window has passed'
      if (!cur || cur.doneAt == null || !canUndo(cur.doneAt, ms)) return conflict(gone)
      if (!(await store.undo(who, id, cur.doneAt))) return conflict(gone) // it changed meanwhile
    }
    tell(who, request)
    const st = await state(who, ms, k)
    if (action === 'done') await allDone(who, st)
    return json(st)
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function DELETE(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no reminders' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  const id = b.value?.id
  if (!cleanId(id)) return json({ error: 'id: a reminder id', field: 'id' }, 400)
  try {
    const ms = Date.now()
    if (!(await remindersStore().remove(who, id))) return json({ error: 'already gone (or done)', ...(await state(who, ms)) }, 409)
    tell(who, request)
    const st = await state(who, ms)
    await allDone(who, st)
    return json(st)
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
