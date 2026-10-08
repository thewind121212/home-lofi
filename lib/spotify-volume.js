// The owner's Spotify volume: which answer wins when several are in flight. Pure (no fetch, no React, no env), shared
// by the server (lib/spotify.js, its cached device) and the page (app/page.js useSpotifyVolume), so node:test checks it.
//
// The races: a slider drag sends a level, then maybe another; Spotify takes a moment to report a new level; the page
// polls the device every 15 s and the server caches it for 10 s. Without rules, an answer that left before a change
// can land after it and put the old level back.

// Spotify keeps reporting the old level for a moment after a change: a read that began this soon after one still
// counts as "before" it
export const VOL_LAG = 2500

// Server: a device read (GET /me/player) -> what to cache. began: when that read was sent (ms); last: the newest
// volume change Spotify accepted, { at: when it was sent, level }, or null. A read that began before the change (or
// within VOL_LAG after it) keeps the level that was set; any other field (name, supportsVolume) is the read's.
// (last.name: the device it was set on, when known: a read of another device keeps its own level)
export function settle(read, began, last, lag = VOL_LAG) {
  if (!read || !last || read.volume === null || began > last.at + lag) return read
  if (last.name != null && last.name !== read.name) return read
  return { ...read, volume: last.level }
}

// Page: a poll answer counts only if it was sent after the slider last moved and no change is on its way (sent,
// changed: ms; busy: a level waiting to go out or out and unanswered)
export const pollCounts = (sent, { changed, busy }) => !busy && sent > changed

// Page: the answer to volume change number `seq`. m = { latest: the newest change sent, applied: the newest change
// whose OK answer was taken }.
//   device: take its device (Spotify's confirmed level), if it's OK and newer than the last one taken, whatever order
//           the answers come in (a later failure then rolls back to the newest level Spotify did accept)
//   settle: it answers the newest change: the slider drops its own level for the device's, and a failure is shown
//           (an older change's failure is not: a newer one is still on its way)
export function volumeAnswer(m, seq, ok) {
  return { device: Boolean(ok) && seq > m.applied, settle: seq === m.latest }
}

// the home station's own Spotify player (go-librespot on Tavarian, device name SPOTIFY_DEVICE_NAME, by default
// "Tavarian home station"): it ignores Spotify's volume on purpose, so the Spotify tab shows a note instead of a slider.
// (A renamed station device needs this rule changed too.)
export const isStationDevice = (name) => typeof name === 'string' && /^tavarian\b/i.test(name.trim())
