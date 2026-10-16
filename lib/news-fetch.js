// The news agent's digests, for the owner's News (rules in lib/news.js). Server-only: import it only from the owner's
// route app/api/private/settings/news. NEWS_URL is where this server reaches the agent (e.g. http://10.10.0.162:8090,
// a machine on the LAN the browser never needs to reach); empty = off.
// - latest.json is kept LATEST_TTL for every tab and device, the archive's listing LIST_TTL, an archived digest (it
//   never changes) for good, the newest few. One request per file at a time (callers meanwhile share it); each gives
//   up after TIMEOUT, and a failed one is remembered FAIL_TTL, so while the agent's machine is down the page's asks
//   fail at once instead of waiting again.
// - Nothing past MAX_BYTES is read; no redirects followed.
// - A run (Refresh: the agent makes an edition now, /api/run): its /api/status kept STATUS_TTL. Once a run is seen
//   done, latest.json and the listing are asked again (once per run), so the new edition shows at once. The agent's
//   own limits (a cooldown, so many a day) answer 429 with how long to wait: kept, so every device knows.
import { archiveNames, cleanDigest, cleanRun, validArchive } from './news.js'

const TIMEOUT = 6000
const LATEST_TTL = 60_000
const LIST_TTL = 5 * 60_000
const FAIL_TTL = 15_000
const STATUS_TTL = 4000
const KEEP_ARCHIVED = 12
const MAX_BYTES = 2 * 1024 * 1024

const base = () => (process.env.NEWS_URL ?? '').trim().replace(/\/+$/, '')
export const newsOn = () => /^https?:\/\//i.test(base())
// the fetch: the tests hand in their own (no network)
const fetcher = () => globalThis.__homeNewsFetch ?? fetch

// the module's memory (globalThis: the tests reset it)
const mem = () => (globalThis.__homeNews ??= { files: new Map(), loading: new Map(), done: null, nextAt: 0 })
export const resetNews = () => void (globalThis.__homeNews = null)

// the agent's answer (method: GET, or POST for a run), or throws "news unreachable" (never the address)
async function ask(path, method = 'GET') {
  try {
    return await fetcher()(`${base()}${path}`, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT) })
  } catch {
    throw Object.assign(new Error('news unreachable'), { status: 0 })
  }
}

// a file's body (text), or throws ("news unreachable", "news 404")
async function get(path) {
  const r = await ask(path)
  if (!r.ok) {
    r.body?.cancel().catch(() => {})
    throw Object.assign(new Error(`news ${r.status}`), { status: r.status })
  }
  return body(r)
}

// an answer's body, MAX_BYTES at most
async function body(r) {
  const big = () => Object.assign(new Error('news: too large'), { status: 502 })
  if (Number(r.headers.get('content-length')) > MAX_BYTES) {
    r.body?.cancel().catch(() => {})
    throw big()
  }
  // (counted as it comes: a body with no length, or a wrong one, stops at MAX_BYTES)
  if (!r.body) return ''
  const reader = r.body.getReader()
  const chunks = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    if (n > MAX_BYTES) {
      reader.cancel().catch(() => {})
      throw big()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

// one file, through the memory: kept `ttl` (Infinity: for good), a failure FAIL_TTL; parse turns its text into what's
// kept (throwing: not what was expected)
function cached(path, ttl, parse) {
  const m = mem()
  const hit = m.files.get(path)
  const now = Date.now()
  if (hit && now < hit.until) return hit.error ? Promise.reject(hit.error) : Promise.resolve(hit.value)
  if (m.loading.has(path)) return m.loading.get(path)
  const p = get(path)
    .then((text) => {
      const value = parse(text)
      m.files.set(path, { value, until: Date.now() + ttl, at: Date.now() })
      return value
    })
    .catch((error) => {
      // (a failure doesn't wipe a good copy: the page can still be shown what was there)
      m.files.set(path, hit?.value !== undefined && !hit.error ? { ...hit, until: Date.now() + FAIL_TTL, stale: true } : { error, until: Date.now() + FAIL_TTL })
      if (hit?.value !== undefined && !hit.error) return hit.value
      throw error
    })
    .finally(() => m.loading.delete(path))
  m.loading.set(path, p)
  // the archive: only the newest few kept
  const old = [...m.files.keys()].filter((k) => k.startsWith('/archive/') && k !== '/archive/')
  for (const k of old.slice(0, Math.max(0, old.length - KEEP_ARCHIVED))) m.files.delete(k)
  return p
}

const digest = (text) => {
  const d = cleanDigest(JSON.parse(text))
  if (!d) throw Object.assign(new Error('news: not a digest'), { status: 502 })
  return d
}

// -> the newest digest (cleaned)
export const latest = () => cached('/latest.json', LATEST_TTL, digest)
// the agent didn't answer the last ask: latest() is the copy from before
export const latestStale = () => Boolean(mem().files.get('/latest.json')?.stale)
// -> an archived one by its name (lib/news.js validArchive)
export function archived(name) {
  if (!validArchive(name)) return Promise.reject(Object.assign(new Error('news: no such edition'), { status: 404 }))
  return cached(`/archive/${name}`, Infinity, digest)
}
// -> the archive's names, newest first ([] when there's no listing: the agent may not keep one)
export function editions() {
  return cached('/archive/', LIST_TTL, (text) => {
    try {
      return archiveNames(JSON.parse(text))
    } catch {
      return archiveNames(text)
    }
  }).catch(() => [])
}

// ---- a run ----

// a run done that the latest copy here is older than: latest.json and the listing asked again (once per run; one already
// on its way may be from before it, so it isn't waited on either)
function after(run) {
  const m = mem()
  if (run?.state !== 'done') return false
  const key = run.job ?? String(run.finishedAt)
  if (m.done === key) return false
  const first = m.done == null
  m.done = key
  // (the first one this server sees: whatever it fetched is from after it, unless it's older than the run's end)
  const hit = m.files.get('/latest.json')
  if (first && (!hit || hit.error || run.finishedAt == null || hit.at >= run.finishedAt)) return false
  for (const k of ['/latest.json', '/archive/']) {
    m.files.delete(k)
    m.loading.delete(k)
  }
  return true
}

// -> { run (lib/news.js cleanRun) | null (the agent has no runs, or didn't answer), nextAt (no refresh before then, ms;
//    0: any time), fresh (a run just done: ask latest() again) }
export async function runState() {
  const run = await cached('/api/status', STATUS_TTL, (text) => {
    const r = cleanRun(JSON.parse(text))
    if (!r) throw Object.assign(new Error('news: not a status'), { status: 502 })
    return r
  }).catch(() => null)
  const m = mem()
  return { run, nextAt: m.nextAt > Date.now() ? m.nextAt : 0, fresh: after(run) }
}

// Refresh: the agent makes an edition now -> { started: true } (it was idle) | { started: false } (one already going) |
// { nextAt } (its limits: not before then), or throws (unreachable, 502 anything else)
export async function startRun() {
  const r = await ask('/api/run', 'POST')
  let j = null
  try {
    j = JSON.parse(await body(r))
  } catch {}
  const m = mem()
  m.files.delete('/api/status')
  if (r.status === 202 || r.status === 409) return { started: r.status === 202 }
  if (r.status === 429) {
    const s = Number(j?.retry_after_s)
    m.nextAt = Date.now() + (Number.isFinite(s) && s > 0 ? Math.min(s, 86_400) : 600) * 1000
    return { nextAt: m.nextAt }
  }
  throw Object.assign(new Error(`news run ${r.status}`), { status: 502 })
}
