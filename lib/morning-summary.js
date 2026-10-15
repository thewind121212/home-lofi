// The daily summaries' sender (rules and wording in lib/morning.js): a check once a minute in the server
// (instrumentation.js starts it, next to Habits' ticker), sent through the notification hub like any other notice
// (lib/notify-store.js), so it sits in the inbox, pops up on the owner's open pages and buzzes the owner's phones
// (lib/push.js). Server-only.
//
// Every day at 06:00, 13:00 and 18:00 (the owner's zone: the Habits doc's), one notice: the weather, the reminders,
// the routines, the servers. Once each at most: its key (<slot>:<day>, e.g. morning:2026-10-15) is claimed in the
// database before it goes, so a restart, two ticks in the same minute or a second server never send it twice; a send
// that fails gives it back, and a later tick in its half hour tries again.
// The owner's switch (Settings › Notifications › Daily summaries; lib/reminders-store.js prefs) is read each time:
// off, the 06:00 tick is Reminders' own notice instead, exactly as before them (lib/reminders-nudge.js nudgeTick), and
// 13:00 / 18:00 send nothing. One morning notice a day, whichever way the switch is flipped in the window: the morning
// summary holds Reminders' key (todo:<day>) too while it goes, so neither goes after the other (an old server still
// ticking through a deploy included).
//
// What it reads: the reminders, the Habits doc and (13:00, 18:00) today's check-ins (the database: one of those failing
// sends nothing, and a later tick in the half hour tries again), and each one on its own (one that fails, or has no
// answer within SOURCE_MS, just leaves its line out) the weather at the owner's synced location in the owner's unit
// (lib/cloud.js, then the weather API through lib/upstream.js and its 5-minute cache) and the Server card's other
// machines (lib/host.js agentStats, 2 s each). Tests swap those two through globalThis.__homeMorningSources.
import { readDoc } from './cloud.js'
import { DEFAULT_LOC } from './data.js'
import { notifyOn } from './gate.js'
import { habitsStore } from './habits-store.js'
import { localNow } from './habits.js'
import { agentStats } from './host.js'
import { liveBus } from './live.js'
import { MORNING, morningNotice, remindersLine, routinesLine, serversLine, slotOf, summaryTag, tomorrowLine, weatherLine } from './morning.js'
import { cleanNotice } from './notify.js'
import { notifyStore } from './notify-store.js'
import { pushNotice } from './push.js'
import { nudgeTick } from './reminders-nudge.js'
import { nudgeTag, openAtSix, zoneOf } from './reminders.js'
import { remindersStore } from './reminders-store.js'
import { upstream } from './upstream.js'
import { parseWeatherParams } from './weather.js'

export const TICK_MS = 60_000
export const SOURCE_MS = 10_000 // the weather, the machines: no answer by then, no line (well inside the claim's lease)

// the weather lines: the location and unit the owner's devices sync (Đà Lạt and °C until one is picked) -> { now,
// tomorrow } (tomorrow's only when asked: the evening's)
async function weatherNow(owner, { tomorrow = false } = {}) {
  const doc = await readDoc(owner).catch(() => null)
  const loc = doc?.v?.location ?? DEFAULT_LOC
  const unit = doc?.v?.['settings.unit'] ?? 'C'
  const p = parseWeatherParams({ lat: String(loc.lat), lon: String(loc.lon), tz: loc.tz, id: String(loc.id), name: loc.name })
  if (!p) return null
  const w = await upstream('/weather', p)
  return { now: weatherLine(w, unit), tomorrow: tomorrow ? tomorrowLine(w, unit) : null }
}
const sources = () => ({ weather: weatherNow, hosts: agentStats, ...globalThis.__homeMorningSources })
// a source's answer, or null when it fails or takes longer than SOURCE_MS (it may still be running: it's let go)
function within(fn) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), SOURCE_MS)
    Promise.resolve()
      .then(fn)
      .then(resolve, () => resolve(null))
      .finally(() => clearTimeout(t))
  })
}

// One check -> the key it sent (<slot>:<day>, or todo:<day> with the switch off at 06:00), or null
export async function morningTick(ms = Date.now(), owner = process.env.OWNER_USER) {
  if (!notifyOn()) return null // (the hub needs the token, the database and the owner)
  const habits = habitsStore()
  const doc = await habits.getDoc(owner)
  const tz = zoneOf(doc)
  const now = localNow(ms, tz)
  const slot = slotOf(now)
  // most minutes it isn't one of the three: nothing else is read then
  if (!slot) return null
  const store = remindersStore()
  if (!(await store.prefs(owner)).morning) return slot === MORNING ? nudgeTick(ms, owner) : null // off: Reminders' own 06:00 notice, as before
  const key = summaryTag(slot, now.day)
  const morning = slot === MORNING
  const todo = nudgeTag(now.day)
  let mine = false
  let held = false
  let sent = false
  try {
    mine = await store.claimNudge(owner, key)
    if (!mine) return null
    // Reminders' own notice already went this morning (the switch turned on after it): not a second one. The key goes
    // back (not marked sent), so if that one is only being tried and fails, a later tick in the window sends this
    if (morning) {
      held = await store.claimNudge(owner, todo)
      if (!held) {
        await store.releaseNudge(owner, key)
        mine = false
        return null
      }
    }
    const src = sources()
    // the morning lists what was open at 06:00; later on, all that's still open, and the routines left (today's
    // check-ins: taken-back ones don't count)
    const [items, wx, hosts, done] = await Promise.all([
      store.open(owner).then((list) => (morning ? openAtSix(list, now, tz) : list)),
      within(() => src.weather(owner, { tomorrow: slot.id === 'evening' })),
      within(() => src.hosts()),
      morning ? null : habits.checkins(owner, now.day).then((cs) => new Set(cs.filter((c) => c.day === now.day && c.undoneAt == null).map((c) => c.habitId))),
    ])
    const lines = { slot, now, weather: wx?.now ?? null, tomorrow: wx?.tomorrow ?? null, routines: routinesLine(doc, now, done), servers: serversLine(hosts) }
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
    // Reminders' own notice is settled for the day too: the switch turned off before 06:30 doesn't send a second
    // notice that morning
    if (morning) await store.sentNudge(owner, todo).catch(() => {})
    store.prune().catch(() => {})
  } catch {
    // not sent: give the keys back if we can (if not, their claims lapse and a later tick in the window sends it).
    // Sent but not marked (the database went away in between): at worst a second one that time, never none
    if (mine && !sent) await store.releaseNudge(owner, key).catch(() => {})
    if (held && !sent) await store.releaseNudge(owner, todo).catch(() => {})
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
