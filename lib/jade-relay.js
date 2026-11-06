// One turn with Jade, the server's side (app/api/private/settings/jade): open her WebSocket, hello, answer her MCP
// questions, send the recorded PCM as 60 ms Opus frames between listen start / stop (or a typed turn as one `chat`
// message, handover 4.4), and turn what she says into the
// NDJSON stream of lib/jade.js (her Opus decoded back to 16 kHz PCM). Server-only: `ws` (an outgoing socket with our own
// headers; Node's built-in WebSocket can't set them) and `opusscript` (libopus in WASM: no native addon, so the Docker
// build stays plain). Both are serverExternalPackages, loaded from node_modules as they are.
// - One connection a turn: connect + hello is well under a second on the LAN, and Jade hangs up after 8 s of silence
//   anyway, so a kept connection would mostly be a reconnect with more states to get wrong.
// - The page going away (its fetch aborted: pressed again, sheet closed, tab gone) sends Jade `abort` and hangs up, so
//   she stops talking to nobody.
import WebSocket from 'ws'
import OpusScript from 'opusscript'
import {
  CONNECT_MS, FRAME_SAMPLES, IDLE_MS, RATE, TURN_MAX_MS, abortMsg, chatMsg, connectHeaders, hello, jadeUrl, line, listenStart, listenStop,
  mcpReply, parseJade, pcmFrames,
} from './jade.js'

// The frames go faster than real time (a 5 s turn needn't take 5 s to send), but not as one burst: Jade queues audio
// apart from her text messages, so `listen stop` waits for the last frames to be taken in (SETTLE_MS) before it goes.
const BATCH = 4 // frames (240 ms of audio) each PACE_MS: ~6x real time
const PACE_MS = 40
const SETTLE_MS = 300
// after an empty / <bg> stt Jade says nothing more: end the turn when nothing else came within this
const UNHEARD_GRACE_MS = 1500
// ...and a turn her STT drops outright (her voice check: not Linh's voice) gets no stt at all (seen on the live Jade,
// 2026-11-03): no stt this long after listen stop = not heard, rather than a minute's wait
const STT_WAIT_MS = 10_000

export class JadeOffline extends Error {}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Connect and hello. -> { ws, session, onText, onBinary } (the turn's handlers are set later), or throws JadeOffline.
async function connect(clientId) {
  const ws = new WebSocket(jadeUrl(), { headers: connectHeaders(clientId), handshakeTimeout: CONNECT_MS, perMessageDeflate: false })
  const conn = { ws, session: null, onText: () => {}, onBinary: () => {}, onClose: () => {} }
  const send = (o) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o))
  conn.send = send
  ws.on('message', (data, binary) => {
    if (binary) return conn.onBinary(data)
    const m = parseJade(data.toString())
    if (!m) return
    if (m.kind === 'mcp') {
      const reply = mcpReply(m.payload, conn.session)
      if (reply) send(reply)
    } else if (m.kind === 'hello') {
      if (m.session && !conn.session) conn.session = m.session
      conn.onHello?.()
    } else conn.onText(m.line)
  })
  ws.on('close', () => conn.onClose())
  ws.on('error', () => {}) // (close follows; the handshake's failure rejects below)
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => fail(new JadeOffline('no hello')), CONNECT_MS)
    const fail = (e) => (clearTimeout(t), ws.terminate(), reject(e))
    ws.once('open', () => send(hello()))
    ws.once('error', (e) => fail(new JadeOffline(e.message)))
    conn.onClose = () => fail(new JadeOffline('closed before hello'))
    conn.onHello = () => (conn.session ? (clearTimeout(t), resolve()) : fail(new JadeOffline('hello without session')))
  })
  conn.onHello = null
  conn.onClose = () => {}
  return conn
}

// The turn: connects first (throws JadeOffline: the route answers 503), then -> a ReadableStream of NDJSON bytes.
// pcm: Uint8Array of 16 kHz mono Int16 LE; or text (lib/jade.js chatText's) and audio (false: she answers in text
// only). signal: the page's request (aborted = it went away). onEnd: once, when the turn is over whichever way (the
// route's one-turn-a-client slot).
export async function startTurn({ pcm, text, audio = true, clientId, signal, onEnd }) {
  const conn = await connect(clientId)
  const { ws, session, send } = conn
  const enc = new TextEncoder()
  let encoder = null, decoder = null
  let done = false, timer = null, idle = null, grace = null, sttWait = null
  let controller
  const free = () => {
    try { encoder?.delete() } catch {}
    try { decoder?.delete() } catch {}
    encoder = decoder = null
  }
  // every line (her events, each audio frame) restarts the idle clock: a long answer runs on, a stuck one ends
  const quiet = () => {
    clearTimeout(idle)
    idle = setTimeout(() => finish({ t: 'error', error: 'timeout' }), globalThis.__homeJadeIdle ?? IDLE_MS)
  }
  const push = (o) => {
    if (done) return
    quiet()
    try {
      controller.enqueue(enc.encode(line(o)))
    } catch {
      finish(null, true)
    }
  }
  // the one way out: the last line (unless the page is gone), Jade told to stop if she may still be thinking or talking
  // (the page went away, or something went wrong), hang up
  function finish(last, gone = false) {
    if (done) return
    if (last && !gone) push(last)
    if (done) return // (that push found the page gone, and finished)
    done = true
    onEnd?.()
    clearTimeout(timer)
    clearTimeout(idle)
    clearTimeout(grace)
    clearTimeout(sttWait)
    signal?.removeEventListener('abort', onAbort)
    if (gone || last?.t === 'error' || last?.reason === 'unheard') send(abortMsg(session))
    try { ws.close(1000) } catch {}
    setTimeout(() => ws.readyState !== WebSocket.CLOSED && ws.terminate(), 2000).unref?.()
    free()
    try { controller.close() } catch {} // (a page that went away: already cancelled; one replaced by its next turn: ends here)
  }
  const onAbort = () => finish(null, true)

  conn.onText = (l) => {
    if (done) return
    clearTimeout(sttWait)
    if (l.t === 'error') return finish(l) // (a typed turn she refused)
    // (a typed turn's stt is her echo of the text: never "not heard")
    if (l.t === 'stt' && !l.heard && text == null) {
      push(l)
      grace = setTimeout(() => finish({ t: 'end', reason: 'unheard' }), UNHEARD_GRACE_MS)
      return
    }
    if (l.t === 'tts' && l.state === 'start') clearTimeout(grace)
    push(l)
    if (l.t === 'tts' && l.state === 'stop') finish({ t: 'end', reason: 'done' })
  }
  conn.onBinary = (data) => {
    if (done) return
    try {
      decoder ??= new OpusScript(RATE, 1)
      const out = decoder.decode(data)
      push({ t: 'audio', pcm: Buffer.from(out).toString('base64') })
    } catch {} // (a bad packet: skip it, the next one plays)
  }
  conn.onClose = () => finish({ t: 'end', reason: 'closed' })

  const stream = new ReadableStream({
    start(c) {
      controller = c
      push({ t: 'ready' })
      if (signal?.aborted) return finish(null, true)
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => finish({ t: 'error', error: 'timeout' }), TURN_MAX_MS)
      if (text != null) sendText()
      else void sendAudio()
    },
    cancel() {
      finish(null, true)
    },
  })

  // a typed turn: one message; her echo of it (an stt) comes back at once, unless she refused it (an error line)
  function sendText() {
    send(chatMsg(session, text, audio))
    sttWait = setTimeout(() => finish({ t: 'error', error: 'chat' }), globalThis.__homeJadeSttWait ?? STT_WAIT_MS)
  }
  async function sendAudio() {
    try {
      encoder = new OpusScript(RATE, 1, OpusScript.Application.VOIP)
      send(listenStart(session))
      const frames = pcmFrames(pcm)
      for (let i = 0; i < frames.length && !done; i++) {
        ws.send(encoder.encode(Buffer.from(frames[i].buffer), FRAME_SAMPLES))
        if (i % BATCH === BATCH - 1) await wait(PACE_MS)
      }
      if (done) return
      await wait(SETTLE_MS)
      if (done) return
      send(listenStop(session))
      quiet() // (her idle clock starts over here: sending a long recording takes a while, then the stt wait below)
      sttWait = setTimeout(() => finish({ t: 'end', reason: 'unheard' }), globalThis.__homeJadeSttWait ?? STT_WAIT_MS) // (the tests: shorter)
    } catch {
      finish({ t: 'error', error: 'network' })
    }
  }
  return stream
}
