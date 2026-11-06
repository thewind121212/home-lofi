import { ownerOf, sameOriginBinary, sameOriginJson } from '../../../../../lib/gate.js'
import { MAX_BYTES, MIN_BYTES, MSG, TEXT_MAX, chatText, clientIdOk } from '../../../../../lib/jade.js'
import { JadeOffline, startTurn } from '../../../../../lib/jade-relay.js'
import { PAGE, PAGE_MAX, jadeStore } from '../../../../../lib/jade-store.js'

// Talk to Jade (app/jade.js): one push-to-talk turn with the owner's voice assistant on the Razer, relayed (lib/jade-relay.js).
// Owner-only, under the proxy's /api/private/settings location (the Authelia login, at home too; from outside it's the
// same login): Jade can switch the lights and the AC, so a guest on the LAN mustn't talk to her through this page.
//   POST ?client=<the browser's UUID>  body: 16 kHz mono Int16 LE PCM (application/octet-stream, same-origin)
//                                      or a typed turn: { text, audio } (application/json, same-origin)
//     -> 200 application/x-ndjson: the turn as it happens (lib/jade.js `line`), streamed
// 404 = not through that location / not set up, 403 = someone else or another site, 400 = no client id / too short /
// no text, 413 = over a minute / over TEXT_MAX characters, 429 = too many turns at once, 503 = Jade unreachable (a
// Vietnamese line to show).
// One turn a browser: its next one (pressed again while Jade talks) ends the last, and Jade is told to stop.
// Each turn Jade heard is kept (lib/jade-store.js; with a database) before the stream's last line:
//   GET ?before=<id>&limit=<n>  -> { turns (newest first: { id, at, via, me, jade, emoji }), more } (no database: none)
//   DELETE                      -> { ok } the history gone
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store, private' }
const json = (body, status) => Response.json(body, { status, headers: NO_STORE })
const MAX_TURNS = 3 // in all, at once (one owner, a phone and a laptop or two)
const turns = () => (globalThis.__homeJadeTurns ??= new Map()) // client id -> its turn's AbortController

// the body, up to MAX_BYTES (more: null)
async function readCapped(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return null
  const chunks = []
  let n = 0
  for await (const c of request.body ?? []) {
    n += c.length
    if (n > MAX_BYTES) return null
    chunks.push(c)
  }
  const out = new Uint8Array(n)
  let at = 0
  for (const c of chunks) out.set(c, at), (at += c.length)
  return out
}

export async function POST(request) {
  const who = ownerOf(request)
  if (typeof who === 'number') return json({ error: 'no jade' }, who)
  const typed = sameOriginJson(request)
  if (!typed && !sameOriginBinary(request)) return json({ error: 'forbidden' }, 403)
  const client = new URL(request.url).searchParams.get('client')
  if (!clientIdOk(client)) return json({ error: 'bad client' }, 400)
  let pcm = null, text = null, audio = true
  if (typed) {
    if (Number(request.headers.get('content-length')) > TEXT_MAX * 8) return json({ error: MSG.textLong, code: 'text-long' }, 413)
    const body = await request.json().catch(() => null)
    if (typeof body?.text === 'string' && body.text.trim().length > TEXT_MAX) return json({ error: MSG.textLong, code: 'text-long' }, 413)
    text = chatText(body?.text)
    if (!text) return json({ error: 'no text' }, 400)
    audio = body.audio !== false
  } else {
    pcm = await readCapped(request)
    if (!pcm) return json({ error: MSG.tooLong, code: 'too-long' }, 413)
    if (pcm.length < MIN_BYTES) return json({ error: MSG.short, code: 'short' }, 400)
  }

  const all = turns()
  all.get(client)?.abort() // this browser's last turn: over (it ends itself and leaves the map)
  if (all.size >= MAX_TURNS && !all.has(client)) return json({ error: MSG.busy, code: 'busy' }, 429)
  const ac = new AbortController()
  all.set(client, ac)
  const release = () => all.get(client) === ac && all.delete(client)
  const gone = () => ac.abort()
  if (request.signal.aborted) gone()
  else request.signal.addEventListener('abort', gone, { once: true })
  try {
    const store = jadeStore()
    const onRecord = store ? (rec) => store.add(who, rec) : null
    const stream = await startTurn({ pcm, text, audio, clientId: client, signal: ac.signal, onEnd: release, onRecord })
    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store, private, no-transform', // no-transform: Next's gzip would hold the lines back
        'x-accel-buffering': 'no', // nginx: don't buffer this response
      },
    })
  } catch (e) {
    release()
    request.signal.removeEventListener('abort', gone)
    if (e instanceof JadeOffline) return json({ error: MSG.offline, code: 'offline' }, 503)
    throw e
  }
}

export async function GET(request) {
  const who = ownerOf(request)
  if (typeof who === 'number') return json({ error: 'no jade' }, who)
  const store = jadeStore()
  if (!store) return json({ turns: [], more: false }, 200)
  const q = new URL(request.url).searchParams
  const before = /^\d{1,15}$/.test(q.get('before') ?? '') ? Number(q.get('before')) : null
  const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(q.get('limit') ?? '', 10) || PAGE))
  try {
    return json(await store.list(who, { before, limit }), 200)
  } catch {
    return json({ error: 'database' }, 503)
  }
}

// (no other site can send a DELETE without a CORS preflight, which no route here grants; a browser says where it came from)
export async function DELETE(request) {
  const who = ownerOf(request)
  if (typeof who === 'number') return json({ error: 'no jade' }, who)
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return json({ error: 'forbidden' }, 403)
  const store = jadeStore()
  if (!store) return json({ ok: true }, 200)
  try {
    await store.clear(who)
    return json({ ok: true }, 200)
  } catch {
    return json({ error: 'database' }, 503)
  }
}
