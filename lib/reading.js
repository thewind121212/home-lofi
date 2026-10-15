// Reading: the books the owner is partway through in Kavita (several at once), for the slim Reading bar under Sounds
// and its sheet (app/reading.js). The rules only, no network and no React, so node:test checks them; the Kavita client
// is lib/kavita.js, the owner-only routes app/api/private/settings/reading (+ /cover).
// - In progress = Kavita's own On Deck list (started, not finished), minus anything not opened for MAX_AGE_DAYS: a
//   book put down two months ago isn't one being read. Most recently read first.
// - Kavita writes its read dates in the server's local time with no offset ("2026-10-15T12:47:08.1465046"): they're
//   read in KAVITA_TZ (Kavita's zone, Asia/Ho_Chi_Minh unless set).
// - Links go to Kavita's public address (KAVITA_PUBLIC_URL) at the book's continue point, in the reader that fits its
//   format; without a continue point, the series page.
export const MAX_AGE_DAYS = 60
export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh'
export const MAX_BOOKS = 20 // (the on-deck page asked for: plenty for "a few at once")
const DAY = 86_400_000

// Kavita's MangaFormat -> the reader's path segment (epub's own reader, the PDF one, pages for the rest)
export const FORMAT = { image: 0, archive: 1, epub: 3, pdf: 4 }
const READER = { 3: 'book', 4: 'pdf' } // (anything else: 'manga', as Kavita's own getNavigationArray)

const posInt = (v) => Number.isInteger(v) && v > 0 && v <= 2 ** 31 - 1
export const validId = posInt

// a time zone Intl knows, else the default (a typo in the env mustn't throw on every request)
export function zoneOf(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return DEFAULT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() })
    return tz.trim()
  } catch {
    return DEFAULT_TZ
  }
}

// the zone's offset from UTC (ms) at an instant
function offsetAt(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
}

// a Kavita date -> epoch ms, or null (missing, junk, or Kavita's "never": 0001-01-01). With an offset or Z it's
// taken as written; without one it's the wall clock in `tz`
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/
export function kavitaTime(s, tz = DEFAULT_TZ) {
  const m = STAMP.exec(typeof s === 'string' ? s.trim() : '')
  if (!m || +m[1] < 1970) return null
  const ms = m[7] ? Math.round(Number(`0${m[7]}`) * 1000) : 0
  if (m[8]) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[8].length === 5 ? `${m[8].slice(0, 3)}:${m[8].slice(3)}` : m[8]}`)
    return Number.isFinite(t) ? t + ms : null
  }
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  if (!Number.isFinite(wall)) return null
  const zone = zoneOf(tz)
  // (the offset at the guess, then again at the answer: right across a DST change too)
  let t = wall - offsetAt(wall, zone)
  t = wall - offsetAt(t, zone)
  return t + ms
}

// how far in, 0-100. Started but under 1 %: 1 (it's begun); nearly done but not quite: 99 (not "100 %" while unread
// pages are left)
export function percent(read, pages) {
  if (!Number.isFinite(read) || !Number.isFinite(pages) || pages <= 0 || read <= 0) return 0
  if (read >= pages) return 100
  return Math.min(99, Math.max(1, Math.round((read / pages) * 100)))
}

// KAVITA_PUBLIC_URL -> its origin + path without the trailing slash, or null (not http(s), credentials in it, junk)
export function publicBase(url) {
  if (typeof url !== 'string' || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

// the reader at a chapter (the continue point), or the series page without one
export function readerPath({ libraryId, seriesId, chapterId, format }) {
  if (!posInt(libraryId) || !posInt(seriesId)) return null
  const series = `/library/${libraryId}/series/${seriesId}`
  if (!posInt(chapterId)) return series
  return `${series}/${READER[format] ?? 'manga'}/${chapterId}`
}

// Kavita's on-deck SeriesDto list -> the books in progress, most recent first:
// [{ id, name, libraryId, format, pages, pagesRead, percent, readAt, coverV }]. Anything odd is left out: not an id,
// nothing read, all read, no read date, or not read for maxAgeDays.
export function inProgress(series, { now = Date.now(), tz = DEFAULT_TZ, maxAgeDays = MAX_AGE_DAYS } = {}) {
  if (!Array.isArray(series)) return []
  const seen = new Set()
  const out = []
  for (const s of series) {
    if (!s || typeof s !== 'object' || !posInt(s.id) || !posInt(s.libraryId) || seen.has(s.id)) continue
    const pages = Number(s.pages), pagesRead = Number(s.pagesRead)
    if (!(pages > 0) || !(pagesRead > 0) || pagesRead >= pages) continue
    const readAt = kavitaTime(s.latestReadDate, tz)
    if (readAt == null || now - readAt > maxAgeDays * DAY) continue
    seen.add(s.id)
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 200) : `Series ${s.id}`
    // the cover file's name changes with the cover: it versions the cover's address (a new one isn't served from cache)
    const coverV = typeof s.coverImage === 'string' ? s.coverImage.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) : ''
    out.push({ id: s.id, name, libraryId: s.libraryId, format: Number.isInteger(s.format) ? s.format : null, pages, pagesRead, percent: percent(pagesRead, pages), readAt: Math.min(readAt, now), coverV })
  }
  return out.sort((a, b) => b.readAt - a.readAt || a.name.localeCompare(b.name)).slice(0, MAX_BOOKS)
}

// the bar's line: one book -> its name and how far ("Reading · Dungeon Crawler Carl · 1%"); more -> how many and the
// latest ("Reading · 2 books · Dungeon Crawler Carl 1%"). The how-far is the bar's tail: on a narrow phone only the
// title gives way ("Reading · 3 books · Dungeon Cra… 1%"). None -> null (no bar). -> { value, detail, tail, label }
export function barLine(books) {
  if (!Array.isArray(books) || !books.length) return null
  const [b] = books
  if (books.length === 1) return { value: b.name, detail: null, tail: `· ${b.percent}%`, label: `Reading ${b.name}, ${b.percent}%. Open` }
  const n = `${books.length} books`
  return { value: n, detail: b.name, tail: `${b.percent}%`, label: `Reading ${n}, latest ${b.name} at ${b.percent}%. Open them` }
}

// "last read …": 'just now', '5 min ago', '2 h ago', 'yesterday', '3 days ago', '5 weeks ago'
export function readAgo(at, now) {
  if (!Number.isFinite(at)) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  return `${Math.floor(d / 7)} weeks ago`
}
