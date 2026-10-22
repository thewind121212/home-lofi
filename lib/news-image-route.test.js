// A story's photo through the owner's News (app/api/private/settings/news/image) with the agent stood in
// (globalThis.__homeNewsFetch): who gets it, the name checked before asking, only images passed through, the size cap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../app/api/private/settings/news/image/route.js'
import { resetNews } from './news-fetch.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', NEWS_URL: 'http://news.test:8090/' }
const env = (on) => {
  for (const [k, v] of Object.entries(VARS)) on ? (process.env[k] = v) : delete process.env[k]
}
const WEBP = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 fake', 'binary')
let calls, files
test.beforeEach(() => {
  env(true)
  resetNews()
  calls = []
  files = { '/images/8ae9d92c16.webp': new Response(WEBP, { headers: { 'content-type': 'image/webp' } }) }
  globalThis.__homeNewsFetch = async (url) => {
    const u = new URL(url)
    calls.push(u.pathname)
    return files[u.pathname] ?? new Response('', { status: 404 })
  }
})
test.after(() => {
  env(false)
  delete globalThis.__homeNewsFetch
})
const get = async (f, headers = OWNER) => {
  const r = await GET(new Request(`http://home.test/api/private/settings/news/image?f=${encodeURIComponent(f)}`, { headers }))
  return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), csp: r.headers.get('content-security-policy'), body: Buffer.from(await r.arrayBuffer()) }
}

test('the owner gets the photo, kept privately', async () => {
  const r = await get('8ae9d92c16.webp')
  assert.equal(r.status, 200)
  assert.equal(r.type, 'image/webp')
  assert.match(r.cache, /^private, max-age=\d+$/)
  assert.match(r.csp, /sandbox/)
  assert.deepEqual(r.body, WEBP)
  assert.deepEqual(calls, ['/images/8ae9d92c16.webp'])
})

test('guests and others: nothing, the agent not asked; no NEWS_URL: 404', async () => {
  assert.equal((await get('8ae9d92c16.webp', {})).status, 404)
  assert.equal((await get('8ae9d92c16.webp', { ...OWNER, 'remote-user': 'someone' })).status, 403)
  delete process.env.NEWS_URL
  assert.equal((await get('8ae9d92c16.webp')).status, 404)
  assert.deepEqual(calls, [])
})

test('a name that isn\'t one: 404 without asking', async () => {
  for (const f of ['../latest.json', 'a/b.webp', 'latest.json', 'x.svg', '', '.webp']) assert.equal((await get(f)).status, 404, f)
  assert.deepEqual(calls, [])
})

test('not there: 404; not an image, too large, or the agent down: 502', async () => {
  assert.equal((await get('nope.webp')).status, 404)
  files['/images/page.webp'] = new Response('<html>', { headers: { 'content-type': 'text/html' } })
  assert.equal((await get('page.webp')).status, 502)
  files['/images/big.webp'] = new Response(Buffer.alloc(4 * 1024 * 1024), { headers: { 'content-type': 'image/webp' } })
  assert.equal((await get('big.webp')).status, 502)
  files['/images/err.webp'] = new Response('', { status: 500 })
  assert.equal((await get('err.webp')).status, 502)
  globalThis.__homeNewsFetch = async () => {
    throw new TypeError('fetch failed')
  }
  assert.equal((await get('8ae9d92c16.webp')).status, 502)
})
