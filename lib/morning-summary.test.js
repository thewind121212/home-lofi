// The morning summary's sender (lib/morning-summary.js): every morning at 06:00 one notice through the notification hub
// and to the phones, claimed so it never goes twice; the owner's switch off -> Reminders' own notice, as before. No
// database, no network: the stores are memoryStore()s, the push service a stand-in (globalThis.__homePushSend), the
// weather and the other machines stand-ins too (globalThis.__homeMorningSources); the clock is the `ms` passed, or
// node:test's mock.timers for the ticker itself.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import { SOURCE_MS, TICK_MS, morningTick, startMorning } from './morning-summary.js'
import { memoryStore } from './reminders-store.js'
import { memoryStore as habitsMemory } from './habits-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { memoryStore as pushMemory } from './push-store.js'
import { liveBus } from './live.js'

const env = (on) => {
  const vars = { NOTIFY_TOKEN: 'notify-token-for-tests-0123456789', OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', GATE_SECRET: 'gate-secret-for-tests-0123456789', SYNC_SECRET: 'sync-secret-for-tests-0123456789' }
  for (const [k, v] of Object.entries(vars)) on ? (process.env[k] = v) : delete process.env[k]
}
// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026 (Wednesday the 14th)
const at = (h, m, day = 14) => Date.UTC(2026, 9, day, h - 7, m)
const WEATHER = '29° now · 24–33° · rain from 15:00'
const TOMORROW = 'Tomorrow 23–31° · rain likely'

let store, notes, pushes, asked
const put = (id, text, day = '2026-10-13') => store.add('owner', { id, text, day, at: at(9, 0, Number(day.slice(8))) }, 50)
const habit = (name, when, days = [1, 2, 3, 4, 5, 6, 7]) => ({ id: name.toLowerCase().padEnd(6, 'x'), name, when, days, archived: false, since: '2026-10-01', remind: true, icon: 'Sprout', minutes: 30, identity: '' })
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
  // the weather at the owner's location, and the Server card's other machines
  asked = []
  globalThis.__homeMorningSources = {
    weather: async (owner, o) => (asked.push(['weather', owner, Boolean(o?.tomorrow)]), { now: WEATHER, tomorrow: o?.tomorrow ? TOMORROW : null }),
    hosts: async () => (asked.push(['hosts']), [{ name: 'razer', stats: { cpu: 4 } }]),
  }
})
test.after(() => {
  env(false)
  for (const k of ['__homeRemindersStore', '__homeHabitsStore', '__homeNotifyStore', '__homePushStore', '__homePushSend', '__homeMorningSources']) delete globalThis[k]
})
const inbox = async () => (await notes.list('owner')).items
const settle = () => new Promise((r) => setImmediate(r)) // (the push goes in the background)

test('06:00: one summary in the inbox and on the phone (weather, reminders, routines, servers); the pages hear', async () => {
  await put('aaaaaa000001', 'renew the domain', '2026-10-11')
  await put('aaaaaa000002', 'call mum')
  await globalThis.__homeHabitsStore.putDoc('owner', { tz: 'Asia/Ho_Chi_Minh', habits: [habit('Workout', { kind: 'time', at: '06:15' }), habit('Read', { kind: 'any' })] })
  const heard = []
  const off = liveBus().subscribe('owner', 'tab-morning-01', (e) => heard.push(e.kind))
  assert.equal(await morningTick(at(5, 59)), null)
  assert.deepEqual(asked, []) // (outside the window nothing is fetched)
  assert.equal(await morningTick(at(6, 0)), 'morning:2026-10-14')
  await settle()
  off()
  const [n, ...more] = await inbox()
  assert.equal(more.length, 0)
  assert.equal(n.title, 'Good morning · Wed 14 Oct')
  assert.equal(n.body, `${WEATHER}\n2 reminders: renew the domain · call mum\n2 routines today · first: Workout 06:15\nAll servers up`)
  assert.deepEqual([n.source, n.tag, n.color], ['Summary', 'morning:2026-10-14', 'highlight'])
  assert.deepEqual(pushes.map((p) => [p.title, p.tag, p.body]), [[n.title, 'morning:2026-10-14', n.body]])
  assert.deepEqual(heard, ['notify'])
  assert.deepEqual(asked, [['weather', 'owner', false], ['hosts']])
})

test('every morning, nothing open or not: each line only when it has something to say', async () => {
  globalThis.__homeMorningSources = { weather: async () => null, hosts: async () => [{ name: 'razer', stats: null }] }
  assert.equal(await morningTick(at(6, 0)), 'morning:2026-10-14')
  const [n] = await inbox()
  assert.equal(n.body, 'razer down') // no weather, no reminders, no Habits
  await settle()
  assert.equal(pushes.length, 1)
})

test('the weather or the machines failing (or no host agents) leave their line out; the summary still goes', async () => {
  await put('aaaaaa000001', 'renew the domain')
  globalThis.__homeMorningSources = {
    weather: async () => {
      throw new Error('upstream 502')
    },
    hosts: () => {
      throw new Error('bad HOST_AGENTS') // (even one that throws before it's a promise)
    },
  }
  assert.equal(await morningTick(at(6, 0)), 'morning:2026-10-14')
  assert.equal((await inbox())[0].body, '1 reminder: renew the domain')
  globalThis.__homeMorningSources = { weather: async () => ({ now: WEATHER }), hosts: async () => [] }
  assert.equal(await morningTick(at(6, 0, 15)), 'morning:2026-10-15')
  assert.equal((await inbox()).find((n) => n.tag === 'morning:2026-10-15').body, `${WEATHER}\n1 reminder: renew the domain`)
})

test('the weather or the machines with no answer: their line is left out after SOURCE_MS, the summary still goes', async () => {
  await put('aaaaaa000001', 'renew the domain')
  globalThis.__homeMorningSources = { weather: () => new Promise(() => {}), hosts: async () => [{ name: 'razer', stats: null }] }
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let out
    const tick = morningTick(at(6, 0)).then((k) => (out = k))
    for (let i = 0; i < 20; i++) await settle()
    assert.equal(out, undefined) // (still waiting for the weather)
    mock.timers.tick(SOURCE_MS)
    await tick
    assert.equal(out, 'morning:2026-10-14')
    assert.equal((await inbox())[0].body, '1 reminder: renew the domain\nrazer down')
  } finally {
    mock.timers.reset()
  }
})

test('06:00 to 06:29 only, once a day: the same minute again, later minutes, a second server: never twice', async () => {
  assert.equal(await morningTick(at(6, 30)), null)
  assert.equal(await morningTick(at(12, 0)), null)
  const [a, b] = await Promise.all([morningTick(at(6, 0)), morningTick(at(6, 0))])
  assert.deepEqual([a, b].sort(), ['morning:2026-10-14', null])
  assert.equal(await morningTick(at(6, 1)), null)
  assert.equal(await morningTick(at(6, 29)), null)
  assert.equal((await inbox()).length, 1)
  assert.equal(await morningTick(at(6, 0, 15)), 'morning:2026-10-15') // the next morning is a new one
  // a server that was down at 06:00 still sends until 06:29
  assert.equal(await morningTick(at(6, 29, 16)), 'morning:2026-10-16')
})

test('only what was open at 06:00 is listed: one added at 06:10 isn\'t (a server late to the morning)', async () => {
  await put('aaaaaa000001', 'renew the domain')
  await store.add('owner', { id: 'aaaaaa000003', text: 'added at ten past', day: '2026-10-14', at: at(6, 10) }, 50)
  assert.equal(await morningTick(at(6, 12)), 'morning:2026-10-14')
  assert.match((await inbox())[0].body, /^.*\n1 reminder: renew the domain\n/)
})

test('one held done while the summary went out: the reminders line is put right before the phone buzzes', async () => {
  await put('aaaaaa000001', 'renew the domain')
  await put('aaaaaa000002', 'call mum')
  const real = notes.add
  let once = true
  notes.add = async (n) => {
    const r = await real(n)
    if (once) (once = false), await store.done('owner', 'aaaaaa000001', at(6, 0)) // (the route ran meanwhile)
    return r
  }
  assert.equal(await morningTick(at(6, 0)), 'morning:2026-10-14')
  await settle()
  notes.add = real
  const list = await inbox()
  assert.equal(list.length, 1) // (the same tag: the first one was replaced)
  assert.equal(list[0].body, `${WEATHER}\n1 reminder: call mum\nAll servers up`)
  assert.deepEqual(pushes.map((p) => p.body), [list[0].body])
})

test('all of them held done while it went out: no reminders line, the summary itself still goes', async () => {
  await put('aaaaaa000001', 'renew the domain')
  const real = notes.add
  let once = true
  notes.add = async (n) => {
    const r = await real(n)
    if (once) (once = false), await store.done('owner', 'aaaaaa000001', at(6, 0))
    return r
  }
  assert.equal(await morningTick(at(6, 0)), 'morning:2026-10-14')
  await settle()
  notes.add = real
  const [n] = await inbox()
  assert.equal(n.body, `${WEATHER}\nAll servers up`)
  assert.equal(pushes.length, 1)
  assert.equal(pushes[0].body, n.body)
})

test('switched off: Reminders\' own 06:00 notice instead, exactly as before (only with something open)', async () => {
  await store.setPrefs('owner', { morning: false })
  assert.equal(await morningTick(at(6, 0)), null) // nothing open: nothing at all
  assert.deepEqual(await inbox(), [])
  await put('aaaaaa000001', 'renew the domain', '2026-10-11')
  await put('aaaaaa000002', 'call mum')
  assert.equal(await morningTick(at(6, 1)), 'todo:2026-10-14')
  await settle()
  const [n, ...more] = await inbox()
  assert.equal(more.length, 0)
  assert.equal(n.title, '2 reminders today')
  assert.equal(n.body, "• renew the domain\n• call mum\nCarried for 3 days. Hold each one when it's done.")
  assert.deepEqual([n.source, n.tag], ['Reminders', 'todo:2026-10-14'])
  assert.deepEqual(pushes.map((p) => p.tag), ['todo:2026-10-14'])
  assert.deepEqual(asked, []) // (no weather, no machines asked)
  assert.equal(await morningTick(at(6, 2)), null) // once
  // and on again the next morning: the summary
  await store.setPrefs('owner', { morning: true })
  assert.equal(await morningTick(at(6, 0, 15)), 'morning:2026-10-15')
})

test('switched off at 06:05, after the summary went: no second notice that morning', async () => {
  await put('aaaaaa000001', 'renew the domain')
  assert.equal(await morningTick(at(6, 0)), 'morning:2026-10-14')
  await store.setPrefs('owner', { morning: false })
  assert.equal(await morningTick(at(6, 5)), null)
  assert.deepEqual((await inbox()).map((n) => n.tag), ['morning:2026-10-14'])
})

test('switched on at 06:05, after Reminders\' own notice went: no second notice that morning', async () => {
  await put('aaaaaa000001', 'renew the domain')
  await store.setPrefs('owner', { morning: false })
  assert.equal(await morningTick(at(6, 0)), 'todo:2026-10-14')
  await store.setPrefs('owner', { morning: true })
  assert.equal(await morningTick(at(6, 5)), null)
  assert.equal(await morningTick(at(6, 6)), null)
  assert.deepEqual((await inbox()).map((n) => n.tag), ['todo:2026-10-14'])
  assert.deepEqual(asked, []) // (nothing fetched for it)
  assert.equal(await morningTick(at(6, 0, 15)), 'morning:2026-10-15') // the next morning: the summary
})

test('switched on with Reminders\' notice still being tried: if that one fails, the summary goes instead', async () => {
  await store.claimNudge('owner', 'todo:2026-10-14') // (another server, mid-send)
  assert.equal(await morningTick(at(6, 0)), null)
  await store.releaseNudge('owner', 'todo:2026-10-14') // (its send failed)
  assert.equal(await morningTick(at(6, 1)), 'morning:2026-10-14')
  await store.setPrefs('owner', { morning: false })
  await put('aaaaaa000001', 'renew the domain')
  assert.equal(await morningTick(at(6, 2)), null) // (and Reminders' own is settled with it)
  assert.deepEqual((await inbox()).map((n) => n.tag), ['morning:2026-10-14'])
})

test('the owner\'s zone (the Habits doc\'s): 06:00 there, not in Ho Chi Minh City', async () => {
  await globalThis.__homeHabitsStore.putDoc('owner', { tz: 'Europe/Berlin', habits: [] })
  assert.equal(await morningTick(at(6, 0)), null) // 01:00 in Berlin
  assert.equal(await morningTick(Date.UTC(2026, 9, 14, 4, 0)), 'morning:2026-10-14') // 06:00 CEST
})

test('the hub off (no token / database / owner): nothing sent, nothing claimed', async () => {
  delete process.env.NOTIFY_TOKEN
  assert.equal(await morningTick(at(6, 0)), null)
  env(true)
  assert.equal(await morningTick(at(6, 1)), 'morning:2026-10-14')
})

test('a send that fails gives the key back: the next tick sends it', async () => {
  const real = notes.add
  notes.add = async () => {
    throw new Error('database away')
  }
  assert.equal(await morningTick(at(6, 0)), null)
  notes.add = real
  // both keys given back: switched off now, Reminders' own notice could still go; on, the summary does
  assert.equal(await store.claimNudge('owner', 'todo:2026-10-14'), true)
  await store.releaseNudge('owner', 'todo:2026-10-14')
  assert.equal(await morningTick(at(6, 1)), 'morning:2026-10-14')
  assert.equal((await inbox()).length, 1)
})

test('the switch unreadable (the database away): nothing this minute, the next one tries again', async () => {
  const prefs = store.prefs
  store.prefs = async () => {
    throw new Error('down')
  }
  await assert.rejects(morningTick(at(6, 0))) // (the ticker catches it)
  store.prefs = prefs
  assert.equal(await morningTick(at(6, 1)), 'morning:2026-10-14')
})

test('the ticker: on the minute, once per process, sends at 06:00 and not again at 06:01', async () => {
  await put('aaaaaa000001', 'renew the domain')
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at(5, 59, 14) + 30_000 })
  try {
    delete globalThis.__homeMorningTicker
    startMorning()
    startMorning() // (a second call: no second ticker)
    const flush = async () => {
      for (let i = 0; i < 20; i++) await settle()
    }
    mock.timers.tick(TICK_MS) // 06:00:30 -> the first run (at :02 past the minute)
    await flush()
    assert.deepEqual((await inbox()).map((n) => n.tag), ['morning:2026-10-14'])
    mock.timers.tick(TICK_MS)
    await flush()
    assert.equal((await inbox()).length, 1)
    assert.equal(pushes.length, 1)
  } finally {
    mock.timers.reset()
    delete globalThis.__homeMorningTicker
  }
})

test('the ticker, switched off: Reminders\' notice at 06:00 (and still only once)', async () => {
  await put('aaaaaa000001', 'renew the domain')
  await store.setPrefs('owner', { morning: false })
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at(5, 59, 14) + 30_000 })
  try {
    delete globalThis.__homeMorningTicker
    startMorning()
    const flush = async () => {
      for (let i = 0; i < 20; i++) await settle()
    }
    mock.timers.tick(TICK_MS)
    await flush()
    mock.timers.tick(TICK_MS)
    await flush()
    assert.deepEqual((await inbox()).map((n) => n.tag), ['todo:2026-10-14'])
    assert.equal(pushes.length, 1)
  } finally {
    mock.timers.reset()
    delete globalThis.__homeMorningTicker
  }
})

test('13:00: the afternoon\'s, every reminder still open, the routines left (today\'s check-ins), no tomorrow', async () => {
  await put('aaaaaa000001', 'renew the domain', '2026-10-11')
  await store.add('owner', { id: 'aaaaaa000003', text: 'added at ten', day: '2026-10-14', at: at(10, 0) }, 50)
  const hs = globalThis.__homeHabitsStore
  await hs.putDoc('owner', { tz: 'Asia/Ho_Chi_Minh', habits: [habit('Workout', { kind: 'time', at: '06:15' }), habit('Read', { kind: 'any' }), habit('Piano', { kind: 'window', from: '19:00', to: '22:00' })] })
  await hs.check('owner', { habitId: 'workout', day: '2026-10-14', at: at(6, 20), late: false })
  await hs.check('owner', { habitId: 'readxx', day: '2026-10-13', at: at(9, 0, 13), late: false }) // (yesterday's doesn't count)
  assert.equal(await morningTick(at(12, 59)), null)
  assert.equal(await morningTick(at(13, 0)), 'afternoon:2026-10-14')
  await settle()
  const [n, ...more] = await inbox()
  assert.equal(more.length, 0)
  assert.equal(n.title, 'Good afternoon · Wed 14 Oct')
  assert.equal(n.body, `${WEATHER}\n2 reminders: renew the domain · added at ten\n2 routines left · 1 done · next: Piano 19:00\nAll servers up`)
  assert.deepEqual([n.source, n.tag], ['Summary', 'afternoon:2026-10-14'])
  assert.deepEqual(pushes.map((p) => p.tag), ['afternoon:2026-10-14'])
  assert.deepEqual(asked, [['weather', 'owner', false], ['hosts']])
  assert.equal(await morningTick(at(13, 1)), null) // once
  assert.equal(await morningTick(at(13, 30)), null)
  // Reminders' own morning key isn't touched: it has nothing to do with the afternoon
  assert.equal(await store.claimNudge('owner', 'todo:2026-10-14'), true)
})

test('18:00: the evening\'s, with tomorrow\'s weather under today\'s', async () => {
  assert.equal(await morningTick(at(18, 0)), 'evening:2026-10-14')
  const [n] = await inbox()
  assert.equal(n.title, 'Good evening · Wed 14 Oct')
  assert.equal(n.body, `${WEATHER}\n${TOMORROW}\nAll servers up`)
  assert.deepEqual(asked, [['weather', 'owner', true], ['hosts']])
  assert.equal(await morningTick(at(18, 29)), null)
})

test('all three in a day, each once; the morning\'s still the one that settles Reminders\' notice', async () => {
  await put('aaaaaa000001', 'renew the domain')
  const sent = []
  for (const [h, m] of [[6, 0], [6, 1], [13, 0], [13, 15], [18, 0], [18, 29], [18, 30], [23, 0]]) sent.push(await morningTick(at(h, m)))
  assert.deepEqual(sent.filter(Boolean), ['morning:2026-10-14', 'afternoon:2026-10-14', 'evening:2026-10-14'])
  await settle()
  assert.deepEqual(pushes.map((p) => p.tag), ['morning:2026-10-14', 'afternoon:2026-10-14', 'evening:2026-10-14'])
})

test('switched off: no afternoon or evening summary at all', async () => {
  await put('aaaaaa000001', 'renew the domain')
  await store.setPrefs('owner', { morning: false })
  assert.equal(await morningTick(at(13, 0)), null)
  assert.equal(await morningTick(at(18, 0)), null)
  assert.deepEqual(await inbox(), [])
  assert.deepEqual(asked, [])
})
