import { sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { GH_KEY, cleanGhAction } from '../../../../../lib/github.js'
import { githubDay } from '../../../../../lib/news-day.js'
import { newsStore } from '../../../../../lib/news-store.js'

// The owner's GitHub list (app/github.js): the news agent's repos of the day (lib/news-fetch.js, NEWS_URL; a day:
// lib/news-day.js), owner-only like News next door. Guests get 404 / 403 here, and read the same days from app/api/github
// (no read state).
//   GET [?day=YYYY-MM-DD]   -> { on: true, digest: { date, at, overview, repos } (lib/github.js cleanGh), day (the day
//                              shown), picked (the day asked for, null = the newest), today (the agent's today), days:
//                              [{ day, last (HH:MM | null) }] (newest first), latestAt (the newest list's time), late
//                              (today's should be there and isn't: "chưa cập nhật"), retry (late, and worth asking
//                              again soon), stale (the agent didn't answer just now: the copy from before), read: [ids]
//                              (this day's repos the owner has opened), seen (the newest list opened, ms | null) }
//                              { on: false }: NEWS_URL isn't set (no icon)
//   POST { action: 'read' | 'unread', ids }   repos opened / back to unread (ids: owner/name)
//        { action: 'seen', at }               a list opened (the icon's dot goes; only ever forward)
//   -> { ok: true }; the owner's other tabs hear 'github' on the live stream and pull.
// 404 = not set up / no such day, 403 = someone else, 400 = a bad body, 502 = the agent unreachable or not a list
// ({ on: true, error }: the page keeps what it had), 503 = database unreachable (POST).
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 8192
const tell = (who, request) => liveBus().publish(who, { kind: 'github', at: Date.now(), from: clientId(request.headers.get('x-home-client')) })

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no github' }, who)
  const { status, body } = await githubDay(new URL(request.url).searchParams.get('day'))
  if (status !== 200 || !body.on) return json(body, status)
  // the read state: a database hiccup still shows the list (nothing dimmed, no dot)
  let read = [], seen = null
  try {
    const store = newsStore()
    const ids = new Set(body.digest.repos.map((r) => GH_KEY + r.id))
    ;[read, seen] = await Promise.all([store.reads(who).then((r) => r.filter((id) => ids.has(id)).map((id) => id.slice(GH_KEY.length))), store.ghSeen(who)])
  } catch {}
  return json({ ...body, read, seen })
}

export async function POST(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no github' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  const c = cleanGhAction(body)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  const { act } = c
  try {
    const store = newsStore()
    if (act.action === 'read') {
      await store.read(who, act.ids.map((id) => GH_KEY + id), Date.now())
      await store.prune(who).catch(() => {})
    } else if (act.action === 'unread') await store.unread(who, act.ids.map((id) => GH_KEY + id))
    else await store.setGhSeen(who, Math.min(act.at, Date.now() + 86_400_000))
    tell(who, request)
    return json({ ok: true })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
