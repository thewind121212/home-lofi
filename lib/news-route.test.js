// The owner's News route (app/api/private/settings/news) with the agent stood in (globalThis.__homeNewsFetch): who
// gets in, off without NEWS_URL, the digest cleaned, the archive, the agent down (the last copy kept), the read state
// and the dot, the live stream, Refresh (a run: started, going, done, the agent's limits).
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { GET, POST } from '../app/api/private/settings/news/route.js'
import { resetNews } from './news-fetch.js'
import { memoryStore } from './news-store.js'
import { liveBus } from './live.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', NEWS_URL: 'http://news.test:8090/' }
const env = (on) => {
  for (const [k, v] of Object.entries(VARS)) on ? (process.env[k] = v) : delete process.env[k]
}
const T0 = Date.UTC(2026, 9, 16, 4, 0)
const it = (id, o = {}) => ({ id, title_vi: `Tin ${id}`, title_original: `Tin ${id}`, summary_vi: 's', category: 'ai', importance: 3, source: 'S', url: `https://n.example/${id}`, published_at: null, points: null, comments: null, comments_url: null, ...o })
const digest = (at, ids) => ({ schema_version: '1.0', edition: 'morning', generated_at: at, overview_vi: 'o', sections: [{ key: 'tech', title: 'Công nghệ', items: ids.map((i) => it(i)) }], usage: { model: 'm', input_tokens: 1, output_tokens: 1, cost_usd: 0.2 } })
let calls, agent
const stand = async (url) => {
  const u = new URL(url)
  calls.push(u.pathname)
  if (agent.down) throw new TypeError('fetch failed')
  if (u.pathname === '/api/status' && agent.status) return Response.json(agent.status)
  if (u.pathname === '/api/run' && agent.run) return Response.json(agent.run.body, { status: agent.run.status })
  if (u.pathname === '/latest.json') return Response.json(agent.latest)
  if (u.pathname === '/archive/') return new Response('<a href="2026-10-15_1800.json">x</a><a href="2026-10-16_1012.json">y</a>', { headers: { 'content-type': 'text/html' } })
  if (u.pathname === '/archive/2026-10-15_1800.json') return Response.json(digest('2026-10-15T18:00:00+07:00', ['old1', 'a']))
  return new Response('', { status: 404 })
}
test.beforeEach(() => {
  env(true)
  resetNews()
  calls = []
  agent = { latest: digest('2026-10-16T10:12:14+07:00', ['a', 'b', 'c']) }
  globalThis.__homeNewsFetch = stand
  globalThis.__homeNewsStore = memoryStore()
  mock.timers.enable({ apis: ['Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())
test.after(() => {
  env(false)
  delete globalThis.__homeNewsFetch
  delete globalThis.__homeNewsStore
})

const call = async (fn, method, body, headers = OWNER, query = '') => {
  const init = { method, headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const r = await fn(new Request(`http://home.test/api/private/settings/news${query}`, init))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}
const get = (q = '', headers) => call(GET, 'GET', undefined, headers, q)
const post = (body, headers) => call(POST, 'POST', body, headers)

test('guests: nothing (404 / 403); no NEWS_URL: off', async () => {
  assert.equal((await get('', {})).status, 404)
  assert.equal((await get('', { ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await post({ action: 'seen', at: 1 }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.deepEqual(calls, [])
  delete process.env.NEWS_URL
  assert.deepEqual((await get()).body, { on: false })
})

test('GET: the latest digest, cleaned (no usage), the archive, nothing read, a new edition (no seen)', async () => {
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.deepEqual(r.body.digest.sections[0].items.map((i) => i.id), ['a', 'b', 'c'])
  assert.equal('usage' in r.body.digest, false)
  assert.deepEqual([r.body.edition, r.body.latestAt, r.body.read, r.body.seen], [null, Date.parse('2026-10-16T03:12:14Z'), [], null])
  // (the latest, 10:12, is in the archive too: left out of it)
  assert.deepEqual(r.body.editions, [{ name: '2026-10-15_1800.json', label: '2026-10-15 18:00' }])
  // kept a minute for every tab
  await get()
  assert.deepEqual(calls.filter((c) => c === '/latest.json'), ['/latest.json'])
  mock.timers.setTime(T0 + 61_000)
  await get()
  assert.equal(calls.filter((c) => c === '/latest.json').length, 2)
})

test('an archived edition; one not in the archive, or a bad name: 404', async () => {
  const r = await get('?edition=2026-10-15_1800.json')
  assert.deepEqual([r.status, r.body.edition, r.body.digest.sections[0].items.map((i) => i.id)], [200, '2026-10-15_1800.json', ['old1', 'a']])
  assert.equal((await get('?edition=2026-10-01_0600.json')).status, 404)
  assert.equal((await get('?edition=../latest.json')).status, 404)
  assert.ok(!calls.includes('/latest.json/..'))
})

test('the agent down: 502 at first; once loaded, the last copy is kept', async () => {
  agent.down = true
  assert.deepEqual([(await get()).status, (await get()).body.error], [502, 'news unreachable'])
  agent.down = false
  mock.timers.setTime(T0 + 16_000)
  assert.equal((await get()).status, 200)
  agent.down = true
  mock.timers.setTime(T0 + 80_000)
  const r = await get()
  assert.deepEqual([r.status, r.body.digest.sections[0].items.length, r.body.stale], [200, 3, true])
  agent.down = false
  mock.timers.setTime(T0 + 100_000)
  assert.equal((await get()).body.stale, false)
  agent.down = true
  // not a digest: 502
  agent.down = false
  agent.latest = { hello: 'world' }
  resetNews()
  assert.equal((await get()).status, 502)
})

test('read / unread: this digest\'s read ones; seen: the dot goes, only ever forward; the other tabs hear it', async () => {
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-bbbbbbbb', (e) => heard.push(e.kind))
  const from = { ...OWNER, 'x-home-client': 'tab-aaaaaaaa' }
  assert.equal((await post({ action: 'read', ids: ['a', 'c', 'old1'] }, from)).status, 200)
  assert.deepEqual((await get()).body.read.sort(), ['a', 'c'])
  await post({ action: 'unread', ids: ['c'] }, from)
  assert.deepEqual((await get()).body.read, ['a'])
  assert.deepEqual((await get('?edition=2026-10-15_1800.json')).body.read.sort(), ['a', 'old1'])
  const latestAt = (await get()).body.latestAt
  await post({ action: 'seen', at: latestAt }, from)
  await post({ action: 'seen', at: latestAt - 86_400_000 }, from)
  assert.equal((await get()).body.seen, latestAt)
  off()
  assert.deepEqual(heard, ['news', 'news', 'news', 'news'])
  for (const bad of [{ action: 'read', ids: [] }, { action: 'seen' }, { action: 'x' }]) assert.equal((await post(bad)).status, 400)
  assert.equal((await post({ action: 'read', ids: ['a'] }, { ...OWNER })).status, 200) // (same-origin is set by call())
})

test('a body past 2 MB (no length said): refused, not read to the end', async () => {
  let pulled = 0
  globalThis.__homeNewsFetch = async () => new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(256 * 1024)); if (pulled > 100) c.close() } }))
  assert.equal((await get()).status, 502)
  assert.ok(pulled < 40, `read ${pulled} of 101 chunks`) // (the stream reads a little ahead of the reader)
})

const status = (o = {}) => ({ job_id: 'd0e89c9a', status: 'idle', edition: 'manual', started_at: null, finished_at: null, result_url: null, items: null, cost_usd: null, error: null, ...o })

test('no /api/status (an older agent): run null, no Refresh to offer', async () => {
  const r = await get()
  assert.deepEqual([r.status, r.body.run, r.body.nextAt], [200, null, 0])
})

test('Refresh: started, going (every tab hears it), done: the new edition at once, not the minute-old copy', async () => {
  agent.status = status({ status: 'done', started_at: '2026-10-16T10:10:00+07:00', finished_at: '2026-10-16T10:12:14+07:00', items: 3 })
  assert.equal((await get()).body.run.state, 'done')
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-bbbbbbbb', (e) => heard.push(e.kind))
  agent.run = { status: 202, body: { job: { job_id: 'ffff0001', status: 'running' } } }
  agent.status = status({ job_id: 'ffff0001', status: 'running', started_at: '2026-10-16T11:00:00+07:00' })
  const p = await post({ action: 'refresh' }, { ...OWNER, 'x-home-client': 'tab-aaaaaaaa' })
  assert.deepEqual([p.status, p.body], [200, { ok: true, started: true }])
  assert.deepEqual(heard, ['news'])
  off()
  // (the status asked again at once, not the copy from before the start)
  const going = (await get()).body.run
  assert.deepEqual([going.job, going.state, going.startedAt, going.finishedAt], ['ffff0001', 'running', T0, null])
  // one already going: 409, the same
  agent.run = { status: 409, body: { error: 'busy', job: { job_id: 'ffff0001' } } }
  assert.deepEqual((await post({ action: 'refresh' })).body, { ok: true, started: false })
  // done 20 s later: latest.json (kept a minute) and the listing asked again, once
  mock.timers.setTime(T0 + 20_000)
  agent.latest = digest('2026-10-16T11:00:20+07:00', ['n1', 'n2'])
  agent.status = status({ job_id: 'ffff0001', status: 'done', started_at: '2026-10-16T11:00:00+07:00', finished_at: '2026-10-16T11:00:20+07:00', items: 2, cost_usd: 0.5391 })
  const before = calls.filter((c) => c === '/latest.json').length
  const r = await get()
  assert.deepEqual(r.body.digest.sections[0].items.map((i) => i.id), ['n1', 'n2'])
  assert.deepEqual([r.body.run.state, r.body.run.items, r.body.run.cost, r.body.latestAt], ['done', 2, 0.539, T0 + 20_000])
  mock.timers.setTime(T0 + 30_000)
  await get()
  assert.equal(calls.filter((c) => c === '/latest.json').length, before + 1)
})

test('Refresh: the agent\'s limits (429) kept for every device; failed runs said; the agent down: 502', async () => {
  agent.status = status()
  agent.run = { status: 429, body: { error: 'cooldown', retry_after_s: 420 } }
  const p = await post({ action: 'refresh' })
  assert.deepEqual([p.status, p.body.nextAt], [429, T0 + 420_000])
  assert.equal((await get()).body.nextAt, T0 + 420_000)
  mock.timers.setTime(T0 + 421_000)
  assert.equal((await get()).body.nextAt, 0)
  agent.status = status({ status: 'error', error: 'anthropic: overloaded\u0000', finished_at: '2026-10-16T11:07:00+07:00' })
  mock.timers.setTime(T0 + 430_000)
  assert.deepEqual([(await get()).body.run.state, (await get()).body.run.error], ['error', 'anthropic: overloaded'])
  agent.down = true
  assert.equal((await post({ action: 'refresh' })).status, 502)
  agent.down = false
  agent.run = { status: 500, body: {} }
  assert.equal((await post({ action: 'refresh' })).status, 502)
  assert.equal((await post({ action: 'refresh' }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
})
