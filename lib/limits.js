// Small per-client limits for public routes (Tavarian events + tickets). In memory, per server process.

// The visitor's IP as the proxies report it: the first X-Forwarded-For entry (the address the outermost proxy saw),
// else X-Real-IP, else 'unknown'. Behind our chain (front proxy -> NPM -> Coolify's proxy) the last entries and
// X-Real-IP are proxies, so they would put every visitor in one bucket. A client can fake the first entry: these
// limits are a courtesy guard against a runaway tab, not security (the routes also have a total cap).
const IP = /^[0-9a-fA-F:.]{2,45}$/
export function clientIp(request) {
  const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (first && IP.test(first)) return first
  const real = request.headers.get('x-real-ip')?.trim()
  return real && IP.test(real) ? real : 'unknown'
}

// at most `max` hits per key in any `windowMs` (sliding window); hit(key) -> true when allowed
export function windowLimit(max, windowMs, now = Date.now) {
  const hits = new Map()
  return function hit(key) {
    const t = now()
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v.at(-1) >= windowMs) hits.delete(k) // sweep
    const list = (hits.get(key) ?? []).filter((at) => t - at < windowMs)
    if (list.length >= max) return hits.set(key, list), false
    list.push(t)
    hits.set(key, list)
    return true
  }
}

// open-at-once slots: `perKey` per key and `total` in all; take(key) -> a release function, or null when full
export function slots(perKey, total) {
  const open = new Map()
  let all = 0
  return function take(key) {
    const n = open.get(key) ?? 0
    if (n >= perKey || all >= total) return null
    open.set(key, n + 1)
    all++
    let done = false
    return () => {
      if (done) return
      done = true
      all--
      const left = (open.get(key) ?? 1) - 1
      left > 0 ? open.set(key, left) : open.delete(key)
    }
  }
}
