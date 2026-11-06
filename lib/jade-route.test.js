// Talk to Jade's route (app/api/private/settings/jade) against a stand-in Jade (scripts/jade-fake.mjs, a real WebSocket
// server on a free port): who gets in, the limits, a whole turn (hello, the MCP answers, the Opus frames both ways, the
// lines streamed), <bg>, Jade offline / silent / hanging up, and the page going away mid-answer (abort to Jade).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DELETE, GET, POST } from '../app/api/private/settings/jade/route.js'
import { memoryStore } from './jade-store.js'
import { fakeJade } from '../scripts/jade-fake.mjs'
import { splitLines } from './jade.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const CLIENT = '0b7a4f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
let jade
before(async () => {
  jade = await fakeJade()
  globalThis.__homeJadeStore = memoryStore()
  Object.assign(process.env, { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', JADE_WS_URL: `ws://127.0.0.1:${jade.port}/xiaozhi/v1/` })
})
after(async () => {
  for (const k of ['GATE_SECRET', 'SYNC_SECRET', 'OWNER_USER', 'JADE_WS_URL']) delete process.env[k]
  delete globalThis.__homeJadeStore
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

// ---- typed turns (handover 4.4) ----
const typed = (body, { headers = {}, signal } = {}) =>
  req({ body: typeof body === 'string' ? body : JSON.stringify(body), signal, headers: { 'content-type': 'application/json', ...headers } })

test('a typed turn: one chat message (the text tidied), the same lines back, her voice with it', async () => {
  const lines = await readAll(await POST(typed({ text: '  mấy giờ\n rồi  ', audio: true })))
  const kinds = lines.filter((l) => l.t !== 'audio').map((l) => l.t + (l.state ? `:${l.state}` : ''))
  assert.deepEqual(kinds, ['ready', 'stt', 'tts:start', 'emoji', 'say', 'say', 'tts:stop', 'end'])
  assert.deepEqual(lines[1], { t: 'stt', text: 'mấy giờ rồi', heard: true }) // (her echo)
  assert.equal(lines.filter((l) => l.t === 'audio').length, 8)
  assert.equal(lines.at(-1).reason, 'done')
  await ms(50)
  const rec = jade.log.at(-1)
  assert.deepEqual(rec.sent.filter((s) => s.type !== 'mcp').map((s) => s.type), ['hello', 'chat'])
  const chat = rec.sent.find((s) => s.type === 'chat')
  assert.deepEqual(chat, { session_id: 'fake-' + jade.log.length, type: 'chat', text: 'mấy giờ rồi', audio: true })
  assert.equal(rec.frames, 0) // (no Opus up)
  assert.equal(rec.aborted, false)
})

test('a typed turn, text only: audio false to Jade, no audio lines; her tool call as a tool line', async () => {
  const lines = await readAll(await POST(typed({ text: 'thời tiết hôm nay', audio: false })))
  assert.equal(lines.filter((l) => l.t === 'audio').length, 0)
  assert.deepEqual(lines.find((l) => l.t === 'tool'), { t: 'tool', name: 'thoi_tiet' })
  assert.equal(lines.at(-1).reason, 'done')
  await ms(50)
  assert.equal(jade.log.at(-1).sent.find((s) => s.type === 'chat').audio, false)
})

test('typed turns: no text / too long / bad JSON refused before Jade is dialled; an exit phrase ends closed, no answer', async () => {
  const before = jade.log.length
  assert.equal((await POST(typed({ text: '   ' }))).status, 400)
  assert.equal((await POST(typed({ audio: false }))).status, 400)
  assert.equal((await POST(typed('{nope'))).status, 400)
  const long = await POST(typed({ text: 'a'.repeat(2001) }))
  assert.equal(long.status, 413)
  assert.equal((await long.json()).code, 'text-long')
  assert.equal((await POST(typed({ text: 'hi' }, { headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403)
  assert.equal(jade.log.length, before)
  const bye = await readAll(await POST(typed({ text: 'tạm biệt' })))
  assert.deepEqual(bye, [{ t: 'ready' }, { t: 'end', reason: 'closed' }])
})

test('a device Jade refuses text from: an error line (refused), Jade told to stop', async () => {
  process.env.JADE_DEVICE_ID = 'test-intruder'
  try {
    const lines = await readAll(await POST(typed({ text: 'mấy giờ rồi' })))
    assert.deepEqual(lines, [{ t: 'ready' }, { t: 'error', error: 'refused' }])
    await ms(100)
    assert.equal(jade.log.at(-1).aborted, true)
  } finally {
    delete process.env.JADE_DEVICE_ID
  }
})

// ---- the history ----
const hist = (qs = '', headers = {}) => new Request(`http://home.test/api/private/settings/jade${qs}`, { headers: { ...OWNER, ...headers } })
const del = (headers = {}) => new Request('http://home.test/api/private/settings/jade', { method: 'DELETE', headers: { ...OWNER, 'sec-fetch-site': 'same-origin', ...headers } })
const newest = async () => (await (await GET(hist('?limit=1'))).json()).turns[0]

test('history: a voice turn and a typed one kept by the time the stream ends; one Jade did not hear is not', async () => {
  await DELETE(del())
  await readAll(await POST(req()))
  const v = await newest() // (no wait: kept before the last line)
  assert.equal(v.via, 'voice')
  assert.equal(v.me, 'mấy giờ rồi')
  assert.equal(v.jade, 'Bây giờ là mười giờ sáng. Chúc Linh một ngày vui nhé!')
  assert.equal(v.emoji, '😊')
  assert.ok(Math.abs(v.at - Date.now()) < 5000)
  await readAll(await POST(typed({ text: 'thời tiết hôm nay', audio: false })))
  const t = await newest()
  assert.deepEqual([t.via, t.me, t.jade, t.emoji], ['text', 'thời tiết hôm nay', 'Bây giờ là mười giờ sáng, chúc Linh một ngày vui nhé!', '🙂'])
  jade.wss.mode = 'bg'
  try {
    await readAll(await POST(req()))
  } finally {
    jade.wss.mode = undefined
  }
  await readAll(await POST(typed({ text: 'tạm biệt' }))) // (she hung up without taking it)
  const all = await (await GET(hist())).json()
  assert.equal(all.turns.length, 2)
  assert.equal(all.more, false)
})

test('history: newest first, pages by before / limit, cleared by DELETE; guests and other sites kept out', async () => {
  await DELETE(del())
  const store = globalThis.__homeJadeStore
  for (let i = 1; i <= 5; i++) await store.add('owner', { via: 'text', me: `q${i}`, jade: `a${i}` })
  await store.add('eve', { via: 'text', me: 'not yours' })
  const p1 = await (await GET(hist('?limit=2'))).json()
  assert.deepEqual(p1.turns.map((t) => t.me), ['q5', 'q4'])
  assert.equal(p1.more, true)
  const p2 = await (await GET(hist(`?limit=2&before=${p1.turns[1].id}`))).json()
  assert.deepEqual(p2.turns.map((t) => t.me), ['q3', 'q2'])
  const p3 = await (await GET(hist(`?limit=2&before=${p2.turns[1].id}`))).json()
  assert.deepEqual([p3.turns.map((t) => t.me), p3.more], [['q1'], false])
  assert.equal((await GET(hist('?before=nope'))).status, 200) // (ignored: the newest)
  const r = await GET(hist())
  assert.equal(r.headers.get('cache-control'), 'no-store, private')
  assert.equal((await GET(hist('', { 'x-home-sync': '' }))).status, 404)
  assert.equal((await GET(hist('', { 'remote-user': 'eve' }))).status, 403)
  assert.equal((await DELETE(del({ 'remote-user': 'eve' }))).status, 403)
  assert.equal((await DELETE(del({ 'sec-fetch-site': 'cross-site' }))).status, 403)
  assert.equal((await (await GET(hist())).json()).turns.length, 5)
  assert.deepEqual(await (await DELETE(del())).json(), { ok: true })
  assert.deepEqual(await (await GET(hist())).json(), { turns: [], more: false })
  assert.equal((await store.list('eve')).turns.length, 1) // (only the owner's)
})
