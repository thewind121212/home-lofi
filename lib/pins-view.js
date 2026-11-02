// The Pins sheet's views (app/pins.js PinsBody): the owner's pins grouped by site or by the day they were pinned, the
// quick filters over them (a site, then a part of it; a time span) with their counts, and the search's highlights.
// Pure: no React, no clock of its own (`now` comes in), so node:test checks all of it. Days are the device's own
// (local time), like the day dividers a person reads them by.
//
// Why groups: the owner keeps many pages of a few sites (most of them GitHub's), pinned a few at a time over weeks. One
// flat newest-first list buries everything under the biggest site; by site, then by day inside it, it reads the way
// it was pinned. The filters narrow it in a tap, and each one's count says what it would leave (faceted: the search
// and the other filters applied, never its own), so a tap never leads to nothing by surprise.
import { domainOf, fold } from './pins.js'

export const SECTION_SHOWN = 4 // a long section shows its newest few, "Show N more" the rest (one big site doesn't bury the others)
export const SECTION_SLACK = 2 // ...but never "Show 1 more" / "Show 2 more": a section that's only that much longer shows whole
export const TOP_SITES = 5 // site chips shown before "+N" (fewer when they don't fit on one line)
export const TOP_PARTS = 8 // ...and the picked site's parts (GitHub's owners)
export const SUB_MIN = 6 // a site this big gets the second row (its top path part: GitHub's owners) once it's picked
export const VIEWS = ['site', 'date']
export const TIMES = [
  ['any', 'Any time'],
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['older', 'Older'],
]
const TIME_PHRASE = { today: 'from today', '7d': 'from the last 7 days', '30d': 'from the last 30 days', older: 'from before the last 30 days' }
// the filters in words, for "Nothing on GitHub · vercel from today": a site's name, its part, a time span (each may be none)
export const whereOf = (site, part, time) => [site && `on ${site}${part ? ` · ${part}` : ''}`, TIME_PHRASE[time]].filter(Boolean).join(' ')
export const cleanView = (v) => (VIEWS.includes(v) ? v : 'site')

// ---- days (the device's local time) ----

const pad = (n) => String(n).padStart(2, '0')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// a moment (ms) -> its local day, "2026-10-27" (sorts as text, newest last)
export function dayKey(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : 0)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// local midnight `back` days before the day of `ms` (by the calendar, not 24 h steps: a DST change is still one day)
export function dayStart(ms, back = 0) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()
}
// a day key -> its weekday and date, "Tue 27 Oct", with the year only when it isn't this one ("Sat 27 Dec 2025")
export function dayDate(key, now) {
  const [y, m, d] = key.split('-').map(Number)
  return `${WD[new Date(y, m - 1, d).getDay()]} ${d} ${MO[m - 1]}${y === new Date(now).getFullYear() ? '' : ` ${y}`}`
}
// a day key -> "Today", "Yesterday", else its date (dayDate)
export function dayLabel(key, now) {
  if (key === dayKey(now)) return 'Today'
  if (key === dayKey(dayStart(now, 1))) return 'Yesterday'
  return dayDate(key, now)
}

// the time chips: today, the last 7 / 30 days (by the calendar, today included), or before those 30
export function inTime(at, time, now) {
  if (time === 'today') return at >= dayStart(now)
  if (time === '7d') return at >= dayStart(now, 6)
  if (time === '30d') return at >= dayStart(now, 29)
  if (time === 'older') return at < dayStart(now, 29)
  return true
}

// ---- sites, and their parts ----

// the link's path, as parts ("/vercel/next.js/issues/1" -> ["vercel", "next.js", "issues", "1"]), decoded
function parts(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
  } catch {
    return []
  }
}
// GitHub's own pages, not an owner's: no owner chip for them (github.com/settings, /topics/…, /search?q=…)
const GH_RESERVED = new Set([
  'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'customer-stories', 'dashboard', 'enterprise', 'events',
  'explore', 'features', 'issues', 'login', 'marketplace', 'new', 'notifications', 'organizations', 'pricing', 'pulls',
  'readme', 'search', 'security', 'settings', 'site', 'sponsors', 'stars', 'team', 'topics', 'trending', 'watching',
])
// a GitHub link's path -> { owner, repo, rest } (owner and repo may be null; github.com/orgs/x is owner x's page), or
// null for any other site
function ghPath(url) {
  if (domainOf(url) !== 'github.com') return null
  const p = parts(url)
  if (!p.length || GH_RESERVED.has(p[0].toLowerCase())) return { owner: null, repo: null, rest: [] }
  if (p[0].toLowerCase() === 'orgs') return { owner: p[1] ?? null, repo: null, rest: [] }
  return { owner: p[0], repo: p[1] ?? null, rest: p.slice(2) }
}
// its first path part: the second-level chips' key (Hugging Face's owner, a wiki's "wiki"); GitHub's: the owner (none
// on GitHub's own pages)
export function pathTop(url) {
  const g = ghPath(url)
  return g ? g.owner : (parts(url)[0] ?? null)
}
// a GitHub link -> "owner/repo" ("owner" on an owner's page; null elsewhere): its titles look alike, the path tells
// them apart
export function repoOf(url) {
  const g = ghPath(url)
  return g?.owner ? [g.owner, g.repo].filter(Boolean).join('/') : null
}
// what a GitHub page is inside its repo, in a few words ("issue #12", "PR #7", "app.js"); null for the repo itself
function ghPage(rest) {
  const [kind, a, ...more] = rest
  if (!kind) return null
  const num = /^\d+$/.test(a ?? '') ? a : null
  if (kind === 'issues' && num) return `issue #${num}`
  if (kind === 'pull' && num) return `PR #${num}`
  if (kind === 'discussions' && num) return `discussion #${num}`
  if (kind === 'commit' && a) return `commit ${a.slice(0, 7)}`
  if (kind === 'releases' && a === 'tag' && more[0]) return `release ${more[0]}`
  if ((kind === 'blob' || kind === 'tree') && a) return more.at(-1) ?? a
  return [kind, a, ...more].filter(Boolean).join('/')
}
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// GitHub's title, less what the line under it says anyway: "GitHub - " in front; " · Issue #488 · owner/repo", " by
// dev42 · Pull Request #7 · owner/repo", " · owner/repo" at the end. Nothing left: null
function ghTitle(t, repo) {
  let x = t.replace(/^GitHub -\s*/, '')
  if (repo) x = x.replace(new RegExp(` · ${esc(repo)}$`, 'i'), '')
  x = x.replace(/ by \S+ · Pull Request #\d+$/, '').replace(/ · (?:Issue|Pull Request|Discussion) #\d+$/, '')
  return x.trim() || null
}

// A tile's lines -> { title, meta }. title: what the page calls itself; meta: under it, the site (and its domain).
// GitHub's are told apart by their path, as its titles all look alike ("GitHub - owner/repo: …"): the kind of page
// first (a cut line loses the repo, not the "issue #488"), then owner/repo; a repo's own pages (its home, releases,
// wiki: GitHub titles them all "owner/repo: description") are its name; any other page its own title, less GitHub's
// endings
const lines = new WeakMap() // (a pin's lines, once: the same pin object until the data changes)
export function linesOf(pin) {
  let l = lines.get(pin)
  if (!l) lines.set(pin, (l = linesOfPin(pin)))
  return l
}
function linesOfPin(pin) {
  const title = pin.title ?? null
  const generic = pin.site && pin.site.toLowerCase() !== pin.domain ? `${pin.site} · ${pin.domain}` : pin.domain
  const g = ghPath(pin.url)
  if (!g?.owner) return { title: title ?? pin.domain, meta: generic }
  const repo = repoOf(pin.url)
  if (!g.repo) return { title: (title && ghTitle(title, null)) || g.owner, meta: generic }
  const page = ghPage(g.rest)
  const meta = page ? `${page} · ${repo}` : repo
  const t = title ? ghTitle(title, repo) : null
  // (no title, or GitHub's "owner/repo: description" for one of the repo's own pages)
  if (!t || new RegExp(`^${esc(repo)}(:|$)`, 'i').test(t)) return { title: g.repo, meta }
  return { title: t, meta }
}

// a site's name: what its pages call it most ("GitHub"), short enough for a chip; else its domain
export function siteName(pins, domain) {
  const n = new Map()
  for (const p of pins) {
    const s = p.site?.trim()
    if (s && s.length <= 24) n.set(s, (n.get(s) ?? 0) + 1)
  }
  let best = null
  for (const [s, c] of n) if (!best || c > n.get(best)) best = s
  return best ?? domain
}

// ---- the pins, ready to filter: each once, whatever is typed ----

// pins (newest first) -> rows { pin, site, top, hay } and the sites { key, name, icon, total } (most pins first;
// a tie: the one pinned last first). hay: the search's text, folded once (lib/pins.js matches, without its per-call
// fold)
export function prepare(pins) {
  const rows = []
  const sites = new Map()
  for (const pin of pins) {
    const site = pin.domain || domainOf(pin.url) || '?'
    const top = pathTop(pin.url)
    rows.push({ pin, site, top: top?.toLowerCase() ?? null, hay: fold([pin.title, pin.description, pin.site, pin.url, pin.domain].filter(Boolean).join(' \n ')) })
    const s = sites.get(site) ?? { key: site, pins: [], last: -Infinity }
    s.pins.push(pin)
    s.last = Math.max(s.last, pin.addedAt ?? 0)
    sites.set(site, s)
  }
  const list = [...sites.values()]
    .map((s) => ({ key: s.key, name: siteName(s.pins, s.key), icon: s.pins.find((p) => p.icon)?.icon ?? null, total: s.pins.length, last: s.last }))
    .sort((a, b) => b.total - a.total || b.last - a.last || (a.key < b.key ? -1 : 1))
  // two sites by one name (en. and vi.wikipedia.org, both "Wikipedia"): their domains tell them apart
  const named = new Map()
  for (const x of list) named.set(x.name, (named.get(x.name) ?? 0) + 1)
  for (const x of list) if (named.get(x.name) > 1) x.name = x.key
  return { rows, sites: list }
}

const words = (q) => fold(q).split(/\s+/).filter(Boolean)

// The filters { q, site, sub, time } over prepare()'s rows -> {
//   found: the pins they leave (newest first),
//   sites: { key -> n }: each site's pins with the search and the time applied (not the site: its chip's count),
//   times: { any, today, 7d, 30d, older }: with the search, the site and its part applied (not the time),
//   subs: the picked site's parts (partsOf) with n: their pins with the search and the time applied
// }
// sub must be one of the site's parts (liveFilters): a part with no chip would filter unseen
export function facet(prep, { q = '', site = null, sub = null, time = 'any' } = {}, now = Date.now(), parts = site ? partsOf(prep, site) : []) {
  const w = words(q)
  const sites = {}
  const times = Object.fromEntries(TIMES.map(([k]) => [k, 0]))
  const found = []
  const n = new Map() // the picked site's parts -> pins with the search and the time applied
  for (const r of prep.rows) {
    if (w.length && !w.every((x) => r.hay.includes(x))) continue
    const okTime = inTime(r.pin.addedAt, time, now)
    const okSite = !site || r.site === site
    const okSub = !sub || r.top === sub
    if (okTime) sites[r.site] = (sites[r.site] ?? 0) + 1
    if (okSite && okSub) for (const [k] of TIMES) if (inTime(r.pin.addedAt, k, now)) times[k]++
    if (okSite && okSub && okTime) found.push(r.pin)
    if (okSite && okTime && r.top) n.set(r.top, (n.get(r.top) ?? 0) + 1)
  }
  return { found, sites, times, subs: parts.map((p) => ({ ...p, n: n.get(p.key) ?? 0 })) }
}

// A site's parts (its pins' first path part: GitHub's owners), as the site has them whatever is typed (chips don't
// come and go under the finger; a 0 one is dimmed) -> [{ key, label, total }], most pins first. label: as in its
// newest pin (GitHub's owners are any case: "TheWind121212" and "thewind121212" are one). Only for a big site whose
// parts group something: [] when each part is there once (chips that say nothing)
export function partsOf(prep, site) {
  const all = new Map()
  for (const r of prep.rows) {
    if (r.site !== site || !r.top) continue
    const p = all.get(r.top) ?? { key: r.top, label: pathTop(r.pin.url), total: 0 }
    p.total++
    all.set(r.top, p)
  }
  const big = prep.sites.find((s) => s.key === site)?.total ?? 0
  if (big < SUB_MIN || all.size < 2 || ![...all.values()].some((p) => p.total >= 2)) return []
  return [...all.values()].sort((a, b) => b.total - a.total || (a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1))
}

// The filters as picked -> the ones that still hold: a site with no pins left is none, and so is a part that's no
// longer among its chips (removed, or the site shrank below SUB_MIN). on: the filters show at all (a handful of pins:
// none of them). -> { site, sub, time, parts } (parts: the site's, partsOf). The sheet forgets the others, so an Undo
// or another tab's change never brings one back unseen
export function liveFilters(prep, { site = null, sub = null, time = 'any' } = {}, on = true) {
  const s = on && site && prep.sites.some((x) => x.key === site) ? site : null
  const parts = s ? partsOf(prep, s) : []
  return { site: s, sub: s && sub && parts.some((p) => p.key === sub) ? sub : null, time: on ? time : 'any', parts }
}

// ---- the two views ----

// pins (newest first) -> [{ key: day, pins }], newest day first
export function byDay(pins) {
  const days = new Map()
  for (const p of pins) {
    const k = dayKey(p.addedAt)
    if (!days.has(k)) days.set(k, [])
    days.get(k).push(p)
  }
  return [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, list]) => ({ key, pins: list.sort((a, b) => b.addedAt - a.addedAt) }))
}

// pins -> [{ key: domain, n, last, pins }]: the biggest site first (a tie: the one pinned last), each newest first
export function bySite(pins) {
  const sites = new Map()
  for (const p of pins) {
    const k = p.domain || domainOf(p.url) || '?'
    if (!sites.has(k)) sites.set(k, [])
    sites.get(k).push(p)
  }
  return [...sites]
    .map(([key, list]) => {
      list.sort((a, b) => b.addedAt - a.addedAt)
      return { key, n: list.length, last: list[0].addedAt, pins: list }
    })
    .sort((a, b) => b.n - a.n || b.last - a.last || (a.key < b.key ? -1 : 1))
}

// how many of a section to show: all of a short one (or opened), else the first SECTION_SHOWN
export const shownOf = (n, open) => (open || n <= SECTION_SHOWN + SECTION_SLACK ? n : SECTION_SHOWN)

export const RENDER_STEP = 60 // tiles drawn at first, and again each time the list's end comes near (500 at once is slow)

// What to draw of the sections: their sizes, each one's state ({ open, shut }) and how many tiles may be drawn ->
// { parts: [{ take, cut }] for the sections drawn (the first few; the rest wait), more: something is left for later }.
// take: its tiles to draw; cut: fewer than it would show, for now (the rest comes as the list scrolls, "Show N more"
// too: 300 tiles at once is a long freeze). A folded one keeps its tiles (they fold away, animated) but they don't
// count: nothing of it shows
export function plan(sizes, states, budget) {
  const parts = []
  let left = budget
  for (let i = 0; i < sizes.length && left > 0; i++) {
    const want = shownOf(sizes[i], states[i]?.open)
    const take = Math.min(want, left)
    parts.push({ take, cut: take < want })
    if (!states[i]?.shut) left -= take
  }
  return { parts, more: parts.length < sizes.length || parts.some((x) => x.cut) }
}

// ---- the search's highlights ----

// one character -> its folded form (lib/pins.js fold, a character at a time: an accent alone folds to nothing). Plain
// ASCII skips the Unicode work
const foldChar = (c) => (c.charCodeAt(0) < 128 ? c.toLowerCase() : c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd'))

// A text and the query -> [{ text, hit }]: the words found in it marked, matched as the search matches (lib/pins.js
// fold: no case, no accents; "da lat" marks "Đà Lạt", an "Đà" written with a separate accent keeps it inside the mark).
// Overlapping words make one mark. Words of one letter mark nothing (every "a" lit up while typing is noise). Most
// texts have none of the words: one fold of the whole text says so, and that's all they cost
export function marks(text, query) {
  const s = String(text ?? '')
  const w = words(query ?? '').filter((x) => x.length >= 2)
  if (!s || !w.length) return s ? [{ text: s, hit: false }] : []
  const whole = fold(s)
  if (!w.some((x) => whole.includes(x))) return [{ text: s, hit: false }]
  // the folded text a character at a time, and for each of its UTF-16 units where it came from in the text
  let folded = ''
  const from = []
  const cps = Array.from(s)
  const at = [] // each code point's index in s
  for (let i = 0, k = 0; i < cps.length; k += cps[i].length, i++) {
    at.push(k)
    const f = foldChar(cps[i])
    folded += f
    for (let u = 0; u < f.length; u++) from.push(i) // (per UTF-16 unit, as indexOf counts: an emoji is two)
  }
  at.push(s.length)
  // (the whole text's fold where it lines up: a letter that folds by its place, Greek's final ς, matches as searched)
  if (whole.length === folded.length) folded = whole
  const hits = Array(cps.length).fill(false)
  for (const x of w) {
    for (let j = folded.indexOf(x); j >= 0; j = folded.indexOf(x, j + 1)) {
      const a = from[j]
      let b = from[j + x.length - 1] + 1
      // (an accent written apart folds to nothing: it goes with its letter)
      while (b < cps.length && foldChar(cps[b]) === '') b++
      for (let i = a; i < b; i++) hits[i] = true
    }
  }
  const out = []
  for (let i = 0; i < cps.length; ) {
    let j = i
    while (j < cps.length && hits[j] === hits[i]) j++
    out.push({ text: s.slice(at[i], at[j]), hit: hits[i] })
    i = j
  }
  return out
}

// ---- the sheet's keys ----

// a key press while the sheet is open -> what it does: 'focus' (/ to the box, unless typing in a field), 'clear-q'
// (Esc: the search first), 'clear-filters' (then the filters), or null (Esc with nothing left: the sheet closes as
// ever). typing: the key went to a field; q: something typed; filtered: a site or a time is picked
export function sheetKey(e, { typing = false, q = false, filtered = false } = {}) {
  // (an IME composing: its Esc is the IME's, a "/" a character of the word)
  if (!e || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return null
  if (e.key === '/' && !typing && !e.repeat) return 'focus'
  if (e.key === 'Escape') return q ? 'clear-q' : filtered ? 'clear-filters' : null
  return null
}
