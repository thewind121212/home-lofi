'use client'

// Pins: links the owner keeps, each with its preview, newest first: an icon next to the header's bell, the pins in a sheet. Rules in lib/pins.js; the route is
// app/api/private/settings/pins (owner-only: guests get 404 / 403 and never see the card).
// - One box does both: typing searches the pins as you go (title, description, site, link; no case, no accents), and
//   a link ("https://…", "www.…") is pinned with Enter or the Pin button. The server fetches its preview meanwhile (a
//   pending tile); a link it won't or can't fetch (a LAN address, too slow, not a page) is kept anyway, with why.
// - The newest SHOWN as tiles, "Show all (N)" for the rest; ✕ removes one, with a short Undo.
// - Pictures come straight from the sites (no referrer, lazy); a broken one gives way to a tile with the site's icon
//   or its first letter.
// - Links: a pin can go on habits and reminders (several on one): their small chips there open it (PinChips), and the
//   picker (LinkPicker, one for the page, opened with pn.pick) ticks pins on and off, or pins a pasted link onto it.
// - The owner's other tabs follow on the live stream ('pins': pull).
import './pins.css'
import { useEffect, useRef, useState } from 'react'
import { Check, Link2, Pin, Plus, RotateCw, Search, Trash2, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { Bone } from './skeleton'
import { closeDialog, useStillPage } from './settings'
import { MAX_LINKS, REASONS, SHOWN, UNDO_MS, cleanUrl, linkedTo, looksLikeLink, matches } from '../lib/pins'
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
    // a link -> true once it's kept (or was already), false if not (the note says why). to: linked onto that habit /
    // reminder too ({ kind, id })
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
        return Boolean(j)
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
      say(`Removed ${pin.title ?? pin.domain}. Undo is there for a few seconds.`)
      enqueue(() => call('DELETE', { id: pin.id }))
        .then(() => ungone(pin.id))
        .catch((e) => (ungone(pin.id), setUndoing((u) => (u?.pin.id === pin.id ? null : u)), failed(e, 'remove it')))
    },
    undo() {
      const u = undoing
      if (!u) return
      setUndoing(null)
      ungone(u.pin.id)
      say(`${u.pin.title ?? u.pin.domain} is back`)
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

function Tile({ pin, onRemove, onRefresh, refreshing }) {
  const name = pin.title ?? pin.domain
  const desc = pin.description ?? (pin.ok ? null : `No preview: ${REASONS[pin.reason] ?? REASONS.unreachable}`)
  return (
    <li className={`pn-tile${pin.ok ? '' : ' is-bare'}`}>
      <a className="pn-link" href={pin.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={pin.url}>
        <Thumb pin={pin} />
        <span className="pn-text">
          <span className="pn-name">{name}</span>
          <span className="pn-desc">{desc ?? pin.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
          <span className="pn-dom">
            {pin.image && <Icon pin={pin} size={12} />}
            <span>{pin.site && pin.site.toLowerCase() !== pin.domain ? `${pin.site} · ${pin.domain}` : pin.domain}</span>
          </span>
        </span>
      </a>
      <div className="pn-acts">
        {!pin.ok && (
          <button type="button" className="pn-act" aria-label={`Fetch the preview of ${name} again`} title="Try the preview again" disabled={refreshing} onClick={() => onRefresh(pin)}>
            <span className="dot"><RotateCw size={13} className={refreshing ? 'pn-spin' : ''} aria-hidden="true" /></span>
          </button>
        )}
        <button type="button" className="pn-act" aria-label={`Remove ${name}`} title="Remove" onClick={() => onRemove(pin)}>
          <span className="dot"><X size={14} aria-hidden="true" /></span>
        </button>
      </div>
    </li>
  )
}

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

// All of them in a sheet (opened from its header icon): the box (paste a link, or search), the tiles, ✕ with Undo
export function PinsSheet({ pn, dlg }) {
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  const close = () => closeDialog(dlg.current)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="pn-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => delete dlg.current.dataset.closing}
      className="wx-sheet sm:max-w-2xl glass-panel text-lofi-text overscroll-contain"
    >
      {pn.on && <PinsBody pn={pn} onClose={close} />}
    </dialog>
  )
}

function PinsBody({ pn, onClose }) {
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const box = useRef(null)
  // (the one being removed stays out while its Undo shows, whatever a pull brings meanwhile)
  const pins = pn.data.pins.filter((p) => !pn.hidden(p.id))
  const link = looksLikeLink(q)
  const found = link || !q.trim() ? pins : pins.filter((p) => matches(p, q)) // (500 at most: as you type is fine)
  const shown = all ? found : found.slice(0, SHOWN)
  const total = pins.length
  const kept = link ? pins.find((p) => p.url === cleanUrl(q).url) : null

  async function submit(e) {
    e.preventDefault()
    if (!link) return
    const text = q
    setQ('')
    if (!(await pn.add(text))) setQ((cur) => cur || text) // (not kept: the link back in the box, to fix or retry)
  }
  const u = pn.undoing
  return (
    <section aria-labelledby="pn-title" className="p-5 sm:p-6 pn">
      <div className="pn-head">
        <span className="pn-mark" aria-hidden="true"><Pin size={16} /></span>
        <div className="pn-title">
          <h2 id="pn-title">Pins</h2>
          <span className="pn-sub">{total ? `${total} kept` : 'none yet'}</span>
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
          placeholder="Paste a link, or search"
          aria-label="Paste a link to pin it, or type to search your pins"
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
        <button type="submit" className="pn-add" disabled={!link} title={link ? 'Pin this link' : 'Paste a link to pin it'}>
          <Plus size={16} aria-hidden="true" /><span>Pin</span>
        </button>
      </form>
      {kept && <p className="pn-note soft">Already pinned: Enter moves it to the top</p>}
      {/* the one live region, always there (one mounted with its words is often missed): notes, removals */}
      <p className="sr-only" role="status" aria-live="polite">{pn.said}</p>
      {pn.note && <p className="pn-note">{pn.note}</p>}
      {u && (
        <div className="pn-undo">
          <span className="ic" aria-hidden="true"><Trash2 size={15} /></span>
          <div className="msg">
            <span>Removed {u.pin.title ?? u.pin.domain}</span>
            <small aria-hidden="true">undo for <UndoLeft until={u.until} />s</small>
          </div>
          <button type="button" className="pn-ghost" onClick={() => pn.undo()}>Undo</button>
          <UndoLine key={u.until} until={u.until} total={UNDO_MS} />
        </div>
      )}

      {total === 0 && !pn.adding.length ? (
        <Empty />
      ) : found.length === 0 && !pn.adding.length ? (
        <p className="pn-none">No pin matches “{q.trim()}”</p>
      ) : (
        <ul className="pn-grid">
          {pn.adding.map((a) => <PendingTile key={`add-${a.key}`} url={a.url} />)}
          {shown.map((p) => (
            <Tile key={p.id} pin={p} onRemove={pn.remove} onRefresh={pn.refresh} refreshing={pn.refreshing === p.id} />
          ))}
        </ul>
      )}
      {found.length > SHOWN && (
        <button type="button" className="pn-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all (${found.length})`}
        </button>
      )}
    </section>
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
            <span>{p.title ?? p.domain}</span>
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
                    <span className="pn-name">{p.title ?? p.domain}</span>
                    <span className="pn-pick-dom">{p.domain}</span>
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
