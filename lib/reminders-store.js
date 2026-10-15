// Reminders' storage (lib/reminders.js has the rules). Server-only: the route (app/api/private/settings/reminders)
// and the 06:00 nudge (lib/reminders-nudge.js). Postgres (DATABASE_URL, the same database as settings sync and
// Habits), tables created on first use. remindersStore() is the one they use; memoryStore() behaves the same in memory,
// for the tests (they set globalThis.__homeRemindersStore).
//
// What it keeps: each reminder (its text, the day it was added in the owner's zone) and, once it's done, when: a done
// one stays as a small log (DONE_DAYS) but is never listed again. A mistaken entry is deleted outright. And the
// notices' keys (todo:<day>, and the daily summaries' morning:<day>, afternoon:<day>, evening:<day>), claimed before
// one goes, like Habits' reminders (lib/habits-store.js). And the owner's one switch for them: the summaries
// (lib/morning.js) on, the default, or off (only the 06:00 reminders-only notice), in reminder_prefs: the server's
// ticker reads it, so it can't live in the browser's settings.
import pg from 'pg'
import { CLAIM_LEASE } from './habits-store.js'

export const DONE_DAYS = 90 // the done log: older ones go

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reminders (
  owner text NOT NULL,
  id text NOT NULL,
  text text NOT NULL,
  day date NOT NULL,
  created_at timestamptz NOT NULL,
  done_at timestamptz,
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS reminders_open ON reminders (owner, created_at) WHERE done_at IS NULL;
CREATE TABLE IF NOT EXISTS reminder_nudges (owner text NOT NULL, key text NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now(), sent boolean NOT NULL DEFAULT false, PRIMARY KEY (owner, key));
CREATE TABLE IF NOT EXISTS reminder_prefs (owner text PRIMARY KEY, morning boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());`

// a row -> what the card gets (doneAt only where it matters: the undo)
const toItem = (r) => ({ id: r.id, text: r.text, day: r.day, at: +r.created_at, ...(r.done_at !== undefined && { doneAt: r.done_at == null ? null : +r.done_at }) })

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
  const q = async (sql, args) => (await db()).query(sql, args)
  return {
    // the open ones, oldest first -> [{ id, text, day, at }]
    async open(owner) {
      const r = await q('SELECT id, text, day::text AS day, created_at FROM reminders WHERE owner = $1 AND done_at IS NULL ORDER BY created_at, id', [owner])
      return r.rows.map(toItem)
    },
    async get(owner, id) {
      const r = await q('SELECT id, text, day::text AS day, created_at, done_at FROM reminders WHERE owner = $1 AND id = $2', [owner, id])
      return r.rows[0] ? toItem(r.rows[0]) : null
    },
    // a new one, unless `max` are open already -> false then. The owner's adds go one at a time (the lock), so two at
    // once can't both slip under the cap
    async add(owner, { id, text, day, at }, max) {
      const c = await (await db()).connect()
      try {
        await c.query('BEGIN')
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reminders:${owner}`])
        const n = (await c.query('SELECT count(*)::int AS n FROM reminders WHERE owner = $1 AND done_at IS NULL', [owner])).rows[0].n
        if (n >= max) {
          await c.query('ROLLBACK')
          return false
        }
        await c.query('INSERT INTO reminders (owner, id, text, day, created_at) VALUES ($1, $2, $3, $4::date, to_timestamp($5 / 1000.0))', [owner, id, text, day, at])
        await c.query('COMMIT')
        return true
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        c.release()
      }
    },
    // done: only an open one (two tabs holding it at once: one statement, one wins) -> false otherwise
    async done(owner, id, at) {
      const r = await q('UPDATE reminders SET done_at = to_timestamp($3 / 1000.0) WHERE owner = $1 AND id = $2 AND done_at IS NULL', [owner, id, at])
      return r.rowCount > 0
    },
    // back on the list: only the "done" it saw (the same moment), so nothing done again meanwhile is undone by mistake
    async undo(owner, id, doneAt) {
      const r = await q('UPDATE reminders SET done_at = NULL WHERE owner = $1 AND id = $2 AND done_at = to_timestamp($3 / 1000.0)', [owner, id, doneAt])
      return r.rowCount > 0
    },
    // a mistaken entry, gone for good (only an open one: the done log isn't edited)
    async remove(owner, id) {
      const r = await q('DELETE FROM reminders WHERE owner = $1 AND id = $2 AND done_at IS NULL', [owner, id])
      return r.rowCount > 0
    },
    // A notice's key (Reminders' morning one, a summary's): claimed (true = this tick sends it), then marked sent; a
    // claim never marked sent lapses after CLAIM_LEASE (the same rule as Habits' reminders: never lost, at worst rarely
    // twice)
    async claimNudge(owner, key) {
      const r = await q(
        `INSERT INTO reminder_nudges (owner, key) VALUES ($1, $2)
         ON CONFLICT (owner, key) DO UPDATE SET claimed_at = now()
         WHERE NOT reminder_nudges.sent AND reminder_nudges.claimed_at < now() - make_interval(secs => $3)`,
        [owner, key, CLAIM_LEASE / 1000],
      )
      return r.rowCount > 0
    },
    async sentNudge(owner, key) {
      await q('UPDATE reminder_nudges SET sent = true WHERE owner = $1 AND key = $2', [owner, key])
    },
    // the send failed: a later tick may try at once
    async releaseNudge(owner, key) {
      await q('DELETE FROM reminder_nudges WHERE owner = $1 AND key = $2 AND NOT sent', [owner, key])
    },
    // the owner's morning switch -> { morning } (never set: the summary is on)
    async prefs(owner) {
      const r = await q('SELECT morning FROM reminder_prefs WHERE owner = $1', [owner])
      return { morning: r.rows[0]?.morning ?? true }
    },
    async setPrefs(owner, { morning }) {
      await q('INSERT INTO reminder_prefs (owner, morning) VALUES ($1, $2) ON CONFLICT (owner) DO UPDATE SET morning = EXCLUDED.morning, updated_at = now()', [owner, morning])
      return { morning }
    },
    // keys are per day, the done log is a log: the old ones go
    async prune() {
      await q("DELETE FROM reminder_nudges WHERE claimed_at < now() - interval '40 days'")
      await q('DELETE FROM reminders WHERE done_at < now() - make_interval(days => $1)', [DONE_DAYS])
    },
  }
}

// The same, in memory (tests)
export function memoryStore() {
  const rows = new Map() // `${owner} ${id}` -> { owner, id, text, day, at, doneAt }
  const claimed = new Map() // `${owner} ${key}` -> { at, sent }
  const prefs = new Map() // owner -> { morning }
  const pick = ({ id, text, day, at }) => ({ id, text, day, at })
  return {
    async open(owner) {
      return [...rows.values()].filter((r) => r.owner === owner && r.doneAt == null).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map(pick)
    },
    async get(owner, id) {
      const r = rows.get(`${owner} ${id}`)
      return r ? { ...pick(r), doneAt: r.doneAt } : null
    },
    async add(owner, { id, text, day, at }, max) {
      if ([...rows.values()].filter((r) => r.owner === owner && r.doneAt == null).length >= max) return false
      rows.set(`${owner} ${id}`, { owner, id, text, day, at, doneAt: null })
      return true
    },
    async done(owner, id, at) {
      const r = rows.get(`${owner} ${id}`)
      if (!r || r.doneAt != null) return false
      r.doneAt = at
      return true
    },
    async undo(owner, id, doneAt) {
      const r = rows.get(`${owner} ${id}`)
      if (!r || r.doneAt == null || r.doneAt !== doneAt) return false
      r.doneAt = null
      return true
    },
    async remove(owner, id) {
      const r = rows.get(`${owner} ${id}`)
      if (!r || r.doneAt != null) return false
      return rows.delete(`${owner} ${id}`)
    },
    async claimNudge(owner, k, now = Date.now()) {
      const c = claimed.get(`${owner} ${k}`)
      if (c && (c.sent || now - c.at < CLAIM_LEASE)) return false
      claimed.set(`${owner} ${k}`, { at: now, sent: false })
      return true
    },
    async sentNudge(owner, k) {
      const c = claimed.get(`${owner} ${k}`)
      if (c) c.sent = true
    },
    async releaseNudge(owner, k) {
      if (!claimed.get(`${owner} ${k}`)?.sent) claimed.delete(`${owner} ${k}`)
    },
    async prefs(owner) {
      return { morning: prefs.get(owner)?.morning ?? true }
    },
    async setPrefs(owner, { morning }) {
      prefs.set(owner, { morning })
      return { morning }
    },
    async prune() {},
  }
}

// The route's and the nudge's store: one per process (globalThis: each route is its own bundle)
export const remindersStore = () => (globalThis.__homeRemindersStore ??= pgStore())
