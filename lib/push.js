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
// PUSH_TEST_HOSTS: extra hosts (plain http too) for the tests' stand-in push service; never in production
const testHosts = () => (process.env.NODE_ENV === 'production' ? [] : (process.env.PUSH_TEST_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean))

// what a browser's PushSubscription.toJSON() sends -> { sub: { endpoint, keys: { p256dh, auth } } } | { error, field }
export function cleanSubscription(raw, test = testHosts()) {
  if (!raw || typeof raw !== 'object') return { error: 'subscription: an object', field: 'subscription' }
  const { endpoint, keys } = raw
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return { error: 'endpoint: a URL', field: 'endpoint' }
  let u
  try {
    u = new URL(endpoint)
  } catch {
    return { error: 'endpoint: a URL', field: 'endpoint' }
  }
  const stand = test.length > 0 && hostOk(u.hostname, test)
  // a real push service: https, its own host, no port (none of them use one), no user / password
  const real = u.protocol === 'https:' && !u.port && hostOk(u.hostname, PUSH_HOSTS)
  if ((!real && !stand) || u.username || u.password) return { error: 'endpoint: not a known push service', field: 'endpoint' }
  // p256dh: an uncompressed P-256 point (65 bytes), auth: 16 bytes, both base64url
  const p = keys?.p256dh, a = keys?.auth
  if (typeof p !== 'string' || !B64URL.test(p) || Buffer.from(p, 'base64url').length !== 65) return { error: 'keys.p256dh: a P-256 key', field: 'keys.p256dh' }
  if (typeof a !== 'string' || !B64URL.test(a) || Buffer.from(a, 'base64url').length !== 16) return { error: 'keys.auth: 16 bytes', field: 'keys.auth' }
  return { sub: { endpoint: u.href, keys: { p256dh: p, auth: a } } }
}

// a short device name ("iPhone · Safari") from what the page says, kept to one plain line
export const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '') || 'This device'

// a notice -> the push's JSON (public/sw.js reads it). Apple and Google take 4 KB of push, encryption adds a little,
// and a phone shows a few lines anyway: at most MAX_PAYLOAD bytes. A long link (non-Latin text grows 9x when
// %-encoded) gives way first (the tap opens the home page), then the body, then the title; never half a character
export const MAX_PAYLOAD = 3000
const chars = (s, n) => {
  const a = Array.from(s ?? '')
  return a.length > n ? `${a.slice(0, n - 1).join('').trimEnd()}…` : a.join('')
}
export function payloadOf(n) {
  const p = { title: chars(n.title, 80), body: chars(n.body, 300), tag: n.tag ?? null, url: n.url ?? '/', level: n.level ?? 'info' }
  const size = () => Buffer.byteLength(JSON.stringify(p))
  if (size() > MAX_PAYLOAD) p.url = '/'
  for (let b = 300; size() > MAX_PAYLOAD && b > 20; b -= 20) p.body = chars(n.body, b)
  for (let t = 80; size() > MAX_PAYLOAD && t > 10; t -= 10) p.title = chars(n.title, t)
  return JSON.stringify(p)
}
// how long a push service keeps trying a phone that's off (the notice's own life, at most 4 weeks), and how urgent
export const optionsOf = (n) => ({ TTL: Math.max(60, Math.min(n.ttl ?? 86400, 28 * 86400)), urgency: n.level === 'error' || n.level === 'warning' ? 'high' : 'normal' })
// which answers mean the subscription is gone for good (the app was removed, permission taken back)
export const goneStatus = (code) => code === 404 || code === 410
// a rejection that's about this device (its subscription is bad): counts toward MAX_FAILS. Not: no answer at all (the
// internet down, a timeout), 429 (slow down), 413 (our payload), 5xx (their trouble): those never cost a device
export const deviceFault = (code) => Number.isInteger(code) && code >= 400 && code < 500 && code !== 429 && code !== 413

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
          await store.ok(s.endpoint) // (always: another send may have counted a failure since the list was read)
        } catch (e) {
          if (goneStatus(e?.statusCode)) {
            out.dropped++
            await store.remove(owner, s.endpoint)
          } else {
            out.failed++
            if (deviceFault(e?.statusCode)) await store.fail(s.endpoint, MAX_FAILS)
          }
        }
      }),
    )
  } catch {}
  return out
}
