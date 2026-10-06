// What an internet-radio station (kind 'stream') is playing right now. Server-only: app/api/radio/now/route.js.
// Most stations have a now-playing API; the rest ('icy') carry the song in the stream itself: we ask for the
// metadata, read up to the first block (a few KB) and hang up. Each answer is kept 20 s, so every listener's poll
// costs the station at most one call.
import { stationById } from './stations.js'

const TIMEOUT = 6000
const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'user-agent': 'wliafdew.dev radio' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
// "Artist - Title" -> { artist, title }
export const split = (t) => {
  const s = String(t ?? '').trim()
  const i = s.indexOf(' - ')
  return i > 0 ? { artist: s.slice(0, i), title: s.slice(i + 3) } : { artist: null, title: s }
}
// the ICY StreamTitle from a raw metadata block
export const streamTitle = (block) => /StreamTitle='(.*?)';/s.exec(block)?.[1] ?? null

async function icy(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'icy-metadata': '1', 'user-agent': 'wliafdew.dev radio' } })
  const every = Number(r.headers.get('icy-metaint'))
  if (!r.ok || !every || every > 256_000) return r.body?.cancel(), null
  const reader = r.body.getReader()
  const chunks = []
  let have = 0
  try {
    while (have < every + 1 + 255 * 16) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      have += value.length
      const buf = Buffer.concat(chunks)
      if (buf.length > every) {
        const len = buf[every] * 16
        if (buf.length >= every + 1 + len) return split(streamTitle(buf.subarray(every + 1, every + 1 + len).toString('utf8')))
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return null
}

const APIS = {
  laut: ({ id }) => get(`https://api.laut.fm/station/${id}/current_song`).then((j) => ({ artist: j.artist?.name, title: j.title })),
  flux: ({ id }) => get(`https://fluxmusic.api.radiosphere.io/channels/${id}/current-track`).then((j) => ({ artist: j.trackInfo?.artistCredits, title: j.trackInfo?.title })),
  paradise: ({ id }) => get(`https://api.radioparadise.com/api/now_playing?chan=${id}`).then((j) => ({ artist: j.artist, title: j.title })),
  srg: ({ id }) => get(`https://api.radioswiss${id === 'rsj' ? 'jazz' : 'classic'}.ch/api/v1/${id}/en/current`).then((j) => j.channel?.playingnow?.current?.metadata ?? {}),
  icy: (_, s) => icy(s.url),
}

const TTL = 20_000
const cache = new Map()
export async function nowPlaying(id) {
  const s = stationById(id)
  if (s.id !== id || s.kind !== 'stream' || !APIS[s.now?.api]) return null
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const v = await APIS[s.now.api](s.now, s)
  const value = v?.title ? { artist: v.artist ? String(v.artist).slice(0, 120) : null, title: String(v.title).slice(0, 160) } : null
  cache.set(id, { at: Date.now(), value })
  return value
}
