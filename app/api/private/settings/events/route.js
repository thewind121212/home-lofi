import { syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'

// The owner's live settings feed (Server-Sent Events, lib/live.js): app/cloud.js keeps it open while synced and pulls
// the settings when it hears that another device saved. Same owner-only gate as /api/private/settings (the proxy's
// location for that path covers this one, Authelia login included): 404 = not set up / not through that location,
// 403 = someone else. Guests never get a stream.
//   GET ?id=<this tab's id>   -> event: hello   (on connect)            data: { at }
//                                event: changed (another tab saved)     data: { at, from }
// A ": ping" comment every 20 s keeps proxies from closing it as idle. No settings ever go down this stream.
export const dynamic = 'force-dynamic'

const PING = 20_000
const NO_STORE = { 'cache-control': 'no-store, private' }
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return Response.json({ error: 'no sync' }, { status: who, headers: NO_STORE })
  const id = clientId(new URL(request.url).searchParams.get('id'))
  if (!id) return Response.json({ error: 'bad id' }, { status: 400, headers: NO_STORE })

  const encoder = new TextEncoder()
  let done = false
  let unsubscribe = () => {}
  let ping = null
  let end = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const write = (text) => {
        if (done) throw new Error('closed') // (the bus drops a subscriber whose send throws)
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          end() // the browser is gone
          throw new Error('closed')
        }
      }
      end = () => {
        if (done) return
        done = true
        clearInterval(ping)
        unsubscribe()
        try {
          controller.close()
        } catch {}
      }
      const quiet = (text) => {
        try {
          write(text)
        } catch {}
      }
      quiet(frame('hello', { at: Date.now() }))
      // end: the bus pushes this stream out when it's full (the oldest goes); the page reconnects with backoff
      unsubscribe = liveBus().subscribe(who, id, (event) => write(frame('changed', event)), () => end())
      ping = setInterval(() => quiet(': ping\n\n'), PING)
      if (request.signal.aborted) end()
      else request.signal.addEventListener('abort', () => end(), { once: true })
    },
    cancel() {
      end()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, private, no-transform', // no-transform: Next's gzip would hold the events back
      'x-accel-buffering': 'no', // nginx: don't buffer this response
    },
  })
}
