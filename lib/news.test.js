// News' pure rules (lib/news.js): the agent's digest checked before the page sees it (links, sizes, order), the
// archive's listing, the read writes, the page's words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX, MAX_ITEMS, ago, cleanImage, archiveDays, archiveLabel, archiveName, archiveNames, cleanPoints, dayName, dayOf, mergeDay, topIds, cleanAction, cleanDigest, cleanItem, cleanLink, cleanPlatforms, cleanRun, inCinemas, editionLine, PAPER, editionName, folio, longDay, runGoing, validArchive, waitFor } from './news.js'

const item = (o = {}) => ({
  id: 'a1b2c3d4e5', title_vi: 'Giá xăng giảm', title_original: 'Giá xăng giảm', summary_vi: 'Từ 15h hôm nay…', category: 'kinh-te', importance: 4,
  source: 'VnExpress', url: 'https://vnexpress.net/x.html', published_at: '2026-10-15T07:52:11+00:00', points: null, comments: null, comments_url: null, ...o,
})

test('cleanLink: http(s) only, no credentials', () => {
  assert.equal(cleanLink('https://a.example/x?y=1'), 'https://a.example/x?y=1')
  for (const v of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.example/', 'https://u:p@a.example/', '/relative', 5, null]) assert.equal(cleanLink(v), null)
})

test('cleanItem: what the page gets; no title or link, or a bad id: left out', () => {
  assert.deepEqual(cleanItem(item()), {
    id: 'a1b2c3d4e5', title: 'Giá xăng giảm', original: null, summary: 'Từ 15h hôm nay…', category: 'kinh-te', importance: 4,
    source: 'VnExpress', url: 'https://vnexpress.net/x.html', publishedAt: Date.parse('2026-10-15T07:52:11Z'), points: null, comments: null, commentsUrl: null,
    platform: null, keyPoints: null, image: null,
  })
  const hn = cleanItem(item({ title_original: 'Gas price drops', points: 312, comments: 140, comments_url: 'https://news.ycombinator.com/item?id=1', importance: 9, category: 'nope' }))
  assert.deepEqual([hn.original, hn.points, hn.comments, hn.commentsUrl, hn.importance, hn.category], ['Gas price drops', 312, 140, 'https://news.ycombinator.com/item?id=1', 5, 'khac'])
  assert.equal(cleanItem(item({ importance: -3 })).importance, 1)
  assert.equal(cleanItem(item({ title_vi: '', title_original: 'Only original' })).title, 'Only original')
  for (const bad of [item({ url: 'javascript:alert(1)' }), item({ title_vi: ' ', title_original: '' }), item({ id: '../etc' }), null, 'x']) assert.equal(cleanItem(bad), null)
  assert.equal(cleanItem(item({ title_vi: 'x'.repeat(1000) })).title.length, MAX.title)
  assert.equal(cleanItem(item({ comments_url: 'javascript:x', points: -1 })).commentsUrl, null)
})

test('cleanDigest: sections in order, stories by importance then newest; one story once; junk left out', () => {
  const d = cleanDigest({
    edition: 'morning', generated_at: '2026-10-16T10:12:14+07:00', overview_vi: '  Hôm nay\n\n\n\nnhiều tin. ',
    sections: [
      { key: 'vietnam', title: 'Việt Nam', items: [item({ id: 'low', importance: 2 }), item({ id: 'top', importance: 5, published_at: '2026-10-15T01:00:00Z' }), item({ id: 'top2', importance: 5, published_at: '2026-10-15T02:00:00Z' }), item({ id: 'bad', url: 'nope' })] },
      { key: 'tech', title: 'Công nghệ', items: [item({ id: 'top' }), item({ id: 't1' })] },
      { key: 'empty', title: 'Nothing', items: [item({ url: '' })] },
      'junk',
    ],
    usage: { cost_usd: 0.2 },
  })
  assert.deepEqual([d.edition, d.at, d.overview], ['morning', Date.parse('2026-10-16T03:12:14Z'), 'Hôm nay\n\nnhiều tin.'])
  assert.deepEqual(d.sections.map((s) => [s.key, s.title, s.items.map((i) => i.id)]), [['vietnam', 'Việt Nam', ['top2', 'top', 'low']], ['tech', 'Công nghệ', ['t1']]])
  assert.equal('usage' in d, false)
  assert.equal(cleanDigest({ edition: 'x', generated_at: '2026-10-16T10:12:14+07:00', sections: [] }).edition, 'manual')
  for (const bad of [null, {}, { sections: [] }, { generated_at: 'never', sections: [] }]) assert.equal(cleanDigest(bad), null)
  // non-strings aren't keys; an edition from the future is now
  const odd = cleanDigest({ edition: ['morning'], generated_at: '2030-01-01T00:00:00Z', sections: [{ key: 'k', title: 'K', items: [item({ category: ['ai'] })] }] }, 1000)
  assert.deepEqual([odd.edition, odd.at, odd.sections[0].items[0].category], ['manual', 1000, 'khac'])
  const many = cleanDigest({ generated_at: '2026-10-16T10:12:14+07:00', sections: [{ key: 'k', title: 'K', items: Array.from({ length: 200 }, (_, i) => item({ id: `i${i}` })) }] })
  assert.equal(many.sections[0].items.length, MAX_ITEMS)
})

test('archiveNames: the listing (HTML or JSON) -> digest names, newest first', () => {
  const html = '<ul><li><a href="2026-10-16_1012.json">x</a></li><li><a href="2026-10-15_1800.json">y</a></li><li><a href="../">up</a></li><li><a href="notes.txt">n</a></li><li><a href="2026-10-16_1012.json">dup</a></li></ul>'
  assert.deepEqual(archiveNames(html), ['2026-10-16_1012.json', '2026-10-15_1800.json'])
  assert.deepEqual(archiveNames(['2026-10-14_0600.json', 'x', 3]), ['2026-10-14_0600.json'])
  assert.deepEqual(archiveNames(null), [])
  assert.deepEqual(archiveNames('<a href="bad%E0.json">x</a><a href="2026-10-16_1012.json">y</a>'), ['2026-10-16_1012.json'])
  assert.equal(validArchive('2026-10-16_1012.json'), true)
  for (const n of ['../latest.json', '2026-10-16_1012.json?x', 'latest.json', '']) assert.equal(validArchive(n), false)
  assert.equal(archiveLabel('2026-10-16_1012.json'), '2026-10-16 10:12')
  assert.equal(archiveName(Date.parse('2026-10-16T10:12:14+07:00'), 'Asia/Ho_Chi_Minh'), '2026-10-16_1012.json')
  const now = Date.parse('2026-10-16T11:00:00+07:00'), tz = 'Asia/Ho_Chi_Minh'
  assert.deepEqual(['2026-10-16', '2026-10-15', '2026-10-13', 'x'].map((d) => dayName(d, now, tz)), ['Today', 'Yesterday', 'Tue 13 Oct', null])
  assert.deepEqual([dayOf('2026-10-16_1012.json'), dayOf('latest.json')], ['2026-10-16', null])
})

test('cleanAction: read / unread ids, seen at', () => {
  assert.deepEqual(cleanAction({ action: 'read', ids: ['a1', 'a1', 'b2', '../x', 5] }), { act: { action: 'read', ids: ['a1', 'b2'] } })
  assert.deepEqual(cleanAction({ action: 'unread', ids: ['a1'] }), { act: { action: 'unread', ids: ['a1'] } })
  assert.deepEqual(cleanAction({ action: 'seen', at: 5 }), { act: { action: 'seen', at: 5 } })
  assert.deepEqual(cleanAction({ action: 'refresh', extra: 1 }), { act: { action: 'refresh' } })
  assert.equal(cleanAction({ action: 'read', ids: [] }).field, 'ids')
  assert.equal(cleanAction({ action: 'seen' }).field, 'at')
  assert.equal(cleanAction({ action: 'boom' }).field, 'action')
  assert.equal(cleanAction([]).field, null)
  assert.equal(cleanAction({ action: 'read', ids: Array.from({ length: 500 }, (_, i) => `x${i}`) }).act.ids.length, 100)
})

test('ago / editionLine: the page\'s words', () => {
  const now = Date.UTC(2026, 9, 16, 5, 0)
  assert.deepEqual([ago(now, now), ago(now - 12 * 60_000, now), ago(now - 3 * 3600_000, now), ago(now - 3 * 86_400_000, now), ago(null, now)], ['now', '12m', '3h', '3d', null])
  const tz = 'Asia/Ho_Chi_Minh'
  assert.equal(editionLine({ edition: 'morning', at: Date.UTC(2026, 9, 16, 3, 12) }, now, tz), 'Morning · 10:12')
  assert.equal(editionLine({ edition: 'evening', at: Date.UTC(2026, 9, 15, 11, 5) }, now, tz), 'Evening · Thu 15 Oct, 18:05')
})

test('cleanRun: the agent\'s /api/status; runGoing: not when stuck; waitFor', () => {
  const now = Date.parse('2026-10-16T05:00:00Z')
  const raw = { job_id: 'd0e89c9a', status: 'done', edition: 'manual', started_at: '2026-10-16T11:53:41+07:00', finished_at: '2026-10-16T11:55:38+07:00', result_url: '/manual.json', items: 24, cost_usd: 0.539, error: null }
  assert.deepEqual(cleanRun(raw, now), { job: 'd0e89c9a', state: 'done', edition: 'manual', startedAt: Date.parse('2026-10-16T04:53:41Z'), finishedAt: Date.parse('2026-10-16T04:55:38Z'), items: 24, cost: 0.539, error: null })
  assert.equal(cleanRun({ ...raw, status: 'weird' }), null)
  assert.equal(cleanRun(null), null)
  const bad = cleanRun({ ...raw, job_id: '../x', edition: 'x', items: -1, cost_usd: 'a', status: 'error', error: 5 }, now)
  assert.deepEqual([bad.job, bad.edition, bad.items, bad.cost, bad.error], [null, null, null, null, 'it failed'])
  // (a start in the future: now)
  assert.equal(cleanRun({ ...raw, started_at: '2030-01-01T00:00:00Z' }, now).startedAt, now)
  const going = cleanRun({ ...raw, status: 'running', finished_at: null }, now)
  assert.equal(runGoing(going, going.startedAt + 3 * 60_000), true)
  assert.equal(runGoing(going, going.startedAt + 11 * 60_000), false)
  assert.equal(runGoing({ ...going, startedAt: null }, now), true)
  assert.equal(runGoing(cleanRun(raw, now), now), false)
  assert.equal(runGoing(null, now), false)
  assert.deepEqual([waitFor(400), waitFor(40_000), waitFor(7 * 60_000 - 5), waitFor(9 * 3600_000 - 60_000)], ['1 s', '40 s', '7 min', '9 h'])
})

test('editions by name: the agent\'s afternoon, and one asked for (manual)', () => {
  const now = Date.UTC(2026, 9, 16, 9)
  assert.equal(cleanDigest({ edition: 'afternoon', generated_at: '2026-10-16T15:00:00+07:00', sections: [] }, now).edition, 'afternoon')
  assert.equal(editionLine({ edition: 'afternoon', at: Date.UTC(2026, 9, 16, 8) }, now, 'Asia/Ho_Chi_Minh'), 'Afternoon · 15:00')
  assert.equal(editionLine({ edition: 'manual', at: Date.UTC(2026, 9, 16, 4, 55) }, now, 'Asia/Ho_Chi_Minh'), 'On demand · 11:55')
})

test('cleanPlatforms (schema 1.5): a film\'s names, each once, cut to size; anything else null', () => {
  assert.deepEqual(cleanPlatforms(['Netflix']), ['Netflix'])
  assert.deepEqual(cleanPlatforms(['Disney+', ' Hulu ', 'hulu', '', 5, null]), ['Disney+', 'Hulu'])
  assert.equal(cleanPlatforms(null), null)
  assert.equal(cleanPlatforms('Netflix'), null)
  assert.equal(cleanPlatforms([]), null)
  assert.equal(cleanPlatforms(Array.from({ length: 20 }, (_, i) => `P${i}`)).length, 6)
  assert.equal(cleanPlatforms(['x'.repeat(100)])[0].length, 40)
  assert.deepEqual(cleanItem(item({ platform: ['Rạp chiếu'] })).platform, ['Rạp chiếu'])
  assert.equal(cleanItem(item()).platform, null)
  assert.equal(inCinemas('Rạp chiếu'), true)
  assert.equal(inCinemas('Netflix'), false)
  // (1.5 with a section of films: the digest as before)
  const d = cleanDigest({ schema_version: '1.5', edition: 'morning', generated_at: '2026-10-16T07:00:00+07:00', sections: [{ key: 'movies', title: 'Phim ảnh', items: [item({ id: 'f1', platform: ['Netflix'] })] }] }, Date.UTC(2026, 9, 16, 1))
  assert.deepEqual([d.sections[0].key, d.sections[0].items[0].platform], ['movies', ['Netflix']])
})

test('archiveDays: the days, newest first, each day\'s editions oldest first; the latest counts even before the listing has it', () => {
  assert.deepEqual(archiveDays(['2026-10-16_1012.json', '2026-10-15_1800.json', '2026-10-16_0700.json', 'x.json'], '2026-10-16_1437.json'), [
    { day: '2026-10-16', names: ['2026-10-16_0700.json', '2026-10-16_1012.json', '2026-10-16_1437.json'] },
    { day: '2026-10-15', names: ['2026-10-15_1800.json'] },
  ])
  assert.deepEqual(archiveDays([], '2026-10-16_1437.json'), [{ day: '2026-10-16', names: ['2026-10-16_1437.json'] }])
})

test('mergeDay: each story once, in its newest words and section; since = its first edition; the brief and top from the newest', () => {
  const at = (h) => `2026-10-16T${h}:00:00+07:00`
  const now = Date.parse('2026-10-16T20:00:00+07:00')
  const ed = (h, edition, sections, overview) => cleanDigest({ edition, generated_at: at(h), overview_vi: overview, sections }, now)
  const morning = ed('07', 'morning', [
    { key: 'vietnam', title: 'Việt Nam', items: [item({ id: 'a', importance: 3, summary_vi: 'old words' }), item({ id: 'b', importance: 2 })] },
    { key: 'movies', title: 'Phim', items: [item({ id: 'f', importance: 3 })] },
  ], 'morning brief')
  const noon = ed('12', 'manual', [
    { key: 'tech', title: 'Công nghệ', items: [item({ id: 'c', importance: 5 }), item({ id: 'b', importance: 2 })] },
    { key: 'vietnam', title: 'Việt Nam', items: [item({ id: 'a', importance: 4, summary_vi: 'new words' }), item({ id: 'd', importance: 4 })] },
  ], 'the day so far')
  const d = mergeDay([noon, morning, null])
  assert.deepEqual([d.updates, d.at, d.first, d.overview, d.edition], [2, Date.parse(at('12')), Date.parse(at('07')), 'the day so far', 'manual'])
  // the newest's sections first (b moved to tech), then the ones only the morning had
  assert.deepEqual(d.sections.map((s) => [s.key, s.items.map((i) => i.id)]), [['tech', ['c', 'b']], ['vietnam', ['d', 'a']], ['movies', ['f']]])
  // (a and d weigh the same, from the same time: the one that came later first)
  const a = d.sections[1].items[1]
  assert.deepEqual([a.summary, a.importance, a.since], ['new words', 4, Date.parse(at('07'))])
  assert.equal(d.sections[1].items[0].since, Date.parse(at('12')))
  assert.deepEqual(d.top, ['c', 'a', 'd', 'b'])
  assert.equal(mergeDay([]), null)
})

test('topIds: 4–5 of 5 (8 at most), or the best five; cleanPoints: lines, cut, 8 at most', () => {
  const d = (imps) => ({ sections: [{ items: imps.map((importance, i) => ({ id: `i${i}`, importance, publishedAt: i })) }] })
  assert.deepEqual(topIds(d([4, 5, 2, 4, 4, 4, 1])), ['i1', 'i5', 'i4', 'i3', 'i0'])
  assert.equal(topIds(d(Array(20).fill(5))).length, 8)
  assert.deepEqual(topIds(d([1, 2, 3])), ['i2', 'i1', 'i0'])
  assert.deepEqual(cleanPoints(['  một ', '', 5, 'hai']), ['một', 'hai'])
  assert.equal(cleanPoints('x'), null)
  assert.equal(cleanPoints(Array(20).fill('x')).length, 8)
  assert.deepEqual(cleanItem(item({ key_points_vi: ['A', 'B'] })).keyPoints, ['A', 'B'])
})

test('PAPER / editionName / folio / longDay: the masthead', () => {
  const tz = 'Asia/Ho_Chi_Minh'
  assert.equal(PAPER, 'The Dalater')
  // 07:05, 11:59, 15:04, 23:33 in Vietnam
  assert.equal(editionName({ at: Date.UTC(2026, 9, 22, 0, 5) }, tz), 'Morning Edition')
  assert.equal(editionName({ at: Date.UTC(2026, 9, 22, 4, 59) }, tz), 'Morning Edition')
  assert.equal(editionName({ at: Date.UTC(2026, 9, 22, 8, 4) }, tz), 'Afternoon Edition')
  assert.equal(editionName({ at: Date.UTC(2026, 9, 22, 16, 33) }, tz), 'Afternoon Edition')
  assert.equal(folio('2026-01-01'), 'Vol. I · No. 1')
  assert.equal(folio('2026-10-22'), 'Vol. I · No. 295')
  assert.equal(folio('2028-12-31'), 'Vol. III · No. 366')
  assert.equal(folio('2034-03-01'), 'Vol. IX · No. 60')
  assert.equal(folio('x'), null)
  assert.equal(longDay('2026-10-22'), 'Thursday, October 22, 2026')
  assert.equal(longDay(null), null)
})

test('cleanImage: a photo under images/ with its size, or null', () => {
  const img = { file: 'images/8ae9d92c16.webp', source_url: 'https://x.example/a.jpg', width: 1200, height: 675, alt_vi: 'Nhân viên ngân hàng', credit: 'Ảnh: vnexpress.net' }
  assert.deepEqual(cleanImage(img), { name: '8ae9d92c16.webp', width: 1200, height: 675, alt: 'Nhân viên ngân hàng', credit: 'Ảnh: vnexpress.net' })
  assert.deepEqual(cleanImage({ ...img, file: 'images/a.JPG', credit: null, alt_vi: 5 }), { name: 'a.JPG', width: 1200, height: 675, alt: '', credit: null })
  for (const file of ['images/../secret.webp', 'images/a/b.webp', '/images/a.webp', 'other/a.webp', 'images/a.svg', 'images/.webp', 'https://x.example/a.webp', 7])
    assert.equal(cleanImage({ ...img, file }), null, String(file))
  for (const width of [0, -1, 1.5, '1200', 20_000, undefined]) assert.equal(cleanImage({ ...img, width }), null, String(width))
  for (const v of [null, undefined, 'images/a.webp', []]) assert.equal(cleanImage(v), null)
  // (an item without the key: older editions)
  assert.equal(cleanItem(item()).image, null)
  assert.equal(cleanItem(item({ image: img })).image.name, '8ae9d92c16.webp')
})

test('mergeDay: a newer copy without the photo keeps the earlier one', () => {
  const img = { name: 'a.webp', width: 1200, height: 675, alt: '', credit: null }
  const d = (at, image) => ({ edition: 'morning', at, overview: null, sections: [{ key: 'tech', title: 'T', items: [{ id: 'aaaaaaaaaa', title: 't', importance: 3, publishedAt: null, image }] }] })
  assert.deepEqual(mergeDay([d(1, img), d(2, null)]).sections[0].items[0].image, img)
  assert.equal(mergeDay([d(1, img), d(2, { ...img, name: 'b.webp' })]).sections[0].items[0].image.name, 'b.webp')
})
