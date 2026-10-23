// Timed reminders' due notices (rules in lib/timed.js): every TICK_MS the server asks the reminders API what's due
// (lib/timed-fetch.js), and sends each one through the notification hub once (lib/notify-store.js): the bell, a pop-up
// on the owner's open pages, the lock screen, and a buzz on the owner's phones (lib/push.js), even with no page open.
// The pages hear 'reminders' too, so their pop-up shows it at once. Server-only; instrumentation.js starts it.
// Each time a reminder rings is a key (due:<id>:<when>), claimed in the database before it goes (Reminders' own
// claims, lib/reminders-store.js): a restart, two ticks or a second server never send it twice; a send that fails
// gives the key back. A snooze or a repeat's next time is a new key, so it rings again then. Done / snooze / delete
// on the page take the notice off (the route's unring).
import { notifyOn } from './gate.js'
import { liveBus } from './live.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'
import { pushNotice } from './push.js'
import { remindersStore } from './reminders-store.js'
import { dueKey, dueNotice } from './timed.js'
import { timedApi, timedOn } from './timed-fetch.js'

export const TICK_MS = 30_000

// One check -> the keys it sent
export async function timedTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!timedOn() || !notifyOn()) return []
  const due = await timedApi.due()
  if (!due.length) return []
  const store = remindersStore()
  const sent = []
  for (const i of due) {
    const key = dueKey(i)
    let mine = false
    try {
      mine = await store.claimNudge(owner, key)
      if (!mine) continue
      const c = cleanNotice(dueNotice(i, ms))
      if (c.error) throw new Error(c.error)
      await notifyStore().add(c.notice)
      sent.push(key)
      await store.sentNudge(owner, key)
      void pushNotice(owner, c.notice) // and to the owner's phones, in the background
    } catch {
      if (mine && !sent.includes(key)) await store.releaseNudge(owner, key).catch(() => {})
    }
  }
  if (sent.length) {
    liveBus().publish(owner, { kind: 'notify', at: ms })
    liveBus().publish(owner, { kind: 'reminders', at: ms })
  }
  return sent
}

// The ticker: once per process, a first check a moment after the start (what came due while the server was down)
export function startTimed() {
  if (globalThis.__homeTimedTicker) return
  globalThis.__homeTimedTicker = true
  const run = () => timedTick().catch(() => {}) // the API or the database away: the next tick tries again
  const first = setTimeout(() => {
    run()
    setInterval(run, TICK_MS).unref?.()
  }, 5_000)
  first.unref?.()
}
