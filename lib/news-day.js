// One day of News and of the GitHub list, as the routes answer it: the owner's (app/api/private/settings/news, .../github:
// with the read state, and News' runs) and everyone's (app/api/news, app/api/github: read-only, no Refresh). Server-only
// (lib/news-fetch.js reaches the agent). Each -> { status, body }: 200 { on: true, digest, ... }, { on: false } (NEWS_URL
// isn't set), 404 (no such day), 502 (the agent unreachable or not a digest).
import { DAY, archiveDays, archiveName, dayOf, mergeDay } from './news.js'
import { ghDays, ghLate } from './github.js'
import { archived, editions, ghArchived, ghLatest, ghLatestStale, ghNames, latest, latestStale, newsOn, runState } from './news-fetch.js'

const TZ = 'Asia/Ho_Chi_Minh' // the agent's clock (its archive's names, its "today")
const answer = (body, status = 200) => ({ status, body })

// News: `day` (YYYY-MM-DD | null: the newest with news), its editions merged (lib/news.js mergeDay). runs: also ask the
// agent about its runs (the owner's Refresh) -> body + run, nextAt
//   { on, digest, day, picked, today, days: [{ day, updates, last }], latestAt, stale[, run, nextAt] }
export async function newsDay(day, { runs = false } = {}) {
  if (!newsOn()) return answer({ on: false })
  if (day && !DAY.test(day)) return answer({ on: true, error: 'no such day' }, 404)
  let newest, names, run
  try {
    ;[newest, names, run] = await Promise.all([latest(), editions(), runs ? runState() : null])
    // (a run just done: its edition, not the copy from before it)
    if (run?.fresh) [newest, names] = await Promise.all([latest(), editions()])
  } catch {
    return answer({ on: true, error: 'news unreachable' }, 502)
  }
  // the day: its editions from the archive (the latest as just fetched), merged; one that won't load is left out
  const latestName = archiveName(newest.at, TZ)
  const days = archiveDays(names, latestName)
  const entry = day ? days.find((d) => d.day === day) : days[0]
  if (!entry) return answer({ on: true, error: 'no such day' }, 404)
  const got = await Promise.allSettled(entry.names.map((n) => (n === latestName ? newest : archived(n))))
  const digest = mergeDay(got.filter((g) => g.status === 'fulfilled').map((g) => g.value))
  if (!digest) return answer({ on: true, error: 'news unreachable' }, 502)
  return answer({
    on: true,
    digest,
    day: entry.day,
    picked: day || null,
    today: dayOf(archiveName(Date.now(), TZ)),
    days: days.map((d) => ({ day: d.day, updates: d.names.length, last: d.names.at(-1).slice(11, 13) + ':' + d.names.at(-1).slice(13, 15) })),
    latestAt: newest.at,
    stale: latestStale(),
    ...(runs && { run: run.run, nextAt: run.nextAt }),
  })
}

// the GitHub list: `day` (YYYY-MM-DD | null: the newest)
//   { on, digest, day, picked, today, days: [{ day, last }], latestAt, late, retry, stale }
export async function githubDay(day) {
  if (!newsOn()) return answer({ on: false })
  if (day && !DAY.test(day)) return answer({ on: true, error: 'no such day' }, 404)
  let newest, names
  try {
    ;[newest, names] = await Promise.all([ghLatest(), ghNames()])
  } catch {
    return answer({ on: true, error: 'github unreachable' }, 502)
  }
  const days = ghDays(names, newest.date)
  const entry = day ? days.find((d) => d.day === day) : days[0]
  if (!entry) return answer({ on: true, error: 'no such day' }, 404)
  let digest = newest
  if (entry.day !== newest.date) {
    try {
      digest = await ghArchived(entry.name)
    } catch {
      return answer({ on: true, error: 'github unreachable' }, 502)
    }
  }
  // (the listing may already have a newer day than the copy of github.json kept here: that one's the newest)
  const top = entry === days[0] && digest.at > newest.at ? digest : newest
  const { today, late, retry } = ghLate(days[0].day > top.date ? days[0].day : top.date, Date.now(), TZ)
  return answer({
    on: true,
    digest,
    day: entry.day,
    picked: day || null,
    today,
    days: days.map((d) => ({ day: d.day, last: d.last })),
    latestAt: top.at,
    late,
    retry,
    stale: ghLatestStale(),
  })
}
