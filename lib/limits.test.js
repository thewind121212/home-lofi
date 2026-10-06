import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIp, slots, windowLimit } from './limits.js'

const req = (headers) => new Request('http://x/', { headers })

test('clientIp: first X-Forwarded-For entry, else X-Real-IP, else unknown', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2, 172.18.0.5', 'x-real-ip': '10.0.0.2' })), '203.0.113.7')
  assert.equal(clientIp(req({ 'x-forwarded-for': '2001:db8::1' })), '2001:db8::1')
  assert.equal(clientIp(req({ 'x-forwarded-for': 'not an ip', 'x-real-ip': '10.0.0.9' })), '10.0.0.9')
  assert.equal(clientIp(req({})), 'unknown')
})

test('windowLimit: max hits per key in a sliding window', () => {
  let t = 0
  const hit = windowLimit(2, 1000, () => t)
  assert.equal(hit('a'), true)
  assert.equal(hit('a'), true)
  assert.equal(hit('a'), false)
  assert.equal(hit('b'), true) // its own bucket
  t = 999
  assert.equal(hit('a'), false)
  t = 1000
  assert.equal(hit('a'), true)
})

test('slots: per key and total, release once', () => {
  const take = slots(2, 3)
  const a1 = take('a'), a2 = take('a')
  assert.ok(a1 && a2)
  assert.equal(take('a'), null)
  const b1 = take('b')
  assert.ok(b1)
  assert.equal(take('c'), null) // total full
  a1()
  a1() // twice is still one
  assert.ok(take('c'))
  assert.equal(take('d'), null)
})
