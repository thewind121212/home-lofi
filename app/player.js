'use client'

// The Player tab: the home page's own station inside Tavarian (lib/tavarian.js has the server side).
// - useTavarian(): the live state and queue from /api/tavarian/events (EventSource), polling /api/tavarian/state
//   every 5 s when the stream can't stay open (and trying the stream again every 30 s).
// - usePlayerAudio(): one <audio> element. Listen gets a 10-minute ticket (a new one a minute before it ends, only
//   while listening) and plays Tavarian's audio straight from Tavarian; a new streamId (song change, seek, resume)
//   swaps the source; paused / idle / loading on Tavarian lets the element go, and it comes back by itself when the
//   station plays again (if this tab still listens). Volume and mute follow the radio's (Music passes them in).
// - PlayerPanel (the tab), PlayerSheet (a <dialog> like Settings: queue, recent, and for the owner: Add — Search or
//   link · Import playlist —, playlists, the Tavarian link) and PlayerMini (ambient bar and lock screen). Guests listen and watch; the owner's
//   buttons post to /api/private/settings/tavarian, lock while it's in flight and spin until a state shows the change.
// - useOwnerOps(): the owner's queue actions (Play now / next, remove, remove selected, clear, drag reorder, add,
//   import) with Undo for 5 s
//   and the "Skipped A · loading B…" line; useDragReorder(): the queue's drag handles (mouse, or hold on a phone).
// - useAutoplayPicks(): while Spotify autoplay runs, the owner's card and queue also show Spotify's next picks.
// - The lists (the sheet's Now + Up next, Recent, the card's Up next) glide when they change: useFlip() (app/flip.js).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  allPicked, audioUrl, autoplayPicks, autoplayText, mainAction, classifyLink, clockOffset, confirms, fullTitle, gapAt, gapIndex, importSummary, insertAt, mmss, moveId, moveTo, newClientId, overflows, pickedIds, pickedText,
  placedText, placementIcon, placementLabel, plain, positionAt, reasonText, remapOrder, renewIn, restoreOrder, sameOrder, bulkRemovedLine, songErrorText, sourceLabel, statusInfo, cardList,
  songLink, thumbOf, ticketOk, toggleIn, transitionLine, undoPlan, videoUrl,
} from '../lib/player'
import { claimMediaSession, mediaSessionOwner, silentWav, useMounted } from './radio'
import { closeDialog, motionOff } from './settings'
import { settleFlip, useFlip } from './flip'
import { coverCache } from '../lib/spotify-cover'
import { lazyWatcher, scrollRoot } from '../lib/lazy'
import { flipSig } from '../lib/flip'

const POLL_MS = 5000 // fallback polling of /api/tavarian/state
const SSE_RETRY_MS = 30_000 // while polling, try the event stream again this often
const SSE_ERRORS = 3 // this many errors in a row (no event in between): the stream can't stay open here
const FADE_IN = 600
const CONFIRM_MS = 15_000 // an owner's button gives up spinning after this
const TOKEN_DEAD = ['invalid_token', 'token_revoked', 'token_expired', 'owner_gone']

// ---- the owner's route: { action, ...args } -> { ok, data } or { ok: false, error: '<plain message>', code } ----
export async function tavarianPost(body, { signal } = {}) {
  let r
  try {
    r = await fetch('/api/private/settings/tavarian', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual', // a lapsed login redirects to the sign-in page: that's an error here
      cache: 'no-store',
      signal, // (a request nobody waits for any more is cancelled)
    })
  } catch {
    return { ok: false, status: 0, error: signal?.aborted ? 'cancelled' : "Couldn't reach the home server" }
  }
  const d = await r.json().catch(() => ({}))
  if (r.ok) return { ok: true, data: d }
  const wait = Number(r.headers.get('retry-after')) || 0
  const error =
    r.status === 429 ? `Too fast: try again in ${wait || 30} s`
    : r.type === 'opaqueredirect' || r.status === 401 || r.status === 403 || (r.status === 404 && !d.code) ? 'Sign in again to control the player'
    : (d.error ?? 'Tavarian refused the request')
  return { ok: false, status: r.status, code: d.code ?? null, error, retryAfter: wait || null }
}

// ---- Spotify's next autoplay picks (owner): /api/private/settings/spotify/picks -> { nowUri, picks }, or null ----
const PICKS_MS = 30_000
const PICKS_RETRY_MS = 11_000 // just after a song change Spotify (or the server's 10 s cache) may still say the last one
const PICKS_RETRIES = 2
async function fetchPicks(signal) {
  try {
    const r = await fetch('/api/private/settings/spotify/picks', { redirect: 'manual', cache: 'no-store', signal })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}
// on: the owner sees the Player and the song is an autoplay pick. Asks when the song changes and every 30 s while
// the page shows (sooner, a couple of times, while the answer is still about another song) -> rows for the lists
// (lib/player.js autoplayPicks: [] unless the account's queue is the station's song's)
function useAutoplayPicks(on, song) {
  const [answer, setAnswer] = useState(null)
  const uri = on ? (song?.spotifyUri ?? null) : null // (a song without one can't be matched: nothing to ask)
  const id = song?.id ?? null
  useEffect(() => {
    if (!uri) return
    let alive = true
    let timer = 0
    let retries = PICKS_RETRIES
    let asking = false // (the page showing again mid-question doesn't start a second round of asks)
    const ctl = new AbortController()
    const ask = async () => {
      if (asking) return
      clearTimeout(timer)
      let wait = PICKS_MS
      if (document.visibilityState === 'visible') {
        asking = true
        const a = await fetchPicks(ctl.signal)
        asking = false
        if (!alive) return
        setAnswer(a)
        if (a?.nowUri !== uri && retries-- > 0) wait = PICKS_RETRY_MS
      }
      timer = setTimeout(ask, wait)
    }
    const onVis = () => document.visibilityState === 'visible' && ask()
    ask()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      clearTimeout(timer)
      ctl.abort()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [uri, id])
  return uri ? autoplayPicks(answer, song) : []
}

// ---- the live station ----
// keep: stay connected while the page is hidden (this tab is listening); otherwise a hidden page lets go
export function useTavarian({ keep = false } = {}) {
  const [d, setD] = useState({ state: null, queue: null, offset: 0, off: false, revoked: false, reachable: true, link: 'connecting', hub: null })
  const [songError, setSongError] = useState(null)
  const sync = useRef(() => {})
  const refresh = useRef(() => {})
  const keepRef = useRef(keep)
  keepRef.current = keep

  useEffect(() => {
    let es = null
    let poll = 0
    let retry = 0
    let errors = 0
    let stopped = false // off or revoked: nothing to reconnect to
    const put = (f) => !stopped && setD((p) => ({ ...p, ...f(p) }))
    const takeState = (state) => put(() => ({ state, offset: clockOffset(state?.serverNowMs) }))
    const end = (patch) => {
      close()
      stopped = true
      setD((p) => ({ ...p, ...patch }))
    }
    const get = async () => {
      try {
        const r = await fetch('/api/tavarian/state', { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (r.status === 503 && j.error === 'tavarian_off') return end({ off: true, link: 'off' })
        if (TOKEN_DEAD.includes(j.code)) return end({ revoked: true, link: 'off' })
        if (!r.ok) return put(() => ({ reachable: false }))
        put((p) => ({ state: j.state ?? p.state, queue: j.queue ?? p.queue, offset: clockOffset(j.state?.serverNowMs), reachable: !j.stale }))
      } catch {
        put(() => ({ reachable: false }))
      }
    }
    const stopPolling = () => (clearInterval(poll), (poll = 0))
    function close() {
      clearTimeout(retry)
      stopPolling()
      es?.close()
      es = null
    }
    function fallback() {
      es?.close()
      es = null
      if (!poll) (poll = setInterval(get, POLL_MS)), get()
      put(() => ({ link: 'polling' }))
      clearTimeout(retry)
      retry = setTimeout(open, SSE_RETRY_MS)
    }
    function open() {
      if (es || stopped) return
      clearTimeout(retry)
      errors = 0
      const src = (es = new EventSource('/api/tavarian/events'))
      const on = (name, f) =>
        src.addEventListener(name, (e) => {
          if (es !== src) return
          let v = null
          try {
            v = JSON.parse(e.data)
          } catch {
            return
          }
          errors = 0
          if (poll) stopPolling()
          f(v ?? {})
        })
      on('status', (v) => {
        if (v.status === 'idle' && v.reason === 'tavarian_off') return end({ off: true, link: 'off' })
        put(() => ({ hub: v, link: 'live', ...(v.status === 'live' && { reachable: true }), ...(v.status === 'retrying' && { reachable: false }) }))
        // the server's own stream to Tavarian is down (e.g. too_many_streams): ask /api/tavarian/state meanwhile (it
        // uses Tavarian's API, not a stream), so the page and the owner's queue don't go stale; the next event stops it
        if (v.status === 'retrying' && !poll) (poll = setInterval(get, POLL_MS)), get()
      })
      on('state', (v) => put(() => ({ state: v, offset: clockOffset(v.serverNowMs), reachable: true, link: 'live' })))
      on('queue', (v) => put(() => ({ queue: v })))
      // the next song's audio is ready (a moment before the state says playing): its streamId and clock
      on('audio-ready', (v) =>
        put((p) =>
          p.state
            ? {
                state: { ...p.state, streamId: v.streamId ?? p.state.streamId, startedAtMs: v.startedAtMs ?? p.state.startedAtMs, serverNowMs: v.serverNowMs ?? p.state.serverNowMs, status: p.state.status === 'loading' ? 'playing' : p.state.status },
                offset: clockOffset(v.serverNowMs),
              }
            : {},
        ),
      )
      on('song-error', (v) => setSongError({ ...v, at: Date.now() }))
      on('revoked', () => end({ revoked: true, link: 'off' }))
      src.onerror = () => {
        if (es !== src) return
        errors++
        // CLOSED: a refusal (429 too many streams, 503 not set up), EventSource won't retry; else it does, a few times
        if (src.readyState === EventSource.CLOSED || errors >= SSE_ERRORS) fallback()
      }
    }
    // connected while the page shows (or this tab listens); a hidden page lets go of everything
    sync.current = () => {
      if (stopped) return
      if (document.visibilityState === 'visible' || keepRef.current) {
        if (!es && !poll) open()
      } else close()
    }
    refresh.current = () => !stopped && get()
    get() // the first paint (the event stream sends the same a moment later)
    sync.current()
    const onVis = () => {
      if (document.visibilityState === 'visible' && !stopped && !es) get()
      sync.current()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      close()
      stopped = true
    }
  }, [])
  useEffect(() => sync.current(), [keep])

  return {
    ...d,
    songError, // { songId, reason, at }: show it for a few seconds
    // a fresh state / queue from the owner's own command, shown at once
    takeState: (state) => state && setD((p) => ({ ...p, state, offset: clockOffset(state.serverNowMs) })),
    setQueue: (queue) => queue && setD((p) => ({ ...p, queue })),
    setRevoked: () => setD((p) => ({ ...p, revoked: true })),
    refresh: () => refresh.current(), // state + queue again (after an owner's add / import: their answers have no queue)
  }
}

// ---- the sound ----
// onListen(): called inside the Listen tap (the page pauses the radio there)
export function usePlayerAudio(tv, { owner, onListen }) {
  const [listening, setListening] = useState(false)
  const [phase, setPhase] = useState('off') // off | connecting | playing | waiting (listening, the station isn't playing)
  const [note, setNote] = useState(null)
  const [fixedVolume, setFixedVolume] = useState(false)
  const audio = useRef(null)
  const m = useRef({ want: false, id: null, ticket: null, pending: null, stream: null, haltAt: 0, tries: 0, renew: 0, retry: 0, ended: 0, ramp: 0, level: 50, gain: 1, fixed: false }).current
  const live = useRef({})
  live.current = { tv, owner, onListen }
  const fn = useRef({})
  // the Media Session handlers while this tab listens (claimed from the radio in listen())
  // (play / pause follow the one button's rule: for the owner they also resume / pause the station)
  const media = useRef({ play: () => m.want || fn.current.press(), pause: () => m.want && fn.current.press(), stop: () => fn.current.stop() }).current

  const apply = () => {
    if (audio.current) audio.current.volume = m.fixed ? 1 : Math.max(0, Math.min(1, (m.level / 100) * m.gain))
  }
  function fadeIn() {
    clearInterval(m.ramp)
    if (m.fixed || motionOff()) return (m.gain = 1), apply()
    const t0 = performance.now()
    m.ramp = setInterval(() => {
      m.gain = Math.min(1, (performance.now() - t0) / FADE_IN)
      apply()
      if (m.gain >= 1) clearInterval(m.ramp)
    }, 40)
  }
  function halt() {
    clearInterval(m.ramp)
    clearTimeout(m.ended)
    m.stream = null
    const a = audio.current
    if (!a?.getAttribute('src')) return
    m.haltAt = Date.now() // its 'pause' event, a moment later, is ours
    a.pause()
    a.removeAttribute('src') // a live stream keeps downloading while paused: let it go
    a.load()
  }
  const now = () => Date.now() + (live.current.tv.offset || 0) // Tavarian's clock, about

  function scheduleRenew() {
    clearTimeout(m.renew)
    if (!m.ticket) return
    // only while listening, and only ahead of audio that plays (else the next play asks for one itself)
    m.renew = setTimeout(() => m.want && live.current.tv.state?.status === 'playing' && getTicket(true), renewIn(m.ticket, now()))
  }
  // POST /api/tavarian/ticket (one at a time). A refusal: a plain note; 429 tries again when told
  function getTicket(quiet = false) {
    m.pending ??= fetch('/api/tavarian/ticket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: m.id }), cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.ticket && j.streamUrl) {
          m.ticket = { ticket: j.ticket, expiresAt: j.expiresAt, streamUrl: j.streamUrl, at: now() }
          scheduleRenew()
          return m.ticket
        }
        if (!m.want) return null
        if (r.status === 429) {
          const wait = Number(r.headers.get('retry-after')) || 60
          if (!quiet) setNote(`Too many listeners from here: trying again in ${wait} s`)
          clearTimeout(m.retry)
          m.retry = setTimeout(() => fn.current.sync(), wait * 1000)
        } else if (!quiet) {
          setNote(r.status === 503 ? 'The player is not set up' : (j.error ?? "Couldn't get a listen ticket"))
          fn.current.stop()
        }
        return null
      })
      .catch(() => {
        if (m.want && !quiet) setNote("Couldn't reach the home server"), fn.current.retry()
        return null
      })
      .finally(() => (m.pending = null))
    return m.pending
  }

  // put the element on what the station plays now (or let it go while it doesn't)
  async function sync() {
    if (!m.want) return
    const s = live.current.tv.state
    if (!(s?.status === 'playing' && s.streamId)) {
      if (m.stream) halt() // (not the silent unlock of a tap that's still playing)
      setPhase(live.current.tv.revoked || live.current.tv.off ? 'off' : s?.status === 'loading' ? 'connecting' : 'waiting')
      return
    }
    const a = audio.current
    if (m.stream === s.streamId && a.getAttribute('src')) return // already on it
    setPhase('connecting')
    // no await when the ticket is still good: play() stays inside the tap that called listen() (iOS)
    const t = ticketOk(m.ticket, now()) ? m.ticket : await getTicket()
    const s2 = live.current.tv.state
    if (!t || !m.want || !(s2?.status === 'playing' && s2.streamId) || (m.stream === s2.streamId && a.getAttribute('src'))) return
    clearTimeout(m.ended)
    clearInterval(m.ramp)
    m.stream = s2.streamId
    m.gain = 0
    apply()
    m.haltAt = Date.now() // a 'pause' from swapping the source is ours too
    a.src = audioUrl(t.streamUrl, s2.streamId, m.id, t.ticket)
    a.play().catch((e) => {
      if (e?.name === 'NotAllowedError') return setNote('Tap Listen to start'), fn.current.stop()
      if (e?.name !== 'AbortError') fn.current.retry()
    })
  }
  // the stream broke: try again soon (a fresh ticket from the second try), give up after a few
  function retry() {
    if (!m.want) return
    clearTimeout(m.retry)
    m.tries++
    if (m.tries > 4) return setNote("Can't play the home station right now"), stop()
    setPhase('connecting')
    m.retry = setTimeout(async () => {
      if (!m.want) return
      if (m.tries >= 2 && !(m.ticket && now() - m.ticket.at < 30_000)) await getTicket(true)
      halt()
      sync()
    }, 1500 * m.tries)
  }

  function listen() {
    if (m.want) return
    m.want = true
    m.tries = 0
    setListening(true)
    setNote(null)
    live.current.onListen?.()
    claimMediaSession('tavarian', media)
    // iOS: this tap "unlocks" the element (a moment of silence), so a later song change can play without one
    const a = audio.current
    if (!a.getAttribute('src')) {
      a.src = silentWav()
      a.play().then(() => a.getAttribute('src')?.startsWith('data:') && halt(), () => {})
    }
    sync()
    scheduleRenew()
  }
  function stop() {
    m.want = false
    clearTimeout(m.retry)
    clearTimeout(m.renew)
    setListening(false)
    setPhase('off')
    halt()
  }
  // the one play / pause button (lib/player.js mainAction): listen / stop here, and for the owner also resume / play /
  // pause the station. listen() runs first, inside the tap (iOS). act(action): the owner's call (the card passes its
  // spinning one); -> the kind it did
  function press(act) {
    const { tv, owner } = live.current
    const a = mainAction({ owner, listening: m.want, status: tv.state?.status, queued: tv.queue?.items?.length ?? 0 })
    if (a.kind === 'stop' || a.kind === 'pause') stop()
    else listen()
    if (owner && a.posts) (act ?? ((k) => tavarianPost({ action: k }).then((r) => r.ok && live.current.tv.takeState(r.data.state))))(a.kind)
    return a.kind
  }
  fn.current = { sync, retry, stop, listen, press }

  useEffect(() => {
    m.id = newClientId()
    const probe = document.createElement('audio')
    probe.volume = 0.5
    setFixedVolume((m.fixed = probe.volume !== 0.5)) // iOS: hardware buttons only
    const a = (audio.current = new Audio())
    a.preload = 'none'
    const ours = () => m.want && m.stream && !a.getAttribute('src')?.startsWith('data:')
    a.addEventListener('playing', () => {
      if (!ours()) return
      m.tries = 0
      setPhase('playing')
      setNote(null)
      fadeIn()
    })
    a.addEventListener('waiting', () => ours() && setPhase('connecting'))
    a.addEventListener('error', () => ours() && a.getAttribute('src') && fn.current.retry())
    // no data for a while: if it still isn't playing a few seconds later, start it again
    a.addEventListener('stalled', () => {
      const id = m.stream
      ours() && setTimeout(() => ours() && m.stream === id && (a.paused || a.readyState < 3) && fn.current.retry(), 4000)
    })
    // this song's stream ran out: the next one's comes with a new streamId; if none comes, join again
    a.addEventListener('ended', () => {
      if (!ours()) return
      const id = m.stream
      setPhase('connecting')
      clearTimeout(m.ended)
      m.ended = setTimeout(() => {
        const s = live.current.tv.state
        if (m.want && m.stream === id && s?.status === 'playing' && s.streamId === id) fn.current.retry()
      }, 5000)
    })
    // paused from outside (headphones unplugged, the phone's lock screen): that's stop listening
    a.addEventListener('pause', () => Date.now() - m.haltAt > 1000 && ours() && !a.ended && fn.current.stop())
    return () => {
      clearTimeout(m.retry)
      clearTimeout(m.renew)
      clearTimeout(m.ended)
      clearInterval(m.ramp)
      a.pause()
      a.removeAttribute('src')
    }
  }, [])

  // the station changed (new song, paused, resumed, seek): follow it
  const st = tv.state
  useEffect(() => {
    if (listening) fn.current.sync()
  }, [listening, st?.status, st?.streamId])
  // gone for good (revoked / not set up): stop
  useEffect(() => {
    if ((tv.revoked || tv.off) && m.want) setNote(tv.off ? 'The player is not set up' : 'The player was disconnected'), stop()
  }, [tv.revoked, tv.off])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  // media keys / the phone's lock screen: play / pause = listen / stop listening (everyone); ⏮ ⏭ and dragging the
  // progress bar change the station for everyone, so the owner only
  useEffect(() => {
    const take = (r) => r.ok && r.data?.state && live.current.tv.takeState(r.data.state)
    media.nexttrack = owner ? () => tavarianPost({ action: 'skip' }).then(take) : undefined
    media.previoustrack = owner ? () => tavarianPost({ action: 'previous' }).then(take) : undefined
    media.seekto = owner ? (d) => Number.isFinite(d?.seekTime) && tavarianPost({ action: 'seek', seconds: Math.max(0, Math.floor(d.seekTime)) }).then(take) : undefined
    if (mediaSessionOwner() === 'tavarian') claimMediaSession('tavarian', media)
  }, [owner])
  // the lock screen's progress bar: where the song is (the phone moves it on by itself while it plays)
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms?.setPositionState || !listening || mediaSessionOwner() !== 'tavarian') return
    const dur = st?.song?.durationSeconds
    try {
      if (!(dur > 0) || !['playing', 'paused'].includes(st?.status)) return ms.setPositionState()
      ms.setPositionState({ duration: dur, playbackRate: 1, position: Math.min(dur, Math.max(0, positionAt(st, live.current.tv.offset))) })
    } catch {}
  }, [listening, st?.status, st?.song?.id, st?.streamId, st?.positionSeconds])
  const song = st?.song
  // the lock screen's picture: asked for here too (no ref: at once), since with the phone locked no card is on screen
  // to ask for a Spotify song's cover; it is set again when the cover arrives. No cover (yet): the station's own
  // picture, never an empty list (iOS then shows its blank disc and may keep the last song's picture)
  const art = useArt(listening ? song : null)
  const who = (Array.isArray(song?.artists) && song.artists.length ? song.artists.join(', ') : plain(song?.artist)) || 'Home station'
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || !listening || mediaSessionOwner() !== 'tavarian') return
    const put = () => {
      if (typeof MediaMetadata !== 'undefined')
        ms.metadata = new MediaMetadata({
          title: plain(song?.title) || 'Home station',
          artist: who,
          album: plain(song?.album) || 'Home station · wliafdew.dev',
          artwork: art
            ? [{ src: art, sizes: art.startsWith('https://i.ytimg.com/') ? '320x180' : '640x640', type: 'image/jpeg' }] // (YouTube 16:9, Spotify square)
            : [{ src: stationCover(), sizes: '256x256', type: 'image/png' }],
        })
      ms.playbackState = st?.status === 'paused' ? 'paused' : 'playing'
    }
    put()
    // back from the lock screen / another app: say it again (a song change while iOS held the page back may be lost)
    const back = () => document.visibilityState === 'visible' && mediaSessionOwner() === 'tavarian' && put()
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [listening, song?.id, song?.title, who, song?.album, art, st?.status])
  useEffect(() => {
    if (!listening && mediaSessionOwner() === 'tavarian' && navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
  }, [listening])

  return {
    listening,
    phase,
    note,
    setNote,
    fixedVolume,
    listen,
    stop,
    press, // the one play / pause button
    // the radio's volume and mute (0-100, 0 = muted), for this element too
    setVolume: (v) => ((m.level = v), apply()),
  }
}

// The whole Player: the live station + this tab's sound. onListen: called inside the Listen tap.
export function usePlayer({ owner, onListen }) {
  const [keep, setKeep] = useState(false)
  const tv = useTavarian({ keep })
  const au = usePlayerAudio(tv, { owner, onListen })
  useEffect(() => setKeep(au.listening), [au.listening])
  return { ...tv, ...au }
}

// The owner's buttons: act(action, args) posts it, then spins until a state shows the change (or 15 s pass)
export function useTavarianControl(p) {
  const [busy, setBusy] = useState(null) // { action, prev, args, sent }
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (busy?.sent && confirms(busy.action, busy.prev, p.state, busy.args)) setBusy(null)
  }, [busy, p.state])
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => (setBusy(null), setErr("Tavarian hasn't confirmed it yet")), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [busy?.action])
  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => setErr(null), 5000)
    return () => clearTimeout(t)
  }, [err])
  async function act(action, args = {}) {
    if (busy) return
    setBusy({ action, prev: p.state, args, sent: false })
    setErr(null)
    const r = await tavarianPost({ action, ...args })
    if (!r.ok) return setBusy(null), setErr(r.error)
    p.takeState(r.data.state)
    setBusy((b) => (b?.action === action ? { ...b, sent: true } : b))
  }
  return { act, busy: busy?.action ?? null, err }
}

// ---- the owner's queue actions: one at a time, a plain message when refused, and Undo for 5 s ----
// The station plays in several places at once, so a wrong tap changes the music everywhere: every change that can be
// put back offers Undo (lib/player.js undoPlan), and ⏭ / Play now say what happens ("Skipped A · loading B…").
const UNDO_MS = 5000
const TRANS_MS = 40_000 // the skip line gives up after this when the next song never plays
const SLOW_IMPORT = "The import is taking long: Tavarian may still be adding songs, check the queue in a minute"

export function useOwnerOps(p) {
  const [busy, setBusy] = useState(null) // the action in flight ('skip', 'now:<id>', 'undo', …): other buttons wait
  const [toast, setToast] = useState(null) // { text, err, plan: Undo's steps, trans: its text is the skip line }
  const [trans, setTrans] = useState(null) // { from, at }: after ⏭ / Play now, until the next song plays
  const [importing, setImporting] = useState(null) // { url, placement, since }
  const [imported, setImported] = useState(null) // { url, summary, data } or { url, error }
  const [progress, setProgress] = useState(null) // a long Undo: { done, total, until (Tavarian said wait till then) }
  const lock = useRef(null)
  const importLock = useRef(false)
  const live = useRef(p)
  live.current = p
  const ids = () => (live.current.queue?.items ?? []).map((s) => s.id)
  const tl = transitionLine(trans, p.state)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.plan ? UNDO_MS : toast.err ? 7000 : 4000)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    if (!trans) return
    const t = setTimeout(() => setTrans(null), tl?.done ? 4000 : Math.max(0, TRANS_MS - (Date.now() - trans.at)))
    return () => clearTimeout(t)
  }, [trans, tl?.done])

  const say = (text, err = false) => setToast({ text, err })
  const offer = (text, entry, withTrans = false) => setToast({ text, plan: undoPlan(entry), trans: withTrans })
  const fail = (r) => (say(r.error, true), false)
  // resolves true once the live state / queue passes `ok` (the event stream brings them), false after `ms`
  const waitFor = (ok, ms) =>
    new Promise((resolve) => {
      const t0 = Date.now()
      const check = () => (ok(live.current.state, live.current.queue?.items ?? []) ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(check, 150))
      check()
    })
  // one action at a time: a tap while another one is in flight does nothing
  async function run(key, f) {
    if (lock.current) return false
    lock.current = key
    setBusy(key)
    try {
      return await f()
    } finally {
      lock.current = null
      setBusy(null)
    }
  }
  // what plays now (to come back to)
  const snapshot = () => {
    const s = live.current.state
    const on = Boolean(s?.song) && ['playing', 'paused', 'loading'].includes(s.status)
    return { from: on ? s.song : null, at: on ? positionAt(s, live.current.offset) : 0, paused: s?.status === 'paused' }
  }
  const takeQueue = (r) => r.ok && live.current.setQueue(r.data.queue)
  const post = tavarianPost

  const skip = () =>
    run('skip', async () => {
      const prev = live.current.state
      const snap = snapshot()
      const next = live.current.queue?.items?.[0] ?? null
      const r = await post({ action: 'skip' })
      if (!r.ok) return fail(r)
      live.current.takeState(r.data.state)
      setTrans({ from: snap.from, at: Date.now() })
      offer(next ? `Now playing ${plain(next.title)}` : 'Skipped', { kind: 'now', ...snap, to: next, toIndex: next ? 0 : null }, true)
      await waitFor((s) => confirms('skip', prev, s), CONFIRM_MS) // the button spins until the station shows it
      return true
    })
  // ⏮: the last played song plays again now (the current one goes to Recently played, like a skip). Tavarian's own
  // Previous, so a song with no YouTube video (played from the Spotify app) comes back too
  const previous = () =>
    run('previous', async () => {
      const back = live.current.queue?.recent?.[0]
      if (!back) return say('Nothing played before this one yet', true), false
      const prev = live.current.state
      const snap = snapshot()
      const r = await post({ action: 'previous' })
      if (!r.ok) return fail(r)
      live.current.takeState(r.data.state)
      setTrans({ from: snap.from, at: Date.now() })
      offer(`Back to ${plain(back.title)}`, { kind: 'now', ...snap, to: r.data.state?.song ?? null, toIndex: null }, true)
      await waitFor((s) => confirms('skip', prev, s), CONFIRM_MS)
      return true
    })
  const playNow = (song) =>
    run(`now:${song.id}`, async () => {
      const snap = snapshot()
      const index = ids().indexOf(song.id)
      const r = await post({ action: 'play-now', id: song.id })
      if (!r.ok) return fail(r)
      live.current.takeState(r.data.state)
      setTrans({ from: snap.from, at: Date.now() })
      offer(`Now playing ${plain(song.title)}`, { kind: 'now', ...snap, to: song, toIndex: index < 0 ? null : index }, true)
      return true
    })
  const playNext = (song) =>
    run(`next:${song.id}`, async () => {
      const before = ids()
      const r = await post({ action: 'next', id: song.id })
      if (!r.ok) return fail(r)
      takeQueue(r)
      offer(`Up next: ${plain(song.title)}`, { kind: 'order', ids: before })
      return true
    })
  const remove = (song) =>
    run(`remove:${song.id}`, async () => {
      const index = ids().indexOf(song.id)
      const r = await post({ action: 'remove', id: song.id })
      if (!r.ok) return fail(r)
      takeQueue(r)
      offer(`Removed ${plain(song.title)}`, { kind: 'remove', song, index })
      return true
    })
  // Select mode's Remove selected: one call (one write on Tavarian); Undo adds them back and puts the order back
  // (paced: more than a few songs take a while, and the line says so)
  const removeMany = (songs) =>
    run('remove-bulk', async () => {
      const before = ids()
      songs = songs.filter((s) => before.includes(s.id)) // (one that plays by now stays: remove-bulk would stop it)
      if (!songs.length) return say('Those songs had already gone', true), false
      const r = await post({ action: 'remove-bulk', ids: songs.map((s) => s.id) })
      if (!r.ok) return fail(r)
      takeQueue(r)
      const skipped = new Set(r.data.skipped ?? [])
      const gone = songs.filter((s) => !skipped.has(s.id))
      const n = gone.length
      if (!n) return say('Those songs had already gone', true), false
      const plan = undoPlan({ kind: 'bulk', songs: gone, ids: before })
      const { text, countdown } = bulkRemovedLine(n, plan)
      setToast({ text, plan, ...(countdown && { until: Date.now() + UNDO_MS }) })
      return true
    })
  // Clear queue (after the two-step question): every queued song, never the one playing. No Undo
  const clear = () =>
    run('clear', async () => {
      const r = await post({ action: 'clear' })
      if (!r.ok) return fail(r)
      takeQueue(r)
      const n = r.data.removed ?? 0
      say(n ? `Cleared the queue: ${n} song${n === 1 ? '' : 's'} removed` : 'The queue was already empty')
      return true
    })
  // a new order (drag and drop, or the handle's arrow keys); shown at once, put back if Tavarian refuses
  const reorder = (order, song, to) =>
    run('reorder', async () => {
      const before = live.current.queue
      const was = ids()
      if (sameOrder(order, was)) return true
      const byId = new Map((before?.items ?? []).map((s) => [s.id, s]))
      live.current.setQueue({ ...before, items: order.map((id) => byId.get(id)).filter(Boolean) })
      const r = await post({ action: 'reorder', ids: order })
      if (!r.ok) return live.current.setQueue(before), fail(r)
      takeQueue(r)
      offer(song ? `Moved ${plain(song.title)} to #${to + 1}` : 'Moved', { kind: 'order', ids: was })
      return true
    })
  // one YouTube video: placement now | next | end
  const add = (url, placement = 'end', title) =>
    run(`add:${url}:${placement}`, async () => {
      const snap = snapshot()
      const r = await post({ action: 'add', youtubeUrl: url, placement })
      if (!r.ok) return fail(r)
      const song = r.data.song
      live.current.refresh()
      if (placement === 'now') setTrans({ from: snap.from, at: Date.now() })
      offer(placedText(placement, song?.title ?? title), { kind: 'added', ids: song?.id != null ? [song.id] : [], placement, ...snap }, placement === 'now')
      return true
    })
  // a whole playlist (YouTube) or a Spotify playlist / album / track: can take a while, so it has its own lock and
  // the other buttons keep working meanwhile
  async function importList(url, placement = 'end') {
    if (importLock.current) return false
    importLock.current = true
    const snap = snapshot()
    setImported(null)
    setImporting({ url, placement, since: Date.now() })
    const r = await post({ action: 'import', url, placement })
    importLock.current = false
    setImporting(null)
    if (!r.ok) {
      const error = r.status === 504 || r.status === 0 || r.code === 'timeout' ? SLOW_IMPORT : r.error
      setImported({ url, error })
      return say(error, true), false
    }
    const summary = importSummary(r.data)
    setImported({ url, summary, data: r.data })
    live.current.refresh()
    const added = (r.data.added ?? []).map((s) => s.id)
    if (!added.length) return say(summary.text, true), false
    if (placement === 'now') setTrans({ from: snap.from, at: Date.now() })
    offer(`Added ${summary.added} song${summary.added === 1 ? '' : 's'}${summary.skipped ? ` · skipped ${summary.skipped}` : ''}`, { kind: 'added', ids: added, placement, ...snap })
    return true
  }

  // Many calls for one Undo (an import's songs, the songs of a Remove selected): two at a time; a refusal in `fine` is
  // all right (it already went / is already there). Tavarian limits how fast a token may call: on "too fast" wait as
  // long as it says, then go on (the line shows how far it got: "Undoing… 12 of 40 added back")
  async function paced(items, call, { verb, fine = [] }) {
    const left = [...items]
    const total = left.length
    let done = 0
    let bad = null
    let pause = null
    const worker = async () => {
      while (left.length && !bad) {
        if (pause) await pause
        if (bad || !left.length) break
        const item = left.shift()
        const q = await call(item)
        if (q.status === 429) {
          left.unshift(item)
          const s = Math.min(90, q.retryAfter || 30)
          pause ??= new Promise((r) => {
            setProgress({ verb, done, total, until: Date.now() + s * 1000 })
            setTimeout(() => ((pause = null), setProgress({ verb, done, total }), r()), s * 1000)
          })
          continue
        }
        if (!q.ok && !fine.includes(q.code)) bad = q
        done++
        if (total > 4) setProgress((g) => ({ verb, done, total, until: g?.until > Date.now() ? g.until : 0 }))
      }
    }
    await Promise.all([worker(), worker()])
    setProgress(null)
    return bad ?? { ok: true }
  }

  // ---- Undo: the plan's steps, in order; the first refusal stops it with a plain message ----
  async function step(st) {
    if (st.do === 'stop') {
      const r = await post({ action: 'stop' })
      if (r.ok) live.current.takeState(r.data.state)
      return r
    }
    if (st.do === 'restore') {
      // the song that played comes back now, at the second it was at (and paused, if it was)
      const r = await post({ action: 'add', youtubeUrl: videoUrl(st.song.youtubeId), placement: 'now' })
      if (!r.ok) return r
      const id = r.data.song?.id
      if (st.at) {
        // (Tavarian takes a seek while the song still loads: it starts right there)
        const q = await post({ action: 'seek', seconds: st.at })
        if (!q.ok) return q
        live.current.takeState(q.data.state)
      }
      if (st.paused) {
        if (!(await waitFor((s) => s?.song?.id === id && s.status === 'playing', 20_000))) return { ok: false, error: "it didn't start in time" }
        const q = await post({ action: 'pause' })
        if (!q.ok) return q
        live.current.takeState(q.data.state)
      }
      return r
    }
    if (st.do === 'requeue') {
      // added again (it lands at the end), then moved back to its place
      let id = (live.current.queue?.items ?? []).find((s) => s.youtubeId === st.song.youtubeId)?.id
      if (id == null) {
        const r = await post({ action: 'add', youtubeUrl: videoUrl(st.song.youtubeId), placement: 'end' })
        if (!r.ok) return r
        id = r.data.song?.id
        live.current.refresh()
        await waitFor((s, q) => q.some((x) => x.id === id), 6000)
      }
      const now = ids()
      const order = insertAt(now.includes(id) ? now : [...now, id], id, st.index)
      if (sameOrder(order, now)) return { ok: true }
      const q = await post({ action: 'reorder', ids: order })
      takeQueue(q)
      return q
    }
    if (st.do === 'order') {
      const now = ids()
      const order = restoreOrder(st.ids, now)
      if (sameOrder(order, now)) return { ok: true }
      const q = await post({ action: 'reorder', ids: order })
      takeQueue(q)
      return q
    }
    if (st.do === 'remove') {
      // one call when Tavarian has remove-bulk (an import's 100 songs: one write); an older one: one by one, paced
      // (only what's still queued: remove-bulk would also stop one of them that plays by now, a single remove doesn't)
      const queued = new Set(ids())
      let rest = st.ids.filter((id) => queued.has(id))
      if (!rest.length) return { ok: true }
      if (rest.length > 1) {
        const r = await post({ action: 'remove-bulk', ids: rest.slice(0, 200) })
        if (r.ok) takeQueue(r), (rest = rest.slice(200))
        else if (r.code !== 'http_404') return r
        if (!rest.length) return { ok: true }
      }
      return paced(rest, async (id) => {
        const q = await post({ action: 'remove', id })
        if (q.ok) takeQueue(q)
        return q
      }, { verb: 'removed', fine: ['not_found', 'not_queued'] })
    }
    if (st.do === 'readd') {
      // the removed songs come back at the end (one still or again queued keeps its place), then the old order
      const map = new Map() // old id -> the id it came back under
      const queued = new Map((live.current.queue?.items ?? []).map((s) => [s.youtubeId, s.id]))
      const todo = st.songs.filter((s) => (queued.has(s.youtubeId) ? (map.set(s.id, queued.get(s.youtubeId)), false) : true))
      const r = await paced(todo, async (s) => {
        const q = await post({ action: 'add', youtubeUrl: videoUrl(s.youtubeId), placement: 'end' })
        if (q.ok && q.data.song?.id != null) map.set(s.id, q.data.song.id)
        return q
      }, { verb: 'added back', fine: ['duplicate'] })
      if (!r.ok) return r
      live.current.refresh()
      const back = [...map.values()]
      await waitFor((s, q) => back.every((id) => q.some((x) => x.id === id)), 8000)
      const now = ids()
      const order = restoreOrder(remapOrder(st.ids, map), now)
      if (sameOrder(order, now)) return { ok: true }
      const q = await post({ action: 'reorder', ids: order })
      takeQueue(q)
      return q
    }
    return { ok: true }
  }
  function undo() {
    const plan = toast?.plan
    if (!plan || lock.current) return
    setToast(null)
    setTrans(null)
    run('undo', async () => {
      for (const st of plan) {
        const r = await step(st)
        if (!r.ok) return say(`Couldn't undo: ${r.error}`, true)
      }
      say('Undone')
    })
  }

  return { busy, toast, trans, tl, importing, imported, progress, say, skip, previous, playNow, playNext, remove, removeMany, clear, reorder, add, importList, undo }
}

// what the line under the player (and the sheet's status line) says for the owner's actions, or null
function opsLine(ops) {
  if (!ops) return null
  if (ops.busy === 'undo') {
    const g = ops.progress
    const s = g?.until ? Math.ceil((g.until - Date.now()) / 1000) : 0
    return { text: g ? `Undoing… ${g.done} of ${g.total} ${g.verb ?? 'removed'}${s > 0 ? ` · Tavarian asks to slow down: going on in ${s} s` : ''}` : 'Undoing…', spin: true, ticks: s > 0 }
  }
  if (ops.busy === 'clear') return { text: 'Clearing the queue…', spin: true }
  if (ops.busy === 'remove-bulk') return { text: 'Removing…', spin: true }
  const t = ops.toast
  if (t?.err) return { text: t.text, err: true }
  // (only a slow Undo, a Remove selected of many songs, shows how long it's still offered)
  if (t) return { text: t.trans && ops.tl ? ops.tl.text : t.text, undo: Boolean(t.plan), until: t.until ?? 0, ticks: Boolean(t.until) }
  if (ops.tl) return { text: ops.tl.text, spin: !ops.tl.done }
  if (ops.importing) return { text: 'Importing a playlist… this can take a while', spin: true }
  return null
}
function OpsLine({ line, ops, wrap, className = '' }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!line?.ticks) return
    const t = setInterval(() => tick((n) => n + 1), 1000) // the countdown
    return () => clearInterval(t)
  }, [line?.ticks])
  return (
    <p className={`flex items-center justify-center gap-2 min-w-0 ${className}`} role="status" aria-live="polite">
      <span className={`${wrap ? 'line-clamp-2 text-center' : 'truncate'} ${line?.err ? 'text-red-400' : ''}`}>
        {line?.spin && <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" />}
        {line?.text ?? ''}
      </span>
      {line?.undo && (
        <button onClick={ops.undo} className="shrink-0 -my-1.5 py-1.5 px-1.5 font-bold text-lofi-primary hover:text-white flex items-center gap-1 transition-colors">
          <i className="fa-solid fa-rotate-left text-[0.9em]" aria-hidden="true" /> Undo
          {line.until > 0 && <span className="font-normal tabular-nums text-lofi-muted">{Math.max(0, Math.ceil((line.until - Date.now()) / 1000))} s</span>}
        </button>
      )}
    </p>
  )
}

// ---- drag to reorder: a mouse drags the handle (⋮⋮) at once; a finger holds it ~400 ms first (a small buzz says
// "go"), so a plain swipe over the list still scrolls. Pointer events; while a finger drags, touchmove is cancelled
// so the list doesn't scroll under it (but it scrolls by itself near the top / bottom edge) ----
const HOLD_MS = 400
function useDragReorder({ ids, disabled, onDrop }) {
  const [drag, setDrag] = useState(null) // { id, from, gap, dy, top }: the row that moves and the drop line
  const [pressing, setPressing] = useState(null) // a finger holds this id's handle (not dragging yet)
  const list = useRef(null)
  const g = useRef(null)
  const latest = useRef({ ids, onDrop })
  latest.current = { ids, onDrop }
  useEffect(() => () => g.current?.end(), [])

  function start(e, index) {
    if (disabled || g.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    const touch = e.pointerType !== 'mouse'
    if (!touch) e.preventDefault() // no text selection while dragging
    const handle = e.currentTarget
    const id = latest.current.ids[index]
    const scroller = list.current?.closest('[data-scroll]')
    const pid = e.pointerId
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    let timer = 0
    let raf = 0
    let lastY = y0
    let mids = []
    let tops = []
    let bottom = 0
    let s0 = 0
    let gap = index
    const scrolled = () => (scroller?.scrollTop ?? 0) - s0
    const update = (y) => {
      lastY = y
      const cy = y + scrolled()
      gap = gapAt(mids, cy)
      setDrag({ id, from: index, gap, dy: cy - y0, top: gap >= tops.length ? bottom + 3 : tops[gap] - 3 })
    }
    const edge = () => {
      if (!active) return
      const r = scroller?.getBoundingClientRect()
      const v = !r ? 0 : lastY < r.top + 48 ? -Math.ceil((r.top + 48 - lastY) / 6) : lastY > r.bottom - 48 ? Math.ceil((lastY - r.bottom + 48) / 6) : 0
      if (v) {
        const before = scroller.scrollTop
        scroller.scrollTop += v
        if (scroller.scrollTop !== before) update(lastY)
      }
      raf = requestAnimationFrame(edge)
    }
    const activate = () => {
      setPressing(null)
      settleFlip(list.current) // (rows still gliding after an update or a drop would be measured mid-way)
      const rows = [...(list.current?.children ?? [])].filter((el) => el.dataset.row != null)
      if (!rows.length) return end()
      const lt = list.current.getBoundingClientRect().top
      const rects = rows.map((r) => r.getBoundingClientRect())
      mids = rects.map((r) => r.top + r.height / 2)
      tops = rects.map((r) => r.top - lt)
      bottom = rects.at(-1).bottom - lt
      s0 = scroller?.scrollTop ?? 0
      active = true
      if (touch) navigator.vibrate?.(10)
      try {
        handle.setPointerCapture(pid)
      } catch {}
      update(lastY)
      raf = requestAnimationFrame(edge)
    }
    const move = (ev) => {
      if (ev.pointerId !== pid) return
      if (active) return update(ev.clientY)
      const d = Math.hypot(ev.clientX - x0, ev.clientY - y0)
      if (!touch && d > 3) activate()
      else if (touch && d > 8) end() // a swipe, not a hold: the list scrolls and nothing moves
    }
    const up = (ev) => {
      if (ev.pointerId !== pid) return
      const was = active
      end()
      if (!was) return
      const now = latest.current.ids // (the queue may have moved on while dragging)
      const from = now.indexOf(id)
      const to = Math.min(gapIndex(index, gap), now.length - 1)
      if (from >= 0 && to !== from) latest.current.onDrop(moveTo(now, from, to), id, to)
    }
    const cancel = (ev) => ev.pointerId === pid && end()
    const noScroll = (ev) => active && ev.cancelable && ev.preventDefault()
    const noMenu = (ev) => ev.preventDefault()
    const keyOut = (ev) => ev.key === 'Escape' && (ev.preventDefault(), end()) // (just the drag: the sheet stays open)
    function end() {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      active = false
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', cancel)
      removeEventListener('touchmove', noScroll)
      removeEventListener('contextmenu', noMenu, true)
      removeEventListener('keydown', keyOut, true)
      g.current = null
      setPressing(null)
      setDrag(null)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', cancel)
    addEventListener('touchmove', noScroll, { passive: false })
    addEventListener('contextmenu', noMenu, true)
    addEventListener('keydown', keyOut, true)
    g.current = { end }
    if (touch) {
      setPressing(id)
      timer = setTimeout(activate, HOLD_MS)
    }
  }
  // the handle's ↑ / ↓ keys move it one place
  function key(e, index) {
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!d) return
    e.preventDefault() // (also while busy: a quick second ↓ is ignored, not a scroll of the list)
    if (disabled) return
    const order = moveId(ids, ids[index], d)
    if (order) onDrop(order, ids[index], index + d)
  }
  return { list, drag, pressing, start, key }
}

// ---- long titles ----
// one ResizeObserver for every title on the page (a queue can be 200 rows)
let sizeWatch = null
const sizeCalls = new WeakMap()
function watchSize(el, f) {
  if (typeof ResizeObserver === 'undefined') return f(), () => {}
  sizeWatch ??= new ResizeObserver((entries) => entries.forEach((e) => sizeCalls.get(e.target)?.()))
  sizeCalls.set(el, f)
  sizeWatch.observe(el)
  f()
  return () => (sizeWatch.unobserve(el), sizeCalls.delete(el))
}
// the card's title: does it take two lines (then the line under it makes room)?
function useTwoLines(ref, text) {
  const [two, setTwo] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    return watchSize(el, () => setTwo(el.clientHeight > 1.5 * (parseFloat(getComputedStyle(el).lineHeight) || 24)))
  }, [text])
  return two
}
// a row's title: two lines at most, the whole one on hover (title) and, when it's cut, behind a small ⌄ that opens
// the row (phones have no hover). Opening and closing slide the row's height (WAAPI, the same in Chrome, Safari and
// Firefox: the box's height from what it shows to what it will show); the ⌄ turns with it (the same 220 ms ease-out,
// Tailwind's curve). Reduced motion: at once.
// `open` is what was asked (the ⌄, aria-expanded); `clamped` is what shows: while closing the whole title stays until
// the box has shrunk to two lines, then the clamp (and its …) comes back.
const EXPAND_MS = 220
function SongTitle({ text }) {
  const ref = useRef(null)
  const box = useRef(null)
  const anim = useRef(null)
  const from = useRef(null) // the height to slide from on the next render (opening)
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(true)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !clamped) return
    return watchSize(el, () => setCut(overflows(el.scrollHeight, el.clientHeight)))
  }, [text, clamped])
  useEffect(() => () => anim.current?.cancel(), [])
  const slide = (a, b, done) => {
    anim.current?.cancel()
    const el = box.current
    if (!el || a === b || motionOff() || !el.animate) return (anim.current = null), done?.()
    const run = (anim.current = el.animate([{ height: `${a}px` }, { height: `${b}px` }], { duration: EXPAND_MS, easing: 'cubic-bezier(0, 0, 0.2, 1)', fill: 'forwards' }))
    run.onfinish = () => anim.current === run && (done ? done() : (run.cancel(), (anim.current = null)))
  }
  // opening: the clamp is off now; slide from the two lines to the whole height
  useLayoutEffect(() => {
    if (from.current == null || clamped) return
    const a = from.current
    from.current = null
    slide(a, box.current.offsetHeight)
  }, [clamped])
  // closing: the clamp is back (this same frame); let the held height go
  useLayoutEffect(() => {
    if (clamped && anim.current) anim.current.cancel(), (anim.current = null)
  }, [clamped])
  const toggle = (e) => {
    e.stopPropagation()
    const el = box.current
    const now = el?.getBoundingClientRect().height ?? 0 // (mid-slide: where it is now)
    if (!open) {
      setOpen(true)
      if (!clamped) return slide(now, ref.current.scrollHeight) // opened again while it was closing
      from.current = now
      setClamped(false)
    } else {
      setOpen(false)
      const lh = parseFloat(getComputedStyle(ref.current).lineHeight) || 16
      slide(now, Math.min(now, 2 * lh), () => setClamped(true))
    }
  }
  return (
    <span className="flex items-start gap-1 min-w-0">
      <span ref={box} className="block min-w-0 flex-1 overflow-hidden">
        <span ref={ref} title={text} className={`text-xs font-medium text-white break-words ${clamped ? 'line-clamp-2' : 'block'}`}>
          {text}
        </span>
      </span>
      {(open || !clamped || cut) && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? 'Show less of the title' : `Show the whole title: ${text}`}
          title={open ? 'Show less' : 'Show the whole title'}
          className="shrink-0 -my-1 -mr-1 w-6 h-6 rounded-full flex items-center justify-center text-lofi-muted hover:text-white hover:bg-white/5 transition-colors"
        >
          <i className={`fa-solid fa-chevron-down text-[9px] transition-transform duration-[220ms] ease-out ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

// ---- pieces ----
// A song's picture: thumbOf (its YouTube thumbnail or Spotify cover), else — a Spotify song Tavarian has no cover for
// (from a Spotify-made playlist) — its cover from Spotify's oEmbed (lib/spotify-cover.js), asked for once the element
// comes within LAZY_MARGIN of being seen in the box that scrolls it (lib/lazy.js: the Player sheet's list, else the
// page), so a flick down the queue finds its covers there already (ref; no ref = at once)
const COVERS_KEY = 'home-lofi:spotify-covers'
const covers =
  typeof window === 'undefined'
    ? null
    : coverCache({
        store: {
          load: () => JSON.parse(localStorage.getItem(COVERS_KEY) || '[]'),
          save: (entries) => localStorage.setItem(COVERS_KEY, JSON.stringify(entries)),
        },
      })
// (covers found just before the tab goes away are saved now, not lost with the pending write)
if (covers) addEventListener('pagehide', () => covers.flush())
// the lock screen's picture while a song has none yet: the station's mark on the night colours (drawn once, a PNG,
// since iOS shows no SVG there)
let stationArt = null
function stationCover() {
  if (stationArt) return stationArt
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 256, 256)
  grad.addColorStop(0, '#2a2a4a')
  grad.addColorStop(1, '#1a1a2e')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-lofi-primary').trim() || '#ff8a5b'
  for (const [r, f] of [[80, '#2a2a4a'], [40, accent], [12, '#1a1a2e']]) {
    g.beginPath()
    g.arc(128, 128, r, 0, Math.PI * 2)
    g.fillStyle = f
    g.fill()
  }
  return (stationArt = c.toDataURL('image/png'))
}

// one IntersectionObserver per scroll box, shared by its rows
const nearby = typeof IntersectionObserver === 'undefined' ? null : lazyWatcher({ IO: IntersectionObserver })
function useArt(song, ref) {
  const own = thumbOf(song) ?? song?.coverThumbnail ?? null
  const uri = !own ? (song?.spotifyUri ?? null) : null
  const [art, setArt] = useState(null) // { uri, url }: kept with its song, so another song's cover never shows
  useEffect(() => {
    if (!uri || !covers) return setArt(null)
    const had = covers.known(uri)
    if (had !== undefined) return setArt({ uri, url: had })
    let alive = true
    const ask = () => covers.cover(uri).then((url) => alive && setArt({ uri, url }))
    const el = ref?.current
    if (!el || !nearby) return ask(), () => (alive = false)
    const stop = nearby(el, scrollRoot(el), ask)
    return () => ((alive = false), stop())
  }, [uri])
  if (own) return own
  if (!uri) return null
  return art?.uri === uri ? art.url : (covers?.known(uri) ?? null)
}

// A picture that fades in once it has loaded (instead of painting in top to bottom, or popping in), decoded off the
// main thread. One already loaded (the browser's cache) shows at once; one that fails stays invisible, leaving whatever
// sits behind it (a placeholder box). lazy: let the browser hold it back until it's near (long lists). Reduced motion:
// no fade (the global rule in globals.css). The opacity is inline so it wins over the caller's own opacity classes.
function FadeImg({ src, lazy, className = '', ...rest }) {
  const el = useRef(null)
  const [done, setDone] = useState(null) // the src that has loaded
  useLayoutEffect(() => {
    const i = el.current
    if (i?.complete && i.naturalWidth) setDone(src)
  }, [src])
  return (
    <img
      ref={el}
      src={src}
      alt=""
      decoding="async"
      loading={lazy ? 'lazy' : undefined}
      onLoad={() => setDone(src)}
      style={done === src ? undefined : { opacity: 0 }}
      className={`${className} ${className.includes('transition') ? '' : 'transition-opacity duration-300 ease-out'}`}
      {...rest}
    />
  )
}

// a small picture (the card's Up next rows) with the same fallback: the box (a placeholder until the picture is in)
// is what's watched, the picture fades in inside it
function Thumb({ s, className }) {
  const ref = useRef(null)
  const art = useArt(s, ref)
  return (
    <span ref={ref} className={`block overflow-hidden ${className}`}>
      {art && <FadeImg src={art} lazy className="w-full h-full object-cover" />}
    </span>
  )
}

function Cover({ song, size = 'w-24 h-24', on, children }) {
  const art = useArt(song)
  return (
    <span className={`relative shrink-0 ${size} rounded-2xl overflow-hidden border border-white/10 shadow-xl bg-lofi-surface flex items-center justify-center`}>
      {art ? <FadeImg key={art} src={art} className={`w-full h-full object-cover ${on ? '' : 'saturate-75 opacity-80'}`} /> : <i className="fa-solid fa-music text-2xl text-lofi-primary/60" aria-hidden="true" />}
      {children}
    </span>
  )
}
function Round({ label, icon, onClick, busy, disabled, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white disabled:opacity-30 disabled:hover:text-lofi-muted transition-colors ${className}`}
    >
      <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : icon} text-sm`} aria-hidden="true" />
    </button>
  )
}
const mainOf = (p, owner) => mainAction({ owner, listening: p.listening, phase: p.phase, status: p.state?.status, queued: p.queue?.items?.length ?? 0 })
const STATION_ACTS = ['pause', 'resume', 'play']

// The Player tab
export function PlayerPanel({ p, owner, vol, openQueue = 0 }) {
  const ctl = useTavarianControl(p)
  const ops = useOwnerOps(p)
  const [sheet, setSheet] = useState(null) // the sheet's open view: queue | recent | search | import | playlists
  // the bar's ☰ asked for the queue (just now: also right after this tab mounted for it)
  useEffect(() => {
    if (owner && openQueue && Date.now() - openQueue < 3000) setSheet('queue')
  }, [openQueue, owner])
  const dlg = useRef(null)
  // a view set: the <dialog> opens (showModal, like Settings) and Add's box or ✕ takes the focus; it closes through
  // closeDialog (the exit animation), and only its close event lets go of the view
  useEffect(() => {
    const d = dlg.current
    if (!sheet || !d || d.open) return
    d.showModal()
    ;(d.querySelector('[data-autofocus]') ?? d.querySelector('[data-close]'))?.focus({ preventScroll: true })
  }, [sheet])
  const title = useRef(null)
  const twoLines = useTwoLines(title, p.state?.song?.title)
  const [drag, setDrag] = useState(null) // the seek bar while it's held (seconds)
  const playing = p.state?.status === 'playing'
  const [, tick] = useState(0)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [playing])

  const song = p.revoked || p.off ? null : p.state?.song
  const art = useArt(song) // (the blurred backdrop: also a Spotify song's fetched cover)
  const items = p.queue?.items ?? []
  const recent = p.queue?.recent ?? []
  const auto = song ? (p.state?.autoplay ?? null) : null // a Spotify autoplay pick: { played, limit }
  const picks = useAutoplayPicks(owner && auto != null, song) // Spotify's next picks (owner, during autoplay)
  const list = cardList({ song, items, recent, autoplay: auto, picks })
  // the two rows glide (a skip: the first leaves, the second moves up, a new one comes in)
  const cardRows = useRef(null)
  useFlip(cardRows, flipSig([list.kind, ...list.rows.map((s) => s.id)]))
  const info = statusInfo({ off: p.off, revoked: p.revoked, reachable: p.reachable, state: p.state, queued: items.length, owner })
  const dur = song?.durationSeconds > 0 ? song.durationSeconds : 0
  const pos = drag ?? positionAt(p.state, p.offset)
  const hearing = p.listening && p.phase === 'playing'
  const main = mainOf(p, owner)
  const locked = ctl.busy != null || ops.busy != null // one tap = one action
  const commitSeek = () => {
    if (drag == null) return
    ctl.act('seek', { seconds: Math.round(drag) })
    setDrag(null)
  }

  if (p.off || p.revoked) {
    return (
      <div className="grow flex flex-col items-center justify-center text-center gap-1.5">
        <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-white/10 bg-lofi-base/30 flex items-center justify-center mb-2" aria-hidden="true">
          <i className={`fa-solid ${p.off ? 'fa-music' : 'fa-link-slash'} text-2xl text-lofi-primary/50`} />
        </div>
        <p className="text-[9px] font-mono uppercase tracking-widest text-lofi-muted">Home station</p>
        <p className="text-sm font-medium text-white" role="status">
          {info.label}
        </p>
        <p className="text-xs text-lofi-muted text-balance max-w-64">
          {p.off ? 'Nothing to play here yet.' : owner ? 'Make a new token on Tavarian (Connections) and set TAVARIAN_TOKEN.' : 'The home station is off for now.'}
        </p>
      </div>
    )
  }

  const songError = p.songError && Date.now() - p.songError.at < 8000 ? p.songError : null
  const titleOf = (id) => [p.state?.song, ...items, ...recent].find((s) => s && s.id === id)?.title
  const err = ctl.err ?? (songError ? songErrorText(songError.reason, titleOf(songError.songId)) : null)
  const mine = owner ? opsLine(ops) : null
  const tuning = p.listening && p.phase === 'connecting'
  // (phones: tuning in is just the spinner, here and on Listen; the words stay for screen readers)
  // (paused because Spotify can't be used: why, in the line under the controls, in the highlight color)
  const line = err ?? p.note ?? (info.why ? <span className="text-lofi-highlight">{info.why}</span> : null) ?? (tuning ? <><span className="sm:hidden" aria-hidden="true"><i className="fa-solid fa-spinner fa-spin" /></span><span className="max-sm:sr-only">Tuning in…</span></> : p.listening && p.phase === 'waiting' ? 'Listening: it plays as soon as the station does' : '')
  return (
    <>
      {song && art && <FadeImg key={art} src={art} aria-hidden="true" className={`absolute inset-0 w-full h-full object-cover blur-2xl scale-125 pointer-events-none transition-opacity duration-700 ${playing ? 'opacity-25' : 'opacity-12'}`} />}

      <div className="relative flex gap-4 min-w-0">
        <Cover song={song} on={playing} />
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <p className="flex items-center gap-2 text-[10px] font-mono text-lofi-muted mb-1">
            <span className={`px-1.5 py-0.5 rounded-full border ${playing ? 'text-lofi-primary bg-lofi-primary/10 border-lofi-primary/20' : 'border-white/10'}`} role="status">
              {playing ? '●' : info.key === 'paused' ? '❚❚' : '○'} {info.label}
            </span>
            {/* (a Spotify autoplay pick: the same badge says so, with how many of the round have played) */}
            {song && (auto || p.state?.playingVia === 'spotify') && (
              <span
                className="min-w-0 px-1.5 py-0.5 rounded-full border border-[#1db954]/30 text-[#1db954] flex items-center gap-1"
                title={auto ? `${autoplayText(auto)}: the queue ran out, Spotify picks the songs (it pauses after ${auto.limit})` : 'Playing from Spotify (320 kbps)'}
              >
                <i className="fa-brands fa-spotify" aria-hidden="true" />
                {auto ? <span className="truncate"><span className="sr-only">Spotify </span>Autoplay · {auto.played}/{auto.limit}</span> : 'Spotify'}
              </span>
            )}
            {hearing && <EqBars />}
          </p>
          {/* a long title takes two lines; then the line under it gives up its room (the card keeps its height) */}
          <p ref={title} className="text-base font-medium text-white line-clamp-2 break-words" title={plain(song?.title) || undefined}>
            {plain(song?.title) || (info.key === 'empty' ? 'Nothing queued' : info.key === 'stopped' ? `${items.length} in the queue` : 'Home station')}
          </p>
          {!(song && twoLines) && <p className="text-xs text-lofi-muted truncate">{song ? 'Tavarian · home station' : owner ? 'Add a song to start' : 'Nothing on the home station right now'}</p>}
          {song && (
            <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono text-lofi-muted tabular-nums">
              <span>{mmss(pos)}</span>
              {owner && dur ? (
                <input
                  type="range"
                  min={0}
                  max={Math.floor(dur)}
                  step={1}
                  value={Math.floor(pos)}
                  onChange={(e) => setDrag(Number(e.target.value))}
                  onPointerUp={commitSeek}
                  onKeyUp={commitSeek}
                  onBlur={commitSeek}
                  disabled={ctl.busy === 'seek'}
                  aria-label="Seek (for everyone)"
                  aria-valuetext={`${mmss(pos)} of ${mmss(dur)}`}
                  className="seek-bar min-w-0 grow disabled:opacity-50"
                  style={{ '--v': `${(pos / dur) * 100}%` }}
                />
              ) : (
                <span className="grow h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                  <span className="block h-full bg-lofi-primary transition-[width] duration-1000 ease-linear" style={{ width: dur ? `${(pos / dur) * 100}%` : playing ? '100%' : '0%' }} />
                </span>
              )}
              <span>{dur ? mmss(dur) : 'live'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-auto flex items-center gap-1.5 pt-2">
        {/* [⏮] [● play / pause] [⏭] [mute + volume] [+] for the owner; a guest gets [● listen / stop] [mute + volume] */}
        {owner && <Round label="Previous song for everyone" icon="fa-backward-step" onClick={ops.previous} busy={ops.busy === 'previous'} disabled={!p.queue?.recent?.length || locked} />}
        <button
          onClick={() => p.press(ctl.act)}
          disabled={owner && locked}
          aria-pressed={p.listening}
          aria-label={main.label}
          title={main.label}
          className="w-11 h-11 shrink-0 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-all hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 shadow-[0_0_15px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)]"
        >
          <i className={`fa-solid ${STATION_ACTS.includes(ctl.busy) ? 'fa-spinner fa-spin' : main.icon} text-base`} aria-hidden="true" />
        </button>
        {owner && <Round label="Skip for everyone" icon="fa-forward-step" onClick={ops.skip} busy={ops.busy === 'skip'} disabled={!song || locked} />}
        {!vol.fixedVolume && (
          <div className="flex items-center gap-1 min-w-0 flex-1 ml-1.5">
            <button onClick={vol.toggleMute} aria-label={vol.muted ? 'Unmute' : 'Mute'} title={vol.muted ? 'Unmute' : 'Mute'} className="w-7 h-7 shrink-0 flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
              <i className={`fa-solid ${vol.muted || vol.volume === 0 ? 'fa-volume-xmark' : vol.volume < 50 ? 'fa-volume-low' : 'fa-volume-high'} text-xs`} aria-hidden="true" />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={vol.muted ? 0 : vol.volume}
              onChange={(e) => vol.setLevel(Number(e.target.value))}
              aria-label="Volume on this device"
              title="Volume on this device"
              className="radio-volume vol-grey min-w-0 flex-1"
              style={{ '--v': `${vol.muted ? 0 : vol.volume}%` }}
            />
            <span className={`w-8 shrink-0 text-right text-[10px] font-mono text-lofi-muted tabular-nums ${owner ? 'max-sm:hidden' : ''}`} aria-hidden="true">
              {vol.muted ? 0 : vol.volume}%
            </span>
          </div>
        )}
        {/* the owner's Add: a round + next to the slider (on a phone too, so the slider keeps its room; the % hides there) */}
        {owner && (
          <button
            onClick={() => setSheet('search')}
            aria-haspopup="dialog"
            aria-label="Add songs (search, paste a link, import a playlist)"
            title="Add songs: search, paste a link, import a playlist"
            className={`h-10 w-10 shrink-0 rounded-full border border-lofi-primary/50 bg-lofi-primary/15 text-lofi-primary font-bold text-sm flex items-center justify-center hover:bg-lofi-primary hover:text-lofi-base transition-colors ${vol.fixedVolume ? 'ml-auto' : ''}`}
          >
            <i className={`fa-solid ${ops.importing ? 'fa-spinner fa-spin' : 'fa-plus'} text-sm`} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Up next: the first two (or "the queue is empty"); nothing on: the last played. The header opens the list */}
      <div ref={cardRows} className="relative mt-2 min-w-0 h-[52px] shrink-0">
        <p className="flex items-center justify-between h-4 text-[9px] font-mono uppercase tracking-widest text-lofi-muted">
          <span>{list.kind === 'last' ? 'Last played' : 'Up next'}</span>
          <button onClick={() => setSheet(list.kind === 'last' ? 'recent' : 'queue')} aria-haspopup="dialog" aria-label={list.kind === 'last' ? `Recent: ${recent.length} song${recent.length === 1 ? '' : 's'}` : `Queue: ${items.length} song${items.length === 1 ? '' : 's'}`} className="normal-case tracking-normal text-[10px] hover:text-white transition-colors">
            {list.kind === 'last' ? `Recent · ${recent.length}` : `Queue · ${items.length}`} ›
          </button>
        </p>
        {list.rows.length ? (
          <ul>
            {list.rows.map((s) => (
              <li key={s.id} data-flip-key={s.id} className="flex items-center gap-2 min-w-0 text-[11px] h-[18px]">
                <Thumb s={s} className="w-[26px] h-4 rounded-sm object-cover shrink-0 bg-lofi-surface" />
                <span className="text-white/80 truncate" title={s.pick ? `Spotify pick: ${[plain(s.title), s.artists.join(', ')].filter(Boolean).join(' · ')}` : plain(s.title)}>
                  {s.pick && <span className="sr-only">Spotify pick: </span>}
                  {plain(s.title)}
                </span>
                {/* (one of Spotify's autoplay picks, not a queued song: its small mark) */}
                {s.pick && <i className="fa-brands fa-spotify text-[10px] text-[#1db954]/70 shrink-0 ml-auto" aria-hidden="true" title="Spotify pick" />}
                {s.durationSeconds > 0 && <span className={`text-lofi-muted font-mono text-[10px] shrink-0 ${s.pick ? '' : 'ml-auto'}`}>{mmss(s.durationSeconds)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p data-flip-key="~empty" className="text-[11px] text-lofi-muted italic pt-1">
            {list.kind === 'autoplay' ? 'Autoplay: Spotify picks the next song.' : owner ? 'The queue is empty: Add puts a song in it.' : 'The queue is empty.'}
          </p>
        )}
      </div>
      {mine ? (
        <OpsLine line={mine} ops={ops} className="relative shrink-0 h-4 mt-1 text-[10px] font-mono text-lofi-muted" />
      ) : (
        <p className={`relative shrink-0 h-4 mt-1 text-[10px] font-mono text-center truncate ${err ? 'text-red-400' : 'text-lofi-muted'}`} aria-live="polite">
          {line}
        </p>
      )}
      <PlayerSheet dlg={dlg} p={p} owner={owner} ops={ops} picks={picks} view={sheet} setView={setSheet} onClosed={() => setSheet(null)} />
    </>
  )
}

function EqBars() {
  return (
    <span className="flex items-end gap-0.5 h-3 shrink-0" aria-hidden="true">
      {[10, 14, 7, 12].map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-lofi-primary origin-bottom animate-eq" style={{ height: h, animationDelay: `${i * -0.23}s` }} />
      ))}
    </span>
  )
}

// a song in a list: (a drag handle), thumbnail, title, a second line, then the row's buttons. stack: on phones the
// buttons get a line of their own (search results: room for their words)
function SongRow({ s, sub, on, picked, lead, stack, lifted, className = '', children, ...rest }) {
  const img = useRef(null)
  const art = useArt(s, img)
  const look = lifted ? 'relative z-10 bg-lofi-surface border-lofi-primary/60 shadow-2xl opacity-95' : on ? 'bg-lofi-primary/15 border-lofi-primary/40' : picked ? 'bg-red-500/10 border-red-400/40' : 'border-white/5 bg-lofi-base/40'
  return (
    <li {...rest} className={`flex items-center gap-2 rounded-xl p-1.5 pr-2 border ${stack ? 'max-sm:flex-wrap' : ''} ${look} ${className}`}>
      {lead}
      <span ref={img} className="block w-12 h-7 sm:w-16 sm:h-9 rounded-md overflow-hidden shrink-0 bg-lofi-surface">
        {art && <FadeImg src={art} lazy className="w-full h-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <SongTitle text={fullTitle(s)} />
        {sub && <span className="block text-[10px] text-lofi-muted truncate">{sub}</span>}
      </span>
      {children && <span className={`flex items-center gap-1 shrink-0 ${stack ? 'max-sm:basis-full max-sm:justify-end' : ''}`}>{children}</span>}
    </li>
  )
}
const SmallBtn = ({ label, icon, onClick, busy, done, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled || busy || done}
    aria-label={label}
    title={label}
    className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs transition-colors disabled:opacity-40 ${done ? 'text-lofi-primary' : 'text-lofi-muted hover:text-white hover:bg-white/5'}`}
  >
    <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : done ? 'fa-check' : icon}`} aria-hidden="true" />
  </button>
)
// a small pill with an icon and a word (the word hides on phones when `short`). It keeps its size whatever it shows:
// the icon has a fixed width (a spinner, a speaker or a ✓ is as wide as ▶), and the word doesn't change
function Pill({ label, text, icon, onClick, busy, disabled, primary, short, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={label}
      title={label}
      className={`h-7 shrink-0 rounded-full flex items-center justify-center gap-1.5 text-[11px] font-mono border transition-colors disabled:opacity-40 ${short ? 'max-sm:w-7 sm:px-2.5' : 'px-2.5'} ${primary ? 'bg-lofi-primary text-lofi-base border-lofi-primary font-bold hover:bg-lofi-highlight' : 'border-white/10 text-lofi-text hover:text-white hover:border-white/30'} ${className}`}
    >
      <i className={`fa-solid fa-fw ${busy ? 'fa-spinner fa-spin' : icon} text-[10px]`} aria-hidden="true" />
      <span className={short ? 'max-sm:hidden' : ''}>{text}</span>
    </button>
  )
}
const ago = (iso) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

// Play now / Play next / Add for a YouTube song (a search result, a recent one). One already queued is played /
// moved from its place instead of added twice.
function PlaceBtns({ s, p, ops, short }) {
  const url = songLink(s)
  // the same song: by its Spotify track when it has no video (a Spotify search result, a Spotify-only song), else by video
  const same = (x) => Boolean(x) && ((Boolean(s.youtubeId) && x.youtubeId === s.youtubeId) || (Boolean(s.spotifyUri) && x.spotifyUri === s.spotifyUri))
  const queued = (p.queue?.items ?? []).find(same)
  const current = same(p.state?.song) && p.state?.status !== 'idle'
  const t = plain(s.title)
  const lock = ops.busy != null
  return (
    <>
      <Pill short={short} primary text="Now" icon={current ? 'fa-volume-high' : 'fa-play'} label={current ? `Playing now: ${t}` : `Play now: ${t}`} disabled={lock || current} busy={ops.busy === (queued ? `now:${queued.id}` : `add:${url}:now`)} onClick={() => (queued ? ops.playNow(queued) : ops.add(url, 'now', s.title))} />
      <Pill short={short} text="Next" icon="fa-angles-up" label={`Play next: ${t}`} disabled={lock || current || (queued && p.queue.items[0]?.id === queued.id)} busy={ops.busy === (queued ? `next:${queued.id}` : `add:${url}:next`)} onClick={() => (queued ? ops.playNext(queued) : ops.add(url, 'next', s.title))} />
      <Pill short={short} text="Add" icon={queued ? 'fa-check' : 'fa-plus'} label={queued ? `In the queue: ${t}` : `Add to the end: ${t}`} disabled={lock || Boolean(queued)} busy={ops.busy === `add:${url}:end`} onClick={() => ops.add(url, 'end', s.title)} />
    </>
  )
}

// (one view since the one input: words, a song link or a playlist link all go in the same box)
const ADD_VIEWS = [['search', 'Search or paste', 'fa-magnifying-glass']]

// The sheet keeps the page still: only its lists ([data-scroll]) scroll. The modal <dialog> makes the page inert, but a
// wheel or a swipe over the header, the chips, the backdrop, or past a list's end would still scroll the page (iOS
// above all): while it's open those are cancelled here, with overscroll-behavior: contain on the lists as the first
// line (and touch-action in globals.css .tv-sheet).
function canScroll(from, stop, dy) {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    const o = getComputedStyle(el).overflowY
    if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 1 && (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true
  }
  return false
}
function useStillPage(dlg, open) {
  useEffect(() => {
    const d = dlg.current
    if (!d || !open) return
    let x0 = 0
    let y0 = 0
    // (on the window while the sheet is open: a wheel over the backdrop doesn't reach the dialog)
    const wheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // pinch zoom, sideways (the chips)
      if (!(d.contains(e.target) && canScroll(e.target, d, e.deltaY))) e.preventDefault()
    }
    const start = (e) => ((x0 = e.touches[0]?.clientX ?? 0), (y0 = e.touches[0]?.clientY ?? 0))
    const move = (e) => {
      if (e.touches.length !== 1 || !e.cancelable) return
      const dx = x0 - e.touches[0].clientX
      const dy = y0 - e.touches[0].clientY
      if (Math.abs(dx) > Math.abs(dy)) return
      if (!(d.contains(e.target) && canScroll(e.target, d, dy))) e.preventDefault()
    }
    const opts = { capture: true, passive: false }
    addEventListener('wheel', wheel, opts)
    addEventListener('touchstart', start, { capture: true, passive: true })
    addEventListener('touchmove', move, opts)
    return () => {
      removeEventListener('wheel', wheel, opts)
      removeEventListener('touchstart', start, { capture: true })
      removeEventListener('touchmove', move, opts)
    }
  }, [dlg, open])
}

// Queue, recent, and for the owner Add (Search or link · Import playlist), Playlists and the Tavarian link. The same
// <dialog> as Settings (.wx-sheet: a bottom sheet on phones, centered from sm; the same way in and out): ✕, Esc or a
// tap on the backdrop closes it, animated (closeDialog). Its content exists only while a view is open.
export function PlayerSheet({ dlg, p, owner, ops, picks = [], view, setView, onClosed }) {
  const [seed, setSeed] = useState('') // text handed from one Add tab to another
  const press = useRef(false) // the press began on the backdrop (a drag that ends there is not a tap on it)
  useStillPage(dlg, Boolean(view))
  const items = p.queue?.items ?? []
  const recent = p.queue?.recent ?? []
  const adding = ADD_VIEWS.some(([id]) => id === view)
  const go = (v, text = '') => (setSeed(text), setView(v))
  const close = () => closeDialog(dlg.current)
  const views = [
    ['queue', `Queue · ${items.length}`],
    ['recent', 'Recent'],
    ...(owner ? [['search', '＋ Add'], ['playlists', 'Playlists']] : []),
  ]
  const chip = ([id, label]) => {
    const on = view === id || (id === 'search' && adding)
    return (
      <button key={id} onClick={() => go(id)} aria-pressed={on} className={`shrink-0 h-7 px-2.5 rounded-full text-[11px] border transition-colors ${on ? 'bg-lofi-primary text-lofi-base border-lofi-primary font-bold' : 'border-white/10 text-lofi-muted hover:text-white'}`}>
        {label}
      </button>
    )
  }
  const line = owner ? opsLine(ops) : null
  return (
    <dialog
      ref={dlg}
      aria-label={adding ? 'Add songs to the home station' : 'Home station'}
      onPointerDown={(e) => (press.current = e.target === dlg.current)}
      onClick={(e) => e.target === dlg.current && press.current && close()}
      onCancel={(e) => {
        e.preventDefault() // Esc: animate out first
        close()
      }}
      onClose={() => {
        delete dlg.current.dataset.closing
        onClosed()
      }}
      className="wx-sheet tv-sheet sm:max-w-xl glass-panel text-lofi-text"
    >
      {view && (
        <div className="h-full flex flex-col min-h-0 p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between mb-2 px-1 shrink-0">
            <h2 className="text-sm font-medium text-white flex items-center gap-2">
              <i className="fa-solid fa-music text-lofi-primary text-xs" aria-hidden="true" /> Home station <span className="font-mono text-[11px] text-lofi-muted">Tavarian</span>
            </h2>
            <button data-close onClick={close} aria-label="Close" className="w-8 h-8 rounded-full bg-lofi-base/60 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
              <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto overscroll-contain touch-pan-x scrollbar-none mb-3 shrink-0">{views.map(chip)}</div>
          {owner && adding && ADD_VIEWS.length > 1 && (
            // one column per Add tab, so they always fill the bar (no bar while there's only the one input)
            <div role="tablist" aria-label="Add songs" className="grid gap-1 p-1 mb-3 shrink-0 rounded-2xl bg-lofi-base/50 border border-white/5" style={{ gridTemplateColumns: `repeat(${ADD_VIEWS.length}, minmax(0, 1fr))` }}>
              {ADD_VIEWS.map(([id, label, icon, wide]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => go(id)}
                  className={`h-9 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors ${view === id ? 'bg-lofi-surface text-white font-medium shadow' : 'text-lofi-muted hover:text-white'}`}
                >
                  <i className={`fa-solid ${icon} text-[11px] ${view === id ? 'text-lofi-primary' : ''}`} aria-hidden="true" />
                  {wide ? (
                    <>
                      <span className="sm:hidden">{label}</span>
                      <span className="max-sm:hidden">{wide}</span>
                    </>
                  ) : (
                    label
                  )}
                </button>
              ))}
            </div>
          )}
          <div key={view} data-scroll className="min-h-0 grow overflow-y-auto overscroll-contain touch-pan-y -mr-1 pr-1">
            {view === 'queue' && <QueueView p={p} owner={owner} ops={ops} picks={picks} onAdd={() => go('search')} />}
            {view === 'recent' && <RecentView p={p} owner={owner} ops={ops} />}
            {owner && view === 'search' && <SearchView p={p} ops={ops} seed={seed} />}
            {owner && view === 'playlists' && <PlaylistsView ops={ops} />}
          </div>
          {owner && <OpsLine wrap line={line} ops={ops} className={`shrink-0 min-h-4 mt-2 text-[11px] font-mono ${line?.err ? '' : 'text-lofi-primary'}`} />}
          {owner && (
            <div className="shrink-0 mt-1 pt-2 border-t border-white/5 space-y-1.5">
              <LinkRow p={p} />
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}

function SongList({ empty, children }) {
  const has = Array.isArray(children) ? children.some(Boolean) && children.length > 0 : Boolean(children)
  return has ? <ul className="space-y-1.5">{children}</ul> : <p className="text-xs text-lofi-muted text-center py-8">{empty}</p>
}
const H3 = ({ children, className = '', ...rest }) => (
  <h3 {...rest} className={`text-[10px] font-mono uppercase tracking-widest text-lofi-muted mb-1.5 px-1 ${className}`}>
    {children}
  </h3>
)

// Recently played (newest first): a song that ends slides in at the top, the others glide down
function RecentView({ p, owner, ops }) {
  const recent = p.queue?.recent ?? []
  const scope = useRef(null)
  useFlip(scope, flipSig(recent.map((s) => s.id)))
  return (
    <div ref={scope} className="relative">
      <SongList empty="Nothing played yet">
        {recent.map((s) => (
          <SongRow key={s.id} data-flip-key={s.id} s={s} sub={[s.durationSeconds > 0 && mmss(s.durationSeconds), s.status === 'failed' ? `couldn't play${s.failReason ? `: ${reasonText(s.failReason)}` : ''}` : s.playedAt && ago(s.playedAt)].filter(Boolean).join(' · ')}>
            {owner && songLink(s) && <PlaceBtns s={s} p={p} ops={ops} short />}
          </SongRow>
        ))}
      </SongList>
    </div>
  )
}

// The queue. The owner can also pick songs (Select: a box on each row, tap the row or the box; Select all / None and
// the count, with Remove selected (N) in a bar that stays at the bottom) and Clear queue (asks first, like Settings ›
// Reset all; the song playing keeps playing). Now and Up next glide when they change (one useFlip scope for both: the
// song that starts playing glides from its row up to the Now slot); not while a row is dragged or held. During
// Spotify autoplay the owner also sees Spotify's next picks after them (read-only: Spotify decides those)
function QueueView({ p, owner, ops, picks = [], onAdd }) {
  const items = p.queue?.items ?? []
  const ids = items.map((s) => s.id)
  const song = p.state?.song
  const lock = ops.busy != null
  const [sel, setSel] = useState(null) // a Set of ids while picking, else null
  const [asking, setAsking] = useState(false) // Clear queue's question
  const clearBtn = useRef(null)
  const asked = useRef(false)
  useEffect(() => {
    if (asking) asked.current = true
    else if (asked.current) (asked.current = false), clearBtn.current?.focus({ preventScroll: true }) // focus back where it was
  }, [asking])
  const picked = pickedIds(sel, ids)
  const all = allPicked(sel, ids)
  const picking = owner && sel != null
  const dnd = useDragReorder({ ids, disabled: !owner || lock || picking, onDrop: (order, id, to) => ops.reorder(order, items.find((s) => s.id === id), to) })
  const d = dnd.drag
  const showLine = d && d.gap !== d.from && d.gap !== d.from + 1
  const scope = useRef(null)
  useFlip(scope, flipSig([song?.id, ...ids]), { paused: Boolean(d) || dnd.pressing != null })
  useEffect(() => {
    if (picking && !items.length) setSel(null) // nothing left to pick
  }, [picking, items.length])
  const removePicked = async () => {
    const songs = items.filter((s) => sel?.has(s.id))
    if (songs.length && (await ops.removeMany(songs))) setSel(null)
  }
  const toolBtn = 'h-6 px-2 shrink-0 whitespace-nowrap rounded-full border text-[10px] font-mono normal-case tracking-normal flex items-center gap-1 transition-colors disabled:opacity-40'
  return (
    <div ref={scope} className="relative">
      {owner && (
        <button onClick={onAdd} className="w-full h-11 mb-3 rounded-2xl border border-dashed border-lofi-primary/50 bg-lofi-primary/10 text-lofi-primary text-sm font-bold flex items-center justify-center gap-2 hover:bg-lofi-primary/20 transition-colors">
          <i className="fa-solid fa-plus" aria-hidden="true" /> Add songs <span className="font-normal text-xs text-lofi-muted max-sm:hidden">search · paste a link · import a playlist</span>
        </button>
      )}
      {song && (
        <>
          <H3 data-flip-key="~now">Now</H3>
          <ul className="mb-3">
            <SongRow key={song.id} data-flip-key={song.id} s={song} on sub={[statusInfo({ state: p.state }).label, song.durationSeconds > 0 && mmss(song.durationSeconds), autoplayText(p.state?.autoplay)].filter(Boolean).join(' · ')} />
          </ul>
        </>
      )}
      {asking ? (
        <ClearQuestion n={items.length} playing={Boolean(song)} onCancel={() => setAsking(false)} onClear={() => (setAsking(false), ops.clear())} />
      ) : (
        <H3 data-flip-key="~next" className="flex items-center gap-2 min-h-6">
          <span className="shrink-0">Up next</span>
          <span className="grow min-w-0 truncate text-right normal-case tracking-normal text-[10px]">
            {owner && !picking && items.length > 1 && (
              <>
                <span className="max-sm:hidden">drag ⋮⋮ to reorder</span>
                <span className="sm:hidden">hold ⋮⋮ to drag</span>
              </>
            )}
          </span>
          {owner && items.length > 0 && (
            <>
              <button onClick={() => setSel(picking ? null : new Set())} aria-pressed={picking} disabled={!picking && lock} className={`${toolBtn} ${picking ? 'bg-lofi-primary text-lofi-base border-lofi-primary font-bold' : 'border-white/10 text-lofi-text hover:text-white hover:border-white/30'}`}>
                <i className={`fa-solid ${picking ? 'fa-check' : 'fa-list-check'} text-[9px]`} aria-hidden="true" /> {picking ? 'Done' : 'Select'}
              </button>
              {!picking && (
                <button ref={clearBtn} onClick={() => setAsking(true)} disabled={lock} aria-label="Clear queue" className={`${toolBtn} border-white/10 text-lofi-muted hover:text-red-300 hover:border-red-400/60`}>
                  <i className="fa-solid fa-trash-can text-[9px]" aria-hidden="true" /> Clear<span className="max-sm:hidden"> queue</span>
                </button>
              )}
            </>
          )}
        </H3>
      )}
      {items.length ? (
        <ol ref={dnd.list} className="relative space-y-1.5" aria-label={picking ? 'Up next: pick songs' : 'Up next'}>
          {items.map((s, i) => {
            const moving = d?.id === s.id
            const t = plain(s.title)
            const on = picking && sel.has(s.id)
            return (
              <SongRow
                key={s.id}
                s={s}
                data-row={i}
                data-flip-key={s.id}
                sub={`${i + 1}${s.durationSeconds > 0 ? ` · ${mmss(s.durationSeconds)}` : ''}`}
                lifted={moving}
                picked={on}
                onClick={picking ? () => setSel((x) => toggleIn(x, s.id)) : undefined}
                className={`${dnd.pressing === s.id ? 'ring-1 ring-lofi-primary/50' : ''} ${picking ? 'cursor-pointer select-none' : ''}`}
                style={moving ? { transform: `translateY(${d.dy}px) scale(1.02)` } : undefined}
                lead={
                  picking ? (
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setSel((x) => toggleIn(x, s.id))}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${t}`}
                      className="w-4 h-4 mx-1 shrink-0 accent-lofi-primary cursor-pointer"
                    />
                  ) : (
                    owner && (
                      <button
                        type="button"
                        onPointerDown={(e) => dnd.start(e, i)}
                        onKeyDown={(e) => dnd.key(e, i)}
                        onContextMenu={(e) => e.preventDefault()}
                        // while an action is in flight: aria-disabled, not disabled (the handle ↓ just moved keeps
                        // the keyboard focus; the drag hook ignores it meanwhile)
                        disabled={items.length < 2}
                        aria-disabled={lock || undefined}
                        aria-label={`Move ${t}: drag, or press up / down`}
                        title="Drag to reorder (on a phone: hold, then drag)"
                        className={`w-6 h-9 -ml-0.5 shrink-0 rounded-lg flex items-center justify-center text-lofi-muted hover:text-white disabled:opacity-30 aria-disabled:opacity-30 select-none [-webkit-touch-callout:none] ${moving ? 'cursor-grabbing text-lofi-primary' : 'cursor-grab'} ${dnd.pressing === s.id ? 'bg-lofi-primary/20 text-lofi-primary' : ''}`}
                      >
                        <i className="fa-solid fa-grip-vertical text-xs" aria-hidden="true" />
                      </button>
                    )
                  )
                }
              >
                {owner && !picking && (
                  <>
                    <Pill short primary text="Now" icon="fa-play" label={`Play now: ${t}`} onClick={() => ops.playNow(s)} busy={ops.busy === `now:${s.id}`} disabled={lock} />
                    <Pill short text="Next" icon="fa-angles-up" label={`Play next: ${t}`} onClick={() => ops.playNext(s)} busy={ops.busy === `next:${s.id}`} disabled={lock || i === 0} />
                    <SmallBtn label={`Remove: ${t}`} icon="fa-xmark" onClick={() => ops.remove(s)} busy={ops.busy === `remove:${s.id}`} disabled={lock} />
                  </>
                )}
              </SongRow>
            )
          })}
          {showLine && (
            <li aria-hidden="true" className="absolute z-20 left-0 right-0 h-0.5 -mt-px rounded-full bg-lofi-primary shadow-[0_0_8px_var(--color-lofi-primary)] pointer-events-none" style={{ top: d.top }}>
              <span className="absolute -left-0.5 -top-[3px] w-2 h-2 rounded-full bg-lofi-primary" />
            </li>
          )}
        </ol>
      ) : (
        <p data-flip-key="~empty" className="text-xs text-lofi-muted text-center py-6">{song && p.state?.autoplay ? 'The queue is empty: Spotify autoplay picks the next song.' : 'The queue is empty.'}</p>
      )}
      {song && p.state?.autoplay && picks.length > 0 && !picking && (
        <section aria-label="Spotify picks" className="mt-3">
          <H3 className="flex items-center gap-1.5">
            <i className="fa-brands fa-spotify text-[#1db954]/80" aria-hidden="true" /> Spotify picks
          </H3>
          <ul className="space-y-1.5">
            {picks.map((s) => (
              <SongRow key={s.id} s={s} sub={[s.artists.join(', '), s.durationSeconds > 0 && mmss(s.durationSeconds)].filter(Boolean).join(' · ')} className="opacity-80" />
            ))}
          </ul>
        </section>
      )}
      {picking && items.length > 0 && (
        // stays at the bottom of the list while it scrolls
        <div className="sticky bottom-0 z-30 mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-lofi-base px-2.5 py-2 shadow-[0_-8px_24px_rgb(0_0_0/0.35)]">
          <button onClick={() => setSel(new Set(ids))} disabled={all} className={`${toolBtn} h-7 border-white/10 text-lofi-text hover:text-white hover:border-white/30`}>
            Select all
          </button>
          <button onClick={() => setSel(new Set())} disabled={!picked.length} className={`${toolBtn} h-7 border-white/10 text-lofi-text hover:text-white hover:border-white/30`}>
            None
          </button>
          <span className="text-[10px] font-mono text-lofi-muted tabular-nums" role="status">
            {pickedText(picked.length, items.length)}
          </span>
          <button
            onClick={removePicked}
            disabled={!picked.length || lock}
            className="ml-auto h-8 px-3 rounded-full bg-red-500/85 text-white font-mono text-[11px] font-bold hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-500/85 transition-colors flex items-center gap-1.5"
          >
            <i className={`fa-solid ${ops.busy === 'remove-bulk' ? 'fa-spinner fa-spin' : 'fa-trash-can'} text-[10px]`} aria-hidden="true" /> Remove selected ({picked.length})
          </button>
        </div>
      )}
    </div>
  )
}

// Clear queue's question, like Settings › Reset all: Cancel is focused, "Yes, clear" wakes after a moment (so a
// double tap can't confirm), the question gives up after 8 s. Esc backs out of it, not the sheet. Only Up next goes:
// the song playing keeps playing. No Undo after: this is the guard
function ClearQuestion({ n, playing, onCancel, onClear }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const a = setTimeout(() => setArmed(true), 800)
    return () => clearTimeout(a)
  }, [])
  useEffect(() => {
    const t = setTimeout(onCancel, 8000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div
      role="alertdialog"
      aria-labelledby="tv-clear-q"
      onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), onCancel())}
      className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2.5 motion-safe:animate-[panel-in_0.2s_ease-out]"
    >
      <p id="tv-clear-q" className="text-[11px] text-red-200 flex items-center gap-2 min-w-0">
        <i className="fa-solid fa-triangle-exclamation text-red-400" aria-hidden="true" />
        <span>
          Clear Up next ({n} song{n === 1 ? '' : 's'})?{' '}
          <span className="text-red-200/70">For everyone, and it can't be undone.{playing && ' The song playing now keeps playing.'}</span>
        </span>
      </p>
      <div className="flex gap-2 shrink-0 ml-auto">
        <button autoFocus onClick={onCancel} className="h-8 px-3 rounded-full border border-white/15 font-mono text-[11px] text-lofi-text hover:text-white hover:border-white/30 transition-colors">
          Cancel
        </button>
        {/* aria-disabled, not disabled: a click on a disabled button would go to the dialog behind it */}
        <button
          aria-disabled={!armed}
          onClick={() => armed && onClear()}
          className="h-8 px-3 rounded-full bg-red-500/85 text-white font-mono text-[11px] font-bold hover:bg-red-500 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-red-500/85 transition-[background-color,opacity] duration-300 flex items-center gap-1.5"
        >
          <i className="fa-solid fa-trash-can" aria-hidden="true" /> Yes, clear
        </button>
      </div>
    </div>
  )
}

// ---- Add: Search ----
// The Add sheet's one input: type anything — words, a song link (YouTube or Spotify), a playlist or album link — and
// Tavarian works out what it is (GET /home/resolve): a search (Spotify while the station plays from Spotify, else
// YouTube; the switch picks), one song (a YouTube link in Spotify mode shows its Spotify match), or a list with Add all.
// Nothing is added until a button says so.
function SearchView({ p, ops, seed }) {
  const [text, setText] = useState(seed)
  const [res, setRes] = useState(null) // what Tavarian made of the text
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [want, setWant] = useState(null) // 'youtube' | 'spotify' picked here for searches, else null (the station's)
  const input = useRef(null)
  const q = text.trim()
  // a link (as Tavarian sees one: a YouTube / Spotify link, or text starting with http(s):// or www.) shows no
  // YouTube | Spotify switch; a pasted one (the text jumped) is read at once, anything else after a pause, so holding
  // backspace on a link doesn't send a request per keystroke (and the one in flight is cancelled)
  const linky = ['video', 'playlist', 'spotify', 'mix'].includes(classifyLink(q).kind) || /^(https?:\/\/|www\.)/i.test(q)
  const last = useRef(q)
  const jumped = Math.abs(q.length - last.current.length) > 1
  useEffect(() => input.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    last.current = q
    if (q.length < 2) return setRes(null), setErr(null), setBusy(false)
    const stop = new AbortController()
    setBusy(true)
    const t = setTimeout(async () => {
      let r = await tavarianPost({ action: 'resolve', q, ...(want && { source: want }) }, { signal: stop.signal })
      // a Tavarian that doesn't know resolve yet: words still search
      if (!r.ok && r.code === 'http_404' && !linky) r = await tavarianPost({ action: 'search', q, ...(want && { source: want }) }, { signal: stop.signal }).then((x) => (x.ok ? { ok: true, data: { resolved: { kind: 'search', source: x.data.source ?? 'youtube', items: x.data.results ?? [] } } } : x))
      if (stop.signal.aborted) return
      setBusy(false)
      if (r.ok && r.data.resolved) setRes(r.data.resolved), setErr(null)
      else setRes(null), setErr(r.ok ? "Tavarian sent an answer this page doesn't understand" : r.error)
    }, jumped && linky ? 0 : linky ? 300 : 450)
    return () => (stop.abort(), clearTimeout(t))
  }, [q, want, linky])
  const from = res?.kind === 'search' ? res.source : (want ?? res?.backend ?? null)
  const switchable = q.length >= 2 && !linky && res?.kind !== 'track' && res?.kind !== 'list'
  return (
    <>
      <form onSubmit={(e) => e.preventDefault()} className="mb-3">
        <TextBox inputRef={input} value={text} onChange={setText} icon="fa-magnifying-glass" label="Search, or paste a YouTube or Spotify link" placeholder="Search, or paste any link" paste />
      </form>
      {switchable && (
        <div role="radiogroup" aria-label="Search on" className="mb-3 flex items-center gap-1.5 text-[11px] font-mono">
          {[['youtube', 'YouTube', 'fa-youtube'], ['spotify', 'Spotify', 'fa-spotify']].map(([id, name, icon]) => (
            <button
              key={id}
              role="radio"
              aria-checked={from === id}
              onClick={() => setWant(id)}
              className={`h-7 px-2.5 rounded-full border flex items-center gap-1.5 transition-colors ${from === id ? (id === 'spotify' ? 'bg-[#1db954] text-black border-[#1db954] font-bold' : 'bg-lofi-primary text-lofi-base border-lofi-primary font-bold') : 'border-white/10 text-lofi-muted hover:text-white'}`}
            >
              <i className={`fa-brands ${icon}`} aria-hidden="true" /> {name}
            </button>
          ))}
        </div>
      )}
      {busy ? (
        <p className="text-xs text-lofi-muted text-center py-4">
          <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" /> {linky ? 'Reading the link…' : 'Searching…'}
        </p>
      ) : err ? (
        <Hint err>{err}</Hint>
      ) : res?.kind === 'list' ? (
        <ResolvedList res={res} p={p} ops={ops} />
      ) : res?.kind === 'track' ? (
        <ResolvedTrack res={res} p={p} ops={ops} />
      ) : res ? (
        <SongList empty="Nothing found">
          {res.items.map((s) => (
            <SongRow key={s.url ?? s.youtubeId} s={s} stack sub={resultSub(s)}>
              <PlaceBtns s={s} p={p} ops={ops} />
            </SongRow>
          ))}
        </SongList>
      ) : (
        <Hint>Type a song or an artist, or paste a link: a YouTube video or playlist, a Spotify track, album or playlist.</Hint>
      )}
    </>
  )
}
const resultSub = (s) => [s.source === 'spotify' ? s.artist : s.channel, s.source === 'spotify' ? s.album : null, s.durationSeconds > 0 ? mmss(s.durationSeconds) : s.youtubeId ? 'live' : null].filter(Boolean).join(' · ')

// one song from a link: its row with Now / Next / Add; in Spotify mode a YouTube link shows its Spotify match (with
// "the YouTube video instead"), or says it has none (it would be skipped while the station plays from Spotify)
function ResolvedTrack({ res, p, ops }) {
  const s = res.items[0]
  if (!s) return <Hint err>Nothing found for that link.</Hint>
  const matched = res.match?.confidence != null && res.match.fromUrl
  return (
    <div className="space-y-2">
      <SongList empty="">
        <SongRow s={s} stack sub={resultSub(s)}>
          <PlaceBtns s={s} p={p} ops={ops} />
        </SongRow>
      </SongList>
      {matched && (
        <p className="text-[11px] text-lofi-muted px-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            <i className="fa-brands fa-spotify text-[#1db954] mr-1" aria-hidden="true" />
            Found on Spotify ({Math.round(res.match.confidence * 100)}% sure)
          </span>
          <button onClick={() => ops.add(res.match.fromUrl, 'end')} disabled={ops.busy != null} className="text-lofi-primary underline underline-offset-2 hover:text-white disabled:opacity-50">
            add the YouTube video instead
          </button>
        </p>
      )}
      {res.note === 'no_spotify_match' && <Hint>No sure match on Spotify: added, it would be skipped while the station plays from Spotify.</Hint>}
      {(res.note === 'spotify_search_off' || res.note === 'spotify_search_unavailable') && <Hint>{reasonText(res.note)}: shown as the YouTube video.</Hint>}
    </div>
  )
}

const ADD_ALL_MAX = 100 // songs an import adds at most (Tavarian's HOME_IMPORT_MAX)
// a playlist or album from a link: its name, Add all (now / next / end, the import), and every song with its buttons
function ResolvedList({ res, p, ops }) {
  const name = res.title ?? (res.source === 'spotify' ? `Spotify ${res.listType ?? 'playlist'}` : 'YouTube playlist')
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        {res.thumbnail && <img src={res.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover bg-lofi-surface shrink-0" />}
        <span className="min-w-0">
          <span className="block text-sm text-white font-medium truncate">{plain(name)}</span>
          <span className="block text-[11px] text-lofi-muted truncate">
            {[res.subtitle, res.total != null ? `${res.total} song${res.total === 1 ? '' : 's'}` : null, res.truncated ? `the first ${ADD_ALL_MAX} can be added` : null].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>
      {res.importUrl && <ImportBox url={res.importUrl} what={`Add all${res.total ? ` (${Math.min(res.total, ADD_ALL_MAX)})` : ''}`} ops={ops} />}
      {res.videoUrl && (
        <p className="text-[11px] text-lofi-muted px-1">
          The link points at one song in this playlist too:{' '}
          <button onClick={() => ops.add(res.videoUrl, 'end')} disabled={ops.busy != null} className="text-lofi-primary underline underline-offset-2 hover:text-white disabled:opacity-50">
            add just that song
          </button>
        </p>
      )}
      <SongList empty="This list is empty">
        {res.items.map((s, i) => (
          <SongRow key={(s.url ?? s.youtubeId ?? '') + i} s={s} stack sub={resultSub(s)}>
            <PlaceBtns s={s} p={p} ops={ops} short />
          </SongRow>
        ))}
      </SongList>
    </div>
  )
}

function TextBox({ inputRef, value, onChange, icon, label, placeholder, paste }) {
  const canPaste = paste && typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText)
  return (
    <div className="flex items-center gap-2">
      <label className="relative grow min-w-0">
        <span className="sr-only">{label}</span>
        <i className={`fa-solid ${icon} absolute left-3 top-1/2 -translate-y-1/2 text-xs text-lofi-muted`} aria-hidden="true" />
        <input
          ref={inputRef}
          data-autofocus // (the sheet focuses it when it opens on this view)
          type={paste ? 'url' : 'search'}
          inputMode={paste ? 'url' : 'search'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={500}
          autoComplete="off"
          className="w-full h-11 pl-8 pr-3 rounded-full bg-lofi-base/60 border border-white/10 text-sm text-white placeholder:text-lofi-muted focus:outline-none focus:border-lofi-primary/60"
        />
      </label>
      {canPaste && (
        <button
          type="button"
          onClick={() =>
            navigator.clipboard.readText().then(
              (t) => onChange(t.trim().slice(0, 500)),
              () => inputRef.current?.focus(),
            )
          }
          className="h-11 px-4 shrink-0 rounded-full border border-white/10 text-xs text-lofi-text hover:text-white hover:border-white/30 flex items-center gap-1.5"
        >
          <i className="fa-solid fa-paste" aria-hidden="true" /> Paste
        </button>
      )}
    </div>
  )
}

const Hint = ({ err, children }) => <p className={`text-xs text-center py-4 px-2 text-balance ${err ? 'text-red-300' : 'text-lofi-muted'}`}>{children}</p>

function ImportBox({ url, what, ops }) {
  const run = ops.importing
  const mine = run?.url === url
  const res = ops.imported?.url === url ? ops.imported : null
  const [, tick] = useState(0)
  useEffect(() => {
    if (!mine) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [mine])
  return (
    <div className="space-y-3">
      <p className="text-xs text-lofi-muted px-1 flex items-center gap-1.5 min-w-0">
        <i className={`${/spotify/i.test(url) ? 'fa-brands fa-spotify text-[#1db954]' : 'fa-brands fa-youtube text-red-400'}`} aria-hidden="true" />
        <span className="text-white whitespace-nowrap">{what}</span>
        <span className="truncate font-mono text-[10px]">{url.replace(/^https:\/\/(www\.|open\.)?/, '')}</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        {['end', 'next', 'now'].map((pl) => (
          <button
            key={pl}
            onClick={() => ops.importList(url, pl)}
            disabled={Boolean(run)}
            className={`h-12 rounded-2xl text-xs flex flex-col items-center justify-center gap-0.5 border transition-colors disabled:opacity-50 ${pl === 'end' ? 'bg-lofi-primary text-lofi-base border-lofi-primary font-bold hover:bg-lofi-highlight' : 'border-white/10 text-lofi-text hover:text-white hover:border-white/30'}`}
          >
            <i className={`fa-solid ${mine && run.placement === pl ? 'fa-spinner fa-spin' : placementIcon(pl)}`} aria-hidden="true" />
            {placementLabel(pl)}
          </button>
        ))}
      </div>
      {mine && (
        <div className="rounded-2xl border border-lofi-primary/30 bg-lofi-primary/10 p-3 text-xs text-center" role="status">
          <p className="text-white font-medium">
            <i className="fa-solid fa-spinner fa-spin mr-1.5 text-lofi-primary" aria-hidden="true" /> Importing… this can take a while
          </p>
          <p className="text-lofi-muted mt-1 font-mono text-[10px]">{Math.round((Date.now() - run.since) / 1000)} s · you can close this: the result shows under the player too</p>
        </div>
      )}
      {run && !mine && <Hint>Another import is running: wait for it to finish.</Hint>}
      {res && <ImportResult res={res} />}
    </div>
  )
}
function ImportResult({ res }) {
  if (res.error)
    return (
      <p className="rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200 text-center" role="status">
        {res.error}
      </p>
    )
  const s = res.summary
  const src = res.data?.source
  const name = (typeof src === 'object' && (src?.title ?? src?.name)) || sourceLabel(src)
  const skipped = res.data?.skipped ?? []
  return (
    <div className={`rounded-2xl border p-3 text-xs space-y-1.5 ${s.added ? 'border-lofi-primary/30 bg-lofi-base/40' : 'border-red-400/30 bg-red-500/10'}`} role="status">
      <p className="text-white font-medium flex items-center gap-1.5">
        <i className={`fa-solid ${s.added ? 'fa-check text-lofi-primary' : 'fa-circle-exclamation text-red-400'}`} aria-hidden="true" />
        {s.added ? `${s.added} song${s.added === 1 ? '' : 's'} added` : 'Nothing added'}
        {name && <span className="text-lofi-muted font-normal truncate">· {plain(name)}</span>}
      </p>
      {s.found != null && <p className="text-lofi-muted">{s.found} found</p>}
      {s.skipped > 0 && (
        <details className="text-lofi-muted">
          <summary className="cursor-pointer hover:text-white">
            {s.skipped} skipped: {s.groups.map((g) => `${g.n} ${g.text}`).join(', ')}
          </summary>
          <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto pl-4 list-disc">
            {skipped.map((x, i) => (
              <li key={i} className="truncate">
                {plain(x.title) || x.youtubeId || 'Unknown song'} — {reasonText(x.reason)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.cut && <p className="text-lofi-highlight">{s.cut[0].toUpperCase() + s.cut.slice(1)}</p>}
    </div>
  )
}

function PlaylistsView({ ops }) {
  const [lists, setLists] = useState(undefined) // undefined = loading, null = failed
  const [open, setOpen] = useState(null) // { list, songs }
  const [all, setAll] = useState(null) // busy | done
  useEffect(() => {
    let alive = true
    tavarianPost({ action: 'playlists' }).then((r) => {
      if (!alive) return
      if (r.ok) setLists(r.data.playlists ?? [])
      else setLists(null), ops.say(r.error, true)
    })
    return () => (alive = false)
  }, [])
  async function show(list) {
    setOpen({ list, songs: undefined })
    setAll(null)
    const r = await tavarianPost({ action: 'playlist-songs', id: list.id })
    setOpen((o) => (o?.list.id === list.id ? { list, songs: r.ok ? (r.data.songs ?? []) : null } : o))
    if (!r.ok) ops.say(r.error, true)
  }
  async function queue(ids) {
    const r = await tavarianPost({ action: 'from-playlist', playlistId: open.list.id, ...(ids && { youtubeIds: ids }) })
    if (!r.ok) return ops.say(r.error, true), false
    const s = importSummary(r.data)
    ops.say(s.text, !s.added && s.skipped > 0)
    return s.added > 0
  }
  if (open)
    return (
      <>
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setOpen(null)} className="h-8 px-3 rounded-full border border-white/10 text-xs text-lofi-muted hover:text-white flex items-center gap-1.5">
            <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true" /> Playlists
          </button>
          <p className="grow min-w-0 text-sm text-white truncate">{open.list.name}</p>
          <button
            onClick={async () => (setAll('busy'), setAll((await queue()) ? 'done' : null))}
            disabled={!open.songs?.length || all != null}
            className="h-8 px-3 shrink-0 rounded-full bg-lofi-primary text-lofi-base text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <i className={`fa-solid ${all === 'busy' ? 'fa-spinner fa-spin' : all === 'done' ? 'fa-check' : 'fa-list-check'}`} aria-hidden="true" /> Queue all
          </button>
        </div>
        {open.songs === undefined ? (
          <p className="text-xs text-lofi-muted text-center py-6">
            <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" /> Loading…
          </p>
        ) : (
          <SongList empty={open.songs === null ? "Couldn't load it" : 'No songs in this playlist'}>
            {(open.songs ?? []).map((s) => (
              <SongRow key={s.youtubeId} s={s}>
                <PlaylistAdd onAdd={() => queue([s.youtubeId])} title={s.title} />
              </SongRow>
            ))}
          </SongList>
        )}
      </>
    )
  if (lists === undefined)
    return (
      <p className="text-xs text-lofi-muted text-center py-6">
        <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" /> Loading playlists…
      </p>
    )
  return (
    <SongList empty={lists === null ? "Couldn't load your playlists" : 'No playlists on Tavarian yet'}>
      {(lists ?? []).map((l) => (
        <li key={l.id}>
          <button onClick={() => show(l)} className="w-full flex items-center gap-2 rounded-xl p-1.5 pr-3 text-left border border-white/5 bg-lofi-base/40 hover:border-white/20 transition-colors">
            {l.coverThumbnail ? <img src={l.coverThumbnail} alt="" className="w-16 h-9 rounded-md object-cover shrink-0" /> : <span className="w-16 h-9 rounded-md bg-lofi-surface flex items-center justify-center shrink-0"><i className="fa-solid fa-list text-lofi-muted text-xs" aria-hidden="true" /></span>}
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-white truncate">{l.name}</span>
              <span className="block text-[10px] text-lofi-muted">
                {l.songCount ?? 0} song{l.songCount === 1 ? '' : 's'}
              </span>
            </span>
            <i className="fa-solid fa-chevron-right text-[10px] text-lofi-muted" aria-hidden="true" />
          </button>
        </li>
      ))}
    </SongList>
  )
}
function PlaylistAdd({ onAdd, title }) {
  const [state, setState] = useState(null)
  return <SmallBtn label={`Add to the queue: ${title}`} icon="fa-plus" onClick={async () => (setState('busy'), setState((await onAdd()) ? 'done' : null))} busy={state === 'busy'} done={state === 'done'} />
}

// "Tavarian link: <name> · expires <date> · Revoke link", with the same two-step question as Settings › Reset all:
// Cancel is focused, "Yes, revoke" wakes after a moment, and the question gives up after 8 s
function LinkRow({ p }) {
  const [tok, setTok] = useState(undefined)
  const [sure, setSure] = useState(false)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    tavarianPost({ action: 'token' }).then((r) => alive && setTok(r.ok ? r.data.token : null))
    return () => (alive = false)
  }, [])
  useEffect(() => {
    if (!sure) return
    setArmed(false)
    const a = setTimeout(() => setArmed(true), 800)
    const t = setTimeout(() => setSure(false), 8000)
    return () => (clearTimeout(a), clearTimeout(t))
  }, [sure])
  async function revoke() {
    setSure(false)
    setBusy(true)
    const r = await tavarianPost({ action: 'revoke' })
    setBusy(false)
    if (r.ok) p.setRevoked()
    else setErr(r.error)
  }
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)
  if (sure)
    return (
      <div
        role="alertdialog"
        aria-labelledby="tv-revoke-q"
        onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), setSure(false))}
        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 motion-safe:animate-[panel-in_0.2s_ease-out]"
      >
        <p id="tv-revoke-q" className="text-[11px] text-red-200 flex items-center gap-2 min-w-0">
          <i className="fa-solid fa-triangle-exclamation text-red-400" aria-hidden="true" />
          <span>
            Revoke the link? <span className="text-red-200/70">The Player stops for everyone until a new token is set.</span>
          </span>
        </p>
        <div className="flex gap-2 shrink-0">
          <button autoFocus onClick={() => setSure(false)} className="h-8 px-3 rounded-full border border-white/15 font-mono text-[11px] text-lofi-text hover:text-white hover:border-white/30 transition-colors">
            Cancel
          </button>
          <button
            aria-disabled={!armed}
            onClick={() => armed && revoke()}
            className="h-8 px-3 rounded-full bg-red-500/85 text-white font-mono text-[11px] font-bold hover:bg-red-500 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-red-500/85 transition-[background-color,opacity] duration-300 flex items-center gap-1.5"
          >
            <i className="fa-solid fa-link-slash" aria-hidden="true" /> Yes, revoke
          </button>
        </div>
      </div>
    )
  return (
    <p className="text-[10px] font-mono text-lofi-muted text-center flex flex-wrap items-center justify-center gap-x-1.5">
      <i className="fa-solid fa-link text-lofi-primary/70" aria-hidden="true" />
      <span>Tavarian link:</span>
      {tok === undefined ? <span>…</span> : tok ? (
        <>
          <span className="text-lofi-text">{tok.name ?? 'token'}</span>
          {tok.expiresAt && <span>· expires {date(tok.expiresAt)}</span>}
        </>
      ) : (
        <span>{p.revoked ? 'revoked' : 'unknown'}</span>
      )}
      {!p.revoked && (
        <>
          <span>·</span>
          <button onClick={() => (setErr(null), setSure(true))} disabled={busy} className="text-lofi-muted hover:text-red-300 underline-offset-2 hover:underline disabled:opacity-50">
            {busy ? 'Revoking…' : 'Revoke link'}
          </button>
        </>
      )}
      {err && <span className="basis-full text-red-400">{err}</span>}
    </p>
  )
}

// The ambient bar ("bar") and lock screen ("lock") piece: listen / stop for everyone, the cover and title, ⏭ for the
// owner. eq: the bar's equalizer (from MiniPlayer, so both sources look the same)
export function PlayerMini({ p, owner, lock, box, eq, onQueue }) {
  const mounted = useMounted()
  const ctl = useTavarianControl(p)
  const song = p.state?.song
  const art = useArt(song) // (a Spotify song's fetched cover too)
  const status = statusInfo({ state: p.state, reachable: p.reachable }).label
  const main = mainOf(p, owner)
  return (
    <div className={box} role={lock ? 'group' : undefined} aria-label={lock ? 'Now playing' : undefined}>
      <button
        onClick={() => p.press(ctl.act)}
        disabled={owner && ctl.busy != null}
        aria-pressed={p.listening}
        title={main.label}
        aria-label={`${main.label}: home station`}
        className="w-9 h-9 shrink-0 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-colors disabled:opacity-60 shadow-[0_0_12px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)]"
      >
        <i className={`fa-solid text-xs ${STATION_ACTS.includes(ctl.busy) ? 'fa-spinner fa-spin' : main.icon}`} aria-hidden="true" />
      </button>
      {mounted && song && art && <FadeImg key={art} src={art} className={`${lock ? 'w-11 h-11 rounded-xl' : 'max-sm:hidden w-8 h-8 rounded-lg'} object-cover shrink-0 ${p.state?.status === 'playing' ? '' : 'opacity-70'}`} />}
      <span className={`min-w-0 font-sans ${lock ? 'max-w-52' : 'max-sm:hidden max-w-40'}`}>
        <span className="block text-xs text-white truncate">{plain(song?.title) || 'Home station'}</span>
        <span className="block text-[11px] text-lofi-muted truncate">{p.state?.status === 'playing' ? 'Tavarian · home station' : status}</span>
      </span>
      {eq}
      {owner && song && (
        <button onClick={() => ctl.act('skip')} aria-label="Skip for everyone" title="Skip for everyone" className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
          <i className={`fa-solid text-xs ${ctl.busy === 'skip' ? 'fa-spinner fa-spin' : 'fa-forward-step'}`} aria-hidden="true" />
        </button>
      )}
      {onQueue && (
        <button onClick={onQueue} aria-label="Open the queue" title="Open the queue" className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
          <i className="fa-solid fa-list-ul text-xs" aria-hidden="true" />
        </button>
      )}
      {ctl.err && <span className="text-[10px] text-red-400 whitespace-nowrap" role="status">{ctl.err}</span>}
    </div>
  )
}
