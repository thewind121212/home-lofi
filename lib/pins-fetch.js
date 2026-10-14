// A pin's preview, fetched by the server (server-only: the route app/api/private/settings/pins). The server sits on
// the home LAN, so a link must never reach in there (SSRF): every host, the first and each redirect's, is resolved
// here and all of its addresses must be public (lib/pins.js ipAllowed); the socket then goes to the very address that
// was checked (a lookup of our own on the request: a second DNS answer can't swap in 10.0.0.1), with the real Host
// and TLS name. At most LIMITS.hops redirects, LIMITS.ms in all, LIMITS.bytes read (as the head is all it needs, it
// stops at </head>), web pages only.
// The route tests hand in their own fetcher (globalThis.__homePinsFetch); this file's tests stand a local server in
// for the site (request: the connection, resolve: the DNS), so nothing touches the network.
import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { pipeline } from 'node:stream'
import zlib from 'node:zlib'
import { MAX_HTML, fetchable, cleanText, ipAllowed, parseHead } from './pins.js'

export const LIMITS = { hops: 3, ms: 6_000, bytes: MAX_HTML }
// a plain name (some sites answer bots with a challenge page either way; the pin is kept then, without a preview)
const UA = 'Mozilla/5.0 (compatible; home-lofi-pins/1.0; +https://home.wliafdew.dev) link preview'
const HTML = ['text/html', 'application/xhtml+xml']

class Refused extends Error {
  constructor(reason, detail) {
    super(reason)
    this.reason = reason
    this.detail = detail
  }
}

// a host name -> every address it has ([{ address, family }]). c-ares (a Resolver), not getaddrinfo: a lookup that
// hangs would sit in libuv's 4 threads (shared with zlib, fs, crypto) where nothing can cancel it, long after the fetch
// gave up. This one times out by itself and is cancelled when the fetch ends. (It doesn't read /etc/hosts: only
// public names are fetched anyway.)
async function dnsAll(host, signal) {
  const r = new Resolver({ timeout: 2000, tries: 2 })
  const cancel = () => r.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const [v4, v6] = await Promise.allSettled([r.resolve4(host), r.resolve6(host)])
    const list = [...(v4.value ?? []).map((address) => ({ address, family: 4 })), ...(v6.value ?? []).map((address) => ({ address, family: 6 }))]
    if (!list.length) throw v4.reason ?? v6.reason ?? new Error('ENOTFOUND')
    return list
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

// a host -> the address to connect to, once all of them are public
async function vet(host, resolve, allow, signal) {
  const bare = host.replace(/^\[(.*)\]$/, '$1')
  let list
  if (isIP(bare)) list = [{ address: bare, family: isIP(bare) }]
  else {
    try {
      list = await resolve(bare, signal)
    } catch {
      throw new Refused('unreachable')
    }
  }
  if (!Array.isArray(list) || !list.length) throw new Refused('unreachable')
  if (!list.every((a) => allow(a.address))) throw new Refused('blocked')
  return list[0]
}

// One GET to the checked address: Host and SNI stay the link's own. -> the response (headers in, body not read yet)
export function request(u, addr, signal) {
  return new Promise((resolve, reject) => {
    const tls = u.protocol === 'https:'
    const req = (tls ? https : http).request(
      {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[(.*)\]$/, '$1'),
        port: u.port || (tls ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        agent: false, // a fresh socket each time: a pooled one could be to another address
        lookup: (_host, opts, cb) => (opts?.all ? cb(null, [addr]) : cb(null, addr.address, addr.family)),
        signal,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': 'en,vi;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    )
    req.on('error', reject)
    req.end()
  })
}

// bodies being read right now (the tests check each one ends, timeout or not)
export const reading = { now: 0 }

// the response's body, unzipped, up to `limit` bytes (unzipped: a small bomb stops there too): it stops as soon as the
// head is over. The fetch giving up (signal) ends it at once, the unzipper included (pipeline: one going down takes
// the other with it; a bare .pipe() would leave the unzipper waiting forever, its buffers held)
async function readHead(res, limit, signal) {
  const enc = String(res.headers['content-encoding'] ?? '').trim().toLowerCase()
  const unzip = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip() : enc === 'deflate' ? zlib.createInflate() : enc === 'br' ? zlib.createBrotliDecompress() : null
  if (!unzip && enc && enc !== 'identity') throw new Refused('not-html')
  const body = unzip ?? res
  if (unzip) pipeline(res, unzip, () => {})
  const kill = () => {
    const e = new Refused('timeout')
    res.destroy(e)
    body.destroy(e)
  }
  if (signal?.aborted) kill()
  else signal?.addEventListener('abort', kill, { once: true })
  reading.now++
  const chunks = []
  let n = 0, tail = ''
  try {
    for await (const c of body) {
      chunks.push(c)
      n += c.length
      if (n >= limit) break
      // (the end of the head is plain ASCII, so latin1 finds it in any ASCII-based charset)
      const text = tail + c.toString('latin1')
      if (/<\/head\s*>|<body[\s>]/i.test(text)) break
      tail = text.slice(-16)
    }
  } catch (e) {
    if (!chunks.length) throw e // (a body cut short: what came may still hold the head)
  } finally {
    signal?.removeEventListener('abort', kill)
    res.destroy()
    body.destroy()
    reading.now--
  }
  return Buffer.concat(chunks).subarray(0, limit)
}

// bytes -> text, in the charset the server or the page names (UTF-8 if none, or one TextDecoder doesn't know)
function decode(buf, contentType) {
  const named = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1]
    ?? /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'))?.[1]
  try {
    return new TextDecoder(named || 'utf-8').decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

// A link (already through lib/pins.js cleanUrl; fetchable is checked here) -> its preview. Never throws:
//   { ok: true, url (where it ended up), title, description, image, icon, site }
//   { ok: false, reason (a lib/pins.js REASONS key), status? }
export async function fetchPreview(link, { resolve = dnsAll, allow = ipAllowed, send = request, ms = LIMITS.ms, hops = LIMITS.hops, bytes = LIMITS.bytes } = {}) {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), ms)
  const late = new Promise((_, reject) => stop.signal.addEventListener('abort', () => reject(new Refused('timeout')), { once: true }))
  late.catch(() => {})
  const timed = (p) => Promise.race([p, late])
  try {
    let u = new URL(link)
    for (let hop = 0; ; hop++) {
      const why = fetchable(u)
      if (why) throw new Refused(why)
      const addr = await timed(vet(u.hostname, resolve, allow, stop.signal))
      const res = await timed(send(u, addr, stop.signal))
      const code = res.statusCode
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.destroy()
        if (hop >= hops) throw new Refused('redirects')
        try {
          u = new URL(res.headers.location, u)
        } catch {
          throw new Refused('unreachable')
        }
        continue
      }
      if (code < 200 || code >= 300) {
        res.destroy()
        throw new Refused('http', code)
      }
      const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      // a picture's own link: the picture is its preview
      if (type.startsWith('image/') && type !== 'image/svg+xml') {
        res.destroy()
        const last = u.pathname.split('/').filter(Boolean).pop() ?? ''
        let name = last
        try {
          name = decodeURIComponent(last) // (%E9 from a Latin-1 site isn't UTF-8: then as it is)
        } catch {}
        name = name.replace(/\.[a-z0-9]{2,5}$/i, '')
        return { ok: true, url: u.href, title: cleanText(name, 200), description: null, image: u.href, icon: null, site: null }
      }
      if (!HTML.includes(type)) {
        res.destroy()
        throw new Refused('not-html')
      }
      const html = decode(await timed(readHead(res, bytes, stop.signal)), res.headers['content-type'])
      const p = parseHead(html, u.href)
      if (!p.title && !p.description && !p.image) return { ok: false, reason: 'empty', icon: p.icon }
      return { ok: true, url: u.href, ...p }
    }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, reason: e.reason, ...(e.detail && { status: e.detail }) }
    return { ok: false, reason: stop.signal.aborted ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timer)
    stop.abort() // (whatever is still open: a socket, a lookup's race)
  }
}
