'use client'

// The radio: two kinds of station behind one player.
// - youtube: a 24/7 YouTube live stream, played audio-only through a hidden IFrame player. Stops when a phone locks.
// - stream: a real internet-radio stream in an <audio> element: keeps playing in the background on iOS / Android.
// Play / pause / switch fade (switching between the two kinds crossfades); a station that won't start or dies is skipped
// (at most 3 in a row) with a note; media keys, headphones and the phone's lock screen work through the Media Session.
// iOS Safari ignores volume from the page (hardware buttons only), so there the slider and fades are left out.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MOODS, STATIONS, stationById } from '../lib/stations'
import { load, motionOff, save } from './settings'

const START_MS = 15000 // no sound by then: that station is skipped
const YT_WAIT_MS = 15000 // the IFrame API never came (an ad blocker, a network that blocks YouTube): youtube stations off
const FADE_IN = 900
const FADE_OUT = 350

// a station's picture: the live stream's thumbnail (youtube), else a generated cover (emoji on a mood gradient)
const ytThumb = (v) => `https://i.ytimg.com/vi/${v}/mqdefault.jpg`
const COVER_BG = { focus: ['#ff8c69', '#5b3f8c'], chill: ['#6ec6ff', '#3b3a72'], jazz: ['#e0a96d', '#4a2c2a'], piano: ['#c7b8ea', '#2d2a4a'], asia: ['#ff9fb2', '#3d2a5a'], retro: ['#ff5fa2', '#2b1055'], sleep: ['#3a4a8c', '#0f1026'] }
const drawn = new Map()
function drawCover(s) {
  if (drawn.has(s.id)) return drawn.get(s.id)
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const [a, b] = COVER_BG[s.mood] ?? COVER_BG.chill
  const grad = g.createLinearGradient(0, 0, 256, 256)
  grad.addColorStop(0, a)
  grad.addColorStop(1, b)
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  g.font = '120px serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(s.emoji, 128, 138)
  const url = c.toDataURL('image/png')
  drawn.set(s.id, url)
  return url
}
export const coverOf = (s, info) => (s.kind === 'youtube' && info?.[s.id]?.v ? ytThumb(info[s.id].v) : typeof document === 'undefined' ? null : drawCover(s))

export function useMounted() {
  const [on, setOn] = useState(false)
  useEffect(() => setOn(true), [])
  return on
}

// 3600 -> "3.6K"
export const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n))

// can this station play right now? youtube needs its stream found and the IFrame API loaded
const playable = (s, info, yt) => (s.kind === 'stream' ? true : yt !== 'blocked' && Boolean(info?.[s.id]?.v))

// /api/radio: the YouTube stations' live streams ({ id: { v, title, watching } | null }), refreshed hourly
export function useRadioInfo() {
  const [m, setM] = useState(null)
  useEffect(() => {
    let alive = true
    const get = () =>
      fetch('/api/radio')
        .then((r) => r.json())
        .then((v) => alive && !v.error && setM(v), () => {})
    get()
    const t = setInterval(get, 3600_000)
    return () => ((alive = false), clearInterval(t))
  }, [])
  return m
}

// The Media Session (media keys, headphones, the phone's lock screen) has one set of handlers for the page: the source
// that last started (the radio, or the Player tab listening) claims it with its own; the other leaves it alone
const MEDIA_ACTIONS = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekto']
let mediaOwner = 'radio'
export const mediaSessionOwner = () => mediaOwner
export function claimMediaSession(owner, handlers) {
  mediaOwner = owner
  const ms = typeof navigator !== 'undefined' && navigator.mediaSession
  if (!ms) return
  for (const k of MEDIA_ACTIONS) {
    try {
      ms.setActionHandler(k, handlers?.[k] ?? null)
    } catch {}
  }
}

// a tiny silent WAV: played once inside the first tap that starts a YouTube station, so the <audio> element is
// "unlocked" on iOS for a later switch to a stream station that doesn't come from a tap (lock screen ⏭, a skip)
export function silentWav() {
  const n = 800
  const b = new Uint8Array(44 + n)
  const v = new DataView(b.buffer)
  const str = (o, t) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)))
  str(0, 'RIFF'), v.setUint32(4, 36 + n, true), str(8, 'WAVEfmt '), v.setUint32(16, 16, true), v.setUint16(20, 1, true)
  v.setUint16(22, 1, true), v.setUint32(24, 8000, true), v.setUint32(28, 8000, true), v.setUint16(32, 1, true), v.setUint16(34, 8, true)
  str(36, 'data'), v.setUint32(40, n, true), b.fill(128, 44)
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`
}

// The player. `station` is the picked one (kept by the page, so the Hide bar and the lock screen show it too);
// select(id) is called straight from a tap, so the first play happens inside that gesture (iOS needs it).
export function useRadio({ station, info, onStation, onTune, host }) {
  const [status, setStatus] = useState('idle') // idle | loading | playing
  const [note, setNote] = useState(null)
  const [volume, setVolume] = useState(50)
  const [muted, setMuted] = useState(false)
  const [yt, setYt] = useState('loading') // the IFrame API: loading | ready | blocked
  const [fixedVolume, setFixedVolume] = useState(false) // iOS: the page can't set volume
  const [sleepAt, setSleepAt] = useState(null)
  const [now, setNow] = useState(null) // what a stream station plays: { artist, title }
  const player = useRef(null)
  const audio = useRef(null)
  // the engine's own state; event handlers read it (and the latest functions, fn) so they never see an old render
  const m = useRef({ want: false, engine: null, cur: station, gain: { yt: 0, audio: 0 }, ramps: {}, skips: 0, bad: {}, watchdog: 0, haltAt: 0, unlocked: false, retry: false, playing: false, fixed: false }).current
  const live = useRef({})
  live.current = { info, yt, volume, muted, station, onStation }
  m.cur = station

  const level = () => (live.current.muted ? 0 : live.current.volume)
  const apply = (engine, g) => {
    m.gain[engine] = g
    if (engine === 'yt') player.current?.setVolume?.(Math.round(level() * g))
    else if (audio.current) audio.current.volume = Math.min(1, (level() / 100) * g)
  }
  const fade = (engine, to, ms, done) => {
    clearInterval(m.ramps[engine])
    const from = m.gain[engine]
    if (motionOff() || ms <= 0 || from === to) return apply(engine, to), done?.()
    const t0 = performance.now()
    m.ramps[engine] = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / ms)
      apply(engine, from + (to - from) * p)
      if (p >= 1) clearInterval(m.ramps[engine]), done?.()
    }, 40)
  }
  const halt = (engine) => {
    clearInterval(m.ramps[engine])
    if (engine === 'yt') player.current?.pauseVideo?.()
    else if (audio.current) {
      m.haltAt = Date.now() // its 'pause' event, coming a moment later, is ours
      audio.current.pause()
      audio.current.removeAttribute('src') // a live stream keeps downloading while paused: let it go
      audio.current.load()
    }
  }
  const stop = (engine, ms) => engine && fade(engine, 0, ms, () => halt(engine))

  // the stations that can play now, in list order; on a locked phone only the ones that play in the background
  const onAir = (bgOnly) => STATIONS.filter((s) => playable(s, live.current.info, live.current.yt) && !(bgOnly && s.kind !== 'stream'))
  const neighbour = (from, d, bgOnly) => {
    const list = onAir(bgOnly).filter((s) => s.id === from.id || !(m.bad[s.id] > Date.now() - 600_000))
    if (!list.length) return null
    const i = list.findIndex((s) => s.id === from.id)
    return list[(i + d + list.length) % list.length]
  }

  function start(s) {
    const { info, yt } = live.current
    clearTimeout(m.watchdog)
    setNow(null)
    m.playing = false
    setStatus('loading')
    m.engine = s.kind === 'youtube' ? 'yt' : 'audio'
    m.retry = false
    m.watchdog = setTimeout(() => m.want && !m.playing && fn.current.fail(s, 'timeout'), START_MS)
    if (s.kind === 'stream') {
      const a = audio.current
      apply('audio', m.fixed ? 1 : 0)
      a.src = s.url
      a.play().catch((e) => (e?.name === 'NotAllowedError' ? ((m.want = false), clearTimeout(m.watchdog), setStatus('idle')) : e?.name !== 'AbortError' && fn.current.fail(s, 'error')))
      return
    }
    if (yt === 'blocked') return fail(s, 'blocked')
    const v = info?.[s.id]?.v
    if (!v) return fail(s, 'off')
    if (!m.unlocked && audio.current && !audio.current.src) {
      // see silentWav(): this tap also unlocks the <audio> element for later
      audio.current.src = silentWav()
      audio.current.play().then(() => audio.current?.getAttribute('src')?.startsWith('data:') && halt('audio'), () => {})
    }
    m.unlocked = true
    const p = player.current
    if (!p) return // built soon: onReady starts it
    apply('yt', 0)
    if (p.getVideoData?.()?.video_id === v) p.playVideo()
    else p.loadVideoById(v)
  }

  // a station that won't play: skip to the next one (a few times), else stop and say so
  function fail(s, why) {
    clearTimeout(m.watchdog)
    if (!m.want || m.cur.id !== s.id) return
    m.bad[s.id] = Date.now()
    halt(m.engine)
    const blocked = why === 'blocked'
    const next = m.skips < 3 && neighbour(s, 1, document.hidden)
    if (next && next.id !== s.id) {
      m.skips++
      setNote(blocked ? `YouTube is blocked here: switched to ${next.emoji} ${next.name}` : `${s.name} is off air: switched to ${next.emoji} ${next.name}`)
      live.current.onStation(next.id)
      m.cur = next
      return start(next)
    }
    m.want = false
    setStatus('idle')
    setNote(blocked ? 'YouTube is blocked in this browser: try a 📱 station' : "Couldn't start the radio: try another station")
  }

  function play() {
    if (mediaOwner !== 'radio') claimMediaSession('radio', media) // the Player tab had the media keys
    m.want = true
    m.skips = 0
    setNote(null)
    start(m.cur)
  }
  function pause() {
    m.want = false
    m.playing = false
    clearTimeout(m.watchdog)
    setStatus('idle')
    stop(m.engine, FADE_OUT)
  }
  const toggle = () => (m.want ? pause() : play())

  // pick a station (from a tap, the list, ⏮ ⏭ or the lock screen); keeps playing if music is on
  function select(id) {
    const s = stationById(id)
    if (s.id === m.cur.id && m.want) return
    live.current.onStation(s.id)
    m.cur = s
    setNote(null)
    if (!m.want) return
    m.skips = 0
    const old = m.engine
    const next = s.kind === 'youtube' ? 'yt' : 'audio'
    if (old && old !== next) return stop(old, 600), start(s) // crossfade between the two players
    clearTimeout(m.watchdog)
    setStatus('loading')
    const go = () => m.cur.id === s.id && m.want && start(s)
    // a youtube station from a tap: start right away, inside the gesture (iOS); otherwise a short fade out first
    if (!old || (next === 'yt' && !m.unlocked)) return go()
    fade(old, 0, FADE_OUT, go)
  }
  const step = (d, bgOnly = false) => {
    const n = neighbour(m.cur, d, bgOnly)
    if (n) select(n.id)
  }
  const fn = useRef({})
  fn.current = { start, fail, pause, play, step }
  const media = useRef({
    play: () => fn.current.play(),
    pause: () => fn.current.pause(),
    stop: () => fn.current.pause(),
    nexttrack: () => fn.current.step(1, document.hidden),
    previoustrack: () => fn.current.step(-1, document.hidden),
  }).current

  function setLevel(v) {
    const x = Math.max(0, Math.min(100, Math.round(v)))
    live.current.volume = x
    live.current.muted = false
    setVolume(x)
    setMuted(false)
    save('volume', x)
    if (m.engine) apply(m.engine, m.gain[m.engine])
  }
  function toggleMute() {
    live.current.muted = !live.current.muted
    setMuted(live.current.muted)
    if (m.engine) apply(m.engine, m.gain[m.engine])
  }

  // the two players
  useEffect(() => {
    const v = Number(load('volume', 50))
    if (v >= 0 && v <= 100) setVolume((live.current.volume = v))
    const probe = document.createElement('audio')
    probe.volume = 0.5
    setFixedVolume((m.fixed = probe.volume !== 0.5))

    const a = (audio.current = new Audio())
    a.preload = 'none'
    a.addEventListener('playing', () => {
      if (m.engine !== 'audio' || !m.want || a.getAttribute('src')?.startsWith('data:')) return
      clearTimeout(m.watchdog)
      m.skips = 0
      m.playing = true
      setStatus('playing')
      fade('audio', 1, FADE_IN)
    })
    a.addEventListener('waiting', () => m.engine === 'audio' && m.want && setStatus('loading'))
    a.addEventListener('error', () => {
      if (m.engine !== 'audio' || !m.want || !a.getAttribute('src') || a.getAttribute('src').startsWith('data:')) return
      if (!m.retry) return (m.retry = true), setTimeout(() => m.want && m.engine === 'audio' && (a.load(), a.play().catch(() => {})), 1500)
      fn.current.fail(m.cur, 'error')
    })
    // paused from outside (the lock screen, headphones unplugged): that's a pause
    a.addEventListener('pause', () => Date.now() - m.haltAt > 1000 && m.engine === 'audio' && m.want && !a.getAttribute('src')?.startsWith('data:') && fn.current.pause())

    // ponytail: build the YouTube player after idle (not on click) so a tap can call playVideo() synchronously
    let waited = 0
    const build = () => {
      waited = setTimeout(() => !player.current && setYt('blocked'), YT_WAIT_MS)
      window.onYouTubeIframeAPIReady = () => {
        new window.YT.Player(host.current.appendChild(document.createElement('div')), {
          height: '0',
          width: '0',
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, iv_load_policy: 3, playsinline: 1 },
          events: {
            onReady: (e) => {
              clearTimeout(waited)
              player.current = e.target
              setYt('ready')
              if (m.want && m.engine === 'yt') fn.current.start(m.cur) // Play was pressed before it was ready
            },
            onStateChange: (e) => {
              if (m.engine !== 'yt') return
              const S = window.YT.PlayerState
              if (e.data === S.PLAYING) {
                if (!m.want) return e.target.pauseVideo()
                clearTimeout(m.watchdog)
                m.skips = 0
                m.playing = true
                setStatus('playing')
                fade('yt', 1, FADE_IN)
              } else if (e.data === S.BUFFERING) m.want && setStatus('loading')
              else if (e.data === S.ENDED) fn.current.fail(m.cur, 'off')
              else if (e.data === S.PAUSED && m.want && document.hidden) fn.current.pause() // a phone put it away
            },
            onError: () => m.engine === 'yt' && fn.current.fail(m.cur, 'error'),
          },
        })
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.onerror = () => (clearTimeout(waited), setYt('blocked'))
      document.head.appendChild(s)
    }
    const idle = window.requestIdleCallback
    const id = idle ? idle(build, { timeout: 3000 }) : setTimeout(build, 1500)
    return () => {
      if (idle) cancelIdleCallback(id)
      else clearTimeout(id)
      clearTimeout(waited)
      clearTimeout(m.watchdog)
      Object.values(m.ramps).forEach(clearInterval)
      a.pause()
      a.removeAttribute('src')
    }
  }, [])

  // YouTube blocked while a youtube station was asked for: hop to a stream one
  useEffect(() => {
    if (yt === 'blocked' && m.want && m.cur.kind === 'youtube') fn.current.fail(m.cur, 'blocked')
  }, [yt])

  // what a stream station is playing (now-playing APIs, through /api/radio/now): every 30 s while it plays
  useEffect(() => {
    if (status !== 'playing' || station.kind !== 'stream' || !station.now) return setNow(null)
    let alive = true
    const get = () =>
      fetch(`/api/radio/now?id=${station.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => alive && setNow(v?.title ? v : null), () => {})
    get()
    const t = setInterval(get, 30_000)
    return () => ((alive = false), clearInterval(t))
  }, [status, station])

  // sleep timer: the last 20 s fade out, then pause
  const [, tick] = useState(0)
  useEffect(() => {
    if (!sleepAt) return
    let fading = false
    const t = setInterval(() => {
      const left = sleepAt - Date.now()
      tick((n) => n + 1)
      if (left <= 20_000 && !fading && m.want && m.engine) (fading = true), fade(m.engine, 0, Math.max(0, left))
      if (left <= 0) clearInterval(t), setSleepAt(null), m.want && fn.current.pause()
    }, 1000)
    return () => clearInterval(t)
  }, [sleepAt])
  const sleepLeft = sleepAt ? Math.max(0, Math.ceil((sleepAt - Date.now()) / 60_000)) : null

  // the phone's lock screen / notification, media keys, headphone buttons
  useEffect(() => {
    if (mediaOwner === 'radio') claimMediaSession('radio', media)
    return () => mediaOwner === 'radio' && claimMediaSession('radio', null)
  }, [])
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || typeof MediaMetadata === 'undefined' || mediaOwner !== 'radio') return
    const art = coverOf(station, info)
    ms.metadata = new MediaMetadata({
      title: now?.title ?? station.name,
      artist: now?.artist ?? `${station.by} · ${station.sub}`,
      album: `${station.emoji} ${station.name} · wliafdew.dev radio`,
      artwork: art ? [{ src: art, sizes: station.kind === 'youtube' ? '320x180' : '256x256', type: station.kind === 'youtube' ? 'image/jpeg' : 'image/png' }] : [],
    })
    ms.playbackState = m.want ? 'playing' : 'paused'
  }, [station, info, now, status])

  useEffect(() => onTune({ playing: status === 'playing', loading: status === 'loading' }), [status, onTune])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  return { status, note, setNote, volume, muted, fixedVolume, yt, now, sleepLeft, sleepAt, setSleepAt, toggle, pause, select, step, setLevel, toggleMute }
}

// the little dancing bars (rest low when paused, still with reduced motion)
export function Bars({ on, className = '' }) {
  return (
    <span className={`flex items-end gap-0.5 h-3 shrink-0 ${className}`} aria-hidden="true">
      {[10, 14, 7, 12].map((h, i) => (
        <span key={i} className={`w-[3px] rounded-full bg-lofi-primary origin-bottom ${on ? 'animate-eq' : 'scale-y-30 opacity-60'}`} style={{ height: h, animationDelay: `${i * -0.23}s` }} />
      ))}
    </span>
  )
}

const SLEEP = [15, 30, 60, 90]

// The Radio tab: cover + what's on, the controls, then every station one tap away. The name opens the full list.
export function RadioPanel({ r, station, info, invite, onList }) {
  const playing = r.status === 'playing'
  const loading = r.status === 'loading'
  const meta = info?.[station.id]
  const mounted = useMounted()
  const art = mounted ? coverOf(station, info) : null
  const strip = useRef(null)
  const [sleepMenu, setSleepMenu] = useState(false)
  // keep the current station's chip in view
  useEffect(() => {
    const el = strip.current?.querySelector('[aria-current="true"]')
    if (el && strip.current) strip.current.scrollTo({ left: el.offsetLeft - strip.current.clientWidth / 2 + el.clientWidth / 2, behavior: motionOff() ? 'auto' : 'smooth' })
  }, [station.id])

  function share() {
    const url = `${location.origin}/?station=${station.id}`
    if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ title: `${station.name} · radio`, url }).catch(() => {})
    // no clipboard (http, or not allowed): just show the link
    if (!navigator.clipboard) return r.setNote(url)
    navigator.clipboard.writeText(url).then(
      () => r.setNote(`Link copied: ${station.emoji} ${station.name}`),
      () => r.setNote(url),
    )
  }
  const title = station.kind === 'stream' ? (r.now ? `${r.now.artist ? `${r.now.artist} · ` : ''}${r.now.title}` : station.sub) : (meta?.title ?? station.sub)

  return (
    <>
      {/* the cover, big and blurred, tints the card */}
      {art && <img src={art} alt="" aria-hidden="true" className={`absolute inset-0 w-full h-full object-cover blur-2xl scale-125 pointer-events-none transition-opacity duration-700 ${playing ? 'opacity-25' : 'opacity-12'}`} />}

      <div className="relative flex gap-4 min-w-0">
        <button onClick={onList} aria-haspopup="dialog" aria-label={`Station: ${station.name}. All stations`} className="relative shrink-0 w-24 h-24 rounded-2xl overflow-hidden border border-white/10 shadow-xl group">
          {art ? <img src={art} alt="" className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${playing ? '' : 'saturate-75'}`} /> : <span className="w-full h-full bg-lofi-surface flex items-center justify-center text-3xl">{station.emoji}</span>}
          {station.kind === 'stream' && <span className="absolute bottom-1 right-1 text-[10px] leading-none bg-lofi-base/80 rounded-full px-1 py-0.5" title="Keeps playing with the screen off">📱</span>}
        </button>
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <p className="flex items-center gap-2 text-[10px] font-mono text-lofi-muted mb-1">
            <span className="text-lofi-primary bg-lofi-primary/10 px-1.5 py-0.5 rounded-full border border-lofi-primary/20">● LIVE</span>
            {playing && <Bars on />}
            {meta?.watching > 0 && <span>{short(meta.watching)} listening</span>}
          </p>
          <button onClick={onList} aria-haspopup="dialog" className="min-w-0 flex items-center gap-1.5 text-left text-base font-medium text-white hover:text-lofi-primary transition-colors">
            <span aria-hidden="true">{station.emoji}</span>
            <span className="truncate">{station.name}</span>
            <i className="fa-solid fa-chevron-down text-[9px] text-lofi-muted" aria-hidden="true" />
          </button>
          <p className="text-xs text-lofi-muted truncate">{station.by}</p>
          <p className="text-[11px] text-lofi-text/70 truncate italic mt-0.5" title={title}>{title}</p>
        </div>
      </div>

      <div className="relative mt-auto flex items-center gap-2 pt-3">
        <button onClick={() => r.step(-1)} aria-label="Previous station" title="Previous station" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
          <i className="fa-solid fa-backward-step" aria-hidden="true" />
        </button>
        <button
          onClick={r.toggle}
          aria-label={playing || loading ? 'Pause' : `Play ${station.name}`}
          title={playing || loading ? 'Pause' : 'Play'}
          className={`w-12 h-12 shrink-0 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-all hover:scale-105 shadow-[0_0_15px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)] ${invite && r.status === 'idle' ? 'motion-safe:animate-pulse ring-4 ring-lofi-primary/30' : ''}`}
        >
          <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : playing ? 'fa-pause' : 'fa-play ml-1'}`} aria-hidden="true" />
        </button>
        <button onClick={() => r.step(1)} aria-label="Next station" title="Next station" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
          <i className="fa-solid fa-forward-step" aria-hidden="true" />
        </button>
        {!r.fixedVolume && (
          <div className="flex items-center gap-1.5 min-w-0 flex-1 ml-1">
            <button onClick={r.toggleMute} aria-label={r.muted ? 'Unmute' : 'Mute'} title={r.muted ? 'Unmute' : 'Mute'} className="w-7 h-7 shrink-0 flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
              <i className={`fa-solid ${r.muted || r.volume === 0 ? 'fa-volume-xmark' : r.volume < 50 ? 'fa-volume-low' : 'fa-volume-high'} text-xs`} aria-hidden="true" />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={r.muted ? 0 : r.volume}
              onChange={(e) => r.setLevel(Number(e.target.value))}
              aria-label="Volume"
              className="radio-volume min-w-0 flex-1"
              style={{ '--v': `${r.muted ? 0 : r.volume}%` }}
            />
          </div>
        )}
        <div className={`relative flex items-center gap-0.5 shrink-0 ${r.fixedVolume ? 'ml-auto' : ''}`}>
          <button
            onClick={() => setSleepMenu((v) => !v)}
            aria-label={r.sleepLeft ? `Sleep timer: ${r.sleepLeft} min left` : 'Sleep timer'}
            aria-expanded={sleepMenu}
            title="Sleep timer"
            className={`h-8 px-2 rounded-full flex items-center gap-1 text-xs transition-colors ${r.sleepLeft ? 'text-lofi-primary bg-lofi-primary/10' : 'text-lofi-muted hover:text-white'}`}
          >
            <i className="fa-solid fa-moon" aria-hidden="true" />
            {r.sleepLeft != null && <span className="font-mono text-[10px]">{r.sleepLeft}m</span>}
          </button>
          <button onClick={share} aria-label="Share this station" title="Share this station" className="w-8 h-8 rounded-full flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
            <i className="fa-solid fa-share-nodes text-xs" aria-hidden="true" />
          </button>
          {sleepMenu && (
            <div role="menu" aria-label="Stop the music after" className="absolute bottom-full right-0 mb-2 z-40 glass-panel rounded-xl p-1.5 flex gap-1 font-mono text-[11px] motion-safe:animate-[panel-in_0.2s_ease-out]">
              {SLEEP.map((n) => (
                <button key={n} role="menuitem" onClick={() => (r.setSleepAt(Date.now() + n * 60_000), setSleepMenu(false))} className="px-2 py-1 rounded-lg text-lofi-text hover:bg-lofi-primary/15 hover:text-white">
                  {n}m
                </button>
              ))}
              {r.sleepAt && (
                <button role="menuitem" onClick={() => (r.setSleepAt(null), setSleepMenu(false))} className="px-2 py-1 rounded-lg text-lofi-muted hover:text-white">
                  off
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* every station, one tap away (📱 = keeps playing with the screen off) */}
      <div ref={strip} className="relative mt-3 -mx-1 px-1 flex gap-1.5 overflow-x-auto overscroll-x-contain scrollbar-none [mask-image:linear-gradient(90deg,transparent,black_12px,black_calc(100%-12px),transparent)]">
        {STATIONS.map((s) => {
          const on = s.id === station.id
          const ok = playable(s, info, r.yt)
          return (
            <button
              key={s.id}
              onClick={() => r.select(s.id)}
              disabled={!ok}
              aria-current={on}
              title={`${s.name} · ${s.by}${s.kind === 'stream' ? ' · plays with the screen off' : ''}`}
              className={`shrink-0 h-8 px-2.5 rounded-full flex items-center gap-1.5 text-xs border transition-colors disabled:opacity-30 ${on ? 'bg-lofi-primary/20 border-lofi-primary/50 text-white' : 'bg-lofi-base/40 border-white/5 text-lofi-text hover:border-white/20 hover:text-white'}`}
            >
              <span aria-hidden="true">{s.emoji}</span>
              <span className="whitespace-nowrap">{s.short ?? s.name}</span>
              {on && playing && <span className="w-1.5 h-1.5 rounded-full bg-lofi-primary motion-safe:animate-pulse" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <p className="relative h-4 mt-1.5 text-[10px] font-mono text-center truncate text-lofi-muted" aria-live="polite">
        {r.note ?? (loading ? 'Tuning in…' : '')}
      </p>
    </>
  )
}

// All stations, grouped by mood, in a window over the page (a sheet on phones; portalled to <body>, since the card's
// backdrop-filter would trap a fixed child). Filters: a mood, or 📱 (plays with the screen off). The current one is
// lit (a dot while it plays); one that can't play right now is greyed out. Esc / ✕ / outside closes.
export function StationList({ r, current, info, playing, onClose }) {
  const close = useRef(null)
  const [mood, setMood] = useState('all')
  useEffect(() => {
    close.current?.focus({ preventScroll: true })
    const onKey = (e) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])
  const groups = MOODS.map(([id, label]) => [id, label, STATIONS.filter((s) => s.mood === id && (mood === 'all' || mood === id || (mood === 'bg' && s.kind === 'stream')))]).filter(([, , l]) => l.length)
  const chip = (id, label) => (
    <button key={id} onClick={() => setMood(id)} aria-pressed={mood === id} className={`shrink-0 h-7 px-2.5 rounded-full text-[11px] border transition-colors ${mood === id ? 'bg-lofi-primary text-lofi-base border-lofi-primary font-bold' : 'border-white/10 text-lofi-muted hover:text-white'}`}>
      {label}
    </button>
  )
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-lofi-base/70 backdrop-blur-sm motion-safe:animate-[fade-in_0.2s_ease-out]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Radio stations"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-3xl max-h-[85dvh] glass-panel rounded-t-3xl sm:rounded-3xl p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col min-h-0 text-lofi-text motion-safe:animate-[panel-in_0.25s_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <i className="fa-solid fa-radio text-lofi-primary text-xs" aria-hidden="true" /> Stations <span className="font-mono text-[11px] text-lofi-muted">{STATIONS.length}</span>
          </h2>
          <button ref={close} onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-lofi-base/60 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
            <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none mb-3 shrink-0">
          {chip('all', 'All')}
          {chip('bg', '📱 Screen off')}
          {MOODS.map(([id, label]) => chip(id, label))}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain -mr-1 pr-1 space-y-3">
          {groups.map(([id, label, list]) => (
            <section key={id}>
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-lofi-muted mb-1.5 px-1">{label}</h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {list.map((s) => {
                  const on = s.id === current
                  const ok = playable(s, info, r.yt)
                  const w = info?.[s.id]?.watching
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => (r.select(s.id), onClose())}
                        disabled={!ok}
                        aria-current={on || undefined}
                        title={`${s.name} · ${s.by} · ${s.sub}`}
                        className={`w-full flex items-center gap-2 rounded-xl p-1.5 pr-2 text-left border transition-colors disabled:opacity-35 ${on ? 'bg-lofi-primary/15 border-lofi-primary/40 text-white' : 'border-white/5 bg-lofi-base/40 text-lofi-text hover:border-white/20 hover:text-white'}`}
                      >
                        <img src={coverOf(s, info) ?? undefined} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0 bg-lofi-surface" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium truncate">
                            {s.emoji} {s.name}
                          </span>
                          <span className="block text-[10px] text-lofi-muted truncate">
                            {s.by}
                            {w > 0 && ` · ${short(w)} listening`}
                          </span>
                        </span>
                        {s.kind === 'stream' && <span className="text-[10px]" title="Keeps playing with the screen off">📱</span>}
                        {on && playing && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-lofi-primary motion-safe:animate-pulse" aria-hidden="true" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
