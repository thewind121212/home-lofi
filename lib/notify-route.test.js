// The notification hub's routes: the senders' POST /api/notify (token, limits, what's stored) and the owner's
// /api/private/settings/notifications (who gets in, read / dismiss / clear), and that both tell the owner's open tabs
// over the live stream. No database: the store is lib/notify-store.js memoryStore() (globalThis.__homeNotifyStore).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { POST as send } from '../app/api/notify/route.js'
import { GET as list, POST as act } from '../app/api/private/settings/notifications/route.js'
import { GET as events } from '../app/api/private/settings/events/route.js'
import { memoryStore } from './notify-store.js'
import { liveBus } from './live.js'
import { memoryStore as pushMemory } from './push-store.js'

const TOKEN = 'notify-token-for-tests-0123456789'
const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const env = (on) => {
  const vars = { NOTIFY_TOKEN: TOKEN, GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
test.beforeEach(() => {
  env(true)
  globalThis.__homeNotifyStore = memoryStore()
  globalThis.__homePushStore = pushMemory() // (no devices: the push side does nothing)
})
test.after(() => {
  env(false)
  delete globalThis.__homeNotifyStore
})

let ip = 0 // a new client address per call, so the per-IP limit only bites where a test wants it
const post = async (body, { token = TOKEN, type = 'application/json', from } = {}) => {
  const headers = { 'content-type': type, 'x-forwarded-for': from ?? `10.0.0.${(ip++ % 250) + 1}` }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await send(new Request('http://home.test/api/notify', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }))
  return { status: r.status, headers: r.headers, body: await r.json() }
}
const owner = async (method = 'GET', body, headers = OWNER) => {
  const init = { method, headers: { ...headers, ...(body && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) }, body: body && JSON.stringify(body) }
  const r = await (method === 'GET' ? list : act)(new Request('http://home.test/api/private/settings/notifications', init))
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() }
}

test('send: off (404) until the token, the database and the owner are all set', async () => {
  for (const k of ['NOTIFY_TOKEN', 'DATABASE_URL', 'OWNER_USER']) {
    env(true)
    delete process.env[k]
    assert.equal((await post({ title: 'x' })).status, 404, k)
  }
  env(true)
  process.env.NOTIFY_TOKEN = 'short' // under 16 characters: never accepted (lib/gate.js secretOk)
  assert.equal((await post({ title: 'x' }, { token: 'short' })).status, 401)
})

test('send: the token, then JSON, then the fields', async () => {
  assert.equal((await post({ title: 'x' }, { token: null })).status, 401)
  const bad = await post({ title: 'x' }, { token: TOKEN.replace('0', '1') })
  assert.equal(bad.status, 401)
  assert.equal(bad.headers.get('www-authenticate'), 'Bearer')
  assert.equal((await post('title=x', { type: 'application/x-www-form-urlencoded' })).status, 415)
  assert.equal((await post('{nope')).status, 400)
  assert.equal((await post({ title: 'x'.repeat(5000) })).status, 413)
  assert.deepEqual((await post({ title: 'x', level: 'loud' })).body, { error: 'level: one of info, success, warning, error', field: 'level' })
  assert.equal(globalThis.__homeNotifyStore.size, 0)
})

test('send: 201 with the id; warnings for what the page can’t show; the owner sees it', async () => {
  const a = await post({ title: 'Backup done', level: 'success', source: 'backup', icon: 'fa:database' })
  assert.equal(a.status, 201)
  assert.equal(a.body.id, 1)
  assert.ok(Number.isFinite(a.body.at))
  assert.equal(a.body.warnings, undefined)
  const b = await post({ title: 'Odd', icon: '🔔', color: '#f00' })
  assert.equal(b.status, 201)
  assert.equal(b.body.warnings.length, 2)
  const r = await owner()
  assert.equal(r.status, 200)
  assert.equal(r.cache, 'no-store, private')
  assert.equal(r.body.read, 0)
  assert.deepEqual(
    r.body.items.map(({ at, ...i }) => i),
    [
      { id: 2, exp: null, title: 'Odd', level: 'info' },
      { id: 1, exp: null, title: 'Backup done', level: 'success', source: 'backup', icon: { fa: 'fa-solid fa-database' } },
    ],
  )
})

test('send: a tag replaces the older one (a new id: new again everywhere); ttl sets exp', async () => {
  await post({ title: 'Deploy started', tag: 'deploy-home' })
  await post({ title: 'Other' })
  await post({ title: 'Deploy done ✓', tag: 'deploy-home', level: 'success', ttl: 600 })
  const { items } = (await owner()).body
  assert.deepEqual(items.map((i) => [i.id, i.title]), [[3, 'Deploy done ✓'], [2, 'Other']])
  assert.ok(Math.abs(items[0].exp - items[0].at - 600_000) < 50)
})

test('send: 60 a minute per address', async () => {
  for (let n = 0; n < 60; n++) assert.equal((await post({ title: `n${n}` }, { from: '10.9.9.9' })).status, 201)
  const r = await post({ title: 'one too many' }, { from: '10.9.9.9' })
  assert.equal(r.status, 429)
  assert.equal(r.headers.get('retry-after'), '60')
  assert.equal((await post({ title: 'someone else' }, { from: '10.9.9.8' })).status, 201)
})

test('owner route: the same gate as settings sync (404 / 403), never for guests', async () => {
  await post({ title: 'secret' })
  for (const [headers, status] of [
    [{}, 404],
    [{ 'remote-user': 'owner' }, 404],
    [{ ...OWNER, 'x-home-sync': 'wrong-wrong-wrong-wrong' }, 404],
    [{ ...OWNER, 'remote-user': 'eve' }, 403],
  ]) {
    const r = await owner('GET', undefined, headers)
    assert.equal(r.status, status, JSON.stringify(headers))
    assert.equal(r.body.items, undefined)
    assert.equal((await owner('POST', { action: 'clear', upTo: 99 }, headers)).status, status)
  }
  assert.equal(globalThis.__homeNotifyStore.size, 1)
  // the hub off (no token): the owner gets 404 too, so the page shows no bell
  delete process.env.NOTIFY_TOKEN
  assert.equal((await owner()).status, 404)
})

test('owner route: read (never backwards), dismiss, clear up to an id; bad requests', async () => {
  for (const t of ['a', 'b', 'c', 'd']) await post({ title: t })
  assert.equal((await owner('POST', { action: 'read', upTo: 3 })).body.read, 3)
  assert.equal((await owner('POST', { action: 'read', upTo: 2 })).body.read, 3) // another device, behind: stays
  assert.deepEqual((await owner('POST', { action: 'dismiss', id: 2 })).body.items.map((i) => i.id), [4, 3, 1])
  assert.deepEqual((await owner('POST', { action: 'clear', upTo: 3 })).body.items.map((i) => i.id), [4]) // 4 came later: stays
  for (const body of [{ action: 'read' }, { action: 'read', upTo: -1 }, { action: 'read', upTo: '3' }, { action: 'nuke', upTo: 3 }, { action: 'dismiss', upTo: 3 }])
    assert.equal((await owner('POST', body)).status, 400, JSON.stringify(body))
  // writes only from the page itself (same-origin JSON)
  const r = await act(new Request('http://home.test/api/private/settings/notifications', { method: 'POST', headers: { ...OWNER, 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' }, body: '{"action":"clear","upTo":9}' }))
  assert.equal(r.status, 403)
})

// read until the next blank line (one SSE frame)
const decoder = new TextDecoder()
async function frame(reader) {
  let text = ''
  while (!text.endsWith('\n\n')) {
    const { value, done } = await reader.read()
    if (done) return null
    text += decoder.decode(value)
  }
  return { event: /^event: (.+)$/m.exec(text)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(text)?.[1] ?? 'null') }
}

test('the live stream: a sent notice and a read both say "notify" (no content), settings saves still say "changed"', async () => {
  const stop = new AbortController()
  const r = await events(new Request('http://home.test/api/private/settings/events?id=phone-tab-01', { headers: OWNER, signal: stop.signal }))
  const reader = r.body.getReader()
  assert.equal((await frame(reader)).event, 'hello')

  await post({ title: 'Disk almost full', body: 'never on the stream', level: 'warning' })
  const n = await frame(reader)
  assert.equal(n.event, 'notify')
  assert.deepEqual(Object.keys(n.data), ['at'])

  await owner('POST', { action: 'read', upTo: 1 })
  assert.equal((await frame(reader)).event, 'notify')

  liveBus().publish('owner', { at: 9, from: 'pc-tab-0001' })
  assert.deepEqual(await frame(reader), { event: 'changed', data: { at: 9, from: 'pc-tab-0001' } })
  stop.abort()
})
