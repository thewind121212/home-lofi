// The owner's live settings stream (app/api/private/settings/events/route.js): who gets one, what it says, and that a
// closed stream leaves the bus. No database: the stream never reads one (the save route publishes, lib/live.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../app/api/private/settings/events/route.js'
import { liveBus } from './live.js'

const URL_ = 'http://home.test/api/private/settings/events'
const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const open = (id = 'phone-tab-01', headers = OWNER, signal) => GET(new Request(`${URL_}${id === null ? '' : `?id=${id}`}`, { headers, signal }))
const env = (on) => {
  const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
test.after(() => env(false))

// read until the next blank line (one SSE frame)
const decoder = new TextDecoder()
async function frame(reader) {
  let text = ''
  while (!text.endsWith('\n\n')) {
    const { value, done } = await reader.read()
    if (done) return null
    text += decoder.decode(value)
  }
  const ev = /^event: (.+)$/m.exec(text)?.[1]
  const data = /^data: (.+)$/m.exec(text)?.[1]
  return { event: ev, data: data && JSON.parse(data) }
}

test('sync not set up: 404 for everyone, owner included', async () => {
  env(false)
  assert.equal((await open()).status, 404)
  env(true)
  delete process.env.DATABASE_URL
  assert.equal((await open()).status, 404)
})

test('the owner gate: no proxy secrets -> 404, someone else -> 403, never a stream', async () => {
  env(true)
  const before = liveBus().size
  for (const [headers, status] of [
    [{}, 404],
    [{ 'remote-user': 'owner' }, 404], // a client's own Remote-User, without the proxy's secrets
    [{ ...OWNER, 'x-home-sync': 'wrong-wrong-wrong-wrong' }, 404],
    [{ ...OWNER, 'remote-user': 'eve' }, 403],
    [{ ...OWNER, 'remote-user': '' }, 403],
  ]) {
    const r = await open('phone-tab-01', headers)
    assert.equal(r.status, status, JSON.stringify(headers))
    assert.equal(r.headers.get('cache-control'), 'no-store, private')
    assert.notEqual(r.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  }
  assert.equal((await open(null)).status, 400) // the owner, but no tab id
  assert.equal((await open('bad id!')).status, 400)
  assert.equal(liveBus().size, before)
})

test('the owner: hello, then a save from another tab; never its own; abort leaves the bus', async () => {
  env(true)
  const stop = new AbortController()
  const before = liveBus().size
  const r = await open('phone-tab-01', OWNER, stop.signal)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  assert.equal(r.headers.get('cache-control'), 'no-store, private, no-transform')
  assert.equal(r.headers.get('x-accel-buffering'), 'no')
  const reader = r.body.getReader()
  const hello = await frame(reader)
  assert.equal(hello.event, 'hello')
  assert.ok(Number.isFinite(hello.data.at))
  assert.equal(liveBus().size, before + 1)

  assert.equal(liveBus().publish('owner', { at: 5, from: 'phone-tab-01' }), 0) // its own save: not echoed
  assert.equal(liveBus().publish('someone', { at: 6, from: null }), 0) // another owner's: never
  assert.equal(liveBus().publish('owner', { at: 7, from: 'pc-tab-0001' }), 1)
  assert.deepEqual(await frame(reader), { event: 'changed', data: { at: 7, from: 'pc-tab-0001' } })

  stop.abort()
  assert.equal(liveBus().size, before)
  assert.equal(await frame(reader), null) // the stream ended
})

test('a browser that cancels the stream (tab closed) leaves the bus too', async () => {
  env(true)
  const before = liveBus().size
  const r = await open('pc-tab-0001')
  const reader = r.body.getReader()
  await frame(reader)
  assert.equal(liveBus().size, before + 1)
  await reader.cancel()
  assert.equal(liveBus().size, before)
})
