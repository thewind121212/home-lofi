import { test } from 'node:test'
import assert from 'node:assert/strict'
import { privateAnswer, retryIn } from './private-poll.js'

test('privateAnswer: only a real "no" locks the panel; a deploy restart or a blip retries', () => {
  assert.equal(privateAnswer(200), 'ok')
  assert.equal(privateAnswer(0, 'opaqueredirect'), 'locked') // the login redirect
  assert.equal(privateAnswer(302), 'locked')
  for (const s of [401, 403, 404]) assert.equal(privateAnswer(s), 'locked', String(s))
  for (const s of [0, 429, 500, 502, 503, 504]) assert.equal(privateAnswer(s), 'retry', String(s))
})

test('retryIn: 5 s, then doubling, at most a minute', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(retryIn), [5000, 10000, 20000, 40000, 60000, 60000])
})
