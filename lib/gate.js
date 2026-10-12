import { timingSafeEqual } from 'node:crypto'

// A header the reverse proxy injects, compared in constant time. Missing / short secret -> false (fail closed).
export function secretOk(got, secret) {
  if (!secret || secret.length < 16 || !got) return false
  const a = Buffer.from(got), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Auth (LAN bypass / Authelia login) is enforced by the reverse proxy, not here.
// Seatbelt: the proxy's /api/private location injects x-home-gate = GATE_SECRET; anything else is a 404. Fail closed.
export const gateOk = (got) => secretOk(got, process.env.GATE_SECRET)

// The owner-only zone: requests under the proxy's /api/private/settings location (always behind the Authelia login).
// Needs the gate, plus x-home-sync = SYNC_SECRET that only that location adds; only then is Remote-User trusted
// (on a path without the login check a client could send its own). 404 = not set up / not through that location,
// 403 = someone else, else the owner's name.
export function ownerOf(request) {
  if (!gateOk(request.headers.get('x-home-gate')) || !secretOk(request.headers.get('x-home-sync'), process.env.SYNC_SECRET)) return 404
  const name = process.env.OWNER_USER
  if (!name) return 404
  return request.headers.get('remote-user') === name ? name : 403
}

// Settings sync's owner (app/api/private/settings and its live stream): ownerOf, and 404 while there's no database
export const syncOwner = (request) => (process.env.DATABASE_URL ? ownerOf(request) : 404)

// The notification hub's senders (app/api/notify): `Authorization: Bearer <NOTIFY_TOKEN>`, compared in constant time.
// The hub is off (404) without a token, a database to keep notices in, or an owner to show them to.
export const notifyOn = () => Boolean(process.env.NOTIFY_TOKEN && process.env.DATABASE_URL && process.env.OWNER_USER)
export function senderOk(request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return secretOk(m?.[1], process.env.NOTIFY_TOKEN)
}

// writes only from this page: a same-origin fetch with a JSON body (a cross-site form or image can't send either)
export function sameOriginJson(request) {
  const site = request.headers.get('sec-fetch-site')
  return (!site || site === 'same-origin') && Boolean(request.headers.get('content-type')?.startsWith('application/json'))
}
