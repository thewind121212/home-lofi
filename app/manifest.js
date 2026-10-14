// The web app manifest (Next: app/manifest.js -> /manifest.webmanifest): what "Add to Home Screen" installs. On an
// iPhone the Home Screen app is also what can get push notifications (iOS 16.4+, app/push.js); from iOS 26 every
// site added to the Home Screen opens as a web app.
export default function manifest() {
  return {
    name: 'Linh Homelab',
    short_name: 'Home',
    description: 'A lofi home page.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1a1a2e',
    theme_color: '#1a1a2e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
