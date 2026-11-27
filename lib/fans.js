// The router's fans on the Server card (owner-only): an Arduino on the Razer's USB drives two fan outputs, and a small
// service there (fan-control, FAN_URL) answers GET /api/status -> { fan1, fan2 } (0-100 %) and POST /api/fan
// { fan, speed } -> the same. That service has no login, so only this server talks to it: the browser goes through
// app/api/private/settings/fans (the Authelia login on every network) and never reaches the Razer's port.
// Server-only. Empty FAN_URL = no Router fans row.
// - /api/status is kept TTL for the owner's tabs, gives up after TIMEOUT, and a failure is remembered FAIL_TTL so a
//   Razer that's off never slows the card down.
// - Only the two speeds, as whole numbers 0-100, ever reach the browser (cleanFans). An { error } from the service
//   (the Arduino unplugged or not answering) is reachable but not ok.

const TIMEOUT = 1500
const SET_TIMEOUT = 3000
const TTL = 2000
const FAIL_TTL = 10_000

// fan1 / fan2 are the Arduino's outputs 3 and 4
export const FANS = [
  { id: 1, key: 'fan1', name: 'Switch fan' },
  { id: 2, key: 'fan2', name: 'Router fan' },
]
export const okFan = (id) => FANS.some((f) => f.id === id)
export const okSpeed = (n) => Number.isInteger(n) && n >= 0 && n <= 100

const base = () => (process.env.FAN_URL ?? '').trim().replace(/\/+$/, '')
export const fansOn = () => /^https?:\/\//i.test(base())
// the fetch: the tests hand in their own (no network)
const fetcher = () => globalThis.__homeFansFetch ?? fetch
// the module's memory (globalThis: the tests reset it)
const mem = () => (globalThis.__homeFans ??= { at: 0, value: null, loading: null })
export const resetFans = () => void (globalThis.__homeFans = undefined)

// the service's answer -> what the page gets: { reachable, ok, fans: [{ id, name, speed }] }
export function cleanFans(d) {
  if (!d || typeof d !== 'object') return { reachable: false, ok: false }
  if (d.error != null) return { reachable: true, ok: false }
  const fans = FANS.map((f) => ({ id: f.id, name: f.name, speed: okSpeed(d[f.key]) ? d[f.key] : null }))
  return { reachable: true, ok: fans.every((f) => f.speed != null), fans }
}

export async function fanStatus() {
  if (!fansOn()) return null
  const m = mem()
  const age = Date.now() - m.at
  if (m.value && age < (m.value.ok ? TTL : FAIL_TTL)) return m.value
  m.loading ??= (async () => {
    let value
    try {
      const r = await fetcher()(`${base()}/api/status`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT) })
      value = cleanFans(await r.json().catch(() => null))
    } catch {
      value = { reachable: false, ok: false }
    }
    Object.assign(m, { at: Date.now(), value, loading: null })
    return value
  })()
  return m.loading
}

// Set one fan, or 'both' (one after the other: the Arduino takes one command at a time) -> the fresh status, which
// every tab then gets from the cache. Throws when the service is unreachable or says no.
export async function setFans(fan, speed) {
  let value
  for (const id of fan === 'both' ? FANS.map((f) => f.id) : [fan]) {
    const r = await fetcher()(`${base()}/api/fan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fan: id, speed }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(SET_TIMEOUT),
    })
    value = cleanFans(await r.json().catch(() => null))
    if (!r.ok || !value.ok) {
      mem().at = 0 // the next read asks again
      throw new Error(`fans ${r.status}`)
    }
  }
  Object.assign(mem(), { at: Date.now(), value })
  return value
}
