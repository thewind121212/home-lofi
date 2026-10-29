import { githubDay } from '../../../lib/news-day.js'

// Everyone's GitHub list (app/github.js for a guest; the owner uses app/api/private/settings/github): the same days,
// read-only, no read state (a guest's is kept on their device). GET [?day=YYYY-MM-DD] -> lib/news-day.js githubDay.
// 404 = no such day, 502 = the agent unreachable; { on: false }: NEWS_URL isn't set (no icon). No POST (405).
const ok = { 'cache-control': 'public, max-age=30' }
const none = { 'cache-control': 'no-store' }

export async function GET(request) {
  const { status, body } = await githubDay(new URL(request.url).searchParams.get('day'))
  return Response.json(body, { status, headers: status === 200 ? ok : none })
}
