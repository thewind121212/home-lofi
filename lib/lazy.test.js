import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAZY_MARGIN, askOrder, lazyWatcher, scrollRoot } from './lazy.js'

// a tiny DOM: { tagName, parentElement, style }
const node = (tagName, parentElement = null, style = {}) => ({ tagName, parentElement, style: { overflowX: 'visible', overflowY: 'visible', ...style } })
const styleOf = (e) => e.style

test('scrollRoot: the nearest box that scrolls, else the viewport (null)', () => {
  const html = node('HTML')
  const body = node('BODY', html, { overflowY: 'auto' }) // the page itself: still the viewport
  const sheet = node('DIALOG', body, { overflowY: 'hidden' }) // clips, but doesn't scroll
  const list = node('DIV', sheet, { overflowY: 'auto' }) // the Player sheet's [data-scroll]
  const ul = node('UL', list)
  const row = node('LI', ul)
  assert.equal(scrollRoot(row, styleOf), list)
  assert.equal(scrollRoot(node('SPAN', row), styleOf), list)
  const strip = node('DIV', ul, { overflowX: 'scroll' })
  assert.equal(scrollRoot(node('IMG', strip), styleOf), strip) // sideways counts too
  assert.equal(scrollRoot(node('IMG', node('DIV', body)), styleOf), null)
  assert.equal(scrollRoot(node('IMG', node('DIV')), styleOf), null) // detached
  assert.equal(scrollRoot(null, styleOf), null)
})

// an entry as IntersectionObserver gives it: rootBounds already grown by the margin
const root = { top: 100 - LAZY_MARGIN, bottom: 600 + LAZY_MARGIN } // the list shows y 100-600
const entry = (target, top, h = 40, isIntersecting = true) => ({ target, isIntersecting, rootBounds: root, boundingClientRect: { top, bottom: top + h } })

test('askOrder: the rows ahead first, the ones on screen last (the cover queue serves the newest ask first)', () => {
  const es = [entry('a', 120), entry('b', 640), entry('c', 900), entry('d', 300), entry('e', 1200, 40, false), entry('f', 20)]
  assert.deepEqual(askOrder(es).map((e) => e.target), ['c', 'f', 'b', 'd', 'a']) // (served backwards: a, d, b, f, c)
  // as far as each other: the lower one first, so the upper one is served first; no rootBounds (a cross-origin root):
  // all as if showing
  assert.deepEqual(askOrder([{ target: 'x', isIntersecting: true, rootBounds: null, boundingClientRect: {} }, entry('y', 300)]).map((e) => e.target), ['y', 'x'])
  assert.deepEqual(askOrder([]), [])
})

// a fake IntersectionObserver: records what it watches, fire() plays the browser
function fakeIO() {
  const made = []
  class IO {
    constructor(cb, opts) {
      Object.assign(this, { cb, opts, els: new Set(), off: false })
      made.push(this)
    }
    observe(el) { this.els.add(el) }
    unobserve(el) { this.els.delete(el) }
    disconnect() { this.els.clear(); this.off = true }
    fire(entries) { this.cb(entries, this) }
  }
  return { IO, made }
}

test('lazyWatcher: one observer per root with the margin, each row asked once, gone with its last row', () => {
  const { IO, made } = fakeIO()
  const watch = lazyWatcher({ IO })
  const list = { id: 'list' }
  const asked = []
  const stopA = watch('a', list, () => asked.push('a'))
  watch('b', list, () => asked.push('b'))
  watch('c', list, () => asked.push('c'))
  watch('v', null, () => asked.push('v'))
  assert.equal(made.length, 2) // the list's, the viewport's
  assert.deepEqual(made[0].opts, { root: list, rootMargin: `${LAZY_MARGIN}px` })
  assert.equal(made[1].opts.root, null)
  assert.deepEqual([...made[0].els], ['a', 'b', 'c'])

  // b comes close (ahead), a is showing: b asked first, a last (served first); c still waits
  made[0].fire([entry('a', 200), entry('b', 700), entry('c', 2000, 40, false)])
  assert.deepEqual(asked, ['b', 'a'])
  assert.deepEqual([...made[0].els], ['c'])
  made[0].fire([entry('a', 200)]) // (a late entry for a row already asked: nothing)
  assert.deepEqual(asked, ['b', 'a'])
  stopA() // already done: harmless
  assert.equal(made[0].off, false)

  made[0].fire([entry('c', 500)])
  assert.deepEqual(asked, ['b', 'a', 'c'])
  assert.equal(made[0].off, true) // its last row: the observer goes

  // a row that leaves before it's asked (unmounted) stops being watched; the next row on that root gets a new observer
  const stopV = watch('w', null, () => asked.push('w'))
  stopV()
  assert.deepEqual([...made[1].els], ['v'])
  const stopX = watch('x', list, () => asked.push('x'))
  assert.equal(made.length, 3)
  stopX()
  assert.equal(made[2].off, true)
  made[1].fire([entry('v', 300)])
  assert.deepEqual(asked, ['b', 'a', 'c', 'v'])
})

test('lazyWatcher: watching the same row again replaces its callback (a new song in that row)', () => {
  const { IO, made } = fakeIO()
  const watch = lazyWatcher({ IO, margin: 100 })
  const asked = []
  const stop1 = watch('a', null, () => asked.push(1))
  watch('a', null, () => asked.push(2))
  stop1() // the first song's cleanup must not stop the second's
  assert.deepEqual([...made[0].els], ['a'])
  assert.equal(made[0].opts.rootMargin, '100px')
  made[0].fire([{ target: 'a', isIntersecting: true, rootBounds: null, boundingClientRect: {} }])
  assert.deepEqual(asked, [2])
})
