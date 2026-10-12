// lib/gate.js pageAccess: what the page's server render may assume about the visitor from the proxy's headers, and
// that anything the proxy didn't vouch for (no x-home-sync, a wrong one, a Remote-User of the client's own) says nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageAccess } from './gate.js'

const GATE = 'gate-secret-for-tests-0123456789', SYNC = 'sync-secret-for-tests-0123456789'
const vars = { GATE_SECRET: GATE, SYNC_SECRET: SYNC, OWNER_USER: 'owner', DATABASE_URL: 'postgres://unused', NOTIFY_TOKEN: 'notify-token-for-tests-0123456789' }
const env = (on, over = {}) => {
  for (const [k, v] of Object.entries({ ...vars, ...over })) on && v != null ? (process.env[k] = v) : delete process.env[k]
}
test.beforeEach(() => env(true))
test.after(() => env(false))
const access = (headers) => pageAccess(new Headers(headers))

test('no word from the proxy: everything unknown, the browser asks as before', () => {
  assert.deepEqual(access({}), { owner: null, priv: null, notify: false })
  // a client's own Remote-User, or a guessed secret, changes nothing
  assert.deepEqual(access({ 'remote-user': 'owner' }), { owner: null, priv: null, notify: false })
  assert.deepEqual(access({ 'remote-user': 'owner', 'x-home-sync': 'nope-nope-nope-nope-nope' }), { owner: null, priv: null, notify: false })
})

test('the owner, signed in: owner, private and the hub', () => {
  assert.deepEqual(access({ 'x-home-sync': SYNC, 'remote-user': 'owner' }), { owner: true, priv: true, notify: true })
  assert.deepEqual(access({ 'x-home-sync': SYNC, 'x-home-gate': GATE, 'remote-user': 'owner' }), { owner: true, priv: true, notify: true })
})

test('a guest Authelia turned away: not the owner, locked (unless the LAN proxy vouches for the private part)', () => {
  assert.deepEqual(access({ 'x-home-sync': SYNC }), { owner: false, priv: false, notify: false })
  assert.deepEqual(access({ 'x-home-sync': SYNC, 'remote-user': '' }), { owner: false, priv: false, notify: false })
  assert.deepEqual(access({ 'x-home-sync': SYNC, 'x-home-gate': GATE }), { owner: false, priv: true, notify: false })
})

test('someone else signed in: not the owner; the private part is theirs to find out', () => {
  assert.deepEqual(access({ 'x-home-sync': SYNC, 'remote-user': 'friend' }), { owner: false, priv: null, notify: false })
})

test('the gate alone: the private part, nothing about the owner', () => {
  assert.deepEqual(access({ 'x-home-gate': GATE, 'remote-user': 'owner' }), { owner: null, priv: true, notify: false })
})

test('not set up: no sync secret, no database or no owner name -> no owner', () => {
  env(true, { SYNC_SECRET: null })
  assert.deepEqual(access({ 'x-home-sync': SYNC, 'remote-user': 'owner' }), { owner: null, priv: null, notify: false })
  env(true, { DATABASE_URL: null })
  assert.equal(access({ 'x-home-sync': SYNC, 'remote-user': 'owner' }).owner, false)
  env(true, { OWNER_USER: null })
  assert.equal(access({ 'x-home-sync': SYNC, 'remote-user': 'owner' }).owner, false)
  env(true, { NOTIFY_TOKEN: null })
  assert.deepEqual(access({ 'x-home-sync': SYNC, 'remote-user': 'owner' }), { owner: true, priv: true, notify: false })
})
