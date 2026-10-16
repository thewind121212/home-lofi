// The owner's GitHub route (app/api/private/settings/github) with the agent stood in (globalThis.__homeNewsFetch): who
// gets in, off without NEWS_URL, the list cleaned, an older day, late or not, the agent down, the read state (beside
// News', never mixed) and the dot, the live stream.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { GET, POST } from '../app/api/private/settings/github/route.js'
import { GET as newsGET } from '../app/api/private/settings/news/route.js'
import { resetNews } from './news-fetch.js'
import { memoryStore } from './news-store.js'
import { liveBus } from './live.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', NEWS_URL: 'http://news.test:8090/' }
const env = (on) => {
  for (const [k, v] of Object.entries(VARS)) on ? (process.env[k] = v) : delete process.env[k]
}
const at = (day, hm) => Date.parse(`${day}T${hm}:00+07:00`)
const repo = (id, o = {}) => ({ id, rank: 1, list: 'trending', full_name: id, url: `https://github.com/${id}`, summary_vi: 's', category: 'web', worth_trying: 3, ...o })
const list = (date, ids, hm = '06:02') => ({ schema_version: 'gh-1.0', kind: 'github', date, generated_at: `${date}T${hm}:00+07:00`, overview_vi: 'o', repos: ids.map((i) => repo(i)), usage: { cost_usd: 0.45 } })
const news = { schema_version: '1.5', edition: 'morning', generated_at: '2026-10-16T06:00:00+07:00', sections: [{ key: 'tech', title: 'T', items: [{ id: 'n1', title_vi: 'x', url: 'https://n.example/1', category: 'ai', importance: 3 }] }] }
let calls, agent
const stand = async (url) => {
  const u = new URL(url)
  calls.push(u.pathname)
  if (agent.down) throw new TypeError('fetch failed')
  if (u.pathname === '/github.json') return Response.json(agent.latest)
  if (u.pathname === '/github-archive/') return new Response((agent.names ?? ['2026-10-15_0602.json', '2026-10-16_0602.json']).map((n) => `<a href="${n}">x</a>`).join(''), { headers: { 'content-type': 'text/html' } })
  if (u.pathname === '/github-archive/2026-10-15_0602.json') return Response.json(list('2026-10-15', ['old/one', 'a/a']))
  if (u.pathname === '/latest.json') return Response.json(news)
  return new Response('', { status: 404 })
}
test.beforeEach(() => {
  env(true)
  resetNews()
  calls = []
  agent = { latest: list('2026-10-16', ['a/a', 'b/b', 'c/c']) }
  globalThis.__homeNewsFetch = stand
  globalThis.__homeNewsStore = memoryStore()
  mock.timers.enable({ apis: ['Date'], now: at('2026-10-16', '09:00') })
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
  const r = await fn(new Request(`http://home.test/api/private/settings/github${query}`, init))
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

test('GET: the newest list, cleaned (no usage), the days, not late, nothing read, no seen', async () => {
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.deepEqual(r.body.digest.repos.map((x) => x.id), ['a/a', 'b/b', 'c/c'])
  assert.equal('usage' in r.body.digest, false)
  assert.deepEqual([r.body.day, r.body.picked, r.body.today, r.body.late, r.body.retry, r.body.stale, r.body.read, r.body.seen], ['2026-10-16', null, '2026-10-16', false, false, false, [], null])
  assert.equal(r.body.latestAt, at('2026-10-16', '06:02'))
  assert.deepEqual(r.body.days, [{ day: '2026-10-16', last: '06:02' }, { day: '2026-10-15', last: '06:02' }])
})

test('an older day; one not in the archive, or a bad one: 404', async () => {
  const r = await get('?day=2026-10-15')
  assert.deepEqual([r.status, r.body.day, r.body.picked, r.body.digest.repos.map((x) => x.id)], [200, '2026-10-15', '2026-10-15', ['old/one', 'a/a']])
  assert.equal((await get('?day=2026-10-01')).status, 404)
  assert.equal((await get('?day=../github.json')).status, 404)
  assert.ok(!calls.some((c) => c.includes('..')))
})

test("late: yesterday's list after 06:05 (asked again until 08:00); the agent down: the copy from before, or 502", async () => {
  agent.latest = list('2026-10-15', ['old/one'])
  agent.names = ['2026-10-15_0602.json']
  mock.timers.setTime(at('2026-10-16', '07:00'))
  let r = await get()
  assert.deepEqual([r.body.day, r.body.late, r.body.retry], ['2026-10-15', true, true])
  mock.timers.setTime(at('2026-10-16', '08:30'))
  resetNews()
  r = await get()
  assert.deepEqual([r.body.late, r.body.retry], [true, false])
  // down: the copy kept
  mock.timers.setTime(at('2026-10-16', '08:32'))
  agent.down = true
  r = await get()
  assert.deepEqual([r.status, r.body.stale, r.body.digest.repos[0].id], [200, true, 'old/one'])
  resetNews()
  assert.equal((await get()).status, 502)
})

test("the listing already has today's while the copy of github.json is yesterday's: today's, not late", async () => {
  agent.latest = list('2026-10-15', ['old/one'])
  agent.names = ['2026-10-15_0602.json', '2026-10-16_0602.json']
  const today = list('2026-10-16', ['a/a'])
  const was = stand
  globalThis.__homeNewsFetch = async (url) => (new URL(url).pathname === '/github-archive/2026-10-16_0602.json' ? Response.json(today) : was(url))
  mock.timers.setTime(at('2026-10-16', '07:00'))
  const r = await get()
  assert.deepEqual([r.body.day, r.body.late, r.body.latestAt, r.body.digest.repos[0].id], ['2026-10-16', false, at('2026-10-16', '06:02'), 'a/a'])
})

test("read / unread / seen: kept per owner, beside News' (never in its list); the other tabs hear 'github'", async () => {
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-bbbbbbbb', (e) => heard.push(e.kind))
  assert.equal((await post({ action: 'read', ids: ['a/a', 'c/c'] })).status, 200)
  assert.equal((await post({ action: 'unread', ids: ['c/c'] })).status, 200)
  assert.equal((await post({ action: 'seen', at: at('2026-10-16', '06:02') })).status, 200)
  off()
  const r = await get()
  assert.deepEqual([r.body.read, r.body.seen], [['a/a'], at('2026-10-16', '06:02')])
  assert.deepEqual(heard, ['github', 'github', 'github'])
  // News' read list doesn't get them
  const n = await newsGET(new Request('http://home.test/api/private/settings/news', { headers: OWNER }))
  assert.deepEqual((await n.json()).read, [])
  // bad bodies
  assert.equal((await post({ action: 'read', ids: ['../x'] })).status, 400)
  assert.equal((await post({ action: 'refresh' })).status, 400)
})
