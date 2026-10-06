'use client'

import { createContext, useEffect, useRef, useState } from 'react'
import { AUTH_URL, DAY_SCENES, SCENES, SCENES_URL } from '../lib/data'
import { DEFAULTS, SCENE_WEATHER, THEMES, customTheme, sceneName } from '../lib/settings'

// settings + `reduced` (Motion: Reduced, or the OS asks for it), provided by Home
export const Prefs = createContext({ ...DEFAULTS, reduced: false })

// localStorage can throw (private mode, blocked storage) -> fall back silently
export function load(key, fallback) {
  try {
    const v = localStorage.getItem('home-lofi:' + key)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
export function save(key, value) {
  try {
    localStorage.setItem('home-lofi:' + key, JSON.stringify(value))
  } catch {}
}

// Imperative code (WAAPI timelines, dialog exits) reads the same `reduced`, mirrored onto <html data-motion> by Home
export const motionOff = () => document.documentElement.dataset.motion === 'reduce'

// Every close path (✕, Esc, backdrop) plays the exit animation, then really closes. The dialog's onClose must
// delete dataset.closing (the browser can close it without us, e.g. a second Esc).
export function closeDialog(d) {
  if (!d?.open || 'closing' in d.dataset) return
  if (motionOff()) return d.close()
  d.dataset.closing = ''
  let t
  const done = (e) => {
    if (e && e.target !== d) return // a child's animation (panel and ::backdrop both target the dialog)
    d.removeEventListener('animationend', done)
    clearTimeout(t)
    if ('closing' in d.dataset) d.close() // already closed (onClose cleared it) -> don't touch a re-opened panel
  }
  d.addEventListener('animationend', done)
  t = setTimeout(done, 400) // fallback if animationend never fires
}

const SWATCHES = [
  ['sunset', 'Sunset'],
  ['sakura', 'Sakura'],
  ['matcha', 'Matcha'],
  ['ocean', 'Ocean'],
  ['lavender', 'Lavender'],
  ['lemon', 'Lemon'],
]
const swatchBg = ([a, b, c]) => `linear-gradient(135deg, ${c} 0%, ${a} 50%, ${b} 100%)`

// One setting = a fieldset of native radios (arrow keys, one tab stop, radiogroup semantics for free), drawn as pills
function Choice({ legend, name, value, options, onChange, children }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[10px] font-mono uppercase tracking-widest text-lofi-muted">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, label]) => (
          <label key={v} className="relative">
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="peer sr-only" />
            <span className="h-8 px-3 flex items-center rounded-full border border-white/10 bg-white/5 font-mono text-xs text-lofi-text cursor-pointer transition-colors hover:border-white/25 hover:text-white peer-checked:bg-lofi-primary peer-checked:border-transparent peer-checked:text-lofi-base peer-checked:font-bold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lofi-primary">
              {label}
            </span>
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  )
}

// Scene weather: label + icon (header scene button's badge, the scene picker's chips)
export const SCENE_WX = {
  signature: ['Signature', 'fa-wand-magic-sparkles'],
  live: ['Live', 'fa-tower-broadcast'],
  clear: ['Clear', 'fa-sun'],
  drizzle: ['Drizzle', 'fa-cloud-rain'],
  rain: ['Rain', 'fa-cloud-showers-heavy'],
  thunderstorm: ['Storm', 'fa-cloud-bolt'],
  snow: ['Snow', 'fa-snowflake'],
  leaves: ['Leaves', 'fa-leaf'],
}
// 'Storm', or for Live the weather it follows: 'Live · Rain' ('Live' while it waits)
export const wxName = (weather, want) => (weather === 'live' && want ? `Live · ${SCENE_WX[want][0]}` : SCENE_WX[weather][0])

// scene = { want, mode, from }: the variant asked for (null while Live waits for the weather), the one shown, Live's city
function weatherHint(set, { want, mode, from }) {
  const live = set.weather === 'live'
  if (live && !want) return 'Live: waiting for the weather…'
  if (live && want === 'signature') return `Live: ${from ? `no variant for the weather in ${from}` : 'weather unavailable'}, showing Signature`
  const t = live ? `Live now: ${SCENE_WX[want][0]}${from ? ` in ${from}` : ''}` : ''
  const miss = want !== mode ? `${SCENE_WX[want][0]} isn't available for this scene yet, showing Signature` : ''
  return [t, miss].filter(Boolean).join(' · ')
}

// Day / night line for DAY_SCENES (nothing for night-only scenes, or while Live waits): what plays, and what decides it
function dayHint({ id, base, wantDay, day, from }) {
  if (!base || !DAY_SCENES.includes(id)) return ''
  if (wantDay && !day) return "☀️ Daytime · this scene's day version isn't available, showing night"
  return `${day ? '☀️ Daytime' : '🌙 Night'} · ${from ? `follows the sun in ${from}` : 'follows your clock'}`
}

// The lock screen's look (the screensaver keeps the plain one). In the Settings dialog, and alone on the lock
// screen's own panel: the only settings that can change while locked.
export function LockLook({ set, update, id = 'look' }) {
  const opt = (key, legend, options) => (
    <Choice legend={legend} name={`${id}-${key}`} value={set[key]} options={options} onChange={(v) => update({ [key]: v })} />
  )
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-6">
      {opt('lockClock', 'Clock size', [['big', 'Big'], ['small', 'Small'], ['off', 'Off']])}
      {opt('lockDate', 'Date', [[true, 'Show'], [false, 'Hide']])}
      {opt('lockOverlay', 'Overlay', [['off', 'Off'], ['soft', 'Soft'], ['dark', 'Dark']])}
      {opt('lockBlur', 'Blur', [['off', 'Off'], ['soft', 'Soft'], ['strong', 'Strong']])}
      {opt('lockMusic', 'Music', [['bright', 'Bright'], ['dim', 'Dim'], ['hide', 'Hide']])}
      {opt('lockWeather', 'Weather', [[true, 'Show'], [false, 'Hide']])}
    </div>
  )
}

// Where the settings live (app/cloud.js status): icon, text, and for 'signin' a link to the login portal
const SYNC = {
  off: ['fa-laptop', 'Saved in this browser'],
  signin: ['fa-laptop', 'Saved in this browser'],
  syncing: ['fa-cloud-arrow-up motion-safe:animate-pulse text-lofi-primary', 'Saving to your devices…'],
  synced: ['fa-cloud text-emerald-400', 'Synced to your devices'],
  offline: ['fa-cloud text-lofi-highlight', 'Offline · saved here, syncs later'],
}
function SyncStatus({ status }) {
  const [icon, text] = SYNC[status] ?? SYNC.off
  return (
    <p className="min-w-0 flex items-center gap-2 text-[11px] font-mono text-lofi-muted" aria-live="polite">
      <i className={`fa-solid ${icon} w-4 text-center`} aria-hidden="true" />
      <span>
        {text}
        {status === 'signin' && (
          <>
            {' · '}
            <a href={`${AUTH_URL}/?rd=${encodeURIComponent(location.href)}`} className="text-lofi-primary hover:underline">
              sign in to sync
            </a>
          </>
        )}
      </span>
    </p>
  )
}

export function Settings({ dlg, set, update, reset, sync }) {
  // Reset all asks first: a warning row with Cancel (focused) and "Yes, reset", which wakes after a moment so a
  // double-click can't confirm; the row gives up after 8 s, or when the panel closes
  const [sure, setSure] = useState(false)
  const [armed, setArmed] = useState(false)
  const resetBtn = useRef(null)
  const asked = useRef(false)
  useEffect(() => {
    if (sure) asked.current = true
    else if (asked.current && dlg.current?.open) (asked.current = false), resetBtn.current?.focus() // focus back where it was
  }, [sure])
  useEffect(() => {
    if (!sure) return
    setArmed(false)
    const a = setTimeout(() => setArmed(true), 800)
    const t = setTimeout(() => setSure(false), 8000)
    return () => (clearTimeout(a), clearTimeout(t))
  }, [sure])
  useEffect(() => {
    const d = dlg.current
    const off = () => setSure(false)
    d?.addEventListener('close', off)
    return () => d?.removeEventListener('close', off)
  }, [dlg])
  const synced = ['synced', 'syncing', 'offline'].includes(sync)
  const radio = (key, legend, options, extra) => (
    <Choice legend={legend} name={key} value={set[key]} options={options} onChange={(v) => update({ [key]: v })}>
      {extra}
    </Choice>
  )
  return (
    // same dialog pattern as the weather details panel (.wx-sheet: bottom sheet on phones, centered from sm)
    <dialog
      ref={dlg}
      aria-labelledby="set-title"
      onClick={(e) => e.target === dlg.current && closeDialog(dlg.current)}
      onCancel={(e) => {
        e.preventDefault() // Esc: animate out first
        closeDialog(dlg.current)
      }}
      onClose={() => delete dlg.current.dataset.closing}
      className="wx-sheet sm:max-w-xl glass-panel text-lofi-text overscroll-contain"
    >
      <div className="p-5 sm:p-7 flex flex-col gap-6">
        <div className="wx-sticky flex items-center justify-between gap-4">
          <h2 id="set-title" className="text-xl sm:text-2xl short:text-lg font-medium text-white flex items-center gap-3">
            <i className="fa-solid fa-sliders text-lofi-primary text-lg" aria-hidden="true" /> Settings
          </h2>
          <button
            onClick={() => closeDialog(dlg.current)}
            aria-label="Close settings"
            className="w-9 h-9 shrink-0 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white hover:border-lofi-primary/40 transition-colors"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-[10px] font-mono uppercase tracking-widest text-lofi-muted">Color theme</legend>
          <div className="flex flex-wrap items-center gap-2.5">
            {SWATCHES.map(([id, label]) => (
              <label key={id} className="relative" title={label}>
                <input type="radio" name="theme" aria-label={label} checked={set.theme === id} onChange={() => update({ theme: id })} className="peer sr-only" />
                <span
                  className="block w-9 h-9 rounded-full border-2 border-white/10 cursor-pointer transition-transform hover:scale-110 peer-checked:border-white peer-checked:scale-110 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lofi-primary"
                  style={{ background: swatchBg(THEMES[id]) }}
                />
              </label>
            ))}
            {/* custom: the native color picker, invisible on top of its swatch so a tap opens it on every browser */}
            <span
              className={`relative w-9 h-9 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lofi-primary ${set.theme === 'custom' ? 'border-white scale-110' : 'border-white/10'}`}
              style={{ background: set.theme === 'custom' ? swatchBg(customTheme(set.custom)) : 'conic-gradient(#ff8a5c, #fce38a, #8fd694, #5cc8ff, #b69cff, #ff8fb1, #ff8a5c)' }}
              title="Custom accent"
            >
              <i className="fa-solid fa-eye-dropper text-[11px] text-lofi-base/80" aria-hidden="true" />
              <input
                type="color"
                aria-label="Custom accent color"
                value={set.custom}
                onClick={() => set.theme !== 'custom' && update({ theme: 'custom' })}
                onChange={(e) => update({ theme: 'custom', custom: e.target.value })}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </span>
          </div>
        </fieldset>

        {radio('onLoad', 'On load', [['keep', 'Keep'], ['random', 'Random']])}

        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] font-mono uppercase tracking-widest text-lofi-muted">
            Dim scene <span className="text-lofi-text tabular-nums">{set.dim}%</span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={set.dim}
            onChange={(e) => update({ dim: Number(e.target.value) })}
            className="w-full h-8 accent-lofi-primary cursor-pointer"
          />
          <span className="flex justify-between text-[10px] font-mono text-lofi-muted" aria-hidden="true">
            <span>more scene</span>
            <span>more readable</span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-x-4 gap-y-6">
          {radio('clock', 'Clock', [[24, '24h'], [12, '12h']])}
          {radio('unit', 'Temperature', [['C', '°C'], ['F', '°F']])}
          {radio('motion', 'Motion', [['system', 'System'], ['reduce', 'Reduced']])}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-6">
          {radio('idle', 'Screensaver after', [[0, 'Off'], [30, '30s'], [60, '1m'], [120, '2m'], [300, '5m']])}
          {radio('idleShow', 'Show', [['scene', 'Scene only'], ['clock', 'Scene + clock']])}
        </div>

        <section className="flex flex-col gap-4 pt-4 border-t border-white/5" aria-labelledby="look-title">
          <h3 id="look-title" className="text-sm font-medium text-white flex items-center gap-2">
            <i className="fa-solid fa-lock text-lofi-primary text-xs" aria-hidden="true" /> Lock screen
          </h3>
          <LockLook set={set} update={update} />
        </section>

        <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
          {sure ? (
            <div
              role="alertdialog"
              aria-labelledby="reset-q"
              // Esc backs out of the question, not the whole panel
              onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), setSure(false))}
              className="w-full flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 motion-safe:animate-[panel-in_0.2s_ease-out]">
              <p id="reset-q" className="text-xs text-red-200 flex items-center gap-2.5 min-w-0">
                <i className="fa-solid fa-triangle-exclamation text-red-400" aria-hidden="true" />
                <span>
                  Reset every setting{synced ? ' on all your devices' : ''}? <span className="text-red-200/70">This can't be undone.</span>
                </span>
              </p>
              <div className="flex gap-2 shrink-0">
                <button autoFocus onClick={() => setSure(false)} className="h-9 px-4 rounded-full border border-white/15 font-mono text-xs text-lofi-text hover:text-white hover:border-white/30 transition-colors">
                  Cancel
                </button>
                {/* aria-disabled, not disabled: Chrome gives a click on a disabled button to the dialog behind it, which closes */}
                <button
                  aria-disabled={!armed}
                  onClick={() => armed && (setSure(false), reset())}
                  className="h-9 px-4 rounded-full bg-red-500/85 text-white font-mono text-xs font-bold hover:bg-red-500 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-red-500/85 transition-[background-color,opacity] duration-300 flex items-center gap-2"
                >
                  <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Yes, reset
                </button>
              </div>
            </div>
          ) : (
            <>
              <SyncStatus status={sync} />
              <button
                ref={resetBtn}
                onClick={() => setSure(true)}
                className="h-9 px-4 rounded-full border border-white/10 font-mono text-xs text-lofi-muted hover:text-white hover:border-red-400/60 transition-colors flex items-center gap-2"
              >
                <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset all
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  )
}

// A scene's poster (<base>.webp: the one the scene itself already loaded), cross-fading when it changes: the old one
// stays underneath until the new one has loaded and faded in. No base (Live waiting) = night sky; down = night sky + moon.
export function ScenePoster({ base, down, className = '', imgClass = '' }) {
  const src = base ? `${base}.webp` : null
  const [shown, setShown] = useState([{ src, k: 0 }]) // the last two; a fresh key per change, so even a switch back fades
  const top = shown.at(-1)
  if (top.src !== src) setShown([top, { src, k: top.k + 1 }]) // derived state: re-renders before paint
  return (
    <span className={`night-sky block relative overflow-hidden ${className}`}>
      {down ? (
        <i className="fa-solid fa-moon absolute top-1/2 left-1/2 -translate-1/2 text-lofi-highlight" aria-hidden="true" />
      ) : (
        shown.map(
          ({ src, k }) =>
            src && (
              <img
                key={k}
                src={src}
                alt=""
                decoding="async"
                onLoad={(e) => (e.currentTarget.style.opacity = 1)}
                className={`absolute inset-0 w-full h-full object-cover opacity-0 transition duration-500 [image-rendering:pixelated] ${imgClass}`}
              />
            ),
        )
      )}
    </span>
  )
}

// The header's scene button (mini picture of the scene as shown + the Scene weather badge) and its popup: the scene
// (opens the Gallery) and the Scene weather chips. Same dialog pattern as Settings; .scene-pop makes it a popover
// under the button from sm, the bottom sheet below. scene = { id, base, down, want, mode, from, wantDay, day } (see Home)
export function ScenePicker({ set, update, scene, onGallery, className = '' }) {
  const btn = useRef(null)
  const dlg = useRef(null)
  const name = sceneName(scene.id ?? 'london')
  const wx = wxName(set.weather, scene.want)
  const hint = weatherHint(set, scene)
  const dayLine = dayHint(scene)
  // the popover hangs under the button, right edges aligned; absolute in the top layer = page coordinates, so it
  // scrolls with the page
  const place = () => {
    const r = btn.current.getBoundingClientRect()
    dlg.current.style.setProperty('--pop-top', `${r.bottom + scrollY + 8}px`)
    dlg.current.style.setProperty('--pop-right', `${document.documentElement.clientWidth - r.right}px`)
  }
  useEffect(() => {
    const onResize = () => dlg.current.open && place()
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])
  function open() {
    if (dlg.current.open) return // also ignores clicks while the close animation runs
    place()
    dlg.current.showModal()
  }
  // straight to the Gallery (no exit animation under it); focus on the button first, so closing the Gallery lands there
  function toGallery() {
    dlg.current.close()
    btn.current.focus({ preventScroll: true })
    onGallery()
  }
  return (
    <>
      <button
        ref={btn}
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`Scene: ${name}${scene.down ? ' (could not load)' : ''}, weather ${wx}. Change scene or weather`}
        title={scene.down ? 'Scene could not load, showing the night sky' : 'Change scene or weather'}
        className={`${className} min-w-0 flex items-center gap-2.5 p-1 sm:pr-3 rounded-xl bg-lofi-base/50 border border-white/5 text-left hover:border-white/20 transition-colors`}
      >
        <span className="relative shrink-0">
          <ScenePoster base={scene.base} down={scene.down} className="w-16 h-9 rounded-lg" />
          <span className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full bg-lofi-base border border-white/15 flex items-center justify-center text-[8px] text-lofi-primary shadow">
            <i className={`fa-solid ${SCENE_WX[set.weather][1]}`} aria-hidden="true" />
          </span>
        </span>
        <span className="max-sm:hidden min-w-0">
          <span className="block max-w-28 truncate text-xs text-white">{name}</span>
          <span className={`block max-w-28 truncate text-[10px] font-mono ${scene.down ? 'text-red-400' : 'text-lofi-muted'}`}>{scene.down ? 'offline' : wx}</span>
        </span>
        {/* wrapped: Font Awesome's unlayered display beats Tailwind's hidden on the <i> itself */}
        <span className="max-sm:hidden text-[9px] text-lofi-muted" aria-hidden="true">
          <i className="fa-solid fa-chevron-down" />
        </span>
      </button>

      <dialog
        ref={dlg}
        aria-labelledby="pick-title"
        onClick={(e) => e.target === dlg.current && closeDialog(dlg.current)}
        onCancel={(e) => {
          e.preventDefault() // Esc: animate out first
          closeDialog(dlg.current)
        }}
        // the browser restores focus to the opener; a click (Safari) left none -> back to the button
        onClose={() => {
          delete dlg.current.dataset.closing
          if (document.activeElement === document.body) btn.current.focus({ preventScroll: true })
        }}
        className="wx-sheet scene-pop glass-panel text-lofi-text overscroll-contain"
      >
        <div className="p-5 sm:p-4 flex flex-col gap-4">
          {/* title + close on the phone sheet only (the hidden title still names the dialog); the popover hangs off its button */}
          <div className="flex items-center justify-between gap-4 sm:hidden">
            <h2 id="pick-title" className="text-lg font-medium text-white flex items-center gap-3">
              <i className="fa-solid fa-image text-lofi-primary" aria-hidden="true" /> Scene
            </h2>
            <button
              onClick={() => closeDialog(dlg.current)}
              aria-label="Close"
              className="w-9 h-9 shrink-0 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white hover:border-lofi-primary/40 transition-colors"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>

          <button onClick={toGallery} aria-haspopup="dialog" aria-label={`${name}. Change scene`} className="group block rounded-xl">
            <span className="block relative rounded-xl overflow-hidden ring-2 ring-transparent transition-shadow duration-300 group-hover:ring-lofi-primary group-hover:shadow-[0_0_24px_color-mix(in_oklab,var(--color-lofi-primary)_45%,transparent)]">
              <ScenePoster
                base={scene.base}
                down={scene.down}
                className="aspect-video text-2xl"
                imgClass="group-hover:scale-105 group-hover:brightness-110 group-focus-visible:scale-105 group-focus-visible:brightness-110"
              />
              <span className="absolute inset-x-0 bottom-0 px-3 pt-10 pb-2.5 flex items-end justify-between gap-3 bg-linear-to-t from-black/80 via-black/35 to-transparent">
                <span className="min-w-0 truncate text-sm font-medium text-white">{name}</span>
                <span className="shrink-0 flex items-center gap-1.5 font-mono text-[11px] text-white/90 group-hover:text-lofi-primary transition-colors">
                  <i className="fa-solid fa-images" aria-hidden="true" /> Change scene
                  <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true" />
                </span>
              </span>
            </span>
          </button>

          <div role="group" aria-labelledby="pick-wx">
            <p id="pick-wx" className="mb-2 text-[10px] font-mono uppercase tracking-widest text-lofi-muted">
              Scene weather
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {SCENE_WEATHER.map((w) => {
                const on = set.weather === w
                return (
                  <button
                    key={w}
                    aria-pressed={on}
                    onClick={() => update({ weather: w })}
                    className={`h-14 min-w-0 px-0.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 font-mono text-[10px] transition-colors ${
                      on ? 'bg-lofi-primary border-transparent text-lofi-base font-bold' : 'bg-white/5 border-white/10 text-lofi-text hover:border-white/25 hover:text-white'
                    }`}
                  >
                    <i className={`fa-solid ${SCENE_WX[w][1]} text-sm ${on ? '' : 'text-lofi-primary'}`} aria-hidden="true" />
                    <span className="max-w-full truncate tracking-tight">{SCENE_WX[w][0]}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {hint && (
            <p className="-mt-1 text-[11px] font-mono text-lofi-muted" aria-live="polite">
              {hint}
            </p>
          )}
          {dayLine && (
            <p className="-mt-2 text-[11px] font-mono text-lofi-muted" aria-live="polite">
              {dayLine}
            </p>
          )}
        </div>
      </dialog>
    </>
  )
}

// Full-screen scene picker. Posters come in the wanted weather variant, falling back to the signature poster, then to
// the night-sky placeholder (scene not uploaded yet).
export function Gallery({ dlg, scene, variant, onPick }) {
  const [q, setQ] = useState('')
  const grid = useRef(null)
  const t = q.trim().toLowerCase()
  const shown = SCENES.filter((id) => sceneName(id).toLowerCase().includes(t))
  const v = variant && variant !== 'signature' ? variant : null

  // arrows move between tiles; up/down jump one row (= tiles sharing the first tile's top)
  function onKeyDown(e) {
    const tiles = [...grid.current.querySelectorAll('button')]
    const i = tiles.indexOf(document.activeElement)
    if (i < 0) return
    const cols = tiles.filter((b) => b.offsetTop === tiles[0].offsetTop).length
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key]
    if (!step) return
    e.preventDefault()
    tiles[Math.min(tiles.length - 1, Math.max(0, i + step))].focus()
  }

  const onImgError = (e) => {
    const img = e.currentTarget
    if (img.dataset.fallback) {
      img.src = img.dataset.fallback
      delete img.dataset.fallback
    } else img.style.visibility = 'hidden'
  }

  return (
    <dialog
      ref={dlg}
      aria-labelledby="gal-title"
      onCancel={(e) => {
        e.preventDefault()
        closeDialog(dlg.current)
      }}
      onClose={() => {
        delete dlg.current.dataset.closing
        setQ('')
      }}
      className="gallery text-lofi-text overscroll-contain"
    >
      <div className="min-h-full flex flex-col">
        <div className="sticky top-0 z-10 bg-lofi-base border-b border-white/5 px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-3">
            <h2 id="gal-title" className="grow text-lg sm:text-xl font-medium text-white flex items-center gap-3">
              <i className="fa-solid fa-images text-lofi-primary" aria-hidden="true" /> Choose a scene
            </h2>
            <div className="order-last sm:order-none basis-full sm:basis-64 relative">
              <input
                type="search"
                aria-label="Filter scenes by city"
                placeholder="Search city…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full h-10 bg-lofi-surface/60 border border-white/10 rounded-xl pl-10 pr-3 text-white placeholder:text-lofi-muted focus:outline-none focus:border-lofi-primary/50 font-mono text-sm"
              />
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-lofi-muted text-sm" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onPick(randomScene(scene))}
                aria-label="Random scene"
                className="h-10 min-w-10 px-2.5 sm:px-4 rounded-full bg-lofi-base/50 border border-white/10 font-mono text-xs text-lofi-text hover:text-white hover:border-lofi-primary/40 transition-colors flex items-center justify-center gap-2"
              >
                <span aria-hidden="true">🎲</span>
                <span className="hidden sm:inline" aria-hidden="true">Random</span>
              </button>
              <button
                onClick={() => closeDialog(dlg.current)}
                aria-label="Close scene gallery"
                className="w-10 h-10 shrink-0 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white hover:border-lofi-primary/40 transition-colors"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="grow px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div
            ref={grid}
            onKeyDown={onKeyDown}
            className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 sm:gap-4"
          >
            {shown.map((id) => {
              const on = id === scene
              const sig = `${SCENES_URL}/${id}.webp`
              return (
                <button
                  key={id + v}
                  onClick={() => onPick(id)}
                  aria-current={on || undefined}
                  className="group min-w-0 text-left rounded-2xl p-1 focus-visible:outline-offset-0"
                >
                  <span
                    className={`night-sky block relative aspect-video overflow-hidden rounded-xl border transition-shadow duration-300 group-hover:shadow-[0_0_24px_color-mix(in_oklab,var(--color-lofi-primary)_45%,transparent)] group-focus-visible:shadow-[0_0_24px_color-mix(in_oklab,var(--color-lofi-primary)_45%,transparent)] ${
                      on ? 'border-transparent ring-2 ring-lofi-primary' : 'border-white/10'
                    }`}
                  >
                    <img
                      src={v ? `${SCENES_URL}/${v}/${id}.webp` : sig}
                      data-fallback={v ? sig : undefined}
                      onError={onImgError}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 group-focus-visible:scale-110"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    {on && (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center text-[11px] shadow-lg">
                        <i className="fa-solid fa-check" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className={`block mt-2 px-1 text-sm truncate transition-colors ${on ? 'text-lofi-primary font-medium' : 'text-white group-hover:text-lofi-primary'}`}>
                    {sceneName(id)}
                  </span>
                </button>
              )
            })}
          </div>
          {!shown.length && <p className="py-16 text-center font-mono text-sm text-lofi-muted">No scene matches “{q.trim()}”</p>}
        </div>
      </div>
    </dialog>
  )
}

export const randomScene = (not) => {
  const pool = SCENES.filter((id) => id !== not)
  return pool[Math.floor(Math.random() * pool.length)]
}
