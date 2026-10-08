import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIVE_HIDDEN_MS, LIVE_TRIES, MAX_STREAMS, clientId, createBus, liveAction, liveRetryMs, liveWanted, newClientId } from './live.js'

// a subscriber that records what it hears
const ear = () => {
  const heard = []
  let closed = 0
  return { heard, send: (e) => heard.push(e), close: () => closed++, get closed() { return closed } }
}

test('bus: a save reaches every other stream of that owner, not the tab that made it, not other owners', () => {
  const bus = createBus()
  const pc = ear(), phone = ear(), tablet = ear(), eve = ear()
  bus.subscribe('owner', 'pc-tab-0001', pc.send)
  bus.subscribe('owner', 'phone-tab-01', phone.send)
  bus.subscribe('owner', 'tablet-tab-1', tablet.send)
  bus.subscribe('eve', 'eve-tab-0001', eve.send)
  assert.equal(bus.publish('owner', { at: 1, from: 'pc-tab-0001' }), 2)
  assert.deepEqual(pc.heard, [])
  assert.deepEqual(phone.heard, [{ at: 1, from: 'pc-tab-0001' }])
  assert.deepEqual(tablet.heard, [{ at: 1, from: 'pc-tab-0001' }])
  assert.deepEqual(eve.heard, [])
  // no sender id (an old page, a bad header): everyone hears it
  assert.equal(bus.publish('owner', { at: 2, from: null }), 3)
  assert.equal(pc.heard.length, 1)
})

test('bus: unsubscribe and a dead stream (send throws) both leave it', () => {
  const bus = createBus()
  const a = ear(), dead = ear()
  const leave = bus.subscribe('owner', 'aaaaaaaa', a.send)
  bus.subscribe('owner', 'bbbbbbbb', () => {
    throw new Error('closed')
  }, dead.close)
  assert.equal(bus.size, 2)
  assert.equal(bus.publish('owner', { at: 1, from: null }), 1)
  assert.equal(bus.size, 1) // the dead one is gone...
  assert.equal(dead.closed, 1) // ...and told to close
  leave()
  leave() // twice: harmless
  assert.equal(bus.size, 0)
  assert.equal(bus.publish('owner', { at: 2, from: null }), 0)
  assert.equal(a.heard.length, 1)
})

test('bus: capped; when full the oldest stream is closed, the new one gets in', () => {
  const bus = createBus({ max: 3 })
  const ears = [ear(), ear(), ear(), ear()]
  ears.forEach((e, i) => bus.subscribe('owner', `tab-${i}-xxxx`, e.send, e.close))
  assert.equal(bus.size, 3)
  assert.deepEqual(ears.map((e) => e.closed), [1, 0, 0, 0])
  bus.publish('owner', { at: 1, from: null })
  assert.deepEqual(ears.map((e) => e.heard.length), [0, 1, 1, 1])
  assert.ok(MAX_STREAMS >= 6 && MAX_STREAMS <= 50)
})

test('bus: closeAll (the server stopping) ends every stream', () => {
  const bus = createBus()
  const a = ear(), b = ear()
  bus.subscribe('owner', 'aaaaaaaa', a.send, a.close)
  bus.subscribe('owner', 'bbbbbbbb', b.send, b.close)
  bus.closeAll()
  assert.deepEqual([a.closed, b.closed, bus.size], [1, 1, 0])
  assert.equal(bus.publish('owner', { at: 1, from: null }), 0)
})

test('clientId: only short url-safe ids; newClientId makes one', () => {
  for (const v of [null, undefined, 42, '', 'short', 'a'.repeat(65), 'has space ok?', '../../etc', 'ab<script>cd']) assert.equal(clientId(v), null, String(v))
  assert.equal(clientId('pc-tab_0001'), 'pc-tab_0001')
  const id = newClientId()
  assert.match(id, /^[0-9a-f]{24}$/)
  assert.equal(clientId(id), id)
  assert.notEqual(newClientId(), id)
  assert.equal(newClientId((b) => b.fill(255)), 'ff'.repeat(12))
})

test('liveWanted: only while synced; open while shown, a minute after hiding, or while sounds play', () => {
  assert.equal(liveWanted({ synced: false, visible: true }), false) // guests, signed out: never
  assert.equal(liveWanted({ synced: true, visible: true }), true)
  assert.equal(liveWanted({ synced: true, visible: false, hiddenMs: 5_000 }), true)
  assert.equal(liveWanted({ synced: true, visible: false, hiddenMs: LIVE_HIDDEN_MS }), false)
  assert.equal(liveWanted({ synced: true, visible: false, hiddenMs: LIVE_HIDDEN_MS * 30, keep: true }), true) // sounds play
  assert.equal(liveWanted({ synced: true, visible: true, fails: LIVE_TRIES }), false) // gave up until the tab shows again
})

test('liveRetryMs: backs off to a minute, then gives up', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(liveRetryMs), [2000, 5000, 15000, 30000, 60000, 60000])
  assert.equal(liveRetryMs(LIVE_TRIES - 1), 60000)
  assert.equal(liveRetryMs(LIVE_TRIES), null)
})

test('liveAction: another tab saved -> pull; our own save, guests, unknown frames -> nothing; hello pulls only after a drop', () => {
  const me = { self: 'mine-0001', synced: true }
  assert.equal(liveAction({ kind: 'changed', at: 1, from: 'pc-tab-0001' }, me), 'pull')
  assert.equal(liveAction({ kind: 'changed', at: 1, from: null }, me), 'pull')
  assert.equal(liveAction({ kind: 'changed', at: 1, from: 'mine-0001' }, me), null)
  assert.equal(liveAction({ kind: 'changed', at: 1, from: 'pc-tab-0001' }, { ...me, synced: false }), null)
  assert.equal(liveAction({ kind: 'hello', at: 1 }, me), null) // first connect: the load's pull covers it
  assert.equal(liveAction({ kind: 'hello', at: 1 }, { ...me, missed: true }), 'pull') // back after a drop
  assert.equal(liveAction({ kind: 'settings', v: {} }, me), null)
  assert.equal(liveAction(null, me), null)
})
