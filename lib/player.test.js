import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  audioUrl, autoplayPicks, autoplayText, autoTab, START_GAP, startedTab, cardList, songLink, classifyLink, clockOffset, confirms, expiresMs, gapAt, gapIndex, importSummary, insertAt, isYouTubeUrl, mmss, moveId, moveTo, musicSource, newClientId, placedText,
  placementIcon, placementLabel, plain, sourceLabel, positionAt, reasonText, renewIn, restorable, restoreOrder, sameOrder, songErrorText, statusInfo, thumbOf, ticketOk, transitionLine,
  undoPlan, validClientId, remapOrder, toggleIn, pickedIds, allPicked, pickedText, fullTitle, overflows, slowUndo, SLOW_UNDO, bulkRemovedLine, mainAction,
} from './player.js'

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

test('statusInfo: paused after the Spotify autoplay round says so, with the count when known', () => {
  const why = (extra) => statusInfo({ state: { song: { id: 1 }, status: 'paused', positionSeconds: 0, stalledReason: 'autoplay_limit', ...extra } }).why
  assert.equal(why({ autoplay: { played: 20, limit: 20 } }), 'Paused after 20 Spotify autoplay songs: press Play for more')
  assert.equal(why({ autoplay: null }), 'Spotify autoplay is done for now: press Play for more')
  assert.equal(why({ stalledReason: 'spotify_auth' }), 'Spotify logged the station out: Connect Spotify again in Settings') // the others unchanged
  assert.equal(why({ stalledReason: 'brand_new_reason' }), 'brand new reason')
  assert.equal(typeof why({ stalledReason: 'constructor' }), 'string') // a key every object has is not a reason text
})

test('autoplayText: "Spotify autoplay · 3/20", null when the song is not an autoplay pick', () => {
  assert.equal(autoplayText({ played: 3, limit: 20 }), 'Spotify autoplay · 3/20')
  assert.equal(autoplayText(null), null)
  assert.equal(autoplayText({ played: 3, limit: 0 }), null)
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

test('classifyLink: video, video + playlist, playlist, Mix, Spotify, another link, a search', () => {
  const k = (t) => classifyLink(t)
  assert.deepEqual(k('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), { kind: 'video', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', list: null, mix: false })
  assert.equal(k(' youtu.be/dQw4w9WgXcQ?si=abc ').url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  assert.equal(k('https://m.youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ')
  assert.equal(k('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx_12-3').list, 'PLx_12-3') // this video, or the whole playlist
  const mixVideo = k('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1')
  assert.equal(mixVideo.kind, 'video')
  assert.equal(mixVideo.list, null) // a Mix can't be imported: only the video is offered
  assert.ok(mixVideo.mix)
  assert.deepEqual(k('https://www.youtube.com/playlist?list=PLabc123'), { kind: 'playlist', list: 'PLabc123', url: 'https://www.youtube.com/playlist?list=PLabc123' })
  assert.equal(k('youtube.com/playlist?list=RDCLAK5uy').kind, 'mix')
  assert.deepEqual(k('https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy?si=x'), { kind: 'spotify', what: 'album', url: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy' })
  assert.equal(k('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').what, 'playlist')
  assert.equal(k('spotify:track:4uLU6hMCjMI75M1A2tKUQC').url, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')
  for (const u of ['https://vimeo.com/1', 'https://www.youtube.com/@LofiGirl', 'https://youtu.be/short', 'https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF', 'https://youtube.com/playlist'])
    assert.equal(k(u).kind, 'unsupported', u)
  for (const t of ['lofi piano', 'ac/dc', 'Mr. Brightside', 'chill']) assert.equal(k(t).kind, 'text', t)
  assert.equal(k('   ').kind, 'empty')
  assert.equal(k(null).kind, 'empty')
})

test('placements: labels, icons, and what the owner reads after', () => {
  assert.deepEqual(['now', 'next', 'end', undefined].map(placementLabel), ['Play now', 'Play next', 'Add to end', 'Add to end'])
  assert.equal(placementIcon('now'), 'fa-play')
  assert.equal(placedText('now', 'Rain &amp; Piano'), 'Playing Rain & Piano')
  assert.equal(placedText('next', 'B'), 'Up next: B')
  assert.equal(placedText('end', null), 'Added: the song')
})

test('reasons and song errors read plainly', () => {
  assert.equal(reasonText('duplicate'), 'already in the queue')
  assert.equal(reasonText('no_match'), 'no YouTube match')
  assert.equal(reasonText('some_new_code'), 'some new code')
  assert.equal(reasonText(null), 'unknown reason')
  assert.equal(songErrorText('start_timeout', 'Lofi &amp; Rain'), "Lofi & Rain didn't start, skipped")
  assert.equal(songErrorText('not_embeddable', null), "A song couldn't play (not allowed outside YouTube), skipped")
  assert.equal(songErrorText(null, 'X'), "X couldn't play, skipped")
})

test('importSummary: added, skipped by reason, truncated', () => {
  const song = (id) => ({ id })
  const r = {
    added: [song(1), song(2), song(3)],
    skipped: [{ reason: 'duplicate' }, { reason: 'too_long' }, { reason: 'duplicate' }],
    found: 140,
    truncated: { limit: 100, dropped: 40, reason: 'import_max' },
  }
  const s = importSummary(r)
  assert.equal(s.text, 'Added 3 songs · skipped 3 (2 already in the queue, 1 too long) · first 100 only (40 more not imported)')
  assert.deepEqual([s.added, s.skipped, s.found], [3, 3, 140])
  assert.deepEqual(s.groups.map((g) => [g.reason, g.n]), [['duplicate', 2], ['too_long', 1]])
  assert.equal(importSummary({ added: [song(1)], skipped: [], truncated: null }).text, 'Added 1 song')
  assert.equal(importSummary({ added: [], skipped: [{ reason: 'no_match' }] }).text, 'Nothing added · skipped 1 (1 no YouTube match)')
  assert.equal(importSummary({ added: [song(1)], skipped: [], truncated: { limit: 12, dropped: 3, reason: 'queue_room' } }).cut, 'only 12 fit in the queue (3 left out)')
  assert.equal(importSummary(null).text, 'Nothing added')
  assert.equal(sourceLabel('youtube-playlist'), 'YouTube playlist')
  assert.equal(sourceLabel('spotify-album'), 'Spotify album')
  assert.equal(sourceLabel({ kind: 'spotify_track' }), 'Spotify track')
  assert.equal(sourceLabel('deezer-mix'), 'Deezer mix')
  assert.equal(sourceLabel(null), null)
})

test('transitionLine: skipping A, then loading B, then playing B', () => {
  const A = { id: 1, title: 'Song A' }
  const B = { id: 2, title: 'Song &amp; B' }
  const t = { from: A }
  assert.deepEqual(transitionLine(t, { song: A, status: 'playing' }), { text: 'Skipping Song A…', done: false })
  assert.deepEqual(transitionLine(t, { song: B, status: 'loading' }), { text: 'Skipped Song A · loading Song & B…', done: false })
  assert.deepEqual(transitionLine(t, { song: B, status: 'playing' }), { text: 'Playing Song & B', done: true })
  assert.deepEqual(transitionLine(t, { song: null, status: 'idle' }), { text: 'Skipped Song A · the queue is empty', done: true })
  assert.equal(transitionLine({ from: null }, { song: B, status: 'loading' }).text, 'Loading Song & B…')
  assert.equal(transitionLine(null, { song: B, status: 'loading' }), null)
  assert.equal(transitionLine(t, null), null)
})

test('reorder math: moveTo, the drop gap, insertAt, restoreOrder', () => {
  assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveTo(['a', 'b'], 5, 0), ['a', 'b'])
  const mids = [10, 30, 50, 70] // four rows, 20 px apart
  assert.deepEqual([0, 11, 31, 69, 99].map((y) => gapAt(mids, y)), [0, 1, 2, 3, 4])
  assert.equal(gapIndex(1, 1), 1) // just above itself: stays
  assert.equal(gapIndex(1, 2), 1) // just below itself: stays
  assert.equal(gapIndex(1, 4), 3) // to the end
  assert.equal(gapIndex(3, 0), 0)
  assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 1, gapIndex(1, 4)), ['a', 'c', 'd', 'b'])
  assert.deepEqual(insertAt([1, 2, 3, 9], 9, 1), [1, 9, 2, 3])
  assert.deepEqual(insertAt([1, 2], 9, 7), [1, 2, 9])
  assert.deepEqual(restoreOrder([3, 1, 2], [1, 2, 3]), [3, 1, 2])
  assert.deepEqual(restoreOrder([3, 1, 2, 4], [1, 7, 2, 3]), [3, 1, 2, 7]) // 4 is gone, 7 is new (kept after)
  assert.ok(sameOrder([1, 2], [1, 2]))
  assert.ok(!sameOrder([1, 2], [2, 1]))
})

test('undoPlan: the steps that put the station back', () => {
  const A = { id: 1, youtubeId: 'aaaaaaaaaaa', durationSeconds: 200 }
  const B = { id: 2, youtubeId: 'bbbbbbbbbbb', durationSeconds: 180 }
  const live = { id: 3, youtubeId: 'ccccccccccc', durationSeconds: null }
  assert.ok(restorable(A))
  assert.ok(!restorable(live))
  // Play now B (3rd in the queue) while A played at 1:15: A back where it was, B back in its place
  assert.deepEqual(undoPlan({ kind: 'now', from: A, at: 75.6, to: B, toIndex: 2 }), [
    { do: 'restore', song: A, at: 75, paused: false },
    { do: 'requeue', song: B, index: 2 },
  ])
  // skip (B was first in the queue), A had just started: from the top
  assert.deepEqual(undoPlan({ kind: 'now', from: A, at: 1, paused: true, to: B, toIndex: 0 })[0], { do: 'restore', song: A, at: 0, paused: true })
  // nothing played before: stop again
  assert.deepEqual(undoPlan({ kind: 'now', from: null, to: B, toIndex: 0 }), [{ do: 'stop' }, { do: 'requeue', song: B, index: 0 }])
  // a live stream can't come back: no undo
  assert.equal(undoPlan({ kind: 'now', from: live, at: 10, to: B, toIndex: 0 }), null)
  assert.deepEqual(undoPlan({ kind: 'remove', song: B, index: 4 }), [{ do: 'requeue', song: B, index: 4 }])
  assert.deepEqual(undoPlan({ kind: 'order', ids: [3, 1, 2] }), [{ do: 'order', ids: [3, 1, 2] }])
  assert.deepEqual(undoPlan({ kind: 'added', ids: [7, 8], placement: 'end' }), [{ do: 'remove', ids: [7, 8] }])
  assert.deepEqual(undoPlan({ kind: 'added', ids: [7, 8, 9], placement: 'now', from: A, at: 30 }), [
    { do: 'restore', song: A, at: 30, paused: false },
    { do: 'remove', ids: [8, 9] },
  ])
  assert.deepEqual(undoPlan({ kind: 'added', ids: [7], placement: 'now', from: null }), [{ do: 'stop' }])
  assert.equal(undoPlan({ kind: 'added', ids: [] }), null)
  assert.equal(undoPlan({ kind: 'mystery' }), null)
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

test('Select mode: toggle, what is still queued (in queue order), all, the count', () => {
  let sel = new Set()
  sel = toggleIn(sel, 3)
  sel = toggleIn(sel, 1)
  assert.deepEqual([...sel], [3, 1])
  assert.deepEqual([...toggleIn(sel, 3)], [1])
  assert.deepEqual([...sel], [3, 1]) // a new Set each time (React state)
  assert.deepEqual(pickedIds(sel, [1, 2, 3]), [1, 3])
  assert.deepEqual(pickedIds(sel, [2, 3]), [3]) // 1 played meanwhile: not counted
  assert.deepEqual(pickedIds(null, [1, 2]), [])
  assert.ok(allPicked(new Set([1, 2, 9]), [1, 2]))
  assert.ok(!allPicked(sel, [1, 2, 3]))
  assert.ok(!allPicked(new Set(), []))
  assert.ok(!allPicked(null, [1]))
  assert.equal(pickedText(2, 12), '2 of 12 selected')
  assert.equal(pickedText(0, 12), 'None selected')
})

test('bulk undo: add the removed songs back, then the old order (new ids in their old places)', () => {
  const a = { id: 1, youtubeId: 'aaaaaaaaaaa', durationSeconds: 10 }
  const b = { id: 2, youtubeId: 'bbbbbbbbbbb', durationSeconds: 10 }
  const plan = undoPlan({ kind: 'bulk', songs: [a, b, { id: 3 }], ids: [1, 5, 2, 6] })
  assert.deepEqual(plan, [{ do: 'readd', songs: [a, b], ids: [1, 5, 2, 6] }])
  assert.equal(undoPlan({ kind: 'bulk', songs: [{ id: 3 }] }), null)
  assert.equal(undoPlan({ kind: 'bulk', songs: [] }), null)
  // 1 -> 11 and 2 -> 12 came back at the end; 6 played meanwhile; 7 was added since
  const order = restoreOrder(remapOrder([1, 5, 2, 6], new Map([[1, 11], [2, 12]])), [5, 7, 11, 12])
  assert.deepEqual(order, [11, 5, 12, 7])
  assert.ok(!slowUndo(plan))
  const many = Array.from({ length: SLOW_UNDO + 1 }, (_, i) => ({ id: i, youtubeId: 'x' + i }))
  assert.ok(slowUndo(undoPlan({ kind: 'bulk', songs: many, ids: [] })))
  assert.ok(!slowUndo(undoPlan({ kind: 'bulk', songs: many.slice(1), ids: [] })))
  assert.ok(!slowUndo(null))
})

test("Remove selected's line: a countdown only when Undo would be slow (more than 15 songs)", () => {
  const songs = (n) => Array.from({ length: n }, (_, i) => ({ id: i, youtubeId: 'x' + i }))
  const line = (n) => bulkRemovedLine(n, undoPlan({ kind: 'bulk', songs: songs(n), ids: [] }))
  assert.deepEqual(line(1), { text: 'Removed 1 song', countdown: false })
  assert.deepEqual(line(3), { text: 'Removed 3 songs', countdown: false })
  assert.deepEqual(line(SLOW_UNDO), { text: `Removed ${SLOW_UNDO} songs`, countdown: false })
  assert.deepEqual(line(SLOW_UNDO + 1), { text: `Removed ${SLOW_UNDO + 1} songs · Undo would take a while`, countdown: true })
  assert.deepEqual(bulkRemovedLine(2, null), { text: 'Removed 2 songs', countdown: false })
})

test('long titles: the plain full title, and when two lines cut it', () => {
  assert.equal(fullTitle({ title: 'Rain &amp; Piano' }), 'Rain & Piano')
  assert.equal(fullTitle({ name: 'My list' }), 'My list')
  assert.equal(fullTitle(null, 'Home station'), 'Home station')
  assert.equal(fullTitle({ title: '' }, 'x'), 'x')
  assert.ok(overflows(48, 32))
  assert.ok(!overflows(33, 32)) // rounding
  assert.ok(!overflows(32, 32))
})

test('mainAction: one play / pause button — the owner drives the station, a guest only listens', () => {
  const k = (o) => mainAction(o).kind
  // guest: listen / stop on this device, whatever the station does
  for (const status of ['playing', 'paused', 'idle', 'loading']) {
    assert.equal(k({ status, queued: 3 }), 'listen')
    assert.equal(k({ status, queued: 3, listening: true, phase: 'playing' }), 'stop')
  }
  // owner, not listening here
  assert.equal(k({ owner: true, status: 'playing' }), 'listen') // it plays: listen here only
  assert.equal(k({ owner: true, status: 'loading' }), 'listen')
  assert.equal(k({ owner: true, status: 'paused' }), 'resume')
  assert.equal(k({ owner: true, status: 'idle', queued: 2 }), 'play')
  assert.equal(k({ owner: true, status: 'idle', queued: 0 }), 'listen') // nothing to play: listening waits for it
  // owner, listening here
  assert.equal(k({ owner: true, listening: true, phase: 'playing', status: 'playing' }), 'pause')
  assert.equal(k({ owner: true, listening: true, phase: 'connecting', status: 'loading' }), 'pause')
  assert.equal(k({ owner: true, listening: true, phase: 'waiting', status: 'paused' }), 'stop') // already paused
  assert.equal(k({ owner: true, listening: true, phase: 'waiting', status: 'idle', queued: 4 }), 'stop')
  // icons and labels
  assert.deepEqual(mainAction({ owner: true, status: 'paused' }), { kind: 'resume', label: 'Resume for everyone and listen here', icon: 'fa-play ml-0.5', posts: true })
  assert.equal(mainAction({ listening: true, phase: 'playing', status: 'playing' }).icon, 'fa-pause')
  assert.equal(mainAction({ listening: true, phase: 'connecting', status: 'playing' }).icon, 'fa-spinner fa-spin')
  assert.match(mainAction({ listening: true, phase: 'connecting' }).label, /^Tuning in… Tap to stop/)
  assert.match(mainAction({ owner: true, listening: true, phase: 'connecting', status: 'playing' }).label, /pause for everyone/)
  assert.equal(mainAction({}).posts, false)
  assert.equal(mainAction({ owner: true, listening: true, status: 'playing' }).posts, true)
  assert.equal(mainAction().kind, 'listen')
})

test('cardList: next two while a song is on, never Recent then; Last played only when nothing is on', () => {
  const a = { id: 1 }, b = { id: 2 }, c = { id: 3 }, r = [{ id: 9 }, { id: 8 }, { id: 7 }]
  const song = { id: 5 }
  assert.deepEqual(cardList({ song, items: [a, b, c], recent: r }), { kind: 'next', rows: [a, b] })
  assert.deepEqual(cardList({ song, items: [], recent: r }), { kind: 'empty', rows: [] })
  assert.deepEqual(cardList({ song: null, items: [a], recent: r }), { kind: 'next', rows: [a] })
  assert.deepEqual(cardList({ song: null, items: [], recent: r }), { kind: 'last', rows: [r[0], r[1]] })
  assert.deepEqual(cardList({ song: null, items: [], recent: [] }), { kind: 'empty', rows: [] })
  assert.deepEqual(cardList(), { kind: 'empty', rows: [] })
})

test('cardList: Spotify autoplay with an empty queue says Spotify picks next; a queued song still comes first', () => {
  const a = { id: 1 }, song = { id: 5 }, autoplay = { played: 3, limit: 20 }
  assert.deepEqual(cardList({ song, items: [], recent: [{ id: 9 }], autoplay }), { kind: 'autoplay', rows: [] })
  assert.deepEqual(cardList({ song, items: [a], autoplay }), { kind: 'next', rows: [a] })
  assert.deepEqual(cardList({ song: null, items: [], recent: [], autoplay }), { kind: 'empty', rows: [] }) // nothing on: no autoplay line
  assert.deepEqual(cardList({ song, items: [], autoplay: null }), { kind: 'empty', rows: [] })
})

const pick = (n, extra = {}) => ({ title: `Pick ${n}`, artists: ['A'], album: 'B', cover: `https://i.scdn.co/image/${n}`, spotifyUri: `spotify:track:pick${n}abc`, durationSeconds: 200, ...extra })

test('autoplayPicks: only when the account plays the station\'s song (nowUri), as song rows', () => {
  const song = { id: 5, spotifyUri: 'spotify:track:nowNOW123' }
  const answer = { nowUri: 'spotify:track:nowNOW123', picks: [pick(1), pick(2)] }
  const rows = autoplayPicks(answer, song)
  assert.deepEqual(rows[0], { id: 'sp:spotify:track:pick1abc', pick: true, source: 'spotify', title: 'Pick 1', artists: ['A'], album: 'B', thumbnail: 'https://i.scdn.co/image/1', spotifyUri: 'spotify:track:pick1abc', durationSeconds: 200 })
  assert.equal(thumbOf(rows[0]), 'https://i.scdn.co/image/1') // the card's / sheet's picture: its own cover
  assert.equal(thumbOf(autoplayPicks({ ...answer, picks: [pick(1, { cover: null })] }, song)[0]), null) // (then useArt asks oEmbed by spotifyUri)
  // the account plays something else (another device, or Spotify hasn't caught up with the song change): nothing
  assert.deepEqual(autoplayPicks({ ...answer, nowUri: 'spotify:track:other1234' }, song), [])
  assert.deepEqual(autoplayPicks({ ...answer, nowUri: null }, song), [])
  assert.deepEqual(autoplayPicks(answer, { id: 5 }), []) // a song without a Spotify uri can't be matched
  assert.deepEqual(autoplayPicks(answer, null), [])
  assert.deepEqual(autoplayPicks(null, song), [])
  assert.deepEqual(autoplayPicks({ nowUri: song.spotifyUri, picks: 'nope' }, song), [])
})

test('autoplayPicks: a track twice shows once; nameless picks and missing fields are fine', () => {
  const song = { id: 5, spotifyUri: 'spotify:track:nowNOW123' }
  const rows = autoplayPicks({ nowUri: song.spotifyUri, picks: [pick(1), pick(1), { title: '' }, null, { title: 'Bare' }] }, song)
  assert.deepEqual(rows.map((r) => r.title), ['Pick 1', 'Bare'])
  assert.deepEqual(rows[1], { id: 'sp:4', pick: true, source: 'spotify', title: 'Bare', artists: [], album: null, thumbnail: null, spotifyUri: null, durationSeconds: null })
})

test('cardList during autoplay: queued songs first, then Spotify\'s picks, two rows in all', () => {
  const a = { id: 1 }, b = { id: 2 }, song = { id: 5 }, autoplay = { played: 3, limit: 20 }
  const p1 = { id: 'sp:1', pick: true }, p2 = { id: 'sp:2', pick: true }, p3 = { id: 'sp:3', pick: true }
  assert.deepEqual(cardList({ song, items: [], autoplay, picks: [p1, p2, p3] }), { kind: 'next', rows: [p1, p2] })
  assert.deepEqual(cardList({ song, items: [a], autoplay, picks: [p1, p2] }), { kind: 'next', rows: [a, p1] }) // added mid-run: plays first
  assert.deepEqual(cardList({ song, items: [a, b], autoplay, picks: [p1] }), { kind: 'next', rows: [a, b] })
  assert.deepEqual(cardList({ song, items: [], autoplay, picks: [] }), { kind: 'autoplay', rows: [] }) // none known: "Spotify picks the next song"
  // not autoplay (or nothing on): picks are ignored
  assert.deepEqual(cardList({ song, items: [], autoplay: null, picks: [p1] }), { kind: 'empty', rows: [] })
  assert.deepEqual(cardList({ song: null, items: [], recent: [], autoplay, picks: [p1] }), { kind: 'empty', rows: [] })
})

test('musicSource for the owner: the home station playing beats Spotify; sound here still wins', () => {
  const now = 1_000_000
  const idle = { playing: false, loading: false }
  const sp = { enabled: true, track: 'Snowman', playing: true }
  const tv = { listening: false, song: { id: 1 }, playing: true, owner: true }
  assert.equal(musicSource('radio', idle, sp, tv, now), 'tavarian')
  assert.equal(musicSource('spotify', idle, sp, tv, now), 'tavarian')
  assert.equal(musicSource('radio', idle, sp, { ...tv, playing: false }, now), 'spotify') // paused there
  assert.equal(musicSource('radio', idle, sp, { ...tv, song: null }, now), 'spotify')
  assert.equal(musicSource('radio', { playing: true }, sp, tv, now), 'radio') // the radio started here
  assert.equal(musicSource('radio', idle, sp, { ...tv, owner: false }, now), 'spotify') // a guest: as before
})

test('autoTab: Player while the station plays, else Spotify while it plays, else the last pick', () => {
  assert.equal(autoTab({ tvPlaying: true, spPlaying: true }), 'player')
  assert.equal(autoTab({ tvPlaying: false, spPlaying: true }), 'spotify')
  assert.equal(autoTab({ tvPlaying: false, spPlaying: false }), null)
  assert.equal(autoTab(), null)
})

test('statusInfo: paused because Spotify can not be used says why', () => {
  const s = { song: { id: 1 }, status: 'paused', stalledReason: 'spotify_search_off' }
  assert.equal(statusInfo({ state: s }).label, 'Paused')
  assert.match(statusInfo({ state: s }).why, /search isn't set up/)
  assert.equal(statusInfo({ state: { ...s, stalledReason: null } }).label, 'Paused on Tavarian')
  assert.equal(statusInfo({ state: { ...s, stalledReason: null } }).why, undefined)
  assert.equal(statusInfo({ state: { ...s, stalledReason: 'spotify_new_thing' } }).why, 'spotify new thing') // unknown: plain words
})

test('thumbOf: Spotify\'s cover when that\'s what the song shows, else the video\'s thumbnail', () => {
  assert.equal(thumbOf({ youtubeId: 'abc', thumbnail: 'https://i.scdn.co/c', metadataSource: 'spotify' }), 'https://i.scdn.co/c')
  assert.equal(thumbOf({ youtubeId: 'abc', thumbnail: 'https://i.scdn.co/c', metadataSource: 'youtube' }), 'https://i.ytimg.com/vi/abc/mqdefault.jpg')
  assert.equal(thumbOf({ youtubeId: null, source: 'spotify', thumbnail: 'https://i.scdn.co/c' }), 'https://i.scdn.co/c')
  assert.equal(thumbOf({ youtubeId: 'abc' }), 'https://i.ytimg.com/vi/abc/mqdefault.jpg')
  assert.equal(thumbOf(null), null)
})

test('songLink: the url, the video, or the Spotify track; null when none', () => {
  assert.equal(songLink({ url: 'https://open.spotify.com/track/x1' }), 'https://open.spotify.com/track/x1')
  assert.equal(songLink({ youtubeId: 'abcdefghijk' }), 'https://www.youtube.com/watch?v=abcdefghijk')
  assert.equal(songLink({ youtubeId: null, spotifyUri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT' }), 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
  assert.equal(songLink({ youtubeId: null, spotifyUri: 'spotify:episode:x' }), null)
  assert.equal(songLink(null), null)
})

test('songLink: a Spotify song (or one showing its Spotify match) is re-added as the exact track', () => {
  const uri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
  assert.equal(songLink({ youtubeId: 'abcdefghijk', spotifyUri: uri, source: 'spotify' }), 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
  assert.equal(songLink({ youtubeId: 'abcdefghijk', spotifyUri: uri, metadataSource: 'spotify' }), 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
  assert.equal(songLink({ youtubeId: 'abcdefghijk', spotifyUri: uri, source: 'youtube', metadataSource: 'youtube' }), 'https://www.youtube.com/watch?v=abcdefghijk')
})

test('startedTab: switches when the station / Spotify starts while the page is open, not on song changes', () => {
  const seen = {}
  let t = 0
  const at = (o, dt = 1000) => startedTab(seen, o, (t += dt))
  assert.equal(at({}), null) // quiet (seen from here on)
  assert.equal(at({ spPlaying: true }), null) // playing within START_GAP of the page opening: autoTab's job
  assert.equal(at({}), null)
  assert.equal(at({ spPlaying: true }, START_GAP + 1), 'spotify') // Spotify starts later
  assert.equal(at({ spPlaying: true, tvPlaying: true }, START_GAP + 1), 'player') // the station starts: it comes first
  assert.equal(at({ spPlaying: true }), null) // the station between songs (or Spotify alone again): no switch
  assert.equal(at({ spPlaying: true, tvPlaying: true }, 3000), null) // back within START_GAP: the same session
  assert.equal(at({ spPlaying: true }), null)
  assert.equal(at({ spPlaying: true, tvPlaying: true }, START_GAP + 1), 'player') // quiet for long: a new start
  assert.equal(at({ tvPlaying: true }), null) // one Spotify poll missed it...
  assert.equal(at({ tvPlaying: true, spPlaying: true }, 15_200), null) // ...and the next one 15.2 s later: not a start
  assert.equal(at({}), null)
  assert.equal(at({ spPlaying: true }, START_GAP + 1), 'spotify') // Spotify alone...
  assert.equal(at({}), null) // ...one poll misses it...
  assert.equal(at({ spPlaying: true }, 15_200), null) // ...the next poll has it again: not a start
  assert.equal(at({}), null)
  assert.equal(at({ tvPlaying: true, radioHere: true }, START_GAP + 1), null) // the radio plays here: leave it
  assert.equal(at({ tvPlaying: true }), null) // (that start was seen: no late switch)
})
