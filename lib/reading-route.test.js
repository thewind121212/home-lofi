// The owner's Reading routes (app/api/private/settings/reading + /cover) with Kavita stood in
// (globalThis.__homeKavitaFetch): who gets in, off without the env, the list (several books, continue links, the
// 2-minute keep), the token bought once and again on a 401, Kavita down, and covers only for books on the list. The
// key must never show up in an answer.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../app/api/private/settings/reading/route.js'
import { GET as COVER } from '../app/api/private/settings/reading/cover/route.js'
import { resetKavita } from './kavita.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const KEY = 'kavita-key-for-tests-ffffffff'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', KAVITA_URL: 'http://kavita.test:5000/', KAVITA_API_KEY: KEY, KAVITA_PUBLIC_URL: 'https://kavita.example/', KAVITA_TZ: '' }
const env = (on) => {
  for (const [k, v] of Object.entries(VARS)) on ? (process.env[k] = v) : delete process.env[k]
}
const T0 = Date.UTC(2026, 9, 15, 7, 0)
const DECK = [
  { id: 6, name: 'Dungeon Crawler Carl', libraryId: 2, pages: 650, pagesRead: 9, latestReadDate: '2026-10-15T12:47:08.1465046', format: 3, coverImage: 'v8_c8.png' },
  { id: 23, name: 'Berserk', libraryId: 4, pages: 220, pagesRead: 55, latestReadDate: '2026-10-12T22:00:00', format: 1, coverImage: 's23.png' },
  { id: 31, name: 'A Manual', libraryId: 5, pages: 90, pagesRead: 30, latestReadDate: '2026-10-14T09:00:00', format: 4 },
  { id: 40, name: 'Put down', libraryId: 2, pages: 300, pagesRead: 20, latestReadDate: '2026-07-01T09:00:00', format: 3 },
]
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
let calls, kavita
// the stand-in Kavita: kavita.down, kavita.expire (the next API call says 401), kavita.cover (a Response factory)
const stand = async (url, init = {}) => {
  const u = new URL(url)
  calls.push(`${init.method ?? 'GET'} ${u.pathname}`)
  if (kavita.down) throw new TypeError('fetch failed')
  if (u.pathname === '/api/Plugin/authenticate') {
    assert.equal(u.searchParams.get('apiKey'), KEY)
    return Response.json({ token: `jwt-${++kavita.tokens}`, username: 'linh' })
  }
  const auth = init.headers?.authorization
  if (auth !== `Bearer jwt-${kavita.tokens}` || kavita.expire) {
    kavita.expire = false
    return new Response('', { status: 401 })
  }
  if (u.pathname === '/api/Series/on-deck') {
    assert.equal(init.method, 'POST')
    assert.equal(init.body, '{}')
    return Response.json(kavita.deck)
  }
  if (u.pathname === '/api/reader/continue-point') {
    const id = Number(u.searchParams.get('seriesId'))
    if (id === 31) return new Response('', { status: 500 }) // (that one: no continue point -> its series page)
    return Response.json({ id: id * 10 + 1, pages: 64, pagesRead: 9, volumeId: 8 })
  }
  if (u.pathname === '/api/image/series-cover') return kavita.cover(Number(u.searchParams.get('seriesId')))
  return new Response('', { status: 404 })
}
test.beforeEach(() => {
  env(true)
  resetKavita()
  calls = []
  kavita = { tokens: 0, deck: DECK, cover: () => new Response(PNG, { headers: { 'content-type': 'image/png' } }) }
  globalThis.__homeKavitaFetch = stand
  mock.timers.enable({ apis: ['Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())
test.after(() => {
  env(false)
  resetKavita()
  delete globalThis.__homeKavitaFetch
})

const get = async (headers = OWNER) => {
  const r = await GET(new Request('http://home.test/api/private/settings/reading', { headers }))
  const text = await r.text()
  assert.ok(!text.includes(KEY) && !text.includes('jwt-') && !text.includes('kavita.test'), 'no key, token or inner address in the answer')
  return { status: r.status, cache: r.headers.get('cache-control'), body: JSON.parse(text) }
}
const cover = (q, headers = OWNER) => COVER(new Request(`http://home.test/api/private/settings/reading/cover?${q}`, { headers }))
const later = (ms) => mock.timers.setTime(Date.now() + ms)

test('guests: nothing (404 / 403), and Kavita is never asked for them', async () => {
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await get({ ...OWNER, 'x-home-sync': 'x'.repeat(32) })).status, 404)
  assert.equal((await cover('id=6', {})).status, 404)
  assert.equal((await cover('id=6', { ...OWNER, 'remote-user': 'someone' })).status, 403)
  delete process.env.DATABASE_URL
  assert.equal((await get()).status, 404)
  assert.deepEqual(calls, [])
})

test('off without KAVITA_URL or KAVITA_API_KEY: { on: false }, no bar', async () => {
  for (const k of ['KAVITA_URL', 'KAVITA_API_KEY']) {
    env(true)
    process.env[k] = '  '
    const r = await get()
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { on: false })
    assert.equal((await cover('id=6')).status, 404)
  }
  assert.deepEqual(calls, [])
})

test('the books in progress, most recent first, with continue links; put-down ones left out', async () => {
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.equal(r.body.on, true)
  assert.equal(r.body.kavita, 'https://kavita.example')
  assert.deepEqual(r.body.books.map((b) => b.name), ['Dungeon Crawler Carl', 'A Manual', 'Berserk'])
  assert.deepEqual(r.body.books[0], {
    id: 6, name: 'Dungeon Crawler Carl', pages: 650, pagesRead: 9, percent: 1, readAt: Date.UTC(2026, 9, 15, 5, 47, 8, 147),
    href: 'https://kavita.example/library/2/series/6/book/61', seriesHref: 'https://kavita.example/library/2/series/6',
    cover: '/api/private/settings/reading/cover?id=6&v=v8_c8.png',
  })
  // a PDF without a continue point: its series page; an archive: the page reader
  assert.equal(r.body.books[1].href, 'https://kavita.example/library/5/series/31')
  assert.equal(r.body.books[1].cover, '/api/private/settings/reading/cover?id=31')
  assert.equal(r.body.books[2].href, 'https://kavita.example/library/4/series/23/manga/231')
  // one token, one on-deck, one continue point per book in progress (not the put-down one)
  assert.equal(calls.filter((c) => c.endsWith('/authenticate')).length, 1)
  assert.equal(calls.filter((c) => c.endsWith('/continue-point')).length, 3)
})

test('kept 2 minutes for everyone; the token kept too, bought again once on a 401', async () => {
  await get()
  const n = calls.length
  await get()
  later(60_000)
  await get()
  assert.equal(calls.length, n, 'within 2 minutes: Kavita not asked again')
  later(61_000)
  kavita.deck = DECK.slice(1)
  assert.deepEqual((await get()).body.books.map((b) => b.id), [31, 23])
  assert.equal(calls.filter((c) => c.endsWith('/authenticate')).length, 1)
  // the token expires early: a fresh one, and the call goes through
  later(121_000)
  kavita.expire = true
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(calls.filter((c) => c.endsWith('/authenticate')).length, 2)
})

test('a 401 on several calls at once buys one token, not one each', async () => {
  await get()
  const many = [...DECK.slice(0, 3), { id: 50, name: 'Five', libraryId: 2, pages: 10, pagesRead: 2, latestReadDate: '2026-10-15T10:00:00', format: 0 }]
  kavita.deck = many
  later(121_000)
  // the token stops working (Kavita restarted): on-deck and every continue point see a 401 at once
  kavita.tokens++
  const r = await get()
  assert.equal(r.status, 200)
  assert.equal(r.body.books.length, 4)
  assert.equal(calls.filter((c) => c.endsWith('/authenticate')).length, 2)
  // concurrent covers with a stale token: one purchase between them
  kavita.tokens++
  const all = await Promise.all([cover('id=6'), cover('id=23'), cover('id=31'), cover('id=50')])
  assert.deepEqual(all.map((x) => x.status), [200, 200, 200, 200])
  assert.equal(calls.filter((c) => c.endsWith('/authenticate')).length, 3)
})

test('no public address: the books without links; nothing in progress: an empty list', async () => {
  delete process.env.KAVITA_PUBLIC_URL
  const r = await get()
  assert.equal(r.body.kavita, null)
  assert.equal(r.body.books[0].href, null)
  assert.equal(r.body.books[0].seriesHref, null)
  resetKavita()
  kavita.deck = []
  assert.deepEqual((await get()).body.books, [])
})

test('Kavita down or saying no: 502 { on, error }, and the next ask tries again', async () => {
  kavita.down = true
  const r = await get()
  assert.equal(r.status, 502)
  assert.deepEqual(r.body, { on: true, error: 'Kavita unreachable' })
  kavita.down = false
  // (for 15 s after, it fails at once without asking: the page's asks don't each wait on a Kavita that's down)
  const n = calls.length
  assert.equal((await get()).status, 502)
  assert.equal((await cover('id=6')).status, 502)
  assert.equal(calls.length, n)
  later(15_001)
  assert.equal((await get()).status, 200)
  // the key refused
  resetKavita()
  globalThis.__homeKavitaFetch = async (url) => (new URL(url).pathname.endsWith('/authenticate') ? new Response('', { status: 401 }) : stand(url))
  assert.equal((await get()).status, 502)
  globalThis.__homeKavitaFetch = stand
})

test('covers: only books on the list, a real id, a picture of sane size; cached privately', async () => {
  const r = await cover('id=6&v=v8_c8.png')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.equal(r.headers.get('cache-control'), 'private, max-age=86400')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), PNG)
  // (the list was asked for it, as none was kept yet)
  assert.ok(calls.includes('POST /api/Series/on-deck'))
  for (const bad of ['id=0', 'id=-6', 'id=6.5', 'id=abc', 'id=', '', 'id=99999999999', 'id=06']) assert.equal((await cover(bad)).status, 400, bad)
  // not on the reading list (the put-down one, any other id): no
  assert.equal((await cover('id=40')).status, 404)
  assert.equal((await cover('id=7')).status, 404)
  // not a picture (an SVG, HTML), too big, or none: 502
  kavita.cover = () => new Response('<svg onload="x()"/>', { headers: { 'content-type': 'image/svg+xml' } })
  assert.equal((await cover('id=6')).status, 502)
  kavita.cover = () => new Response('<html>', { headers: { 'content-type': 'text/html' } })
  assert.equal((await cover('id=6')).status, 502)
  kavita.cover = () => new Response(new Uint8Array(3 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } })
  assert.equal((await cover('id=6')).status, 502)
  kavita.cover = () => new Response(null, { status: 404 })
  assert.equal((await cover('id=6')).status, 502)
  kavita.down = true
  const down = await cover('id=23')
  assert.equal(down.status, 502)
  assert.ok(!(await down.text()).includes(KEY))
})
