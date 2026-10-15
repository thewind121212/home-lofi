'use client'

// Reading: the books the owner is partway through in Kavita (several at once). An icon next to the header's bell, with
// Reminders' and Pins' (a ring round it: how far the latest one is); a tap opens them in a sheet: cover, title, how far, when last read, and Continue (Kavita's reader at that book's continue point,
// in a new tab). Rules in lib/reading.js; the route is app/api/private/settings/reading (owner-only: guests get
// 404 / 403 and never see the icon), covers come through /reading/cover (Kavita's key never reaches the browser).
// - Nothing in progress, or Kavita not set up: no icon at all. Kavita unreachable: the last list stays (the sheet says
//   so quietly); never loaded, no icon.
// - Asked when the owner's known, then when the page shows again or the window regains focus (MIN_GAP apart: the
//   server keeps Kavita's answer 2 minutes anyway) and when the sheet opens. Never on a timer.
// - Its skeleton only where the icon showed last time (lib/skeleton.js `reading`): most visits may have no icon.
import './reading.css'
import { useEffect, useRef, useState } from 'react'
import { BookOpen, ExternalLink, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { rememberShape } from './skeleton'
import { closeDialog, useStillPage } from './settings'
import { iconLabel, readAgo } from '../lib/reading'
import { privateAnswer } from '../lib/private-poll'

const URL_ = '/api/private/settings/reading'
const MIN_GAP = 30_000

// ---- state: the server's, the page only draws it ----

// owner: settings sync answered as the owner (the page's `owner`). -> { on, pending, data, error, books, pull }
export function useReading(owner) {
  const [data, setData] = useState(null) // { books, kavita, at }
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false) // a load was tried (so a failed one ends the skeleton)
  const [error, setError] = useState(false) // the last ask failed (Kavita, or the network)
  const api = useRef({})
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  useEffect(() => {
    let on = true, busy = false, last = 0
    async function pull(force = false) {
      if (!on || !ownerRef.current || busy || (!force && Date.now() - last < MIN_GAP)) return
      busy = true
      last = Date.now()
      try {
        const r = await fetch(URL_, { cache: 'no-store', redirect: 'manual' })
        const j = await r.json().catch(() => null)
        if (!on) return
        // not the owner (or not set up), or Kavita isn't: no icon
        if (privateAnswer(r.status, r.type) === 'locked' || (r.ok && j?.on === false)) {
          setOff(true)
          setData(null)
          setError(false)
          rememberShape({ reading: false })
        } else if (r.ok && Array.isArray(j?.books)) {
          setOff(false)
          setData(j)
          setError(false)
          rememberShape({ reading: j.books.length > 0 })
        } else setError(true) // (Kavita unreachable, a restart: what was there stays)
      } catch {
        if (on) setError(true)
      } finally {
        busy = false
        if (on) setTried(true)
      }
    }
    api.current.pull = pull
    const wake = () => document.visibilityState === 'visible' && pull()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      on = false
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [])
  useEffect(() => {
    if (owner) {
      setOff(false)
      return void api.current.pull?.(true)
    }
    setData(null)
  }, [owner])

  const on = Boolean(owner && data && !off)
  return {
    on,
    pending: Boolean(owner && !data && !off && !tried), // the owner's first load is on its way: the skeleton
    data,
    error,
    books: on ? data.books : [],
    pull: () => api.current.pull?.(),
  }
}

// ---- the header icon ----

// The header's icon next to the bell: a ring around it for how far the latest book is (no badge: a count of books
// never wants doing; its label says how many); a tap opens them all. Nothing in
// progress: nothing. wait: it may be on its way (owner not known yet, or the first load), so its skeleton keeps the
// place (where it showed last time); force: it surely is the owner's
export function ReadingIcon({ rd, wait = false, force = false, onOpen, className = '' }) {
  const label = iconLabel(rd.books)
  if (!label) return wait && !rd.on ? <HeadIconSkeleton force={force} className={`sk-reading ${className}`} /> : null
  return <HeadIcon className={className} label={label} icon={BookOpen} ring={rd.books[0].percent} onOpen={() => onOpen()} />
}

// ---- the sheet ----

// a soft colour per book, for a missing cover
const hue = (s) => [...(s || '?')].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 11)

// the cover through this server; none or broken: a tile in the book's colour with an open book
function Cover({ book }) {
  const [bad, setBad] = useState(false)
  if (!book.cover || bad) {
    return (
      <span className="rd-cover rd-plain" style={{ '--rd-h': hue(book.name) }} aria-hidden="true">
        <BookOpen size={18} strokeWidth={1.8} />
      </span>
    )
  }
  return (
    <span className="rd-cover" aria-hidden="true">
      <img src={book.cover} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />
    </span>
  )
}

function Book({ book, now }) {
  const when = readAgo(book.readAt, now)
  return (
    <li className="rd-row">
      <Cover book={book} />
      <div className="rd-text">
        <span className="rd-name" title={book.name}>{book.name}</span>
        <span className="rd-prog">
          <span className="rd-track" role="progressbar" aria-label={`${book.name}: how far`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={book.percent}>
            <span style={{ width: `${book.percent}%` }} />
          </span>
          <span className="rd-pct">{book.percent}%</span>
        </span>
        <span className="rd-when">{when && `last read ${when}`}</span>
      </div>
      {book.href && (
        <a className="rd-go" href={book.href} target="_blank" rel="noopener noreferrer" aria-label={`Continue ${book.name} in Kavita (new tab)`}>
          Continue
        </a>
      )}
    </li>
  )
}

// All of them in a sheet (opened from the header icon). Its open state is followed here: opening it asks for a fresh list
export function ReadingSheet({ rd, dlg }) {
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  const pull = useRef(rd.pull)
  pull.current = rd.pull
  useEffect(() => void (open && pull.current()), [open])
  const close = () => closeDialog(dlg.current)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="rd-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => delete dlg.current.dataset.closing}
      className="wx-sheet sm:max-w-xl glass-panel text-lofi-text overscroll-contain"
    >
      {rd.on && <ReadingBody rd={rd} onClose={close} />}
    </dialog>
  )
}

function ReadingBody({ rd, onClose }) {
  const { books } = rd
  const kavita = rd.data.kavita
  const n = books.length
  const now = Date.now()
  return (
    <section aria-labelledby="rd-title" className="p-5 sm:p-6 rd">
      <div className="rd-head">
        <span className="rd-mark" aria-hidden="true"><BookOpen size={17} strokeWidth={1.9} /></span>
        <div className="rd-title">
          <h2 id="rd-title">Reading</h2>
          <span className="rd-sub">{n ? `${n} in progress` : 'nothing in progress'}</span>
        </div>
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      {n ? (
        <ul className="rd-list">
          {books.map((b) => <Book key={b.id} book={b} now={now} />)}
        </ul>
      ) : (
        <p className="rd-empty">Nothing partway through. Books you start in Kavita show up here.</p>
      )}
      {(rd.error || kavita) && (
        <div className="rd-foot">
          {rd.error && <span className="rd-note" role="status">Kavita unreachable{n ? ': the last list' : ''}</span>}
          {kavita && (
            <a className="rd-open" href={kavita} target="_blank" rel="noopener noreferrer">
              Open Kavita <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </section>
  )
}
