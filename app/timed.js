'use client'

// Reminders with a time (rules in lib/timed.js, the route app/api/private/settings/reminders/timed): the parts of the
// Reminders sheet and pop-up (app/reminders.js) that come from the owner's reminders API. One box adds to either list:
// the server asks the model whether the sentence has a time; with one it lands here, without one on the carry-over list.
// - Due now: highlighted, with Done and Snooze 10 min (the pop-up shows these too, at any hour).
// - Today / Coming up: the time ("19:00 today", "tomorrow 08:00", "Fri 31/10 19:00"), ↻ for a repeat, and ✓, edit,
//   a two-tap delete.
// - Done (folded): both lists' done ones, with Reopen.
// The owner's phones hear about a due one from the server (lib/timed-ticker.js), page open or not.
import { useEffect, useRef, useState } from 'react'
import { AlarmClock, Check, ChevronDown, History, Loader, Pencil, Repeat, RotateCcw, Trash2 } from 'lucide-react'
import { REPEATS, REPEAT_LABEL, SNOOZE_MIN, dueKey, groupsOf, localOf, ringAt, whenLabel } from '../lib/timed'
import { MAX_TEXT } from '../lib/reminders'

const URL_ = '/api/private/settings/reminders/timed'
const POLL_MS = 30_000 // while the page is shown (the server's ticker also says 'reminders' when one comes due)
const TICK_MS = 15_000 // a time passing moves it into Due now without asking

const say = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// owner: the page's; clientId(): this tab's live-stream id; onTodo(): the carry-over list changed (a sentence without
// a time went there): its hook pulls.
// -> { on, items, now, groups, due, live, add, act, history, loadHistory }
export function useTimed(owner, clientId, onTodo) {
  const [data, setData] = useState(null) // { now, items }
  const [off, setOff] = useState(false)
  const [, setTick] = useState(0)
  const [history, setHistory] = useState(null) // null: not asked; { done } | { error }
  const skew = useRef(0)
  const api = useRef({})
  const seq = useRef({ sent: 0, shown: 0 })
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const todoRef = useRef(onTodo)
  todoRef.current = onTodo

  const take = (j, n) => {
    if (!j || !Array.isArray(j.items) || n < seq.current.shown) return
    seq.current.shown = n
    if (Number.isFinite(j.now)) skew.current = j.now - Date.now()
    setData({ now: j.now, items: j.items })
  }
  async function call(method, body, path = URL_) {
    const n = ++seq.current.sent
    const headers = {}
    const id = clientId?.()
    if (id) headers['x-home-client'] = id
    if (body !== undefined) headers['content-type'] = 'application/json'
    const r = await fetch(path, { method, cache: 'no-store', redirect: 'manual', headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (r.status === 404 && path === URL_ && method === 'GET') {
      setOff(true) // no REMIND_URL, or not the owner: the carry-over list alone
      setData(null)
      return null
    }
    if (r.status === 403) return setOff(true), setData(null), null
    const j = await r.json().catch(() => null)
    take(j, n)
    if (!r.ok) throw Object.assign(new Error(j?.error ?? 'failed'), { status: r.status, plain: j?.plain === true })
    if (j?.stale) api.current.pull?.()
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
        await call('GET')
      } catch {}
      busy = false
      if (again) pull()
    }
    api.current.pull = pull
    api.current.live = () => {
      clearTimeout(soon)
      soon = setTimeout(pull, 200)
    }
    const onVis = () => document.visibilityState === 'visible' && pull()
    document.addEventListener('visibilitychange', onVis)
    const poll = setInterval(() => document.visibilityState === 'visible' && pull(), POLL_MS)
    const tick = setInterval(() => document.visibilityState === 'visible' && setTick((t) => t + 1), TICK_MS)
    return () => {
      on = false
      clearTimeout(soon)
      clearInterval(poll)
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  useEffect(() => {
    if (owner) return setOff(false), void api.current.pull?.()
    setData(null)
    setHistory(null)
  }, [owner])

  const on = Boolean(owner && data && !off)
  const now = Date.now() + skew.current
  const items = data?.items ?? []
  const groups = groupsOf(items, now)
  const refreshHistory = () => history && api.current.loadHistory?.()
  api.current.loadHistory = async () => {
    try {
      const r = await fetch(`${URL_}?history=1`, { cache: 'no-store', redirect: 'manual' })
      const j = await r.json().catch(() => null)
      setHistory(r.ok && Array.isArray(j?.done) ? { done: j.done } : { error: say(j?.error) ?? "Couldn't load them" })
    } catch {
      setHistory({ error: "Couldn't load them: check the connection" })
    }
  }

  return {
    on,
    items,
    now,
    groups,
    // the due ones as the pop-up's tuck counts them: a new time ringing (a snooze ending) opens it again
    due: groups.due.map((i) => ({ ...i, key: `t:${dueKey(i)}` })),
    // 'reminders': something changed (here, another tab, the ticker); 'hello': the stream reconnected
    live: (kind) => (kind === 'reminders' || kind === 'hello') && api.current.live?.(),
    // a sentence -> { added } | { error, plain } (plain: the model failed; offer "save without a time")
    async add(text, plain = false) {
      try {
        const j = await call('POST', { action: 'add', text, plain })
        if (j?.added?.kind === 'todo') todoRef.current?.()
        refreshHistory()
        return { added: j?.added ?? null }
      } catch (e) {
        return { error: say(e.message === 'failed' ? "Couldn't add it: check the connection and try again" : e.message), plain: e.plain }
      }
    },
    // done / reopen / delete / snooze / edit -> null or what was wrong
    async act(action, id, extra = {}) {
      if (action === 'done' || action === 'delete' || action === 'snooze')
        setData((d) => d && { ...d, items: d.items.filter((i) => i.id !== id || action === 'snooze') }) // (drawn now; the answer replaces it)
      try {
        await call('POST', { action, id, ...extra })
        if (action === 'done' || action === 'reopen') refreshHistory()
        return null
      } catch (e) {
        api.current.pull?.()
        return say(e.message === 'failed' ? "Couldn't save that: check the connection and try again" : e.message)
      }
    },
    history,
    loadHistory: () => api.current.loadHistory(),
    pull: () => api.current.pull?.(),
  }
}

// ---- the add box ----

// One box for both lists. A sentence with a time ("7pm call mom", "tomorrow 8am dentist", "every day 9pm pills") goes
// to the timed list; one without ("buy milk") to the carry-over list as typed. The model takes a few seconds when it's
// waking up: the box says so. If it fails, the text stays and "Save without a time" puts it on the carry-over list.
export function TimedAdd({ tm, compact = false, full = false }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text, plain? }
  const slow = useRef(0)
  const [waking, setWaking] = useState(false)
  useEffect(() => {
    if (!msg?.ok) return
    const t = setTimeout(() => setMsg(null), 6000)
    return () => clearTimeout(t)
  }, [msg])
  async function go(plain = false) {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    setMsg(null)
    slow.current = setTimeout(() => setWaking(true), 2500)
    const r = await tm.add(t, plain)
    clearTimeout(slow.current)
    setWaking(false)
    setBusy(false)
    if (r.error) return setMsg({ ok: false, text: r.error, plain: r.plain })
    setText('')
    const a = r.added
    setMsg({ ok: true, text: a?.kind === 'timed' ? `${a.title} · ${whenLabel(a.due, a.allDay, tm.now)}${a.repeat !== 'none' ? ` · ${REPEAT_LABEL[a.repeat]}` : ''}` : `${a?.title ?? t} · no time: on the list until it's done` })
  }
  return (
    <form className={`rm-add${compact ? ' is-compact' : ''}`} onSubmit={(e) => (e.preventDefault(), go())}>
      <div className="rm-add-row">
        <input
          className="rm-input"
          aria-label="New reminder (with a time, or without)"
          placeholder={compact ? 'Add one…' : 'Remind me… (7pm call mom · buy milk)'}
          maxLength={MAX_TEXT}
          value={text}
          onChange={(e) => (setText(e.target.value), msg && !msg.ok && setMsg(null))}
          enterKeyHint="done"
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" className="rm-addbtn" aria-label="Add reminder" disabled={!text.trim() || busy}>
          {busy ? <Loader size={15} className="tm-spin" aria-hidden="true" /> : <span aria-hidden="true">+</span>}
          {!compact && <span>{busy ? 'Reading' : 'Add'}</span>}
        </button>
      </div>
      {busy && <p className="tm-hint" role="status">{waking ? 'Waking the model up: the first one takes a few seconds…' : 'Reading the time…'}</p>}
      {msg && (
        <p className={msg.ok ? 'tm-added' : 'hb-note'} role={msg.ok ? 'status' : 'alert'}>
          {msg.ok && <Check size={13} strokeWidth={2.4} aria-hidden="true" />}
          {msg.text}
          {!msg.ok && msg.plain && !full && (
            <button type="button" className="tm-link" onClick={() => go(true)}>
              Save without a time
            </button>
          )}
        </p>
      )}
    </form>
  )
}

// ---- rows ----

function When({ item, now }) {
  const at = ringAt(item)
  return (
    <small>
      {item.snoozed ? 'snoozed to ' : ''}
      {whenLabel(at, item.allDay && !item.snoozed, now)}
      {item.repeat !== 'none' && (
        <span className="tm-rep">
          <Repeat size={10} strokeWidth={2.2} aria-hidden="true" />
          {REPEAT_LABEL[item.repeat]}
        </span>
      )}
    </small>
  )
}

// A due one: highlighted, Done and Snooze (the sheet's Due now, and the pop-up)
export function DueRow({ item, tm }) {
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async (action, extra) => {
    setBusy(true)
    setErr(await tm.act(action, item.id, extra))
    setBusy(false)
  }
  return (
    <li className="tm-row is-due">
      <div className="rm-row-in">
        <span className="tm-ic" aria-hidden="true"><AlarmClock size={16} strokeWidth={2} /></span>
        <div className="rm-text">
          <p title={item.title}>{item.title}</p>
          <When item={item} now={tm.now} />
          {err && <span className="hb-note">{err}</span>}
        </div>
        <div className="tm-acts">
          <button type="button" className="tm-btn" disabled={busy} onClick={() => run('snooze', { minutes: SNOOZE_MIN })} aria-label={`Snooze ${SNOOZE_MIN} minutes: ${item.title}`}>
            Snooze {SNOOZE_MIN} min
          </button>
          <button type="button" className="tm-btn is-done" disabled={busy} onClick={() => run('done')} aria-label={`Done: ${item.title}`}>
            <Check size={14} strokeWidth={2.4} aria-hidden="true" /> Done
          </button>
        </div>
      </div>
    </li>
  )
}

// One later today, coming up, or without a time: ✓, edit, delete (two taps)
export function TimedRow({ item, tm }) {
  const [editing, setEditing] = useState(false)
  const [sure, setSure] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!sure) return
    const t = setTimeout(() => setSure(false), 4000)
    return () => clearTimeout(t)
  }, [sure])
  if (editing) return <EditRow item={item} tm={tm} onClose={() => setEditing(false)} />
  return (
    <li className="tm-row">
      <div className="rm-row-in">
        <div className="rm-text">
          <p title={item.title}>{item.title}</p>
          <When item={item} now={tm.now} />
          {err && <span className="hb-note">{err}</span>}
        </div>
        <button type="button" className="rm-trash" aria-label={`Edit: ${item.title}`} title="Edit" onClick={() => setEditing(true)}>
          <Pencil size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`rm-trash${sure ? ' is-sure' : ''}`}
          aria-label={sure ? `Really delete: ${item.title}` : `Delete: ${item.title}`}
          title={sure ? 'Tap again to delete' : 'Delete'}
          onClick={async () => (sure ? setErr(await tm.act('delete', item.id)) : setSure(true))}
        >
          <Trash2 size={14} aria-hidden="true" />
          {sure && <span>Delete?</span>}
        </button>
        <button type="button" className="tm-check" aria-label={`Done: ${item.title}`} title="Done" onClick={async () => setErr(await tm.act('done', item.id))}>
          <Check size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

// The edit form in the row: the title, the day, the time (empty: the whole day), how it repeats
function EditRow({ item, tm, onClose }) {
  const start = localOf(item.due, item.allDay)
  const [title, setTitle] = useState(item.title)
  const [day, setDay] = useState(start.slice(0, 10))
  const [time, setTime] = useState(start.slice(11, 16))
  const [repeat, setRepeat] = useState(item.repeat)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    const patch = {}
    if (title.trim() !== item.title) patch.title = title
    const when = day ? (time ? `${day}T${time}` : day) : null
    if (when !== (start || null)) patch.when = when
    if (repeat !== item.repeat) patch.repeat = repeat
    if (!Object.keys(patch).length) return onClose()
    setBusy(true)
    const r = await tm.act('edit', item.id, patch)
    setBusy(false)
    if (r) return setErr(r)
    onClose()
  }
  return (
    <li className="tm-row is-editing">
      <form className="tm-edit" onSubmit={save}>
        <input className="rm-input" aria-label="Title" value={title} maxLength={MAX_TEXT} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <div className="tm-edit-row">
          <input className="rm-input" type="date" aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)} />
          <input className="rm-input" type="time" aria-label="Time (empty: the whole day)" value={time} onChange={(e) => setTime(e.target.value)} disabled={!day} />
          <select className="rm-input" aria-label="Repeats" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            {REPEATS.map((r) => (
              <option key={r} value={r}>{r === 'none' ? 'once' : REPEAT_LABEL[r]}</option>
            ))}
          </select>
        </div>
        {err && <p className="hb-note" role="alert">{err}</p>}
        <div className="tm-edit-row is-end">
          <button type="button" className="hb-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="hb-ghost warm" disabled={busy || !title.trim()}>Save</button>
        </div>
      </form>
    </li>
  )
}

// a section of the sheet: its heading, then its rows
export function Group({ label, n, warm = false, children }) {
  if (!n) return null
  return (
    <section className={`tm-group${warm ? ' is-warm' : ''}`} aria-label={label}>
      <h3>
        {label} <span>{n}</span>
      </h3>
      <ul className="rm-list rm-pop-list">{children}</ul>
    </section>
  )
}

// ---- Done (folded) ----

const agoText = (t, now) => {
  if (!t) return ''
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return whenLabel(t, true, now)
}

// both lists' done ones, newest first, with Reopen (rm: the carry-over list's hook, for its own reopen)
export function DoneSection({ tm, rm }) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState(null)
  const h = tm.history
  const toggle = () => {
    if (!open) tm.loadHistory()
    setOpen(!open)
  }
  async function reopen(d) {
    setErr(null)
    const e = d.kind === 'timed' ? await tm.act('reopen', d.id) : await rm.reopen(d.id)
    if (e) setErr(e)
    tm.loadHistory()
  }
  return (
    <section className="tm-done" aria-label="Done">
      <button type="button" className="tm-fold" aria-expanded={open} onClick={toggle}>
        <History size={14} aria-hidden="true" /> Done
        <ChevronDown size={14} className={open ? 'is-open' : ''} aria-hidden="true" />
      </button>
      {open && (
        <div className="tm-done-in">
          {!h && <p className="tm-hint">Loading…</p>}
          {h?.error && <p className="hb-note">{h.error}</p>}
          {h?.done && !h.done.length && <p className="tm-hint">Nothing done yet.</p>}
          {err && <p className="hb-note" role="alert">{err}</p>}
          {h?.done?.length > 0 && (
            <ul className="rm-list rm-pop-list">
              {h.done.map((d) => (
                <li key={`${d.kind}:${d.id}`} className="tm-row is-past">
                  <div className="rm-row-in">
                    <div className="rm-text">
                      <p title={d.title}>{d.title}</p>
                      <small>
                        done {agoText(d.doneAt, tm.now)}
                        {d.kind === 'timed' && d.repeat !== 'none' ? ` · ${REPEAT_LABEL[d.repeat]}` : ''}
                      </small>
                    </div>
                    <button type="button" className="tm-btn" onClick={() => reopen(d)} aria-label={`Reopen: ${d.title}`}>
                      <RotateCcw size={13} aria-hidden="true" /> Reopen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

