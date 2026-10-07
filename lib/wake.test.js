import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WAKE_GUARD_MS, eatNextClick } from './wake.js'

// a window stand-in. A plain EventTarget has no capture phase, so the page's own click listener (which counts the
// clicks that got through) is added after the guard: registration order stands in for capture-first
function page(guard) {
  const t = new EventTarget()
  const off = guard(t)
  let clicks = 0
  t.addEventListener('click', () => clicks++)
  const click = () => {
    const e = new Event('click', { cancelable: true })
    t.dispatchEvent(e)
    return e.defaultPrevented
  }
  return { off, click, down: (e = new Event('pointerdown')) => t.dispatchEvent(e), clicks: () => clicks }
}

test('eatNextClick: the click that ends the waking press is swallowed, once', () => {
  const wake = new Event('pointerdown')
  const p = page((t) => eatNextClick(t, { from: wake }))
  p.down(wake) // the waking press itself (still on its way) doesn't let go
  assert.equal(p.click(), true)
  assert.equal(p.clicks(), 0)
  assert.equal(p.click(), false) // the next one is real
  assert.equal(p.clicks(), 1)
})

test('eatNextClick: a new press lets go (its click is real), so do the timeout and off()', async () => {
  const p = page((t) => eatNextClick(t)) // e.g. a swipe that never made a click
  p.down()
  p.click()
  assert.equal(p.clicks(), 1)

  const q = page((t) => eatNextClick(t, { ms: 20 }))
  await new Promise((r) => setTimeout(r, 40))
  q.click()
  assert.equal(q.clicks(), 1)

  const r = page((t) => eatNextClick(t))
  r.off()
  r.click()
  assert.equal(r.clicks(), 1)
})

test('the dashboard ignores the pointer for a moment after it comes back', () => {
  assert.ok(WAKE_GUARD_MS >= 300 && WAKE_GUARD_MS <= 600)
})
