// Reminders' 06:00 notice (rules in lib/reminders.js): a check once a minute in the server (instrumentation.js starts
// it, next to Habits' ticker), sent through the notification hub like any other notice (lib/notify-store.js), so it
// sits in the inbox, pops up on the owner's open pages and buzzes the owner's phones (lib/push.js). Server-only.
// One a day at most, and only with something open: its key (todo:<day>) is claimed in the database before it goes,
// so a restart, two ticks in the same minute or a second server never send it twice; a send that fails gives it back.
import { notifyOn } from './gate.js'
import { habitsStore } from './habits-store.js'
import { localNow } from './habits.js'
import { liveBus } from './live.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'
import { pushNotice } from './push.js'
import { NUDGE_AT, NUDGE_LATE, nudgeKey, nudgeNotice, zoneOf } from './reminders.js'
import { remindersStore } from './reminders-store.js'

export const TICK_MS = 60_000

// One check -> the key it sent, or null
export async function nudgeTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!notifyOn()) return null // (the hub needs the token, the database and the owner)
  const now = localNow(ms, zoneOf(await habitsStore().getDoc(owner)))
  // most minutes it isn't the morning: the reminders aren't even read then
  if (now.min < NUDGE_AT || now.min >= NUDGE_AT + NUDGE_LATE) return null
  const store = remindersStore()
  const items = await store.open(owner)
  const key = nudgeKey(now, items.length)
  if (!key) return null
  let mine = false
  let sent = false
  try {
    mine = await store.claimNudge(owner, key)
    if (!mine) return null
    const c = cleanNotice(nudgeNotice(items, now))
    if (c.error) throw new Error(c.error)
    await notifyStore().add(c.notice)
    sent = true
    void pushNotice(owner, c.notice) // and to the owner's phones, in the background
    liveBus().publish(owner, { kind: 'notify', at: ms })
    await store.sentNudge(owner, key)
    store.prune().catch(() => {})
  } catch {
    // not sent: give the key back if we can (if not, its claim lapses and a later tick in the window sends it).
    // Sent but not marked (the database went away in between): at worst a second one that morning, never none
    if (mine && !sent) await store.releaseNudge(owner, key).catch(() => {})
  }
  return sent ? key : null
}

// The ticker: on the minute (a few seconds past), for as long as the server runs. Once per process
export function startNudges() {
  if (globalThis.__homeRemindersNudge) return
  globalThis.__homeRemindersNudge = true
  const run = () => nudgeTick().catch(() => {}) // the database away for a minute: the next tick tries again
  const first = setTimeout(() => {
    run()
    setInterval(run, TICK_MS).unref?.()
  }, TICK_MS - (Date.now() % TICK_MS) + 2_000)
  first.unref?.()
}
