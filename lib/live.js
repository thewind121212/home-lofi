// Live settings sync between the owner's open devices: the change made on the PC shows on the phone a second later,
// no reload (the Sounds mix above all: the phone that plays them follows the new levels). Pure, so node:test checks it.
//
// How: the server keeps a little bus of open owner event streams (app/api/private/settings/events). When a save
// (PUT /api/private/settings) changes the cloud copy, it publishes { at, from } to every stream but the one of the tab
// that saved (`from`: that tab's id). The event carries no settings at all: it only says "pull", and the page does
// its usual GET + take() (app/cloud.js), with every rule that already has (newer stamp wins, nothing moves while
// Settings or Sounds is open on that device).
//
// The bus is in memory, in this one server process. One container runs the app (Coolify), so every device's stream and
// every save meet here. Two or more instances would each have their own bus and miss each other's saves (then this
// needs Postgres LISTEN/NOTIFY or similar); devices still catch up on load and when they come back to the tab.

// open owner streams at once (a PC, a phone, a tablet, a few tabs each). Full: the OLDEST goes, not the new one: it is
// most likely a phone that slept without its connection ever closing (its pings go into the void until TCP gives up)
export const MAX_STREAMS = 12

// A tab's id: what the stream URL and the PUT header carry, so a save isn't echoed back to the tab that made it
const ID = /^[A-Za-z0-9_-]{8,64}$/
export const clientId = (v) => (typeof v === 'string' && ID.test(v) ? v : null)
export function newClientId(fill = (b) => crypto.getRandomValues(b)) {
  // (getRandomValues, not randomUUID: the LAN address is plain http, and randomUUID needs a secure context)
  return Array.from(fill(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('')
}

// The bus. subscribe(owner, id, send, close) -> unsubscribe. send(event) writes a frame (throws once the stream is
// gone: it is dropped then); close() ends a stream the cap pushes out. publish(owner, event) -> how many heard it.
// closeAll() ends every stream (the server is stopping).
export function createBus({ max = MAX_STREAMS } = {}) {
  const subs = new Set() // insertion order = oldest first
  const drop = (s) => {
    subs.delete(s)
    try {
      s.close()
    } catch {}
  }
  return {
    subscribe(owner, id, send, close = () => {}) {
      while (subs.size >= max) drop(subs.values().next().value)
      const s = { owner, id, send, close }
      subs.add(s)
      return () => subs.delete(s)
    },
    publish(owner, event) {
      let n = 0
      for (const s of [...subs]) {
        if (s.owner !== owner || (event.from && s.id === event.from)) continue
        try {
          s.send(event)
          n++
        } catch {
          drop(s)
        }
      }
      return n
    },
    closeAll() {
      for (const s of [...subs]) drop(s)
    },
    get size() {
      return subs.size
    },
  }
}

// The process-wide bus (globalThis: each route is its own bundle, and the save route and the stream route must share
// it). On SIGTERM (docker stop, a redeploy) Next stops taking requests and waits for the open ones to finish, and a
// stream never finishes by itself: the old server would hang on until Docker kills it, its pages none the wiser. So
// the streams end there and then; the pages reconnect (to the new server) and pull.
export function liveBus() {
  if (!globalThis.__homeLiveBus) {
    const bus = (globalThis.__homeLiveBus = createBus())
    // (only next to a handler that's already there, Next's: a listener of our own would cancel Node's default exit)
    if (typeof process !== 'undefined' && process.listenerCount?.('SIGTERM') > 0) process.once('SIGTERM', () => bus.closeAll())
  }
  return globalThis.__homeLiveBus
}

// ---- the page's side (app/cloud.js) ----------------------------------------------------------------------------------

// A dropped stream comes back after 2 s, 5 s, 15 s, 30 s, then every 60 s; after LIVE_TRIES failures in a row (no
// hello in between: the proxy has no stream for us, say) it gives up until the tab shows again. Nothing is lost
// meanwhile: the page still pulls on load and whenever the tab comes back.
export const LIVE_RETRY = [2, 5, 15, 30, 60] // s
export const LIVE_TRIES = 8
export const liveRetryMs = (fails) => (fails >= LIVE_TRIES ? null : LIVE_RETRY[Math.min(fails, LIVE_RETRY.length - 1)] * 1000)

// a hidden tab lets its stream go after a minute (the pull on coming back covers what it missed), unless `keep`:
// sounds are playing on it, so the mix should follow even with the phone's screen off
export const LIVE_HIDDEN_MS = 60_000

// Should the stream be open? Only while synced (the owner, signed in: never for guests), and not after giving up.
export function liveWanted({ synced, visible, hiddenMs = 0, keep = false, fails = 0 }) {
  if (!synced || fails >= LIVE_TRIES) return false
  return visible || keep || hiddenMs < LIVE_HIDDEN_MS
}

// A frame from the stream -> 'pull' (GET the doc: take() decides what changes, and holds it while a dialog is open)
// or null. frame: { kind: 'hello' | 'changed', at, from }.
// - changed: pull, unless it's this tab's own save (the server leaves the sender out already; this is the seatbelt)
// - hello (sent on every connect): pull only after a drop (`missed`), since saves made while it was down said nothing.
//   The first connect and a reopen when the tab shows again need none: the load / visibility pull is already on it.
export function liveAction(frame, { self, synced, missed = false }) {
  if (!synced || !frame) return null
  if (frame.kind === 'changed') return frame.from && frame.from === self ? null : 'pull'
  if (frame.kind === 'hello') return missed ? 'pull' : null
  return null
}
