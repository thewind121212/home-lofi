'use client'

// News: the digest an agent on another machine writes twice a day (Vietnam and tech, summarised in Vietnamese), read
// here as a small magazine: a bottom sheet on phones, a panel on bigger screens. An icon next to the header's bell (a
// dot: an edition not opened yet); a tap opens it on pages: Top (the day in brief, the stories that matter most, a card
// per section), then one per section (its most important stories as lead cards, the rest as rows), swiped or picked
// from the nav. Rules in lib/news.js; the route is app/api/private/settings/news (owner-only: guests get
// 404 / 403 and never see the icon; NEWS_URL not set: no icon either).
// - A story's title opens it (a new tab) and marks it read: read ones are dimmed, on every device (the server keeps
//   them). ✓ marks one read / unread by hand; "Mark all read" a whole section.
// - Older editions from the agent's archive in the select at the top (read state carries over: same stories, same ids).
// - 📌 pins a story's link (app/pins.js).
// - 🔄 Refresh: the agent makes an edition now (a run, a few minutes). Asked again every POLL while it's going (on every
//   device: they hear 'news'), and the new edition shows by itself. The agent's limits (a cooldown, so many a day) are
//   its own: the page says how long to wait.
// - Asked when the owner's known, when the page shows again (MIN_GAP apart), every REFRESH while it's on screen (a new
//   edition's dot), when the modal opens, and when another device reads something ('news' on the live stream).
import './news.css'
import { Component, useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, Clock, Cpu, Flag, Globe, Hash, MessageSquare, Newspaper, Pin, RefreshCw, Sparkles, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { closeDialog, motionOff, useStillPage } from './settings'
import { CATEGORIES, EDITIONS, ago, editionLine, editionName, runGoing, waitFor } from '../lib/news'
import { privateAnswer } from '../lib/private-poll'
import { reportError } from './report-error'

const URL_ = '/api/private/settings/news'
const MIN_GAP = 30_000
const REFRESH = 10 * 60_000
const POLL = 8000 // a run going: asked this often
const FAILED_FOR = 30 * 60_000 // a run that failed: said for this long
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
  // Refresh: asked (the answer not in yet); its trouble ('down': the agent didn't answer, 'soon': its limits); the run
  // this tab saw going and then done (its new edition, until the modal closes)
  const [asking, setAsking] = useState(false)
  const [trouble, setTrouble] = useState(null)
  const [ready, setReady] = useState(null)
  const runRef = useRef(null)
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
        if (r.status === 404 && name && j?.on) {
          // (that edition has left the archive: back to the latest. Before the locked check: a guest's 404 has no on)
          view.current = null
          setPicked(undefined)
          again = true
        } else if (privateAnswer(r.status, r.type) === 'locked' || (r.ok && j?.on === false)) {
          setOff(true)
          setData(null)
          setError(false)
        } else if (r.ok && j?.digest) {
          setOff(false)
          setData(j)
          setError(false)
          setPicked(undefined)
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
  // a run going: asked again every POLL, until it's done (or stuck)
  const run = data?.run ?? null
  const going = runGoing(run, Date.now())
  useEffect(() => {
    if (!going) return
    const t = setInterval(() => document.visibilityState === 'visible' && api.current.pull?.(true), POLL)
    return () => clearInterval(t)
  }, [going])
  // (one seen going, then done: its edition is the latest now)
  useEffect(() => {
    const was = runRef.current
    runRef.current = run
    if (was?.state === 'running' && run?.state === 'done' && (!was.job || was.job === run.job)) setReady(run)
  }, [run?.state, run?.job])

  async function send(body) {
    const headers = { 'content-type': 'application/json' }
    const id = clientId?.()
    if (id) headers['x-home-client'] = id
    // (a pull already on its way read the state before this write: its answer is dropped, not drawn over it)
    seq.current.shown = ++seq.current.sent
    return fetch(URL_, { method: 'POST', cache: 'no-store', redirect: 'manual', headers, body: JSON.stringify(body) })
  }
  async function write(body) {
    if (!(await send(body)).ok) throw new Error('failed')
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
      setTrouble(null)
      setReady(null)
    },
    // Refresh: { can (the agent tells its runs), busy (asked, or a run going), run, nextAt, trouble, ready }
    refresh: { can: Boolean(on && run), busy: asking || going, run, nextAt: data?.nextAt ?? 0, trouble, ready },
    // a fresh edition now (the agent's limits: said, not asked)
    async start() {
      if (!on || asking || going) return
      setReady(null)
      if (data.nextAt > Date.now()) return void setTrouble('soon')
      setTrouble(null)
      setAsking(true)
      try {
        const r = await send({ action: 'refresh' })
        const j = await r.json().catch(() => null)
        if (r.status === 429 && j?.nextAt) {
          setData((d) => d && { ...d, nextAt: j.nextAt })
          setTrouble('soon')
        } else if (!r.ok) setTrouble('down')
        else if (j?.started === false) setTrouble(null) // (one was going already: it's drawn as going)
      } catch {
        setTrouble('down')
      } finally {
        setAsking(false)
        api.current.pull?.(true)
      }
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

// The magazine in a dialog (opened from the header icon): a bottom sheet on phones (drag its top down to close), a
// centered panel from sm, wider from lg with the sections down the side. Opening it asks for a fresh digest, and marks
// the latest edition seen once it's on screen
export function NewsModal({ nw, pn, dlg }) {
  const [open, setOpen] = useState(false)
  // the page shown: 'top' or a section's key (kept across editions and openings: a sheet dragged shut by mistake opens
  // where it was)
  const [tab, setTab] = useState('top')
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
      {nw.on && (
        <NewsCatch key={nw.data.edition ?? 'latest'} nw={nw} onClose={close}>
          <NewsBody nw={nw} pn={pn} dlg={dlg} tab={tab} setTab={setTab} onClose={close} />
        </NewsCatch>
      )}
    </dialog>
  )
}

// Phones: the sheet follows a finger dragging its top (grip): let go past DRAG_CLOSE (or a flick) and it slides away,
// short of it and it springs back. Buttons in there stay buttons
const DRAG_CLOSE = 110
function useDragClose(dlg, grip) {
  useEffect(() => {
    const g = grip.current
    if (!g) return
    let y0 = null, dy = 0, t0 = 0, id = null
    const phone = () => matchMedia('(max-width: 639px)').matches
    const down = (e) => {
      const d = dlg.current
      if (!d || !phone() || e.button > 0 || e.target.closest('button, a, [role="menu"]')) return
      y0 = e.clientY
      dy = 0
      t0 = performance.now()
      id = e.pointerId
      g.setPointerCapture?.(id)
      d.style.transition = 'none'
    }
    const move = (e) => {
      if (y0 == null || e.pointerId !== id) return
      dy = Math.max(0, e.clientY - y0)
      dlg.current.style.transform = dy ? `translateY(${dy}px)` : ''
    }
    const up = (e) => {
      if (y0 == null || e.pointerId !== id) return
      y0 = null
      const d = dlg.current
      const flick = dy > 40 && dy / Math.max(1, performance.now() - t0) > 0.6
      if (dy > DRAG_CLOSE || flick) {
        d.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 1, 1)'
        d.style.transform = 'translateY(100%)'
        setTimeout(() => {
          d.close()
          d.style.transform = d.style.transition = ''
        }, 200)
      } else {
        d.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)'
        d.style.transform = ''
        setTimeout(() => void (d.style.transition = ''), 260)
      }
    }
    g.addEventListener('pointerdown', down)
    g.addEventListener('pointermove', move)
    g.addEventListener('pointerup', up)
    g.addEventListener('pointercancel', up)
    return () => {
      g.removeEventListener('pointerdown', down)
      g.removeEventListener('pointermove', move)
      g.removeEventListener('pointerup', up)
      g.removeEventListener('pointercancel', up)
    }
  }, [dlg, grip])
}

// An edition that can't be drawn (something in it the page didn't expect): told to the server's log, and the modal says
// so with a way back to the latest, instead of the whole page going down. (A fresh one for each edition: its key)
class NewsCatch extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    reportError(error, `news:${this.props.nw.data?.edition ?? 'latest'}`, info?.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    const { nw, onClose } = this.props
    return (
      <section className="nw">
        <header className="nw-head">
          <span className="nw-mark" aria-hidden="true"><Newspaper size={17} strokeWidth={1.9} /></span>
          <div className="nw-title"><h2 id="nw-title">News</h2></div>
          <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="nw-scroll">
          <div className="nw-brief" role="alert">
            <span className="nw-kicker">Couldn't show this edition</span>
            <p>Something in it tripped the page. It's been noted.</p>
            {nw.data?.edition != null && <button type="button" className="nw-brief-more nw-back" onClick={() => nw.show(null)}>Back to the latest</button>}
          </div>
        </div>
      </section>
    )
  }
}

// a section's icon in the nav (by the agent's keys; anything else a #)
const SEC_ICON = { top: Sparkles, vietnam: Flag, 'viet-nam': Flag, tech: Cpu, 'cong-nghe': Cpu, world: Globe, 'the-gioi': Globe }
const smooth = () => (motionOff() ? 'auto' : 'smooth')

// The edition as pages, side by side: Top (the day in brief, the stories that matter most, each section's card), then
// one per section. The nav (chips over the pages below lg, a column beside them from lg) and a swipe both move between
// them; each page scrolls on its own, so a section is a short read, not a long scroll past the others.
// Keys (from lg, focus in the modal): ← → the pages, j / k the stories, m read / unread
function NewsBody({ nw, pn, dlg, tab, setTab, onClose }) {
  const { digest, editions } = nw.data
  const now = Date.now()
  const head = useRef(null)
  const pager = useRef(null)
  const nav = useRef(null)
  const aim = useRef({ i: null, t: 0 }) // a page being scrolled to (its scroll events aren't a swipe)
  const want = useRef(null) // where the focus goes once the page asked for is shown: 'tab' | 'page'
  const [brief, setBrief] = useState(false) // (phones: the brief folded to a few lines until tapped)
  useDragClose(dlg, head)
  const pages = [{ key: 'top', title: 'Top' }, ...digest.sections]
  const at = Math.max(0, pages.findIndex((p) => p.key === tab))
  const atRef = useRef(at)
  atRef.current = at
  const pinned = new Set(pn?.on ? pn.data.pins.map((p) => p.url) : [])
  const total = digest.sections.reduce((n, s) => n + s.items.length, 0)
  const left = (s) => s.items.filter((i) => !nw.isRead(i.id)).length
  const unread = digest.sections.reduce((n, s) => n + left(s), 0)

  function go(i, focus = null) {
    const n = Math.min(pages.length - 1, Math.max(0, i))
    setTab(pages[n].key)
    const el = pager.current
    if (el?.clientWidth) {
      clearTimeout(aim.current.t)
      aim.current = { i: n, t: setTimeout(() => (aim.current.i = null), 900) }
      el.scrollTo({ left: n * el.clientWidth, behavior: smooth() })
    }
    // (once it's drawn: till then the page is inert, and can't take it)
    want.current = focus
    if (n === atRef.current) focusOn(n)
  }
  function focusOn(n) {
    const f = want.current
    want.current = null
    if (f === 'tab') nav.current?.querySelectorAll('[role="tab"]')[n]?.focus()
    else if (f === 'page') pager.current?.children[n]?.focus({ preventScroll: true })
  }
  // a swipe: the page it settles on is the one shown
  function onScroll() {
    const el = pager.current
    const w = el?.clientWidth
    if (!w) return
    if (aim.current.i != null) {
      if (Math.abs(el.scrollLeft - aim.current.i * w) > 2) return
      aim.current.i = null
    }
    const i = Math.round(el.scrollLeft / w)
    if (i !== atRef.current && pages[i]) setTab(pages[i].key)
  }
  // the pager on the page shown: when it gets its size (the modal opening, a phone turned) and when the page is changed
  // from outside a swipe (a section gone from a newer edition: Top)
  useEffect(() => {
    const el = pager.current
    if (!el) return
    const snap = () => {
      if (!el.clientWidth) return
      aim.current.i = null
      el.scrollLeft = atRef.current * el.clientWidth
    }
    snap()
    const ro = new ResizeObserver(snap)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = pager.current
    if (!el?.clientWidth || aim.current.i != null) return
    if (Math.round(el.scrollLeft / el.clientWidth) !== at) el.scrollLeft = at * el.clientWidth
  }, [at, pages.length])
  useEffect(() => {
    focusOn(at)
  }, [at])
  // (the chips: the one shown kept in view)
  useEffect(() => {
    const n = nav.current
    const b = n?.querySelector('[aria-selected="true"]')
    if (!b || n.scrollWidth <= n.clientWidth + 1) return
    n.scrollTo({ left: b.offsetLeft - (n.clientWidth - b.offsetWidth) / 2, behavior: smooth() })
  }, [at])
  // a newer copy of the latest: every page back to its top
  useEffect(() => {
    for (const p of pager.current?.children ?? []) p.scrollTop = 0
  }, [digest.at])

  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('.nw-menu')) return
    const onTab = e.target.getAttribute?.('role') === 'tab'
    const step = { ArrowRight: 1, ArrowLeft: -1, ...(onTab && { ArrowDown: 1, ArrowUp: -1 }) }[e.key]
    if (step) {
      e.preventDefault()
      return go(at + step, onTab ? 'tab' : 'page')
    }
    const page = pager.current?.children[at]
    if (!page) return
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      const links = [...page.querySelectorAll('.nw-h a')]
      const cur = links.findIndex((a) => a.closest('article')?.contains(document.activeElement))
      const next = links[cur < 0 ? 0 : Math.min(links.length - 1, Math.max(0, cur + (e.key === 'j' ? 1 : -1)))]
      next?.focus({ preventScroll: true })
      next?.closest('article')?.scrollIntoView({ block: 'nearest', behavior: smooth() })
    } else if (e.key === 'm') {
      const id = document.activeElement?.closest?.('article[data-id]')?.dataset.id
      if (id && nw.isRead(id)) nw.unread([id])
      else if (id) nw.read([id])
    }
  }

  const notes = nw.error || nw.data.stale || nw.refresh.can
  return (
    <section aria-labelledby="nw-title" className="nw" onKeyDown={onKey}>
      <header ref={head} className="nw-head">
        <span className="nw-grip" aria-hidden="true" />
        <span className="nw-mark" aria-hidden="true"><Newspaper size={17} strokeWidth={1.9} /></span>
        <div className="nw-title">
          <h2 id="nw-title">News</h2>
          {/* (with the edition menu there, the time is on its button) */}
          <span className="nw-sub">
            <span className={editions.length ? 'nw-sub-ed' : undefined}>{editions.length ? (EDITIONS[digest.edition] ?? 'On demand') : editionLine(digest, now, TZ)}{total ? ' · ' : ''}</span>
            {total ? (unread ? `${unread} unread` : 'all read') : ''}
          </span>
        </div>
        {nw.refresh.can && <RefreshButton nw={nw} />}
        {editions.length > 0 && <EditionMenu nw={nw} editions={editions} now={now} />}
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>

      <div className="nw-body">
        <div className="nw-side">
          <div ref={nav} className="nw-nav" role="tablist" aria-label="Sections">
            {pages.map((p, i) => {
              const Icon = SEC_ICON[p.key] ?? Hash
              const n = p.items ? left(p) : null
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  id={`nw-tab-${p.key}`}
                  aria-selected={i === at}
                  aria-controls={`nw-page-${p.key}`}
                  tabIndex={i === at ? 0 : -1}
                  className="nw-tab"
                  onClick={() => go(i)}
                >
                  <Icon size={14} strokeWidth={2} aria-hidden="true" />
                  <span className="nw-tab-name">{p.title}</span>
                  {n != null && <span className={`nw-tab-n${n ? '' : ' is-done'}`} aria-label={n ? `${n} unread` : 'all read'}>{n || <Check size={11} strokeWidth={3} />}</span>}
                </button>
              )
            })}
          </div>
          <p className="nw-keys" aria-hidden="true">
            <span><kbd>←</kbd><kbd>→</kbd><span>sections</span></span>
            <span><kbd>j</kbd><kbd>k</kbd><span>stories</span></span>
            <span><kbd>m</kbd><span>read / unread</span></span>
          </p>
        </div>

        <div className={`nw-main${nw.loading ? ' is-loading' : ''}`} aria-busy={nw.loading}>
          {notes && (
            <div className="nw-notes">
              {(nw.error || nw.data.stale) && <p className="nw-note" role="status">The news machine isn't answering: this is the last edition it sent.</p>}
              {nw.refresh.can && <RunNote nw={nw} />}
            </div>
          )}
          <div ref={pager} className="nw-pager" onScroll={onScroll}>
            {pages.map((p, i) => (
              <div key={p.key} id={`nw-page-${p.key}`} role="tabpanel" aria-labelledby={`nw-tab-${p.key}`} tabIndex={-1} inert={i !== at} className="nw-page" data-scroll>
                {p.key === 'top' ? (
                  <TopPage digest={digest} brief={brief} setBrief={setBrief} nw={nw} pn={pn} pinned={pinned} now={now} left={left} go={go} />
                ) : (
                  <SectionPage section={p} next={pages[i + 1]} onNext={() => go(i + 1, 'page')} onTop={() => go(0, 'page')} nw={nw} pn={pn} pinned={pinned} now={now} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const TOP = 8 // Top's stories at most
const LEADS = 2 // lead cards at most (importance 5)
const byWeight = (a, b) => b.importance - a.importance || (b.publishedAt ?? 0) - (a.publishedAt ?? 0)

// Top: the day in brief, the stories that matter most from every section (4–5 of 5; the best five when there are
// fewer), then a card per section (its unread, its first headlines) that opens it
function TopPage({ digest, brief, setBrief, nw, pn, pinned, now, left, go }) {
  const all = digest.sections.flatMap((s) => s.items).sort(byWeight)
  let top = all.filter((i) => i.importance >= 4).slice(0, TOP)
  if (top.length < 5) top = all.slice(0, 5)
  const props = { nw, pn, pinned, now }
  return (
    <>
      {digest.overview && (
        <div className={`nw-brief${brief ? ' is-open' : ''}`}>
          <span className="nw-kicker">In brief</span>
          <p>{digest.overview}</p>
          <button type="button" className="nw-brief-more" aria-expanded={brief} onClick={() => setBrief((b) => !b)}>{brief ? 'Less' : 'More'}</button>
        </div>
      )}
      {top.length > 0 && <Stories title="Top stories" items={top} {...props} />}
      {digest.sections.length > 0 && (
        <section className="nw-sec" aria-labelledby="nw-s-index">
          <div className="nw-sec-head">
            <h3 id="nw-s-index">Sections</h3>
            <span className="nw-rule" aria-hidden="true" />
          </div>
          <div className="nw-index">
            {digest.sections.map((s, i) => {
              const Icon = SEC_ICON[s.key] ?? Hash
              const n = left(s)
              const heads = s.items.filter((it) => !nw.isRead(it.id)).slice(0, 2)
              return (
                <button key={s.key} type="button" className="nw-card" onClick={() => go(i + 1, 'page')}>
                  <span className="nw-card-top">
                    <Icon size={15} strokeWidth={2} aria-hidden="true" />
                    <span className="nw-card-name">{s.title}</span>
                    <span className="nw-card-n">{n ? `${n} unread` : 'all read'}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </span>
                  {heads.map((it) => <span key={it.id} className="nw-card-line">{it.title}</span>)}
                </button>
              )
            })}
          </div>
        </section>
      )}
      {!digest.sections.length && <p className="nw-empty">Nothing in this edition.</p>}
    </>
  )
}

// A section's page: its stories (filtered by category when it has more than one), then on to the next
function SectionPage({ section, next, onNext, onTop, nw, pn, pinned, now }) {
  const [picked, setCat] = useState(null)
  const cats = Object.entries(section.items.reduce((m, i) => ((m[i.category] = (m[i.category] ?? 0) + 1), m), {}))
  // (a newer copy without that category: all of them)
  const cat = cats.some(([k]) => k === picked) ? picked : null
  const items = cat ? section.items.filter((i) => i.category === cat) : section.items
  const chip = (key, label, n) => (
    <button key={key ?? 'all'} type="button" className="nw-chip" aria-pressed={cat === key} onClick={() => setCat(key)} style={key ? { '--nw-h': HUE[key] ?? 240 } : undefined}>
      {label}
      {n != null && <span>{n}</span>}
    </button>
  )
  return (
    <>
      {cats.length > 1 && (
        <div className="nw-chips" role="group" aria-label="Category">
          {chip(null, 'All', section.items.length)}
          {cats.map(([k, n]) => chip(k, CATEGORIES[k] ?? k, n))}
        </div>
      )}
      <Stories title={section.title} items={items} all={section.items} nw={nw} pn={pn} pinned={pinned} now={now} />
      <button type="button" className="nw-next" onClick={next ? onNext : onTop}>
        {next ? <>Next: {next.title}<ArrowRight size={15} aria-hidden="true" /></> : <>Back to Top<ArrowUp size={15} aria-hidden="true" /></>}
      </button>
    </>
  )
}

// a run of stories under a heading: their unread, Mark all read, the 5/5 ones as lead cards (LEADS at most), the rest as
// rows (all: what Mark all read covers, when a filter shows fewer)
function Stories({ title, items, all = items, nw, pn, pinned, now }) {
  const left = all.filter((i) => !nw.isRead(i.id)).map((i) => i.id)
  const leads = items.filter((i) => i.importance >= 5).slice(0, LEADS)
  const rest = items.filter((i) => !leads.includes(i))
  const id = useId()
  return (
    <section className="nw-sec" aria-labelledby={id}>
      <div className="nw-sec-head">
        <h3 id={id}>{title}</h3>
        <span className="nw-rule" aria-hidden="true" />
        <span className="nw-count">{left.length ? `${left.length} unread` : 'all read'}</span>
        {left.length > 0 && <button type="button" className="nw-allread" onClick={() => nw.read(left)}>Mark all read</button>}
      </div>
      {leads.length > 0 && (
        <div className="nw-leads">
          {leads.map((it) => <Story key={it.id} it={it} lead nw={nw} pn={pn} pinned={pinned} now={now} />)}
        </div>
      )}
      {rest.length > 0 && (
        <ul className="nw-list">
          {rest.map((it) => <li key={it.id}><Story it={it} nw={nw} pn={pn} pinned={pinned} now={now} /></li>)}
        </ul>
      )}
    </section>
  )
}

// 🔄: a fresh edition now. Spins while asked or a run is going (on any device)
function RefreshButton({ nw }) {
  const { busy } = nw.refresh
  return (
    <button
      type="button"
      className={`nw-refresh${busy ? ' is-busy' : ''}`}
      aria-label={busy ? 'Making a fresh edition' : 'Refresh: a fresh edition now'}
      title={busy ? 'Making a fresh edition…' : 'Fresh news now (takes a few minutes)'}
      aria-busy={busy}
      disabled={busy}
      onClick={() => nw.start()}
    >
      <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

// What a run is up to, under the header: going (how long so far), taking too long, failed, the agent's limits, done
// (with a way to it from an older edition). Nothing when there's nothing to say
function RunNote({ nw }) {
  const { run, nextAt, trouble, ready, busy } = nw.refresh
  const [now, setNow] = useState(Date.now)
  const ticking = busy || (trouble === 'soon' && nextAt > now)
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])
  const at = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms)
  let tone = 'run', text = null, action = null
  if (run?.state === 'running') {
    const so = run.startedAt != null ? Math.max(0, now - run.startedAt) : null
    if (runGoing(run, now)) {
      const t = so == null ? '' : ` ${Math.floor(so / 60_000)}:${String(Math.floor(so / 1000) % 60).padStart(2, '0')}`
      text = `Making a fresh edition…${t} · usually 2–4 min. It shows here when it's ready.`
    } else {
      tone = 'warn'
      text = `The fresh edition is taking longer than usual (started ${at(run.startedAt)}). It shows here if it comes.`
    }
  } else if (trouble === 'down') {
    tone = 'warn'
    text = "The news machine didn't answer: no fresh edition this time."
  } else if (trouble === 'soon' && nextAt > now) {
    tone = 'warn'
    text = `Too soon for another refresh: try again in ${waitFor(nextAt - now)}.`
  } else if (ready) {
    text = `Fresh edition ready${ready.items != null ? ` · ${ready.items} stories` : ''}.`
    if (nw.view != null) action = <button type="button" className="nw-run-go" onClick={() => nw.show(null)}>Show it</button>
  } else if (run?.state === 'error' && (run.finishedAt ?? 0) > now - FAILED_FOR) {
    tone = 'warn'
    text = `The last refresh failed: ${run.error}`
  }
  if (!text) return null
  return (
    <p className={`nw-run is-${tone}`} role="status">
      {busy && <span className="nw-run-bar" aria-hidden="true" />}
      <span>{text}</span>
      {action}
    </p>
  )
}

// The edition picker: a button with the one shown ("Latest · 10:32"), a short list under it (Latest, then the archive
// by day: "Today · 10:12", "Yesterday · 18:00"). Arrow keys move, Enter picks, Esc or a tap elsewhere closes it (Esc
// doesn't close the modal then)
function EditionMenu({ nw, editions, now }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const btn = useRef(null)
  const cur = nw.view
  const latest = `Latest · ${new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(nw.data.latestAt)}`
  const label = (n) => (n == null ? latest : (editionName(n, now, TZ) ?? n))
  const all = [null, ...editions.map((e) => e.name)]
  useEffect(() => {
    if (!open) return
    const out = (e) => !box.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', out, true)
    // (the picked one gets the focus, so the arrows start from there)
    box.current?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true })
    return () => document.removeEventListener('pointerdown', out, true)
  }, [open])
  const pick = (n) => {
    setOpen(false)
    btn.current?.focus({ preventScroll: true })
    if (n !== cur) nw.show(n)
  }
  function onKey(e) {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      btn.current?.focus({ preventScroll: true })
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const items = [...box.current.querySelectorAll('[role="menuitemradio"]')]
      const i = items.indexOf(document.activeElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }
  return (
    <div ref={box} className="nw-menu" onKeyDown={onKey}>
      <button ref={btn} type="button" className={`nw-menu-btn${open ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={`Edition: ${label(cur)}. Pick another`} onClick={() => setOpen((o) => !o)}>
        <Clock size={13} aria-hidden="true" />
        <span>{label(cur)}</span>
        <ChevronDown size={14} className="chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="nw-menu-list" role="menu" aria-label="Editions">
          {all.map((n, i) => (
            <button key={n ?? 'latest'} type="button" role="menuitemradio" aria-checked={n === cur} tabIndex={-1} className={`nw-menu-item${i === 1 ? ' is-first-old' : ''}`} onClick={() => pick(n)}>
              <span>{label(n)}</span>
              {n === cur && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
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
    <article data-id={it.id} className={`nw-story${lead ? ' is-lead' : ''}${read ? ' is-read' : ''}`} style={{ '--nw-h': HUE[it.category] ?? 240 }}>
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
