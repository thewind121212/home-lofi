'use client'

// The Pins card: links the owner keeps, each with its preview, newest first. Rules in lib/pins.js; the route is
// app/api/private/settings/pins (owner-only: guests get 404 / 403 and never see the card).
// - One box does both: typing searches the pins as you go (title, description, site, link; no case, no accents), and
//   a link ("https://…", "www.…") is pinned with Enter or the Pin button. The server fetches its preview meanwhile (a
//   pending tile); a link it won't or can't fetch (a LAN address, too slow, not a page) is kept anyway, with why.
// - The newest SHOWN as tiles, "Show all (N)" for the rest; ✕ removes one, with a short Undo.
// - Pictures come straight from the sites (no referrer, lazy); a broken one gives way to a tile with the site's icon
//   or its first letter.
// - The owner's other tabs follow on the live stream ('pins': pull).
import './pins.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Pin, Plus, RotateCw, Search, Trash2, X } from 'lucide-react'
import { Bone, rememberShape } from './skeleton'
import { SK_MAX } from '../lib/skeleton'
import { REASONS, SHOWN, UNDO_MS, cleanUrl, looksLikeLink, matches } from '../lib/pins'

const URL_ = '/api/private/settings/pins'
const NOTE_MS = 6000

// ---- state: the server's, with the device only drawing it ----

// owner: settings sync answered as the owner (the page's `owner`); clientId(): this tab's live-stream id (its own
// changes aren't echoed back). -> { on, pending, data, adding, refreshing, undoing, note, add, remove, undo, refresh, live }
export function usePins(owner, clientId) {
  const [data, setData] = useState(null)
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false) // a load was tried (so a failed one ends the skeleton)
  const [adding, setAdding] = useState([]) // [{ key, url }]: links whose preview is on its way (a pending tile each)
  const [refreshing, setRefreshing] = useState(null) // the pin whose preview is fetched again
  const [undoing, setUndoing] = useState(null) // { pin, index, until }: the Undo bar (the pin is gone from the list)
  const [note, setNote] = useState(null)
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
    if (r.status === 404 || r.status === 403) {
      setOff(true)
      setData(null)
      return null
    }
    const j = await r.json().catch(() => null)
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

  const failed = (e, what) => {
    if (e?.status === 400 || e?.status === 409 || e?.status === 429) setNote(e.message.charAt(0).toUpperCase() + e.message.slice(1))
    else {
      setNote(`Couldn't ${what}: check the connection and try again`)
      api.current.pull?.()
    }
  }
  const why = (reason) => REASONS[reason] ?? REASONS.unreachable

  return {
    on: Boolean(owner && data && !off),
    pending: Boolean(owner && !data && !off && !tried), // the owner's first load is on its way: the skeleton
    data,
    adding,
    refreshing,
    undoing,
    note,
    // 'pins': another tab changed something; 'hello': the stream (re)connected, a pull unless one just went out
    live: (kind) => (kind === 'pins' || (kind === 'hello' && Date.now() - seq.current.at > 3000)) && api.current.live?.(),
    // a link -> true once it's kept (or was already), false if not (the note says why)
    async add(text) {
      const c = cleanUrl(text)
      if (c.error) {
        setNote(`That link won't do: ${c.error.replace(/^url: /, '')}`)
        return false
      }
      const key = ++seq.current.key
      setAdding((a) => [{ key, url: c.url }, ...a])
      try {
        const j = await enqueue(() => call('POST', { url: c.url }))
        if (j?.dup) setNote('Already pinned: moved it to the top')
        else if (j && !j.ok) setNote(`Pinned without a preview: ${why(j.reason)}`)
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
      // gone from the list at once (the card hides it while its Undo shows, whatever a pull says meanwhile)
      setUndoing({ pin, index, until: Date.now() + UNDO_MS })
      enqueue(() => call('DELETE', { id: pin.id })).catch((e) => (setUndoing(null), failed(e, 'remove it')))
    },
    undo() {
      const u = undoing
      if (!u) return
      setUndoing(null)
      setData((d) => (d && !d.pins.some((p) => p.id === u.pin.id) ? { ...d, pins: [...d.pins.slice(0, u.index), u.pin, ...d.pins.slice(u.index)] } : d))
      enqueue(() => call('POST', { action: 'undo', id: u.pin.id })).catch((e) => failed(e, 'bring it back'))
    },
    async refresh(pin) {
      setRefreshing(pin.id)
      try {
        const j = await enqueue(() => call('POST', { action: 'refresh', id: pin.id }))
        if (j && !j.ok) setNote(`Still no preview: ${why(j.reason)}`)
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
            <RotateCw size={13} className={refreshing ? 'pn-spin' : ''} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="pn-act" aria-label={`Remove ${name}`} title="Remove" onClick={() => onRemove(pin)}>
          <X size={14} aria-hidden="true" />
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

// ---- the card ----

// The card while it's on its way: its own parts with stand-ins. The pre-paint stylesheet (lib/skeleton.js) shows it
// only on the owner's browser, with as many tiles as it showed last time (its empty box for none, "Show all" if
// there was one); every tile is the same height, so that's the card's height at any width
const SK_PN = Array.from({ length: SK_MAX.pins }, (_, i) => i)
function PinsSkeleton({ force }) {
  return (
    <section aria-label="Pins" aria-busy="true" className={`glass-panel rounded-3xl p-4 sm:p-5 pn sk-owner ${force ? 'sk-force' : ''}`}>
      <span className="sr-only">Loading pins…</span>
      <div className="pn-head" aria-hidden="true">
        <span className="pn-mark"><Pin size={16} /></span>
        <div className="pn-title">
          <h2>Pins</h2>
          <span className="pn-sub"><Bone w="8ch" /></span>
        </div>
      </div>
      <div className="pn-box sk-pulse" aria-hidden="true">
        <span className="pn-box-ic"><Search size={16} /></span>
        <span className="pn-input" />
        <span className="pn-add" data-off=""><Plus size={16} /><span>Pin</span></span>
      </div>
      <ul className="pn-grid sk-pn-grid" aria-hidden="true">
        {SK_PN.map((i) => (
          <li key={i} data-sk-pin={i} className="pn-tile">
            <div className="pn-link">
              <span className="pn-thumb sk-pulse" />
              <span className="pn-text">
                <span className="pn-name"><Bone w="14ch" /></span>
                <span className="pn-desc"><Bone w="90%" /><br /><Bone w="60%" /></span>
                <span className="pn-dom"><span><Bone w="10ch" /></span></span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <Empty className="sk-pn-empty" />
      <span className="pn-more sk-pn-more" aria-hidden="true"><Bone w="11ch" /></span>
    </section>
  )
}

function Empty({ className = '' }) {
  return (
    <div className={`pn-empty ${className}`}>
      <p>Nothing pinned yet</p>
      <small>Paste a link above: its picture, title and a line about it stay here, searchable.</small>
    </div>
  )
}

// pn: usePins(). Nothing at all unless the server said this is the owner and answered.
// wait: the owner's card may be on its way (owner not known yet, or the first load), so its skeleton keeps the place;
// force: it surely is (the owner), whatever the remembered shape says
export function PinsCard({ pn, wait = false, force = false }) {
  if (!pn.on) return wait ? <PinsSkeleton force={force} /> : null
  return <PinsBody pn={pn} />
}

function PinsBody({ pn }) {
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const box = useRef(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!pn.undoing) return
    const t = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(t)
  }, [pn.undoing])
  // (the one being removed stays out while its Undo shows, whatever a pull brings meanwhile)
  const pins = useMemo(() => pn.data.pins.filter((p) => p.id !== pn.undoing?.pin.id), [pn.data, pn.undoing])
  const link = looksLikeLink(q)
  const found = useMemo(() => (link || !q.trim() ? pins : pins.filter((p) => matches(p, q))), [pins, q, link])
  const shown = all ? found : found.slice(0, SHOWN)
  const total = pins.length
  const kept = link ? pins.find((p) => p.url === cleanUrl(q).url) : null
  // the next visit's skeleton: how many tiles, and whether there's a "Show all"
  useEffect(() => rememberShape({ pins: Math.min(total, SHOWN), pinsMore: total > SHOWN }), [total])

  async function submit(e) {
    e.preventDefault()
    if (!link) return
    const text = q
    setQ('')
    if (!(await pn.add(text))) setQ((cur) => cur || text) // (not kept: the link back in the box, to fix or retry)
  }
  const u = pn.undoing
  const left = u ? Math.max(0, u.until - Date.now()) : 0
  return (
    <section aria-labelledby="pn-title" className="glass-panel rounded-3xl p-4 sm:p-5 pn">
      <div className="pn-head">
        <span className="pn-mark" aria-hidden="true"><Pin size={16} /></span>
        <div className="pn-title">
          <h2 id="pn-title">Pins</h2>
          <span className="pn-sub">{total ? `${total} kept` : 'none yet'}</span>
        </div>
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
          maxLength={2048}
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
      {pn.note && <p className="pn-note" role="status">{pn.note}</p>}
      {u && (
        <div className="pn-undo" role="status">
          <span className="ic" aria-hidden="true"><Trash2 size={15} /></span>
          <div className="msg">
            <span>Removed {u.pin.title ?? u.pin.domain}</span>
            <small>undo for {Math.ceil(left / 1000)}s</small>
          </div>
          <button type="button" className="pn-ghost" onClick={() => pn.undo()}>Undo</button>
          <span className="bar" style={{ transform: `scaleX(${left / UNDO_MS})` }} />
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
