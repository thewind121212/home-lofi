import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FULLSCREEN_EVENTS, fullscreenApi, isFullscreenKey } from './fullscreen.js'

// a fake document: standard API, webkit-only (iPadOS Safari), or none (iPhone Safari)
function fakeDoc(kind = 'std', { refuse = false } = {}) {
  const calls = []
  const doc = { documentElement: {} }
  const el = doc.documentElement
  if (kind === 'std') {
    doc.fullscreenEnabled = true
    doc.fullscreenElement = null
    el.requestFullscreen = function (opts) {
      calls.push(['request', this === el, opts])
      if (refuse) return Promise.reject(new TypeError('Permissions check failed'))
      doc.fullscreenElement = el
      return Promise.resolve()
    }
    doc.exitFullscreen = function () {
      calls.push(['exit', this === doc])
      doc.fullscreenElement = null
      return Promise.resolve()
    }
  } else if (kind === 'webkit') {
    doc.webkitFullscreenEnabled = true
    doc.webkitFullscreenElement = null
    el.webkitRequestFullscreen = function () {
      calls.push(['webkitRequest', this === el])
      doc.webkitFullscreenElement = el // (returns undefined, like old Safari)
    }
    doc.webkitExitFullscreen = function () {
      calls.push(['webkitExit', this === doc])
      doc.webkitFullscreenElement = null
    }
  }
  return { doc, calls }
}

test('fullscreenApi: the standard API on <html>, toggled both ways', async () => {
  const { doc, calls } = fakeDoc('std')
  const f = fullscreenApi(doc)
  assert.equal(f.supported, true)
  assert.equal(f.active(), false)
  await f.toggle()
  assert.equal(f.active(), true)
  await f.toggle()
  assert.equal(f.active(), false)
  assert.deepEqual(calls, [['request', true, { navigationUI: 'hide' }], ['exit', true]])
})

test('fullscreenApi: the webkit fallback (iPadOS Safari)', async () => {
  const { doc, calls } = fakeDoc('webkit')
  const f = fullscreenApi(doc)
  assert.equal(f.supported, true)
  await f.toggle()
  assert.equal(f.active(), true)
  await f.toggle()
  assert.deepEqual(calls, [['webkitRequest', true], ['webkitExit', true]])
})

test('fullscreenApi: not supported (iPhone Safari, no document, disabled by policy): no button, toggle does nothing', async () => {
  for (const doc of [fakeDoc('none').doc, null, undefined, { documentElement: { requestFullscreen() {} }, fullscreenEnabled: false }]) {
    const f = fullscreenApi(doc)
    assert.equal(f.supported, false)
    assert.equal(f.active(), false)
    await f.toggle() // resolves, no throw
  }
})

test('fullscreenApi: a refusal (no user gesture) never rejects, and nothing changes', async () => {
  const { doc } = fakeDoc('std', { refuse: true })
  const f = fullscreenApi(doc)
  await f.toggle()
  assert.equal(f.active(), false)
  const throwing = { fullscreenEnabled: true, fullscreenElement: null, documentElement: { requestFullscreen() { throw new Error('old') } } }
  await fullscreenApi(throwing).toggle()
  assert.deepEqual(FULLSCREEN_EVENTS, ['fullscreenchange', 'webkitfullscreenchange'])
})

test('isFullscreenKey: F alone, not with a modifier, a repeat, while typing or with a dialog open', () => {
  assert.equal(isFullscreenKey({ key: 'f' }), true)
  assert.equal(isFullscreenKey({ key: 'F' }), true) // Caps Lock / Shift
  for (const e of [{ key: 'f', ctrlKey: true }, { key: 'f', metaKey: true }, { key: 'f', altKey: true }, { key: 'f', repeat: true }, { key: 'g' }, { key: 'Enter' }, {}, null]) {
    assert.equal(isFullscreenKey(e), false, JSON.stringify(e))
  }
  assert.equal(isFullscreenKey({ key: 'f' }, { typing: true }), false)
  assert.equal(isFullscreenKey({ key: 'f' }, { dialog: true }), false)
})
