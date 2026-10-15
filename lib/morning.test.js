// The morning summary's rules (lib/morning.js): its window and key, the title, each line there or left out, and the
// switch's body. Pure: no database, no network (the sender's tests: lib/morning-summary.test.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanNotice } from './notify.js'
import { MORNING_AT, cleanPrefs, morningKey, morningNotice, morningTag, morningTitle, remindersLine, routinesLine, serversLine, weatherLine } from './morning.js'

const now = (min, day = '2026-10-15') => ({ day, min, dow: 4 })

test('the window: 06:00 to 06:29, every day, one key a day', () => {
  assert.equal(MORNING_AT, 360)
  assert.equal(morningKey(now(359)), null)
  assert.equal(morningKey(now(360)), 'morning:2026-10-15')
  assert.equal(morningKey(now(389)), 'morning:2026-10-15')
  assert.equal(morningKey(now(390)), null)
  assert.equal(morningKey(now(12 * 60)), null)
  assert.equal(morningKey(now(360, '2026-10-16')), 'morning:2026-10-16')
  assert.equal(morningTag('2026-10-15'), 'morning:2026-10-15')
})

test('the title: the day as the owner\'s calendar has it', () => {
  assert.equal(morningTitle('2026-10-15'), 'Good morning · Thu 15 Oct')
  assert.equal(morningTitle('2026-11-01'), 'Good morning · Sun 1 Nov')
  assert.equal(morningTitle('nope'), 'Good morning')
})

// the weather API's /weather data, in the location's time: today the 15th from midnight, two days of hours
const wx = ({ time = '2026-10-15T06:05', temp = 28.6, code = 2, codes = {}, chances = {}, days = true } = {}) => {
  const hours = Array.from({ length: 48 }, (_, i) => `2026-10-${15 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`)
  return {
    current: { time, temperature_2m: temp, weather_code: code },
    hourly: { time: hours, weather_code: hours.map((t) => codes[t] ?? 1), precipitation_probability: hours.map((t) => chances[t] ?? 10) },
    ...(days && { daily: { time: ['2026-10-14', '2026-10-15', '2026-10-16'], temperature_2m_min: [22, 23.6, 21], temperature_2m_max: [30, 32.7, 29] } }),
  }
}

test('weather: now, today\'s low–high, and the first rain from now to midnight', () => {
  assert.equal(weatherLine(wx({ codes: { '2026-10-15T15:00': 61, '2026-10-15T17:00': 63 } })), '29° now · 24–33° · rain from 15:00')
  // a likely chance counts too; earlier hours of the day don't
  assert.equal(weatherLine(wx({ codes: { '2026-10-15T03:00': 61 }, chances: { '2026-10-15T11:00': 70 } })), '29° now · 24–33° · rain from 11:00')
  // storms / snow say so; tomorrow's rain isn't today's
  assert.equal(weatherLine(wx({ codes: { '2026-10-15T14:00': 95 } })), '29° now · 24–33° · storms from 14:00')
  assert.equal(weatherLine(wx({ codes: { '2026-10-16T09:00': 61 } })), '29° now · 24–33° · no rain')
  // raining at the station now, or this hour: now
  assert.equal(weatherLine(wx({ code: 61 })), '29° now · 24–33° · rain now')
  assert.equal(weatherLine(wx({ codes: { '2026-10-15T06:00': 80 } })), '29° now · 24–33° · rain now')
  // the owner's unit
  assert.equal(weatherLine(wx(), 'F'), '83° now · 74–91° · no rain')
})

test('weather: what\'s missing is left out; nothing to go on is no line', () => {
  assert.equal(weatherLine(wx({ days: false })), '29° now · no rain')
  const noHours = wx()
  delete noHours.hourly
  assert.equal(weatherLine(noHours), '29° now · 24–33°')
  assert.equal(weatherLine(wx({ time: '2026-10-15T23:59' })).endsWith('no rain'), true)
  assert.equal(weatherLine(null), null)
  assert.equal(weatherLine({}), null)
  assert.equal(weatherLine(wx({ temp: null })), null)
})

const rem = (text) => ({ id: text.replace(/\W/g, '').slice(0, 12).padEnd(6, 'x'), text, day: '2026-10-14' })
test('reminders: how many and the first few, long ones cut; none is no line', () => {
  assert.equal(remindersLine([]), null)
  assert.equal(remindersLine(undefined), null)
  assert.equal(remindersLine([rem('renew the domain')]), '1 reminder: renew the domain')
  assert.equal(remindersLine([rem('renew the domain'), rem('call mum')]), '2 reminders: renew the domain · call mum')
  assert.equal(remindersLine(['a', 'b', 'c', 'd', 'e'].map((x) => rem(`thing ${x}`))), '5 reminders: thing a · thing b · thing c +2 more')
  const long = remindersLine([rem('book the flights to Hanoi for the wedding in December, window seats')])
  assert.equal(long, '1 reminder: book the flights to Hanoi for the…')
  assert.equal(remindersLine([rem('x'.repeat(60))]), `1 reminder: ${'x'.repeat(39)}…`) // (no word to cut at)
})

const habit = (name, when, days = [1, 2, 3, 4, 5, 6, 7], more = {}) => ({ id: name.toLowerCase().padEnd(6, 'x'), name, when, days, archived: false, since: '2026-10-01', ...more })
test('routines: the ones due today, the first one still ahead; none (or no Habits) is no line', () => {
  const doc = {
    tz: 'Asia/Ho_Chi_Minh',
    habits: [
      habit('Piano', { kind: 'window', from: '19:00', to: '22:00' }),
      habit('Workout', { kind: 'time', at: '06:15' }, [1, 2, 3, 4, 5, 6]),
      habit('Read', { kind: 'any' }),
      habit('Swim', { kind: 'time', at: '07:00' }, [6, 7]), // not on Thursdays
      habit('Guitar', { kind: 'time', at: '08:00' }, undefined, { archived: true }),
      habit('Spanish', { kind: 'time', at: '05:00' }, undefined, { since: '2026-10-20' }), // not started yet
    ],
  }
  assert.equal(routinesLine(doc, now(360)), '3 routines today · first: Workout 06:15')
  // Workout's time is over by 07:30: the next one ahead
  assert.equal(routinesLine(doc, now(450)), '3 routines today · first: Piano 19:00')
  assert.equal(routinesLine({ habits: [habit('Read', { kind: 'any' })] }, now(360)), '1 routine today')
  assert.equal(routinesLine({ habits: [habit('Swim', { kind: 'time', at: '07:00' }, [6, 7])] }, now(360)), null)
  assert.equal(routinesLine(null, now(360)), null)
  assert.equal(routinesLine({ tz: 'UTC', habits: [] }, now(360)), null)
})

test('servers: all up, or which are down; no machines set up is no line', () => {
  assert.equal(serversLine([{ name: 'razer', stats: { cpu: 3 } }, { name: 'nas', stats: { cpu: 1 } }]), 'All servers up')
  assert.equal(serversLine([{ name: 'razer', stats: null }, { name: 'nas', stats: { cpu: 1 } }]), 'razer down')
  assert.equal(serversLine([{ name: 'razer', stats: null }, { name: 'nas', stats: null }]), 'razer, nas down')
  assert.equal(serversLine([]), null)
  assert.equal(serversLine(null), null)
})

test('the notice: the title and the lines there are, today\'s tag, gone at midnight; a valid hub notice', () => {
  const n = morningNotice({ now: now(360), weather: '29° now · 24–33° · rain from 15:00', reminders: '2 reminders: renew the domain · call mum', routines: '4 routines today', servers: 'All servers up' })
  assert.equal(n.title, 'Good morning · Thu 15 Oct')
  assert.equal(n.body, '29° now · 24–33° · rain from 15:00\n2 reminders: renew the domain · call mum\n4 routines today\nAll servers up')
  assert.deepEqual([n.source, n.tag, n.color, n.icon, n.ttl], ['Morning', 'morning:2026-10-15', 'highlight', 'fa-solid fa-mug-hot', 18 * 3600])
  const c = cleanNotice(n)
  assert.equal(c.error, undefined)
  assert.deepEqual(c.warnings ?? [], [])
  // each line only when it has something to say
  assert.equal(morningNotice({ now: now(365), weather: null, reminders: 'x', routines: null, servers: 'razer down' }).body, 'x\nrazer down')
  assert.equal(morningNotice({ now: now(365) }).body, 'Nothing on the list today.')
  // the longest it gets still fits the hub (and the push trims it to 300)
  const big = morningNotice({ now: now(360), weather: weatherLine(wx({ codes: { '2026-10-15T15:00': 61 } }), 'F'), reminders: remindersLine(Array.from({ length: 50 }, (_, i) => rem(`${'x'.repeat(130)} ${i}`))), routines: '20 routines today · first: ' + 'y'.repeat(40) + ' 06:15', servers: Array.from({ length: 8 }, (_, i) => `machine-${i}`).join(', ') + ' down' })
  assert.equal(cleanNotice(big).error, undefined)
})

test('the switch\'s body: { morning: true | false } only', () => {
  assert.deepEqual(cleanPrefs({ morning: false }), { morning: false })
  assert.deepEqual(cleanPrefs({ morning: true, extra: 1 }), { morning: true })
  assert.equal(cleanPrefs({ morning: 'off' }).field, 'morning')
  assert.equal(cleanPrefs({}).field, 'morning')
  assert.equal(cleanPrefs([]).field, null)
  assert.equal(cleanPrefs(null).field, null)
})
