// Reminders' 06:00 notice (rules in lib/reminders.js), for when the owner has turned the morning summary off (Settings
// › Notifications; lib/morning-summary.js's ticker runs this check then, once a minute through the morning window).
// Sent through the notification hub like any other notice (lib/notify-store.js), so it sits in the inbox, pops up on
// the owner's open pages and buzzes the owner's phones (lib/push.js). Server-only.
// One a day at most, and only with something open: its key (todo:<day>) is claimed in the database before it goes,
// so a restart, two ticks in the same minute or a second server never send it twice; a send that fails gives it back.
import { notifyOn } from './gate.js'
import { habitsStore } from './habits-store.js'
import { localNow } from './habits.js'
import { liveBus } from './live.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'
import { pushNotice } from './push.js'
import { NUDGE_AT, NUDGE_LATE, nudgeKey, nudgeNotice, nudgeTag, openAtSix, zoneOf } from './reminders.js'
import { remindersStore } from './reminders-store.js'

// One check -> the key it sent, or null
export async function nudgeTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!notifyOn()) return null // (the hub needs the token, the database and the owner)
  const tz = zoneOf(await habitsStore().getDoc(owner))
  const now = localNow(ms, tz)
  // most minutes it isn't the morning: the reminders aren't even read then
  if (now.min < NUDGE_AT || now.min >= NUDGE_AT + NUDGE_LATE) return null
  const store = remindersStore()
  const items = openAtSix(await store.open(owner), now, tz)
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
    // the last one held done while this went out (its route found no notice to take off): take it off here, and no
    // phone buzzes for it
    const left = await store.open(owner).catch(() => null) // (not known: as if some were left)
    if (left?.length !== 0) void pushNotice(owner, c.notice) // and to the owner's phones, in the background
    else await notifyStore().dropTag(nudgeTag(now.day))
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
