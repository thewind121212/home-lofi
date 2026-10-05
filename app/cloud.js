import { useEffect, useRef, useState } from 'react'
import { SETTINGS_KEY, parseSettings } from '../lib/settings'
import { SYNC_KEYS, cleanDoc, merge } from '../lib/sync'
import { load, save } from './settings'

// Owner-only cloud sync of settings, saved scene and weather location (rules in lib/sync.js). Local-first: the page
// always renders from localStorage and never waits for the network; this hook pushes and pulls in the background.
// status: 'off' (guest / sync not set up) | 'signin' (the proxy wants an Authelia login) | 'syncing' | 'synced'
//         | 'offline' (changes are safe in this browser and go up on the next try)
const URL_ = '/api/private/settings'
const STAMPS = 'stamps' // localStorage home-lofi:stamps = { key: ms of the last local change }
const PUSH_DELAY = 1000 // a burst of edits (dragging the dim slider) becomes one request
const RETRY = [5, 15, 30, 60] // s, then every 60 s

// localStorage -> doc. Keys without a stamp count as never changed here, so the cloud copy wins for them.
function localDoc() {
  let raw
  try {
    raw = localStorage.getItem(SETTINGS_KEY)
  } catch {}
  const s = parseSettings(raw)
  const v = { scene: load('scene', null), location: load('location', null) }
  for (const f of Object.keys(s)) v[`settings.${f}`] = s[f]
  return cleanDoc({ v, t: load(STAMPS, {}) })
}

// remote values -> localStorage (and their stamps, so they don't look like local edits on the next push)
function writeLocal(doc, keys) {
  const stamps = load(STAMPS, {})
  const patch = {}
  for (const k of keys) {
    stamps[k] = doc.t[k]
    if (k.startsWith('settings.')) patch[k.slice(9)] = doc.v[k]
    else save(k, doc.v[k])
  }
  if (Object.keys(patch).length) {
    let raw
    try {
      raw = localStorage.getItem(SETTINGS_KEY)
    } catch {}
    save('settings', { ...parseSettings(raw), ...patch })
  }
  save(STAMPS, stamps)
}

// apply(keys): the hook already wrote those keys to localStorage; the page re-reads them into state.
// hold: the Settings dialog; while it's open, incoming changes wait so nothing moves under the cursor.
export function useCloudSync(apply, hold) {
  const [status, setStatus] = useState('off')
  const touch = useRef(() => {}) // replaced once the effect runs; a stable function for the page to call
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => {
    let alive = true
    let on = false // the server said yes at least once (owner, signed in, sync set up)
    let busy = false, dirty = false, again = false, timer, tries = 0 // again: a pull asked for while busy
    let answered = false
    const early = {} // edits made before the first answer: they count only if that answer says "owner"

    // remote doc -> take the keys that are newer than ours; true if we still have newer keys to send up.
    // While the Settings dialog is open nothing incoming is written or shown (it would move under the cursor, and the
    // dialog's next edit would save its older copy over it); one fresh pull runs when it closes.
    let held = false
    const take = (remote) => {
      const local = localDoc()
      // newer in the cloud, or the same stamp with a different value: changed here while signed out (those edits
      // get no stamp and stay on this device), so signing in brings the cloud copy back
      const changed = Object.keys(remote.t).filter(
        (k) => remote.t[k] > (local.t[k] ?? 0) || (remote.t[k] === local.t[k] && JSON.stringify(remote.v[k]) !== JSON.stringify(local.v[k])),
      )
      const dlg = hold.current
      if (changed.length && dlg?.open) {
        if (!held) dlg.addEventListener('close', () => ((held = false), request('GET')), { once: true })
        held = true
      } else if (changed.length) {
        writeLocal(remote, changed)
        applyRef.current(changed)
      }
      return merge(remote, local).changed.length > 0
    }

    const later = (fn, ms) => {
      clearTimeout(timer)
      timer = setTimeout(fn, ms)
    }

    async function request(method) {
      if (busy) return method === 'PUT' ? (dirty = true) : (again = true)
      busy = true
      again = false // a PUT answers with the merged doc, so it's a pull too
      if (method === 'PUT') dirty = false
      if (on) setStatus('syncing')
      try {
        const r = await fetch(URL_, {
          method,
          redirect: 'manual', // Authelia's login redirect -> 'signin', not a followed redirect
          cache: 'no-store',
          ...(method === 'PUT' && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(localDoc()) }),
        })
        if (!alive) return
        answered = true
        if (r.type === 'opaqueredirect' || r.status === 401) return (on = false), setStatus('signin')
        if (r.status === 403 || r.status === 404) return (on = false), setStatus('off')
        if (!r.ok) throw new Error(r.status)
        const { doc } = await r.json()
        const first = !on
        on = true
        tries = 0
        if (first && Object.keys(early).length) save(STAMPS, { ...load(STAMPS, {}), ...early })
        // first sync and the cloud is empty: this browser's settings become the cloud copy
        if (first && !Object.keys(doc.t).length) {
          const now = Date.now()
          save(STAMPS, Object.fromEntries(SYNC_KEYS.map((k) => [k, now])))
          dirty = true
        } else if (take(doc)) dirty = true
        setStatus(dirty ? 'syncing' : 'synced')
      } catch {
        if (!alive) return
        if (!on) return setStatus('off') // never reached the server: behave like a guest, quietly
        dirty ||= method === 'PUT'
        setStatus('offline')
        later(() => request(dirty ? 'PUT' : 'GET'), RETRY[Math.min(tries++, RETRY.length - 1)] * 1000)
        return
      } finally {
        busy = false
      }
      if (dirty && alive) later(() => request('PUT'), PUSH_DELAY)
      else if (again && alive) request('GET')
    }

    touch.current = (keys) => {
      const now = Date.now()
      // not syncing (guest, signed out): no stamps, so these edits never overwrite the owner's cloud copy
      if (!on) return answered || keys.forEach((k) => (early[k] = now))
      save(STAMPS, { ...load(STAMPS, {}), ...Object.fromEntries(keys.map((k) => [k, now])) })
      dirty = true
      setStatus('syncing')
      later(() => request('PUT'), PUSH_DELAY)
    }

    // back to this tab / back online: pick up what other devices changed, send what's waiting
    const wake = () => document.visibilityState === 'visible' && on && request(dirty ? 'PUT' : 'GET')
    document.addEventListener('visibilitychange', wake)
    addEventListener('online', wake)
    request('GET')
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      removeEventListener('online', wake)
    }
  }, [hold])

  return { status, touch: (keys) => touch.current(keys) }
}
