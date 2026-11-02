'use client'

// Pins: links the owner keeps, each with its preview, newest first: an icon next to the header's bell, the pins in a sheet. Rules in lib/pins.js; the route is
// app/api/private/settings/pins (owner-only: guests get 404 / 403 and never see the card).
// - One box does both: typing searches the pins as you go (title, description, site, link; no case, no accents), and
//   a link ("https://…", "www.…") is pinned with Enter or the Pin button. The server fetches its preview meanwhile (a
//   pending tile); a link it won't or can't fetch (a LAN address, too slow, not a page) is kept anyway, with why.
// - The pins by site (a section each, the biggest first, small day dividers inside) or by the day they were pinned
//   (lib/pins-view.js; the choice is the device's). A long section shows its newest few, "Show N more" the rest.
//   Quick filters under the box: a site (and, for a big one, a part of it: GitHub's owners), a time span; each chip's
//   count is what tapping it would leave. The search works on top of them and marks the words it found. / goes to the
//   box; Esc clears the search, then the filters, then closes. ✕ removes one, with a short Undo.
// - Pictures come straight from the sites (no referrer, lazy); a broken one gives way to a tile with the site's icon
//   or its first letter.
// - Links: a pin can go on habits and reminders (several on one): their small chips there open it (PinChips), and the
//   picker (LinkPicker, one for the page, opened with pn.pick) ticks pins on and off, or pins a pasted link onto it.
// - The owner's other tabs follow on the live stream ('pins': pull).
import './pins.css'
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, CornerDownRight, Link2, Pin, Plus, RotateCw, Search, SearchX, Sparkles, Trash2, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { Bone } from './skeleton'
import { closeDialog, load, motionOff, save, useStillPage } from './settings'
import { MAX_LINKS, REASONS, UNDO_MS, cleanUrl, linkedTo, looksLikeLink, matches } from '../lib/pins'
import { RENDER_STEP, TIMES, TOP_PARTS, TOP_SITES, byDay, bySite, cleanView, dayDate, dayKey, dayLabel, facet, linesOf, liveFilters, marks, plan, prepare, sheetKey, shownOf, whereOf } from '../lib/pins-view'
import { UndoLeft, UndoLine } from './habits'

const URL_ = '/api/private/settings/pins'
const NOTE_MS = 6000

// ---- state: the server's, with the device only drawing it ----

// owner: settings sync answered as the owner (the page's `owner`); clientId(): this tab's live-stream id (its own
// changes aren't echoed back). -> { on, pending, data, adding, refreshing, undoing, note, add, remove, undo, refresh, live,
// linked, link, unlink, picking, pick, unpick }
export function usePins(owner, clientId) {
  const [data, setData] = useState(null)
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false) // a load was tried (so a failed one ends the skeleton)
  const [adding, setAdding] = useState([]) // [{ key, url }]: links whose preview is on its way (a pending tile each)
  const [refreshing, setRefreshing] = useState(null) // the pin whose preview is fetched again
  const [undoing, setUndoing] = useState(null) // { pin, index, until }: the Undo bar (the pin is gone from the list)
  const [note, setNote] = useState(null)
  const [said, setSaid] = useState('') // what the card's one live region says (screen readers): the latest news
  const [gone, setGone] = useState(() => new Set()) // pins removed here whose removal the server hasn't confirmed yet
  const [picking, setPicking] = useState(null) // { to, label }: the link picker is open for this habit / reminder
  // links ticked on / off here whose request hasn't been answered yet: drawn over whatever answer lands meanwhile (an
  // add still fetching its preview, a pull), so a tick never flickers back. Each goes once its own answer is in
  const [ticks, setTicks] = useState([]) // [{ key, on, pin, kind, id, at }]
  const api = useRef({})
  const seq = useRef({ sent: 0, shown: 0, at: 0, key: 0 }) // an older answer landing later is out of date
  // every request goes one at a time, in order (a pull never reads around a change still on its way), and one that
  // fails doesn't hold up the next
  const queue = useRef(Promise.resolve())
  const enqueue = (fn) => (queue.current = queue.current.catch(() => {}).then(fn))
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  async function call(method, body) {
    const n = ++seq.current.sent
    seq.current.at = Date.now()
    const headers = {}
    const id = clientId?.()
    if (id) headers['x-home-client'] = id
    if (body !== undefined) headers['content-type'] = 'application/json'
    const r = await fetch(URL_, { method, cache: 'no-store', redirect: 'manual', headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const j = await r.json().catch(() => null)
    // 404 / 403: not the owner (or not set up): no card. Not the route's own "forbidden" (a write it wouldn't take from
    // here): that one is just a failed write
    if (r.status === 404 || (r.status === 403 && j?.error !== 'forbidden')) {
      setOff(true)
      setData(null)
      return null
    }
    if (n >= seq.current.shown && Array.isArray(j?.pins)) {
      seq.current.shown = n
      setData(j)
    }
    if (!r.ok) throw Object.assign(new Error(j?.error ?? 'failed'), { status: r.status })
    return j
  }

  useEffect(() => {
    let on = true, busy = false, again = false, soon = 0
    async function pull() {
      if (!on || !ownerRef.current) return
      if (busy) return void (again = true)
      busy = true
      again = false
      try {
        await enqueue(() => call('GET'))
      } catch {}
      busy = false
      if (on) setTried(true)
      if (again) pull()
    }
    api.current.pull = pull
    api.current.live = () => {
      clearTimeout(soon)
      soon = setTimeout(pull, 200)
    }
    const onVis = () => document.visibilityState === 'visible' && pull()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      on = false
      clearTimeout(soon)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  useEffect(() => {
    if (owner) {
      setOff(false)
      return void api.current.pull?.()
    }
    setData(null)
  }, [owner])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), NOTE_MS)
    return () => clearTimeout(t)
  }, [note])
  useEffect(() => {
    if (!undoing) return
    const t = setTimeout(() => setUndoing(null), Math.max(0, undoing.until - Date.now()))
    return () => clearTimeout(t)
  }, [undoing])

  // (the same words twice still get read out: a no-break space tells them apart)
  const say = (text) => setSaid((cur) => (cur === text ? `${text}\u00a0` : text))
  const tell = (text) => (setNote(text), say(text))
  const ungone = (id) => setGone((g) => (g.has(id) ? new Set([...g].filter((x) => x !== id)) : g))
  const failed = (e, what) => {
    if (e?.status === 400 || e?.status === 403 || e?.status === 409 || e?.status === 429) tell(e.message.charAt(0).toUpperCase() + e.message.slice(1))
    else {
      tell(`Couldn't ${what}: check the connection and try again`)
      api.current.pull?.()
    }
  }
  const why = (reason) => REASONS[reason] ?? REASONS.unreachable
  function tick(on, pin, to) {
    const key = ++seq.current.key
    setTicks((t) => [...t, { key, on, pin: pin.id, kind: to.kind, id: to.id, at: Date.now() }])
    enqueue(() => call('POST', { action: on ? 'link' : 'unlink', id: pin.id, to }))
      .catch((e) => failed(e, on ? 'link it' : 'unlink it'))
      .finally(() => setTicks((t) => t.filter((x) => x.key !== key)))
  }

  return {
    on: Boolean(owner && data && !off),
    pending: Boolean(owner && !data && !off && !tried), // the owner's first load is on its way: the skeleton
    data,
    adding,
    refreshing,
    undoing,
    note,
    said,
    // hidden from the list: removed here (its Undo showing, or its removal still on its way: a pull meanwhile mustn't
    // bring it back for a moment)
    hidden: (id) => gone.has(id) || undoing?.pin.id === id,
    // 'pins': another tab changed something; 'hello': the stream (re)connected, a pull unless one just went out
    live: (kind) => (kind === 'pins' || (kind === 'hello' && Date.now() - seq.current.at > 3000)) && api.current.live?.(),
    // a link -> the pin's id once it's kept (or was already), false if not (the note says why). to: linked onto that
    // habit / reminder too ({ kind, id })
    async add(text, to) {
      const c = cleanUrl(text)
      if (c.error) {
        tell(`That link won't do: ${c.error.replace(/^url: /, '')}`)
        return false
      }
      const key = ++seq.current.key
      setAdding((a) => [{ key, url: c.url }, ...a])
      try {
        const j = await enqueue(() => call('POST', { url: c.url, ...(to && { to }) }))
        if (j?.linkError) tell(j.linkError.charAt(0).toUpperCase() + j.linkError.slice(1))
        else if (j?.dup) tell(to ? 'Already pinned: linked it' : 'Already pinned: moved it to the top')
        else if (j && !j.ok) tell(`Pinned without a preview: ${why(j.reason)}`)
        return j ? (j.pin ?? true) : false
      } catch (e) {
        failed(e, 'pin that')
        return false
      } finally {
        setAdding((a) => a.filter((x) => x.key !== key))
      }
    },
    remove(pin) {
      const list = data?.pins ?? []
      const index = list.findIndex((p) => p.id === pin.id)
      if (index < 0) return
      // gone from the list at once, and stays gone until the server agrees (another removal's Undo taking this one's
      // place included: this one is then simply done)
      setGone((g) => new Set(g).add(pin.id))
      setUndoing({ pin, index, until: Date.now() + UNDO_MS })
      say(`Removed ${linesOf(pin).title}. Undo is there for a few seconds.`)
      enqueue(() => call('DELETE', { id: pin.id }))
        .then(() => ungone(pin.id))
        .catch((e) => (ungone(pin.id), setUndoing((u) => (u?.pin.id === pin.id ? null : u)), failed(e, 'remove it')))
    },
    undo() {
      const u = undoing
      if (!u) return
      setUndoing(null)
      ungone(u.pin.id)
      say(`${linesOf(u.pin).title} is back`)
      setData((d) => (d && !d.pins.some((p) => p.id === u.pin.id) ? { ...d, pins: [...d.pins.slice(0, u.index), u.pin, ...d.pins.slice(u.index)] } : d))
      enqueue(() => call('POST', { action: 'undo', id: u.pin.id })).catch((e) => failed(e, 'bring it back'))
    },
    // the pins on a habit / reminder (kept ones, not one being removed), in the order they were linked
    linked(kind, id) {
      if (!data) return []
      let links = data.links ?? []
      for (const t of ticks) {
        const same = (l) => l.pin === t.pin && l.kind === t.kind && l.id === t.id
        links = t.on ? (links.some(same) ? links : [...links, t]) : links.filter((l) => !same(l))
      }
      return linkedTo(links, data.pins.filter((p) => !gone.has(p.id) && undoing?.pin.id !== p.id), kind, id)
    },
    link: (pin, to) => tick(true, pin, to),
    unlink: (pin, to) => tick(false, pin, to),
    // the picker: open for one habit / reminder (label: its name, for the heading)
    picking,
    pick: (to, label) => setPicking({ to, label }),
    unpick: () => setPicking(null),
    async refresh(pin) {
      setRefreshing(pin.id)
      try {
        const j = await enqueue(() => call('POST', { action: 'refresh', id: pin.id }))
        if (j && !j.ok) tell(`Still no preview: ${why(j.reason)}`)
      } catch (e) {
        failed(e, 'fetch it again')
      } finally {
        setRefreshing(null)
      }
    },
  }
}

// ---- a pin ----

// a soft colour per site, for the tiles without a picture
const hue = (s) => [...(s || '?')].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 7)

// the site's icon, or its first letter
function Icon({ pin, size }) {
  const [bad, setBad] = useState(false)
  if (pin.icon && !bad) {
    return <img className="pn-icon" src={pin.icon} width={size} height={size} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
  }
  // (an address has no letter worth showing: a link then)
  const letter = /^\p{L}/u.test(pin.domain ?? '') ? pin.domain[0].toUpperCase() : null
  return (
    <span className="pn-letter" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }} aria-hidden="true">
      {letter ?? <Link2 size={Math.round(size * 0.55)} />}
    </span>
  )
}

// its picture; none, broken, or too small to be one (a tracker pixel, or a site's stand-in served with its 404, like
// YouTube's grey 120 x 90: an <img> shows that as if it loaded; real previews are 200 px and up): a tile in the site's
// colour with its icon
function Thumb({ pin }) {
  const [bad, setBad] = useState(false)
  if (pin.image && !bad) {
    return (
      <span className="pn-thumb">
        <img src={pin.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} onLoad={(e) => Math.max(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) <= 120 && setBad(true)} />
      </span>
    )
  }
  return (
    <span className="pn-thumb pn-plain" style={{ '--pn-h': hue(pin.domain) }}>
      <Icon pin={pin} size={28} />
    </span>
  )
}

// q: the search, its words marked; fresh: just pinned here (a glow); day: the first of its day in a site's section
// (its label, above it). Its lines: lib/pins-view.js linesOf (GitHub's told apart by their path). Memoised: the
// sheet's callbacks are stable, so typing or a filter redraws only the tiles whose marks change
const Tile = memo(function Tile({ pin, q, fresh = false, day = null, onRemove, onRefresh, refreshing }) {
  const { title: name, meta } = linesOf(pin)
  const label = pin.title ?? pin.domain // (its buttons' names: the whole title)
  const desc = pin.description ?? (pin.ok ? null : `No preview: ${REASONS[pin.reason] ?? REASONS.unreachable}`)
  return (
    <li className={`pn-tile${pin.ok ? '' : ' is-bare'}${fresh ? ' is-new' : ''}${day ? ' has-day' : ''}`} data-pin={pin.id}>
      {day && <span className="pn-tday">{day}</span>}
      <a className="pn-link" href={pin.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={pin.url}>
        <Thumb pin={pin} />
        <span className="pn-text">
          <span className="pn-name"><Hl text={name} q={q} /></span>
          <span className="pn-desc"><Hl text={desc ?? pin.url.replace(/^https?:\/\/(www\.)?/, '')} q={q} /></span>
          <span className="pn-dom">
            {pin.image && <Icon pin={pin} size={12} />}
            <span><Hl text={meta} q={q} /></span>
          </span>
        </span>
      </a>
      <div className="pn-acts">
        {!pin.ok && (
          <button type="button" className="pn-act" aria-label={`Fetch the preview of ${label} again`} title="Try the preview again" disabled={refreshing} onClick={() => onRefresh(pin)}>
            <span className="dot"><RotateCw size={13} className={refreshing ? 'pn-spin' : ''} aria-hidden="true" /></span>
          </button>
        )}
        <button type="button" className="pn-act" aria-label={`Remove ${label}`} title="Remove" onClick={() => onRemove(pin)}>
          <span className="dot"><X size={14} aria-hidden="true" /></span>
        </button>
      </div>
    </li>
  )
})

// a link on its way: its domain, the rest stand-ins
function PendingTile({ url }) {
  let domain = ''
  try {
    domain = new URL(url).hostname.replace(/^www\./, '')
  } catch {}
  return (
    <li className="pn-tile is-pending" aria-busy="true">
      <div className="pn-link">
        <span className="pn-thumb sk-pulse" />
        <span className="pn-text">
          <span className="pn-name">{domain}</span>
          <span className="pn-desc"><Bone w="85%" /><br /><Bone w="55%" /></span>
          <span className="pn-dom"><span>fetching its preview…</span></span>
        </span>
      </div>
    </li>
  )
}

// ---- the header icon and the sheet ----

function Empty({ className = '' }) {
  return (
    <div className={`pn-empty ${className}`}>
      <p>Nothing pinned yet</p>
      <small>Paste a link above: its picture, title and a line about it stay here, searchable.</small>
    </div>
  )
}

// The header's icon next to the bell; a tap opens the pins in a sheet (the box there: paste a link). pn: usePins().
// Nothing at all unless the server said this is the owner.
// wait: it may be on its way (owner not known yet, or the first load), so its skeleton keeps the place; force: it
// surely is the owner's, whatever the remembered shape says
export function PinsIcon({ pn, wait = false, force = false, onOpen, className = '' }) {
  if (!pn.on) return wait ? <HeadIconSkeleton force={force} className={className} /> : null
  const n = pn.data.pins.filter((p) => !pn.hidden(p.id)).length
  return <HeadIcon className={className} label={n ? `Pins, ${n} kept` : 'Pins, none yet'} icon={Pin} onOpen={() => onOpen()} />
}

const FILTERS_FROM = 5 // pins kept before the filters (and the two views) show: for a handful, they'd only be in the way
const VIEW_KEY = 'pinsView' // this device's view: by site (the default) or by date
const JUST_MAX = 3 // links pinned in this sitting, on top of the list

// All of them in a sheet (opened from its header icon): the box (paste a link, or search), the filters, the pins by
// site or by date, ✕ with Undo. Only the head and the box stay put: the filters scroll with the pins (on a phone with
// its keyboard up, a fixed block of chips left the results a sliver), and stay on top of them where there's room (a
// tall window). With enough pins to filter the sheet has a fixed height, so a filter doesn't make it jump.
export function PinsSheet({ pn, dlg }) {
  const [open, setOpen] = useState(false)
  const [round, setRound] = useState(0) // each close: a fresh body for the next open (no search or filter left over)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => {
      setOpen(d.open)
      if (!d.open) setRound((r) => r + 1)
    })
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  const close = () => closeDialog(dlg.current)
  const shown = pn.data ? pn.data.pins.filter((p) => !pn.hidden(p.id)).length : 0
  return (
    <dialog
      ref={dlg}
      aria-labelledby="pn-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => delete dlg.current.dataset.closing}
      className={`wx-sheet pn-sheet${shown >= FILTERS_FROM ? ' is-tall' : ''} sm:max-w-2xl glass-panel text-lofi-text`}
    >
      {pn.on && <PinsBody key={round} pn={pn} open={open} onClose={close} />}
    </dialog>
  )
}

// the day, as long as the sheet is open (a minute's check: past midnight, "Today" moves on)
function useNow() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow((n) => (dayKey(n) === dayKey(Date.now()) ? n : Date.now())), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

// A row of chips (items: [{ key, node }]): one line that scrolls sideways (no bar), its edges fading where there's
// more; from 640 px with a mouse it wraps instead (a wheel doesn't scroll sideways). max: chips shown before "+N" opens
// the rest; while wrapping, only as many as fit on one line (a lone "+N" on a line of its own is a wasted row). keep:
// a picked chip stays in sight among them. lead: something before the chips (the parts' ↳)
function ChipRow({ label, items, max = Infinity, keep = null, lead = null, noun = 'more', className = '' }) {
  const ref = useRef(null)
  const [all, setAll] = useState(false)
  const [fit, setFit] = useState(max)
  const [width, setWidth] = useState(0)
  const check = useRef(() => {})
  check.current = () => {
    const el = ref.current
    if (!el) return
    const l = el.scrollLeft > 2
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    el.dataset.fade = `${l ? 'l' : ''}${r ? 'r' : ''}`
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => check.current()
    const ro = new ResizeObserver(() => (setWidth(el.clientWidth), on()))
    ro.observe(el)
    el.addEventListener('scroll', on, { passive: true })
    return () => (ro.disconnect(), el.removeEventListener('scroll', on))
  }, [])
  useEffect(() => void check.current()) // (its chips change: the counts, "+N")
  // fitting: from max again whenever the row or its chips change, then one fewer until "+N" is on the first line
  // (layout effects: all before the screen shows any of it)
  const sig = `${width}|${items.map((it) => it.key).join()}|${keep}`
  useLayoutEffect(() => void setFit(max), [sig, max])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || all || max === Infinity || !el.clientWidth || getComputedStyle(el).flexWrap !== 'wrap') return
    const first = el.querySelector('[data-chip]')
    const more = el.querySelector('[data-more]')
    if (first && more && more.offsetTop > first.offsetTop + 4 && fit > 1) setFit((f) => f - 1)
  })
  const n = all ? items.length : Math.min(fit, max)
  const shown = items.filter((it, i) => i < n || it.key === keep)
  const rest = items.length - shown.length
  return (
    <div ref={ref} role="group" aria-label={label} className={`pn-row ${className}`}>
      {lead}
      {shown.map((it) => <Fragment key={it.key}>{it.node}</Fragment>)}
      {(rest > 0 || all) && items.length > Math.min(fit, max) && (
        <button type="button" data-more className="pn-fchip is-more" aria-expanded={all} onClick={() => setAll((a) => !a)} aria-label={all ? `Fewer ${noun}` : `${rest} more ${noun}`}>
          {all ? 'Fewer' : `+${rest}`}
        </button>
      )}
    </div>
  )
}

// the words found, marked (lib/pins-view.js marks: no case, no accents)
function Hl({ text, q }) {
  if (!q || !text) return text
  return marks(text, q).map((m, i) => (m.hit ? <mark key={i} className="pn-hit">{m.text}</mark> : <Fragment key={i}>{m.text}</Fragment>))
}

const plural = (n) => `${n} pin${n === 1 ? '' : 's'}`

function PinsBody({ pn, open, onClose }) {
  const [q, setQ] = useState('')
  const [view, setView] = useState(() => cleanView(load(VIEW_KEY, 'site')))
  const [site, setSite] = useState(null)
  const [sub, setSub] = useState(null) // a part of the site (GitHub's owner)
  const [time, setTime] = useState('any')
  const [opened, setOpened] = useState(() => new Set()) // sections showing all their pins
  const [shut, setShut] = useState(() => new Set()) // sections folded away
  const [limit, setLimit] = useState(RENDER_STEP) // tiles drawn so far (more as the list's end comes near)
  const [just, setJust] = useState([]) // ids pinned (or pinned again) in this sitting, newest first: on top of the list
  const [fresh, setFresh] = useState(null) // the one just pinned: glowing a moment
  const [typing, setTyping] = useState(false) // the box has the focus (on a phone: the keyboard is up)
  const [clears, setClears] = useState(0) // (each Clear: the chip rows start over, "+N" folded)
  const [heard, setHeard] = useState('') // the result count, for screen readers
  const box = useRef(null)
  const scroller = useRef(null)
  const filtersRef = useRef(null)
  const justRef = useRef(null)
  const now = useNow()
  // (stable for the memoised tiles: pn is a new object on every render)
  const pnRef = useRef(pn)
  pnRef.current = pn
  const onRemove = useCallback((p) => pnRef.current.remove(p), [])
  const onRefresh = useCallback((p) => pnRef.current.refresh(p), [])

  // (the one being removed stays out while its Undo shows, whatever a pull brings meanwhile)
  const all = pn.data.pins
  const hiddenKey = all.filter((p) => pn.hidden(p.id)).map((p) => p.id).join()
  const pins = useMemo(() => all.filter((p) => !pn.hidden(p.id)), [all, hiddenKey]) // (pn.hidden is new each time: hiddenKey is what it says)
  const total = pins.length
  const prep = useMemo(() => prepare(pins), [pins])
  const link = looksLikeLink(q)
  const kept = link ? pins.find((p) => p.url === cleanUrl(q).url) : null
  // (typing stays quick with 500 pins: the lists catch up a moment later)
  const query = useDeferredValue(link ? '' : q.trim())
  // the filters that still hold (lib/pins-view.js liveFilters): a site whose last pin went, a part whose chip went, any
  // of them once the filters are hidden (a handful of pins) is none, and is forgotten below
  const filters = total >= FILTERS_FROM
  const live = useMemo(() => liveFilters(prep, { site, sub, time }, filters), [prep, site, sub, time, filters])
  const { site: siteOn, sub: subOn, time: timeOn } = live
  useEffect(() => {
    if (site !== siteOn) setSite(null)
    if (sub !== subOn) setSub(null)
    if (time !== timeOn) setTime('any')
  }, [site, siteOn, sub, subOn, time, timeOn])
  // the counts now (cheap), the list a moment later (drawing it is the slow part: the chips answer the tap at once)
  const f = useMemo(() => facet(prep, { q: query, site: siteOn, sub: subOn, time: timeOn }, now, live.parts), [prep, query, siteOn, subOn, timeOn, now, live.parts])
  const shape = filters ? view : 'site' // (a handful of pins: no views to pick from, by site)
  const found = useDeferredValue(f.found)
  const shapeLate = useDeferredValue(shape)
  const groups = useMemo(() => (shapeLate === 'site' ? bySite(found) : byDay(found)), [shapeLate, found])
  const stale = found !== f.found || shapeLate !== shape
  const filtered = Boolean(siteOn || timeOn !== 'any')
  const searching = Boolean(query)
  const siteOf = (key) => prep.sites.find((s) => s.key === key)

  const clearFilters = () => (setSite(null), setSub(null), setTime('any'), setClears((c) => c + 1))
  const clearAll = () => (setQ(''), clearFilters())
  const pickView = (v) => (setView(v), save(VIEW_KEY, v))
  const pickSite = (key) => (setSite((s) => (s === key ? null : key)), setSub(null))
  const toggle = (set, key) => set((s) => {
    const n = new Set(s)
    n.has(key) ? n.delete(key) : n.add(key)
    return n
  })

  // / to the box; Esc clears the search, then the filters, then closes the sheet as ever (lib/pins-view.js sheetKey)
  const keys = useRef({})
  keys.current = { q: Boolean(q), filtered, clearFilters }
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      const d = box.current?.closest('dialog')
      if (!d?.open || 'closing' in d.dataset || !(d.contains(e.target) || e.target === document.body)) return
      const typing = Boolean(e.target.closest?.('input, textarea, select, [contenteditable="true"]'))
      const act = sheetKey(e, { typing, q: keys.current.q, filtered: keys.current.filtered })
      if (!act) return
      e.preventDefault() // (an Esc handled here doesn't close the sheet)
      if (act === 'focus') box.current?.focus()
      else if (act === 'clear-q') setQ('')
      else keys.current.clearFilters()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open])
  // opened with a mouse: straight into the box (on a phone that would throw the keyboard up)
  useEffect(() => {
    if (open && matchMedia('(pointer: fine)').matches) box.current?.focus({ preventScroll: true })
  }, [open])
  // a new filter, view or search: back to the top of the list, and only its first tiles drawn
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    setLimit(RENDER_STEP)
  }, [siteOn, subOn, timeOn, shape, query])
  // the filters on top of the list where they stay (a tall window): the section heads stop under them, and a tile
  // focused by keys scrolls clear of both (--pn-stick, the filters' height there; 0 where they scroll away)
  useEffect(() => {
    const el = filtersRef.current, sc = scroller.current
    if (!el || !sc) return
    const set = () => sc.style.setProperty('--pn-stick', `${getComputedStyle(el).position === 'sticky' ? el.offsetHeight : 0}px`)
    const ro = new ResizeObserver(set)
    ro.observe(el)
    set()
    return () => ro.disconnect()
  }, [filters, searching, open])
  // the count, said a moment after the search or a filter settles (screen readers: what the list now holds)
  const n = f.found.length
  useEffect(() => {
    if (!filtered && !searching) return void setHeard('')
    const t = setTimeout(() => setHeard(plural(n)), 700)
    return () => clearTimeout(t)
  }, [n, filtered, searching])

  async function submit(e) {
    e.preventDefault()
    if (!link) return
    const text = q
    setQ('')
    const id = await pn.add(text)
    if (!id) return void setQ((cur) => cur || text) // (not kept: the link back in the box, to fix or retry)
    if (typeof id !== 'string') return
    setJust((j) => [id, ...j.filter((x) => x !== id)].slice(0, JUST_MAX))
    setFresh(id)
  }
  // the one just pinned: in sight (on top of the list, whatever the filters), a glow for a moment
  useEffect(() => {
    if (!fresh) return
    const raf = requestAnimationFrame(() => void justRef.current?.scrollIntoView({ block: 'nearest', behavior: motionOff() ? 'auto' : 'smooth' }))
    const t = setTimeout(() => setFresh(null), 2400)
    return () => (cancelAnimationFrame(raf), clearTimeout(t))
  }, [fresh])
  const justPins = just.map((id) => pins.find((p) => p.id === id)).filter(Boolean)
  const foundIds = useMemo(() => new Set(f.found.map((p) => p.id)), [f.found])
  const outside = (filtered || searching) && justPins.some((p) => !foundIds.has(p.id))

  const timeName = TIMES.find(([k]) => k === timeOn)?.[1]
  const partName = subOn && live.parts.find((x) => x.key === subOn)?.label
  const what = [siteOn && siteOf(siteOn)?.name, partName, timeOn !== 'any' && timeName, searching && `“${query}”`].filter(Boolean)
  // (nothing left: does the search find anything without the filters?)
  const alone = useMemo(() => (n === 0 && query && filtered ? facet(prep, { q: query }, now).found.length : 0), [n, query, filtered, prep, now])
  const where = whereOf(siteOn && siteOf(siteOn)?.name, partName, timeOn)
  const single = groups.length === 1 // (one section: all of it, no "Show more")
  const bare = single && !filters // (a handful of pins, one site: no head to fold)
  const keyOf = (g) => `${shapeLate}:${g.key}`
  const drawn = plan(groups.map((g) => g.pins.length), groups.map((g) => ({ open: single || opened.has(keyOf(g)), shut: shut.has(keyOf(g)) })), limit)
  // the list's end near (800 px): the next tiles
  const sentinel = useRef(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !drawn.more) return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setLimit((l) => l + RENDER_STEP), { root: scroller.current, rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [drawn.more, limit, open])
  const u = pn.undoing
  return (
    <section aria-labelledby="pn-title" className={`pn pn-main${typing ? ' is-typing' : ''}`}>
      <div className="pn-top">
        <div className="pn-head">
          <span className="pn-mark" aria-hidden="true"><Pin size={16} /></span>
          <div className="pn-title">
            <h2 id="pn-title">Pins</h2>
            <span className="pn-sub">{total ? `${total} kept` : 'none yet'}</span>
          </div>
          {filters && (
            <div className="pn-seg" role="group" aria-label="Group the pins" data-on={view}>
              <span className="slide" aria-hidden="true" />
              <button type="button" aria-pressed={view === 'site'} onClick={() => pickView('site')}>By site</button>
              <button type="button" aria-pressed={view === 'date'} onClick={() => pickView('date')}>By date</button>
            </div>
          )}
          <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>

        <form className="pn-box" role="search" onSubmit={submit}>
          <span className="pn-box-ic" aria-hidden="true">{link ? <Link2 size={16} /> : <Search size={16} />}</span>
          <input
            ref={box}
            className="pn-input"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            placeholder="Paste a link, or search"
            aria-label="Paste a link to pin it, or type to search your pins"
            enterKeyHint={link ? 'go' : 'search'}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {/* (a press on ✕ or Pin keeps the focus in the box: the keyboard stays up, the chips stay tucked away) */}
          {q ? (
            <button type="button" className="pn-clear" aria-label="Clear" onPointerDown={(e) => e.preventDefault()} onClick={() => (setQ(''), box.current?.focus())}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="pn-kbd" aria-hidden="true" title="Press / to search">/</kbd>
          )}
          <button type="submit" className="pn-add" disabled={!link} title={link ? 'Pin this link' : 'Paste a link to pin it'} onPointerDown={(e) => e.preventDefault()}>
            <Plus size={16} aria-hidden="true" /><span>Pin</span>
          </button>
        </form>
        {kept && <p className="pn-note soft">Already pinned: Enter moves it to the top</p>}
        {/* the live regions, always there (one mounted with its words is often missed): notes and removals; the count */}
        <p className="sr-only" role="status" aria-live="polite">{pn.said}</p>
        <p className="sr-only" role="status" aria-live="polite">{heard}</p>
      </div>

      <div ref={scroller} className="pn-scroll" data-scroll>
        {(filters || searching) && (
          <div ref={filtersRef} className="pn-filters">
            {filters && (
              <>
                <ChipRow
                  key={`sites-${clears}`}
                  label="Sites"
                  noun="sites"
                  max={TOP_SITES}
                  keep={siteOn}
                  items={prep.sites.map((s) => {
                    const c = f.sites[s.key] ?? 0
                    return {
                      key: s.key,
                      node: (
                        <button type="button" data-chip className={`pn-fchip${c ? '' : ' is-zero'}`} aria-pressed={siteOn === s.key} onClick={() => pickSite(s.key)} title={s.key} aria-label={`${s.name}, ${plural(c)}`}>
                          <Icon pin={{ icon: s.icon, domain: s.key }} size={14} />
                          <span className="pn-fchip-name">{s.name}</span>
                          <span className="n" aria-hidden="true">{c}</span>
                        </button>
                      ),
                    }
                  })}
                />
                {f.subs.length > 0 && (
                  <ChipRow
                    key={`${siteOn}-${clears}`}
                    label={`Parts of ${siteOf(siteOn)?.name}`}
                    className="is-sub"
                    noun="parts"
                    max={TOP_PARTS}
                    keep={subOn}
                    lead={<CornerDownRight size={14} className="pn-sub-ic" aria-hidden="true" />}
                    items={f.subs.map((s) => ({
                      key: s.key,
                      node: (
                        <button type="button" data-chip className={`pn-fchip is-small${s.n ? '' : ' is-zero'}`} aria-pressed={subOn === s.key} onClick={() => setSub((x) => (x === s.key ? null : s.key))} aria-label={`${s.label}, ${plural(s.n)}`}>
                          <span className="pn-fchip-name">{s.label}</span>
                          <span className="n" aria-hidden="true">{s.n}</span>
                        </button>
                      ),
                    }))}
                  />
                )}
                <ChipRow
                  label="Pinned"
                  items={TIMES.map(([k, label]) => ({
                    key: k,
                    node: (
                      <button type="button" data-chip className={`pn-fchip is-time${f.times[k] ? '' : ' is-zero'}`} aria-pressed={timeOn === k} onClick={() => setTime((t) => (t === k && k !== 'any' ? 'any' : k))} aria-label={`${label}, ${plural(f.times[k])}`}>
                        <span className="pn-fchip-name">{label}</span>
                        <span className="n" aria-hidden="true">{f.times[k]}</span>
                      </button>
                    ),
                  }))}
                />
              </>
            )}
            {/* (always there with the filters: what's on, so nothing under it moves when one is picked) */}
            <div className="pn-sum">
              <span>{[plural(n), ...what].join(' · ')}</span>
              {(filtered || searching) && <button type="button" className="pn-sum-clear" onClick={clearAll}>Clear</button>}
            </div>
          </div>
        )}
        {pn.adding.length > 0 && (
          <ul className="pn-grid pn-adding" aria-label="Being pinned">
            {pn.adding.map((a) => <PendingTile key={`add-${a.key}`} url={a.url} />)}
          </ul>
        )}
        {justPins.length > 0 && (
          <section ref={justRef} className="pn-sec pn-just" aria-label="Just pinned">
            <h3 className="pn-sec-head">
              <span className="pn-sec-row">
                <Sparkles size={16} className="pn-sec-cal" aria-hidden="true" />
                <span className="pn-sec-name">Just pinned</span>
                {outside && <span className="pn-sec-dom">not all in this view</span>}
                {outside ? <button type="button" className="pn-sum-clear" onClick={clearAll}>Show all</button> : <span className="pn-count" aria-hidden="true">{justPins.length}</span>}
              </span>
            </h3>
            <div className="pn-fold-in">
              <ul className="pn-grid">
                {justPins.map((p) => <Tile key={p.id} pin={p} fresh={fresh === p.id} onRemove={onRemove} onRefresh={onRefresh} refreshing={pn.refreshing === p.id} />)}
              </ul>
            </div>
          </section>
        )}
        {!open ? null : total === 0 && !pn.adding.length ? (
          <Empty />
        ) : n === 0 && total > 0 ? (
          <NoMatch query={query} filtered={filtered} where={where} alone={alone} onFilters={clearFilters} onSearch={() => (setQ(''), box.current?.focus())} onAll={clearAll} />
        ) : (
          <div className={`pn-list${stale ? ' is-stale' : ''}`}>
            {drawn.parts.map(({ take, cut }, i) => {
              const g = groups[i]
              const key = keyOf(g)
              const s = shapeLate === 'site' ? siteOf(g.key) : null
              return (
                <PinSection
                  key={key}
                  id={key}
                  head={shapeLate === 'site' ? <SiteHead site={s ?? { key: g.key, name: g.key }} /> : <DayHead day={g.key} now={now} />}
                  name={shapeLate === 'site' ? [s?.name ?? g.key, s && s.name !== g.key ? g.key : null].filter(Boolean).join(', ') : dayLabel(g.key, now)}
                  pins={g.pins}
                  take={take}
                  cut={cut}
                  days={shapeLate === 'site'}
                  bare={bare}
                  now={now}
                  shut={shut.has(key)}
                  onShut={() => toggle(setShut, key)}
                  open={single || opened.has(key)}
                  onOpen={single ? null : () => (toggle(setOpened, key), setLimit((l) => l + RENDER_STEP))}
                  q={query}
                  onRemove={onRemove}
                  onRefresh={onRefresh}
                  refreshing={pn.refreshing}
                />
              )
            })}
            {drawn.more && <div ref={sentinel} className="pn-sentinel" aria-hidden="true" />}
          </div>
        )}
      </div>

      {/* notes and the Undo float over the bottom of the list: nothing above them moves */}
      {(pn.note || u) && (
        <div className="pn-toasts">
          {pn.note && <p className="pn-note pn-toast">{pn.note}</p>}
          {u && (
            <div className="pn-undo pn-toast">
              <span className="ic" aria-hidden="true"><Trash2 size={15} /></span>
              <div className="msg">
                <span>Removed {linesOf(u.pin).title}</span>
                <small aria-hidden="true">undo for <UndoLeft until={u.until} />s</small>
              </div>
              <button type="button" className="pn-ghost" onClick={() => pn.undo()}>Undo</button>
              <UndoLine key={u.until} until={u.until} total={UNDO_MS} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function SiteHead({ site }) {
  return (
    <>
      <Icon pin={{ icon: site.icon, domain: site.key }} size={18} />
      <span className="pn-sec-name">{site.name}</span>
      {site.name !== site.key && <span className="pn-sec-dom">{site.key}</span>}
    </>
  )
}
function DayHead({ day, now }) {
  const label = dayLabel(day, now)
  return (
    <>
      <CalendarDays size={16} className="pn-sec-cal" aria-hidden="true" />
      <span className="pn-sec-name">{label}</span>
      {/* (Today / Yesterday: the date too) */}
      {(label === 'Today' || label === 'Yesterday') && <span className="pn-sec-dom">{dayDate(day, now)}</span>}
    </>
  )
}

// One site's or one day's pins: its head (sticky at the top of the list as it scrolls; a tap folds it away), the
// tiles, and "Show N more" when it's long. By site, the tiles flow on (two across where there's room) and the first of
// each day carries the day above it: date by date without a half-empty row under every day. bare: no head (one site,
// a handful of pins)
function PinSection({ id, head, name, pins, take, cut, days, bare, now, shut, onShut, open, onOpen, q, onRemove, onRefresh, refreshing }) {
  const ref = useRef(null)
  const list = pins.slice(0, take)
  const body = `pn-sec-${id.replace(/[^\w-]/g, '_')}`
  const less = () => {
    onOpen()
    // (back to its head when it was scrolled past: the rest folds up above the finger otherwise)
    const el = ref.current
    const sc = el?.closest('.pn-scroll')
    if (el && sc && el.getBoundingClientRect().top < sc.getBoundingClientRect().top) sc.scrollTo({ top: el.offsetTop - sc.offsetTop })
  }
  let last = null
  const tiles = (
    <>
      <ul className={`pn-grid${days ? ' is-days' : ''}`}>
        {list.map((p) => {
          const d = days ? dayKey(p.addedAt) : null
          const label = d && d !== last ? dayLabel(d, now) : null
          last = d
          return <Tile key={p.id} pin={p} q={q} day={label} onRemove={onRemove} onRefresh={onRefresh} refreshing={refreshing === p.id} />
        })}
      </ul>
      {onOpen && (open || (!cut && pins.length > shownOf(pins.length, false))) && (
        <button type="button" className="pn-more" aria-expanded={open} aria-controls={body} onClick={open ? less : onOpen}>
          {open ? 'Show fewer' : `Show ${pins.length - take} more`}
          <ChevronDown size={14} className={open ? 'pn-chev is-up' : 'pn-chev'} aria-hidden="true" />
        </button>
      )}
    </>
  )
  if (bare) return <section ref={ref} className="pn-sec is-bare"><div className="pn-fold-in">{tiles}</div></section>
  return (
    <section ref={ref} className={`pn-sec${shut ? ' is-shut' : ''}`}>
      <h3 className="pn-sec-head">
        <button type="button" aria-expanded={!shut} aria-controls={body} onClick={onShut} aria-label={`${name}, ${plural(pins.length)}`}>
          {head}
          <span className="pn-count" aria-hidden="true">{pins.length}</span>
          <ChevronDown size={16} className="pn-chev" aria-hidden="true" />
        </button>
      </h3>
      <div className="pn-fold" id={body}>
        <div className="pn-fold-in" inert={shut}>{tiles}</div>
      </div>
    </section>
  )
}

// Nothing left by the search and the filters: what's on, and the way out that leaves the most. Both on: the search
// alone, if it finds something without the filters (n: how many), else the search goes; and "Clear all"
function NoMatch({ query, filtered, where, alone, onFilters, onSearch, onAll }) {
  const both = Boolean(query && filtered)
  const line = both
    ? alone
      ? `Nothing ${where} matches “${query}”: ${alone} without the filters`
      : `Nothing matches “${query}”, with or without the filters`
    : query
      ? `Nothing matches “${query}”`
      : `Nothing ${where}`
  return (
    <div className="pn-empty pn-nomatch">
      <span className="pn-nomatch-ic" aria-hidden="true"><SearchX size={18} /></span>
      <p>No pins match</p>
      <small>{line}</small>
      <div className="pn-nomatch-acts">
        {both && alone > 0 && <button type="button" className="pn-ghost is-on" onClick={onFilters}>Clear filters</button>}
        {both && !alone && <button type="button" className="pn-ghost is-on" onClick={onSearch}>Clear search</button>}
        {both && <button type="button" className="pn-ghost" onClick={onAll}>Clear all</button>}
        {!both && <button type="button" className="pn-ghost is-on" onClick={query ? onSearch : onFilters}>{query ? 'Clear search' : 'Clear filters'}</button>}
      </div>
    </div>
  )
}

// ---- links on habits and reminders ----

// The pins on a habit / reminder (to: { kind, id }), as small chips: each opens its link in a new tab. Nothing when
// there are none (or this isn't the owner's page)
export function PinChips({ pn, to, className = '' }) {
  if (!pn?.on) return null
  const list = pn.linked(to.kind, to.id)
  if (!list.length) return null
  return (
    <ul className={`pn-chips ${className}`} aria-label="Links">
      {list.map((p) => (
        <li key={p.id}>
          <a className="pn-chip" href={p.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={p.title ? `${p.title} · ${p.domain}` : p.url}>
            <Icon pin={p} size={12} />
            <span>{linesOf(p).title}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

// The button that opens the picker for a habit / reminder (label: its name). With some linked, it shows how many
export function LinkButton({ pn, to, label, className = '', text = false }) {
  if (!pn?.on) return null
  const n = pn.linked(to.kind, to.id).length
  return (
    <button
      type="button"
      className={`pn-linkbtn${n ? ' has-links' : ''}${text ? ' is-text' : ''} ${className}`}
      aria-haspopup="dialog"
      aria-label={n ? `Links for ${label}: ${n}. Change them` : `Link a pin to ${label}`}
      title={n ? `${n} link${n === 1 ? '' : 's'}: change them` : 'Link a pin'}
      onClick={() => pn.pick(to, label)}
    >
      <Link2 size={14} aria-hidden="true" />
      {text ? <span>{n ? `Links (${n})` : 'Add links'}</span> : n > 0 && <span>{n}</span>}
    </button>
  )
}

// The one picker for the page (pn.pick opens it, for one habit / reminder): the box searches the pins, or pins a pasted
// link straight onto it; a tap on a pin ticks it on or off. The linked ones come first. It opens over whatever sheet
// it was opened from (the routines, the reminders), and goes back to it
export function LinkPicker({ pn }) {
  const dlg = useRef(null)
  const open = Boolean(pn.on && pn.picking)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) closeDialog(d)
  }, [open])
  const close = () => closeDialog(dlg.current)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="pn-pick-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => (delete dlg.current.dataset.closing, pn.unpick())}
      className="wx-sheet sm:max-w-lg glass-panel text-lofi-text overscroll-contain"
    >
      {open && <PickerBody key={`${pn.picking.to.kind}:${pn.picking.to.id}`} pn={pn} to={pn.picking.to} label={pn.picking.label} onClose={close} />}
    </dialog>
  )
}

function PickerBody({ pn, to, label, onClose }) {
  const [q, setQ] = useState('')
  const box = useRef(null)
  const linked = pn.linked(to.kind, to.id)
  const on = new Set(linked.map((p) => p.id))
  // (the order as it opened: a pin ticked on doesn't jump to the top under the finger)
  const [order] = useState(() => on)
  const pins = pn.data.pins.filter((p) => !pn.hidden(p.id))
  const link = looksLikeLink(q)
  const found = link || !q.trim() ? pins : pins.filter((p) => matches(p, q))
  const list = [...found.filter((p) => order.has(p.id)), ...found.filter((p) => !order.has(p.id))]
  const full = linked.length >= (pn.data.maxLinks ?? MAX_LINKS)
  const kept = link ? pins.find((p) => p.url === cleanUrl(q).url) : null

  async function submit(e) {
    e.preventDefault()
    if (!link) return
    const text = q
    setQ('')
    if (!(await pn.add(text, to))) setQ((cur) => cur || text)
  }
  const what = to.kind === 'habit' ? 'routine' : 'reminder'
  return (
    <section aria-labelledby="pn-pick-title" className="p-5 sm:p-6 pn">
      <div className="pn-head">
        <span className="pn-mark" aria-hidden="true"><Link2 size={16} /></span>
        <div className="pn-title">
          <h2 id="pn-pick-title">Links</h2>
          <span className="pn-sub pn-pick-for" title={label}>{label}</span>
        </div>
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>

      <form className="pn-box" role="search" onSubmit={submit}>
        <span className="pn-box-ic" aria-hidden="true">{link ? <Link2 size={16} /> : <Search size={16} />}</span>
        <input
          ref={box}
          className="pn-input"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && q && (e.preventDefault(), setQ(''))}
          placeholder="Paste a link or search"
          aria-label={`Paste a link to pin it onto this ${what}, or type to search your pins`}
          enterKeyHint={link ? 'go' : 'search'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {q && (
          <button type="button" className="pn-clear" aria-label="Clear" onClick={() => (setQ(''), box.current?.focus())}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
        <button type="submit" className="pn-add" disabled={!link || (full && !(kept && on.has(kept.id)))} title={link ? 'Pin and link it' : 'Paste a link to pin it here'}>
          <Plus size={16} aria-hidden="true" /><span>Link</span>
        </button>
      </form>
      {kept && <p className="pn-note soft">{on.has(kept.id) ? 'Already linked here' : full ? 'Already pinned' : 'Already pinned: Enter links it'}</p>}
      <p className="sr-only" role="status" aria-live="polite">{pn.said}</p>
      {pn.note && <p className="pn-note">{pn.note}</p>}
      {full && <p className="pn-note soft">{linked.length} linked: the most one {what} can have</p>}

      {pins.length === 0 && !pn.adding.length ? (
        <div className="pn-empty"><p>No pins yet</p><small>Paste a link above: it's pinned and linked here.</small></div>
      ) : list.length === 0 && !pn.adding.length ? (
        <p className="pn-none">No pin matches “{q.trim()}”</p>
      ) : (
        <ul className="pn-picks" data-scroll>
          {pn.adding.map((a) => (
            <li key={`add-${a.key}`} className="pn-pick is-pending" aria-busy="true">
              <span className="pn-pick-ic sk-pulse" />
              <span className="pn-pick-text"><span className="pn-name">{a.url.replace(/^https?:\/\/(www\.)?/, '')}</span><span className="pn-pick-dom">fetching its preview…</span></span>
            </li>
          ))}
          {list.map((p) => {
            const is = on.has(p.id)
            return (
              <li key={p.id}>
                <button type="button" className={`pn-pick${is ? ' is-on' : ''}`} aria-pressed={is} disabled={!is && full} onClick={() => (is ? pn.unlink(p, to) : pn.link(p, to))}>
                  <Icon pin={p} size={18} />
                  <span className="pn-pick-text">
                    <span className="pn-name">{linesOf(p).title}</span>
                    <span className="pn-pick-dom">{linesOf(p).meta}</span>
                  </span>
                  <span className="pn-pick-tick" aria-hidden="true">{is && <Check size={14} strokeWidth={2.6} />}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="pn-pick-foot">
        <span className="pn-sub">{linked.length ? `${linked.length} linked` : 'none linked yet'}</span>
        <button type="button" className="hb-btn primary" onClick={onClose}>Done</button>
      </div>
    </section>
  )
}
