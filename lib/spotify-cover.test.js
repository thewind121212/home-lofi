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
  assert.ok(most <= 3) // a few at a time
  assert.equal(c.known(uris[3]), 'https://image-cdn-ak.spotifycdn.com/image/abc')
  assert.equal(await c.cover(uris[3]), 'https://image-cdn-ak.spotifycdn.com/image/abc')
  assert.equal(asked.length, 8) // remembered
  assert.equal(await c.cover('spotify:track:badbadbad'), null) // not a Spotify image host
  assert.equal(await c.cover('spotify:track:gonegone1'), null)
  assert.equal(c.known('spotify:track:never0000'), undefined)
  assert.equal(await c.cover('spotify:episode:x'), null)
})
