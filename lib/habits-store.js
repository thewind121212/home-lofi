// Habits' storage (lib/habits.js has the rules). Server-only: imported by app/api/private/settings/habits. Postgres
// (DATABASE_URL, the same database as settings sync), tables created on first use. habitsStore() is the one the route
// uses; memoryStore() behaves the same in memory, for the route tests (they set globalThis.__homeHabitsStore).
//
// What it keeps: the owner's habits doc ({ tz, habits }: the editor's whole list, archived ones too) and one check-in
// per habit per day. A check-in taken back after its undo window stays, marked undone with its reason (honest: it was
// ticked, then wasn't); checking that day again makes it done again.
import { sharedPool } from './db.js'

export const CLAIM_LEASE = 120_000 // a reminder claimed but never marked sent: another tick may send it after this
export const HISTORY_DAYS = 120 // what the card gets in full (the week strip, recent ratings)
// (streaks look further back: lib/habits.js STREAK_DAYS, through doneDays(), the kept days alone)

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
);
CREATE TABLE IF NOT EXISTS habit_reminders (owner text NOT NULL, key text NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now(), sent boolean NOT NULL DEFAULT false, PRIMARY KEY (owner, key));`

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
  return {
    // -> { tz, habits } | null (never saved)
    async getDoc(owner) {
      const data = (await q('SELECT data FROM habit_docs WHERE owner = $1', [owner])).rows[0]?.data
      return Array.isArray(data?.habits) ? data : null // ('{}': the row a first save made before it wrote)
    },
    async putDoc(owner, doc) {
      await q('INSERT INTO habit_docs (owner, data) VALUES ($1, $2) ON CONFLICT (owner) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [owner, doc])
    },
    // read, change, write with the row locked: two saves at once go one after the other (the second sees the first).
    // change(old | null) -> { doc } (written) | { error, field } (nothing written) -> what change returned
    updateDoc: (owner, change) =>
      tx(async (c) => {
        // create-then-lock the row (nothing saved yet: no row to lock, and two first saves would both write)
        await c.query("INSERT INTO habit_docs (owner, data) VALUES ($1, '{}') ON CONFLICT (owner) DO NOTHING", [owner])
        const data = (await c.query('SELECT data FROM habit_docs WHERE owner = $1 FOR UPDATE', [owner])).rows[0]?.data
        const old = Array.isArray(data?.habits) ? data : null
        const out = change(old)
        if (out.doc) await c.query('INSERT INTO habit_docs (owner, data) VALUES ($1, $2) ON CONFLICT (owner) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [owner, out.doc])
        return out
      }),
    // an archived habit, for good: out of the doc, with its check-ins and its reminders' records, all or nothing
    // -> { doc } | { error: 'none' | 'active' }
    deleteHabit: (owner, habitId) =>
      tx(async (c) => {
        const data = (await c.query('SELECT data FROM habit_docs WHERE owner = $1 FOR UPDATE', [owner])).rows[0]?.data
        const h = Array.isArray(data?.habits) ? data.habits.find((x) => x.id === habitId) : null
        if (!h) return { error: 'none' }
        if (!h.archived) return { error: 'active' }
        const doc = { ...data, habits: data.habits.filter((x) => x.id !== habitId) }
        await c.query('UPDATE habit_docs SET data = $2, updated_at = now() WHERE owner = $1', [owner, doc])
        await c.query('DELETE FROM habit_checkins WHERE owner = $1 AND habit_id = $2', [owner, habitId])
        await c.query("DELETE FROM habit_reminders WHERE owner = $1 AND key LIKE 'start:' || $2 || ':%'", [owner, habitId])
        return { doc }
      }),
    // the check-ins from `from` (a day) on, oldest first
    async checkins(owner, from) {
      const r = await q(
        `SELECT habit_id, day::text AS day, done_at, late, rating, note, undone_at, undo_reason FROM habit_checkins
         WHERE owner = $1 AND day >= $2::date ORDER BY day, habit_id`,
        [owner, from],
      )
      return r.rows.map(toCheckin)
    },
    // the days each habit was kept (not taken back) from `from` on: what streaks count -> [{ habitId, day }]
    async doneDays(owner, from) {
      const r = await q('SELECT habit_id, day::text AS day FROM habit_checkins WHERE owner = $1 AND day >= $2::date AND undone_at IS NULL', [owner, from])
      return r.rows.map((x) => ({ habitId: x.habit_id, day: x.day }))
    },
    async get(owner, habitId, day) {
      const r = await q('SELECT habit_id, day::text AS day, done_at, late, rating, note, undone_at, undo_reason FROM habit_checkins WHERE owner = $1 AND habit_id = $2 AND day = $3::date', [owner, habitId, day])
      return r.rows[0] ? toCheckin(r.rows[0]) : null
    },
    // kept: a check-in for that day, unless one is already kept (the first record stands: two holds at once, a stale
    // tab) -> false then. A day taken back can be kept again (fresh). One statement, so two at once can't both win
    async check(owner, { habitId, day, at, late, rating = null }) {
      const r = await q(
        `INSERT INTO habit_checkins (owner, habit_id, day, done_at, late, rating) VALUES ($1, $2, $3::date, to_timestamp($4 / 1000.0), $5, $6)
         ON CONFLICT (owner, habit_id, day) DO UPDATE SET done_at = EXCLUDED.done_at, late = EXCLUDED.late, rating = EXCLUDED.rating,
           note = NULL, undone_at = NULL, undo_reason = NULL
         WHERE habit_checkins.undone_at IS NOT NULL`,
        [owner, habitId, day, at, late, rating],
      )
      return r.rowCount > 0
    },
    async rate(owner, { habitId, day, rating, note }) {
      const r = await q(
        `UPDATE habit_checkins SET rating = $4, note = CASE WHEN $5::boolean THEN $6 ELSE note END
         WHERE owner = $1 AND habit_id = $2 AND day = $3::date AND undone_at IS NULL`,
        [owner, habitId, day, rating, note !== undefined, note ?? null],
      )
      return r.rowCount > 0
    },
    // gone, as if never ticked (the undo right after; the route checks the window): only the check-in it saw (still
    // kept, the same moment), so an untick or a fresh check landing in between isn't wiped -> false then
    async remove(owner, habitId, day, doneAt) {
      const r = await q(
        'DELETE FROM habit_checkins WHERE owner = $1 AND habit_id = $2 AND day = $3::date AND undone_at IS NULL AND done_at = to_timestamp($4 / 1000.0)',
        [owner, habitId, day, doneAt],
      )
      return r.rowCount > 0
    },
    // A reminder's key (lib/habits-reminders.js): claim it (true = this tick sends it), then mark it sent once the
    // notice is in. A claim that was never marked sent (the send failed, the database or the process went away in
    // between) lapses after CLAIM_LEASE, so a later tick sends it: a reminder is never lost, at worst (rarely) twice.
    async claimReminder(owner, key) {
      const r = await q(
        `INSERT INTO habit_reminders (owner, key) VALUES ($1, $2)
         ON CONFLICT (owner, key) DO UPDATE SET claimed_at = now()
         WHERE NOT habit_reminders.sent AND habit_reminders.claimed_at < now() - make_interval(secs => $3)`,
        [owner, key, CLAIM_LEASE / 1000],
      )
      return r.rowCount > 0
    },
    async sentReminder(owner, key) {
      await q('UPDATE habit_reminders SET sent = true WHERE owner = $1 AND key = $2', [owner, key])
    },
    // the send failed: a later tick may try at once (best effort; the lease covers it when this fails too)
    async releaseReminder(owner, key) {
      await q('DELETE FROM habit_reminders WHERE owner = $1 AND key = $2 AND NOT sent', [owner, key])
    },
    // keys are per day: the old ones go
    async pruneReminders() {
      await q("DELETE FROM habit_reminders WHERE claimed_at < now() - interval '40 days'")
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
  const claimed = new Map() // `${owner} ${key}` -> { at, sent }
  const key = (o, h, d) => `${o} ${h} ${d}`
  return {
    async getDoc(owner) {
      return docs.has(owner) ? structuredClone(docs.get(owner)) : null
    },
    async putDoc(owner, doc) {
      docs.set(owner, structuredClone(doc))
    },
    async deleteHabit(owner, habitId) {
      const data = docs.get(owner)
      const h = data?.habits.find((x) => x.id === habitId)
      if (!h) return { error: 'none' }
      if (!h.archived) return { error: 'active' }
      const doc = { ...structuredClone(data), habits: data.habits.filter((x) => x.id !== habitId).map((x) => structuredClone(x)) }
      docs.set(owner, doc)
      for (const k of [...rows.keys()]) if (k.startsWith(`${owner} ${habitId} `)) rows.delete(k)
      for (const k of [...claimed.keys()]) if (k.startsWith(`${owner} start:${habitId}:`)) claimed.delete(k)
      return { doc: structuredClone(doc) }
    },
    async updateDoc(owner, change) {
      const out = change(docs.has(owner) ? structuredClone(docs.get(owner)) : null)
      if (out.doc) docs.set(owner, structuredClone(out.doc))
      return out
    },
    async checkins(owner, from) {
      return [...rows.entries()]
        .filter(([k, c]) => k.startsWith(`${owner} `) && c.day >= from)
        .map(([, c]) => ({ ...c }))
        .sort((a, b) => (a.day === b.day ? a.habitId.localeCompare(b.habitId) : a.day < b.day ? -1 : 1))
    },
    async doneDays(owner, from) {
      return [...rows.entries()].filter(([k, c]) => k.startsWith(`${owner} `) && c.day >= from && c.undoneAt == null).map(([, c]) => ({ habitId: c.habitId, day: c.day }))
    },
    async get(owner, habitId, day) {
      const c = rows.get(key(owner, habitId, day))
      return c ? { ...c } : null
    },
    async check(owner, { habitId, day, at, late, rating = null }) {
      const cur = rows.get(key(owner, habitId, day))
      if (cur && cur.undoneAt == null) return false
      rows.set(key(owner, habitId, day), { habitId, day, doneAt: at, late, rating, note: null, undoneAt: null, reason: null })
      return true
    },
    async rate(owner, { habitId, day, rating, note }) {
      const c = rows.get(key(owner, habitId, day))
      if (!c || c.undoneAt != null) return false
      c.rating = rating
      if (note !== undefined) c.note = note
      return true
    },
    async remove(owner, habitId, day, doneAt) {
      const c = rows.get(key(owner, habitId, day))
      if (!c || c.undoneAt != null || c.doneAt !== doneAt) return false
      return rows.delete(key(owner, habitId, day))
    },
    async claimReminder(owner, k, now = Date.now()) {
      const c = claimed.get(`${owner} ${k}`)
      if (c && (c.sent || now - c.at < CLAIM_LEASE)) return false
      claimed.set(`${owner} ${k}`, { at: now, sent: false })
      return true
    },
    async sentReminder(owner, k) {
      const c = claimed.get(`${owner} ${k}`)
      if (c) c.sent = true
    },
    async releaseReminder(owner, k) {
      if (!claimed.get(`${owner} ${k}`)?.sent) claimed.delete(`${owner} ${k}`)
    },
    async pruneReminders() {},
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
