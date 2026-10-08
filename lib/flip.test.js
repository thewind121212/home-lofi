import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EASE_OUT, MOVE_MS, flipPlan, flipSig, inView, limitShift, motionAllowed, moveDuration, springEasing, visibleBand } from './flip.js'

const box = (y, h = 50, x = 0) => ({ x, y, w: 300, h })
const snap = (o) => new Map(Object.entries(o))
const keys = (plan) => ({ move: plan.move.map((m) => m.key), enter: plan.enter, leave: plan.leave.map((l) => l.key) })

test('flipPlan: moved rows invert their move; new ones enter; gone ones leave', () => {
  // a skip: A goes up to the Now slot (same key, another list), B and C move up a row, D comes in, NOW goes
  const before = snap({ NOW: box(0), A: box(100), B: box(160), C: box(220) })
  const after = snap({ A: box(0), B: box(100), C: box(160), D: box(220) })
  const plan = flipPlan(before, after)
  assert.deepEqual(keys(plan), { move: ['A', 'B', 'C'], enter: ['D'], leave: ['NOW'] })
  assert.deepEqual(plan.move[0], { key: 'A', dx: 0, dy: 100, fade: false }) // starts where it was: 100 px lower
  assert.equal(plan.move[1].dy, 60)
  assert.equal(plan.leave[0].stay, false)
  assert.equal(plan.skipped, 0)
})

test('flipPlan: a reorder moves only the rows that changed place; sub-pixel shifts are not moves', () => {
  const before = snap({ A: box(0), B: box(60), C: box(120), D: box(180) })
  const after = snap({ A: box(0.3), C: box(60), B: box(120), D: box(180) })
  assert.deepEqual(keys(flipPlan(before, after)), { move: ['C', 'B'], enter: [], leave: [] })
  assert.deepEqual(keys(flipPlan(before, before)), { move: [], enter: [], leave: [] })
})

test('flipPlan: only rows near the visible band animate; far moves start just past the edge', () => {
  const view = { top: 0, bottom: 400 }
  const before = snap({ A: box(0), B: box(5000), C: box(6000), D: box(100), E: box(200) })
  const after = snap({ B: box(0), A: box(60), C: box(6060), E: box(7000), F: box(9000) })
  const plan = flipPlan(before, after, view, { margin: 100 })
  // C: out of sight before and after (nothing); F: enters out of sight (nothing); D: gone in sight
  assert.deepEqual(keys(plan), { move: ['B', 'A'], enter: [], leave: ['E', 'D'] })
  const b = plan.move[0]
  assert.equal(b.fade, true) // came from out of sight: fades in
  assert.equal(b.dy, 500) // 5000 px away, but it slides in from the band's height + margin
  assert.deepEqual(plan.leave[0], { key: 'E', stay: true }) // moved out of sight: a copy fades where it was
  assert.deepEqual(plan.leave[1], { key: 'D', stay: false })
})

test('flipPlan: at most `max` rows animate, the rest are counted as skipped', () => {
  const before = new Map()
  const after = new Map()
  for (let i = 0; i < 200; i++) before.set(`k${i}`, box(i * 50)), after.set(`k${i}`, box(i * 50 + 50))
  const plan = flipPlan(before, after, null, { max: 10 })
  assert.equal(plan.move.length, 10)
  assert.equal(plan.skipped, 190)
  assert.deepEqual(plan.move.map((m) => m.key), Array.from({ length: 10 }, (_, i) => `k${i}`)) // the first ones (top of the list)
})

test('inView / limitShift / visibleBand', () => {
  const view = { top: 100, bottom: 300 }
  assert.equal(inView(box(50, 49), view), false)
  assert.equal(inView(box(50, 51), view), true)
  assert.equal(inView(box(320), view), false)
  assert.equal(inView(box(320), view, 30), true)
  assert.equal(limitShift(-900, 400), -400)
  assert.equal(limitShift(120, 400), 120)
  assert.deepEqual(visibleBand({ top: -40, bottom: 2000 }, { h: 800 }), { top: 0, bottom: 800 }) // cut to the window
  assert.deepEqual(visibleBand(null, { h: 800 }), { top: 0, bottom: 800 })
  assert.deepEqual(visibleBand({ top: 900, bottom: 1200 }, { h: 800 }), { top: 900, bottom: 900 }) // off screen: empty
})

test('moveDuration: one row is quick, a long glide a little longer, within MOVE_MS', () => {
  const [lo, hi] = MOVE_MS
  assert.equal(moveDuration(0, 0), lo)
  assert.ok(moveDuration(0, 56) > lo && moveDuration(0, 56) < 240)
  assert.equal(moveDuration(0, -5000), hi)
  assert.ok(lo >= 220 && hi <= 280)
})

test('springEasing: a linear() curve from 0 to 1, fast start, soft landing, a hair of overshoot at most', () => {
  const e = springEasing()
  assert.match(e, /^linear\(0, [\d., ]+, 1\)$/)
  const v = e.slice(7, -1).split(', ').map(Number)
  assert.equal(v.length, 25)
  assert.equal(v[0], 0)
  assert.equal(v.at(-1), 1)
  assert.ok(v[6] > 0.6, `a quarter of the way in it's mostly there (${v[6]})`) // like an ease-out
  assert.ok(Math.max(...v) <= 1.01, 'no visible bounce')
  assert.ok(Math.abs(v.at(-2) - 1) < 0.01, 'settled before the end')
  assert.ok(springEasing({ damping: 1.5 }).startsWith('linear(0,')) // (clamped to a damped spring)
  assert.match(EASE_OUT, /^cubic-bezier\(/)
})

test('motionAllowed: Settings › Motion: Reduced or the OS setting turn it off', () => {
  assert.equal(motionAllowed({ setting: '', prefersReduced: false }), true)
  assert.equal(motionAllowed({ setting: undefined }), true)
  assert.equal(motionAllowed({ setting: 'reduce' }), false)
  assert.equal(motionAllowed({ setting: '', prefersReduced: true }), false)
})

test('flipSig: changes with the keys and their order only', () => {
  assert.equal(flipSig(['a', 'b']), flipSig(['a', 'b']))
  assert.notEqual(flipSig(['a', 'b']), flipSig(['b', 'a']))
  assert.notEqual(flipSig(['ab']), flipSig(['a', 'b']))
  assert.equal(flipSig([null, 1]), flipSig(['', '1']))
})
