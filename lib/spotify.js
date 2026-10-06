// Spotify "now playing" for the music card's Spotify tab. Server-only: import it only from app/api/spotify/route.js.
// Public on purpose: track, artists, album, cover and Spotify links. Never anything about the account.
// Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN (one-time consent: scripts/spotify-auth.mjs).
// Scopes: user-read-currently-playing (now playing), user-read-playback-state (up next), user-modify-playback-state
// (the owner's controls, Premium only). An older token without the last two still shows now playing.
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
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
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
// doesn't after ~3 s. Throws an Error whose .reason is 'premium' (not Premium), 'device' (no active device), 'scope'
// (old token) or 'spotify'.
const CONTROLS = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] }
const CHECKS = [400, 500, 700, 1200] // ms between looks, ~2.8 s in all
export const done = (action, before, now) =>
  action === 'pause' ? !now.playing : action === 'play' ? now.playing === true : Boolean(now.url ?? now.track) && (now.url ?? now.track) !== (before?.url ?? before?.track)
export async function control(action) {
  const before = action === 'next' || action === 'previous' ? await fetchNow().catch(() => null) : null // to tell the new track
  const [method, path] = CONTROLS[action]
  const r = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) {
    const reason = (await r.json().catch(() => null))?.error?.reason
    throw Object.assign(new Error(`HTTP ${r.status}`), {
      reason: reason === 'PREMIUM_REQUIRED' ? 'premium' : r.status === 404 || reason === 'NO_ACTIVE_DEVICE' ? 'device' : r.status === 401 || r.status === 403 ? 'scope' : 'spotify',
    })
  }
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
