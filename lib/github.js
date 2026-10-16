// GitHub: the repos the news agent picks each morning (NEWS_URL: github.json, github-archive/<name>.json,
// github-schema.json), for the owner's GitHub icon and its list (app/github.js). The rules only, no network and no
// React, so node:test checks them; the fetching is lib/news-fetch.js (the same agent), the read state
// lib/news-store.js (ids kept as gh:<owner/repo>, beside News'), the owner-only route app/api/private/settings/github.
// - Whatever the agent writes is checked here before the page sees it, as News is (lib/news.js): known fields only,
//   each cut to size, links http(s) only, counts as numbers. A repo that can't be shown (no name, no link) is left
//   out, not the whole list. schema_version isn't checked (gh-1.0 so far: fields only ever added).
// - One list a day, made at about 06:00 (the agent's wall clock): until GH_FRESH_AT the day before's is the newest
//   there is; after it, a list from an older day is late ("chưa cập nhật"), and the page asks again every 15 min
//   until GH_RETRY_UNTIL.
// - Older days from the agent's archive (it keeps 30), the newest file of each.
import { DAY, archiveName, cleanLink, cleanText, cleanTime, dayOf, validArchive } from './news.js'

export const MAX_REPOS = 100
export const MAX_GH = { name: 140, description: 600, language: 40, topic: 40, license: 40, summary: 1500, line: 400, useWhen: 1200, quickStart: 400, overview: 3000 }
export const MAX_LINES = 10 // features / dev use: lines at most
export const MAX_TOPICS = 12
export const MAX_GH_IDS = 100 // ids in one "read" write
export const GH_FRESH_AT = 6 * 60 + 5 // today's list is due by 06:05 (minutes into the day, the agent's clock)
export const GH_RETRY_UNTIL = 8 * 60 // a late one: asked again until 08:00
export const GH_RETRY = 15 * 60_000
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
// an owner/name as GitHub allows them (never . or .. for either)
const REPO = { test: (v) => REPO_RE.test(v) && !v.split('/').some((p) => p === '.' || p === '..') }

// the agent's categories, as the page names them
export const GH_CATEGORIES = {
  'ai-llm': 'AI · LLM',
  'ai-agent': 'AI agents',
  devtools: 'Dev tools',
  web: 'Web',
  mobile: 'Mobile',
  backend: 'Backend',
  database: 'Database',
  'infra-devops': 'Infra · DevOps',
  security: 'Security',
  'data-ml': 'Data · ML',
  'ui-design': 'UI · Design',
  game: 'Game',
  learning: 'Learning',
  other: 'Other',
}
export const GH_LISTS = { trending: 'Trending', new: 'New' }
export const MATURITY = { experimental: 'Experimental', growing: 'Growing', mature: 'Mature' }
export const DIFFICULTY = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null)
const pick = (v, known) => (typeof v === 'string' && Object.hasOwn(known, v) ? v : null)

// a list of short lines (features_vi, dev_use_vi) -> lines, or null
export function cleanLines(v, n = MAX_LINES) {
  if (!Array.isArray(v)) return null
  const out = []
  for (const x of v) {
    const t = cleanText(x, MAX_GH.line)
    if (t) out.push(t)
    if (out.length >= n) break
  }
  return out.length ? out : null
}

// one repo as the agent wrote it -> what the page draws, or null (no name or no link)
export function cleanRepo(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && REPO.test(raw.id) ? raw.id : typeof raw.full_name === 'string' && REPO.test(raw.full_name) ? raw.full_name : null
  const url = cleanLink(raw.url)
  if (!id || !url) return null
  const topics = Array.isArray(raw.topics) ? [...new Set(raw.topics.map((t) => cleanText(t, MAX_GH.topic)).filter(Boolean))].slice(0, MAX_TOPICS) : []
  const worth = Number.isFinite(raw.worth_trying) ? Math.min(5, Math.max(1, Math.round(raw.worth_trying))) : null
  return {
    id,
    rank: count(raw.rank),
    list: pick(raw.list, GH_LISTS) ?? 'trending',
    name: cleanText(raw.full_name, MAX_GH.name) ?? id,
    url,
    description: cleanText(raw.description, MAX_GH.description),
    language: cleanText(raw.language, MAX_GH.language),
    topics,
    stars: count(raw.stars),
    week: count(raw.stars_this_week),
    forks: count(raw.forks),
    license: cleanText(raw.license, MAX_GH.license),
    homepage: cleanLink(raw.homepage),
    pushedAt: cleanTime(raw.pushed_at),
    firstSeen: typeof raw.first_seen === 'string' && DAY.test(raw.first_seen) ? raw.first_seen : null,
    days: count(raw.days_on_list),
    isNew: raw.is_new_today === true,
    summary: cleanText(raw.summary_vi, MAX_GH.summary, true),
    features: cleanLines(raw.features_vi),
    devUse: cleanLines(raw.dev_use_vi),
    useWhen: cleanText(raw.use_when_vi, MAX_GH.useWhen, true),
    category: pick(raw.category, GH_CATEGORIES) ?? 'other',
    maturity: pick(raw.maturity, MATURITY),
    difficulty: pick(raw.difficulty, DIFFICULTY),
    worth,
    quickStart: cleanText(raw.quick_start, MAX_GH.quickStart, true),
  }
}

// github.json / an archived one -> { date, at, overview, repos } or null (not the agent's GitHub list)
export function cleanGh(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.kind != null && raw.kind !== 'github') return null
  if (typeof raw.date !== 'string' || !DAY.test(raw.date) || !Array.isArray(raw.repos)) return null
  const seen = new Set()
  const repos = []
  for (const r of raw.repos) {
    const c = cleanRepo(r)
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    repos.push(c)
    if (repos.length >= MAX_REPOS) break
  }
  // (trending first, then new; each by its rank)
  const order = (r) => (r.list === 'trending' ? 0 : 1)
  repos.sort((a, b) => order(a) - order(b) || (a.rank ?? 1e9) - (b.rank ?? 1e9))
  return {
    date: raw.date,
    at: cleanTime(raw.generated_at) ?? Date.parse(`${raw.date}T06:00:00+07:00`),
    overview: cleanText(raw.overview_vi, MAX_GH.overview, true),
    repos,
  }
}

// the archive's names (newest first) and the newest list's day -> the days, newest first: [{ day, name (the newest
// file of the day | null: only github.json has it), last ('HH:MM' | null) }]
export function ghDays(names, latestDay) {
  const days = new Map()
  for (const n of names.filter(validArchive).sort().reverse()) {
    const d = dayOf(n)
    if (!days.has(d)) days.set(d, n)
  }
  if (DAY.test(latestDay ?? '') && !days.has(latestDay)) days.set(latestDay, null)
  return [...days]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, name]) => ({ day, name, last: name ? `${name.slice(11, 13)}:${name.slice(13, 15)}` : null }))
}

// the newest list's day, now, the agent's tz -> { today, late (today's should be there by now and isn't), retry (late,
// and still worth asking again) }
export function ghLate(date, now, tz) {
  const name = archiveName(now, tz)
  const today = dayOf(name)
  const mins = Number(name.slice(11, 13)) * 60 + Number(name.slice(13, 15))
  const late = Boolean(date) && date < today && mins >= GH_FRESH_AT
  return { today, late, retry: late && mins < GH_RETRY_UNTIL }
}

// a "read" write's ids -> the valid ones (at most MAX_GH_IDS), or null (not a list)
export function cleanGhIds(v) {
  if (!Array.isArray(v)) return null
  return [...new Set(v.filter((x) => typeof x === 'string' && REPO.test(x)))].slice(0, MAX_GH_IDS)
}
// how the read state keeps them (beside News' story ids, never mixed up with them)
export const GH_KEY = 'gh:'

// POST's body -> { act } | { error, field }
// { action: 'read', ids } | { action: 'unread', ids } | { action: 'seen', at }
export function cleanGhAction(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'an object', field: null }
  if (b.action === 'read' || b.action === 'unread') {
    const ids = cleanGhIds(b.ids)
    return ids?.length ? { act: { action: b.action, ids } } : { error: 'ids: repo ids (owner/name)', field: 'ids' }
  }
  if (b.action === 'seen') return Number.isFinite(b.at) && b.at > 0 ? { act: { action: 'seen', at: b.at } } : { error: 'at: a list time', field: 'at' }
  return { error: 'action: read, unread or seen', field: 'action' }
}

// 280554 -> "280.6k", 1234567 -> "1.2M", 999 -> "999"
export function compact(n) {
  if (!Number.isFinite(n)) return ''
  const a = Math.abs(n)
  const one = (v, unit) => `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`
  if (a >= 999_950) return one(n / 1e6, 'M')
  if (a >= 999.5) return one(n / 1e3, 'k')
  return String(Math.round(n))
}
