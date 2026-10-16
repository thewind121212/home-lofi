'use client'

// Focus sessions: a small Pomodoro that is the SAME on every one of the owner's devices. Rules in lib/focus.js; the
// route is app/api/private/settings/focus (owner-only: guests get 404 / 403 and see nothing); the phase changes, the
// notice and the phone's buzz are the server's (lib/focus-ticker.js), so they happen with every page closed.
// - An icon next to the header's bell (Reminders', Pins', Reading's): a timer; while a session runs, a ring round it
//   fills as the phase goes (the accent for focus, a calm green for a break; frozen and grey while paused), and its
//   label says what's left. A tap opens the sheet: the big mm:ss, the phase, 25 / 5 and 50 / 10 to start, Pause /
//   Resume, Skip, Stop, and 🍅 today. Every button draws its result at once (lib/focus.js act, the server's own rule)
//   and the server's answer then stands.
// - While one runs, a small countdown chip on Ambient's bar (a tap opens the sheet) and on the lock screen.
// - Sync: the state lives on the server. Every answer carries the server's clock; this page keeps the difference (the
//   quickest recent trip's: lib/focus.js addSkew) and counts down from phaseEndsAt with it (never by its own clock),
//   re-drawing on each second's edge, so every device shows the same mm:ss. One timer per page does that (useFocus's
//   beat; the pieces showing the countdown listen), and none while the page is hidden: shown again, it draws the right
//   value at once and pulls. Another device's change, or the server's phase change, comes as 'focus' on the live stream
//   (app/cloud.js): a pull. Pulls also on load, when the page shows again and when the window regains focus.
// - A soft chime (WebAudio, no file) when a phase runs out, on a device whose page is on screen (once per device: two
//   tabs on screen don't both ring); the phone in a pocket gets the server's push instead. No music is touched.
import './focus.css'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play, SkipForward, Square, Timer, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { closeDialog, useStillPage } from './settings'
import { DEFAULT_PRESET, MINUTE, PRESETS, PRESET_IDS, act, addSkew, cleanSession, countText, fmtLeft, iconLabel, leftOf, nextTickIn, paused, phaseLen, phaseLine, phaseName, ringOf, ringWords, running, skewOf, transitionKey } from '../lib/focus'

const URL_ = '/api/private/settings/focus'
const RETRY_MS = [3_000, 10_000, 30_000, 60_000] // a failed first load, tried again (then every minute)
const END_PULL_MS = 1_500 // a phase ran out here: the server's change should be in by then (the live event usually is)
const CHIME_LATE = 3_000 // a phase that ran out longer ago than this (the page was asleep): no chime, just the new state
const CHIMED = 'focus-chimed' // localStorage: the last phase end this device chimed for (its transitionKey)

// ---- the chime ----

// One AudioContext for the page, made (or woken) on a tap: browsers only let a page make sound after one. A device
// never tapped since it loaded may stay silent; its phone push still comes
let ctx = null
function audio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}
// Two soft bell notes (a sine and a quiet octave, a quick rise, a long fade): rising when a focus ends (a break),
// falling when a break ends (back to it). ~2 s, quiet. key: the phase that ended (transitionKey): a second tab of this
// browser on screen at the same moment stays quiet
export function chime(ended = 'focus', key = null) {
  try {
    if (key && localStorage.getItem(CHIMED) === key) return
    if (key) localStorage.setItem(CHIMED, key)
  } catch {}
  const c = audio()
  if (!c) return
  const notes = ended === 'focus' ? [659.25, 987.77] : [987.77, 659.25] // E5, B5
  const t0 = c.currentTime + 0.05
  notes.forEach((f, i) => {
    const t = t0 + i * 0.32
    for (const [mult, peak] of [[1, 0.11], [2, 0.025]]) {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.value = f * mult
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peak, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7)
      o.connect(g).connect(c.destination)
      o.start(t)
      o.stop(t + 1.8)
    }
  })
}

// ---- state: the server's, with the device only drawing it ----

// owner: settings sync answered as the owner (the page's `owner`); clientId(): this tab's live-stream id.
// -> { on, pending, session, today (🍅), note, now() (the server's clock, as this device knows it), live, pull,
//      start(preset), pause(), resume(), skip(), stop() }. The small API the rest of the page (and a command palette)
//      uses; every action is safe to call any time (one that makes no sense now is a no-op on the server: a 409)
export function useFocus(owner, clientId) {
  const [data, setData] = useState(null) // { session, today: { day, n }, now, tz, minute, presets }
  const [off, setOff] = useState(false)
  const [tried, setTried] = useState(false)
  const [note, setNote] = useState(null)
  const skew = useRef(0) // the server's clock minus this device's
  const samples = useRef([]) // the trips it's taken from (lib/focus.js addSkew)
  const api = useRef({})
  const seq = useRef({ sent: 0, shown: 0, at: 0 }) // an older answer landing later is out of date
  const writing = useRef(0) // actions on their way: a pull's answer (from before them) mustn't undo what they drew
  // one request at a time, in order (a resume never overtakes its pause), and one that fails doesn't hold up the next
  const queue = useRef(Promise.resolve())
  const enqueue = (fn) => (queue.current = queue.current.catch(() => {}).then(fn))
  const dataRef = useRef(data)
  dataRef.current = data
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const now = () => Date.now() + skew.current
  // the page's one countdown timer: the pieces that show mm:ss listen (useLeft), and it re-draws them on each second's
  // edge of the phase while one runs, someone listens and the page is on screen
  const beat = (useRef(null).current ??= makeBeat(() => {
    const s = dataRef.current?.session
    return running(s) ? leftOf(s, now()) : 0
  }))

  async function call(method, body) {
    const n = ++seq.current.sent
    seq.current.at = Date.now()
    const headers = {}
    const id = clientId?.()
    if (id) headers['x-home-client'] = id
    if (body !== undefined) headers['content-type'] = 'application/json'
    const t0 = Date.now(), p0 = performance.now()
    const r = await fetch(URL_, { method, cache: 'no-store', redirect: 'manual', headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const t1 = Date.now(), p1 = performance.now() // (the headers are in: the body's download is no part of the trip)
    if (r.status === 404 || r.status === 403) {
      setOff(true)
      setData(null)
      return null
    }
    const j = await r.json().catch(() => null)
    // the server's clock, at the middle of the trip (its `now` was read somewhere in there); the quickest trip wins
    if (Number.isFinite(j?.now)) {
      samples.current = addSkew(samples.current, { skew: j.now - (t0 + t1) / 2, rtt: p1 - p0, at: p1 })
      skew.current = skewOf(samples.current)
    }
    if (j && 'session' in j && n >= seq.current.shown && (body !== undefined || !writing.current)) {
      seq.current.shown = n
      setData({ ...j, session: cleanSession(j.session) })
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
      if (!failed) fails = 0
      else if (on && !dataRef.current && ownerRef.current) retry = setTimeout(pull, RETRY_MS[Math.min(fails++, RETRY_MS.length - 1)])
    }
    api.current.pull = pull
    api.current.live = (ms = 150) => {
      clearTimeout(soon)
      soon = setTimeout(pull, ms)
    }
    // shown again: the countdown's right value at once (the beat slept while hidden), then what's new
    const wake = () => {
      beat.arm()
      if (document.visibilityState === 'visible') pull()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      on = false
      clearTimeout(soon)
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
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

  // a new state or a new skew: the beat re-aims at the new second's edges and re-draws now
  useEffect(() => void beat.arm(), [data, beat])

  // A phase running out on this device's (corrected) clock: the chime, if the page is on screen, then a pull for the
  // server's next phase (the live event usually brings it first). Not for a phase that ran out long ago (the page slept)
  const s = data?.session ?? null
  const endsAt = running(s) ? s.phaseEndsAt : null
  useEffect(() => {
    if (endsAt == null) return
    let t2 = 0
    const ended = s.phase
    const key = transitionKey(s)
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible' && now() - endsAt < CHIME_LATE) chime(ended, key)
      t2 = setTimeout(() => api.current.pull?.(), END_PULL_MS)
    }, Math.max(0, endsAt - now()))
    return () => (clearTimeout(t), clearTimeout(t2))
  }, [s?.id, s?.round, s?.phase, endsAt])
  // while one runs, the first tap anywhere wakes the sound (so this device can chime at the end)
  const live = Boolean(s)
  useEffect(() => {
    if (!live) return
    const wakeAudio = () => audio()
    addEventListener('pointerdown', wakeAudio, { once: true, capture: true })
    addEventListener('keydown', wakeAudio, { once: true, capture: true })
    return () => (removeEventListener('pointerdown', wakeAudio, { capture: true }), removeEventListener('keydown', wakeAudio, { capture: true }))
  }, [live])

  // an action: drawn now by the same rule the server runs, then sent; the answer (or a 409's fresh state) replaces it.
  // Failed otherwise (offline, 503): what was on screen before it comes back at once (unless a newer answer has been
  // drawn meanwhile), then a pull for what's true
  function send(action, preset) {
    const d = dataRef.current
    if (!d || !ownerRef.current) return
    audio() // (inside the tap: this device may chime later)
    const r = act(d.session, { action, preset }, now(), { id: d.session?.id ?? 'pending', minute: d.minute ?? MINUTE })
    if (r.error) return void api.current.pull?.() // (out of date here: what's true now)
    const shown = seq.current.shown
    setData({ ...d, session: r.session })
    writing.current++
    enqueue(() => call('POST', preset ? { action, preset } : { action }))
      .catch((e) => {
        if (e?.status === 409) return setNote(e.message.charAt(0).toUpperCase() + e.message.slice(1))
        if (seq.current.shown === shown) setData((cur) => (cur?.session === r.session ? d : cur))
        setNote("Couldn't reach the server: check the connection and try again")
        api.current.pull?.()
      })
      .finally(() => writing.current--)
  }

  const on = Boolean(owner && data && !off)
  return {
    on,
    pending: Boolean(owner && !data && !off && !tried), // the owner's first load is on its way: the skeleton
    session: on ? s : null,
    today: on ? (data.today?.n ?? 0) : 0,
    minute: data?.minute ?? MINUTE,
    note,
    now,
    beat,
    // 'focus': another device (or the server's ticker) changed it; 'hello': the stream (re)connected
    live: (kind) => (kind === 'focus' || (kind === 'hello' && Date.now() - seq.current.at > 3000)) && api.current.live?.(),
    pull: () => api.current.pull?.(),
    start: (preset = DEFAULT_PRESET) => PRESETS[preset] && send('start', preset),
    pause: () => send('pause'),
    resume: () => send('resume'),
    skip: () => send('skip'),
    stop: () => send('stop'),
  }
}

// The page's one countdown timer (useFocus's beat): a tiny store the pieces showing mm:ss listen to. left(): the
// running phase's time left (0: none running). It fires just after each second's edge of the phase (every device turns
// over together), only while someone listens and the page is on screen; arm() re-aims it (a new state, the page shown
// again) and re-draws at once
function makeBeat(left) {
  const subs = new Set()
  let n = 0, t = 0
  const draw = () => {
    n++
    for (const f of subs) f()
  }
  function arm() {
    clearTimeout(t)
    if (!subs.size || document.visibilityState === 'hidden') return
    draw()
    const wait = nextTickIn(left())
    if (wait != null) t = setTimeout(arm, wait + 15)
  }
  return {
    arm,
    get: () => n,
    sub(f) {
      subs.add(f)
      if (subs.size === 1) arm()
      return () => {
        subs.delete(f)
        if (!subs.size) clearTimeout(t)
      }
    },
  }
}

// The time left now, re-drawn on the beat while it runs. Only the piece that shows it re-draws, not the page
export function useLeft(fc) {
  useSyncExternalStore(fc.beat.sub, fc.beat.get, () => 0)
  return leftOf(fc.session, fc.now())
}

export const focusShowing = (fc) => Boolean(fc.on && fc.session)
const ringTone = (s) => (paused(s) ? 'stroke-lofi-muted' : s.phase === 'break' ? 'stroke-emerald-400' : 'stroke-lofi-primary')
const iconTone = (s) => (paused(s) ? 'text-lofi-muted' : s.phase === 'break' ? 'text-emerald-400' : 'text-lofi-primary')

// ---- the header icon ----

// Its button on top of the dock (over ⛰): a timer; while a session runs, a ring for how far this phase has gone, the
// label what's left. Nothing at all unless the server said this is the owner and answered. wait: it may be on its way (owner
// not known yet, or the first load), so its skeleton keeps the place; force: it surely is the owner's
export function FocusIcon({ fc, wait = false, force = false, onOpen, className = '' }) {
  useLeft(fc)
  if (!fc.on) return wait ? <HeadIconSkeleton force={force} dock className={className} /> : null
  const s = fc.session
  const ms = fc.now()
  return (
    <HeadIcon
      dock
      className={className}
      label={iconLabel(s, ms)}
      fa="fa-stopwatch"
      ring={s ? ringOf(s, ms) : null}
      ringClass={s ? ringTone(s) : undefined}
      warm={running(s) && s.phase === 'focus'}
      onOpen={() => onOpen()}
    />
  )
}

// ---- the sheet ----

export function FocusSheet({ fc, dlg }) {
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  const pull = useRef(fc.pull)
  pull.current = fc.pull
  useEffect(() => void (open && pull.current()), [open])
  const close = () => closeDialog(dlg.current)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="fc-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => delete dlg.current.dataset.closing}
      className="wx-sheet sm:max-w-md glass-panel text-lofi-text overscroll-contain"
    >
      {fc.on && <FocusBody fc={fc} onClose={close} />}
    </dialog>
  )
}

// The sheet: a timer, not a form. A big ring round the countdown (it fills as the phase goes: the accent for focus,
// green for a break, grey while paused), what it is over the time and where it's at under it; then the controls as a
// player has them: the big round Pause / Resume in the middle, Stop and Skip either side. Nothing running: the two
// lengths as one switch (the ring shows the one picked) and one big Start. Today's 🍅 in the head
const RING_R = 92
const RING_C = 2 * Math.PI * RING_R
function FocusBody({ fc, onClose }) {
  const left = useLeft(fc)
  const [pick, setPick] = useState(DEFAULT_PRESET)
  const s = fc.session
  const ms = fc.now()
  const tone = !s ? 'is-idle' : paused(s) ? 'is-paused' : s.phase === 'break' ? 'is-break' : 'is-focus'
  const pct = s ? ringOf(s, ms) : 0
  const words = ringWords(s, pick)
  return (
    <section aria-labelledby="fc-title" className={`p-5 sm:p-6 fc ${tone}`}>
      <div className="fc-head">
        <h2 id="fc-title">Focus</h2>
        <span className="fc-count">{countText(fc.today)}</span>
        <button type="button" className="hb-iconbtn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>

      <div className="fc-dial">
        <svg viewBox="0 0 200 200" className="fc-ring" aria-hidden="true">
          <circle cx="100" cy="100" r={RING_R} className="fc-ring-track" />
          <circle cx="100" cy="100" r={RING_R} className="fc-ring-fill" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - pct / 100)} />
        </svg>
        <div className="fc-face">
          <span className="fc-label">{words.label}</span>
          <span className="fc-time" role="timer" aria-label={s ? iconLabel(s, ms) : 'No focus session'}>
            {s ? fmtLeft(left) : fmtLeft(phaseLen(pick, 'focus', fc.minute))}
          </span>
          <span className="fc-detail">{words.detail}</span>
        </div>
      </div>

      {s ? (
        <div className="fc-controls">
          <span className="fc-side">
            <button type="button" className="fc-round" onClick={() => fc.stop()} aria-label="Stop the session"><Square size={15} strokeWidth={2.4} aria-hidden="true" /></button>
            <span aria-hidden="true">Stop</span>
          </span>
          {paused(s) ? (
            <button type="button" className="fc-big" onClick={() => fc.resume()} aria-label="Resume"><Play size={26} strokeWidth={2.2} aria-hidden="true" /></button>
          ) : (
            <button type="button" className="fc-big" onClick={() => fc.pause()} aria-label="Pause"><Pause size={26} strokeWidth={2.2} aria-hidden="true" /></button>
          )}
          <span className="fc-side">
            <button type="button" className="fc-round" onClick={() => fc.skip()} aria-label={s.phase === 'focus' ? 'Skip to the break' : 'Skip the break: focus now'}><SkipForward size={17} strokeWidth={2} aria-hidden="true" /></button>
            <span aria-hidden="true">{s.phase === 'focus' ? 'Break' : 'Focus'}</span>
          </span>
        </div>
      ) : (
        <div className="fc-start">
          <div className="fc-switch" role="radiogroup" aria-label="Length">
            {PRESET_IDS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={pick === p} className="fc-opt" onClick={() => setPick(p)} aria-label={`${PRESETS[p][0]} minutes focus, ${PRESETS[p][1]} minutes break`}>
                {PRESETS[p][0]}<small> / {PRESETS[p][1]}</small>
              </button>
            ))}
          </div>
          <button type="button" className="fc-big" onClick={() => fc.start(pick)} aria-label={`Start: ${PRESETS[pick][0]} minutes focus`}><Play size={26} strokeWidth={2.2} aria-hidden="true" /></button>
        </div>
      )}
      {fc.note && <p className="hb-note" role="status">{fc.note}</p>}
    </section>
  )
}

// ---- Ambient and the lock screen ----
// While a session runs (or is paused): a chip on Ambient's bar (a tap opens the sheet) and a pill on the lock screen
// (not a button there: a swipe over it still unlocks)

export function FocusChip({ fc, onOpen }) {
  const left = useLeft(fc)
  if (!focusShowing(fc)) return null
  const s = fc.session
  return (
    <button
      type="button"
      onClick={() => onOpen()}
      aria-haspopup="dialog"
      aria-label={`${iconLabel(s, fc.now())}. Open focus`}
      title={phaseLine(s)}
      className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap text-white hover:text-lofi-primary transition-colors"
    >
      {paused(s) ? <Pause size={13} strokeWidth={2.2} className="text-lofi-muted" aria-hidden="true" /> : <Timer size={14} strokeWidth={2} className={iconTone(s)} aria-hidden="true" />}
      <span className="max-sm:hidden font-sans text-xs text-lofi-muted">{phaseName(s)}</span>
      <span className={`text-xs tabular-nums ${paused(s) ? 'text-lofi-muted' : ''}`}>{fmtLeft(left)}</span>
    </button>
  )
}

export function LockFocus({ fc }) {
  const left = useLeft(fc)
  if (!focusShowing(fc)) return null
  const s = fc.session
  return (
    <div role="timer" aria-label={iconLabel(s, fc.now())} className="glass-panel h-9 px-3.5 rounded-full flex items-center gap-2 font-mono text-xs text-white">
      {paused(s) ? <Pause size={13} strokeWidth={2.2} className="text-lofi-muted" aria-hidden="true" /> : <Timer size={14} strokeWidth={2} className={iconTone(s)} aria-hidden="true" />}
      <span className="text-lofi-muted">{phaseName(s)}{paused(s) ? ' · paused' : ''}</span>
      <span className="tabular-nums">{fmtLeft(left)}</span>
    </div>
  )
}
