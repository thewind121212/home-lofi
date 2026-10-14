// Web Push (lib/push.js, lib/push-store.js, app/api/private/settings/push, and the hub's senders): which subscriptions
// are taken (only real push services: the server POSTs to them), what a push carries, who may manage devices, and a
// real encrypted send to a local stand-in push service, decrypted with the device's own key.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createECDH, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { MAX_FAILS, cleanName, cleanSubscription, optionsOf, payloadOf, pushNotice } from './push.js'
import { MAX_DEVICES, memoryStore } from './push-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { GET as pushGet, POST as pushPost } from '../app/api/private/settings/push/route.js'
import webpush from 'web-push'
import { POST as send } from '../app/api/notify/route.js'

const ece = createRequire(import.meta.url)('http_ece')
const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789', TOKEN = 'notify-token-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, NOTIFY_TOKEN: TOKEN, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
after(() => {
  env(false)
  delete process.env.PUSH_TEST_HOSTS
  delete globalThis.__homePushStore
  delete globalThis.__homeNotifyStore
  delete globalThis.__homePushSend
})

// a device: its own ECDH key pair and auth secret, as a browser makes them
function device(endpoint = `https://web.push.apple.com/QK${randomBytes(8).toString('hex')}`) {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  return { ecdh, auth, json: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }
}

test('cleanSubscription: only real push services over https, with well-formed keys', () => {
  const d = device()
  assert.deepEqual(cleanSubscription(d.json).sub, d.json)
  for (const ep of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.ok(cleanSubscription({ ...d.json, endpoint: ep }).sub, ep)
  const bad = (patch, field) => assert.equal(cleanSubscription({ ...d.json, ...patch }).field, field)
  bad({ endpoint: 'http://web.push.apple.com/x' }, 'endpoint') // not https
  bad({ endpoint: 'https://evil.example/x' }, 'endpoint')
  bad({ endpoint: 'https://push.apple.com.evil.example/x' }, 'endpoint') // a look-alike
  bad({ endpoint: 'https://user:pw@web.push.apple.com/x' }, 'endpoint')
  bad({ endpoint: 'https://10.10.0.217/x' }, 'endpoint') // the LAN: never
  bad({ endpoint: `https://web.push.apple.com/${'x'.repeat(1100)}` }, 'endpoint')
  bad({ endpoint: 'not a url' }, 'endpoint')
  bad({ keys: { ...d.json.keys, p256dh: 'AAAA' } }, 'keys.p256dh')
  bad({ keys: { ...d.json.keys, p256dh: d.json.keys.p256dh.replace(/.$/, '+') } }, 'keys.p256dh')
  bad({ keys: { ...d.json.keys, auth: randomBytes(15).toString('base64url') } }, 'keys.auth')
  assert.equal(cleanSubscription(null).field, 'subscription')
  assert.equal(cleanName('  iPhone\u0000 ·\n Home Screen  '), 'iPhone · Home Screen')
  assert.equal(cleanName(5), 'This device')
})

test('payloadOf / optionsOf: short, and as urgent as the notice', () => {
  const p = JSON.parse(payloadOf({ title: 'Workout in 5 min', body: 'x'.repeat(400), tag: 'habit:a', level: 'info' }))
  assert.equal(p.body.length, 300)
  assert.ok(p.body.endsWith('…'))
  assert.deepEqual([p.title, p.tag, p.url], ['Workout in 5 min', 'habit:a', '/'])
  assert.deepEqual(optionsOf({ ttl: 600, level: 'warning' }), { TTL: 600, urgency: 'high' })
  assert.deepEqual(optionsOf({ level: 'info' }), { TTL: 86400, urgency: 'normal' })
  assert.equal(optionsOf({ ttl: 10 }).TTL, 60)
  assert.equal(optionsOf({ ttl: 365 * 86400 }).TTL, 28 * 86400)
})

test('pushNotice: every device; gone ones (404 / 410) drop at once, failing ones after MAX_FAILS; silent: none', async () => {
  const store = memoryStore()
  const [a, b, c] = [device(), device(), device()]
  for (const d of [a, b, c]) await store.add('owner', d.json, 'x')
  const calls = []
  const fake = async (sub, body, opts) => {
    calls.push(sub.endpoint)
    if (sub.endpoint === b.json.endpoint) throw Object.assign(new Error('gone'), { statusCode: 410 })
    if (sub.endpoint === c.json.endpoint) throw Object.assign(new Error('busy'), { statusCode: 500 })
    assert.equal(JSON.parse(body).title, 'Hi')
    assert.equal(opts.vapidDetails.publicKey, (await store.keys()).publicKey)
  }
  assert.deepEqual(await pushNotice('owner', { title: 'Hi' }, { send: fake, store }), { sent: 1, dropped: 1, failed: 1 })
  assert.deepEqual((await store.list('owner')).map((s) => s.endpoint), [a.json.endpoint, c.json.endpoint])
  for (let i = 1; i < MAX_FAILS; i++) await pushNotice('owner', { title: 'Hi' }, { send: fake, store })
  assert.deepEqual((await store.list('owner')).map((s) => s.endpoint), [a.json.endpoint])
  calls.length = 0
  assert.deepEqual(await pushNotice('owner', { title: 'Hi', silent: true }, { send: fake, store }), { sent: 0, dropped: 0, failed: 0 })
  assert.equal(calls.length, 0)
  // a store that's down: nothing thrown
  const down = { list: async () => Promise.reject(new Error('db')) }
  assert.deepEqual(await pushNotice('owner', { title: 'Hi' }, { send: fake, store: down }), { sent: 0, dropped: 0, failed: 0 })
})

test('the store keeps MAX_DEVICES (the newest), and a device turned on again is updated, not doubled', async () => {
  const store = memoryStore()
  const ds = Array.from({ length: MAX_DEVICES + 2 }, () => device())
  for (const d of ds) await store.add('owner', d.json, 'x')
  const kept = (await store.list('owner')).map((s) => s.endpoint)
  assert.deepEqual(kept, ds.slice(2).map((d) => d.json.endpoint))
  const again = device(ds[5].json.endpoint)
  await store.add('owner', again.json, 'renamed')
  const l = await store.list('owner')
  assert.equal(l.length, MAX_DEVICES)
  assert.deepEqual(l.find((s) => s.endpoint === again.json.endpoint).keys, again.json.keys)
})

// ---- the routes ----
const call = async (fn, method, body, headers = OWNER) => {
  const init = { method, headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const r = await fn(new Request('http://home.test/api/private/settings/push', init))
  return { status: r.status, body: await r.json() }
}
const fresh = () => {
  env(true)
  globalThis.__homePushStore = memoryStore()
  globalThis.__homeNotifyStore = notifyMemory()
}

test('push route: owner only, and off with the hub', async () => {
  fresh()
  assert.equal((await call(pushGet, 'GET', undefined, {})).status, 404)
  assert.equal((await call(pushGet, 'GET', undefined, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  assert.equal((await call(pushPost, 'POST', { action: 'add', subscription: device().json }, { ...OWNER, 'remote-user': 'someone' })).status, 403)
  delete process.env.NOTIFY_TOKEN
  assert.equal((await call(pushGet, 'GET')).status, 404)
  env(true)
  const r = await call(pushGet, 'GET')
  assert.equal(r.status, 200)
  assert.match(r.body.publicKey, /^[A-Za-z0-9_-]{87}$/)
  assert.deepEqual(r.body.devices, [])
})

test('push route: add, list, remove; a bad subscription is a 400; writes only same-origin JSON', async () => {
  fresh()
  const d = device()
  const add = await call(pushPost, 'POST', { action: 'add', subscription: d.json, name: 'iPhone · Home Screen' })
  assert.equal(add.status, 200)
  assert.deepEqual(add.body.devices.map((x) => [x.endpoint, x.name]), [[d.json.endpoint, 'iPhone · Home Screen']])
  assert.equal((await call(pushPost, 'POST', { action: 'add', subscription: { ...d.json, endpoint: 'https://evil.example/x' } })).body.field, 'endpoint')
  assert.equal((await call(pushPost, 'POST', { action: 'nope' })).status, 400)
  const cross = await pushPost(new Request('http://home.test/x', { method: 'POST', headers: { ...OWNER, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' }))
  assert.equal(cross.status, 403)
  const rm = await call(pushPost, 'POST', { action: 'remove', endpoint: d.json.endpoint })
  assert.deepEqual(rm.body.devices, [])
})

test('push route: a test goes only to one of the owner\'s own devices', async () => {
  fresh()
  assert.equal((await call(pushPost, 'POST', { action: 'test', endpoint: 'https://web.push.apple.com/not-mine' })).body.field, 'endpoint')
})

// ---- a real send: web-push encrypts and signs, a local stand-in push service receives, the device decrypts ----
function standIn() {
  const got = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) })
      res.writeHead(201).end()
    })
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, got, url: `http://127.0.0.1:${server.address().port}` })))
}
const open = (d, body) => JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString('utf8'))

test('a real push: the hub\'s sender route posts a notice, the device gets it encrypted and signed, and can read it', async () => {
  fresh()
  const svc = await standIn()
  process.env.PUSH_TEST_HOSTS = '127.0.0.1'
  // web-push's own encryption and VAPID signature (generateRequestDetails is what sendNotification sends), delivered
  // over plain http to the stand-in (sendNotification itself only speaks https)
  globalThis.__homePushSend = async (sub, body, opts) => {
    const d = webpush.generateRequestDetails(sub, body, opts)
    const r = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body })
    if (!r.ok) throw Object.assign(new Error('push'), { statusCode: r.status })
  }
  try {
    const d = device(`${svc.url}/push/device-1`)
    assert.equal((await call(pushPost, 'POST', { action: 'add', subscription: d.json, name: 'Test device' })).status, 200)
    // a machine on the LAN sends a notice, as Claude Code's hook does
    const r = await send(new Request('http://home.test/api/notify', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' }, body: JSON.stringify({ title: 'Claude finished · home-lofi', body: 'Done: 303 tests pass.', level: 'success', tag: 'claude:x', ttl: 3600 }) }))
    assert.equal(r.status, 201)
    for (let i = 0; i < 50 && !svc.got.length; i++) await new Promise((res) => setTimeout(res, 20))
    assert.equal(svc.got.length, 1)
    const g = svc.got[0]
    assert.equal(g.path, '/push/device-1')
    assert.deepEqual([g.headers['content-encoding'], g.headers.ttl, g.headers.urgency], ['aes128gcm', '3600', 'normal'])
    // signed with the server's key (VAPID): its public key is the one the page subscribes with
    const pub = (await call(pushGet, 'GET')).body.publicKey
    assert.match(g.headers.authorization, new RegExp(`^vapid t=[^,]+, k=${pub}$`))
    const claims = JSON.parse(Buffer.from(g.headers.authorization.split('t=')[1].split(',')[0].split('.')[1], 'base64url'))
    assert.deepEqual([claims.aud, claims.sub], [svc.url, 'https://home.wliafdew.dev'])
    // only the device can read it
    assert.deepEqual(open(d, g.body), { title: 'Claude finished · home-lofi', body: 'Done: 303 tests pass.', tag: 'claude:x', url: '/', level: 'success' })
    // the "Test" button: to this device only
    const t = await call(pushPost, 'POST', { action: 'test', endpoint: d.json.endpoint })
    assert.deepEqual(t.body.test, { sent: 1, dropped: 0, failed: 0 })
    assert.equal(open(d, svc.got[1].body).title, 'Alerts are on')
  } finally {
    svc.server.close()
    delete process.env.PUSH_TEST_HOSTS
    delete globalThis.__homePushSend
  }
})
