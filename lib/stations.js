// Radio stations (app/radio.js plays them), two kinds:
// - youtube: a 24/7 YouTube live stream, audio-only through a hidden IFrame player. No video ids here: a station is a
//   channel + a word from its stream's title; the server asks YouTube for the channel's current live stream
//   (lib/youtube.js, /api/radio, cached for an hour), so a restarted stream is picked up by itself. `query` is the
//   fallback search when the channel has no matching live stream.
// - stream: an internet radio's own audio stream (`url`), played in an <audio> element, so it keeps playing with a
//   phone's screen off. `now` names its now-playing API (lib/radio-now.js), when it has one.
// `mood` groups the station list (MOODS order).
export const MOODS = [
  ['focus', 'Focus'],
  ['chill', 'Chill'],
  ['jazz', 'Jazz & café'],
  ['piano', 'Piano & classical'],
  ['asia', 'Asia'],
  ['retro', 'Synth & retro'],
  ['sleep', 'Sleep & ambient'],
]

const LOFI_GIRL = 'UCSJ4gkVC6NrvII8umztf0Ow'
const CAFE_BGM = 'UCJhjE7wbdYAae1G25m0tHAA'
// youtube: [id, mood, emoji, name, sub, by, channel, match, query]
const yt = (id, mood, emoji, name, sub, by, channel, match, query) => ({ id, kind: 'youtube', mood, emoji, name, sub, by, channel, match, query })
// stream: [id, mood, emoji, name, sub, by, url, now]
const radio = (id, mood, emoji, name, sub, by, url, now) => ({ id, kind: 'stream', mood, emoji, name, sub, by, url, now })

// Picked 2026-10-06 by live listeners (YouTube's "watching"), all checked to play embedded on other sites.
export const STATIONS = [
  yt('lofi', 'focus', '📚', 'Lofi Hip Hop', 'beats to relax/study to', 'Lofi Girl', LOFI_GIRL, 'lofi hip hop radio 📚', 'lofi hip hop radio beats to relax study to'),
  yt('chillhop', 'focus', '🐾', 'Chillhop Radio', 'jazzy & lofi hip hop beats', 'Chillhop Music', 'UCOxqgCwgOqC2lMqC5PYz_Dg', 'Chillhop Radio', 'chillhop radio jazzy lofi hip hop beats'),
  yt('study', 'focus', '⏱️', 'Study With Me', 'pomodoro focus sessions', 'Lofi Girl', LOFI_GIRL, 'Pomodoro', 'study with me pomodoro lofi live'),
  yt('medieval', 'focus', '🏰', 'Medieval Lofi', 'beats to scribe manuscripts to', 'Lofi Girl', LOFI_GIRL, 'medieval lofi', 'medieval lofi radio'),
  radio('laut-lofi', 'focus', '🎧', 'Lofi Radio', 'lofi beats around the clock', 'laut.fm', 'https://lofi.stream.laut.fm/lofi', { api: 'laut', id: 'lofi' }),

  yt('lofi-house', 'chill', '🌅', 'Lofi House', 'lounge grooves to vibe to', 'Lofi Girl', LOFI_GIRL, 'lofi house', 'lofi house radio lounge music'),
  yt('jazzhop', 'chill', '🕯️', 'Jazzhop & Groove', 'smooth vocals, soul & R&B', '3am-playlist', 'UC0gm-j2SN9tWuOCLYMvATvQ', 'JAZZHOP & GROOVE', 'jazzhop groove 24/7 live smooth vocal'),
  radio('flux-chillhop', 'chill', '🎚️', 'FluxFM ChillHop', 'chill beats from Berlin', 'FluxFM', 'https://streams.fluxfm.de/Chillhop/mp3-320/streams.fluxfm.de/', { api: 'flux', id: 'chillhop' }),
  radio('rp-mellow', 'chill', '🌿', 'Radio Paradise Mellow', 'hand-picked mellow mix, no ads', 'Radio Paradise', 'https://stream.radioparadise.com/mellow-128', { api: 'paradise', id: 1 }),

  yt('cafe', 'jazz', '☕', 'Café Jazz Piano', 'slow jazz for work & study', 'Cafe Music BGM', CAFE_BGM, 'Jazz Piano Radio', 'relaxing jazz piano radio slow jazz 24/7'),
  yt('jazz-lofi', 'jazz', '🎷', 'Jazz Lofi', 'jazzy beats to chill/study to', 'Lofi Girl', LOFI_GIRL, 'jazz lofi radio', 'jazz lofi radio beats to chill study to'),
  yt('bossa', 'jazz', '🌴', 'Bossa Nova Café', 'smooth jazz & sweet bossa', 'Cafe Music BGM', CAFE_BGM, 'Living Coffee', 'smooth jazz bossa nova radio 24/7'),
  radio('swiss-jazz', 'jazz', '🎺', 'Radio Swiss Jazz', 'jazz, soul & blues, no talk', 'SRG SSR', 'https://stream.srg-ssr.ch/srgssr/rsj/mp3/128', { api: 'srg', id: 'rsj' }),

  yt('piano', 'piano', '🎹', 'Slow Piano', 'calm, cozy piano', 'Pure Music Moments', 'UC7U9euhn-atGkoYVtmQlnBA', 'Slow Piano', 'slow piano 24/7 live calm cozy'),
  yt('classical', 'piano', '🎼', 'Morning Classics', 'bright piano & strings', 'Elise Piano', 'UCyaJqqSWHsNC4Gdxhk55jhA', 'Morning Classics', 'morning classics piano strings live'),
  yt('strings', 'piano', '🎻', 'Strings & Adagios', 'cello, violin & piano', 'Calm Classical Music', 'UCqKWo2ReHIjOzgPN0OX-dUQ', 'Tchaikovsky', 'adagio classical cello violin piano live'),
  yt('rain-piano', 'piano', '🌧️', 'Rain & Piano', 'night piano by the fireplace', 'Rainwood Cabin', 'UCidcqDcAvbCbJ9oo3IeToUQ', 'Rain', 'night piano rain fireplace live'),
  radio('swiss-classic', 'piano', '🏛️', 'Radio Swiss Classic', 'calm classical, all day', 'SRG SSR', 'https://stream.srg-ssr.ch/srgssr/rsc_de/mp3/128', { api: 'srg', id: 'rsc' }),

  yt('asian-lofi', 'asia', '⛩️', 'Asian Lofi', 'eastern melodies, lofi beats', 'Lofi Girl', LOFI_GIRL, 'asian lofi', 'asian lofi radio beats to relax study to'),
  yt('ghibli', 'asia', '🍃', 'Ghibli Piano', 'Studio Ghibli on piano', 'kno Piano Music', 'UCulsxDuZ0gU8lzhpPAjUwUg', 'Ghibli', 'ghibli piano 24/7 live'),
  yt('showa', 'asia', '🏮', 'Showa Jazz Kissa', 'morning piano jazz, old Tokyo café', 'Showa Jazz Cafe', 'UCjQhMZfoMEJ0tBHjAZIj0mA', 'Morning Piano Jazz', 'showa jazz cafe morning piano jazz live'),
  yt('seoul', 'asia', '🧋', 'Seoul Café Jazz', 'breezy jazz piano, Korean café', 'MONKEY BGM', 'UCBnMxlW70f0SB4ZTJx124lw', 'for Cafe, Coffee Shop', 'cafe jazz piano playlist live'),
  yt('saigon', 'asia', '🛵', 'Cà Phê Sáng', 'Vietnamese guitar for slow mornings', 'Nhạc Test Loa Không Lời', 'UC-XgUo3KYnVBVoLxjAVgOIQ', 'Rumba Guitar', 'nhạc không lời buổi sáng rumba guitar cafe live'),
  radio('citypop', 'asia', '🗾', 'Japan City Pop', "80s Tokyo city pop", 'BOX Radio', 'https://play.streamafrica.net/japancitypop', { api: 'icy' }),

  yt('synthwave', 'retro', '🌆', 'Synthwave', 'neon beats to chill/game to', 'Lofi Girl', LOFI_GIRL, 'synthwave radio', 'synthwave radio beats to chill game to'),
  radio('nightride', 'retro', '🚘', 'Nightride FM', 'synthwave radio', 'Nightride FM', 'https://stream.nightride.fm/nightride.mp3', { api: 'icy' }),

  yt('sleepy', 'sleep', '💤', 'Sleepy Lofi', 'beats to sleep & chill to', 'Lofi Girl', LOFI_GIRL, 'sleep/chill', 'lofi hip hop radio beats to sleep chill to'),
  yt('sleep', 'sleep', '🌌', 'Deep Sleep', 'calm ambient to sleep & dream to', 'Lofi Girl', LOFI_GIRL, 'deep sleep music', 'deep sleep music calm ambient 24/7'),
  yt('space', 'sleep', '🪐', 'Deep Space', 'ambient drift among the stars', 'View Escape', 'UCUc8mpd7aQROHAb-KxdoGww', 'Interstellar', 'deep space ambient music live'),
  radio('sleeping-pill', 'sleep', '🛌', 'Ambient Sleeping Pill', 'beatless ambient for sleep', 'Stereoscenic', 'https://radio.stereoscenic.com/asp-h', { api: 'icy' }),
]
export const stationById = (id) => STATIONS.find((s) => s.id === id) ?? STATIONS[0]
