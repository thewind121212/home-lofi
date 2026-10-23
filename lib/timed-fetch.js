// The owner's reminders API (lib/timed.js has the rules). Server-only: the owner's route
// (app/api/private/settings/reminders/timed) and the due ticker (lib/timed-ticker.js). REMIND_URL is where this server
// reaches it (http://10.10.0.162:8098: a machine on the LAN with no login of its own, so never the browser, never the
// internet); empty = off, and Reminders is its carry-over list alone.
// Each call gives up after TIMEOUT (a sentence: PARSE_TIMEOUT, the model may be waking up), reads MAX_BYTES at most and
// follows no redirects. A failure throws { status } (0: unreachable, else the API's) and never says the address.
import { HISTORY, cleanList, cleanTimed } from './timed.js'

const TIMEOUT = 8000
const PARSE_TIMEOUT = 60_000
const MAX_BYTES = 1024 * 1024

const base = () => (process.env.REMIND_URL ?? '').trim().replace(/\/+$/, '')
export const timedOn = () => /^https?:\/\//i.test(base())
const fetcher = () => globalThis.__homeTimedFetch ?? fetch // (the tests hand in their own: no network)

async function call(path, { method = 'GET', body, timeout = TIMEOUT } = {}) {
  let r
  try {
    r = await fetcher()(`${base()}${path}`, {
      method,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw Object.assign(new Error('reminders unreachable'), { status: 0 })
  }
  let json = null
  try {
    const buf = await r.arrayBuffer()
    if (buf.byteLength <= MAX_BYTES) json = JSON.parse(new TextDecoder().decode(buf))
  } catch {}
  if (!r.ok) throw Object.assign(new Error(typeof json?.error === 'string' ? json.error.slice(0, 200) : `reminders ${r.status}`), { status: r.status })
  if (json == null) throw Object.assign(new Error('reminders: not JSON'), { status: 502 })
  return json
}
const one = (j) => {
  const i = cleanTimed(j)
  if (!i) throw Object.assign(new Error('reminders: an odd answer'), { status: 502 })
  return i
}

export const timedApi = {
  // the open ones -> { now (ms), items }
  async open() {
    const j = await call('/api/reminders?status=open')
    const now = Date.parse(j?.now)
    return { now: Number.isFinite(now) ? now : Date.now(), items: cleanList(j?.reminders) }
  },
  // the done ones, newest first
  done: async (limit = HISTORY) => cleanList((await call(`/api/reminders?status=done&limit=${limit}`))?.reminders),
  // the open ones whose time has come
  due: async () => cleanList((await call('/api/reminders/due'))?.reminders),
  // a sentence -> what the model read, nothing saved
  parse: (text) => call('/api/parse', { method: 'POST', body: { text }, timeout: PARSE_TIMEOUT }),
  create: async (fields) => one(await call('/api/reminders', { method: 'POST', body: fields })),
  edit: async (id, patch) => one(await call(`/api/reminders/${id}`, { method: 'PATCH', body: patch })),
  doneOne: async (id) => one(await call(`/api/reminders/${id}/done`, { method: 'POST' })),
  reopen: async (id) => one(await call(`/api/reminders/${id}/reopen`, { method: 'POST' })),
  snooze: async (id, minutes) => one(await call(`/api/reminders/${id}/snooze`, { method: 'POST', body: { minutes } })),
  remove: (id) => call(`/api/reminders/${id}`, { method: 'DELETE' }),
}
