// Everyone's News, GitHub list and photos (app/api/news, app/api/github, app/api/news/image) with the agent stood in
// (globalThis.__homeNewsFetch): no login needed, the same days as the owner's, no read state, and never a run (Refresh
// stays the owner's: no POST, the agent's run endpoints never asked).
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as news from '../app/api/news/route.js'
import * as github from '../app/api/github/route.js'
import * as photo from '../app/api/news/image/route.js'
import { resetNews } from './news-fetch.js'

const T0 = Date.UTC(2026, 9, 16, 4, 0)
const it = (id) => ({ id, title_vi: `Tin ${id}`, title_original: `Tin ${id}`, summary_vi: 's', category: 'ai', importance: 3, source: 'S', url: `https://n.example/${id}`, published_at: null, points: null, comments: null, comments_url: null })
const digest = (at, ids) => ({ schema_version: '1.0', edition: 'morning', generated_at: at, overview_vi: 'o', sections: [{ key: 'tech', title: 'Công nghệ', items: ids.map(it) }], usage: { cost_usd: 0.2 } })
const repo = (id) => ({ id, rank: 1, list: 'trending', full_name: id, url: `https://github.com/${id}`, summary_vi: 's', category: 'web', worth_trying: 3 })
const list = (date, ids) => ({ schema_version: 'gh-1.0', kind: 'github', date, generated_at: `${date}T06:02:00+07:00`, overview_vi: 'o', repos: ids.map(repo), usage: { cost_usd: 0.45 } })
const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 fake', 'binary')
let calls, down
test.beforeEach(() => {
  process.env.NEWS_URL = 'http://news.test:8090/'
  resetNews()
  calls = []
  down = false
  globalThis.__homeNewsFetch = async (url, init) => {
    const u = new URL(url)
    calls.push(`${init?.method ?? 'GET'} ${u.pathname}`)
    if (down) throw new TypeError('fetch failed')
    if (u.pathname === '/latest.json') return Response.json(digest('2026-10-16T10:12:14+07:00', ['a', 'b']))
    if (u.pathname === '/archive/') return new Response('<a href="2026-10-15_1800.json">x</a><a href="2026-10-16_1012.json">y</a>', { headers: { 'content-type': 'text/html' } })
    if (u.pathname === '/archive/2026-10-15_1800.json') return Response.json(digest('2026-10-15T18:00:00+07:00', ['old']))
    if (u.pathname === '/github.json') return Response.json(list('2026-10-16', ['a/a', 'b/b']))
    if (u.pathname === '/github-archive/') return new Response('<a href="2026-10-16_0602.json">x</a>', { headers: { 'content-type': 'text/html' } })
    if (u.pathname === '/images/8ae9d92c16.webp') return new Response(WEBP, { headers: { 'content-type': 'image/webp' } })
    return new Response('', { status: 404 })
  }
  mock.timers.enable({ apis: ['Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())
test.after(() => {
  delete process.env.NEWS_URL
  delete globalThis.__homeNewsFetch
})
// (a guest from the internet: no gate, no login headers at all)
const get = async (route, path) => {
  const r = await route.GET(new Request(`http://home.test${path}`))
  const json = (r.headers.get('content-type') ?? '').includes('json')
  return { status: r.status, cache: r.headers.get('cache-control'), type: r.headers.get('content-type'), body: json ? await r.json() : Buffer.from(await r.arrayBuffer()) }
}

test('News for everyone: the newest day, the days, no read state, no run (no Refresh)', async () => {
  const r = await get(news, '/api/news')
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'public, max-age=30')
  assert.deepEqual(r.body.digest.sections[0].items.map((i) => i.id), ['a', 'b'])
  assert.deepEqual([r.body.day, r.body.picked, r.body.latestAt], ['2026-10-16', null, Date.parse('2026-10-16T03:12:14Z')])
  assert.deepEqual(r.body.days.map((d) => d.day), ['2026-10-16', '2026-10-15'])
  for (const k of ['read', 'seen', 'run', 'nextAt']) assert.equal(k in r.body, false, k)
  assert.equal('usage' in r.body.digest, false)
  assert.ok(!calls.some((c) => c.includes('/api/')), `the agent's run endpoints never asked: ${calls}`)
  const old = await get(news, '/api/news?day=2026-10-15')
  assert.deepEqual([old.status, old.body.day, old.body.digest.sections[0].items[0].id], [200, '2026-10-15', 'old'])
  assert.equal((await get(news, '/api/news?day=2026-09-01')).status, 404)
  assert.equal((await get(news, '/api/news?day=../x')).status, 404)
})

test('Refresh is the owner\'s: the public routes take no POST', () => {
  for (const route of [news, github, photo]) assert.deepEqual(Object.keys(route), ['GET'])
})

test('the GitHub list for everyone, no read state', async () => {
  const r = await get(github, '/api/github')
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'public, max-age=30')
  assert.deepEqual(r.body.digest.repos.map((x) => x.id), ['a/a', 'b/b'])
  assert.equal('read' in r.body || 'seen' in r.body, false)
})

test('photos for everyone, kept a week; only a photo\'s name asked for', async () => {
  const r = await get(photo, '/api/news/image?f=8ae9d92c16.webp')
  assert.deepEqual([r.status, r.type], [200, 'image/webp'])
  assert.match(r.cache, /^public, max-age=604800/)
  assert.deepEqual(r.body, WEBP)
  calls = []
  assert.equal((await get(photo, '/api/news/image?f=..%2Flatest.json')).status, 404)
  assert.equal((await get(photo, '/api/news/image?f=nope.webp')).status, 404)
  assert.deepEqual(calls, ['GET /images/nope.webp'], 'a bad name never reaches the agent')
})

test('off without NEWS_URL; the agent down: 502, never cached', async () => {
  delete process.env.NEWS_URL
  assert.deepEqual((await get(news, '/api/news')).body, { on: false })
  assert.deepEqual((await get(github, '/api/github')).body, { on: false })
  assert.equal((await get(photo, '/api/news/image?f=8ae9d92c16.webp')).status, 404)
  process.env.NEWS_URL = 'http://news.test:8090/'
  down = true
  const r = await get(news, '/api/news')
  assert.deepEqual([r.status, r.cache], [502, 'no-store'])
  assert.equal((await get(github, '/api/github')).status, 502)
})
