import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backoffMs, createHub, hub, MAX_BACKOFF, sseParser } from './tavarian-hub.js'

const TOKEN = 'fake-hub-token-not-real-0002' // never a real one

const parse = (...chunks) => {
  const out = []
  const push = sseParser((e) => out.push(e))
  chunks.forEach((c) => push(c))
  return out
}

test('sseParser: events, multi-line data, comments, CRLF / CR, chunks cut anywhere', () => {
  assert.deepEqual(parse('event: state\ndata: {"a":1}\n\n'), [{ event: 'state', data: '{"a":1}', id: null }])
  assert.deepEqual(parse('data: one\ndata: two\n\n'), [{ event: 'message', data: 'one\ntwo', id: null }])
  assert.deepEqual(parse(': ping\n\n', ':\n', 'event: queue\n: inside\ndata:x\n\n'), [{ event: 'queue', data: 'x', id: null }])
  assert.deepEqual(parse('event: a\r\ndata: 1\r\n\r\n', 'event: b\rdata: 2\r\r'), [
    { event: 'a', data: '1', id: null },
    { event: 'b', data: '2', id: null },
  ])
  // cut mid-field, mid-value, and between \r and \n
  assert.deepEqual(parse('ev', 'ent: st', 'ate\r', '\ndata: {"x"', ':2}\r', '\n\r', '\n'), [{ event: 'state', data: '{"x":2}', id: null }])
  assert.deepEqual(parse('event: x\n\n'), []) // no data: nothing to dispatch
  assert.deepEqual(parse('data:  two spaces\nid: 7\n\n'), [{ event: 'message', data: ' two spaces', id: '7' }]) // one space dropped
  assert.deepEqual(parse('event: revoked\ndata: null\n\nevent: state\ndata: {}\n'), [{ event: 'revoked', data: 'null', id: null }]) // the last one isn't finished
})

test('backoffMs: 1 s, 2 s, 4 s ... at most 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(backoffMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  assert.equal(MAX_BACKOFF, 30000)
})

// ---- a hub with a fake clock and a fake Tavarian ----
const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((ok) => setImmediate(ok))
}
function rig({ idleMs = 60_000 } = {}) {
  let t = 0, seq = 0
  const timers = new Map()
  const opened = [] // each upstream attempt: { url, init, send, end }
  const replies = [] // queued answers: 'stream' | Response | Error
  const fetchImpl = async (url, init) => {
    const r = replies.shift() ?? 'stream'
    if (r instanceof Error) throw r
    if (r instanceof Response) return opened.push({ url, init }), r
    let c
    const body = new ReadableStream({ start: (ctl) => (c = ctl) })
    const conn = {
      url,
      init,
      send: (s) => c.enqueue(new TextEncoder().encode(s)),
      end: () => c.close(),
      aborted: false,
    }
    init.signal.addEventListener('abort', () => {
      conn.aborted = true
      try {
        c.error(new DOMException('aborted', 'AbortError'))
      } catch {}
    })
    opened.push(conn)
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }
  const h = createHub({
    fetchImpl,
    base: () => 'https://tav.test',
    token: () => TOKEN,
    idleMs,
    now: () => t,
    setTimer: (fn, ms) => (timers.set(++seq, { fn, at: t + ms, ms }), seq),
    clearTimer: (k) => timers.delete(k),
  })
  return {
    h,
    opened,
    replies,
    timers,
    // the delays of the timers still pending (besides the silence watchdog)
    pending: () => [...timers.values()].map((x) => x.ms).filter((ms) => ms !== 50_000 && ms !== 15_000),
    async advance(ms) {
      t += ms
      for (const [k, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (x.at <= t && timers.has(k)) {
          timers.delete(k)
          x.fn()
        }
      }
      await tick()
    },
  }
}
const collector = () => {
  const got = []
  const send = (event, data) => got.push([event, data])
  return { got, send, events: () => got.map((g) => g[0]) }
}
const STATE = 'event: state\ndata: {"status":"playing","positionSeconds":5,"serverNowMs":1000,"song":{"id":1,"title":"A","userId":"u9"},"secret":"x"}\n\n'
const QUEUE = 'event: queue\ndata: {"items":[{"id":2,"title":"B"}],"recent":[]}\n\n'

test('hub: one upstream for everyone, the token in its header (never an Origin), fan-out, snapshot', async () => {
  const r = rig()
  const a = collector(), b = collector()
  r.h.subscribe(a.send)
  r.h.subscribe(b.send)
  await tick()
  assert.equal(r.opened.length, 1)
  assert.equal(r.opened[0].url, 'https://tav.test/api/v1/home/events')
  assert.equal(r.opened[0].init.headers.authorization, `Bearer ${TOKEN}`)
  assert.ok(!Object.keys(r.opened[0].init.headers).some((k) => k.toLowerCase() === 'origin'))
  r.opened[0].send(STATE + ': ping\n\n' + QUEUE)
  r.opened[0].send('event: audio-ready\ndata: {"streamId":"s1","startedAtMs":5,"serverNowMs":6,"x":1}\n\nevent: song-error\ndata: {"songId":3,"reason":"gone"}\n\n')
  await tick()
  for (const c of [a, b]) assert.deepEqual(c.events().filter((e) => e !== 'status'), ['state', 'queue', 'audio-ready', 'song-error'])
  assert.deepEqual(a.got.filter((g) => g[0] === 'status').map((g) => g[1].status), ['idle', 'connecting', 'live'])
  assert.deepEqual(b.got.filter((g) => g[0] === 'status').map((g) => g[1].status), ['connecting', 'live']) // joined while connecting
  const of = (c, e) => c.got.find((g) => g[0] === e)[1]
  assert.deepEqual(of(a, 'state').song, { id: 1, youtubeId: null, title: 'A', thumbnail: null, durationSeconds: null, status: null, addedAt: null, playedAt: null, failReason: null, source: null, spotifyUri: null, artist: null, matchConfidence: null })
  assert.equal(of(a, 'state').secret, undefined)
  assert.deepEqual(of(a, 'audio-ready'), { streamId: 's1', startedAtMs: 5, serverNowMs: 6 })
  const snap = r.h.snapshot()
  assert.equal(snap.live, true)
  assert.equal(snap.status, 'live')
  assert.equal(snap.queue.items[0].title, 'B')
  assert.equal(snap.subscribers, 2)
  // a late subscriber gets status, state and queue at once, the position moved on
  await r.advance(2000)
  const c = collector()
  r.h.subscribe(c.send)
  assert.deepEqual(c.events(), ['status', 'state', 'queue'])
  assert.equal(c.got[1][1].positionSeconds, 7)
  assert.equal(c.got[1][1].serverNowMs, 3000)
  assert.equal(r.opened.length, 1) // still one stream
  assert.ok(!JSON.stringify([a.got, b.got, c.got, r.h.snapshot()]).includes(TOKEN))
})

test('hub: reconnects 1 s, 2 s, 4 s ...; a working stream resets it and resends the full state', async () => {
  const r = rig()
  const a = collector()
  r.h.subscribe(a.send)
  await tick()
  r.opened[0].send(STATE)
  await tick()
  r.opened[0].end() // Tavarian restarts
  await tick()
  assert.equal(r.h.snapshot().status, 'retrying')
  assert.deepEqual(r.pending(), [1000])
  r.replies.push(new TypeError('down'), new TypeError('down'))
  await r.advance(1000)
  assert.deepEqual(r.pending(), [2000])
  await r.advance(2000)
  assert.deepEqual(r.pending(), [4000])
  await r.advance(4000) // this one connects
  assert.equal(r.opened.length, 2)
  const before = a.got.length
  r.opened[1].send(STATE + QUEUE)
  await tick()
  assert.deepEqual(a.events().slice(before), ['status', 'state', 'queue'])
  assert.equal(r.h.snapshot().status, 'live')
  r.opened[1].end()
  await tick()
  assert.deepEqual(r.pending(), [1000]) // back to 1 s
})

test('hub: a silent connection (no ping) is dropped and reopened', async () => {
  const r = rig()
  r.h.subscribe(() => {})
  await tick()
  r.opened[0].send(STATE)
  await tick()
  await r.advance(49_000)
  assert.equal(r.opened[0].aborted, false)
  await r.advance(1000)
  assert.equal(r.opened[0].aborted, true)
  await r.advance(1000)
  assert.equal(r.opened.length, 2)
})

test('hub: `revoked` tells everyone and stops for good', async () => {
  const r = rig()
  const a = collector()
  r.h.subscribe(a.send)
  await tick()
  r.opened[0].send(STATE + 'event: revoked\ndata: null\n\n')
  await tick()
  assert.deepEqual(a.events().slice(-2), ['status', 'revoked'])
  assert.equal(r.h.snapshot().status, 'revoked')
  assert.equal(r.opened[0].aborted, true)
  assert.deepEqual(r.pending(), [])
  await r.advance(120_000)
  const b = collector()
  r.h.subscribe(b.send)
  await tick()
  assert.deepEqual(b.events(), ['status', 'revoked', 'state'])
  assert.equal(r.opened.length, 1) // never asked again
})

test('hub: a 401 at connect counts as revoked; the owner route can revoke too', async () => {
  const r = rig()
  r.replies.push(new Response(JSON.stringify({ success: false, error: 'token_expired' }), { status: 401 }))
  const a = collector()
  r.h.subscribe(a.send)
  await tick()
  assert.deepEqual(a.events(), ['status', 'status', 'status', 'revoked'])
  assert.deepEqual(a.got[2][1], { status: 'revoked', reason: 'token_expired' })
  assert.deepEqual(a.got.at(-1)[1], { reason: 'token_expired' })
  assert.deepEqual(r.pending(), [])

  const s = rig()
  s.h.subscribe(() => {})
  await tick()
  s.h.revoked()
  assert.equal(s.h.snapshot().status, 'revoked')
  assert.equal(s.opened[0].aborted, true)
})

test('hub: 429 too_many_streams waits at least 30 s; rate_limited honours Retry-After; 503 waits 30 s', async () => {
  const r = rig()
  r.replies.push(
    new Response(JSON.stringify({ success: false, error: 'too_many_streams' }), { status: 429, headers: { 'retry-after': '5' } }),
    new Response(JSON.stringify({ success: false, error: 'rate_limited' }), { status: 429, headers: { 'retry-after': '45' } }),
    new Response(JSON.stringify({ success: false, error: 'home_player_not_configured' }), { status: 503 }),
  )
  r.h.subscribe(() => {})
  await tick()
  assert.deepEqual(r.pending(), [30_000])
  assert.equal(r.h.snapshot().reason, 'too_many_streams')
  await r.advance(29_999)
  assert.equal(r.opened.length, 1) // no hammering
  await r.advance(1)
  assert.equal(r.opened.length, 2)
  assert.deepEqual(r.pending(), [45_000])
  await r.advance(45_000)
  assert.deepEqual(r.pending(), [30_000])
  assert.equal(r.h.snapshot().reason, 'home_player_not_configured')
})

test('hub: closes 60 s after the last subscriber leaves; coming back in time keeps it open', async () => {
  const r = rig()
  const off1 = r.h.subscribe(() => {})
  const off2 = r.h.subscribe(() => {})
  await tick()
  r.opened[0].send(STATE)
  await tick()
  off1()
  off2()
  off2() // twice is fine
  assert.deepEqual(r.pending(), [60_000])
  await r.advance(30_000)
  const off3 = r.h.subscribe(() => {}) // back in time
  assert.deepEqual(r.pending(), [])
  assert.equal(r.opened.length, 1)
  off3()
  r.opened[0].send(': ping\n\n') // Tavarian's pings keep the watchdog quiet
  await tick()
  await r.advance(40_000)
  r.opened[0].send(': ping\n\n')
  await tick()
  await r.advance(19_999)
  assert.equal(r.opened[0].aborted, false)
  await r.advance(1)
  assert.equal(r.opened[0].aborted, true)
  assert.equal(r.h.snapshot().status, 'idle')
  assert.equal(r.h.snapshot().live, false)
  assert.equal(r.h.snapshot().subscribers, 0)
  r.h.subscribe(() => {}) // a new visitor opens it again
  await tick()
  assert.equal(r.opened.length, 2)
})

test('hub: a subscriber that throws is dropped, the others still get events', async () => {
  const r = rig()
  const a = collector()
  let calls = 0
  r.h.subscribe(a.send)
  r.h.subscribe((e) => {
    if (++calls > 1) throw new Error('closed')
  })
  await tick()
  r.opened[0].send(STATE + QUEUE)
  await tick()
  assert.equal(r.h.snapshot().subscribers, 1)
  assert.deepEqual(a.events().slice(-2), ['state', 'queue'])
})

test('hub(): one instance per process', () => {
  assert.equal(hub(), hub())
  assert.equal(globalThis.__tavarianHub, hub())
})
