import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECENT_N, START_N, command, isQuickKey, rank, remember, score, startList } from './quick.js'

const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, ...mods })

test('isQuickKey: ⌘K / Ctrl+K anywhere but over another dialog or the lock; / only outside fields', () => {
  assert.equal(isQuickKey(key('k', { metaKey: true })), true)
  assert.equal(isQuickKey(key('k', { ctrlKey: true })), true)
  assert.equal(isQuickKey(key('K', { ctrlKey: true })), true) // (caps lock)
  assert.equal(isQuickKey(key('k', { ctrlKey: true }), { typing: true }), true) // in a field too
  assert.equal(isQuickKey(key('k', { ctrlKey: true }), { dialog: true }), false) // Settings is open
  assert.equal(isQuickKey(key('k', { ctrlKey: true }), { dialog: true, open: true }), true) // its own: closes it
  assert.equal(isQuickKey(key('k', { ctrlKey: true }), { locked: true }), false)
  assert.equal(isQuickKey(key('k', { ctrlKey: true, shiftKey: true })), false) // Ctrl+Shift+K: the browser's
  assert.equal(isQuickKey(key('k', { ctrlKey: true, altKey: true })), false)
  assert.equal(isQuickKey(key('k')), false) // plain k
  assert.equal(isQuickKey(key('/')), true)
  assert.equal(isQuickKey(key('/'), { typing: true }), false)
  assert.equal(isQuickKey(key('/'), { dialog: true }), false)
  assert.equal(isQuickKey(key('/'), { locked: true }), false)
  assert.equal(isQuickKey(key('/', { ctrlKey: true })), false)
  assert.equal(isQuickKey(key('/', { repeat: true })), false)
  assert.equal(isQuickKey(null), false)
  assert.equal(isQuickKey({}), false)
})

const A = (title, more = {}) => ({ id: title, title, group: 'action', ...more })
const S = (title, hint, more = {}) => ({ id: `svc:${title}`, title, hint, group: 'service', ...more })

test('score: word starts in the title beat keywords and hints, which beat the inside of a word', () => {
  const settings = A('Settings')
  assert.ok(score(settings, 'set') > score(A('Reset sounds'), 'set')) // (inside "reset")
  assert.ok(score(A('Hacker News'), 'news') > score(A('Play', { keywords: ['news'] }), 'news'))
  assert.ok(score(A('Play', { keywords: ['music'] }), 'mus') > score(A('Bemusing'), 'mus'))
  assert.ok(score(S('GitHub', 'github.com'), 'github') > 0)
  assert.ok(score(S('Profile', 'profile.wliafdew.dev'), 'wliaf') > 0) // the host counts
  assert.equal(score(settings, ''), 0)
  assert.equal(score(settings, '   '), 0)
  assert.equal(score(settings, 'zzz'), 0)
})

test('score: every word typed must fit somewhere', () => {
  const t = A('Lock screen', { keywords: ['sleep'] })
  assert.ok(score(t, 'lock scr') > 0)
  assert.ok(score(t, 'scr lock') > 0) // any order
  assert.ok(score(t, 'lock sleep') > 0) // title + keyword
  assert.equal(score(t, 'lock music'), 0)
})

test('score: the whole title from its start ranks above the same words elsewhere', () => {
  assert.ok(score(A('Scene gallery'), 'scene') > score(A('Random scene'), 'scene'))
  assert.ok(score(A('Rain'), 'rain') > score(A('Rainy café'), 'rain')) // a whole word over a word's start
})

test('score: accents and case never matter (Vietnamese)', () => {
  assert.ok(score(A('Đà Lạt'), 'da lat') > 0)
  assert.ok(score(A('Add a reminder', { keywords: ['nhắc'] }), 'nhac') > 0)
  assert.ok(score(A('Café'), 'CAFE') > 0)
  assert.ok(score(A('Mua sữa'), 'sữa') > 0)
  assert.equal(score(A('Café'), 'cafe'), score(A('Cafe'), 'café'))
})

test('score: a run of letters can match the initials or the letters in order, below real matches', () => {
  const hn = score(S('Hacker News', 'news.ycombinator.com'), 'hn')
  assert.ok(hn > 0)
  assert.ok(score(S('Grafana', 'grafana.wliafdew.dev'), 'grfn') > 0)
  assert.ok(hn < score(A('Rain'), 'ra')) // even a substring is better
  assert.ok(score(A('Grafana'), 'grfn') < score(A('Grafana'), 'fana'))
  assert.equal(score(A('Grafana'), 'g'), 30 + 5) // (one letter: a word start)
  assert.equal(score(A('Rain'), 'x'), 0) // no subsequence for a single letter
  assert.equal(score(A('Grafana'), 'gr fn'), 0) // nor for several words
})

test('rank: best first; at the same score actions before services, then the order built', () => {
  const items = [
    S('Grafana', 'grafana.wliafdew.dev'),
    A('Rainy café', { keywords: ['sounds'] }),
    A('Rain', { keywords: ['sounds'] }),
    S('Rain service', 'rain.example.com'),
    A('Storm night', { keywords: ['rain', 'thunder'] }),
  ]
  assert.deepEqual(rank(items, 'rain').map((x) => x.title), ['Rain', 'Rain service', 'Rainy café', 'Storm night'])
  assert.deepEqual(rank(items, 'ra').map((x) => x.title), ['Rainy café', 'Rain', 'Rain service', 'Storm night', 'Grafana'])
  assert.deepEqual(rank(items, 'nothing'), [])
  assert.equal(rank(items, 'ra', 2).length, 2)
})

test('rank: a word start in a later word still beats the inside of a word', () => {
  const items = [A('Bemused'), A('Play / pause', { keywords: ['music'] })]
  assert.deepEqual(rank(items, 'mus').map((x) => x.title), ['Play / pause', 'Bemused'])
})

test('command: remind / nhắc + text adds a reminder', () => {
  assert.deepEqual(command('remind buy milk'), { kind: 'remind', text: 'buy milk' })
  assert.deepEqual(command('  Remind   buy milk  '), { kind: 'remind', text: 'buy milk' })
  assert.deepEqual(command('nhắc mua sữa'), { kind: 'remind', text: 'mua sữa' })
  assert.deepEqual(command('nhac mua sữa'), { kind: 'remind', text: 'mua sữa' })
  assert.deepEqual(command('remind me to call mom'), { kind: 'remind', text: 'call mom' })
  assert.deepEqual(command('remind me call mom'), { kind: 'remind', text: 'call mom' })
  assert.deepEqual(command('remind meeting at 3'), { kind: 'remind', text: 'meeting at 3' }) // ("me" only as a word)
  assert.equal(command('remind me'), null)
  assert.equal(command('remind me to'), null)
  assert.equal(command('remind'), null)
  assert.equal(command('remind '), null)
  assert.equal(command('reminders'), null)
  assert.equal(command('reminders open'), null)
  assert.equal(command(''), null)
  assert.equal(command(undefined), null)
})

test('command: pin + one link pins it', () => {
  assert.deepEqual(command('pin https://example.com/a'), { kind: 'pin', url: 'https://example.com/a' })
  assert.deepEqual(command('pin example.com/x?utm_source=a'), { kind: 'pin', url: 'https://example.com/x' })
  assert.deepEqual(command('Pin www.youtube.com'), { kind: 'pin', url: 'https://www.youtube.com/' })
  assert.equal(command('pin some words'), null)
  assert.equal(command('pin notalink'), null)
  assert.equal(command('pin javascript:alert(1)'), null)
  assert.equal(command('pins'), null)
  assert.equal(command('pinned example.com'), null)
})

test('startList: the recent ones first, then the home ones, no repeats', () => {
  const items = [A('a', { home: true }), A('b'), A('c', { home: true }), A('d', { home: true }), S('s', 'x.com')]
  assert.deepEqual(startList(items, []).map((x) => x.id), ['a', 'c', 'd'])
  assert.deepEqual(startList(items, ['svc:s', 'c', 'gone']).map((x) => x.id), ['svc:s', 'c', 'a', 'd'])
  assert.deepEqual(startList(items, ['b'], 2).map((x) => x.id), ['b', 'a'])
  const ordered = [A('x', { home: 3 }), A('y', { home: 1 }), A('z', { home: 2 }), A('w', { home: 1 })]
  assert.deepEqual(startList(ordered, []).map((x) => x.id), ['y', 'w', 'z', 'x'])
  const many = Array.from({ length: 20 }, (_, i) => A(`h${i}`, { home: true }))
  assert.equal(startList(many, []).length, START_N)
  assert.equal(startList(many, ['h9', 'h8', 'h7', 'h6', 'h5', 'h4']).filter((x) => +x.id.slice(1) >= 4).length, RECENT_N)
})

test('remember: to the front, no repeats, a few at most', () => {
  assert.deepEqual(remember([], 'a'), ['a'])
  assert.deepEqual(remember(['a', 'b'], 'b'), ['b', 'a'])
  assert.deepEqual(remember(['a', 'b', 'c', 'd'], 'e'), ['e', 'a', 'b', 'c'])
  assert.deepEqual(remember('junk', 'a'), ['a'])
  assert.deepEqual(remember([1, null, 'a'], 'b'), ['b', 'a'])
})
