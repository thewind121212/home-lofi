// A Spotify track's cover when Tavarian has none for it (songs from a Spotify-made playlist: its public page lists no
// per-song pictures, and the Web API won't list other people's playlists). Spotify's public oEmbed answers any track
// with its cover (no login, CORS open), so the page asks it — once per track (remembered), a few at a time, only for
// rows on screen (the caller decides that). No React here, so node:test can check it.
const OEMBED = 'https://open.spotify.com/oembed?url='
const TRACK = /^spotify:track:([A-Za-z0-9]{6,64})$/
const MAX_AT_ONCE = 3
const KEEP = 500 // covers remembered (a big queue stays cheap)

export const trackIdOf = (uri) => TRACK.exec(typeof uri === 'string' ? uri : '')?.[1] ?? null

// -> { cover(uri): Promise<url | null>, known(uri): url | null | undefined } — undefined = not asked yet
export function coverCache({ fetchImpl = (...a) => fetch(...a) } = {}) {
  const done = new Map() // id -> url | null
  const waiting = new Map() // id -> Promise
  const queue = []
  let running = 0
  const pump = () => {
    while (running < MAX_AT_ONCE && queue.length) {
      const job = queue.pop() // the newest first: the rows on screen now, not the ones scrolled past
      running++
      job().finally(() => (running--, pump()))
    }
  }
  const remember = (id, url) => {
    done.set(id, url)
    if (done.size > KEEP) done.delete(done.keys().next().value) // the oldest goes
    return url
  }
  return {
    known: (uri) => {
      const id = trackIdOf(uri)
      return id ? done.get(id) : null
    },
    cover(uri) {
      const id = trackIdOf(uri)
      if (!id) return Promise.resolve(null)
      if (done.has(id)) return Promise.resolve(done.get(id))
      if (waiting.has(id)) return waiting.get(id)
      const p = new Promise((resolve) => {
        queue.push(async () => {
          let url = null
          let final = true // false: a passing failure (rate limit, server error, network): not remembered, asked again later
          try {
            const r = await fetchImpl(OEMBED + encodeURIComponent(`https://open.spotify.com/track/${id}`), { cache: 'force-cache' })
            if (!r.ok) final = r.status === 404 || r.status === 400
            const j = r.ok ? await r.json() : null
            url = typeof j?.thumbnail_url === 'string' && /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i.test(j.thumbnail_url) ? j.thumbnail_url : null
          } catch {
            final = false
          }
          waiting.delete(id)
          resolve(final ? remember(id, url) : null)
        })
        pump()
      })
      waiting.set(id, p)
      return p
    },
  }
}
