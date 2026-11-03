const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // microphone: this page's own (Talk to Jade, app/jade.js), no frame's
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
]

export default {
  output: 'standalone',
  // the radio's YouTube client (lib/youtube.js): plain Node require on the server, not bundled
  // undici: TAVARIAN_PROXY's ProxyAgent (lib/tavarian.js), also plain Node; web-push (lib/push.js): Node crypto + https
  // ws + opusscript (lib/jade-relay.js, Talk to Jade): an outgoing WebSocket with our own headers, and libopus in WASM
  // (opusscript reads its .wasm next to itself at runtime)
  serverExternalPackages: ['youtubei.js', 'undici', 'web-push', 'ws', 'opusscript'],
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
