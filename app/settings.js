'use client'

import { createContext } from 'react'
import { DEFAULTS } from '../lib/settings'

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
