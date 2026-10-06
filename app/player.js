'use client'

// The Player tab: the home page's own station inside Tavarian (lib/tavarian.js has the server side).
// - useTavarian(): the live state and queue from /api/tavarian/events (EventSource), polling /api/tavarian/state
//   every 5 s when the stream can't stay open (and trying the stream again every 30 s).
// - usePlayerAudio(): one <audio> element. Listen gets a 10-minute ticket (a new one a minute before it ends, only
//   while listening) and plays Tavarian's audio straight from Tavarian; a new streamId (song change, seek, resume)
//   swaps the source; paused / idle / loading on Tavarian lets the element go, and it comes back by itself when the
//   station plays again (if this tab still listens). Volume and mute follow the radio's (Music passes them in).
// - PlayerPanel (the tab), PlayerSheet (queue, recent, and for the owner: add, playlists, the Tavarian link) and
//   PlayerMini (Hide bar and lock screen). Guests listen and watch; the owner's buttons post to
//   /api/private/settings/tavarian and spin until a state shows the change.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { audioUrl, clockOffset, confirms, isYouTubeUrl, mmss, moveId, newClientId, plain, positionAt, renewIn, statusInfo, thumbOf, ticketOk } from '../lib/player'
import { claimMediaSession, mediaSessionOwner, silentWav, useMounted } from './radio'
import { motionOff } from './settings'

const POLL_MS = 5000 // fallback polling of /api/tavarian/state
const SSE_RETRY_MS = 30_000 // while polling, try the event stream again this often
const SSE_ERRORS = 3 // this many errors in a row (no event in between): the stream can't stay open here
const FADE_IN = 600
const CONFIRM_MS = 15_000 // an owner's button gives up spinning after this
const TOKEN_DEAD = ['invalid_token', 'token_revoked', 'token_expired', 'owner_gone']

// ---- the owner's route: { action, ...args } -> { ok, data } or { ok: false, error: '<plain message>', code } ----
export async function tavarianPost(body) {
  let r
  try {
    r = await fetch('/api/private/settings/tavarian', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual', // a lapsed login redirects to the sign-in page: that's an error here
      cache: 'no-store',
    })
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the home server" }
  }
  const d = await r.json().catch(() => ({}))
  if (r.ok) return { ok: true, data: d }
  const wait = Number(r.headers.get('retry-after')) || 0
  const error =
    r.status === 429 ? `Too fast: try again in ${wait || 30} s`
    : r.type === 'opaqueredirect' || r.status === 401 || r.status === 403 || (r.status === 404 && !d.code) ? 'Sign in again to control the player'
    : (d.error ?? 'Tavarian refused the request')
  return { ok: false, status: r.status, code: d.code ?? null, error }
}

// ---- the live station ----
// keep: stay connected while the page is hidden (this tab is listening); otherwise a hidden page lets go
export function useTavarian({ keep = false } = {}) {
  const [d, setD] = useState({ state: null, queue: null, offset: 0, off: false, revoked: false, reachable: true, link: 'connecting', hub: null })
  const [songError, setSongError] = useState(null)
  const sync = useRef(() => {})
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
  const media = useRef({ play: () => fn.current.listen(), pause: () => fn.current.stop(), stop: () => fn.current.stop() }).current

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
  fn.current = { sync, retry, stop, listen }

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

  // media keys / the phone's lock screen: play / pause = listen / stop listening; ⏭ skips, for the owner only
  useEffect(() => {
    media.nexttrack = owner ? () => tavarianPost({ action: 'skip' }).then((r) => r.ok && live.current.tv.takeState(r.data.state)) : undefined
    if (mediaSessionOwner() === 'tavarian') claimMediaSession('tavarian', media)
  }, [owner])
  const song = st?.song
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || !listening || mediaSessionOwner() !== 'tavarian') return
    if (typeof MediaMetadata !== 'undefined')
      ms.metadata = new MediaMetadata({
        title: plain(song?.title) || 'Home station',
        artist: 'Tavarian',
        album: 'Home station · wliafdew.dev',
        artwork: song?.youtubeId ? [{ src: thumbOf(song), sizes: '320x180', type: 'image/jpeg' }] : [],
      })
    ms.playbackState = 'playing'
  }, [listening, song?.id, song?.title])
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
    toggle: () => (m.want ? stop() : listen()),
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

// ---- pieces ----
function Cover({ song, size = 'w-24 h-24', on, children }) {
  const art = thumbOf(song)
  return (
    <span className={`relative shrink-0 ${size} rounded-2xl overflow-hidden border border-white/10 shadow-xl bg-lofi-surface flex items-center justify-center`}>
      {art ? <img src={art} alt="" className={`w-full h-full object-cover ${on ? '' : 'saturate-75 opacity-80'}`} /> : <i className="fa-solid fa-music text-2xl text-lofi-primary/60" aria-hidden="true" />}
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
const listenLabel = (p) => (!p.listening ? 'Listen' : p.phase === 'connecting' ? 'Tuning in' : 'Stop')

// ⏸ / ▶ for the owner: pause while it plays (or loads), resume when paused, play when stopped with a queue
function playAction(p) {
  const s = p.state?.status
  if (s === 'playing' || s === 'loading') return ['pause', 'Pause for everyone', 'fa-pause']
  if (s === 'paused') return ['resume', 'Resume for everyone', 'fa-play ml-0.5']
  return ['play', 'Play the queue', 'fa-play ml-0.5']
}

// The Player tab
export function PlayerPanel({ p, owner, vol }) {
  const ctl = useTavarianControl(p)
  const [sheet, setSheet] = useState(null) // the sheet's open view: queue | recent | add | playlists
  const [drag, setDrag] = useState(null) // the seek bar while it's held (seconds)
  const playing = p.state?.status === 'playing'
  const [, tick] = useState(0)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [playing])

  const song = p.revoked || p.off ? null : p.state?.song
  const items = p.queue?.items ?? []
  const recent = p.queue?.recent ?? []
  const info = statusInfo({ off: p.off, revoked: p.revoked, reachable: p.reachable, state: p.state, queued: items.length, owner })
  const dur = song?.durationSeconds > 0 ? song.durationSeconds : 0
  const pos = drag ?? positionAt(p.state, p.offset)
  const hearing = p.listening && p.phase === 'playing'
  const [act, actLabel, actIcon] = playAction(p)
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
  const err = ctl.err ?? (songError ? `A song couldn't play${songError.reason ? ` (${songError.reason})` : ''}: skipped` : null)
  const line = err ?? p.note ?? (p.listening && p.phase === 'connecting' ? 'Tuning in…' : p.listening && p.phase === 'waiting' ? 'Listening: it plays as soon as the station does' : owner ? '⏸ ⏭ change it for everyone listening here' : '')
  const next = items.slice(0, 2)
  return (
    <>
      {song && <img src={thumbOf(song)} alt="" aria-hidden="true" className={`absolute inset-0 w-full h-full object-cover blur-2xl scale-125 pointer-events-none transition-opacity duration-700 ${playing ? 'opacity-25' : 'opacity-12'}`} />}

      <div className="relative flex gap-4 min-w-0">
        <Cover song={song} on={playing} />
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <p className="flex items-center gap-2 text-[10px] font-mono text-lofi-muted mb-1">
            <span className={`px-1.5 py-0.5 rounded-full border ${playing ? 'text-lofi-primary bg-lofi-primary/10 border-lofi-primary/20' : 'border-white/10'}`} role="status">
              {playing ? '●' : info.key === 'paused' ? '❚❚' : '○'} {info.label}
            </span>
            {hearing && <EqBars />}
          </p>
          <p className="text-base font-medium text-white truncate" title={plain(song?.title)}>
            {plain(song?.title) || (info.key === 'empty' ? 'Nothing queued' : info.key === 'stopped' ? `${items.length} in the queue` : 'Home station')}
          </p>
          <p className="text-xs text-lofi-muted truncate">{song ? 'Tavarian · home station' : owner ? 'Add a song to start' : 'Nothing on the home station right now'}</p>
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
                  className="radio-volume min-w-0 grow disabled:opacity-50"
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
        <button
          onClick={p.toggle}
          aria-pressed={p.listening}
          aria-label={p.listening ? 'Stop listening' : 'Listen to the home station'}
          className="h-10 pl-4 pr-5 shrink-0 rounded-full bg-lofi-primary text-lofi-base font-bold text-sm flex items-center gap-2 hover:bg-lofi-highlight transition-all hover:scale-105 shadow-[0_0_15px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)]"
        >
          <i className={`fa-solid ${p.listening && p.phase === 'connecting' ? 'fa-spinner fa-spin' : p.listening ? 'fa-stop' : 'fa-headphones'} text-sm`} aria-hidden="true" />
          {listenLabel(p)}
        </button>
        {owner && (
          <>
            <Round label={actLabel} icon={actIcon} onClick={() => ctl.act(act)} busy={['pause', 'resume', 'play'].includes(ctl.busy)} disabled={act === 'play' && !items.length} className="ml-1" />
            <Round label="Skip for everyone" icon="fa-forward-step" onClick={() => ctl.act('skip')} busy={ctl.busy === 'skip'} disabled={!song} />
          </>
        )}
        {!vol.fixedVolume && (
          <div className="flex items-center gap-1 min-w-0 flex-1 ml-1">
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
              aria-label="Volume"
              className="radio-volume min-w-0 flex-1"
              style={{ '--v': `${vol.muted ? 0 : vol.volume}%` }}
            />
          </div>
        )}
      </div>

      {/* Up next (or the last played): the first two; the header opens the whole list (and Add, for the owner) */}
      <div className="relative mt-2 min-w-0 h-[52px] shrink-0">
        <p className="flex items-center justify-between h-4 text-[9px] font-mono uppercase tracking-widest text-lofi-muted">
          <span>{next.length ? 'Up next' : recent.length ? 'Last played' : 'Queue'}</span>
          <span className="flex items-center gap-3 normal-case tracking-normal text-[10px]">
            {owner && (
              <button onClick={() => setSheet('add')} aria-haspopup="dialog" aria-label="Add a song" className="hover:text-white transition-colors">
                ＋ Add
              </button>
            )}
            <button onClick={() => setSheet(next.length || !recent.length ? 'queue' : 'recent')} aria-haspopup="dialog" aria-label={`Queue: ${items.length} song${items.length === 1 ? '' : 's'}`} className="hover:text-white transition-colors">
              {next.length || !recent.length ? `Queue · ${items.length}` : `Recent · ${recent.length}`} ›
            </button>
          </span>
        </p>
        {next.length > 0 || recent.length > 0 ? (
          <ul>
            {(next.length ? next : recent.slice(0, 2)).map((s) => (
              <li key={s.id} className="flex items-center gap-2 min-w-0 text-[11px] h-[18px]">
                <img src={thumbOf(s) ?? undefined} alt="" className="w-[26px] h-4 rounded-sm object-cover shrink-0 bg-lofi-surface" />
                <span className="text-white/80 truncate">{plain(s.title)}</span>
                {s.durationSeconds > 0 && <span className="text-lofi-muted font-mono text-[10px] shrink-0 ml-auto">{mmss(s.durationSeconds)}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-lofi-muted italic pt-1">{owner ? 'The queue is empty: ＋ Add puts a song in it.' : 'The queue is empty.'}</p>
        )}
      </div>
      <p className={`relative shrink-0 h-4 mt-1 text-[10px] font-mono text-center truncate ${err ? 'text-red-400' : 'text-lofi-muted'}`} aria-live="polite">
        {line}
      </p>
      {sheet && <PlayerSheet p={p} owner={owner} view={sheet} setView={setSheet} onClose={() => setSheet(null)} />}
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

// a song in a list: thumbnail, title, a second line, then the row's buttons
function SongRow({ s, sub, on, children }) {
  return (
    <li className={`flex items-center gap-2 rounded-xl p-1.5 pr-2 border ${on ? 'bg-lofi-primary/15 border-lofi-primary/40' : 'border-white/5 bg-lofi-base/40'}`}>
      <img src={thumbOf(s) ?? s.coverThumbnail ?? undefined} alt="" className="w-16 h-9 rounded-md object-cover shrink-0 bg-lofi-surface" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-white truncate" title={plain(s.title ?? s.name)}>
          {plain(s.title ?? s.name)}
        </span>
        {sub && <span className="block text-[10px] text-lofi-muted truncate">{sub}</span>}
      </span>
      {children}
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
const ago = (iso) => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

// Queue, recent, and for the owner Add (link or search), Playlists and the Tavarian link. A window over the page
// (a sheet on phones; portalled to <body>, like the station list). Esc / ✕ / outside closes.
export function PlayerSheet({ p, owner, view, setView, onClose }) {
  const close = useRef(null)
  const box = useRef(null)
  const [msg, setMsg] = useState(null) // { text, err }
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!box.current?.contains(document.activeElement)) close.current?.focus({ preventScroll: true }) // (Add focuses its box)
    const onKey = (e) => e.key === 'Escape' && (e.stopPropagation(), onCloseRef.current())
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), msg.err ? 7000 : 4000)
    return () => clearTimeout(t)
  }, [msg])
  const items = p.queue?.items ?? []
  const recent = p.queue?.recent ?? []
  const views = [
    ['queue', `Queue · ${items.length}`],
    ['recent', 'Recent'],
    ...(owner ? [['add', '＋ Add'], ['playlists', 'Playlists']] : []),
  ]
  const chip = ([id, label]) => (
    <button key={id} onClick={() => setView(id)} aria-pressed={view === id} className={`shrink-0 h-7 px-2.5 rounded-full text-[11px] border transition-colors ${view === id ? 'bg-lofi-primary text-lofi-base border-lofi-primary font-bold' : 'border-white/10 text-lofi-muted hover:text-white'}`}>
      {label}
    </button>
  )
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-lofi-base/70 backdrop-blur-sm motion-safe:animate-[fade-in_0.2s_ease-out]" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Home station"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-xl h-[85dvh] sm:h-[min(640px,85dvh)] glass-panel rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col min-h-0 text-lofi-text motion-safe:animate-[panel-in_0.25s_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <i className="fa-solid fa-music text-lofi-primary text-xs" aria-hidden="true" /> Home station <span className="font-mono text-[11px] text-lofi-muted">Tavarian</span>
          </h2>
          <button ref={close} onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-lofi-base/60 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
            <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none mb-3 shrink-0">{views.map(chip)}</div>
        <div className="min-h-0 grow overflow-y-auto overscroll-contain -mr-1 pr-1">
          {view === 'queue' && <QueueView p={p} owner={owner} setMsg={setMsg} onAdd={() => setView('add')} />}
          {view === 'recent' && (
            <SongList empty="Nothing played yet">
              {recent.map((s) => (
                <SongRow key={s.id} s={s} sub={[s.durationSeconds > 0 && mmss(s.durationSeconds), s.status === 'failed' ? `couldn't play${s.failReason ? `: ${s.failReason}` : ''}` : s.playedAt && ago(s.playedAt)].filter(Boolean).join(' · ')}>
                  {owner && <AddBtn url={`https://www.youtube.com/watch?v=${s.youtubeId}`} title={s.title} label="Queue it again" setMsg={setMsg} />}
                </SongRow>
              ))}
            </SongList>
          )}
          {owner && view === 'add' && <AddView setMsg={setMsg} queued={items} />}
          {owner && view === 'playlists' && <PlaylistsView setMsg={setMsg} />}
        </div>
        <p className={`shrink-0 min-h-4 mt-2 text-[11px] font-mono text-center ${msg?.err ? 'text-red-400' : 'text-lofi-primary'}`} role="status" aria-live="polite">
          {msg?.text ?? ''}
        </p>
        {owner && (
          <div className="shrink-0 mt-1 pt-2 border-t border-white/5 space-y-1.5">
            <p className="text-[10px] font-mono text-lofi-muted text-center">⏸ ⏭ and the queue change it for everyone listening on the home page.</p>
            <LinkRow p={p} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function SongList({ empty, children }) {
  const has = Array.isArray(children) ? children.some(Boolean) && children.length > 0 : Boolean(children)
  return has ? <ul className="space-y-1.5">{children}</ul> : <p className="text-xs text-lofi-muted text-center py-8">{empty}</p>
}

function QueueView({ p, owner, setMsg, onAdd }) {
  const items = p.queue?.items ?? []
  const [busy, setBusy] = useState(null) // the id being removed / moved
  const song = p.state?.song
  async function remove(s) {
    setBusy(s.id)
    const r = await tavarianPost({ action: 'remove', id: s.id })
    setBusy(null)
    if (r.ok) p.setQueue(r.data.queue), setMsg({ text: `Removed: ${plain(s.title)}` })
    else setMsg({ text: r.error, err: true })
  }
  async function move(s, d) {
    const ids = moveId(
      items.map((x) => x.id),
      s.id,
      d,
    )
    if (!ids) return
    const before = p.queue
    p.setQueue({ ...p.queue, items: ids.map((id) => items.find((x) => x.id === id)) }) // at once; the answer confirms
    setBusy(s.id)
    const r = await tavarianPost({ action: 'reorder', ids })
    setBusy(null)
    if (r.ok) p.setQueue(r.data.queue)
    else p.setQueue(before), setMsg({ text: r.error, err: true })
  }
  return (
    <>
      {song && (
        <>
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-lofi-muted mb-1.5 px-1">Now</h3>
          <ul className="mb-3">
            <SongRow s={song} on sub={`${statusInfo({ state: p.state }).label}${song.durationSeconds > 0 ? ` · ${mmss(song.durationSeconds)}` : ''}`} />
          </ul>
        </>
      )}
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-lofi-muted mb-1.5 px-1">Up next</h3>
      {items.length ? (
        <ol className="space-y-1.5">
          {items.map((s, i) => (
            <SongRow key={s.id} s={s} sub={`${i + 1}${s.durationSeconds > 0 ? ` · ${mmss(s.durationSeconds)}` : ''}`}>
              {owner && (
                <span className="flex items-center shrink-0">
                  <SmallBtn label={`Move up: ${s.title}`} icon="fa-arrow-up" onClick={() => move(s, -1)} disabled={i === 0 || busy != null} />
                  <SmallBtn label={`Move down: ${s.title}`} icon="fa-arrow-down" onClick={() => move(s, 1)} disabled={i === items.length - 1 || busy != null} />
                  <SmallBtn label={`Remove: ${s.title}`} icon="fa-xmark" onClick={() => remove(s)} busy={busy === s.id} disabled={busy != null} />
                </span>
              )}
            </SongRow>
          ))}
        </ol>
      ) : (
        <div className="text-center py-6">
          <p className="text-xs text-lofi-muted">The queue is empty.</p>
          {owner && (
            <button onClick={onAdd} className="mt-2 h-8 px-4 rounded-full bg-lofi-primary text-lofi-base text-xs font-bold">
              ＋ Add a song
            </button>
          )}
        </div>
      )}
    </>
  )
}

// + : add one YouTube link to the queue; a check once it's in
function AddBtn({ url, title, label = 'Add to the queue', setMsg, done: already }) {
  const [state, setState] = useState(null) // busy | done
  async function add() {
    setState('busy')
    const r = await tavarianPost({ action: 'add', youtubeUrl: url })
    setState(r.ok ? 'done' : null)
    setMsg(r.ok ? { text: `Added: ${plain(r.data.song?.title ?? title)}` } : { text: r.error, err: true })
  }
  return <SmallBtn label={`${label}: ${plain(title)}`} icon="fa-plus" onClick={add} busy={state === 'busy'} done={state === 'done' || already} />
}

function AddView({ setMsg, queued }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const input = useRef(null)
  const q = text.trim()
  const link = isYouTubeUrl(q)
  useEffect(() => input.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    if (link || q.length < 2) return setResults(null), setSearching(false)
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await tavarianPost({ action: 'search', q })
      if (!alive) return
      setSearching(false)
      if (r.ok) setResults(r.data.results ?? [])
      else setResults([]), setMsg({ text: r.error, err: true })
    }, 500)
    return () => ((alive = false), clearTimeout(t))
  }, [q, link])
  async function addLink() {
    if (!link || adding) return
    setAdding(true)
    const r = await tavarianPost({ action: 'add', youtubeUrl: q })
    setAdding(false)
    if (r.ok) setText(''), setMsg({ text: `Added: ${plain(r.data.song?.title) || 'the song'}` })
    else setMsg({ text: r.error, err: true })
  }
  const inQueue = new Set(queued.map((s) => s.youtubeId))
  return (
    <>
      <form onSubmit={(e) => (e.preventDefault(), addLink())} className="flex items-center gap-2 mb-3">
        <label className="relative grow min-w-0">
          <span className="sr-only">YouTube link or search</span>
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-lofi-muted" aria-hidden="true" />
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a YouTube link, or search"
            maxLength={300}
            className="w-full h-10 pl-8 pr-3 rounded-full bg-lofi-base/60 border border-white/10 text-sm text-white placeholder:text-lofi-muted focus:outline-none focus:border-lofi-primary/60"
          />
        </label>
        {link && (
          <button type="submit" disabled={adding} className="h-10 px-4 shrink-0 rounded-full bg-lofi-primary text-lofi-base text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
            <i className={`fa-solid ${adding ? 'fa-spinner fa-spin' : 'fa-plus'}`} aria-hidden="true" /> Add
          </button>
        )}
      </form>
      {link ? (
        <p className="text-xs text-lofi-muted text-center py-4">A YouTube link: Add puts it at the end of the queue.</p>
      ) : searching ? (
        <p className="text-xs text-lofi-muted text-center py-4">
          <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" /> Searching…
        </p>
      ) : results ? (
        <SongList empty="Nothing found">
          {results.map((s) => (
            <SongRow key={s.youtubeId} s={s} sub={[s.channel, s.durationSeconds > 0 ? mmss(s.durationSeconds) : 'live'].filter(Boolean).join(' · ')}>
              <AddBtn url={s.youtubeUrl ?? `https://www.youtube.com/watch?v=${s.youtubeId}`} title={s.title} setMsg={setMsg} done={inQueue.has(s.youtubeId)} />
            </SongRow>
          ))}
        </SongList>
      ) : (
        <p className="text-xs text-lofi-muted text-center py-4">Type 2 letters or more to search YouTube.</p>
      )}
    </>
  )
}

function PlaylistsView({ setMsg }) {
  const [lists, setLists] = useState(undefined) // undefined = loading, null = failed
  const [open, setOpen] = useState(null) // { list, songs }
  const [all, setAll] = useState(null) // busy | done
  useEffect(() => {
    let alive = true
    tavarianPost({ action: 'playlists' }).then((r) => {
      if (!alive) return
      if (r.ok) setLists(r.data.playlists ?? [])
      else setLists(null), setMsg({ text: r.error, err: true })
    })
    return () => (alive = false)
  }, [])
  async function show(list) {
    setOpen({ list, songs: undefined })
    setAll(null)
    const r = await tavarianPost({ action: 'playlist-songs', id: list.id })
    setOpen((o) => (o?.list.id === list.id ? { list, songs: r.ok ? (r.data.songs ?? []) : null } : o))
    if (!r.ok) setMsg({ text: r.error, err: true })
  }
  async function queue(ids) {
    const r = await tavarianPost({ action: 'from-playlist', playlistId: open.list.id, ...(ids && { youtubeIds: ids }) })
    if (!r.ok) return setMsg({ text: r.error, err: true }), false
    const added = r.data.added?.length ?? 0
    const skipped = r.data.skipped ?? []
    const why = [...new Set(skipped.map((s) => s.reason))].join(', ')
    setMsg({ text: `Added ${added} song${added === 1 ? '' : 's'}${skipped.length ? ` · skipped ${skipped.length}${why ? ` (${why})` : ''}` : ''}`, err: !added && skipped.length > 0 })
    return added > 0
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

// The Hide bar ("bar") and lock screen ("lock") piece: listen / stop for everyone, the cover and title, ⏭ for the
// owner. eq: the bar's equalizer (from MiniPlayer, so both sources look the same)
export function PlayerMini({ p, owner, lock, box, eq }) {
  const mounted = useMounted()
  const ctl = useTavarianControl(p)
  const song = p.state?.song
  const status = statusInfo({ state: p.state, reachable: p.reachable }).label
  return (
    <div className={box} role={lock ? 'group' : undefined} aria-label={lock ? 'Now playing' : undefined}>
      <button
        onClick={p.toggle}
        aria-pressed={p.listening}
        title={p.listening ? 'Stop listening' : 'Listen'}
        aria-label={p.listening ? 'Stop listening to the home station' : 'Listen to the home station'}
        className="w-9 h-9 shrink-0 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-colors shadow-[0_0_12px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)]"
      >
        <i className={`fa-solid text-xs ${p.listening && p.phase === 'connecting' ? 'fa-spinner fa-spin' : p.listening ? 'fa-stop' : 'fa-headphones'}`} aria-hidden="true" />
      </button>
      {mounted && song && <img src={thumbOf(song) ?? undefined} alt="" className={`${lock ? 'w-11 h-11 rounded-xl' : 'max-sm:hidden w-8 h-8 rounded-lg'} object-cover shrink-0 ${p.state?.status === 'playing' ? '' : 'opacity-70'}`} />}
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
      {ctl.err && <span className="text-[10px] text-red-400 whitespace-nowrap" role="status">{ctl.err}</span>}
    </div>
  )
}
