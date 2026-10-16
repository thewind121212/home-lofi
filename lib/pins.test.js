// Pins' pure rules (lib/pins.js): which links are kept, which may be fetched (the SSRF fence), the page's head ->
// its preview, and the card's search.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX, MAX_HTML, cleanTarget, linkedTo, absUrl, safeLink, canUndo, cleanAction, cleanText, cleanUrl, decodeEntities, domainOf, fetchable, fold, ipAllowed, looksLikeLink, matches, parseHead, UNDO_MS } from './pins.js'

test('ipAllowed: public unicast only, IPv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.128.0.1', '172.15.255.255', '11.0.0.1', '223.255.255.254']) assert.equal(ipAllowed(ip), true, ip)
  for (const ip of [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.10.0.217', '10.255.255.255', '127.0.0.1', '127.1.2.3', '172.16.0.1', '172.19.0.87', '172.31.255.255',
    '192.168.1.1', '100.64.0.1', '100.127.255.255', '169.254.169.254', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.19.255.255', '198.51.100.7',
    '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  ]) assert.equal(ipAllowed(ip), false, ip)
})

test('ipAllowed: IPv6, the IPv4 inside a mapped / NAT64 one judged as that IPv4, junk refused', () => {
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '[2606:4700::1]', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '::ffff:808:808']) assert.equal(ipAllowed(ip), true, ip)
  for (const ip of [
    '::', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:10.10.0.217', '::ffff:7f00:1', '::ffff:c0a8:101', '64:ff9b::10.0.0.1', '64:ff9b:1::1',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fec0::1', 'ff02::1', 'ff05::2', '::127.0.0.1', '::ffff:0:10.0.0.1', '100::1',
    '2001::1', '2001:db8::1', '2002:c0a8:101::1', '3fff::1',
  ]) assert.equal(ipAllowed(ip), false, ip)
  for (const junk of ['', 'example.com', '1.2.3', '1.2.3.256', '01.2.3.4.5', '1::2::3', '1:2:3:4:5:6:7:8:9', 'g::1', '::ffff:1.2.3.999', null, 42]) assert.equal(ipAllowed(junk), false, String(junk))
})

test('cleanUrl: http(s) with a host, no user / password, not too long; bare domains become https; tracking tags go', () => {
  assert.deepEqual(cleanUrl('  https://github.com  '), { url: 'https://github.com/' })
  assert.deepEqual(cleanUrl('github.com/vercel/next.js'), { url: 'https://github.com/vercel/next.js' })
  assert.deepEqual(cleanUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk&utm_source=x&si=abc&fbclid=1'), { url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' })
  assert.deepEqual(cleanUrl('https://EXAMPLE.com:443/a#'), { url: 'https://example.com/a' })
  assert.deepEqual(cleanUrl('https://example.com/a#part'), { url: 'https://example.com/a#part' })
  // a LAN link is kept (it just isn't fetched: fetchable)
  assert.deepEqual(cleanUrl('http://10.10.0.217:5001/'), { url: 'http://10.10.0.217:5001/' })
  for (const bad of ['', '   ', 'hello world', 'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com/', 'mailto:a@b.c', 'https://user:pw@example.com/', 'https://user@example.com/', `https://example.com/${'a'.repeat(2048)}`, null, 5, {}]) {
    const c = cleanUrl(bad)
    assert.equal(c.field, 'url', String(bad).slice(0, 40))
    assert.match(c.error, /^url: /)
  }
})

test('fetchable: the default port, a public name or address; else why not', () => {
  const f = (s) => fetchable(new URL(s))
  assert.equal(f('https://github.com/'), null)
  assert.equal(f('http://93.184.216.34/'), null)
  assert.equal(f('http://[2606:4700::1111]/'), null)
  assert.equal(f('https://example.com:8443/'), 'port')
  for (const s of [
    'http://10.10.0.217:5001/', 'http://127.0.0.1:3996/', 'http://localhost/', 'http://app.localhost/', 'http://[::1]/', 'http://[::ffff:10.0.0.1]/',
    'http://0x7f.1/', 'http://2130706433/', 'http://017700000001/', 'http://router/', 'http://nas.local/', 'http://printer.lan/', 'http://x.home.arpa/',
    'http://169.254.169.254/latest/meta-data/', 'http://0/', 'http://[fe80::1]/',
  ]) assert.equal(f(s), 'blocked', s)
  assert.equal(f('ftp://example.com/'), 'refused')
  assert.equal(f('https://u:p@example.com/'), 'refused')
})

test('looksLikeLink: the box pins only what is surely a link; anything else is a search', () => {
  for (const s of ['https://github.com', 'http://x.y/z', 'www.example.com', '  https://a.b/c  ']) assert.equal(looksLikeLink(s), true, s)
  for (const s of ['github', 'github.com', 'lofi hip hop', 'https://a b', '', null]) assert.equal(looksLikeLink(s), false, String(s))
  assert.equal(domainOf('https://www.github.com/x'), 'github.com')
  assert.equal(domainOf('nope'), '')
})

test('decodeEntities / cleanText: entities, tags, control characters, length (never half a character)', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#x2019; &hellip; &nbsp;'), 'Tom & Jerry <3 "hi" \'x\' ’ …  ')
  assert.equal(decodeEntities('&unknown; &AMP; &amp &#0; &#xD800; &#x1F3B5;'), '&unknown; &AMP; &amp � � 🎵')
  assert.equal(cleanText('  a\n\tb  <b>bold</b>\u0000 ', 50), 'a b bold')
  assert.equal(cleanText('&lt;script&gt;x&lt;/script&gt;', 50), 'x')
  assert.equal(cleanText('', 10), null)
  assert.equal(cleanText(5, 10), null)
  assert.equal(cleanText('🎵'.repeat(10), 5), '🎵🎵🎵🎵…')
  assert.equal(cleanText('x'.repeat(500), MAX.description).length, MAX.description)
})

test('absUrl: against the page, http(s) only', () => {
  assert.equal(absUrl('/img/a.png', 'https://ex.com/p/q'), 'https://ex.com/img/a.png')
  assert.equal(absUrl('b.png', 'https://ex.com/p/q'), 'https://ex.com/p/b.png')
  assert.equal(absUrl('//cdn.ex.com/c.png', 'https://ex.com/'), 'https://cdn.ex.com/c.png')
  assert.equal(absUrl('/a.png?x=1&amp;y=2', 'https://ex.com/'), 'https://ex.com/a.png?x=1&y=2')
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://u:p@ex.com/a.png', '', '   ', null]) assert.equal(absUrl(bad, 'https://ex.com/'), null, String(bad))
})

const PAGE = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Plain title</title>
<!-- <meta property="og:title" content="in a comment"> -->
<script>var s = '<meta property="og:title" content="in a script">'</script>
<meta property="og:title" content="Lofi &amp; chill &#8212; beats">
<meta name="twitter:title" content="Twitter title">
<meta property=og:description content='Beats to relax &quot;and&quot; study to'>
<meta name="description" content="Plain description">
<meta property="og:image" content="/img/cover.jpg?w=1200&amp;h=630">
<meta property="og:site_name" content="Lofi Girl">
<link rel="icon" href="/favicon-16.png" sizes="16x16">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple.png">
</head><body><meta property="og:image" content="/in-body.jpg"><title>svg title</title></body></html>`

test('parseHead: Open Graph first, entities decoded, relative links resolved; comments, scripts and the body ignored', () => {
  assert.deepEqual(parseHead(PAGE, 'https://lofi.example/watch?v=1'), {
    title: 'Lofi & chill — beats',
    description: 'Beats to relax "and" study to',
    image: 'https://lofi.example/img/cover.jpg?w=1200&h=630',
    icon: 'https://lofi.example/apple.png',
    site: 'Lofi Girl',
  })
})

test('parseHead: the fallbacks (Twitter card, <title>, meta description, image_src, /favicon.ico), <base>', () => {
  const tw = parseHead('<head><meta name="twitter:title" content="TW"><meta name="twitter:image:src" content="https://cdn.x/t.png"><title>T</title></head>', 'https://x.example/a')
  assert.deepEqual([tw.title, tw.image, tw.icon], ['TW', 'https://cdn.x/t.png', 'https://x.example/favicon.ico'])
  const plain = parseHead('<HTML><HEAD><TITLE> Just a\n  title </TITLE><META NAME="Description" CONTENT="desc here"><link rel="image_src" href="pic.png"><LINK REL="shortcut icon" HREF="/fav.ico"></HEAD>', 'https://y.example/dir/page')
  assert.deepEqual(plain, { title: 'Just a title', description: 'desc here', image: 'https://y.example/dir/pic.png', icon: 'https://y.example/fav.ico', site: null })
  const based = parseHead('<head><base href="https://cdn.example/assets/"><meta property="og:image" content="hero.jpg"><link rel=icon href="i.svg"></head>', 'https://z.example/')
  assert.deepEqual([based.image, based.icon], ['https://cdn.example/assets/hero.jpg', 'https://cdn.example/assets/i.svg'])
  // og:image as a data: URI or javascript: is dropped; the twitter one stands
  const bad = parseHead('<meta property="og:image" content="data:image/png;base64,AAAA"><meta property="og:image" content="javascript:x"><meta name="twitter:image" content="/tw.png">', 'https://w.example/')
  assert.equal(bad.image, 'https://w.example/tw.png')
})

test('parseHead: junk and broken HTML give nulls, never a throw', () => {
  for (const junk of ['', null, undefined, 42, '<', '<meta', '<meta content=">', '<title>never closed', '<<<>>>', '\u0000\u0001', '<meta property="og:title" content="a > b">']) {
    const p = parseHead(junk, 'https://j.example/')
    assert.equal(typeof p, 'object')
    assert.equal(p.icon, 'https://j.example/favicon.ico')
  }
  assert.equal(parseHead('<meta property="og:title" content="a > b">', 'https://j.example/').title, 'a > b')
  // attributes in any order, single / double / no quotes, a self-closing slash, a duplicate key (the first wins)
  const p = parseHead(`<meta content="C1" property="og:title"/><meta property='og:title' content='C2'><meta name=description content=plain>`, 'https://j.example/')
  assert.deepEqual([p.title, p.description], ['C1', 'plain'])
  // long ones are cut
  const long = parseHead(`<title>${'t'.repeat(500)}</title><meta name="description" content="${'d'.repeat(900)}">`, 'https://j.example/')
  assert.equal(long.title.length, MAX.title)
  assert.equal(long.description.length, MAX.description)
  // a huge page: only the start is looked at
  assert.equal(parseHead(`<head>${' '.repeat(2_000_000)}<title>late</title>`, 'https://j.example/').title, null)
})

test('cleanAction: add (the default), refresh, undo', () => {
  assert.deepEqual(cleanAction({ url: 'github.com' }), { act: { action: 'add', url: 'https://github.com/' } })
  assert.deepEqual(cleanAction({ action: 'refresh', id: 'abcdef123456' }), { act: { action: 'refresh', id: 'abcdef123456' } })
  assert.equal(cleanAction({ action: 'undo', id: 'NOPE!' }).field, 'id')
  assert.equal(cleanAction({ action: 'explode' }).field, 'action')
  assert.equal(cleanAction({ url: 'javascript:alert(1)' }).field, 'url')
  for (const b of [null, [], 'x']) assert.equal(cleanAction(b).field, null)
})

test('canUndo: right after (server clock), not later, not before', () => {
  assert.equal(canUndo(1000, 1000 + UNDO_MS), true)
  assert.equal(canUndo(1000, 1000 + UNDO_MS + 6000), false)
  assert.equal(canUndo(1000, 900), false)
  assert.equal(canUndo(null, 1000), false)
})

test('search: every word somewhere; no case, no accents (đ too)', () => {
  const pin = { title: 'Đà Lạt trip — Café list', description: 'Where to eat in the highlands', url: 'https://maps.example.com/list/42', domain: 'maps.example.com', site: 'Maps' }
  assert.equal(fold('ĐÀ LẠT Crème'), 'da lat creme')
  for (const q of ['', '  ', 'da lat', 'DA', 'cafe', 'café', 'highlands eat', 'maps.example', 'list/42', 'MAPS']) assert.equal(matches(pin, q), true, q)
  for (const q of ['saigon', 'da saigon', 'github']) assert.equal(matches(pin, q), false, q)
  assert.equal(matches({ url: 'https://x.y/', domain: 'x.y', title: null, description: null }, 'x.y'), true)
})

test('parseHead: YouTube\'s maxresdefault (often missing) becomes hqdefault (always there)', () => {
  const yt = (img) => parseHead(`<meta property="og:image" content="${img}">`, 'https://www.youtube.com/watch?v=jfKfPfyJRdk').image
  assert.equal(yt('https://i.ytimg.com/vi/jfKfPfyJRdk/maxresdefault.jpg?v=6911ace0'), 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg?v=6911ace0')
  assert.equal(yt('https://i.ytimg.com/vi_webp/abc-_1/maxresdefault.webp'), 'https://i.ytimg.com/vi_webp/abc-_1/hqdefault.webp')
  assert.equal(yt('https://example.com/vi/x/maxresdefault.jpg'), 'https://example.com/vi/x/maxresdefault.jpg')
})

test('parseHead: hostile HTML (1.5 MB of tags left open) is one quick pass, not minutes of the event loop', () => {
  for (const unit of ['<meta ', '<script ', '<link a="b" ', '<title>', '<!--', '<meta a="', '</', '<a<b<c', '<style></styl', 'a= <meta ']) {
    const html = unit.repeat(Math.ceil(1_500_000 / unit.length))
    const t = performance.now()
    const p = parseHead(html, 'https://x.example/')
    const ms = performance.now() - t
    assert.equal(typeof p, 'object')
    assert.ok(ms < 200, `${JSON.stringify(unit)}: ${ms.toFixed(0)} ms`)
  }
  assert.ok(MAX_HTML >= 1_000_000) // (YouTube's head is ~780 KB: its og:title comes after that)
  // and a real head after a big (closed) attribute still comes through
  assert.equal(parseHead(`<head><meta name="x" content="${'x'.repeat(100_000)}"><title>T</title></head>`, 'https://x.example/').title, 'T')
  // tags, titles and scripts left open: what came before them stands
  assert.equal(parseHead('<head><meta property="og:title" content="Before"><meta name="x', 'https://x.example/').title, 'Before')
  assert.equal(parseHead('<head><title>Real</title><script>var a = "<title>no</title>"', 'https://x.example/').title, 'Real')
  assert.equal(parseHead('<head><TITLE>Upper</Title ><body><title>body</title>', 'https://x.example/').title, 'Upper')
})

test('safeLink: pictures and icons only where a fetch could go (the owner\'s browser loads them, inside the LAN)', () => {
  assert.equal(safeLink('/a.png', 'https://ex.com/p'), 'https://ex.com/a.png')
  assert.equal(safeLink('https://cdn.ex.com/a.png', 'https://ex.com/'), 'https://cdn.ex.com/a.png')
  for (const bad of ['http://10.0.0.1/cgi-bin/reboot', 'http://192.168.1.1/x.png', 'http://[::1]/x.png', 'http://localhost/x.png', 'http://router/x.png',
    'http://nas.local/x.png', 'https://ex.com:8443/x.png', 'https://u:p@ex.com/x.png', 'http://169.254.169.254/latest', 'javascript:alert(1)']) {
    assert.equal(safeLink(bad, 'https://ex.com/'), null, bad)
  }
  // a page on the LAN (kept, never fetched) gives no favicon guess either
  assert.equal(parseHead('', 'http://10.10.0.217/').icon, null)
})

test('cleanUrl: the tracking tags go, the rest of the query stays byte for byte', () => {
  assert.deepEqual(cleanUrl('https://ex.com/s?q=a%20b&flag&utm_source=x&x=1+2'), { url: 'https://ex.com/s?q=a%20b&flag&x=1+2' })
  assert.deepEqual(cleanUrl('https://ex.com/s?q=a%20b&flag'), { url: 'https://ex.com/s?q=a%20b&flag' })
  assert.deepEqual(cleanUrl('https://ex.com/s?utm_source=x&fbclid=y'), { url: 'https://ex.com/s' })
  assert.deepEqual(cleanUrl('https://ex.com/s?utm%5Fsource=x&a=1#h'), { url: 'https://ex.com/s?a=1#h' })
  assert.deepEqual(cleanUrl('https://ex.com/s?%E9=1&si=2'), { url: 'https://ex.com/s?%E9=1' })
})

test('cleanAction: link / unlink need a pin and a target; an add may carry one', () => {
  const to = { kind: 'todo', id: 'abcdef123456' }
  assert.deepEqual(cleanAction({ action: 'link', id: 'abcdef123456', to: { ...to, extra: 1 } }), { act: { action: 'link', id: 'abcdef123456', to } })
  assert.deepEqual(cleanAction({ action: 'unlink', id: 'abcdef123456', to }), { act: { action: 'unlink', id: 'abcdef123456', to } })
  assert.deepEqual(cleanAction({ url: 'github.com', to }), { act: { action: 'add', url: 'https://github.com/', to } })
  assert.equal(cleanAction({ action: 'link', id: 'abcdef123456' }).field, 'to')
  assert.equal(cleanAction({ url: 'github.com', to: { kind: 'todo' } }).field, 'to')
  assert.equal(cleanAction({ action: 'unlink', id: 'x', to }).field, 'id')
})

test('cleanTarget / linkedTo: habits and reminders only; a target\'s pins in the order they were linked, kept ones only', () => {
  assert.deepEqual(cleanTarget({ kind: 'habit', id: 'h1abcdef' }), { kind: 'habit', id: 'h1abcdef' })
  for (const t of [null, [], 'x', { kind: 'pin', id: 'abcdef12' }, { kind: 'todo', id: 'ab' }, { kind: 'todo', id: 'ABCDEF12' }]) assert.equal(cleanTarget(t), false)
  const pins = [{ id: 'p1' }, { id: 'p2' }]
  const links = [{ pin: 'p2', kind: 'habit', id: 'h', at: 1 }, { pin: 'p1', kind: 'habit', id: 'h', at: 3 }, { pin: 'gone', kind: 'habit', id: 'h', at: 2 }, { pin: 'p1', kind: 'todo', id: 'h', at: 0 }]
  assert.deepEqual(linkedTo(links, pins, 'habit', 'h').map((p) => p.id), ['p2', 'p1'])
  assert.deepEqual(linkedTo(undefined, pins, 'habit', 'h'), [])
})
