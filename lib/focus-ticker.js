// Focus sessions' phase changes (rules in lib/focus.js), made by the SERVER, so the phone buzzes at the end of a focus
// phase even with every page closed. Server-only; instrumentation.js starts it next to the daily summaries' ticker.
//
// When the owner's running phase ends: focus -> a break (it starts by itself), 🍅 +1, a notice in the hub ("Focus done
// · 5 min break") and a push to the owner's phones (lib/push.js pushNotice, exactly like lib/morning-summary.js); break
// -> focus again ("Break over · back to focus"). Every open page hears 'focus' on the live stream and pulls the new
// state (the pages chime themselves, on the second, from their own countdown: app/focus.js).
// Once each: the change's key (focus:<id>:<round>:<phase>) is claimed in the database first, and the new state is
// written only if the session is still the one that was read (lib/focus-store.js put: its rev), so a restart, two
// ticks at once, a second server, or the owner pressing Pause in the same instant never count or buzz twice.
//
// On time: a timer set to the running phase's end (re-armed after every change: the route calls armFocus(), and after
// each tick and on start), plus a check once a minute in case a timer was lost (another server made the change, the
// clock jumped). Pushes land within a second or two of the end.
import { notifyOn } from './gate.js'
import { habitsStore } from './habits-store.js'
import { liveBus } from './live.js'
import { advance, dayOf, ended, minuteMs, phaseNotice, running, transitionKey } from './focus.js'
import { focusStore } from './focus-store.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'
import { pushNotice } from './push.js'
import { zoneOf } from './reminders.js'

export const CHECK_MS = 60_000 // the fallback check
export const ARM_SLACK = 50 // the timer fires this long after the end (never a hair early)
const MAX_TIMER = 2 ** 31 - 1 // setTimeout's longest

// One check -> the key of the change it made, or null (nothing ended, someone else made it, the session moved)
export async function focusTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!process.env.DATABASE_URL || !owner) return null
  const store = focusStore()
  const { rev, session } = await store.get(owner)
  if (!ended(session, ms)) return null
  const key = transitionKey(session)
  if (!(await store.claim(owner, key))) return null
  let moved = false
  try {
    const tz = zoneOf(await habitsStore().getDoc(owner).catch(() => null))
    const { session: next, counted } = advance(session, ms, minuteMs())
    const day = dayOf(counted ? session.phaseEndsAt : ms, tz)
    // only if nothing moved since the read (a Pause / Stop / Skip just now wins: it's newer than this tick's view)
    if ((await store.put(owner, rev, next, { count: counted ? day : null })) == null) {
      await store.release(owner, key)
      return null
    }
    moved = true
    liveBus().publish(owner, { kind: 'focus', at: ms })
    armFocus(next)
    if (notifyOn()) {
      const c = cleanNotice(phaseNotice(session, next, { count: await store.count(owner, day).catch(() => 0), tz }))
      if (!c.error) {
        await notifyStore().add(c.notice)
        void pushNotice(owner, c.notice) // to the owner's phones, in the background
        liveBus().publish(owner, { kind: 'notify', at: ms })
      }
    }
  } catch {
    // not made: give the key back (if that fails too, its claim lapses and a later check makes it)
    if (!moved) await store.release(owner, key).catch(() => {})
  } finally {
    // made (the notice may have failed: the change itself stands, and its key must not be made again)
    if (moved) {
      await store.sent(owner, key).catch(() => {})
      store.prune().catch(() => {})
    }
  }
  return moved ? key : null
}

const run = () =>
  focusTick()
    .catch(() => null)
    .then(() => rearm())

// read the session and set the timer to its end (the fallback check and the start)
async function rearm() {
  if (!globalThis.__homeFocusTicker) return
  const owner = process.env.OWNER_USER
  if (!process.env.DATABASE_URL || !owner) return
  const { session } = await focusStore().get(owner).catch(() => ({ session: undefined }))
  if (session !== undefined) armFocus(session)
}

// The timer to this session's phase end (null / paused: none). The route calls it after each change; a no-op until
// startFocus() has run (the tests, a build)
export function armFocus(session, now = Date.now()) {
  const t = globalThis.__homeFocusTicker
  if (!t) return
  clearTimeout(t.timer)
  t.timer = null
  if (!running(session)) return
  t.timer = setTimeout(run, Math.min(MAX_TIMER, Math.max(0, session.phaseEndsAt - now) + ARM_SLACK))
  t.timer.unref?.()
}

// The ticker: once per process, for as long as the server runs. A first check a moment after the start (a phase that
// ended while the server was down is changed then), the timer, and the minute's fallback
export function startFocus() {
  if (globalThis.__homeFocusTicker) return
  const t = (globalThis.__homeFocusTicker = { timer: null })
  const first = setTimeout(() => {
    run()
    setInterval(run, CHECK_MS).unref?.()
  }, 3_000)
  first.unref?.()
  return t
}
