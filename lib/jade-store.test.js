// Talk to Jade's history store (lib/jade-store.js): the in-memory one the route's tests use, which the Postgres one
// mirrors: newest first, paging, KEEP, per owner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEEP, memoryStore } from './jade-store.js'

test('memoryStore: newest first, pages, only past KEEP the oldest go, per owner', async () => {
  const s = memoryStore()
  for (let i = 0; i < KEEP + 3; i++) await s.add('o', { via: 'voice', me: `m${i}` })
  await s.add('x', { via: 'text', me: 'other' })
  const first = await s.list('o', { limit: 3 })
  assert.deepEqual(first.turns.map((t) => t.me), [`m${KEEP + 2}`, `m${KEEP + 1}`, `m${KEEP}`])
  assert.equal(first.more, true)
  assert.deepEqual(Object.keys(first.turns[0]).sort(), ['at', 'emoji', 'id', 'jade', 'me', 'via'])
  const all = await s.list('o', { limit: KEEP + 10 })
  assert.equal(all.turns.length, KEEP)
  assert.equal(all.turns.at(-1).me, 'm3')
  await s.clear('o')
  assert.equal((await s.list('o')).turns.length, 0)
  assert.equal((await s.list('x')).turns[0].me, 'other')
})
