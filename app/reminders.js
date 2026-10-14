'use client'

// Reminders: the owner's short list of things not to forget, carried from day to day until each is done. Rules in
// lib/reminders.js; the route is app/api/private/settings/reminders (owner-only: guests get 404 / 403 and see nothing).
// - A slim bar under Sounds (how many are open); a tap opens the list in a sheet: the open ones, an add field, hold
//   to mark one done, and a quiet two-tap delete for a mistaken entry (not "done": it never was).
// - The pop-up: from 06:00 (the server's clock in the owner's zone: its answer says `due`; the page never decides by
//   the device's clock) while anything is open, a panel floats over the dashboard (bottom left; on a phone beside the
//   dock). It has no close button: it goes when the last one is held done. It can be tucked into a pill for a while
//   (TUCK_MS) or until the next load, never dismissed.
// - Done is a hold (Habits' ring, app/habits.js HoldRing: keyboard Space / Enter held, a buzz, reduced motion kept),
//   then the row folds away; Undo right after (UNDO_MS).
// - The owner's other tabs follow on the live stream ('reminders': pull).
import './reminders.css'
import { useEffect, useRef, useState } from 'react'
import { BellRing, Check, ChevronDown, ChevronUp, ListTodo, Plus, Trash2, X } from 'lucide-react'
import { HoldRing } from './habits'
import { MiniBar, MiniBarSkeleton } from './minibar'
import { localNow } from '../lib/habits'
import { MAX_TEXT, UNDO_MS, carried } from '../lib/reminders'
import { closeDialog, motionOff, useStillPage } from './settings'

const URL_ = '/api/private/settings/reminders'
const TUCK_MS = 10 * 60_000 // tucked into its pill, the pop-up opens again after this
const LEAVE_MS = 420 // a row folding away
const RETRY_MS = [3_000, 10_000, 30_000, 60_000] // a failed first load, tried again (then every minute)
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
  // changes this tab made that the server hasn't answered yet: id -> null (done / deleted) | the item (undone). An
  // answer to a request that went out before them (a pull queued earlier) still has the old list: these go over it
  const mine = useRef(new Map())
  const over = (items) => {
    if (!mine.current.size) return items
    const out = items.filter((i) => !mine.current.has(i.id) || mine.current.get(i.id))
    for (const [id, item] of mine.current) if (item && !out.some((i) => i.id === id)) out.push(item)
    return out.sort((a, b) => a.at - b.at)
  }

  const take = (s) => {
    if (!s || !Array.isArray(s.items)) return
    if (Number.isFinite(s.at)) skew.current = s.at - Date.now()
    setData({ ...s, items: over(s.items) })
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
    let on = true, busy = false, again = false, soon = 0, retry = 0, fails = 0
    async function pull() {
      if (!on || !ownerRef.current) return
      if (busy) return void (again = true)
      busy = true
      again = false
      clearTimeout(retry)
      let failed = false
      try {
        await enqueue(() => call('GET'))
      } catch {
        failed = true
      }
      busy = false
      if (on) setTried(true)
      if (again) return pull()
      // the first load failed (the database restarting, say): try again, slower each time, so a tab left open on a
      // wall still gets the card and the 06:00 pop-up. (No answer for a guest: 404 / 403 turns it off, no retries)
      if (!failed) fails = 0
      else if (on && !dataRef.current && ownerRef.current) retry = setTimeout(pull, RETRY_MS[Math.min(fails++, RETRY_MS.length - 1)])
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
      clearTimeout(retry)
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
  // a change of this tab's: drawn now, held over older answers until its own answer (or failure) is in
  const write = (id, item, method, body) => {
    mine.current.set(id, item)
    return enqueue(() => call(method, body).finally(() => mine.current.delete(id)))
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
      // (a failure clears only its own Undo, not a newer one's)
      write(item.id, null, 'POST', { action: 'done', id: item.id }).catch((e) => (setUndoing((u) => (u?.item.id === item.id ? null : u)), fail(e)))
    },
    undo() {
      const u = undoing
      if (!u) return
      setUndoing(null)
      patch((list) => [...list.filter((i) => i.id !== u.item.id), u.item].sort((a, b) => a.at - b.at))
      write(u.item.id, u.item, 'POST', { action: 'undo', id: u.item.id }).catch(fail)
    },
    remove(item) {
      patch((list) => list.filter((i) => i.id !== item.id))
      write(item.id, null, 'DELETE', { id: item.id }).catch(fail)
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
  const li = useRef(null)
  const [holding, setHolding] = useState(false)
  const [sure, setSure] = useState(false) // the trash was tapped once: the second tap deletes
  useEffect(() => {
    if (!sure) return
    const t = setTimeout(() => setSure(false), 4000)
    return () => clearTimeout(t)
  }, [sure])
  const age = carried(item, today)
  return (
    <li ref={li} className={`rm-row${holding ? ' is-holding' : ''}${leaving ? ' is-leaving' : ''}${age > 0 ? ' is-carried' : ''}`} aria-hidden={leaving || undefined}>
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
        <HoldRing label={`Hold when done: ${item.text}`} onHolding={setHolding} onDone={() => (focusOn(li.current), onDone(item))} />
      </div>
    </li>
  )
}

// a row held done is going: the focus (if it was in it) moves to the next row's ring (else the one before), and with no
// rows left to the Undo there, so the keyboard isn't dropped back at the top of the page
function focusOn(row) {
  if (!row?.contains(document.activeElement)) return
  const box = row.closest('.rm, .rm-pop')
  const rows = [...row.parentElement.children].filter((r) => r !== row && !r.classList.contains('is-leaving'))
  const ring = (rows.find((r) => row.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) ?? rows.at(-1))?.querySelector('.hb-hold')
  setTimeout(() => (ring?.isConnected ? ring : box?.querySelector('.rm-undo button'))?.focus({ preventScroll: true }), 60)
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
    <div className="hb-undo rm-undo">
      <span className="ic" aria-hidden="true"><Check size={16} strokeWidth={2.4} /></span>
      {/* (the live region is the line that doesn't change: the countdown ticking isn't read out) */}
      <div className="msg">
        <span className="rm-undo-text" role="status">Done: {u.item.text}</span>
        <small aria-hidden="true">undo for {Math.ceil(left / 1000)}s</small>
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

// ---- the bar and the sheet ----

// The dashboard's slim bar (under Sounds, its height): how many are open and the oldest; a tap opens the whole list in a
// sheet, + opens it on the add field. Nothing at all unless the server said this is the owner and answered.
// wait: it may be on its way (owner not known yet, or the first load), so its skeleton keeps the place; force: it
// surely is the owner's, whatever the remembered shape says
export function RemindersBar({ rm, wait = false, force = false, onOpen }) {
  if (!rm.on) return wait ? <MiniBarSkeleton label="Reminders" force={force} /> : null
  const items = rm.data.items
  const n = items.length
  return (
    <MiniBar
      label="Reminders"
      icon={ListTodo}
      value={n ? `${n} open` : 'none left'}
      detail={items[0]?.text}
      warm={n > 0 && rm.data.due}
      onOpen={() => onOpen()}
      onAdd={() => onOpen('add')}
      openLabel={`Reminders: ${n ? `${n} open` : 'none left'}. Open the list`}
      addLabel="Add a reminder"
    />
  )
}

// The whole list in a sheet (opened from the bar): the open ones, the add field, hold to mark one done, the two-tap delete
export function RemindersSheet({ rm, dlg }) {
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
      aria-labelledby="rm-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => delete dlg.current.dataset.closing}
      className="wx-sheet sm:max-w-xl glass-panel text-lofi-text overscroll-contain"
    >
      {rm.on && <RemindersBody rm={rm} onClose={close} />}
    </dialog>
  )
}

function RemindersBody({ rm, onClose }) {
  const { data } = rm
  const items = data.items
  const rows = useLeaving(items)
  const n = items.length
  const sub = !n ? 'nothing left' : data.due ? `${n} open · on screen until done` : `${n} open · back on screen at 06:00`
  return (
    <section aria-labelledby="rm-title" className="p-5 sm:p-6 rm">
      <div className="rm-head">
        <span className="rm-well" aria-hidden="true"><ListTodo size={18} strokeWidth={1.9} /></span>
        <div className="rm-title">
          <h2 id="rm-title">Reminders</h2>
          <span className="rm-sub">{sub}</span>
        </div>
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <AddForm rm={rm} />
      {rows.length ? (
        <ul className="rm-list">
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
  // which one is on screen (the panel or the pill): going away, it's that one that goes, as it was
  const [kind, setKind] = useState(rm.panel)
  if (want && kind !== rm.panel) setKind(rm.panel)
  const box = useRef(null)
  const moveFocus = useRef(false) // tucked / opened by its own button: the focus follows to the other one
  useEffect(() => {
    if (want) return setShown(true), setLeaving(false)
    if (!shown) return
    if (still()) return setShown(false)
    setLeaving(true)
    const t = setTimeout(() => (setShown(false), setLeaving(false)), 380)
    return () => clearTimeout(t)
  }, [want])
  useEffect(() => {
    if (!moveFocus.current || !shown) return
    moveFocus.current = false
    const el = box.current
    ;(el?.matches('.rm-pill') ? el : el?.querySelector('[data-tuck]'))?.focus({ preventScroll: true })
  }, [kind, shown])
  // the page pads its bottom by this while it floats there, so the end of the page can be scrolled out from under it
  // (html[data-rm-pop] in app/reminders.css)
  useEffect(() => {
    const el = box.current
    const html = document.documentElement
    if (!shown || leaving || !el) return
    const set = () => {
      // (offsetTop: its layout box, without the entrance's transform; a fixed box's is from the top of the window)
      html.style.setProperty('--rm-pop-h', `${Math.max(0, Math.ceil(innerHeight - el.offsetTop))}px`)
      html.dataset.rmPop = ''
    }
    set()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set)
    ro?.observe(el)
    addEventListener('resize', set)
    return () => (ro?.disconnect(), removeEventListener('resize', set), delete html.dataset.rmPop, html.style.removeProperty('--rm-pop-h'))
  }, [shown, leaving, kind])
  if (!shown || !rm.data) return null
  const items = rm.data.items
  const n = items.length
  if (kind === 'pill')
    return (
      <button ref={box} type="button" className={`rm-pill${leaving ? ' is-leaving' : ''}`} onClick={() => ((moveFocus.current = true), rm.untuck())} aria-label={`${n} reminder${n === 1 ? '' : 's'} left: show them`}>
        <BellRing size={15} strokeWidth={2} aria-hidden="true" />
        <span>{n} reminder{n === 1 ? '' : 's'}</span>
        <ChevronUp size={15} aria-hidden="true" />
      </button>
    )
  return (
    <aside ref={box} className={`rm-pop${leaving ? ' is-leaving' : ''}`} aria-labelledby="rm-pop-title">
      <div className="rm-pop-head">
        <span className="rm-well is-warm" aria-hidden="true"><BellRing size={17} strokeWidth={1.9} /></span>
        <div className="rm-title">
          <h2 id="rm-pop-title">Today&apos;s reminders</h2>
          <span className="rm-sub">{n ? `${n} left · hold each when done` : 'all clear'}</span>
        </div>
        {n > 0 && (
          <button type="button" data-tuck className="hb-iconbtn" aria-label="Tuck away for now (it comes back)" title="Tuck away for now" onClick={() => ((moveFocus.current = true), rm.tuck())}>
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
