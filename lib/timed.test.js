// Timed reminders (lib/timed.js), their route (app/api/private/settings/reminders/timed) and the due ticker
// (lib/timed-ticker.js). No network: the reminders API is a stand-in in memory (globalThis.__homeTimedFetch) that
// answers like the real one; the stores are memoryStore()s and the push service only counts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import { cleanTimed, cleanTimedAction, dayOf, dueKey, dueNotice, groupsOf, isoOf, localOf, parsedTime, ringAt, whenLabel } from './timed.js'
import { GET, POST } from '../app/api/private/settings/reminders/timed/route.js'
import { timedTick } from './timed-ticker.js'
import { memoryStore as remMemory } from './reminders-store.js'
import { memoryStore as notifyMemory } from './notify-store.js'
import { memoryStore as pushMemory } from './push-store.js'
import { memoryStore as habitsMemory } from './habits-store.js'

const T = (s) => Date.parse(`${s}+07:00`) // a time in Ho Chi Minh City
const NOW = T('2026-10-23T14:00:00')
const raw = (o = {}) => ({ id: 1, title: 'Gọi mẹ', text: null, due_at: '2026-10-23T19:00:00+07:00', all_day: false, repeat: 'none', status: 'open', created_at: '2026-10-23T13:00:00+07:00', done_at: null, snoozed_until: null, is_due: false, ...o })

test('cleanTimed: known fields, times as ms; anything odd is dropped', () => {
  assert.deepEqual(cleanTimed(raw()), { id: 1, title: 'Gọi mẹ', due: T('2026-10-23T19:00:00'), allDay: false, repeat: 'none', status: 'open', doneAt: null, snoozed: null, created: T('2026-10-23T13:00:00') })
  assert.equal(cleanTimed(raw({ id: '1' })), null)
  assert.equal(cleanTimed(raw({ title: '  ' })), null)
  assert.equal(cleanTimed(raw({ status: 'weird' })), null)
  assert.equal(cleanTimed(raw({ repeat: 'hourly' })).repeat, 'none')
  assert.equal(cleanTimed(raw({ title: 'a\nb\u001b[31m' })).title, 'a b [31m')
  assert.equal(cleanTimed(raw({ due_at: 'soon' })).due, null)
})

test('groupsOf: due now, later today, coming up (by time), no time; a snooze rings at its own time', () => {
  const items = [
    raw({ id: 1, due_at: '2026-10-23T13:00:00+07:00' }),
    raw({ id: 2, due_at: '2026-10-23T19:00:00+07:00' }),
    raw({ id: 3, due_at: '2026-10-24T08:00:00+07:00' }),
    raw({ id: 4, due_at: null }),
    raw({ id: 5, due_at: '2026-10-23T12:00:00+07:00', snoozed_until: '2026-10-23T14:10:00+07:00' }),
    raw({ id: 6, due_at: '2026-10-23T11:00:00+07:00' }),
    raw({ id: 7, status: 'done', due_at: '2026-10-23T10:00:00+07:00' }),
  ].map(cleanTimed)
  const g = groupsOf(items, NOW)
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((i) => i.id)])), { due: [6, 1], today: [5, 2], soon: [3], none: [4] })
  assert.equal(ringAt(items[4]), T('2026-10-23T14:10:00'))
})

test('whenLabel: today / tomorrow / yesterday / a date; whole days without the hour', () => {
  assert.equal(whenLabel(T('2026-10-23T19:00:00'), false, NOW), '19:00 today')
  assert.equal(whenLabel(T('2026-10-24T08:00:00'), false, NOW), 'tomorrow 08:00')
  assert.equal(whenLabel(T('2026-10-22T21:30:00'), false, NOW), 'yesterday 21:30')
  assert.equal(whenLabel(T('2026-10-30T19:00:00'), false, NOW), 'Fri 30/10 19:00')
  assert.equal(whenLabel(T('2026-11-05T08:00:00'), true, NOW), 'Thu 5/11')
  assert.equal(whenLabel(T('2026-10-23T08:00:00'), true, NOW), 'today')
  assert.equal(whenLabel(null, false, NOW), 'no time')
  // the day turns at midnight in Ho Chi Minh City, not UTC
  assert.equal(dayOf(T('2026-10-24T00:30:00')), '2026-10-24')
})

test('isoOf / localOf: the edit form\'s values, read in +07:00', () => {
  assert.equal(isoOf('2026-10-23T19:05'), '2026-10-23T19:05:00+07:00')
  assert.equal(isoOf('2026-11-05'), '2026-11-05T08:00:00+07:00')
  for (const bad of ['2026-02-30', '2026-10-23T25:00', '23/10/2026', '', null, '2026-10-23T19:05:00']) assert.equal(isoOf(bad), null, String(bad))
  assert.equal(localOf(T('2026-10-23T19:05:00'), false), '2026-10-23T19:05')
  assert.equal(localOf(T('2026-11-05T08:00:00'), true), '2026-11-05')
  assert.equal(localOf(null), '')
})

test('cleanTimedAction: what the page may send', () => {
  assert.deepEqual(cleanTimedAction({ action: 'add', text: '  7h tối  gọi mẹ ' }), { act: { action: 'add', text: '7h tối gọi mẹ', plain: false } })
  assert.equal(cleanTimedAction({ action: 'add', text: 'x'.repeat(141) }).field, 'text')
  assert.deepEqual(cleanTimedAction({ action: 'snooze', id: 3 }), { act: { action: 'snooze', id: 3, minutes: 10 } })
  assert.equal(cleanTimedAction({ action: 'snooze', id: 3, minutes: 0 }).field, 'minutes')
  assert.equal(cleanTimedAction({ action: 'done', id: '3' }).field, 'id')
  assert.equal(cleanTimedAction({ action: 'nuke', id: 3 }).field, 'action')
  assert.deepEqual(cleanTimedAction({ action: 'edit', id: 3, title: 'Call mom', when: '2026-10-23T20:00', repeat: 'daily' }).act.patch, { title: 'Call mom', due_at: '2026-10-23T20:00:00+07:00', all_day: false, repeat: 'daily' })
  assert.deepEqual(cleanTimedAction({ action: 'edit', id: 3, when: '2026-11-05' }).act.patch, { due_at: '2026-11-05T08:00:00+07:00', all_day: true })
  assert.deepEqual(cleanTimedAction({ action: 'edit', id: 3, when: null }).act.patch, { due_at: null, all_day: false })
  assert.equal(cleanTimedAction({ action: 'edit', id: 3 }).field, 'edit')
  assert.equal(cleanTimedAction({ action: 'edit', id: 3, repeat: 'yearly' }).field, 'repeat')
})

test('parsedTime: only a sentence with a time goes to the API', () => {
  assert.deepEqual(parsedTime({ title: 'Gọi mẹ', due_at: '2026-10-23T19:00:00+07:00', all_day: false, repeat: 'none' }), { title: 'Gọi mẹ', due_at: '2026-10-23T19:00:00+07:00', all_day: false, repeat: 'none' })
  assert.equal(parsedTime({ title: 'Mua sữa', due_at: null }), null)
  assert.equal(parsedTime({ title: '', due_at: '2026-10-23T19:00:00+07:00' }), null)
  assert.equal(parsedTime(null), null)
})

test('dueNotice / dueKey: a new key for each time it rings', () => {
  const i = cleanTimed(raw({ repeat: 'daily' }))
  const n = dueNotice(i, NOW)
  assert.equal(n.title, 'Gọi mẹ')
  assert.equal(n.tag, 'remind:1')
  assert.equal(n.level, 'warning')
  assert.match(n.body, /^Due 19:00 today · repeats every day/)
  const snoozed = { ...i, snoozed: T('2026-10-23T19:10:00') }
  assert.notEqual(dueKey(i), dueKey(snoozed))
  assert.match(dueNotice(snoozed, NOW).body, /^Snoozed, now 19:10 today/)
})

// ---- the stand-in API ----------------------------------------------------------------------------------------------

const iso = (t) => (t == null ? null : new Date(t + 7 * 3600_000).toISOString().slice(0, 19) + '+07:00')
function fakeApi(clock) {
  const rows = new Map()
  let next = 1
  const calls = []
  const parse = (text) => {
    if (/fail/.test(text)) return null
    const m = /(\d+)h tối/.exec(text)
    const title = text.replace(/^(nhắc tôi )?\d+h tối /, '').replace(/^./, (c) => c.toUpperCase())
    return { title: m ? title : 'Bản dịch', due_at: m ? `${dayOf(clock())}T${String(12 + Number(m[1])).padStart(2, '0')}:00:00+07:00` : null, all_day: false, repeat: /mỗi ngày/.test(text) ? 'daily' : 'none' }
  }
  const out = (r) => ({ ...r, is_due: r.status === 'open' && Date.parse(r.snoozed_until ?? r.due_at ?? 'x') <= clock() })
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  return {
    rows,
    calls,
    fetch: async (url, init = {}) => {
      const u = new URL(url)
      const body = init.body ? JSON.parse(init.body) : null
      calls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`)
      const p = u.pathname
      if (p === '/api/parse') {
        const r = parse(body.text)
        return r ? res(200, r) : res(503, { error: 'model failed' })
      }
      if (p === '/api/reminders' && init.method === 'POST') {
        const r = { id: next++, title: body.title, text: null, due_at: body.due_at, all_day: body.all_day ?? false, repeat: body.repeat ?? 'none', status: 'open', created_at: iso(clock()), done_at: null, snoozed_until: null }
        rows.set(r.id, r)
        return res(201, out(r))
      }
      if (p === '/api/reminders') {
        const st = u.searchParams.get('status')
        return res(200, { now: iso(clock()), reminders: [...rows.values()].filter((r) => st === 'all' || r.status === st).map(out) })
      }
      if (p === '/api/reminders/due') return res(200, { now: iso(clock()), reminders: [...rows.values()].map(out).filter((r) => r.is_due) })
      const m = /^\/api\/reminders\/(\d+)(?:\/(\w+))?$/.exec(p)
      const r = m && rows.get(Number(m[1]))
      if (!r) return res(404, { error: 'not found' })
      if (init.method === 'DELETE') return rows.delete(r.id), res(200, { deleted: r.id })
      if (m[2] === 'done') {
        if (r.repeat === 'daily') r.due_at = iso(Date.parse(r.due_at) + 86400_000)
        else Object.assign(r, { status: 'done', done_at: iso(clock()) })
        r.snoozed_until = null
      } else if (m[2] === 'reopen') Object.assign(r, { status: 'open', done_at: null })
      else if (m[2] === 'snooze') r.snoozed_until = iso(clock() + body.minutes * 60_000)
      else if (init.method === 'PATCH') Object.assign(r, body, 'due_at' in body ? { snoozed_until: null } : {})
      return res(200, out(r))
    },
  }
}

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', REMIND_URL: 'http://reminders.test:8098', NOTIFY_TOKEN: 'notify-token-for-tests-0123456789' }
let api, now, rem, notes, pushes
test.beforeEach(async () => {
  Object.assign(process.env, VARS)
  now = NOW
  api = fakeApi(() => now)
  globalThis.__homeTimedFetch = api.fetch
  rem = globalThis.__homeRemindersStore = remMemory()
  globalThis.__homeHabitsStore = habitsMemory()
  notes = globalThis.__homeNotifyStore = notifyMemory(() => now)
  const push = (globalThis.__homePushStore = pushMemory())
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  await push.add('owner', { endpoint: 'https://web.push.apple.com/QKtest', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, 'iPhone')
  pushes = []
  globalThis.__homePushSend = async (sub, body) => void pushes.push(JSON.parse(body))
})
test.after(() => {
  for (const k of Object.keys(VARS)) delete process.env[k]
  for (const k of ['__homeTimedFetch', '__homeRemindersStore', '__homeHabitsStore', '__homeNotifyStore', '__homePushStore', '__homePushSend']) delete globalThis[k]
})
const U = 'http://home.test/api/private/settings/reminders/timed'
const get = async (q = '', headers = OWNER) => {
  const r = await GET(new Request(U + q, { headers }))
  return { status: r.status, body: await r.json() }
}
const post = async (body, headers = OWNER) => {
  const r = await POST(new Request(U, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}

test('route: owner-only, and off (404) without REMIND_URL', async () => {
  assert.equal((await get('', {})).status, 404)
  assert.equal((await get('', { ...OWNER, 'remote-user': 'eve' })).status, 403)
  delete process.env.REMIND_URL
  assert.equal((await get()).status, 404)
  assert.equal(api.calls.length, 0)
})

test('route: a sentence with a time goes to the API; without one, onto the carry-over list as typed', async () => {
  const a = await post({ action: 'add', text: 'nhắc tôi 7h tối gọi mẹ' })
  assert.equal(a.status, 200)
  assert.deepEqual(a.body.added, { kind: 'timed', title: 'Gọi mẹ', due: T('2026-10-23T19:00:00'), allDay: false, repeat: 'none' })
  assert.equal(a.body.items.length, 1)
  const b = await post({ action: 'add', text: 'renew the domain' })
  assert.deepEqual(b.body.added, { kind: 'todo', title: 'renew the domain' }) // (not the model's "Bản dịch")
  assert.deepEqual((await rem.open('owner')).map((i) => i.text), ['renew the domain'])
  assert.equal(api.rows.size, 1)
  // the model failed: 503 with plain, nothing saved; plain: true saves it without asking the model
  const c = await post({ action: 'add', text: 'fail this one' })
  assert.equal(c.status, 503)
  assert.equal(c.body.plain, true)
  const before = api.calls.length
  assert.equal((await post({ action: 'add', text: 'fail this one', plain: true })).body.added.kind, 'todo')
  assert.equal(api.calls.slice(before).filter((x) => x.includes('/api/parse')).length, 0)
})

test('route: done, snooze, edit, delete, reopen; history merges both lists', async () => {
  await post({ action: 'add', text: '7h tối gọi mẹ' })
  await post({ action: 'add', text: 'mua sữa' })
  const [todo] = await rem.open('owner')
  await rem.done('owner', todo.id, NOW - 60_000)
  assert.equal((await post({ action: 'snooze', id: 1 })).body.items[0].snoozed, NOW + 600_000)
  const e = await post({ action: 'edit', id: 1, title: 'Call mom', when: '2026-10-23T20:00' })
  assert.equal(e.body.items[0].title, 'Call mom')
  assert.equal(e.body.items[0].due, T('2026-10-23T20:00:00'))
  assert.equal(e.body.items[0].snoozed, null)
  assert.deepEqual((await post({ action: 'done', id: 1 })).body.items, [])
  const h = await get('?history=1')
  assert.deepEqual(h.body.done.map((d) => [d.kind, d.title]), [['timed', 'Call mom'], ['todo', 'mua sữa']])
  assert.deepEqual((await post({ action: 'reopen', id: 1 })).body.items.map((i) => i.id), [1])
  assert.deepEqual((await post({ action: 'delete', id: 1 })).body.items, [])
  assert.equal((await post({ action: 'done', id: 99 })).status, 404)
  assert.equal((await post({ action: 'edit', id: 1, when: 'later' })).status, 400)
})

test('route: the API down is a 502, never its address', async () => {
  globalThis.__homeTimedFetch = async () => { throw new Error('connect ECONNREFUSED 10.10.0.162:8098') }
  const r = await get()
  assert.equal(r.status, 502)
  assert.doesNotMatch(JSON.stringify(r.body), /10\.10|8098/)
})

test('ticker: each due one is sent once (bell + phone); a snooze rings again later; done takes it off the bell', async () => {
  await post({ action: 'add', text: '7h tối gọi mẹ' })
  assert.deepEqual(await timedTick(now, 'owner'), []) // not yet
  now = T('2026-10-23T19:00:30')
  assert.equal((await timedTick(now, 'owner')).length, 1)
  assert.deepEqual(await timedTick(now + 30_000, 'owner'), []) // once
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(pushes.map((p) => [p.title, p.level]), [['Gọi mẹ', 'warning']])
  assert.deepEqual((await notes.list('owner')).items.map((i) => i.tag), ['remind:1'])
  // snoozed: off the bell now, back in 10 minutes
  await post({ action: 'snooze', id: 1 })
  assert.deepEqual((await notes.list('owner')).items, [])
  assert.deepEqual(await timedTick(now + 60_000, 'owner'), [])
  now += 11 * 60_000
  assert.equal((await timedTick(now, 'owner')).length, 1)
  await post({ action: 'done', id: 1 })
  assert.deepEqual((await notes.list('owner')).items, [])
})
