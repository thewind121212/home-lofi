// Reminders' rules (lib/reminders.js): what a reminder may say, when the pop-up and the 06:00 notice are due (in the
// owner's zone, with the late window), how long one has been carried, and the notice itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localNow } from './habits.js'
import { cleanNotice } from './notify.js'
import { MAX_TEXT, NUDGE_AT, canUndo, carried, cleanAction, cleanText, nudgeKey, nudgeNotice, openAtSix, popupDue, zoneOf } from './reminders.js'

// a local time in Ho Chi Minh City (UTC+7) on a day of October 2026
const at = (h, m, day = 14) => Date.UTC(2026, 9, day, h - 7, m)
const hcm = (h, m, day) => localNow(at(h, m, day), 'Asia/Ho_Chi_Minh')

test('cleanText: one line, spaces collapsed, 1–140 characters', () => {
  assert.deepEqual(cleanText('  renew   the\tdomain \n'), { text: 'renew the domain' })
  assert.deepEqual(cleanText('call\u0000mum\u0007'), { text: 'call mum' })
  assert.deepEqual(cleanText('Gọi mẹ 📞'), { text: 'Gọi mẹ 📞' })
  assert.equal(cleanText('x'.repeat(MAX_TEXT)).text.length, MAX_TEXT)
  for (const bad of ['', '   ', '\n\t', 'x'.repeat(MAX_TEXT + 1), null, undefined, 42, ['a'], { text: 'a' }]) assert.equal(cleanText(bad).field, 'text', JSON.stringify(bad))
})

test('cleanAction: add / done / undo, and nothing else', () => {
  assert.deepEqual(cleanAction({ action: 'add', text: ' buy milk ' }), { act: { action: 'add', text: 'buy milk' } })
  assert.deepEqual(cleanAction({ action: 'done', id: 'a1b2c3d4e5f6', at: 0 }), { act: { action: 'done', id: 'a1b2c3d4e5f6' } }) // a time from the page: ignored
  assert.deepEqual(cleanAction({ action: 'undo', id: 'a1b2c3d4e5f6' }), { act: { action: 'undo', id: 'a1b2c3d4e5f6' } })
  assert.equal(cleanAction({ action: 'add' }).field, 'text')
  assert.equal(cleanAction({ action: 'done' }).field, 'id')
  assert.equal(cleanAction({ action: 'done', id: 'NOPE!' }).field, 'id')
  assert.equal(cleanAction({ action: 'delete', id: 'a1b2c3d4e5f6' }).field, 'action') // (deleting is DELETE, not a POST)
  for (const raw of [null, 'add', [], 5]) assert.equal(cleanAction(raw).field, null)
})

test('the pop-up: from 06:00 to midnight in the owner\'s zone', () => {
  assert.equal(popupDue(hcm(5, 59)), false)
  assert.equal(popupDue(hcm(6, 0)), true)
  assert.equal(popupDue(hcm(23, 59)), true)
  assert.equal(popupDue(hcm(0, 0, 15)), false) // a new day: not before its 06:00
  // the same moment, two zones: 06:30 in Ho Chi Minh City is 19:30 the day before in New York
  const ms = at(6, 30)
  assert.deepEqual(localNow(ms, 'America/New_York'), { day: '2026-10-13', min: 19 * 60 + 30, dow: 2 })
  assert.equal(popupDue(localNow(Date.UTC(2026, 9, 14, 9, 59), 'America/New_York')), false) // 05:59 there
  assert.equal(popupDue(localNow(Date.UTC(2026, 9, 14, 10, 0), 'America/New_York')), true)
})

test('the zone: the Habits doc\'s, else Ho Chi Minh City', () => {
  assert.equal(zoneOf({ tz: 'Europe/Berlin', habits: [] }), 'Europe/Berlin')
  for (const doc of [null, undefined, {}, { tz: 'Nowhere/Land' }, { tz: 5 }]) assert.equal(zoneOf(doc), 'Asia/Ho_Chi_Minh')
})

test('the 06:00 notice: only with something open, 06:00–06:29 (a late server still sends), one key a day', () => {
  assert.equal(nudgeKey(hcm(5, 59), 3), null)
  assert.equal(nudgeKey(hcm(6, 0), 3), 'todo:2026-10-14')
  assert.equal(nudgeKey(hcm(6, 29), 1), 'todo:2026-10-14')
  assert.equal(nudgeKey(hcm(6, 30), 1), null) // too late: the pop-up is there anyway
  assert.equal(nudgeKey(hcm(6, 0), 0), null) // nothing open: nothing sent
  assert.equal(nudgeKey(hcm(6, 5, 15), 1), 'todo:2026-10-15')
  assert.equal(NUDGE_AT, 360)
})

test('carried: days since it was added (the owner\'s calendar), never negative', () => {
  assert.equal(carried({ day: '2026-10-14' }, '2026-10-14'), 0)
  assert.equal(carried({ day: '2026-10-11' }, '2026-10-14'), 3)
  assert.equal(carried({ day: '2026-09-30' }, '2026-10-01'), 1)
  assert.equal(carried({ day: '2026-10-15' }, '2026-10-14'), 0)
  assert.equal(carried({ day: 'junk' }, '2026-10-14'), 0)
})

test('the notice: how many, the first three, the oldest\'s age; today\'s tag, gone at midnight', () => {
  const items = [
    { id: 'a', text: 'renew the domain', day: '2026-10-11' },
    { id: 'b', text: 'call mum', day: '2026-10-13' },
    { id: 'c', text: 'pay the internet bill', day: '2026-10-14' },
    { id: 'd', text: 'back up the NAS', day: '2026-10-14' },
  ]
  const n = nudgeNotice(items, hcm(6, 0))
  assert.equal(n.title, '4 reminders today')
  assert.equal(n.body, "• renew the domain\n• call mum\n• pay the internet bill\n+1 more\nCarried for 3 days. Hold each one when it's done.")
  assert.deepEqual([n.source, n.tag, n.icon, n.ttl], ['Reminders', 'todo:2026-10-14', 'fa-solid fa-list-check', 18 * 3600])
  const one = nudgeNotice([{ id: 'b', text: 'call mum', day: '2026-10-13' }], hcm(6, 10))
  assert.equal(one.title, '1 reminder today')
  assert.equal(one.body, "• call mum\nCarried for 1 day. Hold each one when it's done.")
  assert.equal(nudgeNotice([{ id: 'c', text: 'x', day: '2026-10-14' }], hcm(6, 0)).body, "• x\nHold each one when it's done.")
  // what the hub takes, as it is (no warnings: nothing cut, nothing unknown)
  const c = cleanNotice(n)
  assert.equal(c.error, undefined)
  assert.deepEqual(c.warnings, [])
})

test('undo: within 10 s (+5 s for the trip) of done, by the server\'s clock', () => {
  assert.equal(canUndo(1000, 1000), true)
  assert.equal(canUndo(1000, 16_000), true)
  assert.equal(canUndo(1000, 16_001), false)
  assert.equal(canUndo(1000, 999), false)
  assert.equal(canUndo(null, 1000), false)
})

test('openAtSix: carried ones and today\'s added by 06:00 (the owner\'s zone); not later ones', () => {
  const tz = 'Asia/Ho_Chi_Minh'
  const items = [
    { id: 'a', day: '2026-10-13', at: at(22, 0, 13) },
    { id: 'b', day: '2026-10-14', at: at(5, 59) },
    { id: 'c', day: '2026-10-14', at: at(6, 0) },
    { id: 'd', day: '2026-10-14', at: at(6, 1) },
    { id: 'e', day: '2026-10-14', at: at(9, 0) },
    { id: 'f', day: 'junk', at: at(5, 0) },
  ]
  assert.deepEqual(openAtSix(items, hcm(6, 20), tz).map((i) => i.id), ['a', 'b', 'c'])
  // another zone, another 06:00: 05:59 in Berlin is 10:59 in Ho Chi Minh City
  const berlin = localNow(Date.UTC(2026, 9, 14, 4, 5), 'Europe/Berlin')
  assert.deepEqual(openAtSix([{ id: 'x', day: '2026-10-14', at: Date.UTC(2026, 9, 14, 3, 59) }, { id: 'y', day: '2026-10-14', at: Date.UTC(2026, 9, 14, 4, 1) }], berlin, 'Europe/Berlin').map((i) => i.id), ['x'])
})
