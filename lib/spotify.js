// Spotify "now playing" for the music card's Spotify tab. Server-only: import it only from app/api/spotify/route.js
// and the owner's app/api/private/settings/spotify/route.js (+ its picks/route.js).
// Public on purpose: track, artists, album, cover and Spotify links. Never anything about the account: the device
// (its name, its volume) is the owner's alone and never goes into the public answer.
// Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN (one-time consent: scripts/spotify-auth.mjs).
// Scopes: user-read-currently-playing (now playing), user-read-playback-state (up next), user-modify-playback-state
// (the owner's controls, Premium only). An older token without the last two still shows now playing.
import { settle } from './spotify-volume.js'

const env = process.env
const TIMEOUT = 5000
const TTL = 10_000 // every visitor polls; Spotify gets asked at most once per 10 s

export const spotifyOn = () => Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && env.SPOTIFY_REFRESH_TOKEN)

// access tokens live 1 h; refresh a minute early
let token = null
async function accessToken() {
  if (token && Date.now() < token.until) return token.value
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`token HTTP ${r.status}`)
  const j = await r.json()
  token = { value: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 }
  return token.value
}

async function api(path) {
  const r = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (r.status === 401) token = null // revoked or expired early: a fresh one next time
  if (r.status === 204) return null // nothing playing (or a private session)
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, retryAfter: seconds(r.headers.get('retry-after')) })
  return r.json()
}
// Retry-After (Spotify sends whole seconds) -> seconds, else null
const seconds = (v) => (/^\d{1,6}$/.test(v?.trim() ?? '') ? Number(v) : null)

// A refused command -> why, for the page's note: 'premium' (not Premium), 'device' (no active device), 'volume' (this
// device's volume can't be set from outside: some phones, some speakers), 'scope' (old token) or 'spotify'.
export function failReason(status, reason) {
  if (reason === 'PREMIUM_REQUIRED') return 'premium'
  if (reason === 'VOLUME_CONTROL_DISALLOW') return 'volume'
  if (status === 404 || reason === 'NO_ACTIVE_DEVICE') return 'device'
  if (status === 401 || status === 403) return 'scope'
  return 'spotify'
}
// a command to the active device (no body); throws an Error with .reason (failReason) when Spotify says no
async function send(method, path) {
  const r = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (r.status === 401) token = null
  if (!r.ok) {
    const reason = (await r.json().catch(() => null))?.error?.reason
    throw Object.assign(new Error(`HTTP ${r.status}`), { reason: failReason(r.status, reason) })
  }
}

// covers come 640 / 300 / 64 px: 300 is crisp for a 40 px pill on a 2x screen
const cover = (images = []) => images.find((i) => i.width && i.width <= 320)?.url ?? images.at(-1)?.url ?? null
export const shape = (t) => ({
  track: t.name,
  artists: (t.artists ?? []).map((a) => a.name),
  album: t.album?.name ?? null,
  art: cover(t.album?.images),
  url: t.external_urls?.spotify ?? null,
  durationMs: t.duration_ms ?? null,
})

// the next few tracks: title, artists, album, link, a ~300 px cover (the popup) and the 64 px one (the list);
// [] when the token can't read the queue
async function upNext() {
  try {
    const q = await api('/me/player/queue')
    return (q?.queue ?? [])
      .filter((t) => t?.type === 'track')
      .slice(0, 3)
      .map((t) => ({ ...shape(t), thumb: t.album?.images?.at(-1)?.url ?? null }))
  } catch {
    return []
  }
}

async function fetchNow() {
  const now = await api('/me/player/currently-playing')
  // a track (playing or paused); nothing, a podcast or an ad -> { playing: false } and the page shows its placeholder
  if (now?.item && now.currently_playing_type === 'track') return { playing: now.is_playing, ...shape(now.item), progressMs: now.progress_ms ?? 0, upNext: await upNext() }
  return { playing: false }
}

// Owner controls (Premium): play | pause | next | previous on the active Spotify device. Returns the fresh state once
// Spotify reports the change (paused / playing / another track; it lags a moment), with confirmed: false when it still
// doesn't after ~3 s. Throws an Error with .reason (failReason).
const CONTROLS = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] }
const CHECKS = [400, 500, 700, 1200] // ms between looks, ~2.8 s in all
export const done = (action, before, now) =>
  action === 'pause' ? !now.playing : action === 'play' ? now.playing === true : Boolean(now.url ?? now.track) && (now.url ?? now.track) !== (before?.url ?? before?.track)
export async function control(action) {
  const before = action === 'next' || action === 'previous' ? await fetchNow().catch(() => null) : null // to tell the new track
  await send(...CONTROLS[action])
  let now = null
  for (const ms of CHECKS) {
    await new Promise((ok) => setTimeout(ok, ms))
    cache = { at: 0, value: null, pending: null }
    now = await nowPlaying()
    if (done(action, before, now)) return { ...now, confirmed: true }
  }
  return { ...now, confirmed: false }
}
export const isControl = (a) => Object.hasOwn(CONTROLS, a)

// The owner's device, for the Spotify tab's volume slider: GET /me/player (needs user-read-playback-state, which the
// token has for Up next), its `device` -> { name, type, volume (0-100), supportsVolume } or null (nothing active).
// supportsVolume is false where Spotify won't let anyone else set the volume (an iPhone, some cast speakers) or doesn't
// say what it is. Owner-only (the private route), cached like now playing: the panel polls it while it's open.
export const shapeDevice = (d) =>
  d && typeof d === 'object'
    ? {
        name: typeof d.name === 'string' && d.name ? d.name : 'Spotify',
        type: typeof d.type === 'string' ? d.type : null,
        volume: volumeOf(d.volume_percent),
        supportsVolume: d.supports_volume === true && volumeOf(d.volume_percent) !== null,
      }
    : null
// A read that began before a volume change (or while Spotify still reports the old level) keeps the level that was
// set (lib/spotify-volume.js settle), so it can't cache the old one for 10 s.
let dev = { at: 0, value: undefined, pending: null }
let lastVol = null // the newest change Spotify accepted: { at (when it was sent), level, name (the device) }
export async function device() {
  if (dev.value !== undefined && Date.now() - dev.at < TTL) return dev.value
  if (!dev.pending) {
    const began = Date.now()
    dev.pending = api('/me/player').then(
      (p) => {
        dev = { at: Date.now(), value: settle(shapeDevice(p?.device), began, lastVol), pending: null }
        return dev.value
      },
      (e) => {
        dev.pending = null
        throw Object.assign(e, { reason: failReason(e.status) })
      },
    )
  }
  return dev.pending
}

// Volume (Premium): a whole percent, 0-100, or null for anything else (a string, a fraction, out of range).
export const volumeOf = (v) => (Number.isInteger(v) && v >= 0 && v <= 100 ? v : null)
// PUT /me/player/volume on the active device. Spotify takes a moment to report the new level, so the cached device
// takes it at once, freshly (the next poll would otherwise put the slider back for a few seconds); of two changes
// answered out of order, the one sent last stays. -> the device, or null.
export async function setVolume(percent) {
  const sent = Date.now()
  await send('PUT', `/me/player/volume?volume_percent=${percent}`)
  if (!lastVol || sent >= lastVol.at) lastVol = { at: sent, level: percent, name: dev.value?.name ?? null }
  if (dev.value) dev = { ...dev, at: Date.now(), value: { ...dev.value, volume: lastVol.level } } // (a read on its way still settles)
  return dev.value ?? null
}

// ---- the home station's next autoplay songs (owner only: app/api/private/settings/spotify/picks/route.js) ----
// The station (Tavarian's go-librespot) plays on the owner's own Spotify account, so while its autoplay runs this
// account's queue is Spotify's next picks. -> { nowUri, picks: [{ title, artists, album, cover, spotifyUri,
// durationSeconds }] }: the next 3 tracks (episodes and nameless items left out), nowUri = what the account plays
// now, so the page can tell the queue belongs to the station's song (the account may be playing somewhere else).
const SPOTIFY_IMG = /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i // Spotify's image hosts only
const URI = /^spotify:[a-z]+:[A-Za-z0-9]{6,64}$/
const text = (v) => (typeof v === 'string' && v ? v.slice(0, 300) : null)
export const PICKS = 3
export function shapePick(t) {
  if (t?.type !== 'track' || !text(t.name)) return null
  const art = cover(Array.isArray(t.album?.images) ? t.album.images.filter((i) => i && typeof i === 'object') : [])
  const ms = t.duration_ms
  return {
    title: text(t.name),
    artists: (Array.isArray(t.artists) ? t.artists : []).map((a) => text(a?.name)).filter(Boolean).slice(0, 20),
    album: text(t.album?.name),
    cover: typeof art === 'string' && SPOTIFY_IMG.test(art) ? art : null,
    spotifyUri: typeof t.uri === 'string' && /^spotify:track:[A-Za-z0-9]{6,64}$/.test(t.uri) ? t.uri : null,
    durationSeconds: Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null,
  }
}
export const NO_PICKS = Object.freeze({ nowUri: null, picks: [] })
export function shapePicks(q) {
  if (!q || typeof q !== 'object') return NO_PICKS
  const uri = q.currently_playing?.uri
  return {
    nowUri: typeof uri === 'string' && URI.test(uri) ? uri : null,
    picks: (Array.isArray(q.queue) ? q.queue : []).map(shapePick).filter(Boolean).slice(0, PICKS),
  }
}
// Cached 10 s (the page asks on a song change and every 30 s). Nothing playing (204), a refused token (401), Spotify
// down (5xx) or no answer -> NO_PICKS, kept for the same 10 s; too many requests (429) -> NO_PICKS until Retry-After
// has passed (30 s when it doesn't say, an hour at most).
let picks = { at: 0, value: null, pending: null, until: 0 }
export async function stationPicks() {
  const now = Date.now()
  if (now < picks.until) return NO_PICKS
  if (picks.value && now - picks.at < TTL) return picks.value
  // the catch is after shapePicks, so an odd answer that makes it throw is an empty list too (never a stuck promise)
  picks.pending ??= api('/me/player/queue')
    .then(shapePicks)
    .catch((e) => {
      if (e?.status === 429) picks.until = Date.now() + Math.min(e.retryAfter ?? 30, 3600) * 1000
      return NO_PICKS
    })
    .then((value) => {
      picks = { ...picks, at: Date.now(), value, pending: null }
      return value
    })
  return picks.pending
}
export const _resetPicksForTests = () => (picks = { at: 0, value: null, pending: null, until: 0 })

let cache = { at: 0, value: null, pending: null }
// { playing, track, artists, album, art, url, durationMs, progressMs, at } or { playing: false, at }
export async function nowPlaying() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value
  cache.pending ??= fetchNow()
    .then((v) => {
      cache = { at: Date.now(), value: { ...v, at: Date.now() }, pending: null }
      return cache.value
    })
    .catch((e) => {
      cache.pending = null
      if (cache.value) return cache.value // Spotify hiccup or rate limit: keep showing the last answer
      throw e
    })
  return cache.pending
}
