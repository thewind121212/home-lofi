// Habits' reminders (rules in lib/habits.js): a check once a minute in the server (instrumentation.js starts it), sent
// through the notification hub like any other notice (lib/notify-store.js), so they pop up on the owner's open pages,
// sit in the inbox and show on the lock screen. Server-only.
// Each reminder's key is claimed in the database before it goes (habit_reminders): a restart, two ticks in the same
// minute, or a second server can never send it twice; a send that fails gives the key back for the next tick.
import { notifyOn } from './gate.js'
import { addDays, localNow, remindersDue, startNotice, weekNotice } from './habits.js'
import { habitsStore } from './habits-store.js'
import { liveBus } from './live.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'

export const TICK_MS = 60_000

// One check: what's due now for the owner, claimed and sent. -> the keys it sent
export async function remindTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!owner || !process.env.DATABASE_URL || !notifyOn()) return []
  const store = habitsStore()
  const doc = await store.getDoc(owner)
  if (!doc?.habits?.length) return []
  const now = localNow(ms, doc.tz)
  const week = await store.checkins(owner, addDays(now.day, -6))
  const kept = new Set(week.filter((c) => c.day === now.day && c.undoneAt == null).map((c) => c.habitId))
  const sent = []
  for (const r of remindersDue(doc, kept, now)) {
    if (!(await store.claimReminder(owner, r.key))) continue
    try {
      const c = cleanNotice(r.kind === 'start' ? startNotice(r.habit, now) : weekNotice(doc, week, now.day))
      if (c.error) throw new Error(c.error)
      await notifyStore().add(c.notice)
      sent.push(r.key)
    } catch {
      await store.releaseReminder(owner, r.key).catch(() => {})
    }
  }
  if (sent.length) liveBus().publish(owner, { kind: 'notify', at: ms })
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
