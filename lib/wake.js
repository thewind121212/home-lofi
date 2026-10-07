// The dashboard coming back (screensaver, lock, Hide) must not take the tap that brought it back as a click on a
// card that's just appearing (app/page.js). No React here, so node:test can check it with a plain EventTarget.

// after the dashboard reappears it ignores the pointer this long (a double tap, a press still going on)
export const WAKE_GUARD_MS = 400

// Swallows the next click on `target` (capture phase, once): the click that ends the press that woke the page. It
// lets go when a new press starts (that one's click is a real one; `from` is the waking press itself, which may
// still be on its way) or after `ms`. -> a function that lets go now.
export function eatNextClick(target = globalThis, { from = null, ms = 1500 } = {}) {
  let t = 0
  const cap = { capture: true } // (an object, not `true`: Node's EventTarget only reads the object form on remove)
  const off = () => {
    clearTimeout(t)
    target.removeEventListener('click', eat, cap)
    target.removeEventListener('pointerdown', fresh, cap)
  }
  function eat(e) {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation?.()
    off()
  }
  function fresh(e) {
    if (e !== from) off()
  }
  target.addEventListener('click', eat, cap)
  target.addEventListener('pointerdown', fresh, cap)
  t = setTimeout(off, ms)
  return off
}

// the dashboard fades back in this long (its opacity transition, duration-700 in app/page.js)
export const WAKE_FADE_MS = 700

// No scrolling while the dashboard fades back in: the wheel or the swipe that woke it would scroll the page under
// it. Hides the page's overflow (html and body) and stops wheel / touchmove (not passive, so they can be stopped),
// then lets go after `ms`. -> a function that lets go now.
export function holdScroll(win = globalThis, ms = WAKE_FADE_MS) {
  const doc = win.document
  const els = [doc?.documentElement, doc?.body].filter(Boolean)
  const before = els.map((el) => el.style.overflow)
  const opts = { capture: true, passive: false }
  const stop = (e) => e.cancelable !== false && e.preventDefault()
  let t = 0
  let on = true
  const off = () => {
    if (!on) return
    on = false
    clearTimeout(t)
    els.forEach((el, i) => (el.style.overflow = before[i]))
    win.removeEventListener('wheel', stop, opts)
    win.removeEventListener('touchmove', stop, opts)
  }
  els.forEach((el) => (el.style.overflow = 'hidden'))
  win.addEventListener('wheel', stop, opts)
  win.addEventListener('touchmove', stop, opts)
  t = setTimeout(off, ms)
  return off
}
