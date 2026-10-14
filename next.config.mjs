const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

export default {
  output: 'standalone',
  // the radio's YouTube client (lib/youtube.js): plain Node require on the server, not bundled
  // undici: TAVARIAN_PROXY's ProxyAgent (lib/tavarian.js), also plain Node; web-push (lib/push.js): Node crypto + https
  serverExternalPackages: ['youtubei.js', 'undici', 'web-push'],
  poweredByHeader: false,
  // dev only: lets LAN devices hit `next dev`
  allowedDevOrigins: ['10.*.*.*', '172.*.*.*', '192.168.*.*', '*.local'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // the push worker (public/sw.js): always the newest (a browser checks it on every visit anyway), whole-site scope
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Content-Type', value: 'application/javascript; charset=utf-8' }] },
    ]
  },
}
