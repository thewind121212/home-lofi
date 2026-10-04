const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

export default {
  output: 'standalone',
  poweredByHeader: false,
  // dev only: lets LAN devices hit `next dev`
  allowedDevOrigins: ['10.*.*.*', '172.*.*.*', '192.168.*.*', '*.local'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
