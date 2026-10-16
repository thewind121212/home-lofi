// Every effect in app/*.js returns nothing or a cleanup function, never a value it just happened to get back from a
// call: React keeps what an effect returns and calls it as the cleanup. `useEffect(() => el.scrollTo(...))` took the
// whole page down on 2026-10-16: newer Chrome returns a Promise from scrollTo, and the next run called it ("i is not a
// function"). So an expression-bodied effect must be `() => void …` (or return an arrow), and a block's `return x` must
// not be a DOM scroll / focus call either.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const { parse } = createRequire(import.meta.url)('next/dist/compiled/babel/parser.js')
const DIR = new URL('../app/', import.meta.url)
const DOM = /\.(scrollTo|scrollBy|scrollIntoView|focus|animate|play|requestFullscreen|showModal)\(/

function effects(src) {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'classProperties'] })
  const out = []
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'CallExpression') {
      const c = n.callee
      const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? c.property.name : ''
      if (/^use(Layout|Insertion)?Effect$/.test(name) && n.arguments[0]) out.push(n.arguments[0])
    }
    for (const k in n) {
      if (k === 'loc') continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  }
  walk(ast.program)
  return out
}
const fnLike = (n) => n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression'

// a file's source -> what's wrong with its effects ([] when nothing)
function problems(src, file) {
  const bad = []
  const at = (n) => `app/${file}:${src.slice(0, n.start).split('\n').length}`
  for (const fn of effects(src)) {
    if (!fnLike(fn)) {
      bad.push(`${at(fn)} not an inline function`)
      continue
    }
    if (fn.async) bad.push(`${at(fn)} async (returns a Promise)`)
    const b = fn.body
    if (b.type !== 'BlockStatement') {
      if (!((b.type === 'UnaryExpression' && b.operator === 'void') || fnLike(b))) bad.push(`${at(fn)} returns ${src.slice(b.start, b.start + 50)}`)
      continue
    }
    // a block: its own returns (not nested functions')
    const visit = (m) => {
      if (!m || typeof m.type !== 'string' || (m !== b && /Function/.test(m.type))) return
      if (m.type === 'ReturnStatement' && m.argument && !fnLike(m.argument) && DOM.test(src.slice(m.argument.start, m.argument.end))) bad.push(`${at(m)} returns a DOM call`)
      for (const k in m) {
        if (k === 'loc') continue
        const v = m[k]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v.type === 'string') visit(v)
      }
    }
    visit(b)
  }
  return bad
}

test('effects return nothing or a cleanup, never what a call returned', () => {
  const bad = readdirSync(DIR)
    .filter((f) => f.endsWith('.js'))
    .flatMap((file) => problems(readFileSync(new URL(file, DIR), 'utf8'), file))
  assert.deepEqual(bad, [])
})

test('the check catches the shape that crashed, and lets the safe ones by', () => {
  assert.equal(problems('useEffect(() => scroller.current?.scrollTo({ top: 0 }), [digest.at])', 'x.js').length, 1)
  assert.equal(problems('useEffect(async () => { await go() }, [])', 'x.js').length, 1)
  assert.equal(problems('useEffect(() => { if (!el) return; return el.focus() }, [])', 'x.js').length, 1)
  assert.deepEqual(problems('useEffect(() => void el.scrollTo(0, 0), []); useEffect(() => { el.scrollTo(0, 0) }, []); useEffect(() => () => stop(), [])', 'x.js'), [])
})
