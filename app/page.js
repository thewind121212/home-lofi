'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AUTH_URL, SCENES, SCENES_URL, SERVICES } from '../lib/data'
import { STATIONS, stationById } from '../lib/stations'
import { DEFAULTS, SETTINGS_KEY, clockParts, parseSettings, sceneWeather, themeColors, toUnit } from '../lib/settings'
import { AQI_BANDS, aqiBand, aqiPos, chartPoints, memoCache, spread } from '../lib/weather'
import { useCloudSync } from './cloud'
import { Gallery, LockLook, Prefs, ScenePicker, Settings, closeDialog, load, motionOff, randomScene, save } from './settings'

// a browser with no saved location starts in Đà Lạt
const DEFAULT_LOC = { id: 1584071, name: 'Da Lat', region: 'Lam Dong', country: 'Vietnam', lat: 11.94646, lon: 108.44193, tz: 'Asia/Ho_Chi_Minh' }
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


// keys that only switch windows or modify others: they never wake the screensaver
const QUIET_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'OS', 'Shift', 'Tab', 'CapsLock'])

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
  // Soft lock: the clock screen stays until the swipe to unlock is dragged across. In memory only, so a reload opens unlocked.
  const [softLock, setSoftLock] = useState(false)
  const lockRef = useRef(false)
  lockRef.current = softLock
  const [status, setStatus] = useState('loading')
  const priv = usePrivate()
  const [spotify, applySpotify] = useSpotify()
  const steam = useSteam()
  const streams = useStations()
  // the radio station: the last one picked in this browser
  const [stationId, setStationId] = useState('lofi')
  useEffect(() => setStationId(stationById(load('station', 'lofi')).id), [])
  const pickStation = (id) => (setStationId(id), save('station', id))
  const station = stationById(stationId)
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
  // any input brings it back. It never locks: only the 🔒 button / L do (the soft lock below).
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
      if (e.type === 'keydown' && QUIET_KEYS.has(e.key)) return // Alt+Tab & co. to another window don't wake it
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
      else if (Date.now() - last >= set.idle * 1000) setIdle((idleRef.current = true))
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

  // owner = settings sync reached the server as OWNER_USER (the same check guards the Spotify controls).
  // wasOwner: this browser has been signed in as the owner before, so a lapsed login gets a "sign in" hint
  const owner = ['synced', 'syncing', 'offline'].includes(cloud.status)
  // the music card's tab: the last one picked in this browser (switching never stops the radio)
  const [audioTab, setAudioTab] = useState('radio')
  useEffect(() => {
    const t = load('audioTab', 'radio')
    if (AUDIO_TABS.some(([id]) => id === t)) setAudioTab(t)
  }, [])
  const pickAudio = (t) => (setAudioTab(t), save('audioTab', t))
  const source = musicSource(audioTab, tune, spotify)
  const mini = { source, tune, onRadio: () => music.current?.(), sp: spotify, owner, onSpotify: applySpotify, station }
  const [wasOwner, setWasOwner] = useState(false)
  useEffect(() => {
    if (owner) save('owner', true)
    setWasOwner(owner || load('owner', false) === true)
  }, [owner])

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
    // H toggles Hide, L locks, Space three times quickly locks too (not while typing, not with a dialog open, not while
    // locked; Space also not on a focused button / link / tab / slider, where it presses that control)
    let spaces = [] // times of the last Space presses
    const onKey = (e) => {
      const k = e.key.toLowerCase()
      const space = e.code === 'Space'
      if (k !== 'h' && k !== 'l' && !space) return
      if (e.ctrlKey || e.metaKey || e.altKey || lockRef.current) return
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return
      if (space) {
        if (e.repeat || e.target.closest?.('button, a, [role=tab], [role=slider], summary')) return
        const now = performance.now()
        spaces = [...spaces.filter((t) => now - t < 1200), now]
        if (spaces.length < 3) return
        spaces = []
        e.preventDefault()
        return lock()
      }
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
    <SteamData value={steam}>
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
        className={`relative z-10 max-w-7xl 2xl:max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-44 2xl:pb-8 min-h-screen flex flex-col transition-[opacity,filter,visibility] duration-700 ${focus || idle || softLock ? 'opacity-0 invisible' : ''} ${idle || softLock ? 'blur-md' : ''}`}
      >
        {/* phones: greeting, then clock | scene on one row. sm+: one row (also landscape phones) */}
        <header className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-8 glass-panel rounded-2xl p-4 sm:p-6">
          <div className="flex items-center gap-4 min-w-0">
            <div className={`w-12 h-12 shrink-0 rounded-full bg-linear-to-tr ${iconBg} flex items-center justify-center text-xl shadow-lg`}>
              {icon && <i className={`fa-solid ${icon} text-white`} aria-hidden="true" />}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{greeting}</h1>
              <p className="text-sm text-lofi-muted font-mono text-balance">Welcome to your space.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <ScenePicker
              className="order-2 sm:order-none ml-auto sm:ml-0"
              set={set}
              update={update}
              scene={{ id: scene, base, down: sceneDown, want: wantMode, mode, from: wx?.name }}
              onGallery={openGallery}
            />
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

        {/* Each block is mounted once (the radio never restarts) and placed by the grid:
            phones: one column, Steam · Music · Weather · Hub · Services
            lg (laptops): two columns, Steam + Music + Weather on the left, Hub + Services on the right
              (the Hub + Weather wrapper is display: contents there, so each one is its own grid item)
            2xl (≥1536 px, e.g. 1920×1080): three columns, Steam + Music | Services | Hub + Weather, so nothing scrolls;
              the side columns stay put (sticky) while a long app group scrolls the middle */}
        <main className="grow grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_auto_1fr] 2xl:grid-rows-1 gap-6 lg:items-start">
          <div className="lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:row-span-2 2xl:col-span-3 2xl:row-span-1 2xl:sticky 2xl:top-8 flex flex-col gap-6">
            <SteamCard d={steam} />
            <Music ctl={music} onTune={setTune} spotify={spotify} onSpotify={applySpotify} owner={owner} wasOwner={wasOwner} tab={audioTab} pick={pickAudio} station={station} streams={streams} onStation={pickStation} />
          </div>
          <div className="flex flex-col gap-6 lg:contents 2xl:flex 2xl:col-span-3 2xl:col-start-10 2xl:row-start-1 2xl:sticky 2xl:top-8">
            <div className="max-lg:order-1 lg:col-span-8 lg:col-start-5 lg:row-start-1">
              <Hub status={status} priv={priv} />
            </div>
            <div className="lg:col-span-4 lg:col-start-1 lg:row-start-3">
              <Weather status={status} setStatus={setStatus} setWx={setWx} cloudLoc={cloudLoc} onPick={() => cloud.touch(['location'])} />
            </div>
          </div>
          <div className="lg:col-span-8 lg:col-start-5 lg:row-start-2 lg:row-span-2 2xl:col-span-6 2xl:col-start-4 2xl:row-start-1 2xl:row-span-1">
            <Services priv={priv} />
          </div>
        </main>
      </div>

      {!focus && !idle && !softLock && (
        // 👁 Hide, 🔒 Lock and ⚙️ Settings float bottom right on the dashboard (Hide's bar has its own 👁 / 🔒)
        <div className="fixed z-20 right-4 sm:right-6 bottom-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-2 motion-safe:animate-[fade-in_0.4s_ease-out]">
          <DockButton icon="fa-eye-slash" label="Hide panels (H)" onClick={() => setFocus(true)} />
          <DockButton icon="fa-lock" label="Lock screen (swipe to unlock)" title="Lock screen (L)" onClick={lock} />
          <DockButton icon="fa-gear" label="Settings" onClick={() => setDlg.current.open || setDlg.current.showModal()} />
        </div>
      )}
      {softLock ? (
        <LockScreen onUnlock={unlock} set={set} update={update} screen={<ClockScreen now={now} clock={set.clock} look={lockLook(set)} wx={wx} />}>
          {set.lockMusic !== 'hide' && <MiniPlayer {...mini} variant="lock" />}
        </LockScreen>
      ) : (
        idle && <ClockScreen now={now} clock={set.clock} look={saverLook(set)} />
      )}
      {idle && !softLock && <WakeHint />}
      {/* Header is hidden in Hide, so the way back is the bar's eye button (or Esc / H); the bar can lock too */}
      {focus && !idle && !softLock && <FocusBar now={now} wx={wx} priv={priv} mini={mini} onShow={() => setFocus(false)} onLock={lock} />}
      <Settings dlg={setDlg} set={set} update={update} reset={reset} sync={cloud.status} />
      <Gallery dlg={galDlg} scene={scene} variant={wantMode} onPick={pickScene} />
    </SteamData>
    </Prefs>
  )
}

// '21:05', or '9:05' + a small 'PM'. tick: the colon breathes (the big clock on the lock screen / screensaver)
function Clock({ now, clock, tick }) {
  if (!now) return '--:--'
  const { time, ampm } = clockParts(now, clock)
  const [h, m] = time.split(':')
  return (
    <>
      {tick ? (
        <>
          {h}
          <span className="motion-safe:animate-colon">:</span>
          {m}
        </>
      ) : (
        time
      )}
      {ampm && <span className="text-[0.45em] ml-1 align-[0.15em]">{ampm}</span>}
    </>
  )
}

// the dashboard's floating 👁 / 🔒 / ⚙️, bottom right
function DockButton({ icon, label, title = label, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      className="glass-panel w-11 h-11 rounded-full flex items-center justify-center text-lofi-text hover:text-lofi-primary hover:scale-105 transition"
    >
      <i className={`fa-solid ${icon} text-sm`} aria-hidden="true" />
    </button>
  )
}

// The clock screen behind Lock and Screensaver: blur, then overlay over the scene, then the clock and the date.
// The lock has its own look (Settings > Lock screen); the screensaver keeps the plain one.
// Decorative: the header clock is the accessible one.
const lockLook = (s) => ({ clock: s.lockClock, date: s.lockDate, overlay: s.lockOverlay, blur: s.lockBlur, weather: s.lockWeather })
const saverLook = (s) => ({ clock: s.idleShow === 'clock' ? 'big' : 'off', date: true, overlay: s.idleShow === 'clock' ? 'soft' : 'off', blur: 'off', weather: false })
const BLUR = { soft: 6, strong: 16 } // px. Re-blurs the moving scene every frame: GPU work, so Off by default
function ClockScreen({ now, clock, look, wx }) {
  const { unit } = useContext(Prefs)
  const blur = BLUR[look.blur]
  const weather = look.weather && wx?.temp != null
  return (
    <div className="fixed inset-0 z-20 pointer-events-none select-none motion-safe:animate-[fade-in_1.2s_ease-out]" aria-hidden="true">
      {blur && <div className="absolute inset-0" style={{ backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)` }} />}
      {look.overlay !== 'off' && <div className={`absolute inset-0 lock-overlay-${look.overlay}`} />}
      {(look.clock !== 'off' || weather) && (
        <div className="idle-clock relative h-full flex flex-col items-center justify-center px-4 text-center">
          {look.clock !== 'off' && (
            <div className={`font-mono font-bold text-white leading-none whitespace-nowrap ${look.clock === 'small' ? 'text-5xl sm:text-6xl' : 'text-7xl sm:text-9xl short:text-7xl'}`}>
              <Clock now={now} clock={clock} tick />
            </div>
          )}
          {look.clock !== 'off' && look.date && (
            <div className="mt-4 sm:mt-6 font-mono font-bold text-xs sm:text-base uppercase tracking-[0.3em] text-white/90">
              {now?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          )}
          {/* the weather, quiet: icon, temperature · sky · place (the Weather card's data) */}
          {weather && (
            <div className="mt-3 sm:mt-4 flex items-center justify-center gap-2.5 font-mono text-sm sm:text-base text-white/90 whitespace-nowrap">
              <i className={`fa-solid ${wx.icon ?? 'fa-cloud'} ${ICON_COLOR[wx.icon] ?? 'text-white'}`} />
              <span className="font-bold">
                {toUnit(wx.temp, unit)}°<span className="text-white/60">{unit}</span>
              </span>
              {wx.desc && (
                <>
                  <span className="text-white/35">·</span>
                  <span className="text-white/75">{wx.desc}</span>
                </>
              )}
              {wx.name && (
                <>
                  <span className="max-sm:hidden text-white/35">·</span>
                  <span className="max-sm:hidden text-white/75 truncate max-w-52">{wx.name}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Screensaver: a faint hint in the lock controls' spot, gone after a few seconds (so the two are easy to tell apart)
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

// The lock screen: the clock layer, what's playing (Lock screen › Music: bright, or dim = fades when nobody's there) and a
// breathing "swipe to unlock" at the bottom, 🎨 (its look: the only settings that change while locked) top right.
// Unlock: swipe up anywhere (mouse or finger): the screen follows, and far enough (or a quick flick) it slides away;
// a short swipe springs back, so a bump, a cat or a stray key can't unlock. Or hold Space ~1 s (letting go springs back),
// or ↑ five times. 🎨 shows while the pointer is in the top right corner and for 3 s after a click / tap anywhere; other
// keys (Alt+Tab to another window) and moving the mouse elsewhere don't wake anything.
const REST_MS = 3000
const SPACE_MS = 1000
function LockScreen({ onUnlock, set, update, screen, children }) {
  const [dy, setDy] = useState(0) // how far the screen is pushed up, px
  const [held, setHeld] = useState(false) // a finger / the mouse or Space is moving it: no spring transition
  const [leaving, setLeaving] = useState(false)
  const [awake, setAwake] = useState(true) // a recent click / tap
  const [over, setOver] = useState({ corner: false, music: false }) // the pointer is there
  const [look, setLook] = useState(false)
  const timer = useRef(null)
  const press = useRef(null) // the pointer that went down: { id, y, last: [y, t], moved }
  const raf = useRef(0)
  const dyRef = useRef(0)
  dyRef.current = dy
  const goal = () => Math.min(260, innerHeight * 0.3) // pushed this far, it unlocks
  const rest = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setAwake(false), REST_MS)
  }
  const leave = () => {
    if (motionOff()) return onUnlock()
    setLeaving(true)
    setHeld(false)
    setDy(innerHeight)
    setTimeout(onUnlock, 320)
  }
  useEffect(() => {
    rest()
    const onDown = () => (setAwake(true), rest()) // a click / tap anywhere wakes it (keys don't: Alt+Tab)
    const stop = () => (cancelAnimationFrame(raf.current), (raf.current = 0), setHeld(false))
    const keyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault() // no page scroll, no press on a focused button
        if (e.repeat || raf.current) return
        setAwake(true)
        setHeld(true)
        const t0 = performance.now()
        const step = (t) => {
          const v = Math.min(1, (t - t0) / SPACE_MS) * goal()
          setDy(v)
          if (v >= goal()) return stop(), leave()
          raf.current = requestAnimationFrame(step)
        }
        raf.current = requestAnimationFrame(step)
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.target.closest?.('[data-noswipe]')) {
        e.preventDefault()
        const v = Math.max(0, dyRef.current + (e.key === 'ArrowUp' ? 1 : -1) * (goal() / 5))
        v >= goal() - 1 ? leave() : setDy(v)
      }
    }
    const keyUp = (e) => {
      if (e.code !== 'Space' || !raf.current) return
      e.preventDefault()
      stop()
      setDy(0) // let go early: springs back
      rest()
    }
    addEventListener('pointerdown', onDown, true)
    addEventListener('keydown', keyDown, true)
    addEventListener('keyup', keyUp, true)
    return () => {
      clearTimeout(timer.current)
      cancelAnimationFrame(raf.current)
      removeEventListener('pointerdown', onDown, true)
      removeEventListener('keydown', keyDown, true)
      removeEventListener('keyup', keyUp, true)
    }
  }, [])
  useEffect(() => (look ? clearTimeout(timer.current) : rest()), [look]) // the look panel keeps 🎨 there

  // swipe: only upward moves count; past 8 px it's a swipe (so a tap still presses a button)
  const down = (e) => {
    if (leaving || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('[data-noswipe]')) return
    press.current = { id: e.pointerId, y: e.clientY, last: [e.clientY, e.timeStamp], v: 0, moved: false }
  }
  const move = (e) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    const d = p.y - e.clientY
    if (!p.moved) {
      if (d < 8) return
      p.moved = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setHeld(true)
    }
    const dt = e.timeStamp - p.last[1]
    if (dt > 0) p.v = (p.last[0] - e.clientY) / dt // px / ms, upward
    p.last = [e.clientY, e.timeStamp]
    setDy(Math.max(0, d))
  }
  const up = (e) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    if (!p.moved) return
    setHeld(false)
    const flick = p.v > 0.4 && e.timeStamp - p.last[1] < 120 && dyRef.current > 40
    dyRef.current >= goal() || flick ? leave() : setDy(0)
  }
  const cancel = () => press.current && ((press.current = null), setHeld(false), setDy(0))
  // the hint, clicked: a little lift to show which way
  const nudge = () => {
    if (motionOff() || dyRef.current) return
    setDy(36)
    setTimeout(() => setDy((v) => (v === 36 ? 0 : v)), 220)
  }

  const hover = (k, on) => (setOver((o) => ({ ...o, [k]: on })), on ? setAwake(true) : rest())
  const tools = awake || over.corner || look
  const dim = set.lockMusic === 'dim' && !awake && !over.music && !dy
  const p = Math.min(1, dy / goal())
  return (
    <div
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      className="fixed inset-0 z-30 select-none touch-none [-webkit-touch-callout:none]"
      style={{
        transform: `translateY(${-dy}px)`,
        opacity: leaving ? 0 : 1 - p * 0.5,
        transition: held ? 'none' : 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.35s ease-out',
      }}
    >
      {screen}
      {/* 🎨 top right: comes with the pointer in the corner or a click / tap; its panel opens below it */}
      <div
        onPointerEnter={() => hover('corner', true)}
        onPointerLeave={() => hover('corner', false)}
        className="absolute z-10 top-0 right-0 pl-20 pb-20 pt-[max(1rem,env(safe-area-inset-top))] pr-4 sm:pt-6 sm:pr-6"
      >
        <button
          onClick={() => setLook((v) => !v)}
          aria-label="Lock screen look"
          aria-expanded={look}
          title="Lock screen look"
          className={`glass-panel w-12 h-12 rounded-full flex items-center justify-center transition-[opacity,translate,color] duration-500 ${look ? 'text-lofi-primary' : 'text-lofi-text hover:text-lofi-primary'} ${tools ? 'opacity-100' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
        >
          <i className="fa-solid fa-palette text-sm" aria-hidden="true" />
        </button>
        {look && (
          <section
            data-noswipe
            aria-label="Lock screen look"
            onKeyDown={(e) => e.key === 'Escape' && setLook(false)}
            className="glass-panel absolute right-4 sm:right-6 top-full -mt-14 rounded-3xl p-5 w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain touch-auto select-text text-lofi-text motion-safe:animate-[panel-in_0.3s_cubic-bezier(0.2,0.8,0.2,1)]"
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
      </div>
      {/* bottom center: what's playing, then the breathing hint */}
      <div className="absolute inset-x-0 bottom-0 pb-[max(2rem,env(safe-area-inset-bottom))] flex flex-col items-center px-4">
        {children && (
          <div
            onPointerEnter={() => hover('music', true)}
            onPointerLeave={() => hover('music', false)}
            className={`mb-3 transition-opacity duration-700 ${dim ? 'opacity-30' : 'opacity-100'}`}
          >
            {children}
          </div>
        )}
        <button
          onClick={nudge}
          aria-label="Swipe up to unlock (or hold Space, or press the up arrow five times)"
          className="h-8 px-4 flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-white/80 motion-safe:animate-breathe"
          style={{ opacity: 1 - p }}
        >
          <i className="fa-solid fa-chevron-up text-[10px]" aria-hidden="true" />
          swipe to unlock
        </button>
      </div>
    </div>
  )
}

// Hide's mini bar: show panels + lock | music (MiniPlayer) | weather | time | server. Segments without data are left out.
// Phones: labels (station, place, date) drop, below 375px the equalizer too, and the server stats get their own row.
const SEG = 'flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 border-l border-white/10'
function FocusBar({ now, wx, priv, mini, onShow, onLock }) {
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
        aria-label="Lock screen (swipe to unlock)"
        title="Lock (L)"
        className="w-9 h-9 ml-1 mr-1 sm:mr-2 shrink-0 rounded-full bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-text hover:text-lofi-primary transition-colors"
      >
        <i className="fa-solid fa-lock text-xs" aria-hidden="true" />
      </button>

      <div className={SEG}>
        <MiniPlayer {...mini} variant="bar" />
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

// the audio card's tabs: [id, label, icon]
const AUDIO_TABS = [
  ['radio', 'Radio', 'fa-solid fa-radio'],
  ['spotify', 'Spotify', 'fa-brands fa-spotify'],
  ['player', 'Player', 'fa-solid fa-music'],
]
function Music({ ctl, onTune, spotify, onSpotify, owner, wasOwner, tab, pick, station, streams, onStation }) {
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
  const [ready, setReady] = useState(false) // the YouTube player is built
  const [list, setList] = useState(false) // the station list popup
  const videoId = streams?.[station.id] ?? null
  const onAir = STATIONS.filter((s) => streams?.[s.id]) // stations with a live stream right now
  const step = (d) => {
    const i = onAir.findIndex((s) => s.id === station.id)
    const next = onAir[(i + d + onAir.length) % onAir.length]
    if (next) onStation(next.id)
  }
  const live = { radio: playing, spotify: Boolean(spotify?.enabled && spotify.track && spotify.playing) }

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
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, iv_load_policy: 3 },
          events: {
            onReady: (e) => {
              player.current = e.target
              e.target.setVolume(vol.current)
              setReady(true) // the effect below cues the station (and plays it if Play was pressed meanwhile)
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

  // the station's stream into the player: plays on if music is on (or was asked for), else just cued
  useEffect(() => {
    const p = player.current
    if (!ready || !p || !videoId || p.getVideoData?.()?.video_id === videoId) return
    if (isPlaying.current || want.current) {
      setLoading(true)
      p.loadVideoById(videoId)
    } else p.cueVideoById(videoId)
  }, [ready, videoId])

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
      {tab === 'radio' && (
        <div className="absolute bottom-0 left-0 w-full h-1/2 opacity-20 pointer-events-none flex items-end justify-between px-4 pb-4">
          {[8, 16, 12, 24, 10, 20, 14, 6].map((h, i) => (
            <div key={i} className="w-2 bg-lofi-primary rounded-t animate-pulse" style={{ height: h * 4, animationDelay: `${i / 10}s` }} />
          ))}
        </div>
      )}

      {/* Radio | Spotify | Player: the picked tab is filled (Spotify in its green); a dot marks a source that's playing */}
      <div role="tablist" aria-label="Audio" className="shrink-0 flex items-center gap-1.5 mb-3 z-20">
        {AUDIO_TABS.map(([id, label, icon]) => {
          const on = tab === id
          const fill = id === 'spotify' ? 'bg-[#1db954] text-lofi-base font-bold' : 'bg-lofi-primary text-lofi-base font-bold'
          return (
            <button
              key={id}
              role="tab"
              id={`audio-tab-${id}`}
              aria-selected={on}
              aria-controls="audio-panel"
              onClick={() => pick(id)}
              className={`relative h-8 px-3 rounded-full flex items-center gap-1.5 text-xs font-mono transition-colors ${on ? fill : 'bg-white/5 border border-white/10 text-lofi-muted hover:text-white'}`}
            >
              <i className={`${icon} text-xs`} aria-hidden="true" />
              {label}
              {live[id] && (
                <>
                  <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-lofi-base ${id === 'spotify' ? 'bg-[#1db954]' : 'bg-lofi-primary'} motion-safe:animate-pulse`} aria-hidden="true" />
                  <span className="sr-only"> (playing)</span>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* above the tabs (z-20) only while an Up next popup is open */}
      <div role="tabpanel" id="audio-panel" aria-labelledby={`audio-tab-${tab}`} className="grow min-h-0 flex flex-col z-10 has-[[role=dialog]]:z-30">
        {tab === 'radio' && (
          <>
            <div className="grow flex items-center justify-center mb-2 animate-float">
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
            {/* ◀ station ▾ ▶: the arrows flip stations, the name opens the list */}
            <div className="shrink-0 flex items-center justify-center gap-1 mb-1 min-w-0">
              <button onClick={() => step(-1)} aria-label="Previous station" disabled={onAir.length < 2} className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white disabled:opacity-30 transition-colors">
                <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true" />
              </button>
              <button
                onClick={() => setList(true)}
                aria-haspopup="dialog"
                aria-label={`Station: ${station.name}. Choose a station`}
                className="min-w-0 flex items-center gap-2 px-1 text-sm font-medium text-white hover:text-lofi-primary transition-colors"
              >
                <span className="text-[9px] font-mono text-lofi-primary bg-lofi-primary/10 px-1.5 py-0.5 rounded-full border border-lofi-primary/20">LIVE</span>
                <span aria-hidden="true">{station.emoji}</span>
                <span className="truncate">{station.name}</span>
                <i className="fa-solid fa-chevron-down text-[8px] text-lofi-muted" aria-hidden="true" />
              </button>
              <button onClick={() => step(1)} aria-label="Next station" disabled={onAir.length < 2} className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white disabled:opacity-30 transition-colors">
                <i className="fa-solid fa-chevron-right text-[10px]" aria-hidden="true" />
              </button>
            </div>
            <p className="shrink-0 text-xs text-lofi-muted text-center mb-3 truncate">
              {station.by} · {station.sub}
            </p>
            <div className="shrink-0 flex justify-center items-center gap-6">
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
            <p className="shrink-0 text-[10px] font-mono text-lofi-muted text-center mt-1.5" aria-live="polite">
              VOL {volume}%{hint && <span className="text-red-400"> · audio unavailable</span>}
            </p>
          </>
        )}
        {tab === 'radio' && list && <StationList current={station.id} streams={streams} playing={playing} onPick={(id) => (onStation(id), setList(false))} onClose={() => setList(false)} />}
        {tab === 'spotify' && <SpotifyPanel sp={spotify} owner={owner} wasOwner={wasOwner} onState={onSpotify} />}
        {tab === 'player' && <PlayerSoon />}
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

// fit: inside an @container (the Hub's server stats), compact with no icon until the container is wide
function Stat({ icon, label, value, pct, title, fit }) {
  return (
    <div className={`bg-lofi-surface/50 rounded-xl border border-white/5 flex items-center gap-3 hover:bg-lofi-surface transition-colors ${fit ? 'p-2 @lg:p-3' : 'p-3'}`}>
      {/* the wrapper hides it: Font Awesome's own display would beat a hidden on the <i> */}
      <span className={fit ? 'hidden @lg:block' : 'contents'} aria-hidden="true">
        <i className={`fa-solid ${icon} text-lg`} />
      </span>
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
    <div className="@container glass-panel rounded-3xl p-6 flex flex-col gap-5 relative overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-r from-lofi-surface/0 via-lofi-surface/20 to-lofi-surface/0 animate-shimmer pointer-events-none" />
      {/* wide: status + latency boxes on the right; narrow (the 2xl side column, phones): one small chip by the gateway */}
      <div className="flex justify-between items-center gap-4">
        <div className="z-10 grow min-w-0">
          <h2 className="text-xl font-medium text-white flex items-center gap-3">
            <i className="fa-solid fa-network-wired text-lofi-primary" aria-hidden="true" /> Home Services Hub
          </h2>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs @lg:text-sm text-lofi-muted font-mono truncate">Gateway: home.wliafdew.dev</p>
            <p className="@lg:hidden shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-lofi-base/50 border border-white/5 font-mono text-[11px]" title="System status · round-trip to /api/health">
              <span className={`w-1.5 h-1.5 rounded-full ${DOT[status]}`} aria-hidden="true" />
              <span className={color}>{label}</span>
              <span className="text-lofi-muted">· {latency == null ? '--' : `${latency}ms`}</span>
            </p>
          </div>
        </div>
        <div className="hidden @lg:flex gap-4 z-10">
          <div className="text-center px-4 py-2 bg-lofi-base/50 rounded-xl border border-white/5 shadow-inner" title="Weather API proxy status">
            <div className="text-[10px] text-lofi-muted font-mono uppercase">System Status</div>
            <div className={`text-sm ${color} font-medium flex items-center gap-1.5 justify-center mt-0.5`}>
              <div className={`w-1.5 h-1.5 rounded-full ${DOT[status]}`} /> {label}
            </div>
          </div>
          <div className="text-center px-4 py-2 bg-lofi-base/50 rounded-xl border border-white/5 shadow-inner" title="Round-trip to /api/health">
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
      {/* lg+: brush-stroke bookmark tabs. The rail runs down the card's right edge and the tabs stick to the top of the
          screen inside it, so they stay in reach while a long group (All) scrolls the page */}
      <div className="hidden lg:block absolute top-24 bottom-6 right-0 w-40 z-20 pointer-events-none">
        <div
          role="group"
          aria-label="Choose a group"
          className="sticky top-8 flex flex-col flex-wrap gap-1.5 pointer-events-auto"
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

// Steam: /api/steam, polled every 60 s while the tab is visible (Steam itself is asked at most once a minute), shared
// by the Steam card under the music and the status line on the Entertainment tab's Steam link.
const SteamData = createContext(null)
function useSteam() {
  const [d, setD] = useState() // undefined = loading (the card shows a skeleton), null = unreachable (no card)
  useEffect(() => {
    let alive = true
    const get = () =>
      document.visibilityState === 'visible' &&
      fetch('/api/steam')
        .then((r) => r.json())
        .then(
          (v) => alive && setD((prev) => (v.error ? (prev ?? null) : v)), // a hiccup keeps the last answer
          () => alive && setD((prev) => prev ?? null),
        )
    get()
    const t = setInterval(get, 60_000)
    document.addEventListener('visibilitychange', get)
    return () => ((alive = false), clearInterval(t), document.removeEventListener('visibilitychange', get))
  }, [])
  return d
}
// [label, dot, text, avatar ring], in Steam's own colors
const STEAM_STATE = {
  online: ['Online', 'bg-[#57cbde]', 'text-[#57cbde]', 'ring-[#57cbde]'],
  away: ['Away', 'bg-[#57cbde]/60', 'text-[#57cbde]/80', 'ring-[#57cbde]/50'],
  'in-game': ['Playing', 'bg-[#90ba3c]', 'text-[#a4d007]', 'ring-[#90ba3c]'],
  offline: ['Offline', 'bg-lofi-muted', 'text-lofi-muted', 'ring-white/15'],
}
const steamState = (d) => STEAM_STATE[d.state] ?? STEAM_STATE.offline
function SteamDot({ d }) {
  return <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${steamState(d)[1]} ${d.state === 'offline' ? '' : 'shadow-[0_0_6px_currentColor] motion-safe:animate-pulse'}`} aria-hidden="true" />
}

// The Steam card while /api/steam is on its way: the same shape in pulsing blocks, so nothing jumps when it lands
function SteamSkeleton() {
  const bar = 'rounded-md bg-white/8 motion-safe:animate-pulse'
  return (
    <section aria-label="Steam" aria-busy="true" className="glass-panel rounded-3xl p-5 flex flex-col gap-4">
      <span className="sr-only">Loading Steam…</span>
      <div className="flex items-center gap-4" aria-hidden="true">
        <span className={`w-14 h-14 rounded-2xl ${bar}`} />
        <span className="flex-1 flex flex-col gap-2">
          <span className={`h-4 w-28 ${bar}`} />
          <span className={`h-3 w-20 ${bar}`} />
          <span className={`h-2.5 w-32 ${bar}`} />
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-[3.25rem] rounded-xl ${bar}`} />
        ))}
      </div>
      <div aria-hidden="true">
        <span className={`block mb-1.5 h-2.5 w-24 ${bar}`} />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`aspect-[460/215] rounded-lg ${bar}`} />
          ))}
        </div>
      </div>
    </section>
  )
}

// The Entertainment tab's Steam link: just the live status (the numbers live on the Steam card)
function SteamStatus() {
  const d = useContext(SteamData)
  if (!d) return null
  const [label, , text] = steamState(d)
  return (
    <div className={`z-10 w-full flex items-center justify-center gap-1.5 text-[10px] font-mono min-w-0 ${text}`} title={d.game ? `Playing ${d.game}` : label}>
      <SteamDot d={d} />
      <span className="truncate">{d.game ? `Playing · ${d.game}` : label}</span>
    </div>
  )
}

// Above the music: the Steam profile. Avatar with a ring in the status color, name, level, status (or the game being
// played), then Games / Hours / 2 weeks with icons, then the recently played games (icon + hours this fortnight).
// Public: the same things the Steam profile shows. Nothing until /api/steam answers.
function SteamCard({ d }) {
  if (d === undefined) return <SteamSkeleton />
  if (!d) return null
  const [label, , text, ring] = steamState(d)
  const tiles = [
    d.owned != null && ['fa-gamepad', 'Games', d.owned.toLocaleString('en-US')],
    d.hours != null && ['fa-clock', 'Hours', d.hours.toLocaleString('en-US')],
    ['fa-calendar-week', '2 weeks', `${d.hours2w} h`],
  ].filter(Boolean)
  return (
    <section aria-label="Steam" className="glass-panel rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <a href={d.url} target="_blank" rel="noopener noreferrer" className="relative shrink-0" aria-label={`${d.name ?? 'Steam'} on Steam: ${d.game ? `playing ${d.game}` : label}`}>
          {d.avatar ? (
            <img src={d.avatar} alt="" width={56} height={56} className={`w-14 h-14 rounded-2xl object-cover ring-2 ring-offset-2 ring-offset-lofi-base ${ring}`} />
          ) : (
            <span className={`w-14 h-14 rounded-2xl bg-lofi-surface flex items-center justify-center ring-2 ${ring}`}>
              <i className="fa-brands fa-steam text-2xl text-lofi-muted" aria-hidden="true" />
            </span>
          )}
          <i className="fa-brands fa-steam absolute -bottom-1.5 -right-1.5 text-base text-white bg-[#1b2838] rounded-full p-0.5" aria-hidden="true" />
        </a>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 min-w-0">
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-base font-medium text-white truncate hover:text-[#57cbde] transition-colors">
              {d.name ?? 'Steam'}
            </a>
            {d.level != null && (
              <span className="shrink-0 text-[10px] font-mono text-lofi-highlight border border-lofi-highlight/30 bg-lofi-highlight/10 rounded-full px-1.5 py-px" title="Steam level">
                Lv {d.level}
              </span>
            )}
          </p>
          <p className={`mt-0.5 flex items-center gap-1.5 text-xs font-mono min-w-0 ${text}`}>
            <SteamDot d={d} />
            <span className="truncate">{d.game ? `Playing · ${d.game}` : label}</span>
          </p>
          {d.since && <p className="mt-0.5 text-[10px] font-mono text-lofi-muted">on Steam since {d.since}</p>}
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map(([icon, k, v]) => (
          <div key={k} className="bg-lofi-base/50 border border-white/5 rounded-xl px-2.5 py-2 min-w-0">
            <dt className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-lofi-muted truncate">
              <i className={`fa-solid ${icon} text-[#57cbde]`} aria-hidden="true" />
              {k}
            </dt>
            <dd className="mt-0.5 text-sm font-medium text-white tabular-nums truncate">{v}</dd>
          </div>
        ))}
      </dl>
      {d.recent?.length > 0 && (
        <div className="min-w-0">
          <p className="mb-1.5 text-[9px] font-mono uppercase tracking-widest text-lofi-muted">Recently played</p>
          <ul className="grid grid-cols-3 gap-2">
            {d.recent.map((g) => (
              <li key={g.name} className="min-w-0">
                <a
                  href={g.appid ? `https://store.steampowered.com/app/${g.appid}` : d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${g.name} · ${g.hours2w} h these 2 weeks · ${g.hours} h total`}
                  className="group relative block aspect-[460/215] rounded-lg overflow-hidden bg-lofi-surface ring-1 ring-white/10 hover:ring-[#57cbde]/60 transition"
                >
                  <span className="absolute inset-0 flex items-center justify-center text-lofi-muted" aria-hidden="true">
                    <i className="fa-solid fa-gamepad" />
                  </span>
                  {g.art && (
                    <img
                      src={g.art}
                      alt=""
                      width={460}
                      height={215}
                      loading="lazy"
                      onError={(e) => (e.currentTarget.style.display = 'none')} // the 🎮 behind it shows instead
                      className="relative w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  )}
                  <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 bg-linear-to-t from-black/80 to-transparent text-[10px] font-mono text-white tabular-nums">
                    {g.hours2w} h
                  </span>
                  <span className="sr-only">{g.name}: {g.hours2w} hours these 2 weeks</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// card decorations by `deco` key (lib/data.js / private-services.json)
const DECOR = { vault: Secret, graph: Graph, shell: Shell, steam: SteamStatus }

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
// undefined = loading; { enabled: false } = not set up, and polling stops. Returns [state, apply(fresh state)].
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
  return [sp, (d) => setSp({ ...d, seen: Date.now() })]
}

// /api/stations: each station's live stream right now ({ id: videoId | null }); refreshed hourly. null until it answers.
function useStations() {
  const [m, setM] = useState(null)
  useEffect(() => {
    let alive = true
    const get = () =>
      fetch('/api/stations')
        .then((r) => r.json())
        .then((v) => alive && !v.error && setM(v), () => {})
    get()
    const t = setInterval(get, 3600_000)
    return () => ((alive = false), clearInterval(t))
  }, [])
  return m
}

// Radio: all the stations in a popup over the card; the current one is lit (with a dot while it plays). A station
// without a live stream right now is greyed out. Esc, ✕ or a click outside closes it.
function StationList({ current, streams, playing, onPick, onClose }) {
  const close = useRef(null)
  useEffect(() => {
    close.current?.focus({ preventScroll: true })
    const onKey = (e) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3 bg-lofi-base/60 motion-safe:animate-[fade-in_0.2s_ease-out]" onClick={onClose}>
      <div role="dialog" aria-label="Radio stations" onClick={(e) => e.stopPropagation()} className="relative w-full glass-panel rounded-2xl p-3 motion-safe:animate-[panel-in_0.25s_cubic-bezier(0.2,0.8,0.2,1)]">
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-[10px] font-mono uppercase tracking-widest text-lofi-muted">Stations</p>
          <button ref={close} onClick={onClose} aria-label="Close" className="w-6 h-6 rounded-full bg-lofi-base/60 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white transition-colors">
            <i className="fa-solid fa-xmark text-[10px]" aria-hidden="true" />
          </button>
        </div>
        <ul className="grid grid-cols-2 gap-1.5">
          {STATIONS.map((s) => {
            const on = s.id === current
            const off = streams && !streams[s.id]
            return (
              <li key={s.id}>
                <button
                  onClick={() => onPick(s.id)}
                  disabled={off}
                  aria-current={on || undefined}
                  title={`${s.name} · ${s.by} · ${s.sub}`}
                  className={`w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-left border transition-colors disabled:opacity-35 ${on ? 'bg-lofi-primary/15 border-lofi-primary/40 text-white' : 'border-white/5 bg-lofi-base/40 text-lofi-text hover:border-white/20 hover:text-white'}`}
                >
                  <span className="text-sm" aria-hidden="true">{s.emoji}</span>
                  <span className="min-w-0 flex-1 text-xs font-medium truncate">{s.name}</span>
                  {on && playing && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-lofi-primary motion-safe:animate-pulse" aria-hidden="true" />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// Spotify tab: what I'm listening to (public: track, artists, cover, link). A still cover over a blurred, faint copy of
// it that tints the card (no spinning: calm to look at); paused dims it. Nothing playing, not connected yet or
// unreachable: SpotifyResting instead. The progress runs locally between polls.
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
const SP_ERR = {
  premium: 'Controls need Spotify Premium',
  device: 'Open Spotify on a device first',
  scope: 'Reconnect Spotify to allow controls',
  spotify: "Spotify didn't answer",
}
// The owner's controls (signed in, Premium): POST /api/private/settings/spotify -> the fresh state, shown at once.
function useSpotifyControl(onState) {
  const [busy, setBusy] = useState(null) // the action in flight
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => setErr(null), 4000)
    return () => clearTimeout(t)
  }, [err])
  async function act(action) {
    if (busy) return
    setBusy(action)
    setErr(null)
    try {
      const r = await fetch('/api/private/settings/spotify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
        redirect: 'manual',
        cache: 'no-store',
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) onState(d)
      else setErr(SP_ERR[d.error] ?? SP_ERR.spotify)
    } catch {
      setErr(SP_ERR.spotify)
    } finally {
      setBusy(null)
    }
  }
  return { act, busy, err }
}

function SpotifyPanel({ sp, owner, wasOwner, onState }) {
  const [, tick] = useState(0) // every second while playing, for the progress (this panel only)
  useEffect(() => {
    if (!sp?.playing) return
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [sp?.playing])
  const ctl = useSpotifyControl(onState)
  const [peek, setPeek] = useState(null) // an Up next track shown in the popup
  if (sp === undefined) return null // first answer on its way
  if (!sp.enabled || !sp.track) return <SpotifyResting owner={owner} ctl={ctl} />
  const artists = sp.artists.join(', ')
  const pos = Math.min(sp.durationMs || 0, sp.progressMs + (sp.ageMs ?? 0) + (sp.playing ? Math.max(0, Date.now() - sp.seen) : 0))
  const next = (sp.upNext ?? []).slice(0, owner ? 2 : 3)
  return (
    <>
      {/* ambient: the cover, blurred and faint, behind the whole card (static) */}
      {sp.art && <div className="absolute inset-0 -z-10 bg-cover bg-center scale-125 blur-2xl opacity-30" style={{ backgroundImage: `url(${sp.art})` }} aria-hidden="true" />}
      <div className="flex items-center gap-4 mb-3">
        <a
          href={sp.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${sp.playing ? 'Now playing' : 'Paused'} on Spotify: ${sp.track} by ${artists}`}
          className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 transition-transform duration-300 hover:scale-105"
        >
          {sp.art ? (
            <img src={sp.art} alt="" width={80} height={80} className={`w-full h-full object-cover transition-[filter,opacity] duration-500 ${sp.playing ? '' : 'grayscale-[50%] opacity-75'}`} />
          ) : (
            <span className="w-full h-full bg-lofi-surface flex items-center justify-center text-lofi-muted">
              <i className="fa-solid fa-music text-xl" aria-hidden="true" />
            </span>
          )}
        </a>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-lofi-muted mb-1">
            {sp.playing && (
              <span className="flex items-end gap-px h-2.5" aria-hidden="true">
                {['60%', '100%', '45%'].map((h, i) => (
                  <span key={i} className="w-[2px] rounded-full bg-[#1db954] origin-bottom animate-eq" style={{ height: h, animationDelay: `${i * -0.23}s` }} />
                ))}
              </span>
            )}
            {sp.playing ? 'Now playing' : 'Paused'}
          </p>
          <a href={sp.url} target="_blank" rel="noopener noreferrer" title={sp.album ?? undefined} className="block text-base font-medium text-white truncate hover:text-[#1db954] transition-colors">
            {sp.track}
          </a>
          <p className="text-xs text-lofi-muted truncate">{artists}</p>
        </div>
      </div>
      {sp.durationMs > 0 && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-lofi-muted tabular-nums" aria-hidden="true">
          <span>{mmss(pos)}</span>
          <span className="grow h-1 rounded-full bg-white/10 overflow-hidden">
            <span className="block h-full bg-[#1db954] transition-[width] duration-1000 ease-linear" style={{ width: `${(pos / sp.durationMs) * 100}%` }} />
          </span>
          <span>{mmss(sp.durationMs)}</span>
        </div>
      )}
      {owner && (
        <div className="mt-2 flex items-center justify-center gap-5">
          <SpBtn label="Previous" icon="fa-backward-step" onClick={() => ctl.act('previous')} busy={ctl.busy === 'previous'} />
          <SpBtn
            big
            label={sp.playing ? 'Pause' : 'Play'}
            icon={sp.playing ? 'fa-pause' : 'fa-play ml-0.5'}
            onClick={() => ctl.act(sp.playing ? 'pause' : 'play')}
            busy={ctl.busy === 'play' || ctl.busy === 'pause'}
          />
          <SpBtn label="Next" icon="fa-forward-step" onClick={() => ctl.act('next')} busy={ctl.busy === 'next'} />
        </div>
      )}
      {!owner && wasOwner && <SignInToControl />}
      {ctl.err && <p className="mt-1 text-[10px] font-mono text-red-400 text-center" role="status">{ctl.err}</p>}
      {next.length > 0 && !ctl.err && (
        <div className="mt-auto pt-2 min-w-0">
          <p className="text-[9px] font-mono uppercase tracking-widest text-lofi-muted mb-1">Up next</p>
          <ul className="space-y-1">
            {next.map((t, i) => (
              <li key={i}>
                <button
                  onClick={() => setPeek(t)}
                  aria-haspopup="dialog"
                  aria-label={`Up next: ${t.track} by ${t.artists.join(', ')}. Details`}
                  className="w-full flex items-center gap-2 min-w-0 text-[11px] text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-white/5 transition-colors"
                >
                  {t.thumb ? <img src={t.thumb} alt="" width={18} height={18} className="w-[18px] h-[18px] rounded shrink-0" /> : <i className="fa-solid fa-music text-lofi-muted w-[18px] text-center" aria-hidden="true" />}
                  <span className="text-white/80 truncate">{t.track}</span>
                  <span className="text-lofi-muted truncate shrink-[2]">· {t.artists.join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {peek && <TrackPeek t={peek} onClose={() => setPeek(null)} />}
    </>
  )
}

// Up next details: a small popup over the card, big cover, title, artists, album and a link to Spotify.
// Esc, the ✕ or a click outside it closes it.
function TrackPeek({ t, onClose }) {
  const close = useRef(null)
  useEffect(() => {
    close.current?.focus({ preventScroll: true })
    const onKey = (e) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-lofi-base/60 motion-safe:animate-[fade-in_0.2s_ease-out]" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`${t.track} by ${t.artists.join(', ')}`}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-64 glass-panel rounded-2xl p-4 flex flex-col items-center text-center motion-safe:animate-[panel-in_0.25s_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <button
          ref={close}
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-lofi-base/60 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
        >
          <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
        </button>
        <p className="text-[9px] font-mono uppercase tracking-widest text-lofi-muted mb-2">Up next</p>
        {t.art ? (
          <img src={t.art} alt="" width={112} height={112} className="w-28 h-28 rounded-xl object-cover shadow-2xl ring-1 ring-white/10 mb-3" />
        ) : (
          <span className="w-28 h-28 rounded-xl bg-lofi-surface flex items-center justify-center text-lofi-muted mb-3">
            <i className="fa-solid fa-music text-2xl" aria-hidden="true" />
          </span>
        )}
        <p className="w-full text-sm font-medium text-white truncate">{t.track}</p>
        <p className="w-full text-xs text-lofi-muted truncate">{t.artists.join(', ')}</p>
        {t.album && <p className="w-full text-[10px] font-mono text-lofi-muted/80 truncate mt-0.5">{t.album}</p>}
        {t.url && (
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 h-8 px-4 rounded-full bg-[#1db954] text-lofi-base text-xs font-bold flex items-center gap-2 hover:scale-105 transition-transform"
          >
            <i className="fa-brands fa-spotify" aria-hidden="true" /> Open in Spotify
          </a>
        )}
      </div>
    </div>
  )
}

// the controls' place when this browser's owner login has lapsed (never for guests: they were never the owner here)
function SignInToControl() {
  return (
    <p className="mt-2 text-center text-[11px] font-mono">
      <a href={`${AUTH_URL}/?rd=${encodeURIComponent(location.href)}`} className="text-lofi-primary hover:underline inline-flex items-center gap-1.5">
        <i className="fa-solid fa-lock text-[10px]" aria-hidden="true" /> Sign in to control
      </a>
    </p>
  )
}

// Which music the Hide bar and the lock screen show: whatever is playing, else the picked tab (Spotify only when it
// has a track; the Player tab joins once it exists), else the radio.
const spOn = (sp) => Boolean(sp?.enabled && sp.track)
function musicSource(tab, tune, sp) {
  if (tune.playing || tune.loading) return 'radio'
  if (spOn(sp) && sp.playing) return 'spotify'
  return tab === 'spotify' && spOn(sp) ? 'spotify' : 'radio'
}

// What's playing, small: in the Hide bar (variant "bar") and on the lock screen ("lock"). Radio: play / pause for
// everyone. Spotify: cover, track, artists; the owner also gets play / pause and next. The lock shows nothing when
// nothing plays.
function MiniPlayer({ variant, source, tune, onRadio, sp, owner, onSpotify, station }) {
  const ctl = useSpotifyControl(onSpotify)
  const lock = variant === 'lock'
  const eq = (on, color) => (
    <span className="max-[374px]:hidden flex items-end gap-0.5 h-4 shrink-0" aria-hidden="true">
      {[10, 16, 7, 13].map((h, i) => (
        <span key={i} className={`w-[3px] rounded-full ${color} origin-bottom ${on ? 'animate-eq' : 'scale-y-30 opacity-60'}`} style={{ height: h, animationDelay: `${i * -0.23}s` }} />
      ))}
    </span>
  )
  const box = lock ? 'glass-panel rounded-2xl p-2 pr-3 flex items-center gap-3 max-w-[calc(100vw-2rem)] font-mono text-sm text-white' : 'contents'

  if (source === 'spotify' && spOn(sp)) {
    const artists = sp.artists.join(', ')
    return (
      <div className={box} role={lock ? 'group' : undefined} aria-label={lock ? 'Now playing' : undefined}>
        <a href={sp.url} target="_blank" rel="noopener noreferrer" className="relative shrink-0" aria-label={`${sp.playing ? 'Now playing' : 'Paused'} on Spotify: ${sp.track} by ${artists}`}>
          {sp.art ? (
            <img src={sp.art} alt="" width={36} height={36} className={`${lock ? 'w-11 h-11 rounded-xl' : 'w-8 h-8 rounded-lg'} object-cover ${sp.playing ? '' : 'opacity-70'}`} />
          ) : (
            <span className={`${lock ? 'w-11 h-11' : 'w-8 h-8'} rounded-lg bg-lofi-surface flex items-center justify-center`}>
              <i className="fa-solid fa-music text-lofi-muted" />
            </span>
          )}
          <i className="fa-brands fa-spotify absolute -bottom-1 -right-1 text-xs text-[#1db954] bg-lofi-base rounded-full" aria-hidden="true" />
        </a>
        <span className={`min-w-0 font-sans ${lock ? 'max-w-52' : 'max-sm:hidden max-w-40'}`}>
          <span className="block text-xs text-white truncate">{sp.track}</span>
          <span className="block text-[11px] text-lofi-muted truncate">{artists}</span>
        </span>
        {eq(sp.playing, 'bg-[#1db954]')}
        {owner && (
          <span className="flex items-center gap-1 shrink-0">
            <SpBtn small big label={sp.playing ? 'Pause' : 'Play'} icon={sp.playing ? 'fa-pause' : 'fa-play ml-0.5'} onClick={() => ctl.act(sp.playing ? 'pause' : 'play')} busy={ctl.busy === 'play' || ctl.busy === 'pause'} />
            <SpBtn small label="Next" icon="fa-forward-step" onClick={() => ctl.act('next')} busy={ctl.busy === 'next'} />
          </span>
        )}
        {ctl.err && <span className="text-[10px] text-red-400 whitespace-nowrap" role="status">{ctl.err}</span>}
      </div>
    )
  }

  if (lock && !tune.playing && !tune.loading) return null // the lock shows only music that plays
  return (
    <div className={box} role={lock ? 'group' : undefined} aria-label={lock ? 'Now playing' : undefined}>
      <button
        onClick={onRadio}
        title={tune.playing ? 'Pause' : 'Play'}
        aria-label={`${tune.playing ? 'Pause' : 'Play'} ${station.name} radio`}
        className="w-9 h-9 shrink-0 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center hover:bg-lofi-highlight transition-colors shadow-[0_0_12px_color-mix(in_oklab,var(--color-lofi-primary)_40%,transparent)]"
      >
        <i className={`fa-solid text-xs ${tune.loading ? 'fa-spinner fa-spin' : tune.playing ? 'fa-pause' : 'fa-play ml-0.5'}`} aria-hidden="true" />
      </button>
      <span className={`${lock ? '' : 'max-sm:hidden'} font-sans text-xs text-lofi-text whitespace-nowrap`}>
        <span aria-hidden="true">{station.emoji}</span> {station.name}
      </span>
      {/* equalizer: dances while playing, rests low when paused (and stands still with reduced motion) */}
      {eq(tune.playing, 'bg-lofi-primary')}
    </div>
  )
}

// a Spotify control button; the big one is the green play / pause
function SpBtn({ label, icon, onClick, busy, big, small }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        `${small ? 'w-8 h-8' : big ? 'w-10 h-10' : 'w-9 h-9'} rounded-full flex items-center justify-center transition ${
          big ? 'bg-[#1db954] text-lofi-base hover:scale-105' : 'text-lofi-muted hover:text-white'
        }`
      }
    >
      <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : icon} ${small ? 'text-xs' : big ? 'text-sm' : ''}`} aria-hidden="true" />
    </button>
  )
}

// Spotify tab with nothing to show: an empty cover frame and a line that changes now and then. No link, no controls.
const IDLE_LINES = ['Silence, mostly', 'Taking a music break', 'Probably debugging', 'Headphones off', 'Waiting for the next song']
function SpotifyResting({ owner, ctl }) {
  const { reduced } = useContext(Prefs)
  const [k, setK] = useState(0)
  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setK((i) => i + 1), 6000)
    return () => clearInterval(t)
  }, [reduced])
  return (
    <>
      <div className="grow flex items-center justify-center mb-3" aria-hidden="true">
        <div className="w-28 h-28 rounded-2xl border-2 border-dashed border-white/10 bg-lofi-base/30 flex items-center justify-center">
          <i className="fa-brands fa-spotify text-3xl text-[#1db954]/50" />
        </div>
      </div>
      <p className="text-[9px] font-mono uppercase tracking-widest text-lofi-muted text-center mb-1">Spotify · not playing</p>
      <p key={k} className="text-sm font-medium text-white/80 text-center truncate motion-safe:animate-card-in" aria-hidden="true">
        {IDLE_LINES[k % IDLE_LINES.length]}
      </p>
      <p className="text-xs text-lofi-muted text-center mb-2">nothing on right now</p>
      {owner && (
        <div className="flex flex-col items-center gap-1">
          <SpBtn big label="Resume on Spotify" icon="fa-play ml-0.5" onClick={() => ctl.act('play')} busy={ctl.busy === 'play'} />
          {ctl.err && <p className="text-[10px] font-mono text-red-400" role="status">{ctl.err}</p>}
        </div>
      )}
    </>
  )
}

// Player tab: the owner's own "play any song" player (streamed through the server) is next; for now a promise.
function PlayerSoon() {
  return (
    <div className="grow flex flex-col items-center justify-center text-center gap-2">
      <div className="w-16 h-16 rounded-2xl bg-lofi-surface border border-white/5 flex items-center justify-center mb-2" aria-hidden="true">
        <i className="fa-solid fa-magnifying-glass text-xl text-lofi-primary" />
      </div>
      <p className="text-sm font-medium text-white">Play any song</p>
      <p className="text-xs text-lofi-muted text-balance max-w-56">Search and play anything, streamed through home. Coming soon.</p>
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

  const { stats: st = {} } = d
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
      </div>
      {/* narrow: four across, no icons */}
      <div className="grid grid-cols-4 gap-2 @lg:gap-3">
        <Stat fit icon="fa-gauge text-lofi-primary" label="CPU" value={st.cpu == null ? '--' : `${st.cpu}%`} pct={st.cpu} />
        <Stat fit icon="fa-memory text-blue-400" label={`RAM ${pctOf(st.mem) ?? '--'}%`} value={gbUsed(st.mem)} title={gb(st.mem)} pct={pctOf(st.mem)} />
        <Stat fit icon="fa-temperature-half text-lofi-secondary" label="Temp" value={st.temp == null ? 'n/a' : `${toUnit(st.temp, unit)}°${unit}`} pct={st.temp} />
        <Stat fit icon="fa-hard-drive text-emerald-400" label={`Disk ${pctOf(st.disk) ?? '--'}%`} value={gbUsed(st.disk)} title={gb(st.disk)} pct={pctOf(st.disk)} />
      </div>
    </section>
  )
}
