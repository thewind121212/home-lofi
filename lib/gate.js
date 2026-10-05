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
