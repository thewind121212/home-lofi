import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asStream, pick } from './youtube.js'
import { STATIONS } from './stations.js'

test('asStream: channel lockups and search results, with the live badge', () => {
  const lockup = { content_id: 'aaaaaaaaaaa', metadata: { title: { text: 'Relax Bossa LIVE 24/7' } }, content_image: { overlays: [{ badges: [{ text: 'LIVE' }] }] } }
  assert.deepEqual(asStream(lockup), { videoId: 'aaaaaaaaaaa', title: 'Relax Bossa LIVE 24/7', live: true })
  const vod = { content_id: 'bbbbbbbbbbb', metadata: { title: { text: 'old mix' } }, content_image: { overlays: [{ badges: [{ text: '1:02:03' }] }] } }
  assert.equal(asStream(vod).live, false)
  assert.deepEqual(asStream({ id: 'ccccccccccc', title: { text: 'Synthwave radio' }, is_live: true }), { videoId: 'ccccccccccc', title: 'Synthwave radio', live: true })
})

test('pick: the first live one whose title has the word, any case', () => {
  const s = [{ videoId: 'a', title: 'old Ghibli mix', live: false }, { videoId: 'b', title: '夏夜のジブリ Studio GHIBLI piano', live: true }, { videoId: 'c', title: 'Ghibli too', live: true }]
  assert.equal(pick(s, 'Ghibli'), 'b')
  assert.equal(pick(s, 'nope'), null)
  assert.equal(pick(s, ''), 'b') // empty word: the first live one (the search fallback)
})

test('stations: 10 genres, unique ids, a channel id, a match word and a fallback search', () => {
  assert.equal(STATIONS.length, 10)
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, 10)
  for (const s of STATIONS) assert.ok(/^UC[\w-]{22}$/.test(s.channel) && s.match && s.query && !('videoId' in s), s.id)
})
