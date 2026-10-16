import { sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { archiveLabel, archiveName, cleanAction, validArchive } from '../../../../../lib/news.js'
import { archived, editions, latest, latestStale, newsOn } from '../../../../../lib/news-fetch.js'
import { newsStore } from '../../../../../lib/news-store.js'

// The owner's News (app/news.js): the agent's digest (lib/news-fetch.js, NEWS_URL), in the owner-only zone like the
// settings next door (lib/gate.js ownerOf): the proxy's /api/private/settings location covers this path, Authelia login
// included. Guests get 404 / 403 and the page shows no icon.
//   GET [?edition=<archive name>]  -> { on: true, digest: { edition, at, overview, sections }, edition (the archive name
//                                     shown, null = the latest), latestAt (the newest edition's time), editions:
//                                     [{ name, label }] (the archive, newest first, the latest left out), read: [ids] (this digest's stories
//                                     the owner has read), seen (the newest edition opened, ms | null), stale (the
//                                     agent didn't answer just now: the latest is the copy from before) }
//                                     { on: false }: NEWS_URL isn't set (no icon)
//   POST { action: 'read' | 'unread', ids }   stories read (opened) / back to unread
//        { action: 'seen', at }               an edition opened (the icon's dot goes; only ever forward)
//   -> { ok: true }; the owner's other tabs hear 'news' on the live stream and pull.
// 404 = not set up / no such edition, 403 = someone else, 400 = a bad body, 502 = the agent unreachable or not a
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
  const name = new URL(request.url).searchParams.get('edition')
  if (name && !validArchive(name)) return json({ on: true, error: 'no such edition' }, 404)
  let digest, newest, names
  try {
    ;[newest, names] = await Promise.all([latest(), editions()])
    digest = name ? await archived(name) : newest
  } catch (e) {
    return json({ on: true, error: e?.status === 404 && name ? 'no such edition' : 'news unreachable' }, e?.status === 404 && name ? 404 : 502)
  }
  // the read state: a database hiccup still shows the news (nothing dimmed, no dot)
  let read = [], seen = null
  try {
    const store = newsStore()
    const ids = new Set(digest.sections.flatMap((s) => s.items.map((i) => i.id)))
    ;[read, seen] = await Promise.all([store.reads(who).then((r) => r.filter((id) => ids.has(id))), store.seen(who)])
  } catch {}
  return json({ on: true, digest, edition: name || null, stale: latestStale(), latestAt: newest.at, editions: names.filter((n) => n !== archiveName(newest.at, TZ)).map((n) => ({ name: n, label: archiveLabel(n) })), read, seen })
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
