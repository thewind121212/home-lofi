import { gateOk } from '../../../lib/gate'
import { hostStats, agentStats } from '../../../lib/host'
import { widgetStats } from '../../../lib/widgets'
import { internalServices, liveOf } from '../../../lib/internal'

const HEADERS = { 'cache-control': 'no-store, private' }

export async function GET(request) {
  if (!gateOk(request.headers.get('x-home-gate'))) return Response.json({ error: 'not found' }, { status: 404, headers: HEADERS })
  const [stats, list, widgets, hosts] = await Promise.all([hostStats(), internalServices(), widgetStats(), agentStats()])
  // a service with "widget": "<id>" in the JSON gets that widget's live numbers as stats: [[label, value], ...]
  const lives = await liveOf(list)
  const withStats = list.map(({ widget, ...s }, i) => ({ ...s, live: lives[i], ...(widget && widgets[widget] && { stats: widgets[widget] }) }))
  return Response.json({ user: request.headers.get('remote-user') || null, name: process.env.SERVER_NAME || 'Server', stats, hosts, services: withStats, widgets }, { headers: HEADERS })
}
