'use client'

// Quick actions: a ⌘K / Ctrl+K palette over the dashboard (also "/" outside a text field). Type a few letters, Enter
// runs the top match; ↑ / ↓ or Tab / Shift+Tab move (the typing stays in the field, as in Spotlight), a click runs a
// row. Last, while something's typed: a Google search for it in a new tab (Enter's when nothing here matches).
// - Actions first, then the hosted apps (the Services card's: the public ones, the internal ones too when signed in),
//   each opening in a new tab. Matching and ranking are lib/quick.js (accents and case don't matter: "nhac" finds
//   "nhắc"; a word's start beats the inside of a word).
// - Only what makes sense for whoever looks: Notifications, Reminders, Pins, Reading and the music's ⏭ are the
//   owner's (each only once its hook says it's on), full screen only where the browser can.
// - Typed commands (the owner's): "remind buy milk" / "nhắc mua sữa" adds a reminder, "pin example.com" pins a link;
//   when one parses it's the top row. The palette stays open until the server has it, and says so when it can't.
// - Nothing typed: in Ambient Show panels first (the way back), then the few run last (kept in this browser), then the
//   most useful.
// - A <dialog> like every sheet here (.wx-sheet: a bottom sheet on phones, from sm a panel near the top: .qk-sheet in
//   globals.css): Esc / the backdrop close it (closeDialog's exit), the page stays still behind it (useStillPage).
//   Running a row closes it at once (what it opens comes up in its place).
// - The combobox pattern: focus stays in the field, the rows are a listbox it points into (aria-activedescendant).
//
// Adding actions (Focus sessions, …): build them in quickActions() below from what the page hands over in ctx; an
// action is { id, title, hint?, kbd?, fa | img, keywords?, home?, first?, wait?, run }. `home` (1 first) puts it on the
// list the palette opens on, `first` on top of it whatever was run last; `wait` (what to say meanwhile: 'Adding…')
// keeps the palette open while run()'s promise is out (it may resolve to what went wrong, shown in the palette).
import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Search, X } from 'lucide-react'
import { SCENES, SERVICES } from '../lib/data'
import { LAYERS, PRESETS, applyPreset, audibleLayers, setLayer, soundsLabel } from '../lib/sounds'
import { sceneName } from '../lib/settings'
import { mainAction, spOn } from '../lib/player'
import { domainOf } from '../lib/pins'
import { command, googleUrl, rank, remember, startList, tabHref } from '../lib/quick'
import { PRESETS as FOCUS_PRESETS, PRESET_IDS, fmtLeft, leftOf, paused } from '../lib/focus'
import { closeDialog, load, save, useStillPage } from './settings'
import { tavarianPost } from './player'

const RECENT_KEY = 'quickRecent'
// a new tab, cut off from this page (noopener: it can't reach back through window.opener), and only for an http(s)
// link (lib/quick.js tabHref: never a javascript: one, whatever /api/private or Kavita hands over)
const openTab = (href) => {
  const url = tabHref(href)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ---- the actions ----

// ctx (from the page): owner, ambient, enterAmbient, leaveAmbient, lock, openSettings, full ({ ok, on, toggle }),
// scene, openGallery, pickScene, shuffleScene, openInbox (null unless the owner's inbox is on), openAgents (the same, the 🤖's), snd, mix, setMix,
// openSounds, music ({ source, tune, station, radio(), sp, spAct(action) (the page's Spotify control), spShow() (the
// card's Spotify tab), player, tvOn }), wx, openWeather,
// rm + openReminders, pn + openPins, rd + openReading, nw + openNews, gh + openGithub, fc (useFocus) + openFocus, priv (/api/private: the internal apps)
export function quickActions(ctx) {
  return [...basics(ctx), ...music(ctx), ...sounds(ctx), ...focusing(ctx), ...owners(ctx), ...scenes(ctx)]
}

function basics(c) {
  return [
    c.ambient
      ? { id: 'ambient', title: 'Show panels', kbd: 'Esc', fa: 'fa-eye', keywords: ['ambient', 'dashboard', 'back'], first: true, run: c.leaveAmbient }
      : { id: 'ambient', title: 'Ambient mode', kbd: 'H', fa: 'fa-mountain-sun', keywords: ['hide panels', 'calm', 'scene only'], home: 5, run: c.enterAmbient },
    { id: 'lock', title: 'Lock screen', kbd: 'L', fa: 'fa-lock', keywords: ['clock', 'away', 'sleep'], home: 7, run: c.lock },
    c.openInbox && { id: 'inbox', title: 'Notifications', kbd: 'N', fa: 'fa-bell', keywords: ['inbox', 'alerts', 'thông báo'], home: 4, run: c.openInbox },
    c.openAgents && { id: 'agents', title: 'Agents', fa: 'fa-robot', keywords: ['claude', 'ai', 'bot', 'tác tử'], run: c.openAgents },
    { id: 'weather', title: 'Weather details', hint: c.wx?.name, fa: 'fa-cloud-sun', keywords: ['forecast', 'temperature', 'air quality', 'aqi', 'humidity', 'daily summary', 'thời tiết'], home: 6, run: c.openWeather },
    { id: 'settings', title: 'Settings', fa: 'fa-gear', keywords: ['preferences', 'theme', 'colors', 'clock', 'motion', 'cài đặt'], home: 8, run: c.openSettings },
    c.full?.ok && { id: 'fullscreen', title: c.full.on ? 'Exit full screen' : 'Full screen', kbd: 'F', fa: c.full.on ? 'fa-compress' : 'fa-expand', keywords: ['fullscreen', 'expand'], run: c.full.toggle },
  ].filter(Boolean)
}

// play / pause what the music card plays now (the radio for everyone; the owner's Spotify or home station), and ⏭
// where that player has one for this viewer. Through the page's own controls, so the music card and Ambient's bar show
// it as if their buttons were pressed:
// - Spotify: the page's one Spotify control (the card's and the bar's ⏯ / ⏭ are the same): its button spins, a no from
//   Spotify shows under it as always, and the card turns to its Spotify tab (not saved) so there's something to see.
//   The palette closes at once (Spotify takes a few seconds to confirm a change)
// - the home station: the owner's press goes to Tavarian, which answers at once: the palette waits for it and says so
//   when it's a no (a guest's Listen / Stop only plays here: at once, inside the key press or tap)
const STATION_TITLE = { listen: 'Listen to the home station', stop: 'Stop listening', pause: 'Pause the home station', resume: 'Resume the home station', play: 'Play the home station' }
function music(c) {
  const m = c.music
  if (!m) return []
  const kw = ['music', 'play', 'pause', 'nhạc']
  if (m.source === 'spotify' && c.owner && spOn(m.sp)) {
    return [
      { id: 'music', title: m.sp.playing ? 'Pause Spotify' : 'Play Spotify', hint: m.sp.track, fa: m.sp.playing ? 'fa-pause' : 'fa-play', keywords: kw, home: 1, run: () => (m.spShow(), m.spAct(m.sp.playing ? 'pause' : 'play')) },
      { id: 'next', title: 'Next track', hint: 'Spotify', fa: 'fa-forward-step', keywords: ['skip', 'music', 'song'], run: () => (m.spShow(), m.spAct('next')) },
    ]
  }
  if (m.source === 'tavarian' && m.tvOn && m.player?.state?.song) {
    const p = m.player
    const a = mainAction({ owner: c.owner, listening: p.listening, phase: p.phase, status: p.state.status, queued: p.queue?.items?.length ?? 0 })
    const told = (r) => (r.ok ? (p.takeState(r.data.state), null) : r.error) // -> what went wrong, or null
    const press = () => {
      let sent = null
      p.press((k) => (sent = tavarianPost({ action: k }).then(told)))
      return sent
    }
    const wait = c.owner && a.posts ? 'Asking the home station…' : undefined
    const out = [{ id: 'music', title: STATION_TITLE[a.kind], hint: p.state.song.title, fa: p.listening ? 'fa-pause' : 'fa-play', keywords: [...kw, 'tavarian', 'station'], home: 1, wait, run: press }]
    if (c.owner) out.push({ id: 'next', title: 'Skip song', hint: 'Home station', fa: 'fa-forward-step', keywords: ['next', 'skip', 'music', 'song'], wait: 'Skipping…', run: () => tavarianPost({ action: 'skip' }).then(told) })
    return out
  }
  const on = m.tune.playing || m.tune.loading
  return [{ id: 'music', title: on ? 'Pause the radio' : 'Play the radio', hint: m.station?.name, fa: on ? 'fa-pause' : 'fa-play', keywords: [...kw, 'radio', 'lofi'], home: 1, run: m.radio }]
}

// the Sounds panel, play / pause them (once something's switched on), each sound (on, or off again) and each preset
function sounds(c) {
  const { snd, mix, setMix } = c
  if (!snd || !mix) return []
  const kw = ['sounds', 'ambient sound', 'noise', 'âm thanh']
  const audible = audibleLayers(mix).length > 0
  const out = [{ id: 'sounds', title: 'Sounds', hint: audible ? soundsLabel(mix) : 'Rain, wind, café…', kbd: 'A', fa: 'fa-wave-square', keywords: ['mixer', ...kw], home: 2, run: c.openSounds }]
  if (audible && snd.supported) out.push({ id: 'sounds-play', title: snd.playing ? 'Pause sounds' : 'Play sounds', hint: soundsLabel(mix), fa: snd.playing ? 'fa-pause' : 'fa-play', keywords: kw, run: () => (snd.playing ? snd.stop() : snd.start()) })
  for (const l of LAYERS.filter((x) => x.ready)) {
    const cur = mix.layers[l.id]
    // on and playing (not muted): off again; otherwise on, and the sounds start (this tap is the gesture they need)
    const sounding = cur.on && cur.level > 0 && snd.playing && !snd.muted
    out.push({
      id: `sound:${l.id}`,
      title: l.name,
      hint: sounding ? 'Sound · on, Enter turns it off' : 'Sound',
      fa: l.icon,
      keywords: kw,
      run: () => {
        if (sounding) return setMix(setLayer(mix, l.id, { on: false }))
        setMix(setLayer(mix, l.id, { on: true, level: cur.level || 0.5 }))
        snd.start()
      },
    })
  }
  for (const [id, name, icon] of PRESETS) out.push({ id: `preset:${id}`, title: name, hint: 'Sounds preset', fa: icon, keywords: ['preset', 'mix', ...kw], run: () => (setMix(applyPreset(mix, id)), snd.start()) })
  return out
}

// the owner's: Reminders, Pins, Reading, News (each once its hook has it: on)
function owners(c) {
  if (!c.owner) return []
  const out = []
  if (c.rm?.on) {
    const n = c.rm.data?.items?.length ?? 0
    out.push(
      { id: 'reminders-add', title: 'Add a reminder', hint: 'or type: remind …', fa: 'fa-plus', keywords: ['reminders', 'todo', 'nhắc', 'new'], home: 3, run: () => c.openReminders('add') },
      { id: 'reminders', title: 'Open reminders', hint: n ? `${n} open` : 'none open', fa: 'fa-list-check', keywords: ['todo', 'tasks', 'nhắc'], run: () => c.openReminders() },
    )
  }
  if (c.pn?.on) {
    const n = c.pn.data?.pins?.length ?? 0
    out.push(
      { id: 'pins', title: 'Open pins', hint: plural(n, 'link'), fa: 'fa-thumbtack', keywords: ['links', 'bookmarks', 'saved'], run: () => c.openPins() },
      { id: 'pins-add', title: 'Pin a link', hint: 'or type: pin <link>', fa: 'fa-link', keywords: ['pins', 'bookmark', 'save', 'url'], run: () => c.openPins('add') },
    )
  }
  if (c.rd?.on) {
    out.push({ id: 'reading', title: 'Open reading', hint: `${c.rd.books.length} in progress`, fa: 'fa-book-open', keywords: ['books', 'kavita', 'đọc sách'], run: () => c.openReading() })
    for (const b of c.rd.books.filter((x) => x.href)) {
      out.push({ id: `book:${b.id}`, title: b.name, hint: `${b.percent}% · continue in Kavita`, fa: 'fa-book', keywords: ['continue', 'reading', 'book', 'kavita'], run: () => openTab(b.href) })
    }
  }
  if (c.nw?.on) out.push({ id: 'news', title: 'Open news', hint: c.nw.fresh ? 'a new edition' : 'the latest edition', fa: 'fa-newspaper', keywords: ['news', 'digest', 'rss', 'tin tức', 'báo'], run: () => c.openNews() })
  if (c.gh?.on) out.push({ id: 'github', title: 'Open GitHub trending', hint: c.gh.fresh ? 'a new list' : "the day's repos", fa: 'fa-brands fa-github', keywords: ['github', 'trending', 'repos', 'repo', 'open source'], run: () => c.openGithub() })
  return out
}

// Focus (the owner's, once its hook is on): the sheet, then what fits now: nothing running, start one (each preset);
// running, pause or resume, skip, stop. Every device follows (it's the server's session); the header ring shows it
function focusing(c) {
  const fc = c.fc
  if (!c.owner || !fc?.on) return []
  const s = fc.session
  const kw = ['focus', 'pomodoro', 'timer', 'tập trung']
  const now = s ? `${s.phase === 'focus' ? 'Focus' : 'Break'} · ${fmtLeft(leftOf(s, fc.now()))}${paused(s) ? ' · paused' : ' left'}` : null
  const out = [{ id: 'focus', title: 'Focus', hint: now ?? `🍅 ${fc.today} today`, fa: 'fa-stopwatch', keywords: kw, run: c.openFocus }]
  if (!s) {
    for (const p of PRESET_IDS) {
      const [work, rest] = FOCUS_PRESETS[p]
      out.push({ id: `focus:${p}`, title: `Start focus ${p}`, hint: `${work} min focus, ${rest} min break`, fa: 'fa-play', keywords: kw, run: () => fc.start(p) })
    }
    return out
  }
  out.push(
    paused(s)
      ? { id: 'focus:resume', title: 'Resume focus', hint: now, fa: 'fa-play', keywords: kw, run: fc.resume }
      : { id: 'focus:pause', title: 'Pause focus', hint: now, fa: 'fa-pause', keywords: kw, run: fc.pause },
    { id: 'focus:skip', title: s.phase === 'focus' ? 'Skip to the break' : 'Skip the break', hint: now, fa: 'fa-forward', keywords: kw, run: fc.skip },
    { id: 'focus:stop', title: 'Stop focus', hint: now, fa: 'fa-stop', keywords: kw, run: fc.stop },
  )
  return out
}

// the scene gallery, a random one, and each scene by name
function scenes(c) {
  const now = c.scene ? sceneName(c.scene) : null
  return [
    { id: 'gallery', title: 'Scene gallery', hint: now ? `now: ${now}` : undefined, fa: 'fa-images', keywords: ['change scene', 'background', 'wallpaper', 'city'], run: c.openGallery },
    { id: 'shuffle', title: 'Random scene', fa: 'fa-shuffle', keywords: ['change scene', 'shuffle', 'surprise'], run: c.shuffleScene },
    ...SCENES.map((id) => ({ id: `scene:${id}`, title: sceneName(id), hint: id === c.scene ? 'Scene · showing' : 'Scene', fa: 'fa-city', keywords: ['scene'], run: () => c.pickScene(id) })),
  ]
}

// ---- the apps: the Services card's, each opening in a new tab ----

export function quickServices(priv) {
  const groups = [...SERVICES, ...(priv?.services?.length ? [{ section: 'Internal', items: priv.services }] : [])]
  return groups.flatMap(({ section, items }) =>
    items.map((s) => ({
      id: `svc:${s.href}`,
      title: s.name,
      hint: s.host ?? domainOf(s.href),
      fa: s.fa,
      img: s.fa ? undefined : s.icon,
      keywords: [section],
      group: 'service',
      run: () => openTab(s.href),
    })),
  )
}

// ---- typed commands (the owner's) ----

// what's typed -> the row that does it (on top of the matches), or null
function commandItem(q, c) {
  const cmd = c.owner ? command(q) : null
  if (cmd?.kind === 'remind' && c.rm?.on) {
    return { id: 'cmd:remind', title: `Remind me: ${cmd.text}`, hint: 'add a reminder', fa: 'fa-bell', wait: 'Adding…', run: () => c.rm.add(cmd.text) }
  }
  if (cmd?.kind === 'pin' && c.pn?.on) {
    const run = async () => ((await c.pn.add(cmd.url)) ? null : "Couldn't pin that: check the connection and try again")
    return { id: 'cmd:pin', title: `Pin ${domainOf(cmd.url) || cmd.url}`, hint: cmd.url, fa: 'fa-thumbtack', wait: 'Pinning…', run }
  }
  return null
}

// ---- the palette ----

// scroll the list just enough to show `el`
function keepInView(box, el) {
  if (!box || !el) return
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.top < b.top) box.scrollTop -= b.top - r.top
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
}

export function QuickPalette({ dlg, ctx }) {
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(null) // what the row run waits for says (its `wait`), till it's done
  const [err, setErr] = useState(null)
  const [recent, setRecent] = useState([])
  const field = useRef(null)
  const list = useRef(null)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  useEffect(() => {
    if (!open) return
    setRecent(load(RECENT_KEY, []))
    field.current?.focus()
  }, [open])

  // (only built while open: the page re-renders every second)
  const items = open ? [...quickActions(ctx), ...quickServices(ctx.priv)] : []
  const typed = q.trim()
  const cmd = open && typed ? commandItem(q, ctx) : null
  // something typed: the matches, then a Google search for it (the only row when nothing here matches: Enter's)
  const web = typed ? { id: 'cmd:web', title: `Search Google for “${typed}”`, hint: 'google.com', fa: 'fa-brands fa-google', run: () => openTab(googleUrl(typed)) } : null
  const found = !open || !typed ? [] : [...(cmd ? [cmd] : []), ...rank(items, q)]
  const rows = !open ? [] : typed ? [...found, web] : startList(items, recent)
  const at = Math.max(0, Math.min(active, rows.length - 1))
  useEffect(() => void keepInView(list.current, list.current?.querySelector(`[data-i="${at}"]`)), [at, typed])

  const type = (v) => (setQ(v), setActive(0), setErr(null))
  async function go(item) {
    if (!item || busy) return
    const d = dlg.current
    if (!item.id.startsWith('cmd:')) {
      const next = remember(recent, item.id)
      setRecent(next)
      save(RECENT_KEY, next)
    }
    if (!item.wait) {
      d?.close() // at once: what it opens takes its place
      return item.run()
    }
    setBusy(item.wait)
    setErr(null)
    let why = null
    try {
      why = await item.run()
    } catch {
      why = "That didn't work: try again"
    }
    setBusy(null)
    if (why) return d?.open && setErr(why) // (closed meanwhile: not kept for the next time it opens)
    closeDialog(d)
  }
  function onKeyDown(e) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return // (a Vietnamese / CJK input method is composing: its Enter)
    const n = rows.length
    // ↓ / ↑, and Tab / Shift+Tab as in Spotlight: the row moves, the typing stays in the field (round at the ends)
    const step = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) ? 1 : e.key === 'ArrowUp' || e.key === 'Tab' ? -1 : 0
    if (step) {
      e.preventDefault()
      if (n) setActive((at + step + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(rows[at])
    }
  }
  const close = () => closeDialog(dlg.current)

  return (
    <dialog
      ref={dlg}
      aria-label="Quick actions"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => (delete dlg.current.dataset.closing, setQ(''), setActive(0), setErr(null), setBusy(null))}
      className="wx-sheet qk-sheet glass-panel text-lofi-text"
    >
      <div className="flex flex-col min-h-0 grow">
        <div className="shrink-0 flex items-center gap-3 px-4 sm:px-5 h-16 border-b border-white/5">
          <Search size={18} strokeWidth={2} className="shrink-0 text-lofi-primary" aria-hidden="true" />
          <input
            ref={field}
            value={q}
            onChange={(e) => type(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-label="Search actions and apps"
            aria-expanded={rows.length > 0}
            aria-controls="qk-list"
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? `qk-opt-${at}` : undefined}
            placeholder="Type an action or an app…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-white text-base sm:text-[15px] placeholder:text-lofi-muted/80"
          />
          <button
            type="button"
            onClick={close}
            aria-label="Close quick actions"
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {/* (always there, empty when there's nothing to say: a live region added with its text isn't always read out) */}
        <p role="status" className={busy || err ? `shrink-0 px-5 pt-2.5 text-xs font-mono ${err ? 'text-red-400' : 'text-lofi-muted'}` : 'sr-only'}>
          {err ?? busy ?? ''}
        </p>
        <p id="qk-head" className="shrink-0 px-5 pt-3 pb-1 text-[10px] font-mono uppercase tracking-widest text-lofi-muted">
          {typed ? (found.length ? 'Best matches' : `Nothing here matches “${typed}”: ↵ searches Google`) : 'Suggested'}
        </p>
        <ul
          ref={list}
          id="qk-list"
          role="listbox"
          aria-labelledby="qk-head"
          data-scroll
          className="min-h-0 grow overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y px-2 pb-2"
        >
          {rows.map((it, i) => (
            <li
              key={it.id}
              id={`qk-opt-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === at}
              onPointerMove={(e) => e.pointerType === 'mouse' && i !== at && setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // (the field keeps focus: the keys go on working)
              onClick={() => go(it)}
              className={`group relative flex items-center gap-3 min-h-12 px-3 py-1.5 rounded-xl cursor-pointer select-none transition-colors ${
                i === at ? 'bg-white/[0.07] text-white' : 'text-lofi-text hover:bg-white/[0.04]'
              } ${busy && i === at ? 'opacity-60' : ''}`}
            >
              {i === at && <span aria-hidden="true" className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-full bg-lofi-primary" />}
              <span aria-hidden="true" className={`w-8 h-8 shrink-0 rounded-lg border border-white/5 flex items-center justify-center ${i === at ? 'bg-lofi-primary/15 text-lofi-primary' : 'bg-lofi-base/50 text-lofi-muted'}`}>
                {it.img ? <img src={it.img} alt="" width={18} height={18} loading="lazy" className="w-[18px] h-[18px] object-contain" /> : <i className={`${it.fa?.includes(' ') ? it.fa : `fa-solid ${it.fa}`} text-[13px]`} />}
              </span>
              <span className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <span className="text-sm truncate">{it.title}</span>
                {it.hint && <span className="text-[11px] font-mono text-lofi-muted truncate sm:ml-auto">{it.hint}</span>}
              </span>
              {it.kbd && <kbd className="shrink-0 min-w-6 h-6 px-1.5 rounded-md border border-white/10 bg-lofi-base/50 text-[10px] font-mono text-lofi-muted flex items-center justify-center">{it.kbd}</kbd>}
              {i === at && <CornerDownLeft size={14} aria-hidden="true" className="max-sm:hidden shrink-0 text-lofi-primary" />}
            </li>
          ))}
        </ul>
        <p aria-hidden="true" className="max-sm:hidden shrink-0 px-5 py-2.5 border-t border-white/5 text-[10px] font-mono text-lofi-muted flex items-center gap-4">
          <span>↑ ↓ / tab move</span>
          <span>↵ run</span>
          <span>esc close</span>
          {(ctx.owner && (ctx.rm?.on || ctx.pn?.on)) && <span className="ml-auto">{[ctx.rm?.on && 'remind …', ctx.pn?.on && 'pin <link>'].filter(Boolean).join(' · ')}</span>}
        </p>
      </div>
    </dialog>
  )
}
