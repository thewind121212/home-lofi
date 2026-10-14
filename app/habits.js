'use client'

// The Habits card: the owner's routines for today, kept on purpose. Rules in lib/habits.js; the route is
// app/api/private/settings/habits (owner-only: guests get 404 / 403 and never see the card).
// - Keeping one is a hold, not a tap: the ring fills over HOLD_MS while the habit's identity line opens under it ("I show
//   up at 6:15."); letting go early drains it and nothing is kept. Then one tap says how it felt (hard / okay / great).
// - Right after, Undo (UNDO_MS); later, taking it back asks why (tapped by mistake / didn't really do it), on record.
// - Every time is the server's: it stamps the check-in and says on time or late; the card runs its chips ("now · on
//   time till 08:00") on the server's clock too (the skew from its answer's `at`), not the device's.
// - The routine editor (a .wx-sheet dialog: the bottom sheet on phones, the centered panel from sm): a 24-hour
//   timeline to drag a time or a window's two ends, length chips, day presets and toggles, the identity line, a
//   reminder switch, a live one-line summary. Icons: Lucide (lucide-react).
// - The owner's other tabs follow on the live stream ('habits': pull).
import './habits.css'
import { Bone, rememberShape } from './skeleton'
import { SK_MAX } from '../lib/skeleton'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Archive, ArchiveRestore, BedDouble, Bell, Bike, BookOpen, Brain, CalendarDays, ChevronDown, ChevronRight, Clock, Code, Coffee, Droplet, Dumbbell, Flame,
  Footprints, Guitar, Heart, Languages, Leaf, Moon, Mountain, Music, PenLine, PersonStanding, Piano, Plus, Salad, SlidersHorizontal, Smile, Sprout, Sunrise,
  Timer, Trash2, Waves, X,
} from 'lucide-react'
import { DELETE_WORD, DEFAULT_ICON, GRACE_MIN, ICONS, REMIND_BEFORE, UNDO_MS, addDays, dowOf, fmtMin, isLate, localNow, remindAt, spanOf, toMin } from '../lib/habits'
import { closeDialog, motionOff, useStillPage } from './settings'

const URL_ = '/api/private/settings/habits'
const HOLD_MS = 1800
const GLYPH = { Activity, BedDouble, Bike, BookOpen, Brain, Code, Coffee, Droplet, Dumbbell, Footprints, Guitar, Heart, Languages, Leaf, Moon, Music, PenLine, PersonStanding, Piano, Salad, Sprout, Sunrise, Timer, Waves }
const RATINGS = [['hard', Mountain, 'Hard'], ['okay', Smile, 'Okay'], ['great', Flame, 'Great']]
const rateOf = (k) => RATINGS.find((r) => r[0] === k)
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DOW_LONG = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PRESETS = [['Every day', [1, 2, 3, 4, 5, 6, 7]], ['Weekdays', [1, 2, 3, 4, 5]], ['Mon–Sat', [1, 2, 3, 4, 5, 6]], ['Weekends', [6, 7]]]
const LENGTHS = [10, 15, 20, 30, 45, 60, 90]

function Glyph({ name, size = 20 }) {
  const C = GLYPH[name] ?? GLYPH[DEFAULT_ICON]
  return <C size={size} strokeWidth={1.75} aria-hidden="true" />
}
const vibrate = (p) => {
  try {
    navigator.vibrate?.(p)
  } catch {}
}
const still = () => motionOff() || matchMedia?.('(prefers-reduced-motion: reduce)').matches

const daysText = (days) => {
  const s = days.join('')
  if (s === '1234567') return 'Every day'
  if (s === '12345') return 'Weekdays'
  if (s === '67') return 'Weekends'
  const run = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1)
  return run ? `${DOW_LONG[days[0] - 1]}–${DOW_LONG[days.at(-1) - 1]}` : days.map((d) => DOW_LONG[d - 1]).join(', ')
}
const whenText = (h) => {
  const len = h.minutes ? ` · ${h.minutes} min` : ''
  if (h.when.kind === 'time') return `${h.when.at}${len}`
  if (h.when.kind === 'window') return `${h.when.from}–${h.when.to}${len}`
  return `Any time${len}`
}
const sentence = (h) => {
  const when = h.when.kind === 'time' ? `at ${h.when.at}` : h.when.kind === 'window' ? `between ${h.when.from} and ${h.when.to}` : 'any time of day'
  return `${daysText(h.days)} ${when}${h.minutes ? `, for ${h.minutes} min` : ''}`
}
const suggest = (h) => {
  const what = h.name.trim().toLowerCase()
  if (h.when.kind === 'time') return `I show up at ${h.when.at}.`
  if (h.when.kind === 'window') return `I make time for ${what || 'it'} every evening.`
  return `I do a little ${what || 'of it'} every day.`
}
// timed ones by their start, any-time last
const order = (h) => (h.when.kind === 'any' ? 1440 : spanOf(h)[0])

// ---- state: the server's, with the device only drawing it ----

// owner: settings sync answered as the owner (the page's `owner`); clientId(): this tab's live-stream id (its own
// changes aren't echoed back). -> { on, data, local(), note, keep, rate, undo, takeBack, save, live, undoing }
export function useHabits(owner, clientId) {
  const [data, setData] = useState(null)
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false) // a load was tried (so a failed one ends the skeleton)
  const [note, setNote] = useState(null)
  const [undoing, setUndoing] = useState(null) // { habitId, day, until }: the Undo bar
  const [fresh, setFresh] = useState(null) // the habit just kept (its burst, its rating question)
  const skew = useRef(0) // the server's clock minus this device's
  const api = useRef({})
  const seq = useRef({ sent: 0, shown: 0, at: 0 }) // requests numbered as they go: an older answer landing later is out of date
  // every request goes one at a time, in order (a rating never overtakes its check; a pull never reads around a change
  // still on its way), and one that fails doesn't hold up the next
  const queue = useRef(Promise.resolve())
  const enqueue = (fn) => (queue.current = queue.current.catch(() => {}).then(fn))
  const dataRef = useRef(data)
  dataRef.current = data
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  const take = (s) => {
    if (!s || !Array.isArray(s.habits)) return
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
    // a new day (by the server's clock) while the page stays open: fetch it
    const t = setInterval(() => {
      const d = dataRef.current
      if (d && localNow(Date.now() + skew.current, d.tz).day !== d.today) pull()
    }, 30_000)
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

  const local = () => (dataRef.current ? localNow(Date.now() + skew.current, dataRef.current.tz) : null)
  // what this tab shows until the server answers (the answer replaces it)
  const patch = (habitId, day, fn) =>
    setData((d) => {
      if (!d) return d
      const rest = d.checkins.filter((c) => !(c.habitId === habitId && c.day === day))
      const cur = d.checkins.find((c) => c.habitId === habitId && c.day === day) ?? null
      const next = fn(cur)
      return { ...d, checkins: next ? [...rest, next] : rest }
    })
  const send = (body) => enqueue(() => call('POST', body))
  const fail = (e) => {
    if (e?.status === 409) setNote(e.message.charAt(0).toUpperCase() + e.message.slice(1))
    else {
      setNote("Couldn't save that: check the connection and try again")
      api.current.pull?.()
    }
  }

  return {
    on: Boolean(owner && data && !off),
    pending: Boolean(owner && !data && !off && !tried), // the owner's first load is on its way: the skeleton
    data,
    note,
    undoing,
    fresh,
    local,
    // 'habits': another tab changed something; 'hello': the stream (re)connected, a pull unless one just went out
    live: (kind) => (kind === 'habits' || (kind === 'hello' && Date.now() - seq.current.at > 3000)) && api.current.live?.(),
    // day: the one the row shows (just after midnight, before the card moves on, that's still yesterday: kept late)
    keep(h, day) {
      const now = local()
      if (!now) return
      patch(h.id, day, () => ({ habitId: h.id, day, doneAt: Date.now() + skew.current, late: isLate(h, day, now), rating: null, note: null, undoneAt: null, reason: null }))
      setFresh(h.id)
      setUndoing({ habitId: h.id, day, until: Date.now() + UNDO_MS })
      send({ action: 'check', habitId: h.id, day }).catch((e) => (setUndoing(null), setFresh(null), fail(e)))
    },
    // day: the one the row shows (not "now": a rating tapped just after midnight is for the day it was kept)
    rate(h, rating, day) {
      patch(h.id, day, (c) => c && { ...c, rating })
      setFresh(null)
      send({ action: 'rate', habitId: h.id, day, rating }).catch(fail)
    },
    undo() {
      const u = undoing
      if (!u) return
      setUndoing(null)
      setFresh(null)
      patch(u.habitId, u.day, () => null)
      send({ action: 'undo', habitId: u.habitId, day: u.day }).catch(fail)
    },
    takeBack(h, reason, day) {
      if (undoing?.habitId === h.id && undoing.day === day) return this.undo()
      patch(h.id, day, (c) => c && { ...c, undoneAt: Date.now() + skew.current, reason })
      send({ action: 'untick', habitId: h.id, day, reason }).catch(fail)
    },
    endUndo: () => setUndoing(null),
    // an archived habit for good (its check-ins too) -> null (gone) or what was wrong
    async remove(habitId) {
      try {
        await enqueue(() => call('DELETE', { habitId, confirm: DELETE_WORD }))
        return null
      } catch (e) {
        return e?.status === 400 || e?.status === 409 ? e.message : "Couldn't delete: check the connection and try again"
      }
    },
    // the editor's whole list -> null (saved) or what was wrong
    async save(habits) {
      try {
        await enqueue(() => call('PUT', { tz: dataRef.current?.tz, habits }))
        return null
      } catch (e) {
        return e?.status === 400 ? e.message : "Couldn't save: check the connection and try again"
      }
    },
  }
}

// ---- the hold ----

const CHECK = 'M5 12.5l4.5 4.5L19 7.5' // the check: waiting in the ring, drawn by the hold, then the kept one

// (app/reminders.js holds its reminders done with this same ring: label is its button's name there)
export function HoldRing({ habit, label = `Hold to keep: ${habit?.name}`, onDone, onHolding = () => {} }) {
  const [p, setP] = useState(0)
  const [holding, setHolding] = useState(false)
  const s = useRef({ p: 0, t0: 0, from: 0, raf: 0, on: false }).current
  const C = 2 * Math.PI * 27
  const set = (v) => ((s.p = v), setP(v))
  const tick = () => {
    const v = Math.min(1, s.from + (performance.now() - s.t0) / HOLD_MS)
    set(v)
    if (v < 1) return void (s.raf = requestAnimationFrame(tick))
    s.on = false
    setHolding(false)
    onHolding(false)
    vibrate([12, 40, 24])
    onDone()
  }
  const start = (e) => {
    if (s.on) return
    if (e?.pointerId != null) e.currentTarget.setPointerCapture?.(e.pointerId)
    s.on = true
    cancelAnimationFrame(s.raf)
    s.from = s.p
    s.t0 = performance.now()
    setHolding(true)
    onHolding(true)
    vibrate(8)
    s.raf = requestAnimationFrame(tick)
  }
  // let go early: it drains back, nothing is kept
  const cancel = () => {
    if (!s.on) return
    s.on = false
    cancelAnimationFrame(s.raf)
    setHolding(false)
    onHolding(false)
    if (still()) return set(0)
    const from = s.p, t0 = performance.now(), dur = 160 + 220 * from
    const back = () => {
      const k = Math.min(1, (performance.now() - t0) / dur)
      set(from * (1 - k) ** 3)
      if (k < 1) s.raf = requestAnimationFrame(back)
    }
    s.raf = requestAnimationFrame(back)
  }
  useEffect(() => () => cancelAnimationFrame(s.raf), [])
  return (
    <button
      type="button"
      className={`hb-hold${holding ? ' is-holding' : ''}`}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && (e.preventDefault(), start())}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && cancel()}
      onBlur={cancel}
      style={{ boxShadow: p > 0 ? `0 0 ${8 + p * 22}px rgb(255 138 92 / ${0.15 + p * 0.45})` : 'none' }}
    >
      <span className="ring-hint" aria-hidden="true" />
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <circle className="ring-bg" cx="30" cy="30" r="27" />
        <circle className="ring-fill" cx="30" cy="30" r="27" strokeDasharray={C} strokeDashoffset={C * (1 - p)} style={{ opacity: p > 0 ? 1 : 0 }} />
      </svg>
      {/* the check that's waiting to be earned: a faint one, and over it the real one drawn in as the ring fills, so it
          lands as the kept check (the same path); the label says "hold" for screen readers */}
      <span className="ring-label" aria-hidden="true">
        <svg className="check" viewBox="0 0 24 24" fill="none">
          <path className="ghost" d={CHECK} />
          <path className="ink" d={CHECK} pathLength="1" strokeDasharray="1" strokeDashoffset={1 - p} style={{ opacity: p > 0 ? 1 : 0 }} />
        </svg>
      </span>
    </button>
  )
}

function Burst() {
  const bits = useMemo(() => Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + 0.3, r = 34 + (i % 3) * 8
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, d: i * 12 }
  }), [])
  return (
    <span className="hb-burst" aria-hidden="true">
      {bits.map((b, i) => <i key={i} style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, animationDelay: `${b.d}ms` }} />)}
    </span>
  )
}

// ---- one habit today: a compact tile (the card is a short, wide bar over the Hub) ----
// [icon] name                [ring]
//        06:15 · 45 min  chip
// While held, the second line becomes the identity line; just kept, it asks how it went (three small buttons);
// tapping the check later opens "take it back" under the tile.

function Tile({ habit, today, now, entry, fresh, onKeep, onRate, onTakeBack }) {
  const [holding, setHolding] = useState(false)
  const [asking, setAsking] = useState(false)
  // "take it back" opens only for a press that began on the check itself (a finger, a button, Enter / Space): the finger
  // that just finished the hold lifts over the check that took the ring's place, and a touch screen calls that a tap
  const pressed = useRef(false)
  const due = habit.days.includes(dowOf(today))
  const done = Boolean(entry && entry.undoneAt == null)
  const [s, e] = spanOf(habit)
  const open = habit.when.kind === 'any' || (now.min >= s - 30 && now.min <= e + GRACE_MIN)
  let chip
  if (done) {
    const R = entry.rating && rateOf(entry.rating)[1]
    chip = <span className="hb-chip kept">{entry.late ? 'kept · late' : 'kept'}{R && <R size={12} strokeWidth={2} aria-hidden="true" />}</span>
  } else if (!due) chip = <span className="hb-chip">rest day</span>
  else if (habit.when.kind === 'any') chip = <span className="hb-chip now">today</span>
  else if (now.min < s - 30) {
    const m = s - now.min
    chip = <span className="hb-chip">in {m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`}</span>
  } else if (open) chip = <span className="hb-chip now">now · till {fmtMin(Math.min(1439, e + GRACE_MIN))}</span>
  else chip = <span className="hb-chip late">late · still counts</span>
  const askRate = done && fresh && !entry.rating
  const R = done && entry.rating && rateOf(entry.rating)[1]
  const line = holding ? 'identity' : askRate ? 'rate' : 'meta'
  return (
    <li className={`hb-tile${holding ? ' is-holding' : ''}${done ? ' is-done' : ''}${!due && !done ? ' is-rest' : ''}${due && !done && open ? ' is-due' : ''}`}>
      <div className="hb-tile-main">
        <span className="hb-well" aria-hidden="true"><Glyph name={habit.icon} size={20} /></span>
        <div className="hb-text">
          <div className="hb-name">{habit.name}</div>
          <div className="hb-line" data-show={line}>
            <div className="hb-meta" aria-hidden={line !== 'meta'}><span>{whenText(habit)}</span>{chip}</div>
            <p className="hb-quote" aria-hidden={line !== 'identity'}>“{habit.identity || 'I keep my word to myself.'}”</p>
            <div className="hb-rates" role="group" aria-label="How was it?" aria-hidden={line !== 'rate'}>
              {askRate && RATINGS.map(([k, I, t]) => (
                <button key={k} type="button" className={`hb-rate ${k}`} title={t} aria-label={`${t}`} onClick={() => onRate(habit, k, today)}>
                  <I size={15} strokeWidth={1.9} aria-hidden="true" /><span>{t}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {done ? (
          <button
            type="button"
            className={`hb-kept${fresh ? ' is-fresh' : ''}`}
            aria-label={`${habit.name}: kept. Take it back`}
            aria-expanded={asking}
            onPointerDown={() => (pressed.current = true)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (pressed.current = true)}
            onClick={() => pressed.current && ((pressed.current = false), setAsking((a) => !a))}
          >
            {fresh && <Burst />}
            <svg className="check" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={CHECK} stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {R && <span className="hb-badge" aria-hidden="true"><R size={12} strokeWidth={2.2} /></span>}
          </button>
        ) : (
          <HoldRing habit={habit} onHolding={setHolding} onDone={() => onKeep(habit, today)} />
        )}
      </div>
      <div className={`hb-after${asking && done ? ' is-open' : ''}`}>
        <div>
          {asking && done && (
            <div className="hb-after-in">
              <p>Take back today's {habit.name.toLowerCase()}?</p>
              <button type="button" className="hb-ghost" onClick={() => (setAsking(false), onTakeBack(habit, 'mistake', today))}>Tapped by mistake</button>
              <button type="button" className="hb-ghost warm" onClick={() => (setAsking(false), onTakeBack(habit, 'not-done', today))}>Didn't really do it</button>
              <button type="button" className="hb-ghost" onClick={() => setAsking(false)}>Keep it</button>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

// ---- the week ----

const pretty = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
function Week({ habits, checkins, streaks, today }) {
  const monday = addDays(today, 1 - dowOf(today))
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const kept = useMemo(() => {
    const m = new Map()
    for (const c of checkins) if (c.undoneAt == null) (m.get(c.habitId) ?? m.set(c.habitId, new Map()).get(c.habitId)).set(c.day, c)
    return m
  }, [checkins])
  return (
    <div className="hb-week">
      <p className="hb-label" style={{ margin: 0 }}>This week</p>
      <div className="hb-wk" aria-hidden="true">
        <span />
        {days.map((d, i) => <span key={d} className={`hb-wk-day${d === today ? ' today' : ''}`}>{DOW[i]}</span>)}
      </div>
      {habits.map((h) => {
        const mine = kept.get(h.id) ?? new Map()
        const st = streaks?.[h.id] ?? { count: 0, atRisk: false }
        return (
          <div className="hb-wk" key={h.id}>
            <div className="hb-wk-name">
              <b><Glyph name={h.icon} size={14} /><span>{h.name}</span></b>
              {st.atRisk ? (
                <small className="risk" title="Missed last time: one miss is fine, keep it today">{st.count}-day streak · keep it today</small>
              ) : (
                <small>{st.count ? `${st.count}-day streak` : 'starts today'}</small>
              )}
            </div>
            {days.map((d) => {
              const c = mine.get(d)
              const due = h.days.includes(dowOf(d)) && d >= h.since
              const [cls, label] = c ? (c.late ? ['late', 'kept, late'] : ['done', 'kept on time'])
                : !due ? ['off', 'rest day'] : d > today ? ['ahead', 'coming up'] : d === today ? ['open', 'today, still open'] : ['miss', 'missed']
              return <span key={d} className={`hb-dot ${cls}`} title={`${pretty(d)}: ${label}`} role="img" aria-label={`${h.name}, ${pretty(d)}: ${label}`} />
            })}
          </div>
        )
      })}
      <div className="hb-legend" aria-hidden="true">
        <span><i className="hb-dot done" />kept</span><span><i className="hb-dot late" />late</span><span><i className="hb-dot miss" />missed</span><span><i className="hb-dot off" />rest</span>
      </div>
    </div>
  )
}

// ---- the routine picker ----

// the day as a 24-hour track: drag the time (or a window's two ends); ± and the arrow keys step 5 min (Shift: 30)
function Timeline({ draft, setDraft }) {
  const track = useRef(null)
  const [drag, setDrag] = useState(null)
  const w = draft.when
  const pct = (m) => `${(m / 1440) * 100}%`
  const minAt = (x) => {
    const r = track.current.getBoundingClientRect()
    return Math.max(0, Math.min(1435, Math.round((((x - r.left) / r.width) * 1440) / 5) * 5))
  }
  const setWhen = (p) => setDraft((d) => ({ ...d, when: { ...d.when, ...p } }))
  const move = (which, m) => {
    if (w.kind === 'time') return setWhen({ at: fmtMin(Math.min(m, 1435)) })
    const f = toMin(w.from), t = toMin(w.to)
    if (which === 'from') setWhen({ from: fmtMin(Math.max(0, Math.min(m, t - 15))) })
    else setWhen({ to: fmtMin(Math.min(1435, Math.max(m, f + 15))) })
  }
  const value = (which) => toMin(w.kind === 'time' ? w.at : w[which])
  const step = (which, d) => move(which, Math.max(0, Math.min(1435, value(which) + d)))
  const grab = (which) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag(which)
    vibrate(5)
  }
  const onTrack = (e) => {
    const m = minAt(e.clientX)
    if (w.kind === 'time') return move('at', m)
    move(Math.abs(m - toMin(w.from)) <= Math.abs(m - toMin(w.to)) ? 'from' : 'to', m)
  }
  const key = (which) => (e) => {
    const d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -60, PageUp: 60 }[e.key]
    if (!d) return
    e.preventDefault()
    step(which, d * (e.shiftKey ? 6 : 1))
  }
  const start = w.kind === 'time' ? toMin(w.at) : toMin(w.from)
  const end = w.kind === 'time' ? Math.min(1440, start + (draft.minutes || 30)) : toMin(w.to)
  const clock = (which, label) => (
    <div className="hb-clock">
      <button type="button" className="hb-step" aria-label={`${label} 5 minutes earlier`} onClick={() => step(which, -5)}>−</button>
      <output aria-live="polite">{fmtMin(value(which))}</output>
      <button type="button" className="hb-step" aria-label={`${label} 5 minutes later`} onClick={() => step(which, 5)}>+</button>
    </div>
  )
  const handle = (which, label, at) => (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1435}
      aria-valuenow={at}
      aria-valuetext={fmtMin(at)}
      className={`handle${drag === which ? ' is-active' : ''}`}
      style={{ left: pct(at) }}
      onPointerDown={grab(which)}
      onKeyDown={key(which)}
    />
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="hb-readout">
        {w.kind === 'time' ? clock('at', 'Start') : (<>{clock('from', 'Window opens')}<span className="hb-clock"><span className="to">to</span></span>{clock('to', 'Window closes')}</>)}
      </div>
      <div
        ref={track}
        className={`hb-tl${drag ? ' is-dragging' : ''}`}
        onPointerDown={onTrack}
        onPointerMove={(e) => drag && move(drag, minAt(e.clientX))}
        onPointerUp={() => drag && (setDrag(null), vibrate(5))}
        onPointerCancel={() => setDrag(null)}
      >
        {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => <span key={h} className={`tick${h % 6 === 0 ? ' major' : ''}`} style={{ left: pct(h * 60) }} />)}
        <span className="span" style={{ left: pct(start), width: pct(Math.max(5, end - start)) }} />
        {w.kind === 'time' ? handle('at', 'Start time', start) : (<>{handle('from', 'Window opens', start)}{handle('to', 'Window closes', end)}</>)}
      </div>
      <div className="hb-hours" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: pct(h * 60) }}>{String(h).padStart(2, '0')}</span>)}
      </div>
    </div>
  )
}

const KINDS = [['time', 'At a time'], ['window', 'In a window'], ['any', 'Any time']]
function Editor({ habit, onSave, onArchive, onBack, busy, error }) {
  const [draft, setDraft] = useState(() => structuredClone(habit))
  const [icons, setIcons] = useState(false)
  const kind = draft.when.kind
  const setKind = (k) =>
    setDraft((d) => {
      if (k === d.when.kind) return d
      const at = d.when.kind === 'time' ? d.when.at : d.when.kind === 'window' ? d.when.from : '07:00'
      const from = Math.min(toMin(at), 1420) // (a window needs 15 min after its start, the same day)
      return { ...d, when: k === 'time' ? { kind: k, at } : k === 'window' ? { kind: k, from: fmtMin(from), to: fmtMin(Math.min(1435, from + 150)) } : { kind: k } }
    })
  const toggleDay = (n) => setDraft((d) => ({ ...d, days: d.days.includes(n) ? d.days.filter((x) => x !== n) : [...d.days, n].sort((a, b) => a - b) }))
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
  const hint = suggest(draft)
  const err = !draft.name.trim() ? 'Give it a name.' : !draft.days.length ? 'Pick at least one day.' : null
  const ki = KINDS.findIndex(([k]) => k === kind)
  return (
    <>
      <div className="hb-field">
        <label htmlFor="hb-name" className="hb-flabel">What</label>
        <div className="hb-nameline">
          <button type="button" className="hb-iconpick" aria-label="Pick an icon" aria-expanded={icons} onClick={() => setIcons((o) => !o)}><Glyph name={draft.icon} size={24} /></button>
          <input id="hb-name" className="hb-input" value={draft.name} maxLength={40} placeholder="Workout, Piano, Read…" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        {icons && (
          <div className="hb-icons">
            {ICONS.map((n) => <button key={n} type="button" aria-label={n} aria-pressed={draft.icon === n} onClick={() => (setDraft({ ...draft, icon: n }), setIcons(false))}><Glyph name={n} size={19} /></button>)}
          </div>
        )}
      </div>

      <div className="hb-field">
        <span className="hb-flabel" id="hb-when"><Clock size={12} strokeWidth={2} aria-hidden="true" />When</span>
        <div className="hb-seg" role="group" aria-labelledby="hb-when">
          <span className="slide" style={{ left: `calc(4px + ${ki} * (100% - 8px) / 3)` }} aria-hidden="true" />
          {KINDS.map(([k, t]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{t}</button>)}
        </div>
        {kind === 'any' ? <p className="hb-sub" style={{ margin: 0 }}>Any time that day counts as on time.</p> : <Timeline draft={draft} setDraft={setDraft} />}
      </div>

      <div className="hb-field">
        <span className="hb-flabel" id="hb-len"><Timer size={12} strokeWidth={2} aria-hidden="true" />How long</span>
        <div className="hb-chips" role="group" aria-labelledby="hb-len">
          {LENGTHS.map((m) => <button key={m} type="button" className="hb-pick" aria-pressed={draft.minutes === m} onClick={() => setDraft({ ...draft, minutes: m })}>{m} min</button>)}
        </div>
      </div>

      <div className="hb-field">
        <span className="hb-flabel" id="hb-days"><CalendarDays size={12} strokeWidth={2} aria-hidden="true" />Days</span>
        <div className="hb-chips">
          {PRESETS.map(([t, ds]) => <button key={t} type="button" className="hb-pick" aria-pressed={same(draft.days, ds)} onClick={() => setDraft({ ...draft, days: ds })}>{t}</button>)}
        </div>
        <div className="hb-days" role="group" aria-labelledby="hb-days">
          {DOW.map((l, i) => <button key={i} type="button" className="hb-daybtn" aria-pressed={draft.days.includes(i + 1)} aria-label={DOW_LONG[i]} onClick={() => toggleDay(i + 1)}>{l}</button>)}
        </div>
      </div>

      <div className="hb-field">
        <label htmlFor="hb-identity" className="hb-flabel">Who you are when you keep it</label>
        <input id="hb-identity" className="hb-input" value={draft.identity} maxLength={100} placeholder={hint} onChange={(e) => setDraft({ ...draft, identity: e.target.value })} />
        {!draft.identity && <div className="hb-chips"><button type="button" className="hb-pick" onClick={() => setDraft({ ...draft, identity: hint })}>Use “{hint}”</button></div>}
      </div>

      <div className="hb-field">
        <div className="hb-switchline">
          <span className="bell" aria-hidden="true"><Bell size={18} strokeWidth={1.75} /></span>
          <div className="t" id="hb-remind">
            Remind me
            <small>{kind === 'time' ? `at ${fmtMin(remindAt({ ...draft, remind: true }))}, ${REMIND_BEFORE} min before` : kind === 'window' ? `at ${draft.when.from}, when the window opens` : 'any-time routines have no start to remind'}</small>
          </div>
          <button type="button" className="hb-switch" role="switch" aria-checked={kind !== 'any' && draft.remind} aria-labelledby="hb-remind" disabled={kind === 'any'} onClick={() => setDraft({ ...draft, remind: !draft.remind })}><i /></button>
        </div>
      </div>

      <div className="hb-summary" aria-live="polite">
        <span className="hb-well" aria-hidden="true"><Glyph name={draft.icon} /></span>
        <div><p>{draft.name.trim() || 'Your routine'}: {sentence(draft)}</p><small>{draft.identity || hint}</small></div>
      </div>

      <div className="hb-foot">
        <button type="button" className="hb-btn" onClick={onBack}>Cancel</button>
        <button type="button" className="hb-btn primary" disabled={Boolean(err) || busy} onClick={() => onSave(draft)}>{busy ? 'Saving…' : 'Save routine'}</button>
        {habit.id && (
          <button type="button" className="hb-archive" disabled={busy} onClick={() => onArchive(habit)}>
            <Archive size={14} strokeWidth={2} aria-hidden="true" />Archive routine (its history stays)
          </button>
        )}
      </div>
      {(err || error) && <p className="hb-note" style={{ marginTop: 8, textAlign: 'right' }}>{error ?? err}</p>}
    </>
  )
}

function Routines({ hb, dlg }) {
  const [view, setView] = useState(null) // null: the list; else the habit being edited ({} new)
  const [doomed, setDoomed] = useState(null) // an archived habit about to be deleted for good (its confirm screen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  const habits = hb.data?.habits ?? []
  const save = async (list) => {
    setBusy(true)
    setError(null)
    const e = await hb.save(list)
    setBusy(false)
    if (e) return setError(e)
    setView(null)
  }
  const blank = () => ({ icon: DEFAULT_ICON, name: '', when: { kind: 'time', at: '07:00' }, minutes: 30, days: [1, 2, 3, 4, 5], identity: '', remind: true, archived: false })
  const put = (draft) => save(draft.id ? habits.map((h) => (h.id === draft.id ? draft : h)) : [...habits, draft])
  const active = habits.filter((h) => !h.archived)
  const archived = habits.filter((h) => h.archived)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="hb-routines"
      onClick={(e) => e.target === dlg.current && closeDialog(dlg.current)}
      onCancel={(e) => (e.preventDefault(), closeDialog(dlg.current))}
      onClose={() => (delete dlg.current.dataset.closing, setView(null), setDoomed(null), setError(null))}
      className="wx-sheet hb-sheet text-lofi-text"
    >
      <div className="hb-sheet-head">
        <h3 id="hb-routines">{doomed ? 'Delete routine' : view ? (view.id ? 'Edit routine' : 'New routine') : 'Your routines'}</h3>
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={() => closeDialog(dlg.current)}><X size={18} aria-hidden="true" /></button>
      </div>
      {doomed ? (
        <DeleteRoutine
          habit={doomed}
          busy={busy}
          error={error}
          onBack={() => (setDoomed(null), setError(null))}
          onDelete={async () => {
            setBusy(true)
            setError(null)
            const e = await hb.remove(doomed.id)
            setBusy(false)
            if (e) return setError(e)
            setDoomed(null)
          }}
        />
      ) : view ? (
        <Editor key={view.id ?? 'new'} habit={view} busy={busy} error={error} onBack={() => (setView(null), setError(null))} onSave={put} onArchive={(d) => put({ ...d, archived: true })} />
      ) : (
        <div className="hb-list">
          {active.map((h) => (
            <button key={h.id} type="button" className="hb-item" onClick={() => setView(h)}>
              <span className="hb-well" aria-hidden="true"><Glyph name={h.icon} /></span>
              <span className="min-w-0"><b>{h.name}</b><small>{sentence(h)}</small></span>
              <span className="chev" aria-hidden="true"><ChevronRight size={18} /></span>
            </button>
          ))}
          <button type="button" className="hb-add" onClick={() => setView(blank())}><Plus size={16} strokeWidth={2} aria-hidden="true" />New routine</button>
          {archived.length > 0 && <p className="hb-label" style={{ margin: '12px 0 0' }}>Archived</p>}
          {archived.map((h) => (
            <div key={h.id} className="hb-arch">
              <button type="button" className="hb-item is-archived" disabled={busy} onClick={() => put({ ...h, archived: false })}>
                <span className="hb-well" aria-hidden="true"><Glyph name={h.icon} /></span>
                <span className="min-w-0"><b>{h.name}</b><small>tap to bring it back</small></span>
                <span className="chev" aria-hidden="true"><ArchiveRestore size={18} /></span>
              </button>
              <button type="button" className="hb-trash" disabled={busy} aria-label={`Delete ${h.name} for good`} title="Delete for good" onClick={() => (setError(null), setDoomed(h))}>
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          ))}
          {error && <p className="hb-note">{error}</p>}
        </div>
      )}
    </dialog>
  )
}

// Deleting an archived routine for good: what goes (it and every check-in: its streaks and history), and the word
// typed to say so (a tap alone can't do it). Archive is the everyday way out; this one can't be undone.
function DeleteRoutine({ habit, busy, error, onBack, onDelete }) {
  const [word, setWord] = useState('')
  const ok = word.trim().toLowerCase() === DELETE_WORD
  return (
    <form className="hb-del" onSubmit={(e) => (e.preventDefault(), ok && !busy && onDelete())}>
      <div className="hb-del-who">
        <span className="hb-well" aria-hidden="true"><Glyph name={habit.icon} /></span>
        <b>{habit.name}</b>
      </div>
      <p>This deletes the routine and <strong>all its check-ins</strong>: its streaks and history go too. It can&apos;t be undone.</p>
      <label htmlFor="hb-del-word">Type <code>{DELETE_WORD}</code> to confirm</label>
      <input
        id="hb-del-word"
        className="hb-input"
        value={word}
        onChange={(e) => setWord(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={DELETE_WORD}
        autoFocus
      />
      {error && <p className="hb-note" role="alert">{error}</p>}
      <div className="hb-del-act">
        <button type="button" className="hb-ghost" onClick={onBack}>Cancel</button>
        <button type="submit" className="hb-danger" disabled={!ok || busy}>
          <Trash2 size={15} aria-hidden="true" />{busy ? 'Deleting…' : 'Delete for good'}
        </button>
      </div>
    </form>
  )
}

// ---- the card ----

// The card while it's on its way: its own parts (head, tiles, the week strip) with stand-ins. The pre-paint stylesheet
// (lib/skeleton.js) shows it only on the owner's browser, with as many tiles as there were routines and, at the same
// window width, the height the card had (a phone's tiles wrap their lines)
const SK_HB = Array.from({ length: SK_MAX.habits }, (_, i) => i)
function HabitsSkeleton({ force }) {
  return (
    <section aria-label="Habits" aria-busy="true" className={`glass-panel rounded-3xl p-4 sm:p-5 hb sk-owner sk-hb-card ${force ? 'sk-force' : ''}`}>
      <span className="sr-only">Loading habits…</span>
      <div className="hb-head" aria-hidden="true">
        <div className="hb-dayring">
          <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="3" /></svg>
        </div>
        <div className="hb-title">
          <h2>Habits</h2>
          <span className="hb-sub"><Bone w="15ch" /></span>
        </div>
        <span className="hb-iconbtn hb-weekbtn sk-pulse"><CalendarDays size={16} /><ChevronDown size={14} className="chev" /></span>
        <span className="hb-iconbtn sk-pulse"><SlidersHorizontal size={16} /></span>
      </div>
      <ul className="hb-tiles" aria-hidden="true">
        {SK_HB.map((i) => (
          <li key={i} data-sk-hb={i} className="hb-tile">
            <div className="hb-tile-main">
              <span className="hb-well sk-pulse" />
              <div className="hb-text">
                <div className="hb-name"><Bone w="9ch" /></div>
                <div className="hb-line" data-show="meta">
                  <div className="hb-meta"><span><Bone w="12ch" /></span><span className="hb-chip"><Bone w="6ch" /></span></div>
                </div>
              </div>
              <span className="hb-sk-ring sk-pulse" />
            </div>
            <div className="hb-after"><div /></div>
          </li>
        ))}
      </ul>
      <div className="hb-fold sk-hb-fold" aria-hidden="true">
        <div>
          <div className="hb-week">
            <p className="hb-label" style={{ margin: 0 }}><Bone w="9ch" /></p>
            <div className="hb-wk"><span />{DOW.map((d, k) => <span key={k} className="hb-wk-day">{d}</span>)}</div>
            {SK_HB.map((i) => (
              <div key={i} className="hb-wk" data-sk-hb={i}>
                <div className="hb-wk-name"><b><Bone w="9ch" /></b><small><Bone w="10ch" /></small></div>
                {DOW.map((d, k) => <span key={k} className="hb-dot off" />)}
              </div>
            ))}
            <div className="hb-legend"><span><Bone w="20ch" /></span></div>
          </div>
        </div>
      </div>
    </section>
  )
}

const WEEK_KEY = 'habitsWeek' // the week strip folded open on this device
// hb: useHabits(). Nothing at all unless the server said this is the owner and answered. A short, wide bar: today's
// habits as tiles, the week folded under ▾, the routines behind the sliders.
// wait: the owner's card may be on its way (owner not known yet, or the first load), so its skeleton keeps the place;
// force: it surely is (the owner), whatever the remembered shape says
export function HabitsCard({ hb, wait = false, force = false }) {
  if (!hb.on) return wait ? <HabitsSkeleton force={force} /> : null
  return <HabitsBody hb={hb} />
}

// (mounted only once the data is here, in the browser: the week strip opens as it was, without animating open)
function HabitsBody({ hb }) {
  const dlg = useRef(null)
  const card = useRef(null)
  const [week, setWeek] = useState(() => {
    try {
      return localStorage.getItem(WEEK_KEY) === '1'
    } catch {
      return false
    }
  })
  const [, tick] = useState(0)
  const toggleWeek = () =>
    setWeek((w) => {
      try {
        localStorage.setItem(WEEK_KEY, w ? '0' : '1')
      } catch {}
      return !w
    })
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), hb.undoing ? 200 : 20_000)
    return () => clearInterval(t)
  }, [hb.undoing])
  useEffect(() => {
    if (!hb.undoing) return
    const t = setTimeout(hb.endUndo, Math.max(0, hb.undoing.until - Date.now()))
    return () => clearTimeout(t)
  }, [hb.undoing])
  const { data } = hb
  const now = hb.local()
  const today = data.today
  const habits = data.habits.filter((h) => !h.archived).sort((a, b) => order(a) - order(b))
  const todays = new Map(data.checkins.filter((c) => c.day === today).map((c) => [c.habitId, c]))
  const entry = (id) => todays.get(id)
  const due = habits.filter((h) => h.days.includes(dowOf(today)))
  const kept = due.filter((h) => entry(h.id) && entry(h.id).undoneAt == null).length
  const C = 2 * Math.PI * 13
  const u = hb.undoing && data.habits.find((h) => h.id === hb.undoing.habitId)
  const left = hb.undoing ? Math.max(0, hb.undoing.until - Date.now()) : 0
  const openRoutines = () => dlg.current?.showModal()
  // the next visit's skeleton: how many routines, the week strip, and this card's height at this window width
  const count = habits.length
  useEffect(() => rememberShape({ habits: count, hbWeek: week && count > 0 }), [count, week])
  useEffect(() => {
    const el = card.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let t = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => rememberShape({ hbH: { w: innerWidth, h: Math.round(el.getBoundingClientRect().height) } }), 600)
    })
    ro.observe(el)
    return () => (ro.disconnect(), clearTimeout(t))
  }, [])
  return (
    <section ref={card} aria-labelledby="hb-title" className="glass-panel rounded-3xl p-4 sm:p-5 hb">
      <div className="hb-head">
        <div className="hb-dayring" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="3" />
            <circle cx="16" cy="16" r="13" fill="none" stroke="var(--color-lofi-primary)" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - (due.length ? kept / due.length : 0))} style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)' }} />
          </svg>
        </div>
        <div className="hb-title">
          <h2 id="hb-title">Habits</h2>
          <span className="hb-sub">{!due.length ? 'nothing due today' : kept === due.length ? 'all kept today' : `${kept} of ${due.length} kept today`}</span>
        </div>
        {habits.length > 0 && (
          <button type="button" className={`hb-iconbtn hb-weekbtn${week ? ' is-open' : ''}`} aria-expanded={week} aria-controls="hb-week" aria-label={week ? 'Hide this week' : 'Show this week'} title="This week" onClick={toggleWeek}>
            <CalendarDays size={16} aria-hidden="true" /><ChevronDown size={14} className="chev" aria-hidden="true" />
          </button>
        )}
        <button type="button" className="hb-iconbtn" aria-haspopup="dialog" aria-label="Edit routines" title="Routines" onClick={openRoutines}><SlidersHorizontal size={16} aria-hidden="true" /></button>
      </div>

      {habits.length ? (
        <ul className="hb-tiles">
          {habits.map((h) => (
            <Tile key={h.id} habit={h} today={today} now={now} entry={entry(h.id)} fresh={hb.fresh === h.id} onKeep={hb.keep} onRate={hb.rate} onTakeBack={(x, r, d) => hb.takeBack(x, r, d)} />
          ))}
        </ul>
      ) : (
        <div className="hb-empty">
          <p>Set your first routine</p>
          <small>A time, the days, and who you are when you keep it. Then hold to keep it each day.</small>
          <button type="button" className="hb-ghost warm" onClick={openRoutines}>Add a routine</button>
        </div>
      )}

      {u && (
        <div className="hb-undo">
          <span className="ic" aria-hidden="true"><Glyph name={u.icon} size={16} /></span>
          {/* (the live region is the line that doesn't change: the countdown ticking isn't read out) */}
          <div className="msg">
            <span role="status">{u.name} kept</span>
            <small>{data.checkins.find((c) => c.habitId === u.id && c.day === hb.undoing.day)?.late ? 'late, still counts' : 'on time'}<span aria-hidden="true"> · undo for {Math.ceil(left / 1000)}s</span></small>
          </div>
          <button type="button" className="hb-ghost warm" onClick={() => hb.undo()}>Undo</button>
          <span className="bar" style={{ transform: `scaleX(${left / UNDO_MS})` }} />
        </div>
      )}
      {hb.note && <p className="hb-note" role="status">{hb.note}</p>}

      {habits.length > 0 && (
        <div id="hb-week" className={`hb-fold${week ? ' is-open' : ''}`} aria-hidden={!week}>
          <div><Week habits={habits} checkins={data.checkins} streaks={data.streaks} today={today} /></div>
        </div>
      )}
      <Routines hb={hb} dlg={dlg} />
    </section>
  )
}
