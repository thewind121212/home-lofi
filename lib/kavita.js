// Kavita, the home's book server, for the owner's Reading bar. Server-only: import it only from the owner's routes
// app/api/private/settings/reading (+ /cover). Rules (what's in progress, links, the bar's line) in lib/reading.js.
// Needs KAVITA_URL (where this server reaches Kavita, e.g. http://kavita:5000 on the Coolify network) and
// KAVITA_API_KEY (a Kavita user's auth key: Kavita › User settings › API keys); either missing = off. KAVITA_PUBLIC_URL
// is where the owner's browser reaches it (the Continue links; none without it). KAVITA_TZ: Kavita's time zone.
// - The key never leaves this server: it buys a JWT (POST /api/Plugin/authenticate), kept in memory for TOKEN_TTL and
//   bought again once when Kavita says 401. Covers come through this server too (/cover), never straight from Kavita.
// - The list (on deck + each book's continue point) is kept LIST_TTL for every tab and device; one request to Kavita
//   at a time (callers meanwhile share it). Every call gives up after TIMEOUT.
// - Errors say only what failed ("kavita 502", "kavita unreachable"): never an address with the key in it.
import { MAX_BOOKS, inProgress, publicBase, readerPath, validId, zoneOf } from './reading.js'

const TIMEOUT = 6000
const TOKEN_TTL = 60 * 60_000
const LIST_TTL = 2 * 60_000
const COVER_MAX = 3 * 1024 * 1024 // a cover is ~200 KB; anything past this isn't one
const COVER_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/ // (no SVG: it can carry script)

const env = process.env
const base = () => (env.KAVITA_URL ?? '').trim().replace(/\/+$/, '')
export const kavitaOn = () => Boolean(base() && (env.KAVITA_API_KEY ?? '').trim())
// the fetch: the tests hand in their own (no network), like the pins route's fetcher
const fetcher = () => globalThis.__homeKavitaFetch ?? fetch

// the module's memory (on globalThis: the two routes are separate bundles, and the tests reset it)
const mem = () => (globalThis.__homeKavita ??= { token: null, list: null, loading: null })
export const resetKavita = () => void (globalThis.__homeKavita = null)

async function call(path, init = {}) {
  let r
  try {
    r = await fetcher()(`${base()}${path}`, { cache: 'no-store', redirect: 'error', ...init, signal: AbortSignal.timeout(TIMEOUT) })
  } catch {
    throw Object.assign(new Error('kavita unreachable'), { status: 0 })
  }
  return r
}

async function token() {
  const m = mem()
  if (m.token && Date.now() < m.token.until) return m.token.value
  const q = new URLSearchParams({ apiKey: env.KAVITA_API_KEY.trim(), pluginName: 'home-lofi' })
  const r = await call(`/api/Plugin/authenticate?${q}`, { method: 'POST' })
  if (!r.ok) throw Object.assign(new Error(`kavita auth ${r.status}`), { status: r.status })
  const j = await r.json().catch(() => null)
  if (typeof j?.token !== 'string' || !j.token) throw Object.assign(new Error('kavita auth: no token'), { status: 502 })
  m.token = { value: j.token, until: Date.now() + TOKEN_TTL }
  return j.token
}

// an API call with the token; a 401 buys a fresh one and tries once more
async function api(path, init = {}) {
  for (let i = 0; ; i++) {
    const r = await call(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${await token()}` } })
    if (r.status === 401 && i === 0) {
      mem().token = null
      continue
    }
    if (!r.ok) throw Object.assign(new Error(`kavita ${r.status}`), { status: r.status })
    return r
  }
}

const json = async (r) => {
  try {
    return await r.json()
  } catch {
    throw Object.assign(new Error('kavita: not JSON'), { status: 502 })
  }
}

// each book's continue point (a chapter id), or null (that one then links to its series page)
async function continueAt(id) {
  try {
    const c = await json(await api(`/api/reader/continue-point?seriesId=${id}`))
    return validId(c?.id) ? c.id : null
  } catch {
    return null
  }
}

async function load() {
  const q = new URLSearchParams({ libraryId: '0', PageNumber: '1', PageSize: String(MAX_BOOKS) })
  const deck = await json(await api(`/api/Series/on-deck?${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
  const now = Date.now()
  const books = inProgress(deck, { now, tz: zoneOf(env.KAVITA_TZ) })
  const chapters = await Promise.all(books.map((b) => continueAt(b.id)))
  return books.map((b, i) => ({ ...b, chapterId: chapters[i] }))
}

// -> { books, at } (kept LIST_TTL); throws when Kavita can't be reached or says no
export async function readingList({ fresh = false } = {}) {
  const m = mem()
  if (!fresh && m.list && Date.now() - m.list.at < LIST_TTL) return m.list
  if (m.loading) return m.loading
  m.loading = load()
    .then((books) => (m.list = { books, at: Date.now() }))
    .finally(() => (m.loading = null))
  return m.loading
}

// the books Kavita answered with last (fresh or not), for the cover route's "only books on the list"
export const lastList = () => mem().list

// a list's book -> what the page gets (no Kavita address, no key: links to the public address only)
export function bookView(b, pub = publicBase(env.KAVITA_PUBLIC_URL)) {
  const path = readerPath({ libraryId: b.libraryId, seriesId: b.id, chapterId: b.chapterId, format: b.format })
  const series = readerPath({ libraryId: b.libraryId, seriesId: b.id })
  return {
    id: b.id,
    name: b.name,
    pages: b.pages,
    pagesRead: b.pagesRead,
    percent: b.percent,
    readAt: b.readAt,
    href: pub && path ? `${pub}${path}` : null,
    seriesHref: pub && series ? `${pub}${series}` : null,
    cover: `/api/private/settings/reading/cover?id=${b.id}${b.coverV ? `&v=${encodeURIComponent(b.coverV)}` : ''}`,
  }
}

// a series' cover -> { type, body: Uint8Array }; throws (status 502) for anything that isn't a picture of sane size
export async function seriesCover(id) {
  if (!validId(id)) throw Object.assign(new Error('bad id'), { status: 400 })
  const r = await api(`/api/image/series-cover?seriesId=${id}`)
  const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const bad = (why) => Object.assign(new Error(`kavita cover: ${why}`), { status: 502 })
  if (!COVER_TYPES.test(type)) {
    await r.body?.cancel().catch(() => {})
    throw bad('not a picture')
  }
  if (Number(r.headers.get('content-length')) > COVER_MAX) {
    await r.body?.cancel().catch(() => {})
    throw bad('too large')
  }
  // (read with a cap: a missing or wrong length doesn't let a huge body through)
  const parts = []
  let size = 0
  const reader = r.body?.getReader()
  if (!reader) throw bad('empty')
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > COVER_MAX) {
      await reader.cancel().catch(() => {})
      throw bad('too large')
    }
    parts.push(value)
  }
  if (!size) throw bad('empty')
  const body = new Uint8Array(size)
  let at = 0
  for (const p of parts) body.set(p, at), (at += p.byteLength)
  return { type, body }
}
