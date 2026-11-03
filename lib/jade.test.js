// Talk to Jade's pure parts (lib/jade.js): the xiaozhi messages, the MCP answers, Jade's events, the stream's lines,
// the PCM framing and the microphone's downsampling.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DEVICE, DEFAULT_URL, FRAME_BYTES, RATE, abortMsg, clientIdOk, connectHeaders, downsample, heardNothing, hello, jadeDevice,
  jadeUrl, level, line, listenStart, listenStop, mcpReply, parseJade, pcmFrames, splitLines, toolLabel, toolOf,
} from './jade.js'

test('env: the defaults unless set to something sane', () => {
  delete process.env.JADE_WS_URL
  delete process.env.JADE_DEVICE_ID
  assert.equal(jadeUrl(), DEFAULT_URL)
  assert.equal(jadeDevice(), DEFAULT_DEVICE)
  process.env.JADE_WS_URL = 'http://not-a-socket'
  process.env.JADE_DEVICE_ID = 'bad id with spaces'
  assert.equal(jadeUrl(), DEFAULT_URL)
  assert.equal(jadeDevice(), DEFAULT_DEVICE)
  process.env.JADE_WS_URL = ' ws://10.0.0.5:8004/xiaozhi/v1/ '
  process.env.JADE_DEVICE_ID = 'home-lofi-2'
  assert.equal(jadeUrl(), 'ws://10.0.0.5:8004/xiaozhi/v1/')
  assert.equal(jadeDevice(), 'home-lofi-2')
  delete process.env.JADE_WS_URL
  delete process.env.JADE_DEVICE_ID
})

test('what we send: headers, hello, listen start (manual) / stop, abort', () => {
  const id = '0b7a4f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
  assert.ok(clientIdOk(id))
  assert.ok(!clientIdOk('x'.repeat(36)) && !clientIdOk(null) && !clientIdOk(`${id}\n`))
  assert.deepEqual(connectHeaders(id), { 'Protocol-Version': '1', 'Device-Id': 'home-lofi', 'Client-Id': id, Authorization: 'Bearer local' })
  assert.deepEqual(hello().audio_params, { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 })
  assert.equal(hello().features.mcp, true)
  assert.deepEqual(listenStart('s1'), { session_id: 's1', type: 'listen', state: 'start', mode: 'manual' })
  assert.deepEqual(listenStop('s1'), { session_id: 's1', type: 'listen', state: 'stop' })
  assert.deepEqual(abortMsg('s1'), { session_id: 's1', type: 'abort' })
})

test('MCP: initialize and tools/list answered (no tools), anything else -32601, notifications ignored', () => {
  const init = mcpReply({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 's1')
  assert.deepEqual(init, { session_id: 's1', type: 'mcp', payload: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'home-lofi', version: '1.0' } } } })
  assert.deepEqual(mcpReply({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 's1').payload, { jsonrpc: '2.0', id: 2, result: { tools: [] } })
  assert.deepEqual(mcpReply({ jsonrpc: '2.0', id: 'x', method: 'tools/call' }, 's1').payload.error.code, -32601)
  assert.equal(mcpReply({ jsonrpc: '2.0', method: 'notifications/initialized' }, 's1'), null)
  assert.equal(mcpReply(null, 's1'), null)
  assert.equal(mcpReply({ id: 0, method: 'tools/list' }, 's1').payload.id, 0) // (0 is an id)
})

test('tool names -> a status line', () => {
  assert.equal(toolLabel('thoi_tiet'), 'Jade đang xem thời tiết…')
  assert.equal(toolLabel('tin_tuc'), 'Jade đang xem tin tức…')
  assert.equal(toolLabel('quet_mang__lan'), 'Jade đang dùng quet mang lan…')
  assert.equal(toolLabel('toString'), 'Jade đang dùng toString…') // (not the object's own)
  assert.equal(toolOf('% thoi_tiet '), 'thoi_tiet')
  assert.equal(toolOf('mấy giờ rồi'), null)
})

test("Jade's events -> stream lines; junk -> null", () => {
  const p = (o) => parseJade(JSON.stringify(o))
  assert.deepEqual(p({ type: 'hello', session_id: 'abc', audio_params: {} }), { kind: 'hello', session: 'abc' })
  assert.deepEqual(p({ type: 'hello' }), { kind: 'hello', session: null })
  assert.deepEqual(p({ type: 'mcp', payload: { id: 1 } }), { kind: 'mcp', payload: { id: 1 } })
  assert.deepEqual(p({ type: 'stt', text: 'mấy giờ rồi', session_id: 'abc' }).line, { t: 'stt', text: 'mấy giờ rồi', heard: true })
  assert.deepEqual(p({ type: 'stt', text: '<bg>' }).line, { t: 'stt', text: '<bg>', heard: false })
  assert.deepEqual(p({ type: 'stt', text: '  ' }).line.heard, false)
  // "% name": a tool call, not Linh's words (handover 4.2)
  assert.deepEqual(p({ type: 'stt', text: '% thoi_tiet' }).line, { t: 'tool', name: 'thoi_tiet' })
  assert.deepEqual(p({ type: 'stt', text: '%thoi_tiet' }).line.t, 'stt') // (only "% " with its space)
  assert.deepEqual(p({ type: 'stt', text: '50% chắc chắn' }).line.t, 'stt')
  assert.equal(p({ type: 'stt', text: '% ' }).line.t, 'stt')
  assert.deepEqual(p({ type: 'llm', emotion: 'happy', text: '😊' }).line, { t: 'emoji', emoji: '😊', emotion: 'happy' })
  assert.equal(p({ type: 'llm', emotion: 'happy' }), null)
  assert.deepEqual(p({ type: 'tts', state: 'start' }).line, { t: 'tts', state: 'start' })
  assert.deepEqual(p({ type: 'tts', state: 'sentence_start', text: 'Bây giờ là 10 giờ.' }).line, { t: 'say', text: 'Bây giờ là 10 giờ.' })
  assert.deepEqual(p({ type: 'tts', state: 'stop' }).line, { t: 'tts', state: 'stop' })
  assert.equal(p({ type: 'tts', state: 'sentence_end', text: 'x' }), null)
  assert.equal(p({ type: 'iot' }), null)
  assert.equal(parseJade('not json'), null)
  assert.equal(parseJade('5'), null)
  assert.ok(heardNothing('') && heardNothing('<bg>') && heardNothing(' <bg> ') && heardNothing(undefined) && !heardNothing('chào'))
})

test('stream lines: one JSON a line; split keeps the unfinished rest, skips junk', () => {
  const text = line({ t: 'ready' }) + line({ t: 'stt', text: 'a\nb' }) + 'nope\n' + '{"t":"sa'
  const { lines, rest } = splitLines(text)
  assert.deepEqual(lines, [{ t: 'ready' }, { t: 'stt', text: 'a\nb' }])
  assert.equal(rest, '{"t":"sa')
  assert.deepEqual(splitLines(rest + 'y","text":"x"}\n').lines, [{ t: 'say', text: 'x' }])
})

test('PCM -> 60 ms frames, the last padded with silence; an odd byte dropped', () => {
  assert.equal(FRAME_BYTES, 1920)
  const bytes = new Uint8Array(FRAME_BYTES * 2 + 101).fill(7)
  const f = pcmFrames(bytes)
  assert.equal(f.length, 3)
  assert.ok(f.every((x) => x.length === FRAME_BYTES))
  assert.equal(f[2][99], 7)
  assert.equal(f[2][100], 0) // (byte 101 was half a sample)
  assert.equal(f[2][1919], 0)
  assert.deepEqual(pcmFrames(new Uint8Array(0)), [])
})

test('downsample: 48 kHz -> 16 kHz Int16, the length right across chunks, the level kept', () => {
  const carry = { pos: 0 }
  let n = 0, peak = 0
  for (let c = 0; c < 10; c++) {
    const chunk = new Float32Array(128) // an AudioWorklet's quantum
    for (let i = 0; i < 128; i++) chunk[i] = 0.5 * Math.sin((2 * Math.PI * 300 * (c * 128 + i)) / 48000)
    const out = downsample(chunk, 48000, carry)
    n += out.length
    for (const v of out) peak = Math.max(peak, Math.abs(v))
  }
  assert.equal(n, Math.floor((1280 * RATE) / 48000))
  assert.ok(peak > 15000 && peak < 16500, `peak ${peak}`)
  // 44.1 kHz: no drift over a second
  const c2 = { pos: 0 }
  let m = 0
  for (let c = 0; c < 44100 / 147; c++) m += downsample(new Float32Array(147), 44100, c2).length
  assert.ok(Math.abs(m - 16000) <= 1, `got ${m}`)
  // clipping: a too-loud mic doesn't wrap around
  assert.deepEqual([...downsample(Float32Array.from([2, 2, 2, -2, -2, -2]), 48000)], [32767, -32768])
})

test('level: silence 0, speech most of the way, capped at 1', () => {
  assert.equal(level(new Float32Array(128)), 0)
  assert.equal(level(null), 0)
  assert.ok(level(new Float32Array(128).fill(0.1)) > 0.5)
  assert.equal(level(new Float32Array(128).fill(0.9)), 1)
})
