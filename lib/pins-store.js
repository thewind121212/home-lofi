// Pins' storage (lib/pins.js has the rules). Server-only: imported by app/api/private/settings/pins. Postgres
// (DATABASE_URL, the same database as settings sync), the table created on first use. pinsStore() is the one the route
// uses; memoryStore() behaves the same in memory, for the route tests (they set globalThis.__homePinsStore).
//
// One row per link and owner: the link as kept, its preview (data: { title, description, image, icon, site, ok,
// reason }), when it was added (or last pasted again: the top of the list) and, once removed, when. A removed pin
// stays a little while for its Undo; pasting the same link again brings it back with a fresh preview.
// pin_links: which pins are on which habit / reminder (lib/pins.js cleanTarget). A removed pin's links wait for its
// Undo; the pin pasted again later starts with none, and they're cleared with the row. (MAX_LINKS is a soft cap: an
// Undo puts a pin back on a target even if it has filled up meanwhile)
import { sharedPool } from './db.js'
import { MAX_PINS } from './pins.js'

export const KEEP_REMOVED = 86_400_000 // removed pins are cleared out after a day (only the Undo needs them)

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pins (
  owner text NOT NULL,
  id text NOT NULL,
  url text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (owner, id),
  UNIQUE (owner, url)
);
CREATE TABLE IF NOT EXISTS pin_links (
  owner text NOT NULL,
  pin_id text NOT NULL,
  kind text NOT NULL,
  target text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, pin_id, kind, target)
);`

const toPin = (r) => ({ id: r.id, url: r.url, addedAt: +r.added_at, removedAt: r.removed_at == null ? null : +r.removed_at, data: r.data ?? {} })
const ms = (v) => `to_timestamp(${v} / 1000.0)`

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
  const COLS = 'id, url, data, added_at, removed_at'
  return {
    // the pins kept (not removed), newest first
    async list(owner) {
      const r = await q(`SELECT ${COLS} FROM pins WHERE owner = $1 AND removed_at IS NULL ORDER BY added_at DESC, id DESC LIMIT $2`, [owner, MAX_PINS])
      return r.rows.map(toPin)
    },
    async get(owner, id) {
      const r = await q(`SELECT ${COLS} FROM pins WHERE owner = $1 AND id = $2`, [owner, id])
      return r.rows[0] ? toPin(r.rows[0]) : null
    },
    async byUrl(owner, link) {
      const r = await q(`SELECT ${COLS} FROM pins WHERE owner = $1 AND url = $2`, [owner, link])
      return r.rows[0] ? toPin(r.rows[0]) : null
    },
    // a new pin, or the same link (removed, or pasted twice at once) back on top with this preview -> the pin's id (the
    // old one's, for the same link), or null: MAX_PINS are kept already. Count and insert under the owner's lock: two
    // adds at once (each seeing 499 in a plain statement) go one after the other, so the cap truly holds
    put: (owner, { id, url: link, data, at }) =>
      tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pins:${owner}`])
        const n = (await c.query('SELECT count(*)::int AS n FROM pins WHERE owner = $1 AND removed_at IS NULL AND url <> $2', [owner, link])).rows[0].n
        if (n >= MAX_PINS) return null
        // (a removed one pasted again comes back as new: off what it was linked to. Only its Undo puts those back)
        await c.query('DELETE FROM pin_links WHERE owner = $1 AND pin_id IN (SELECT id FROM pins WHERE owner = $1 AND url = $2 AND removed_at IS NOT NULL)', [owner, link])
        const r = await c.query(
          `INSERT INTO pins (owner, id, url, data, added_at) VALUES ($1, $2, $3, $4, ${ms('$5')})
           ON CONFLICT (owner, url) DO UPDATE SET data = EXCLUDED.data, added_at = EXCLUDED.added_at, removed_at = NULL
           RETURNING id`,
          [owner, id, link, data, at],
        )
        return r.rows[0].id
      }),
    // a kept pin back on top (its link pasted again)
    async bump(owner, id, at) {
      return (await q(`UPDATE pins SET added_at = ${ms('$3')} WHERE owner = $1 AND id = $2 AND removed_at IS NULL`, [owner, id, at])).rowCount > 0
    },
    async setData(owner, id, data) {
      return (await q('UPDATE pins SET data = $3 WHERE owner = $1 AND id = $2 AND removed_at IS NULL', [owner, id, data])).rowCount > 0
    },
    async remove(owner, id, at) {
      return (await q(`UPDATE pins SET removed_at = ${ms('$3')} WHERE owner = $1 AND id = $2 AND removed_at IS NULL`, [owner, id, at])).rowCount > 0
    },
    // the Undo: only the removal it saw (the same moment), so a pin removed again, or pasted back meanwhile, is left be
    async restore(owner, id, removedAt) {
      return (await q(`UPDATE pins SET removed_at = NULL WHERE owner = $1 AND id = $2 AND removed_at = ${ms('$3')}`, [owner, id, removedAt])).rowCount > 0
    },
    async prune(owner, before) {
      await q(`DELETE FROM pins WHERE owner = $1 AND removed_at < ${ms('$2')}`, [owner, before])
      await q('DELETE FROM pin_links l WHERE owner = $1 AND NOT EXISTS (SELECT 1 FROM pins p WHERE p.owner = l.owner AND p.id = l.pin_id)', [owner])
      // and the ones on reminders done (past their Undo, a day to be sure) or deleted. (Reminders' table is made by its
      // own route: none yet, nothing to clear)
      await q(
        `DELETE FROM pin_links l WHERE owner = $1 AND kind = 'todo'
         AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.owner = l.owner AND r.id = l.target AND (r.done_at IS NULL OR r.done_at > now() - interval '1 day'))`,
        [owner],
      ).catch(() => {})
    },
    // the kept pins' links -> [{ pin, kind, id, at }]
    async links(owner) {
      const r = await q(
        `SELECT l.pin_id, l.kind, l.target, l.linked_at FROM pin_links l JOIN pins p ON p.owner = l.owner AND p.id = l.pin_id
         WHERE l.owner = $1 AND p.removed_at IS NULL ORDER BY l.linked_at, l.pin_id`,
        [owner],
      )
      return r.rows.map((x) => ({ pin: x.pin_id, kind: x.kind, id: x.target, at: +x.linked_at }))
    },
    // a kept pin onto a habit / reminder -> 'ok' (now, or already), 'gone' (no such pin), 'full' (max on it already).
    // Under the owner's lock, like put: two at once can't both slip under the cap
    link: (owner, pin, { kind, id }, at, max) =>
      tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pins:${owner}`])
        if (!(await c.query('SELECT 1 FROM pins WHERE owner = $1 AND id = $2 AND removed_at IS NULL', [owner, pin])).rowCount) return 'gone'
        if ((await c.query('SELECT 1 FROM pin_links WHERE owner = $1 AND pin_id = $2 AND kind = $3 AND target = $4', [owner, pin, kind, id])).rowCount) return 'ok'
        const n = (await c.query(
          'SELECT count(*)::int AS n FROM pin_links l JOIN pins p ON p.owner = l.owner AND p.id = l.pin_id WHERE l.owner = $1 AND l.kind = $2 AND l.target = $3 AND p.removed_at IS NULL',
          [owner, kind, id],
        )).rows[0].n
        if (n >= max) return 'full'
        await c.query(`INSERT INTO pin_links (owner, pin_id, kind, target, linked_at) VALUES ($1, $2, $3, $4, ${ms('$5')})`, [owner, pin, kind, id, at])
        return 'ok'
      }),
    async unlink(owner, pin, { kind, id }) {
      return (await q('DELETE FROM pin_links WHERE owner = $1 AND pin_id = $2 AND kind = $3 AND target = $4', [owner, pin, kind, id])).rowCount > 0
    },
  }
}

// The same, in memory (tests)
export function memoryStore() {
  const rows = new Map() // `${owner} ${id}` -> { owner, id, url, data, addedAt, removedAt }
  const links = new Map() // `${owner} ${pin} ${kind} ${target}` -> { owner, pin, kind, id, at }
  const kept = (owner, pin) => rows.get(`${owner} ${pin}`)?.removedAt === null
  const mine = (owner) => [...rows.values()].filter((r) => r.owner === owner)
  const out = (r) => ({ id: r.id, url: r.url, addedAt: r.addedAt, removedAt: r.removedAt, data: structuredClone(r.data) })
  return {
    async list(owner) {
      return mine(owner)
        .filter((r) => r.removedAt == null)
        .sort((a, b) => b.addedAt - a.addedAt || (a.id < b.id ? 1 : -1))
        .slice(0, MAX_PINS)
        .map(out)
    },
    async get(owner, id) {
      const r = rows.get(`${owner} ${id}`)
      return r ? out(r) : null
    },
    async byUrl(owner, link) {
      const r = mine(owner).find((x) => x.url === link)
      return r ? out(r) : null
    },
    async put(owner, { id, url: link, data, at }) {
      if (mine(owner).filter((r) => r.removedAt == null && r.url !== link).length >= MAX_PINS) return null
      const old = mine(owner).find((x) => x.url === link)
      if (old?.removedAt != null) for (const [k, l] of links) if (l.owner === owner && l.pin === old.id) links.delete(k)
      if (old) return Object.assign(old, { data: structuredClone(data), addedAt: at, removedAt: null }).id
      rows.set(`${owner} ${id}`, { owner, id, url: link, data: structuredClone(data), addedAt: at, removedAt: null })
      return id
    },
    async bump(owner, id, at) {
      const r = rows.get(`${owner} ${id}`)
      if (!r || r.removedAt != null) return false
      r.addedAt = at
      return true
    },
    async setData(owner, id, data) {
      const r = rows.get(`${owner} ${id}`)
      if (!r || r.removedAt != null) return false
      r.data = structuredClone(data)
      return true
    },
    async remove(owner, id, at) {
      const r = rows.get(`${owner} ${id}`)
      if (!r || r.removedAt != null) return false
      r.removedAt = at
      return true
    },
    async restore(owner, id, removedAt) {
      const r = rows.get(`${owner} ${id}`)
      if (!r || r.removedAt == null || r.removedAt !== removedAt) return false
      r.removedAt = null
      return true
    },
    async prune(owner, before) {
      for (const [k, r] of rows) if (r.owner === owner && r.removedAt != null && r.removedAt < before) rows.delete(k)
      for (const [k, l] of links) if (l.owner === owner && !rows.has(`${owner} ${l.pin}`)) links.delete(k)
    },
    async links(owner) {
      return [...links.values()].filter((l) => l.owner === owner && kept(owner, l.pin)).sort((a, b) => a.at - b.at || (a.pin < b.pin ? -1 : 1)).map(({ pin, kind, id, at }) => ({ pin, kind, id, at }))
    },
    async link(owner, pin, { kind, id }, at, max) {
      if (!kept(owner, pin)) return 'gone'
      const k = `${owner} ${pin} ${kind} ${id}`
      if (links.has(k)) return 'ok'
      if ([...links.values()].filter((l) => l.owner === owner && l.kind === kind && l.id === id && kept(owner, l.pin)).length >= max) return 'full'
      links.set(k, { owner, pin, kind, id, at })
      return 'ok'
    },
    async unlink(owner, pin, { kind, id }) {
      return links.delete(`${owner} ${pin} ${kind} ${id}`)
    },
  }
}

// The route's store: one per process (globalThis: each route is its own bundle)
export const pinsStore = () => (globalThis.__homePinsStore ??= pgStore())
