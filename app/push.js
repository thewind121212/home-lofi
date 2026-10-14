'use client'

// "Alerts on this device": the hub's notices as pushes, so a phone gets them with the page closed (lib/push.js sends,
// public/sw.js shows them). Lives in the bell inbox's footer (owner only, like the inbox). Per device:
// - an iPhone / iPad in a Safari tab can't: push needs the Home Screen app (iOS 16.4+), so it says how to add it
// - "Turn on alerts": the tap itself asks for permission (iOS only shows the prompt for a tap), then subscribes with
//   the server's key and hands the subscription to the server; "Test" sends one to this device; "Turn off" ends it
// - blocked in the browser's / iOS settings: it says where to change that
import { useEffect, useRef, useState } from 'react'

const URL_ = '/api/private/settings/push'

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext

// "iPhone · Home Screen", "Mac · Chrome"
function deviceName() {
  const ua = navigator.userAgent
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const app = standalone() ? 'Home Screen' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${dev} · ${app}`
}
const bytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
// was this subscription made with the server's current key? (a new key: subscribe again)
const sameKey = (sub, key) => {
  const k = sub?.options?.applicationServerKey
  return !k || b64(k) === key
}

async function api(method, body) {
  const r = await fetch(URL_, {
    method,
    cache: 'no-store',
    redirect: 'manual',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw Object.assign(new Error(j?.error ?? 'failed'), { status: r.status })
  return j
}

// -> { state: 'loading' | 'off-server' | 'unsupported' | 'install' | 'denied' | 'off' | 'on', ... }
export function usePush(active) {
  const [state, setState] = useState('loading')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const key = useRef(null)
  const sub = useRef(null)
  // every check and every tap takes a number; a check that finishes after a newer one started (the inbox opened, then
  // "Turn on" was tapped before the check came back) doesn't write its older answer over it
  const gen = useRef(0)

  async function refresh() {
    const n = ++gen.current
    const set = (v) => n === gen.current && setState(v)
    if (!canPush()) return set(isIOS() && !standalone() ? 'install' : 'unsupported')
    let srv
    try {
      srv = await api('GET')
    } catch (e) {
      return set(e?.status === 404 || e?.status === 403 ? 'off-server' : 'off')
    }
    if (n !== gen.current) return
    key.current = srv.publicKey
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    const s = await reg.pushManager.getSubscription()
    if (n !== gen.current) return
    sub.current = s
    if (Notification.permission === 'denied') return set('denied')
    set(s && sameKey(s, srv.publicKey) && srv.devices.some((d) => d.endpoint === s.endpoint) ? 'on' : 'off')
  }
  useEffect(() => {
    if (active) refresh().catch(() => setState('off'))
  }, [active])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  async function turnOn() {
    ++gen.current
    setBusy(true)
    setNote(null)
    try {
      // first, straight from the tap: iOS shows the permission prompt only for a user's tap
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'off')
        return setNote(perm === 'denied' ? null : 'Not turned on: allow notifications to get alerts')
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      let s = await reg.pushManager.getSubscription()
      if (s && !sameKey(s, key.current)) await s.unsubscribe().then(() => (s = null), () => (s = null))
      s ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key.current) })
      await api('POST', { action: 'add', subscription: s.toJSON(), name: deviceName() })
      sub.current = s
      setState('on')
      setNote('Alerts are on for this device')
    } catch {
      setNote("Couldn't turn alerts on: try again")
    } finally {
      setBusy(false)
    }
  }
  async function turnOff() {
    ++gen.current
    setBusy(true)
    setNote(null)
    try {
      const s = sub.current
      if (s) {
        await api('POST', { action: 'remove', endpoint: s.endpoint }).catch(() => {})
        await s.unsubscribe().catch(() => {})
      }
      sub.current = null
      setState('off')
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    if (!sub.current) return
    setBusy(true)
    try {
      const r = await api('POST', { action: 'test', endpoint: sub.current.endpoint })
      setNote(r.test?.sent ? 'Sent: it should arrive in a moment' : "This device didn't take it: turn alerts off and on again")
      if (!r.devices.some((d) => d.endpoint === sub.current.endpoint)) setState('off')
    } catch {
      setNote("Couldn't send a test: try again")
    } finally {
      setBusy(false)
    }
  }
  return { state, busy, note, turnOn, turnOff, test }
}

const pill = 'h-9 px-3.5 rounded-full border font-mono text-xs transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait'

// the inbox footer's left side. open: the inbox is open (checks this device then)
export function PushControl({ open }) {
  const p = usePush(open)
  const [help, setHelp] = useState(false)
  if (p.state === 'loading' || p.state === 'unsupported' || p.state === 'off-server') return <span />
  return (
    <div className="min-w-0 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {p.state === 'install' && (
          <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} className={`${pill} border-white/10 text-lofi-muted hover:text-white`}>
            <i className="fa-solid fa-mobile-screen" aria-hidden="true" /> Alerts on this iPhone
          </button>
        )}
        {p.state === 'denied' && (
          <span className="font-mono text-[11px] text-lofi-highlight">
            <i className="fa-solid fa-bell-slash mr-1.5" aria-hidden="true" />
            Alerts are blocked: allow them in {isIOS() ? 'Settings › Notifications › Home' : "this site's settings"}
          </span>
        )}
        {p.state === 'off' && (
          <button type="button" onClick={p.turnOn} disabled={p.busy} className={`${pill} border-lofi-primary/40 text-lofi-primary hover:bg-lofi-primary/10`}>
            <i className={`fa-solid ${p.busy ? 'fa-spinner fa-spin' : 'fa-bell'}`} aria-hidden="true" /> Turn on alerts
          </button>
        )}
        {p.state === 'on' && (
          <>
            <span className="h-9 px-3 rounded-full bg-lofi-primary/10 border border-lofi-primary/30 font-mono text-xs text-lofi-primary flex items-center gap-2">
              <i className="fa-solid fa-bell" aria-hidden="true" /> Alerts on
            </span>
            <button type="button" onClick={p.test} disabled={p.busy} className={`${pill} border-white/10 text-lofi-muted hover:text-white`}>Test</button>
            <button type="button" onClick={p.turnOff} disabled={p.busy} className={`${pill} border-white/10 text-lofi-muted hover:text-white`}>Turn off</button>
          </>
        )}
      </div>
      {help && p.state === 'install' && (
        <p className="max-w-xs font-mono text-[11px] leading-relaxed text-lofi-muted">
          iPhone alerts come from the Home Screen app: tap <i className="fa-solid fa-arrow-up-from-bracket text-white/80" aria-label="Share" /> Share › Add to Home Screen, open
          Home from its icon, then turn alerts on here.
        </p>
      )}
      {p.note && <p role="status" className="font-mono text-[11px] text-lofi-highlight">{p.note}</p>}
    </div>
  )
}
