// The Tavarian event hub. Server-only. ONE upstream Server-Sent-Events connection to Tavarian's /home/events for the
// whole server, whatever the number of visitors: it opens with the first browser that subscribes (via
// /api/tavarian/events), keeps the latest state and queue, fans every event out, reconnects with backoff, and closes
// 60 s after the last browser leaves. Tavarian allows 2 streams per token; this keeps us at 1.
import { freshen, shapeAudioReady, shapeQueue, shapeSongError, shapeState, tavarianUrl, TOKEN_DEAD } from './tavarian.js'

// ---- SSE parsing (the text/event-stream format), by hand: feed it text chunks as they come ----
// onEvent({ event, data, id }) at each blank line that ends an event with data; comments (": ping") are dropped.
// Lines end in \n, \r\n or \r, and a chunk can stop anywhere (mid-line, between \r and \n).
export function sseParser(onEvent) {
  let buf = ''
  let skipLF = false // the last chunk ended in \r: a \n right after it belongs to the same line end
  let event = ''
  let data = []
  let id = null
  const line = (l) => {
    if (l === '') {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n'), id })
      event = ''
      data = []
      return
    }
    if (l[0] === ':') return // a comment
    const i = l.indexOf(':')
    const field = i < 0 ? l : l.slice(0, i)
    let value = i < 0 ? '' : l.slice(i + 1)
    if (value[0] === ' ') value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    else if (field === 'id' && !value.includes('\0')) id = value
    // retry and unknown fields: ignored (our own backoff decides)
  }
  return function push(text) {
    if (skipLF && text[0] === '\n') text = text.slice(1)
    skipLF = false
    buf += text
    let start = 0
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i]
      if (c !== '\n' && c !== '\r') continue
      line(buf.slice(start, i))
      if (c === '\r') {
        if (i + 1 === buf.length) skipLF = true
        else if (buf[i + 1] === '\n') i++
      }
      start = i + 1
    }
    buf = buf.slice(start)
  }
}

// 1 s, 2 s, 4 s ... at most 30 s
export const MAX_BACKOFF = 30_000
export const backoffMs = (attempt) => Math.min(1000 * 2 ** attempt, MAX_BACKOFF)

const CONNECT_TIMEOUT = 15_000 // headers must come by then
const SILENCE = 50_000 // Tavarian pings every 20 s: this long without a byte = a dead connection

// The hub. Everything it touches from outside comes in through the options, so the tests can drive it.
export function createHub({
  fetchImpl = (...a) => fetch(...a),
  base = tavarianUrl,
  token = () => process.env.TAVARIAN_TOKEN,
  idleMs = 60_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  // the server log (docker logs): what went wrong with the station, never a token (codes and ids only)
  log = (line) => console.warn(`[tavarian] ${line}`),
} = {}) {
  const subs = new Set()
  let latest = { state: null, stateAt: 0, queue: null, queueAt: 0 }
  let status = 'idle' // idle | connecting | live | retrying | revoked
  let reason = null // the last error code (no secrets: Tavarian's code or ours)
  let conn = null // the open attempt's AbortController
  let attempt = 0
  let retryTimer = null
  let idleTimer = null
  let silenceTimer = null

  const fan = (event, data) => {
    for (const send of subs) {
      try {
        send(event, data)
      } catch {
        subs.delete(send) // a closed browser stream
      }
    }
  }
  const setStatus = (s, why = reason) => {
    reason = why
    if (s === status) return
    status = s
    fan('status', { status, reason })
  }
  const clear = (t) => t && clearTimer(t)

  function stop() {
    clear(retryTimer)
    clear(silenceTimer)
    retryTimer = silenceTimer = null
    const c = conn
    conn = null
    c?.abort()
  }

  function retry(delay) {
    stop()
    if (status === 'revoked') return
    if (status !== 'retrying') log(`event stream lost (${reason ?? 'no answer'}), reconnecting`)
    setStatus('retrying')
    retryTimer = setTimer(() => {
      retryTimer = null
      connect()
    }, delay ?? backoffMs(attempt))
    attempt++
  }

  function revoked(why) {
    log(`event stream refused for good: ${why}`)
    stop()
    setStatus('revoked', why)
    fan('revoked', { reason: why })
  }

  function handle({ event, data }) {
    let d = null
    try {
      d = JSON.parse(data)
    } catch {
      return
    }
    if (event === 'state') {
      latest = { ...latest, state: shapeState(d), stateAt: now() }
      attempt = 0 // a working connection: the next drop starts again at 1 s
      setStatus('live', null)
      fan('state', latest.state)
    } else if (event === 'queue') {
      latest = { ...latest, queue: shapeQueue(d), queueAt: now() }
      fan('queue', latest.queue)
    } else if (event === 'audio-ready') fan('audio-ready', shapeAudioReady(d))
    else if (event === 'song-error') {
      const e = shapeSongError(d)
      log(`song ${e?.songId ?? '?'} skipped: ${typeof e?.reason === 'string' ? e.reason.slice(0, 120) : 'no reason'}`)
      fan('song-error', e)
    }
    else if (event === 'revoked') revoked('token_revoked')
  }

  async function connect() {
    if (conn || status === 'revoked') return
    const t = token()
    if (!t) return setStatus('idle', 'tavarian_off')
    const ctl = new AbortController()
    conn = ctl
    if (status !== 'retrying') setStatus('connecting')
    const watch = (ms) => {
      clear(silenceTimer)
      silenceTimer = setTimer(() => conn === ctl && retry(), ms)
    }
    watch(CONNECT_TIMEOUT)
    let res
    try {
      res = await fetchImpl(`${base()}/api/v1/home/events`, {
        headers: { authorization: `Bearer ${t}`, accept: 'text/event-stream' },
        cache: 'no-store',
        redirect: 'manual',
        signal: ctl.signal,
      })
    } catch {
      if (conn === ctl) retry()
      return
    }
    if (conn !== ctl) return res.body?.cancel().catch(() => {}) // closed while connecting
    if (!res.ok || !res.body) {
      const code = await res
        .json()
        .then((j) => (typeof j?.error === 'string' ? j.error : null))
        .catch(() => null)
      if (conn !== ctl) return
      const wait = Number(res.headers.get('retry-after')) * 1000 || 0
      reason = code ?? `http_${res.status}`
      if (res.status === 401 || TOKEN_DEAD.has(code)) return revoked(reason) // a dead token: asking again won't help
      if (code === 'too_many_streams') return retry(Math.max(wait, MAX_BACKOFF)) // an old stream still counts: give it time
      if (res.status === 429) return retry(Math.max(wait, backoffMs(attempt)))
      if (res.status === 403 || res.status === 503) return retry(MAX_BACKOFF) // fixed on Tavarian's side, not soon
      return retry()
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const push = sseParser(handle)
    watch(SILENCE)
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (conn !== ctl) break
        if (done) break
        watch(SILENCE)
        push(decoder.decode(value, { stream: true }))
      }
    } catch {
      // dropped
    }
    reader.cancel().catch(() => {})
    if (conn === ctl) {
      reason = 'disconnected'
      retry()
    }
  }

  function close() {
    stop()
    attempt = 0
    if (status !== 'revoked') setStatus('idle')
  }

  const api = {
    // send(event, data) for every event; it gets the current status, state and queue right away.
    // -> unsubscribe. The last one out closes the upstream connection after idleMs.
    subscribe(send) {
      subs.add(send)
      clear(idleTimer)
      idleTimer = null
      const snap = api.snapshot()
      try {
        send('status', { status: snap.status, reason: snap.reason })
        if (snap.status === 'revoked') send('revoked', { reason: snap.reason })
        if (snap.state) send('state', snap.state)
        if (snap.queue) send('queue', snap.queue)
      } catch {
        subs.delete(send)
      }
      if (!conn && !retryTimer && status !== 'revoked') connect()
      let gone = false
      return () => {
        if (gone) return
        gone = true
        subs.delete(send)
        if (subs.size || idleTimer) return
        idleTimer = setTimer(() => {
          idleTimer = null
          if (!subs.size) close()
        }, idleMs)
      }
    },
    // { status, reason, live, state (moved on to now), queue, stateAt, queueAt, subscribers }
    snapshot() {
      return {
        status,
        reason,
        live: status === 'live',
        state: freshen(latest.state, latest.stateAt, now()),
        queue: latest.queue,
        stateAt: latest.stateAt,
        queueAt: latest.queueAt,
        subscribers: subs.size,
      }
    },
    // the token was revoked from here (the owner's route): stop for good, tell everyone
    revoked: () => status !== 'revoked' && revoked('token_revoked'),
    close,
  }
  return api
}

// One hub per server process; globalThis keeps it across Next's dev hot reloads (a reload would else open a second
// upstream stream, and Tavarian allows only 2).
export const hub = () => (globalThis.__tavarianHub ??= createHub())
