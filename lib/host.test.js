import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCpu, cpuBusy, parseMem, pickTemp, hostStats } from './host.js'

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
  assert.deepEqual(Object.keys(s), ['cpu', 'mem', 'temp', 'disk', 'uptime', 'load'])
})

test('pickTemp prefers CPU sensors, falls back to any', () => {
  assert.equal(pickTemp([[71000, false], [48500, true], [52250, true]]), 52.3) // hot NVMe ignored
  assert.equal(pickTemp([[41000, false], [0, true]]), 41) // no readable CPU sensor -> any
  assert.equal(pickTemp([]), null)
})
