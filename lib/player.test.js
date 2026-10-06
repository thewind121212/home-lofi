import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioUrl, clockOffset, confirms, expiresMs, isYouTubeUrl, mmss, moveId, musicSource, newClientId, plain, positionAt, renewIn, statusInfo, thumbOf, ticketOk, validClientId } from './player.js'

test('clientId: 32 hex from randomUUID (or random bytes), and the server-side rule', () => {
  const id = newClientId()
  assert.match(id, /^[0-9a-f]{32}$/)
  assert.ok(validClientId(id))
  assert.notEqual(newClientId(), id)
  const noUuid = { getRandomValues: (b) => b.fill(171) }
  assert.equal(newClientId(noUuid), 'ab'.repeat(16))
  assert.ok(validClientId('abc_DEF-12'))
  assert.ok(!validClientId('short'))
  assert.ok(!validClientId('x'.repeat(65)))
  assert.ok(!validClientId('has space1'))
  assert.ok(!validClientId(12345678))
})

test('audioUrl: streamUrl + streamId, clientId, ticket (encoded); null while one is missing', () => {
  assert.equal(audioUrl('https://t.dev/home-audio/stream', 'home-1', 'abcdefgh', 'tk.1/2+3'), 'https://t.dev/home-audio/stream?streamId=home-1&clientId=abcdefgh&ticket=tk.1%2F2%2B3')
  assert.equal(audioUrl('https://t.dev/s?x=1', 's', 'abcdefgh', 't'), 'https://t.dev/s?x=1&streamId=s&clientId=abcdefgh&ticket=t')
  assert.equal(audioUrl('https://t.dev/s', null, 'abcdefgh', 't'), null)
  assert.equal(audioUrl('https://t.dev/s', 's', 'abcdefgh', ''), null)
})

test('tickets: usable until a minute before the end, renewed then (never sooner than 30 s)', () => {
  const now = Date.parse('2026-10-06T14:00:00Z')
  assert.equal(expiresMs('2026-10-06T14:10:00.000Z'), now + 600_000)
  assert.equal(expiresMs(1791297800), 1791297800000) // seconds
  assert.equal(expiresMs(1791297800000), 1791297800000)
  assert.equal(expiresMs('soon'), null)
  assert.equal(expiresMs(null), null)
  const t = { ticket: 'x', expiresAt: '2026-10-06T14:10:00.000Z', at: now }
  assert.ok(ticketOk(t, now))
  assert.ok(ticketOk(t, now + 8 * 60_000))
  assert.ok(!ticketOk(t, now + 9 * 60_000 + 1))
  assert.ok(!ticketOk(null, now))
  assert.ok(!ticketOk({ ...t, ticket: '' }, now))
  assert.equal(renewIn(t, now), 9 * 60_000)
  assert.equal(renewIn(t, now + 9 * 60_000), 30_000) // already due: wait a little, not a loop
  assert.equal(renewIn({ ticket: 'x', expiresAt: null, at: now }, now), 9 * 60_000) // no expiry given: 10 minutes
})

test('positionAt: playing runs from startedAtMs on Tavarian\'s clock; paused / loading hold positionSeconds', () => {
  const song = { id: 4, durationSeconds: 214 }
  const playing = { song, status: 'playing', positionSeconds: 2.6, startedAtMs: 1_000_000, serverNowMs: 1_002_600 }
  // Tavarian's clock is 500 ms ahead of ours
  const offset = clockOffset(1_002_600, 1_002_100)
  assert.equal(offset, 500)
  assert.equal(positionAt(playing, offset, 1_002_100), 2.6)
  assert.equal(positionAt(playing, offset, 1_012_100), 12.6)
  assert.equal(positionAt(playing, offset, 1_500_000), 214) // never past the end
  assert.equal(positionAt({ ...playing, startedAtMs: null }, 0, 1_004_600), 4.6) // no start: position + time since
  assert.equal(positionAt({ ...playing, status: 'paused', startedAtMs: null, positionSeconds: 10.2 }, 0, 9e12), 10.2)
  assert.equal(positionAt({ ...playing, status: 'loading', positionSeconds: 200, startedAtMs: null }, 0, 9e12), 200)
  assert.equal(positionAt({ song: null, status: 'idle' }), 0)
  assert.equal(positionAt({ ...playing, startedAtMs: 2_000_000 }, 0, 1_000_000), 0) // never negative
  assert.equal(clockOffset(null), 0)
})

test('mmss + thumbOf', () => {
  assert.equal(mmss(0), '0:00')
  assert.equal(mmss(75.9), '1:15')
  assert.equal(mmss(3725), '1:02:05')
  assert.equal(mmss(-3), '0:00')
  assert.equal(mmss(undefined), '0:00')
  assert.equal(thumbOf({ youtubeId: 'dQw4w9WgXcQ', thumbnail: 'hq' }), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  assert.equal(thumbOf({ thumbnail: 'hq' }), 'hq')
  assert.equal(thumbOf(null), null)
  assert.equal(plain('Nhạc Chill &quot;Cực Suy&quot; Rain &amp; Piano &#39;24 &#x1F3B9; &bogus;'), 'Nhạc Chill "Cực Suy" Rain & Piano \'24 🎹 &bogus;')
  assert.equal(plain(null), '')
})

test('statusInfo: one plain label per situation', () => {
  const s = (status, extra) => ({ song: status === 'idle' ? null : { id: 1 }, status, positionSeconds: 0, ...extra })
  const label = (o) => statusInfo(o).label
  assert.equal(label({ off: true, revoked: true }), 'Player not set up')
  assert.equal(label({ revoked: true, owner: true, state: s('playing') }), 'Disconnected — new link needed')
  assert.equal(label({ revoked: true, state: s('playing') }), 'Player unavailable')
  assert.equal(label({ reachable: false, state: s('playing') }), 'Tavarian unreachable')
  assert.equal(label({ state: null }), 'Connecting…')
  assert.equal(label({ state: s('playing') }), 'Playing')
  assert.equal(label({ state: s('paused') }), 'Paused on Tavarian')
  assert.equal(label({ state: s('loading') }), 'Loading next song')
  assert.equal(label({ state: s('loading', { positionSeconds: 200 }) }), 'Loading…') // a seek / resume
  assert.equal(label({ state: s('idle') }), 'Queue is empty')
  assert.equal(label({ state: s('idle'), queued: 2 }), 'Stopped')
  assert.equal(statusInfo({ state: s('paused') }).key, 'paused')
})

test('confirms: the state that shows each owner action happened', () => {
  const at = (status, id = 1, positionSeconds = 0) => ({ status, song: id ? { id } : null, positionSeconds })
  assert.ok(confirms('pause', at('playing'), at('paused')))
  assert.ok(!confirms('pause', at('playing'), at('playing')))
  assert.ok(!confirms('resume', at('paused'), at('loading')))
  assert.ok(confirms('resume', at('paused'), at('playing')))
  assert.ok(confirms('play', at('idle', null), at('playing')))
  assert.ok(!confirms('skip', at('playing', 1), at('playing', 1)))
  assert.ok(confirms('skip', at('playing', 1), at('loading', 2)))
  assert.ok(confirms('skip', at('playing', 1), at('idle', null)))
  assert.ok(confirms('stop', at('playing'), at('idle', null)))
  assert.ok(!confirms('seek', at('playing'), at('loading', 1, 200), { seconds: 200 }))
  assert.ok(confirms('seek', at('playing'), at('playing', 1, 201.5), { seconds: 200 }))
  assert.ok(!confirms('seek', at('playing'), at('playing', 1, 20), { seconds: 200 }))
  assert.ok(!confirms('pause', at('playing'), null))
})

test('isYouTubeUrl + moveId', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtu.be/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=x&list=y', 'https://m.youtube.com/shorts/abc', ' https://youtube.com/live/abc '])
    assert.ok(isYouTubeUrl(u), u)
  for (const u of ['lofi piano', 'https://vimeo.com/1', 'https://youtube.com/', 'https://www.youtube.com/@LofiGirl', null]) assert.ok(!isYouTubeUrl(u), String(u))
  assert.deepEqual(moveId([1, 2, 3], 2, -1), [2, 1, 3])
  assert.deepEqual(moveId([1, 2, 3], 2, 1), [1, 3, 2])
  assert.equal(moveId([1, 2, 3], 1, -1), null)
  assert.equal(moveId([1, 2, 3], 3, 1), null)
  assert.equal(moveId([1, 2, 3], 9, 1), null)
})

test('musicSource: what makes sound here, then Spotify, then the home station, then the picked tab', () => {
  const now = 1_000_000
  const idle = { playing: false, loading: false }
  const sp = { enabled: true, track: 'Snowman', playing: true }
  const spPaused = { enabled: true, track: 'Snowman', playing: false, pausedAt: now - 10_000 }
  const spOld = { ...spPaused, pausedAt: now - 61_000 }
  const tvSong = { listening: false, song: { id: 1 }, playing: false }
  // without the Player: as before
  assert.equal(musicSource('radio', idle, null, null, now), 'radio')
  assert.equal(musicSource('spotify', idle, sp, null, now), 'spotify')
  assert.equal(musicSource('radio', { playing: true }, sp, null, now), 'radio')
  assert.equal(musicSource('radio', idle, spPaused, null, now), 'spotify')
  assert.equal(musicSource('radio', idle, spOld, null, now), 'radio')
  assert.equal(musicSource('spotify', idle, spOld, null, now), 'spotify')
  assert.equal(musicSource('player', idle, null, null, now), 'radio')
  // with it
  assert.equal(musicSource('radio', idle, sp, { ...tvSong, listening: true }, now), 'tavarian') // listening here beats Spotify
  assert.equal(musicSource('radio', { loading: true }, null, { ...tvSong, listening: true }, now), 'radio')
  assert.equal(musicSource('radio', idle, sp, { ...tvSong, playing: true }, now), 'spotify')
  assert.equal(musicSource('radio', idle, spOld, { ...tvSong, playing: true }, now), 'tavarian') // the station plays
  assert.equal(musicSource('radio', idle, null, tvSong, now), 'radio') // paused there, not picked
  assert.equal(musicSource('player', idle, null, tvSong, now), 'tavarian') // picked, has a song
  assert.equal(musicSource('player', idle, null, { listening: false, song: null, playing: false }, now), 'radio')
  assert.equal(musicSource('spotify', idle, spOld, tvSong, now), 'spotify')
})
