// Focus sessions' storage (lib/focus.js has the rules). Server-only: the route (app/api/private/settings/focus) and the
// ticker (lib/focus-ticker.js). Postgres (DATABASE_URL, the same database as settings sync, Habits and Reminders),
// tables created on first use. focusStore() is the one they use; memoryStore() behaves the same in memory, for the tests
// (they set globalThis.__homeFocusStore).
//
// What it keeps:
// - focus_sessions: the owner's one session (data: lib/focus.js's session, null once stopped) and its rev, a number
//   that goes up with every write. Every write says which rev it read (put): the route and the ticker each read, decide,
//   and write only if nothing moved meanwhile, so a "pause" on the phone and the ticker's phase change landing in the
//   same instant can't both win (the loser reads again, or gives up). The row stays after a stop (data null), so the
//   rev never starts over.
// - focus_days: 🍅 per day (the owner's day), bumped in the same transaction as the phase change that earned it.
// - focus_claims: each phase change's key (lib/focus.js transitionKey), claimed before it's made, marked sent once its
//   notice is out, given back if it failed (Reminders' pattern, lib/reminders-store.js claimNudge): two servers, or a
//   restart mid-change, never count or buzz twice.
import { sharedPool } from './db.js'
import { CLAIM_LEASE } from './habits-store.js'

export const KEEP_DAYS = 400 // the 🍅 counts: older ones go

const SCHEMA = `
CREATE TABLE IF NOT EXISTS focus_sessions (owner text PRIMARY KEY, rev bigint NOT NULL, data jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS focus_days (owner text NOT NULL, day date NOT NULL, n int NOT NULL DEFAULT 0, PRIMARY KEY (owner, day));
CREATE TABLE IF NOT EXISTS focus_claims (owner text NOT NULL, key text NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now(), sent boolean NOT NULL DEFAULT false, PRIMARY KEY (owner, key));`

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
    // -> { rev (0: never written), session (null: none) }
    async get(owner) {
      const r = await q('SELECT rev, data FROM focus_sessions WHERE owner = $1', [owner])
      return r.rows[0] ? { rev: Number(r.rows[0].rev), session: r.rows[0].data ?? null } : { rev: 0, session: null }
    },
    // the session (null: stopped), only if it's still at `rev` -> the new rev, or null (it moved meanwhile: nothing
    // written). count: a day ('YYYY-MM-DD') whose 🍅 goes up with it, in the same transaction
    async put(owner, rev, session, { count = null } = {}) {
      const c = await (await db()).connect()
      try {
        await c.query('BEGIN')
        const r = rev === 0
          ? await c.query('INSERT INTO focus_sessions (owner, rev, data) VALUES ($1, 1, $2) ON CONFLICT (owner) DO NOTHING RETURNING rev', [owner, session])
          : await c.query('UPDATE focus_sessions SET rev = rev + 1, data = $3, updated_at = now() WHERE owner = $1 AND rev = $2 RETURNING rev', [owner, rev, session])
        if (!r.rowCount) {
          await c.query('ROLLBACK')
          return null
        }
        if (count) await c.query('INSERT INTO focus_days (owner, day, n) VALUES ($1, $2::date, 1) ON CONFLICT (owner, day) DO UPDATE SET n = focus_days.n + 1', [owner, count])
        await c.query('COMMIT')
        return Number(r.rows[0].rev)
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        c.release()
      }
    },
    // 🍅 on a day
    async count(owner, day) {
      const r = await q('SELECT n FROM focus_days WHERE owner = $1 AND day = $2::date', [owner, day])
      return r.rows[0]?.n ?? 0
    },
    // a phase change's key: claimed (true = this tick makes it), then marked sent; a claim never marked sent lapses
    // after CLAIM_LEASE (never lost, at worst rarely twice: and then the rev check above still lets only one through)
    async claim(owner, key) {
      const r = await q(
        `INSERT INTO focus_claims (owner, key) VALUES ($1, $2)
         ON CONFLICT (owner, key) DO UPDATE SET claimed_at = now()
         WHERE NOT focus_claims.sent AND focus_claims.claimed_at < now() - make_interval(secs => $3)`,
        [owner, key, CLAIM_LEASE / 1000],
      )
      return r.rowCount > 0
    },
    async sent(owner, key) {
      await q('UPDATE focus_claims SET sent = true WHERE owner = $1 AND key = $2', [owner, key])
    },
    // the change wasn't made (the session moved meanwhile, the database failed): a later tick may try at once
    async release(owner, key) {
      await q('DELETE FROM focus_claims WHERE owner = $1 AND key = $2 AND NOT sent', [owner, key])
    },
    // claims only matter while their phase could still end; the counts are kept a good while
    async prune() {
      await q("DELETE FROM focus_claims WHERE claimed_at < now() - interval '2 days'")
      await q('DELETE FROM focus_days WHERE day < current_date - $1::int', [KEEP_DAYS])
    },
  }
}

// The same, in memory (tests)
export function memoryStore() {
  const rows = new Map() // owner -> { rev, session }
  const days = new Map() // `${owner} ${day}` -> n
  const claimed = new Map() // `${owner} ${key}` -> { at, sent }
  return {
    async get(owner) {
      const r = rows.get(owner)
      return r ? { rev: r.rev, session: structuredClone(r.session) } : { rev: 0, session: null }
    },
    async put(owner, rev, session, { count = null } = {}) {
      const r = rows.get(owner)
      if ((r?.rev ?? 0) !== rev) return null
      rows.set(owner, { rev: rev + 1, session: structuredClone(session) })
      if (count) days.set(`${owner} ${count}`, (days.get(`${owner} ${count}`) ?? 0) + 1)
      return rev + 1
    },
    async count(owner, day) {
      return days.get(`${owner} ${day}`) ?? 0
    },
    async claim(owner, k, now = Date.now()) {
      const c = claimed.get(`${owner} ${k}`)
      if (c && (c.sent || now - c.at < CLAIM_LEASE)) return false
      claimed.set(`${owner} ${k}`, { at: now, sent: false })
      return true
    },
    async sent(owner, k) {
      const c = claimed.get(`${owner} ${k}`)
      if (c) c.sent = true
    },
    async release(owner, k) {
      if (!claimed.get(`${owner} ${k}`)?.sent) claimed.delete(`${owner} ${k}`)
    },
    async prune() {},
  }
}

// The route's and the ticker's store: one per process (globalThis: each route is its own bundle)
export const focusStore = () => (globalThis.__homeFocusStore ??= pgStore())
