// Live stats for internal services (same numbers the old Homepage widgets showed). Server-only: import it
// only from app/api/private/route.js. URLs + credentials come from env (.env on the server), never the bundle.
// A widget is enabled when its *_URL env is set; any failure -> null for that widget, never throws.

const env = process.env
const TIMEOUT = 5000
const TTL = 30_000 // /api/private polls every 5 s per viewer; upstreams get hit at most once per 30 s

async function get(url, headers = {}) {
  const r = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
const basic = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') })
const n = (v) => Number(v ?? 0).toLocaleString('en-US')
const gb = (bytes) => `${(bytes / 2 ** 30).toFixed(0)} GB`

// NPM hands out a bearer token valid ~1 day; reuse it for an hour
let npmToken = null
async function npmAuth() {
  if (npmToken && Date.now() < npmToken.until) return npmToken.value
  const r = await fetch(`${env.NPM_URL}/api/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: env.NPM_USER, secret: env.NPM_PASS }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  npmToken = { value: (await r.json()).token, until: Date.now() + 3600_000 }
  return npmToken.value
}

// each returns [[label, value], ...]
export const WIDGETS = {
  adguard: {
    url: 'ADGUARD_URL',
    async stats() {
      const s = await get(`${env.ADGUARD_URL}/control/stats`, basic(env.ADGUARD_USER, env.ADGUARD_PASS))
      const filtered = (s.num_replaced_safebrowsing ?? 0) + (s.num_replaced_safesearch ?? 0) + (s.num_replaced_parental ?? 0)
      return [
        ['Queries', n(s.num_dns_queries)],
        ['Blocked', n(s.num_blocked_filtering)],
        ['Filtered', n(filtered)],
        ['Latency', `${((s.avg_processing_time ?? 0) * 1000).toFixed(1)} ms`],
      ]
    },
  },
  npm: {
    url: 'NPM_URL',
    async stats() {
      const hosts = await get(`${env.NPM_URL}/api/nginx/proxy-hosts`, { authorization: `Bearer ${await npmAuth()}` })
      const on = hosts.filter((h) => h.enabled).length
      return [['Enabled', n(on)], ['Disabled', n(hosts.length - on)], ['Total', n(hosts.length)]]
    },
  },
  portainer: {
    url: 'PORTAINER_URL',
    async stats() {
      const list = await get(`${env.PORTAINER_URL}/api/endpoints/${env.PORTAINER_ENV}/docker/containers/json?all=1`, { 'x-api-key': env.PORTAINER_KEY })
      const running = list.filter((c) => c.State === 'running').length
      return [['Running', n(running)], ['Stopped', n(list.length - running)], ['Total', n(list.length)]]
    },
  },
  nextcloud: {
    url: 'NEXTCLOUD_URL',
    async stats() {
      const d = (await get(`${env.NEXTCLOUD_URL}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json`, { 'nc-token': env.NEXTCLOUD_TOKEN })).ocs.data
      const sys = d.nextcloud.system
      return [
        ['CPU', `${Number(sys.cpuload?.[0] ?? 0).toFixed(2)}`],
        ['Memory', sys.mem_total ? `${Math.round(100 - (sys.mem_free / sys.mem_total) * 100)}%` : '--'],
        ['Free', gb(sys.freespace ?? 0)],
        ['Users 24h', n(d.activeUsers?.last24hours)],
      ]
    },
  },
  whatsupdocker: {
    url: 'WUD_URL',
    async stats() {
      const list = await get(`${env.WUD_URL}/api/containers`, basic(env.WUD_USER, env.WUD_PASS))
      return [['Monitored', n(list.length)], ['Updates', n(list.filter((c) => c.updateAvailable).length)]]
    },
  },
  n8n: {
    url: 'N8N_URL',
    // needs an n8n API key (Settings -> n8n API). Only counts, no workflow names or data.
    async stats() {
      const h = { 'x-n8n-api-key': env.N8N_API_KEY }
      const workflows = []
      let cursor = ''
      do {
        const page = await get(`${env.N8N_URL}/api/v1/workflows?limit=250${cursor ? `&cursor=${cursor}` : ''}`, h)
        workflows.push(...page.data)
        cursor = page.nextCursor
      } while (cursor)
      // ponytail: last 250 executions, counted if they started in the last 24 h; page further if you run >250/day
      const runs = (await get(`${env.N8N_URL}/api/v1/executions?limit=250`, h)).data.filter((e) => Date.now() - Date.parse(e.startedAt) < 86_400_000)
      return [
        ['Active', `${workflows.filter((w) => w.active).length}/${workflows.length}`],
        ['Runs 24h', n(runs.length)],
        ['Failed 24h', n(runs.filter((e) => e.status === 'error' || e.status === 'crashed').length)],
      ]
    },
  },
  coolify: {
    url: 'COOLIFY_URL',
    // needs an API token (Keys & Tokens -> API tokens) with the "read" permission only; "read:sensitive" isn't needed.
    // status is "running:healthy", "exited:unhealthy", ... -> counted as running when it starts with "running"
    async stats() {
      const h = { authorization: `Bearer ${env.COOLIFY_TOKEN}` }
      const lists = await Promise.all(['applications', 'services', 'databases'].map((r) => get(`${env.COOLIFY_URL}/api/v1/${r}`, h)))
      const [apps, services, dbs] = lists.map((l) => `${l.filter((x) => String(x.status).startsWith('running')).length}/${l.length}`)
      return [['Apps', apps], ['Services', services], ['Databases', dbs]]
    },
  },
  myspeed: {
    url: 'MYSPEED_URL',
    async stats() {
      const [t] = await get(`${env.MYSPEED_URL}/api/speedtests?limit=1`, { password: env.MYSPEED_PASS })
      if (!t) return null
      return [['Ping', `${t.ping} ms`], ['Down', `${Number(t.download).toFixed(0)} Mb/s`], ['Up', `${Number(t.upload).toFixed(0)} Mb/s`]]
    },
  },
}

// ponytail: one shared cache for all widgets; per-widget TTLs if one upstream needs a different cadence
let cache = { at: 0, value: null, pending: null }
export async function widgetStats() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value
  cache.pending ??= Promise.all(
    Object.entries(WIDGETS)
      .filter(([, w]) => env[w.url])
      .map(async ([id, w]) => [id, await w.stats().catch(() => null)]),
  ).then((pairs) => {
    cache = { at: Date.now(), value: Object.fromEntries(pairs), pending: null }
    return cache.value
  })
  return cache.pending
}
