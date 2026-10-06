import { clientIp, slots } from '../../../../lib/limits'
import { tavarianOn } from '../../../../lib/tavarian'
import { hub } from '../../../../lib/tavarian-hub'

// Public live feed for the Player tab (Server-Sent Events). Browsers never talk to Tavarian's API: they all share
// this server's one upstream stream (lib/tavarian-hub.js). Events: status, state, queue, audio-ready, song-error,
// revoked; each `data:` is one JSON line. A ": ping" comment every 20 s keeps proxies from closing it.
export const dynamic = 'force-dynamic'

const PING = 20_000
const take = slots(4, 400) // 4 open per IP (a few tabs), 400 in all

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`

export async function GET(request) {
  if (!tavarianOn()) return Response.json({ error: 'tavarian_off' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  const release = take(clientIp(request))
  if (!release) return Response.json({ error: 'too_many_streams' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '30' } })

  const encoder = new TextEncoder()
  let done = false
  let unsubscribe = () => {}
  let ping = null
  let end = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const write = (text) => {
        if (done) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          end() // the browser is gone
        }
      }
      end = () => {
        if (done) return
        done = true
        clearInterval(ping)
        unsubscribe()
        release()
        try {
          controller.close()
        } catch {}
      }
      write('retry: 5000\n\n') // EventSource reconnects 5 s after a drop
      unsubscribe = hub().subscribe((event, data) => {
        if (done) throw new Error('closed') // the hub drops this subscriber
        write(frame(event, data))
      })
      ping = setInterval(() => write(': ping\n\n'), PING)
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
      'cache-control': 'no-cache, no-transform', // no-transform: Next's gzip would hold the events back
      'x-accel-buffering': 'no', // nginx: don't buffer this response
    },
  })
}
