import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CALM_MS, ambientTick, ambientView, ambientWake } from './ambient.js'

test('ambientView: the dashboard, with its dock and dim overlay, only when not in Ambient and not locked', () => {
  const v = ambientView()
  assert.deepEqual(v, { dashboard: true, dock: true, dim: true, blur: false, bar: 'none', clock: 'none', hint: false, catcher: false })
  for (const s of [{ ambient: 'hand' }, { ambient: 'auto' }, { locked: true }]) {
    const w = ambientView(s)
    assert.equal(w.dashboard, false)
    assert.equal(w.dock, false)
    assert.equal(w.dim, false)
  }
})

test('ambientView: Ambient shows the bar; calm fades it, and brings the clock only with "Scene + clock"', () => {
  assert.equal(ambientView({ ambient: 'hand' }).bar, 'shown')
  assert.equal(ambientView({ ambient: 'hand', calm: true }).bar, 'faded')
  // the clock stays mounted ('faded') while the bar is there, so it can fade in and out
  assert.equal(ambientView({ ambient: 'hand', idleShow: 'clock' }).clock, 'faded')
  assert.equal(ambientView({ ambient: 'hand', calm: true, idleShow: 'clock' }).clock, 'shown')
  assert.equal(ambientView({ ambient: 'hand', calm: true, idleShow: 'scene' }).clock, 'none')
  assert.equal(ambientView({ idleShow: 'clock' }).clock, 'none') // not in Ambient
})

test('ambientView: a tap on the bare scene leaves only while the bar is there', () => {
  assert.equal(ambientView({ ambient: 'hand' }).catcher, true)
  assert.equal(ambientView({ ambient: 'hand', calm: true }).catcher, false) // that tap only wakes the bar
  assert.equal(ambientView({ ambient: 'hand', locked: true }).catcher, false)
})

test('ambientView: the lock wins: no bar, no Ambient clock, no hint, the dashboard blurs', () => {
  const v = ambientView({ ambient: 'auto', calm: true, locked: true, idleShow: 'clock' })
  assert.equal(v.bar, 'none')
  assert.equal(v.clock, 'none')
  assert.equal(v.hint, false)
  assert.equal(v.blur, true)
  assert.equal(ambientView({ locked: true }).blur, true)
})

test('ambientView: Ambient that came on by itself blurs the dashboard away and hints "move to wake"', () => {
  assert.equal(ambientView({ ambient: 'auto', calm: true }).blur, true)
  assert.equal(ambientView({ ambient: 'auto', calm: true }).hint, true)
  assert.equal(ambientView({ ambient: 'hand', calm: true }).blur, false)
  assert.equal(ambientView({ ambient: 'hand', calm: true }).hint, false)
})

test('ambientTick: Ambient comes on by itself after the set time, starting calm', () => {
  assert.deepEqual(ambientTick({ after: 60, since: 59_000 }), { ambient: false, calm: false })
  assert.deepEqual(ambientTick({ after: 60, since: 60_000 }), { ambient: 'auto', calm: true })
  assert.deepEqual(ambientTick({ after: 0, since: 3_600_000 }), { ambient: false, calm: false }) // Off: never by itself
})

test('ambientTick: never by itself while busy (a dialog, a dropdown, typed text) or locked', () => {
  assert.deepEqual(ambientTick({ after: 30, since: 99_000, busy: true }), { ambient: false, calm: false })
  assert.deepEqual(ambientTick({ after: 30, since: 99_000, locked: true }), { ambient: false, calm: false })
})

test('ambientTick: the bar fades after CALM_MS without input, unless held or busy', () => {
  assert.ok(CALM_MS >= 3000 && CALM_MS <= 10_000)
  assert.deepEqual(ambientTick({ ambient: 'hand', since: CALM_MS - 1 }), { ambient: 'hand', calm: false })
  assert.deepEqual(ambientTick({ ambient: 'hand', since: CALM_MS }), { ambient: 'hand', calm: true })
  assert.deepEqual(ambientTick({ ambient: 'hand', since: CALM_MS, held: true }), { ambient: 'hand', calm: false })
  assert.deepEqual(ambientTick({ ambient: 'hand', since: CALM_MS, busy: true }), { ambient: 'hand', calm: false })
  // calm stays calm (only an input wakes it)
  assert.deepEqual(ambientTick({ ambient: 'hand', calm: true, since: 0 }), { ambient: 'hand', calm: true })
})

test('ambientTick: locked, nothing changes underneath (unlocking returns to where you were)', () => {
  assert.deepEqual(ambientTick({ ambient: 'hand', locked: true, since: 99_000 }), { ambient: 'hand', calm: false })
  assert.deepEqual(ambientTick({ ambient: 'auto', calm: true, locked: true }), { ambient: 'auto', calm: true })
})

test('ambientWake: an input wakes only a calm Ambient (and makes it someone\'s again)', () => {
  assert.deepEqual(ambientWake({ ambient: 'auto', calm: true }), { ambient: 'hand', calm: false })
  assert.deepEqual(ambientWake({ ambient: 'hand', calm: true }), { ambient: 'hand', calm: false })
  assert.equal(ambientWake({ ambient: 'hand', calm: false }), null) // the bar is there: the input acts
  assert.equal(ambientWake({ ambient: false }), null)
  assert.equal(ambientWake({ ambient: 'hand', calm: true, locked: true }), null) // the lock handles its own input
})
