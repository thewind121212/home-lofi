// Talk to Jade (the owner's Vietnamese voice assistant on the Razer, xiaozhi-esp32-server 0.9.8): the pure parts, shared
// by the relay (lib/jade-relay.js, the server's side of one turn), its route (app/api/private/settings/jade) and the
// sheet (app/jade.js). No Node or browser APIs here, so node:test checks all of it.
// How a turn goes: the page records while the button is held (16 kHz mono Int16), POSTs it; the server opens Jade's
// WebSocket (xiaozhi protocol v1, the ESP32 firmware's), says hello, answers Jade's MCP questions (no tools: a page has
// no volume or eyes), sends the turn as 60 ms Opus frames between listen start / stop, and streams back what Jade says
// as NDJSON lines (below), her voice decoded to 16 kHz PCM. The browser never talks to Jade: the page is https and Jade
// is plain ws:// on the LAN (mixed content), and Jade's port must never face the internet.

export const RATE = 16000 // Jade's audio both ways: 16 kHz mono 16-bit, 60 ms Opus frames (the hello's audio_params)
export const FRAME_MS = 60
export const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000 // 960
export const FRAME_BYTES = FRAME_SAMPLES * 2
export const MIN_MS = 300 // a shorter press is a tap, not speech: the page ignores it ("Giữ nút để nói")
export const MAX_MS = 60_000 // the longest turn the page records (and the route takes)
export const MIN_BYTES = (RATE * 2 * 200) / 1000 // the route's floor (200 ms): under it there's nothing to hear
export const MAX_BYTES = (RATE * 2 * MAX_MS) / 1000 // 1.92 MB
export const IDLE_MS = 20_000 // a turn with nothing from Jade this long (no event, no audio) is over
export const TURN_MAX_MS = 5 * 60_000 // and none runs longer than this (a long story or the news still fits)
export const CONNECT_MS = 5000 // the WebSocket open + Jade's hello (well under 1 s on the LAN)

export const DEFAULT_URL = 'ws://10.10.0.162:8004/xiaozhi/v1/'
export const DEFAULT_DEVICE = 'home-lofi' // its own id: not the iPhone's or the ESP32's MAC (one id, one session)
const env = (k) => (typeof process !== 'undefined' ? (process.env[k] ?? '').trim() : '')
export const jadeUrl = () => (/^wss?:\/\//i.test(env('JADE_WS_URL')) ? env('JADE_WS_URL') : DEFAULT_URL)
export const jadeDevice = () => (/^[\w:.-]{1,64}$/.test(env('JADE_DEVICE_ID')) ? env('JADE_DEVICE_ID') : DEFAULT_DEVICE)

// a browser's Client-Id: a UUID it keeps in localStorage (anything else: none)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const clientIdOk = (id) => typeof id === 'string' && UUID.test(id)

// ---- the protocol: what we send ----

export const connectHeaders = (clientId, device = jadeDevice()) => ({
  'Protocol-Version': '1',
  'Device-Id': device,
  'Client-Id': clientId,
  Authorization: 'Bearer local', // (auth is off on Jade; the firmware sends it anyway)
})
export const hello = () => ({
  type: 'hello', version: 1, transport: 'websocket', features: { mcp: true },
  audio_params: { format: 'opus', sample_rate: RATE, channels: 1, frame_duration: FRAME_MS },
})
// manual: push to talk (never 'detect': that's the wake word's path, with an extra check on the server)
export const listenStart = (sid) => ({ session_id: sid, type: 'listen', state: 'start', mode: 'manual' })
export const listenStop = (sid) => ({ session_id: sid, type: 'listen', state: 'stop' })
export const abortMsg = (sid) => ({ session_id: sid, type: 'abort' })
// a typed turn (handover 4.4): Jade answers it like speech, with no wake word, STT or voice check (so only home-lofi and
// iphone-linh may send it); audio false = text only: no TTS at all, no Opus back (faster, and silent)
export const TEXT_MAX = 2000
export const chatMsg = (sid, text, audio = true) => ({ session_id: sid, type: 'chat', text, audio: Boolean(audio) })
// what the page typed -> the text Jade gets (trimmed, runs of blank space as one), or null (empty / too long)
export function chatText(v) {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t && t.length <= TEXT_MAX ? t : null
}

// Jade asks the device for its own tools (the ESP32 has volume and eyes): a page has none. A request (with an id) gets
// its answer, wrapped for the socket; a notification (no id) gets nothing (null).
export function mcpReply(payload, sid) {
  if (!payload || typeof payload !== 'object' || payload.id === undefined || payload.id === null) return null
  const { id, method } = payload
  const body =
    method === 'initialize' ? { result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'home-lofi', version: '1.0' } } }
    : method === 'tools/list' ? { result: { tools: [] } }
    : { error: { code: -32601, message: 'Method not found' } }
  return { session_id: sid, type: 'mcp', payload: { jsonrpc: '2.0', id, ...body } }
}

// ---- the protocol: what Jade says ----

// Jade heard nothing she'll answer: empty, or <bg> (her STT dropped it as background: too quiet, or not Linh's voice)
export const heardNothing = (text) => typeof text !== 'string' || !text.trim() || text.trim() === '<bg>'

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')

// An stt starting "% " isn't what Linh said: Jade sends it while she calls one of her tools ("% thoi_tiet"; the ESP32
// shows it on its screen; handover 4.2). The page shows a small status line instead of Linh's bubble.
// tool name -> what she's doing, Vietnamese ("Jade đang …"); a name not known here: its words, underscores as spaces
const TOOLS = {
  thoi_tiet: 'xem thời tiết', tin_tuc: 'xem tin tức', doc_tin_tuc: 'đọc tin tức', den: 'chỉnh đèn', bat_den: 'bật đèn',
  tat_den: 'tắt đèn', may_lanh: 'chỉnh máy lạnh', dieu_hoa: 'chỉnh máy lạnh', nhac: 'mở nhạc', phat_nhac: 'mở nhạc',
  nhac_nho: 'xem lời nhắc', lich: 'xem lịch', gio: 'xem giờ', tinh_trang_may: 'xem tình trạng máy', tim_kiem: 'tìm kiếm',
}
export const toolOf = (text) => (typeof text === 'string' && text.startsWith('% ') ? text.slice(2).trim().slice(0, 64) || null : null)
export const toolLabel = (name) => `Jade đang ${Object.hasOwn(TOOLS, name) ? TOOLS[name] : `dùng ${String(name).replace(/_+/g, ' ').trim()}`}…`
// One text frame from Jade -> what it means here, or null (not JSON, or nothing the page shows):
//   { kind: 'hello', session }     her hello (the session id every later message carries)
//   { kind: 'mcp', payload }       a question for the device (mcpReply)
//   { kind: 'line', line }         something for the page: one stream line (below)
export function parseJade(text) {
  let m
  try {
    m = JSON.parse(text)
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  if (m.type === 'hello') return { kind: 'hello', session: str(m.session_id, 128) || null }
  if (m.type === 'mcp') return { kind: 'mcp', payload: m.payload }
  // a typed turn she refused: not allowed for this device, bad text, not ready (her English: the page shows its own line)
  if (m.type === 'chat' && m.state === 'error') return { kind: 'line', line: { t: 'error', error: /not allowed/i.test(str(m.error)) ? 'refused' : 'chat' } }
  if (m.type === 'stt') {
    const tool = toolOf(m.text)
    return { kind: 'line', line: tool ? { t: 'tool', name: tool } : { t: 'stt', text: str(m.text), heard: !heardNothing(m.text) } }
  }
  if (m.type === 'llm') return str(m.text, 16) ? { kind: 'line', line: { t: 'emoji', emoji: str(m.text, 16), emotion: str(m.emotion, 32) } } : null
  if (m.type === 'tts') {
    if (m.state === 'sentence_start') return str(m.text) ? { kind: 'line', line: { t: 'say', text: str(m.text) } } : null
    if (m.state === 'start' || m.state === 'stop') return { kind: 'line', line: { t: 'tts', state: m.state } }
  }
  return null
}

// ---- the stream back to the page: NDJSON, one object a line ----
//   { t: 'ready' }                        Jade said hello, the turn is on its way
//   { t: 'stt', text, heard }             what she heard (heard false: empty / <bg>)
//   { t: 'tool', name }                   she's calling one of her tools ("% thoi_tiet": not speech, toolLabel)
//   { t: 'emoji', emoji, emotion }        her mood for the answer
//   { t: 'tts', state: 'start' | 'stop' } she starts / is done speaking
//   { t: 'say', text }                    the sentence she's saying now
//   { t: 'audio', pcm }                   her voice: base64 16 kHz mono Int16 (one 60 ms frame)
//   { t: 'end', reason }                  'done' | 'unheard' | 'closed' (Jade hung up) | 'timeout'
//   { t: 'error', error }                 a key of MSG (the page's line to show); the stream ends after it
export const line = (o) => JSON.stringify(o) + '\n'
// the page's side: text so far -> the complete lines' objects (bad ones skipped) and the unfinished rest
export function splitLines(text) {
  const parts = text.split('\n')
  const rest = parts.pop()
  const lines = []
  for (const p of parts) {
    if (!p.trim()) continue
    try {
      lines.push(JSON.parse(p))
    } catch {}
  }
  return { lines, rest }
}

// ---- audio ----

// 16-bit PCM bytes -> 60 ms frames for the Opus encoder; the last one padded with silence (a half frame can't be sent)
export function pcmFrames(bytes) {
  const out = []
  for (let at = 0; at < bytes.length; at += FRAME_BYTES) {
    const f = new Uint8Array(FRAME_BYTES)
    f.set(bytes.subarray(at, Math.min(at + FRAME_BYTES, bytes.length & ~1)))
    out.push(f)
  }
  return out
}

// The microphone's Float32 samples at the AudioContext's rate (44.1 / 48 kHz) -> 16 kHz Int16: each output sample the
// mean of the input samples it covers (a box filter: enough against aliasing for speech, and cheap on a phone).
// carry: { pos } between calls, so chunk edges don't click or drift.
export function downsample(input, fromRate, carry = { pos: 0 }) {
  const step = fromRate / RATE
  const out = []
  let pos = carry.pos // where the next output sample starts, in input samples (may be < 0: it began in the last chunk)
  while (pos + step <= input.length) {
    const a = Math.max(0, Math.floor(pos)), b = Math.max(a + 1, Math.floor(pos + step))
    let sum = 0
    for (let i = a; i < b; i++) sum += input[i]
    const v = Math.max(-1, Math.min(1, sum / (b - a)))
    out.push(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff))
    pos += step
  }
  carry.pos = pos - input.length
  return Int16Array.from(out)
}

// a chunk's loudness for the button's ring: 0–1 (RMS, scaled so ordinary speech fills most of it)
export function level(samples) {
  if (!samples?.length) return 0
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return Math.min(1, Math.sqrt(s / samples.length) * 6)
}

// the sheet's words for each state
export const STATES = {
  idle: 'Sẵn sàng',
  listening: 'Đang nghe',
  thinking: 'Jade đang nghĩ',
  speaking: 'Jade đang nói',
  offline: 'Mất kết nối',
}
export const MSG = {
  short: 'Giữ nút để nói',
  unheard: 'Jade không nghe rõ, nói to hơn nhé',
  offline: 'Jade đang offline, thử lại sau nhé',
  network: 'Mất kết nối với máy chủ, thử lại nhé',
  denied: 'Trình duyệt chưa cho dùng micro: bật quyền micro cho trang này',
  nomic: 'Không tìm thấy micro',
  busy: 'Jade đang bận một lượt khác, thử lại nhé',
  timeout: 'Jade trả lời lâu quá, thử lại nhé',
  tooLong: 'Nói ngắn hơn một phút nhé',
  failed: 'Có lỗi, tải lại trang rồi thử lại nhé',
  refused: 'Jade chưa cho trang này nhắn chữ',
  chat: 'Jade chưa nhận được tin nhắn, thử lại nhé',
  textLong: `Tin nhắn dài quá, tối đa ${TEXT_MAX} ký tự nhé`,
  bye: 'Jade đã kết thúc cuộc trò chuyện',
}
