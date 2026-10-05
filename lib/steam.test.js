import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProfile, tag } from './steam.js'

const game = (name, total) => `<mostPlayedGame><gameName><![CDATA[${name}]]></gameName><gameLink><![CDATA[https://steamcommunity.com/app/42]]></gameLink><gameIcon><![CDATA[https://x/icon.jpg]]></gameIcon><hoursPlayed>1.0</hoursPlayed><hoursOnRecord>${total}</hoursOnRecord></mostPlayedGame>`
const xml = (state, extra = '') => `<profile><steamID><![CDATA[Leo]]></steamID><avatarFull><![CDATA[https://x/a.jpg]]></avatarFull><memberSince>April 10, 2014</memberSince><onlineState>${state}</onlineState><hoursPlayed2Wk>3.5</hoursPlayed2Wk>${extra}<mostPlayedGames>${game('Ready or Not', '137')}${game('Big One', '1,234.5')}${game('A', '1')}${game('B', '2')}</mostPlayedGames></profile>`

test('tag: plain and CDATA', () => {
  assert.equal(tag('<a>x</a>', 'a'), 'x')
  assert.equal(tag('<a><![CDATA[Leo & co]]></a>', 'a'), 'Leo & co')
  assert.equal(tag('<b>x</b>', 'a'), null)
})

test('parseProfile: online, in-game with the game, offline; recent games with total hours', () => {
  const on = parseProfile(xml('online'))
  const g = (name, hours) => ({ name, appid: 42, art: 'https://cdn.cloudflare.steamstatic.com/steam/apps/42/header.jpg', hours, hours2w: 1 })
  assert.deepEqual(on, {
    name: 'Leo', avatar: 'https://x/a.jpg', url: 'https://steamcommunity.com/profiles/76561198132741545', level: null, since: 2014, gameId: null,
    state: 'online', game: null, owned: null, hours: null, hours2w: 3.5, recent: [g('Ready or Not', 137), g('Big One', 1235), g('A', 1)],
  })
  const ig = parseProfile(xml('in-game', '<inGameInfo><gameName><![CDATA[Palworld]]></gameName></inGameInfo>'))
  assert.equal(ig.state, 'in-game')
  assert.equal(ig.game, 'Palworld')
  assert.equal(parseProfile(xml('offline')).state, 'offline')
  assert.equal(parseProfile(xml('something-new')).state, 'offline')
})
