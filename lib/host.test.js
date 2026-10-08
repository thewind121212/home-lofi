import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCpu, cpuBusy, parseMem, pickTemp, freshPower, hostStats, parseAgents, agentShape } from './host.js'

test('parseCpu + delta', () => {
  const a = parseCpu('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4\n')
  assert.deepEqual(a, { idle: 800, total: 1000 })
  const b = parseCpu('cpu  200 0 200 1300 100 0 0 0 0 0')
  assert.deepEqual(b, { idle: 1400, total: 1800 })
  assert.equal(cpuBusy(a, b), 25) // 200 busy of 800
  assert.equal(cpuBusy(a, a), null) // no time passed
  assert.throws(() => parseCpu('intr 1 2 3'))
})

test('parseMem', () => {
  const m = parseMem('MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    4000000 kB\n')
  assert.deepEqual(m, { used: 12000000 * 1024, total: 16000000 * 1024 })
  assert.throws(() => parseMem('MemTotal: 100 kB\n'))
  assert.throws(() => parseMem(''))
})

test('hostStats never throws, has every field', async () => {
  const s = await hostStats()
  assert.deepEqual(Object.keys(s), ['cpu', 'mem', 'temp', 'disk', 'uptime', 'load', 'power'])
})

test('pickTemp prefers CPU sensors, falls back to any', () => {
  assert.equal(pickTemp([[71000, false], [48500, true], [52250, true]]), 52.3) // hot NVMe ignored
  assert.equal(pickTemp([[41000, false], [0, true]]), 41) // no readable CPU sensor -> any
  assert.equal(pickTemp([]), null)
})

test('freshPower keeps recent readings only', () => {
  assert.deepEqual(freshPower({ watts: 2.5, cpu: 1.9, ram: 0.6, at: 1000 }, 1010), { watts: 2.5, cpu: 1.9, ram: 0.6 })
  assert.deepEqual(freshPower({ watts: 1.9, cpu: 1.9, ram: null, at: 1000 }, 1010), { watts: 1.9, cpu: 1.9, ram: null }) // no RAM domain
  assert.equal(freshPower({ watts: 2.5, at: 1000 }, 1100), null) // meter stopped
  assert.equal(freshPower({ watts: null, at: 1000 }, 1010), null)
  assert.equal(freshPower(null), null)
})

test('parseAgents keeps valid entries only', () => {
  const ok = { name: 'debian', url: 'http://10.10.0.50:9101/stats.json', token: 'abc' }
  assert.deepEqual(parseAgents(JSON.stringify([ok, { name: 'x', url: 'javascript:1', token: 'a' }, { name: 'y', url: 'http://h' }])), [ok])
  assert.deepEqual(parseAgents(''), [])
  assert.deepEqual(parseAgents('not json'), [])
  assert.deepEqual(parseAgents('{"name":"a"}'), [])
})

test('agentShape: hostStats shape, drops stale / junk', () => {
  const j = { cpu: 15, mem: { used: 7.8e9, total: 16.6e9 }, temp: 44, disk: { used: 2e11, total: 5e11 }, uptime: 526063, load: [0.32, 0.7, 0.77], power: { watts: 2.5, cpu: 1.8, ram: 0.6 }, at: 1000, extra: 'x' }
  assert.deepEqual(agentShape(j, 1010), { cpu: 15, mem: { used: 7.8e9, total: 16.6e9 }, temp: 44, disk: { used: 2e11, total: 5e11 }, uptime: 526063, load: [0.32, 0.7, 0.77], power: { watts: 2.5, cpu: 1.8, ram: 0.6 } })
  assert.equal(agentShape(j, 1100), null) // agent stopped writing
  const junk = agentShape({ cpu: 'x', mem: { used: -1 }, temp: null, disk: null, uptime: 5, load: [1], power: null, at: 1000 }, 1001)
  assert.deepEqual(junk, { cpu: null, mem: null, temp: null, disk: null, uptime: 5, load: null, power: null })
  assert.equal(agentShape(null), null)
})
