// Pins: links the owner keeps, each with its preview (the page's Open Graph / Twitter card, else its <title>,
// description and icon). Pure rules shared by the owner's route (app/api/private/settings/pins), its fetcher
// (lib/pins-fetch.js), its store (lib/pins-store.js) and the card (app/pins.js). No React, no network, no database,
// so node:test checks all of it.
//
// The server fetches what the owner pastes, from inside the LAN: that is the danger (SSRF). So a link must be plain
// http(s) on the default port with a public host name, and every address it resolves to must be public unicast
// (ipAllowed); the fetcher checks each redirect again and connects only to the address it checked.

export const MAX_PINS = 500
export const MAX_URL = 2048
export const MAX = { title: 200, description: 400, site: 80 }
export const SHOWN = 6 // the card shows the newest few; "Show all" opens the rest (and search looks at all of them)
export const UNDO_MS = 8_000 // a pin just removed can come back
export const UNDO_SLACK = 5_000 // the server's allowance for the trip there
// bytes of a page read, at most. The head is all that's needed, but some heads are huge: YouTube's is ~780 KB of inline
// script before its og:title. (Safe to read: parseHead is one linear pass, ~20 ms for this much hostile HTML)
export const MAX_HTML = 1_500_000

// why a pin has no preview (the card says so; the link is kept all the same)
export const REASONS = {
  blocked: 'a private or local address: not fetched',
  port: 'not on the usual port: not fetched',
  timeout: 'the site took too long',
  'not-html': 'not a web page',
  http: 'the site said no',
  redirects: 'too many redirects',
  refused: 'it led somewhere not allowed',
  unreachable: "couldn't reach the site",
  empty: 'the page has no preview',
}

const CTRL = /[\u0000-\u001f\u007f-\u009f]/g
const ID = /^[a-z0-9]{8,24}$/
// tracking tags that only make the same link look different
const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_eid|igshid|si)$/i

// ---- addresses: only public unicast may be fetched ----

const v4 = (s) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const p = m.slice(1).map(Number)
  return p.every((x) => x <= 255) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : null
}
// -> 8 hextets, or null (zones like fe80::1%eth0 too: never a public address)
function v6(s) {
  if (!/^[0-9a-f:.]+$/i.test(s) || s.length > 45) return null
  let tail = []
  // an IPv4 at the end ("::ffff:10.0.0.1") is the last two words
  if (s.includes('.')) {
    const i = s.lastIndexOf(':')
    const n = v4(s.slice(i + 1))
    if (n == null) return null
    tail = [n >>> 16, n & 0xffff]
    s = s.slice(0, i + 1)
    if (!s.endsWith('::')) s = s.slice(0, -1)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const part = (x) => (x === '' ? [] : x.split(':'))
  const head = part(halves[0]), back = halves.length === 2 ? part(halves[1]) : []
  const words = [...head, ...back]
  if (!words.every((w) => /^[0-9a-f]{1,4}$/i.test(w))) return null
  const want = 8 - tail.length
  if (halves.length === 1 ? words.length !== want : words.length >= want) return null
  const fill = halves.length === 2 ? Array(want - words.length).fill(0) : []
  return [...head.map((w) => parseInt(w, 16)), ...fill, ...back.map((w) => parseInt(w, 16)), ...tail]
}

// not on the internet: this host, the LAN, the carrier's NAT, link-local, multicast, documentation, reserved
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([a, bits]) => [v4(a), bits])
const v4Public = (n) => !V4_BLOCKED.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits))

// an IP address (v4 or v6, brackets allowed) -> may the server connect to it?
// v6: only global unicast (2000::/3), less its special blocks (Teredo and the IETF's 2001::/23, documentation, 6to4);
// an IPv4 inside one (::ffff:10.0.0.1, NAT64 64:ff9b::/96) is judged as that IPv4. Everything else (::1, ::,
// fc00::/7, fe80::/10, ff00::/8, the old ::a.b.c.d) is refused.
export function ipAllowed(ip) {
  if (typeof ip !== 'string') return false
  const s = ip.replace(/^\[(.*)\]$/, '$1')
  const n = v4(s)
  if (n != null) return v4Public(n)
  const h = v6(s)
  if (!h) return false
  const zero = (from, to) => h.slice(from, to).every((x) => x === 0)
  if (zero(0, 5) && h[5] === 0xffff) return v4Public(((h[6] << 16) | h[7]) >>> 0)
  if (h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6)) return v4Public(((h[6] << 16) | h[7]) >>> 0)
  if ((h[0] & 0xe000) !== 0x2000) return false
  if (h[0] === 0x2001 && (h[1] < 0x200 || h[1] === 0xdb8)) return false
  if (h[0] === 0x2002) return false
  if (h[0] === 0x3fff && h[1] < 0x1000) return false
  return true
}
export const isIpLiteral = (host) => v4(host) != null || v6(host.replace(/^\[(.*)\]$/, '$1')) != null

// ---- links ----

// what may be kept: an http(s) link with a host, no user name or password, not too long -> null, or what's wrong
function keepable(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'http or https links only'
  if (u.username || u.password) return 'no user name or password in the link'
  if (u.href.length > MAX_URL) return `at most ${MAX_URL} characters`
  if (!u.hostname) return 'a host name'
  return null
}

// What the server may fetch: a URL object -> null (fine) or why not, as a REASONS key. The fetcher asks this of
// every redirect too. A link the owner keeps can still be anything keepable (the router's page on the LAN, a dev
// server's port): it is kept, never fetched, and the card says why.
export function fetchable(u) {
  if (keepable(u)) return 'refused'
  const host = u.hostname.replace(/\.$/, '').toLowerCase()
  if (isIpLiteral(host) ? !ipAllowed(host) : host === 'localhost' || host.endsWith('.localhost')) return 'blocked'
  // one word (a LAN machine, a container's name) or a name only the LAN knows
  if (!isIpLiteral(host) && (!host.includes('.') || /\.(local|lan|home|internal|intranet|corp|home\.arpa)$/.test(host))) return 'blocked'
  return u.port ? 'port' : null // (80 / 443 only: the URL parser drops a default one)
}

const keyOf = (part) => {
  const k = part.split('=')[0].replace(/\+/g, ' ')
  try {
    return decodeURIComponent(k)
  } catch {
    return k
  }
}

// what the owner pasted -> { url } | { error, field }. A bare "example.com/x" is taken as https. Tracking tags go
// (the same link shared twice is then the same pin); the rest stays as it was.
export function cleanUrl(raw) {
  const bad = (why) => ({ error: `url: ${why}`, field: 'url' })
  if (typeof raw !== 'string') return bad('a link')
  let s = raw.replace(CTRL, '').trim()
  if (!s) return bad('a link')
  if (s.length > MAX_URL) return bad(`at most ${MAX_URL} characters`)
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[^\s/?#]+\.[a-z]{2,}([/?#:]|$)/i.test(s)) s = `https://${s}`
  let u
  try {
    u = new URL(s)
  } catch {
    return bad('a link')
  }
  const why = keepable(u)
  if (why) return bad(why)
  // (on the raw query: rebuilding it through searchParams would change the rest, "a%20b" to "a+b", "flag" to "flag=")
  if (u.search) {
    const parts = u.search.slice(1).split('&')
    const keep = parts.filter((part) => !TRACKING.test(keyOf(part)))
    if (keep.length < parts.length) u.search = keep.length ? `?${keep.join('&')}` : ''
  }
  const href = u.href.replace(/#$/, '') // (an empty fragment: the same page)
  return href.length > MAX_URL ? bad(`at most ${MAX_URL} characters`) : { url: href }
}

// does the text look like a link to pin (not a search)? The card's one box does both: "https://…" or "www.…" pins
export const looksLikeLink = (s) => typeof s === 'string' && /^(https?:\/\/|www\.)\S+$/i.test(s.trim())

// the host to show: "github.com", "en.wikipedia.org" (no www.)
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ---- the page's head -> its preview ----

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', deg: '°',
  times: '×', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', iexcl: '¡', iquest: '¿', shy: '',
  zwj: '', zwnj: '', thinsp: ' ', ensp: ' ', emsp: ' ', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à',
  oacute: 'ó', uacute: 'ú', iacute: 'í', ccedil: 'ç', ntilde: 'ñ', ouml: 'ö', uuml: 'ü', auml: 'ä', szlig: 'ß',
}
// &amp; &#39; &#x2019; &hellip; -> the characters (named ones need their ';'; an unknown name stays as it is)
export function decodeEntities(s) {
  return String(s).replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,31}));?/gi, (m, dec, hex, name) => {
    if (name) return m.endsWith(';') && Object.hasOwn(NAMED, name) ? NAMED[name] : m
    const cp = dec ? Number(dec) : parseInt(hex, 16)
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�'
  })
}

// a text from the page -> one clean line, at most n characters (never half of one)
export function cleanText(s, n) {
  if (typeof s !== 'string') return null
  const t = decodeEntities(s).replace(/<[^<>]{0,200}>/g, ' ').replace(CTRL, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const a = Array.from(t)
  return a.length > n ? `${a.slice(0, n - 1).join('').trimEnd()}…` : t
}

// a link from the page (an image, an icon) against where the page ended up -> an absolute http(s) URL, or null
export function absUrl(v, base) {
  if (typeof v !== 'string') return null
  const s = decodeEntities(v).replace(CTRL, '').trim()
  if (!s || s.length > MAX_URL) return null
  try {
    const u = new URL(s, base)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.href.length > MAX_URL) return null
    return u.href
  } catch {
    return null
  }
}

// A picture or icon the page names, for the card -> its absolute URL if the same rules as a fetch allow it, else
// null. The owner's browser loads it from inside the LAN on every render: a page saying og:image =
// http://10.0.0.1/cgi-bin/reboot must not make it do that. (A public name that resolves into the LAN can't be told
// apart without resolving it; the browser's own Private Network Access checks are the backstop there.)
export function safeLink(v, base) {
  const href = absUrl(v, base)
  if (!href) return null
  return fetchable(new URL(href)) ? null : href
}

const ATTR = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
function attrsOf(s) {
  const a = {}
  for (const m of s.matchAll(ATTR)) {
    const k = m[1].toLowerCase()
    if (!(k in a)) a[k] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return a
}
// an icon's size, to pick the best ("32x32", "any" for an SVG; an apple-touch-icon without sizes is 180)
const iconSize = (rels, sizes, href) => {
  if (/\bany\b/i.test(sizes ?? '') || /\.svg(\?|$)/i.test(href)) return 512
  const m = /(\d+)x(\d+)/i.exec(sizes ?? '')
  if (m) return Number(m[1])
  return rels.some((r) => r.startsWith('apple-touch-icon')) ? 180 : 16
}

// YouTube names its biggest still (maxresdefault), which many videos and live streams don't have (the 404 comes with
// a grey stand-in picture). hqdefault is there for nearly all of them, and a tile is 112 px wide anyway
const smaller = (img) => img?.replace(/^(https:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/[\w-]+\/)maxresdefault(\.(?:jpg|webp))/, '$1hqdefault$2') ?? null

// The head as tags, in one pass and without a regex that can backtrack: a page is untrusted, and "<meta " a million
// times over must cost a millisecond, not the event loop. Each '<' is looked at once; a tag runs to its '>' outside
// quotes; script / style / template / title run to their own closing tag; a comment to "-->". Anything left open
// (no '>', no closing tag) ends the scan there. It stops at </head> or <body.
// -> { tags: [{ name, attrs }] (meta, link, base), title (its raw text, the first one) }
const NAME = /<(\/?)([a-zA-Z][a-zA-Z0-9-]{0,31})/y
const RAW = new Set(['script', 'style', 'template', 'title', 'textarea', 'noscript'])
function scanHead(s) {
  const tags = []
  let title = null
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt < 0) break
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4)
      if (e < 0) break
      i = e + 3
      continue
    }
    NAME.lastIndex = lt
    const m = NAME.exec(s)
    if (!m) {
      i = lt + 1
      continue
    }
    const name = m[2].toLowerCase()
    if (name === 'body' && !m[1]) break
    // the tag's end: the first '>' outside quotes
    let j = lt + m[0].length, q = ''
    for (; j < s.length; j++) {
      const c = s[j]
      if (q) {
        if (c === q) q = ''
      } else if (c === '"' || c === "'") q = c
      else if (c === '>') break
    }
    if (j >= s.length) break
    i = j + 1
    if (m[1]) {
      if (name === 'head') break
      continue
    }
    if (name === 'meta' || name === 'link' || name === 'base') tags.push({ name, attrs: attrsOf(s.slice(lt + m[0].length, j)) })
    else if (RAW.has(name)) {
      // to its closing tag (found by '</' and a look at the name: no lowercased copy, whose indexes could differ)
      const close = new RegExp(`</${name}[\\s>/]`, 'iy')
      let k = i
      for (;;) {
        k = s.indexOf('</', k)
        if (k < 0) break
        close.lastIndex = k
        if (close.test(s)) break
        k += 2
      }
      if (k < 0) {
        i = s.length
        break
      }
      if (name === 'title' && title == null) title = s.slice(i, k)
      i = k
    }
  }
  return { tags, title }
}

// The page's HTML (only its head is looked at; anything broken is shrugged off) and the URL it came from ->
// { title, description, image, icon, site }, each null when there's none. Open Graph first, then Twitter's card, then
// the plain head; the icon falls back to /favicon.ico. Pictures and icons only where safeLink allows.
export function parseHead(html, pageUrl) {
  const { tags, title } = scanHead(typeof html === 'string' ? html.slice(0, MAX_HTML) : '')
  let base = pageUrl
  const meta = {}
  const icons = []
  let imageSrc = null
  for (const { name, attrs: a } of tags) {
    if (name === 'base') {
      if (a.href && base === pageUrl) base = absUrl(a.href, pageUrl) ?? pageUrl
    } else if (name === 'meta') {
      const k = (a.property ?? a.name ?? a.itemprop ?? '').trim().toLowerCase()
      if (k && a.content != null && !(k in meta)) meta[k] = a.content
    } else if (a.href) {
      const rels = (a.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      if (rels.includes('icon') || rels.some((r) => r.startsWith('apple-touch-icon'))) icons.push({ href: a.href, size: iconSize(rels, a.sizes, a.href) })
      else if (rels.includes('image_src')) imageSrc ??= a.href
    }
  }
  const first = (...keys) => keys.map((k) => meta[k]).find((v) => typeof v === 'string' && v.trim()) ?? null
  const image = smaller([first('og:image', 'og:image:url'), first('og:image:secure_url'), first('twitter:image', 'twitter:image:src'), imageSrc]
    .map((v) => safeLink(v, base))
    .find(Boolean) ?? null)
  // the biggest icon the page names (an icon's own size doesn't matter much: it shows at 16 to 32 px, so >= 32 is enough)
  icons.sort((x, y) => Math.min(y.size, 64) - Math.min(x.size, 64))
  const icon = icons.map((i) => safeLink(i.href, base)).find(Boolean) ?? safeLink('/favicon.ico', pageUrl)
  return {
    title: cleanText(first('og:title', 'twitter:title') ?? title ?? '', MAX.title),
    description: cleanText(first('og:description', 'twitter:description', 'description') ?? '', MAX.description),
    image,
    icon,
    site: cleanText(first('og:site_name', 'application-name') ?? '', MAX.site),
  }
}

// ---- what the page asks ----

// POST's body -> { act: { action: 'add', url } | { action: 'refresh' | 'undo', id } } | { error, field }
export function cleanAction(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'an object', field: null }
  const action = b.action ?? 'add'
  if (action === 'add') {
    const c = cleanUrl(b.url)
    return c.error ? c : { act: { action, url: c.url } }
  }
  if (action !== 'refresh' && action !== 'undo') return { error: 'action: add, refresh or undo', field: 'action' }
  return validId(b.id) ? { act: { action, id: b.id } } : { error: 'id: a pin\'s id', field: 'id' }
}
export const validId = (v) => typeof v === 'string' && ID.test(v)

// the undo right after a removal (later it's gone; pasting the link again brings it back)
export const canUndo = (removedAt, nowMs) => Number.isFinite(removedAt) && nowMs - removedAt >= 0 && nowMs - removedAt <= UNDO_MS + UNDO_SLACK

// ---- search (the card's, as you type) ----

// lower case, no accents (Vietnamese đ too, which Unicode doesn't take apart): "Đà Lạt" ~ "da lat"
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd')

// every word of the query somewhere in the pin's title, description, site, link or domain
export function matches(pin, query) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold([pin.title, pin.description, pin.site, pin.url, pin.domain].filter(Boolean).join(' \n '))
  return words.every((w) => hay.includes(w))
}
