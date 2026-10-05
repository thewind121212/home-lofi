// Steam presence and library for the Steam card. Public on purpose: status, the game being played, games owned, hours.
// Server-only: import it only from app/api/steam/route.js. The profile is STEAM_ID (lib/data.js).
// STEAM_API_KEY (optional, https://steamcommunity.com/dev/apikey) adds games owned + total hours; without it the public
// profile XML still gives the status and the recent games. Either way the profile must be public.
import { STEAM_ID } from './data.js'

const env = process.env
const TIMEOUT = 6000
const TTL = 60_000 // every visitor polls; Steam gets asked at most once a minute

async function get(url, as = 'json') {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return as === 'json' ? r.json() : r.text()
}
// <name>text</name> or <name><![CDATA[text]]></name>
export const tag = (xml, name) => xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`))?.[1]?.trim() ?? null
const num = (v) => (v == null ? null : Number(String(v).replace(/,/g, '')))
const PROFILE = `https://steamcommunity.com/profiles/${STEAM_ID}`

// personastate 0 offline, 1 online, 2 busy, 3 away, 4 snooze, 5 looking to trade, 6 looking to play
const STATES = ['offline', 'online', 'away', 'away', 'away', 'online', 'online']

async function fromApi() {
  const q = `key=${env.STEAM_API_KEY}&steamid=${STEAM_ID}`
  const [sum, owned, recent, level] = await Promise.all([
    get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${STEAM_ID}`),
    get(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${q}&include_played_free_games=1&include_appinfo=1`).catch(() => null),
    get(`https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?${q}&count=3`).catch(() => null),
    get(`https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?${q}`).catch(() => null),
  ])
  const p = sum?.response?.players?.[0]
  if (!p) throw new Error('no such player')
  const games = owned?.response?.games
  const rec = recent?.response?.games ?? []
  return {
    name: p.personaname ?? null,
    avatar: p.avatarfull ?? null,
    url: p.profileurl ?? PROFILE,
    level: level?.response?.player_level ?? null,
    since: p.timecreated ? new Date(p.timecreated * 1000).getFullYear() : null,
    state: p.gameextrainfo ? 'in-game' : STATES[p.personastate] ?? 'offline',
    game: p.gameextrainfo ?? null,
    gameId: p.gameid ? Number(p.gameid) : null,
    owned: owned?.response?.game_count ?? null,
    hours: games ? Math.round(games.reduce((a, g) => a + (g.playtime_forever ?? 0), 0) / 60) : null,
    hours2w: Math.round((rec.reduce((a, g) => a + (g.playtime_2weeks ?? 0), 0) / 60) * 10) / 10,
    recent: rec.slice(0, 3).map((g) => ({
      name: g.name,
      appid: g.appid,
      icon: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : null,
      hours: Math.round((g.playtime_forever ?? 0) / 60),
      hours2w: Math.round(((g.playtime_2weeks ?? 0) / 60) * 10) / 10,
    })),
  }
}

// the public profile XML: no key, no games-owned count
export function parseProfile(x) {
  const state = tag(x, 'onlineState') // online | offline | in-game
  const inGame = x.match(/<inGameInfo>[\s\S]*?<\/inGameInfo>/)?.[0]
  return {
    name: tag(x, 'steamID'),
    avatar: tag(x, 'avatarFull'),
    url: PROFILE,
    level: null,
    since: num(tag(x, 'memberSince')?.match(/\d{4}/)?.[0]),
    gameId: null,
    state: state === 'in-game' ? 'in-game' : state === 'online' ? 'online' : 'offline',
    game: inGame ? tag(inGame, 'gameName') : null,
    owned: null,
    hours: null,
    hours2w: num(tag(x, 'hoursPlayed2Wk')) ?? 0,
    recent: [...x.matchAll(/<mostPlayedGame>([\s\S]*?)<\/mostPlayedGame>/g)].slice(0, 3).map(([, g]) => ({
      name: tag(g, 'gameName'),
      appid: num(tag(g, 'gameLink')?.match(/app\/(\d+)/)?.[1]),
      icon: tag(g, 'gameIcon'),
      hours: Math.round(num(tag(g, 'hoursOnRecord')) ?? 0),
      hours2w: num(tag(g, 'hoursPlayed')) ?? 0,
    })),
  }
}
const fromXml = async () => parseProfile(await get(`https://steamcommunity.com/profiles/${STEAM_ID}/?xml=1`, 'text'))

let cache = { at: 0, value: null, pending: null }
// { name, avatar, url, level, since, state: online | away | in-game | offline, game, gameId, owned, hours, hours2w,
//   recent: [{ name, appid, icon, hours, hours2w }] }
export async function steamStatus() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value
  cache.pending ??= (env.STEAM_API_KEY ? fromApi().catch(fromXml) : fromXml())
    .then((v) => {
      cache = { at: Date.now(), value: v, pending: null }
      return v
    })
    .catch((e) => {
      cache.pending = null
      if (cache.value) return cache.value // Steam hiccup: keep the last answer
      throw e
    })
  return cache.pending
}
