'use client'

import { createContext, useRef, useState } from 'react'
import { SCENES, SCENES_URL } from '../lib/data'
import { DEFAULTS, SCENE_WEATHER, THEMES, customTheme, sceneName } from '../lib/settings'

// settings + `reduced` (Motion: Reduced, or the OS asks for it), provided by Home
export const Prefs = createContext({ ...DEFAULTS, reduced: false })

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

const WEATHER_LABEL = { signature: 'Signature', live: 'Live', clear: 'Clear', drizzle: 'Drizzle', rain: 'Rain', thunderstorm: 'Storm', snow: 'Snow', leaves: 'Leaves' }

// scene = { want, mode, from }: the variant asked for (null while Live waits for the weather), the one shown, Live's city
function weatherHint(set, { want, mode, from }) {
  const live = set.weather === 'live'
  if (live && !want) return 'Live: waiting for the weather…'
  if (live && want === 'signature') return `Live: ${from ? `no variant for the weather in ${from}` : 'weather unavailable'}, showing Signature`
  let t = live ? `Live: ${WEATHER_LABEL[want].toLowerCase()}${from ? ` (from ${from})` : ''}` : ''
  if (want !== mode) t += `${t ? ' · ' : ''}not available for this scene yet, showing Signature`
  return t
}

export function Settings({ dlg, set, update, reset, scene }) {
  const hint = weatherHint(set, scene)
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

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-lofi-muted">Scene</p>
            <button
              onClick={scene.open}
              aria-haspopup="dialog"
              className="h-8 pl-3 pr-2.5 rounded-full border border-white/10 bg-white/5 font-mono text-xs text-white hover:border-lofi-primary/50 transition-colors flex items-center gap-2"
            >
              <i className="fa-solid fa-image text-lofi-primary" aria-hidden="true" />
              {sceneName(scene.id ?? 'london')}
              <i className="fa-solid fa-chevron-right text-[9px] text-lofi-muted" aria-hidden="true" />
            </button>
          </div>
          {radio('onLoad', 'On load', [['keep', 'Keep'], ['random', 'Random']])}
        </div>

        {radio(
          'weather',
          'Scene weather',
          SCENE_WEATHER.map((w) => [w, WEATHER_LABEL[w]]),
          hint && <p className="mt-2 text-[11px] font-mono text-lofi-muted" aria-live="polite">{hint}</p>,
        )}

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

        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-x-4 gap-y-6">
          {radio('clock', 'Clock', [[24, '24h'], [12, '12h']])}
          {radio('unit', 'Temperature', [['C', '°C'], ['F', '°F']])}
          {radio('motion', 'Motion', [['system', 'System'], ['reduce', 'Reduced']])}
        </div>

        <div className="pt-2 border-t border-white/5 flex justify-end">
          <button
            onClick={reset}
            className="h-9 px-4 rounded-full border border-white/10 font-mono text-xs text-lofi-muted hover:text-white hover:border-lofi-secondary/60 transition-colors flex items-center gap-2"
          >
            <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset all
          </button>
        </div>
      </div>
    </dialog>
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
        <div className="sticky top-0 z-10 bg-lofi-base/95 border-b border-white/5 px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
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
