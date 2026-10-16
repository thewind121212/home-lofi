'use client'

// A crash in the browser, told to the server's log (app/api/client-error): where it happened, the message, its stack
// (minified in production, still enough to find the component), the page and the browser. Once per message per page
// load, and never in the way: a failed report is dropped.
const sent = new Set()
// component: React's component stack, where an error boundary has it (the News modal's)
export function reportError(error, where, component) {
  try {
    const message = String(error?.message ?? error).slice(0, 500)
    if (sent.has(`${where}:${message}`)) return
    sent.add(`${where}:${message}`)
    const body = JSON.stringify({
      where,
      message,
      digest: error?.digest,
      stack: String(error?.stack ?? '').slice(0, 3000),
      component: typeof component === 'string' ? component.slice(0, 1500) : undefined,
      url: location.pathname + location.search,
      ua: navigator.userAgent,
    })
    fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch {}
}
