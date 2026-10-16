import { clientIp, windowLimit } from '../../../lib/limits.js'

// Crashes in the browser (app/report-error.js: the error pages, the News modal's own boundary) land in the server's
// log, so a crash on a phone can be read afterwards: `docker logs … | grep client-error`. Anyone's page can report
// (a guest's crash too), so it's small and slow: a few fields cut to size, REPORTS a minute per visitor, nothing kept.
//   POST { message, stack, component, digest, where, url, ua } -> 204
const REPORTS = 10
const MAX_BODY = 8192
const hit = windowLimit(REPORTS, 60_000)
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/g
const cut = (v, n) => (typeof v === 'string' ? v.replace(CTRL, ' ').slice(0, n) : undefined)

export async function POST(request) {
  if (!hit(clientIp(request))) return new Response(null, { status: 429 })
  const text = await request.text()
  if (text.length > MAX_BODY) return new Response(null, { status: 413 })
  let b
  try {
    b = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!b || typeof b !== 'object') return new Response(null, { status: 400 })
  const report = {
    where: cut(b.where, 40),
    message: cut(b.message, 500),
    digest: cut(b.digest, 40),
    url: cut(b.url, 200),
    ua: cut(b.ua, 200),
    stack: cut(b.stack, 3000),
    component: cut(b.component, 1500),
  }
  console.error(`[client-error] ${JSON.stringify(report)}`)
  return new Response(null, { status: 204 })
}
