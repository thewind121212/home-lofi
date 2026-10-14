'use client'

// "Alerts on this device": the hub's notices as pushes, so a phone gets them with the page closed (lib/push.js sends,
// public/sw.js shows them). Lives in the bell inbox's footer (owner only, like the inbox). Per device:
// - an iPhone / iPad in a Safari tab can't: push needs the Home Screen app (iOS 16.4+), so it says how to add it
// - "Turn on alerts": the tap itself asks for permission (iOS only shows the prompt for a tap), then subscribes with
//   the server's key and hands the subscription to the server; "Turn off" ends it
// - blocked in the browser's / iOS settings: it says where to change that
import { useEffect, useRef, useState } from 'react'

const URL_ = '/api/private/settings/push'

const isIPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isIOS = () => /iPhone|iPod/.test(navigator.userAgent) || isIPad()
const phoneWord = () => (isIPad() ? 'iPad' : 'iPhone')
const standalone = () => matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext

// "iPhone · Home Screen", "Mac · Chrome"
function deviceName() {
  const ua = navigator.userAgent
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const app = standalone() ? (isIOS() ? 'Home Screen' : 'App') : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
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
  if (!r.ok) throw Object.assign(new Error(j?.error ?? 'failed'), { status: r.status, field: j?.field })
  return j
}

// -> { state: 'loading' | 'off-server' | 'unsupported' | 'install' | 'denied' | 'error' | 'off' | 'on', ... }
// ('error': the server couldn't be asked (the network, a lapsed login): nothing is touched until it can)
export function usePush(active) {
  const [state, setState] = useState('loading')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const key = useRef(null)
  const sub = useRef(null)
  // every check and every tap takes a number; a check that finishes after a newer one started (the inbox opened, then
  // "Turn on" was tapped before the check came back) doesn't write its older answer over it
  const gen = useRef(0)

  const busyRef = useRef(false)
  async function refresh() {
    if (busyRef.current) return // a tap is under way: it says what's true when it's done
    const n = ++gen.current
    const set = (v) => n === gen.current && setState(v)
    if (!canPush()) return set(isIOS() && !standalone() ? 'install' : 'unsupported')
    let srv
    try {
      srv = await api('GET')
    } catch (e) {
      return set(e?.status === 404 || e?.status === 403 ? 'off-server' : 'error')
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
  const check = () => {
    const n = gen.current + 1
    refresh().catch(() => n === gen.current && setState('error'))
  }
  useEffect(() => {
    if (active) check()
  }, [active])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  async function turnOn() {
    ++gen.current
    busyRef.current = true
    setBusy(true)
    setNote(null)
    try {
      // first, straight from the tap: iOS shows the permission prompt only for a user's tap
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'off')
        return setNote(perm === 'denied' ? null : 'Not turned on: allow notifications to get alerts')
      }
      // the server's key, or nothing changes: without it a working subscription would be undone for nothing
      key.current ??= (await api('GET')).publicKey
      if (!key.current) throw new Error('no key')
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
      busyRef.current = false
      setBusy(false)
    }
  }
  async function turnOff() {
    ++gen.current
    busyRef.current = true
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
      busyRef.current = false
      setBusy(false)
    }
  }
  return { state, busy, note, turnOn, turnOff, retry: check }
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
            <i className="fa-solid fa-mobile-screen" aria-hidden="true" /> Alerts on this {phoneWord()}
          </button>
        )}
        {p.state === 'error' && (
          <button type="button" onClick={p.retry} className={`${pill} border-white/10 text-lofi-muted hover:text-white`}>
            <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Couldn't check alerts · Retry
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
            <button type="button" onClick={p.turnOff} disabled={p.busy} className={`${pill} border-white/10 text-lofi-muted hover:text-white`}>Turn off</button>
          </>
        )}
      </div>
      {help && p.state === 'install' && (
        <p className="max-w-xs font-mono text-[11px] leading-relaxed text-lofi-muted">
          {phoneWord()} alerts come from the Home Screen app: tap <i className="fa-solid fa-arrow-up-from-bracket text-white/80" aria-hidden="true" /> Share › Add to Home
          Screen, open Home from its icon and sign in there (it keeps its own login), then turn alerts on in this inbox. Added it
          already? Open Home from its icon.
        </p>
      )}
      {/* one live region, always there, so a screen reader reads each new note */}
      <p role="status" aria-live="polite" className="font-mono text-[11px] text-lofi-highlight empty:hidden">{p.note ?? ''}</p>
    </div>
  )
}
