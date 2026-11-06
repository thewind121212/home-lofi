'use client'

// Talk to Jade: the owner's Vietnamese voice assistant on the Razer, from this page. An icon by the header's bell (the
// owner's only, like Pins) opens a sheet: one big hold-to-talk button and the chat of this page's session. The protocol
// and the relay live on the server (lib/jade.js, lib/jade-relay.js, app/api/private/settings/jade): the browser can't
// reach Jade itself (an https page can't open her ws:// on the LAN, and her port never faces the internet).
// - Hold: the mic records (the browser's echo cancelling / noise suppression / auto gain on), downsampled to 16 kHz
//   mono Int16 as it comes (an AudioWorklet, else a ScriptProcessor). Release: the recording goes up in one POST and
//   the answer streams back as NDJSON lines: what Jade heard (Linh's bubble), her sentences (her bubble, with her
//   mood's emoji) and her voice (16 kHz PCM), played gaplessly with WebAudio a little ahead (LEAD).
// - Pressing again while she thinks or talks interrupts her: the fetch is aborted (the server tells Jade `abort`), her
//   voice stops at once, and the new turn starts. Closing the sheet does the same.
// - iOS: the AudioContext is made and resumed inside the press itself (iOS lets sound start only in a gesture); the mic
//   is opened per press and closed on release, so the page's music (and the home station's silence loop that keeps a
//   locked iPhone playing, app/player.js) is left alone between turns. The radio pauses while Jade talks (onTalk) and
//   comes back after.
// - Or type (handover 4.4): the box under the button sends a typed turn (JSON to the same route), Linh's bubble at once,
//   Jade's answer as for speech. 🔊 beside it: she also says it aloud (remembered), or answers in text only (faster,
//   silent, the radio left playing). Typing on a phone, the sheet takes the part of the screen the keyboard leaves.
import './jade.css'
import { useEffect, useRef, useState } from 'react'
import { AudioLines, Mic, SendHorizontal, Volume2, VolumeX, X } from 'lucide-react'
import { HeadIcon, HeadIconSkeleton } from './head-icon'
import { closeDialog, load, save, useStillPage } from './settings'
import { useRoom } from './use-room'
import { MAX_MS, MIN_MS, MSG, STATES, TEXT_MAX, chatText, downsample, level, splitLines, toolLabel } from '../lib/jade'
import { privateAnswer } from '../lib/private-poll'

const URL_ = '/api/private/settings/jade'
const LEAD = 0.12 // s: how far ahead Jade's voice is scheduled (a small buffer against the network's unevenness)
const CLIENT_KEY = 'jadeClient'
const VOICE_KEY = 'jadeVoice' // typed turns: she answers aloud too (true) or in text only
const COMPACT_H = 560 // typing on a touch screen with less room than this (a phone's keyboard up): the compact sheet

// its button on the dock, over Focus (the header's row was full on phones): the owner's only (owner known); its stand-in
// circle while that isn't known yet
export function JadeIcon({ owner, wait = false, onOpen }) {
  if (!owner) return wait ? <HeadIconSkeleton dock /> : null
  return <HeadIcon dock label="Talk to Jade" icon={AudioLines} onOpen={() => onOpen()} />
}

// this browser's Client-Id for Jade: a UUID kept in localStorage (private mode: one for the page's life)
function clientId() {
  try {
    const v = localStorage.getItem(CLIENT_KEY)
    if (v) return v
    const id = crypto.randomUUID()
    localStorage.setItem(CLIENT_KEY, id)
    return id
  } catch {
    return (globalThis.__jadeClient ??= crypto.randomUUID())
  }
}

// the recorder's worklet: hands each quantum's samples to the page (a Blob URL: no file to serve)
// ({ stop: true } from the page: process() returns false, so the browser drops this press's processor)
const WORKLET = `registerProcessor('jd-rec', class extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = (e) => { if (e.data && e.data.stop) this.on = false } }
  process(inputs) { if (!this.on) return false; const c = inputs[0] && inputs[0][0]; if (c && c.length) this.port.postMessage(c.slice(0)); return true }
})`
const workletReady = new WeakMap() // AudioContext -> the addModule promise (once each)

// her sentences into one bubble: her splitter drops the punctuation where it cut (text-only turns), so a piece that
// ends without any gets a comma (handover 4.4)
const joinSaid = (a, b) => (!a ? b : `${a}${/[.!?…,;:)"”]$/.test(a) ? '' : ','} ${b}`)

let ids = 0
const nextId = () => ++ids

export function JadeSheet({ dlg, onTalk }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState('idle') // idle | listening | thinking | speaking | offline
  const [note, setNote] = useState(null) // a hint under the button (Vietnamese)
  const [tool, setTool] = useState(null) // the tool Jade is calling right now ("% thoi_tiet"): a status line, not a bubble
  const [msgs, setMsgs] = useState([]) // { id, who: 'me' | 'jade' | 'sys', text, emoji }
  const [draft, setDraft] = useState('') // the box's text
  const [voice, setVoice] = useState(() => load(VOICE_KEY, true) !== false)
  const [typing, setTyping] = useState(false) // the box has the focus
  useStillPage(dlg, open)
  const room = useRoom(open)
  const [touch] = useState(() => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches)
  const compact = typing && touch && (room.h < room.full * 0.75 || room.h < COMPACT_H)
  const r = useRef({ sources: new Set() }).current // the recorder, the player and the turn: plain mutable state, no re-render
  const btn = useRef(null)
  const list = useRef(null)
  const talk = useRef(onTalk)
  talk.current = onTalk
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  // closed: Jade stops (the fetch aborted), the mic and her voice too
  useEffect(() => void (!open && stopAll()), [open])
  useEffect(() => () => stopAll(), [])
  useEffect(() => void list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }), [msgs, compact])
  // the compact sheet: the dialog sized to the visible part (--jd-vv-h / --jd-vv-top, app/jade.css; as Pins does)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    d.toggleAttribute('data-compact', compact)
    d.style.setProperty('--jd-vv-h', `${room.h}px`)
    d.style.setProperty('--jd-vv-top', `${room.top}px`)
    return () => void d.removeAttribute('data-compact')
  }, [dlg, compact, room.h, room.top])

  const add = (m) => setMsgs((all) => [...all.slice(-80), { id: nextId(), ...m }])
  // Jade's bubble for this turn: made on her first word or emoji, then added to
  const jade = (fn) =>
    setMsgs((all) => {
      const last = all.at(-1)
      if (last?.who === 'jade' && last.turn === r.turn) return [...all.slice(0, -1), fn(last)]
      return [...all, fn({ id: nextId(), who: 'jade', turn: r.turn, text: '', emoji: '' })]
    })
  const ring = (v) => btn.current?.style.setProperty('--jd-lvl', v.toFixed(3))

  // ---- the mic ----
  function stopMic() {
    clearTimeout(r.maxT)
    r.recording = false
    try { r.node?.port?.postMessage({ stop: true }) } catch {}
    try { r.node?.disconnect() } catch {}
    try { r.src?.disconnect() } catch {}
    r.stream?.getTracks().forEach((t) => t.stop())
    r.node = r.src = r.stream = null
    ring(0)
  }
  function onSamples(f32) {
    if (!r.recording) return
    r.chunks.push(downsample(f32, r.ctx.sampleRate, r.carry))
    r.lvl = Math.max(level(f32), (r.lvl ?? 0) * 0.85) // falls back gently, so the ring doesn't flicker
    ring(r.lvl)
  }
  async function openMic(press) {
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    } catch (e) {
      if (r.press !== press) return
      r.recording = false
      setState('idle')
      setNote(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? MSG.denied : MSG.nomic)
      talk.current?.(false)
      return
    }
    if (r.press !== press || !r.recording) return stream.getTracks().forEach((t) => t.stop()) // released already
    const ctx = r.ctx
    if (ctx.state !== 'running') void ctx.resume().catch(() => {}) // (a page that's capturing may start its sound)
    r.stream = stream
    r.src = ctx.createMediaStreamSource(stream)
    let node = null
    try {
      if (!ctx.audioWorklet) throw new Error('no worklet')
      if (!workletReady.has(ctx)) workletReady.set(ctx, ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))))
      await workletReady.get(ctx)
      node = new AudioWorkletNode(ctx, 'jd-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      node.port.onmessage = (e) => onSamples(e.data)
    } catch {
      node = ctx.createScriptProcessor(2048, 1, 1) // (older Safari)
      node.onaudioprocess = (e) => onSamples(e.inputBuffer.getChannelData(0).slice())
    }
    if (r.press !== press || !r.recording) {
      r.node = node
      return stopMic()
    }
    r.node = node
    r.src.connect(node)
    node.connect(ctx.destination) // (it writes nothing: silence; connected so the browser runs it)
    talk.current?.(true) // the mic is on: the radio pauses (only now: a mic that fails leaves it playing)
  }

  // ---- Jade's voice ----
  function stopVoice() {
    for (const s of r.sources ?? []) try { s.stop() } catch {}
    r.sources = new Set()
    r.next = 0
    clearTimeout(r.doneT)
  }
  function play(b64) {
    const ctx = r.ctx
    if (!ctx) return
    const bin = atob(b64)
    const n = bin.length >> 1
    const buf = ctx.createBuffer(1, n, 16000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < n; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
      ch[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000
    }
    const s = ctx.createBufferSource()
    s.buffer = buf
    s.connect(ctx.destination)
    const at = Math.max(r.next || 0, ctx.currentTime + (r.next > ctx.currentTime ? 0 : LEAD))
    s.start(at)
    r.next = at + buf.duration
    r.sources.add(s)
    s.onended = () => r.sources.delete(s)
  }
  // the turn's over: back to ready once her voice has played out (the radio too)
  function settle(st = 'idle') {
    setTool(null)
    const left = r.ctx && r.next ? Math.max(0, r.next - r.ctx.currentTime) : 0
    clearTimeout(r.doneT)
    r.doneT = setTimeout(() => {
      if (r.ac || r.recording) return // (a new turn started meanwhile)
      setState(st)
      talk.current?.(false)
      sleep()
    }, left * 1000 + 50)
  }
  // nothing to hear or record: let the AudioContext sleep (a phone's audio hardware too); press() wakes it
  const sleep = () => void (r.ctx?.state === 'running' && r.ctx.suspend().catch(() => {}))
  const wake = () => void (r.ctx && r.ctx.state !== 'running' && r.ctx.resume().catch(() => {}))

  function stopAll() {
    r.press = null
    r.ac?.abort()
    r.ac = null
    stopMic()
    stopVoice()
    if (stateRef.current !== 'idle' && stateRef.current !== 'offline') setState('idle')
    talk.current?.(false)
    sleep()
  }

  // ---- a turn ----
  function press() {
    if (r.recording) return
    navigator.vibrate?.(12)
    // iOS: the context is made and woken inside the gesture, or it stays silent
    try {
      r.ctx ??= new (window.AudioContext || window.webkitAudioContext)()
      if (r.ctx.state !== 'running') void r.ctx.resume().catch(() => {})
    } catch {}
    // pressed while Jade thinks or talks: she stops, this is the next turn
    r.ac?.abort()
    r.ac = null
    stopVoice()
    setNote(null)
    setTool(null)
    setState('listening')
    const p = {}
    r.press = p
    r.at = performance.now()
    r.recording = true
    r.chunks = []
    r.carry = { pos: 0 }
    r.lvl = 0
    if (!navigator.mediaDevices?.getUserMedia || !r.ctx) {
      r.recording = false
      setState('idle')
      talk.current?.(false) // (an interrupted answer: the radio comes back)
      return setNote(MSG.nomic)
    }
    r.maxT = setTimeout(() => release(), MAX_MS) // a minute at most
    void openMic(p)
  }
  function release() {
    if (!r.recording) return
    navigator.vibrate?.(8)
    // (iOS may count only the release as the gesture that lets sound start: wake it here too, before her voice comes)
    if (r.ctx && r.ctx.state !== 'running') void r.ctx.resume().catch(() => {})
    const held = performance.now() - r.at
    const chunks = r.chunks
    stopMic()
    const samples = chunks.reduce((n, c) => n + c.length, 0)
    if (held < MIN_MS || samples < (16000 * MIN_MS) / 1000 / 2) {
      r.press = null
      setState('idle')
      setNote(MSG.short)
      talk.current?.(false)
      return
    }
    const pcm = new Int16Array(samples)
    let at = 0
    for (const c of chunks) pcm.set(c, at), (at += c.length)
    void send(new Uint8Array(pcm.buffer))
  }

  // a typed turn: Linh's bubble at once; sent while Jade thinks or talks, it interrupts her (as pressing does)
  function type(e) {
    e?.preventDefault()
    const text = chatText(draft)
    if (!text || r.recording) return
    if (voice) {
      // (iOS: her voice can start only from a context woken in a gesture: this submit is one)
      try {
        r.ctx ??= new (window.AudioContext || window.webkitAudioContext)()
        if (r.ctx.state !== 'running') void r.ctx.resume().catch(() => {})
      } catch {}
    }
    r.press = null
    r.ac?.abort()
    r.ac = null
    stopVoice()
    setNote(null)
    setTool(null)
    setDraft('')
    add({ who: 'me', text })
    void send(JSON.stringify({ text, audio: voice }), true)
  }
  const toggleVoice = () => setVoice((v) => (save(VOICE_KEY, !v), !v))

  async function send(body, typed = false) {
    const ac = new AbortController()
    r.ac = ac
    r.turn = nextId()
    r.typed = typed
    r.heard = typed // (a typed turn: Linh's bubble is up already; her stt is only its echo)
    r.saidUnheard = r.spoke = r.echo = r.loud = false
    setState('thinking')
    const fail = (text, st = 'idle') => {
      if (r.ac !== ac) return
      r.ac = null
      setNote(text)
      settle(st)
    }
    let res
    try {
      res = await fetch(`${URL_}?client=${encodeURIComponent(clientId())}`, {
        method: 'POST', body, signal: ac.signal, cache: 'no-store', redirect: 'manual',
        headers: { 'content-type': typed ? 'application/json' : 'application/octet-stream' },
      })
    } catch {
      return ac.signal.aborted ? undefined : fail(MSG.network, 'offline')
    }
    if (!res.ok) {
      const j = await res.json().catch(() => null)
      if (privateAnswer(res.status, res.type) === 'locked') return fail('Hết phiên đăng nhập: tải lại trang rồi đăng nhập nhé')
      // (the route's own Vietnamese lines carry a code; anything else, e.g. a bad client id, isn't for reading)
      return fail(j?.code && j.error ? j.error : MSG.failed, res.status === 503 || res.status >= 500 ? 'offline' : 'idle')
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let rest = ''
    let ended = null
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const out = splitLines(rest + dec.decode(value, { stream: true }))
        rest = out.rest
        for (const l of out.lines) {
          if (r.ac !== ac) return
          if (l.t === 'end' || l.t === 'error') ended = l
          else onLine(l)
        }
      }
    } catch {
      if (ac.signal.aborted || r.ac !== ac) return
      return fail(MSG.network, 'offline')
    }
    if (r.ac !== ac) return
    if (ended?.t === 'error') return fail(MSG[ended.error] ?? MSG.network, ended.error === 'network' ? 'offline' : 'idle')
    // a typed goodbye ("tạm biệt", "cảm ơn" on its own): she hangs up without a word, not even the echo
    if (typed && !r.echo && ended?.reason === 'closed') {
      add({ who: 'sys', text: MSG.bye })
      return fail(null)
    }
    // Jade hung up (or the stream broke off) before saying what she heard: the connection, not the voice
    if (!r.heard && ended?.reason !== 'unheard' && !r.saidUnheard) return fail(MSG.network, 'offline')
    if (!r.heard) {
      if (!r.saidUnheard) add({ who: 'sys', text: MSG.unheard })
      return fail(null)
    }
    if (ended?.reason === 'closed' && !r.spoke) return fail(MSG.network, 'offline')
    r.ac = null
    settle()
  }

  function onLine(l) {
    // (her tool's done once she starts her next sentence, or is done talking; her voice still playing doesn't end it)
    if (l.t === 'stt' || l.t === 'say' || (l.t === 'tts' && l.state === 'stop')) setTool(null)
    if (l.t === 'tool') setTool(l.name)
    else if (l.t === 'stt' && r.typed) r.echo = true
    else if (l.t === 'stt') {
      r.heard = l.heard
      r.saidUnheard = !l.heard
      if (l.heard) add({ who: 'me', text: l.text })
      else add({ who: 'sys', text: MSG.unheard })
    } else if (l.t === 'emoji') jade((m) => ({ ...m, emoji: l.emoji }))
    else if (l.t === 'say') {
      r.spoke = true
      jade((m) => ({ ...m, text: joinSaid(m.text, l.text) }))
    } else if (l.t === 'tts' && l.state === 'start') {
      r.spoke = false
      setState('speaking')
    } else if (l.t === 'audio') {
      if (stateRef.current !== 'speaking') setState('speaking')
      if (!r.loud) (r.loud = true), talk.current?.(true) // (a typed turn's voice: the radio pauses for it)
      play(l.pcm)
    }
  }

  const close = () => closeDialog(dlg.current)
  // Space: hold to talk on a keyboard (not while a button or a field has it: Space presses those)
  const isKey = (e) => e.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !(e.target.tagName === 'BUTTON' && e.target !== btn.current)
  const live = state === 'listening'
  const busy = state === 'thinking' || state === 'speaking'
  // the line under the button: an error or her tool first; then a hint (typing: what she's doing, the button's own state
  // line steps aside)
  const said = note ?? (tool && busy ? toolLabel(tool) : null)
  const hint = said ?? (typing ? (busy ? `${STATES[state]}…` : null) : state === 'idle' ? 'Giữ nút (hoặc phím Space) để nói' : busy ? 'Nhấn lại để ngắt lời' : null)
  return (
    <dialog
      ref={dlg}
      aria-labelledby="jd-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => delete dlg.current.dataset.closing}
      onKeyDown={(e) => isKey(e) && (e.preventDefault(), e.repeat || press())}
      onKeyUp={(e) => isKey(e) && (e.preventDefault(), wake(), release())}
      className="wx-sheet jd-sheet sm:max-w-lg glass-panel text-lofi-text"
    >
      <section aria-labelledby="jd-title" className={`jd${typing ? ' is-typing' : ''}${compact ? ' is-compact' : ''}`}>
        <div className="jd-head">
          <span className="jd-mark" aria-hidden="true"><AudioLines size={17} strokeWidth={1.9} /></span>
          <div className="jd-title">
            <h2 id="jd-title">Jade</h2>
            <span className="jd-sub">trợ lý giọng nói ở nhà</span>
          </div>
          <button type="button" className="hb-iconbtn" aria-label="Close" onClick={close}><X size={18} aria-hidden="true" /></button>
        </div>
        <ol ref={list} className="jd-chat" data-scroll aria-live="polite">
          {msgs.length === 0 && <li className="jd-empty">Giữ nút và nói, hoặc nhắn bên dưới, ví dụ “Jade ơi, mấy giờ rồi?”</li>}
          {msgs.map((m) => (
            <li key={m.id} className={`jd-msg jd-${m.who}`}>
              {m.who === 'jade' && m.emoji && <span className="jd-emoji" aria-hidden="true">{m.emoji}</span>}
              <span className="jd-text">{m.text || '…'}</span>
            </li>
          ))}
        </ol>
        <div className={`jd-talk is-${state}${hint ? '' : ' no-hint'}`}>
          <button
            ref={btn}
            type="button"
            className="jd-btn"
            aria-label={`Giữ để nói với Jade (${STATES[state]})`}
            aria-pressed={live}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              e.currentTarget.setPointerCapture?.(e.pointerId)
              press()
            }}
            onPointerUp={() => (wake(), release())}
            onPointerCancel={() => release()}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          >
            <span className="jd-ring" aria-hidden="true" />
            <Mic size={34} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <p className="jd-state" role="status">{STATES[state]}</p>
          <p className="jd-note">{hint ?? '\u00a0'}</p>
        </div>
        <form className="jd-type" onSubmit={type}>
          <button
            type="button"
            className="jd-voice"
            aria-pressed={voice}
            aria-label="Jade đọc to câu trả lời"
            title={voice ? 'Jade trả lời bằng giọng nói' : 'Jade chỉ trả lời bằng chữ'}
            onPointerDown={(e) => typing && e.preventDefault()} // (the box keeps the focus: a phone's keyboard stays up)
            onClick={toggleVoice}
          >
            {voice ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
          </button>
          <input
            className="jd-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            maxLength={TEXT_MAX}
            placeholder="Nhắn cho Jade…"
            aria-label="Nhắn cho Jade"
            enterKeyHint="send"
            autoComplete="off"
            lang="vi"
          />
          <button type="submit" className="jd-send" aria-label="Gửi" disabled={!draft.trim()} onPointerDown={(e) => typing && e.preventDefault()}>
            <SendHorizontal size={18} aria-hidden="true" />
          </button>
        </form>
      </section>
    </dialog>
  )
}
