import { readFile } from 'node:fs/promises'
import { gateOk } from '../../../lib/gate'
import { hostStats } from '../../../lib/host'
import { widgetStats } from '../../../lib/widgets'
import { check } from '../../../lib/status'

const HEADERS = { 'cache-control': 'no-store, private' }

// Same item shape as SERVICES[].items in lib/data.js. Missing/invalid file -> [].
async function services() {
  try {
    const list = JSON.parse(await readFile(/*turbopackIgnore: true*/ process.env.PRIVATE_SERVICES_FILE || '/config/private-services.json', 'utf8'))
    // drop items the client card can't render safely (it does new URL(href); no javascript: links)
    return Array.isArray(list)
      ? list.filter((s) => {
          try {
            return typeof s.name === 'string' && /^https?:$/.test(new URL(s.href).protocol)
          } catch {
            return false
          }
        })
      : []
  } catch {
    return []
  }
}

export async function GET(request) {
  if (!gateOk(request.headers.get('x-home-gate'))) return Response.json({ error: 'not found' }, { status: 404, headers: HEADERS })
  const [stats, list, widgets] = await Promise.all([hostStats(), services(), widgetStats()])
  // a service with "widget": "<id>" in the JSON gets that widget's live numbers as stats: [[label, value], ...]
  // live = up/down + ms from probing the service's own link (< 500 = up: an auth wall still means it's alive)
  const lives = await Promise.all(list.map((s) => check(s.href, null, 500)))
  const withStats = list.map(({ widget, ...s }, i) => ({ ...s, live: lives[i], ...(widget && widgets[widget] && { stats: widgets[widget] }) }))
  return Response.json({ user: request.headers.get('remote-user') || null, stats, services: withStats, widgets }, { headers: HEADERS })
}
