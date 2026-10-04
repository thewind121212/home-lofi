'use client'

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AUTH_URL, SCENES, SCENES_URL, SERVICES } from '../lib/data'

const DEFAULT_LOC = { id: 1566083, name: 'Ho Chi Minh City', lat: 10.8231, lon: 106.6297, tz: 'Asia/Ho_Chi_Minh' }
const ACCENTS = ['text-lofi-primary', 'text-blue-400', 'text-lofi-secondary', 'text-lofi-highlight', 'text-purple-400', 'text-emerald-400']
const ICON_COLOR = {
  'fa-sun': 'text-lofi-highlight',
  'fa-moon': 'text-lofi-highlight',
  'fa-cloud': 'text-gray-400',
  'fa-smog': 'text-gray-400',
  'fa-cloud-rain': 'text-blue-400',
  'fa-cloud-showers-heavy': 'text-blue-400',
  'fa-cloud-showers-water': 'text-blue-400',
  'fa-cloud-bolt': 'text-lofi-secondary',
}
const DOT = {
  loading: 'bg-gray-400',
  ok: 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]',
  error: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]',
}

const sceneName = (id) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
const pad = (n) => String(n).padStart(2, '0')

// localStorage can throw (private mode, blocked storage) -> fall back silently
function load(key, fallback) {
  try {
    const v = localStorage.getItem('home-lofi:' + key)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
function save(key, value) {
  try {
    localStorage.setItem('home-lofi:' + key, JSON.stringify(value))
  } catch {}
}

export default function Home() {
  const [now, setNow] = useState(null)
  const [scene, setScene] = useState(null)
  const [reduced, setReduced] = useState(false)
  const [focus, setFocus] = useState(false)
  const [status, setStatus] = useState('loading')
  const priv = usePrivate()
  const videoRef = useRef(null)
  const [sceneDown, setSceneDown] = useState(false) // scene files missing / host down -> night sky fallback
  useEffect(() => setSceneDown(false), [scene])

  useEffect(() => {
    const s = load('scene', 'london')
    setScene(SCENES.includes(s) ? s : 'london')
    setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches)
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    const onKey = (e) => e.key === 'Escape' && setFocus(false)
    addEventListener('keydown', onKey)
    return () => {
      clearInterval(t)
      removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (reduced) return
    const onVis = () => {
      const v = videoRef.current
      if (!v) return
      if (document.hidden) v.pause()
      else v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [reduced])

  const hour = now?.getHours()
  const [greeting, icon, iconBg] =
    hour == null
      ? ['\u00a0', '', 'from-lofi-surface to-lofi-base']
      : hour >= 5 && hour < 12
      ? ['Good morning', 'fa-sun', 'from-lofi-highlight to-lofi-primary']
      : hour >= 12 && hour < 18
        ? ['Good afternoon', 'fa-cloud-sun', 'from-lofi-primary to-lofi-secondary']
        : ['Good evening', 'fa-moon', 'from-lofi-base to-lofi-surface border border-white/10']

  return (
    <>
      {/* Night sky: shows while the scene loads, and stays as the fallback if it can't load */}
      <NightSky />
      {/* Full-screen animated scene (decorative) */}
      {scene && !sceneDown && (
        <video
          key={scene}
          ref={videoRef}
          className="fixed inset-0 w-full h-full object-cover"
          style={{ imageRendering: 'pixelated' }}
          poster={`${SCENES_URL}/${scene}.webp`}
          autoPlay={!reduced}
          preload={reduced ? 'none' : 'auto'}
          muted
          loop
          playsInline
          aria-hidden="true"
        >
          <source src={`${SCENES_URL}/${scene}.webm`} type="video/webm" />
          <source src={`${SCENES_URL}/${scene}.mp4`} type="video/mp4" />
        </video>
      )}
      {scene && !sceneDown && (
        <SceneCanvas key={'c' + scene} id={scene} videoRef={videoRef} reduced={reduced} onFail={() => setSceneDown(true)} />
      )}
      <div
        className={`fixed inset-0 pointer-events-none bg-linear-to-b from-lofi-base/75 via-lofi-base/45 to-lofi-base/85 transition-opacity duration-500 ${focus ? 'opacity-0' : ''}`}
      />

      <div
        className={`relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24 min-h-screen flex flex-col transition-opacity duration-500 ${focus ? 'opacity-0 invisible' : ''}`}
      >
        <header className="flex flex-col md:flex-row justify-between items-center mb-8 glass-panel rounded-2xl p-6">
          <div className="flex items-center space-x-4 mb-4 md:mb-0">
            <div className={`w-12 h-12 rounded-full bg-linear-to-tr ${iconBg} flex items-center justify-center text-xl shadow-lg`}>
              {icon && <i className={`fa-solid ${icon} text-white`} aria-hidden="true" />}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{greeting}</h1>
              <p className="text-sm text-lofi-muted font-mono">Welcome to your space.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label
              className="flex items-center gap-2 bg-lofi-base/50 border border-white/5 rounded-full pl-3 pr-1 py-1.5 text-xs font-mono text-lofi-muted"
              title={sceneDown ? 'Scene could not load, showing the night sky' : 'Background scene'}
            >
              {sceneDown ? (
                <i className="fa-solid fa-moon text-lofi-highlight" aria-hidden="true" />
              ) : (
                <i className="fa-solid fa-image" aria-hidden="true" />
              )}
              {sceneDown && <span className="text-[10px] text-lofi-secondary">offline</span>}
              <select
                value={scene ?? 'london'}
                onChange={(e) => {
                  setScene(e.target.value)
                  save('scene', e.target.value)
                }}
                className="bg-transparent text-white cursor-pointer max-w-28"
                aria-label="Background scene"
              >
                {SCENES.map((id) => (
                  <option key={id} value={id} className="bg-lofi-base">
                    {sceneName(id)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => setFocus(true)}
              aria-label="Focus mode: hide panels"
              title="Focus mode"
              className="w-8 h-8 shrink-0 rounded-full bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
            >
              <i className="fa-solid fa-eye-slash text-xs" aria-hidden="true" />
            </button>
            <div className="text-right">
            <div className="text-3xl font-mono font-bold text-white neon-text">
              {now ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : '--:--'}
            </div>
            <div className="text-xs text-lofi-muted uppercase tracking-widest">
              {now?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) ?? ' '}
            </div>
            </div>
          </div>
        </header>

        <main className="grow grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 flex flex-col gap-6">
            <Music />
            <Weather status={status} setStatus={setStatus} />
            <Server d={priv} />
          </div>
          <div className="lg:col-span-8 flex flex-col gap-6">
            <Hub status={status} />
            <Services priv={priv} />
          </div>
        </main>
      </div>

      {/* Header is hidden in focus mode, so the only way back is this button (or Esc) */}
      {focus && (
        <button
          onClick={() => setFocus(false)}
          aria-label="Show panels"
          title="Show panels (Esc)"
          className="glass-panel fixed bottom-4 left-4 z-20 w-10 h-10 rounded-full flex items-center justify-center text-lofi-text hover:text-lofi-primary transition-colors"
        >
          <i className="fa-solid fa-eye text-sm" aria-hidden="true" />
        </button>
      )}
    </>
  )
}

function Music() {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState(false)
  const [volume, setVolume] = useState(50)
  const vol = useRef(50)
  const player = useRef(null)
  const host = useRef(null)
  const want = useRef(false) // user asked to play before the player was ready
  const isPlaying = useRef(false)
  const timer = useRef(null)

  useEffect(() => {
    const v = Number(load('volume', 50))
    if (v >= 0 && v <= 100) setVolume((vol.current = v))

    // ponytail: build the player after idle (not on click) so toggle() can call playVideo()
    // synchronously inside the user gesture, which iOS requires for audio.
    const start = () => {
      window.onYouTubeIframeAPIReady = () => {
        new window.YT.Player(host.current.appendChild(document.createElement('div')), {
          height: '0',
          width: '0',
          videoId: 'jfKfPfyJRdk',
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, iv_load_policy: 3 },
          events: {
            onReady: (e) => {
              player.current = e.target
              e.target.setVolume(vol.current)
              if (want.current) e.target.playVideo()
            },
            onStateChange: (e) => {
              isPlaying.current = e.data === window.YT.PlayerState.PLAYING
              setPlaying(isPlaying.current)
              if (isPlaying.current) setLoading(false)
            },
          },
        })
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
    const idle = window.requestIdleCallback
    const id = idle ? idle(start, { timeout: 3000 }) : setTimeout(start, 1500)
    return () => {
      if (idle) cancelIdleCallback(id)
      else clearTimeout(id)
      clearTimeout(timer.current)
    }
  }, [])

  function toggle() {
    const p = player.current
    const S = window.YT?.PlayerState
    if (p && (p.getPlayerState() === S.PLAYING || p.getPlayerState() === S.BUFFERING)) {
      want.current = false
      clearTimeout(timer.current)
      setLoading(false)
      return p.pauseVideo()
    }
    want.current = true
    p?.playVideo()
    setHint(false)
    setLoading(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (isPlaying.current) return
      want.current = false
      setLoading(false)
      setHint(true)
    }, 10000)
  }

  function changeVolume(d) {
    const v = Math.max(0, Math.min(100, vol.current + d))
    setVolume((vol.current = v))
    player.current?.setVolume(v)
    save('volume', v)
  }

  return (
    <div className="glass-panel rounded-3xl p-6 relative overflow-hidden flex flex-col h-[320px]">
      <div className="absolute bottom-0 left-0 w-full h-1/2 opacity-20 pointer-events-none flex items-end justify-between px-4 pb-4">
        {[8, 16, 12, 24, 10, 20, 14, 6].map((h, i) => (
          <div key={i} className="w-2 bg-lofi-primary rounded-t animate-pulse" style={{ height: h * 4, animationDelay: `${i / 10}s` }} />
        ))}
      </div>

      <div className="flex justify-between items-center mb-6 z-10">
        <h2 className="text-lg font-medium text-white flex items-center gap-2">
          <i className="fa-solid fa-headphones-simple text-lofi-primary" aria-hidden="true" /> Chill Vibes
        </h2>
        <span className="text-xs font-mono text-lofi-primary bg-lofi-primary/10 px-2 py-1 rounded-full border border-lofi-primary/20">LIVE</span>
      </div>

      <div className="grow flex items-center justify-center mb-4 z-10 animate-float">
        <div
          className={`w-24 h-24 rounded-full bg-linear-to-br from-lofi-surface to-lofi-base border-4 border-lofi-surface shadow-xl flex items-center justify-center overflow-hidden relative ${playing ? 'animate-record' : ''}`}
        >
          <div className="absolute w-20 h-20 rounded-full border border-white/5" />
          <div className="absolute w-16 h-16 rounded-full border border-white/5" />
          <div className="absolute w-12 h-12 rounded-full border border-white/5" />
          <div className="w-8 h-8 rounded-full bg-lofi-primary flex items-center justify-center z-10">
            <div className="w-2 h-2 rounded-full bg-lofi-base" />
          </div>
        </div>
      </div>

      <div className="z-10 mt-auto">
        <p className="text-sm font-medium text-white text-center mb-1">Lofi Girl Radio</p>
        <p className="text-xs text-lofi-muted text-center mb-4 truncate">beats to relax/study to</p>
        <div className="flex justify-center items-center gap-6">
          <button className="text-lofi-muted hover:text-white transition-colors" title="Volume Down" aria-label="Volume down" onClick={() => changeVolume(-10)}>
            <i className="fa-solid fa-volume-low" aria-hidden="true" />
          </button>
          <button
            className="w-12 h-12 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-all hover:scale-105 shadow-[0_0_15px_rgba(255,138,92,0.4)]"
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={toggle}
          >
            <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : playing ? 'fa-pause' : 'fa-play ml-1'}`} aria-hidden="true" />
          </button>
          <button className="text-lofi-muted hover:text-white transition-colors" title="Volume Up" aria-label="Volume up" onClick={() => changeVolume(10)}>
            <i className="fa-solid fa-volume-high" aria-hidden="true" />
          </button>
        </div>
        <p className="text-[10px] font-mono text-lofi-muted text-center mt-2" aria-live="polite">
          VOL {volume}%{hint && <span className="text-lofi-secondary"> · audio unavailable</span>}
        </p>
      </div>

      <div ref={host} className="youtube-hidden" />
    </div>
  )
}

function Weather({ status, setStatus }) {
  const [loc, setLoc] = useState(null)
  const [w, setW] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState({ state: 'idle', items: [] })
  const [active, setActive] = useState(-1)
  const ctrl = useRef(null) // AbortController of the latest search
  const debounce = useRef(null)
  const box = useRef(null)

  useEffect(() => {
    const l = load('location', null)
    const ok = l && Number.isFinite(l.lat) && Number.isFinite(l.lon) && typeof l.tz === 'string' && /^\d+$/.test(String(l.id))
    setLoc(ok ? l : DEFAULT_LOC)
  }, [])

  useEffect(() => {
    if (!loc) return
    let alive = true
    setW(null) // never show the previous city's numbers while/if this one fails
    const get = async () => {
      setStatus('loading')
      try {
        const q = new URLSearchParams({ lat: loc.lat, lon: loc.lon, tz: loc.tz, id: loc.id, name: loc.name ?? '' })
        const r = await fetch('/api/weather?' + q)
        if (!r.ok) throw new Error(r.status)
        const data = await r.json()
        if (alive) {
          setW(data)
          setStatus('ok')
        }
      } catch {
        if (alive) setStatus('error')
      }
    }
    get()
    const t = setInterval(get, 10 * 60 * 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [loc, setStatus])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => box.current?.contains(e.target) || close()
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  function close() {
    clearTimeout(debounce.current)
    debounce.current = null
    setOpen(false)
    setActive(-1)
  }

  function search(text) {
    clearTimeout(debounce.current)
    debounce.current = null
    ctrl.current?.abort()
    const t = text.trim()
    if (t.length < 2) return close()
    const c = (ctrl.current = new AbortController())
    setOpen(true)
    setActive(-1)
    setRes({ state: 'loading', items: [] })
    fetch('/api/geo?q=' + encodeURIComponent(t), { signal: c.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((items) => ctrl.current === c && setRes({ state: items.length ? 'ok' : 'empty', items }))
      .catch(() => ctrl.current === c && !c.signal.aborted && setRes({ state: 'error', items: [] }))
  }

  function pick(place) {
    ctrl.current?.abort()
    close()
    setQ('')
    setLoc(place)
    save('location', place)
  }

  function onKeyDown(e) {
    const items = open && res.state === 'ok' ? res.items : []
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return res.items.length ? setOpen(true) : search(q)
      if (items.length) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % items.length : a <= 0 ? items.length - 1 : a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // typed since the last search -> search now; otherwise pick highlighted (or first)
      if (!debounce.current && items.length) pick(items[Math.max(active, 0)])
      else search(q)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (open && e.key === 'Escape') e.stopPropagation()
      close()
    }
  }

  return (
    <div className="glass-panel rounded-3xl p-6 interactive-hover flex flex-col h-auto min-h-[320px] relative overflow-hidden">
      <div className="absolute -right-10 -top-10 w-40 h-40 bg-lofi-primary/5 rounded-full blur-2xl pointer-events-none" />

      <div ref={box} className="relative mb-5 z-20">
        <input
          type="text"
          role="combobox"
          aria-label="Search location"
          aria-expanded={open}
          aria-controls="geo-list"
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `geo-opt-${active}` : undefined}
          placeholder="Search location... (e.g., Tokyo)"
          maxLength={80}
          value={q}
          onChange={(e) => {
            const v = e.target.value
            setQ(v)
            clearTimeout(debounce.current)
            if (v.trim().length < 2) {
              ctrl.current?.abort()
              return close()
            }
            debounce.current = setTimeout(() => search(v), 300)
          }}
          onKeyDown={onKeyDown}
          className="w-full bg-lofi-base/80 border border-white/10 rounded-xl py-2.5 pl-10 pr-20 text-white placeholder:text-lofi-muted focus:outline-none focus:border-lofi-primary/50 transition-all font-mono text-sm shadow-inner"
        />
        <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-lofi-muted text-sm" aria-hidden="true" />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2" title={`weather.wliafdew.dev: ${status}`}>
          <span className="text-[9px] font-mono text-lofi-muted hidden sm:block opacity-50">
            {{ loading: 'API ...', ok: 'API OK', error: 'API ERR' }[status]}
          </span>
          <div className={`w-2 h-2 rounded-full ${DOT[status]} ${status === 'loading' ? 'animate-pulse' : ''}`} />
        </div>
        {/* stays inside the card (fits above its content), so the card's overflow-hidden never clips it */}
        <ul
          id="geo-list"
          role="listbox"
          aria-label="Locations"
          hidden={!open}
          className="absolute left-0 right-0 top-full mt-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-lofi-base/95 backdrop-blur-md shadow-xl py-1 font-mono text-sm"
        >
          {res.state === 'ok' ? (
            res.items.map((r, i) => (
              <li
                key={r.id}
                id={`geo-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={`px-3 py-2 cursor-pointer transition-colors ${i === active ? 'bg-lofi-primary/15 text-lofi-primary' : 'text-white'}`}
              >
                <div className="truncate">{r.name}</div>
                {(r.region || r.country) && (
                  <div className="text-[10px] text-lofi-muted truncate">{[r.region, r.country].filter(Boolean).join(', ')}</div>
                )}
              </li>
            ))
          ) : (
            <li role="option" aria-selected={false} aria-disabled="true" className={`px-3 py-2 text-xs ${res.state === 'error' ? 'text-lofi-secondary' : 'text-lofi-muted'}`}>
              {{ loading: 'Searching…', empty: 'No places found', error: 'Search unavailable' }[res.state]}
            </li>
          )}
        </ul>
      </div>

      <div className="flex justify-between items-start mb-4 z-10">
        <div className="min-w-0">
          <h2 className="text-xs text-lofi-text/80 mb-1 uppercase tracking-wider font-mono">Current Conditions</h2>
          <h3 className="text-xl font-medium text-white truncate max-w-[180px]" title={w?.name || loc?.name}>
            {w?.name || loc?.name || ' '}
          </h3>
        </div>
        <div className={`text-5xl ${ICON_COLOR[w?.icon] ?? 'text-white'} drop-shadow-[0_0_15px_currentColor] transition-all duration-500`}>
          <i className={`fa-solid ${w?.icon ?? 'fa-cloud'}`} aria-hidden="true" />
        </div>
      </div>

      <div className="mb-6 z-10">
        <div className="text-6xl font-light text-white mb-1 tracking-tighter leading-none">
          {w?.temp ?? '--'}
          <span className="text-2xl text-lofi-muted font-normal">°C</span>
        </div>
        <div className="text-sm text-lofi-primary font-medium mt-2">
          {w?.desc ?? (status === 'error' ? 'Weather unavailable' : 'Loading...')}
          {w && <span className="text-lofi-muted font-normal"> · feels like {w.feelsLike}°</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-auto z-10">
        <Stat icon="fa-cloud-rain text-lofi-secondary" label="Rain Chance" value={w?.rainChance != null ? `${w.rainChance}%` : '--'} />
        <Stat icon="fa-sun text-lofi-highlight" label="UV Index" value={w?.uv != null ? `${w.uv} (${w.uvLabel})` : '--'} />
        <Stat icon="fa-droplet text-blue-400" label="Humidity" value={w ? `${w.humidity}%` : '--'} />
        <Stat icon="fa-wind text-gray-400" label="Wind" value={w ? `${w.wind} km/h` : '--'} />
      </div>
    </div>
  )
}

// pct (0-100 or null) adds a thin bar; omit it for a plain tile
// CSS-only lofi night sky (gradient, twinkling pixel stars, glowing moon): the backdrop while a scene loads and the
// fallback when it can't load.
function NightSky() {
  return (
    <div className="night-sky fixed inset-0" aria-hidden="true">
      <div className="night-stars absolute inset-0" />
      <div className="night-stars night-stars-2 absolute inset-0" />
      <div className="absolute top-[5%] right-[4%] w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-lofi-highlight shadow-[0_0_60px_20px_rgba(252,227,138,0.35)] motion-safe:animate-float" />
    </div>
  )
}

// Pixel-sharp scene: redraws each video frame onto a device-resolution canvas with smoothing off, the way
// loficities draws its own canvas. Browsers smooth a scaled <video> (Chrome ignores image-rendering on video),
// which blurs pixel edges on 4K. The <video> underneath stays as the fallback and the frame source.
function SceneCanvas({ id, videoRef, reduced, onFail }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current, g = c.getContext('2d'), v = videoRef.current
    if (!g || !v) return
    const poster = new Image()
    poster.src = `${SCENES_URL}/${id}.webp`
    let src = poster, handle = 0, running = false
    const draw = () => {
      const w = src.videoWidth || src.naturalWidth, h = src.videoHeight || src.naturalHeight
      if (!w) return
      const k = Math.max(c.width / w, c.height / h) // object-fit: cover
      g.imageSmoothingEnabled = false
      g.drawImage(src, (c.width - w * k) / 2, (c.height - h * k) / 2, w * k, h * k)
    }
    const fit = () => {
      c.width = Math.round(innerWidth * devicePixelRatio)
      c.height = Math.round(innerHeight * devicePixelRatio)
      draw()
    }
    const rvfc = 'requestVideoFrameCallback' in v
    const tick = () => {
      draw()
      handle = rvfc ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick) // rVFC: only on new frames
    }
    const onPlaying = () => {
      src = v
      if (!running) (running = true), tick()
    }
    poster.onload = () => src === poster && draw()
    // fallback: both video sources failed (404, host down), or, when motion is reduced (no video), the poster failed
    const fail = () => onFail()
    const lastSource = v.querySelector('source:last-of-type')
    lastSource?.addEventListener('error', fail)
    if (reduced) poster.onerror = fail
    fit()
    addEventListener('resize', fit)
    v.addEventListener('playing', onPlaying)
    if (!v.paused && v.readyState > 2) onPlaying()
    return () => {
      removeEventListener('resize', fit)
      v.removeEventListener('playing', onPlaying)
      lastSource?.removeEventListener('error', fail)
      rvfc ? v.cancelVideoFrameCallback(handle) : cancelAnimationFrame(handle)
    }
  }, [id, videoRef])
  return <canvas ref={ref} className="fixed inset-0 w-full h-full" aria-hidden="true" />
}

function Stat({ icon, label, value, pct }) {
  return (
    <div className="bg-lofi-surface/50 p-3 rounded-xl border border-white/5 flex items-center gap-3 hover:bg-lofi-surface transition-colors">
      <i className={`fa-solid ${icon} text-lg`} aria-hidden="true" />
      <div className="min-w-0 grow">
        <div className="text-[10px] text-lofi-muted font-mono uppercase tracking-wider">{label}</div>
        <div className="text-sm text-white font-medium truncate">{value}</div>
        {pct !== undefined && (
          <div className="h-1 mt-1.5 rounded-full bg-lofi-base/60 overflow-hidden" aria-hidden="true">
            <div className={`h-full rounded-full transition-all duration-500 ${pct > 85 ? 'bg-lofi-secondary' : 'bg-lofi-primary'}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

function Hub({ status }) {
  const [latency, setLatency] = useState(null)

  useEffect(() => {
    const ping = async () => {
      const t0 = performance.now()
      try {
        await fetch('/api/health', { cache: 'no-store' })
        setLatency(Math.round(performance.now() - t0))
      } catch {
        setLatency(null)
      }
    }
    ping()
    const t = setInterval(ping, 30000)
    return () => clearInterval(t)
  }, [])

  const [label, color] = { loading: ['Checking', 'text-gray-400'], ok: ['Online', 'text-green-400'], error: ['Offline', 'text-red-400'] }[status]

  return (
    <div className="glass-panel rounded-3xl p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-r from-lofi-surface/0 via-lofi-surface/20 to-lofi-surface/0 animate-shimmer pointer-events-none" />
      <div className="z-10">
        <h2 className="text-xl font-medium text-white flex items-center gap-3">
          <i className="fa-solid fa-network-wired text-lofi-primary" aria-hidden="true" /> Home Services Hub
        </h2>
        <p className="text-sm text-lofi-muted mt-1 font-mono">Gateway: home.wliafdew.dev</p>
      </div>
      <div className="flex gap-4 z-10">
        <div className="text-center px-4 py-2 bg-lofi-base/50 rounded-xl border border-white/5 shadow-inner" title="Weather API proxy status">
          <div className="text-[10px] text-lofi-muted font-mono uppercase">System Status</div>
          <div className={`text-sm ${color} font-medium flex items-center gap-1.5 justify-center mt-0.5`}>
            <div className={`w-1.5 h-1.5 rounded-full ${DOT[status]}`} /> {label}
          </div>
        </div>
        <div className="text-center px-4 py-2 bg-lofi-base/50 rounded-xl border border-white/5 shadow-inner hidden sm:block" title="Round-trip to /api/health">
          <div className="text-[10px] text-lofi-muted font-mono uppercase">Latency</div>
          <div className="text-sm text-white font-medium mt-0.5">{latency == null ? '--' : `${latency}ms`}</div>
        </div>
      </div>
    </div>
  )
}

const TABS = ['All', ...SERVICES.map((g) => g.section), 'Internal']
// staggered rise-in for everything marked data-anim inside el
function enter(el) {
  el.querySelectorAll('[data-anim]').forEach((c, i) =>
    c.animate([{ opacity: 0, transform: 'translateY(16px) scale(0.95)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], {
      duration: 420,
      delay: 60 + Math.min(i, 12) * 45,
      easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)', // slight overshoot, like GSAP back.out
      fill: 'backwards',
    }),
  )
}
const TAB_ICON = { All: 'fa-border-all', Sites: 'fa-globe', Apps: 'fa-cubes', Developer: 'fa-code', Contact: 'fa-address-card', Entertainment: 'fa-gamepad', Internal: 'fa-lock' }
// Painted-stroke edges: straight on the left, torn on the right (two layers give the rough brush look)
const BRUSH = 'polygon(0% 6%, 93% 0%, 100% 22%, 95% 44%, 99% 66%, 93% 100%, 1% 94%)'
const BRUSH_2 = 'polygon(2% 0%, 97% 10%, 92% 34%, 100% 58%, 96% 88%, 88% 96%, 0% 100%)'

// Hosted Applications with a group picker. Internal = /api/private services: shown when unlocked, sign-in prompt when locked.
function Services({ priv }) {
  const [tab, setTab] = useState('Sites')
  const [health, setHealth] = useState({}) // public up/down for the Apps section
  const box = useRef(null)
  useEffect(() => {
    const get = () => fetch('/api/status').then((r) => r.json()).then(setHealth, () => {})
    get()
    const t = setInterval(get, 60_000)
    return () => clearInterval(t)
  }, [])
  const run = useRef(0) // bumps on every click so a stale sequence stops when a newer one starts
  useEffect(() => {
    const t = load('tab', 'Sites')
    if (TABS.includes(t)) setTab(t)
  }, [])

  // GSAP-style timeline with the native Web Animations API (no library):
  // old cards stagger out -> swap -> panel height tweens -> new cards stagger in.
  async function pick(t) {
    if (t === tab) return
    save('tab', t)
    const el = box.current
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return setTab(t)
    const id = ++run.current
    el.getAnimations({ subtree: true }).forEach((a) => a.cancel())
    const h0 = el.offsetHeight
    const out = [...el.querySelectorAll('[data-anim]')]
    await Promise.all(
      out.map((c, i) =>
        c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px) scale(0.96)', filter: 'blur(3px)' }], {
          duration: 160,
          delay: Math.min(i, 8) * 18,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'forwards',
        }).finished.catch(() => {}),
      ),
    )
    if (id !== run.current) return
    flushSync(() => setTab(t))
    el.getAnimations({ subtree: true }).forEach((a) => a.cancel())
    const h1 = el.offsetHeight
    el.style.overflow = 'clip' // only while the height tweens
    el.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
      .finished.catch(() => {})
      .then(() => id === run.current && (el.style.overflow = ''))
    enter(el)
  }
  useEffect(() => {
    // next frame, so the tab restored from localStorage has rendered first
    const f = requestAnimationFrame(() => box.current && !matchMedia('(prefers-reduced-motion: reduce)').matches && enter(box.current))
    return () => cancelAnimationFrame(f)
  }, [])

  const groups = [...SERVICES, ...(priv?.services?.length ? [{ section: 'Internal', items: priv.services }] : [])]
  const shown = tab === 'All' ? groups : groups.filter((g) => g.section === tab)
  const locked = priv === null
  const count = (t) => (t === 'All' ? groups : groups.filter((g) => g.section === t)).reduce((a, g) => a + g.items.length, 0)
  let n = 0
  return (
    // lg: tab stack on the panel's right edge; the selected tab sticks out past the border like a bookmark. pr-44 keeps cards clear of it (~1/4 of the panel)
    <div className="glass-panel rounded-3xl p-6 grow flex flex-col relative lg:pr-44 lg:min-h-[24rem]">
      <div className="mb-6">
        <h3 className="text-sm font-mono text-lofi-text/80 uppercase tracking-widest flex items-center gap-2">
          <i className="fa-solid fa-server text-xs" aria-hidden="true" /> Hosted Applications
        </h3>
        <p key={tab} className="mt-2 text-[11px] font-mono text-lofi-muted motion-safe:animate-card-in">
          <span className="text-lofi-primary">{tab}</span> ·{' '}
          {tab === 'Internal' && locked ? 'locked' : `${String(count(tab)).padStart(2, '0')} apps`}
        </p>
      </div>
      <div
        role="group"
        aria-label="Choose a group"
        className="flex flex-wrap gap-x-1 gap-y-1.5 mb-5 lg:mb-0 lg:absolute lg:top-24 lg:right-0 lg:w-40 lg:flex-col lg:gap-1.5 z-20"
      >
        {TABS.map((t) => {
          const on = tab === t
          const icon = t === 'Internal' && !locked ? 'fa-lock-open' : TAB_ICON[t]
          return (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              aria-pressed={on}
              className={`group/tab relative isolate -rotate-3 h-8 lg:h-9 pl-2.5 pr-4 lg:pl-3 lg:pr-5 flex items-center gap-2 font-mono font-bold uppercase text-[10px] tracking-[0.08em] transition-all duration-200 ease-out ${
                on ? 'text-lofi-base lg:translate-x-4 motion-safe:animate-tilt drop-shadow-[0_4px_10px_rgba(255,138,92,0.35)]' : 'text-lofi-muted hover:text-white lg:hover:translate-x-1'
              }`}
            >
              {on ? (
                <>
                  {/* back stroke: offset, highlight-tinted; front stroke: primary -> secondary */}
                  <span aria-hidden="true" className="absolute inset-0 -z-10 translate-x-1 translate-y-1 bg-lofi-highlight/70 origin-left motion-safe:animate-brush" style={{ clipPath: BRUSH_2 }} />
                  <span aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-lofi-primary to-lofi-secondary origin-left motion-safe:animate-brush" style={{ clipPath: BRUSH }} />
                </>
              ) : (
                <span aria-hidden="true" className="absolute inset-0 -z-10 bg-white/5 opacity-0 group-hover/tab:opacity-100 transition-opacity" style={{ clipPath: BRUSH }} />
              )}
              <i className={`fa-solid ${icon} w-3.5 text-center ${on ? '' : 'text-lofi-primary/70 group-hover/tab:text-lofi-primary'}`} aria-hidden="true" />
              <span className="truncate">{t}</span>
              <span className={`ml-auto pl-1.5 text-[9px] tabular-nums ${on ? 'opacity-70' : 'opacity-50'} hidden lg:inline`}>
                {t === 'Internal' && locked ? '--' : String(count(t)).padStart(2, '0')}
              </span>
            </button>
          )
        })}
      </div>
      <div ref={box} className="space-y-6">
        {shown.map(({ section, items }) => (
          <section key={section}>
            {tab === 'All' && <h4 data-anim className="text-[10px] font-mono text-lofi-text/80 uppercase tracking-widest mb-3">{section}</h4>}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {items.map((s) => (
                <ServiceCard
                  key={s.name + s.href}
                  s={s}
                  accent={ACCENTS[n++ % ACCENTS.length]}
                  live={s.live ?? (s.status && health[s.status])}
                  stats={s.stats ?? (s.widget && priv?.widgets?.[s.widget])}
                />
              ))}
            </div>
          </section>
        ))}
        {tab === 'Internal' && locked && (
          <div data-anim className="flex flex-col items-center text-center gap-4 py-12">
            <div className="w-14 h-14 rounded-2xl bg-lofi-surface flex items-center justify-center border border-white/5">
              <i className="fa-solid fa-lock text-2xl text-lofi-primary" aria-hidden="true" />
            </div>
            <p className="text-sm text-lofi-muted">Internal apps are private. Sign in to see them.</p>
            <a
              href={`${AUTH_URL}/?rd=${encodeURIComponent(location.href)}`}
              className="text-xs font-mono text-lofi-primary bg-lofi-primary/10 hover:bg-lofi-primary/20 px-4 py-2 rounded-full border border-lofi-primary/20 transition-colors"
            >
              Sign in
            </a>
          </div>
        )}
        {tab === 'Internal' && priv?.services?.length === 0 && <p className="text-sm text-lofi-muted text-center py-12">No internal apps configured.</p>}
      </div>
    </div>
  )
}

// Passbolt's card: no stats to show (its API needs an admin GPG key), so a sealed "password" that now and then
// scrambles into a cheeky message and re-seals. Pure decoration.
const SECRET_MSGS = ['NICE TRY', 'NO PEEKING', 'TOP SECRET', 'ENCRYPTED', 'SEALED', 'NOT TODAY']
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*@!?'
const SEAL = '•'.repeat(12)
const framed = (m) => ('•'.repeat(Math.floor((12 - m.length) / 2)) + m).padEnd(12, '•')
function Secret() {
  const [text, setText] = useState(SEAL)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timers = []
    let k = Math.floor(Math.random() * SECRET_MSGS.length)
    // decrypt-style: characters settle left to right, the rest keep flickering
    const scramble = (to, ms, done) => {
      const t0 = Date.now()
      const id = setInterval(() => {
        const p = (Date.now() - t0) / ms
        if (p >= 1) return clearInterval(id), setText(to), done?.()
        setText([...to].map((c, i) => (i / to.length < p ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(''))
      }, 50)
      timers.push(id)
    }
    const cycle = () => {
      setBusy(true)
      scramble(framed(SECRET_MSGS[k++ % SECRET_MSGS.length]), 700, () =>
        timers.push(setTimeout(() => scramble(SEAL, 450, () => setBusy(false)), 1600)),
      )
    }
    timers.push(setInterval(cycle, 6500), setTimeout(cycle, 1500 + Math.random() * 2000))
    return () => timers.forEach((t) => (clearInterval(t), clearTimeout(t)))
  }, [])
  return (
    <div className="z-10 w-full flex items-center justify-center gap-2 bg-lofi-base/60 border border-white/5 rounded-lg px-2 py-1.5" aria-label="Vault sealed">
      <i className={`fa-solid ${busy ? 'fa-lock-open text-lofi-primary motion-safe:animate-wiggle' : 'fa-lock text-lofi-highlight'} text-[11px] w-3`} aria-hidden="true" />
      <span className={`font-mono text-[11px] tracking-[0.18em] whitespace-pre transition-colors ${busy ? 'text-lofi-primary' : 'text-lofi-muted'}`} aria-hidden="true">
        {text}
      </span>
    </div>
  )
}

function ServiceCard({ s, accent, live, stats }) {
  return (
    <a
      href={s.href}
      target="_blank"
      rel="noopener noreferrer"
      data-anim
      className="bg-lofi-base/40 hover:bg-lofi-surface border border-white/5 hover:border-lofi-primary/40 p-5 rounded-2xl transition-all duration-300 group flex flex-col items-center text-center gap-3 relative overflow-hidden backdrop-blur-sm"
    >
      <div className="absolute inset-0 bg-linear-to-b from-lofi-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div
        className={`w-14 h-14 rounded-2xl bg-lofi-surface flex items-center justify-center ${accent} group-hover:scale-110 group-hover:-translate-y-1 transition-all duration-300 shadow-lg group-hover:shadow-[0_0_20px_rgba(255,138,92,0.4)] z-10 border border-white/5`}
      >
        {s.fa ? (
          <i className={`${s.fa} text-2xl`} aria-hidden="true" />
        ) : (
          <img src={s.icon} alt="" width={32} height={32} loading="lazy" className="w-8 h-8 object-contain" />
        )}
      </div>
      <div className="z-10 mt-1 w-full min-w-0">
        <div className="text-sm font-medium text-white group-hover:text-lofi-primary transition-colors">{s.name}</div>
        <div className="text-[10px] text-lofi-muted mt-1 font-mono tracking-tight truncate">{new URL(s.href).hostname}</div>
        {live && (
          <div className={`mt-1.5 text-[10px] font-mono flex items-center justify-center gap-1.5 ${live.up ? 'text-emerald-400' : 'text-lofi-secondary'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${live.up ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-lofi-secondary'}`} aria-hidden="true" />
            {live.up ? `Online${live.ms != null ? ` · ${live.ms} ms` : ''}` : 'Down'}
          </div>
        )}
      </div>
      {s.secret && <Secret />}
      {/* live widget numbers (internal services only, from /api/private) */}
      {Array.isArray(stats) && (
        <dl className="z-10 w-full grid grid-cols-2 gap-1.5">
          {stats.map(([label, value]) => (
            <div key={label} className="bg-lofi-base/60 border border-white/5 rounded-lg px-1.5 py-1 min-w-0 odd:last:col-span-2">
              <dt className="text-[9px] font-mono uppercase tracking-wider text-lofi-muted truncate">{label}</dt>
              <dd className="text-xs font-medium text-white tabular-nums truncate">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </a>
  )
}

const GB = 2 ** 30
const pctOf = (x) => (x?.total ? Math.round((x.used / x.total) * 100) : null)
const gb = (x) => (x ? `${(x.used / GB).toFixed(1)} / ${(x.total / GB).toFixed(1)} GB` : '--')
function dur(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

// /api/private data, or null when locked. The proxy + Authelia decide who gets a 200.
function usePrivate() {
  const [d, setD] = useState(undefined) // undefined = loading, null = locked

  useEffect(() => {
    let alive = true, ok = false
    const get = async () => {
      let r
      try {
        r = await fetch('/api/private', { redirect: 'manual', cache: 'no-store' })
        if (r.status !== 200) throw new Error(r.status)
        const data = await r.json()
        ok = true
        if (alive) setD(data)
      } catch {
        if (ok && !r) return // network blip mid-session: keep last stats, try again next tick
        clearInterval(t) // stop polling after any non-200 (e.g. login expired -> redirect)
        if (alive) setD(null)
      }
    }
    const t = setInterval(() => document.visibilityState === 'visible' && get(), 5000)
    get()
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  return d
}

// Left column: host stats when unlocked, otherwise a small sign-in card. Internal services render inside Services.
function Server({ d }) {
  if (d === undefined) return null
  const here = encodeURIComponent(location.href)

  if (!d) {
    return (
      <div className="glass-panel rounded-2xl px-5 py-3 flex items-center justify-between gap-4">
        <p className="text-xs font-mono text-lofi-muted flex items-center gap-3 min-w-0">
          <i className="fa-solid fa-lock text-lofi-primary" aria-hidden="true" />
          <span className="truncate">Server &amp; internal apps</span>
        </p>
        <a
          href={`${AUTH_URL}/?rd=${here}`}
          aria-label="Sign in to see server status and internal services"
          className="shrink-0 text-xs font-mono text-lofi-primary bg-lofi-primary/10 hover:bg-lofi-primary/20 px-3 py-1.5 rounded-full border border-lofi-primary/20 transition-colors"
        >
          Sign in
        </a>
      </div>
    )
  }

  const { stats: st = {}, user } = d
  return (
    <div className="glass-panel rounded-3xl p-6 flex flex-col gap-5">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h3 className="text-sm font-mono text-lofi-text/80 uppercase tracking-widest flex items-center gap-2">
          <i className="fa-solid fa-microchip text-xs" aria-hidden="true" /> Server
        </h3>
        <p className="text-[10px] font-mono text-lofi-muted">
          up {st.uptime == null ? '--' : dur(st.uptime)} · load {st.load ? st.load.map((n) => n.toFixed(2)).join(' ') : '--'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat icon="fa-gauge text-lofi-primary" label="CPU" value={st.cpu == null ? '--' : `${st.cpu}%`} pct={st.cpu} />
        <Stat icon="fa-memory text-blue-400" label={`RAM ${pctOf(st.mem) ?? '--'}%`} value={gb(st.mem)} pct={pctOf(st.mem)} />
        <Stat icon="fa-temperature-half text-lofi-secondary" label="Temp" value={st.temp == null ? 'n/a' : `${st.temp}°C`} pct={st.temp} />
        <Stat icon="fa-hard-drive text-emerald-400" label={`Disk ${pctOf(st.disk) ?? '--'}%`} value={gb(st.disk)} pct={pctOf(st.disk)} />
      </div>
      {user && (
        <p className="text-[10px] font-mono text-lofi-muted">
          signed in as <span className="text-white">{user}</span> ·{' '}
          <a href={`${AUTH_URL}/logout?rd=${here}`} className="text-lofi-primary hover:underline">
            sign out
          </a>
        </p>
      )}
    </div>
  )
}
