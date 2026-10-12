import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLORS,
  LEVEL_LOOK,
  MAX,
  SAVER_FRESH_MS,
  TOAST_MAX,
  ago,
  alive,
  ambientNote,
  byDay,
  cleanNotice,
  dayLabel,
  left,
  lockNotes,
  look,
  maxId,
  notifyPlaces,
  parseIcon,
  toItem,
  toastsFor,
  unreadOf,
} from './notify.js'
import { ambientView } from './ambient.js'

test('cleanNotice: a full notice comes through as sent', () => {
  const raw = { title: 'Backup done', body: 'nextcloud → b2\n4.2 GB', level: 'success', source: 'backup', icon: 'fa:database', color: 'blue', url: 'https://coolify.wliafdew.dev/x', tag: 'backup-nightly', silent: true, ttl: 3600 }
  assert.deepEqual(cleanNotice(raw), {
    notice: { ...raw, icon: { fa: 'fa-solid fa-database' } },
    warnings: [],
  })
})

test('cleanNotice: only a title is needed; level defaults to info, false / empty extras are left out', () => {
  assert.deepEqual(cleanNotice({ title: 'Hi' }), { notice: { title: 'Hi', level: 'info' }, warnings: [] })
  assert.deepEqual(cleanNotice({ title: 'Hi', body: '  ', source: '', silent: false }), { notice: { title: 'Hi', level: 'info' }, warnings: [] })
})

test('cleanNotice: hard errors name the field', () => {
  for (const [raw, field] of [
    [null, null],
    [[], null],
    ['text', null],
    [{}, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 5 }, 'title'],
    [{ title: 'x', body: ['a'] }, 'body'],
    [{ title: 'x', source: {} }, 'source'],
    [{ title: 'x', level: 'critical' }, 'level'],
    [{ title: 'x', tag: 'has space' }, 'tag'],
    [{ title: 'x', tag: 'x'.repeat(65) }, 'tag'],
    [{ title: 'x', silent: 'yes' }, 'silent'],
    [{ title: 'x', ttl: 5 }, 'ttl'],
    [{ title: 'x', ttl: 31 * 86400 }, 'ttl'],
    [{ title: 'x', ttl: '60' }, 'ttl'],
  ]) {
    const r = cleanNotice(raw)
    assert.ok(r.error, JSON.stringify(raw))
    assert.equal(r.field, field, JSON.stringify(raw))
    assert.equal(r.notice, undefined)
  }
})

test('cleanNotice: soft problems still send, with warnings (the level look stands in)', () => {
  const r = cleanNotice({ title: 'x'.repeat(100), body: 'y'.repeat(600), icon: '🔔', color: '#ff0000', url: 'javascript:alert(1)', extra: 1, more: 2 })
  assert.equal(r.notice.title.length, MAX.title)
  assert.ok(r.notice.title.endsWith('…'))
  assert.equal(r.notice.body.length, MAX.body)
  assert.equal(r.notice.icon, undefined)
  assert.equal(r.notice.color, undefined)
  assert.equal(r.notice.url, undefined)
  assert.equal(r.warnings.length, 6)
  assert.match(r.warnings.join('\n'), /icon: use fa-<name>/)
  assert.match(r.warnings.join('\n'), /ignored: extra, more/)
})

test('cleanNotice: a one-line title, a body that keeps its lines, no control characters', () => {
  const { notice } = cleanNotice({ title: ' Disk\nalmost\tfull \u001b[31m', body: 'line 1\r\nline 2\u0007', ttl: 59.6 })
  assert.equal(notice.title, 'Disk almost full [31m')
  assert.equal(notice.body, 'line 1\nline 2')
  assert.equal(notice.ttl, 60)
})

test('parseIcon: Font Awesome or an https image, nothing else (the page has no emoji icons)', () => {
  assert.deepEqual(parseIcon('fa:database'), { fa: 'fa-solid fa-database' })
  assert.deepEqual(parseIcon('fa-hard-drive'), { fa: 'fa-solid fa-hard-drive' })
  assert.deepEqual(parseIcon('fa-solid fa-server'), { fa: 'fa-solid fa-server' })
  assert.deepEqual(parseIcon('fa-brands fa-docker'), { fa: 'fa-brands fa-docker' })
  assert.deepEqual(parseIcon('fa-regular fa-bell'), { fa: 'fa-regular fa-bell' })
  assert.deepEqual(parseIcon('https://static.wliafdew.dev/public/n8n.png'), { img: 'https://static.wliafdew.dev/public/n8n.png' })
  for (const bad of ['🔔', 'database', 'fa:', 'fa-solid', 'fa:Database', 'fa:x y', 'fa-solid fa-x"><script>', 'fa-light fa-bell', 'http://lan/icon.png', 'https://', 'data:image/png;base64,AA', 42, null, ''])
    assert.equal(parseIcon(bad), null, String(bad))
})

test('cleanNotice: colors are the page palette names only', () => {
  for (const c of COLORS) assert.equal(cleanNotice({ title: 'x', color: c }).notice.color, c)
  for (const c of ['amber', 'orange', '#fff', 'rgb(0,0,0)', 'Primary']) assert.equal(cleanNotice({ title: 'x', color: c }).notice.color, undefined, c)
})

test('look: the notice’s own icon and color, else its level’s (Font Awesome, page palette)', () => {
  assert.deepEqual(look({ level: 'error' }), { icon: { fa: LEVEL_LOOK.error.icon }, color: 'red' })
  assert.deepEqual(look({ level: 'warning', color: 'purple' }), { icon: { fa: 'fa-solid fa-triangle-exclamation' }, color: 'purple' })
  assert.deepEqual(look({ level: 'info', icon: { img: 'https://a.b/c.png' } }), { icon: { img: 'https://a.b/c.png' }, color: 'primary' })
  for (const l of Object.values(LEVEL_LOOK)) {
    assert.match(l.icon, /^fa-solid fa-[a-z-]+$/)
    assert.ok(COLORS.includes(l.color))
  }
})

test('toItem: a row -> the page’s item, re-checked (a hand-written row can’t sneak anything in)', () => {
  const row = { id: '7', created_at: new Date(1000), expires_at: new Date(5000), data: { title: 'T', level: 'warning', icon: { fa: 'fa-solid fa-database' }, color: 'blue' } }
  assert.deepEqual(toItem(row), { id: 7, at: 1000, exp: 5000, title: 'T', level: 'warning', icon: { fa: 'fa-solid fa-database' }, color: 'blue' })
  // the stored icon goes through parseIcon again: a bad one (or one that isn't an icon at all) drops
  assert.equal(toItem({ ...row, data: { ...row.data, icon: { fa: 'x"><b>' } } }).icon, undefined)
  assert.equal(toItem({ ...row, data: { ...row.data, icon: '🔔' } }).icon, undefined)
  assert.deepEqual(toItem({ ...row, data: { ...row.data, icon: { img: 'https://a.b/c.png' } } }).icon, { img: 'https://a.b/c.png' })
  assert.equal(toItem({ ...row, data: { ...row.data, color: 'orange' } }).color, undefined)
  assert.equal(toItem({ ...row, data: {} }), null)
  assert.equal(toItem({ ...row, expires_at: null }).exp, null)
})

const item = (id, extra = {}) => ({ id, at: 1_000_000 + id, exp: null, title: `n${id}`, level: 'info', ...extra })

test('alive / unreadOf / maxId', () => {
  const items = [item(3, { exp: 10 }), item(2), item(1, { exp: 5_000_000 })]
  assert.deepEqual(alive(items, 100).map((i) => i.id), [2, 1])
  assert.deepEqual(unreadOf(items, 1).map((i) => i.id), [3, 2])
  assert.equal(maxId(items), 3)
  assert.equal(maxId([]), 0)
})

test('toastsFor: not silent, at least the chosen level, at most TOAST_MAX', () => {
  const fresh = [item(6, { level: 'error' }), item(5, { silent: true }), item(4, { level: 'warning' }), item(3), item(2, { level: 'success' }), item(1)]
  assert.deepEqual(toastsFor(fresh).show.map((i) => i.id), [6, 4, 3])
  assert.equal(toastsFor(fresh).more, 2) // (the silent one never counts)
  assert.equal(TOAST_MAX, 3)
  assert.deepEqual(toastsFor(fresh, { notifyMin: 'warning' }), { show: [fresh[0], fresh[2]], more: 0 })
  assert.deepEqual(toastsFor(fresh, { notifyMin: 'error' }).show.map((i) => i.id), [6])
  assert.deepEqual(toastsFor(fresh, { notifyToasts: false }), { show: [], more: 0 })
})

test('notifyPlaces: dashboard, compact, screensaver (clock / pill), lock', () => {
  const set = { notifyToasts: true, notifyAmbient: true, notifyLock: 'titles' }
  const at = (amb, opts = {}) => notifyPlaces(ambientView({ ...amb, idleShow: opts.idleShow ?? 'clock', locked: opts.locked }), { locked: opts.locked, set: opts.set ?? set })
  assert.deepEqual(at({ ambient: false }), { bell: true, toasts: true, chip: false, saver: null, lock: null })
  assert.deepEqual(at({ ambient: 'hand', calm: false }), { bell: false, toasts: false, chip: true, saver: null, lock: null })
  assert.deepEqual(at({ ambient: 'auto', calm: true }), { bell: false, toasts: false, chip: false, saver: 'clock', lock: null })
  assert.equal(at({ ambient: 'hand', calm: true }, { idleShow: 'scene' }).saver, 'pill')
  assert.deepEqual(at({ ambient: 'hand', calm: true }, { locked: true }), { bell: false, toasts: false, chip: false, saver: null, lock: 'titles' })
  assert.equal(at({ ambient: false }, { locked: true }).lock, 'titles')
  // the settings turn each place off
  const off = { notifyToasts: false, notifyAmbient: false, notifyLock: 'off' }
  assert.equal(at({ ambient: false }, { set: off }).toasts, false)
  assert.equal(at({ ambient: false }, { set: off }).bell, true) // the bell and the inbox always stay
  assert.equal(at({ ambient: 'hand' }, { set: off }).chip, false)
  assert.equal(at({ ambient: 'auto', calm: true }, { set: off }).saver, null)
  assert.equal(at({ ambient: false }, { locked: true, set: off }).lock, null)
  assert.equal(at({ ambient: false }, { locked: true, set: { ...set, notifyLock: 'count' } }).lock, 'count')
})

test('ambientNote: the newest unread, + how many more; the screensaver lets old info go but keeps warnings', () => {
  const now = 10_000_000
  const old = now - SAVER_FRESH_MS - 1
  const items = [item(4, { at: old }), item(3, { at: old, level: 'warning' }), item(2, { at: now - 1000 }), item(1)]
  assert.deepEqual(ambientNote(items, 0, now), { item: items[0], more: 3 })
  assert.deepEqual(ambientNote(items, 0, now, { saver: true }), { item: items[1], more: 3 })
  assert.equal(ambientNote(items, 4, now), null)
  assert.equal(ambientNote([item(1, { at: old })], 0, now, { saver: true }), null)
  assert.equal(ambientNote([item(1, { exp: now - 1 })], 0, now), null) // past its ttl
})

test('lockNotes: up to three, the rest counted; count mode shows none; details only for full', () => {
  const items = [5, 4, 3, 2, 1].map((id) => item(id))
  assert.equal(lockNotes(items, 0, 0, null), null)
  assert.equal(lockNotes(items, 5, 0, 'titles'), null)
  const t = lockNotes(items, 0, 0, 'titles')
  assert.deepEqual(t.show.map((i) => i.id), [5, 4, 3])
  assert.equal(t.more, 2)
  assert.equal(t.total, 5)
  assert.equal(t.details, false)
  assert.equal(lockNotes(items, 0, 0, 'full').details, true)
  assert.deepEqual(lockNotes(items, 3, 0, 'count'), { show: [], more: 2, total: 2, details: false })
})

test('ago / left: short times', () => {
  const now = new Date(2026, 9, 12, 21, 0).getTime()
  assert.equal(ago(now - 10_000, now), 'now')
  assert.equal(ago(now + 5000, now), 'now') // a clock a little ahead
  assert.equal(ago(now - 5 * 60_000, now), '5m')
  assert.equal(ago(now - 3 * 3600_000, now), '3h')
  assert.equal(ago(new Date(2026, 9, 10, 9).getTime(), now), 'Sat')
  assert.equal(ago(new Date(2026, 8, 3).getTime(), now), 'Sep 3')
  assert.equal(left(now + 30_000, now), 'a moment')
  assert.equal(left(now + 61_000, now), '2m')
  assert.equal(left(now + 2 * 3600_000, now), '2h')
  assert.equal(left(now + 3 * 86400_000, now), '3d')
})

test('dayLabel / byDay: Today, Yesterday, then the date, newest first', () => {
  const now = new Date(2026, 9, 12, 0, 30).getTime()
  const at = (d, h) => new Date(2026, 9, d, h).getTime()
  assert.equal(dayLabel(at(12, 0), now), 'Today')
  assert.equal(dayLabel(at(11, 23), now), 'Yesterday')
  assert.equal(dayLabel(at(5, 12), now), 'Mon, Oct 5')
  const items = [item(4, { at: at(12, 0) }), item(3, { at: at(11, 20) }), item(2, { at: at(11, 8) }), item(1, { at: at(5, 12) })]
  assert.deepEqual(
    byDay(items, now).map(([label, list]) => [label, list.map((i) => i.id)]),
    [['Today', [4]], ['Yesterday', [3, 2]], ['Mon, Oct 5', [1]]],
  )
})
