// Ambient: the scene with a slim bar (music, sounds, weather, clock, server) instead of the dashboard, and the dock on
// the right with 👁 Show panels and 🔒 Lock. One mode for "I'm here, just show me the scene" (the dock's ⛰ button / H)
// and "I've walked away" (Settings › Ambient after N s without input). After CALM_MS without input the bar and the dock
// fade ("calm"), and with Settings › When the bar fades = Scene + clock the big clock fades in over the scene; any input
// brings them back. The lock (🔒 / L) is its own thing and wins over all of it. No React here, so node:test can check
// the rules; app/page.js wires them to state and events.
//
// ambient: false (the dashboard) | 'hand' (H, the dock button, or woken by someone) | 'auto' (came on by itself and
// nobody has touched anything since: the dashboard blurs as it fades, like the old screensaver, and a "move to wake"
// hint shows once)

// the bar fades after this long without input
export const CALM_MS = 5000

// What's on screen. idleShow: Settings › When the bar fades ('scene' | 'clock'). Each layer is shown, 'faded' (kept
// mounted so it can fade out / in) or 'none' (not there at all).
//   dashboard / dim: the panels, the scene's darkening overlay
//   dock: the floating buttons on the right, with dockSet: which ones. On the dashboard ('dashboard': ⛰ Ambient, 🔒,
//     ⚙️), and in Ambient ('ambient': 👁 Show panels, 🔒), where it fades and comes back with the bar
//   blur: the dashboard blurs as it fades (the lock, and Ambient that came on by itself)
//   bar: the ambient bar; clock: the big clock over the scene; hint: "move to wake"
//   catcher: a tap on the bare scene (not on the bar or the dock) goes back to the dashboard: only while the bar is there
export function ambientView({ ambient = false, calm = false, locked = false, idleShow = 'clock' } = {}) {
  const on = Boolean(ambient) && !locked
  const panels = !ambient && !locked
  const bar = on ? (calm ? 'faded' : 'shown') : 'none'
  return {
    dashboard: panels,
    dock: panels ? 'shown' : bar,
    dockSet: panels ? 'dashboard' : on ? 'ambient' : null,
    dim: panels,
    blur: locked || ambient === 'auto',
    bar,
    clock: on && idleShow === 'clock' ? (calm ? 'shown' : 'faded') : 'none',
    hint: on && calm && ambient === 'auto',
    catcher: on && !calm,
  }
}

// One clock tick (app/page.js runs it every second) -> the next { ambient, calm }.
//   since: ms since the last input; after: Settings › Ambient after, in s (0 = Off: never by itself)
//   busy: a dialog / dropdown is open or text is typed (nothing starts or fades then)
//   held: the pointer rests on the bar or the dock, or the keyboard is in one of them (they stay)
// Locked: nothing changes underneath, so unlocking returns to where you were.
export function ambientTick({ ambient = false, calm = false, locked = false, busy = false, held = false, since = 0, after = 0 } = {}) {
  if (locked) return { ambient, calm }
  if (!ambient) {
    // came on by itself: nobody has been here for a while, so it starts calm (no bar flashing up for an empty room)
    if (after > 0 && !busy && since >= after * 1000) return { ambient: 'auto', calm: since >= CALM_MS }
    return { ambient: false, calm: false }
  }
  if (!calm && !busy && !held && since >= CALM_MS) return { ambient, calm: true }
  return { ambient, calm }
}

// An input (pointer move, press, key, wheel) while calm brings the bar and the dock back, and only that: the caller
// swallows it (no click-through onto the bar, the dock or the scene, Esc / H don't leave yet). -> the next { ambient, calm }, or null when the
// input isn't a wake (it acts as usual). Woken, Ambient is someone's again ('hand').
export function ambientWake({ ambient = false, calm = false, locked = false } = {}) {
  if (!ambient || !calm || locked) return null
  return { ambient: 'hand', calm: false }
}

// In Ambient the dock sits bottom right, beside the bar, which is centred and as wide as what it shows: on a phone (or a
// long title on a small window) the two would overlap. -> how far to raise the dock (px) so it clears the bar's top by
// `gap`, or 0 when they don't meet side by side. bar / dock: { left, right, top, bottom } (getBoundingClientRect),
// the dock where it rests (not raised); no bar: 0.
export function dockLift(bar, dock, gap = 8) {
  if (!bar || !dock) return 0
  const beside = bar.right + gap <= dock.left || dock.right + gap <= bar.left
  const above = dock.bottom + gap <= bar.top
  if (beside || above) return 0
  return Math.max(0, Math.ceil(dock.bottom - bar.top + gap))
}
