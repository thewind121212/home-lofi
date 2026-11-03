// Talk to Jade's route (app/api/private/settings/jade) against a stand-in Jade (scripts/jade-fake.mjs, a real WebSocket
// server on a free port): who gets in, the limits, a whole turn (hello, the MCP answers, the Opus frames both ways, the
// lines streamed), <bg>, Jade offline / silent / hanging up, and the page going away mid-answer (abort to Jade).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { POST } from '../app/api/private/settings/jade/route.js'
import { fakeJade } from '../scripts/jade-fake.mjs'
import { splitLines } from './jade.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const CLIENT = '0b7a4f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
let jade
before(async () => {
  jade = await fakeJade()
  Object.assign(process.env, { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', JADE_WS_URL: `ws://127.0.0.1:${jade.port}/xiaozhi/v1/` })
})
after(async () => {
  for (const k of ['GATE_SECRET', 'SYNC_SECRET', 'OWNER_USER', 'JADE_WS_URL']) delete process.env[k]
  await jade.close()
})

// a second of a 200 Hz hum at 16 kHz
const speech = (ms = 1000) => {
  const n = (16 * ms) | 0, b = new Uint8Array(n * 2), v = new DataView(b.buffer)
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(9000 * Math.sin((2 * Math.PI * 200 * i) / 16000)), true)
  return b
}
const req = ({ body = speech(), headers = {}, client = CLIENT, signal } = {}) =>
  new Request(`http://home.test/api/private/settings/jade${client ? `?client=${client}` : ''}`, {
    method: 'POST', body, signal, duplex: 'half',
    headers: { ...OWNER, 'content-type': 'application/octet-stream', 'sec-fetch-site': 'same-origin', ...headers },
  })
async function readAll(r) {
  const dec = new TextDecoder()
  let text = ''
  for await (const c of r.body) text += dec.decode(c, { stream: true })
  return splitLines(text + '\n').lines
}
const ms = (n) => new Promise((r) => setTimeout(r, n))

test('guests and other sites: nothing, and Jade never dialled', async () => {
  const before = jade.log.length
  assert.equal((await POST(req({ headers: { 'x-home-sync': '' } }))).status, 404)
  assert.equal((await POST(req({ headers: { 'remote-user': 'eve' } }))).status, 403)
  assert.equal((await POST(req({ headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403)
  assert.equal((await POST(req({ headers: { 'content-type': 'text/plain' } }))).status, 403)
  assert.equal((await POST(req({ client: null }))).status, 400)
  assert.equal((await POST(req({ client: 'nope' }))).status, 400)
  const short = await POST(req({ body: speech(100) }))
  assert.equal(short.status, 400)
  assert.equal(short.headers.get('cache-control'), 'no-store, private')
  assert.equal((await short.json()).code, 'short')
  assert.equal((await POST(req({ body: new Uint8Array(1_920_002) }))).status, 413)
  assert.equal(jade.log.length, before)
})

test('a whole turn: hello, MCP answered, the frames sent and decodable, the answer streamed with her voice', async () => {
  const r = await POST(req({ body: speech(1000) }))
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/x-ndjson; charset=utf-8')
  assert.equal(r.headers.get('x-accel-buffering'), 'no')
  assert.match(r.headers.get('cache-control'), /no-store/)
  const lines = await readAll(r)
  const kinds = lines.filter((l) => l.t !== 'audio').map((l) => l.t + (l.state ? `:${l.state}` : ''))
  assert.deepEqual(kinds, ['ready', 'stt', 'emoji', 'tts:start', 'say', 'say', 'tts:stop', 'end'])
  assert.deepEqual(lines[1], { t: 'stt', text: 'mấy giờ rồi', heard: true })
  assert.deepEqual(lines.find((l) => l.t === 'emoji'), { t: 'emoji', emoji: '😊', emotion: 'happy' })
  assert.deepEqual(lines.filter((l) => l.t === 'say').map((l) => l.text), ['Bây giờ là mười giờ sáng.', 'Chúc Linh một ngày vui nhé!'])
  assert.equal(lines.at(-1).reason, 'done')
  const audio = lines.filter((l) => l.t === 'audio')
  assert.equal(audio.length, 12)
  assert.ok(audio.every((a) => Buffer.from(a.pcm, 'base64').length === 1920)) // 60 ms of 16 kHz Int16 each
  await ms(50)
  const rec = jade.log.at(-1)
  assert.equal(rec.headers['device-id'], 'home-lofi')
  assert.equal(rec.headers['client-id'], CLIENT)
  assert.equal(rec.headers['protocol-version'], '1')
  assert.equal(rec.headers.authorization, 'Bearer local')
  const types = rec.sent.map((s) => s.type + (s.state ? `:${s.state}` : ''))
  assert.deepEqual(types.filter((t) => t !== 'mcp'), ['hello', 'listen:start', 'listen:stop']) // (the MCP answers whenever asked)
  const mcp = rec.sent.filter((s) => s.type === 'mcp').map((s) => s.payload)
  assert.equal(mcp[0].result.serverInfo.name, 'home-lofi')
  assert.deepEqual(mcp[1], { jsonrpc: '2.0', id: 2, result: { tools: [] } })
  assert.ok(rec.sent.slice(1).every((s) => s.session_id === 'fake-' + jade.log.length))
  assert.equal(rec.frames, 17) // 1 s = 16.7 frames, the last padded
  assert.equal(rec.decodedBytes, 17 * 1920)
  assert.equal(rec.aborted, false)
  assert.equal(rec.closed, true)
})

test('<bg>: the stt line says not heard, then the turn ends', async () => {
  jade.wss.mode = 'bg'
  try {
    const lines = await readAll(await POST(req()))
    assert.deepEqual(lines.map((l) => l.t), ['ready', 'stt', 'end'])
    assert.equal(lines[1].heard, false)
    assert.equal(lines[2].reason, 'unheard')
  } finally {
    jade.wss.mode = undefined
  }
})

test("a turn Jade's STT drops without a word (no stt): ended as not heard, Jade told to stop", async () => {
  jade.wss.mode = 'mute'
  globalThis.__homeJadeSttWait = 300
  try {
    const lines = await readAll(await POST(req()))
    assert.deepEqual(lines, [{ t: 'ready' }, { t: 'end', reason: 'unheard' }])
    await ms(100)
    assert.equal(jade.log.at(-1).aborted, true)
  } finally {
    jade.wss.mode = undefined
    delete globalThis.__homeJadeSttWait
  }
})

test('Jade goes quiet mid-answer: the idle clock ends the turn (timeout) and tells her to stop', async () => {
  jade.wss.mode = 'stall'
  globalThis.__homeJadeIdle = 800 // (longer than sending the second of audio)
  try {
    const lines = await readAll(await POST(req()))
    assert.deepEqual(lines.map((l) => l.t + (l.state ? `:${l.state}` : '')), ['ready', 'stt', 'tts:start', 'error'])
    assert.equal(lines.at(-1).error, 'timeout')
    await ms(100)
    assert.equal(jade.log.at(-1).aborted, true)
  } finally {
    jade.wss.mode = undefined
    delete globalThis.__homeJadeIdle
  }
})

test('Jade offline or silent: 503 with the Vietnamese line; hanging up mid-turn: end closed', async () => {
  const url = process.env.JADE_WS_URL
  process.env.JADE_WS_URL = 'ws://127.0.0.1:1/xiaozhi/v1/'
  const off = await POST(req())
  process.env.JADE_WS_URL = url
  assert.equal(off.status, 503)
  assert.deepEqual(await off.json(), { error: 'Jade đang offline, thử lại sau nhé', code: 'offline' })
  jade.wss.mode = 'nohello'
  const t0 = Date.now()
  const quiet = await POST(req())
  assert.equal(quiet.status, 503)
  assert.ok(Date.now() - t0 >= 4500)
  jade.wss.mode = 'drop'
  const lines = await readAll(await POST(req()))
  jade.wss.mode = undefined
  assert.deepEqual(lines.map((l) => l.t), ['ready', 'stt', 'end'])
  assert.equal(lines[2].reason, 'closed')
})

test('the page goes away mid-answer: Jade told to abort and hung up; a new turn from the same browser replaces the old', async () => {
  jade.wss.mode = 'long'
  try {
    const ac = new AbortController()
    const r = await POST(req({ signal: ac.signal }))
    const reader = r.body.getReader()
    let text = ''
    while (!text.includes('"audio"')) text += new TextDecoder().decode((await reader.read()).value)
    ac.abort()
    await ms(150)
    const rec = jade.log.at(-1)
    assert.equal(rec.aborted, true)
    assert.equal(rec.sent.at(-1).type, 'abort')
    assert.equal(rec.closed, true)
    // pressed again: the same browser's turn in flight is ended (Jade told to stop) when the next one comes
    const first = await POST(req())
    const r1 = first.body.getReader()
    await r1.read()
    await ms(500)
    const second = await POST(req())
    assert.equal(second.status, 200)
    await ms(150)
    assert.equal(jade.log.at(-2).aborted, true)
    let rest = ''
    for (let x = await r1.read(); !x.done; x = await r1.read()) rest += new TextDecoder().decode(x.value)
    assert.ok(!rest.includes('"end"')) // (it just stops: that tab asked for the next one)
    await second.body.cancel()
    await ms(150)
    assert.equal(jade.log.at(-1).aborted, true)
  } finally {
    jade.wss.mode = undefined
  }
})
