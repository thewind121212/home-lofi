import { STATUS_CHECKS } from '../../../lib/data'
import { check } from '../../../lib/status'

// Public up/down + response time for cards with a `status` key (lib/data.js STATUS_CHECKS).
export async function GET() {
  const pairs = await Promise.all(Object.entries(STATUS_CHECKS).map(async ([id, [url, ok]]) => [id, await check(url, ok)]))
  return Response.json(Object.fromEntries(pairs), { headers: { 'cache-control': 'public, max-age=30' } })
}
