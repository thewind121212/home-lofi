// The Reading bar's rules (lib/reading.js): Kavita's local dates, what counts as in progress (On Deck minus the
// finished, the unstarted and the put-down), the order, the % shown, the reader links, the bar's line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AGE_DAYS, iconLabel, inProgress, kavitaTime, percent, publicBase, readAgo, readerPath, zoneOf } from './reading.js'

const NOW = Date.UTC(2026, 9, 15, 7, 0) // 14:00 in Ho Chi Minh City
const H = 3_600_000, D = 24 * H
// a SeriesDto as Kavita's on-deck gives it (the fields used, plus some it carries)
const dto = (o) => ({ id: 6, name: 'Dungeon Crawler Carl', libraryId: 2, libraryName: 'LtcRpg', pages: 650, pagesRead: 9, latestReadDate: '2026-10-15T12:47:08.1465046', format: 3, coverImage: 'v8_c8.png', wordCount: 1303890, ...o })
const fixture = [
  dto({}),
  dto({ id: 11, name: 'The Wandering Inn', libraryId: 2, pages: 1200, pagesRead: 840, latestReadDate: '2026-10-15T08:10:00', format: 3, coverImage: 'v12_c30.png' }),
  dto({ id: 23, name: 'Berserk', libraryId: 4, pages: 220, pagesRead: 55, latestReadDate: '2026-10-12T22:00:00.5', format: 1, coverImage: 'series23.png' }),
]

test('kavitaTime: Kavita wall clock in its zone; offsets and Z taken as written; junk and "never" are null', () => {
  assert.equal(kavitaTime('2026-10-15T12:47:08', 'Asia/Ho_Chi_Minh'), Date.UTC(2026, 9, 15, 5, 47, 8))
  assert.equal(kavitaTime('2026-10-15T12:47:08.1465046'), Date.UTC(2026, 9, 15, 5, 47, 8, 147))
  assert.equal(kavitaTime('2026-10-15T12:47:08', 'UTC'), Date.UTC(2026, 9, 15, 12, 47, 8))
  // across a DST change: 2026-07-01 10:00 in Berlin is CEST (+2), 2026-12-01 10:00 is CET (+1)
  assert.equal(kavitaTime('2026-07-01T10:00:00', 'Europe/Berlin'), Date.UTC(2026, 6, 1, 8))
  assert.equal(kavitaTime('2026-12-01T10:00:00', 'Europe/Berlin'), Date.UTC(2026, 11, 1, 9))
  assert.equal(kavitaTime('2026-10-15T12:47:08Z', 'Asia/Ho_Chi_Minh'), Date.UTC(2026, 9, 15, 12, 47, 8))
  assert.equal(kavitaTime('2026-10-15T12:47:08+02:00'), Date.UTC(2026, 9, 15, 10, 47, 8))
  // a bad zone falls back to Kavita's default, never throws
  assert.equal(kavitaTime('2026-10-15T12:47:08', 'Mars/Olympus'), Date.UTC(2026, 9, 15, 5, 47, 8))
  for (const bad of ['0001-01-01T00:00:00', '', null, undefined, 42, 'yesterday', '2026-10-15', '2026-10-15 12:47:08']) assert.equal(kavitaTime(bad), null)
})

test('zoneOf: a real zone, else Asia/Ho_Chi_Minh', () => {
  assert.equal(zoneOf('Europe/Berlin'), 'Europe/Berlin')
  assert.equal(zoneOf(' UTC '), 'UTC')
  for (const bad of [undefined, '', '  ', 'Nope/Nowhere', 5]) assert.equal(zoneOf(bad), 'Asia/Ho_Chi_Minh')
})

test('percent: begun is at least 1 %, unfinished at most 99 %', () => {
  assert.equal(percent(9, 650), 1)
  assert.equal(percent(1, 5000), 1)
  assert.equal(percent(840, 1200), 70)
  assert.equal(percent(649, 650), 99)
  assert.equal(percent(650, 650), 100)
  assert.equal(percent(0, 650), 0)
  assert.equal(percent(5, 0), 0)
  assert.equal(percent(NaN, 10), 0)
})

test('inProgress: several books, most recently read first, with % and the read time', () => {
  const books = inProgress(fixture, { now: NOW })
  assert.deepEqual(books.map((b) => b.name), ['Dungeon Crawler Carl', 'The Wandering Inn', 'Berserk'])
  assert.deepEqual(books[0], { id: 6, name: 'Dungeon Crawler Carl', libraryId: 2, format: 3, pages: 650, pagesRead: 9, percent: 1, readAt: Date.UTC(2026, 9, 15, 5, 47, 8, 147), coverV: 'v8_c8.png' })
  assert.deepEqual(books.map((b) => b.percent), [1, 70, 25])
  // reading another one moves it up
  const later = inProgress([fixture[0], fixture[1], { ...fixture[2], latestReadDate: '2026-10-15T13:30:00' }], { now: NOW })
  assert.deepEqual(later.map((b) => b.id), [23, 6, 11])
})

test('inProgress: not opened for 60 days, finished, unstarted, undated or odd: left out', () => {
  const old = (days) => new Date(NOW + 7 * H - days * D).toISOString().slice(0, 19) // (as Kavita's local wall clock)
  const kept = inProgress([dto({ id: 1, latestReadDate: old(MAX_AGE_DAYS - 1) }), dto({ id: 2, latestReadDate: old(MAX_AGE_DAYS + 1) })], { now: NOW })
  assert.deepEqual(kept.map((b) => b.id), [1])
  const odd = [
    dto({ id: 3, pagesRead: 650 }), // finished
    dto({ id: 4, pagesRead: 0 }), // not started
    dto({ id: 5, latestReadDate: '0001-01-01T00:00:00' }), // never read
    dto({ id: 7, pages: 0 }),
    dto({ id: -1 }),
    dto({ id: '8' }),
    dto({ id: 9, libraryId: 0 }),
    null,
    'x',
  ]
  assert.deepEqual(inProgress(odd, { now: NOW }), [])
  assert.deepEqual(inProgress(null), [])
  assert.deepEqual(inProgress({ id: 6 }), [])
  // the same series twice: once; no name: a stand-in; the cover version: only safe characters
  const same = inProgress([dto({}), dto({ name: 'Again' }), dto({ id: 12, name: '  ', coverImage: '../x?.png' })], { now: NOW })
  assert.deepEqual(same.map((b) => [b.id, b.name]), [[6, 'Dungeon Crawler Carl'], [12, 'Series 12']])
  assert.equal(same[1].coverV, '..x.png')
  // a read date ahead of this clock (the two servers' clocks differ a little): now, not the future
  assert.equal(inProgress([dto({ latestReadDate: '2026-10-15T14:05:00' })], { now: NOW })[0].readAt, NOW)
})

test('readerPath: the reader for the format at the continue point, else the series page', () => {
  assert.equal(readerPath({ libraryId: 2, seriesId: 6, chapterId: 8, format: 3 }), '/library/2/series/6/book/8')
  assert.equal(readerPath({ libraryId: 2, seriesId: 6, chapterId: 8, format: 4 }), '/library/2/series/6/pdf/8')
  assert.equal(readerPath({ libraryId: 4, seriesId: 23, chapterId: 90, format: 1 }), '/library/4/series/23/manga/90')
  assert.equal(readerPath({ libraryId: 4, seriesId: 23, chapterId: 90, format: 0 }), '/library/4/series/23/manga/90')
  // unknown or missing format: the page reader, as Kavita itself does
  assert.equal(readerPath({ libraryId: 4, seriesId: 23, chapterId: 90, format: 2 }), '/library/4/series/23/manga/90')
  assert.equal(readerPath({ libraryId: 4, seriesId: 23, chapterId: 90, format: null }), '/library/4/series/23/manga/90')
  assert.equal(readerPath({ libraryId: 2, seriesId: 6, chapterId: null, format: 3 }), '/library/2/series/6')
  assert.equal(readerPath({ libraryId: 2, seriesId: 6 }), '/library/2/series/6')
  assert.equal(readerPath({ libraryId: 0, seriesId: 6, chapterId: 8 }), null)
  assert.equal(readerPath({ libraryId: 2, seriesId: '6/../x', chapterId: 8 }), null)
})

test('publicBase: an http(s) address without its trailing slash; anything else null', () => {
  assert.equal(publicBase('https://kavita.wliafdew.dev'), 'https://kavita.wliafdew.dev')
  assert.equal(publicBase('https://kavita.wliafdew.dev/'), 'https://kavita.wliafdew.dev')
  assert.equal(publicBase(' http://10.10.0.217:5000/kavita/ '), 'http://10.10.0.217:5000/kavita')
  for (const bad of [undefined, '', 'kavita.wliafdew.dev', 'javascript:alert(1)', 'https://u:p@kavita.example', 'ftp://x']) assert.equal(publicBase(bad), null)
})

test('iconLabel: one book by name and how far; more: how many and the latest; none: no icon', () => {
  const books = inProgress(fixture, { now: NOW })
  assert.equal(iconLabel(books.slice(0, 1)), 'Reading Dungeon Crawler Carl, 1%')
  assert.equal(iconLabel(books.slice(0, 2)), 'Reading 2 books, latest Dungeon Crawler Carl at 1%')
  assert.equal(iconLabel(books), 'Reading 3 books, latest Dungeon Crawler Carl at 1%')
  assert.equal(iconLabel([]), null)
  assert.equal(iconLabel(undefined), null)
})

test('readAgo: plain words', () => {
  assert.equal(readAgo(NOW - 20_000, NOW), 'just now')
  assert.equal(readAgo(NOW + 5000, NOW), 'just now')
  assert.equal(readAgo(NOW - 5 * 60_000, NOW), '5 min ago')
  assert.equal(readAgo(NOW - 2 * H - 10_000, NOW), '2 h ago')
  assert.equal(readAgo(NOW - 30 * H, NOW), 'a day ago')
  assert.equal(readAgo(NOW - 40 * H, NOW), 'a day ago') // (not "yesterday": 40 h back may be two days on the calendar)
  assert.equal(readAgo(NOW - 3 * D, NOW), '3 days ago')
  assert.equal(readAgo(NOW - 40 * D, NOW), '5 weeks ago')
  assert.equal(readAgo(null, NOW), '')
})
