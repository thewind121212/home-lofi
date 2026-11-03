import { ownerOf, sameOriginBinary } from '../../../../../lib/gate.js'
import { MAX_BYTES, MIN_BYTES, MSG, clientIdOk } from '../../../../../lib/jade.js'
import { JadeOffline, startTurn } from '../../../../../lib/jade-relay.js'

// Talk to Jade (app/jade.js): one push-to-talk turn with the owner's voice assistant on the Razer, relayed (lib/jade-relay.js).
// Owner-only, under the proxy's /api/private/settings location (the Authelia login, at home too; from outside it's the
// same login): Jade can switch the lights and the AC, so a guest on the LAN mustn't talk to her through this page.
//   POST ?client=<the browser's UUID>  body: 16 kHz mono Int16 LE PCM (application/octet-stream, same-origin)
//     -> 200 application/x-ndjson: the turn as it happens (lib/jade.js `line`), streamed
// 404 = not through that location / not set up, 403 = someone else or another site, 400 = no client id / too short,
// 413 = over a minute, 429 = too many turns at once, 503 = Jade unreachable (a Vietnamese line to show).
// One turn a browser: its next one (pressed again while Jade talks) ends the last, and Jade is told to stop.
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
  if (!sameOriginBinary(request)) return json({ error: 'forbidden' }, 403)
  const client = new URL(request.url).searchParams.get('client')
  if (!clientIdOk(client)) return json({ error: 'bad client' }, 400)
  const pcm = await readCapped(request)
  if (!pcm) return json({ error: MSG.tooLong, code: 'too-long' }, 413)
  if (pcm.length < MIN_BYTES) return json({ error: MSG.short, code: 'short' }, 400)

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
    const stream = await startTurn({ pcm, clientId: client, signal: ac.signal, onEnd: release })
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
