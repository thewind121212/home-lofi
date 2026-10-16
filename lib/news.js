// News: the digest an agent on another machine writes (NEWS_URL: latest.json, archive/<name>.json, schema.json), for
// the owner's 📰 icon and its magazine page (app/news.js). The rules only, no network and no React, so node:test checks
// them; the fetching is lib/news-fetch.js, the read state lib/news-store.js, the owner-only route
// app/api/private/settings/news.
// - Whatever the agent writes is checked here before the page sees it: known fields only, each cut to size, links
//   http(s) only (never javascript: or the like), importance 1–5, times as epoch ms. An item that can't be shown
//   (no title, no link) is left out, not the whole digest.
// - Read state is the owner's, on the server (every device dims the same ones); the dot on the icon is a newer
//   edition than the last one opened.

export const MAX_ITEMS = 60 // per section
export const MAX_SECTIONS = 8
export const MAX = { title: 300, summary: 1200, overview: 3000, source: 80, section: 60 }
export const MAX_READ_IDS = 100 // ids in one "read" write
const ID = /^[A-Za-z0-9_-]{1,64}$/
// an archive file's name: 2026-10-16_1012.json (the agent's listing has nothing else worth fetching)
const ARCHIVE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.json$/

// the agent's categories, as the page names them (its content is Vietnamese, so are these)
export const CATEGORIES = {
  'thoi-su': 'Thời sự',
  'kinh-te': 'Kinh tế',
  'cong-nghe': 'Công nghệ',
  ai: 'AI',
  'khoa-hoc': 'Khoa học',
  'the-gioi': 'Thế giới',
  'xa-hoi': 'Xã hội',
  'the-thao': 'Thể thao',
  'giai-tri': 'Giải trí',
  'lap-trinh': 'Lập trình',
  'bao-mat': 'Bảo mật',
  khac: 'Khác',
}
// (the agent's scheduled ones are morning and afternoon; manual: one asked for with Refresh)
export const EDITIONS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', manual: 'On demand' }

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
// text as written, minus control characters, trimmed and cut to n (a summary keeps its line breaks)
export function cleanText(v, n, lines = false) {
  if (typeof v !== 'string') return null
  let s = v.replace(CTRL, '')
  s = lines ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : s.replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

// a link the page may open: absolute http(s), no credentials in it
export function cleanLink(v) {
  if (typeof v !== 'string' || v.length > 2048) return null
  try {
    const u = new URL(v.trim())
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null
    return u.href
  } catch {
    return null
  }
}

// an ISO time -> epoch ms | null
export function cleanTime(v) {
  if (typeof v !== 'string' || v.length > 40) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const count = (v) => (Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null)

// one story -> what the page gets, or null (nothing to show or open)
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = cleanText(raw.title_vi, MAX.title) ?? cleanText(raw.title_original, MAX.title)
  const url = cleanLink(raw.url)
  if (!title || !url || typeof raw.id !== 'string' || !ID.test(raw.id)) return null
  const original = cleanText(raw.title_original, MAX.title)
  const imp = Number.isFinite(raw.importance) ? Math.round(raw.importance) : 3
  return {
    id: raw.id,
    title,
    // (only when it says something the title doesn't: an English source's own words)
    original: original && original.toLowerCase() !== title.toLowerCase() ? original : null,
    summary: cleanText(raw.summary_vi, MAX.summary, true),
    category: typeof raw.category === 'string' && Object.hasOwn(CATEGORIES, raw.category) ? raw.category : 'khac',
    importance: Math.min(5, Math.max(1, imp)),
    source: cleanText(raw.source, MAX.source),
    url,
    publishedAt: cleanTime(raw.published_at),
    points: count(raw.points),
    comments: count(raw.comments),
    commentsUrl: cleanLink(raw.comments_url),
  }
}

// the agent's digest -> { edition, at, overview, sections: [{ key, title, items }] } | null (not a digest at all).
// Each section: most important first, then newest (the agent's order where those are equal); one story only once
// now: the server's clock (an edition can't be from the future: a clock running ahead would keep the dot on for good)
export function cleanDigest(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) return null
  let at = cleanTime(raw.generated_at)
  if (at == null) return null
  at = Math.min(at, now)
  const seen = new Set()
  const sections = []
  for (const s of raw.sections.slice(0, MAX_SECTIONS)) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.items)) continue
    const items = []
    for (const [i, r] of s.items.entries()) {
      const it = cleanItem(r)
      if (!it || seen.has(it.id)) continue
      seen.add(it.id)
      items.push({ it, i })
      if (items.length >= MAX_ITEMS) break
    }
    if (!items.length) continue
    items.sort((a, b) => b.it.importance - a.it.importance || (b.it.publishedAt ?? 0) - (a.it.publishedAt ?? 0) || a.i - b.i)
    const key = typeof s.key === 'string' && /^[a-z0-9-]{1,32}$/.test(s.key) ? s.key : `s${sections.length}`
    sections.push({ key, title: cleanText(s.title, MAX.section) ?? key, items: items.map((x) => x.it) })
  }
  return {
    edition: typeof raw.edition === 'string' && Object.hasOwn(EDITIONS, raw.edition) ? raw.edition : 'manual',
    at,
    overview: cleanText(raw.overview_vi, MAX.overview, true),
    sections,
  }
}

// the archive's directory listing (HTML, or a JSON list of names) -> its digests' names, newest first
export function archiveNames(body) {
  let names = []
  if (Array.isArray(body)) names = body.filter((x) => typeof x === 'string')
  else if (typeof body === 'string') {
    // (one link that won't decode is skipped, not the whole listing)
    names = [...body.matchAll(/href="([^"?#/]+)"/g)].map((m) => {
      try {
        return decodeURIComponent(m[1])
      } catch {
        return ''
      }
    })
  }
  return [...new Set(names.filter((n) => ARCHIVE.test(n)))].sort().reverse()
}
export const validArchive = (name) => typeof name === 'string' && ARCHIVE.test(name)
// an edition's time -> the name the agent's archive gives it (the agent's wall clock: tz), e.g. to leave the latest out
export function archiveName(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}.json`
}
// an archive name -> its time as the agent wrote it (the owner's wall clock, no zone): "2026-10-16 10:12"
export function archiveLabel(name) {
  const m = ARCHIVE.exec(name ?? '')
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : null
}

// an edition's name in the menu, by the agent's wall clock: "Today · 10:12", "Yesterday · 18:00", "Thu 15 Oct · 06:00"
// (name: an archive file's; now and tz: which day is today)
export function editionName(name, now, tz) {
  const m = ARCHIVE.exec(name ?? '')
  if (!m) return null
  const day = `${m[1]}-${m[2]}-${m[3]}`
  const ymd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ms)
  const time = `${m[4]}:${m[5]}`
  if (day === ymd(now)) return `Today · ${time}`
  if (day === ymd(now - 86_400_000)) return `Yesterday · ${time}`
  const d = new Date(`${day}T12:00:00Z`)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} · ${time}`
}

// a "read" write's ids -> the valid ones (at most MAX_READ_IDS), or null (not a list)
export function cleanIds(v) {
  if (!Array.isArray(v)) return null
  return [...new Set(v.filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, MAX_READ_IDS)
}

// POST's body -> { act } | { error, field }
// { action: 'read', ids } | { action: 'unread', ids } | { action: 'seen', at } | { action: 'refresh' }
export function cleanAction(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'an object', field: null }
  if (b.action === 'refresh') return { act: { action: 'refresh' } }
  if (b.action === 'read' || b.action === 'unread') {
    const ids = cleanIds(b.ids)
    return ids?.length ? { act: { action: b.action, ids } } : { error: 'ids: story ids', field: 'ids' }
  }
  if (b.action === 'seen') return Number.isFinite(b.at) && b.at > 0 ? { act: { action: 'seen', at: b.at } } : { error: 'at: an edition time', field: 'at' }
  return { error: 'action: read, unread, seen or refresh', field: 'action' }
}

// ---- a run: an edition made now (Refresh), besides the agent's scheduled ones ----

export const RUN_STATES = ['idle', 'running', 'done', 'error']
export const RUN_SLOW = 10 * 60_000 // a run still going after this: stuck, the page stops waiting for it
// the agent's /api/status (its newest run, asked for or scheduled) -> { job, state, edition, startedAt, finishedAt,
// items, cost, error } | null (not a status)
export function cleanRun(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !RUN_STATES.includes(raw.status)) return null
  const startedAt = cleanTime(raw.started_at)
  return {
    job: typeof raw.job_id === 'string' && ID.test(raw.job_id) ? raw.job_id : null,
    state: raw.status,
    edition: typeof raw.edition === 'string' && Object.hasOwn(EDITIONS, raw.edition) ? raw.edition : null,
    startedAt: startedAt == null ? null : Math.min(startedAt, now),
    finishedAt: cleanTime(raw.finished_at),
    items: count(raw.items),
    cost: Number.isFinite(raw.cost_usd) && raw.cost_usd >= 0 && raw.cost_usd < 1000 ? Math.round(raw.cost_usd * 1000) / 1000 : null,
    error: raw.status === 'error' ? (cleanText(raw.error, 300) ?? 'it failed') : null,
  }
}
// a run going (and not stuck)
export const runGoing = (run, now) => run?.state === 'running' && !(run.startedAt != null && now - run.startedAt > RUN_SLOW)
// a wait, short: "40 s", "7 min", "9 h"
export function waitFor(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.ceil(s / 60)
  return m < 60 ? `${m} min` : `${Math.ceil(m / 60)} h`
}

// ---- the page's words ----

// how long ago, short: "now", "12m", "3h", "2d"
export function ago(ms, now) {
  if (!Number.isFinite(ms)) return null
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

// the edition's line: "Morning · 10:12", or with the day when it isn't today ("Evening · Thu 15 Oct, 18:05")
export function editionLine(d, now, tz) {
  const opts = { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ms)
  const time = new Intl.DateTimeFormat('en-GB', opts).format(d.at)
  const when = day(d.at) === day(now) ? time : `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d.at)}, ${time}`
  return `${EDITIONS[d.edition] ?? 'On demand'} · ${when}`
}
