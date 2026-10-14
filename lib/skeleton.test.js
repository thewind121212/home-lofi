import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHAPE_KEY, SK_MAX, TAB_KEY, cleanShape, prePaintShape, shapeAttrs, shapeCss } from './skeleton.js'

test('cleanShape: keeps valid fields, caps counts, drops junk', () => {
  for (const raw of [null, undefined, 'x', 42, []]) assert.deepEqual(cleanShape(raw), {})
  assert.deepEqual(cleanShape({ owner: true, hosts: 2, habits: 3, internal: 6, hbWeek: false, wxAqi: true, wxStation: false, hbH: { w: 390, h: 412 } }), {
    owner: true, hosts: 2, habits: 3, internal: 6, hbWeek: false, wxAqi: true, wxStation: false, hbH: { w: 390, h: 412 },
  })
  assert.deepEqual(cleanShape({ hosts: 99, habits: 40, internal: 500 }), { hosts: SK_MAX.hosts, habits: SK_MAX.habits, internal: SK_MAX.internal })
  assert.deepEqual(cleanShape({ owner: 'yes', hosts: -1, habits: 1.5, internal: '3', hbWeek: 1, wxAqi: null, hbH: { w: '390', h: 1 } }), {})
  assert.deepEqual(cleanShape({ power: [true, false] }), { power: [true, false] })
  assert.deepEqual(cleanShape({ power: [true, 'no'] }), {})
  assert.deepEqual(cleanShape({ power: [true, true, true, true, true] }), {})
  assert.deepEqual(cleanShape({ hbH: { w: 390, h: 0 } }), {})
  assert.deepEqual(cleanShape({ hbH: { w: 390, h: 99999 } }), {})
})

test('shapeCss: hides the parts past the remembered counts, keeps the picked tab', () => {
  const css = shapeCss({ hosts: 2, habits: 1, internal: 10 }, 'Apps')
  assert.match(css, /\[data-sk-host="2"\],\[data-sk-host="3"\]\{display:none!important\}/)
  assert.doesNotMatch(css, /data-sk-host="1"/)
  assert.match(css, /\[data-sk-hb="1"\],.*\[data-sk-hb="7"\]\{display:none!important\}/)
  assert.doesNotMatch(css, /data-sk-hb="0"/)
  assert.match(css, /\[data-sk-int="10"\],\[data-sk-int="11"\]\{/)
  assert.match(css, /\.svc-boot \[data-sk-grp\]:not\(\[data-sk-grp="Apps"\]\),\.svc-boot \[data-sk-head\]\{display:none!important\}/)
  // All: every group and its heading stay
  assert.doesNotMatch(shapeCss({}, 'All'), /svc-boot/)
  // nothing remembered: one machine's rows, three routines, six internal apps, the Sites tab
  const first = shapeCss({}, null)
  assert.match(first, /\[data-sk-host="1"\]/)
  assert.match(first, /\[data-sk-hb="3"\]/)
  assert.match(first, /\[data-sk-int="6"\]/)
  assert.match(first, /:not\(\[data-sk-grp="Sites"\]\)/)
  // no internal apps last time: not even their section
  assert.match(shapeCss({ internal: 0 }, 'All'), /\.sk-int-grp\{display:none!important\}/)
  assert.doesNotMatch(shapeCss({ internal: 2 }, 'All'), /sk-int-grp/)
  // each internal app's stat chips: as many as it had, 3 when not known, the box gone for none
  const ch = shapeCss({ internal: 3, intChips: [4, 0] }, 'Internal')
  assert.match(ch, /\[data-sk-int="0"\] \[data-sk-chip="4"\],\[data-sk-int="0"\] \[data-sk-chip="5"\]/)
  assert.doesNotMatch(ch, /\[data-sk-int="0"\] \[data-sk-chip="3"\]/)
  assert.match(ch, /\[data-sk-int="1"\] \.sk-chips/)
  assert.match(ch, /\[data-sk-int="2"\] \[data-sk-chip="3"\]/)
  assert.deepEqual(cleanShape({ intChips: [4, 0, 6] }), { intChips: [4, 0, 6] })
  assert.deepEqual(cleanShape({ intChips: [7] }), {})
  // a public app's chips by widget: 3 by default, more or fewer as remembered; names that aren't plain are dropped
  const wc = shapeCss(cleanShape({ wChips: { nextcloud: 4, n8n: 2, off: 0, 'x"]{}': 3 } }), 'Apps')
  assert.match(wc, /\[data-sk-w\] \[data-sk-chip="3"\],\[data-sk-w\] \[data-sk-chip="4"\],\[data-sk-w\] \[data-sk-chip="5"\]\{display:none!important\}/)
  assert.match(wc, /\[data-sk-w="nextcloud"\] \[data-sk-chip="3"\]\{display:block!important\}/)
  assert.match(wc, /\[data-sk-w="n8n"\] \[data-sk-chip="2"\]\{display:none!important\}/)
  assert.match(wc, /\[data-sk-w="off"\] \.sk-chips\{display:none!important\}/)
  assert.doesNotMatch(wc, /x"\]/)
  assert.ok(wc.indexOf('display:block') > wc.indexOf('[data-sk-w] [data-sk-chip="3"]'))
  // a tab that isn't a plain word can't write CSS
  assert.match(shapeCss({}, '"]{}body{display:none}'), /:not\(\[data-sk-grp="Sites"\]\)/)
  // as many as the skeleton draws: nothing to hide
  // (only the public apps' default of 3 chips stays)
  assert.equal(shapeCss({ hosts: 4, habits: 8, internal: 12, intChips: Array(12).fill(6) }, 'All'), '[data-sk-w] [data-sk-chip="3"],[data-sk-w] [data-sk-chip="4"],[data-sk-w] [data-sk-chip="5"]{display:none!important}')
  // a machine without a watts badge: its stand-in badge goes
  assert.match(shapeCss({ hosts: 2, power: [false, true] }, 'Sites'), /\[data-sk-host="0"\] \.sk-power\{display:none!important\}/)
  assert.doesNotMatch(shapeCss({ hosts: 2, power: [true, true] }, 'Sites'), /sk-power/)
  // the Habits card's height, at that window width only
  assert.match(shapeCss({ hbH: { w: 390, h: 412 } }, 'Sites'), /@media \(min-width:389\.5px\) and \(max-width:390\.5px\)\{\.sk-hb-card\{min-height:412px\}\}/)
})

test('shapeAttrs: <html data-sk-*> for a shape', () => {
  assert.deepEqual(shapeAttrs({}), {})
  assert.deepEqual(shapeAttrs({ owner: true, hosts: 1, hbWeek: true, wxAqi: false, wxStation: true }), { skOwner: '', skPriv: '', skOneHost: '', skHbWeek: '', skWxNoAqi: '', skWxStation: '' })
  assert.deepEqual(shapeAttrs({ owner: false, hosts: 0, wxAqi: true }), {})
  assert.deepEqual(shapeAttrs({ hosts: 3 }), { skPriv: '' })
  assert.deepEqual(shapeAttrs({ fixedVol: true }), { skFixedVol: '' })
  assert.deepEqual(shapeAttrs({ fixedVol: false }), {})
  assert.deepEqual(cleanShape({ fixedVol: true }), { fixedVol: true })
  assert.deepEqual(cleanShape({ fixedVol: 'yes' }), {})
})

test('prePaintShape: stringified as the page inlines it, sets <html> and the stylesheet; never throws', () => {
  const run = (store) => {
    const root = { dataset: {} }, head = []
    const ls = { getItem: (k) => (store === 'throw' ? (() => { throw new Error('blocked') })() : store[k] ?? null) }
    const doc = { documentElement: root, head: { appendChild: (el) => head.push(el) }, createElement: () => ({}) }
    new Function('localStorage', 'document', `(${prePaintShape})(${JSON.stringify(SHAPE_KEY)},${JSON.stringify(TAB_KEY)},${JSON.stringify(SK_MAX)},${cleanShape},${shapeCss},${shapeAttrs})`)(ls, doc)
    return [root.dataset, head[0]?.id, head[0]?.textContent]
  }
  const [attrs, id, css] = run({ [SHAPE_KEY]: JSON.stringify({ owner: true, hosts: 2 }), [TAB_KEY]: '"All"' })
  assert.deepEqual(attrs, { skOwner: '', skPriv: '' })
  assert.equal(id, 'sk-shape')
  assert.match(css, /data-sk-host="2"/)
  assert.doesNotMatch(css, /svc-boot/)
  const onPhone = (ua, store) => {
    const root = { dataset: {} }
    const ls = { getItem: (k) => store[k] ?? null }
    const doc = { documentElement: root, head: { appendChild: () => {} }, createElement: () => ({}) }
    new Function('localStorage', 'document', 'navigator', `(${prePaintShape})(${JSON.stringify(SHAPE_KEY)},${JSON.stringify(TAB_KEY)},${JSON.stringify(SK_MAX)},${cleanShape},${shapeCss},${shapeAttrs})`)(ls, doc, { userAgent: ua, platform: 'iPhone', maxTouchPoints: 5 })
    return root.dataset.skFixedVol
  }
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
  assert.equal(onPhone(iphone, {}), '')
  assert.equal(onPhone(iphone, { [SHAPE_KEY]: '{"fixedVol":false}' }), undefined)
  assert.equal(onPhone('Mozilla/5.0 (Linux; Android 15)', {}), undefined)
  // junk or blocked storage: the guest's shape (no attributes), the Sites tab
  for (const store of [{ [SHAPE_KEY]: 'junk', [TAB_KEY]: '{' }, 'throw']) {
    const [a, , c] = run(store)
    assert.deepEqual(a, {})
    assert.match(c, /data-sk-grp="Sites"/)
  }
})
