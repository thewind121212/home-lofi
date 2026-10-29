import { newsDay } from '../../../lib/news-day.js'

// Everyone's News (app/news.js for a guest; the owner uses app/api/private/settings/news): the same days, read-only.
// No read state (a guest's is kept on their device) and no Refresh: a run costs, so only the owner, behind the login,
// can ask for one. GET [?day=YYYY-MM-DD] -> lib/news-day.js newsDay (without run / nextAt). 404 = no such day, 502 = the
// agent unreachable; { on: false }: NEWS_URL isn't set (no icon). No POST (405).
const ok = { 'cache-control': 'public, max-age=30' }
const none = { 'cache-control': 'no-store' }

export async function GET(request) {
  const { status, body } = await newsDay(new URL(request.url).searchParams.get('day'))
  return Response.json(body, { status, headers: status === 200 ? ok : none })
}
