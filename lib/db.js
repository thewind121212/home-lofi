// The one Postgres pool this server uses (DATABASE_URL): settings sync, Habits, Pins, Reminders, Focus, the hub, push
// and News all draw from it. Each used to have its own (2–3 connections each, 17 in all), past the home_lofi role's
// limit of 10: at a busy moment, or while a deploy runs the old and the new container side by side, Postgres refused
// the rest ("too many connections for role") and the page got 503s. One pool of DB_POOL_MAX (default 4) keeps a
// deploy's two containers at 8, under the limit with room to spare.
// On globalThis: every route is its own bundle, and they must share it.
import pg from 'pg'

const MAX = Math.min(20, Math.max(1, Number.parseInt(process.env.DB_POOL_MAX ?? '', 10) || 4))

export function sharedPool(url = process.env.DATABASE_URL) {
  const pools = (globalThis.__homePgPools ??= new Map())
  let pool = pools.get(url)
  if (!pool) {
    // (a query waits for a free connection up to connectionTimeoutMillis; idle ones go back after 10 s)
    pool = new pg.Pool({ connectionString: url, max: MAX, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000 })
    pool.on('error', () => {}) // an idle connection dropping (DB restart) must not crash the server; the next query reconnects
    pools.set(url, pool)
  }
  return pool
}
