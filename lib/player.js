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

// ---- the card's short list under the controls ----
// a song is on (playing, paused, loading): the next two, or "the queue is empty" (no Recent here); nothing on: the
// next two when the queue has songs (play starts them), else the last played ones
export function cardList({ song = null, items = [], recent = [] } = {}) {
  if (items.length) return { kind: 'next', rows: items.slice(0, 2) }
  if (!song && recent.length) return { kind: 'last', rows: recent.slice(0, 2) }
  return { kind: 'empty', rows: [] }
}

// ---- the Player's one play / pause button (the card, the Hide bar, the lock screen, media keys) ----
// kind: listen (this device only) · stop (this device only) · resume / play (listen here AND resume / play the
// queue for everyone) · pause (pause for everyone AND stop listening here, like a Spotify Connect pause).
// The owner controls the station with it; a guest only listens or stops. Tuning in: the spinner, same button.
export function mainAction({ owner = false, listening = false, phase = 'off', status = 'idle', queued = 0 } = {}) {
  const live = status === 'playing' || status === 'loading'
  const kind = listening
    ? owner && live ? 'pause' : 'stop'
    : owner && status === 'paused' ? 'resume'
    : owner && !live && queued > 0 ? 'play'
    : 'listen'
  const label = {
    listen: 'Listen here',
    stop: 'Stop listening here',
    pause: 'Pause for everyone (and stop listening here)',
    resume: 'Resume for everyone and listen here',
    play: 'Play the queue for everyone and listen here',
  }[kind]
  const tuning = listening && phase === 'connecting'
  return {
    kind,
    label: tuning ? `Tuning in… ${kind === 'pause' ? 'Tap to pause for everyone' : 'Tap to stop'}` : label,
    icon: tuning ? 'fa-spinner fa-spin' : listening ? 'fa-pause' : 'fa-play ml-0.5',
    posts: kind === 'pause' || kind === 'resume' || kind === 'play', // it also changes the station (owner)
  }
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

// ---- the owner's Add sheet: a YouTube link is added as it is, anything else (2+ characters) is a search ----
export const isYouTubeUrl = (s) => typeof s === 'string' && /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)\S+$/i.test(s.trim())
const YT_ID = /^[A-Za-z0-9_-]{11}$/
const LIST_ID = /^[A-Za-z0-9_-]{2,64}$/
const isMix = (list) => /^RD/.test(list) // YouTube's endless auto playlists ("Mix"): Tavarian can't import them
export const videoUrl = (id) => `https://www.youtube.com/watch?v=${id}`
export const playlistUrl = (list) => `https://www.youtube.com/playlist?list=${list}`
// What a pasted text is -> { kind, url, … }:
//   video     { id, url (clean watch link), list (its playlist, if any and importable), mix (it came from a Mix) }
//   playlist  { list, url } — a YouTube playlist          mix  { url } — a YouTube Mix (not importable)
//   spotify   { what: playlist | album | track, url }    unsupported (another link)   text (a search)   empty
export function classifyLink(text) {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return { kind: 'empty' }
  const uri = /^spotify:(playlist|album|track):([A-Za-z0-9]{6,64})$/i.exec(t)
  if (uri) return { kind: 'spotify', what: uri[1].toLowerCase(), url: `https://open.spotify.com/${uri[1].toLowerCase()}/${uri[2]}` }
  if (/\s/.test(t) || !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$|\?)/i.test(t)) return { kind: 'text' }
  let u
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return { kind: 'text' }
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  const list = u.searchParams.get('list')
  const okList = list && LIST_ID.test(list) ? list : null
  const video = (id) => {
    if (!YT_ID.test(id ?? '')) return { kind: 'unsupported' }
    return { kind: 'video', id, url: videoUrl(id), list: okList && !isMix(okList) ? okList : null, mix: Boolean(okList && isMix(okList)) }
  }
  if (host === 'youtu.be') return video(parts[0])
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') return video(u.searchParams.get('v'))
    if (['shorts', 'live', 'embed', 'v'].includes(parts[0])) return video(parts[1])
    if (parts[0] === 'playlist' && okList) return isMix(okList) ? { kind: 'mix', url: playlistUrl(okList) } : { kind: 'playlist', list: okList, url: playlistUrl(okList) }
    return { kind: 'unsupported' }
  }
  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const i = /^intl-[a-z-]+$/i.test(parts[0] ?? '') ? 1 : 0 // open.spotify.com/intl-de/album/…
    const what = parts[i]?.toLowerCase()
    if (['playlist', 'album', 'track'].includes(what) && /^[A-Za-z0-9]{6,64}$/.test(parts[i + 1] ?? '')) return { kind: 'spotify', what, url: `https://open.spotify.com/${what}/${parts[i + 1]}` }
  }
  return { kind: 'unsupported' }
}

// ---- where an added song goes ----
export const PLACEMENTS = ['now', 'next', 'end']
const PLACE = { now: ['Play now', 'fa-play'], next: ['Play next', 'fa-angles-up'], end: ['Add to end', 'fa-plus'] }
export const placementLabel = (p) => (PLACE[p] ?? PLACE.end)[0]
export const placementIcon = (p) => (PLACE[p] ?? PLACE.end)[1]
// what the owner reads once it's done
export function placedText(placement, title) {
  const t = plain(title) || 'the song'
  return placement === 'now' ? `Playing ${t}` : placement === 'next' ? `Up next: ${t}` : `Added: ${t}`
}

// ---- Tavarian's reasons (an import's skipped songs, a song that couldn't play), in plain words ----
const REASONS = {
  duplicate: 'already in the queue',
  too_long: 'too long',
  not_embeddable: 'not allowed outside YouTube',
  live_stream: "a live stream (can't be played)",
  unknown_duration: 'length unknown',
  no_match: 'no YouTube match',
  not_found: 'gone or private',
  unavailable: 'unavailable',
  private: 'private',
  queue_full: 'the queue is full',
  start_timeout: "didn't start",
  invalid_url: 'not a video',
  music_unavailable: "YouTube didn't answer",
  // Spotify mode (the station plays from Spotify): a song it can't play there is skipped
  no_spotify_match: 'no sure match on Spotify',
  spotify_search_off: "Spotify search isn't set up",
  spotify_search_unavailable: "Spotify search didn't answer",
  spotify_unavailable: "Spotify isn't ready",
  spotify_auth: 'Spotify logged the station out',
  spotify_daemon_down: "the Spotify player isn't running",
  spotify_failed: "Spotify couldn't play it",
}
export const reasonText = (code) => REASONS[code] ?? (typeof code === 'string' && code ? code.replace(/_/g, ' ') : 'unknown reason')
// the song-error event, with the song's title when we know it
export function songErrorText(reason, title) {
  const t = plain(title) || 'A song'
  return reason === 'start_timeout' ? `${t} didn't start, skipped` : `${t} couldn't play${reason ? ` (${reasonText(reason)})` : ''}, skipped`
}

// ---- an import's answer, summed up: "Added 12 · skipped 3 (2 already in the queue, 1 too long) · first 100 only" ----
export function importSummary(r) {
  const added = Array.isArray(r?.added) ? r.added.length : 0
  const skipped = Array.isArray(r?.skipped) ? r.skipped : []
  const counts = new Map()
  for (const s of skipped) counts.set(s?.reason ?? null, (counts.get(s?.reason ?? null) ?? 0) + 1)
  const groups = [...counts].map(([reason, n]) => ({ reason, n, text: reasonText(reason) })).sort((a, b) => b.n - a.n)
  const t = r?.truncated
  const cut = !t ? null
    : t.reason === 'queue_room' ? `only ${t.limit ?? 'some'} fit in the queue${t.dropped ? ` (${t.dropped} left out)` : ''}`
    : `first ${t.limit ?? 100} only${t.dropped ? ` (${t.dropped} more not imported)` : ''}`
  const head = added ? `Added ${added} song${added === 1 ? '' : 's'}` : 'Nothing added'
  const skip = skipped.length ? `skipped ${skipped.length} (${groups.map((g) => `${g.n} ${g.text}`).join(', ')})` : null
  return { added, skipped: skipped.length, groups, cut, found: typeof r?.found === 'number' ? r.found : null, text: [head, skip, cut].filter(Boolean).join(' · ') }
}

// an import's source ("youtube-playlist", "spotify-album", …) -> "YouTube playlist", "Spotify album"
const BRANDS = { youtube: 'YouTube', spotify: 'Spotify' }
export function sourceLabel(src) {
  const t = typeof src === 'string' ? src : (src?.kind ?? src?.type)
  if (typeof t !== 'string' || !t) return null
  const [brand, ...rest] = t.toLowerCase().split(/[-_ ]+/)
  return [BRANDS[brand] ?? brand[0].toUpperCase() + brand.slice(1), ...rest].join(' ')
}

// ---- after ⏭ / Play now: "Skipped A · loading B…", then "Playing B". t = { from: the song that played (or null) } ----
export function transitionLine(t, state) {
  if (!t || !state) return null
  const a = plain(t.from?.title)
  const s = state.song
  if (s && t.from && s.id === t.from.id) return { text: a ? `Skipping ${a}…` : 'Skipping…', done: false }
  if (!s || state.status === 'idle') return { text: a ? `Skipped ${a} · the queue is empty` : 'The queue is empty', done: true }
  const b = plain(s.title) || 'the next song'
  if (state.status === 'loading') return { text: a ? `Skipped ${a} · loading ${b}…` : `Loading ${b}…`, done: false }
  return { text: state.status === 'paused' ? `${b} · paused` : `Playing ${b}`, done: true }
}

// ---- the queue's order: drag and drop, and undo ----
// the item at `from` moved to index `to`
export function moveTo(list, from, to) {
  if (from < 0 || from >= list.length) return [...list]
  const out = [...list]
  const [x] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x)
  return out
}
// the gap (0 = above the first row … n = below the last) a pointer at y is in, from each row's middle (top to bottom)
export function gapAt(mids, y) {
  let g = 0
  while (g < mids.length && y > mids[g]) g++
  return g
}
// row `from` dropped into `gap` -> its new index (the gaps right above and below it mean "stay")
export const gapIndex = (from, gap) => (gap > from ? gap - 1 : gap)
// one queue id moved up (d = -1) or down (1): the new order, or null when it can't move (the drag handle's arrow keys)
export function moveId(ids, id, d) {
  const i = ids.indexOf(id)
  const j = i + d
  if (i < 0 || j < 0 || j >= ids.length) return null
  return moveTo(ids, i, j)
}
export const sameOrder = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
// `id` (a song added back: it lands at the end) put at `index` among `ids`
export function insertAt(ids, id, index) {
  const out = ids.filter((x) => x !== id)
  out.splice(Math.max(0, Math.min(out.length, index)), 0, id)
  return out
}
// the order `before`, for the songs still queued `now`; songs added since keep their place after them
export function restoreOrder(before, now) {
  const has = new Set(now)
  const kept = before.filter((id) => has.has(id))
  const seen = new Set(kept)
  return [...kept, ...now.filter((id) => !seen.has(id))]
}

// the order `before` with the songs that came back under a new id (old id -> new id) in their old places
export const remapOrder = (before, map) => before.map((id) => map.get(id) ?? id)

// ---- the queue's Select mode: a Set of song ids; what counts is what's still queued, in the queue's order ----
export function toggleIn(sel, id) {
  const out = new Set(sel)
  out.has(id) ? out.delete(id) : out.add(id)
  return out
}
export const pickedIds = (sel, ids) => (sel ? ids.filter((id) => sel.has(id)) : [])
export const allPicked = (sel, ids) => Boolean(sel) && ids.length > 0 && ids.every((id) => sel.has(id))
// "3 of 12 selected"
export const pickedText = (n, total) => (n ? `${n} of ${total} selected` : 'None selected')

// ---- long titles: two lines, the whole one on hover (title) or behind a small toggle ----
export const fullTitle = (s, fallback = '') => plain(s?.title ?? s?.name) || fallback
// the text is cut (line-clamp): its full height is taller than the box (a pixel of rounding is not a cut)
export const overflows = (scrollHeight, clientHeight) => scrollHeight - clientHeight > 1

// ---- Undo: the steps that put the station back. Entries (what the owner did):
//   now     { from: song that played or null, at: its position, paused, to: the new song, toIndex: its place in the queue or null }
//   remove  { song, index }        order { ids: the order before }        added { ids, placement, from, at, paused }
//   bulk    { songs: the removed songs, ids: the order before }
// Steps: restore { song, at, paused } (add it with placement now, seek back) · stop · requeue { song, index } (add it
// again at the end, move it back) · order { ids } · remove { ids } · readd { songs, ids } (each added again at the
// end, paced, then the old order). null: nothing can be undone (a live song can't come back).
export const restorable = (song) => Boolean(song?.youtubeId) && song.durationSeconds > 0
const back = (e) => (e.from ? (restorable(e.from) ? { do: 'restore', song: e.from, at: e.at > 3 ? Math.floor(e.at) : 0, paused: Boolean(e.paused) } : null) : { do: 'stop' })
export function undoPlan(e) {
  switch (e?.kind) {
    case 'now': {
      const first = back(e)
      if (!first) return null
      return e.to && e.toIndex != null && restorable(e.to) ? [first, { do: 'requeue', song: e.to, index: e.toIndex }] : [first]
    }
    case 'remove':
      return e.song?.youtubeId ? [{ do: 'requeue', song: e.song, index: e.index ?? 0 }] : null
    case 'order':
      return Array.isArray(e.ids) ? [{ do: 'order', ids: e.ids }] : null
    case 'bulk': {
      const songs = (e.songs ?? []).filter((s) => s?.youtubeId)
      return songs.length ? [{ do: 'readd', songs, ids: Array.isArray(e.ids) ? e.ids : [] }] : null
    }
    case 'added': {
      const ids = e.ids ?? []
      if (!ids.length) return null
      if (e.placement !== 'now') return [{ do: 'remove', ids }]
      const first = back(e)
      if (!first) return null
      return ids.length > 1 ? [first, { do: 'remove', ids: ids.slice(1) }] : [first]
    }
    default:
      return null
  }
}

// more than this many songs to add back: Undo says it would take a while (Tavarian allows 20 writes a minute, so
// they go in paced), and still offers it
export const SLOW_UNDO = 15
export const slowUndo = (plan) => Boolean(plan?.some((st) => st.do === 'readd' && st.songs.length > SLOW_UNDO))
// Remove selected's line: "Removed N songs", and only when its Undo would be slow, that it would, with the seconds
// it's still offered (countdown); a quick Undo looks like every other one
export function bulkRemovedLine(n, plan) {
  const slow = slowUndo(plan)
  return { text: `Removed ${n} song${n === 1 ? '' : 's'}${slow ? ' · Undo would take a while' : ''}`, countdown: slow }
}

// ---- which music the Hide bar and the lock screen show ----
// Whatever makes sound here wins (the radio, or this tab listening to the Player), then Spotify playing (or paused
// for under a minute), then the home station playing on Tavarian; else the picked tab (Spotify / Player only when
// they have a song), else the radio. The owner's order puts the home station before Spotify: Tavarian > Spotify >
// radio. tv = { listening, song, playing, owner } (the Player, summed up).
export const SP_LOCK_REST = 60_000 // the lock screen lets a paused Spotify go after this (same track, nothing new)
export const spOn = (sp) => Boolean(sp?.enabled && sp.track)
export function musicSource(tab, tune, sp, tv = null, now = Date.now()) {
  if (tune.playing || tune.loading) return 'radio'
  if (tv?.listening) return 'tavarian'
  if (tv?.owner && tv.song && tv.playing) return 'tavarian'
  if (spOn(sp) && sp.playing) return 'spotify'
  if (spOn(sp) && sp.pausedAt && now - sp.pausedAt < SP_LOCK_REST) return 'spotify' // just paused: stays a minute
  if (tv?.song && tv.playing) return 'tavarian'
  if (tab === 'player' && tv?.song) return 'tavarian'
  return tab === 'spotify' && spOn(sp) ? 'spotify' : 'radio'
}

// the owner's music card when the page opens: the Player tab while the home station plays, else Spotify while it
// plays, else null (the tab picked last stays)
export const autoTab = ({ tvPlaying = false, spPlaying = false } = {}) => (tvPlaying ? 'player' : spPlaying ? 'spotify' : null)
