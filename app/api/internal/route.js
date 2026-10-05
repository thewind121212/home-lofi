import { internalServices, liveOf } from '../../../lib/internal'

// Public teaser for the locked Internal tab: each internal service's name, icon and up/down + ms. Never its link,
// host, widget or stats (those only come from /api/private). Probes are cached per URL (lib/status.js).
export async function GET() {
  const list = await internalServices()
  const lives = await liveOf(list)
  const teaser = list.map((s, i) => ({ name: s.name, ...(s.fa ? { fa: s.fa } : s.icon && { icon: s.icon }), live: lives[i] }))
  return Response.json(teaser, { headers: { 'cache-control': 'public, max-age=30' } })
}
