// The notification hub's storage (lib/notify.js has the rules). Server-only: imported by app/api/notify and
// app/api/private/settings/notifications. Postgres (DATABASE_URL, the same database as settings sync): two small tables,
// created on first use. notifyStore() is the one the routes use; memoryStore() has the same behavior in memory, for
// the route tests (they set globalThis.__homeNotifyStore).
//
// What it keeps: the newest KEEP notices, none older than KEEP_DAYS, none past its ttl (pruned on every add; reads skip
// expired ones meanwhile). A notice with a tag replaces the older one with that tag: it gets a new id, so it counts as
// new (unread, a pop-up) on every device. Read state is one number per owner: everything up to that id is read.
import pg from 'pg'
import { toItem } from './notify.js'

export const KEEP = 200
export const KEEP_DAYS = 30
export const LIST = 50 // what the page gets: the newest 50 that are still alive

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  tag text,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_tag ON notifications (tag) WHERE tag IS NOT NULL;
CREATE TABLE IF NOT EXISTS notify_reads (owner text PRIMARY KEY, read_id bigint NOT NULL DEFAULT 0);`

// the notice as stored: everything but ttl (that's expires_at)
const dataOf = ({ ttl, ...rest }) => rest

export function pgStore(url = process.env.DATABASE_URL) {
  let pool = null
  let ready = null
  function db() {
    if (!pool) {
      pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 })
      pool.on('error', () => {}) // an idle connection dropping (DB restart) must not crash the server
    }
    ready ??= pool.query(SCHEMA).catch((e) => {
      ready = null // try again on the next request
      throw e
    })
    return ready.then(() => pool)
  }
  async function tx(fn) {
    const c = await (await db()).connect()
    try {
      await c.query('BEGIN')
      const out = await fn(c)
      await c.query('COMMIT')
      return out
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }
  return {
    // notice: lib/notify.js cleanNotice()'s -> { id, at }
    add: (notice) =>
      tx(async (c) => {
        if (notice.tag) {
          // one at a time per tag, so two quick updates can't both survive
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`notify:${notice.tag}`])
          await c.query('DELETE FROM notifications WHERE tag = $1', [notice.tag])
        }
        const r = await c.query(
          `INSERT INTO notifications (expires_at, tag, data) VALUES (CASE WHEN $1::int IS NULL THEN NULL ELSE now() + make_interval(secs => $1::int) END, $2, $3)
           RETURNING id, created_at`,
          [notice.ttl ?? null, notice.tag ?? null, dataOf(notice)],
        )
        await c.query(
          `DELETE FROM notifications WHERE (expires_at IS NOT NULL AND expires_at <= now()) OR created_at < now() - make_interval(days => $1)
             OR id <= (SELECT id FROM notifications ORDER BY id DESC OFFSET $2 LIMIT 1)`,
          [KEEP_DAYS, KEEP],
        )
        return { id: Number(r.rows[0].id), at: +r.rows[0].created_at }
      }),
    // -> { items: newest first, read }
    async list(owner) {
      const p = await db()
      const [rows, reads] = await Promise.all([
        p.query('SELECT id, created_at, expires_at, data FROM notifications WHERE expires_at IS NULL OR expires_at > now() ORDER BY id DESC LIMIT $1', [LIST]),
        p.query('SELECT read_id FROM notify_reads WHERE owner = $1', [owner]),
      ])
      return { items: rows.rows.map(toItem).filter(Boolean), read: Number(reads.rows[0]?.read_id ?? 0) }
    },
    // read never goes back (two devices: the later "read up to 5" can't undo an earlier "read up to 9")
    async markRead(owner, upTo) {
      await (await db()).query(
        'INSERT INTO notify_reads (owner, read_id) VALUES ($1, $2) ON CONFLICT (owner) DO UPDATE SET read_id = GREATEST(notify_reads.read_id, EXCLUDED.read_id)',
        [owner, upTo],
      )
    },
    async dismiss(id) {
      await (await db()).query('DELETE FROM notifications WHERE id = $1', [id])
    },
    async clear(upTo) {
      await (await db()).query('DELETE FROM notifications WHERE id <= $1', [upTo])
    },
    // the notice with this tag is out of date (a habit kept: its reminder) -> true if one went
    async dropTag(tag) {
      return (await (await db()).query('DELETE FROM notifications WHERE tag = $1', [tag])).rowCount > 0
    },
  }
}

// The same, in memory (tests). now: a clock to move.
export function memoryStore(now = Date.now) {
  let rows = []
  let next = 1
  const reads = new Map()
  const live = () => rows.filter((r) => r.exp == null || r.exp > now())
  return {
    async add(notice) {
      const at = now()
      if (notice.tag) rows = rows.filter((r) => r.tag !== notice.tag)
      const row = { id: next++, at, exp: notice.ttl ? at + notice.ttl * 1000 : null, tag: notice.tag ?? null, data: dataOf(notice) }
      rows.push(row)
      rows = live().filter((r) => r.at >= at - KEEP_DAYS * 86400_000).slice(-KEEP)
      return { id: row.id, at }
    },
    async list(owner) {
      const items = live()
        .sort((a, b) => b.id - a.id)
        .slice(0, LIST)
        .map((r) => toItem({ id: r.id, created_at: r.at, expires_at: r.exp, data: r.data }))
        .filter(Boolean)
      return { items, read: reads.get(owner) ?? 0 }
    },
    async markRead(owner, upTo) {
      reads.set(owner, Math.max(reads.get(owner) ?? 0, upTo))
    },
    async dismiss(id) {
      rows = rows.filter((r) => r.id !== id)
    },
    async clear(upTo) {
      rows = rows.filter((r) => r.id > upTo)
    },
    async dropTag(tag) {
      const n = rows.length
      rows = rows.filter((r) => r.tag !== tag)
      return rows.length < n
    },
    get size() {
      return rows.length
    },
  }
}

// The routes' store: one per process (globalThis: each route is its own bundle, and the sender's route and the owner's
// must share one pool)
export const notifyStore = () => (globalThis.__homeNotifyStore ??= pgStore())
