// The GitHub list's rules (lib/github.js): a repo cleaned, the list cleaned and ordered, the days, late or not, the
// POST bodies, numbers made short.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanGh, cleanGhAction, cleanRepo, compact, ghDays, ghLate } from './github.js'

const repo = (o = {}) => ({
  id: 'morluto/rea', rank: 1, list: 'trending', full_name: 'morluto/rea', url: 'https://github.com/morluto/rea', description: 'd', language: 'TypeScript',
  topics: ['mcp', 'mcp', ' cli '], stars: 280554, stars_this_week: 239477, forks: 1234, license: 'MIT', homepage: 'https://rea.tools', created_at: '2026-04-14T00:51:32Z',
  pushed_at: '2026-10-16T09:15:01Z', first_seen: '2026-10-16', days_on_list: 1, is_new_today: true, summary_vi: 'Tóm tắt', features_vi: ['a', '', 'b'], dev_use_vi: ['c'],
  use_when_vi: 'khi', category: 'ai-agent', maturity: 'growing', difficulty: 'intermediate', worth_trying: 5, quick_start: 'npx rea-agents setup', readme_used: true, ...o,
})

test('cleanRepo: the fields the page draws, cut and checked', () => {
  const r = cleanRepo(repo())
  assert.deepEqual(
    [r.id, r.name, r.list, r.language, r.topics, r.stars, r.week, r.forks, r.license, r.homepage, r.isNew, r.features, r.devUse, r.category, r.maturity, r.difficulty, r.worth, r.quickStart],
    ['morluto/rea', 'morluto/rea', 'trending', 'TypeScript', ['mcp', 'cli'], 280554, 239477, 1234, 'MIT', 'https://rea.tools/', true, ['a', 'b'], ['c'], 'ai-agent', 'growing', 'intermediate', 5, 'npx rea-agents setup'],
  )
  assert.equal(r.pushedAt, Date.parse('2026-10-16T09:15:01Z'))
  // no link, a bad one, no name: left out
  assert.equal(cleanRepo(repo({ url: 'javascript:alert(1)' })), null)
  assert.equal(cleanRepo(repo({ id: '../x', full_name: 'nope' })), null)
  // what's unknown falls back; what's out of range is clamped or dropped
  const odd = cleanRepo(repo({ list: 'hot', category: 'crypto', maturity: 'ancient', worth_trying: 9, stars: -1, homepage: 'ftp://x', quick_start: '', is_new_today: 'yes' }))
  assert.deepEqual([odd.list, odd.category, odd.maturity, odd.worth, odd.stars, odd.homepage, odd.quickStart, odd.isNew], ['trending', 'other', null, 5, null, null, null, false])
  // (the id from full_name when it has none)
  assert.equal(cleanRepo(repo({ id: undefined, full_name: 'a/b.js' })).id, 'a/b.js')
})

test('cleanGh: not the GitHub list -> null; repos deduped, trending first then new, each by rank', () => {
  assert.equal(cleanGh(null), null)
  assert.equal(cleanGh({ kind: 'news', date: '2026-10-16', repos: [] }), null)
  assert.equal(cleanGh({ kind: 'github', date: 'today', repos: [] }), null)
  const g = cleanGh({
    schema_version: 'gh-1.0', kind: 'github', date: '2026-10-16', generated_at: '2026-10-16T06:02:31+07:00', overview_vi: ' xu hướng ',
    repos: [repo({ id: 'n/b', full_name: 'n/b', list: 'new', rank: 1 }), repo({ id: 't/b', full_name: 't/b', rank: 2 }), repo({ id: 't/a', full_name: 't/a', rank: 1 }), repo({ id: 't/a', full_name: 't/a', rank: 9 }), { id: 'bad' }],
  })
  assert.deepEqual(g.repos.map((r) => r.id), ['t/a', 't/b', 'n/b'])
  assert.deepEqual([g.date, g.at, g.overview], ['2026-10-16', Date.parse('2026-10-15T23:02:31Z'), 'xu hướng'])
  assert.equal('usage' in g, false)
})

test('ghDays: the newest file of each day, newest day first; the latest list counts without a file', () => {
  const names = ['2026-10-15_0602.json', '2026-10-16_0602.json', '2026-10-16_1630.json', 'junk.json']
  assert.deepEqual(ghDays(names, '2026-10-16'), [
    { day: '2026-10-16', name: '2026-10-16_1630.json', last: '16:30' },
    { day: '2026-10-15', name: '2026-10-15_0602.json', last: '06:02' },
  ])
  assert.deepEqual(ghDays(names.slice(0, 1), '2026-10-17')[0], { day: '2026-10-17', name: null, last: null })
})

test('ghLate: yesterday’s list is fine before 06:05, late after it, asked again until 08:00', () => {
  const at = (hm) => Date.parse(`2026-10-16T${hm}:00+07:00`)
  const tz = 'Asia/Ho_Chi_Minh'
  assert.deepEqual(ghLate('2026-10-15', at('06:04'), tz), { today: '2026-10-16', late: false, retry: false })
  assert.deepEqual(ghLate('2026-10-15', at('06:05'), tz), { today: '2026-10-16', late: true, retry: true })
  assert.deepEqual(ghLate('2026-10-15', at('07:59'), tz), { today: '2026-10-16', late: true, retry: true })
  assert.deepEqual(ghLate('2026-10-15', at('08:00'), tz), { today: '2026-10-16', late: true, retry: false })
  assert.deepEqual(ghLate('2026-10-16', at('09:00'), tz), { today: '2026-10-16', late: false, retry: false })
})

test('cleanGhAction: read / unread with repo ids, seen with a time', () => {
  assert.deepEqual(cleanGhAction({ action: 'read', ids: ['a/b', 'a/b', 'nope', 3, 'c/d.e'] }), { act: { action: 'read', ids: ['a/b', 'c/d.e'] } })
  assert.equal(cleanGhAction({ action: 'unread', ids: ['nope'] }).field, 'ids')
  assert.deepEqual(cleanGhAction({ action: 'seen', at: 5 }), { act: { action: 'seen', at: 5 } })
  assert.equal(cleanGhAction({ action: 'refresh' }).field, 'action')
  assert.equal(cleanGhAction([]).error, 'an object')
})

test('compact: short star counts', () => {
  assert.deepEqual([0, 999, 1000, 1234, 99_950, 280_554, 999_960, 1_234_567].map(compact), ['0', '999', '1k', '1.2k', '100k', '281k', '1M', '1.2M'])
})
