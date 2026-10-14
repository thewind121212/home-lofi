// The push worker (lib/push.js sends, app/push.js turns it on per device). It only shows pushes: no caching, no
// offline page, nothing else, so the site works exactly as without it. Every push shows a notification (iOS takes a
// silent push as a broken promise and stops delivering), and a tap opens the notice's link, or the home page.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { body: e.data ? e.data.text() : '' }
  }
  const title = typeof d.title === 'string' && d.title ? d.title : 'Home'
  const options = {
    body: typeof d.body === 'string' ? d.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: typeof d.url === 'string' ? d.url : '/' },
  }
  // a newer one with the same tag replaces the older on the lock screen (a reminder sent again, Claude's session)
  if (typeof d.tag === 'string' && d.tag) (options.tag = d.tag), (options.renotify = true)
  e.waitUntil(self.registration.showNotification(title, options))
})

// a tap: the notice's link (http / https only), or the home page. The home page reuses an open window of this site
// (focused); any other link opens on its own, as the inbox opens them (target=_blank), so a playing page isn't
// navigated away. Anything the browser refuses (focus, navigate) falls back to opening a window.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  let url = self.location.origin + '/'
  try {
    const u = new URL(e.notification.data?.url || '/', self.location.origin)
    if (u.protocol === 'https:' || u.protocol === 'http:') url = u.href
  } catch {}
  e.waitUntil(
    (async () => {
      if (url === self.location.origin + '/') {
        try {
          const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          const w = wins.find((c) => new URL(c.url).origin === self.location.origin)
          if (w) return void (await w.focus())
        } catch {}
      }
      await self.clients.openWindow(url)
    })(),
  )
})
