// The morning summary's sender (rules and wording in lib/morning.js): a check once a minute in the server
// (instrumentation.js starts it, next to Habits' ticker), sent through the notification hub like any other notice
// (lib/notify-store.js), so it sits in the inbox, pops up on the owner's open pages and buzzes the owner's phones
// (lib/push.js). Server-only.
//
// Every morning at 06:00 (the owner's zone: the Habits doc's), one notice: the weather, the reminders open at 06:00,
// today's routines, the servers. Once a day at most: its key (morning:<day>) is claimed in the database before it goes,
// so a restart, two ticks in the same minute or a second server never send it twice; a send that fails gives it back,
// and a later tick in the window (to 06:29) tries again.
// The owner's switch (Settings › Notifications › Morning summary; lib/reminders-store.js prefs) is read each morning:
// off, this tick is Reminders' own 06:00 notice instead, exactly as before it (lib/reminders-nudge.js nudgeTick).
//
// What it reads, each one on its own (one that fails or is slow just leaves its line out): the reminders and the
// Habits doc (the database), the weather at the owner's synced location in the owner's unit (lib/cloud.js, then the
// weather API through lib/upstream.js and its 5-minute cache: once a morning), and the Server card's other machines
// (lib/host.js agentStats, 2 s each). Tests swap the last two through globalThis.__homeMorningSources.
import { readDoc } from './cloud.js'
import { DEFAULT_LOC } from './data.js'
import { notifyOn } from './gate.js'
import { habitsStore } from './habits-store.js'
import { localNow } from './habits.js'
import { agentStats } from './host.js'
import { liveBus } from './live.js'
import { morningKey, morningNotice, remindersLine, routinesLine, serversLine, weatherLine } from './morning.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'
import { pushNotice } from './push.js'
import { nudgeTick } from './reminders-nudge.js'
import { nudgeTag, openAtSix, zoneOf } from './reminders.js'
import { remindersStore } from './reminders-store.js'
import { upstream } from './upstream.js'
import { parseWeatherParams } from './weather.js'

export const TICK_MS = 60_000

// the weather line: the location and unit the owner's devices sync (Đà Lạt and °C until one is picked)
async function weatherNow(owner) {
  const doc = await readDoc(owner).catch(() => null)
  const loc = doc?.v?.location ?? DEFAULT_LOC
  const p = parseWeatherParams({ lat: String(loc.lat), lon: String(loc.lon), tz: loc.tz, id: String(loc.id), name: loc.name })
  return p ? weatherLine(await upstream('/weather', p), doc?.v?.['settings.unit'] ?? 'C') : null
}
const sources = () => ({ weather: weatherNow, hosts: agentStats, ...globalThis.__homeMorningSources })

// One check -> the key it sent (morning:<day>, or todo:<day> with the summary off), or null
export async function morningTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!notifyOn()) return null // (the hub needs the token, the database and the owner)
  const doc = await habitsStore().getDoc(owner)
  const tz = zoneOf(doc)
  const now = localNow(ms, tz)
  const key = morningKey(now)
  // most minutes it isn't the morning: nothing else is read then
  if (!key) return null
  const store = remindersStore()
  if (!(await store.prefs(owner)).morning) return nudgeTick(ms, owner) // off: Reminders' own notice, as before
  let mine = false
  let sent = false
  try {
    mine = await store.claimNudge(owner, key)
    if (!mine) return null
    const src = sources()
    const [items, weather, hosts] = await Promise.all([
      store.open(owner).then((list) => openAtSix(list, now, tz)),
      Promise.resolve().then(() => src.weather(owner)).catch(() => null),
      Promise.resolve().then(() => src.hosts()).catch(() => null),
    ])
    const lines = { now, weather, routines: routinesLine(doc, now), servers: serversLine(hosts) }
    let c = cleanNotice(morningNotice({ ...lines, reminders: remindersLine(items) }))
    if (c.error) throw new Error(c.error)
    await notifyStore().add(c.notice)
    sent = true
    // one held done while this went out (its route had nothing of ours to take off): the reminders line is put right
    // (the same tag: it replaces the one just added) before any phone buzzes; the summary itself still goes
    const left = await store.open(owner).catch(() => null) // (not known: as it was)
    if (left) {
      const ids = new Set(left.map((i) => i.id))
      const still = items.filter((i) => ids.has(i.id))
      if (still.length < items.length) {
        const again = cleanNotice(morningNotice({ ...lines, reminders: remindersLine(still) }))
        if (!again.error && (await notifyStore().add(again.notice).then(() => true, () => false))) c = again
      }
    }
    void pushNotice(owner, c.notice) // and to the owner's phones, in the background
    liveBus().publish(owner, { kind: 'notify', at: ms })
    await store.sentNudge(owner, key)
    // Reminders' own notice is settled for the day too (its key is its tag): the switch turned off before 06:30
    // doesn't send a second notice that morning
    const todo = nudgeTag(now.day)
    if (await store.claimNudge(owner, todo).catch(() => false)) await store.sentNudge(owner, todo).catch(() => {})
    store.prune().catch(() => {})
  } catch {
    // not sent: give the key back if we can (if not, its claim lapses and a later tick in the window sends it).
    // Sent but not marked (the database went away in between): at worst a second one that morning, never none
    if (mine && !sent) await store.releaseNudge(owner, key).catch(() => {})
  }
  return sent ? key : null
}

// The ticker: on the minute (a few seconds past), for as long as the server runs. Once per process
export function startMorning() {
  if (globalThis.__homeMorningTicker) return
  globalThis.__homeMorningTicker = true
  const run = () => morningTick().catch(() => {}) // the database away for a minute: the next tick tries again
  const first = setTimeout(() => {
    run()
    setInterval(run, TICK_MS).unref?.()
  }, TICK_MS - (Date.now() % TICK_MS) + 2_000)
  first.unref?.()
}
