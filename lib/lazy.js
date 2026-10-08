// "Ask for this once it's nearly on screen": the Player's song rows fetch a missing Spotify cover (lib/spotify-cover.js)
// only when they come close. Close means close inside the box that scrolls them: an IntersectionObserver whose root is
// the viewport sees a row hidden below the fold of the Player sheet's own list as not there at all (its rootMargin
// grows the viewport, not that list), so covers would start only once a row is already showing. Hence the nearest
// scroll container as the root (the viewport when there is none), a generous margin, and one observer per root shared
// by every row in it. No React here, so node:test can check it with a fake observer.

// ask this far ahead of the visible part of the list (px): about ten rows, a flick's worth
export const LAZY_MARGIN = 400

const SCROLLS = /^(auto|scroll|overlay)$/

// The nearest ancestor of `el` that scrolls (overflow auto / scroll on either axis), or null for the viewport (the
// page itself scrolling counts as the viewport). styleOf: getComputedStyle, or a fake in tests.
export function scrollRoot(el, styleOf = (e) => getComputedStyle(e)) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (p.tagName === 'BODY' || p.tagName === 'HTML') return null
    const s = styleOf(p)
    if (SCROLLS.test(s.overflowY) || SCROLLS.test(s.overflowX)) return p
  }
  return null
}

// How far a row is from the visible part of its root (0 = showing). rootBounds include the margin, so it comes off.
const distance = (e, margin) => {
  const r = e.rootBounds
  if (!r) return 0
  const b = e.boundingClientRect
  return Math.max(0, r.top + margin - b.bottom, b.top - (r.bottom - margin))
}
// The entries that came close, in the order to ask for them: the farthest first, the rows showing last (bottom to top).
// The cover queue serves the newest ask first (lib/spotify-cover.js), so what's on screen loads first, top down, then
// what's just ahead of it, and so on outwards.
export function askOrder(entries, margin = LAZY_MARGIN) {
  return entries
    .filter((e) => e.isIntersecting)
    .map((e, i) => ({ e, i, d: distance(e, margin) }))
    .sort((a, b) => b.d - a.d || b.i - a.i)
    .map((x) => x.e)
}

// -> watch(el, root, fn): calls fn() once, when el comes within `margin` of root's visible part (root null = the
// viewport), and returns a function that stops watching. One IntersectionObserver per root, shared; it goes away with
// the last element it watches. IO: the IntersectionObserver class (a fake in tests).
export function lazyWatcher({ IO, margin = LAZY_MARGIN } = {}) {
  const roots = new Map() // root | null -> { io, fns: Map<el, fn> }
  const drop = (root, el) => {
    const r = roots.get(root)
    if (!r || !r.fns.delete(el)) return
    r.io.unobserve(el)
    if (!r.fns.size) r.io.disconnect(), roots.delete(root)
  }
  return function watch(el, root = null, fn) {
    let r = roots.get(root)
    if (!r) {
      const fns = new Map()
      const io = new IO(
        (entries) => {
          for (const e of askOrder(entries, margin)) {
            const f = fns.get(e.target)
            if (!f) continue
            drop(root, e.target)
            f()
          }
        },
        { root, rootMargin: `${margin}px` },
      )
      roots.set(root, (r = { io, fns }))
    }
    if (!r.fns.has(el)) r.io.observe(el)
    r.fns.set(el, fn)
    return () => r.fns.get(el) === fn && drop(root, el)
  }
}
