// Quick actions: the ⌘K / Ctrl+K palette (app/quick.js). The pure half: which key opens it, how typed text finds
// actions and services (accent- and case-insensitive, so "nhac" finds "nhắc" and "da lat" finds "Đà Lạt"), the order
// they come in, the typed commands ("remind buy milk", "pin example.com") and the short list it opens on. No React,
// no DOM, so node:test checks all of it.
//
// An item is { id, title, hint?, kbd?, keywords?, group: 'action' | 'service', home? (1, 2…), first?, run }: rank() only
// reads the words (title, keywords, hint) and the group, startList() first / home; app/quick.js builds the items and
// runs them.

import { cleanUrl, fold } from './pins.js'

export const RECENT_N = 4 // the last few run, on top of the list the palette opens on
export const START_N = 7 // that list: the first ones, the recent ones, then the most useful (home), this many at most
export const SHOWN_MAX = 40 // matches shown at once (the list scrolls; nobody reads past the first few)

// ⌘K / Ctrl+K: opens it (or closes it again), from anywhere, a text field too, but not over another dialog (open: the
// palette itself is the open one, so the same keys close it). "/": opens it when not typing in a field (in one it's a
// "/"), no modifier, no dialog open. Never while locked: the lock screen opens nothing.
export function isQuickKey(e, { typing = false, dialog = false, open = false, locked = false } = {}) {
  if (locked || typeof e?.key !== 'string') return false
  // (held down, the key repeats: not open-shut-open)
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') return !e.repeat && (open || !dialog)
  return e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !typing && !dialog
}

// ---- finding: typed text -> the items that fit, best first ----

// the words of a text: folded (no accents, lower case), split on anything that isn't a letter or a digit
const wordsOf = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
// the same words as typed: lower case, accents kept ("nhạc", not "nhac")
const markedOf = (s) => String(s ?? '').normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
// is `q` a subsequence of `s` ("grfn" in "grafana")?
function within(q, s) {
  let i = 0
  for (const c of s) if (c === q[i] && ++i === q.length) return true
  return false
}

// What kind of match an item is (score's hundreds), best first. Every word typed has to fit somewhere; the item is
// as good as its weakest word:
//   6  the title starts with what's typed ("set" -> Settings, "weather" -> Weather details, "spotify" -> Spotify)
//   5  every word starts a word of the title ("spotify" -> Pause Spotify, "news" -> Hacker News)
//   4  … or of its keywords or hint ("musi" -> Play the radio, keyword music; "github" -> GitHub's host)
//   3  … or sits inside a word (two letters at least: "fana" -> Grafana; one letter is only ever a word's start)
//   2  one run of letters is the title's initials ("hn" -> Hacker News)
//   1  one run of letters is in the title in order, from a word's start ("grfn" -> Grafana): rank() shows these only
//      when nothing better fits anything, so "hn" isn't Thunder and "pins" isn't Open reminders
// The rest (under 100) only orders the same kind: +4 the whole title exactly, +2 every word typed is a whole word of the
// title, +8 the accents typed are the item's own (typed with them, "nhạc" is the music and "nhắc" the reminders,
// though both fold to "nhac"; typed without, neither counts).
export const KIND = { start: 6, words: 5, keyword: 4, inside: 3, initials: 2, letters: 1 }
export const kindOf = (s) => Math.floor(s / 100)
export function score(item, query) {
  const q = wordsOf(query)
  if (!q.length) return 0
  const title = wordsOf(item.title)
  const rest = wordsOf([item.keywords, item.hint].flat().filter(Boolean).join(' '))
  const all = [...title, ...rest]
  let worst = KIND.words
  for (const w of q) {
    const fit = title.some((t) => t.startsWith(w)) ? KIND.words : rest.some((t) => t.startsWith(w)) ? KIND.keyword : w.length > 1 && all.some((t) => t.includes(w)) ? KIND.inside : 0
    worst = Math.min(worst, fit)
    if (!worst) break
  }
  if (worst) {
    const flat = title.join(' ')
    const typed = q.join(' ')
    const kind = worst === KIND.words && flat.startsWith(typed) ? KIND.start : worst
    return kind * 100 + (flat === typed ? 4 : 0) + (q.every((w) => title.includes(w)) ? 2 : 0) + accents(item, query)
  }
  if (q.length !== 1 || q[0].length < 2) return 0
  if (title.length > 1 && title.map((t) => t[0]).join('').startsWith(q[0])) return KIND.initials * 100
  const joined = title.join('')
  let at = 0
  for (const t of title) {
    if (t[0] === q[0][0] && within(q[0], joined.slice(at))) return KIND.letters * 100
    at += t.length
  }
  return 0
}
// +8 when the query carries accents and every word typed with them is in the item as typed ("nhạc" in "nhạc", not in
// "nhắc"), else 0
function accents(item, query) {
  const marked = markedOf(query).filter((w) => w !== fold(w))
  if (!marked.length) return 0
  const own = markedOf([item.title, item.keywords, item.hint].flat().filter(Boolean).join(' '))
  return marked.every((w) => own.some((t) => t.includes(w))) ? 8 : 0
}

const GROUP = { action: 0, service: 1 }
// the items that fit `query`, best first: the better kind of match first; within a kind actions before services (the
// obvious intent: "weather" is the Weather details before the weather site), then the finer points, then the order
// they were built in (the more useful first). Letters-in-order matches only when nothing fits any better.
export function rank(items, query, max = SHOWN_MAX) {
  const found = items.map((item, i) => ({ item, i, s: score(item, query) })).filter((x) => x.s > 0)
  const loose = !found.some((x) => kindOf(x.s) > KIND.letters)
  return found
    .filter((x) => loose || kindOf(x.s) > KIND.letters)
    .sort((a, b) => kindOf(b.s) - kindOf(a.s) || (GROUP[a.item.group] ?? 0) - (GROUP[b.item.group] ?? 0) || b.s - a.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.item)
}

// ---- typed commands ----

// "remind buy milk" / "nhắc mua sữa" -> { kind: 'remind', text } (a leading "me" / "me to" goes: "remind me to call
// mom" is "call mom"); "pin example.com/x" -> { kind: 'pin', url } when what follows is one link (lib/pins.js
// cleanUrl: a bare host is taken as https); anything else -> null (just a search). "nhắc" is remind, and so is "nhac"
// typed without accents (a keyboard with no Vietnamese input), but not "nhạc" (music) or any other accented spelling
export function command(input) {
  const m = /^\s*(\S+)\s+(\S[\s\S]*?)\s*$/u.exec(String(input ?? ''))
  if (!m) return null
  const verb = fold(m[1])
  const typed = m[1].normalize('NFC').toLowerCase()
  if (verb === 'remind' || typed === 'nhắc' || typed === 'nhac') {
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

// nothing typed: the items marked first (always there: Show panels in Ambient, the way back), then the ones run last
// (still there: a book finished, a service gone are skipped), then the items marked home (a number: 1 first; the same
// number, the order built), no repeats, `n` at most
export function startList(items, recent = [], n = START_N) {
  const byId = new Map(items.map((x) => [x.id, x]))
  const first = items.filter((x) => x.first)
  const seen = new Set(first.map((x) => x.id))
  const last = recent.map((id) => byId.get(id)).filter((x) => x && !seen.has(x.id)).slice(0, RECENT_N)
  for (const x of last) seen.add(x.id)
  const home = items.filter((x) => x.home && !seen.has(x.id)).sort((a, b) => Number(a.home) - Number(b.home))
  return [...first, ...last, ...home].slice(0, n)
}
// `id` just ran: to the front of the recent ones (kept in this browser)
export const remember = (recent, id) => [id, ...(Array.isArray(recent) ? recent : []).filter((x) => x !== id && typeof x === 'string')].slice(0, RECENT_N)

// a link Quick actions may open in a new tab: an absolute http(s) one (the Services card's, a book's in Kavita) ->
// itself, anything else (javascript:, data:, a relative path, junk) -> null
// what's typed -> a Google search for it (the palette's last row while something's typed: the only one, so Enter's,
// when nothing here matches)
export const googleUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(String(q ?? '').trim())}`

export function tabHref(href) {
  try {
    const u = new URL(String(href ?? ''))
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}
