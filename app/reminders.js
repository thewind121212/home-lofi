'use client'

// Reminders: the owner's short list of things not to forget, carried from day to day until each is done. Rules in
// lib/reminders.js; the route is app/api/private/settings/reminders (owner-only: guests get 404 / 403 and see nothing).
// - The card (the middle column, under Habits): the open ones, an add field, hold to mark one done, and a quiet
//   two-tap delete for a mistaken entry (not "done": it never was).
// - The pop-up: from 06:00 (the server's clock in the owner's zone: its answer says `due`; the page never decides by
//   the device's clock) while anything is open, a panel floats over the dashboard (bottom left; on a phone beside the
//   dock). It has no close button: it goes when the last one is held done. It can be tucked into a pill for a while
//   (TUCK_MS) or until the next load, never dismissed.
// - Done is a hold (Habits' ring, app/habits.js HoldRing: keyboard Space / Enter held, a buzz, reduced motion kept),
//   then the row folds away; Undo right after (UNDO_MS).
// - The owner's other tabs follow on the live stream ('reminders': pull).
import './reminders.css'
import { useEffect, useRef, useState } from 'react'
import { BellRing, Check, ChevronDown, ChevronUp, ListTodo, Plus, Trash2 } from 'lucide-react'
import { HoldRing } from './habits'
import { Bone, rememberShape } from './skeleton'
import { SK_MAX } from '../lib/skeleton'
import { localNow } from '../lib/habits'
import { MAX_TEXT, UNDO_MS, carried } from '../lib/reminders'
import { motionOff } from './settings'

const URL_ = '/api/private/settings/reminders'
const TUCK_MS = 10 * 60_000 // tucked into its pill, the pop-up opens again after this
const LEAVE_MS = 420 // a row folding away
const still = () => motionOff() || matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---- state: the server's, with the device only drawing it ----

// owner: settings sync answered as the owner (the page's `owner`); clientId(): this tab's live-stream id.
// -> { on, pending, data, note, undoing, panel ('none' | 'pill' | 'open'), live, add, done, undo, remove, tuck, untuck }
export function useReminders(owner, clientId) {
  const [data, setData] = useState(null)
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false) // a load was tried (so a failed one ends the skeleton)
  const [note, setNote] = useState(null)
  const [undoing, setUndoing] = useState(null) // { item, until }: the Undo bar
  const [tucked, setTucked] = useState(false) // in memory only: a reload opens it again
  const skew = useRef(0) // the server's clock minus this device's
  const api = useRef({})
  const seq = useRef({ sent: 0, shown: 0, at: 0 }) // an older answer landing later is out of date
  // one request at a time, in order (an undo never overtakes its done), and one that fails doesn't hold up the next
  const queue = useRef(Promise.resolve())
  const enqueue = (fn) => (queue.current = queue.current.catch(() => {}).then(fn))
  const dataRef = useRef(data)
  dataRef.current = data
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  const take = (s) => {
    if (!s || !Array.isArray(s.items)) return
    if (Number.isFinite(s.at)) skew.current = s.at - Date.now()
    setData(s)
  }
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
    if (n >= seq.current.shown) {
      seq.current.shown = n
      take(j)
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
    // 06:00 or a new day coming round (by the server's clock) while the page stays open: ask the server, which decides
    const t = setInterval(() => {
      const d = dataRef.current
      if (!d) return
      const now = localNow(Date.now() + skew.current, d.tz)
      if (now.day !== d.today || (!d.due && now.min >= d.from)) pull()
    }, 15_000)
    return () => {
      on = false
      clearTimeout(soon)
      clearInterval(t)
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
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])
  useEffect(() => {
    if (!undoing) return
    const t = setTimeout(() => setUndoing(null), Math.max(0, undoing.until - Date.now()))
    return () => clearTimeout(t)
  }, [undoing])
  useEffect(() => {
    if (!tucked) return
    const t = setTimeout(() => setTucked(false), TUCK_MS)
    return () => clearTimeout(t)
  }, [tucked])

  // what this tab shows until the server answers (the answer replaces it)
  const patch = (fn) => setData((d) => d && { ...d, items: fn(d.items) })
  const fail = (e) => {
    if (e?.status === 409) setNote(e.message.charAt(0).toUpperCase() + e.message.slice(1))
    else {
      setNote("Couldn't save that: check the connection and try again")
      api.current.pull?.()
    }
  }
  const items = data?.items ?? []
  const on = Boolean(owner && data && !off)
  // the pop-up: the server says it's due and something is open (or the last one was just done: its Undo, briefly).
  // All done, it shows open (the "all clear" with its Undo) even when tucked
  const panel = !on || !data.due || (!items.length && !undoing) ? 'none' : tucked && items.length ? 'pill' : 'open'

  return {
    on,
    pending: Boolean(owner && !data && !off && !tried), // the owner's first load is on its way: the skeleton
    data,
    note,
    undoing,
    panel,
    // 'reminders': another tab changed something; 'hello': the stream (re)connected, a pull unless one just went out
    live: (kind) => (kind === 'reminders' || (kind === 'hello' && Date.now() - seq.current.at > 3000)) && api.current.live?.(),
    // -> null (added) or what was wrong
    async add(text) {
      try {
        await enqueue(() => call('POST', { action: 'add', text }))
        return null
      } catch (e) {
        return e?.status === 400 || e?.status === 409 ? e.message.charAt(0).toUpperCase() + e.message.slice(1) : "Couldn't add it: check the connection and try again"
      }
    },
    done(item) {
      patch((list) => list.filter((i) => i.id !== item.id))
      setUndoing({ item, until: Date.now() + UNDO_MS })
      enqueue(() => call('POST', { action: 'done', id: item.id })).catch((e) => (setUndoing(null), fail(e)))
    },
    undo() {
      const u = undoing
      if (!u) return
      setUndoing(null)
      patch((list) => [...list.filter((i) => i.id !== u.item.id), u.item].sort((a, b) => a.at - b.at))
      enqueue(() => call('POST', { action: 'undo', id: u.item.id })).catch(fail)
    },
    remove(item) {
      patch((list) => list.filter((i) => i.id !== item.id))
      enqueue(() => call('DELETE', { id: item.id })).catch(fail)
    },
    tuck: () => setTucked(true),
    untuck: () => setTucked(false),
  }
}

// ---- rows ----

// The list as drawn: the items, plus the ones just gone (done here, or on another tab) folding away where they were
function useLeaving(items) {
  const [st, setSt] = useState(() => ({ src: items, rows: items.map((item) => ({ item, leaving: false })) }))
  let rows = st.rows
  if (st.src !== items) {
    const keep = new Set(items.map((i) => i.id))
    rows = items.map((item) => ({ item, leaving: false }))
    if (!still()) st.rows.forEach((r, i) => !keep.has(r.item.id) && rows.splice(Math.min(i, rows.length), 0, { item: r.item, leaving: true }))
    setSt({ src: items, rows }) // (during render: React redraws at once, before anything is painted)
  }
  const leaving = rows.some((r) => r.leaving)
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setSt((s) => ({ ...s, rows: s.rows.filter((r) => !r.leaving) })), LEAVE_MS)
    return () => clearTimeout(t)
  }, [st, leaving])
  return rows
}

const ageText = (n) => (n <= 0 ? 'added today' : n === 1 ? 'since yesterday' : `carried ${n} days`)

// One reminder: its text, how long it's been carried, the ring to hold. onRemove: the card's quiet delete (two taps)
function Row({ item, today, leaving, onDone, onRemove }) {
  const [holding, setHolding] = useState(false)
  const [sure, setSure] = useState(false) // the trash was tapped once: the second tap deletes
  useEffect(() => {
    if (!sure) return
    const t = setTimeout(() => setSure(false), 4000)
    return () => clearTimeout(t)
  }, [sure])
  const age = carried(item, today)
  return (
    <li className={`rm-row${holding ? ' is-holding' : ''}${leaving ? ' is-leaving' : ''}${age > 0 ? ' is-carried' : ''}`} aria-hidden={leaving || undefined}>
      <div className="rm-row-in">
        <div className="rm-text">
          <p title={item.text}>{item.text}</p>
          <small>{holding ? 'keep holding: done when the ring fills' : ageText(age)}</small>
        </div>
        {onRemove && (
          <button
            type="button"
            className={`rm-trash${sure ? ' is-sure' : ''}`}
            aria-label={sure ? `Really delete: ${item.text}` : `Delete (a mistake, not done): ${item.text}`}
            title={sure ? 'Tap again to delete' : 'Delete (added by mistake)'}
            disabled={leaving}
            onClick={() => (sure ? onRemove(item) : setSure(true))}
          >
            <Trash2 size={14} aria-hidden="true" />
            {sure && <span>Delete?</span>}
          </button>
        )}
        <HoldRing label={`Hold when done: ${item.text}`} onHolding={setHolding} onDone={() => onDone(item)} />
      </div>
    </li>
  )
}

function UndoBar({ rm }) {
  const [, tick] = useState(0)
  const u = rm.undoing
  useEffect(() => {
    if (!u) return
    const t = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(t)
  }, [u])
  if (!u) return null
  const left = Math.max(0, u.until - Date.now())
  return (
    <div className="hb-undo rm-undo" role="status">
      <span className="ic" aria-hidden="true"><Check size={16} strokeWidth={2.4} /></span>
      <div className="msg">
        <span className="rm-undo-text">Done: {u.item.text}</span>
        <small>undo for {Math.ceil(left / 1000)}s</small>
      </div>
      <button type="button" className="hb-ghost warm" onClick={() => rm.undo()}>Undo</button>
      <span className="bar" style={{ transform: `scaleX(${left / UNDO_MS})` }} />
    </div>
  )
}

// the add field: Enter or the button. The text stays if it didn't go through
function AddForm({ rm, compact = false }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const full = (rm.data?.items.length ?? 0) >= (rm.data?.max ?? Infinity)
  async function submit(e) {
    e.preventDefault()
    if (!text.trim() || busy || full) return
    setBusy(true)
    const e2 = await rm.add(text)
    setBusy(false)
    setErr(e2)
    if (!e2) setText('')
  }
  return (
    <form className={`rm-add${compact ? ' is-compact' : ''}`} onSubmit={submit}>
      <div className="rm-add-row">
        <input
          className="rm-input"
          aria-label="New reminder"
          placeholder={full ? 'The list is full: get some done first' : compact ? 'Add one…' : 'Add a reminder…'}
          maxLength={MAX_TEXT}
          value={text}
          onChange={(e) => (setText(e.target.value), err && setErr(null))}
          enterKeyHint="done"
          autoComplete="off"
          disabled={full}
        />
        <button type="submit" className="rm-addbtn" aria-label="Add reminder" disabled={!text.trim() || busy || full}>
          <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
          {!compact && <span>Add</span>}
        </button>
      </div>
      {err && <p className="hb-note" role="alert">{err}</p>}
    </form>
  )
}

// ---- the card ----

// The card while it's on its way: its own parts with stand-ins. The pre-paint stylesheet (lib/skeleton.js) shows it
// only on the owner's browser, with as many rows as were open last time (none: the "nothing left" line) and, at the
// same window width, the height the card had
const SK_TD = Array.from({ length: SK_MAX.todos }, (_, i) => i)
function RemindersSkeleton({ force }) {
  return (
    <section aria-label="Reminders" aria-busy="true" className={`glass-panel rounded-3xl p-4 sm:p-5 rm sk-owner sk-td-card ${force ? 'sk-force' : ''}`}>
      <span className="sr-only">Loading reminders…</span>
      <div className="rm-head" aria-hidden="true">
        <span className="rm-well"><ListTodo size={18} strokeWidth={1.9} /></span>
        <div className="rm-title">
          <h2>Reminders</h2>
          <span className="rm-sub"><Bone w="17ch" /></span>
        </div>
        <div className="rm-add">
          <div className="rm-add-row">
            <span className="rm-input sk-pulse" />
            <span className="rm-addbtn sk-pulse"><Plus size={16} strokeWidth={2.2} /><span>Add</span></span>
          </div>
        </div>
      </div>
      <ul className="rm-list rm-grid sk-td-list" aria-hidden="true">
        {SK_TD.map((i) => (
          <li key={i} data-sk-td={i} className="rm-row">
            <div className="rm-row-in">
              <div className="rm-text">
                <p><Bone w="14ch" /></p>
                <small><Bone w="9ch" /></small>
              </div>
              <span className="rm-trash" />
              <span className="rm-sk-ring sk-pulse" />
            </div>
          </li>
        ))}
      </ul>
      <p className="rm-empty sk-td-empty" aria-hidden="true"><Bone w="24ch" /></p>
    </section>
  )
}

// rm: useReminders(). Nothing at all unless the server said this is the owner and answered.
// wait: the owner's card may be on its way (owner not known yet, or the first load), so its skeleton keeps the place;
// force: it surely is (the owner), whatever the remembered shape says
export function RemindersCard({ rm, wait = false, force = false }) {
  if (!rm.on) return wait ? <RemindersSkeleton force={force} /> : null
  return <RemindersBody rm={rm} />
}

function RemindersBody({ rm }) {
  const card = useRef(null)
  const { data } = rm
  const items = data.items
  const rows = useLeaving(items)
  // the next visit's skeleton: how many are open, and this card's height at this window width
  useEffect(() => rememberShape({ todos: items.length }), [items.length])
  useEffect(() => {
    const el = card.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let t = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => rememberShape({ tdH: { w: innerWidth, h: Math.round(el.getBoundingClientRect().height) } }), 600)
    })
    ro.observe(el)
    return () => (ro.disconnect(), clearTimeout(t))
  }, [])
  const n = items.length
  const sub = !n ? 'nothing left' : data.due ? `${n} open · on screen until done` : `${n} open · back on screen at 06:00`
  return (
    <section ref={card} aria-labelledby="rm-title" className="glass-panel rounded-3xl p-4 sm:p-5 rm">
      <div className="rm-head">
        <span className="rm-well" aria-hidden="true"><ListTodo size={18} strokeWidth={1.9} /></span>
        <div className="rm-title">
          <h2 id="rm-title">Reminders</h2>
          <span className="rm-sub">{sub}</span>
        </div>
        <AddForm rm={rm} />
      </div>
      {rows.length ? (
        <ul className="rm-list rm-grid">
          {rows.map((r) => <Row key={r.item.id} item={r.item} today={data.today} leaving={r.leaving} onDone={rm.done} onRemove={rm.remove} />)}
        </ul>
      ) : (
        <p className="rm-empty">Nothing carried over. What you add stays here, and on screen from 06:00, until you hold it done.</p>
      )}
      {rm.panel !== 'open' && <UndoBar rm={rm} />}
      {rm.note && rm.panel !== 'open' && <p className="hb-note" role="status">{rm.note}</p>}
    </section>
  )
}

// ---- the pop-up ----

// hidden: the dashboard isn't on screen (Ambient, the lock): it waits, and comes back with it
export function RemindersPopup({ rm, hidden = false }) {
  const want = rm.panel !== 'none' && !hidden
  const [shown, setShown] = useState(want)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (want) return setShown(true), setLeaving(false)
    if (!shown) return
    if (still()) return setShown(false)
    setLeaving(true)
    const t = setTimeout(() => (setShown(false), setLeaving(false)), 380)
    return () => clearTimeout(t)
  }, [want])
  if (!shown || !rm.data) return null
  const items = rm.data.items
  const n = items.length
  if (rm.panel === 'pill' && !leaving)
    return (
      <button type="button" className="rm-pill" onClick={rm.untuck} aria-label={`${n} reminder${n === 1 ? '' : 's'} left: show them`}>
        <BellRing size={15} strokeWidth={2} aria-hidden="true" />
        <span>{n} reminder{n === 1 ? '' : 's'}</span>
        <ChevronUp size={15} aria-hidden="true" />
      </button>
    )
  return (
    <aside className={`rm-pop${leaving ? ' is-leaving' : ''}`} aria-labelledby="rm-pop-title">
      <div className="rm-pop-head">
        <span className="rm-well is-warm" aria-hidden="true"><BellRing size={17} strokeWidth={1.9} /></span>
        <div className="rm-title">
          <h2 id="rm-pop-title">Today&apos;s reminders</h2>
          <span className="rm-sub">{n ? `${n} left · hold each when done` : 'all clear'}</span>
        </div>
        {n > 0 && (
          <button type="button" className="hb-iconbtn" aria-label="Tuck away for now (it comes back)" title="Tuck away for now" onClick={rm.tuck}>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <PopupList rm={rm} />
      {n > 0 && <AddForm rm={rm} compact />}
      {n === 0 && rm.undoing && (
        <p className="rm-clear"><Check size={15} strokeWidth={2.4} aria-hidden="true" />Nothing carried over to tomorrow.</p>
      )}
      <UndoBar rm={rm} />
      {rm.note && <p className="hb-note" role="status">{rm.note}</p>}
    </aside>
  )
}

function PopupList({ rm }) {
  const rows = useLeaving(rm.data.items)
  if (!rows.length) return null
  return (
    <ul className="rm-list rm-pop-list">
      {rows.map((r) => <Row key={r.item.id} item={r.item} today={rm.data.today} leaving={r.leaving} onDone={rm.done} />)}
    </ul>
  )
}
