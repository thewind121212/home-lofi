// Habits' reminders (rules in lib/habits.js): a check once a minute in the server (instrumentation.js starts it), sent
// through the notification hub like any other notice (lib/notify-store.js), so they pop up on the owner's open pages,
// sit in the inbox, show on the lock screen, and buzz the owner's phones (lib/push.js). Server-only.
// Each reminder's key is claimed in the database before it goes (habit_reminders): a restart, two ticks in the same
// minute, or a second server can never send it twice; a send that fails gives the key back for the next tick.
import { notifyOn } from './gate.js'
import { addDays, localNow, remindersDue, startNotice, weekNotice } from './habits.js'
import { habitsStore } from './habits-store.js'
import { liveBus } from './live.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'
import { pushNotice } from './push.js'

export const TICK_MS = 60_000

// One check: what's due now for the owner, claimed and sent. -> the keys it sent
export async function remindTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!notifyOn()) return [] // (the hub needs the token, the database and the owner)
  const store = habitsStore()
  const doc = await store.getDoc(owner)
  if (!doc?.habits?.length) return []
  const now = localNow(ms, doc.tz)
  // most minutes nothing is due: no check-ins read then
  if (!remindersDue(doc, new Set(), now).length) return []
  const week = await store.checkins(owner, addDays(now.day, -6))
  const kept = new Set(week.filter((c) => c.day === now.day && c.undoneAt == null).map((c) => c.habitId))
  const sent = []
  for (const r of remindersDue(doc, kept, now)) {
    let mine = false
    try {
      mine = await store.claimReminder(owner, r.key)
      if (!mine) continue
      const c = cleanNotice(r.kind === 'start' ? startNotice(r.habit, now) : weekNotice(doc, week, now.day))
      if (c.error) throw new Error(c.error)
      await notifyStore().add(c.notice)
      sent.push(r.key)
      await store.sentReminder(owner, r.key)
      void pushNotice(owner, c.notice) // and to the owner's phones (lib/push.js), in the background
    } catch {
      // not sent (or not marked): give the key back if we can; if not, its claim lapses and a later tick sends it
      if (mine && !sent.includes(r.key)) await store.releaseReminder(owner, r.key).catch(() => {})
    }
  }
  if (sent.length) {
    liveBus().publish(owner, { kind: 'notify', at: ms })
    store.pruneReminders().catch(() => {})
  }
  return sent
}

// The ticker: on the minute (a few seconds past, so 06:10 is 06:10), for as long as the server runs. Once per process
export function startReminders() {
  if (globalThis.__homeHabitsReminders) return
  globalThis.__homeHabitsReminders = true
  const run = () => remindTick().catch(() => {}) // the database away for a minute: the next tick tries again
  const first = setTimeout(() => {
    run()
    setInterval(run, TICK_MS).unref?.()
  }, TICK_MS - (Date.now() % TICK_MS) + 2_000)
  first.unref?.()
}
