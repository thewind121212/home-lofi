'use client'

// News: the digest an agent on another machine writes twice a day (Vietnam and tech, summarised in Vietnamese), read
// here as one magazine page in a centered modal. An icon next to the header's bell (a dot: an edition not opened yet);
// a tap opens it: the edition and its time, the day in brief, then each section, its most important stories as lead
// cards and the rest as rows. Rules in lib/news.js; the route is app/api/private/settings/news (owner-only: guests get
// 404 / 403 and never see the icon; NEWS_URL not set: no icon either).
// - A story's title opens it (a new tab) and marks it read: read ones are dimmed, on every device (the server keeps
//   them). ✓ marks one read / unread by hand; "Mark all read" a whole section.
// - Older editions from the agent's archive in the select at the top (read state carries over: same stories, same ids).
// - 📌 pins a story's link (app/pins.js).
// - Asked when the owner's known, when the page shows again (MIN_GAP apart), every REFRESH while it's on screen (a new
//   edition's dot), when the modal opens, and when another device reads something ('news' on the live stream).
import './news.css'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, MessageSquare, Newspaper, Pin, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { closeDialog, useStillPage } from './settings'
import { CATEGORIES, ago, editionLine } from '../lib/news'
import { privateAnswer } from '../lib/private-poll'

const URL_ = '/api/private/settings/news'
const MIN_GAP = 30_000
const REFRESH = 10 * 60_000
const TZ = 'Asia/Ho_Chi_Minh' // (the agent's editions are this home's mornings and evenings)

// ---- state: the server's, the page only draws it ----

// owner: settings sync answered as the owner; clientId(): this tab's live-stream id. -> { on, pending, data, error,
// fresh, view, show, isRead, read, unread, seen, live, pull }
export function useNews(owner, clientId) {
  const [data, setData] = useState(null) // the route's GET answer
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState(undefined) // an edition picked in the select, until it's on screen
  // read / unread here whose write hasn't been answered yet: drawn over any pull landing meanwhile
  const [ops, setOps] = useState([]) // [{ key, on, ids }]
  // the newest edition opened here: the dot stays gone even if a pull already on its way lands without it
  const [seenHere, setSeenHere] = useState(0)
  const api = useRef({})
  const view = useRef(null) // the archive name shown (null: the latest)
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const dataRef = useRef(null)
  dataRef.current = data
  const seq = useRef({ key: 0, sent: 0, shown: 0 })

  useEffect(() => {
    let on = true, busy = false, again = false, last = 0
    // (the agent's machine down, a restart: what was there stays, and so does the edition it was)
    function fail() {
      setError(true)
      view.current = dataRef.current?.edition ?? null
      setPicked(undefined)
    }
    async function pull(force = false) {
      if (!on || !ownerRef.current || (!force && Date.now() - last < MIN_GAP)) return
      if (busy) return void (again = true)
      busy = true
      again = false
      last = Date.now()
      const n = ++seq.current.sent
      const name = view.current
      try {
        const r = await fetch(name ? `${URL_}?edition=${encodeURIComponent(name)}` : URL_, { cache: 'no-store', redirect: 'manual' })
        const j = await r.json().catch(() => null)
        if (!on || name !== view.current) return
        // (read before a write of this tab's: asked again, so what was asked for still comes)
        if (n < seq.current.shown) return void (again = true)
        seq.current.shown = n
        if (privateAnswer(r.status, r.type) === 'locked' || (r.ok && j?.on === false)) {
          setOff(true)
          setData(null)
          setError(false)
        } else if (r.ok && j?.digest) {
          setOff(false)
          setData(j)
          setError(false)
          setPicked(undefined)
        } else if (r.status === 404 && name) {
          // (that edition has left the archive: back to the latest)
          view.current = null
          setPicked(undefined)
          again = true
        } else fail()
      } catch {
        if (on && name === view.current) fail()
      } finally {
        busy = false
        if (on) setTried(true)
        if (on && again) pull(true)
      }
    }
    api.current.pull = pull
    const wake = () => document.visibilityState === 'visible' && pull()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    const t = setInterval(() => document.visibilityState === 'visible' && pull(true), REFRESH)
    return () => {
      on = false
      clearInterval(t)
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

  async function write(body) {
    const headers = { 'content-type': 'application/json' }
    const id = clientId?.()
    if (id) headers['x-home-client'] = id
    // (a pull already on its way read the state before this write: its answer is dropped, not drawn over it)
    seq.current.shown = ++seq.current.sent
    const r = await fetch(URL_, { method: 'POST', cache: 'no-store', redirect: 'manual', headers, body: JSON.stringify(body) })
    if (!r.ok) throw new Error('failed')
  }
  function mark(on, ids) {
    if (!ids.length) return
    const key = ++seq.current.key
    setOps((o) => [...o, { key, on, ids }])
    write({ action: on ? 'read' : 'unread', ids })
      .then(() => setData((d) => d && { ...d, read: on ? [...new Set([...d.read, ...ids])] : d.read.filter((x) => !ids.includes(x)) }))
      .catch(() => api.current.pull?.(true))
      .finally(() => setOps((o) => o.filter((x) => x.key !== key)))
  }

  const on = Boolean(owner && data && !off)
  const readSet = new Set(data?.read ?? [])
  for (const o of ops) for (const id of o.ids) o.on ? readSet.add(id) : readSet.delete(id)
  return {
    on,
    pending: Boolean(owner && !data && !off && !tried),
    data,
    error,
    loading: picked !== undefined,
    // an edition newer than the newest one opened
    fresh: on && data.latestAt > Math.max(data.seen ?? 0, seenHere),
    view: picked !== undefined ? picked : (data?.edition ?? null),
    // another edition (null: the latest)
    show(name) {
      view.current = name
      setPicked(name)
      api.current.pull?.(true)
    },
    // the modal closed: next time it opens on the latest
    reset() {
      view.current = null
      setPicked(undefined)
    },
    isRead: (id) => readSet.has(id),
    read: (ids) => mark(true, ids.filter((id) => !readSet.has(id))),
    unread: (ids) => mark(false, ids.filter((id) => readSet.has(id))),
    // the latest edition opened: the dot goes (here at once, everywhere once the server has it)
    seen() {
      if (!on || data.latestAt <= Math.max(data.seen ?? 0, seenHere)) return
      const at = data.latestAt
      setSeenHere(at)
      write({ action: 'seen', at }).catch(() => {})
    },
    // 'news': another tab or device read something; 'hello': the stream (re)connected
    live: (kind) => (kind === 'news' ? api.current.pull?.(true) : kind === 'hello' && api.current.pull?.()),
    pull: (force) => api.current.pull?.(force),
  }
}

// ---- the header icon ----

export function NewsIcon({ nw, wait = false, force = false, onOpen, className = '' }) {
  if (!nw.on) return wait ? <HeadIconSkeleton force={force} className={className} /> : null
  return <HeadIcon className={className} label={nw.fresh ? 'News: a new edition' : 'News'} icon={Newspaper} dot={nw.fresh} onOpen={() => onOpen()} />
}

// ---- the modal ----

// a colour per category (the tag's tint)
const HUE = { 'thoi-su': 18, 'kinh-te': 140, 'cong-nghe': 205, ai: 265, 'khoa-hoc': 180, 'the-gioi': 225, 'xa-hoi': 35, 'the-thao': 100, 'giai-tri': 320, 'lap-trinh': 190, 'bao-mat': 0, khac: 240 }
const domainOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// The magazine page in a centered modal (opened from the header icon). Opening it asks for a fresh digest, and marks
// the latest edition seen once it's on screen
export function NewsModal({ nw, pn, dlg }) {
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  const ref = useRef(nw)
  ref.current = nw
  useEffect(() => void (open && ref.current.pull(true)), [open])
  // (the latest on screen, the modal open: seen)
  const latestShown = open && nw.on && nw.view == null && nw.data.edition == null
  useEffect(() => void (latestShown && ref.current.seen()), [latestShown, nw.data?.latestAt])
  const close = () => closeDialog(dlg.current)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="nw-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => (delete dlg.current.dataset.closing, nw.reset())}
      className="wx-sheet nw-modal glass-panel text-lofi-text"
    >
      {nw.on && <NewsBody nw={nw} pn={pn} onClose={close} />}
    </dialog>
  )
}

function NewsBody({ nw, pn, onClose }) {
  const { digest, editions } = nw.data
  const now = Date.now()
  const scroller = useRef(null)
  const [brief, setBrief] = useState(false) // (phones: the brief folded to a few lines until tapped)
  // another edition: back to the top
  useEffect(() => scroller.current?.scrollTo({ top: 0 }), [digest.at])
  const pinned = new Set(pn?.on ? pn.data.pins.map((p) => p.url) : [])
  const total = digest.sections.reduce((n, s) => n + s.items.length, 0)
  const unread = digest.sections.reduce((n, s) => n + s.items.filter((i) => !nw.isRead(i.id)).length, 0)
  return (
    <section aria-labelledby="nw-title" className="nw">
      <header className="nw-head">
        <span className="nw-mark" aria-hidden="true"><Newspaper size={17} strokeWidth={1.9} /></span>
        <div className="nw-title">
          <h2 id="nw-title">News</h2>
          <span className="nw-sub">{editionLine(digest, now, TZ)}{total ? ` · ${unread ? `${unread} unread` : 'all read'}` : ''}</span>
        </div>
        {editions.length > 0 && (
          <label className="nw-pick">
            <span className="sr-only">Edition</span>
            <select value={nw.view ?? ''} onChange={(e) => nw.show(e.target.value || null)}>
              <option value="">Latest</option>
              {editions.map((e) => <option key={e.name} value={e.name}>{e.label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        )}
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>

      <div ref={scroller} className={`nw-scroll${nw.loading ? ' is-loading' : ''}`} aria-busy={nw.loading} data-scroll>
        {(nw.error || nw.data.stale) && <p className="nw-note" role="status">The news machine isn't answering: this is the last edition it sent.</p>}
        {digest.overview && (
          <div className={`nw-brief${brief ? ' is-open' : ''}`}>
            <span className="nw-kicker">In brief</span>
            <p>{digest.overview}</p>
            <button type="button" className="nw-brief-more" aria-expanded={brief} onClick={() => setBrief((b) => !b)}>{brief ? 'Less' : 'More'}</button>
          </div>
        )}
        {digest.sections.map((s) => (
          <Section key={s.key} section={s} nw={nw} pn={pn} pinned={pinned} now={now} />
        ))}
        {!total && <p className="nw-empty">Nothing in this edition.</p>}
      </div>
    </section>
  )
}

const LEADS = 2 // a section's lead cards at most (its importance-5 stories)

function Section({ section, nw, pn, pinned, now }) {
  const ids = section.items.map((i) => i.id)
  const left = ids.filter((id) => !nw.isRead(id))
  const leads = section.items.filter((i) => i.importance >= 5).slice(0, LEADS)
  const rest = section.items.filter((i) => !leads.includes(i))
  const id = `nw-s-${section.key}`
  return (
    <section className="nw-sec" aria-labelledby={id}>
      <div className="nw-sec-head">
        <h3 id={id}>{section.title}</h3>
        <span className="nw-rule" aria-hidden="true" />
        <span className="nw-count">{left.length ? `${left.length} unread` : 'all read'}</span>
        {left.length > 0 && <button type="button" className="nw-allread" onClick={() => nw.read(left)}>Mark all read</button>}
      </div>
      {leads.length > 0 && (
        <div className="nw-leads">
          {leads.map((it) => <Story key={it.id} it={it} lead nw={nw} pn={pn} pinned={pinned} now={now} />)}
        </div>
      )}
      <ul className="nw-list">
        {rest.map((it) => <li key={it.id}><Story it={it} nw={nw} pn={pn} pinned={pinned} now={now} /></li>)}
      </ul>
    </section>
  )
}

function Story({ it, lead = false, nw, pn, pinned, now }) {
  const [more, setMore] = useState(false)
  const [pinning, setPinning] = useState(false)
  const read = nw.isRead(it.id)
  const when = ago(it.publishedAt, now)
  const isPinned = pinned.has(it.url)
  const open = () => nw.read([it.id])
  return (
    <article className={`nw-story${lead ? ' is-lead' : ''}${read ? ' is-read' : ''}`} style={{ '--nw-h': HUE[it.category] ?? 240 }}>
      <div className="nw-tags">
        <span className="nw-cat">{CATEGORIES[it.category]}</span>
        <span className="nw-imp" aria-label={`importance ${it.importance} of 5`} title={`importance ${it.importance} of 5`}>
          {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= it.importance ? 'on' : ''} />)}
        </span>
      </div>
      <h4 className="nw-h">
        <a href={it.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={open} onAuxClick={(e) => e.button === 1 && open()}>{it.title}</a>
      </h4>
      {it.summary && (
        <p className={`nw-sum${more || lead ? ' is-open' : ''}`} onClick={() => !lead && setMore((m) => !m)}>{it.summary}</p>
      )}
      {more && it.original && <p className="nw-orig">{it.original}</p>}
      {lead && it.original && <p className="nw-orig">{it.original}</p>}
      <div className="nw-meta">
        <span className="nw-src" title={domainOf(it.url)}>{it.source ?? domainOf(it.url)}</span>
        {when && <span>{when}</span>}
        {it.points != null && <span title="points">▲ {it.points}</span>}
        {it.comments != null && (it.commentsUrl ? (
          <a className="nw-com" href={it.commentsUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={open} onAuxClick={(e) => e.button === 1 && open()} aria-label={`${it.comments} comments`}>
            <MessageSquare size={11} aria-hidden="true" />{it.comments}
          </a>
        ) : (
          <span><MessageSquare size={11} aria-hidden="true" />{it.comments}</span>
        ))}
        <span className="nw-acts">
          {!lead && (it.summary || it.original) && (
            <button type="button" className="nw-act" aria-expanded={more} aria-label={more ? 'Show less' : 'Show more'} title={more ? 'Less' : 'More'} onClick={() => setMore((m) => !m)}>
              <ChevronDown size={14} className={more ? 'rot' : ''} aria-hidden="true" />
            </button>
          )}
          {pn?.on && (
            <button
              type="button"
              className={`nw-act${isPinned ? ' is-on' : ''}`}
              aria-label={isPinned ? 'Pinned' : `Pin: ${it.title}`}
              title={isPinned ? 'Pinned' : 'Pin it'}
              disabled={isPinned || pinning}
              onClick={async () => (setPinning(true), await pn.add(it.url), setPinning(false))}
            >
              <Pin size={13} aria-hidden="true" />
            </button>
          )}
          <button type="button" className={`nw-act${read ? ' is-on' : ''}`} aria-pressed={read} aria-label={`Read: ${it.title}`} title={read ? 'Read: mark unread' : 'Mark read'} onClick={() => (read ? nw.unread([it.id]) : nw.read([it.id]))}>
            <Check size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </span>
      </div>
    </article>
  )
}
