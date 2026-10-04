// Up/down + response time for a URL, cached per URL for 60 s (so visitors/polls can't hammer the targets).
// ok(json) judges JSON health endpoints; without it any HTTP status < maxStatus (after redirects) counts as up.
const TTL = 60_000
const cache = new Map() // url -> { at, value, pending }

async function probe(url, ok, maxStatus) {
  const t = Date.now()
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const up = ok ? r.ok && ok(await r.json()) : r.status < maxStatus
    return { up, ms: Date.now() - t }
  } catch {
    return { up: false, ms: null } // timeout, DNS, expired TLS cert...
  }
}

export function check(url, ok = null, maxStatus = 400) {
  const c = cache.get(url)
  if (c?.value && Date.now() - c.at < TTL) return c.value
  if (c?.pending) return c.pending
  const pending = probe(url, ok, maxStatus).then((value) => {
    cache.set(url, { at: Date.now(), value })
    return value
  })
  cache.set(url, { ...c, pending })
  return pending
}
