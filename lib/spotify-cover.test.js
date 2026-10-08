import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverCache, trackIdOf } from './spotify-cover.js'

const ok = (url) => new Response(JSON.stringify({ thumbnail_url: url, title: 't' }), { status: 200 })

test('trackIdOf: only spotify:track URIs', () => {
  assert.equal(trackIdOf('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), '4cOdK2wGLETKBW3PvgPWqT')
  assert.equal(trackIdOf('spotify:episode:x'), null)
  assert.equal(trackIdOf(null), null)
})

test('coverCache: asks Spotify once per track, remembers, a few at a time, only Spotify image hosts', async () => {
  const asked = []
  let open = 0
  let most = 0
  const c = coverCache({
    fetchImpl: async (url) => {
      asked.push(url)
      most = Math.max(most, ++open)
      await new Promise((r) => setTimeout(r, 5))
      open--
      if (url.includes('bad')) return ok('https://evil.example/x.jpg')
      if (url.includes('gone')) return new Response('nope', { status: 404 })
      return ok('https://image-cdn-ak.spotifycdn.com/image/abc')
    },
  })
  const uris = Array.from({ length: 8 }, (_, i) => `spotify:track:track00000${i}`)
  const covers = await Promise.all([...uris, uris[0]].map((u) => c.cover(u)))
  assert.equal(covers[0], 'https://image-cdn-ak.spotifycdn.com/image/abc')
  assert.equal(asked.length, 8) // the repeat waited for the same answer
  assert.ok(most <= 6) // a few at a time
  assert.equal(c.known(uris[3]), 'https://image-cdn-ak.spotifycdn.com/image/abc')
  assert.equal(await c.cover(uris[3]), 'https://image-cdn-ak.spotifycdn.com/image/abc')
  assert.equal(asked.length, 8) // remembered
  assert.equal(await c.cover('spotify:track:badbadbad'), null) // not a Spotify image host
  assert.equal(await c.cover('spotify:track:gonegone1'), null)
  assert.equal(c.known('spotify:track:never0000'), undefined)
  assert.equal(await c.cover('spotify:episode:x'), null)
  assert.equal(c.known('spotify:episode:x'), null) // not a track: nothing to ask
})

test('coverCache: asks made together are served newest first (the rows showing are asked last)', async () => {
  const asked = []
  const c = coverCache({ fetchImpl: async (url) => (asked.push(url.match(/track%2F(\w+)/)[1]), await new Promise((r) => setTimeout(r, 5)), ok('https://i.scdn.co/image/z')) })
  const ids = Array.from({ length: 9 }, (_, i) => `order0000${i}`)
  await Promise.all(ids.map((id) => c.cover(`spotify:track:${id}`)))
  assert.deepEqual(asked, [...ids].reverse()) // six at once from the newest, then the rest, still newest first
})

test('coverCache: a passing failure (429, 5xx, network) is asked again later; a 404 is remembered', async () => {
  let n = 0
  const c = coverCache({ fetchImpl: async () => (++n === 1 ? new Response('slow down', { status: 429 }) : ok('https://i.scdn.co/image/x')) })
  assert.equal(await c.cover('spotify:track:abcdef123'), null)
  assert.equal(c.known('spotify:track:abcdef123'), undefined) // not remembered
  assert.equal(await c.cover('spotify:track:abcdef123'), 'https://i.scdn.co/image/x')
  const d = coverCache({ fetchImpl: async () => new Response('nope', { status: 404 }) })
  await d.cover('spotify:track:abcdef123')
  assert.equal(d.known('spotify:track:abcdef123'), null) // remembered: no cover
})

test('coverCache: found covers are kept across reloads (store), misses are not', async () => {
  let saved = null
  const store = { load: () => [['keptkept01', 'https://i.scdn.co/image/k']], save: (e) => (saved = e) }
  const c = coverCache({ store, fetchImpl: async (url) => (url.includes('newnew0001') ? ok('https://i.scdn.co/image/n') : new Response('no', { status: 404 })) })
  assert.equal(c.known('spotify:track:keptkept01'), 'https://i.scdn.co/image/k') // from the store, no request
  await c.cover('spotify:track:newnew0001')
  await c.cover('spotify:track:missmiss01')
  await new Promise((r) => setTimeout(r, 1100)) // the save is batched
  assert.deepEqual(saved, [['keptkept01', 'https://i.scdn.co/image/k'], ['newnew0001', 'https://i.scdn.co/image/n']])
  const broken = coverCache({ store: { load: () => { throw new Error('blocked') }, save: () => {} } })
  assert.equal(broken.known('spotify:track:keptkept01'), undefined) // a blocked storage is just empty
})

test('coverCache: stored entries are checked like fresh answers; a 429 pauses the next requests', async () => {
  const c = coverCache({ store: { load: () => [['goodgood01', 'https://i.scdn.co/image/g'], ['badbad0001', 'javascript:alert(1)'], ['evilevil01', 'https://evil.example/p.gif'], ['../x', 'https://i.scdn.co/image/x']], save: () => {} } })
  assert.equal(c.known('spotify:track:goodgood01'), 'https://i.scdn.co/image/g')
  assert.equal(c.known('spotify:track:badbad0001'), undefined)
  assert.equal(c.known('spotify:track:evilevil01'), undefined)
  const times = []
  let first = true
  const d = coverCache({ fetchImpl: async () => (times.push(Date.now()), first ? ((first = false), new Response('slow', { status: 429, headers: { 'retry-after': '1' } })) : ok('https://i.scdn.co/image/y')) })
  await d.cover('spotify:track:aaaaaa0001')
  await d.cover('spotify:track:aaaaaa0002')
  assert.ok(times[1] - times[0] >= 900) // waited for Retry-After
})
