// Finds each radio station's current 24/7 live stream with youtubei.js (YouTube's own InnerTube API, an npm library:
// no binary, no key). Server-only: app/api/stations/route.js. One request per channel, cached for an hour.
import { Innertube, Log } from 'youtubei.js'
import { STATIONS } from './stations.js'

Log.setLevel(Log.Level.NONE) // the library logs every page part it doesn't know yet

let client = null
const yt = () => (client ??= Innertube.create({ retrieve_player: false, generate_session_locally: true }).catch((e) => ((client = null), Promise.reject(e))))

// a LockupView / Video item -> { videoId, title, live }
export function asStream(v) {
  const videoId = v.content_id ?? v.id ?? v.video_id
  const title = String(v.metadata?.title?.text ?? v.title?.text ?? v.title ?? '')
  const live = v.is_live === true || JSON.stringify(v.content_image ?? v.badges ?? v.thumbnail_overlays ?? '').includes('LIVE')
  return { videoId, title, live }
}
// the first live stream whose title contains `match` (any case)
export const pick = (streams, match) => streams.find((s) => s.live && s.videoId && s.title.toLowerCase().includes(match.toLowerCase()))?.videoId ?? null

async function channelStreams(id) {
  const ch = await (await yt()).getChannel(id)
  return ((await ch.getLiveStreams()).videos ?? []).map(asStream)
}
async function searchLive(query) {
  const r = await (await yt()).search(query, { features: ['live'] })
  return r.results.filter((x) => x.type === 'Video').map(asStream)
}

const TTL = 3600_000
let cache = { at: 0, value: null, pending: null }
// { stationId: videoId | null }: the channel's matching live stream, else the first live search hit, else the last one
// that worked (kept from the previous hour), else null (the page leaves that station out)
export async function stationStreams() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value
  cache.pending ??= (async () => {
    const channels = [...new Set(STATIONS.map((s) => s.channel))]
    const lists = Object.fromEntries(await Promise.all(channels.map(async (c) => [c, await channelStreams(c).catch(() => [])])))
    const pairs = await Promise.all(
      STATIONS.map(async (s) => [
        s.id,
        pick(lists[s.channel], s.match) ?? pick(await searchLive(s.query).catch(() => []), '') ?? cache.value?.[s.id] ?? null,
      ]),
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
