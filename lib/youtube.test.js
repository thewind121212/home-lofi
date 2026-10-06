import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asStream, pick, viewers } from './youtube.js'
import { MOODS, STATIONS } from './stations.js'

test('viewers: the "N watching" count, K / M / commas', () => {
  assert.equal(viewers('3.6K watching'), 3600)
  assert.equal(viewers('427 watching'), 427)
  assert.equal(viewers('1.2M watching'), 1200000)
  assert.equal(viewers('12,345 watching'), 12345)
  assert.equal(viewers('1.2M views'), null)
  assert.equal(viewers(undefined), null)
})

test('asStream: channel lockups and search results, with the live badge and the watching count', () => {
  const lockup = {
    content_id: 'aaaaaaaaaaa',
    metadata: { title: { text: 'Relax Bossa LIVE 24/7' }, metadata: { metadata_rows: [{ metadata_parts: [{ text: { text: '3.6K watching' } }] }] } },
    content_image: { overlays: [{ badges: [{ text: 'LIVE' }] }] },
  }
  assert.deepEqual(asStream(lockup), { videoId: 'aaaaaaaaaaa', title: 'Relax Bossa LIVE 24/7', live: true, watching: 3600 })
  const vod = { content_id: 'bbbbbbbbbbb', metadata: { title: { text: 'old mix' } }, content_image: { overlays: [{ badges: [{ text: '1:02:03' }] }] } }
  assert.equal(asStream(vod).live, false)
  assert.deepEqual(asStream({ id: 'ccccccccccc', title: { text: 'Synthwave radio' }, is_live: true, view_count: { text: '427 watching' } }), {
    videoId: 'ccccccccccc',
    title: 'Synthwave radio',
    live: true,
    watching: 427,
  })
})

test('pick: the first live one whose title has the word, any case', () => {
  const s = [{ videoId: 'a', title: 'old Ghibli mix', live: false }, { videoId: 'b', title: '夏夜のジブリ Studio GHIBLI piano', live: true }, { videoId: 'c', title: 'Ghibli too', live: true }]
  assert.equal(pick(s, 'Ghibli').videoId, 'b')
  assert.equal(pick(s, 'nope'), null)
  assert.equal(pick(s, '').videoId, 'b') // empty word: the first live one (the search fallback)
})

test('stations: unique ids, a known mood; youtube = channel + match + query (no ids), stream = an https url', () => {
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, STATIONS.length)
  const moods = new Set(MOODS.map(([id]) => id))
  for (const s of STATIONS) {
    assert.ok(moods.has(s.mood) && s.emoji && s.name && s.by, s.id)
    if (s.kind === 'youtube') assert.ok(/^UC[\w-]{22}$/.test(s.channel) && s.match && s.query && !('videoId' in s) && !('url' in s), s.id)
    else assert.ok(s.kind === 'stream' && /^https:\/\//.test(s.url), s.id)
  }
})
