'use client'

import { useContext, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AUTH_URL, SCENES, SCENES_URL, SERVICES } from '../lib/data'
import { DEFAULTS, SETTINGS_KEY, clockParts, parseSettings, sceneName, sceneWeather, themeColors, toUnit } from '../lib/settings'
import { AQI_BANDS, aqiBand, aqiPos, chartPoints, memoCache, spread } from '../lib/weather'
import { useCloudSync } from './cloud'
import { Gallery, LockLook, Prefs, Settings, closeDialog, load, motionOff, randomScene, save } from './settings'

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

// ponytail: details-panel responses per location for 10 min (same as the server revalidate), lost on reload
const detailCache = memoCache(20, 10 * 60 * 1000)
const locQuery = (l) => new URLSearchParams({ lat: l.lat, lon: l.lon, tz: l.tz, id: l.id, name: l.name ?? '' })
// Settings > Dim scene: 50 = the original overlay (75 / 45 / 85 % of the base color), 0 = bare scene, 100 = ~opaque
function dimOverlay(dim) {
  const a = (p) => Math.min(100, Math.round((p * dim) / 50))
  const stop = (p) => `color-mix(in oklab, var(--color-lofi-base) ${a(p)}%, transparent)`
  return `linear-gradient(to bottom, ${stop(75)}, ${stop(45)}, ${stop(85)})`
}


export default function Home() {
  const [now, setNow] = useState(null)
  const [scene, setScene] = useState(null)
  const [settings, setSettings] = useState(null) // null until read from localStorage (after hydration)
  const [sysReduced, setSysReduced] = useState(false)
  const set = settings ?? DEFAULTS
  const reduced = set.motion === 'reduce' || sysReduced
  const [focus, setFocus] = useState(false)
  const [idle, setIdle] = useState(false)
  const idleRef = useRef(false)
  // Soft lock: the clock screen stays until the unlock pill is held. In memory only, so a reload always opens unlocked.
  const [softLock, setSoftLock] = useState(false)
  const lockRef = useRef(false)
  lockRef.current = softLock
  const wakeRef = useRef(set.idleWake) // read by the idle timer without restarting it
  wakeRef.current = set.idleWake
  const [status, setStatus] = useState('loading')
  const priv = usePrivate()
  const spotify = useSpotify()
  const videoRef = useRef(null)
  const setDlg = useRef(null)
  const galDlg = useRef(null)
  const [wx, setWx] = useState() // the Weather card's /api/weather data: undefined = loading, null = failed
  const [cloudLoc, setCloudLoc] = useState(null) // a weather location picked on another device (cloud sync)
  // owner-only cloud sync (app/cloud.js): it saves remote changes to localStorage, this puts them on screen
  const cloud = useCloudSync((keys) => {
    if (keys.some((k) => k.startsWith('settings.'))) {
      // colors cross-fade instead of jumping (html[data-fade] in globals.css)
      const html = document.documentElement
      html.dataset.fade = ''
      setTimeout(() => delete html.dataset.fade, 800)
      let raw
      try {
        raw = localStorage.getItem(SETTINGS_KEY)
      } catch {}
      setSettings(parseSettings(raw))
    }
    if (keys.includes('scene') && set.onLoad === 'keep') setScene(load('scene', 'london'))
    if (keys.includes('location')) setCloudLoc(load('location', null))
  }, setDlg)
  const music = useRef(null) // Music's toggle(), so the focus bar can drive the same player
  const [tune, setTune] = useState({ playing: false, loading: false }) // Music's state, mirrored for the focus bar
  // Scene weather: the wanted variant (null = Live, still waiting for the weather), and the one actually shown.
  // A variant that failed to load falls back to the signature files for that scene.
  // ponytail: failures are remembered until reload, so variants uploaded later show up after a refresh
  const [badVariants, setBadVariants] = useState(() => new Set())
  const wantMode = set.weather !== 'live' ? set.weather : wx === undefined ? null : sceneWeather(wx?.code)
  const mode = wantMode && badVariants.has(`${wantMode}/${scene}`) ? 'signature' : wantMode
  const base = scene && mode && (mode === 'signature' ? `${SCENES_URL}/${scene}` : `${SCENES_URL}/${mode}/${scene}`)
  const [sceneDown, setSceneDown] = useState(false) // signature files missing / host down -> night sky fallback
  useEffect(() => setSceneDown(false), [base])
  const onSceneFail = (m) => (m === 'signature' ? setSceneDown(true) : setBadVariants((b) => new Set(b).add(`${m}/${scene}`)))

  useEffect(() => {
    let raw
    try {
      raw = localStorage.getItem(SETTINGS_KEY)
    } catch {}
    const st = parseSettings(raw)
    setSettings(st)
    const s = load('scene', 'london')
    // On load: Random picks a new scene each visit without overwriting the saved one
    setScene(st.onLoad === 'random' ? randomScene(s) : SCENES.includes(s) ? s : 'london')
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => setSysReduced(mq.matches)
    onMq()
    mq.addEventListener('change', onMq)
    // right away (not after the re-render), so mount-time animations below already see it
    document.documentElement.dataset.motion = st.motion === 'reduce' || mq.matches ? 'reduce' : ''
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    const onKey = (e) => e.key === 'Escape' && !lockRef.current && setFocus(false)
    addEventListener('keydown', onKey)
    return () => {
      clearInterval(t)
      removeEventListener('keydown', onKey)
      mq.removeEventListener('change', onMq)
    }
  }, [])

  // one reduced-motion switch for everything: CSS ([data-motion] rule in globals.css), motionOff(), Prefs
  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.motion = reduced ? 'reduce' : ''
    const v = videoRef.current
    if (v) reduced ? v.pause() : v.play().catch(() => {})
  }, [settings, reduced])

  // Screensaver (Settings > Screensaver after): after N s without input the dashboard fades + blurs away (like Hide);
  // any input brings it back. With Wake with: Hold to unlock it locks instead (the soft lock below).
  // Never while a dialog or the location dropdown is open, or with text typed in a field.
  useEffect(() => {
    if (!set.idle) return
    let last = Date.now()
    const busy = () => {
      const a = document.activeElement
      return document.querySelector('dialog[open], [role="combobox"][aria-expanded="true"]') || (a?.matches('input[type="text"], input[type="search"], textarea') && a.value)
    }
    const wake = (e) => {
      if (e.type === 'pointermove' && !e.movementX && !e.movementY) return // synthetic moves from layout changes
      last = Date.now()
      if (!idleRef.current) return
      idleRef.current = false
      setIdle(false)
      // the waking key doesn't also act: not on a focused card (Enter), not on our own listeners (Esc would leave Hide)
      if (e.type === 'keydown') e.preventDefault(), e.stopPropagation()
      if (e.type === 'pointerdown') {
        // swallow the click that ends this tap/press, so it doesn't land on a card that just reappeared
        const eat = (ev) => (ev.preventDefault(), ev.stopPropagation())
        addEventListener('click', eat, { capture: true, once: true })
        setTimeout(() => removeEventListener('click', eat, true), 800)
      }
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel']
    events.forEach((n) => addEventListener(n, wake, { capture: true, passive: n !== 'keydown' }))
    const t = setInterval(() => {
      if (idleRef.current) return
      if (lockRef.current) return void (last = Date.now())
      if (busy()) last = Date.now()
      else if (Date.now() - last >= set.idle * 1000) wakeRef.current === 'hold' ? lock() : setIdle((idleRef.current = true))
    }, 1000)
    return () => {
      clearInterval(t)
      events.forEach((n) => removeEventListener(n, wake, { capture: true }))
      setIdle((idleRef.current = false))
    }
  }, [set.idle])

  // theme = the three @theme color variables, overridden on <html>
  useEffect(() => {
    if (!settings) return
    const [a, b, c] = themeColors(settings)
    const st = document.documentElement.style
    st.setProperty('--color-lofi-primary', a)
    st.setProperty('--color-lofi-secondary', b)
    st.setProperty('--color-lofi-highlight', c)
    // the tab icon too (app/icon.svg with the accent dot)
    const icon = document.querySelector('link[rel="icon"]')
    if (icon) icon.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#1a1a2e"/><circle cx="16" cy="16" r="10" fill="#2a2a4a"/><circle cx="16" cy="16" r="5" fill="${a}"/><circle cx="16" cy="16" r="1.5" fill="#1a1a2e"/></svg>`)}`
  }, [settings])

  function lock() {
    ;[setDlg.current, galDlg.current].forEach((d) => d?.open && d.close()) // nothing left open behind the lock
    document.activeElement?.blur()
    setSoftLock(true)
  }
  function unlock() {
    // swallow the click that may follow the hold, so it doesn't land on a card that just reappeared
    const eat = (ev) => (ev.preventDefault(), ev.stopPropagation())
    addEventListener('click', eat, { capture: true, once: true })
    setTimeout(() => removeEventListener('click', eat, true), 800)
    idleRef.current = false
    setIdle(false)
    setSoftLock(false)
  }
  useEffect(() => {
    // H toggles Hide, L locks (not while typing, not with a dialog open, not while locked)
    const onKey = (e) => {
      const k = e.key.toLowerCase()
      if (k !== 'h' && k !== 'l') return
      if (e.ctrlKey || e.metaKey || e.altKey || lockRef.current) return
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return
      e.preventDefault()
      k === 'l' ? lock() : setFocus((f) => !f)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  function update(patch) {
    const next = { ...set, ...patch }
    setSettings(next)
    save('settings', next)
    cloud.touch(Object.keys(patch).map((k) => `settings.${k}`))
  }
  function openGallery() {
    const d = galDlg.current
    if (d.open) return
    d.showModal()
    const cur = d.querySelector('[aria-current]') // start on the current scene
    cur?.focus({ preventScroll: true })
    cur?.scrollIntoView({ block: 'center' })
  }
  function pickScene(id) {
    setScene(id)
    save('scene', id)
    cloud.touch(['scene'])
    closeDialog(galDlg.current)
  }
  function reset() {
    setSettings(DEFAULTS)
    try {
      localStorage.removeItem(SETTINGS_KEY)
    } catch {}
    cloud.touch(Object.keys(DEFAULTS).map((k) => `settings.${k}`))
  }

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
    <Prefs value={{ ...set, reduced }}>
      {/* Night sky: shows while the scene loads, and stays as the fallback if it can't load */}
      <NightSky />
      {/* Full-screen animated scene (decorative) */}
      {base && !sceneDown && (
        <SceneCanvas key={scene} base={base} mode={mode} videoRef={videoRef} reduced={reduced} onFail={onSceneFail} />
      )}
      <div
        className={`fixed top-0 left-0 w-full h-lvh pointer-events-none transition-opacity duration-500 ${focus || idle || softLock ? 'opacity-0' : ''}`}
        style={{ background: dimOverlay(set.dim) }}
      />

      <div
        className={`relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-24 min-h-screen flex flex-col transition-[opacity,filter,visibility] duration-700 ${focus || idle || softLock ? 'opacity-0 invisible' : ''} ${idle || softLock ? 'blur-md' : ''}`}
      >
        {/* phones: greeting, then clock | scene + focus + settings on one row. sm+: one row (also landscape phones) */}
        <header className="flex flex-col sm:flex-row sm:flex-wrap lg:flex-nowrap justify-between items-stretch sm:items-center gap-4 mb-8 glass-panel rounded-2xl p-4 sm:p-6">
          <div className="flex items-center gap-4 min-w-0">
            <div className={`w-12 h-12 shrink-0 rounded-full bg-linear-to-tr ${iconBg} flex items-center justify-center text-xl shadow-lg`}>
              {icon && <i className={`fa-solid ${icon} text-white`} aria-hidden="true" />}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{greeting}</h1>
              <p className="text-sm text-lofi-muted font-mono text-balance">Welcome to your space.</p>
            </div>
          </div>
          <NowPlaying sp={spotify} now={now} />
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
              onClick={openGallery}
              aria-haspopup="dialog"
              aria-label={`Background scene: ${sceneName(scene ?? 'london')}${sceneDown ? ' (could not load)' : ''}. Choose a scene`}
              title={sceneDown ? 'Scene could not load, showing the night sky' : 'Choose a scene'}
              className="order-2 sm:order-none ml-auto sm:ml-0 min-w-0 h-8 flex items-center gap-2 bg-lofi-base/50 border border-white/5 rounded-full pl-2.5 pr-2 sm:pl-3 sm:pr-2.5 text-xs font-mono text-lofi-muted hover:text-white hover:border-white/20 transition-colors"
            >
              {sceneDown ? (
                <i className="fa-solid fa-moon text-lofi-highlight" aria-hidden="true" />
              ) : (
                <span className="hidden sm:inline">
                  <i className="fa-solid fa-image" aria-hidden="true" />
                </span>
              )}
              {/* phones: the moon (+ the title) says it */}
              {sceneDown && <span className="hidden sm:inline text-[10px] text-red-400">offline</span>}
              <span className="min-w-0 sm:max-w-28 truncate text-white">{sceneName(scene ?? 'london')}</span>
              <span className="max-sm:hidden text-[9px]" aria-hidden="true">
                <i className="fa-solid fa-chevron-down" />
              </span>
            </button>
            <button
              onClick={() => setFocus(true)}
              aria-label="Hide panels (H)"
              title="Hide panels (H)"
              className="order-3 sm:order-none w-8 h-8 shrink-0 rounded-full bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
            >
              <i className="fa-solid fa-eye-slash text-xs" aria-hidden="true" />
            </button>
            <button
              onClick={lock}
              aria-label="Lock screen (hold to unlock)"
              title="Lock screen (L)"
              className="order-3 sm:order-none w-8 h-8 shrink-0 rounded-full bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
            >
              <i className="fa-solid fa-lock text-xs" aria-hidden="true" />
            </button>
            <button
              onClick={() => setDlg.current.open || setDlg.current.showModal()}
              aria-label="Settings"
              aria-haspopup="dialog"
              title="Settings"
              className="order-4 sm:order-none w-8 h-8 shrink-0 rounded-full bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
            >
              <i className="fa-solid fa-gear text-xs" aria-hidden="true" />
            </button>
            <div className="order-1 sm:order-none shrink-0 text-left sm:text-right">
            <div className="text-3xl font-mono font-bold text-white neon-text">
              <Clock now={now} clock={set.clock} />
            </div>
            <div className="text-xs text-lofi-muted uppercase tracking-widest">
              {now?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) ?? ' '}
            </div>
            </div>
          </div>
        </header>

        <main className="grow grid grid-cols-1 lg:grid-cols-12 gap-6 lg:items-start">
          <div className="lg:col-span-4 flex flex-col gap-6">
            <Music ctl={music} onTune={setTune} />
            <Weather status={status} setStatus={setStatus} setWx={setWx} cloudLoc={cloudLoc} onPick={() => cloud.touch(['location'])} />
          </div>
          <div className="lg:col-span-8 flex flex-col gap-6">
            <Hub status={status} priv={priv} />
            <Services priv={priv} />
          </div>
        </main>
      </div>

      {(idle || softLock) && <ClockScreen now={now} set={set} />}
      {softLock && <LockPill onUnlock={unlock} set={set} update={update} />}
      {idle && !softLock && <WakeHint />}
      {/* Header is hidden in Hide, so the way back is the bar's eye button (or Esc / H); the bar can lock too */}
      {focus && !idle && !softLock && <FocusBar now={now} wx={wx} priv={priv} tune={tune} onToggle={() => music.current?.()} onShow={() => setFocus(false)} onLock={lock} />}
      <Settings dlg={setDlg} set={set} update={update} reset={reset} sync={cloud.status} scene={{ id: scene, want: wantMode, mode, from: wx?.name, open: openGallery }} />
      <Gallery dlg={galDlg} scene={scene} variant={wantMode} onPick={pickScene} />
    </Prefs>
  )
}

// '21:05', or '9:05' + a small 'PM'
function Clock({ now, clock }) {
  if (!now) return '--:--'
  const { time, ampm } = clockParts(now, clock)
  return (
    <>
      {time}
      {ampm && <span className="text-[0.45em] ml-1 align-[0.15em]">{ampm}</span>}
    </>
  )
}

// The clock screen behind Lock and Screensaver (Settings > Lock screen): blur, then overlay over the scene, then the
// clock (big / small / off) and the date. Decorative: the header clock is the accessible one.
const BLUR = { soft: 6, strong: 16 } // px. Re-blurs the moving scene every frame: GPU work, so Off by default
function ClockScreen({ now, set }) {
  const blur = BLUR[set.lockBlur]
  return (
    <div className="fixed inset-0 z-20 pointer-events-none select-none motion-safe:animate-[fade-in_1.2s_ease-out]" aria-hidden="true">
      {blur && <div className="absolute inset-0" style={{ backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)` }} />}
      {set.lockOverlay !== 'off' && <div className={`absolute inset-0 lock-overlay-${set.lockOverlay}`} />}
      {set.idleShow !== 'scene' && (
        <div className="idle-clock relative h-full flex flex-col items-center justify-center px-4 text-center">
          <div className={`font-mono font-bold text-white leading-none whitespace-nowrap ${set.idleShow === 'small' ? 'text-5xl sm:text-6xl' : 'text-7xl sm:text-9xl short:text-7xl'}`}>
            <Clock now={now} clock={set.clock} />
          </div>
          {set.lockDate && (
            <div className="mt-4 sm:mt-6 font-mono font-bold text-xs sm:text-base uppercase tracking-[0.3em] text-white/90">
              {now?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Screensaver: a faint hint in the lock pill's spot, gone after a few seconds (so the two are easy to tell apart)
function WakeHint() {
  return (
    <p
      className="fixed z-30 inset-x-0 bottom-[max(2.75rem,env(safe-area-inset-bottom))] text-center font-mono text-xs text-white/70 pointer-events-none select-none opacity-0 motion-safe:animate-[hint_4s_ease-in-out]"
      aria-hidden="true"
    >
      move to wake
    </p>
  )
}

// Soft lock's unlock control: hold ~0.8 s (pointer, or Space / Enter) so a bump, a cat or a stray key can't unlock.
// Moving the mouse only brings the pill back to full strength; it never unlocks.
// The 🎨 button next to it opens the clock screen's look (LockLook): the only settings that change while locked.
const HOLD_MS = 800
function LockPill({ onUnlock, set, update }) {
  const [holding, setHolding] = useState(false)
  const [awake, setAwake] = useState(true)
  const [look, setLook] = useState(false)
  const timer = useRef(null)
  const btn = useRef(null)
  useEffect(() => {
    btn.current?.focus({ preventScroll: true }) // keyboard users land on it
    let t
    const wake = () => {
      setAwake(true)
      clearTimeout(t)
      t = setTimeout(() => setAwake(false), 3000)
    }
    wake()
    const events = ['pointermove', 'pointerdown', 'keydown']
    events.forEach((n) => addEventListener(n, wake, { passive: true }))
    return () => {
      clearTimeout(t)
      clearTimeout(timer.current)
      events.forEach((n) => removeEventListener(n, wake))
    }
  }, [])
  const start = () => {
    if (timer.current) return
    setHolding(true)
    timer.current = setTimeout(onUnlock, HOLD_MS)
  }
  const stop = () => {
    clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  const hold = (e) => e.key === ' ' || e.key === 'Enter'
  return (
    <div
      className={`fixed z-30 inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-3 px-4 transition-opacity duration-700 ${awake || holding || look ? 'opacity-100' : 'opacity-25'}`}
    >
      {look && (
        <section
          aria-label="Lock screen look"
          onKeyDown={(e) => e.key === 'Escape' && setLook(false)}
          className="glass-panel rounded-3xl p-5 w-full max-w-md text-lofi-text motion-safe:animate-[panel-in_0.3s_cubic-bezier(0.2,0.8,0.2,1)]"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-white flex items-center gap-2">
              <i className="fa-solid fa-palette text-lofi-primary text-xs" aria-hidden="true" /> Lock screen
            </h2>
            <button
              onClick={() => setLook(false)}
              aria-label="Close"
              className="w-7 h-7 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
            >
              <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
            </button>
          </div>
          <LockLook id="lock" set={set} update={update} />
        </section>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setLook((v) => !v)}
          aria-label="Lock screen look"
          aria-expanded={look}
          title="Lock screen look"
          className={`glass-panel w-[3.25rem] h-[3.25rem] rounded-full flex items-center justify-center transition-colors ${look ? 'text-lofi-primary' : 'text-lofi-text hover:text-lofi-primary'}`}
        >
          <i className="fa-solid fa-palette text-sm" aria-hidden="true" />
        </button>
        <button
          ref={btn}
          onPointerDown={(e) => (e.currentTarget.setPointerCapture?.(e.pointerId), start())}
          onPointerUp={stop}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
          onKeyDown={(e) => hold(e) && (e.preventDefault(), e.repeat || start())}
          onKeyUp={(e) => hold(e) && stop()}
          onBlur={stop}
          onContextMenu={(e) => e.preventDefault()} // long-press on phones: no menu
          aria-label="Hold to unlock"
          className="glass-panel rounded-full pl-2 pr-5 py-2 flex items-center gap-3 font-mono text-xs text-lofi-text select-none touch-none [-webkit-touch-callout:none]"
        >
          <span className="relative w-9 h-9 flex items-center justify-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" className="stroke-white/10" />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="100"
                className="stroke-lofi-primary"
                style={{ strokeDashoffset: holding ? 0 : 100, transition: `stroke-dashoffset ${holding ? `${HOLD_MS}ms linear` : '200ms ease-out'}` }}
              />
            </svg>
            <i className={`fa-solid ${holding ? 'fa-lock-open' : 'fa-lock'} text-lofi-primary`} aria-hidden="true" />
          </span>
          {holding ? 'Keep holding…' : 'Hold to unlock'}
        </button>
      </div>
    </div>
  )
}

// Hide's mini bar: show panels + lock | music | weather | time | server. Segments without data are left out.
// Phones: labels (station, place, date) drop, below 375px the equalizer too, and the server stats get their own row.
const SEG = 'flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 border-l border-white/10'
function FocusBar({ now, wx, priv, tune, onToggle, onShow, onLock }) {
  const { unit, clock } = useContext(Prefs)
  const st = priv?.stats
  const ram = pctOf(st?.mem)
  return (
    <aside
      aria-label="Focus bar"
      className="glass-panel fixed z-20 inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto w-fit max-w-[calc(100%-2rem)] rounded-3xl sm:rounded-full p-1.5 flex flex-wrap items-center justify-center gap-y-1.5 font-mono text-sm text-white motion-safe:animate-[panel-in_0.45s_cubic-bezier(0.2,0.8,0.2,1)]"
    >
      <button
        onClick={onShow}
        aria-label="Show panels"
        title="Show panels (Esc)"
        className="w-9 h-9 shrink-0 rounded-full bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-text hover:text-lofi-primary transition-colors"
      >
        <i className="fa-solid fa-eye text-sm" aria-hidden="true" />
      </button>
      <button
        onClick={onLock}
        aria-label="Lock screen (hold to unlock)"
        title="Lock (L)"
        className="w-9 h-9 ml-1 mr-1 sm:mr-2 shrink-0 rounded-full bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-text hover:text-lofi-primary transition-colors"
      >
        <i className="fa-solid fa-lock text-xs" aria-hidden="true" />
      </button>

      <div className={SEG}>
        <button
          onClick={onToggle}
          title={tune.playing ? 'Pause' : 'Play'}
          aria-label={tune.playing ? 'Pause Lofi Girl Radio' : 'Play Lofi Girl Radio'}
          className="w-9 h-9 shrink-0 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-colors shadow-[0_0_12px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)]"
        >
          <i className={`fa-solid text-xs ${tune.loading ? 'fa-spinner fa-spin' : tune.playing ? 'fa-pause' : 'fa-play ml-0.5'}`} aria-hidden="true" />
        </button>
        <span className="max-sm:hidden font-sans text-xs text-lofi-text whitespace-nowrap">Lofi Girl Radio</span>
        {/* equalizer: dances while playing, rests low when paused (and stands still with reduced motion) */}
        <span className="max-[374px]:hidden flex items-end gap-0.5 h-4" aria-hidden="true">
          {[10, 16, 7, 13].map((h, i) => (
            <span
              key={i}
              className={`w-[3px] rounded-full bg-lofi-primary origin-bottom ${tune.playing ? 'animate-eq' : 'scale-y-30 opacity-60'}`}
              style={{ height: h, animationDelay: `${i * -0.23}s` }}
            />
          ))}
        </span>
      </div>

      {wx && (
        <div className={SEG} title={wx.desc}>
          <i className={`fa-solid ${wx.icon ?? 'fa-cloud'} ${ICON_COLOR[wx.icon] ?? 'text-white'}`} aria-hidden="true" />
          <span className="sr-only">{wx.desc}, </span>
          <span className="whitespace-nowrap">
            {toUnit(wx.temp, unit) ?? '--'}°<span className="text-lofi-muted">{unit}</span>
          </span>
          {wx.name && <span className="max-sm:hidden max-w-32 truncate font-sans text-xs text-lofi-muted">{wx.name}</span>}
        </div>
      )}

      <div className={SEG}>
        <span className="whitespace-nowrap">
          <Clock now={now} clock={clock} />
        </span>
        <span className="max-sm:hidden text-[10px] uppercase tracking-widest text-lofi-muted whitespace-nowrap">
          {now?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* signed in / LAN only (same data as the Server card); otherwise no segment at all */}
      {st && (
        <div className={`${SEG} text-xs max-sm:basis-full max-sm:justify-center max-sm:border-l-0 max-sm:border-t max-sm:pt-1.5`}>
          <span className="whitespace-nowrap" title="CPU">
            <i className="fa-solid fa-microchip text-lofi-primary mr-1.5" aria-hidden="true" />
            <span className="sr-only">CPU </span>
            {st.cpu ?? '--'}%
          </span>
          {st.temp != null && (
            <span className="whitespace-nowrap" title="CPU temperature">
              <i className="fa-solid fa-temperature-half text-lofi-secondary mr-1.5" aria-hidden="true" />
              <span className="sr-only">temperature </span>
              {toUnit(st.temp, unit)}°{unit}
            </span>
          )}
          {ram != null && (
            <span className="whitespace-nowrap" title="RAM">
              <i className="fa-solid fa-memory text-blue-400 mr-1.5" aria-hidden="true" />
              <span className="sr-only">RAM </span>
              {ram}%
            </span>
          )}
        </div>
      )}
    </aside>
  )
}

function Music({ ctl, onTune }) {
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

  // the focus bar's play button calls this same toggle() straight from its click (iOS gesture rule above)
  useEffect(() => {
    ctl.current = toggle
  })
  useEffect(() => onTune({ playing, loading }), [playing, loading, onTune])

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
          <button className="w-11 h-11 -m-2.5 flex items-center justify-center text-lofi-muted hover:text-white transition-colors" title="Volume Down" aria-label="Volume down" onClick={() => changeVolume(-10)}>
            <i className="fa-solid fa-volume-low" aria-hidden="true" />
          </button>
          <button
            className="w-12 h-12 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-all hover:scale-105 shadow-[0_0_15px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)]"
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={toggle}
          >
            <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : playing ? 'fa-pause' : 'fa-play ml-1'}`} aria-hidden="true" />
          </button>
          <button className="w-11 h-11 -m-2.5 flex items-center justify-center text-lofi-muted hover:text-white transition-colors" title="Volume Up" aria-label="Volume up" onClick={() => changeVolume(10)}>
            <i className="fa-solid fa-volume-high" aria-hidden="true" />
          </button>
        </div>
        <p className="text-[10px] font-mono text-lofi-muted text-center mt-2" aria-live="polite">
          VOL {volume}%{hint && <span className="text-red-400"> · audio unavailable</span>}
        </p>
      </div>

      <div ref={host} className="youtube-hidden" />
    </div>
  )
}

function Weather({ status, setStatus, setWx, cloudLoc, onPick }) {
  const [loc, setLoc] = useState(null)
  const [w, setW] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState({ state: 'idle', items: [] })
  const [active, setActive] = useState(-1)
  const ctrl = useRef(null) // AbortController of the latest search
  const debounce = useRef(null)
  const box = useRef(null)
  const card = useRef(null)
  const dlg = useRef(null)
  const [detail, setDetail] = useState({ state: 'idle' }) // details panel: { key, state, data }
  const { unit } = useContext(Prefs)

  useEffect(() => {
    const l = load('location', null)
    const ok = l && Number.isFinite(l.lat) && Number.isFinite(l.lon) && typeof l.tz === 'string' && /^\d+$/.test(String(l.id))
    setLoc(ok ? l : DEFAULT_LOC)
  }, [])
  useEffect(() => {
    if (cloudLoc) setLoc(cloudLoc) // picked on another device; already validated and saved by the sync
  }, [cloudLoc])

  useEffect(() => {
    if (!loc) return
    let alive = true
    setW(null) // never show the previous city's numbers while/if this one fails
    const get = async () => {
      setStatus('loading')
      try {
        const r = await fetch('/api/weather?' + locQuery(loc))
        if (!r.ok) throw new Error(r.status)
        const data = await r.json()
        if (alive) {
          setW(data)
          setWx(data)
          setStatus('ok')
        }
      } catch {
        if (alive) {
          setWx(null)
          setStatus('error')
        }
      }
    }
    get()
    const t = setInterval(get, 10 * 60 * 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [loc, setStatus, setWx])

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
    onPick()
  }

  // lazy: fetched only when the panel opens, then served from detailCache
  function loadDetail() {
    const key = locQuery(loc).toString()
    const hit = detailCache.get(key)
    if (hit) return setDetail({ key, state: 'ok', data: hit })
    setDetail({ key, state: 'loading' })
    fetch('/api/weather/detail?' + key)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        detailCache.set(key, data)
        setDetail((d) => (d.key === key ? { key, state: 'ok', data } : d))
      })
      .catch(() => setDetail((d) => (d.key === key ? { key, state: 'error' } : d)))
  }

  function openDetail() {
    if (!loc || dlg.current.open) return // also ignores clicks while the close animation runs
    dlg.current.showModal()
    loadDetail()
  }

  const closeDetail = () => closeDialog(dlg.current)

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
    <>
    <div
      ref={card}
      tabIndex={-1}
      // whole card opens the panel, except the search box and its dropdown, and real controls
      onClick={(e) => e.target.closest('input, button, a, [role="listbox"]') || openDetail()}
      className="group glass-panel rounded-3xl p-6 interactive-hover flex flex-col h-auto min-h-[320px] relative overflow-hidden cursor-pointer"
    >
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
          placeholder="Search city…"
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
            <li role="option" aria-selected={false} aria-disabled="true" className={`px-3 py-2 text-xs ${res.state === 'error' ? 'text-red-400' : 'text-lofi-muted'}`}>
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
          {toUnit(w?.temp, unit) ?? '--'}
          <span className="text-2xl text-lofi-muted font-normal">°{unit}</span>
        </div>
        <div className="text-sm text-lofi-primary font-medium mt-2">
          {w?.desc ?? (status === 'error' ? 'Weather unavailable' : 'Loading...')}
          {w && <span className="text-lofi-muted font-normal"> · feels like {toUnit(w.feelsLike, unit)}°</span>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
          {w?.aqi != null ? <AqiPill aqi={w.aqi} className="grow basis-48" /> : <span />}
          <button
            onClick={openDetail}
            aria-haspopup="dialog"
            // padding + negative margin: a 32px+ tap target, same look
            className="py-2 -my-2 px-1 -mx-1 font-mono text-[11px] uppercase tracking-wider text-lofi-muted group-hover:text-lofi-primary hover:text-lofi-primary transition-colors"
          >
            Details <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-auto z-10">
        <Stat icon="fa-cloud-rain text-lofi-secondary" label="Rain Chance" value={w?.rainChance != null ? `${w.rainChance}%` : '--'} />
        <Stat icon="fa-sun text-lofi-highlight" label="UV Index" value={w?.uv != null ? `${w.uv} (${w.uvLabel})` : '--'} />
        <Stat icon="fa-droplet text-blue-400" label="Humidity" value={w ? `${w.humidity}%` : '--'} />
        <Stat icon="fa-wind text-gray-400" label="Wind" value={w ? `${w.wind} km/h` : '--'} />
      </div>
    </div>

    {/* native modal: focus trap, Esc and top layer for free. Click on the backdrop = click on <dialog> itself */}
    <dialog
      ref={dlg}
      aria-labelledby="wx-title"
      onClick={(e) => e.target === dlg.current && closeDetail()}
      onCancel={(e) => {
        e.preventDefault() // Esc: animate out first
        closeDetail()
      }}
      // the browser restores focus to the opener; a click on the card had none -> back to the card
      onClose={() => {
        delete dlg.current.dataset.closing
        card.current.contains(document.activeElement) || card.current.focus({ preventScroll: true })
      }}
      className="wx-sheet glass-panel text-lofi-text overscroll-contain"
    >
      <WeatherDetail w={w} loc={loc} detail={detail} onRetry={loadDetail} onClose={closeDetail} />
    </dialog>
    </>
  )
}

const Label = ({ icon, children }) => (
  <h3 className="flex items-center gap-2 mb-3 text-[10px] font-mono uppercase tracking-widest text-lofi-muted">
    <i className={`fa-solid ${icon} text-lofi-primary`} aria-hidden="true" />
    {children}
  </h3>
)

const weekday = (date, i) => (i ? new Date(date + 'T12:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : 'Today')

function WeatherDetail({ w, loc, detail, onRetry, onClose }) {
  const { unit } = useContext(Prefs)
  const tc = (v) => toUnit(v, unit) // °C from the API -> display unit
  const d = detail.state === 'ok' ? detail.data : null
  // header: the panel's own fresh data once loaded, the card's meanwhile
  const now = d?.now ?? w
  const span = d?.range ? Math.max(1, d.range.max - d.range.min) : 1
  const band = aqiBand(d?.air.aqi)
  return (
    <div className="p-5 sm:p-7 flex flex-col gap-6">
      {/* wx-sticky: title + close stay pinned on phones and short (landscape) screens. A direct child of the
          scrolling content (not inside <header>), so it can stick for the whole panel */}
      <div className="wx-sticky flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-widest text-lofi-muted mb-1 short:hidden">Weather details</p>
          <h2 id="wx-title" className="text-xl sm:text-2xl short:text-lg font-medium text-white truncate">{d?.name || w?.name || loc?.name}</h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close weather details"
          className="w-9 h-9 shrink-0 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white hover:border-lofi-primary/40 transition-colors"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      <header>
        {/* short screens: one compact row (icon, temp, condition, AQI) instead of two big ones */}
        <div className="flex flex-col gap-3 -mt-3 short:flex-row short:flex-wrap short:items-center short:gap-x-4 short:gap-y-1">
          <div className="flex items-center gap-4 short:gap-3">
            <i className={`fa-solid ${now?.icon ?? 'fa-cloud'} text-4xl short:text-2xl ${ICON_COLOR[now?.icon] ?? 'text-white'} drop-shadow-[0_0_12px_currentColor]`} aria-hidden="true" />
            <div className="text-5xl short:text-3xl font-light text-white tracking-tighter leading-none">
              {tc(now?.temp) ?? '--'}
              <span className="text-xl short:text-base text-lofi-muted font-normal">°{unit}</span>
            </div>
            <div className="text-sm text-lofi-primary font-medium min-w-0">{now?.desc ?? ' '}</div>
          </div>
          {now?.aqi != null && <AqiPill aqi={now.aqi} className="short:grow short:basis-48" />}
        </div>
      </header>

      {!d ? (
        <div className="py-10 text-center font-mono text-xs" aria-live="polite">
          {detail.state === 'error' ? (
            <>
              <p className="text-red-400 mb-3">Details unavailable</p>
              <button onClick={onRetry} className="px-3 py-1.5 rounded-full border border-white/10 text-lofi-text hover:text-lofi-primary hover:border-lofi-primary/40 transition-colors">
                Retry
              </button>
            </>
          ) : (
            <p className="text-lofi-muted animate-pulse">Loading forecast…</p>
          )}
        </div>
      ) : (
        <>
          <section className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <Label icon="fa-clock">Next 24 hours</Label>
              <div className="flex items-center gap-3 text-[10px] font-mono text-lofi-muted" aria-hidden="true">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded-full bg-gradient-to-r from-lofi-highlight to-lofi-primary" />
                  Temp
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1 h-2.5 rounded-t-sm bg-blue-400" />
                  Rain
                </span>
              </div>
            </div>
            {d.hours.length ? <HourChart hours={d.hours.map((h) => ({ ...h, temp: tc(h.temp) }))} unit={unit} /> : <p className="text-xs font-mono text-lofi-muted">No hourly data</p>}
          </section>

          <section>
            <Label icon="fa-calendar-days">7 days</Label>
            <ul className="flex flex-col">
              {d.days.map((x, i) => (
                <li key={x.date} className="grid grid-cols-[3rem_1.5rem_2.25rem_1fr_2.25rem_2.75rem] items-center gap-2 sm:gap-3 py-2 border-b border-white/5 last:border-0 font-mono text-sm">
                  <span className={i ? 'text-lofi-text' : 'text-lofi-primary font-bold'}>{weekday(x.date, i)}</span>
                  <i className={`fa-solid ${x.icon} text-center ${ICON_COLOR[x.icon] ?? 'text-white'}`} aria-hidden="true" />
                  <span className="text-right text-lofi-muted">{tc(x.min) ?? '--'}°</span>
                  <span className="relative h-1.5 rounded-full bg-lofi-base/60" aria-hidden="true">
                    {x.min != null && x.max != null && d.range && (
                      <span
                        className="absolute inset-y-0 rounded-full bg-gradient-to-r from-blue-300 via-lofi-highlight to-lofi-primary"
                        style={{ left: `${((x.min - d.range.min) / span) * 100}%`, right: `${((d.range.max - x.max) / span) * 100}%` }}
                      />
                    )}
                  </span>
                  <span className="text-white">{tc(x.max) ?? '--'}°</span>
                  <span className={`text-right text-xs ${x.rain >= 50 ? 'text-blue-300' : 'text-lofi-muted'}`}>
                    <i className="fa-solid fa-droplet text-[9px] mr-1 opacity-70" aria-hidden="true" />
                    {x.rain ?? '--'}%
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="rounded-2xl bg-lofi-base/40 border border-white/5 p-4">
              <Label icon="fa-lungs">Air quality</Label>
              {band ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-mono font-bold leading-none" style={{ color: band.color }}>{d.air.aqi}</span>
                    <span className="text-sm text-white">{band.label}</span>
                  </div>
                  <div className="relative mt-4 mb-1" aria-hidden="true">
                    <div className="flex h-2 rounded-full overflow-hidden gap-px">
                      {AQI_BANDS.map(([max, , color]) => <span key={max} className="flex-1" style={{ backgroundColor: color }} />)}
                    </div>
                    <span
                      className="absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_8px_rgba(0,0,0,0.6)]"
                      style={{ left: `${aqiPos(d.air.aqi)}%`, backgroundColor: band.color }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-lofi-muted">
                    <span>0</span>
                    <span>500</span>
                  </div>
                  <p className="text-xs text-lofi-text/90 mt-3">{band.advice}</p>
                </>
              ) : (
                <p className="text-xs font-mono text-lofi-muted">No air quality data</p>
              )}
              <dl className="grid grid-cols-3 gap-2 mt-4">
                {[['PM2.5', d.air.pm25], ['PM10', d.air.pm10], ['O₃', d.air.o3]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-lofi-surface/50 border border-white/5 px-2.5 py-2">
                    <dt className="text-[10px] font-mono text-lofi-muted">{k}</dt>
                    <dd className="text-sm font-mono text-white">
                      {v ?? '--'}
                      <span className="block text-[9px] text-lofi-muted">µg/m³</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-2xl bg-lofi-base/40 border border-white/5 p-4">
              <Label icon="fa-wind">Sun &amp; wind</Label>
              <div className="grid grid-cols-2 gap-2">
                <Tile icon="fa-sun text-lofi-highlight" k="Sunrise" v={d.sun.sunrise ?? '--'} />
                <Tile icon="fa-moon text-lofi-highlight" k="Sunset" v={d.sun.sunset ?? '--'} />
                <div className="col-span-2 flex items-center gap-3 rounded-xl bg-lofi-surface/50 border border-white/5 px-3 py-2.5">
                  <span className="w-10 h-10 shrink-0 rounded-full border border-white/10 bg-lofi-base/60 flex items-center justify-center">
                    {/* arrow points where the wind blows to (direction is where it comes from) */}
                    <i
                      className="fa-solid fa-arrow-down text-lofi-primary transition-transform"
                      style={{ transform: `rotate(${d.wind.dir ?? 0}deg)` }}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-lofi-muted">Wind{d.wind.compass && ` from ${d.wind.compass}`}</div>
                    <div className="text-sm font-mono text-white">
                      {d.wind.speed ?? '--'} km/h
                      <span className="text-lofi-muted text-xs"> · gusts {d.wind.gust ?? '--'}</span>
                    </div>
                  </div>
                </div>
                <Tile icon="fa-gauge text-blue-400" k="Pressure" v={d.pressure != null ? `${d.pressure} hPa` : '--'} />
                <Tile icon="fa-cloud text-gray-400" k="Cloud" v={d.cloud != null ? `${d.cloud}%` : '--'} />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

// Hourly chart geometry (px; x is in % of the width so it stretches to any container)
const CH = 150, CH_TOP = 34, CH_BOT = 88, BAR = 36
const hourLabel = (h, i) => (i ? h.t.slice(11, 16) : 'Now')

// 24 hours, no scrolling: temp curve (SVG stretched to the width), rain bars, HTML labels on the same x positions.
// Desktop labels every 3 h, phones every 6 h (max-sm:hidden), the curve and bars always show every hour.
function HourChart({ hours, unit }) {
  const [sel, setSel] = useState(null)
  const n = hours.length
  const c = chartPoints(hours, 100, CH, { top: CH_TOP, bottom: CH_BOT })
  const every = (k) => hours.map((_, i) => i).filter((i) => i % k === 0)
  // min/max first so they always win a spot, then the regular steps
  const tempWide = spread([c.iHi, c.iLo, ...every(3)], 2), tempNarrow = spread([c.iHi, c.iLo, ...every(6)], 2)
  const wet = hours.map((h, i) => i).filter((i) => hours[i].rain >= 50).sort((a, b) => hours[b].rain - hours[a].rain)
  const rainNarrow = spread(wet, 2)
  // shown on wide / narrow screens -> utility classes (both false = not rendered at all)
  const vis = (wide, narrow) => `${wide ? '' : 'sm:hidden'} ${narrow ? '' : 'max-sm:hidden'}`
  const maxRain = Math.max(0, ...hours.map((h) => h.rain ?? 0))
  const summary =
    `Next 24 hours: ${c.lo} to ${c.hi}°${unit}, warmest at ${hourLabel(hours[c.iHi], c.iHi)}, coolest at ${hourLabel(hours[c.iLo], c.iLo)}; ` +
    `rain chance up to ${maxRain}%. Arrow keys step through the hours.`
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setSel(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))))
  }
  const s = sel == null ? null : { h: hours[sel], p: c.pts[sel] }
  const tipX = s ? (s.p.x < 18 ? '0%' : s.p.x > 82 ? '-100%' : '-50%') : 0

  return (
    <div
      tabIndex={0}
      role="group"
      aria-roledescription="chart"
      aria-label={summary}
      onPointerDown={at}
      onPointerMove={at}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)} // touch: keep the tapped hour
      onBlur={() => setSel(null)}
      onKeyDown={(e) => {
        const k = { ArrowRight: 1, ArrowLeft: -1, Home: -n, End: n }[e.key]
        if (!k) return
        e.preventDefault()
        setSel((v) => Math.min(n - 1, Math.max(0, (v ?? (k > 0 ? -1 : n)) + k)))
      }}
      className="relative select-none touch-pan-y rounded-xl cursor-crosshair"
    >
      {/* top row: icon + time */}
      <div className="relative h-11" aria-hidden="true">
        {hours.map((h, i) =>
          i % 3 ? null : (
            <div
              key={h.t}
              className={`absolute top-0 -translate-x-1/2 flex flex-col items-center gap-1 ${vis(true, i % 6 === 0)}`}
              style={{ left: `${c.pts[i].x}%` }}
            >
              <i className={`fa-solid ${h.icon} text-sm ${ICON_COLOR[h.icon] ?? 'text-white'}`} />
              <span className={`text-[10px] font-mono whitespace-nowrap ${i ? 'text-lofi-muted' : 'text-lofi-primary font-bold'}`}>{hourLabel(h, i)}</span>
            </div>
          ),
        )}
      </div>

      <div className="relative border-b border-white/10" style={{ height: CH }} aria-hidden="true">
        <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox={`0 0 100 ${CH}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="wx-line" gradientUnits="userSpaceOnUse" x1="0" y1={CH_TOP} x2="0" y2={CH_BOT}>
              {/* theme colors: style, not the stopColor attribute, so var() resolves */}
              <stop offset="0" style={{ stopColor: 'var(--color-lofi-secondary)' }} />
              <stop offset="0.5" style={{ stopColor: 'var(--color-lofi-primary)' }} />
              <stop offset="1" style={{ stopColor: 'var(--color-lofi-highlight)' }} />
            </linearGradient>
            <linearGradient id="wx-area" gradientUnits="userSpaceOnUse" x1="0" y1={CH_TOP} x2="0" y2={CH}>
              <stop offset="0" stopOpacity="0.3" style={{ stopColor: 'var(--color-lofi-primary)' }} />
              <stop offset="1" stopOpacity="0" style={{ stopColor: 'var(--color-lofi-primary)' }} />
            </linearGradient>
          </defs>
          {c.pts.map((p, i) =>
            i % 3 ? null : <line key={i} x1={p.x} x2={p.x} y1="0" y2={CH} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />,
          )}
          <path d={c.area} fill="url(#wx-area)" />
          <path d={c.line} fill="none" stroke="url(#wx-line)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>

        {hours.map((h, i) => {
          const barH = ((h.rain ?? 0) / 100) * BAR, x = c.pts[i].x
          return (
            <div key={h.t}>
              <span
                className={`absolute bottom-0 -translate-x-1/2 rounded-t-sm ${h.rain >= 50 ? 'bg-blue-400' : 'bg-blue-400/40'} ${sel === i ? 'brightness-125' : ''}`}
                style={{ left: `${x}%`, width: `${42 / n}%`, height: Math.max(1, barH) }}
              />
              {h.rain >= 50 && (
                <span
                  className={`absolute -translate-x-1/2 text-[9px] font-mono text-blue-300 ${vis(true, rainNarrow.has(i))}`}
                  style={{ left: `${x}%`, bottom: barH + 2 }}
                >
                  {h.rain}%
                </span>
              )}
              {(tempWide.has(i) || tempNarrow.has(i)) && c.pts[i].y != null && (
                <>
                  <span
                    className={`absolute -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${i === c.iHi ? 'bg-lofi-secondary' : i === c.iLo ? 'bg-blue-300' : 'bg-white/70'} ${vis(tempWide.has(i), tempNarrow.has(i))}`}
                    style={{ left: `${x}%`, top: c.pts[i].y }}
                  />
                  <span
                    className={`absolute -translate-x-1/2 text-[11px] font-mono whitespace-nowrap ${
                      i === c.iHi ? 'text-lofi-primary font-bold' : i === c.iLo ? 'text-blue-300 font-bold' : 'text-white/85'
                    } ${vis(tempWide.has(i), tempNarrow.has(i))}`}
                    style={{ left: `${x}%`, top: c.pts[i].y - 22 }}
                  >
                    {h.temp}°
                  </span>
                </>
              )}
            </div>
          )
        })}

        {/* now */}
        {c.pts[0].y != null && (
          <span className="absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3" style={{ left: `${c.pts[0].x}%`, top: c.pts[0].y }}>
            <span className="absolute inset-0 rounded-full bg-lofi-primary/50 motion-safe:animate-ping" />
            <span className="absolute inset-0 rounded-full bg-lofi-primary border-2 border-lofi-base shadow-[0_0_10px_color-mix(in_oklab,var(--color-lofi-primary)_80%,transparent)]" />
          </span>
        )}

        {s && (
          <>
            <span className="absolute top-0 bottom-0 border-l border-dashed border-white/35 pointer-events-none" style={{ left: `${s.p.x}%` }} />
            {s.p.y != null && (
              <span
                className="absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-lofi-primary pointer-events-none"
                style={{ left: `${s.p.x}%`, top: s.p.y }}
              />
            )}
          </>
        )}
      </div>

      {s && (
        <div
          role="tooltip"
          className="absolute top-11 z-10 pointer-events-none whitespace-nowrap rounded-lg border border-white/10 bg-lofi-base/95 backdrop-blur-md px-2.5 py-1.5 font-mono text-[11px] shadow-xl flex items-center gap-2"
          style={{ left: `${s.p.x}%`, transform: `translateX(${tipX})` }}
        >
          <span className={sel ? 'text-lofi-muted' : 'text-lofi-primary font-bold'}>{hourLabel(s.h, sel)}</span>
          <i className={`fa-solid ${s.h.icon} ${ICON_COLOR[s.h.icon] ?? 'text-white'}`} aria-hidden="true" />
          <span className="text-white">{s.h.temp ?? '--'}°</span>
          <span className="text-blue-300">
            <i className="fa-solid fa-droplet text-[9px] mr-0.5" aria-hidden="true" />
            {s.h.rain ?? '--'}%
          </span>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {s ? `${hourLabel(s.h, sel)}: ${s.h.temp ?? 'no data'}°${unit}, rain ${s.h.rain ?? 'no data'}%` : ''}
      </p>
    </div>
  )
}

const Tile = ({ icon, k, v }) => (
  <div className="flex items-center gap-2.5 rounded-xl bg-lofi-surface/50 border border-white/5 px-3 py-2.5">
    <i className={`fa-solid ${icon} text-sm`} aria-hidden="true" />
    <div className="min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-wider text-lofi-muted">{k}</div>
      <div className="text-sm font-mono text-white truncate">{v}</div>
    </div>
  </div>
)

// ● AQI 62 · Moderate, tinted with the EPA band color
const AQI_SHORT = { 'Unhealthy for Sensitive Groups': 'Sensitive groups' }

// One line always: a size container that swaps in the short label when the full one (~19rem) wouldn't fit.
function AqiPill({ aqi, className = '' }) {
  const b = aqiBand(aqi)
  if (!b) return null
  const short = AQI_SHORT[b.label]
  return (
    <div className={`@container min-w-0 ${className}`}>
      <span
        title={`AQI ${aqi} · ${b.label}`}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-lofi-text"
        style={{ borderColor: b.color + '59', backgroundColor: b.color + '1f' }}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: b.color, boxShadow: `0 0 6px ${b.color}` }} aria-hidden="true" />
        AQI {aqi} ·{' '}
        {short ? (
          <>
            <span className="@max-[19rem]:hidden">{b.label}</span>
            <span className="hidden @max-[19rem]:inline">{short}</span>
          </>
        ) : (
          b.label
        )}
      </span>
    </div>
  )
}

// pct (0-100 or null) adds a thin bar; omit it for a plain tile
// CSS-only lofi night sky (gradient, twinkling pixel stars, glowing moon): the backdrop while a scene loads and the
// fallback when it can't load.
function NightSky() {
  return (
    <div className="night-sky fixed top-0 left-0 w-full h-lvh" aria-hidden="true">
      <div className="night-stars absolute inset-0" />
      <div className="night-stars night-stars-2 absolute inset-0" />
      <div className="absolute top-[5%] right-[4%] w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-lofi-highlight shadow-[0_0_60px_20px_color-mix(in_oklab,var(--color-lofi-highlight)_35%,transparent)] motion-safe:animate-float" />
    </div>
  )
}

// Pixel-sharp scene: redraws each video frame onto a device-resolution canvas with smoothing off, the way
// loficities draws its own canvas. Browsers smooth a scaled <video> (Chrome ignores image-rendering on video),
// which blurs pixel edges on 4K. The videos sit underneath as frame sources (and show their poster before the
// first draw). Keyed by scene: a weather change for the same scene cross-fades in place. Every variant of a scene
// is the same loop on the same timeline, so the new video starts at the old one's currentTime and only the weather
// changes. At most two videos decode at once.
const FADE = 1000
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

function sceneVideo(base, holder, preload) {
  const v = document.createElement('video')
  v.className = 'fixed top-0 left-0 w-full h-lvh object-cover'
  v.style.imageRendering = 'pixelated'
  v.muted = v.loop = v.playsInline = true
  v.setAttribute('aria-hidden', 'true')
  v.preload = preload ? 'auto' : 'none'
  v.poster = `${base}.webp`
  for (const ext of ['webm', 'mp4']) {
    const s = document.createElement('source')
    s.src = `${base}.${ext}`
    s.type = `video/${ext}`
    v.append(s)
  }
  holder.prepend(v) // under the current one
  return v
}
function dropVideo(v) {
  v.pause()
  v.querySelectorAll('source').forEach((s) => s.removeAttribute('src'))
  v.load() // frees the decoder
  v.remove()
}

function SceneCanvas({ base, mode, videoRef, reduced, onFail }) {
  const ref = useRef(null)
  const holder = useRef(null)
  const api = useRef(null)
  const live = useRef({})
  live.current = { reduced, onFail }

  useEffect(() => {
    const c = ref.current, g = c.getContext('2d')
    if (!g) return
    let cur = null // { v, base, mode }: the shown video
    let next = null // { v, base, mode, t0 }: the incoming variant; t0 set once its fade runs
    let still = null // { img, t0 }: snapshot of a mix interrupted by a newer switch, fading out over cur
    let src = null // what cur draws from: its poster until it plays, then the video
    let raf = 0, vfc = 0, vfcVideo = null
    const rvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype

    const cover = (img, a) => {
      const w = img.videoWidth || img.naturalWidth || img.width, h = img.videoHeight || img.naturalHeight || img.height
      if (!w) return false
      const k = Math.max(c.width / w, c.height / h) // object-fit: cover
      g.globalAlpha = a
      g.drawImage(img, (c.width - w * k) / 2, (c.height - h * k) / 2, w * k, h * k)
      return true
    }
    const promote = () => {
      dropVideo(cur.v)
      cur = next
      next = null
      src = videoRef.current = cur.v
      cur.v.addEventListener('playing', onPlaying)
    }
    const draw = () => {
      g.imageSmoothingEnabled = false
      if (!src || !cover(src, 1)) return
      if (still) {
        const q = ease(Math.min(1, (performance.now() - still.t0) / FADE))
        if (q >= 1) still = null
        else cover(still.img, 1 - q)
      }
      if (next?.t0) {
        const p = ease(Math.min(1, (performance.now() - next.t0) / FADE))
        cover(next.v, p)
        if (p >= 1) promote()
      }
      g.globalAlpha = 1
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      vfcVideo?.cancelVideoFrameCallback(vfc)
      vfcVideo = null
    }
    // rAF while fading, otherwise only on new video frames (rVFC); a paused video (hidden tab) lets the loop sleep
    const loop = () => {
      stop()
      draw()
      if (next?.t0 || still || !rvfc) raf = requestAnimationFrame(loop)
      else if (src instanceof HTMLVideoElement) vfc = (vfcVideo = src).requestVideoFrameCallback(loop)
    }
    function onPlaying() {
      src = cur.v
      loop()
    }

    // a fresh cur: poster first, then the video once it plays. Fails = both sources, or the poster when it's all we
    // load (reduced motion) or the file is a weather variant (not uploaded yet)
    const start = (b, m) => {
      const v = sceneVideo(b, holder.current, !live.current.reduced)
      v.autoplay = !live.current.reduced
      cur = { v, base: b, mode: m }
      videoRef.current = v
      const poster = new Image()
      poster.onload = () => cur?.v === v && src !== v && ((src = poster), draw())
      poster.onerror = () => (live.current.reduced || m !== 'signature') && cur?.v === v && live.current.onFail(m)
      poster.src = `${b}.webp`
      v.querySelector('source:last-of-type').addEventListener('error', () => cur?.v === v && live.current.onFail(m))
      v.addEventListener('playing', onPlaying)
    }

    const switchTo = (b, m) => {
      if (next?.base === b) return
      if (next) {
        // a newer switch mid-fade: keep the visible mix as a still that fades out, keep the stronger video
        if (next.t0) {
          const p = ease(Math.min(1, (performance.now() - next.t0) / FADE))
          const s = document.createElement('canvas')
          s.width = c.width
          s.height = c.height
          s.getContext('2d').drawImage(c, 0, 0)
          still = { img: s, t0: performance.now() }
          if (p >= 0.5) promote()
        }
        if (next) dropVideo(next.v)
        next = null
      }
      if (b === cur.base) return loop()
      // nothing played yet (poster only, or still loading): just replace; the canvas keeps its last frame meanwhile
      if (src !== cur.v) {
        dropVideo(cur.v)
        src = null
        return start(b, m)
      }
      const v = sceneVideo(b, holder.current, true)
      const n = (next = { v, base: b, mode: m })
      let lead = 0.05, tries = 0
      const sync = () => {
        const d = v.duration || cur.v.duration
        v.currentTime = d ? (cur.v.currentTime + (cur.v.paused ? 0 : lead)) % d : cur.v.currentTime
      }
      v.addEventListener('loadedmetadata', sync, { once: true })
      const check = () => {
        if (next !== n || n.t0 || v.paused) return
        const d = v.duration || 240
        const drift = ((((cur.v.currentTime - v.currentTime) % d) + d * 1.5) % d) - d / 2
        if (Math.abs(drift) > 0.08 && tries++ < 3) {
          lead += drift // the seek took that much longer: aim further ahead
          return sync()
        }
        c.dataset.drift = drift.toFixed(3) // for the e2e check
        n.t0 = performance.now()
        loop()
      }
      v.addEventListener('seeked', () => {
        if (next !== n) return
        // reduced motion (cur paused on a frame): swap instantly at the same time position
        if (cur.v.paused) {
          promote()
          return draw()
        }
        if (v.paused) v.play().catch(() => {})
        else check()
      })
      v.addEventListener('playing', check)
      // missing variant: cancel, keep the current video, let Home fall back to Signature
      v.querySelector('source:last-of-type').addEventListener('error', () => {
        if (next !== n) return
        dropVideo(v)
        next = null
        live.current.onFail(m)
      })
    }
    api.current = { switchTo }

    // sized from its own box (h-lvh: doesn't change when the mobile toolbar slides), not window resize, which fires
    // all through a mobile scroll. ponytail: DPR capped at 2, 3x phones cost a lot more for no visible gain
    const fit = () => {
      const k = Math.min(devicePixelRatio, 2)
      const w = Math.round(c.clientWidth * k), h = Math.round(c.clientHeight * k)
      if (w === c.width && h === c.height) return // assigning clears the canvas
      c.width = w
      c.height = h
      draw()
    }
    start(base, mode)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    return () => {
      ro.disconnect()
      stop()
      for (const x of [cur, next]) x && dropVideo(x.v)
      cur = next = null
      api.current = null
    }
  }, [videoRef]) // base / mode changes go through switchTo below, not a remount

  useEffect(() => api.current?.switchTo(base, mode), [base, mode])

  // fade-in: a cheap cross-fade (through the night sky) on scene switches
  return (
    <div className="motion-safe:animate-[fade-in_0.6s_ease-out]">
      <div ref={holder} aria-hidden="true" />
      <canvas ref={ref} className="fixed top-0 left-0 w-full h-lvh" aria-hidden="true" />
    </div>
  )
}

function Stat({ icon, label, value, pct, title }) {
  return (
    <div className="bg-lofi-surface/50 p-3 rounded-xl border border-white/5 flex items-center gap-3 hover:bg-lofi-surface transition-colors">
      <i className={`fa-solid ${icon} text-lg`} aria-hidden="true" />
      <div className="min-w-0 grow">
        <div className="text-[10px] text-lofi-muted font-mono uppercase tracking-wider">{label}</div>
        <div className="text-sm text-white font-medium truncate" title={title}>{value}</div>
        {pct !== undefined && (
          <div className="h-1 mt-1.5 rounded-full bg-lofi-base/60 overflow-hidden" aria-hidden="true">
            <div className={`h-full rounded-full transition-all duration-500 ${pct > 85 ? 'bg-red-400' : 'bg-lofi-primary'}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

// Top of the right column, so the server stats stay above the fold (1080p): status row, then Server below it.
function Hub({ status, priv }) {
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
    <div className="glass-panel rounded-3xl p-6 flex flex-col gap-5 relative overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-r from-lofi-surface/0 via-lofi-surface/20 to-lofi-surface/0 animate-shimmer pointer-events-none" />
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
      <Server d={priv} />
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
// the auth portal, coming back to this page after login
const signIn = () => `${AUTH_URL}/?rd=${encodeURIComponent(location.href)}`
const TAB_ICON = { All: 'fa-border-all', Sites: 'fa-globe', Apps: 'fa-cubes', Developer: 'fa-code', Contact: 'fa-address-card', Entertainment: 'fa-gamepad', Internal: 'fa-lock' }
// Painted-stroke edges: straight on the left, torn on the right (two layers give the rough brush look)
const BRUSH = 'polygon(0% 6%, 93% 0%, 100% 22%, 95% 44%, 99% 66%, 93% 100%, 1% 94%)'
const BRUSH_2 = 'polygon(2% 0%, 97% 10%, 92% 34%, 100% 58%, 96% 88%, 88% 96%, 0% 100%)'

// Hosted Applications with a group picker. Internal = /api/private services: shown when unlocked, sign-in prompt when locked.
function Services({ priv }) {
  const [tab, setTab] = useState('Sites')
  const [health, setHealth] = useState({}) // public up/down for the Apps section
  const [teaser, setTeaser] = useState(null) // locked: the internal services' names + up/down only (/api/internal)
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
    if (!el || motionOff()) return setTab(t)
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
    const f = requestAnimationFrame(() => box.current && !motionOff() && enter(box.current))
    return () => cancelAnimationFrame(f)
  }, [])

  const locked = priv === null
  useEffect(() => {
    if (!locked) return
    const get = () => fetch('/api/internal').then((r) => r.json()).then((l) => Array.isArray(l) && setTeaser(l), () => {})
    get()
    const t = setInterval(get, 60_000)
    return () => clearInterval(t)
  }, [locked])

  const groups = [...SERVICES, ...(priv?.services?.length ? [{ section: 'Internal', items: priv.services }] : [])]
  const shown = tab === 'All' ? groups : groups.filter((g) => g.section === tab)
  const count = (t) => (t === 'All' ? groups : groups.filter((g) => g.section === t)).reduce((a, g) => a + g.items.length, 0)
  // shared by both tab variants (pills < lg, brush bookmarks >= lg); n = null while Internal is locked
  const meta = (t) => ({ on: tab === t, icon: t === 'Internal' && !locked ? 'fa-lock-open' : TAB_ICON[t], n: t === 'Internal' && locked ? (teaser?.length ?? null) : count(t) })
  let n = 0
  return (
    // lg: tab stack on the panel's right edge; the selected tab sticks out past the border like a bookmark. pr-44 keeps cards clear of it (~1/4 of the panel)
    <div className="glass-panel rounded-3xl p-6 flex flex-col relative lg:pr-44 lg:min-h-[24rem]">
      <div className="mb-6">
        <h3 className="text-sm font-mono text-lofi-text/80 uppercase tracking-widest flex items-center gap-2">
          <i className="fa-solid fa-server text-xs" aria-hidden="true" /> Hosted Applications
        </h3>
        <p key={tab} className="mt-2 text-[11px] font-mono text-lofi-muted motion-safe:animate-card-in">
          <span className="text-lofi-primary">{tab}</span> ·{' '}
          {tab === 'Internal' && locked ? 'locked' : `${String(count(tab)).padStart(2, '0')} apps`}
        </p>
      </div>
      {/* < lg: wrapping pills (no hidden horizontal scroll) */}
      <div role="group" aria-label="Choose a group" className="flex flex-wrap gap-1.5 mb-5 lg:hidden">
        {TABS.map((t) => {
          const { on, icon, n } = meta(t)
          return (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              aria-pressed={on}
              className={`relative isolate h-9 pl-2.5 ${n == null ? 'pr-3' : 'pr-1.5 max-[374px]:pr-3'} rounded-full border flex items-center gap-1.5 font-mono font-bold uppercase text-[10px] tracking-[0.04em] transition-all duration-200 ease-out active:scale-95 ${
                on ? 'text-lofi-base border-transparent scale-[1.04] shadow-[0_0_16px_color-mix(in_oklab,var(--color-lofi-primary)_45%,transparent)]' : 'text-lofi-muted bg-white/5 border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-0 -z-10 rounded-full bg-linear-to-r from-lofi-primary to-lofi-secondary transition-opacity duration-200 ${on ? 'opacity-100' : 'opacity-0'}`}
              />
              <i className={`fa-solid ${icon} text-[11px] ${on ? '' : 'text-lofi-primary/80'}`} aria-hidden="true" />
              {t}
              {n != null && (
                <span className={`max-[374px]:hidden min-w-5 h-5 px-1.5 rounded-full flex items-center justify-center text-[9px] tabular-nums ${on ? 'bg-lofi-base/20' : 'bg-white/10 text-lofi-text/80'}`}>
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* lg+: brush-stroke bookmark tabs */}
      <div
        role="group"
        aria-label="Choose a group"
        className="hidden lg:flex lg:flex-wrap lg:absolute lg:top-24 lg:right-0 lg:w-40 lg:flex-col lg:gap-1.5 z-20"
      >
        {TABS.map((t) => {
          const { on, icon, n } = meta(t)
          return (
            <button
              key={t}
              type="button"
              onClick={() => pick(t)}
              aria-pressed={on}
              className={`group/tab relative isolate -rotate-3 h-8 lg:h-9 pl-2.5 pr-4 lg:pl-3 lg:pr-5 flex items-center gap-2 font-mono font-bold uppercase text-[10px] tracking-[0.08em] transition-all duration-200 ease-out ${
                on ? 'text-lofi-base lg:translate-x-4 motion-safe:animate-tilt drop-shadow-[0_4px_10px_color-mix(in_oklab,var(--color-lofi-primary)_35%,transparent)]' : 'text-lofi-muted hover:text-white lg:hover:translate-x-1'
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
                {n == null ? '--' : String(n).padStart(2, '0')}
              </span>
            </button>
          )
        })}
      </div>
      <div ref={box} className="space-y-6">
        {shown.map(({ section, items }) => (
          <section key={section}>
            {tab === 'All' && <h4 data-anim className="text-[10px] font-mono text-lofi-text/80 uppercase tracking-widest mb-3">{section}</h4>}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-4">
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
          <>
            <div data-anim className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-lofi-base/40 border border-white/5 px-4 py-3">
              <p className="text-xs font-mono text-lofi-muted flex items-center gap-2.5 min-w-0">
                <i className="fa-solid fa-lock text-lofi-primary" aria-hidden="true" />
                <span>Internal apps are private.</span>
              </p>
              <a
                href={signIn()}
                className="shrink-0 text-xs font-mono text-lofi-primary bg-lofi-primary/10 hover:bg-lofi-primary/20 px-4 py-2 rounded-full border border-lofi-primary/20 transition-colors"
              >
                Sign in
              </a>
            </div>
            {/* name + live status only; the card goes nowhere and every one wears the sealed vault */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {teaser?.map((s) => (
                <ServiceCard key={s.name} s={{ ...s, href: '#', host: '█████.wliafdew.dev', deco: 'vault' }} accent={ACCENTS[n++ % ACCENTS.length]} live={s.live} />
              ))}
            </div>
          </>
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
  const { reduced } = useContext(Prefs)
  useEffect(() => {
    setText(SEAL)
    setBusy(false)
    if (reduced) return
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
  }, [reduced])
  return (
    <div className="z-10 w-full flex items-center justify-center gap-2 bg-lofi-base/60 border border-white/5 rounded-lg px-2 py-1.5" aria-label="Vault sealed">
      <i className={`fa-solid ${busy ? 'fa-lock-open text-lofi-primary motion-safe:animate-wiggle' : 'fa-lock text-lofi-highlight'} text-[11px] w-3`} aria-hidden="true" />
      <span className={`font-mono text-[11px] tracking-[0.18em] whitespace-pre transition-colors ${busy ? 'text-lofi-primary' : 'text-lofi-muted'}`} aria-hidden="true">
        {text}
      </span>
    </div>
  )
}

// Grafana's card: a fake live panel. A random-walk area chart scrolls behind a metric that is totally real
// and definitely not made up. Pure decoration.
const METRICS = [
  ['vibes', (v) => `${Math.round(70 + v * 30)}%`],
  ['coffee', (v) => `${(1 + v * 4).toFixed(1)}/h`],
  ['bugs', () => '0*'],
  ['chill', (v) => `${(5 + v * 5).toFixed(1)}/10`],
  ['panic', () => '0%'],
]
const POINTS = 24
const walk = (v) => Math.min(0.9, Math.max(0.15, v + (Math.random() - 0.5) * 0.3))
const seed = () => Array.from({ length: POINTS }).reduce((a) => [...a, walk(a.at(-1) ?? 0.5)], [])
function Graph() {
  const [pts, setPts] = useState(() => Array(POINTS).fill(0.5)) // flat on the server; random after mount (no hydration mismatch)
  const [k, setK] = useState(0)
  const { reduced } = useContext(Prefs)
  useEffect(() => {
    setPts(seed())
    setK(0)
    if (reduced) return
    const tick = setInterval(() => setPts((p) => [...p.slice(1), walk(p.at(-1))]), 900)
    const next = setInterval(() => setK((i) => i + 1), 4000)
    return () => (clearInterval(tick), clearInterval(next))
  }, [reduced])
  const [label, fmt] = METRICS[k % METRICS.length]
  const line = pts.map((v, i) => `${((i / (POINTS - 1)) * 100).toFixed(1)},${((1 - v) * 24).toFixed(1)}`).join(' ')
  return (
    <div className="z-10 w-full relative overflow-hidden bg-lofi-base/60 border border-white/5 rounded-lg px-2 py-1.5" aria-hidden="true">
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <polygon points={`0,24 ${line} 100,24`} className="fill-lofi-primary/15" />
        <polyline points={line} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="stroke-lofi-primary/50" />
      </svg>
      {/* halo in the panel colour keeps the text readable where the line crosses it */}
      <div className="relative flex items-center justify-center gap-1.5 font-mono text-[11px] whitespace-nowrap [text-shadow:0_0_3px_var(--color-lofi-base),0_0_6px_var(--color-lofi-base)]">
        <span className="text-lofi-muted">{label}</span>
        <span className="text-white tabular-nums">{fmt(pts.at(-1))}</span>
      </div>
    </div>
  )
}

// Termix's card: a tiny shell types a command, gets a cheeky reply, clears and goes again. Pure decoration.
// Keep both sides <= 12 chars so they fit a phone-width card untruncated.
const SHELL = [
  ['whoami', 'root (maybe)'],
  ['sudo snack', 'okay.'],
  ['rm -rf /', 'nice try'],
  ['exit', 'no escape'],
  ['ping mom', 'no reply'],
  ['git push -f', 'bold move'],
  ['vim', 'send help'],
  ['uptime', 'more than u'],
]
function Shell() {
  const [line, setLine] = useState({ text: '', reply: false })
  const { reduced } = useContext(Prefs)
  useEffect(() => {
    if (reduced) return setLine({ text: 'ssh home', reply: false })
    setLine({ text: '', reply: false })
    let t // strictly one step at a time, so a single pending timeout
    const later = (fn, ms) => (t = setTimeout(fn, ms))
    let k = Math.floor(Math.random() * SHELL.length)
    const run = () => {
      const [cmd, reply] = SHELL[k++ % SHELL.length]
      let i = 0
      const type = () => {
        setLine({ text: cmd.slice(0, ++i), reply: false })
        if (i < cmd.length) return later(type, 60 + Math.random() * 90) // uneven, like a person typing
        later(() => {
          setLine({ text: reply, reply: true })
          later(() => (setLine({ text: '', reply: false }), later(run, 700)), 1800)
        }, 450)
      }
      type()
    }
    later(run, 800 + Math.random() * 1500)
    return () => clearTimeout(t)
  }, [reduced])
  return (
    <div className="z-10 w-full flex items-center bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 font-mono text-[11px] text-left" aria-hidden="true">
      <span className="text-lofi-primary mr-1.5">{line.reply ? '→' : '$'}</span>
      <span className={`truncate whitespace-pre ${line.reply ? 'text-lofi-highlight' : 'text-white'}`}>{line.text}</span>
      {!line.reply && <span className="w-[0.6em] h-[1.1em] ml-px shrink-0 bg-lofi-primary/80 motion-safe:animate-blink" />}
    </div>
  )
}

// card decorations by `deco` key (lib/data.js / private-services.json)
const DECOR = { vault: Secret, graph: Graph, shell: Shell }

function ServiceCard({ s, accent, live, stats }) {
  const Deco = DECOR[s.deco]
  return (
    <a
      href={s.href}
      {...(s.href === '#' ? { onClick: (e) => e.preventDefault() } : { target: '_blank', rel: 'noopener noreferrer' })}
      data-anim
      className="@container bg-lofi-base/40 hover:bg-lofi-surface border border-white/5 hover:border-lofi-primary/40 px-3 py-5 sm:p-5 rounded-2xl transition-all duration-300 group flex flex-col items-center text-center gap-3 relative overflow-hidden card-blur"
    >
      <div className="absolute inset-0 bg-linear-to-b from-lofi-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div
        className={`w-14 h-14 rounded-2xl bg-lofi-surface flex items-center justify-center ${accent} group-hover:scale-110 group-hover:-translate-y-1 transition-all duration-300 shadow-lg group-hover:shadow-[0_0_20px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)] z-10 border border-white/5`}
      >
        {s.fa ? (
          <i className={`${s.fa} text-2xl`} aria-hidden="true" />
        ) : (
          <img src={s.icon} alt="" width={32} height={32} loading="lazy" className="w-8 h-8 object-contain" />
        )}
      </div>
      <div className="z-10 mt-1 w-full min-w-0">
        {/* 2 lines reserved so neighbours line up whether the name wraps or not */}
        <div className="min-h-[2lh] text-sm font-medium text-white text-balance wrap-break-word hyphens-auto group-hover:text-lofi-primary transition-colors">{s.name}</div>
        <div className="text-[10px] text-lofi-muted mt-1 font-mono tracking-tight truncate">{s.host ?? new URL(s.href).hostname}</div>
        {live && (
          <div
            title={live.up ? `Online${live.ms != null ? ` · ${live.ms} ms` : ''}` : 'Down'}
            className={`mt-1.5 text-[10px] font-mono whitespace-nowrap flex items-center justify-center gap-1.5 ${live.up ? 'text-emerald-400' : 'text-red-400'}`}
          >
            <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${live.up ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-red-400'}`} aria-hidden="true" />
            {/* narrow cards: "● 239 ms" */}
            {live.up ? live.ms == null ? 'Online' : <span><span className="@max-[8rem]:sr-only">Online · </span>{live.ms} ms</span> : 'Down'}
          </div>
        )}
      </div>
      {Deco && <Deco />}
      {/* live widget numbers (internal services only, from /api/private) */}
      {Array.isArray(stats) && (
        <dl className="z-10 w-full grid grid-cols-1 @[9rem]:grid-cols-2 gap-1.5">
          {stats.map(([label, value]) => (
            <div key={label} title={`${label}: ${value}`} className="bg-lofi-base/60 border border-white/5 rounded-lg px-1.5 py-1 min-w-0 @[9rem]:odd:last:col-span-2">
              <dt className="text-[9px] font-mono uppercase text-lofi-muted truncate">{label}</dt>
              <dd className="text-xs font-medium text-white tabular-nums truncate">{compact(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </a>
  )
}

// "154,780" -> "154.8K" (exact value stays in the chip's title)
const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const compact = (v) => (/^\d{1,3}(,\d{3})+$/.test(v) && Number(v.replace(/,/g, '')) >= 10_000 ? COMPACT.format(Number(v.replace(/,/g, ''))) : v)

const GB = 2 ** 30
const pctOf = (x) => (x?.total ? Math.round((x.used / x.total) * 100) : null)
const gb = (x) => (x ? `${(x.used / GB).toFixed(1)} / ${(x.total / GB).toFixed(1)} GB` : '--')
const gbUsed = (x) => (x ? `${(x.used / GB).toFixed(1)} GB` : '--') // fits the tile; the full "used / total" goes in title
function dur(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

// /api/spotify, polled every 15 s while the tab is visible (the server asks Spotify at most every 10 s).
// undefined = loading; { enabled: false } = not set up, and polling stops.
function useSpotify() {
  const [sp, setSp] = useState()
  useEffect(() => {
    let alive = true
    const get = () =>
      document.visibilityState === 'visible' &&
      fetch('/api/spotify', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return
          setSp({ ...d, seen: Date.now() })
          if (d.enabled === false) stop()
        }, () => {})
    const t = setInterval(get, 15_000)
    const stop = () => (clearInterval(t), document.removeEventListener('visibilitychange', get))
    document.addEventListener('visibilitychange', get)
    get()
    return () => ((alive = false), stop())
  }, [])
  return sp
}

const ago = (iso, now) => {
  const m = Math.round(((now?.getTime() ?? Date.now()) - Date.parse(iso)) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
// Header pill: what I'm listening to on Spotify (public: track, artists, cover, link). Playing, paused, or the last
// played track; nothing at all until Spotify is set up. The progress bar runs locally between polls.
function NowPlaying({ sp, now }) {
  if (!sp?.enabled || !sp.track) return null
  const artists = sp.artists.join(', ')
  const paused = !sp.playing && sp.progressMs != null
  const label = sp.playing ? 'Now playing' : paused ? 'Paused' : `Last played${sp.playedAt ? ` · ${ago(sp.playedAt, now)}` : ''}`
  const pos = sp.progressMs == null ? null : sp.progressMs + (sp.ageMs ?? 0) + (sp.playing ? Math.max(0, (now?.getTime() ?? sp.seen) - sp.seen) : 0)
  return (
    <div className="order-last basis-full lg:order-none lg:basis-auto lg:flex-1 min-w-0 flex lg:justify-center">
      <a
        href={sp.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${sp.track} · ${artists}${sp.album ? ` · ${sp.album}` : ''}`}
        aria-label={`${label} on Spotify: ${sp.track} by ${artists}`}
        className="group w-full lg:max-w-sm min-w-0 flex items-center gap-3 rounded-2xl bg-lofi-base/50 border border-white/5 hover:border-[#1db954]/40 p-1.5 pr-3 transition-colors"
      >
        <span className="relative shrink-0">
          {sp.art ? (
            <img src={sp.art} alt="" width={44} height={44} className={`w-11 h-11 rounded-xl object-cover ${sp.playing ? '' : 'opacity-70'}`} />
          ) : (
            <span className="w-11 h-11 rounded-xl bg-lofi-surface flex items-center justify-center text-lofi-muted">
              <i className="fa-solid fa-music" aria-hidden="true" />
            </span>
          )}
          <i className="fa-brands fa-spotify absolute -bottom-1 -right-1 text-sm text-[#1db954] bg-lofi-base rounded-full" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-lofi-muted">
            {sp.playing && (
              <span className="flex items-end gap-px h-2.5" aria-hidden="true">
                {['60%', '100%', '45%'].map((h, i) => (
                  <span key={i} className="w-[2px] rounded-full bg-[#1db954] origin-bottom animate-eq" style={{ height: h, animationDelay: `${i * -0.23}s` }} />
                ))}
              </span>
            )}
            {label}
          </span>
          <span className="block text-sm text-white truncate group-hover:text-[#1db954] transition-colors">{sp.track}</span>
          <span className="block text-[11px] text-lofi-muted truncate">{artists}</span>
          {pos != null && sp.durationMs > 0 && (
            <span className="mt-1 block h-0.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
              <span className="block h-full bg-[#1db954] transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (pos / sp.durationMs) * 100)}%` }} />
            </span>
          )}
        </span>
      </a>
    </div>
  )
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

// The Hub's second row: host stats when unlocked, otherwise a sign-in line. Internal services render inside Services.
function Server({ d }) {
  const { unit } = useContext(Prefs)
  if (d === undefined) return null
  const here = encodeURIComponent(location.href)

  if (!d) {
    return (
      <div className="z-10 border-t border-white/5 pt-4 flex items-center justify-between gap-4">
        <p className="text-xs font-mono text-lofi-muted flex items-center gap-3 min-w-0">
          <i className="fa-solid fa-lock text-lofi-primary" aria-hidden="true" />
          <span className="truncate">Server &amp; internal apps</span>
        </p>
        <a
          href={`${AUTH_URL}/?rd=${here}`}
          aria-label="Sign in to see server status and internal services"
          className="shrink-0 text-xs font-mono text-lofi-primary bg-lofi-primary/10 hover:bg-lofi-primary/20 px-3 py-2 rounded-full border border-lofi-primary/20 transition-colors"
        >
          Sign in
        </a>
      </div>
    )
  }

  const { stats: st = {}, user } = d
  return (
    <section aria-label="Server" className="z-10 border-t border-white/5 pt-4 flex flex-col gap-3">
      <div className="flex flex-wrap justify-between items-center gap-x-4 gap-y-1 text-[10px] font-mono text-lofi-muted">
        <p className="flex items-center gap-2">
          <i className="fa-solid fa-microchip text-lofi-text/80" aria-hidden="true" />
          <span className="text-lofi-text/80 uppercase tracking-widest">Server</span>
          <span>
            up {st.uptime == null ? '--' : dur(st.uptime)} · load {st.load ? st.load.map((n) => n.toFixed(2)).join(' ') : '--'}
          </span>
        </p>
        {user && (
          <p>
            signed in as <span className="text-white">{user}</span> ·{' '}
            <a href={`${AUTH_URL}/logout?rd=${here}`} className="text-lofi-primary hover:underline">
              sign out
            </a>
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon="fa-gauge text-lofi-primary" label="CPU" value={st.cpu == null ? '--' : `${st.cpu}%`} pct={st.cpu} />
        <Stat icon="fa-memory text-blue-400" label={`RAM ${pctOf(st.mem) ?? '--'}%`} value={gbUsed(st.mem)} title={gb(st.mem)} pct={pctOf(st.mem)} />
        <Stat icon="fa-temperature-half text-lofi-secondary" label="Temp" value={st.temp == null ? 'n/a' : `${toUnit(st.temp, unit)}°${unit}`} pct={st.temp} />
        <Stat icon="fa-hard-drive text-emerald-400" label={`Disk ${pctOf(st.disk) ?? '--'}%`} value={gbUsed(st.disk)} title={gb(st.disk)} pct={pctOf(st.disk)} />
      </div>
    </section>
  )
}
