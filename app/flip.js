'use client'

// useFlip(): rows that glide to their new place when a list changes (skip, reorder, add, remove), like framer-motion's
// layout / layoutId + AnimatePresence, without the library. lib/flip.js has the pure parts (what moved, timing).
// - The scope (ref): an element with position: relative around the rows; each row carries data-flip-key. Keys are
//   matched across the whole scope, so a song that leaves Up next for the Now slot glides from one to the other.
// - First: while React renders a new list (`sig` changed) the DOM still shows the last one: each row's box is read
//   then (getBoundingClientRect: mid-glide, where it is seen, so a new update that lands mid-animation goes on from
//   there without a jump — the job of getSnapshotBeforeUpdate in a class). Last / Invert / Play: in a layout effect
//   (before the paint) the running glides stop, the new boxes are read, and each moved row is animated (Web
//   Animations API, transform only) from where it was to 0. New rows fade / slide in; a gone row leaves a copy of
//   itself (inert, aria-hidden, absolutely placed where it was) that fades out, then is removed.
// - Only rows near what can be seen animate (a 200-song queue costs the few in sight), at most MAX_ANIMATED.
// - paused (a drag is on, or a finger holds a handle): nothing animates and what runs stops at once, so a glide never
//   fights the dragged row's own transform; the drop's new order then glides the others (and the dropped row settles
//   from where it was let go).
// - resize (a list whose box grows and shrinks with it, the notifications inbox): its scroller ([data-scroll]) eases
//   from the height it had to the new one, so the panel around it doesn't jump, and the boxes are read from the
//   scroller's corner (a bottom sheet's top edge moves with that height, and the rows ride along). While it plays, a
//   list that fits its box hides what the glides push past its edges instead of showing scrollbars for them.
// - Settings › Motion: Reduced (html[data-motion='reduce']) or the OS setting, or a hidden page: no animation.
// Only a change of `sig` animates: the 1-s ticks, Select mode, a title opening (its own 220 ms slide) don't.
import { useLayoutEffect, useRef } from 'react'
import { EASE_IN, EASE_OUT, ENTER_MS, LEAVE_MS, MIN_SHIFT, flipPlan, moveDuration, motionAllowed, springEasing, visibleBand } from '../lib/flip'

const glides = new WeakMap() // element -> { anim, fades }: its running glide / fade-in
let ease = null
const easing = () => (ease ??= typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)') ? springEasing() : EASE_OUT)

function canAnimate() {
  if (typeof document === 'undefined' || typeof Element.prototype.animate !== 'function' || document.visibilityState !== 'visible') return false
  return motionAllowed({ setting: document.documentElement.dataset.motion, prefersReduced: matchMedia?.('(prefers-reduced-motion: reduce)').matches })
}
const ZERO = { x: 0, y: 0 }
// o: the corner the boxes are read from (resize: the scroller's; else the viewport's)
const boxOf = (el, o = ZERO) => {
  const r = el.getBoundingClientRect()
  return { x: r.left - o.x, y: r.top - o.y, w: r.width, h: r.height }
}
const rowsOf = (scope) => scope.querySelectorAll('[data-flip-key]')
function stop(el) {
  const g = glides.get(el)
  if (!g) return
  glides.delete(el)
  g.anim.cancel()
}
function glide(el, frames, opts, fades) {
  const anim = el.animate(frames, opts)
  glides.set(el, { anim, fades })
  anim.onfinish = anim.oncancel = () => glides.get(el)?.anim === anim && glides.delete(el)
  return anim
}

// First: each key's box as seen now (a leaving copy still fading counts: a key that comes back starts from it), the
// element, and the opacity of rows that were still fading in (they go on from it). box (resize): the scroller, whose
// height now is where it eases from (offsetHeight: the panel's own pop-in / pop-out scale doesn't count)
function snapshot(scope, ghosts, box) {
  const b = box?.getBoundingClientRect()
  const o = b ? { x: b.left, y: b.top } : ZERO
  const rects = new Map()
  const els = new Map()
  const fading = new Map()
  for (const el of rowsOf(scope)) {
    const k = el.dataset.flipKey
    if (rects.has(k)) continue
    rects.set(k, boxOf(el, o))
    els.set(k, el)
    if (glides.get(el)?.fades) fading.set(k, Number(getComputedStyle(el).opacity))
  }
  for (const [k, g] of ghosts) if (!k.endsWith('\u0000out') && !rects.has(k) && g.isConnected) rects.set(k, boxOf(g, o))
  return { rects, els, fading, box, h: box?.offsetHeight }
}

// a copy of a row that left, fading where it was (under the rows that glide over its place)
function leaveCopy(scope, src, box, ghosts, key, s) {
  const g = src.cloneNode(true)
  for (const el of [g, ...g.querySelectorAll('[id],[data-flip-key],[data-row]')]) ['id', 'data-flip-key', 'data-row'].forEach((a) => el.removeAttribute(a))
  g.setAttribute('aria-hidden', 'true')
  g.inert = true
  Object.assign(g.style, {
    position: 'absolute',
    margin: '0',
    left: `${box.x - s.left}px`,
    top: `${box.y - s.top}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
    transform: '',
    pointerEvents: 'none',
    zIndex: '0',
  })
  scope.prepend(g) // first in the scope: painted under the rows that glide in
  ghosts.get(key)?.remove()
  ghosts.set(key, g)
  const anim = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], { duration: LEAVE_MS, easing: EASE_IN, fill: 'forwards' })
  anim.onfinish = anim.oncancel = () => {
    g.remove()
    if (ghosts.get(key) === g) ghosts.delete(key)
  }
  return anim
}
function dropGhosts(ghosts) {
  for (const g of ghosts.values()) g.remove()
  ghosts.clear()
}

// resize: the scroller eases from the height it had to the new one (the panel around it follows); while that and the
// glides play, a list that fits clips them (overflow: hidden) instead of showing scrollbars for what they push past
// its edges. Once all of them are done (or a newer update took over) the scroller is left as it was.
function resizeFrom(s, box, from, to, fits, anims, easing) {
  const anim = from != null && Math.abs(from - to) >= MIN_SHIFT ? box.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: moveDuration(0, from - to), easing }) : null
  if (anim) anims.push(anim)
  if (!anims.length) return
  const z = { box, anim }
  s.size = z
  if (fits) box.style.overflow = 'hidden'
  Promise.allSettled(anims.map((a) => a.finished)).then(() => s.size === z && settleSize(s))
}
// the scroller at its own height and overflow at once
function settleSize(s) {
  const z = s.size
  if (!z) return
  s.size = null
  z.anim?.cancel()
  z.box.style.overflow = ''
}
// nothing left playing: the copies go, the scroller settles
function rest(s) {
  dropGhosts(s.ghosts)
  settleSize(s)
}

function play(scope, snap, st) {
  const { ghosts } = st
  const scroller = scope.closest('[data-scroll]')
  const box = snap.box?.isConnected ? snap.box : null
  // Last: the boxes as laid out (stop what still glides, and the scroller's height: the snapshot has where they were
  // seen). Two passes, so the stops don't make every read lay the page out again
  settleSize(st)
  for (const el of snap.els.values()) stop(el)
  const found = rowsOf(scope)
  for (const el of found) stop(el)
  const view = scroller?.getBoundingClientRect() ?? null
  const o = box ? { x: view.left, y: view.top } : ZERO
  const rects = new Map()
  const els = new Map()
  for (const el of found) {
    const k = el.dataset.flipKey
    if (!rects.has(k)) rects.set(k, boxOf(el, o)), els.set(k, el)
  }
  // resize: the scroller still starts at its old height, so what was seen down to there still is
  const h = box ? box.offsetHeight : 0
  const band = visibleBand(box ? { top: view.top, bottom: view.top + Math.max(view.height, (view.height * snap.h) / (h || 1)) } : view, { h: innerHeight })
  const plan = flipPlan(snap.rects, rects, { top: band.top - o.y, bottom: band.bottom - o.y })
  for (const k of rects.keys()) if (ghosts.has(k)) ghosts.get(k).remove(), ghosts.delete(k) // came back: it glides from the copy
  // the scope's corner, read once (a read per copy would lay the page out again after each one is added)
  const sb = plan.leave.length ? scope.getBoundingClientRect() : null
  const s = sb && { left: sb.left - o.x + scope.clientLeft, top: sb.top - o.y + scope.clientTop }
  // resize: does the new list fit its scroller (the copies are absolute: the scope's height leaves them out), and what
  // plays, to know when it's all done
  const fits = box ? scope.offsetHeight <= box.clientHeight : false
  const anims = box ? [] : null
  for (const { key, stay } of plan.leave) {
    // gone: the old element (React has let go of it; still whole). Moved out of sight: the live one, copied
    const src = stay ? els.get(key) : snap.els.get(key)
    // (a copy of a row still here is kept apart: it only fades, nothing comes back to it)
    if (src && (stay || !src.isConnected)) anims?.push(leaveCopy(scope, src, snap.rects.get(key), ghosts, stay ? `${key}\u0000out` : key, s))
  }
  const e = easing()
  for (const { key, dx, dy, fade } of plan.move) {
    const op = fade ? 0 : snap.fading.get(key)
    const from = { transform: `translate(${dx}px, ${dy}px)` }
    const to = { transform: 'none' }
    if (op != null) (from.opacity = op), (to.opacity = 1)
    anims?.push(glide(els.get(key), [from, to], { duration: moveDuration(dx, dy), easing: e }, op != null))
  }
  for (const key of plan.enter) anims?.push(glide(els.get(key), [{ opacity: 0, transform: 'translateY(6px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: ENTER_MS, easing: e }, true))
  if (box) resizeFrom(st, box, snap.h, h, fits, anims, e)
}

// ref: the scope element; sig: the rows' keys in order (flipSig); paused: no animation now (a drag); resize: the
// scroller's height eases with the list (above)
export function useFlip(ref, sig, { paused = false, resize = false } = {}) {
  const st = useRef(null)
  st.current ??= { sig: undefined, snap: null, ghosts: new Map(), size: null }
  const s = st.current
  // First (during render: the DOM still shows the last commit). Once per change: a render React throws away and does
  // again finds the same DOM, so the first snapshot stays good until the commit
  if (ref.current && s.sig !== undefined && s.sig !== sig && !s.snap && !paused && canAnimate()) s.snap = snapshot(ref.current, s.ghosts, resize ? ref.current.closest('[data-scroll]') : null)
  // every commit: a change of sig plays; any other commit just lets an unused snapshot go
  useLayoutEffect(() => {
    const snap = s.snap
    s.snap = null
    if (s.sig === sig) return
    const first = s.sig === undefined
    s.sig = sig
    const scope = ref.current
    if (first || !scope) return
    if (!snap || paused || !canAnimate()) return rest(s)
    play(scope, snap, s)
  })
  // a drag starts: whatever still glides takes its place at once
  useLayoutEffect(() => {
    if (!paused || !ref.current) return
    for (const el of rowsOf(ref.current)) stop(el)
    rest(s)
  }, [paused])
  useLayoutEffect(() => () => rest(s), [])
}

// Stop every glide in `scope` now (the rows jump to their real places): the drag measures the rows as they really are
export function settleFlip(scope) {
  for (const el of scope?.querySelectorAll('[data-flip-key]') ?? []) for (const a of el.getAnimations()) a.cancel()
}
