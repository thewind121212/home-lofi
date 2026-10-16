// The owner's synced settings in Postgres (DATABASE_URL). Server-only: import it only from
// app/api/private/settings/route.js (and readDoc from the daily summaries' sender, lib/morning-summary.js: the owner's
// location and unit for their weather lines). One small table, created on first use; one row per owner.
import { sharedPool } from './db.js'
import { cleanDoc, merge } from './sync.js'

let pool = null
let ready = null
function db() {
  if (!pool) {
    pool = sharedPool() // (lib/db.js: one pool for the whole server)
  }
  ready ??= pool
    .query('CREATE TABLE IF NOT EXISTS settings (owner text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())')
    .catch((e) => {
      ready = null // try again on the next request
      throw e
    })
  return ready.then(() => pool)
}

export async function readDoc(owner) {
  const r = await (await db()).query('SELECT data FROM settings WHERE owner = $1', [owner])
  return cleanDoc(r.rows[0]?.data)
}

// Merge `incoming` into the stored doc (newer stamp wins per key) -> { doc: the result, changed: the keys it took }
// (changed: the save route tells the owner's other devices to pull, lib/live.js)
export async function writeDoc(owner, incoming) {
  const c = await (await db()).connect()
  try {
    await c.query('BEGIN')
    // create-then-lock the row, so two devices saving at the same moment merge one after the other
    await c.query("INSERT INTO settings (owner, data) VALUES ($1, '{}') ON CONFLICT (owner) DO NOTHING", [owner])
    const r = await c.query('SELECT data FROM settings WHERE owner = $1 FOR UPDATE', [owner])
    const { doc, changed } = merge(cleanDoc(r.rows[0].data), cleanDoc(incoming))
    if (changed.length) await c.query('UPDATE settings SET data = $2, updated_at = now() WHERE owner = $1', [owner, doc])
    await c.query('COMMIT')
    return { doc, changed }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
