import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KIND, RECENT_N, START_N, command, isQuickKey, kindOf, rank, remember, score, startList, tabHref } from './quick.js'

const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, ...mods })

test('isQuickKey: ⌘K / Ctrl+K anywhere but over another dialog or the lock; / only outside fields', () => {
  assert.equal(isQuickKey(key('k', { metaKey: true })), true)
  assert.equal(isQuickKey(key('k', { ctrlKey: true })), true)
  assert.equal(isQuickKey(key('K', { ctrlKey: true })), true) // (caps lock)
  assert.equal(isQuickKey(key('k', { ctrlKey: true, repeat: true })), false) // (held down: no flicker)
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

test('score: accents and case never stop a match (Vietnamese)', () => {
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
  assert.equal(kindOf(score(A('Grafana'), 'g')), KIND.start) // (one letter: a word start)
  assert.equal(score(A('Grafana'), 'a'), 0) // (one letter is never the inside of a word)
  assert.equal(score(A('Rain'), 'x'), 0) // no subsequence for a single letter
  assert.equal(score(A('Grafana'), 'gr fn'), 0) // nor for several words
})

test('rank: the better kind of match first; within a kind actions before services, then the order built', () => {
  const items = [
    S('Grafana', 'grafana.wliafdew.dev'),
    A('Rainy café', { keywords: ['sounds'] }),
    A('Rain', { keywords: ['sounds'] }),
    S('Rain service', 'rain.example.com'),
    A('Storm night', { keywords: ['rain', 'thunder'] }),
  ]
  assert.deepEqual(rank(items, 'rain').map((x) => x.title), ['Rain', 'Rainy café', 'Rain service', 'Storm night'])
  assert.deepEqual(rank(items, 'ra').map((x) => x.title), ['Rainy café', 'Rain', 'Rain service', 'Storm night', 'Grafana'])
  assert.deepEqual(rank(items, 'nothing'), [])
  assert.equal(rank(items, 'ra', 2).length, 2)
})

// the palette's real neighbours (app/quick.js): the actions and a few of the Services card's apps
const PALETTE = [
  A('Play the radio', { keywords: ['music', 'play', 'pause', 'nhạc', 'radio', 'lofi'] }),
  A('Pause Spotify', { hint: 'Some track', keywords: ['music', 'play', 'pause', 'nhạc'] }),
  A('Sounds', { keywords: ['mixer', 'sounds', 'ambient sound', 'noise', 'âm thanh'] }),
  A('Thunder', { hint: 'Sound', keywords: ['sounds'] }),
  A('Notifications', { keywords: ['inbox', 'alerts', 'thông báo'] }),
  A('Weather details', { hint: 'Da Lat', keywords: ['forecast', 'temperature', 'thời tiết'] }),
  A('Settings', { keywords: ['preferences', 'theme', 'colors', 'clock', 'motion', 'cài đặt'] }),
  A('Add a reminder', { hint: 'or type: remind …', keywords: ['reminders', 'todo', 'nhắc', 'new'] }),
  A('Open reminders', { hint: '2 open', keywords: ['todo', 'tasks', 'nhắc'] }),
  A('Open pins', { hint: '3 links', keywords: ['links', 'bookmarks', 'saved'] }),
  A('Pin a link', { hint: 'or type: pin <link>', keywords: ['pins', 'bookmark', 'save', 'url'] }),
  A('Open reading', { hint: '1 in progress', keywords: ['books', 'kavita', 'đọc sách'] }),
  S('Profile', 'profile.wliafdew.dev', { keywords: ['Sites'] }),
  S('Weather', 'weather.wliafdew.dev', { keywords: ['Sites'] }),
  S('Grafana', 'grafana.wliafdew.dev', { keywords: ['Apps'] }),
  S('Kavita', 'kavita.wliafdew.dev', { keywords: ['Apps'] }),
  S('Hacker News', 'news.ycombinator.com', { keywords: ['Developer'] }),
  S('Spotify', 'open.spotify.com', { keywords: ['Entertainment'] }),
  S('Settings sync', 'sync.example.com', { keywords: ['Internal'] }),
]
const top = (q, n = 1) => rank(PALETTE, q).slice(0, n).map((x) => x.title)

test('rank: the obvious intent wins (an action that starts with it over an app that only contains it)', () => {
  assert.deepEqual(top('set'), ['Settings']) // not "Settings sync", nor the app whose words contain "set"
  assert.deepEqual(top('weather', 2), ['Weather details', 'Weather']) // the same kind of match: the action first
  assert.deepEqual(top('spotify', 2), ['Spotify', 'Pause Spotify']) // the app's whole name beats a later word
  assert.deepEqual(top('spot', 2), ['Spotify', 'Pause Spotify'])
  assert.deepEqual(top('kavita', 2), ['Kavita', 'Open reading']) // a name over a keyword
  assert.deepEqual(top('read'), ['Open reading'])
  assert.deepEqual(top('remind', 2), ['Add a reminder', 'Open reminders'])
  assert.deepEqual(top('music', 2), ['Play the radio', 'Pause Spotify'])
  // a service only ever beats an action with a better kind of match, never the same kind
  for (const q of ['set', 'weather', 'pin', 'notif', 'sound', 'pause', 'play']) {
    const r = rank(PALETTE, q)
    const firstApp = r.findIndex((x) => x.group === 'service')
    if (firstApp < 0) continue
    for (const x of r.slice(firstApp + 1)) if (x.group === 'action') assert.ok(kindOf(score(x, q)) < kindOf(score(r[firstApp], q)), `${q}: ${x.title}`)
  }
})

test('rank: typed with accents, the item with those accents first ("nhạc" music, "nhắc" reminders); without, music first', () => {
  assert.deepEqual(top('nhạc', 2), ['Play the radio', 'Pause Spotify'])
  assert.deepEqual(top('nhắc', 2), ['Add a reminder', 'Open reminders'])
  assert.deepEqual(top('NHẮC'), ['Add a reminder']) // (case)
  assert.deepEqual(top('nhắc'.normalize('NFD')), ['Add a reminder']) // (a keyboard that types the accents apart)
  assert.deepEqual(top('nhac', 4), ['Play the radio', 'Pause Spotify', 'Add a reminder', 'Open reminders']) // both, the order built
  assert.equal(rank(PALETTE, 'nhạc').length, 4) // the other spelling still shows, below
  assert.ok(score(A('x', { keywords: ['nhạc'] }), 'nhạc') > score(A('x', { keywords: ['nhắc'] }), 'nhạc'))
  assert.equal(score(A('x', { keywords: ['nhạc'] }), 'nhac'), score(A('x', { keywords: ['nhắc'] }), 'nhac'))
  assert.deepEqual(top('thời', 1), ['Weather details'])
})

test('rank: initials and letters in order only when nothing better fits', () => {
  assert.deepEqual(rank(PALETTE, 'hn').map((x) => x.title), ['Hacker News']) // not Thunder (t-h-u-n…)
  assert.ok(!rank(PALETTE, 'pins').some((x) => x.title === 'Open reminders')) // (o-p-…-i-n-…-s)
  assert.deepEqual(top('pins', 2), ['Open pins', 'Pin a link'])
  assert.deepEqual(rank(PALETTE, 'grfn').map((x) => x.title), ['Grafana']) // nothing better: still found
  assert.equal(score(A('Thunder'), 'hn'), 0) // letters in order must start at a word's start
  assert.equal(kindOf(score(A('Hacker News'), 'hn')), KIND.initials)
  assert.equal(kindOf(score(A('Grafana'), 'grfn')), KIND.letters)
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

test('command: "nhạc" (music) is never remind; "nhac" without accents is', () => {
  assert.equal(command('nhạc lofi'), null)
  assert.equal(command('nhác mua sữa'), null)
  assert.deepEqual(command('Nhắc mua sữa'), { kind: 'remind', text: 'mua sữa' })
  assert.deepEqual(command('nhắc mua sữa'.normalize('NFD')), { kind: 'remind', text: 'mua sữa'.normalize('NFD') })
  assert.deepEqual(command('NHAC call mom'), { kind: 'remind', text: 'call mom' })
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
  // first: always on it, on top (Show panels in Ambient), however many recent and home ones there are
  const amb = [...Array.from({ length: 10 }, (_, i) => A(`h${i}`, { home: i + 1 })), A('panels', { home: 5, first: true })]
  assert.deepEqual(startList(amb, ['h9', 'h8', 'h7', 'h6', 'panels']).map((x) => x.id), ['panels', 'h9', 'h8', 'h7', 'h6', 'h0', 'h1'])
  assert.equal(startList(amb, ['h9', 'h8', 'h7', 'h6'], 3)[0].id, 'panels')
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

test('tabHref: only absolute http(s) links open', () => {
  assert.equal(tabHref('https://grafana.wliafdew.dev'), 'https://grafana.wliafdew.dev/')
  assert.equal(tabHref('http://10.10.0.217:5000/library'), 'http://10.10.0.217:5000/library')
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<b>x', 'vbscript:x', '/relative', '//evil.example', 'file:///etc/passwd', '', null, undefined, 42]) {
    assert.equal(tabHref(bad), null, String(bad))
  }
})
