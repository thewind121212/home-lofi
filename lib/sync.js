// Owner-only cloud copy of the per-browser settings: pure helpers shared by the browser (app/cloud.js) and the
// server (lib/cloud.js). A doc is { v: { key: value }, t: { key: ms } }: every key carries the time it last changed and
// the newer side wins per key, so a theme picked on the phone and a clock format picked on the PC both survive.
import { SCENES } from './data.js'
import { DEFAULTS, parseSettings } from './settings.js'
import { cleanSounds } from './sounds.js'

// Synced: every setting, the saved scene and the weather location. Volume and the services tab stay per device.
const FIELDS = Object.keys(DEFAULTS)
export const SYNC_KEYS = [...FIELDS.map((f) => `settings.${f}`), 'scene', 'location']
// Retired settings the server still keeps (true / false) for one release: a tab still running the old page (opened
// before the deploy) has them stamped, and if the server dropped them that tab would see a difference on every answer
// and push again every second, "syncing" for ever. Kept, they're echoed back and it settles. The new page never shows
// or takes them (takeKeys). Retired with the mini window, 2026-10-08: remove after 2026-11-08.
const RETIRED = ['settings.miniWeather', 'settings.miniDate']
// what a stored / sent doc may hold (cleanDoc)
const KEPT_KEYS = [...SYNC_KEYS, ...RETIRED]

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined)

// The value as it may be stored, or undefined when it isn't valid for that key (unknown keys too).
export function clean(key, v) {
  if (RETIRED.includes(key)) return typeof v === 'boolean' ? v : undefined
  if (key === 'scene') return SCENES.includes(v) ? v : undefined
  if (key === 'location') {
    // same checks as the Weather card's saved location, plus the extra fields /api/geo returns
    if (!v || !Number.isFinite(v.lat) || !Number.isFinite(v.lon) || !str(v.tz, 64) || !/^\d{1,12}$/.test(String(v.id))) return undefined
    const extra = Object.fromEntries(['region', 'country'].map((f) => [f, str(v[f], 120)]).filter(([, x]) => x !== undefined))
    return { id: Number(v.id), name: str(v.name, 120) ?? '', ...extra, lat: v.lat, lon: v.lon, tz: v.tz }
  }
  const f = key.startsWith('settings.') && key.slice(9)
  if (!FIELDS.includes(f)) return undefined
  // the Sounds mix is an object: checked field by field, key order free (jsonb reorders keys), parsed value back
  if (f === 'sounds') return cleanSounds(v)
  // parseSettings swaps anything invalid for the default; only an unchanged value is a valid one
  const p = parseSettings(JSON.stringify({ [f]: v }))[f]
  return p === v ? p : undefined
}

// Any JSON -> a doc holding only valid keys with a positive stamp, stamps capped at `now` (a device whose clock runs
// ahead must not win every future edit).
export function cleanDoc(raw, now = Date.now()) {
  const doc = { v: {}, t: {} }
  for (const k of KEPT_KEYS) {
    const t = raw?.t?.[k]
    const v = clean(k, raw?.v?.[k])
    if (v === undefined || !Number.isFinite(t) || t <= 0) continue
    doc.v[k] = v
    doc.t[k] = Math.min(Math.round(t), now)
  }
  return doc
}

// The keys of a cloud doc this page takes over its local copy: newer in the cloud, or the same stamp with a different
// value (changed here while signed out: those edits get no stamp and stay on this device, so signing in brings the
// cloud copy back). Only keys this page syncs: a retired one the server still keeps (RETIRED) is never taken, or it
// would count as a change on every pull.
export function takeKeys(remote, local) {
  return Object.keys(remote.t).filter(
    (k) => SYNC_KEYS.includes(k) && (remote.t[k] > (local.t[k] ?? 0) || (remote.t[k] === local.t[k] && JSON.stringify(remote.v[k]) !== JSON.stringify(local.v[k]))),
  )
}

// Per key, the newer side wins (ties keep `base`). Returns the merged doc and the keys `incoming` changed.
export function merge(base, incoming) {
  const doc = { v: { ...base.v }, t: { ...base.t } }
  const changed = []
  for (const k of Object.keys(incoming.t)) {
    if (incoming.t[k] > (base.t[k] ?? 0)) {
      doc.v[k] = incoming.v[k]
      doc.t[k] = incoming.t[k]
      changed.push(k)
    }
  }
  return { doc, changed }
}
