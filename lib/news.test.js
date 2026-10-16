// News' pure rules (lib/news.js): the agent's digest checked before the page sees it (links, sizes, order), the
// archive's listing, the read writes, the page's words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX, MAX_ITEMS, ago, archiveLabel, archiveName, editionName, archiveNames, cleanAction, cleanDigest, cleanItem, cleanLink, cleanRun, editionLine, runGoing, validArchive, waitFor } from './news.js'

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
  assert.deepEqual(['2026-10-16_1012.json', '2026-10-15_1800.json', '2026-10-13_0600.json', 'x'].map((n) => editionName(n, now, tz)), ['Today · 10:12', 'Yesterday · 18:00', 'Tue 13 Oct · 06:00', null])
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
