// Host stats for /api/private. Server-only: import it only from app/api/private/route.js.
// Inside a normal Docker container /proc and /sys show HOST values, so no mounts are needed.
// Every field is independently null on error (e.g. macOS dev has no /proc).
import { readFile, readdir, statfs } from 'node:fs/promises'

const read = (p) => readFile(p, 'utf8')
const ls = (d) => readdir(d).catch(() => [])
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

// First line of /proc/stat -> { idle, total } jiffies (user..steal; guest is already counted in user/nice).
export function parseCpu(text) {
  const [label, ...rest] = text.split('\n')[0].trim().split(/\s+/)
  const n = rest.slice(0, 8).map(Number)
  if (label !== 'cpu' || n.length < 4 || n.some(Number.isNaN)) throw new Error('bad /proc/stat')
  return { idle: n[3] + (n[4] || 0), total: n.reduce((a, b) => a + b, 0) }
}

// % busy between two parseCpu samples
export function cpuBusy(a, b) {
  const dt = b.total - a.total
  // clamp: iowait may go backwards (kernel docs), which can push the raw value past 0-100
  return dt > 0 ? Math.min(100, Math.max(0, Math.round(100 * (1 - (b.idle - a.idle) / dt)))) : null
}

// /proc/meminfo -> { used, total } bytes, used = MemTotal - MemAvailable
export function parseMem(text) {
  const kb = (k) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1]) * 1024
  const total = kb('MemTotal'), avail = kb('MemAvailable')
  if (!total || Number.isNaN(avail)) throw new Error('bad /proc/meminfo')
  return { used: total - avail, total }
}

// ponytail: one module-scope sample shared by all requests; a sample <250ms old is waited out so the delta isn't noise,
// one >10s old is replaced so the first poll after idle shows current load, not an hours-long average.
let prev = null
async function cpu() {
  if (!prev || Date.now() - prev.t > 10000) prev = { ...parseCpu(await read('/proc/stat')), t: Date.now() }
  const p = prev // local copy: concurrent polls must not measure against each other's fresh sample
  await sleep(p.t + 250 - Date.now())
  const cur = { ...parseCpu(await read('/proc/stat')), t: Date.now() }
  prev = cur
  return cpuBusy(p, cur)
}

// CPU sensors (hwmon `name` / thermal_zone `type`), same preference as the systeminformation lib the old Homepage used
const CPU_SENSOR = /^(coretemp|k10temp|zenpower|cpu_thermal|cpu-thermal|x86_pkg_temp|soc_thermal)$/

// Hottest CPU sensor; if the box exposes none, hottest sensor of any kind (NVMe, board...).
async function temp() {
  const files = [] // [path, isCpu]
  for (const z of await ls('/sys/class/thermal')) {
    if (!z.startsWith('thermal_zone')) continue
    const type = await read(`/sys/class/thermal/${z}/type`).catch(() => '')
    files.push([`/sys/class/thermal/${z}/temp`, CPU_SENSOR.test(type.trim())])
  }
  for (const h of await ls('/sys/class/hwmon')) {
    const name = await read(`/sys/class/hwmon/${h}/name`).catch(() => '')
    for (const f of await ls(`/sys/class/hwmon/${h}`)) if (/^temp\d+_input$/.test(f)) files.push([`/sys/class/hwmon/${h}/${f}`, CPU_SENSOR.test(name.trim())])
  }
  return pickTemp(await Promise.all(files.map(([f, isCpu]) => read(f).then((v) => [Number(v), isCpu], () => [0, isCpu]))))
}

// [[millidegrees, isCpu]] -> °C (1 decimal): hottest CPU reading, else hottest of all; unreadable/0 ignored
export function pickTemp(readings) {
  const vals = readings.filter(([v]) => v > 0)
  const pick = vals.some(([, isCpu]) => isCpu) ? vals.filter(([, isCpu]) => isCpu) : vals
  return pick.length ? Math.round(Math.max(...pick.map(([v]) => v)) / 100) / 10 : null
}

async function disk() {
  // ponytail: the container's / sits on the host's docker disk; set DISK_PATH to a bind mount if that differs.
  const s = await statfs(process.env.DISK_PATH || '/')
  return { used: (s.blocks - s.bfree) * s.bsize, total: s.blocks * s.bsize }
}

const FIELDS = {
  cpu,
  mem: async () => parseMem(await read('/proc/meminfo')),
  temp,
  disk,
  uptime: async () => Math.round(Number((await read('/proc/uptime')).split(' ')[0])),
  load: async () => (await read('/proc/loadavg')).split(' ').slice(0, 3).map(Number),
}

export async function hostStats() {
  const keys = Object.keys(FIELDS)
  const vals = await Promise.all(keys.map((k) => FIELDS[k]().catch(() => null)))
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]))
}
