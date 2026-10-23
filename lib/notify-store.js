// The notification hub's storage (lib/notify.js has the rules). Server-only: imported by app/api/notify and
// app/api/private/settings/notifications. Postgres (DATABASE_URL, the same database as settings sync): two small tables,
// created on first use. notifyStore() is the one the routes use; memoryStore() has the same behavior in memory, for
// the route tests (they set globalThis.__homeNotifyStore).
//
// What it keeps: the newest KEEP notices, none older than KEEP_DAYS, none past its ttl (pruned on every add; reads skip
// expired ones meanwhile). A notice with a tag replaces the older one with that tag: it gets a new id, so it counts as
// new (unread, a pop-up) on every device. Read state is one number per owner: everything up to that id is read.
// Two kinds share the table, each kept, read and cleared on its own: 'notice' (services: lib/notify.js) and 'agent'
// (agents' messages: lib/agents.js). A busy agent can't push the services' notices out, nor the other way round.
import { sharedPool } from './db.js'
import { toItem } from './notify.js'
import { agentItem } from './agents.js'

export const KINDS = ['notice', 'agent']
const kindOf = (k) => (k === 'agent' ? 'agent' : 'notice')
const itemOf = (kind, row) => (kind === 'agent' ? agentItem(row) : toItem(row))

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
CREATE TABLE IF NOT EXISTS notify_reads (owner text PRIMARY KEY, read_id bigint NOT NULL DEFAULT 0);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'notice';
ALTER TABLE notify_reads ADD COLUMN IF NOT EXISTS agent_read_id bigint NOT NULL DEFAULT 0;`

// the notice as stored: everything but ttl (that's expires_at) and kind (its own column)
const dataOf = ({ ttl, kind, ...rest }) => rest
const READ = { notice: 'read_id', agent: 'agent_read_id' }

export function pgStore(url = process.env.DATABASE_URL) {
  let pool = null
  let ready = null
  function db() {
    pool ??= sharedPool(url) // (lib/db.js: one pool for the whole server)
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
    // notice: lib/notify.js cleanNotice()'s, or lib/agents.js cleanAgent()'s (kind 'agent') -> { id, at }
    add: (notice) =>
      tx(async (c) => {
        const kind = kindOf(notice.kind)
        if (notice.tag) {
          // one at a time per tag, so two quick updates can't both survive
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`notify:${kind}:${notice.tag}`])
          await c.query('DELETE FROM notifications WHERE tag = $1 AND kind = $2', [notice.tag, kind])
        }
        const r = await c.query(
          `INSERT INTO notifications (expires_at, tag, kind, data) VALUES (CASE WHEN $1::int IS NULL THEN NULL ELSE now() + make_interval(secs => $1::int) END, $2, $3, $4)
           RETURNING id, created_at`,
          [notice.ttl ?? null, notice.tag ?? null, kind, dataOf(notice)],
        )
        await c.query(
          `DELETE FROM notifications WHERE (expires_at IS NOT NULL AND expires_at <= now()) OR created_at < now() - make_interval(days => $1)
             OR (kind = $3 AND id <= (SELECT id FROM notifications WHERE kind = $3 ORDER BY id DESC OFFSET $2 LIMIT 1))`,
          [KEEP_DAYS, KEEP, kind],
        )
        return { id: Number(r.rows[0].id), at: +r.rows[0].created_at }
      }),
    // -> { items: newest first, read }
    async list(owner, kind = 'notice') {
      kind = kindOf(kind)
      const p = await db()
      const [rows, reads] = await Promise.all([
        p.query('SELECT id, created_at, expires_at, data FROM notifications WHERE kind = $2 AND (expires_at IS NULL OR expires_at > now()) ORDER BY id DESC LIMIT $1', [LIST, kind]),
        p.query(`SELECT ${READ[kind]} AS read FROM notify_reads WHERE owner = $1`, [owner]),
      ])
      return { items: rows.rows.map((r) => itemOf(kind, r)).filter(Boolean), read: Number(reads.rows[0]?.read ?? 0) }
    },
    // read never goes back (two devices: the later "read up to 5" can't undo an earlier "read up to 9")
    async markRead(owner, upTo, kind = 'notice') {
      const col = READ[kindOf(kind)]
      await (await db()).query(
        `INSERT INTO notify_reads (owner, ${col}) VALUES ($1, $2) ON CONFLICT (owner) DO UPDATE SET ${col} = GREATEST(notify_reads.${col}, EXCLUDED.${col})`,
        [owner, upTo],
      )
    },
    async dismiss(id, kind = 'notice') {
      await (await db()).query('DELETE FROM notifications WHERE id = $1 AND kind = $2', [id, kindOf(kind)])
    },
    async clear(upTo, kind = 'notice') {
      await (await db()).query('DELETE FROM notifications WHERE id <= $1 AND kind = $2', [upTo, kindOf(kind)])
    },
    // the notice with this tag is out of date (a habit kept: its reminder) -> true if one went
    async dropTag(tag) {
      return (await (await db()).query("DELETE FROM notifications WHERE tag = $1 AND kind = 'notice'", [tag])).rowCount > 0
    },
  }
}

// The same, in memory (tests). now: a clock to move.
export function memoryStore(now = Date.now) {
  let rows = []
  let next = 1
  const reads = new Map() // `${kind}:${owner}` -> read up to
  const live = () => rows.filter((r) => r.exp == null || r.exp > now())
  return {
    async add(notice) {
      const at = now()
      const kind = kindOf(notice.kind)
      if (notice.tag) rows = rows.filter((r) => r.kind !== kind || r.tag !== notice.tag)
      const row = { id: next++, at, exp: notice.ttl ? at + notice.ttl * 1000 : null, tag: notice.tag ?? null, kind, data: dataOf(notice) }
      rows.push(row)
      rows = live().filter((r) => r.at >= at - KEEP_DAYS * 86400_000)
      const mine = rows.filter((r) => r.kind === kind)
      if (mine.length > KEEP) rows = rows.filter((r) => r.kind !== kind || r.id > mine.at(-KEEP - 1).id)
      return { id: row.id, at }
    },
    async list(owner, kind = 'notice') {
      kind = kindOf(kind)
      const items = live()
        .filter((r) => r.kind === kind)
        .sort((a, b) => b.id - a.id)
        .slice(0, LIST)
        .map((r) => itemOf(kind, { id: r.id, created_at: r.at, expires_at: r.exp, data: r.data }))
        .filter(Boolean)
      return { items, read: reads.get(`${kind}:${owner}`) ?? 0 }
    },
    async markRead(owner, upTo, kind = 'notice') {
      const k = `${kindOf(kind)}:${owner}`
      reads.set(k, Math.max(reads.get(k) ?? 0, upTo))
    },
    async dismiss(id, kind = 'notice') {
      rows = rows.filter((r) => r.id !== id || r.kind !== kindOf(kind))
    },
    async clear(upTo, kind = 'notice') {
      rows = rows.filter((r) => r.id > upTo || r.kind !== kindOf(kind))
    },
    async dropTag(tag) {
      const n = rows.length
      rows = rows.filter((r) => r.kind !== 'notice' || r.tag !== tag)
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
