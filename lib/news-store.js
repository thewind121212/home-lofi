// News' read state (lib/news.js has the rules). Server-only: the route app/api/private/settings/news. Postgres
// (DATABASE_URL, the same database as settings sync), tables created on first use. newsStore() is the one it uses;
// memoryStore() behaves the same in memory, for the tests (they set globalThis.__homeNewsStore).
//
// What it keeps: the stories the owner has read (by the agent's id, so every device dims the same ones), for
// KEEP_DAYS: a story is long gone from the digests by then. And the newest edition the owner has opened (the dot on
// the icon is an edition newer than that).
import { sharedPool } from './db.js'

export const KEEP_DAYS = 45
export const MAX_KEPT = 3000 // ids handed to the page (the newest read)

const SCHEMA = `
CREATE TABLE IF NOT EXISTS news_reads (owner text NOT NULL, item_id text NOT NULL, read_at timestamptz NOT NULL, PRIMARY KEY (owner, item_id));
CREATE TABLE IF NOT EXISTS news_seen (owner text PRIMARY KEY, edition_at timestamptz NOT NULL);`

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
  const q = async (sql, args) => (await db()).query(sql, args)
  return {
    // -> the ids read (newest first, MAX_KEPT at most)
    async reads(owner) {
      const r = await q('SELECT item_id FROM news_reads WHERE owner = $1 ORDER BY read_at DESC LIMIT $2', [owner, MAX_KEPT])
      return r.rows.map((x) => x.item_id)
    },
    async read(owner, ids, at) {
      await q('INSERT INTO news_reads (owner, item_id, read_at) SELECT $1, unnest($2::text[]), to_timestamp($3 / 1000.0) ON CONFLICT DO NOTHING', [owner, ids, at])
    },
    async unread(owner, ids) {
      await q('DELETE FROM news_reads WHERE owner = $1 AND item_id = ANY($2::text[])', [owner, ids])
    },
    // -> the newest edition opened (ms) | null
    async seen(owner) {
      const r = await q('SELECT edition_at FROM news_seen WHERE owner = $1', [owner])
      return r.rows[0] ? +r.rows[0].edition_at : null
    },
    // (only ever forward: an old edition opened from the archive doesn't bring the dot back)
    async setSeen(owner, at) {
      await q(
        'INSERT INTO news_seen (owner, edition_at) VALUES ($1, to_timestamp($2 / 1000.0)) ON CONFLICT (owner) DO UPDATE SET edition_at = GREATEST(news_seen.edition_at, EXCLUDED.edition_at)',
        [owner, at],
      )
    },
    async prune(owner) {
      await q('DELETE FROM news_reads WHERE owner = $1 AND read_at < now() - make_interval(days => $2)', [owner, KEEP_DAYS])
    },
  }
}

// The same, in memory (tests)
export function memoryStore() {
  const reads = new Map() // owner -> Map(id -> at)
  const seen = new Map() // owner -> ms
  const mine = (owner) => (reads.has(owner) ? reads.get(owner) : reads.set(owner, new Map()).get(owner))
  return {
    async reads(owner) {
      return [...mine(owner)].sort((a, b) => b[1] - a[1]).slice(0, MAX_KEPT).map(([id]) => id)
    },
    async read(owner, ids, at) {
      for (const id of ids) if (!mine(owner).has(id)) mine(owner).set(id, at)
    },
    async unread(owner, ids) {
      for (const id of ids) mine(owner).delete(id)
    },
    async seen(owner) {
      return seen.get(owner) ?? null
    },
    async setSeen(owner, at) {
      seen.set(owner, Math.max(seen.get(owner) ?? 0, at))
    },
    async prune(owner, now = Date.now()) {
      for (const [id, at] of mine(owner)) if (at < now - KEEP_DAYS * 86_400_000) mine(owner).delete(id)
    },
  }
}

export const newsStore = () => (globalThis.__homeNewsStore ??= pgStore())
