// Full screen (⛶ on the dock and the lock screen, F): the whole page, through the Fullscreen API on <html>, with the
// webkit-prefixed one as the fallback (iPadOS Safari). An iPhone has no element full screen at all: no button there.
// No React here, so node:test can check it with a fake document.

// the events that say full screen came or went (the browser's own Esc / ✕ too)
export const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange']

// -> { supported, active(), toggle(): Promise } for `doc` (document). toggle() never rejects: a refusal (no user
// gesture, a permissions policy) just leaves things as they are, and the change event reports what really happened.
export function fullscreenApi(doc = globalThis.document) {
  const el = doc?.documentElement
  const supported = Boolean(doc && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && (el?.requestFullscreen || el?.webkitRequestFullscreen))
  const active = () => Boolean(doc?.fullscreenElement ?? doc?.webkitFullscreenElement)
  const call = (fn, self, ...args) => {
    try {
      return Promise.resolve(fn?.apply(self, args)).catch(() => {})
    } catch {
      return Promise.resolve() // (an old webkit throws instead of rejecting)
    }
  }
  return {
    supported,
    active,
    toggle() {
      if (!supported) return Promise.resolve()
      if (active()) return doc.exitFullscreen ? call(doc.exitFullscreen, doc) : call(doc.webkitExitFullscreen, doc)
      return el.requestFullscreen ? call(el.requestFullscreen, el, { navigationUI: 'hide' }) : call(el.webkitRequestFullscreen, el)
    },
  }
}

// F toggles full screen, by the same rules as H / L / A: no Ctrl / ⌘ / Alt (Ctrl+F is the browser's find), not a key
// held down (repeat), not while typing in a field, not with a dialog open. Locked is fine: the lock screen has no text
// fields, and F is never an unlock (the lock only listens to Space and the arrows).
export function isFullscreenKey(e, { typing = false, dialog = false } = {}) {
  return typeof e?.key === 'string' && e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !typing && !dialog
}
