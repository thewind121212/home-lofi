// Focus sessions' server-side phase changes (lib/focus-ticker.js): at a phase's end, the next one, 🍅 +1, the notice in
// the hub and on the phone, once only (two ticks, two servers, a Pause in the same instant), and the timer that makes it
// land on the second. No database, no network: the stores are memoryStore()s, the push service a stand-in
// (globalThis.__homePushSend); the clock is the `ms` passed, or node:test's mock.timers for the timer.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import { ARM_SLACK, armFocus, focusTick, startFocus } from './focus-ticker.js'
import { memoryStore } from './focus-store.js'
import { memoryStore as habitsMemory } from './habits-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { memoryStore as pushMemory } from './push-store.js'
import { liveBus } from './live.js'
import { MINUTE, act, startSession } from './focus.js'

const env = (on) => {
  const vars = { NOTIFY_TOKEN: 'notify-token-for-tests-0123456789', OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026 (Wednesday the 14th)
const at = (h, m, day = 14, s = 0) => Date.UTC(2026, 9, day, h - 7, m, s)
const T0 = at(10, 0)
const END = T0 + 25 * MINUTE

let store, notes, pushes
const begin = async (s = startSession('25/5', T0, 'a1b2c3d4e5f6')) => (await store.put('owner', (await store.get('owner')).rev, s), s)
test.beforeEach(async () => {
  env(true)
  store = globalThis.__homeFocusStore = memoryStore()
  globalThis.__homeHabitsStore = habitsMemory()
  notes = globalThis.__homeNotifyStore = notifyMemory(() => END)
  const push = (globalThis.__homePushStore = pushMemory())
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  await push.add('owner', { endpoint: 'https://web.push.apple.com/QKtest', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, 'iPhone')
  pushes = []
  globalThis.__homePushSend = async (sub, body) => void pushes.push(JSON.parse(body))
})
test.after(() => {
  env(false)
  for (const k of ['__homeFocusStore', '__homeHabitsStore', '__homeNotifyStore', '__homePushStore', '__homePushSend', '__homeFocusTicker']) delete globalThis[k]
})
const inbox = async () => (await notes.list('owner')).items
const settle = () => new Promise((r) => setImmediate(r)) // (the push goes in the background)

test('focus ends: a break starts by itself, 🍅 +1, one notice in the hub and on the phone; the pages hear', async () => {
  await begin()
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-focus-01', (e) => heard.push(e.kind))
  assert.equal(await focusTick(END - 1), null) // (not yet)
  assert.equal(await focusTick(END + 800), 'focus:a1b2c3d4e5f6:1:focus')
  await settle()
  off()
  const { session } = await store.get('owner')
  assert.deepEqual([session.phase, session.round, session.phaseEndsAt], ['break', 1, END + 5 * MINUTE])
  assert.equal(await store.count('owner', '2026-10-14'), 1)
  const [n, ...more] = await inbox()
  assert.equal(more.length, 0)
  assert.deepEqual([n.title, n.body, n.tag, n.source], ['Focus done · 5 min break', 'Round 1 done · 1 focus session today. Back to focus at 10:30.', 'focus:a1b2c3d4e5f6', 'Focus'])
  assert.deepEqual(pushes.map((p) => [p.title, p.tag]), [['Focus done · 5 min break', 'focus:a1b2c3d4e5f6']])
  assert.deepEqual(heard, ['focus', 'notify'])
})

test('break ends: focus again (round 2), its notice replaces the last one, nothing counted', async () => {
  await begin()
  await focusTick(END)
  assert.equal(await focusTick(END + 5 * MINUTE + 500), 'focus:a1b2c3d4e5f6:1:break')
  await settle()
  const { session } = await store.get('owner')
  assert.deepEqual([session.phase, session.round, session.phaseEndsAt], ['focus', 2, END + 30 * MINUTE])
  assert.equal(await store.count('owner', '2026-10-14'), 1)
  assert.deepEqual((await inbox()).map((n) => [n.title, n.body]), [['Break over · back to focus', 'Round 2 · 25 min, until 10:55.']])
  assert.deepEqual(pushes.map((p) => p.title), ['Focus done · 5 min break', 'Break over · back to focus'])
})

test('once only: two ticks at once, a second server, a restart: one change, one count, one push', async () => {
  await begin()
  const keys = await Promise.all([focusTick(END + 100), focusTick(END + 100), focusTick(END + 200)])
  assert.deepEqual(keys.filter(Boolean), ['focus:a1b2c3d4e5f6:1:focus'])
  assert.equal(await focusTick(END + 60_000), null) // (the minute's check: the break is running, nothing ended)
  await settle()
  assert.equal(await store.count('owner', '2026-10-14'), 1)
  assert.equal(pushes.length, 1)
})

test('a Pause landing between the read and the write wins: no change, no count, no push; the key goes back', async () => {
  await begin()
  const real = store.put
  store.put = async (owner, rev, session, o) => {
    store.put = real
    const cur = await store.get(owner)
    await real(owner, cur.rev, act(cur.session, { action: 'pause' }, END - 1).session) // (the phone, just now)
    return real(owner, rev, session, o)
  }
  assert.equal(await focusTick(END + 100), null)
  await settle()
  const { session } = await store.get('owner')
  assert.deepEqual([session.phase, session.phaseEndsAt, session.pausedLeft], ['focus', null, 1])
  assert.equal(await store.count('owner', '2026-10-14'), 0)
  assert.deepEqual([pushes.length, (await inbox()).length], [0, 0])
  assert.equal(await store.claim('owner', 'focus:a1b2c3d4e5f6:1:focus'), true) // (given back: resumed, it changes then)
})

test('paused, stopped or none: nothing ever ends', async () => {
  assert.equal(await focusTick(END), null)
  const s = await begin()
  await store.put('owner', (await store.get('owner')).rev, act(s, { action: 'pause' }, T0 + MINUTE).session)
  assert.equal(await focusTick(END + 99 * MINUTE), null)
  await store.put('owner', (await store.get('owner')).rev, null)
  assert.equal(await focusTick(END + 99 * MINUTE), null)
  assert.equal(pushes.length, 0)
})

test('the hub off (no token): the phases still change and count, just no notice', async () => {
  delete process.env.NOTIFY_TOKEN
  await begin()
  assert.equal(await focusTick(END), 'focus:a1b2c3d4e5f6:1:focus')
  await settle()
  assert.equal((await store.get('owner')).session.phase, 'break')
  assert.equal(await store.count('owner', '2026-10-14'), 1)
  assert.deepEqual([pushes.length, (await inbox()).length], [0, 0])
})

test('the database failing mid-change: nothing half-made, and the next tick makes it', async () => {
  await begin()
  const real = store.put
  store.put = async () => {
    store.put = real
    throw new Error('down')
  }
  assert.equal(await focusTick(END), null)
  assert.equal((await store.get('owner')).session.phase, 'focus')
  assert.equal(await focusTick(END + 1000), 'focus:a1b2c3d4e5f6:1:focus') // (the key was given back)
})

test('a focus ending after midnight counts on the new day (the owner\'s zone)', async () => {
  await begin(startSession('25/5', at(23, 50), 'b1b2c3d4e5f6'))
  await focusTick(at(0, 15, 15))
  assert.equal(await store.count('owner', '2026-10-15'), 1)
  assert.equal(await store.count('owner', '2026-10-14'), 0)
})

test('the timer: armed to the phase\'s end, it makes the change on the second (not at the next minute)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 })
  delete globalThis.__homeFocusTicker
  armFocus(startSession('25/5', T0, 'x')) // (before the ticker starts: nothing)
  globalThis.__homeFocusTicker = { timer: null } // (started, without its minute's check: that one has its own test)
  const s = await begin()
  armFocus(s)
  t.mock.timers.tick(25 * MINUTE + ARM_SLACK - 1)
  for (let i = 0; i < 5; i++) await settle()
  assert.equal((await store.get('owner')).session.phase, 'focus')
  t.mock.timers.tick(1)
  for (let i = 0; i < 10; i++) await settle()
  assert.equal((await store.get('owner')).session.phase, 'break')
  assert.equal(pushes.length, 1)
  // and it re-armed itself for the break's end
  t.mock.timers.tick(5 * MINUTE + ARM_SLACK)
  for (let i = 0; i < 10; i++) await settle()
  assert.deepEqual([(await store.get('owner')).session.phase, (await store.get('owner')).session.round], ['focus', 2])
  // a pause disarms it: nothing changes however long it waits
  const p = act((await store.get('owner')).session, { action: 'pause' }, Date.now()).session
  await store.put('owner', (await store.get('owner')).rev, p)
  armFocus(p)
  t.mock.timers.tick(40 * MINUTE)
  for (let i = 0; i < 10; i++) await settle()
  assert.equal((await store.get('owner')).session.pausedLeft, 25 * MINUTE - 2 * ARM_SLACK) // (paused as soon as the focus began)
  delete globalThis.__homeFocusTicker
})

test('the ticker starts once per process; its first check (just after a restart) makes a change missed meanwhile', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: END + 10 * 1000 })
  delete globalThis.__homeFocusTicker
  await begin() // (ended 10 s ago, while the server was down)
  const first = startFocus()
  assert.ok(first)
  assert.equal(startFocus(), undefined)
  t.mock.timers.tick(3_000)
  for (let i = 0; i < 10; i++) await settle()
  const { session } = await store.get('owner')
  assert.deepEqual([session.phase, session.phaseEndsAt], ['break', END + 5 * MINUTE]) // (on time after all: within LATE_MS)
  assert.equal(pushes.length, 1)
  assert.ok(globalThis.__homeFocusTicker.timer) // armed for the break's end
  armFocus(null)
  delete globalThis.__homeFocusTicker
})
