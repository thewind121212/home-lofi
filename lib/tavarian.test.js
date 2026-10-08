import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIONS, _resetSearchSourceForTests, call, failure, freshen, readHome, resetCache, retryAfter, shapeQueue, shapeResolved, shapeResult, shapeSettings, shapeState, tavarianOn, ticketFor, validClientId,
} from './tavarian.js'

const TOKEN = 'fake-test-token-not-real-0001' // never a real one
process.env.TAVARIAN_URL = 'https://tav.test/'
process.env.TAVARIAN_TOKEN = TOKEN

const envelope = (data, status = 200, headers = {}) => new Response(JSON.stringify({ success: true, data }), { status, headers })
const refusal = (error, status, headers = {}) => new Response(JSON.stringify({ success: false, error }), { status, headers })
// replaces fetch for one test; reply(url, init) -> Response (or throws)
function mockFetch(t, reply) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => (calls.push({ url, init }), reply(url, init, calls.length)))
  return calls
}
const song = (id, extra = {}) => ({ id, youtubeId: 'yt' + id, title: 'Song ' + id, thumbnail: 't', durationSeconds: 200, status: 'queued', addedAt: 'a', playedAt: null, failReason: null, ...extra })

beforeEach(() => (resetCache(), _resetSearchSourceForTests()))

test('tavarianOn: needs the token', () => {
  delete process.env.TAVARIAN_TOKEN
  assert.equal(tavarianOn(), false)
  process.env.TAVARIAN_TOKEN = TOKEN
  assert.equal(tavarianOn(), true)
})

test('call: envelope data, the bearer token, JSON body, never an Origin header', async (t) => {
  const calls = mockFetch(t, () => envelope({ hello: 1 }))
  assert.deepEqual(await call('POST', '/home/queue', { youtubeUrl: 'u' }), { ok: true, status: 200, data: { hello: 1 } })
  const { url, init } = calls[0]
  assert.equal(url, 'https://tav.test/api/v1/home/queue') // trailing slash of TAVARIAN_URL dropped
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(init.headers['content-type'], 'application/json')
  assert.equal(init.body, '{"youtubeUrl":"u"}')
  assert.ok(!Object.keys(init.headers).some((k) => k.toLowerCase() === 'origin'))
  assert.ok(init.signal instanceof AbortSignal) // the 5 s timeout
  await call('GET', '/home/state')
  assert.equal(calls[1].init.body, undefined)
  assert.equal(calls[1].init.headers['content-type'], undefined)
})

test('call: error codes, statuses, Retry-After; never throws', async (t) => {
  const replies = [
    refusal('duplicate', 409),
    refusal('rate_limited', 429, { 'retry-after': '7' }),
    new Response('<html>oops</html>', { status: 500 }),
    new Response(JSON.stringify({ success: false }), { status: 200 }),
    new Response(null, { status: 204 }),
    refusal(`Bearer ${TOKEN} is wrong`, 401), // a code that isn't one: never passed on
  ]
  mockFetch(t, (u, i, n) => replies[n - 1])
  assert.deepEqual(await call('POST', '/home/queue', {}), { ok: false, status: 409, error: 'duplicate' })
  assert.deepEqual(await call('GET', '/home/state'), { ok: false, status: 429, error: 'rate_limited', retryAfter: 7 })
  assert.deepEqual(await call('GET', '/home/state'), { ok: false, status: 500, error: 'http_500' })
  assert.deepEqual(await call('GET', '/home/state'), { ok: false, status: 502, error: 'bad_response' })
  assert.deepEqual(await call('POST', '/token/revoke-self'), { ok: true, status: 204, data: null })
  assert.deepEqual(await call('GET', '/home/state'), { ok: false, status: 401, error: 'http_401' })
})

test('call: network failure -> unreachable, timeout -> timeout, no token -> no call', async (t) => {
  const errors = [new TypeError('fetch failed'), new DOMException('The operation was aborted due to timeout', 'TimeoutError')]
  const calls = mockFetch(t, (u, i, n) => {
    throw errors[n - 1]
  })
  assert.deepEqual(await call('GET', '/home/state'), { ok: false, status: 0, error: 'unreachable' })
  assert.deepEqual(await call('GET', '/home/state'), { ok: false, status: 0, error: 'timeout' })
  delete process.env.TAVARIAN_TOKEN
  assert.deepEqual(await call('GET', '/home/state'), { ok: false, status: 0, error: 'tavarian_off' })
  process.env.TAVARIAN_TOKEN = TOKEN
  assert.equal(calls.length, 2)
})

test('retryAfter: seconds or an HTTP date', () => {
  assert.equal(retryAfter('12'), 12)
  assert.equal(retryAfter(new Date(10_000).toUTCString(), 0), 10)
  assert.equal(retryAfter('soon'), null)
  assert.equal(retryAfter(null), null)
})

test('shapes: only the listed fields pass through', () => {
  const state = shapeState({ song: song(1, { requestedBy: 'u-1', ownerId: 9 }), status: 'playing', positionSeconds: 3, startedAtMs: 1, serverNowMs: 2, streamId: 's', token: TOKEN })
  assert.deepEqual(Object.keys(state), ['song', 'status', 'positionSeconds', 'startedAtMs', 'serverNowMs', 'streamId', 'playingVia', 'stalledReason'])
  assert.deepEqual(Object.keys(state.song), ['id', 'youtubeId', 'title', 'thumbnail', 'durationSeconds', 'status', 'addedAt', 'playedAt', 'failReason', 'source', 'spotifyUri', 'artist', 'matchConfidence', 'metadataSource', 'youtubeTitle', 'youtubeThumbnail', 'spotifyTitle', 'spotifyThumbnail', 'artists', 'album'])
  assert.deepEqual(shapeState({}), { song: null, status: 'idle', positionSeconds: 0, startedAtMs: null, serverNowMs: null, streamId: null, playingVia: null, stalledReason: null })
  assert.equal(shapeState({ playingVia: 'spotify' }).playingVia, 'spotify')
  assert.equal(shapeState({ playingVia: 'tape' }).playingVia, null)
  assert.equal(shapeState({ stalledReason: 'spotify_search_off' }).stalledReason, 'spotify_search_off')
  assert.equal(shapeState({ stalledReason: '<b>x</b>' }).stalledReason, null)
  assert.equal(shapeState(null), null)
  assert.deepEqual(shapeQueue({ items: [song(1), 'junk', null], recent: 'x', secret: 1 }), { items: [shapeState({ song: song(1) }).song], recent: [] })
})

test('freshen: moves serverNowMs and a playing position on, up to the song end', () => {
  const s = { song: { durationSeconds: 100 }, status: 'playing', positionSeconds: 10, serverNowMs: 5000 }
  assert.deepEqual(freshen(s, 1000, 3000), { ...s, positionSeconds: 12, serverNowMs: 7000 })
  assert.equal(freshen(s, 0, 500_000).positionSeconds, 100)
  assert.equal(freshen({ ...s, status: 'paused' }, 1000, 3000).positionSeconds, 10)
  assert.equal(freshen(s, 1000, 1000), s)
  assert.equal(freshen(null, 1, 2), null)
})

test('readHome: one call per 3 s for everyone, concurrent callers share it, last good answer on failure', async (t) => {
  let now = 1_000_000
  t.mock.method(Date, 'now', () => now)
  let fail = false
  const calls = mockFetch(t, (url) => {
    if (fail) throw new TypeError('down')
    return url.endsWith('/home/state') ? envelope({ status: 'idle', serverNowMs: 1 }) : envelope({ items: [song(1)], recent: [] })
  })
  const [a, b] = await Promise.all([readHome(), readHome()])
  assert.equal(calls.length, 2) // state + queue, once
  assert.deepEqual(a, b)
  assert.equal(a.ok, true)
  assert.equal(a.state.status, 'idle')
  assert.equal(a.queue.items[0].id, 1)
  now += 2999
  await readHome()
  assert.equal(calls.length, 2) // cached
  now += 1
  fail = true
  const c = await readHome()
  assert.equal(calls.length, 4)
  assert.equal(c.ok, true)
  assert.equal(c.stale, true)
  assert.equal(c.error, 'unreachable')
  assert.deepEqual(c.queue, a.queue)
  resetCache()
  assert.deepEqual(await readHome(), { ok: false, status: 0, error: 'unreachable' }) // nothing good yet
})

test('validClientId / ticketFor: checks the id, builds the stream URL', async (t) => {
  for (const bad of ['short', 'x'.repeat(65), 'has space1', 'dots.are.no', 12345678, null, undefined]) assert.equal(validClientId(bad), false)
  assert.equal(validClientId('tab_ABC-123'), true)
  const calls = mockFetch(t, (u, i, n) =>
    n === 1 ? envelope({ ticket: 'tk1', expiresAt: '2026-10-06T10:00:00Z', streamBase: '/home-audio/stream' }) : envelope({ ticket: 'tk2', expiresAt: 'e', streamBase: '//evil.test/x' }),
  )
  assert.deepEqual(await ticketFor('bad id'), { ok: false, status: 400, error: 'invalid_client_id' })
  assert.equal(calls.length, 0)
  assert.deepEqual(await ticketFor('tab_ABC-123'), {
    ok: true,
    status: 200,
    data: { ticket: 'tk1', expiresAt: '2026-10-06T10:00:00Z', streamUrl: 'https://tav.test/home-audio/stream' },
  })
  assert.equal(calls[0].init.body, '{"clientId":"tab_ABC-123"}')
  assert.equal((await ticketFor('tab_ABC-123')).data.streamUrl, 'https://tav.test/home-audio/stream') // only a plain path is taken
})

test('ACTIONS: bad input is refused here, good input reaches the right endpoint', async (t) => {
  const calls = mockFetch(t, (url) => {
    if (url.includes('/home/search')) return envelope([{ youtubeId: 'a', youtubeUrl: 'u', title: 't', thumbnail: 'th', channel: 'c', durationSeconds: 1, views: 9 }])
    if (url.includes('/from-playlist')) return envelope({ added: [song(2)], skipped: [{ youtubeId: 'b', reason: 'duplicate', x: 1 }] })
    if (url.endsWith('/token')) return envelope({ name: 'home', scopes: ['home'], createdAt: 'c', expiresAt: null, lastUsedAt: 'l', token: TOKEN, hash: 'h' })
    if (url.includes('/playback/')) return envelope({ status: 'playing', song: song(1) })
    return envelope({ items: [], recent: [] })
  })
  const refused = [
    ['add', {}], ['add', { youtubeUrl: 5 }], ['remove', { id: '../x' }], ['reorder', { ids: 'a' }], ['reorder', { ids: [1, '/'] }],
    ['search', { q: 'a' }], ['search', { q: 'x'.repeat(201) }], ['seek', { seconds: -1 }], ['seek', { seconds: '5' }],
    ['playlist-songs', { id: '' }], ['from-playlist', { playlistId: 'p', youtubeIds: 'x' }],
  ]
  for (const [a, b] of refused) assert.equal((await ACTIONS[a](b)).status, 400, a)
  assert.equal(calls.length, 0)

  assert.deepEqual((await ACTIONS.search({ q: ' lofi & chill ' })).data, {
    results: [{ source: 'youtube', url: 'u', youtubeId: 'a', youtubeUrl: 'u', spotifyUri: null, spotifyUrl: null, title: 't', artists: null, artist: null, album: null, thumbnail: 'th', channel: 'c', durationSeconds: 1, explicit: null }],
    source: 'youtube', // (the station isn't in Spotify mode)
  })
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/search?q=lofi%20%26%20chill')
  assert.equal((await ACTIONS.skip({})).data.state.status, 'playing')
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/playback/skip')
  await ACTIONS.seek({ seconds: 42 })
  assert.equal(calls.at(-1).init.body, '{"seconds":42}')
  await ACTIONS.remove({ id: 'abc' })
  assert.equal(calls.at(-1).init.method, 'DELETE')
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/queue/abc')
  assert.deepEqual((await ACTIONS['from-playlist']({ playlistId: 'p1', youtubeIds: ['b'] })).data.skipped, [{ youtubeId: 'b', reason: 'duplicate' }])
  assert.equal(calls.at(-1).init.body, '{"playlistId":"p1","youtubeIds":["b"]}')
  const info = await ACTIONS.token({})
  assert.deepEqual(Object.keys(info.data.token), ['name', 'scopes', 'createdAt', 'expiresAt', 'lastUsedAt'])
  assert.ok(!JSON.stringify(info).includes(TOKEN))
})

test('ACTIONS: play-now, next, add with a placement, import (with a long timeout)', async (t) => {
  const timeouts = []
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal, 'timeout', (ms) => (timeouts.push(ms), timeout(ms)))
  const calls = mockFetch(t, (url) => {
    if (url.endsWith('/play-now')) return envelope({ status: 'loading', song: song(3), positionSeconds: 0, streamId: null, secret: 1 })
    if (url.endsWith('/queue/next')) return envelope({ items: [song(3), song(1)], recent: [] })
    if (url.endsWith('/queue/import'))
      return envelope({
        source: { kind: 'spotify_playlist', title: 'Chill', token: TOKEN },
        added: [song(5), song(6)],
        skipped: [{ youtubeId: null, title: 'Nope', reason: 'no_match', extra: 1 }],
        found: 140,
        truncated: { limit: 100, dropped: 40, reason: 'import_max', x: 1 },
      })
    return envelope(song(9))
  })
  const refused = [
    ['play-now', {}], ['play-now', { id: '../1' }], ['next', { id: null }], ['add', { youtubeUrl: 'https://youtu.be/x', placement: 'top' }],
    ['import', {}], ['import', { url: 'x'.repeat(501) }], ['import', { url: 'https://youtube.com/playlist?list=PL1', placement: 'first' }],
  ]
  for (const [a, b] of refused) assert.equal((await ACTIONS[a](b)).status, 400, a)
  assert.equal(calls.length, 0)

  const now = await ACTIONS['play-now']({ id: 3 })
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/playback/play-now')
  assert.equal(calls.at(-1).init.body, '{"id":3}')
  assert.equal(now.data.state.song.id, 3)
  assert.ok(!('secret' in now.data.state))
  assert.deepEqual((await ACTIONS.next({ id: 3 })).data.queue.items.map((s) => s.id), [3, 1])
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/queue/next')
  await ACTIONS.add({ youtubeUrl: ' https://youtu.be/x ', placement: 'now' })
  assert.equal(calls.at(-1).init.body, '{"youtubeUrl":"https://youtu.be/x","placement":"now"}')
  await ACTIONS.add({ youtubeUrl: 'https://youtu.be/x' })
  assert.equal(calls.at(-1).init.body, '{"youtubeUrl":"https://youtu.be/x"}') // no placement: Tavarian's default (end)
  const im = await ACTIONS.import({ url: 'https://open.spotify.com/playlist/abc', placement: 'next' })
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/queue/import')
  assert.equal(calls.at(-1).init.body, '{"url":"https://open.spotify.com/playlist/abc","placement":"next"}')
  assert.deepEqual(im.data.skipped, [{ youtubeId: null, title: 'Nope', reason: 'no_match' }])
  assert.deepEqual(im.data.truncated, { limit: 100, dropped: 40, reason: 'import_max' })
  assert.equal(im.data.found, 140)
  assert.deepEqual(im.data.added.map((s) => s.id), [5, 6])
  assert.ok(!JSON.stringify(im).includes(TOKEN))
  assert.deepEqual(timeouts, [5000, 5000, 5000, 5000, 120_000]) // only the import waits long
})

test('ACTIONS: remove-bulk (numbers, 1-200 ids) and clear (includeCurrent only when true)', async (t) => {
  const calls = mockFetch(t, (url) =>
    url.endsWith('/remove-bulk')
      ? envelope({ removed: 2, skipped: [9, 'x'], queue: { items: [song(3)], recent: [], secret: 1 }, extra: TOKEN })
      : envelope({ removed: 5, skipped: [], queue: { items: [], recent: [song(1)] } }),
  )
  const refused = [
    ['remove-bulk', {}], ['remove-bulk', { ids: [] }], ['remove-bulk', { ids: 'x' }], ['remove-bulk', { ids: [1, '../2'] }],
    ['remove-bulk', { ids: [0] }], ['remove-bulk', { ids: [1.5] }], ['remove-bulk', { ids: Array.from({ length: 201 }, (_, i) => i + 1) }],
    ['clear', { includeCurrent: 'yes' }],
  ]
  for (const [a, b] of refused) assert.equal((await ACTIONS[a](b)).status, 400, a)
  assert.equal((await ACTIONS['remove-bulk']({ ids: [] })).error, 'invalid_ids')
  assert.equal(calls.length, 0)

  const r = await ACTIONS['remove-bulk']({ ids: [1, '2', 2, 9] })
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/queue/remove-bulk')
  assert.equal(calls.at(-1).init.body, '{"ids":[1,2,9]}') // numbers, once each
  assert.deepEqual(r.data, { removed: 2, skipped: [9], queue: { items: [shapeQueue({ items: [song(3)] }).items[0]], recent: [] } })
  assert.ok(!JSON.stringify(r).includes(TOKEN))
  assert.ok((await ACTIONS['remove-bulk']({ ids: Array.from({ length: 200 }, (_, i) => i + 1) })).ok)

  await ACTIONS.clear({})
  assert.equal(calls.at(-1).url, 'https://tav.test/api/v1/home/queue/clear')
  assert.equal(calls.at(-1).init.body, '{}')
  await ACTIONS.clear({ includeCurrent: false })
  assert.equal(calls.at(-1).init.body, '{}')
  const c = await ACTIONS.clear({ includeCurrent: true })
  assert.equal(calls.at(-1).init.body, '{"includeCurrent":true}')
  assert.equal(c.data.removed, 5)
  assert.deepEqual(c.data.queue.recent.map((s) => s.id), [1])
})

test('failure: an older Tavarian without the route (plain 404) reads plainly', () => {
  assert.equal(failure({ status: 404, error: 'http_404' }).status, 404)
  assert.match(failure({ status: 404, error: 'http_404' }).body.error, /may need an update/)
  assert.match(failure({ status: 400, error: 'invalid_ids' }).body.error, /1 and 200/)
})

test('failure: the new refusals read plainly', () => {
  assert.equal(failure({ status: 409, error: 'not_queued' }).body.error, 'That song already played')
  assert.equal(failure({ status: 422, error: 'live_stream' }).body.error, "Live streams can't be played")
  assert.equal(failure({ status: 422, error: 'mix_not_supported' }).status, 422)
  assert.match(failure({ status: 400, error: 'unsupported_url' }).body.error, /YouTube and Spotify links/)
  assert.equal(failure({ status: 0, error: 'timeout' }).status, 504)
})

test('failure: clear messages; a dead token is our problem (502), never 401 / 403', () => {
  assert.deepEqual(failure({ status: 401, error: 'token_revoked' }).status, 502)
  assert.deepEqual(failure({ status: 403, error: 'insufficient_scope' }).status, 502)
  assert.deepEqual(failure({ status: 409, error: 'duplicate' }), { status: 409, body: { error: 'That song is already in the queue', code: 'duplicate' }, retryAfter: null })
  assert.equal(failure({ status: 422, error: 'not_embeddable' }).status, 422)
  assert.deepEqual(failure({ status: 429, error: 'rate_limited', retryAfter: 9 }).retryAfter, 9)
  assert.equal(failure({ status: 503, error: 'home_player_not_configured' }).status, 503)
  assert.equal(failure({ status: 0, error: 'unreachable' }).status, 502)
  assert.equal(failure({ status: 0, error: 'timeout' }).status, 504)
  assert.equal(failure({ status: 0, error: 'tavarian_off' }).status, 503)
  assert.equal(failure({ status: 500, error: 'http_500' }).body.error, 'Tavarian refused the request')
})

test('the token never shows up in a result', async (t) => {
  mockFetch(t, (url) => (url.includes('ticket') ? envelope({ ticket: 'tk', expiresAt: 'e', streamBase: '/home-audio/stream', token: TOKEN }) : refusal('token_revoked', 401)))
  const out = [await readHome(), await ticketFor('tab_ABC-123'), await ACTIONS.add({ youtubeUrl: 'https://youtu.be/x' }), failure(await call('GET', '/token'))]
  assert.ok(!JSON.stringify(out).includes(TOKEN))
})

test('settings / backend: the station backend, read and set (owner)', async (t) => {
  const calls = mockFetch(t, (url, init) =>
    init.method === 'PUT' && JSON.parse(init.body).backend === 'spotify' ? refusal('spotify_unavailable', 409)
    : envelope({ backend: 'youtube', spotifyAvailable: false, spotifySearch: true, secret: 'x' }))
  assert.deepEqual((await ACTIONS.settings({})).data, { settings: { backend: 'youtube', spotifyAvailable: false, spotifySearch: true, spotifyStatus: 'off', pairing: null } }) // listed fields only
  assert.equal(calls[0].url, 'https://tav.test/api/v1/home/settings')
  assert.equal(calls[0].init.method, 'GET')
  await ACTIONS.backend({ backend: 'youtube' })
  assert.equal(calls[1].init.method, 'PUT')
  assert.equal(calls[1].init.body, '{"backend":"youtube"}')
  const no = await ACTIONS.backend({ backend: 'spotify' })
  assert.equal(no.ok, false)
  assert.equal(failure(no).status, 409)
  assert.equal(failure(no).body.error, "Spotify playback isn't ready on Tavarian: connect Spotify first")
  assert.equal((await ACTIONS.backend({ backend: 'vinyl' })).status, 400) // never sent
  assert.equal(calls.length, 3)
})

test('shapeSettings: unknown backend -> youtube, flags only when true', () => {
  assert.deepEqual(shapeSettings({ backend: 'tape', spotifyAvailable: 'yes' }), { backend: 'youtube', spotifyAvailable: false, spotifySearch: false, spotifyStatus: 'off', pairing: null })
  assert.equal(shapeSettings(null), null)
})

test('pair: asks Tavarian for a pairing code; the code and only a spotify.com link pass', async (t) => {
  const calls = mockFetch(t, () =>
    envelope({ backend: 'youtube', spotifyAvailable: false, spotifySearch: false, spotifyStatus: 'needs_login', pairing: { url: 'https://spotify.com/pair?code=AB12CD', code: 'AB12CD', expiresAt: '2026-10-07T10:00:00Z', extra: 1 } }))
  const r = await ACTIONS.pair({})
  assert.equal(calls[0].init.method, 'PUT')
  assert.equal(calls[0].init.body, '{"pair":true}')
  assert.deepEqual(r.data.settings.pairing, { code: 'AB12CD', url: 'https://spotify.com/pair?code=AB12CD', expiresAt: '2026-10-07T10:00:00Z' })
  assert.equal(r.data.settings.spotifyStatus, 'needs_login')
  const odd = shapeSettings({ pairing: { url: 'https://evil.example/pair', code: 'AB12CD' } })
  assert.equal(odd.pairing.url, 'https://www.spotify.com/pair') // never someone else's link
  assert.equal(shapeSettings({ pairing: { url: 'https://spotify.com/pair', code: '<b>x</b>' } }).pairing, null)
})

test('previous: Tavarian plays the last played song again (also one with no YouTube video)', async (t) => {
  const calls = mockFetch(t, () => envelope({ song: song(7, { youtubeId: null, source: 'spotify', spotifyUri: 'spotify:track:abc' }), status: 'loading' }))
  const r = await ACTIONS.previous({})
  assert.equal(calls[0].url, 'https://tav.test/api/v1/home/playback/previous')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(r.data.state.song.youtubeId, null)
  assert.equal(r.data.state.song.spotifyUri, 'spotify:track:abc')
  const none = mockFetch(t, () => refusal('nothing_before', 409))
  assert.equal(failure(await ACTIONS.previous({})).body.error, 'Nothing played before this one yet')
  assert.equal(none.length, 1)
})

test('search: the station\'s source by default (Spotify in Spotify mode with search set up), or the one asked for', async (t) => {
  const spotifyResult = { source: 'spotify', url: 'https://open.spotify.com/track/abc', youtubeId: null, youtubeUrl: null, spotifyUri: 'spotify:track:abc', spotifyUrl: 'https://open.spotify.com/track/abc', title: 'Runaway', artists: ['AURORA', 7], artist: 'AURORA', album: 'All My Demons', thumbnail: 'https://i.scdn.co/x', channel: 'AURORA', durationSeconds: 249, explicit: false, secret: 1 }
  let mode = 'spotify'
  const calls = mockFetch(t, (url) =>
    url.endsWith('/home/settings') ? envelope({ backend: mode, spotifyAvailable: true, spotifySearch: true })
    : url.includes('source=spotify') ? envelope([spotifyResult])
    : envelope([{ youtubeId: 'y', youtubeUrl: 'https://www.youtube.com/watch?v=y', title: 'yt', thumbnail: 't', channel: 'c', durationSeconds: 1 }]))
  const r = await ACTIONS.search({ q: 'runaway' })
  assert.equal(r.data.source, 'spotify')
  assert.match(calls.at(-1).url, /\/home\/search\?q=runaway&source=spotify$/)
  assert.deepEqual(r.data.results[0].artists, ['AURORA']) // strings only
  assert.equal(r.data.results[0].url, 'https://open.spotify.com/track/abc')
  assert.equal('secret' in r.data.results[0], false)
  // the settings answer is kept a while: the next search asks Tavarian's search only
  await ACTIONS.search({ q: 'lucky' })
  assert.equal(calls.filter((c) => c.url.endsWith('/home/settings')).length, 1)
  // asked for YouTube: no source param, whatever the station
  const y = await ACTIONS.search({ q: 'lucky', source: 'youtube' })
  assert.equal(y.data.source, 'youtube')
  assert.match(calls.at(-1).url, /\/home\/search\?q=lucky$/)
  assert.equal(y.data.results[0].url, 'https://www.youtube.com/watch?v=y') // (from youtubeUrl)
})

test('shapeResult: an old YouTube-only answer still gets source and url', () => {
  assert.deepEqual(shapeResult({ youtubeId: 'a', youtubeUrl: 'u', title: 't' }).source, 'youtube')
  assert.equal(shapeResult({ youtubeId: 'a', youtubeUrl: 'u' }).url, 'u')
  assert.equal(shapeResult(null), null)
})

test('search: a backend flip in Settings changes the default source at once; an old Tavarian answering YouTube is reported as YouTube', async (t) => {
  let mode = 'youtube'
  let spotifyAware = true
  mockFetch(t, (url, init) =>
    url.endsWith('/home/settings') ? envelope({ backend: init.method === 'PUT' ? (mode = JSON.parse(init.body).backend) : mode, spotifyAvailable: true, spotifySearch: true })
    : url.includes('source=spotify') && spotifyAware ? envelope([{ source: 'spotify', url: 'https://open.spotify.com/track/a', spotifyUri: 'spotify:track:a', title: 'A' }])
    : envelope([{ youtubeId: 'y', youtubeUrl: 'https://www.youtube.com/watch?v=y', title: 'yt' }]))
  assert.equal((await ACTIONS.search({ q: 'aa' })).data.source, 'youtube')
  await ACTIONS.backend({ backend: 'spotify' }) // the owner flips it in Settings
  assert.equal((await ACTIONS.search({ q: 'aa' })).data.source, 'spotify') // no 30 s wait
  spotifyAware = false // a Tavarian without Spotify search ignores source=spotify
  assert.equal((await ACTIONS.search({ q: 'bb' })).data.source, 'youtube')
})

test('resolve: one input → what Tavarian made of it (search / track / list), listed fields only', async (t) => {
  const calls = mockFetch(t, (url) =>
    url.includes('list%3D') || url.includes('playlist') ? envelope({ kind: 'list', source: 'spotify', backend: 'spotify', listType: 'album', title: 'All My Demons', subtitle: 'AURORA', thumbnail: 'https://i.scdn.co/a', total: 12, truncated: false, importUrl: 'https://open.spotify.com/album/x', items: [{ source: 'spotify', url: 'https://open.spotify.com/track/a', spotifyUri: 'spotify:track:a', title: 'Runaway' }], secret: 1 })
    : envelope({ kind: 'track', source: 'spotify', backend: 'spotify', items: [{ source: 'spotify', url: 'https://open.spotify.com/track/a', title: 'Runaway' }], match: { confidence: 0.93, fromUrl: 'https://www.youtube.com/watch?v=x', youtubeId: 'x' }, note: null }))
  const tr = await ACTIONS.resolve({ q: 'https://youtu.be/x' })
  assert.match(calls[0].url, /\/home\/resolve\?q=https%3A%2F%2Fyoutu\.be%2Fx$/)
  assert.equal(tr.data.resolved.kind, 'track')
  assert.deepEqual(tr.data.resolved.match, { confidence: 0.93, fromUrl: 'https://www.youtube.com/watch?v=x' })
  const li = await ACTIONS.resolve({ q: 'https://open.spotify.com/playlist/x', source: 'spotify' })
  assert.match(calls[1].url, /&source=spotify$/)
  assert.equal(li.data.resolved.kind, 'list')
  assert.equal(li.data.resolved.importUrl, 'https://open.spotify.com/album/x')
  assert.equal('secret' in li.data.resolved, false)
  assert.equal(li.data.resolved.items[0].title, 'Runaway')
  assert.equal((await ACTIONS.resolve({ q: 'a' })).status, 400) // too short: never sent
  assert.equal(calls.length, 2)
})

test('shapeResolved: unknown kinds are dropped', () => {
  assert.equal(shapeResolved({ kind: 'nope' }), null)
  assert.equal(shapeResolved(null), null)
})
