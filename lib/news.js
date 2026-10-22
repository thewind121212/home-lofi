// News: the digest an agent on another machine writes (NEWS_URL: latest.json, archive/<name>.json, schema.json), for
// the owner's 📰 icon and its magazine page (app/news.js). The rules only, no network and no React, so node:test checks
// them; the fetching is lib/news-fetch.js, the read state lib/news-store.js, the owner-only route
// app/api/private/settings/news.
// - Whatever the agent writes is checked here before the page sees it: known fields only, each cut to size, links
//   http(s) only (never javascript: or the like), importance 1–5, times as epoch ms. An item that can't be shown
//   (no title, no link) is left out, not the whole digest. schema_version isn't checked (1.2 to 1.5 so far, each only
//   adding fields): a newer one still shows what's known in it. 1.5 added platform (a film's: where to watch it).
// - Read state is the owner's, on the server (every device dims the same ones); the dot on the icon is a newer
//   edition than the last one opened.
// - The page shows a day at a time (the agent's wall clock): every edition of it merged, each story once (the agent
//   repeats stories from run to run, under the same id) in its newest words; the brief and the top stories are the
//   newest edition's (its overview covers the day so far). Older days from the archive (it keeps 30).

export const MAX_ITEMS = 60 // per section
export const MAX_SECTIONS = 8
export const MAX = { title: 300, summary: 1200, overview: 3000, source: 80, section: 60, platform: 40, point: 300 }
export const MAX_POINTS = 8 // a story's key points at most
export const MAX_DAY_ITEMS = 150 // a section of a whole day
export const MAX_PLATFORMS = 6 // where to watch a film: names at most
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

// a story's key points (schema 1.4: key_points_vi, a few lines) -> lines, or null
export function cleanPoints(v) {
  if (!Array.isArray(v)) return null
  const out = []
  for (const x of v) {
    const t = cleanText(x, MAX.point)
    if (t) out.push(t)
    if (out.length >= MAX_POINTS) break
  }
  return out.length ? out : null
}

// a film's platforms (schema 1.5: where to watch it, e.g. ["Netflix"], ["Rạp chiếu"]: in cinemas) -> names, each once, or
// null (not a film, or nothing usable)
export function cleanPlatforms(v) {
  if (!Array.isArray(v)) return null
  const seen = new Set()
  const out = []
  for (const x of v) {
    const t = cleanText(x, MAX.platform)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= MAX_PLATFORMS) break
  }
  return out.length ? out : null
}
// a platform that means the cinema, not a service
export const inCinemas = (name) => /^(rạp|rap|cinema|theat)/i.test(name ?? '')

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
    platform: cleanPlatforms(raw.platform),
    keyPoints: cleanPoints(raw.key_points_vi),
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

// ---- days ----

export const DAY = /^\d{4}-\d{2}-\d{2}$/
// an archive name -> its day ("2026-10-16"), or null
export function dayOf(name) {
  const m = ARCHIVE.exec(name ?? '')
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
// the archive's names (newest first) and the latest edition's name -> the days, newest first: [{ day, names (oldest
// first) }]. (The latest may not be in the listing yet: it counts all the same)
export function archiveDays(names, latestName) {
  const all = new Set(names.filter(validArchive))
  if (validArchive(latestName)) all.add(latestName)
  const days = new Map()
  for (const n of [...all].sort()) {
    const d = dayOf(n)
    if (!days.has(d)) days.set(d, [])
    days.get(d).push(n)
  }
  return [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, names]) => ({ day, names }))
}
// a day in the menu, by the agent's wall clock: "Today", "Yesterday", "Thu 15 Oct" (now and tz: which day is today)
export function dayName(day, now, tz) {
  if (!DAY.test(day ?? '')) return null
  const ymd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ms)
  if (day === ymd(now)) return 'Today'
  if (day === ymd(now - 86_400_000)) return 'Yesterday'
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const TOP = 8 // the top stories at most
const byWeight = (a, b) => b.importance - a.importance || (b.publishedAt ?? 0) - (a.publishedAt ?? 0)
// an edition's top stories: those rated 4–5 (TOP at most), or the best five when there are fewer -> their ids
export function topIds(d) {
  const all = d.sections.flatMap((s) => s.items).sort(byWeight)
  const top = all.filter((i) => i.importance >= 4).slice(0, TOP)
  return (top.length < 5 ? all.slice(0, 5) : top).map((i) => i.id)
}

// a day's editions (cleaned digests, any order) -> one digest: { edition, at (the newest's), first (the oldest's),
// updates (how many), overview (the newest's: it covers the day), top (the newest's top stories, ids), sections }.
// Each story once: the newest edition's words and section, since = when it first came (an edition's time). Sections
// in the newest edition's order, then any only older ones had; in each, the weightiest first, then the newest
export function mergeDay(digests) {
  const list = digests.filter(Boolean).sort((a, b) => a.at - b.at)
  if (!list.length) return null
  const newest = list.at(-1)
  const since = new Map()
  const home = new Map() // id -> { it, key }
  const titles = new Map()
  for (const d of list) {
    for (const s of d.sections) {
      titles.set(s.key, s.title)
      for (const it of s.items) {
        if (!since.has(it.id)) since.set(it.id, d.at)
        home.set(it.id, { it, key: s.key })
      }
    }
  }
  const order = [...new Set([...newest.sections.map((s) => s.key), ...[...titles.keys()]])]
  const sections = []
  for (const key of order) {
    const items = [...home.values()].filter((h) => h.key === key).map((h) => ({ ...h.it, since: since.get(h.it.id) }))
    if (!items.length) continue
    items.sort((a, b) => byWeight(a, b) || b.since - a.since)
    sections.push({ key, title: titles.get(key), items: items.slice(0, MAX_DAY_ITEMS) })
  }
  return { edition: newest.edition, at: newest.at, first: list[0].at, updates: list.length, overview: newest.overview, top: topIds(newest), sections }
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

// ---- the masthead (the page is a newspaper's front page) ----

// the paper's name, by the time of day of the newest edition shown: "The Morning Lofi" (before noon), "The Afternoon
// Lofi" (to 17:00), "The Evening Lofi"
export function paperName(d, tz) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d.at))
  return `The ${h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'} Lofi`
}

const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
const roman = (n) => ROMAN.reduce((s, [v, r]) => {
  for (; n >= v; n -= v) s += r
  return s
}, '')
// the folio over the name: the volume (the year, from the paper's first, 2026) and the issue (the day of the year):
// "Vol. I · No. 295"; null for a day that isn't one
export function folio(day) {
  if (!DAY.test(day ?? '')) return null
  const [y, m, d] = day.split('-').map(Number)
  const no = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1
  return `Vol. ${roman(Math.max(1, y - 2025))} · No. ${no}`
}

// the dateline's day, in full: "Thursday, October 22, 2026"
export function longDay(day) {
  if (!DAY.test(day ?? '')) return null
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
