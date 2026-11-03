// A stand-in Jade (xiaozhi-esp32-server's WebSocket, the parts Talk to Jade uses), for lib/jade-route.test.js and for
// trying the sheet without the Razer:  node scripts/jade-fake.mjs [port]  then JADE_WS_URL=ws://127.0.0.1:<port>/xiaozhi/v1/
// It checks the headers, answers hello with a session, asks the device's MCP initialize + tools/list, takes the turn's
// Opus frames and answers "mấy giờ rồi" with two sentences and real Opus audio (a soft tone).
// mode (the argument, or set j.wss.mode): 'ok' | 'bg' (stt <bg>, nothing more) | 'mute' (no stt at all) | 'long' (talks ~20 s:
// abort it) | 'nohello' (never says hello) | 'drop' (hangs up after the turn's stt) | 'stall' (stt, tts start, then silence)
import { WebSocketServer } from 'ws'
import OpusScript from 'opusscript'

export function fakeJade({ port = 0, mode = 'ok' } = {}) {
  const log = [] // what each connection did: { headers, sent: [messages], frames, decodedBytes, aborted, closed }
  const wss = new WebSocketServer({ port, path: '/xiaozhi/v1/' })
  const tone = (n) => {
    const enc = new OpusScript(16000, 1, OpusScript.Application.VOIP)
    const out = []
    for (let f = 0; f < n; f++) {
      const pcm = Buffer.alloc(1920)
      for (let i = 0; i < 960; i++) pcm.writeInt16LE(Math.round(4000 * Math.sin((2 * Math.PI * 330 * (f * 960 + i)) / 16000)), i * 2)
      out.push(enc.encode(pcm, 960))
    }
    enc.delete()
    return out
  }
  wss.on('connection', (ws, req) => {
    const rec = { headers: { ...req.headers }, sent: [], frames: 0, decodedBytes: 0, aborted: false, closed: false }
    log.push(rec)
    const m = wss.mode ?? mode
    const dec = new OpusScript(16000, 1)
    const session = `fake-${log.length}`
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o))
    const timers = []
    const later = (ms, fn) => timers.push(setTimeout(fn, ms))
    ws.on('message', (data, binary) => {
      if (binary) {
        rec.frames++
        try { rec.decodedBytes += dec.decode(data).length } catch { rec.bad = (rec.bad ?? 0) + 1 }
        return
      }
      const msg = JSON.parse(data.toString())
      rec.sent.push(msg)
      if (msg.type === 'hello' && m !== 'nohello') {
        send({ type: 'hello', transport: 'websocket', session_id: session, audio_params: msg.audio_params })
        send({ type: 'mcp', payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } } })
        later(20, () => send({ type: 'mcp', payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } }))
      }
      if (msg.type === 'abort') rec.aborted = true
      if (msg.type === 'listen' && msg.state === 'stop') {
        if (m === 'bg') return send({ type: 'stt', text: '<bg>', session_id: session })
        if (m === 'mute') return // (what the live Jade does with a voice that isn't Linh's: no stt at all)
        send({ type: 'stt', text: 'mấy giờ rồi', session_id: session })
        if (m === 'drop') return later(50, () => ws.terminate())
        if (m === 'stall') return send({ type: 'tts', state: 'start', session_id: session }) // (then nothing, ever)
        send({ type: 'llm', emotion: 'happy', text: '😊', session_id: session })
        send({ type: 'tts', state: 'start', session_id: session })
        send({ type: 'tts', state: 'sentence_start', text: 'Bây giờ là mười giờ sáng.', session_id: session })
        const frames = tone(m === 'long' ? 330 : 12)
        frames.forEach((f, i) => {
          later(30 + i * 60, () => ws.readyState === 1 && ws.send(f))
          if (i === 6) later(30 + i * 60, () => send({ type: 'tts', state: 'sentence_start', text: 'Chúc Linh một ngày vui nhé!', session_id: session }))
        })
        later(60 + frames.length * 60, () => send({ type: 'tts', state: 'stop', session_id: session }))
      }
    })
    ws.on('close', () => {
      rec.closed = true
      timers.forEach(clearTimeout)
      dec.delete()
    })
  })
  return new Promise((resolve) => wss.on('listening', () => resolve({ wss, log, port: wss.address().port, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()) }) })))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const j = await fakeJade({ port: Number(process.argv[2] ?? 8104), mode: process.argv[3] ?? 'ok' })
  console.log(`fake Jade on ws://127.0.0.1:${j.port}/xiaozhi/v1/ (mode ${process.argv[3] ?? 'ok'})`)
  setInterval(() => {
    const last = j.log.at(-1)
    if (last && !last.printed && last.closed) {
      last.printed = true
      console.log(JSON.stringify({ device: last.headers['device-id'], client: last.headers['client-id'], sent: last.sent.map((s) => s.type + (s.state ? `:${s.state}` : '') + (s.payload?.id != null ? `#${s.payload.id}` : '')), frames: last.frames, decodedBytes: last.decodedBytes, aborted: last.aborted }))
    }
  }, 200)
}
