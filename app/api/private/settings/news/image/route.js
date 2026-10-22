import { syncOwner } from '../../../../../../lib/gate.js'
import { image, newsOn } from '../../../../../../lib/news-fetch.js'

// A story's photo for the owner's News (app/news.js): GET ?f=<name> -> the agent's images/<name> (lib/news-fetch.js
// image), passed through. The agent sits on the LAN where a phone out of the house can't reach it; this server can. In
// the owner-only zone like the route next door (the proxy's login covers it; an <img> sends the cookie). Kept a week by
// the browser, privately: a name is a story's id, its photo doesn't change. 404 = not set up / someone else / no such
// photo, 502 = the agent unreachable or not an image.
const NONE = { 'cache-control': 'no-store, private' }
const WEEK = 7 * 24 * 3600

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number' || !newsOn()) return new Response(null, { status: typeof who === 'number' ? who : 404, headers: NONE })
  try {
    const { bytes, type } = await image(new URL(request.url).searchParams.get('f'))
    return new Response(bytes, {
      headers: { 'content-type': type, 'cache-control': `private, max-age=${WEEK}`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
    })
  } catch (e) {
    return new Response(null, { status: e.status === 404 ? 404 : 502, headers: NONE })
  }
}
