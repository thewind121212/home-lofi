import { randomBytes } from 'node:crypto'
import { notifyOn, sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { habitsStore } from '../../../../../lib/habits-store.js'
import { PRESET_IDS, act, cleanAction, dayOf, minuteMs, noticeTag } from '../../../../../lib/focus.js'
import { focusStore } from '../../../../../lib/focus-store.js'
import { armFocus } from '../../../../../lib/focus-ticker.js'
import { notifyStore } from '../../../../../lib/notify-store.js'
import { zoneOf } from '../../../../../lib/reminders.js'

// The owner's focus session (app/focus.js; rules in lib/focus.js), in the owner-only zone like Reminders next door
// (lib/gate.js ownerOf): the proxy's /api/private/settings location covers this path, Authelia login included. Guests
// get 404 / 403 and the page shows nothing (no icon, no chip).
//   GET                                  -> the state below
//   POST { action: 'start', preset }      a fresh session ('25/5' | '50/10'; one running is replaced)
//        { action: 'pause' | 'resume' }   the time left kept / running on from there (409: already so)
//        { action: 'skip' }               this phase ends now (not counted), the next one runs
//        { action: 'stop' }               no session (its notice leaves the inbox)
//   -> the fresh state { session (lib/focus.js; null: none), today: { day, n (🍅) }, now (the server's ms: the page
//      keeps its clock's difference, never trusting its own), tz, minute (a minute's ms: 60000), presets }; the
//      owner's other tabs hear 'focus' on the live stream and pull. The phase changes themselves are the server's
//      (lib/focus-ticker.js), re-armed here after every change.
// 404 = not set up (no gate / no database), 403 = someone else, 400 = a bad body ({ error, field }), 409 = not possible
// now (fresh state with it), 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 1024
const TRIES = 3 // a write that lost to another (the ticker, another tab) reads again and retries this often
const mkId = () => randomBytes(6).toString('hex')

async function state(who, ms = Date.now(), cur) {
  const tz = zoneOf(await habitsStore().getDoc(who))
  const day = dayOf(ms, tz)
  const store = focusStore()
  const [session, n] = await Promise.all([cur !== undefined ? cur : store.get(who).then((r) => r.session), store.count(who, day)])
  return { session, today: { day, n }, now: Date.now(), tz, minute: minuteMs(), presets: PRESET_IDS }
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
  if (typeof who === 'number') return json({ error: 'no focus' }, who)
  try {
    return json(await state(who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function POST(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no focus' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  const c = cleanAction(b.value)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  try {
    const store = focusStore()
    for (let i = 0; i < TRIES; i++) {
      const ms = Date.now() // the one clock that counts
      const { rev, session: cur } = await store.get(who)
      const r = act(cur, c.act, ms, { id: mkId(), minute: minuteMs() })
      if (r.error) return json({ error: r.error, ...(await state(who, ms, cur)) }, 409)
      if ((await store.put(who, rev, r.session)) == null) continue // moved meanwhile (the ticker, another tab): again
      liveBus().publish(who, { kind: 'focus', at: ms, from: clientId(request.headers.get('x-home-client')) })
      armFocus(r.session)
      // stopped (or replaced by a fresh one): the old session's notice leaves the inbox
      if (cur && cur.id !== r.session?.id && notifyOn() && (await notifyStore().dropTag(noticeTag(cur.id)).catch(() => false))) liveBus().publish(who, { kind: 'notify', at: ms })
      return json(await state(who, ms, r.session))
    }
    return json({ error: 'busy: try again', ...(await state(who)) }, 409)
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
