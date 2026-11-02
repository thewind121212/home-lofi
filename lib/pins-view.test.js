// The Pins sheet's views (lib/pins-view.js): days in local time (midnight, the year's turn, a DST night), the time
// chips, the sites and GitHub's owners, the faceted counts, the two groupings, the search's highlights, the keys.
// Local time is pinned per test file (node --test runs each in its own process): Saigon, no DST; one test borrows
// New York for its DST night.
process.env.TZ = 'Asia/Ho_Chi_Minh'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SECTION_SHOWN, SUB_MIN, byDay, bySite, cleanView, dayDate, dayKey, dayLabel, dayStart, facet, inTime, liveFilters, marks, partsOf, pathTop, plan, prepare, repoOf, sheetKey, shownOf, siteName, linesOf, whereOf } from './pins-view.js'

// a local moment (Saigon): at(2026, 11, 2, 9) is 2 Nov 2026, 09:00 there
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 11, 2, 17, 3) // Mon 2 Nov 2026, 17:03

test('dayKey: the local day, midnight included; the year turns at local midnight, not UTC', () => {
  assert.equal(dayKey(at(2026, 11, 2, 0, 0)), '2026-11-02')
  assert.equal(dayKey(at(2026, 11, 1, 23, 59)), '2026-11-01')
  assert.equal(dayKey(at(2026, 1, 1, 0, 0)), '2026-01-01')
  assert.equal(dayKey(at(2025, 12, 31, 23, 59)), '2025-12-31')
  // 1 Jan 2026 03:00 in Saigon is still 31 Dec 2025 in UTC: the device's day wins
  assert.equal(dayKey(Date.UTC(2025, 11, 31, 20, 0)), '2026-01-01')
  assert.equal(dayKey(NaN), dayKey(0)) // (junk: a day all the same, never a throw)
})

test('dayLabel: Today, Yesterday (across midnight and the year), then weekday + date; the year only when not this one', () => {
  assert.equal(dayLabel('2026-11-02', NOW), 'Today')
  assert.equal(dayLabel('2026-11-01', NOW), 'Yesterday')
  assert.equal(dayLabel('2026-10-31', NOW), 'Sat 31 Oct')
  assert.equal(dayLabel('2026-10-27', NOW), 'Tue 27 Oct')
  assert.equal(dayLabel('2025-10-27', NOW), 'Mon 27 Oct 2025')
  // just past midnight: yesterday was a minute ago
  const justAfter = at(2026, 11, 3, 0, 0)
  assert.equal(dayLabel(dayKey(at(2026, 11, 2, 23, 59)), justAfter), 'Yesterday')
  assert.equal(dayLabel(dayKey(justAfter), justAfter), 'Today')
  // New Year's Day: yesterday is last year's, and says "Yesterday", not its year; the day before has its year
  const ny = at(2027, 1, 1, 8)
  assert.equal(dayLabel('2026-12-31', ny), 'Yesterday')
  assert.equal(dayLabel('2026-12-30', ny), 'Wed 30 Dec 2026')
  assert.equal(dayLabel('2027-01-01', ny), 'Today')
  // the date alone (beside "Today" in the By date view)
  assert.equal(dayDate('2026-11-02', NOW), 'Mon 2 Nov')
  assert.equal(dayDate('2026-12-31', ny), 'Thu 31 Dec 2026')
})

test('dayStart / inTime: calendar days (today included in 7 and 30), older is the rest', () => {
  assert.equal(dayStart(NOW), at(2026, 11, 2, 0, 0))
  assert.equal(dayStart(NOW, 6), at(2026, 10, 27, 0, 0))
  assert.equal(dayStart(at(2026, 1, 3), 5), at(2025, 12, 29, 0, 0)) // (across the year)
  const cases = [
    [at(2026, 11, 2, 0, 0), ['any', 'today', '7d', '30d']],
    [at(2026, 11, 1, 23, 59), ['any', '7d', '30d']],
    [at(2026, 10, 27, 0, 0), ['any', '7d', '30d']], // the 7th day back, from its midnight
    [at(2026, 10, 26, 23, 59), ['any', '30d']],
    [at(2026, 10, 4, 0, 0), ['any', '30d']],
    [at(2026, 10, 3, 23, 59), ['any', 'older']],
    [at(2024, 1, 1), ['any', 'older']],
  ]
  for (const [t, want] of cases) for (const k of ['any', 'today', '7d', '30d', 'older']) assert.equal(inTime(t, k, NOW), want.includes(k), `${new Date(t).toString()} ${k}`)
  assert.equal(cleanView('date'), 'date')
  assert.equal(cleanView(null), 'site')
  assert.equal(whereOf('GitHub', 'vercel', 'today'), 'on GitHub · vercel from today')
  assert.equal(whereOf('YouTube', null, 'any'), 'on YouTube')
  assert.equal(whereOf(null, null, 'older'), 'from before the last 30 days')
})

test('dayStart: a DST night is still one day (New York, 2 Nov 2025 is 25 h long)', async () => {
  // (a child process: TZ is the whole process's)
  const { execFileSync } = await import('node:child_process')
  const code = `import('./lib/pins-view.js').then(({ dayStart, dayKey }) => {
    const now = new Date(2025, 10, 3, 9).getTime()
    console.log(JSON.stringify([dayKey(dayStart(now, 1)), dayKey(dayStart(now, 2)), new Date(dayStart(now, 1)).getHours()]))
  })`
  const out = execFileSync(process.execPath, ['-e', code], { cwd: new URL('..', import.meta.url), env: { ...process.env, TZ: 'America/New_York' } }).toString()
  assert.deepEqual(JSON.parse(out), ['2025-11-02', '2025-11-01', 0])
})

test('pathTop / repoOf: the first part of the path (decoded); GitHub links as owner/repo', () => {
  assert.equal(pathTop('https://github.com/vercel/next.js/issues/1'), 'vercel')
  assert.equal(pathTop('https://huggingface.co/Qwen/Qwen3-8B'), 'Qwen')
  assert.equal(pathTop('https://vi.wikipedia.org/wiki/%C4%90%C3%A0_L%E1%BA%A1t'), 'wiki')
  assert.equal(pathTop('https://example.com/'), null)
  assert.equal(pathTop('https://example.com/%E0%A4%A'), '%E0%A4%A') // (broken escapes: as they are)
  assert.equal(pathTop('not a link'), null)
  assert.equal(repoOf('https://github.com/vercel/next.js/pull/123/files'), 'vercel/next.js')
  assert.equal(repoOf('https://www.github.com/thewind121212'), 'thewind121212')
  assert.equal(repoOf('https://github.com/'), null)
  assert.equal(repoOf('https://gist.github.com/someone/abc'), null)
  assert.equal(repoOf('https://gitlab.com/a/b'), null)
  // GitHub: an org's page is its owner's; GitHub's own pages have none
  assert.equal(pathTop('https://github.com/orgs/vercel/repositories'), 'vercel')
  assert.equal(repoOf('https://github.com/orgs/vercel/repositories'), 'vercel')
  for (const u of ['https://github.com/settings/profile', 'https://github.com/search?q=x', 'https://github.com/topics/go', 'https://github.com/', 'https://github.com/Explore']) {
    assert.equal(pathTop(u), null, u)
    assert.equal(repoOf(u), null, u)
  }
})

test('linesOf: GitHub\'s told apart by their path (the kind of page first, then owner/repo); its endings go', () => {
  const gh = (path, title, description = null) => ({ url: `https://github.com${path}`, domain: 'github.com', site: 'GitHub', title, description })
  // a repo's own pages (GitHub titles them all "owner/repo: description"): its name
  assert.deepEqual(linesOf(gh('/vercel/next.js', 'GitHub - vercel/next.js: The React Framework', 'The React Framework')), { title: 'next.js', meta: 'vercel/next.js' })
  assert.deepEqual(linesOf(gh('/vercel/next.js/releases', 'GitHub - vercel/next.js: The React Framework')), { title: 'next.js', meta: 'releases · vercel/next.js' })
  assert.deepEqual(linesOf(gh('/a/b/wiki', 'GitHub - a/b: x')), { title: 'b', meta: 'wiki · a/b' })
  assert.deepEqual(linesOf(gh('/vercel/next.js', null)), { title: 'next.js', meta: 'vercel/next.js' })
  assert.deepEqual(linesOf(gh('/vercel/next.js', 'GitHub - ')), { title: 'next.js', meta: 'vercel/next.js' })
  // an issue, a PR: their own title, less GitHub's endings; the kind first under it (a cut line loses the repo)
  assert.deepEqual(linesOf(gh('/vercel/next.js/issues/71234', 'Bug: dev server hangs · Issue #71234 · vercel/next.js')), { title: 'Bug: dev server hangs', meta: 'issue #71234 · vercel/next.js' })
  assert.deepEqual(linesOf(gh('/vercel/next.js/pull/7/files', 'Fix the cache by dev42 · Pull Request #7 · vercel/next.js')), { title: 'Fix the cache', meta: 'PR #7 · vercel/next.js' })
  assert.deepEqual(linesOf(gh('/a/b/blob/main/app/pins.js', 'b/app/pins.js at main · a/b')), { title: 'b/app/pins.js at main', meta: 'pins.js · a/b' })
  assert.equal(linesOf(gh('/a/b/releases/tag/v4.0.0', 't')).meta, 'release v4.0.0 · a/b')
  assert.equal(linesOf(gh('/a/b/commit/0123456789abcdef', 't')).meta, 'commit 0123456 · a/b')
  assert.equal(linesOf(gh('/a/b/discussions/68888', 't')).meta, 'discussion #68888 · a/b')
  assert.deepEqual(linesOf(gh('/a/b/issues/1', null)), { title: 'b', meta: 'issue #1 · a/b' })
  // a repo whose title isn't GitHub's usual: as it is
  assert.deepEqual(linesOf(gh('/a/b', 'Something else')), { title: 'Something else', meta: 'a/b' })
  // an owner's page, an org's, GitHub's own pages: their title over the site
  assert.deepEqual(linesOf(gh('/thewind121212', 'thewind121212 - Overview')), { title: 'thewind121212 - Overview', meta: 'GitHub · github.com' })
  assert.deepEqual(linesOf(gh('/orgs/vercel', null)), { title: 'vercel', meta: 'GitHub · github.com' })
  assert.deepEqual(linesOf(gh('/settings/profile', 'Your profile')), { title: 'Your profile', meta: 'GitHub · github.com' })
  assert.deepEqual(linesOf(gh('/', null)), { title: 'github.com', meta: 'GitHub · github.com' })
  // other sites: their title (or domain) over their name and domain
  assert.deepEqual(linesOf({ url: 'https://www.youtube.com/watch?v=x', domain: 'youtube.com', site: 'YouTube', title: 'Lofi' }), { title: 'Lofi', meta: 'YouTube · youtube.com' })
  assert.deepEqual(linesOf({ url: 'https://pkg.go.dev/net/http', domain: 'pkg.go.dev', site: null, title: null }), { title: 'pkg.go.dev', meta: 'pkg.go.dev' })
  assert.deepEqual(linesOf({ url: 'https://example.com/GitHub', domain: 'example.com', site: null, title: 'GitHub - x' }), { title: 'GitHub - x', meta: 'example.com' })
})

test('siteName: what the pages call the site most, short; else the domain', () => {
  assert.equal(siteName([{ site: 'GitHub' }, { site: 'GitHub' }, { site: 'Gist' }, { site: null }], 'github.com'), 'GitHub')
  assert.equal(siteName([{ site: null }, {}], 'pkg.go.dev'), 'pkg.go.dev')
  assert.equal(siteName([{ site: 'A site name that is far too long for a chip' }], 'x.dev'), 'x.dev')
})

// a few pins like the owner's: GitHub's many pages over several days, a few other sites
const pin = (id, url, addedAt, more = {}) => {
  const domain = new URL(url).hostname.replace(/^www\./, '')
  return { id, url, domain, title: null, description: null, site: null, icon: null, addedAt, ...more }
}
const PINS = [
  pin('p01', 'https://github.com/thewind121212/home-lofi', at(2026, 11, 2, 9), { title: 'GitHub - thewind121212/home-lofi', site: 'GitHub', icon: 'https://github.com/favicon.ico' }),
  pin('p02', 'https://huggingface.co/Qwen/Qwen3-8B', at(2026, 11, 2, 8), { title: 'Qwen/Qwen3-8B · Hugging Face', site: 'Hugging Face' }),
  pin('p03', 'https://github.com/thewind121212/agent', at(2026, 11, 1, 22), { title: 'GitHub - thewind121212/agent', site: 'GitHub' }),
  pin('p04', 'https://github.com/vercel/next.js', at(2026, 10, 30, 10), { title: 'Next.js by Vercel', site: 'GitHub' }),
  pin('p05', 'https://github.com/TheWind121212/notes', at(2026, 10, 30, 9), { title: 'Ghi chú Đà Lạt', site: 'GitHub' }),
  pin('p06', 'https://www.youtube.com/watch?v=abc', at(2026, 10, 20), { title: 'Lofi beats', site: 'YouTube' }),
  pin('p07', 'https://github.com/vercel/swr', at(2026, 10, 12), { title: 'SWR', site: 'GitHub' }),
  pin('p08', 'https://github.com/golang/go', at(2026, 9, 1), { title: 'The Go language', site: 'GitHub' }),
  pin('p09', 'https://pkg.go.dev/net/http', at(2026, 9, 1), { title: 'http package' }),
]

test('prepare: sites by size (then the one pinned last), named and with an icon', () => {
  const p = prepare(PINS)
  assert.deepEqual(p.sites.map((s) => [s.key, s.name, s.total]), [
    ['github.com', 'GitHub', 6],
    ['huggingface.co', 'Hugging Face', 1],
    ['youtube.com', 'YouTube', 1],
    ['pkg.go.dev', 'pkg.go.dev', 1],
  ])
  assert.equal(p.sites[0].icon, 'https://github.com/favicon.ico')
  assert.equal(p.rows[4].top, 'thewind121212') // (owners in any case are one)
})

test('prepare: two sites by one name show their domains', () => {
  const w = (id, host) => pin(id, `https://${host}/wiki/X`, NOW, { site: 'Wikipedia' })
  const p = prepare([w('w1', 'en.wikipedia.org'), w('w2', 'vi.wikipedia.org'), pin('y1', 'https://youtube.com/watch?v=1', NOW, { site: 'YouTube' })])
  assert.deepEqual(p.sites.map((s) => s.name).sort(), ['YouTube', 'en.wikipedia.org', 'vi.wikipedia.org'])
})

test('facet: each count leaves out its own filter (the search and the others applied); found is all of them', () => {
  const p = prepare(PINS)
  const none = facet(p, {}, NOW)
  assert.equal(none.found.length, 9)
  assert.deepEqual(none.sites, { 'github.com': 6, 'huggingface.co': 1, 'youtube.com': 1, 'pkg.go.dev': 1 })
  assert.deepEqual(none.times, { any: 9, today: 2, '7d': 5, '30d': 7, older: 2 })
  assert.deepEqual(none.subs, [])

  // GitHub, 7 days: the sites' counts are 7 days' (any site), the times' are GitHub's (any time)
  const gh = facet(p, { site: 'github.com', time: '7d' }, NOW)
  assert.deepEqual(gh.found.map((x) => x.id), ['p01', 'p03', 'p04', 'p05'])
  assert.deepEqual(gh.sites, { 'github.com': 4, 'huggingface.co': 1 })
  assert.deepEqual(gh.times, { any: 6, today: 1, '7d': 4, '30d': 5, older: 1 })
  // its owners: all of them (whatever the time), most pins first, each counted in the 7 days; "TheWind121212" is one
  assert.deepEqual(gh.subs.map((s) => [s.key, s.label, s.total, s.n]), [
    ['thewind121212', 'thewind121212', 3, 3],
    ['vercel', 'vercel', 2, 1],
    ['golang', 'golang', 1, 0],
  ])
  // an owner picked: found and the times narrow to it, the owners' own counts don't
  const tw = facet(p, { site: 'github.com', sub: 'thewind121212' }, NOW)
  assert.deepEqual(tw.found.map((x) => x.id), ['p01', 'p03', 'p05'])
  assert.deepEqual(tw.times, { any: 3, today: 1, '7d': 3, '30d': 3, older: 0 })
  assert.deepEqual(tw.subs.map((s) => s.n), [3, 2, 1])

  // the search on top of it all (no accents, no case; a part of the link counts)
  const q = facet(p, { q: 'da LAT' }, NOW)
  assert.deepEqual(q.found.map((x) => x.id), ['p05'])
  assert.deepEqual(q.sites, { 'github.com': 1 })
  assert.equal(facet(p, { q: 'vercel', time: 'today' }, NOW).found.length, 0)
  assert.deepEqual(facet(p, { q: 'vercel', time: 'today' }, NOW).times, { any: 2, today: 0, '7d': 1, '30d': 2, older: 0 })
})

test('facet: no second row for a small site, or one whose parts group nothing', () => {
  const few = prepare(PINS.slice(0, 5)) // GitHub has 4 here (< SUB_MIN)
  assert.ok(SUB_MIN > 4)
  assert.deepEqual(facet(few, { site: 'github.com' }, NOW).subs, [])
  const lone = prepare(Array.from({ length: 8 }, (_, i) => pin(`q${i}x0000`, `https://github.com/owner${i}/r`, NOW - i * 1000)))
  assert.deepEqual(facet(lone, { site: 'github.com' }, NOW).subs, []) // (eight owners, one pin each: chips that say nothing)
  const yt = prepare(Array.from({ length: 8 }, (_, i) => pin(`y${i}x0000`, `https://youtube.com/watch?v=${i}`, NOW - i * 1000)))
  assert.deepEqual(facet(yt, { site: 'youtube.com' }, NOW).subs, []) // (all "watch")
})

test('byDay / bySite: newest day first; the biggest site first, a tie to the one pinned last; each newest first', () => {
  assert.deepEqual(byDay(PINS).map((d) => [d.key, d.pins.map((x) => x.id)]), [
    ['2026-11-02', ['p01', 'p02']],
    ['2026-11-01', ['p03']],
    ['2026-10-30', ['p04', 'p05']],
    ['2026-10-20', ['p06']],
    ['2026-10-12', ['p07']],
    ['2026-09-01', ['p08', 'p09']],
  ])
  assert.deepEqual(bySite(PINS).map((s) => [s.key, s.n]), [['github.com', 6], ['huggingface.co', 1], ['youtube.com', 1], ['pkg.go.dev', 1]])
  // (out of order in, newest first out: an Undo puts a pin back where it was)
  assert.deepEqual(bySite([PINS[3], PINS[0]])[0].pins.map((x) => x.id), ['p01', 'p04'])
  assert.deepEqual(byDay([]), [])
})

test('shownOf: a long section shows its first few; one only a little longer shows whole', () => {
  assert.equal(shownOf(3, false), 3)
  assert.equal(shownOf(SECTION_SHOWN + 2, false), SECTION_SHOWN + 2)
  assert.equal(shownOf(SECTION_SHOWN + 3, false), SECTION_SHOWN)
  assert.equal(shownOf(40, true), 40)
})

test('plan: the first sections up to the budget; a long one (opened too) cut short for now; folded ones don\'t count', () => {
  // three sections: 40 (closed: 4 of them), 3, 100 (opened: "Show N more" grows 60 at a time like the rest)
  assert.deepEqual(plan([40, 3, 100], [{}, {}, { open: true }], 60), { parts: [{ take: 4, cut: false }, { take: 3, cut: false }, { take: 53, cut: true }], more: true })
  assert.deepEqual(plan([40, 3, 100], [{}, {}, { open: true }], 120), { parts: [{ take: 4, cut: false }, { take: 3, cut: false }, { take: 100, cut: false }], more: false })
  // the budget runs out: the later sections wait
  assert.deepEqual(plan([5, 5, 5], [{}, {}, {}], 8), { parts: [{ take: 5, cut: false }, { take: 3, cut: true }], more: true })
  // folded: drawn (to fold away), not counted
  assert.deepEqual(plan([30, 2], [{ shut: true }, {}], 6), { parts: [{ take: 4, cut: false }, { take: 2, cut: false }], more: false })
  assert.deepEqual(plan([30, 9], [{ shut: true, open: true }, {}], 6), { parts: [{ take: 6, cut: true }, { take: 4, cut: false }], more: true })
  assert.deepEqual(plan([], [], 60), { parts: [], more: false })
})

test('partsOf / liveFilters: a part with no chip, a site with no pins, filters hidden: none of them holds', () => {
  const gh = (id, path, ago) => pin(id, `https://github.com/${path}`, NOW - ago)
  let pins = [gh('a1', 'vercel/next.js', 1), gh('a2', 'facebook/react', 2), gh('a3', 'facebook/jest', 3), gh('a4', 'x/y', 4), gh('a5', 'x/z', 5), gh('a6', 'z/w', 6), gh('a7', 'z/q', 7)]
  let p = prepare(pins)
  assert.deepEqual(partsOf(p, 'github.com').map((x) => [x.key, x.total]), [['facebook', 2], ['x', 2], ['z', 2], ['vercel', 1]])
  assert.deepEqual(liveFilters(p, { site: 'github.com', sub: 'vercel', time: '7d' }), { site: 'github.com', sub: 'vercel', time: '7d', parts: partsOf(p, 'github.com') })
  // vercel's last pin goes: no chip for it, so no filter either (it would hide everything, unseen)
  pins = pins.filter((x) => x.id !== 'a1')
  p = prepare(pins)
  assert.equal(liveFilters(p, { site: 'github.com', sub: 'vercel' }).sub, null)
  assert.equal(facet(p, { site: 'github.com', sub: liveFilters(p, { site: 'github.com', sub: 'vercel' }).sub }, NOW).found.length, 6)
  // the site shrinks below SUB_MIN: no parts row, no part
  p = prepare(pins.slice(0, SUB_MIN - 1))
  assert.deepEqual(liveFilters(p, { site: 'github.com', sub: 'facebook' }), { site: 'github.com', sub: null, time: 'any', parts: [] })
  // a site with no pins left, or the filters hidden (a handful of pins)
  assert.equal(liveFilters(p, { site: 'youtube.com' }).site, null)
  assert.deepEqual(liveFilters(p, { site: 'github.com', time: 'today' }, false), { site: null, sub: null, time: 'any', parts: [] })
})

test('marks: the words found, no case or accents, mapped back onto the text as written', () => {
  const m = (t, q) => marks(t, q).map((x) => (x.hit ? `[${x.text}]` : x.text)).join('')
  assert.equal(m('Đà Lạt trip — Café list', 'da lat'), '[Đà] [Lạt] trip — Café list')
  assert.equal(m('Đà Lạt trip — Café list', 'CAFE'), 'Đà Lạt trip — [Café] list')
  // written with separate accents (NFD): the accent stays inside its mark
  const nfd = 'Café list'.normalize('NFD')
  assert.equal(m(nfd, 'cafe'), `[${'Café'.normalize('NFD')}] list`)
  // every time it's there; overlapping words make one mark
  assert.equal(m('next.js and Next', 'next'), '[next].js and [Next]')
  assert.equal(m('GitHub', 'git github'), '[GitHub]')
  assert.equal(m('Tiếng Việt cho người mới', 'viet nguoi'), 'Tiếng [Việt] cho [người] mới')
  // one letter marks nothing; nothing found: the text as one piece
  assert.equal(m('a banana', 'a'), 'a banana')
  assert.deepEqual(marks('plain', 'zzz'), [{ text: 'plain', hit: false }])
  assert.deepEqual(marks('', 'x'), [])
  assert.deepEqual(marks(null, 'xx'), [])
  // characters outside the BMP don't shift the marks
  assert.equal(m('🎵 lofi beats', 'lofi'), '🎵 [lofi] beats')
  // Greek's final ς: marked where the search finds it (the whole text folded, as the search folds it)
  assert.equal(m('ΣΟΦΟΣ σοφος', 'σοφος'), '[ΣΟΦΟΣ] [σοφος]')
  assert.equal(m('ΟΔΟΣ', 'οδος'), '[ΟΔΟΣ]')
  // the pieces always add up to the text
  for (const [t, q] of [['Đà Lạt', 'lat'], [nfd, 'li'], ['İstanbul', 'stan']]) assert.equal(marks(t, q).map((x) => x.text).join(''), t)
})

test('sheetKey: / to the box (not while typing); Esc clears the search, then the filters, then lets the sheet close', () => {
  const k = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...mods })
  assert.equal(sheetKey(k('/')), 'focus')
  assert.equal(sheetKey(k('/'), { typing: true }), null)
  assert.equal(sheetKey(k('/', { ctrlKey: true })), null)
  assert.equal(sheetKey(k('Escape'), { q: true, filtered: true }), 'clear-q')
  assert.equal(sheetKey(k('Escape'), { filtered: true }), 'clear-filters')
  assert.equal(sheetKey(k('Escape'), { typing: true, filtered: true }), 'clear-filters')
  assert.equal(sheetKey(k('Escape')), null)
  assert.equal(sheetKey(k('a')), null)
  assert.equal(sheetKey(null), null)
  // an IME composing: its keys are its own
  assert.equal(sheetKey(k('Escape', { isComposing: true }), { q: true }), null)
  assert.equal(sheetKey(k('/', { keyCode: 229 })), null)
})
