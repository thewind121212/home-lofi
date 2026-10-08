// A Spotify track's cover when Tavarian has none for it (songs from a Spotify-made playlist: its public page lists no
// per-song pictures, and the Web API won't list other people's playlists). Spotify's public oEmbed answers any track
// with its cover (no login, CORS open), so the page asks it — once per track (remembered), a few at a time, only for
// rows on screen (the caller decides that). No React here, so node:test can check it.
const OEMBED = 'https://open.spotify.com/oembed?url='
const TRACK = /^spotify:track:([A-Za-z0-9]{6,64})$/
const COVER = /^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i // Spotify's image hosts only
const ID = /^[A-Za-z0-9]{6,64}$/
const MAX_AT_ONCE = 6 // (open.spotify.com speaks HTTP/2: these share one connection)
const KEEP = 500 // covers remembered (a big queue stays cheap)

export const trackIdOf = (uri) => TRACK.exec(typeof uri === 'string' ? uri : '')?.[1] ?? null

// -> { cover(uri): Promise<url | null>, known(uri): url | null | undefined } — undefined = not asked yet
// store: { load(): [[id, url]…], save(entries) } — covers kept across reloads (a track's cover doesn't change); only
// found covers are kept there, so a song without one is asked again on a later visit
export function coverCache({ fetchImpl = (...a) => fetch(...a), store = null } = {}) {
  const done = new Map() // id -> url | null
  try {
    for (const [id, url] of store?.load() ?? []) if (ID.test(id) && typeof url === 'string' && COVER.test(url)) done.set(id, url) // (checked like a fresh answer)
  } catch {}
  let saving = 0
  const flush = () => {
    clearTimeout(saving)
    saving = 0
    try {
      store?.save([...done].filter(([, url]) => url).slice(-KEEP))
    } catch {}
  }
  const persist = () => {
    if (!store || saving) return
    saving = setTimeout(flush, 1000) // a burst of covers is one write
  }
  // (a hit moves to the back: the covers seen most often are the last to go)
  const touch = (id) => {
    const url = done.get(id)
    done.delete(id)
    done.set(id, url)
    return url
  }
  let pausedUntil = 0 // Spotify said "too many": wait before asking again
  const waiting = new Map() // id -> Promise
  const queue = []
  let running = 0
  const pump = () => {
    const wait = pausedUntil - Date.now()
    if (wait > 0) return void setTimeout(pump, wait)
    while (running < MAX_AT_ONCE && queue.length) {
      const job = queue.pop() // the newest first: the rows on screen now, not the ones scrolled past
      running++
      job().finally(() => (running--, pump()))
    }
  }
  const remember = (id, url) => {
    done.set(id, url)
    if (done.size > KEEP) done.delete(done.keys().next().value) // the oldest goes
    if (url) persist()
    return url
  }
  return {
    known: (uri) => {
      const id = trackIdOf(uri)
      return !id ? null : done.has(id) ? touch(id) : undefined
    },
    flush, // save now (the page is going away)
    cover(uri) {
      const id = trackIdOf(uri)
      if (!id) return Promise.resolve(null)
      if (done.has(id)) return Promise.resolve(touch(id))
      if (waiting.has(id)) return waiting.get(id)
      const p = new Promise((resolve) => {
        queue.push(async () => {
          let url = null
          let final = true // false: a passing failure (rate limit, server error, network): not remembered, asked again later
          try {
            const r = await fetchImpl(OEMBED + encodeURIComponent(`https://open.spotify.com/track/${id}`), { cache: 'force-cache' })
            if (r.status === 429) pausedUntil = Date.now() + (Number(r.headers.get('retry-after')) || 5) * 1000
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
