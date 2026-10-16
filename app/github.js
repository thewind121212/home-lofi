'use client'

// GitHub: the repos the news agent picks each morning (GitHub's weekly trending, and new ones from the last 7 days),
// each explained in Vietnamese: what it is, what it can do, how it helps when building an app, how to try it. An icon
// next to News' in the header (a dot: a list not opened yet); a tap opens it the way News opens (app/news.js: a bottom
// sheet on phones, a panel on bigger screens). Rules in lib/github.js; the route is app/api/private/settings/github
// (owner-only: guests get 404 / 403 and never see the icon; NEWS_URL not set: no icon either).
// - Filters on top: All / Trending / New, ★ 4+ (the agent's "worth trying"), a category. Kept across openings.
// - A repo's name opens it (a new tab) and marks it read: read ones are dimmed, on every device (the server keeps
//   them, beside News' read stories). ✓ marks one by hand; ▾ (or a tap on its summary) opens the rest: Tính năng,
//   Giúp gì khi làm app, Khi nào dùng, the quick start (copied with a tap), its topics and homepage. 📌 pins its link.
// - A day at a time (the agent keeps 30); the newest one late after 06:05 says so ("chưa cập nhật") and is asked
//   again every 15 min (the server says until when: lib/github.js ghLate).
import './github.css'
import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, GitFork, Pin, Star, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { DayMenu, NewsCatch, useDragClose } from './news'
import { closeDialog, motionOff, useStillPage } from './settings'
import { DIFFICULTY, GH_CATEGORIES, GH_RETRY, MATURITY, compact } from '../lib/github'
import { dayName } from '../lib/news'
import { privateAnswer } from '../lib/private-poll'

const URL_ = '/api/private/settings/github'
const MIN_GAP = 30_000
const TZ = 'Asia/Ho_Chi_Minh' // (the agent's day)

// ---- state: the server's, the page only draws it ----

// owner: settings sync answered as the owner; clientId(): this tab's live-stream id. -> { on, pending, data, error,
// fresh, view, loading, show, reset, isRead, read, unread, seen, live, pull }
export function useGithub(owner, clientId) {
  const [data, setData] = useState(null) // the route's GET answer
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState(undefined) // a day picked in the menu, until it's on screen
  // read / unread here whose write hasn't been answered yet: drawn over any pull landing meanwhile
  const [ops, setOps] = useState([]) // [{ key, on, ids }]
  const [seenHere, setSeenHere] = useState(0) // the newest list opened here (the dot stays gone meanwhile)
  const api = useRef({})
  const view = useRef(null) // the day shown (null: the newest)
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const dataRef = useRef(null)
  dataRef.current = data
  const seq = useRef({ key: 0, sent: 0, shown: 0 })

  useEffect(() => {
    let on = true, busy = false, again = false, last = 0
    // (the agent's machine down, a restart: what was there stays, and so does the day it was)
    function fail() {
      setError(true)
      view.current = dataRef.current?.picked ?? null
      setPicked(undefined)
    }
    async function pull(force = false) {
      if (!on || !ownerRef.current || (!force && Date.now() - last < MIN_GAP)) return
      if (busy) return void (again = true)
      busy = true
      again = false
      last = Date.now()
      const n = ++seq.current.sent
      const day = view.current
      try {
        const r = await fetch(day ? `${URL_}?day=${encodeURIComponent(day)}` : URL_, { cache: 'no-store', redirect: 'manual' })
        const j = await r.json().catch(() => null)
        if (!on || day !== view.current) return
        if (n < seq.current.shown) return void (again = true)
        seq.current.shown = n
        if (r.status === 404 && day && j?.on) {
          // (that day has left the archive: back to the newest. Before the locked check: a guest's 404 has no on)
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
        if (on && day === view.current) fail()
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
    // (a late list: this is the "again every 15 min"; otherwise a new morning's list's dot)
    const t = setInterval(() => document.visibilityState === 'visible' && pull(true), GH_RETRY)
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
    // a list newer than the newest one opened
    fresh: on && data.latestAt > Math.max(data.seen ?? 0, seenHere),
    view: picked !== undefined ? picked : (data?.picked ?? null),
    show(day) {
      view.current = day
      setPicked(day)
      api.current.pull?.(true)
    },
    // the modal closed: next time it opens on the newest
    reset() {
      view.current = null
      setPicked(undefined)
    },
    isRead: (id) => readSet.has(id),
    read: (ids) => mark(true, ids.filter((id) => !readSet.has(id))),
    unread: (ids) => mark(false, ids.filter((id) => readSet.has(id))),
    seen() {
      if (!on || data.latestAt <= Math.max(data.seen ?? 0, seenHere)) return
      const at = data.latestAt
      setSeenHere(at)
      write({ action: 'seen', at }).catch(() => {})
    },
    // 'github': another tab or device read something; 'hello': the stream (re)connected
    live: (kind) => (kind === 'github' ? api.current.pull?.(true) : kind === 'hello' && api.current.pull?.()),
    pull: (force) => api.current.pull?.(force),
  }
}

// ---- the header icon ----

export function GithubIcon({ gh, wait = false, force = false, onOpen, className = '' }) {
  if (!gh.on) return wait ? <HeadIconSkeleton force={force} className={className} /> : null
  return <HeadIcon className={className} label={gh.fresh ? 'GitHub: a new list' : 'GitHub'} fa="fa-brands fa-github" dot={gh.fresh} onOpen={() => onOpen()} />
}

// ---- the modal ----

const Mark = () => <i className="fa-brands fa-github gh-mark-i" />
// a colour per category (its tag's tint, its card's edge)
const CAT_HUE = { 'ai-llm': 265, 'ai-agent': 290, devtools: 190, web: 205, mobile: 160, backend: 140, database: 40, 'infra-devops': 25, security: 0, 'data-ml': 315, 'ui-design': 335, game: 100, learning: 55, other: 240 }
// GitHub's own language colours (the common ones; anything else grey)
const LANG = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572a5', Rust: '#dea584', Go: '#00add8', Java: '#b07219', 'C++': '#f34b7d', C: '#555555',
  'C#': '#178600', Swift: '#f05138', Kotlin: '#a97bff', Ruby: '#701516', PHP: '#4f5d95', Shell: '#89e051', HTML: '#e34c26', CSS: '#663399',
  Vue: '#41b883', Svelte: '#ff3e00', Dart: '#00b4ab', 'Jupyter Notebook': '#da5b0b', Zig: '#ec915c', Lua: '#000080', MDX: '#fcb32c', Elixir: '#6e4a7e',
  Haskell: '#5e5086', Scala: '#c22d40', 'Objective-C': '#438eff', Nix: '#7e7eff', Astro: '#ff5a03', Solidity: '#aa6746', GDScript: '#355570',
}
const domainOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
const FILTERS = { list: 'all', top: false, cat: null }

// The list in a dialog (opened from the header icon). Opening it asks for a fresh list, and marks the newest seen once
// it's on screen
export function GithubModal({ gh, pn, dlg }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(FILTERS) // (kept across days and openings)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  const ref = useRef(gh)
  ref.current = gh
  useEffect(() => void (open && ref.current.pull(true)), [open])
  const newestShown = open && gh.on && gh.data.digest.at === gh.data.latestAt
  useEffect(() => void (newestShown && ref.current.seen()), [newestShown, gh.data?.latestAt])
  const close = () => closeDialog(dlg.current)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="gh-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => (delete dlg.current.dataset.closing, gh.reset())}
      className="wx-sheet nw-modal gh-modal glass-panel text-lofi-text"
    >
      {gh.on && (
        <NewsCatch key={gh.data.day} nw={gh} onClose={close} name="GitHub" mark={<Mark />} titleId="gh-title" tag="github">
          <GhBody gh={gh} pn={pn} dlg={dlg} f={f} setF={setF} onClose={close} />
        </NewsCatch>
      )}
    </dialog>
  )
}

function GhBody({ gh, pn, dlg, f, setF, onClose }) {
  const { digest, days } = gh.data
  const now = Date.now()
  const head = useRef(null)
  const scroller = useRef(null)
  const [brief, setBrief] = useState(false)
  useDragClose(dlg, head)
  const pinned = new Set(pn?.on ? pn.data.pins.map((p) => p.url) : [])
  const repos = digest.repos
  const n = (list) => repos.filter((r) => r.list === list).length
  // the filters, one on top of the other: the list, ★ 4+, then a category (its chips count what the first two leave)
  const inList = repos.filter((r) => f.list === 'all' || r.list === f.list)
  const base = inList.filter((r) => !f.top || (r.worth ?? 0) >= 4)
  const cats = Object.entries(base.reduce((m, r) => ((m[r.category] = (m[r.category] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
  const cat = cats.some(([k]) => k === f.cat) ? f.cat : null // (a day without it: all of them)
  const shown = cat ? base.filter((r) => r.category === cat) : base
  const unread = repos.filter((r) => !gh.isRead(r.id)).length
  const set = (o) => setF((x) => ({ ...x, ...o }))
  const groups = (f.list === 'all' ? ['trending', 'new'] : [f.list]).map((l) => ({ key: l, items: shown.filter((r) => r.list === l) })).filter((g) => g.items.length)
  // (a filter changed: back to the top of what's left)
  useEffect(() => void scroller.current?.scrollTo({ top: 0, behavior: motionOff() ? 'auto' : 'smooth' }), [f.list, f.top, cat])
  useEffect(() => void (scroller.current && (scroller.current.scrollTop = 0)), [digest.at])

  const newest = gh.view == null
  const lateNote = newest && gh.data.late
  const since = dayName(digest.date, now, TZ) ?? digest.date
  const sinceText = /^(Today|Yesterday)$/.test(since) ? since.toLowerCase() : since
  return (
    <section aria-labelledby="gh-title" className="nw gh">
      <header ref={head} className="nw-head">
        <span className="nw-grip" aria-hidden="true" />
        <span className="nw-mark gh-mark" aria-hidden="true"><Mark /></span>
        <div className="nw-title">
          <h2 id="gh-title">GitHub</h2>
          {/* (phones: only how many are left, beside the day menu) */}
          <span className="nw-sub">
            <span className="nw-sub-ed">{repos.length} repos{repos.length ? ' · ' : ''}</span>
            {repos.length ? (unread ? `${unread} unread` : 'all read') : ''}
          </span>
        </div>
        {days.length > 0 && <DayMenu nw={gh} days={days} now={now} note={(d) => d.last ?? ''} />}
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>

      <div className="gh-bar">
        <div className="gh-row">
          <div className="gh-seg" role="group" aria-label="List">
            {[['all', 'All', repos.length], ['trending', 'Trending', n('trending')], ['new', 'New', n('new')]].map(([k, label, c]) => (
              <button key={k} type="button" aria-pressed={f.list === k} onClick={() => set({ list: k })}>
                {label}<span>{c}</span>
              </button>
            ))}
          </div>
          <button type="button" className="nw-chip gh-top" aria-pressed={f.top} title="Worth trying: 4 or 5 of 5" onClick={() => set({ top: !f.top })}>
            <Star size={12} strokeWidth={2.2} aria-hidden="true" />4+<span>{inList.filter((r) => (r.worth ?? 0) >= 4).length}</span>
          </button>
        </div>
        {cats.length > 1 && (
          <div className="gh-cats" role="group" aria-label="Category">
            <button type="button" className="nw-chip" aria-pressed={!cat} onClick={() => set({ cat: null })}>All<span>{base.length}</span></button>
            {cats.map(([k, c]) => (
              <button key={k} type="button" className="nw-chip" aria-pressed={cat === k} style={{ '--nw-h': CAT_HUE[k] ?? 240 }} onClick={() => set({ cat: cat === k ? null : k })}>
                {GH_CATEGORIES[k] ?? k}<span>{c}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={scroller} className={`nw-scroll gh-scroll${gh.loading ? ' is-loading' : ''}`} aria-busy={gh.loading} data-scroll>
        {(gh.error || gh.data.stale) && <p className="nw-run is-warn" role="status"><span>The news machine isn't answering: this is the last list it sent.</span></p>}
        {lateNote && (
          <p className="nw-run is-warn" role="status">
            <span>
              <b className="gh-late">Chưa cập nhật</b> · today's list isn't in yet, this is {sinceText}'s.
              {gh.data.retry ? ' Checking again every 15 min until 08:00.' : ''}
            </span>
          </p>
        )}
        {digest.overview && (
          <div className={`nw-brief${brief ? ' is-open' : ''}`}>
            <span className="nw-kicker">This week</span>
            <p>{digest.overview}</p>
            <button type="button" className="nw-brief-more" aria-expanded={brief} onClick={() => setBrief((b) => !b)}>{brief ? 'Less' : 'More'}</button>
          </div>
        )}
        {groups.map((g) => (
          <Group key={g.key} title={g.key === 'trending' ? 'Trending this week' : 'New this week'} items={g.items} gh={gh} pn={pn} pinned={pinned} />
        ))}
        {!repos.length && <p className="nw-empty">No repos in this list.</p>}
        {repos.length > 0 && !shown.length && (
          <p className="nw-empty">
            Nothing matches these filters.{' '}
            <button type="button" className="nw-brief-more nw-back" onClick={() => setF(FILTERS)}>Clear filters</button>
          </p>
        )}
      </div>
    </section>
  )
}

// a list's repos under its heading: how many unread, Mark all read, the cards
function Group({ title, items, gh, pn, pinned }) {
  const left = items.filter((r) => !gh.isRead(r.id)).map((r) => r.id)
  const id = useId()
  return (
    <section className="nw-sec" aria-labelledby={id}>
      <div className="nw-sec-head">
        <h3 id={id}>{title}</h3>
        <span className="nw-rule" aria-hidden="true" />
        <span className="nw-count">{left.length ? `${left.length} unread` : 'all read'}</span>
        {left.length > 0 && <button type="button" className="nw-allread" onClick={() => gh.read(left)}>Mark all read</button>}
      </div>
      <div className="gh-list">
        {items.map((r) => <Repo key={r.id} r={r} gh={gh} pn={pn} pinned={pinned} />)}
      </div>
    </section>
  )
}

function Repo({ r, gh, pn, pinned }) {
  const [more, setMore] = useState(false)
  const [pinning, setPinning] = useState(false)
  const read = gh.isRead(r.id)
  const isPinned = pinned.has(r.url)
  const open = () => gh.read([r.id])
  const slash = r.name.indexOf('/')
  const panel = useId()
  const level = [MATURITY[r.maturity], DIFFICULTY[r.difficulty]].filter(Boolean).join(' · ')
  const body = r.summary ?? r.description
  const extra = r.features || r.devUse || r.useWhen || r.quickStart || r.topics.length || r.homepage || (r.summary && r.description)
  return (
    <article data-id={r.id} className={`gh-repo${read ? ' is-read' : ''}`} style={{ '--nw-h': CAT_HUE[r.category] ?? 240 }}>
      <div className="nw-tags">
        {r.rank != null && <span className="gh-rank">#{r.rank}</span>}
        <span className="nw-cat">{GH_CATEGORIES[r.category]}</span>
        {r.isNew && <span className="nw-new" title="New on the list today">New</span>}
        {r.worth != null && (
          <span className="nw-imp gh-worth" role="img" aria-label={`worth trying ${r.worth} of 5`} title={`Worth trying: ${r.worth} of 5`}>
            {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= r.worth ? 'on' : ''} />)}
          </span>
        )}
      </div>
      <h4 className="nw-h gh-name">
        <a href={r.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={open} onAuxClick={(e) => e.button === 1 && open()}>
          {slash > 0 ? <><span className="gh-owner">{r.name.slice(0, slash + 1)}</span>{r.name.slice(slash + 1)}</> : r.name}
        </a>
      </h4>
      <p className="gh-stats">
        {r.language && <span><i className="gh-lang" style={{ background: LANG[r.language] ?? '#8b8ba7' }} aria-hidden="true" />{r.language}</span>}
        {r.stars != null && <span title={`${r.stars.toLocaleString('en')} stars`}><Star size={11} aria-hidden="true" />{compact(r.stars)}</span>}
        {r.week > 0 && <span className="gh-week" title={`${r.week.toLocaleString('en')} stars this week`}>+{compact(r.week)} this week</span>}
        {r.forks != null && <span title={`${r.forks.toLocaleString('en')} forks`}><GitFork size={11} aria-hidden="true" />{compact(r.forks)}</span>}
        {r.license && <span>{r.license}</span>}
      </p>
      {body && <p className={`nw-sum gh-sum${more ? ' is-open' : ''}`} onClick={() => extra && setMore((m) => !m)}>{body}</p>}
      {more && (
        <div className="gh-more" id={panel}>
          {r.summary && r.description && <p className="nw-orig">{r.description}</p>}
          {r.features && <Lines title="Tính năng" lines={r.features} />}
          {r.devUse && <Lines title="Giúp gì khi làm app" lines={r.devUse} />}
          {r.useWhen && (
            <div className="gh-part">
              <h5>Khi nào dùng</h5>
              <p className="gh-when">{r.useWhen}</p>
            </div>
          )}
          {r.quickStart && <QuickStart text={r.quickStart} />}
          {(r.topics.length > 0 || r.homepage) && (
            <div className="gh-topics">
              {r.homepage && (
                <a className="gh-home" href={r.homepage} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                  <ExternalLink size={11} aria-hidden="true" />{domainOf(r.homepage)}
                </a>
              )}
              {r.topics.slice(0, 8).map((t) => <span key={t}>#{t}</span>)}
            </div>
          )}
        </div>
      )}
      <div className="nw-meta">
        {level && <span>{level}</span>}
        {r.days > 1 && <span>{r.days} days on the list</span>}
        <span className="nw-acts">
          {extra && (
            <button type="button" className="nw-act" aria-expanded={more} aria-controls={more ? panel : undefined} aria-label={more ? 'Show less' : `More about ${r.name}`} title={more ? 'Less' : 'More'} onClick={() => setMore((m) => !m)}>
              <ChevronDown size={14} className={more ? 'rot' : ''} aria-hidden="true" />
            </button>
          )}
          {pn?.on && (
            <button
              type="button"
              className={`nw-act${isPinned ? ' is-on' : ''}`}
              aria-label={isPinned ? 'Pinned' : `Pin: ${r.name}`}
              title={isPinned ? 'Pinned' : 'Pin it'}
              disabled={isPinned || pinning}
              onClick={async () => (setPinning(true), await pn.add(r.url), setPinning(false))}
            >
              <Pin size={13} aria-hidden="true" />
            </button>
          )}
          <button type="button" className={`nw-act${read ? ' is-on' : ''}`} aria-pressed={read} aria-label={`Read: ${r.name}`} title={read ? 'Read: mark unread' : 'Mark read'} onClick={() => (read ? gh.unread([r.id]) : gh.read([r.id]))}>
            <Check size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </span>
      </div>
    </article>
  )
}

function Lines({ title, lines }) {
  return (
    <div className="gh-part">
      <h5>{title}</h5>
      <ul className="nw-points">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  )
}

// the quick start: a line of code, copied with a tap (no clipboard, e.g. plain http: the text selected instead)
function QuickStart({ text }) {
  const [copied, setCopied] = useState(false)
  const code = useRef(null)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      if (code.current) getSelection()?.selectAllChildren(code.current)
    }
  }
  return (
    <div className="gh-part">
      <h5>Quick start</h5>
      <div className="gh-code">
        <code ref={code}>{text}</code>
        <button type="button" className={`nw-act${copied ? ' is-on' : ''}`} aria-label={copied ? 'Copied' : 'Copy the quick start'} title={copied ? 'Copied' : 'Copy'} onClick={copy}>
          {copied ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
        <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
      </div>
    </div>
  )
}
