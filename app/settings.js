'use client'

import { createContext } from 'react'
import { DEFAULTS, THEMES, customTheme } from '../lib/settings'

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

export function Settings({ dlg, set, update, reset }) {
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
