// Quick actions: the ⌘K / Ctrl+K palette (app/quick.js). The pure half: which key opens it, how typed text finds
// actions and services (accent- and case-insensitive, so "nhac" finds "nhắc" and "da lat" finds "Đà Lạt"), the order
// they come in, the typed commands ("remind buy milk", "pin example.com") and the short list it opens on. No React,
// no DOM, so node:test checks all of it.
//
// An item is { id, title, hint?, kbd?, keywords?, group: 'action' | 'service', home? (1, 2…), run }: rank() only reads the
// words (title, keywords, hint) and the group; app/quick.js builds the items and runs them.

import { cleanUrl, fold } from './pins.js'

export const RECENT_N = 4 // the last few run, on top of the list the palette opens on
export const START_N = 7 // that list: the recent ones, then the most useful (home), this many at most
export const SHOWN_MAX = 40 // matches shown at once (the list scrolls; nobody reads past the first few)

// ⌘K / Ctrl+K: opens it (or closes it again), from anywhere, a text field too, but not over another dialog (open: the
// palette itself is the open one, so the same keys close it). "/": opens it when not typing in a field (in one it's a
// "/"), no modifier, no dialog open. Never while locked: the lock screen opens nothing.
export function isQuickKey(e, { typing = false, dialog = false, open = false, locked = false } = {}) {
  if (locked || typeof e?.key !== 'string') return false
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') return open || !dialog
  return e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !typing && !dialog
}

// ---- finding: typed text -> the items that fit, best first ----

// the words of a text: folded (no accents, lower case), split on anything that isn't a letter or a digit
const wordsOf = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
// is `q` a subsequence of `s` ("gfn" in "grafana")?
function within(q, s) {
  let i = 0
  for (const c of s) if (c === q[i] && ++i === q.length) return true
  return false
}

// How well `query` fits an item -> a score, 0 = it doesn't. Every word typed has to be somewhere; the item counts as
// well as its weakest word:
//   3  starts a word of the title ("set" -> Settings, "news" -> Hacker News)
//   2  starts a word of its keywords or hint ("musi" -> Play / pause, keyword music; "github" -> GitHub's host)
//   1  inside a word anywhere ("fana" -> Grafana)
// then x10, +5 when the whole title starts with the whole query (typed straight from the start), +3 when the query
// is all whole words of the title. Nothing fits word by word: one typed run of letters can still match the title's
// initials ("hn" -> Hacker News: 15) or its letters in order ("grfn" -> Grafana: 5), below every real match.
export function score(item, query) {
  const q = wordsOf(query)
  if (!q.length) return 0
  const title = wordsOf(item.title)
  const rest = wordsOf([item.keywords, item.hint].flat().filter(Boolean).join(' '))
  const all = [...title, ...rest].join(' ')
  let worst = 3
  for (const w of q) {
    const fit = title.some((t) => t.startsWith(w)) ? 3 : rest.some((t) => t.startsWith(w)) ? 2 : all.includes(w) ? 1 : 0
    worst = Math.min(worst, fit)
    if (!worst) break
  }
  if (worst) {
    const flat = title.join(' ')
    return worst * 10 + (flat.startsWith(q.join(' ')) ? 5 : 0) + (q.every((w) => title.includes(w)) ? 3 : 0)
  }
  if (q.length !== 1 || q[0].length < 2) return 0
  if (title.length > 1 && title.map((t) => t[0]).join('').startsWith(q[0])) return 15
  return within(q[0], title.join('')) ? 5 : 0
}

const GROUP = { action: 0, service: 1 }
// the items that fit `query`, best first; at the same score actions come before services, then the order they were
// built in (the more useful first)
export function rank(items, query, max = SHOWN_MAX) {
  return items
    .map((item, i) => ({ item, i, s: score(item, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (GROUP[a.item.group] ?? 0) - (GROUP[b.item.group] ?? 0) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.item)
}

// ---- typed commands ----

// "remind buy milk" / "nhắc mua sữa" -> { kind: 'remind', text } (a leading "me" / "me to" goes: "remind me to call
// mom" is "call mom"); "pin example.com/x" -> { kind: 'pin', url } when what follows is one link (lib/pins.js
// cleanUrl: a bare host is taken as https); anything else -> null (just a search)
export function command(input) {
  const m = /^\s*(\S+)\s+(\S[\s\S]*?)\s*$/u.exec(String(input ?? ''))
  if (!m) return null
  const verb = fold(m[1])
  if (verb === 'remind' || verb === 'nhac') {
    const text = m[2].replace(/^me(\s+to)?(\s+|$)/i, '').trim()
    return text ? { kind: 'remind', text } : null
  }
  if (verb === 'pin' && !/\s/.test(m[2])) {
    const c = cleanUrl(m[2])
    return c.error ? null : { kind: 'pin', url: c.url }
  }
  return null
}

// ---- the list it opens on ----

// nothing typed: the ones run last (still there: a book finished, a service gone are skipped), then the items marked
// home (a number: 1 first; the same number, the order built), no repeats, `n` at most
export function startList(items, recent = [], n = START_N) {
  const byId = new Map(items.map((x) => [x.id, x]))
  const first = recent.map((id) => byId.get(id)).filter(Boolean).slice(0, RECENT_N)
  const seen = new Set(first.map((x) => x.id))
  const home = items.filter((x) => x.home && !seen.has(x.id)).sort((a, b) => Number(a.home) - Number(b.home))
  return [...first, ...home].slice(0, n)
}
// `id` just ran: to the front of the recent ones (kept in this browser)
export const remember = (recent, id) => [id, ...(Array.isArray(recent) ? recent : []).filter((x) => x !== id && typeof x === 'string')].slice(0, RECENT_N)
