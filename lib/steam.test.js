import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProfile, tag } from './steam.js'

const game = (name, total) => `<mostPlayedGame><gameName><![CDATA[${name}]]></gameName><hoursPlayed>1.0</hoursPlayed><hoursOnRecord>${total}</hoursOnRecord></mostPlayedGame>`
const xml = (state, extra = '') => `<profile><onlineState>${state}</onlineState><hoursPlayed2Wk>3.5</hoursPlayed2Wk>${extra}<mostPlayedGames>${game('Ready or Not', '137')}${game('Big One', '1,234.5')}${game('A', '1')}${game('B', '2')}</mostPlayedGames></profile>`

test('tag: plain and CDATA', () => {
  assert.equal(tag('<a>x</a>', 'a'), 'x')
  assert.equal(tag('<a><![CDATA[Leo & co]]></a>', 'a'), 'Leo & co')
  assert.equal(tag('<b>x</b>', 'a'), null)
})

test('parseProfile: online, in-game with the game, offline; recent games with total hours', () => {
  const on = parseProfile(xml('online'))
  assert.deepEqual(on, { state: 'online', game: null, owned: null, hours: null, hours2w: 3.5, recent: [{ name: 'Ready or Not', hours: 137 }, { name: 'Big One', hours: 1235 }, { name: 'A', hours: 1 }] })
  const ig = parseProfile(xml('in-game', '<inGameInfo><gameName><![CDATA[Palworld]]></gameName></inGameInfo>'))
  assert.equal(ig.state, 'in-game')
  assert.equal(ig.game, 'Palworld')
  assert.equal(parseProfile(xml('offline')).state, 'offline')
  assert.equal(parseProfile(xml('something-new')).state, 'offline')
})
