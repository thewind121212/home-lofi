// The private panel's answer to one /api/private poll (app/page.js usePrivate). No React here, so node:test checks it.
// 'ok' (200), 'locked' (a real no: the login redirect (opaqueredirect / 3xx), 401, 403, or 404 = not through the
// proxy's location / not set up), else 'retry' (a passing failure: 5xx while the app restarts for a deploy, 429, 0 = no
// network or a timeout) — those keep the last stats and ask again.
export function privateAnswer(status, type) {
  if (type === 'opaqueredirect' || (status >= 300 && status < 400)) return 'locked'
  if (status === 200) return 'ok'
  if (status === 401 || status === 403 || status === 404) return 'locked'
  return 'retry'
}

// the wait before asking again after `fails` passing failures in a row: 5 s, 10 s, 20 s… up to a minute
export const retryIn = (fails) => Math.min(60_000, 5000 * 2 ** Math.max(0, fails - 1))
