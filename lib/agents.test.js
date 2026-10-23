// Agents' messages (lib/agents.js) and their channel through the hub's routes: what a sender must send, how the state
// decides the look and the alerts, one card per session, a list and read state apart from the services' notices, and
// pushes only for needs-you / failed. No database, no network: memoryStore()s and a stand-in push service.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import { agentItem, agentPush, agentView, blocksOf, byProject, cleanAgent, counts, isLong, spansOf } from './agents.js'
import { POST as send } from '../app/api/notify/route.js'
import { GET as list, POST as act } from '../app/api/private/settings/notifications/route.js'
import { memoryStore } from './notify-store.js'
import { memoryStore as pushMemory } from './push-store.js'

const MSG = { kind: 'agent', agent: 'Claude Code · linh-3', project: 'musoni', state: 'needs-you', title: 'Allow git push?' }

test('cleanAgent: agent, project, state and title are required; the rest is checked', () => {
  const ok = cleanAgent({ ...MSG, content: 'Line one\n- a\n- b', session: 'abc-123', url: 'https://github.com/x/y/pull/1', ttl: 3600 })
  assert.deepEqual(ok, {
    notice: { kind: 'agent', agent: 'Claude Code · linh-3', project: 'musoni', title: 'Allow git push?', content: 'Line one\n- a\n- b', state: 'needs-you', session: 'abc-123', tag: 'agent:abc-123', url: 'https://github.com/x/y/pull/1', ttl: 3600 },
    warnings: [],
  })
  for (const f of ['agent', 'project', 'title']) {
    assert.deepEqual(cleanAgent({ ...MSG, [f]: undefined }), { error: `${f}: required`, field: f })
    assert.deepEqual(cleanAgent({ ...MSG, [f]: '  ' }), { error: `${f}: required`, field: f })
    assert.deepEqual(cleanAgent({ ...MSG, [f]: 5 }), { error: `${f}: must be a string`, field: f })
  }
  assert.equal(cleanAgent({ ...MSG, state: 'happy' }).field, 'state')
  assert.equal(cleanAgent({ ...MSG, state: undefined }).field, 'state')
  assert.equal(cleanAgent({ ...MSG, session: 'has space' }).field, 'session')
  assert.equal(cleanAgent({ ...MSG, ttl: 1 }).field, 'ttl')
  assert.equal(cleanAgent({ ...MSG, kind: 'notice' }).field, 'kind')
  assert.equal(cleanAgent([]).error, 'the body must be a JSON object')
})

test('cleanAgent: too long is cut (and said), a bad icon / url left out, unknown fields ignored', () => {
  const r = cleanAgent({ ...MSG, title: 'x'.repeat(150), content: 'y'.repeat(2500), icon: '🤖', url: 'javascript:alert(1)', level: 'error' })
  assert.equal(r.notice.title.length, 100)
  assert.ok(r.notice.title.endsWith('…'))
  assert.equal(r.notice.content.length, 2000)
  assert.equal(r.notice.icon, undefined)
  assert.equal(r.notice.url, undefined)
  assert.deepEqual(r.warnings, ['title: cut to 100 characters', 'content: cut to 2000 characters', 'icon: use fa-<name> (Font Awesome) or an https image URL; showing the robot', 'url: an http(s) address; no link', 'ignored: level'])
  // the title is one line; control characters go; the content keeps its newlines
  const s = cleanAgent({ ...MSG, title: 'a\nb\u001b[31m', content: 'one\r\ntwo\u0007' }).notice
  assert.equal(s.title, 'a b[31m')
  assert.equal(s.content, 'one\ntwo')
  assert.deepEqual(cleanAgent({ ...MSG, icon: 'fa:brain' }).notice.icon, { fa: 'fa-solid fa-brain' })
})

test('agentView: the state picks level, color, the source line, and silent for done / working', () => {
  const n = cleanAgent({ ...MSG, content: 'why' }).notice
  assert.deepEqual(agentView(n), { ...n, level: 'warning', color: 'highlight', icon: { fa: 'fa-solid fa-robot' }, source: 'Needs you · musoni', body: 'why' })
  assert.equal(agentView({ ...n, state: 'failed' }).level, 'error')
  assert.equal(agentView({ ...n, state: 'failed' }).silent, undefined)
  assert.equal(agentView({ ...n, state: 'done' }).silent, true)
  assert.equal(agentView({ ...n, state: 'working' }).silent, true)
  assert.equal(counts({ state: 'working' }), false)
  assert.equal(counts({ state: 'done' }), true)
})

test('agentPush: state · project, then title and content; quiet states stay silent', () => {
  const n = cleanAgent({ ...MSG, content: 'git push origin main', session: 's1' }).notice
  assert.deepEqual(agentPush(n), { title: 'Needs you · musoni', body: 'Allow git push?\ngit push origin main', level: 'warning', tag: 'agent:s1' })
  assert.equal(agentPush({ ...n, state: 'done' }).silent, true)
  assert.equal(agentPush({ ...n, state: 'failed' }).silent, undefined)
})

test('agentItem: a stored row is re-checked on the way out', () => {
  const row = { id: '7', created_at: new Date(1000), expires_at: null, data: { agent: 'a', project: 'p', state: 'done', title: 't', icon: { fa: 'fa-solid fa-brain' }, session: 's' } }
  const i = agentItem(row)
  assert.equal(i.id, 7)
  assert.equal(i.at, 1000)
  assert.equal(i.tag, 'agent:s')
  assert.deepEqual(i.icon, { fa: 'fa-solid fa-brain' })
  assert.equal(agentItem({ ...row, data: { ...row.data, state: 'weird' } }), null)
  assert.equal(agentItem({ ...row, data: { ...row.data, icon: { fa: 'evil" onload="x' } } }).icon.fa, 'fa-solid fa-robot')
})

test('byProject: projects in order of their newest message', () => {
  const items = [{ id: 5, project: 'b' }, { id: 4, project: 'a' }, { id: 3, project: 'b' }]
  assert.deepEqual(byProject(items).map(([p, l]) => [p, l.map((i) => i.id)]), [['b', [5, 3]], ['a', [4]]])
})

test('blocksOf / spansOf: paragraphs, lists and `code`; never HTML', () => {
  assert.deepEqual(blocksOf('Done.\nAll green\n\n- one\n* two\n1. first\n2) second\nafter'), [
    { type: 'p', lines: ['Done.', 'All green'] },
    { type: 'ul', lines: ['one', 'two'] },
    { type: 'ol', lines: ['first', 'second'] },
    { type: 'p', lines: ['after'] },
  ])
  assert.deepEqual(blocksOf(''), [])
  assert.deepEqual(spansOf('run `npm test` now'), [{ text: 'run ', code: false }, { text: 'npm test', code: true }, { text: ' now', code: false }])
  assert.deepEqual(spansOf('a ` b'), [{ text: 'a ` b', code: false }])
  assert.deepEqual(spansOf('<b>x</b>'), [{ text: '<b>x</b>', code: false }])
  assert.equal(isLong('short'), false)
  assert.equal(isLong('a\nb\nc\nd'), true)
  assert.equal(isLong('x'.repeat(300)), true)
})

// ---- through the routes ----------------------------------------------------------------------------------------------

const TOKEN = 'notify-token-for-tests-0123456789'
const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const OWNER = { 'x-home-gate': GATE, 'x-home-sync': SYNC, 'remote-user': 'owner' }
const VARS = { NOTIFY_TOKEN: TOKEN, GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused' }
let pushes, ip = 0
test.beforeEach(async () => {
  Object.assign(process.env, VARS)
  globalThis.__homeNotifyStore = memoryStore()
  const push = (globalThis.__homePushStore = pushMemory())
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  await push.add('owner', { endpoint: 'https://web.push.apple.com/QKtest', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, 'iPhone')
  pushes = []
  globalThis.__homePushSend = async (sub, body) => void pushes.push(JSON.parse(body))
})
test.after(() => {
  for (const k of Object.keys(VARS)) delete process.env[k]
  for (const k of ['__homeNotifyStore', '__homePushStore', '__homePushSend']) delete globalThis[k]
})
const post = async (body) => {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.1.0.${(ip++ % 250) + 1}` }
  const r = await send(new Request('http://home.test/api/notify', { method: 'POST', headers, body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() }
}
const owner = async (ch, body) => {
  const u = `http://home.test/api/private/settings/notifications${ch ? `?ch=${ch}` : ''}`
  const init = { method: body ? 'POST' : 'GET', headers: { ...OWNER, ...(body && { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }) }, body: body && JSON.stringify(body) }
  return (await (body ? act : list)(new Request(u, init))).json()
}
const settle = () => new Promise((r) => setTimeout(r, 20)) // (pushes go out in the background)

test('route: agents and services are two lists, each with its own read state and clear', async () => {
  assert.equal((await post({ title: 'Backup done' })).status, 201) // 1: a service
  assert.equal((await post({ ...MSG, session: 's1' })).status, 201) // 2: an agent
  assert.equal((await post({ title: 'Deployed' })).status, 201) // 3
  assert.deepEqual((await owner()).items.map((i) => i.id), [3, 1])
  const a = await owner('agents')
  assert.deepEqual(a.items.map((i) => [i.id, i.source, i.level]), [[2, 'Needs you · musoni', 'warning']])
  // reading one channel leaves the other unread
  assert.equal((await owner('agents', { action: 'read', upTo: 2 })).read, 2)
  assert.equal((await owner()).read, 0)
  // a service's id can't be dismissed or cleared through the agents' channel, nor the other way round
  await owner('agents', { action: 'dismiss', id: 1 })
  await owner(null, { action: 'dismiss', id: 2 })
  await owner('agents', { action: 'clear', upTo: 3 })
  assert.deepEqual((await owner()).items.map((i) => i.id), [3, 1])
  assert.deepEqual((await owner('agents')).items, [])
})

test('route: one card per session (working → needs-you → done); 400 for a bad message', async () => {
  await post({ ...MSG, state: 'working', title: 'Fixing the header', session: 'abc' })
  await post({ ...MSG, project: 'home-lofi', state: 'done', title: 'Other session', session: 'zzz' })
  await post({ ...MSG, session: 'abc' })
  await post({ ...MSG, state: 'done', title: 'Pushed', content: 'PR #195', session: 'abc' })
  const { items } = await owner('agents')
  assert.deepEqual(items.map((i) => [i.id, i.project, i.state, i.title]), [[4, 'musoni', 'done', 'Pushed'], [2, 'home-lofi', 'done', 'Other session']])
  // a service with the same tag text doesn't touch the agent's card
  await post({ title: 'x', tag: 'agent:abc' })
  assert.equal((await owner('agents')).items.length, 2)
  const bad = await post({ ...MSG, state: 'loud' })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.field, 'state')
  assert.equal((await post({ title: 'x', kind: 'robot' })).status, 400)
})

test('route: only needs-you and failed reach the phone', async () => {
  for (const state of ['working', 'done', 'needs-you', 'failed']) await post({ ...MSG, state, title: state, session: state })
  await settle()
  assert.deepEqual(pushes.map((p) => [p.title, p.body, p.level]), [['Needs you · musoni', 'needs-you', 'warning'], ['Failed · musoni', 'failed', 'error']])
})

test('route: a long Vietnamese content fits (2000 characters, ~6 KB of JSON)', async () => {
  const r = await post({ ...MSG, state: 'done', content: 'Đã xong việc nhé. '.repeat(120) })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.warnings, ['content: cut to 2000 characters'])
  assert.equal((await owner('agents')).items[0].content.length, 2000)
})
