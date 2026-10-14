// Habits' storage (lib/habits.js has the rules). Server-only: imported by app/api/private/settings/habits. Postgres
// (DATABASE_URL, the same database as settings sync), tables created on first use. habitsStore() is the one the route
// uses; memoryStore() behaves the same in memory, for the route tests (they set globalThis.__homeHabitsStore).
//
// What it keeps: the owner's habits doc ({ tz, habits }: the editor's whole list, archived ones too) and one check-in
// per habit per day. A check-in taken back after its undo window stays, marked undone with its reason (honest: it was
// ticked, then wasn't); checking that day again makes it done again.
import pg from 'pg'

export const HISTORY_DAYS = 120 // what the card gets: enough for the week strip and most streaks

const SCHEMA = `
CREATE TABLE IF NOT EXISTS habit_docs (owner text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS habit_checkins (
  owner text NOT NULL,
  habit_id text NOT NULL,
  day date NOT NULL,
  done_at timestamptz NOT NULL,
  late boolean NOT NULL DEFAULT false,
  rating text,
  note text,
  undone_at timestamptz,
  undo_reason text,
  PRIMARY KEY (owner, habit_id, day)
);`

// a row -> what the card gets
const toCheckin = (r) => ({
  habitId: r.habit_id,
  day: r.day,
  doneAt: +r.done_at,
  late: r.late,
  rating: r.rating ?? null,
  note: r.note ?? null,
  undoneAt: r.undone_at == null ? null : +r.undone_at,
  reason: r.undo_reason ?? null,
})

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
    // -> { tz, habits } | null (never saved)
    async getDoc(owner) {
      return (await q('SELECT data FROM habit_docs WHERE owner = $1', [owner])).rows[0]?.data ?? null
    },
    async putDoc(owner, doc) {
      await q('INSERT INTO habit_docs (owner, data) VALUES ($1, $2) ON CONFLICT (owner) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [owner, doc])
    },
    // the check-ins from `from` (a day) on, oldest first
    async checkins(owner, from) {
      const r = await q(
        `SELECT habit_id, day::text AS day, done_at, late, rating, note, undone_at, undo_reason FROM habit_checkins
         WHERE owner = $1 AND day >= $2::date ORDER BY day, habit_id`,
        [owner, from],
      )
      return r.rows.map(toCheckin)
    },
    async get(owner, habitId, day) {
      const r = await q('SELECT habit_id, day::text AS day, done_at, late, rating, note, undone_at, undo_reason FROM habit_checkins WHERE owner = $1 AND habit_id = $2 AND day = $3::date', [owner, habitId, day])
      return r.rows[0] ? toCheckin(r.rows[0]) : null
    },
    // done (again): a fresh check-in for that day, whatever was there
    async check(owner, { habitId, day, at, late, rating = null }) {
      await q(
        `INSERT INTO habit_checkins (owner, habit_id, day, done_at, late, rating) VALUES ($1, $2, $3::date, to_timestamp($4 / 1000.0), $5, $6)
         ON CONFLICT (owner, habit_id, day) DO UPDATE SET done_at = EXCLUDED.done_at, late = EXCLUDED.late, rating = EXCLUDED.rating,
           note = NULL, undone_at = NULL, undo_reason = NULL`,
        [owner, habitId, day, at, late, rating],
      )
    },
    async rate(owner, { habitId, day, rating, note }) {
      const r = await q(
        `UPDATE habit_checkins SET rating = $4, note = CASE WHEN $5::boolean THEN $6 ELSE note END
         WHERE owner = $1 AND habit_id = $2 AND day = $3::date AND undone_at IS NULL`,
        [owner, habitId, day, rating, note !== undefined, note ?? null],
      )
      return r.rowCount > 0
    },
    // gone, as if never ticked (the undo right after); the route checks the window
    async remove(owner, habitId, day) {
      await q('DELETE FROM habit_checkins WHERE owner = $1 AND habit_id = $2 AND day = $3::date', [owner, habitId, day])
    },
    async untick(owner, { habitId, day, at, reason }) {
      const r = await q(
        'UPDATE habit_checkins SET undone_at = to_timestamp($4 / 1000.0), undo_reason = $5 WHERE owner = $1 AND habit_id = $2 AND day = $3::date AND undone_at IS NULL',
        [owner, habitId, day, at, reason],
      )
      return r.rowCount > 0
    },
  }
}

// The same, in memory (tests)
export function memoryStore() {
  const docs = new Map()
  const rows = new Map() // `${owner} ${habitId} ${day}` -> check-in
  const key = (o, h, d) => `${o} ${h} ${d}`
  return {
    async getDoc(owner) {
      return docs.has(owner) ? structuredClone(docs.get(owner)) : null
    },
    async putDoc(owner, doc) {
      docs.set(owner, structuredClone(doc))
    },
    async checkins(owner, from) {
      return [...rows.entries()]
        .filter(([k, c]) => k.startsWith(`${owner} `) && c.day >= from)
        .map(([, c]) => ({ ...c }))
        .sort((a, b) => (a.day === b.day ? a.habitId.localeCompare(b.habitId) : a.day < b.day ? -1 : 1))
    },
    async get(owner, habitId, day) {
      const c = rows.get(key(owner, habitId, day))
      return c ? { ...c } : null
    },
    async check(owner, { habitId, day, at, late, rating = null }) {
      rows.set(key(owner, habitId, day), { habitId, day, doneAt: at, late, rating, note: null, undoneAt: null, reason: null })
    },
    async rate(owner, { habitId, day, rating, note }) {
      const c = rows.get(key(owner, habitId, day))
      if (!c || c.undoneAt != null) return false
      c.rating = rating
      if (note !== undefined) c.note = note
      return true
    },
    async remove(owner, habitId, day) {
      rows.delete(key(owner, habitId, day))
    },
    async untick(owner, { habitId, day, at, reason }) {
      const c = rows.get(key(owner, habitId, day))
      if (!c || c.undoneAt != null) return false
      c.undoneAt = at
      c.reason = reason
      return true
    },
  }
}

// The route's store: one per process (globalThis: each route is its own bundle)
export const habitsStore = () => (globalThis.__homeHabitsStore ??= pgStore())
