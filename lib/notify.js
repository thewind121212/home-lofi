// The notification hub: pure rules shared by the sender route (app/api/notify), the store (lib/notify-store.js), the
// owner's read route (app/api/private/settings/notifications) and the page (app/notify.js). No React, no database, so
// node:test checks all of it.
//
// A machine on the LAN (n8n, a cron job, Coolify) POSTs a small JSON notice with a token; the server keeps it in
// Postgres and tells the owner's open tabs over the live stream (lib/live.js, event 'notify': "pull"). The page pulls
// the newest list and shows it the way the screen is right now: a pop-up on the dashboard, a chip on Ambient's bar
// (compact), one quiet line under the big clock when the bar has faded (screensaver), a short stack on the lock screen.
//
// Looks follow the page, not the sender: icons are Font Awesome (like every other icon on the page) or an https image
// (like a service card's), never an emoji; colors are the names of the page's own palette (the theme's three plus the
// up / down green and red the status lines already use), never a hex value, so a theme change recolors them too.

export const LEVELS = ['info', 'success', 'warning', 'error']
// the page's palette by name (app/notify.js maps them to its Tailwind classes: lofi-* tokens, emerald / red / blue /
// purple-400, the same ones the service cards and status lines use)
export const COLORS = ['primary', 'secondary', 'highlight', 'muted', 'green', 'red', 'blue', 'purple']
// a level's look when the notice brings none: the same icons and colors the page uses for those states already
// (Settings' sync line: green = fine, highlight = needs a look; the status lines: red = down)
export const LEVEL_LOOK = {
  info: { icon: 'fa-solid fa-circle-info', color: 'primary' },
  success: { icon: 'fa-solid fa-circle-check', color: 'green' },
  warning: { icon: 'fa-solid fa-triangle-exclamation', color: 'highlight' },
  error: { icon: 'fa-solid fa-circle-xmark', color: 'red' },
}
export const MAX = { title: 80, body: 500, source: 32, tag: 64, url: 500, icon: 300 }
export const TTL_MIN = 10 // s
export const TTL_MAX = 30 * 86400 // s: the store forgets everything after 30 days anyway
export const MAX_BODY = 16384 // bytes of JSON a sender may POST (an agent's 2000 characters of Vietnamese are ~6 KB)
const FIELDS = ['kind', 'title', 'body', 'level', 'source', 'icon', 'color', 'url', 'tag', 'silent', 'ttl']

// control characters out (a sender's stray \r or ANSI color codes); the title is one line, the body keeps its newlines
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/g
export const oneLine = (s) => s.replace(/[\r\n\t]+/g, ' ').replace(CTRL, '').trim()
export const multiLine = (s) => s.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CTRL, '').trim()
// too long: cut at the limit with an ellipsis (better a short notice than none), and say so in the answer
export const cut = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s)

// 'fa:database', 'fa-database', 'fa-solid fa-database', 'fa-brands fa-docker', 'fa-regular fa-bell' -> the class
// list ('fa-solid fa-database'); an https image URL -> { img }; anything else (an emoji, a typo) -> null
const FA_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export function parseIcon(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > MAX.icon) return null
  if (/^https:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      return u.protocol === 'https:' && u.hostname ? { img: u.href } : null
    } catch {
      return null
    }
  }
  const short = /^fa[:-]([a-z0-9-]+)$/.exec(s)
  if (short && !['solid', 'brands', 'regular'].includes(short[1]) && FA_NAME.test(short[1])) return { fa: `fa-solid fa-${short[1]}` }
  const full = /^fa-(solid|brands|regular) fa-([a-z0-9-]+)$/.exec(s)
  if (full && FA_NAME.test(full[2])) return { fa: `fa-${full[1]} fa-${full[2]}` }
  return null
}

export const webUrl = (v) => {
  if (typeof v !== 'string' || !v.trim() || v.length > MAX.url) return null
  try {
    const u = new URL(v.trim())
    // (the limit again on the encoded form: non-Latin text grows up to 9x when %-encoded)
    return ['http:', 'https:'].includes(u.protocol) && u.hostname && u.href.length <= MAX.url ? u.href : null
  } catch {
    return null
  }
}

export const TAG = /^[A-Za-z0-9._:/-]{1,64}$/

// A sender's JSON -> { notice, warnings } or { error, field }.
// Hard errors (400): no title, a wrong type, an unknown level, a bad tag / ttl / silent: the sender has a bug and
// should hear about it. Soft (the notice still goes out, the answer lists warnings): text cut to its limit, an icon,
// color or url the page can't use (the level's look is used instead, no link), fields it doesn't know.
export function cleanNotice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  const warnings = []
  const bad = (field, error) => ({ error: `${field}: ${error}`, field })
  // (kind 'agent' is lib/agents.js cleanAgent's: the route sends those there)
  if (raw.kind != null && raw.kind !== 'notice') return bad('kind', 'notice (the default) or agent')
  const text = (field, max, fn) => {
    const v = raw[field]
    if (v == null) return undefined
    if (typeof v !== 'string') return bad(field, 'must be a string')
    const s = fn(v)
    if (s.length > max) warnings.push(`${field}: cut to ${max} characters`)
    return s ? cut(s, max) : undefined
  }

  const title = text('title', MAX.title, oneLine)
  if (title?.error) return title
  if (!title) return bad('title', 'required')
  const body = text('body', MAX.body, multiLine)
  if (body?.error) return body
  const source = text('source', MAX.source, oneLine)
  if (source?.error) return source

  const level = raw.level ?? 'info'
  if (!LEVELS.includes(level)) return bad('level', `one of ${LEVELS.join(', ')}`)

  const notice = { title, level }
  if (body) notice.body = body
  if (source) notice.source = source

  if (raw.icon != null) {
    const icon = parseIcon(raw.icon)
    if (icon) notice.icon = icon
    else warnings.push(`icon: use fa-<name> (Font Awesome) or an https image URL; showing the ${level} icon`)
  }
  if (raw.color != null) {
    if (COLORS.includes(raw.color)) notice.color = raw.color
    else warnings.push(`color: one of ${COLORS.join(', ')}; using the ${level} color`)
  }
  if (raw.url != null) {
    const url = webUrl(raw.url)
    if (url) notice.url = url
    else warnings.push('url: an http(s) address; no link')
  }
  if (raw.tag != null) {
    if (typeof raw.tag !== 'string' || !TAG.test(raw.tag)) return bad('tag', 'letters, digits and . _ : / - only, up to 64')
    notice.tag = raw.tag
  }
  if (raw.silent != null) {
    if (typeof raw.silent !== 'boolean') return bad('silent', 'true or false')
    if (raw.silent) notice.silent = true
  }
  if (raw.ttl != null) {
    if (!Number.isFinite(raw.ttl) || raw.ttl < TTL_MIN || raw.ttl > TTL_MAX) return bad('ttl', `seconds, ${TTL_MIN} to ${TTL_MAX}`)
    notice.ttl = Math.round(raw.ttl)
  }
  const extra = Object.keys(raw).filter((k) => !FIELDS.includes(k))
  if (extra.length) warnings.push(`ignored: ${extra.slice(0, 5).join(', ')}`)
  return { notice, warnings }
}

// A stored row -> what the page gets: { id, at, exp, title, body?, level, source?, icon?, color?, url?, tag?, silent? }
// (at / exp: epoch ms; exp null = stays until cleared). data is re-checked on the way out: a row written by an older
// version, or by hand, can't put anything on the page that a sender couldn't.
export function toItem({ id, created_at, expires_at, data }) {
  // (a stored icon is the parsed { fa } / { img }: back to its string, so it goes through parseIcon again)
  const icon = data?.icon?.fa ?? data?.icon?.img ?? undefined
  const { notice } = cleanNotice({ ...data, icon, ttl: undefined })
  if (!notice) return null
  return { id: Number(id), at: +new Date(created_at), exp: expires_at ? +new Date(expires_at) : null, ...notice }
}

// What a notice looks like: its icon ({ fa } or { img }) and color name, the level's when it brings none
export function look(item) {
  const d = LEVEL_LOOK[item?.level] ?? LEVEL_LOOK.info
  return { icon: item?.icon ?? { fa: d.icon }, color: item?.color ?? d.color }
}

// ---- the page's side (app/notify.js) ----------------------------------------------------------------------------------

export const TOAST_MS = 6000 // a pop-up stays this long (errors stay until closed); hovering holds it
export const TOAST_MAX = 3 // at once; more arriving together show as "+N more" on the last one
export const SAVER_FRESH_MS = 30 * 60_000 // the screensaver's line: info / success this recent, warnings / errors while unread
export const LOCK_MAX = 3
const RANK = { info: 0, success: 0, warning: 1, error: 2 }
const MIN_RANK = { all: 0, warning: 1, error: 2 }

export const alive = (items, now) => items.filter((i) => i.exp == null || i.exp > now)
export const unreadOf = (items, read) => items.filter((i) => i.id > read)
export const maxId = (items) => items.reduce((m, i) => Math.max(m, i.id), 0)
export const sticky = (item) => item.level === 'error'

// What this tab changed that a server answer may not show yet: every change makes the server say 'notify' to all the
// owner's tabs, this one too, so a list asked for before a dismiss / clear / read landed can answer after it (answers
// come back in any order) and bring the notice, or the unread badge, back for a moment.
// pending = { gone: [{ id, after }] dismissed, upTo: cleared up to, read: read up to }. Requests are numbered as they
// go out (seq); `after` is the last number out when the server confirmed the dismiss (null until then). settle() lays
// pending over an answer, and forgets a dismissed id only on an answer to a request sent after that confirmation that
// no longer has it: anything older may predate the delete (app/notify.js drops an answer older than one already on
// screen, so none can come after that). upTo and read stay: the server only moves them forward, and new notices get
// higher ids.
export const NO_PENDING = { gone: [], upTo: 0, read: 0 }
export function settle({ items, read }, pending = NO_PENDING, seq = Infinity) {
  const has = (id) => items.some((i) => i.id === id)
  return {
    items: items.filter((i) => i.id > pending.upTo && !pending.gone.some((g) => g.id === i.id)),
    read: Math.max(Number(read) || 0, pending.read),
    pending: { ...pending, gone: pending.gone.filter((g) => g.after == null || seq <= g.after || has(g.id)) },
  }
}

// The pop-ups for what just arrived (fresh: newer than anything this tab had seen, newest first): not silent, at least
// Settings › Pop-ups' level, at most TOAST_MAX. -> { show, more }
export function toastsFor(fresh, { notifyToasts = true, notifyMin = 'all' } = {}) {
  if (!notifyToasts) return { show: [], more: 0 }
  const ok = fresh.filter((i) => !i.silent && RANK[i.level] >= (MIN_RANK[notifyMin] ?? 0))
  return { show: ok.slice(0, TOAST_MAX), more: Math.max(0, ok.length - TOAST_MAX) }
}

// Where notifications show on the screen right now. view: lib/ambient.js ambientView(); locked: the lock is on; set:
// the settings. -> { bell, toasts, chip, saver, lock }
//   bell / toasts: the dashboard (the header's bell and the inbox; pop-ups when Settings › Pop-ups is on)
//   chip: compact, Ambient's bar is up: a chip on it with the newest unread
//   saver: screensaver, the bar has faded: 'clock' (a line under the big clock) or 'pill' (Scene only: a small pill at
//     the bottom, where the bar was)
//   lock: Settings › Lock screen ('titles' | 'full' | 'count'), or null
export function notifyPlaces(view, { locked = false, set = {} } = {}) {
  const amb = set.notifyAmbient !== false
  const calm = view.bar === 'faded'
  return {
    bell: Boolean(view.dashboard),
    toasts: Boolean(view.dashboard) && set.notifyToasts !== false,
    chip: amb && view.bar === 'shown',
    saver: amb && calm ? (view.clock !== 'none' ? 'clock' : 'pill') : null,
    lock: locked && set.notifyLock !== 'off' ? (set.notifyLock ?? 'titles') : null,
  }
}

// Compact / screensaver: the newest unread, and how many more. The screensaver is a room nobody's in: an info / success
// line older than SAVER_FRESH_MS has had its moment and goes; a warning or an error stays until it's read.
export function ambientNote(items, read, now, { saver = false } = {}) {
  const un = unreadOf(alive(items, now), read)
  const keep = saver ? un.filter((i) => RANK[i.level] >= 1 || now - i.at < SAVER_FRESH_MS) : un
  if (!keep.length) return null
  return { item: keep[0], more: un.length - 1 }
}

// The lock screen: the newest LOCK_MAX unread; 'titles' (default) shows title, source and time, 'full' the body too,
// 'count' only how many. Anyone walking past sees the lock screen, hence titles by default. -> { show, more, total } | null
export function lockNotes(items, read, now, mode) {
  if (!mode) return null
  const un = unreadOf(alive(items, now), read)
  if (!un.length) return null
  const show = mode === 'count' ? [] : un.slice(0, LOCK_MAX)
  return { show, more: un.length - show.length, total: un.length, details: mode === 'full' }
}

// '12m' style times: 'now', '5m', '3h', then the weekday ('Mon') within a week, then the date ('Oct 3')
export function ago(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  const d = new Date(at)
  if (s < 7 * 86400) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// how long until a notice with a ttl goes: 'a moment', '5m', '3h', '2d'
export function left(exp, now) {
  const s = Math.max(0, Math.round((exp - now) / 1000))
  if (s < 60) return 'a moment'
  if (s < 3600) return `${Math.ceil(s / 60)}m`
  if (s < 86400) return `${Math.ceil(s / 3600)}h`
  return `${Math.ceil(s / 86400)}d`
}

// the inbox's day headings: 'Today', 'Yesterday', else 'Mon, Oct 5' (local days)
export function dayLabel(at, now) {
  const day = (t) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const diff = Math.round((day(now) - day(at)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// newest-first items -> [[label, items], …] in that order
export function byDay(items, now) {
  const out = []
  for (const i of items) {
    const label = dayLabel(i.at, now)
    if (out.at(-1)?.[0] === label) out.at(-1)[1].push(i)
    else out.push([label, [i]])
  }
  return out
}
