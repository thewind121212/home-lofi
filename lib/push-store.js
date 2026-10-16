// Web Push's storage (lib/push.js has the rules). Server-only. Postgres (DATABASE_URL, the same database as the hub),
// tables made on first use: the server's own VAPID key pair (made once, kept: a new pair would cut off every device)
// and the devices the owner turned on. memoryStore() behaves the same in memory, for the tests
// (globalThis.__homePushStore).
import { sharedPool } from './db.js'
import webpush from 'web-push'

export const MAX_DEVICES = 10 // the newest stay; turning on an 11th device lets the oldest go

const SCHEMA = `
CREATE TABLE IF NOT EXISTS push_keys (id int PRIMARY KEY CHECK (id = 1), public_key text NOT NULL, private_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint text PRIMARY KEY,
  owner text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  fails int NOT NULL DEFAULT 0
);`

const toSub = (r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth }, name: r.name, at: +r.created_at, fails: r.fails })

export function pgStore(url = process.env.DATABASE_URL, gen = () => webpush.generateVAPIDKeys()) {
  let pool = null
  let ready = null
  let cached = null
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
    // the server's key pair: made on first use; two servers at once both try, the first one's stays
    async keys() {
      if (cached) return cached
      const k = gen()
      await q('INSERT INTO push_keys (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING', [k.publicKey, k.privateKey])
      const r = (await q('SELECT public_key, private_key FROM push_keys WHERE id = 1')).rows[0]
      return (cached = { publicKey: r.public_key, privateKey: r.private_key })
    },
    async list(owner) {
      return (await q('SELECT * FROM push_subs WHERE owner = $1 ORDER BY created_at', [owner])).rows.map(toSub)
    },
    // turned on (or again, from the same browser: its keys may be new). The oldest go past MAX_DEVICES
    async add(owner, sub, name) {
      await q(
        `INSERT INTO push_subs (endpoint, owner, p256dh, auth, name) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET owner = EXCLUDED.owner, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, name = EXCLUDED.name, fails = 0`,
        [sub.endpoint, owner, sub.keys.p256dh, sub.keys.auth, name],
      )
      await q(
        `DELETE FROM push_subs WHERE owner = $1 AND endpoint IN (SELECT endpoint FROM push_subs WHERE owner = $1 ORDER BY created_at DESC OFFSET $2)`,
        [owner, MAX_DEVICES],
      )
    },
    async remove(owner, endpoint) {
      return (await q('DELETE FROM push_subs WHERE owner = $1 AND endpoint = $2', [owner, endpoint])).rowCount > 0
    },
    async ok(endpoint) {
      await q('UPDATE push_subs SET fails = 0 WHERE endpoint = $1 AND fails > 0', [endpoint])
    },
    // one more failure in a row; at `max` the device goes
    async fail(endpoint, max) {
      await q('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = $1', [endpoint])
      await q('DELETE FROM push_subs WHERE endpoint = $1 AND fails >= $2', [endpoint, max])
    },
  }
}

export function memoryStore(gen = () => webpush.generateVAPIDKeys()) {
  let keys = null
  let subs = [] // oldest first
  let t = 0
  return {
    async keys() {
      return (keys ??= gen())
    },
    async list(owner) {
      return subs.filter((s) => s.owner === owner).map(({ owner: _, ...s }) => structuredClone(s))
    },
    async add(owner, sub, name) {
      const old = subs.find((s) => s.endpoint === sub.endpoint)
      subs = subs.filter((s) => s.endpoint !== sub.endpoint)
      subs.push({ endpoint: sub.endpoint, keys: { ...sub.keys }, name, owner, at: old?.at ?? ++t, fails: 0 })
      subs.sort((a, b) => a.at - b.at)
      const mine = subs.filter((s) => s.owner === owner)
      if (mine.length > MAX_DEVICES) {
        const drop = new Set(mine.slice(0, mine.length - MAX_DEVICES).map((s) => s.endpoint))
        subs = subs.filter((s) => !drop.has(s.endpoint))
      }
    },
    async remove(owner, endpoint) {
      const n = subs.length
      subs = subs.filter((s) => !(s.owner === owner && s.endpoint === endpoint))
      return subs.length < n
    },
    async ok(endpoint) {
      for (const s of subs) if (s.endpoint === endpoint) s.fails = 0
    },
    async fail(endpoint, max) {
      for (const s of subs) if (s.endpoint === endpoint) s.fails++
      subs = subs.filter((s) => !(s.endpoint === endpoint && s.fails >= max))
    },
  }
}

export const pushStore = () => (globalThis.__homePushStore ??= pgStore())
