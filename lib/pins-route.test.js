// The owner's pins route (app/api/private/settings/pins): who gets in, adding (a preview, or none and why), the same
// link twice, removing with its Undo (server clock), refresh, the cap, the live stream. No database, no network: the
// store is lib/pins-store.js memoryStore() (globalThis.__homePinsStore), the fetcher a stand-in
// (globalThis.__homePinsFetch); the clock is node:test's mock.timers.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DELETE, GET, POST } from '../app/api/private/settings/pins/route.js'
import { GET as EVENTS } from '../app/api/private/settings/events/route.js'
import { memoryStore } from './pins-store.js'
import { liveBus } from './live.js'
import { MAX_LINKS, MAX_PINS, UNDO_MS } from './pins.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
const T0 = Date.UTC(2026, 9, 14, 3, 0)
let fetched // the links the stand-in fetcher was asked for
// the stand-in: a preview for most links; "slow" / "lan" ones fail like the real one would
const stand = async (url) => {
  fetched.push(url)
  if (url.includes('10.10.0.217')) return { ok: false, reason: 'blocked' }
  if (url.includes('slow')) return { ok: false, reason: 'timeout' }
  if (url.includes('throws')) throw new Error('boom')
  if (url.includes('junk')) return { ok: true, title: `  ${'T'.repeat(500)} `, description: 5, image: 'javascript:alert(1)', icon: 'https://ok.example/i.png', site: '<b>S</b>', extra: 'dropped' }
  const host = new URL(url).hostname
  return { ok: true, url, title: `Title of ${host}`, description: `About ${host}`, image: `https://${host}/og.png`, icon: `https://${host}/favicon.ico`, site: host.split('.')[0] }
}
test.beforeEach(() => {
  env(true)
  globalThis.__homePinsStore = memoryStore()
  globalThis.__homePinsFetch = stand
  fetched = []
  mock.timers.enable({ apis: ['Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())
test.after(() => {
  env(false)
  delete globalThis.__homePinsStore
  delete globalThis.__homePinsFetch
})

const call = async (fn, method, body, headers = OWNER) => {
  const init = { method, headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) } }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const r = await fn(new Request('http://home.test/api/private/settings/pins', init))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}
const get = (headers) => call(GET, 'GET', undefined, headers)
const add = (url, headers) => call(POST, 'POST', { url }, headers)
const post = (body, headers) => call(POST, 'POST', body, headers)
const del = (id, headers) => call(DELETE, 'DELETE', { id }, headers)
const later = (ms) => mock.timers.setTime(Date.now() + ms)

test('guests: nothing (404 / 403), so the page shows no card; nothing fetched for them', async () => {
  assert.equal((await get({})).status, 404)
  assert.equal((await get({ ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await get({ ...OWNER, 'x-home-sync': 'x'.repeat(32) })).status, 404)
  assert.equal((await add('https://github.com', { 'remote-user': 'owner' })).status, 404)
  assert.equal((await add('https://github.com', { ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await del('abcdef123456', { ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.deepEqual(fetched, [])
  delete process.env.DATABASE_URL
  assert.equal((await get()).status, 404)
})

test('GET: none yet; no-store', async () => {
  const r = await get()
  assert.deepEqual([r.status, r.cache, r.body], [200, 'no-store, private', { pins: [], links: [], max: MAX_PINS, maxLinks: MAX_LINKS }])
})

test('add: the preview fetched and kept, newest first; the link cleaned', async () => {
  const a = await add('github.com/vercel?utm_source=x')
  assert.equal(a.status, 200)
  assert.deepEqual(fetched, ['https://github.com/vercel'])
  assert.deepEqual(a.body.pins, [{
    id: a.body.pin, url: 'https://github.com/vercel', domain: 'github.com', title: 'Title of github.com', description: 'About github.com',
    image: 'https://github.com/og.png', icon: 'https://github.com/favicon.ico', site: 'github', ok: true, reason: null, addedAt: T0,
  }])
  assert.deepEqual([a.body.dup, a.body.ok, a.body.reason], [false, true, null])
  later(1000)
  await add('https://www.youtube.com/watch?v=jfKfPfyJRdk')
  const r = await get()
  assert.deepEqual(r.body.pins.map((p) => p.domain), ['youtube.com', 'github.com'])
})

test('add: whatever the fetcher says is cut to size and to http(s) links', async () => {
  const r = await add('https://junk.example/')
  const p = r.body.pins[0]
  assert.equal(p.title.length, 200)
  assert.deepEqual([p.description, p.image, p.icon, p.site, p.extra], [null, null, 'https://ok.example/i.png', 'S', undefined])
  // a fetcher's pictures into the LAN, and any kept before: never handed to the card
  globalThis.__homePinsFetch = async () => ({ ok: true, title: 'LAN pics', image: 'http://10.0.0.1/cgi-bin/reboot', icon: 'http://192.168.1.1:8080/i.png' })
  const lan = await add('https://lanpics.example/')
  const lp = lan.body.pins.find((x) => x.id === lan.body.pin)
  assert.deepEqual([lp.title, lp.image, lp.icon], ['LAN pics', null, null])
  await globalThis.__homePinsStore.put('owner', { id: 'oldrow000001', url: 'https://old.example/', data: { ok: true, image: 'http://127.0.0.1/x.png', icon: 'https://ok.example/i.png' }, at: T0 + 1 })
  const old = (await get()).body.pins.find((x) => x.id === 'oldrow000001')
  assert.deepEqual([old.image, old.icon], [null, 'https://ok.example/i.png'])
  globalThis.__homePinsFetch = stand
  // a fetcher that throws: kept, without a preview
  const t = await add('https://throws.example/')
  assert.deepEqual([t.status, t.body.ok, t.body.reason], [200, false, 'unreachable'])
})

test('add: no preview (a LAN link, too slow): kept all the same, with why', async () => {
  const lan = await add('http://10.10.0.217:5001/')
  assert.equal(lan.status, 200)
  assert.deepEqual([lan.body.ok, lan.body.reason], [false, 'blocked'])
  assert.deepEqual(lan.body.pins[0], { id: lan.body.pin, url: 'http://10.10.0.217:5001/', domain: '10.10.0.217', title: null, description: null, image: null, icon: null, site: null, ok: false, reason: 'blocked', addedAt: T0 })
  const slow = await add('https://slow.example/')
  assert.deepEqual([slow.body.ok, slow.body.reason, slow.body.pins.length], [false, 'timeout', 2])
})

test('add: a bad link is the box\'s 400, with its field; writes only same-origin JSON', async () => {
  for (const url of ['javascript:alert(1)', 'not a link', 'https://user:pw@example.com/', 'file:///etc/passwd', '', `https://x.example/${'a'.repeat(2100)}`]) {
    const r = await add(url)
    assert.deepEqual([r.status, r.body.field], [400, 'url'], url)
  }
  assert.equal((await post({ action: 'nope' })).body.field, 'action')
  assert.equal((await post('{nope')).status, 400)
  assert.equal((await post('x'.repeat(9000))).status, 413)
  const cross = await POST(new Request('http://home.test/x', { method: 'POST', headers: { ...OWNER, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{"url":"https://github.com"}' }))
  assert.equal(cross.status, 403)
  // ("forbidden", not "no pins": the card tells the two apart, and only the second means "not the owner")
  assert.equal((await cross.json()).error, 'forbidden')
  assert.equal((await get({ ...OWNER, 'remote-user': 'someone' })).body.error, 'no pins')
  const form = await POST(new Request('http://home.test/x', { method: 'POST', headers: { ...OWNER, 'content-type': 'application/x-www-form-urlencoded' }, body: 'url=https://github.com' }))
  assert.equal(form.status, 403)
  assert.deepEqual(fetched, [])
})

test('the same link again: moved to the top, not twice, not fetched again', async () => {
  const gh = await add('https://github.com/')
  later(1000)
  await add('https://example.org/')
  later(1000)
  const again = await add('https://github.com/?utm_campaign=x')
  assert.deepEqual([again.status, again.body.dup, again.body.pin], [200, true, gh.body.pin])
  assert.deepEqual(again.body.pins.map((p) => p.domain), ['github.com', 'example.org'])
  assert.deepEqual(fetched, ['https://github.com/', 'https://example.org/'])
})

test('remove, then Undo within the window (server clock): back where it was', async () => {
  const a = await add('https://a.example/')
  later(1000)
  const b = await add('https://b.example/')
  later(1000)
  await add('https://c.example/')
  const r = await del(b.body.pin)
  assert.equal(r.status, 200)
  assert.deepEqual([r.body.removed, r.body.until], [b.body.pin, Date.now() + UNDO_MS])
  assert.deepEqual(r.body.pins.map((p) => p.domain), ['c.example', 'a.example'])
  later(UNDO_MS - 500)
  const u = await post({ action: 'undo', id: b.body.pin })
  assert.equal(u.status, 200)
  assert.deepEqual(u.body.pins.map((p) => p.domain), ['c.example', 'b.example', 'a.example'])
  // gone for good after the window; a second removal of the same, or an unknown one: 409
  await del(a.body.pin)
  later(UNDO_MS + 6000)
  const late = await post({ action: 'undo', id: a.body.pin })
  assert.equal(late.status, 409)
  assert.deepEqual(late.body.pins.map((p) => p.domain), ['c.example', 'b.example'])
  assert.equal((await del(a.body.pin)).status, 409)
  assert.equal((await del('ffffffffffff')).status, 409)
  assert.equal((await del('NOPE')).status, 400)
  assert.equal((await post({ action: 'undo', id: 'ffffffffffff' })).status, 409)
  // pasting a removed link brings it back, fetched afresh
  fetched = []
  const back = await add('https://a.example/')
  assert.deepEqual([back.body.dup, back.body.pin, back.body.pins[0].domain, fetched], [false, a.body.pin, 'a.example', ['https://a.example/']])
})

test('DELETE: same-origin JSON only', async () => {
  const a = await add('https://a.example/')
  const r = await DELETE(new Request('http://home.test/x', { method: 'DELETE', headers: { ...OWNER, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ id: a.body.pin }) }))
  assert.equal(r.status, 403)
  assert.equal((await get()).body.pins.length, 1)
})

test('refresh: the preview fetched again (a link that had none may get one)', async () => {
  const s = await add('https://slow.example/')
  assert.equal(s.body.ok, false)
  globalThis.__homePinsFetch = async (url) => (fetched.push(url), { ok: true, title: 'Fast now', image: 'https://slow.example/x.png' })
  const r = await post({ action: 'refresh', id: s.body.pin })
  assert.equal(r.status, 200)
  assert.deepEqual([r.body.ok, r.body.pins[0].title, r.body.pins[0].ok, r.body.pins[0].reason], [true, 'Fast now', true, null])
  await del(s.body.pin)
  assert.equal((await post({ action: 'refresh', id: s.body.pin })).status, 409)
})

test(`the cap: ${MAX_PINS} pins; the next one is a 409 (an old link still moves up)`, async () => {
  const store = globalThis.__homePinsStore
  for (let i = 0; i < MAX_PINS; i++) await store.put('owner', { id: `pin${String(i).padStart(9, '0')}`, url: `https://x${i}.example/`, data: { ok: true }, at: T0 - 1000 + i })
  fetched = []
  const r = await add('https://one-more.example/')
  assert.equal(r.status, 409)
  assert.match(r.body.error, /500 pins at most/)
  assert.equal(r.body.pins.length, MAX_PINS)
  assert.deepEqual(fetched, [])
  const up = await add('https://x0.example/')
  assert.deepEqual([up.status, up.body.dup, up.body.pins[0].url], [200, true, 'https://x0.example/'])
  // a removed link coming back would make 501: refused before any fetch, like a new one
  await store.put('owner', { id: 'gonepin00001', url: 'https://gone.example/', data: { ok: true }, at: T0 - 5000 })
  await store.remove('owner', 'pin000000499', T0)
  await store.remove('owner', 'gonepin00001', T0)
  await store.put('owner', { id: 'fillpin00001', url: 'https://fill.example/', data: { ok: true }, at: T0 })
  fetched = []
  assert.equal((await add('https://gone.example/')).status, 409)
  assert.deepEqual(fetched, [])
})

test('too many previews at once: 429, the rest wait their turn', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  globalThis.__homePinsFetch = async (url) => (await gate, { ok: true, title: url })
  const first = [1, 2, 3].map((i) => add(`https://p${i}.example/`))
  await new Promise((r) => setImmediate(r))
  const fourth = await add('https://p4.example/')
  assert.equal(fourth.status, 429)
  release()
  assert.deepEqual((await Promise.all(first)).map((r) => r.status), [200, 200, 200])
  assert.equal((await add('https://p4.example/')).status, 200)
})

test('the owner\'s other tabs hear "pins" (not the tab that did it), for every change', async () => {
  const heard = []
  const off1 = liveBus().subscribe('owner', 'tab-aaaaaaaa', (e) => heard.push(['a', e.kind]))
  const off2 = liveBus().subscribe('owner', 'tab-bbbbbbbb', (e) => heard.push(['b', e.kind]))
  const from = { ...OWNER, 'x-home-client': 'tab-aaaaaaaa' }
  const a = await add('https://a.example/', from)
  await add('https://a.example/', from) // (moved up)
  await post({ action: 'refresh', id: a.body.pin }, from)
  await del(a.body.pin, from)
  await post({ action: 'undo', id: a.body.pin }, from)
  await add('not a link', from) // (nothing changed: nothing said)
  off1()
  off2()
  assert.deepEqual(heard, Array(5).fill(['b', 'pins']))
})

test('the live stream passes "pins" on as its own event (the page pulls the pins, not the settings)', async () => {
  const stop = new AbortController()
  const r = await EVENTS(new Request('http://home.test/api/private/settings/events?id=phone-tab-01', { headers: OWNER, signal: stop.signal }))
  const reader = r.body.getReader()
  const text = new TextDecoder()
  const frame = async () => {
    let t = ''
    while (!t.endsWith('\n\n')) t += text.decode((await reader.read()).value)
    return t
  }
  assert.match(await frame(), /^event: hello/)
  await add('https://a.example/', { ...OWNER, 'x-home-client': 'pc-tab-0001' })
  assert.match(await frame(), new RegExp(`^event: pins\ndata: \\{"at":${T0},"from":"pc-tab-0001"\\}`))
  stop.abort()
})

test('links: a pin onto habits and reminders, several on one, one on several; unlink; a removed pin drops off (its Undo brings it back)', async () => {
  const habit = { kind: 'habit', id: 'h1abcdef' }, todo = { kind: 'todo', id: 'abcdef123456' }
  const a = (await add('https://a.example/')).body.pin
  later(1000)
  const b = (await add('https://b.example/')).body.pin
  later(1000)
  assert.equal((await post({ action: 'link', id: b, to: habit })).status, 200)
  later(1000)
  await post({ action: 'link', id: a, to: habit })
  await post({ action: 'link', id: a, to: habit }) // (twice: still once, at its first time)
  const r = await post({ action: 'link', id: a, to: todo })
  const pick = (body) => body.links.map((l) => [l.pin, l.kind, l.id])
  assert.deepEqual(pick(r.body), [[b, 'habit', habit.id], [a, 'habit', habit.id], [a, 'todo', todo.id]])
  assert.equal(r.body.links[0].at, T0 + 2000)
  // off one; the pin stays, and on the other
  const u = await post({ action: 'unlink', id: a, to: habit })
  assert.deepEqual(pick(u.body), [[b, 'habit', habit.id], [a, 'todo', todo.id]])
  assert.equal(u.body.pins.length, 2)
  assert.equal((await post({ action: 'unlink', id: a, to: habit })).status, 200) // (not linked: fine)
  // removed: off everything; the Undo: back on
  await del(a)
  assert.deepEqual(pick((await get()).body), [[b, 'habit', habit.id]])
  await post({ action: 'undo', id: a })
  assert.deepEqual(pick((await get()).body), [[b, 'habit', habit.id], [a, 'todo', todo.id]])
  // removed, then pasted again (not its Undo): back as a new pin, linked to nothing
  await del(b)
  later(UNDO_MS + 6000)
  const again = await add('https://b.example/')
  assert.equal(again.body.pin, b)
  assert.deepEqual(pick(again.body), [[a, 'todo', todo.id]])
  // a pin that isn't there, a bad target
  assert.equal((await post({ action: 'link', id: 'zzzzzz999999', to: habit })).status, 409)
  for (const to of [undefined, null, { kind: 'song', id: 'abcdef12' }, { kind: 'habit', id: 'NO!' }, 'habit']) assert.equal((await post({ action: 'link', id: a, to })).body.field, 'to')
})

test('links: an add can link at once (a new link, or one kept already); at most MAX_LINKS on one', async () => {
  const todo = { kind: 'todo', id: 'abcdef123456' }
  const n = await post({ url: 'https://new.example/', to: todo })
  assert.deepEqual(n.body.links.map((l) => [l.pin, l.id]), [[n.body.pin, todo.id]])
  later(10)
  const d = await post({ url: 'https://new.example/', to: { kind: 'habit', id: 'h1abcdef' } })
  assert.equal(d.body.dup, true)
  assert.equal(d.body.links.length, 2)
  for (let i = 1; i < MAX_LINKS; i++) (later(10), assert.equal((await post({ url: `https://p${i}.example/`, to: todo })).body.linkError, undefined))
  // full: the pin is kept, not linked, and says why
  const over = await post({ url: 'https://over.example/', to: todo })
  assert.equal(over.status, 200)
  assert.match(over.body.linkError, /at most/)
  assert.equal(over.body.links.filter((l) => l.id === todo.id).length, MAX_LINKS)
  assert.equal((await post({ action: 'link', id: over.body.pin, to: todo })).status, 409)
  // one removed frees its place
  await del(n.body.pin)
  assert.equal((await post({ action: 'link', id: over.body.pin, to: todo })).status, 200)
})
