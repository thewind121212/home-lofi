// FLIP layout animation, the pure parts (app/flip.js has the hook that measures and animates).
// First: each keyed row's box before React changes the list; Last: after; Invert: the row starts where it was
// (translate by the difference); Play: it glides to 0. Rows are matched by key across the whole scope, so a song that
// leaves the queue and shows up in the Now slot (another element, the same key) glides from one to the other, like
// framer-motion's layoutId. New keys fade / slide in, gone keys leave a fading copy behind (like AnimatePresence).
//
// A box: { x, y, w, h } (viewport px, getBoundingClientRect). A snapshot: Map(key -> box).

// below this (px) a row hasn't moved (sub-pixel rounding of a reflow)
export const MIN_SHIFT = 0.5

// rows farther than this from the visible part of the list don't animate (a 200-song queue: only what can be seen)
export const VIEW_MARGIN = 160

// at most this many rows animate in one update (the rest just take their place)
export const MAX_ANIMATED = 48

// Which keys moved (and by how much: dx / dy invert the move, the row starts there), which came, which went.
// view { top, bottom }: what can be seen of the list (null: no culling). A row that only moves out of sight leaves
// a fading copy where it was (`leave` with stay: true) instead of sliding far away; one that moves in from out of
// sight slides in from just past the edge and fades in (fade: true) instead of flying across the whole list.
// -> { move: [{ key, dx, dy, fade }], enter: [key], leave: [{ key, stay }], skipped: n }
export function flipPlan(before, after, view = null, { margin = VIEW_MARGIN, max = MAX_ANIMATED, min = MIN_SHIFT } = {}) {
  const move = []
  const enter = []
  const leave = []
  let skipped = 0
  let room = max
  const take = () => (room > 0 ? (room--, true) : (skipped++, false))
  const seen = (b) => !view || inView(b, view, margin)
  const reach = view ? view.bottom - view.top + margin : Infinity // the farthest a row slides in from
  for (const [key, a] of after) {
    const b = before.get(key)
    if (!b) {
      if (seen(a) && take()) enter.push(key)
      continue
    }
    // (centers: a row lifted by a drag is scaled up a hair; its corner moved, its middle didn't)
    const dx = b.x + b.w / 2 - (a.x + a.w / 2)
    const dy = b.y + b.h / 2 - (a.y + a.h / 2)
    if (Math.abs(dx) < min && Math.abs(dy) < min) continue
    const was = seen(b)
    const is = seen(a)
    if (!was && !is) continue // all out of sight: nothing to watch
    if (!take()) continue
    if (!is) leave.push({ key, stay: true })
    else move.push({ key, dx: limitShift(dx, reach), dy: limitShift(dy, reach), fade: !was })
  }
  for (const [key, b] of before) if (!after.has(key) && seen(b) && take()) leave.push({ key, stay: false })
  return { move, enter, leave, skipped }
}

// does a box touch the visible band (± margin)?
export function inView(box, view, margin = 0) {
  return box.y + box.h > view.top - margin && box.y < view.bottom + margin
}

// a shift no longer than `max` (same direction): a row from far away starts just past the edge
export function limitShift(d, max) {
  return Math.abs(d) <= max ? d : Math.sign(d) * max
}

// the list's visible band: its scroller's box cut to the window (the card: the window)
export function visibleBand(scroller, win) {
  const top = Math.max(0, scroller ? scroller.top : 0)
  const bottom = Math.min(win.h, scroller ? scroller.bottom : win.h)
  return { top, bottom: Math.max(top, bottom) }
}

// ---- timing: framer-motion's feel (a soft spring that settles without a bounce), in 220-280 ms ----
export const MOVE_MS = [220, 280] // one row's hop .. a long glide
export const ENTER_MS = 240
export const LEAVE_MS = 180
// where linear() easing isn't supported: a plain soft ease-out
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)' // leaving: gone by the end, not lingering

// a longer way takes a little longer (as a spring does), within MOVE_MS
export function moveDuration(dx, dy) {
  const [lo, hi] = MOVE_MS
  const d = Math.hypot(dx, dy)
  return Math.round(Math.min(hi, lo + (d / 400) * (hi - lo)))
}

// A damped spring from 0 to 1 sampled into a CSS linear() easing (WAAPI takes it as `easing`). damping < 1 overshoots
// a hair (0.85: ~0.6 %, unseen, but the landing is soft like framer's); `settle` makes it reach 1 (±0.2 %) by the end.
export function springEasing({ damping = 0.85, settle = 6.5, points = 24 } = {}) {
  const z = Math.min(Math.max(damping, 0.05), 0.999)
  const w = settle / z // natural frequency (per unit time) so the envelope e^(-z·w·t) is ~0.0015 at t = 1
  const wd = w * Math.sqrt(1 - z * z)
  const x = (t) => 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
  const out = []
  for (let i = 0; i <= points; i++) out.push(i === points ? 1 : Math.round(x(i / points) * 1000) / 1000)
  return `linear(${out.join(', ')})`
}

// ---- reduced motion: Settings › Motion (html[data-motion='reduce']) or the OS setting: nothing animates ----
export function motionAllowed({ setting = '', prefersReduced = false } = {}) {
  return setting !== 'reduce' && !prefersReduced
}

// one string for a list's keys in order: the hook animates only when it changes (not on every 1-s tick)
export function flipSig(keys) {
  return keys.map((k) => String(k ?? '')).join('\u0001')
}
