// The preview fetcher (lib/pins-fetch.js): the SSRF fence (every address checked, each redirect too, the socket to the
// checked address), the limits (hops, time, bytes, web pages only) and the decoding. No network: a local server stands
// in for the sites (send() connects to its port), and resolve() is the DNS.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import zlib from 'node:zlib'
import { fetchPreview, request } from './pins-fetch.js'
import { ipAllowed } from './pins.js'

const HEAD = '<html><head><title>Plain</title><meta property="og:title" content="Stand-in &amp; site"><meta property="og:image" content="/cover.jpg"></head><body>'
let server, port
const hits = [] // [host, path] the stand-in saw
before(async () => {
  server = http.createServer((req, res) => {
    hits.push([req.headers.host, req.url])
    const html = (body, extra = {}) => (res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...extra }), res.end(body))
    const [, route, arg] = /^\/([^/?]*)\/?([^?]*)/.exec(req.url)
    if (route === 'page') return html(`${HEAD}<p>hello</p></body></html>`)
    if (route === 'hop') return Number(arg) > 0 ? (res.writeHead(302, { location: `/hop/${Number(arg) - 1}` }), res.end()) : html(HEAD)
    if (route === 'away') return res.writeHead(301, { location: decodeURIComponent(arg) }), res.end()
    if (route === 'json') return res.writeHead(200, { 'content-type': 'application/json' }), res.end('{}')
    if (route === 'png') return res.writeHead(200, { 'content-type': 'image/png' }), res.end(Buffer.alloc(64))
    if (route === 'missing') return res.writeHead(404, { 'content-type': 'text/html' }), res.end(HEAD)
    if (route === 'slow') return // never answers
    if (route === 'gzip') return html(zlib.gzipSync(`${HEAD}</html>`), { 'content-encoding': 'gzip' })
    if (route === 'latin1') return res.writeHead(200, { 'content-type': 'text/html' }), res.end(Buffer.from('<head><meta charset="windows-1252"><title>Caf\xe9 \x93quoted\x94</title></head>', 'latin1'))
    if (route === 'endless') {
      // the head, then a body that never ends: the reader stops at </head>
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write(HEAD)
      const t = setInterval(() => res.write('<p>more</p>'.repeat(100)), 5)
      return res.on('close', () => clearInterval(t))
    }
    if (route === 'huge') {
      // a head that never ends: the reader stops at its byte limit (the title comes too late to count)
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<head>')
      let sent = 0
      const t = setInterval(() => {
        if (res.destroyed || sent > 50_000_000) return clearInterval(t)
        res.write(' '.repeat(65_536))
        sent += 65_536
      }, 1)
      return res.on('close', () => clearInterval(t))
    }
    res.writeHead(500)
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  port = server.address().port
})
after(() => server.close())

// the stand-in's DNS: these names are "public" (the stand-in itself), the others whatever the test says
const DNS = { 'site.test': ['127.0.0.1'], 'lan.test': ['10.0.0.5'], 'mixed.test': ['93.184.216.34', '10.0.0.1'], 'v6.test': ['::1'] }
const resolve = async (host) => {
  if (!DNS[host]) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
  return DNS[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}
// the stand-in counts as public; everything else is judged for real
const allow = (ip) => ip === '127.0.0.1' || ipAllowed(ip)
// every connection goes to the stand-in's port (the links themselves are on port 80, as they must be)
const send = (u, addr, signal) => {
  const v = new URL(u)
  v.port = String(port)
  return request(v, addr, signal)
}
const get = (url, opts) => fetchPreview(url, { resolve, allow, send, ...opts })

test('a page: its preview, the image against where it ended up; the socket went to the checked address, Host kept', async () => {
  hits.length = 0
  const p = await get('http://site.test/page')
  assert.deepEqual(p, { ok: true, url: 'http://site.test/page', title: 'Stand-in & site', description: null, image: 'http://site.test/cover.jpg', icon: 'http://site.test/favicon.ico', site: null })
  assert.deepEqual(hits, [[`site.test:${port}`, '/page']])
})

test('private addresses: refused before any connection, by name, by DNS answer (any one of them), by redirect', async () => {
  hits.length = 0
  for (const url of ['http://lan.test/', 'http://mixed.test/', 'http://v6.test/', 'http://localhost/', 'http://10.10.0.217/', 'http://[::1]/', 'http://router/']) {
    assert.deepEqual(await get(url), { ok: false, reason: 'blocked' }, url)
  }
  // the real rules: even this stand-in, at 127.0.0.1, is off limits
  assert.deepEqual(await fetchPreview('http://site.test/page', { resolve, send }), { ok: false, reason: 'blocked' })
  assert.deepEqual(hits, [])
  // a redirect into the LAN: the first hop is fetched, the second never
  const away = await get(`http://site.test/away/${encodeURIComponent('http://lan.test/admin')}`)
  assert.deepEqual(away, { ok: false, reason: 'blocked' })
  assert.deepEqual(await get(`http://site.test/away/${encodeURIComponent('http://127.0.0.1/')}`), { ok: false, reason: 'blocked' })
  assert.deepEqual(await get(`http://site.test/away/${encodeURIComponent('http://site.test:8080/')}`), { ok: false, reason: 'port' })
  assert.deepEqual(await get(`http://site.test/away/${encodeURIComponent('file:///etc/passwd')}`), { ok: false, reason: 'refused' })
  assert.deepEqual(hits.map((h) => h[1]), ['/away/http%3A%2F%2Flan.test%2Fadmin', '/away/http%3A%2F%2F127.0.0.1%2F', '/away/http%3A%2F%2Fsite.test%3A8080%2F', '/away/file%3A%2F%2F%2Fetc%2Fpasswd'])
  assert.deepEqual(await get('http://nowhere.test/'), { ok: false, reason: 'unreachable' })
})

test('redirects: up to 3 followed, the 4th refused', async () => {
  assert.equal((await get('http://site.test/hop/3')).ok, true)
  assert.equal((await get('http://site.test/hop/3')).url, 'http://site.test/hop/0')
  assert.deepEqual(await get('http://site.test/hop/4'), { ok: false, reason: 'redirects' })
})

test('web pages only; a picture is its own preview; an error status is said', async () => {
  assert.deepEqual(await get('http://site.test/json'), { ok: false, reason: 'not-html' })
  const png = await get('http://site.test/png/cat-photo.png')
  assert.deepEqual([png.ok, png.image, png.title], [true, 'http://site.test/png/cat-photo.png', 'cat-photo'])
  assert.deepEqual(await get('http://site.test/missing'), { ok: false, reason: 'http', status: 404 })
})

test('time and size limits: a site that never answers, a body that never ends, a head that never ends', async () => {
  let t = Date.now()
  assert.deepEqual(await get('http://site.test/slow', { ms: 300 }), { ok: false, reason: 'timeout' })
  assert.ok(Date.now() - t < 2000)
  t = Date.now()
  const endless = await get('http://site.test/endless', { ms: 3000 })
  assert.equal(endless.title, 'Stand-in & site')
  assert.ok(Date.now() - t < 2000, 'stopped at </head>')
  t = Date.now()
  const huge = await get('http://site.test/huge', { ms: 5000, bytes: 300_000 })
  assert.deepEqual([huge.ok, huge.reason], [false, 'empty'])
  assert.ok(Date.now() - t < 4000, 'stopped at the byte limit')
})

test('gzip, and the charset the page names', async () => {
  assert.equal((await get('http://site.test/gzip')).title, 'Stand-in & site')
  assert.equal((await get('http://site.test/latin1')).title, 'Café “quoted”')
})
