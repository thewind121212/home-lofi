import { sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { DAY, archiveDays, archiveName, cleanAction, dayOf, mergeDay } from '../../../../../lib/news.js'
import { archived, editions, latest, latestStale, newsOn, runState, startRun } from '../../../../../lib/news-fetch.js'
import { newsStore } from '../../../../../lib/news-store.js'

// The owner's News (app/news.js): the agent's digest (lib/news-fetch.js, NEWS_URL), in the owner-only zone like the
// settings next door (lib/gate.js ownerOf): the proxy's /api/private/settings location covers this path, Authelia login
// included. Guests get 404 / 403 and the page shows no icon.
//   GET [?day=YYYY-MM-DD]          -> { on: true, digest: a day's editions merged (lib/news.js mergeDay: { edition, at,
//                                     first, updates, overview, top, sections }), day (the day shown), picked (the
//                                     day asked for, null = the newest day with news), today (the agent's today),
//                                     days: [{ day, updates, last (HH:MM) }] (newest first), latestAt (the newest
//                                     edition's time), read: [ids] (this day's stories the owner has read), seen (the
//                                     newest edition opened, ms | null), stale (the agent didn't answer just now: the
//                                     latest is the copy from before), run (the agent's newest run, lib/news.js
//                                     cleanRun, or null: it has none to tell, so no Refresh), nextAt (no Refresh
//                                     before then: the agent's limits; 0 = any time) }
//                                     { on: false }: NEWS_URL isn't set (no icon)
//   POST { action: 'read' | 'unread', ids }   stories read (opened) / back to unread
//        { action: 'seen', at }               an edition opened (the icon's dot goes; only ever forward)
//        { action: 'refresh' }                the agent makes an edition now (a run: a few minutes; the page asks
//                                             again until it's done) -> { ok: true, started } (false: one was going
//                                             already), or 429 { error, nextAt } (the agent's cooldown / daily limit)
//   -> { ok: true }; the owner's other tabs hear 'news' on the live stream and pull.
// 404 = not set up / no such day, 403 = someone else, 400 = a bad body, 502 = the agent unreachable or not a
// digest ({ on: true, error }: the page keeps what it had), 503 = database unreachable (POST).
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 8192
const TZ = 'Asia/Ho_Chi_Minh' // the agent's clock (its archive's names)
const tell = (who, request) => liveBus().publish(who, { kind: 'news', at: Date.now(), from: clientId(request.headers.get('x-home-client')) })

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no news' }, who)
  if (!newsOn()) return json({ on: false })
  const day = new URL(request.url).searchParams.get('day')
  if (day && !DAY.test(day)) return json({ on: true, error: 'no such day' }, 404)
  let newest, names, run
  try {
    ;[newest, names, run] = await Promise.all([latest(), editions(), runState()])
    // (a run just done: its edition, not the copy from before it)
    if (run.fresh) [newest, names] = await Promise.all([latest(), editions()])
  } catch {
    return json({ on: true, error: 'news unreachable' }, 502)
  }
  // the day: its editions from the archive (the latest as just fetched), merged; one that won't load is left out
  const latestName = archiveName(newest.at, TZ)
  const days = archiveDays(names, latestName)
  const entry = day ? days.find((d) => d.day === day) : days[0]
  if (!entry) return json({ on: true, error: 'no such day' }, 404)
  const got = await Promise.allSettled(entry.names.map((n) => (n === latestName ? newest : archived(n))))
  const digest = mergeDay(got.filter((g) => g.status === 'fulfilled').map((g) => g.value))
  if (!digest) return json({ on: true, error: 'news unreachable' }, 502)
  // the read state: a database hiccup still shows the news (nothing dimmed, no dot)
  let read = [], seen = null
  try {
    const store = newsStore()
    const ids = new Set(digest.sections.flatMap((s) => s.items.map((i) => i.id)))
    ;[read, seen] = await Promise.all([store.reads(who).then((r) => r.filter((id) => ids.has(id))), store.seen(who)])
  } catch {}
  return json({
    on: true,
    digest,
    day: entry.day,
    picked: day || null,
    today: dayOf(archiveName(Date.now(), TZ)),
    days: days.map((d) => ({ day: d.day, updates: d.names.length, last: d.names.at(-1).slice(11, 13) + ':' + d.names.at(-1).slice(13, 15) })),
    latestAt: newest.at,
    stale: latestStale(),
    read,
    seen,
    run: run.run,
    nextAt: run.nextAt,
  })
}

export async function POST(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no news' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  const c = cleanAction(body)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  const { act } = c
  if (act.action === 'refresh') {
    if (!newsOn()) return json({ error: 'no news' }, 404)
    try {
      const r = await startRun()
      tell(who, request)
      return r.nextAt ? json({ error: 'not yet', nextAt: r.nextAt }, 429) : json({ ok: true, started: r.started })
    } catch {
      return json({ error: 'news unreachable' }, 502)
    }
  }
  try {
    const store = newsStore()
    if (act.action === 'read') {
      await store.read(who, act.ids, Date.now())
      // (a write is a good moment to let the old ones go)
      await store.prune(who).catch(() => {})
    } else if (act.action === 'unread') await store.unread(who, act.ids)
    else await store.setSeen(who, Math.min(act.at, Date.now() + 86_400_000))
    tell(who, request)
    return json({ ok: true })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
