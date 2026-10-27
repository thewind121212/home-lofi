// One sentence -> a reminder, the way the Reminders box adds one (app/api/private/settings/reminders/timed) and the
// way the owner's assistant does (app/api/private/assistant/remind): the reminders API's model reads it (lib/timed.js
// parsedTime); with a time it's saved there, without one it goes on the carry-over list as typed (the model's title
// would be its Vietnamese). With the reminders API off (no REMIND_URL), or `plain`, straight onto the carry-over list.
// Server-only (the database, the network).
import { randomBytes } from 'node:crypto'
import { localNow } from './habits.js'
import { habitsStore } from './habits-store.js'
import { MAX_OPEN, zoneOf } from './reminders.js'
import { remindersStore } from './reminders-store.js'
import { parsedTime } from './timed.js'
import { timedApi, timedOn } from './timed-fetch.js'

// -> { added: { kind: 'timed' | 'todo', title, due?, allDay?, repeat? } } | { status, error, plain? }
//   409: the carry-over list is full; 502 / 404: the reminders API (down / gone); 503: the database, or the model
//   couldn't read the sentence (plain: true: it can still go on the list without a time)
export async function addSentence(who, text, plain = false) {
  let timed = null
  if (!plain && timedOn()) {
    try {
      timed = parsedTime(await timedApi.parse(text))
    } catch {
      return { status: 503, error: "couldn't read a time in that: try again, or save it without a time", plain: true }
    }
  }
  if (timed) {
    try {
      const i = await timedApi.create(timed)
      return { added: { kind: 'timed', title: i.title, due: i.due, allDay: i.allDay, repeat: i.repeat } }
    } catch (e) {
      return e?.status === 404 ? { status: 404, error: 'that reminder is gone' } : { status: 502, error: 'the reminders service is unreachable: try again in a moment' }
    }
  }
  try {
    const ms = Date.now()
    const day = localNow(ms, zoneOf(await habitsStore().getDoc(who))).day
    if (!(await remindersStore().add(who, { id: randomBytes(6).toString('hex'), text, day, at: ms }, MAX_OPEN)))
      return { status: 409, error: `at most ${MAX_OPEN} open: get some done first` }
    return { added: { kind: 'todo', title: text } }
  } catch {
    return { status: 503, error: 'database unavailable' }
  }
}
