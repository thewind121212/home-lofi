// The Player tab's pure helpers (app/player.js, app/page.js): the station's clock, listen tickets and the audio
// address, what to call each state, the owner's confirmations, and which music the Hide bar / lock screen show.
// No browser APIs here (crypto is passed in), so node:test can check them.

// ---- this tab's listener id: 8-64 of A-Z a-z 0-9 _ - (the server checks the same) ----
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/
export const validClientId = (id) => typeof id === 'string' && CLIENT_ID.test(id)
export function newClientId(c = globalThis.crypto) {
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// the audio, straight from Tavarian: `${streamUrl}?streamId=…&clientId=…&ticket=…` (null while something is missing)
export function audioUrl(streamUrl, streamId, clientId, ticket) {
  if (!streamUrl || !streamId || !clientId || !ticket) return null
  return `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}${new URLSearchParams({ streamId, clientId, ticket })}`
}

// ---- listen tickets: 10 minutes; a new one a minute before the end, and only while listening ----
export const TICKET_LIFE = 600_000 // when the answer has no readable expiresAt
export const TICKET_LEAD = 60_000
const MIN_RENEW = 30_000 // never sooner than this (a skewed clock must not loop on the rate-limited route)
// expiresAt: an ISO date, or epoch seconds / ms -> epoch ms, else null
export function expiresMs(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}
// t = { ticket, expiresAt, at (when we got it) }; now = Tavarian's clock as best we know it
const endOf = (t) => expiresMs(t.expiresAt) ?? (t.at ?? 0) + TICKET_LIFE
export const ticketOk = (t, now = Date.now()) => Boolean(t?.ticket) && endOf(t) - now > TICKET_LEAD
export const renewIn = (t, now = Date.now()) => Math.max(MIN_RENEW, endOf(t) - TICKET_LEAD - now)

// ---- the station's clock ----
// how far Tavarian's clock is ahead of ours, from a state's serverNowMs and when it arrived here
export const clockOffset = (serverNowMs, receivedAt = Date.now()) => (typeof serverNowMs === 'number' ? serverNowMs - receivedAt : 0)
// where the song is now, in seconds: playing = since startedAtMs (the song's zero on Tavarian's clock), else
// positionSeconds; kept within the song
export function positionAt(s, offset = 0, now = Date.now()) {
  if (!s?.song) return 0
  const end = s.song.durationSeconds > 0 ? s.song.durationSeconds : Infinity
  let p = typeof s.positionSeconds === 'number' ? s.positionSeconds : 0
  if (s.status === 'playing') {
    if (typeof s.startedAtMs === 'number') p = (now + offset - s.startedAtMs) / 1000
    else if (typeof s.serverNowMs === 'number') p += (now + offset - s.serverNowMs) / 1000
  }
  return Math.max(0, Math.min(end, p))
}
// 75 -> "1:15", 3725 -> "1:02:05"
export function mmss(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
// titles can come HTML-escaped from YouTube ("Rain &amp; Piano"): the few entities that show up, as text
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
export const plain = (t) =>
  typeof t === 'string' ? t.replace(/&(#\d{1,6}|#x[0-9a-f]{1,5}|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m))) : ''
export const thumbOf = (song) => (song?.youtubeId ? `https://i.ytimg.com/vi/${song.youtubeId}/mqdefault.jpg` : (song?.thumbnail ?? null))

// ---- what the Player tab says. key: off | revoked | connecting | unreachable | playing | paused | loading | stopped | empty ----
export function statusInfo({ off, revoked, reachable = true, state, queued = 0, owner = false }) {
  if (off) return { key: 'off', label: 'Player not set up' }
  if (revoked) return { key: 'revoked', label: owner ? 'Disconnected — new link needed' : 'Player unavailable' }
  if (!reachable) return { key: 'unreachable', label: 'Tavarian unreachable' }
  if (!state) return { key: 'connecting', label: 'Connecting…' }
  if (state.status === 'playing') return { key: 'playing', label: 'Playing' }
  if (state.status === 'paused') return { key: 'paused', label: 'Paused on Tavarian' }
  if (state.status === 'loading') return { key: 'loading', label: state.positionSeconds > 1 ? 'Loading…' : 'Loading next song' }
  return queued > 0 ? { key: 'stopped', label: 'Stopped' } : { key: 'empty', label: 'Queue is empty' }
}

// ---- the owner's buttons spin until a state shows the change: has `next` (after `prev`) done `action`? ----
export function confirms(action, prev, next, args = {}) {
  if (!next) return false
  switch (action) {
    case 'pause':
      return next.status === 'paused'
    case 'play':
    case 'resume':
      return next.status === 'playing'
    case 'skip':
      return next.status === 'idle' || (next.song?.id != null && next.song.id !== prev?.song?.id)
    case 'stop':
      return next.status === 'idle'
    case 'seek':
      return next.status !== 'loading' && Math.abs((next.positionSeconds ?? 0) - (args.seconds ?? 0)) < 5
    default:
      return true
  }
}

// ---- the owner's Add box: a YouTube link is added as it is, anything else (2+ characters) is a search ----
export const isYouTubeUrl = (s) => typeof s === 'string' && /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)\S+$/i.test(s.trim())
// one queue id moved up (d = -1) or down (1): the new order, or null when it can't move
export function moveId(ids, id, d) {
  const i = ids.indexOf(id)
  const j = i + d
  if (i < 0 || j < 0 || j >= ids.length) return null
  const out = [...ids]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

// ---- which music the Hide bar and the lock screen show ----
// Whatever makes sound here wins (the radio, or this tab listening to the Player), then Spotify playing (or paused
// for under a minute), then the home station playing on Tavarian; else the picked tab (Spotify / Player only when
// they have a song), else the radio. tv = { listening, song, playing } (the Player, summed up).
export const SP_LOCK_REST = 60_000 // the lock screen lets a paused Spotify go after this (same track, nothing new)
export const spOn = (sp) => Boolean(sp?.enabled && sp.track)
export function musicSource(tab, tune, sp, tv = null, now = Date.now()) {
  if (tune.playing || tune.loading) return 'radio'
  if (tv?.listening) return 'tavarian'
  if (spOn(sp) && sp.playing) return 'spotify'
  if (spOn(sp) && sp.pausedAt && now - sp.pausedAt < SP_LOCK_REST) return 'spotify' // just paused: stays a minute
  if (tv?.song && tv.playing) return 'tavarian'
  if (tab === 'player' && tv?.song) return 'tavarian'
  return tab === 'spotify' && spOn(sp) ? 'spotify' : 'radio'
}
