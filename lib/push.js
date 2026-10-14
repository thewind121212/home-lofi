// Web Push: every notice the hub keeps (lib/notify-store.js) also goes to the owner's devices as a push, so it reaches
// an iPhone whose home-screen app is closed (iOS 16.4+: only from the Home Screen app, after a tap on "Turn on"),
// or a desktop browser. Open standard: the server signs with its own VAPID keys (lib/push-store.js makes and keeps
// them), no Apple account, no Firebase. public/sw.js shows them; app/push.js turns them on per device.
// This file: the pure rules (no database, no network) and pushNotice(), the one sender everything calls.
import webpush from 'web-push'
import { pushStore } from './push-store.js'
export { MAX_DEVICES } from './push-store.js'

// The push services a subscription may point at: the server POSTs to that URL, so nothing else (an attacker's
// address, a LAN host) is ever accepted. Apple (Safari / iOS), Google (Chrome, Edge on Android), Mozilla, Microsoft.
export const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com']
export const MAX_FAILS = 5 // a device that failed this many sends in a row (not a 404 / 410, which drop it at once) goes
export const SUBJECT = 'https://home.wliafdew.dev' // who signs (VAPID "sub"): a contact the push services may use
const B64URL = /^[A-Za-z0-9_-]+$/

const hostOk = (host, allowed) => allowed.some((h) => host === h || host.endsWith(`.${h}`))
// PUSH_TEST_HOSTS (tests and local checks only): extra hosts, comma-separated
const allowedHosts = () => [...PUSH_HOSTS, ...(process.env.PUSH_TEST_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]

// what a browser's PushSubscription.toJSON() sends -> { sub: { endpoint, keys: { p256dh, auth } } } | { error, field }
export function cleanSubscription(raw, allowed = allowedHosts()) {
  if (!raw || typeof raw !== 'object') return { error: 'subscription: an object', field: 'subscription' }
  const { endpoint, keys } = raw
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return { error: 'endpoint: a URL', field: 'endpoint' }
  let u
  try {
    u = new URL(endpoint)
  } catch {
    return { error: 'endpoint: a URL', field: 'endpoint' }
  }
  const test = allowed.length > PUSH_HOSTS.length && hostOk(u.hostname, allowed.slice(PUSH_HOSTS.length))
  if ((u.protocol !== 'https:' && !test) || u.username || u.password || !hostOk(u.hostname, allowed)) return { error: 'endpoint: not a known push service', field: 'endpoint' }
  // p256dh: an uncompressed P-256 point (65 bytes), auth: 16 bytes, both base64url
  const p = keys?.p256dh, a = keys?.auth
  if (typeof p !== 'string' || !B64URL.test(p) || Buffer.from(p, 'base64url').length !== 65) return { error: 'keys.p256dh: a P-256 key', field: 'keys.p256dh' }
  if (typeof a !== 'string' || !B64URL.test(a) || Buffer.from(a, 'base64url').length !== 16) return { error: 'keys.auth: 16 bytes', field: 'keys.auth' }
  return { sub: { endpoint: u.href, keys: { p256dh: p, auth: a } } }
}

// a short device name ("iPhone · Safari") from what the page says, kept to one plain line
export const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '') || 'This device'

// a notice -> the push's JSON (public/sw.js reads it). Short: Apple takes 4 KB, and a phone shows a few lines anyway
export function payloadOf(n) {
  const body = (n.body ?? '').length > 300 ? `${n.body.slice(0, 299).trimEnd()}…` : n.body ?? ''
  return JSON.stringify({ title: n.title, body, tag: n.tag ?? null, url: n.url ?? '/', level: n.level ?? 'info' })
}
// how long a push service keeps trying a phone that's off (the notice's own life, at most 4 weeks), and how urgent
export const optionsOf = (n) => ({ TTL: Math.max(60, Math.min(n.ttl ?? 86400, 28 * 86400)), urgency: n.level === 'error' || n.level === 'warning' ? 'high' : 'normal' })
// which answers mean the subscription is gone for good (the app was removed, permission taken back)
export const goneStatus = (code) => code === 404 || code === 410

// The one sender: a notice (lib/notify.js cleanNotice's) to every device the owner turned on. Silent notices (the
// hub's "no pop-up") don't buzz a phone either. Never throws; -> { sent, dropped, failed }
// (send: the HTTP side; tests hand in their own through globalThis.__homePushSend, as they do the stores)
export async function pushNotice(owner, notice, { send = globalThis.__homePushSend ?? webpush.sendNotification, store = pushStore() } = {}) {
  const out = { sent: 0, dropped: 0, failed: 0 }
  if (!owner || !notice || notice.silent) return out
  try {
    const subs = await store.list(owner)
    if (!subs.length) return out
    const keys = await store.keys()
    const vapidDetails = { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey }
    const body = payloadOf(notice)
    const opts = { ...optionsOf(notice), vapidDetails, timeout: 10_000 }
    await Promise.all(
      subs.map(async (s) => {
        try {
          await send({ endpoint: s.endpoint, keys: s.keys }, body, opts)
          out.sent++
          if (s.fails) await store.ok(s.endpoint)
        } catch (e) {
          if (goneStatus(e?.statusCode)) {
            out.dropped++
            await store.remove(owner, s.endpoint)
          } else {
            out.failed++
            await store.fail(s.endpoint, MAX_FAILS)
          }
        }
      }),
    )
  } catch {}
  return out
}
