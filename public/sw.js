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

// a tap: the notice's link (http / https only), or the home page; an open window of this site is reused
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  let url = '/'
  try {
    const u = new URL(e.notification.data?.url || '/', self.location.origin)
    if (u.protocol === 'https:' || u.protocol === 'http:') url = u.href
  } catch {}
  e.waitUntil(
    (async () => {
      const here = new URL(url).origin === self.location.origin
      if (here) {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const w of wins) {
          if (new URL(w.url).origin !== self.location.origin) continue
          await w.focus()
          if (w.url !== url && 'navigate' in w) await w.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
