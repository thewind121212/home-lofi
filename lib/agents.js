// Agents' messages: the hub's second channel (lib/notify.js has the first, services). An agent (Claude Code's hook on a
// machine, the news agent, a long job) POSTs to the same /api/notify with the same token, with kind 'agent' and a shape
// of its own: which agent, which project, what state it's in, a title and the content. They're kept apart from the
// services' notices (lib/notify-store.js kind 'agent': their own 200, their own read state) and shown apart: the 🤖
// icon next to the bell, an inbox grouped by project (app/agents.js). Pure rules: no React, no database.
//
// The state decides the rest, so every agent looks and behaves the same:
//   needs-you  amber: it's waiting on the owner (a permission prompt, a question). Pops up, pushes to the phone.
//   failed     red: it stopped on an error. Pops up (stays until closed), pushes.
//   done       green: finished. Quiet: the 🤖 count and the inbox only.
//   working    grey: started / still going. Quiet, and not counted as unread: a status, not news.
// One card per session: a newer message from the same session replaces the older one (working → needs-you → done).
import { TAG, TTL_MAX, TTL_MIN, cut, multiLine, oneLine, parseIcon, webUrl } from './notify.js'

export const STATES = ['needs-you', 'done', 'failed', 'working']
// a state's look on the page and its notice level (pop-ups, the lock screen and the push urgency go by the level)
export const STATE_LOOK = {
  'needs-you': { label: 'Needs you', level: 'warning', color: 'highlight', icon: 'fa-solid fa-hand' },
  failed: { label: 'Failed', level: 'error', color: 'red', icon: 'fa-solid fa-circle-xmark' },
  done: { label: 'Done', level: 'success', color: 'green', icon: 'fa-solid fa-circle-check' },
  working: { label: 'Working', level: 'info', color: 'muted', icon: 'fa-solid fa-gear' },
}
export const ALERTS = ['needs-you', 'failed'] // the states that pop up and push
export const AGENT_ICON = 'fa-solid fa-robot' // an agent's icon when it sends none
export const AGENT_MAX = { agent: 32, project: 48, title: 100, content: 2000, session: 60 }
const FIELDS = ['kind', 'agent', 'project', 'state', 'title', 'content', 'session', 'icon', 'url', 'ttl']
const SESSION = /^[A-Za-z0-9._:/-]{1,60}$/

// A sender's JSON (kind: 'agent') -> { notice, warnings } or { error, field }. Like lib/notify.js cleanNotice: a
// missing or wrong field the sender must fix is a 400; text that's too long is cut (and said so), an icon or a url the
// page can't use is left out, unknown fields are ignored (all three in warnings).
export function cleanAgent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'the body must be a JSON object', field: null }
  if (raw.kind !== 'agent') return { error: 'kind: agent', field: 'kind' }
  const warnings = []
  const bad = (field, error) => ({ error: `${field}: ${error}`, field })
  const notice = { kind: 'agent' }
  for (const [field, fn, need] of [['agent', oneLine, true], ['project', oneLine, true], ['title', oneLine, true], ['content', multiLine, false]]) {
    const v = raw[field]
    if (v == null && !need) continue
    if (v != null && typeof v !== 'string') return bad(field, 'must be a string')
    const s = fn(v ?? '')
    if (!s) {
      if (need) return bad(field, 'required')
      continue
    }
    if (s.length > AGENT_MAX[field]) warnings.push(`${field}: cut to ${AGENT_MAX[field]} characters`)
    notice[field] = cut(s, AGENT_MAX[field])
  }
  if (!STATES.includes(raw.state)) return bad('state', `one of ${STATES.join(', ')}`)
  notice.state = raw.state
  if (raw.session != null) {
    if (typeof raw.session !== 'string' || !SESSION.test(raw.session)) return bad('session', 'letters, digits and . _ : / - only, up to 60')
    notice.session = raw.session
    notice.tag = `agent:${raw.session}` // (lib/notify-store.js: replaces this session's older card, agents only)
    if (!TAG.test(notice.tag)) return bad('session', 'too long')
  }
  if (raw.icon != null) {
    const icon = parseIcon(raw.icon)
    if (icon) notice.icon = icon
    else warnings.push('icon: use fa-<name> (Font Awesome) or an https image URL; showing the robot')
  }
  if (raw.url != null) {
    const url = webUrl(raw.url)
    if (url) notice.url = url
    else warnings.push('url: an http(s) address; no link')
  }
  if (raw.ttl != null) {
    if (!Number.isFinite(raw.ttl) || raw.ttl < TTL_MIN || raw.ttl > TTL_MAX) return bad('ttl', `seconds, ${TTL_MIN} to ${TTL_MAX}`)
    notice.ttl = Math.round(raw.ttl)
  }
  const extra = Object.keys(raw).filter((k) => !FIELDS.includes(k))
  if (extra.length) warnings.push(`ignored: ${extra.slice(0, 5).join(', ')}`)
  return { notice, warnings }
}

// A notice (cleanAgent's, or as stored) -> what the page gets: the sender's fields, plus what the hub's shared pieces
// (pop-ups, Ambient's chip, the lock screen: app/notify.js) read off any notice: level, color, icon, source, body and
// silent (= no pop-up, no push: done and working)
export function agentView(n) {
  const s = STATE_LOOK[n.state] ?? STATE_LOOK.working
  return {
    ...n,
    level: s.level,
    color: s.color,
    icon: n.icon ?? { fa: AGENT_ICON },
    source: `${s.label} · ${n.project}`,
    ...(n.content && { body: n.content }),
    ...(!ALERTS.includes(n.state) && { silent: true }),
  }
}

// A stored row -> the page's item, re-checked on the way out like lib/notify.js toItem
export function agentItem({ id, created_at, expires_at, data }) {
  const icon = data?.icon?.fa ?? data?.icon?.img ?? undefined
  const { notice } = cleanAgent({ ...data, kind: 'agent', icon, tag: undefined, ttl: undefined })
  if (!notice) return null
  return { id: Number(id), at: +new Date(created_at), exp: expires_at ? +new Date(expires_at) : null, ...agentView(notice) }
}

// What goes to the phones (lib/push.js pushNotice): the state and project up front, then the title and the content.
// done / working are silent there too, so they never buzz
export function agentPush(n) {
  const v = agentView(n)
  return {
    title: `${STATE_LOOK[n.state].label} · ${n.project}`,
    body: n.content ? `${n.title}\n${n.content}` : n.title,
    level: v.level,
    ...(n.tag && { tag: n.tag }),
    ...(n.url && { url: n.url }),
    ...(n.ttl && { ttl: n.ttl }),
    ...(v.silent && { silent: true }),
  }
}

// counts toward the 🤖 badge: anything but 'working' (a status line, not something to read)
export const counts = (item) => item.state !== 'working'

// newest-first items -> [[project, items], …], the project with the newest message first
export function byProject(items) {
  const out = new Map()
  for (const i of items) {
    if (!out.has(i.project)) out.set(i.project, [])
    out.get(i.project).push(i)
  }
  return [...out]
}

// The content's light formatting (never HTML: app/agents.js makes React text of it): paragraphs, "- " / "* " lists,
// "1. " lists, and `code` inside a line. -> [{ type: 'p' | 'ul' | 'ol', lines: [string] }]
export function blocksOf(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = !ul && /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const type = ul ? 'ul' : ol ? 'ol' : 'p'
    const s = (ul?.[1] ?? ol?.[1] ?? line).trim()
    if (!s) {
      if (out.at(-1)) out.at(-1).end = true // a blank line ends the block
      continue
    }
    const last = out.at(-1)
    if (last && !last.end && last.type === type) last.lines.push(s)
    else out.push({ type, lines: [s] })
  }
  return out.map(({ type, lines }) => ({ type, lines }))
}

// one line -> [{ text, code }]: `code` spans (an unmatched ` stays as it is)
export function spansOf(line) {
  const out = []
  const re = /`([^`]+)`/g
  let at = 0
  for (let m; (m = re.exec(line)); ) {
    if (m.index > at) out.push({ text: line.slice(at, m.index), code: false })
    out.push({ text: m[1], code: true })
    at = m.index + m[0].length
  }
  if (at < line.length) out.push({ text: line.slice(at), code: false })
  return out
}

// whether a card needs "Show more": past 3 lines or about 3 lines' worth of text
export const SHOW_MORE_CHARS = 220
export const isLong = (content) => Boolean(content) && (content.length > SHOW_MORE_CHARS || content.split('\n').length > 3)
