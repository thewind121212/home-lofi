// Tavarian's "home player" (the music card's Player tab). Server-only: import it only from app/api/** and lib/tavarian-hub.js.
// This server holds the one API token (TAVARIAN_TOKEN, env only: never in git, a log, a response or a browser) and
// calls Tavarian for every command; browsers only get audio straight from Tavarian, with a short-lived ticket.
// Public on purpose: what plays and the queue (titles, thumbnails, YouTube ids). Nothing about the token or account.
const env = process.env
const TIMEOUT = 5000
export const IMPORT_TIMEOUT = 120_000 // an import (YouTube / Spotify playlist) can take tens of seconds on Tavarian
const TTL = 3000 // state + queue: every visitor's first paint shares one answer per 3 s

export const tavarianUrl = () => (env.TAVARIAN_URL || 'https://tavarian.wliafdew.dev').replace(/\/+$/, '')
export const tavarianOn = () => Boolean(env.TAVARIAN_TOKEN)

// TAVARIAN_PROXY (an HTTP proxy, e.g. the home WARP proxy): this server's calls to Tavarian go through it, because the
// direct route from home to Tavarian's host loses packets at times. Browsers' audio stays direct. Empty or `off` = direct.
// If the proxy itself fails, the call is made again directly: that route is slow at worst, not dead.
let proxied = null // { url, fetch }, built on first use
async function viaProxy(url) {
  if (proxied?.url !== url) {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici')
    const dispatcher = new ProxyAgent(url)
    proxied = { url, fetch: (u, init) => undiciFetch(u, { ...init, dispatcher }) }
  }
  return proxied.fetch
}
export async function tavarianFetch(url, init) {
  const proxy = env.TAVARIAN_PROXY
  if (!proxy || proxy === 'off') return fetch(url, init)
  try {
    return await (await viaProxy(proxy))(url, init)
  } catch (e) {
    if (init?.signal?.aborted) throw e
    return fetch(url, init)
  }
}

// Retry-After: seconds or an HTTP date -> seconds, else null
export function retryAfter(value, now = Date.now()) {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Number(value)
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

const CODE = /^[a-z][a-z0-9_]{0,63}$/ // Tavarian's error codes; anything else becomes http_<status>

// One API call -> { ok: true, status, data } or { ok: false, status, error: '<code>', retryAfter? }. Never throws:
// HTTP errors keep Tavarian's code, a network failure is 'unreachable' (status 0), no answer in 5 s (or `timeout` ms)
// is 'timeout'. No Origin header on purpose (Tavarian refuses API calls that carry one; Node's fetch sends none).
export async function call(method, path, body, { timeout = TIMEOUT } = {}) {
  const token = env.TAVARIAN_TOKEN
  if (!token) return { ok: false, status: 0, error: 'tavarian_off' }
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const signal = AbortSignal.timeout(timeout)
  const failed = (e) => ({ ok: false, status: 0, error: e?.name === 'TimeoutError' || signal.aborted ? 'timeout' : 'unreachable' })
  let r
  try {
    r = await tavarianFetch(`${tavarianUrl()}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      redirect: 'manual', // a redirect is an error here, never a second hop with the token
      signal,
    })
  } catch (e) {
    return failed(e)
  }
  const wait = retryAfter(r.headers.get('retry-after'))
  if (r.status === 204) return { ok: true, status: 204, data: null }
  let j = null
  try {
    j = JSON.parse(await r.text())
  } catch (e) {
    if (e?.name === 'TimeoutError' || signal.aborted) return failed(e)
  }
  if (r.ok && j?.success === true) return { ok: true, status: r.status, data: j.data ?? null }
  const error = typeof j?.error === 'string' && CODE.test(j.error) ? j.error : r.ok ? 'bad_response' : `http_${r.status}`
  return { ok: false, status: r.ok ? 502 : r.status, error, ...(wait != null && { retryAfter: wait }) }
}

// ---- public shapes: only the listed fields pass through ----
const isObj = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o)
const pick = (keys) => (o) => (isObj(o) ? Object.fromEntries(keys.map((k) => [k, o[k] ?? null])) : null)
const listOf = (f) => (a) => (Array.isArray(a) ? a.filter(isObj).map(f) : [])

// title / thumbnail are what to show (Spotify's name and cover when the station plays from Spotify and the song has
// them: metadataSource 'spotify'); the YouTube and Spotify ones are kept apart too
const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 20) : null)
const songPick = pick(['id', 'youtubeId', 'title', 'thumbnail', 'durationSeconds', 'status', 'addedAt', 'playedAt', 'failReason', 'source', 'spotifyUri', 'artist', 'matchConfidence', 'metadataSource', 'youtubeTitle', 'youtubeThumbnail', 'spotifyTitle', 'spotifyThumbnail', 'artists', 'album'])
export const shapeSong = (s) => {
  const o = songPick(s)
  return o && { ...o, artists: strs(o.artists) }
}
const VIA = ['youtube', 'spotify']
const count = (v) => Number.isSafeInteger(v) && v >= 0
// Spotify autoplay (the queue ran out in Spotify mode, Spotify picks): the current song is pick `played` of `limit`
const shapeAutoplay = (a) => (isObj(a) && count(a.played) && count(a.limit) && a.limit > 0 ? { played: a.played, limit: a.limit } : null)
export function shapeState(s) {
  if (!isObj(s)) return null
  return {
    song: shapeSong(s.song),
    status: s.status ?? 'idle',
    positionSeconds: s.positionSeconds ?? 0,
    startedAtMs: s.startedAtMs ?? null,
    serverNowMs: s.serverNowMs ?? null,
    streamId: s.streamId ?? null,
    playingVia: VIA.includes(s.playingVia) ? s.playingVia : null, // which backend plays the current song
    // paused because Spotify can't be used right now (search not set up, logged out…): the song waits, not skipped
    stalledReason: typeof s.stalledReason === 'string' && /^[a-z_]{1,40}$/.test(s.stalledReason) ? s.stalledReason : null,
    autoplay: shapeAutoplay(s.autoplay), // null: the song isn't a Spotify autoplay pick
  }
}
export const shapeQueue = (q) => (isObj(q) ? { items: listOf(shapeSong)(q.items), recent: listOf(shapeSong)(q.recent) } : null)
export const shapeAudioReady = pick(['streamId', 'startedAtMs', 'serverNowMs'])
export const shapeSongError = pick(['songId', 'reason'])
// a search result: a YouTube video, or (source 'spotify') a Spotify track with its artists, album and cover; url = the
// link to add it with
const resultPick = pick(['source', 'url', 'youtubeId', 'youtubeUrl', 'spotifyUri', 'spotifyUrl', 'title', 'artists', 'artist', 'album', 'thumbnail', 'channel', 'durationSeconds', 'explicit'])
export const shapeResult = (r) => {
  const o = resultPick(r)
  return o && { ...o, source: o.source === 'spotify' ? 'spotify' : 'youtube', artists: strs(o.artists), url: o.url ?? o.youtubeUrl }
}
export const shapePlaylist = pick(['id', 'name', 'songCount', 'coverThumbnail', 'createdAt', 'updatedAt'])
export const shapePlaylistSong = pick(['youtubeId', 'youtubeUrl', 'title', 'thumbnail', 'addedAt'])
export const shapeTokenInfo = pick(['name', 'scopes', 'createdAt', 'expiresAt', 'lastUsedAt'])
// an import's answer: what was found, added (queued songs), skipped (with a reason code) and left out (truncated)
const shapeSource = (s) => (typeof s === 'string' ? s.slice(0, 200) : pick(['kind', 'type', 'id', 'title', 'name'])(s))
export function shapeImport(d) {
  if (!isObj(d)) return null
  const t = isObj(d.truncated) ? pick(['limit', 'dropped', 'reason'])(d.truncated) : null
  return {
    source: shapeSource(d.source),
    added: listOf(shapeSong)(d.added),
    skipped: listOf(pick(['youtubeId', 'title', 'reason']))(d.skipped),
    found: typeof d.found === 'number' ? d.found : null,
    truncated: t,
  }
}

// A state that was received `at` (this server's clock), moved on to `now`: serverNowMs, and the position while
// playing, so a page that gets an older snapshot still starts at the right spot
export function freshen(state, at, now = Date.now()) {
  const age = Math.max(0, now - (at ?? now))
  if (!state || !age) return state
  const out = { ...state }
  if (typeof out.serverNowMs === 'number') out.serverNowMs += age
  if (out.status === 'playing' && typeof out.positionSeconds === 'number') {
    const end = out.song?.durationSeconds
    out.positionSeconds = Math.min(out.positionSeconds + age / 1000, typeof end === 'number' && end > 0 ? end : Infinity)
  }
  return out
}

// ---- state + queue, cached for every visitor; on a failure keep the last good answer ----
let cache = { at: 0, value: null, pending: null }
// { ok: true, state, queue, at, stale? , error? } or { ok: false, status, error }
export async function readHome() {
  if (cache.value && Date.now() - cache.at < TTL) return { ok: true, ...cache.value }
  cache.pending ??= Promise.all([call('GET', '/home/state'), call('GET', '/home/queue')]).then(([s, q]) => {
    cache.pending = null
    if (s.ok && q.ok) {
      const at = Date.now()
      cache = { at, value: { state: shapeState(s.data), queue: shapeQueue(q.data), at }, pending: null }
      return { ok: true, ...cache.value }
    }
    const bad = s.ok ? q : s
    if (cache.value) return { ok: true, ...cache.value, stale: true, error: bad.error } // Tavarian hiccup: the last answer
    return { ok: false, status: bad.status, error: bad.error, ...(bad.retryAfter != null && { retryAfter: bad.retryAfter }) }
  })
  return cache.pending
}
// after a command: ask again next time (the last answer stays as the fallback)
export const forget = () => {
  cache.at = 0
}
export const resetCache = () => {
  cache = { at: 0, value: null, pending: null }
}

// ---- listen tickets: one per browser tab (clientId), lasts 10 minutes ----
export const validClientId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)
// -> { ok: true, data: { ticket, expiresAt, streamUrl } }: the audio is
// `${streamUrl}?streamId=<state.streamId>&clientId=<clientId>&ticket=<ticket>`
export async function ticketFor(clientId) {
  if (!validClientId(clientId)) return { ok: false, status: 400, error: 'invalid_client_id' }
  const r = await call('POST', '/home/ticket', { clientId })
  if (!r.ok) return r
  const d = r.data
  if (!isObj(d) || typeof d.ticket !== 'string' || !d.ticket) return { ok: false, status: 502, error: 'bad_response' }
  const path = typeof d.streamBase === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(d.streamBase) ? d.streamBase : '/home-audio/stream'
  return { ok: true, status: 200, data: { ticket: d.ticket, expiresAt: d.expiresAt ?? null, streamUrl: tavarianUrl() + path } }
}

// ---- the owner's commands: each -> call()'s result with shaped data; bad input -> 400 without asking Tavarian ----
const ID = /^[A-Za-z0-9_-]{1,64}$/
const okId = (v) => (typeof v === 'string' || Number.isSafeInteger(v)) && ID.test(String(v))
const bad = (error = 'invalid_request') => ({ ok: false, status: 400, error })
const shaped = (f) => (r) => (r.ok ? { ...r, data: f(r.data) } : r)
const enc = encodeURIComponent

export const PLAYBACK = ['play', 'pause', 'resume', 'skip', 'stop', 'previous'] // previous: the last played song again now
// where an added / imported song goes: the end of the queue, next, or now (replaces what plays)
export const PLACEMENTS = ['end', 'next', 'now']
const okPlacement = (p) => p === undefined || PLACEMENTS.includes(p)
const okLink = (u) => typeof u === 'string' && Boolean(u.trim()) && u.length <= 500

export const addSong = async (youtubeUrl, placement) =>
  !okLink(youtubeUrl) ? bad('invalid_url')
  : !okPlacement(placement) ? bad()
  : shaped(shapeSong)(await call('POST', '/home/queue', { youtubeUrl: youtubeUrl.trim(), ...(placement && { placement }) }))
// a whole YouTube playlist, or a Spotify playlist / album / track (matched on YouTube): a long call
export const importLink = async (url, placement) =>
  !okLink(url) ? bad('unsupported_url')
  : !okPlacement(placement) ? bad()
  : shaped(shapeImport)(await call('POST', '/home/queue/import', { url: url.trim(), ...(placement && { placement }) }, { timeout: IMPORT_TIMEOUT }))
// a queued song: play it now (what plays goes to Recently played), or move it to the front of the queue
export const playNow = async (id) => (okId(id) ? shaped(shapeState)(await call('POST', '/home/playback/play-now', { id })) : bad())
export const playNext = async (id) => (okId(id) ? shaped(shapeQueue)(await call('POST', '/home/queue/next', { id })) : bad())
export const removeSong = async (id) => (okId(id) ? shaped(shapeQueue)(await call('DELETE', `/home/queue/${enc(id)}`)) : bad())
export const reorderQueue = async (ids) =>
  Array.isArray(ids) && ids.length <= 500 && ids.every(okId) ? shaped(shapeQueue)(await call('POST', '/home/queue/reorder', { ids })) : bad()
let stationAt = 0
let stationSource = null
// source: 'youtube' | 'spotify', or anything else = the station's own (Spotify while it plays from Spotify and Tavarian
// can search it) -> { results, source }
export const SEARCH_SOURCES = ['youtube', 'spotify']
async function stationSearchSource() {
  if (Date.now() - stationAt < 30_000 && stationSource) return stationSource
  const r = await stationSettings()
  if (!r.ok) (stationSource = 'youtube'), (stationAt = Date.now())
  return stationSource
}
export const _resetSearchSourceForTests = () => ((stationAt = 0), (stationSource = null))
export async function searchSongs(q, source) {
  q = typeof q === 'string' ? q.trim() : ''
  if (q.length < 2 || q.length > 200) return bad()
  const from = SEARCH_SOURCES.includes(source) ? source : await stationSearchSource()
  const r = await call('GET', `/home/search?q=${enc(q)}${from === 'spotify' ? '&source=spotify' : ''}`)
  if (!r.ok) return r
  const results = listOf(shapeResult)(r.data)
  // where the results really came from (a Tavarian without Spotify search ignores source=spotify and answers YouTube)
  const got = from === 'spotify' && !results.some((x) => x.source === 'spotify') && results.length ? 'youtube' : from
  return { ...r, data: { results, source: got } }
}
// The Add sheet's one input: anything (words, a song link, a playlist / album link) -> what Tavarian made of it, without
// adding anything: { kind: 'search' | 'track' | 'list', source, items: [result], … } (lists: title, subtitle, thumbnail,
// total, truncated, importUrl to add them all, videoUrl for "just this song"; tracks: match / note). A YouTube link in
// Spotify mode is matched first (seconds), hence the longer wait
const KINDS = ['search', 'track', 'list']
const str = (v, max = 500) => (typeof v === 'string' && v ? v.slice(0, max) : null)
export function shapeResolved(d) {
  if (!isObj(d) || !KINDS.includes(d.kind)) return null
  const n = (v) => (Number.isFinite(v) ? v : null)
  return {
    kind: d.kind,
    source: d.source === 'spotify' ? 'spotify' : 'youtube',
    backend: d.backend === 'spotify' ? 'spotify' : 'youtube',
    items: listOf(shapeResult)(d.items),
    query: str(d.query),
    match: isObj(d.match) ? { confidence: n(d.match.confidence), fromUrl: str(d.match.fromUrl) } : null,
    note: str(d.note, 64),
    listType: str(d.listType, 32),
    title: str(d.title),
    subtitle: str(d.subtitle),
    thumbnail: str(d.thumbnail),
    total: n(d.total),
    truncated: d.truncated === true,
    importUrl: str(d.importUrl),
    videoUrl: str(d.videoUrl),
  }
}
export async function resolveInput(q, source) {
  q = typeof q === 'string' ? q.trim() : ''
  if (q.length < 2 || q.length > 2048) return bad()
  const from = SEARCH_SOURCES.includes(source) ? `&source=${source}` : ''
  return shaped(shapeResolved)(await call('GET', `/home/resolve?q=${enc(q)}${from}`, undefined, { timeout: 25_000 }))
}
export const playback = async (action) => (PLAYBACK.includes(action) ? shaped(shapeState)(await call('POST', `/home/playback/${action}`)) : bad())
export const seek = async (seconds) =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? shaped(shapeState)(await call('POST', '/home/playback/seek', { seconds })) : bad()
export const playlists = async () => shaped(listOf(shapePlaylist))(await call('GET', '/playlists'))
export const playlistSongs = async (id) => (okId(id) ? shaped(listOf(shapePlaylistSong))(await call('GET', `/playlists/${enc(id)}/songs`)) : bad())
export async function fromPlaylist(playlistId, youtubeIds) {
  if (!okId(playlistId)) return bad()
  if (youtubeIds !== undefined && !(Array.isArray(youtubeIds) && youtubeIds.length <= 500 && youtubeIds.every(okId))) return bad()
  const r = await call('POST', '/home/queue/from-playlist', youtubeIds === undefined ? { playlistId } : { playlistId, youtubeIds })
  return shaped((d) => ({ added: listOf(shapeSong)(d?.added), skipped: listOf(pick(['youtubeId', 'reason']))(d?.skipped) }))(r)
}
// many queued songs at once / the whole queue (one write each on Tavarian): -> { removed: n, skipped: [ids not
// queued], queue }. Tavarian wants the ids as numbers (1-200 of them); includeCurrent (clear) also stops what plays
export const BULK_MAX = 200
const okSongId = (v) => (Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v)))
const shapeRemoved = (d) => ({
  removed: typeof d?.removed === 'number' ? d.removed : 0,
  skipped: Array.isArray(d?.skipped) ? d.skipped.filter((x) => Number.isSafeInteger(x)) : [],
  queue: shapeQueue(d?.queue),
})
export const removeSongs = async (ids) =>
  Array.isArray(ids) && ids.length >= 1 && ids.length <= BULK_MAX && ids.every(okSongId)
    ? shaped(shapeRemoved)(await call('POST', '/home/queue/remove-bulk', { ids: [...new Set(ids.map(Number))] }))
    : bad('invalid_ids')
export const clearQueue = async (includeCurrent) =>
  includeCurrent !== undefined && typeof includeCurrent !== 'boolean' ? bad()
  : shaped(shapeRemoved)(await call('POST', '/home/queue/clear', includeCurrent ? { includeCurrent: true } : {}))
// the station's settings (owner): which backend plays the songs. backend reads 'youtube' until Spotify is set up on
// Tavarian (spotifyAvailable: its Spotify player is logged in); spotifySearch: Tavarian can look up YouTube songs on
// Spotify (its search keys are set); spotifyStatus: the Spotify player's state; pairing: the code that logs it in
// (owner only: our token has home:control, and this only goes through the owner's route; only a spotify.com link).
// autoplay: when the queue runs out in Spotify mode, Spotify's picks play on (autoplayLimit songs, then it pauses);
// null when this Tavarian doesn't have it yet (Settings hides the switch)
export const BACKENDS = ['youtube', 'spotify']
const SP_STATUS = ['off', 'starting', 'needs_login', 'ready', 'error']
const pairLink = (u) => {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' && /(^|\.)spotify\.com$/.test(x.hostname) ? x.href : null
  } catch {
    return null
  }
}
function shapePairing(p) {
  if (!isObj(p) || typeof p.code !== 'string' || !/^[A-Za-z0-9-]{4,16}$/.test(p.code)) return null
  return { code: p.code, url: pairLink(p.url) ?? 'https://www.spotify.com/pair', expiresAt: typeof p.expiresAt === 'string' ? p.expiresAt : null }
}
export const shapeSettings = (d) =>
  isObj(d)
    ? {
        backend: BACKENDS.includes(d.backend) ? d.backend : 'youtube',
        spotifyAvailable: d.spotifyAvailable === true,
        spotifySearch: d.spotifySearch === true,
        spotifyStatus: SP_STATUS.includes(d.spotifyStatus) ? d.spotifyStatus : 'off',
        pairing: shapePairing(d.pairing),
        autoplay: typeof d.autoplay === 'boolean' ? d.autoplay : null,
        autoplayLimit: count(d.autoplayLimit) && d.autoplayLimit > 0 ? d.autoplayLimit : null,
      }
    : null
// (every settings answer also refreshes the station's search source below, so a backend flip shows at once)
const noteSettings = (r) => {
  if (r.ok && r.data) (stationSource = r.data.backend === 'spotify' && r.data.spotifySearch ? 'spotify' : 'youtube'), (stationAt = Date.now())
  return r
}
export const stationSettings = async () => noteSettings(shaped(shapeSettings)(await call('GET', '/home/settings')))
export const setBackend = async (backend) => (BACKENDS.includes(backend) ? noteSettings(shaped(shapeSettings)(await call('PUT', '/home/settings', { backend }))) : bad())
export const setAutoplay = async (autoplay) =>
  typeof autoplay === 'boolean' ? noteSettings(shaped(shapeSettings)(await call('PUT', '/home/settings', { autoplay }))) : bad()
// log Tavarian's Spotify player in: it answers with a pairing code (up to ~8 s)
export const pairSpotify = async () => shaped(shapeSettings)(await call('PUT', '/home/settings', { pair: true }, { timeout: 15_000 }))
export const tokenInfo = async () => shaped(shapeTokenInfo)(await call('GET', '/token'))
export const revokeSelf = async () => call('POST', '/token/revoke-self')

// The owner route's actions: { action, ...args } -> { ok: true, data: <response body> } or call()'s failure.
// `changes`: the action changes state or queue (the cache asks Tavarian again).
const as = (key) => (r) => (r.ok ? { ...r, data: { [key]: r.data } } : r)
export const ACTIONS = {
  add: (b) => addSong(b.youtubeUrl, b.placement).then(as('song')),
  import: (b) => importLink(b.url, b.placement),
  'play-now': (b) => playNow(b.id).then(as('state')),
  next: (b) => playNext(b.id).then(as('queue')),
  remove: (b) => removeSong(b.id).then(as('queue')),
  'remove-bulk': (b) => removeSongs(b.ids),
  clear: (b) => clearQueue(b.includeCurrent),
  reorder: (b) => reorderQueue(b.ids).then(as('queue')),
  search: (b) => searchSongs(b.q, b.source),
  resolve: (b) => resolveInput(b.q, b.source).then(as('resolved')),
  ...Object.fromEntries(PLAYBACK.map((a) => [a, () => playback(a).then(as('state'))])),
  seek: (b) => seek(b.seconds).then(as('state')),
  playlists: () => playlists().then(as('playlists')),
  'playlist-songs': (b) => playlistSongs(b.id).then(as('songs')),
  'from-playlist': (b) => fromPlaylist(b.playlistId, b.youtubeIds),
  settings: () => stationSettings().then(as('settings')),
  backend: (b) => setBackend(b.backend).then(as('settings')),
  autoplay: (b) => setAutoplay(b.autoplay).then(as('settings')),
  pair: () => pairSpotify().then(as('settings')),
  token: () => tokenInfo().then(as('token')),
  revoke: () => revokeSelf().then((r) => (r.ok ? { ...r, data: { revoked: true } } : r)),
}
export const READS = new Set(['search', 'resolve', 'playlists', 'playlist-songs', 'settings', 'token'])
export const isAction = (a) => typeof a === 'string' && Object.hasOwn(ACTIONS, a)

// ---- Tavarian's error codes -> a clear message and a status for our own answer ----
export const TOKEN_DEAD = new Set(['invalid_token', 'token_revoked', 'token_expired', 'owner_gone'])
const MESSAGES = {
  tavarian_off: 'The player is not set up (no TAVARIAN_TOKEN)',
  unreachable: "Can't reach Tavarian",
  timeout: 'Tavarian took too long to answer',
  bad_response: 'Tavarian sent an answer we could not read',
  invalid_token: 'The Tavarian token no longer works: set a new TAVARIAN_TOKEN',
  token_revoked: 'The Tavarian token was revoked: set a new TAVARIAN_TOKEN',
  token_expired: 'The Tavarian token expired: set a new TAVARIAN_TOKEN',
  owner_gone: "The Tavarian token's owner no longer exists: set a new TAVARIAN_TOKEN",
  insufficient_scope: 'The Tavarian token is not allowed to do that (missing scope)',
  owner_not_admin: "The Tavarian token's owner is not an admin anymore",
  origin_not_allowed: 'Tavarian refused the call (origin not allowed)',
  rate_limited: 'Too many requests to Tavarian: try again in a moment',
  too_many_streams: 'Too many event streams open on Tavarian',
  home_player_not_configured: 'The home player is not set up in Tavarian yet',
  music_unavailable: "Tavarian can't reach YouTube or Spotify right now: try again in a moment",
  invalid_json: 'Tavarian could not read the request',
  invalid_request: 'That request is not valid',
  invalid_ids: 'Pick between 1 and 200 songs to remove',
  invalid_client_id: 'Bad clientId (8-64 of A-Z a-z 0-9 _ -)',
  invalid_url: 'That is not a YouTube video link',
  unsupported_url: 'Only YouTube and Spotify links work here (a video, a playlist, or a Spotify track, album or playlist)',
  mix_not_supported: "YouTube Mixes (the endless auto playlists) can't be imported: use a normal playlist",
  empty: 'Nothing to import: that playlist is empty',
  not_found: 'Not found (gone or never existed)',
  not_queued: 'That song already played',
  live_stream: "Live streams can't be played",
  unknown_duration: "That video's length is unknown, so it can't be played",
  no_match: 'No YouTube match',
  start_timeout: "The song didn't start, skipped",
  not_embeddable: "That video's owner doesn't allow playing it outside YouTube",
  too_long: 'That video is too long for the player',
  duplicate: 'That song is already in the queue',
  queue_full: 'The queue is full',
  queue_empty: 'The queue is empty',
  nothing_playing: 'Nothing is playing',
  nothing_before: 'Nothing played before this one yet',
  not_paused: 'It is not paused',
  spotify_unavailable: "Spotify playback isn't ready on Tavarian: connect Spotify first",
  spotify_search_off: "Spotify search isn't set up on Tavarian",
  no_spotify_match: 'No sure match on Spotify',
  spotify_search_unavailable: "Spotify search didn't answer: try again in a moment",
  spotify_unplayable: "Spotify can't play that track here",
  youtube_lookup_unavailable: "Couldn't look the song up on YouTube right now",
  http_404: "Tavarian doesn't know that command yet (it may need an update)",
}
export const errorMessage = (code) => MESSAGES[code] ?? 'Tavarian refused the request'

// -> { status, body: { error, code }, retryAfter }. A dead token or a missing scope is our server's problem, not
// the visitor's: 502, never 401 / 403 (the page reads those as "sign in").
export function failure(r) {
  const code = typeof r?.error === 'string' ? r.error : 'bad_response'
  const status =
    code === 'tavarian_off' ? 503
    : code === 'timeout' ? 504
    : [400, 404, 409, 422, 429, 503].includes(r?.status) ? r.status
    : 502
  return { status, body: { error: errorMessage(code), code }, retryAfter: r?.retryAfter ?? null }
}
