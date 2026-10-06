// Finds each YouTube radio station's current 24/7 live stream with youtubei.js (YouTube's own InnerTube API, an npm
// library: no binary, no key). Server-only: app/api/radio/route.js. One request per channel, cached for an hour.
import { Innertube, Log } from 'youtubei.js'
import { STATIONS } from './stations.js'

Log.setLevel(Log.Level.NONE) // the library logs every page part it doesn't know yet

let client = null
const yt = () => (client ??= Innertube.create({ retrieve_player: false, generate_session_locally: true }).catch((e) => ((client = null), Promise.reject(e))))

// "3.6K watching" / "427 watching" / "1.2M watching" -> 3600 / 427 / 1200000; null when there's no count
export function viewers(text) {
  const m = /([\d.,]+)\s*([KM])?\s+watching/i.exec(String(text ?? ''))
  if (!m) return null
  const n = Number(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6 }[m[2]?.toUpperCase()] ?? 1)
  return Number.isFinite(n) ? Math.round(n) : null
}
// a LockupView / Video item -> { videoId, title, live, watching }
export function asStream(v) {
  const videoId = v.content_id ?? v.id ?? v.video_id
  const title = String(v.metadata?.title?.text ?? v.title?.text ?? v.title ?? '')
  const live = v.is_live === true || JSON.stringify(v.content_image ?? v.badges ?? v.thumbnail_overlays ?? '').includes('LIVE')
  const count = v.view_count?.text ?? JSON.stringify(v.metadata ?? '').match(/"text":"([^"]*watching)"/i)?.[1]
  return { videoId, title, live, watching: viewers(count) }
}
// the first live stream whose title contains `match` (any case)
export const pick = (streams, match) => streams.find((s) => s.live && s.videoId && s.title.toLowerCase().includes(match.toLowerCase())) ?? null

// the channel's live tab, up to 3 pages (Lofi Girl alone runs 20+ streams)
async function channelStreams(id) {
  let page = await (await (await yt()).getChannel(id)).getLiveStreams()
  const all = [...(page.videos ?? [])]
  for (let i = 0; i < 2 && page.has_continuation; i++) {
    page = await page.getContinuation()
    all.push(...(page.videos ?? []))
  }
  return all.map(asStream)
}
async function searchLive(query) {
  const r = await (await yt()).search(query, { features: ['live'] })
  return r.results.filter((x) => x.type === 'Video').map(asStream)
}

const TTL = 3600_000
let cache = { at: 0, value: null, pending: null }
// { stationId: { v, title, watching } | null } for the YouTube stations: the channel's matching live stream, else the
// first live search hit, else the last one that worked (kept from the previous hour), else null (the page skips it)
export async function stationStreams() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value
  cache.pending ??= (async () => {
    const tube = STATIONS.filter((s) => s.kind === 'youtube')
    const channels = [...new Set(tube.map((s) => s.channel))]
    const lists = Object.fromEntries(await Promise.all(channels.map(async (c) => [c, await channelStreams(c).catch(() => [])])))
    const found = async (s) => pick(lists[s.channel], s.match) ?? pick(await searchLive(s.query).catch(() => []), '')
    const pairs = await Promise.all(
      tube.map(async (s) => {
        const f = await found(s)
        return [s.id, f ? { v: f.videoId, title: f.title, watching: f.watching } : (cache.value?.[s.id] ?? null)]
      }),
    )
    cache = { at: Date.now(), value: Object.fromEntries(pairs), pending: null }
    return cache.value
  })().catch((e) => {
    cache.pending = null
    if (cache.value) return cache.value
    throw e
  })
  return cache.pending
}
