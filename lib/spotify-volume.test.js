import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VOL_LAG, pollCounts, settle, volumeAnswer } from './spotify-volume.js'

const kitchen = { name: 'Kitchen', type: 'Speaker', volume: 30, supportsVolume: true }

test('settle: a read that began before a change (or while Spotify lags) keeps the level that was set', () => {
  const last = { at: 1000, level: 80, name: 'Kitchen' }
  assert.deepEqual(settle(kitchen, 900, last), { ...kitchen, volume: 80 }) // began before the change, answered after it
  assert.deepEqual(settle(kitchen, 1000 + VOL_LAG, last), { ...kitchen, volume: 80 }) // Spotify still has the old level
  assert.equal(settle(kitchen, 1001 + VOL_LAG, last), kitchen) // long after: Spotify's word
  assert.equal(settle(kitchen, 900, null), kitchen) // no change made yet
  assert.equal(settle(null, 900, last), null) // nothing active
  assert.equal(settle({ ...kitchen, name: 'iPhone' }, 900, last).volume, 30) // another device: its own level
  assert.equal(settle(kitchen, 900, { ...last, name: null }).volume, 80) // set before the device was known: same one
  assert.equal(settle({ ...kitchen, volume: null, supportsVolume: false }, 900, last).volume, null) // no level reported
  const s = settle({ ...kitchen, supportsVolume: false }, 900, last)
  assert.equal(s.supportsVolume, false) // only the level is kept, the rest is the read's
})

test('pollCounts: a poll sent before the slider last moved, or while a change is out, is dropped', () => {
  assert.equal(pollCounts(2000, { changed: 1000, busy: false }), true)
  assert.equal(pollCounts(900, { changed: 1000, busy: false }), false) // left before the change: the old level
  assert.equal(pollCounts(1000, { changed: 1000, busy: false }), false)
  assert.equal(pollCounts(2000, { changed: 1000, busy: true }), false) // a change on its way wins
  assert.equal(pollCounts(5, { changed: 0, busy: false }), true) // never moved
})

test('volumeAnswer: OK answers count in order of sending, only the newest settles the slider', () => {
  // two changes out, 1 (50) then 2 (70)
  let m = { latest: 2, applied: 0 }
  // the older one's OK lands first: Spotify's level is taken, the slider waits for the newer one
  assert.deepEqual(volumeAnswer(m, 1, true), { device: true, settle: false })
  m = { ...m, applied: 1 }
  // the newer one fails: settles, and the rollback shows 50 (the older OK), not the level from before both
  assert.deepEqual(volumeAnswer(m, 2, false), { device: false, settle: true })
  // the other order: the newer OK first, then the older OK must not put 50 back
  m = { latest: 2, applied: 2 }
  assert.deepEqual(volumeAnswer(m, 1, true), { device: false, settle: false })
  // an older failure: nothing (no error shown while a newer change is still out)
  assert.deepEqual(volumeAnswer({ latest: 2, applied: 0 }, 1, false), { device: false, settle: false })
  // the only change, OK
  assert.deepEqual(volumeAnswer({ latest: 1, applied: 0 }, 1, true), { device: true, settle: true })
  assert.deepEqual(volumeAnswer({ latest: 1, applied: 0 }, 1, undefined), { device: false, settle: true }) // no answer at all
})
