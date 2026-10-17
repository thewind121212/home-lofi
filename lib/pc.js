// The gaming PC on the Server card: its Moni telemetry (CPU / GPU load and temps, RAM, watts, uptime, fan), a
// Wake-on-LAN button and a Turn off button. Server-only. PC_URL is moni-relay on this host (github.com/thewind121212/moni,
// relay/): it hears the PC's Moni broadcasts and answers GET /status; POST /wake sends the magic packet and POST /shutdown
// asks the PC's Moni service to shut Windows down, both with `Authorization: Bearer PC_WAKE_TOKEN`. Empty PC_URL = no PC
// block; empty PC_WAKE_TOKEN = neither button. Turn off also needs the relay's MONI_PC_KEY and the same key in the Moni
// app on the PC (the relay's can_shutdown).
// - /status is kept TTL for every tab (they all poll /api/private every 5 s), gives up after TIMEOUT, and a failure is
//   remembered FAIL_TTL so a stopped relay never slows /api/private down.
// - Only known fields, as numbers / booleans / short strings, ever reach the browser (cleanPc).

const TIMEOUT = 1500
const WAKE_TIMEOUT = 3000
const OFF_TIMEOUT = 6000 // the relay waits up to 4 s for the PC
const TTL = 2000
const FAIL_TTL = 15_000

const base = () => (process.env.PC_URL ?? '').trim().replace(/\/+$/, '')
export const pcOn = () => /^https?:\/\//i.test(base())
export const wakeOn = () => pcOn() && (process.env.PC_WAKE_TOKEN ?? '').length >= 16
// the fetch: the tests hand in their own (no network)
const fetcher = () => globalThis.__homePcFetch ?? fetch
// the module's memory (globalThis: the tests reset it)
const mem = () => (globalThis.__homePc ??= { at: 0, value: null, loading: null })
export const resetPc = () => void (globalThis.__homePc = undefined)

const NUMS = ['cpu', 'ct', 'gpu', 'gt', 'mt', 'st', 'ram', 'ramgb', 'vram', 'vramgb', 'sysw', 'up', 'fan']
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? v : null)
const short = (v) => (typeof v === 'string' ? v.slice(0, 24) : null)

// the relay's /status -> what the page gets. A reading of 0 means "no sensor" (shown as --).
export function cleanPc(d) {
  if (!d || typeof d !== 'object') return { reachable: false }
  const online = d.online === true
  const n = online && d.n && typeof d.n === 'object' ? d.n : {}
  const stats = Object.fromEntries(NUMS.map((k) => [k, num(n[k]) || null]))
  return {
    reachable: true,
    online,
    waking: !online && d.waking === true,
    canWake: !online && d.can_wake === true && wakeOn(),
    stopping: online && d.stopping === true, // asked to turn off, still reporting
    canOff: online && d.can_shutdown === true && wakeOn(),
    lastSeen: online ? null : short(d.last_seen),
    parts: online && d.parts === true, // watts = CPU + GPU packages, not the wall
    ...(online && { stats }),
  }
}

export async function pcStatus() {
  if (!pcOn()) return null
  const m = mem()
  const age = Date.now() - m.at
  if (m.value && age < (m.value.reachable ? TTL : FAIL_TTL)) return m.value
  m.loading ??= (async () => {
    let value
    try {
      const r = await fetcher()(`${base()}/status`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT) })
      value = r.ok ? cleanPc(await r.json()) : { reachable: false }
    } catch {
      value = { reachable: false }
    }
    Object.assign(m, { at: Date.now(), value, loading: null })
    return value
  })()
  return m.loading
}

// -> { sent } (wake: false when it was online already; off: false when it was off already); throws when the relay is
// unreachable or refuses
export const wakePc = () => relayPost('/wake')
export const offPc = () => relayPost('/shutdown')

async function relayPost(path) {
  const r = await fetcher()(`${base()}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.PC_WAKE_TOKEN}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(path === '/wake' ? WAKE_TIMEOUT : OFF_TIMEOUT),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.ok !== true) throw new Error(`relay ${r.status}`)
  mem().at = 0 // the next /api/private asks again: "waking…" / "turning off…" shows at once
  return { sent: body.sent === true }
}
