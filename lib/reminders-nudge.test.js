// Reminders' 06:00 notice (lib/reminders-nudge.js + the rules in lib/reminders.js), the one that goes with the morning
// summary switched off (lib/morning-summary.test.js has the switch and the ticker): once a day, only with something
// open, through the notification hub and to the phones, claimed so it never goes twice. No database, no network: the
// stores are memoryStore()s, the push service a stand-in (globalThis.__homePushSend); the clock is the `ms` passed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import { nudgeTick } from './reminders-nudge.js'
import { memoryStore } from './reminders-store.js'
import { memoryStore as habitsMemory } from './habits-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { memoryStore as pushMemory } from './push-store.js'
import { CLAIM_LEASE } from './habits-store.js'
import { liveBus } from './live.js'

const env = (on) => {
  const vars = { NOTIFY_TOKEN: 'notify-token-for-tests-0123456789', OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', GATE_SECRET: 'gate-secret-for-tests-0123456789', SYNC_SECRET: 'sync-secret-for-tests-0123456789' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026
const at = (h, m, day = 14) => Date.UTC(2026, 9, day, h - 7, m)

let store, notes, pushes
const put = (id, text, day = '2026-10-13') => store.add('owner', { id, text, day, at: at(9, 0, Number(day.slice(8))) }, 50)
test.beforeEach(async () => {
  env(true)
  store = globalThis.__homeRemindersStore = memoryStore()
  globalThis.__homeHabitsStore = habitsMemory()
  notes = globalThis.__homeNotifyStore = notifyMemory(() => at(6, 0)) // (the inbox's own clock: the notices stay alive)
  // one phone, and a push service that only counts
  const push = (globalThis.__homePushStore = pushMemory())
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  await push.add('owner', { endpoint: 'https://web.push.apple.com/QKtest', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, 'iPhone')
  pushes = []
  globalThis.__homePushSend = async (sub, body) => void pushes.push(JSON.parse(body))
})
test.after(() => {
  env(false)
  for (const k of ['__homeRemindersStore', '__homeHabitsStore', '__homeNotifyStore', '__homePushStore', '__homePushSend']) delete globalThis[k]
})
const inbox = async () => (await notes.list('owner')).items
const settle = () => new Promise((r) => setImmediate(r)) // (the push goes in the background)

test('06:00 with reminders open: one notice in the inbox, on the phone, and the open pages hear', async () => {
  await put('aaaaaa000001', 'renew the domain', '2026-10-11')
  await put('aaaaaa000002', 'call mum')
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-nudge-01', (e) => heard.push(e.kind))
  assert.equal(await nudgeTick(at(5, 59)), null)
  assert.equal(await nudgeTick(at(6, 0)), 'todo:2026-10-14')
  await settle()
  off()
  const [n] = await inbox()
  assert.equal(n.title, '2 reminders today')
  assert.equal(n.body, "• renew the domain\n• call mum\nCarried for 3 days. Hold each one when it's done.")
  assert.deepEqual([n.source, n.tag, n.color], ['Reminders', 'todo:2026-10-14', 'highlight'])
  assert.deepEqual(pushes.map((p) => [p.title, p.tag]), [['2 reminders today', 'todo:2026-10-14']])
  assert.deepEqual(heard, ['notify'])
})

test('once a day: the same minute again, later minutes, a second server: never twice', async () => {
  await put('aaaaaa000001', 'renew the domain')
  const [a, b] = await Promise.all([nudgeTick(at(6, 0)), nudgeTick(at(6, 0))])
  assert.deepEqual([a, b].sort(), [null, 'todo:2026-10-14'])
  assert.equal(await nudgeTick(at(6, 1)), null)
  assert.equal(await nudgeTick(at(6, 29)), null)
  assert.equal((await inbox()).length, 1)
  // the next morning is a new one (the reminder carried over)
  assert.equal(await nudgeTick(at(6, 0, 15)), 'todo:2026-10-15')
})

test('nothing open: no notice at all (and nothing claimed)', async () => {
  assert.equal(await nudgeTick(at(6, 0)), null)
  await put('aaaaaa000001', 'renew the domain')
  await store.done('owner', 'aaaaaa000001', at(5, 0))
  assert.equal(await nudgeTick(at(6, 1)), null)
  assert.deepEqual(await inbox(), [])
  assert.deepEqual(pushes, [])
})

test('only what was open at 06:00 counts: one added at 06:10 to an empty list sends nothing', async () => {
  await store.add('owner', { id: 'aaaaaa000002', text: 'call mum', day: '2026-10-14', at: at(6, 10) }, 50)
  assert.equal(await nudgeTick(at(6, 10)), null)
  assert.equal(await nudgeTick(at(6, 11)), null)
  assert.deepEqual(await inbox(), [])
  // the next morning it's carried over: then it does
  assert.equal(await nudgeTick(at(6, 0, 15)), 'todo:2026-10-15')
})

test('a server late to the morning (06:12) lists what was open at 06:00, not what came after', async () => {
  await put('aaaaaa000001', 'renew the domain') // yesterday's
  await store.add('owner', { id: 'aaaaaa000002', text: 'added before six', day: '2026-10-14', at: at(5, 30) }, 50)
  await store.add('owner', { id: 'aaaaaa000003', text: 'added at ten past', day: '2026-10-14', at: at(6, 10) }, 50)
  assert.equal(await nudgeTick(at(6, 12)), 'todo:2026-10-14')
  const [n] = await inbox()
  assert.equal(n.title, '2 reminders today')
  assert.doesNotMatch(n.body, /ten past/)
})

test('the last one held done while the notice went out: it comes off again, no phone buzzes', async () => {
  await put('aaaaaa000001', 'renew the domain')
  const real = notes.add
  notes.add = async (n) => {
    const r = await real(n)
    await store.done('owner', 'aaaaaa000001', at(6, 0)) // (the route ran meanwhile, found no notice to take off)
    return r
  }
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-nudge-02', (e) => heard.push(e.kind))
  assert.equal(await nudgeTick(at(6, 0)), 'todo:2026-10-14')
  await settle()
  off()
  notes.add = real
  assert.deepEqual(await inbox(), [])
  assert.deepEqual(pushes, [])
  assert.deepEqual(heard, ['notify'])
  assert.equal(await nudgeTick(at(6, 1)), null) // and it's settled for the day
})

test('a server that was down at 06:00 still sends until 06:29, not after', async () => {
  await put('aaaaaa000001', 'renew the domain')
  assert.equal(await nudgeTick(at(6, 30)), null)
  assert.equal(await nudgeTick(at(12, 0)), null)
  assert.equal(await nudgeTick(at(6, 29)), 'todo:2026-10-14')
})

test('the owner\'s zone (the Habits doc\'s): 06:00 there, not in Ho Chi Minh City', async () => {
  await globalThis.__homeHabitsStore.putDoc('owner', { tz: 'Europe/Berlin', habits: [] })
  await put('aaaaaa000001', 'renew the domain')
  assert.equal(await nudgeTick(at(6, 0)), null) // 01:00 in Berlin
  assert.equal(await nudgeTick(Date.UTC(2026, 9, 14, 4, 0)), 'todo:2026-10-14') // 06:00 CEST
})

test('the hub off (no token / database / owner): nothing sent, nothing claimed', async () => {
  await put('aaaaaa000001', 'renew the domain')
  delete process.env.NOTIFY_TOKEN
  assert.equal(await nudgeTick(at(6, 0)), null)
  env(true)
  assert.equal(await nudgeTick(at(6, 1)), 'todo:2026-10-14')
})

test('a send that fails gives the key back: the next tick sends it', async () => {
  await put('aaaaaa000001', 'renew the domain')
  const real = notes.add
  notes.add = async () => {
    throw new Error('database away')
  }
  assert.equal(await nudgeTick(at(6, 0)), null)
  notes.add = real
  assert.equal(await nudgeTick(at(6, 1)), 'todo:2026-10-14')
  assert.equal((await inbox()).length, 1)
})

test('a claim never marked sent lapses after the lease; once sent, never again', async () => {
  const t0 = 1_000_000
  assert.equal(await store.claimNudge('owner', 'todo:x', t0), true)
  assert.equal(await store.claimNudge('owner', 'todo:x', t0 + 60_000), false)
  assert.equal(await store.claimNudge('owner', 'todo:x', t0 + CLAIM_LEASE + 1), true)
  await store.sentNudge('owner', 'todo:x')
  assert.equal(await store.claimNudge('owner', 'todo:x', t0 + 10 * CLAIM_LEASE), false)
})
