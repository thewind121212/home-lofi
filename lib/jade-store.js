// Talk to Jade's history (app/jade.js): each turn the page relayed (lib/jade-relay.js), kept so the sheet opens on the
// conversation so far, the same on the phone and the laptop. Server-only: the route (app/api/private/settings/jade).
// Postgres (DATABASE_URL, the same database as Pins and Habits), the table created on first use. jadeStore() is the one
// the route uses (null without a database: no history, the sheet still works); memoryStore() behaves the same in
// memory, for the tests (they set globalThis.__homeJadeStore).
// Only this page's turns: what Jade hears from the ESP32 or the iPhone never comes through here.
//
// A turn: { id, at (ms), via: 'voice' | 'text', me (what Linh said or typed), jade (her answer, joined; '' = none),
// emoji }. Written once, when the turn ends, before the page hears it's over (so a sheet opened again at once has it).
import { sharedPool } from './db.js'

export const KEEP = 2000 // turns kept per owner: older ones go
export const PAGE = 30 // turns a page of history (the route's default)
export const PAGE_MAX = 100

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jade_turns (id bigserial PRIMARY KEY, owner text NOT NULL, at timestamptz NOT NULL DEFAULT now(), via text NOT NULL, me text NOT NULL, jade text NOT NULL DEFAULT '', emoji text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS jade_turns_owner_id ON jade_turns (owner, id DESC);`

const row = (r) => ({ id: Number(r.id), at: new Date(r.at).getTime(), via: r.via, me: r.me, jade: r.jade, emoji: r.emoji })

export function pgStore(url = process.env.DATABASE_URL) {
  let pool = null
  let ready = null
  let adds = 0
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
    // a finished turn -> its id
    async add(owner, { via, me, jade = '', emoji = '' }) {
      const r = await q('INSERT INTO jade_turns (owner, via, me, jade, emoji) VALUES ($1, $2, $3, $4, $5) RETURNING id', [owner, via, me, jade, emoji])
      // (now and then: past KEEP, the oldest go)
      if (++adds % 50 === 1) await q('DELETE FROM jade_turns WHERE owner = $1 AND id <= (SELECT id FROM jade_turns WHERE owner = $1 ORDER BY id DESC OFFSET $2 LIMIT 1)', [owner, KEEP]).catch(() => {})
      return Number(r.rows[0].id)
    },
    // the newest turns (before an id: the ones older than it), newest first -> { turns, more }
    async list(owner, { before = null, limit = PAGE } = {}) {
      const r = await q(
        `SELECT id, at, via, me, jade, emoji FROM jade_turns WHERE owner = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`,
        [owner, before, limit + 1],
      )
      return { turns: r.rows.slice(0, limit).map(row), more: r.rows.length > limit }
    },
    async clear(owner) {
      await q('DELETE FROM jade_turns WHERE owner = $1', [owner])
    },
  }
}

// The same, in memory (tests)
export function memoryStore() {
  const all = [] // { owner, ...turn }, oldest first
  let next = 1
  return {
    async add(owner, { via, me, jade = '', emoji = '' }, at = Date.now()) {
      const id = next++
      all.push({ owner, id, at, via, me, jade, emoji })
      const mine = all.filter((t) => t.owner === owner)
      if (mine.length > KEEP) all.splice(all.indexOf(mine[0]), 1)
      return id
    },
    async list(owner, { before = null, limit = PAGE } = {}) {
      const mine = all.filter((t) => t.owner === owner && (before == null || t.id < before)).reverse()
      return { turns: mine.slice(0, limit).map(({ owner: _, ...t }) => ({ ...t })), more: mine.length > limit }
    },
    async clear(owner) {
      for (let i = all.length - 1; i >= 0; i--) if (all[i].owner === owner) all.splice(i, 1)
    },
  }
}

// The route's store: one per process (globalThis: each route is its own bundle); null without a database
export const jadeStore = () => (globalThis.__homeJadeStore ??= process.env.DATABASE_URL ? pgStore() : null)
