// Skeletons: every card shows its own shape while its data is on the way, so nothing jumps when it lands.
// Some shapes are only known once the data comes (the owner's Habits bar and how many routines, the Hub's machines,
// the Hosted Applications tab, the internal apps), so the page remembers the last ones it saw (SHAPE_KEY), and
// prePaintShape() (inline in <head>, before the first paint, like the theme) turns them into <html data-sk-*> and a
// small stylesheet: the server-rendered skeletons carry every variant, the stylesheet hides the ones that don't
// apply. A first visit (nothing remembered) gets the guest's shape. app/skeleton.js writes the shapes.
export const SHAPE_KEY = 'home-lofi:shape'
export const TAB_KEY = 'home-lofi:tab' // (app/page.js Services keeps the picked tab under it)
// the most of each that a skeleton draws (more than that: the rest come in with the data)
export const SK_MAX = { hosts: 4, habits: 8, internal: 12, chips: 6 }

// the shape as remembered -> a clean one (anything odd: left out)
export function cleanShape(s, max = SK_MAX) {
  const o = {}
  if (!s || typeof s !== 'object') return o
  const n = (v, max) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : undefined)
  if (typeof s.owner === 'boolean') o.owner = s.owner
  for (const k of ['hosts', 'habits', 'internal']) if (n(s[k], max[k]) !== undefined) o[k] = n(s[k], max[k])
  if (typeof s.hbWeek === 'boolean') o.hbWeek = s.hbWeek
  if (typeof s.wxAqi === 'boolean') o.wxAqi = s.wxAqi
  if (typeof s.wxStation === 'boolean') o.wxStation = s.wxStation
  if (typeof s.fixedVol === 'boolean') o.fixedVol = s.fixedVol // the device can't set the radio's volume (iOS)
  // each internal app's stat chips (their rows make the card taller)
  if (Array.isArray(s.intChips) && s.intChips.length <= max.internal && s.intChips.every((c) => Number.isInteger(c) && c >= 0 && c <= max.chips)) o.intChips = s.intChips
  // a public app's stat chips from /api/private, by its widget (Nextcloud, n8n)
  const w = s.wChips
  if (w && typeof w === 'object' && !Array.isArray(w)) {
    const ok = Object.entries(w).filter(([k, c]) => /^[a-z0-9_-]{1,24}$/.test(k) && Number.isInteger(c) && c >= 0 && c <= max.chips).slice(0, 20)
    if (ok.length) o.wChips = Object.fromEntries(ok)
  }
  // which machines show a ⚡ watts badge (it makes their line a little taller)
  if (Array.isArray(s.power) && s.power.length <= max.hosts && s.power.every((b) => typeof b === 'boolean')) o.power = s.power
  // the Habits card's height at a window width (its tiles wrap differently on a phone)
  const hb = s.hbH
  if (hb && Number.isInteger(hb.w) && Number.isInteger(hb.h) && hb.w > 0 && hb.w <= 10000 && hb.h > 0 && hb.h <= 5000) o.hbH = { w: hb.w, h: hb.h }
  return o
}

// the stylesheet for a shape and the picked tab: hides the skeleton parts that don't apply. Each list of [data-sk-*]
// indexes past the remembered count goes; the Services skeleton keeps only the picked tab's groups
export function shapeCss(shape, tab, max = SK_MAX) {
  const past = (attr, from, to) => Array.from({ length: Math.max(0, to - from) }, (_, i) => `[${attr}="${from + i}"]`).join(',')
  const rules = []
  const hosts = past('data-sk-host', Math.max(1, shape.hosts ?? 0), max.hosts)
  if (hosts) rules.push(`${hosts}{display:none!important}`)
  const nopower = (shape.power ?? []).map((b, i) => (b ? '' : `[data-sk-host="${i}"] .sk-power`)).filter(Boolean).join(',')
  if (nopower) rules.push(`${nopower}{display:none!important}`)
  const habits = past('data-sk-hb', shape.habits ?? 3, max.habits)
  if (habits) rules.push(`${habits}{display:none!important}`)
  const internal = past('data-sk-int', shape.internal ?? 6, max.internal)
  if (internal) rules.push(`${internal}{display:none!important}`)
  if (shape.internal === 0) rules.push('.sk-int-grp{display:none!important}') // (none last time: no section either)
  // each internal app's skeleton keeps as many stat chips as it had (3 when not known), none: no chip box
  const chips = []
  for (let i = 0; i < max.internal; i++) {
    const c = shape.intChips?.[i] ?? 3
    if (c === 0) chips.push(`[data-sk-int="${i}"] .sk-chips`)
    else for (let k = c; k < max.chips; k++) chips.push(`[data-sk-int="${i}"] [data-sk-chip="${k}"]`)
  }
  if (chips.length) rules.push(`${chips.join(',')}{display:none!important}`)
  // the public apps' chips (by widget): 3 unless remembered; more come back with a later rule of the same weight
  const deflt = []
  for (let k = 3; k < max.chips; k++) deflt.push(`[data-sk-w] [data-sk-chip="${k}"]`)
  if (deflt.length) rules.push(`${deflt.join(',')}{display:none!important}`)
  for (const [name, c] of Object.entries(shape.wChips ?? {})) {
    const sel = `[data-sk-w="${name}"]`
    if (c === 0) rules.push(`${sel} .sk-chips{display:none!important}`)
    else if (c < 3) rules.push(`${Array.from({ length: 3 - c }, (_, j) => `${sel} [data-sk-chip="${c + j}"]`).join(',')}{display:none!important}`)
    else if (c > 3) rules.push(`${Array.from({ length: c - 3 }, (_, j) => `${sel} [data-sk-chip="${3 + j}"]`).join(',')}{display:block!important}`)
  }
  // (a range: under zoom / display scaling the CSS width is fractional, innerWidth its rounding)
  if (shape.hbH) rules.push(`@media (min-width:${shape.hbH.w - 0.5}px) and (max-width:${shape.hbH.w + 0.5}px){.sk-hb-card{min-height:${shape.hbH.h}px}}`)
  const t = typeof tab === 'string' && /^[A-Za-z]{1,20}$/.test(tab) ? tab : 'Sites'
  if (t !== 'All') rules.push(`.svc-boot [data-sk-grp]:not([data-sk-grp="${t}"]),.svc-boot [data-sk-head]{display:none!important}`)
  return rules.join('')
}

// <html> attributes for a shape (CSS in app/globals.css reads them)
export function shapeAttrs(shape) {
  const a = {}
  if (shape.owner) a.skOwner = ''
  if (shape.hosts > 0) a.skPriv = ''
  if (shape.hosts === 1) a.skOneHost = ''
  if (shape.hbWeek) a.skHbWeek = ''
  if (shape.wxAqi === false) a.skWxNoAqi = ''
  if (shape.wxStation) a.skWxStation = ''
  if (shape.fixedVol) a.skFixedVol = ''
  return a
}

// Inline in <head> (stringified like the helpers it's handed, so all of them use only their arguments): the
// remembered shape -> <html data-sk-*> and <style id="sk-shape">. Never throws; storage blocked: the guest's shape
export function prePaintShape(key, tabKey, max, clean, css, attrs) {
  let shape = {}, tab = null
  try {
    shape = clean(JSON.parse(localStorage.getItem(key)), max)
  } catch {}
  try {
    tab = JSON.parse(localStorage.getItem(tabKey))
  } catch {}
  // not known yet on this device: iOS is the one that can't set volume (iPhone, iPad, an iPad that says it's a Mac)
  try {
    if (shape.fixedVol === undefined) shape.fixedVol = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  } catch {}
  try {
    const r = document.documentElement, a = attrs(shape)
    for (const k in a) r.dataset[k] = a[k]
    const st = document.createElement('style')
    st.id = 'sk-shape'
    st.textContent = css(shape, tab, max)
    document.head.appendChild(st)
  } catch {}
}
