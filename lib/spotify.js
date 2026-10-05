// Spotify "now playing" for the music card's Spotify tab. Server-only: import it only from app/api/spotify/route.js.
// Public on purpose: track, artists, album, cover and Spotify links. Never anything about the account.
// Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN (one-time consent: scripts/spotify-auth.mjs).
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

async function fetchNow() {
  const now = await api('/me/player/currently-playing')
  // a track (playing or paused); nothing, a podcast or an ad -> { playing: false } and the page shows its placeholder
  if (now?.item && now.currently_playing_type === 'track') return { playing: now.is_playing, ...shape(now.item), progressMs: now.progress_ms ?? 0 }
  return { playing: false }
}

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
