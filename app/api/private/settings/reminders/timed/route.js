import { randomBytes } from 'node:crypto'
import { notifyOn, sameOriginJson, syncOwner } from '../../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../../lib/live.js'
import { localNow } from '../../../../../../lib/habits.js'
import { habitsStore } from '../../../../../../lib/habits-store.js'
import { MAX_OPEN, MAX_TEXT, zoneOf } from '../../../../../../lib/reminders.js'
import { remindersStore } from '../../../../../../lib/reminders-store.js'
import { notifyStore } from '../../../../../../lib/notify-store.js'
import { HISTORY, cleanTimedAction, dueTag, parsedTime } from '../../../../../../lib/timed.js'
import { timedApi, timedOn } from '../../../../../../lib/timed-fetch.js'

// Reminders with a time (lib/timed.js), for the owner's Reminders sheet and pop-up (app/timed.js). This server is
// the go-between: the reminders API (REMIND_URL) is on the LAN with no login of its own, so the browser never sees it.
// Owner-only like the carry-over list next door (lib/gate.js ownerOf; the proxy's /api/private/settings location).
//   GET               -> { now, items: the open ones }
//   GET ?history=1    -> { done: the newest HISTORY done ones of both lists, newest first: [{ kind: 'timed' | 'todo',
//                         id, title, doneAt, repeat? }] }
//   POST { action: 'add', text }   the model reads the sentence (a few seconds when it's waking): with a time it's saved
//                                  in the API; without one it goes on the carry-over list as typed. -> { added: { kind,
//                                  title, due?, allDay?, repeat? }, now, items }. plain: true = the carry-over list
//                                  straight away (the model failed: "save without a time")
//        { action: 'done' | 'reopen' | 'delete' | 'snooze' | 'edit', id, … }  (lib/timed.js cleanTimedAction)
//   -> the fresh { now, items }; the owner's other tabs hear 'reminders' and pull. Done, snooze, delete and edit take
//   its due notice off the bell (the next time it rings brings a new one).
// 404 = not set up (no REMIND_URL, no gate / database), 403 = someone else, 400 = a bad body, 409 = the list is full,
// 502 = the API is down or answered oddly, 503 { plain: true } = the model couldn't read the sentence (try again, or
// save it without a time).
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 4096
const owner = (request) => (timedOn() ? syncOwner(request) : 404)
const down = (e) => json({ error: e?.status === 404 ? 'that reminder is gone' : 'the reminders service is unreachable: try again in a moment' }, e?.status === 404 ? 404 : 502)
const tell = (who, request) => liveBus().publish(who, { kind: 'reminders', at: Date.now(), from: clientId(request.headers.get('x-home-client')) })
// its due notice is done with: off the inbox, the lock screen and the pop-ups
async function unring(who, id) {
  if (!notifyOn()) return
  if (await notifyStore().dropTag(dueTag(id)).catch(() => false)) liveBus().publish(who, { kind: 'notify', at: Date.now() })
}

export async function GET(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no timed reminders' }, who)
  try {
    if (new URL(request.url).searchParams.get('history') !== '1') return json(await timedApi.open())
    const [timed, todo] = await Promise.all([timedApi.done(HISTORY), remindersStore().doneList(who, HISTORY).catch(() => [])])
    const done = [
      ...timed.map((i) => ({ kind: 'timed', id: i.id, title: i.title, doneAt: i.doneAt, repeat: i.repeat })),
      ...todo.map((i) => ({ kind: 'todo', id: i.id, title: i.text, doneAt: i.doneAt })),
    ]
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
      .slice(0, HISTORY)
    return json({ done })
  } catch (e) {
    return down(e)
  }
}

export async function POST(request) {
  const who = owner(request)
  if (typeof who === 'number') return json({ error: 'no timed reminders' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  const c = cleanTimedAction(raw, MAX_TEXT)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  const { action, id } = c.act
  let added = null
  if (action === 'add') {
    let timed = null
    if (!c.act.plain) {
      try {
        timed = parsedTime(await timedApi.parse(c.act.text))
      } catch {
        return json({ error: "couldn't read a time in that: try again, or save it without a time", plain: true }, 503)
      }
    }
    if (timed) {
      try {
        const i = await timedApi.create(timed)
        added = { kind: 'timed', title: i.title, due: i.due, allDay: i.allDay, repeat: i.repeat }
      } catch (e) {
        return down(e)
      }
    } else {
      // no time in it: the carry-over list, as typed (the model's title would be its Vietnamese)
      try {
        const ms = Date.now()
        const day = localNow(ms, zoneOf(await habitsStore().getDoc(who))).day
        if (!(await remindersStore().add(who, { id: randomBytes(6).toString('hex'), text: c.act.text, day, at: ms }, MAX_OPEN)))
          return json({ error: `at most ${MAX_OPEN} open: get some done first` }, 409)
        added = { kind: 'todo', title: c.act.text }
      } catch {
        return json({ error: 'database unavailable' }, 503)
      }
    }
  } else {
    try {
      if (action === 'done') await timedApi.doneOne(id)
      else if (action === 'reopen') await timedApi.reopen(id)
      else if (action === 'delete') await timedApi.remove(id)
      else if (action === 'snooze') await timedApi.snooze(id, c.act.minutes)
      else await timedApi.edit(id, c.act.patch)
    } catch (e) {
      if (e?.status === 400) return json({ error: e.message }, 400)
      return down(e)
    }
    if (action !== 'reopen') await unring(who, id)
  }
  tell(who, request)
  try {
    return json({ ...(added && { added }), ...(await timedApi.open()) })
  } catch {
    return json({ ...(added && { added }), stale: true }) // (done, but the list couldn't be read back: the page pulls)
  }
}
