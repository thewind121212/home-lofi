// Radio stations: 24/7 YouTube live streams, played audio-only through the hidden IFrame player (app/page.js Music).
// No video ids here: a station is a channel + a word from its stream's title; the server asks YouTube for the channel's
// current live stream (lib/youtube.js, /api/stations, cached for an hour), so a restarted stream is picked up by itself.
// `query` is the fallback search when the channel has no matching live stream.
export const STATIONS = [
  { id: 'lofi', emoji: '📚', name: 'Lofi Hip Hop', sub: 'beats to relax/study to', by: 'Lofi Girl', channel: 'UCSJ4gkVC6NrvII8umztf0Ow', match: 'lofi hip hop radio 📚', query: 'lofi hip hop radio beats to relax study to' },
  { id: 'cafe', emoji: '☕', name: 'Café Jazz Piano', sub: 'slow jazz for work & study', by: 'Cafe Music BGM', channel: 'UCJhjE7wbdYAae1G25m0tHAA', match: 'Jazz Piano', query: 'relaxing jazz piano radio 24/7' },
  { id: 'piano', emoji: '🎹', name: 'Relaxing Piano', sub: 'calm piano to focus & sleep', by: 'Soothing Relaxation', channel: 'UCjzHeG1KWoonmf9d5KBvSiw', match: 'Piano', query: 'relaxing piano radio 24/7' },
  { id: 'classical', emoji: '🎼', name: 'Classical', sub: 'the great composers, all day', by: 'Classical Music Radio', channel: 'UCfANid6KTbeIs10W02xMDZQ', match: 'Classical', query: 'classical music radio 24/7' },
  { id: 'strings', emoji: '🎻', name: 'Violin & Strings', sub: 'adagios for violin, piano & cello', by: 'Classical Music Adagio', channel: 'UCa3-OziS4wzaUdy3Vosp7hA', match: 'Adagio', query: 'violin cello adagios 24/7 live' },
  { id: 'citypop', emoji: '🗾', name: 'Japanese City Pop', sub: 'シティポップ, night drive in Tokyo', by: 'Tokyo WFH Radio', channel: 'UCfbLFe1gfsrNlJ6CqlFDOfQ', match: 'City Pop', query: 'japanese city pop radio 24/7' },
  { id: 'ghibli', emoji: '🍃', name: 'Ghibli Piano', sub: 'Studio Ghibli on piano', by: 'kno Piano Music', channel: 'UCulsxDuZ0gU8lzhpPAjUwUg', match: 'Ghibli', query: 'ghibli piano 24/7 live' },
  { id: 'bossa', emoji: '🌴', name: 'Bossa Nova', sub: 'soft guitar & café covers', by: 'Nova Lounge', channel: 'UCCkniCDFfS4PfVdq2mPkaGQ', match: 'Bossa', query: 'bossa nova radio 24/7' },
  { id: 'synthwave', emoji: '🌆', name: 'Synthwave', sub: 'neon nights, retro synths', by: 'Synthscape FM', channel: 'UChP-xPZ55v6Bwp2b4TAXESQ', match: 'SYNTHWAVE', query: 'synthwave radio 24/7' },
  { id: 'sleep', emoji: '🌌', name: 'Deep Sleep', sub: 'calm ambient to sleep & dream to', by: 'Lofi Girl', channel: 'UCSJ4gkVC6NrvII8umztf0Ow', match: 'deep sleep', query: 'deep sleep music calm ambient 24/7' },
]
export const stationById = (id) => STATIONS.find((s) => s.id === id) ?? STATIONS[0]
