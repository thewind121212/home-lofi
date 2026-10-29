import { image, newsOn } from '../../../../lib/news-fetch.js'

// A story's photo for everyone's News (app/api/news): GET ?f=<name> -> the agent's images/<name>, as the owner's
// app/api/private/settings/news/image passes it through (lib/news-fetch.js image: only a story photo's name, only an
// image, 3 MB at most). Kept a week by browsers: a name is a story's id, its photo doesn't change. 404 = not set up / no
// such photo, 502 = the agent unreachable or not an image.
const NONE = { 'cache-control': 'no-store' }
const WEEK = 7 * 24 * 3600

export async function GET(request) {
  if (!newsOn()) return new Response(null, { status: 404, headers: NONE })
  try {
    const { bytes, type } = await image(new URL(request.url).searchParams.get('f'))
    return new Response(bytes, {
      headers: { 'content-type': type, 'cache-control': `public, max-age=${WEEK}, immutable`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
    })
  } catch (e) {
    return new Response(null, { status: e.status === 404 ? 404 : 502, headers: NONE })
  }
}
