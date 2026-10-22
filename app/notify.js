'use client'

import { useEffect, useRef, useState } from 'react'
import { LEVEL_LOOK, NO_PENDING, TOAST_MAX, TOAST_MS, ago, alive, byDay, left, look, maxId, settle, sticky, toastsFor, unreadOf } from '../lib/notify'
import { closeDialog, motionOff, useStillPage } from './settings'
import { useFlip } from './flip'
import { flipSig } from '../lib/flip'
import { PushControl } from './push'

// The notification hub on the page (rules in lib/notify.js, the routes in app/api/notify and
// app/api/private/settings/notifications). The owner's only: guests never ask, and the route says 404 / 403 anyway.
// useNotify pulls the list on load, when the tab shows again, and when the live stream (app/cloud.js) says 'notify' or
// reconnects; what arrived since this tab last looked pops up. The pieces below put it on screen the page's way:
// Font Awesome glyphs or the sender's https image in the page's icon wells, colors from the theme's palette.
const URL_ = '/api/private/settings/notifications'

// lib/notify.js COLORS -> the page's classes (the service cards' and status lines' own: tokens, emerald / red / blue /
// purple-400). Literal strings, so Tailwind sees them.
const TEXT = {
  primary: 'text-lofi-primary',
  secondary: 'text-lofi-secondary',
  highlight: 'text-lofi-highlight',
  muted: 'text-lofi-muted',
  green: 'text-emerald-400',
  red: 'text-red-400',
  blue: 'text-blue-400',
  purple: 'text-purple-400',
}
const STRIPE = {
  primary: 'bg-lofi-primary',
  secondary: 'bg-lofi-secondary',
  highlight: 'bg-lofi-highlight',
  muted: 'bg-lofi-muted',
  green: 'bg-emerald-400',
  red: 'bg-red-400',
  blue: 'bg-blue-400',
  purple: 'bg-purple-400',
}

// owner: settings sync answered as the owner (Home's `owner`); set: the settings (pop-ups, their level); dlg: the inbox
// (while it's open, what arrives is shown there and counts as read, no pop-up).
// -> { on, items (alive, newest first), read, unread, shownRead, toasts, more, live, markAllRead, dismiss, clear,
//      dropToast, clearToasts }
export function useNotify(owner, set, dlg) {
  const [hub, setHub] = useState({ items: [], read: 0, ready: false })
  const [tried, setTried] = useState(false) // the first pull came back, whatever it said (the bell's stand-in ends)
  const [shownRead, setShownRead] = useState(0) // read as it was when the inbox opened: its "new" dots stay put
  const [toasts, setToasts] = useState({ show: [], more: 0 })
  const seen = useRef(null) // the newest id this tab has had (null until the first answer: the backlog doesn't pop up)
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const setRef = useRef(set)
  setRef.current = set
  const hubRef = useRef(hub)
  hubRef.current = hub
  const api = useRef({})
  // dismissed / cleared / read here, until the server's answers show it too (lib/notify.js settle): an answer to a
  // request made just before doesn't flash the notice back
  const pending = useRef(NO_PENDING)

  useEffect(() => {
    let on = true, busy = false, again = false, soon = 0
    let sent = 0 // requests numbered as they go out (settle: which answers are surely newer than a dismiss)
    let shown = 0 // the newest request whose answer is on screen: an older answer landing later is out of date

    const take = (answer, seq) => {
      if (!on || !Array.isArray(answer?.items) || seq < shown) return
      shown = seq
      const { items, read, pending: still } = settle(answer, pending.current, seq)
      pending.current = still
      setHub({ items, read, ready: true })
      const top = maxId(items)
      if (seen.current == null) return void (seen.current = top)
      const fresh = items.filter((i) => i.id > seen.current && i.id > read)
      seen.current = Math.max(seen.current, top)
      if (!fresh.length) return
      if (dlg.current?.open) return void post({ action: 'read', upTo: top })
      const t = toastsFor(fresh, setRef.current)
      if (!t.show.length) return
      setToasts((prev) => {
        const all = [...t.show, ...prev.show.filter((p) => !t.show.some((n) => n.id === p.id))]
        return { show: all.slice(0, TOAST_MAX), more: prev.more + t.more + Math.max(0, all.length - TOAST_MAX) }
      })
    }

    async function pull() {
      if (!on || !ownerRef.current) return
      if (busy) return void (again = true)
      busy = true
      again = false
      try {
        const seq = ++sent
        const r = await fetch(URL_, { cache: 'no-store', redirect: 'manual' })
        if (r.ok) take(await r.json(), seq)
      } catch {}
      if (on) setTried(true)
      busy = false
      if (again) pull()
    }

    // done(n): the server did it, and n requests had gone out by then (any later one sees it);
    // undo: the server didn't take it, so stop hiding what it would have changed, and show what it has
    async function post(body, { done, undo } = {}) {
      try {
        const seq = ++sent
        const r = await fetch(URL_, { method: 'POST', cache: 'no-store', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        if (r.ok) {
          done?.(sent)
          return take(await r.json(), seq)
        }
      } catch {}
      undo?.()
      pull()
    }

    // a burst (a script sending five at once) becomes one pull
    api.current.live = () => {
      clearTimeout(soon)
      soon = setTimeout(pull, 250)
    }
    api.current.pull = pull
    api.current.post = post
    const onVis = () => document.visibilityState === 'visible' && pull()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      on = false
      clearTimeout(soon)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [dlg])

  useEffect(() => {
    if (owner) return void api.current.pull?.()
    seen.current = null
    pending.current = NO_PENDING
    setHub({ items: [], read: 0, ready: false })
    setToasts({ show: [], more: 0 })
  }, [owner])

  const items = alive(hub.items, Date.now())
  const unread = unreadOf(items, hub.read).length
  return {
    on: owner && hub.ready,
    tried,
    items,
    read: hub.read,
    unread,
    shownRead,
    toasts: toasts.show,
    more: toasts.more,
    live: () => api.current.live?.(),
    // everything there is now counts as read, here and on every device
    markAllRead() {
      const h = hubRef.current
      setShownRead(h.read)
      const top = maxId(h.items)
      if (top <= h.read) return
      setHub({ ...h, read: top })
      const was = pending.current.read
      pending.current = { ...pending.current, read: Math.max(was, top) }
      api.current.post({ action: 'read', upTo: top }, { undo: () => (pending.current = { ...pending.current, read: was }) })
    },
    dismiss(id) {
      const h = hubRef.current
      setHub({ ...h, items: h.items.filter((i) => i.id !== id) })
      setToasts((t) => ({ ...t, show: t.show.filter((i) => i.id !== id) }))
      const gone = (fn) => (pending.current = { ...pending.current, gone: fn(pending.current.gone) })
      gone((g) => [...g.filter((x) => x.id !== id), { id, after: null }])
      api.current.post({ action: 'dismiss', id }, {
        done: (n) => gone((g) => g.map((x) => (x.id === id ? { id, after: n } : x))),
        undo: () => gone((g) => g.filter((x) => x.id !== id)),
      })
    },
    clear() {
      const h = hubRef.current
      const top = maxId(h.items)
      if (!top) return
      setHub({ ...h, items: [] })
      setToasts({ show: [], more: 0 })
      const was = pending.current.upTo
      pending.current = { ...pending.current, upTo: Math.max(was, top) }
      api.current.post({ action: 'clear', upTo: top }, { undo: () => (pending.current = { ...pending.current, upTo: was }) })
    },
    dropToast: (id) => setToasts((t) => ({ show: t.show.filter((i) => i.id !== id), more: t.show.length > 1 ? t.more : 0 })),
    clearToasts: () => setToasts((t) => (t.show.length ? { show: [], more: 0 } : t)),
  }
}

// ---- pieces ----------------------------------------------------------------------------------------------------------

// the bare glyph (Ambient's chip, the screensaver line): the Font Awesome icon in its color, or the sender's image;
// an image that fails to load falls back to the level's icon
function Glyph({ item, className = '' }) {
  const [bad, setBad] = useState(false)
  const { icon, color } = look(item)
  if (icon.img && !bad) return <img src={icon.img} alt="" width={16} height={16} onError={() => setBad(true)} className={`w-4 h-4 object-contain shrink-0 ${className}`} />
  const fa = icon.fa ?? (LEVEL_LOOK[item.level] ?? LEVEL_LOOK.info).icon
  return <i className={`${fa} ${TEXT[color]} ${className}`} aria-hidden="true" />
}

// the icon in a well, like a service card's (smaller): surface, hairline, the glyph in its color
function NoticeIcon({ item, className = 'w-9 h-9 text-sm' }) {
  const [bad, setBad] = useState(false)
  const { icon, color } = look(item)
  return (
    <span className={`shrink-0 rounded-xl bg-lofi-surface border border-white/5 shadow-lg flex items-center justify-center ${TEXT[color]} ${className}`}>
      {icon.img && !bad ? (
        <img src={icon.img} alt="" width={20} height={20} loading="lazy" onError={() => setBad(true)} className="w-[55%] h-[55%] object-contain" />
      ) : (
        <i className={icon.fa ?? (LEVEL_LOOK[item.level] ?? LEVEL_LOOK.info).icon} aria-hidden="true" />
      )}
    </span>
  )
}

const fullDate = (at) => new Date(at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const meta = (item, now) => [item.source, ago(item.at, now)].filter(Boolean).join(' · ')

// The header's bell, next to the scene picker (its size and well): the unread count on an accent badge. N opens it too.
// ref: the inbox hangs under it from sm (popUnder)
export function Bell({ unread, onOpen, className = '', ref }) {
  return (
    <button
      ref={ref}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={unread ? `Notifications, ${unread} new (N)` : 'Notifications (N)'}
      title="Notifications (N)"
      className={`${className} relative w-11 h-11 shrink-0 rounded-xl bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-text hover:text-lofi-primary hover:border-white/20 transition-colors`}
    >
      <i className={`fa-solid fa-bell text-sm ${unread ? 'text-lofi-primary' : ''}`} aria-hidden="true" />
      {unread > 0 && (
        <span
          key={unread}
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-lofi-primary text-lofi-base text-[10px] font-mono font-bold tabular-nums flex items-center justify-center shadow-[0_0_8px_color-mix(in_oklab,var(--color-lofi-primary)_60%,transparent)] motion-safe:animate-[pop-in_0.25s_ease-out]"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

// One pop-up: the color stripe, the icon well, title, two lines of body, source · time. Goes after TOAST_MS (an error
// stays until closed); the pointer or the keyboard resting on it holds it. A click follows its link, or opens the inbox.
function Toast({ item, now, more, onDrop, onOpen }) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (sticky(item) || held) return
    const t = setTimeout(() => onDrop(item.id), TOAST_MS)
    return () => clearTimeout(t)
  }, [held, item.id])
  const { color } = look(item)
  const text = (
    <>
      <span className="block text-sm font-medium text-white truncate">{item.title}</span>
      {item.body && <span className="block mt-0.5 text-xs text-lofi-text/80 line-clamp-2 whitespace-pre-line wrap-break-word">{item.body}</span>}
      <span className="block mt-1 text-[10px] font-mono text-lofi-muted tracking-tight">
        {meta(item, now)}
        {more > 0 && ` · +${more} more`}
        {item.url && <i className="fa-solid fa-arrow-up-right-from-square ml-1.5 text-[9px]" aria-hidden="true" />}
      </span>
    </>
  )
  const go = 'min-w-0 flex-1 text-left rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lofi-primary'
  return (
    <div
      role={item.level === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="pointer-events-auto glass-panel toast-panel relative overflow-hidden rounded-2xl pl-4 pr-2 py-3 flex items-start gap-3 shadow-xl motion-safe:animate-[panel-in_0.35s_cubic-bezier(0.2,0.8,0.2,1)]"
    >
      <span className={`absolute left-0 inset-y-0 w-1 ${STRIPE[color]}`} aria-hidden="true" />
      <NoticeIcon item={item} />
      {item.url ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => onDrop(item.id)} className={go}>
          {text}
        </a>
      ) : (
        <button onClick={() => (onDrop(item.id), onOpen())} className={go}>
          {text}
        </button>
      )}
      <button
        onClick={() => onDrop(item.id)}
        aria-label={`Close notification: ${item.title}`}
        className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
      >
        <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
      </button>
    </div>
  )
}

// The dashboard's pop-ups, top right (full width on phones), newest on top. The region stays mounted (empty), so
// screen readers announce what comes in.
export function Toasts({ hub, now, onOpen }) {
  const t = now ?? Date.now()
  return (
    <section
      aria-label="New notifications"
      aria-live="polite"
      className="fixed z-40 top-[max(1rem,env(safe-area-inset-top))] inset-x-4 sm:inset-x-auto sm:right-6 sm:w-[22rem] flex flex-col gap-2 pointer-events-none"
    >
      {hub.toasts.map((item, n) => (
        <Toast key={item.id} item={item} now={t} more={n === hub.toasts.length - 1 ? hub.more : 0} onDrop={hub.dropToast} onOpen={onOpen} />
      ))}
    </section>
  )
}

// From sm the inbox hangs under the bell, right edges aligned (like the scene picker's popover). Absolute in the top
// layer = page coordinates. The bell may be off screen (scrolled away, N or a pop-up opened it) or hidden (Ambient keeps
// the dashboard's layout): then it hangs at the top of the screen, still under the bell's column. Its height is the room
// below (--pop-max), so the list scrolls inside it.
export function popUnder(dlg, anchor) {
  if (!dlg || !anchor) return
  const r = anchor.getBoundingClientRect()
  const top = Math.max(r.bottom, 8) + 8
  dlg.style.setProperty('--pop-top', `${top + scrollY}px`)
  dlg.style.setProperty('--pop-right', `${Math.max(16, document.documentElement.clientWidth - r.right)}px`)
  dlg.style.setProperty('--pop-max', `${Math.max(240, innerHeight - top - 16)}px`)
}

// The inbox: the .wx-sheet bottom sheet on phones; from sm a popover under the bell (.scene-pop + .inbox-pop, placed
// by popUnder). The newest 50 by day; what was new when it opened keeps its accent dot until it closes (opening marks
// everything read). Each one can go (✕), or all of them (Clear all). anchor: the bell.
// Header and footer stay put and only the list scrolls; while it's open the page behind doesn't (useStillPage)
export function Inbox({ dlg, anchor, hub, now }) {
  const t = now ?? Date.now()
  const days = byDay(hub.items, t)
  const fresh = unreadOf(hub.items, hub.shownRead).length
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  const rows = useRef(null)
  // only while it's open: a closed inbox has nothing on screen to glide. resize: the list's box eases to its new
  // height with the rows (the popover / sheet follows), and the glides don't flash scrollbars
  useFlip(rows, flipSig(days.flatMap(([label, list]) => [`~day:${label}`, ...list.map((i) => i.id)])), { paused: !open, resize: true })
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    // the page opens it (showModal in openInbox), so follow the open attribute
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  useEffect(() => {
    const onResize = () => dlg.current?.open && popUnder(dlg.current, anchor.current)
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [dlg, anchor])
  return (
    <dialog
      ref={dlg}
      aria-labelledby="ntf-title"
      onClick={(e) => e.target === dlg.current && closeDialog(dlg.current)}
      onCancel={(e) => {
        e.preventDefault() // Esc: animate out first
        closeDialog(dlg.current)
      }}
      onClose={() => (delete dlg.current.dataset.closing, hub.markAllRead())}
      className="wx-sheet scene-pop inbox-pop glass-panel text-lofi-text"
    >
      <div className="p-5 sm:p-4 min-h-0 flex flex-col gap-6 sm:gap-3">
        <div className="wx-sticky shrink-0 flex items-center justify-between gap-4">
          <h2 id="ntf-title" tabIndex={-1} className="text-xl sm:text-base short:text-lg font-medium text-white flex items-center gap-3 sm:gap-2.5">
            <i className="fa-solid fa-bell text-lofi-primary text-lg sm:text-sm" aria-hidden="true" /> Notifications
            {fresh > 0 && <span className="text-[10px] font-mono font-normal text-lofi-primary border border-lofi-primary/30 bg-lofi-primary/10 rounded-full px-2 py-0.5">{fresh} new</span>}
          </h2>
          {/* the phone sheet's close; the popover goes with a click outside or Esc, like the scene picker */}
          <button
            onClick={() => closeDialog(dlg.current)}
            aria-label="Close notifications"
            className="sm:hidden w-9 h-9 shrink-0 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white hover:border-lofi-primary/40 transition-colors"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div data-scroll className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y -mx-1 px-1">
          {/* the glide scope (app/flip.js): a dismissed notice fades out, the ones below move up and the panel eases
              shorter; Clear all fades them all, one arriving slides in. "All quiet" lives in here too, so the last
              ones can leave */}
          <div ref={rows} className="relative flex flex-col gap-6 sm:gap-4">
            {days.length ? (
              days.map(([label, list]) => (
                <section key={label} aria-label={label} className="flex flex-col gap-2">
                  <h3 data-flip-key={`~day:${label}`} className="text-[10px] font-mono uppercase tracking-widest text-lofi-muted">{label}</h3>
                  <ul className="flex flex-col gap-2">
                    {list.map((i) => (
                      <InboxRow key={i.id} item={i} now={t} isNew={i.id > hub.shownRead} onDismiss={hub.dismiss} />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <div data-flip-key="~empty" className="py-10 sm:py-6 flex flex-col items-center gap-3 text-center">
                <span className="w-14 h-14 rounded-2xl bg-lofi-surface border border-white/5 shadow-lg flex items-center justify-center text-lofi-muted">
                  <i className="fa-solid fa-bell-slash text-xl" aria-hidden="true" />
                </span>
                <p className="text-sm text-white">All quiet</p>
                <p className="text-[11px] font-mono text-lofi-muted">What your machines send shows up here.</p>
              </div>
            )}
          </div>
        </div>

        {/* this device's push alerts (app/push.js), then Clear all */}
        <div className="shrink-0 pt-2 sm:pt-3 border-t border-white/5 flex items-start justify-between gap-3">
          <PushControl open={open} />
          <button
            onClick={hub.clear}
            disabled={!hub.items.length}
            className="shrink-0 h-9 px-4 rounded-full border border-white/10 font-mono text-xs text-lofi-muted hover:text-white hover:border-red-400/60 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-lofi-muted disabled:hover:border-white/10"
          >
            <i className="fa-solid fa-broom" aria-hidden="true" /> Clear all
          </button>
        </div>
      </div>
    </dialog>
  )
}

function InboxRow({ item, now, isNew, onDismiss }) {
  return (
    <li
      data-flip-key={item.id}
      className={`group min-w-0 rounded-2xl border p-3 flex items-start gap-3 transition-colors ${isNew ? 'border-lofi-primary/40 bg-lofi-primary/5' : 'border-white/5 bg-lofi-base/40'}`}
    >
      <NoticeIcon item={item} className="w-10 h-10 text-base" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 min-w-0">
          {isNew && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-lofi-primary shadow-[0_0_6px_var(--color-lofi-primary)] -translate-y-0.5" aria-label="new" />}
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 wrap-break-word text-sm font-medium text-white hover:text-lofi-primary transition-colors">
              {item.title}
              <i className="fa-solid fa-arrow-up-right-from-square ml-1.5 text-[9px] text-lofi-muted" aria-hidden="true" />
            </a>
          ) : (
            <span className="min-w-0 wrap-break-word text-sm font-medium text-white">{item.title}</span>
          )}
        </p>
        {item.body && <p className="mt-0.5 text-xs text-lofi-text/80 whitespace-pre-line wrap-break-word">{item.body}</p>}
        <p className="mt-1 text-[10px] font-mono text-lofi-muted tracking-tight" title={fullDate(item.at)}>
          {meta(item, now)}
          {item.exp && <span> · goes in {left(item.exp, now)}</span>}
        </p>
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        aria-label={`Dismiss: ${item.title}`}
        title="Dismiss"
        className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white hover:bg-white/5 transition-colors"
      >
        <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
      </button>
    </li>
  )
}

// Compact (Ambient's bar is up): a segment with the newest unread: glyph, title (phones: the glyph and the count), +N.
// Opens the inbox. note: lib/notify.js ambientNote()
export function AmbientChip({ note, onOpen }) {
  const { item, more } = note
  return (
    <button
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Notifications: ${item.title}${more ? `, and ${more} more` : ''}. Open`}
      title={item.title}
      className="flex items-center gap-2 whitespace-nowrap text-white hover:text-lofi-primary transition-colors"
    >
      <span key={item.id} className="flex motion-safe:animate-[pop-in_0.3s_ease-out]">
        <Glyph item={item} className="text-xs" />
      </span>
      <span className="max-sm:hidden max-w-44 truncate font-sans text-xs">{item.title}</span>
      {more > 0 && <span className="text-[10px] text-lofi-muted tabular-nums">+{more}</span>}
    </button>
  )
}

// Screensaver (the bar has faded): one quiet line, under the big clock ('clock') or in a small pill where the bar was
// ('pill', When the bar fades = Scene only). Decorative like the clock screen: the inbox and the bell are the
// accessible way in. A new one fades in.
export function SaverNote({ note, now, pill = false }) {
  const { item, more } = note
  const line = (
    <span key={item.id} className="flex items-center justify-center gap-2.5 min-w-0 motion-safe:animate-[fade-in_1.2s_ease-out]">
      <Glyph item={item} />
      <span className="min-w-0 truncate max-w-[60vw] sm:max-w-md">{item.title}</span>
      <span className="text-white/35">·</span>
      <span className="text-white/60">{ago(item.at, now ?? Date.now())}</span>
      {more > 0 && <span className="text-white/45 tabular-nums">+{more}</span>}
    </span>
  )
  if (!pill) return <div className="mt-6 sm:mt-8 flex justify-center font-mono text-xs sm:text-sm text-white/85 whitespace-nowrap">{line}</div>
  return (
    <div className="fixed z-20 inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex justify-center pointer-events-none select-none" aria-hidden="true">
      <div className="max-w-full rounded-full bg-lofi-base/50 border border-white/10 px-3.5 py-1.5 font-mono text-xs text-white/85 whitespace-nowrap">{line}</div>
    </div>
  )
}

// The lock screen: the newest few unread as small cards above the music (title, source, time; the body only when
// Settings › Lock screen = Full), then "+N more". 'count', and short screens (a landscape phone): one pill with the
// count. Not buttons: an upward swipe over them still unlocks. A sideways one (Swipe) throws a card off = dismissed
// (gone here, from the inbox and from every device, like ✕ there), or the pill = everything read (the stack leaves
// every lock screen; the inbox keeps them all). Changes from another device move the same way: a dismissed card fades
// and the rest glide up (useFlip), a stack read elsewhere fades out (it stays on screen a moment for that).
// notes: lib/notify.js lockNotes() | null; onDismiss(id), onSeen(): the hub's dismiss / markAllRead
const LEAVE_STACK_MS = 260
export function LockNotices({ notes, now, onDismiss, onSeen }) {
  const t = now ?? Date.now()
  // the last stack shown, kept while it fades out (read everywhere: notes became null)
  const [last, setLast] = useState(notes)
  const leaving = !notes && Boolean(last)
  useEffect(() => {
    if (notes) return void setLast(notes)
    if (!last) return
    const id = setTimeout(() => setLast(null), reduced() ? 0 : LEAVE_STACK_MS)
    return () => clearTimeout(id)
  }, [notes])
  const n = notes ?? last
  const rows = useRef(null)
  useFlip(rows, flipSig([...(n?.show ?? []).map((i) => i.id), n?.more > 0 ? '~more' : '']))
  if (!n) return null
  const pill = (count, more) => (
    <Swipe onGone={onSeen} label="Swipe sideways to mark them all read" className="glass-panel h-9 px-3.5 rounded-full flex items-center gap-2 font-mono text-xs text-white">
      <i className="fa-solid fa-bell text-lofi-primary text-[11px]" aria-hidden="true" />
      {more ? `+${count} more` : `${count} new notification${count === 1 ? '' : 's'}`}
    </Swipe>
  )
  return (
    <div
      role="group"
      aria-label="Notifications"
      className={`flex flex-col items-center gap-2 w-[min(22rem,calc(100vw-2rem))] transition-[opacity,translate,scale] duration-[260ms] ease-in ${leaving ? 'opacity-0 translate-y-2 scale-[0.98]' : ''}`}
    >
      {n.show.length > 0 && (
        <>
          <div ref={rows} className="short:hidden relative w-full flex flex-col items-center gap-2">
            <ul className="w-full flex flex-col gap-2">
              {n.show.map((i) => (
                <Swipe
                  key={i.id}
                  as="li"
                  flipKey={i.id}
                  onGone={() => onDismiss(i.id)}
                  label="Swipe sideways to dismiss"
                  className="glass-panel rounded-2xl px-3 py-2.5 flex items-start gap-3 text-left motion-safe:animate-[panel-in_0.35s_cubic-bezier(0.2,0.8,0.2,1)]"
                >
                  <NoticeIcon item={i} className="w-8 h-8 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2 min-w-0">
                      <span className="min-w-0 truncate text-sm text-white">{i.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] font-mono text-lofi-muted">{ago(i.at, t)}</span>
                    </p>
                    {i.source && <p className="text-[10px] font-mono text-lofi-muted truncate">{i.source}</p>}
                    {n.details && i.body && <p className="mt-0.5 text-xs text-lofi-text/80 line-clamp-2 whitespace-pre-line wrap-break-word">{i.body}</p>}
                  </div>
                </Swipe>
              ))}
            </ul>
            {n.more > 0 && <div data-flip-key="~more">{pill(n.more, true)}</div>}
          </div>
          <div className="hidden short:block">{pill(n.total)}</div>
        </>
      )}
      {!n.show.length && pill(n.total)}
    </div>
  )
}

const reduced = () => motionOff() || matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A card (or the pill) a finger or the mouse can throw sideways. Which way the press goes is settled in its first 8 px:
// sideways is ours (the lock's unlock never sees it), up stays the unlock swipe, a tap does nothing. Past a third of
// its width, or flicked, it flies off that way and onGone() runs; less, it springs back. Its flip key comes off before
// onGone, so the list's glide (useFlip) leaves no fading copy of a card that has already flown away; the rest glide up.
const SLOP = 8
const FLY_MS = 200
function Swipe({ onGone, label, className, children, as: Tag = 'div', flipKey }) {
  const el = useRef(null)
  const g = useRef(null) // the press: { id, x, y, last: [x, t], v, mine }
  const [dx, setDx] = useState(0)
  const [mode, setMode] = useState('rest') // rest | drag | out
  const down = (e) => {
    if (mode === 'out' || (e.pointerType === 'mouse' && e.button !== 0)) return
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, last: [e.clientX, e.timeStamp], v: 0, mine: false }
  }
  const move = (e) => {
    const p = g.current
    if (!p || p.id !== e.pointerId) return
    const x = e.clientX - p.x
    const y = e.clientY - p.y
    if (!p.mine) {
      if (Math.abs(x) < SLOP || Math.abs(x) <= Math.abs(y)) {
        if (Math.abs(y) >= SLOP) g.current = null // up / down first: the lock screen's
        return
      }
      p.mine = true
      el.current?.setPointerCapture?.(e.pointerId)
      setMode('drag')
    }
    e.stopPropagation()
    const dt = e.timeStamp - p.last[1]
    if (dt > 0) p.v = (e.clientX - p.last[0]) / dt // px / ms
    p.last = [e.clientX, e.timeStamp]
    setDx(x)
  }
  const up = (e) => {
    const p = g.current
    if (!p || p.id !== e.pointerId) return
    g.current = null
    if (!p.mine) return
    e.stopPropagation()
    const x = e.clientX - p.x
    const w = el.current?.offsetWidth || 300
    const flick = Math.abs(p.v) > 0.5 && e.timeStamp - p.last[1] < 120 && Math.abs(x) > 30
    if (Math.abs(x) < w / 3 && !flick) return setMode('rest'), setDx(0)
    const dir = Math.sign(flick ? p.v : x) || 1
    const gone = () => (el.current?.removeAttribute('data-flip-key'), onGone())
    if (reduced()) return gone()
    setMode('out')
    setDx(dir * (w + 48))
    setTimeout(gone, FLY_MS)
  }
  const cancel = () => g.current?.mine && ((g.current = null), setMode('rest'), setDx(0))
  const w = el.current?.offsetWidth || 300
  return (
    <Tag
      ref={el}
      data-flip-key={flipKey}
      aria-description={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      className={`${className} ${mode === 'drag' ? 'cursor-grabbing' : ''}`}
      style={{
        transform: dx ? `translateX(${dx}px)` : undefined,
        opacity: mode === 'out' ? 0 : dx ? 1 - Math.min(1, Math.abs(dx) / w) * 0.7 : undefined,
        transition: mode === 'drag' ? 'none' : `transform ${FLY_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${FLY_MS}ms ease-out`,
      }}
    >
      {children}
    </Tag>
  )
}
