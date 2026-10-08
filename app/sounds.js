'use client'

// Sounds: the ambient-sound mixer (rain, wind, brown noise, a fireplace, the sea) for everyone, under whatever music
// plays. The rules and the raw sound live in lib/sounds.js, the Web Audio graph in lib/sound-engine.js; this is the
// hook that runs it for the page, the panel (A, or the music card's Sounds row), that row, and the little mute chip on
// Ambient's bar and the lock screen. Sounds never touch the radio, the home station or Spotify: their own graph, their own volume.
// On a phone they play on like music with the screen locked (lib/sounds.js soundsMedia: a playback audio session and a
// quiet <audio> loop next to the graph), with their own title and ⏯ on the lock screen when no music of the page plays.
import { useEffect, useRef, useState } from 'react'
import {
  PRESETS, SOUND_TIMERS, SOUNDS_DEFAULT, applyPreset, audibleLayers, layerById, loopEvent, loopPlan, minutesLeft, mixPlan, presetOf, quietWav,
  setLayer, shownLayers, soundsLabel, soundsLine, soundsMedia, timerEnd,
} from '../lib/sounds'
import { SLEEP_TAU, TAU, buildVoice, createEngine, loadFile, pump, ramp } from '../lib/sound-engine'
import { claimMediaSession, mediaSessionOwner } from './radio'
import { Choice, closeDialog } from './settings'

const PUMP_MS = 20_000 // top up the envelopes (lib/sound-engine.js AHEAD = 90 s: plenty for a throttled hidden tab)

// iOS's audio session for the page (Safari 16.4+; elsewhere there's none and this does nothing): 'playback' while
// sounds play (on with the screen locked, past the silent switch; like any music player it pauses other apps' audio on
// the phone, as the radio does), 'auto' again after
function audioSession(type) {
  try {
    const s = navigator.audioSession
    if (s && s.type !== type) s.type = type
  } catch {}
}

// The lock screen's picture for sounds: a wave in the theme's colour on the night sky (drawn once)
let cover = null
function soundsCover() {
  if (cover) return cover
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 256, 256)
  grad.addColorStop(0, '#2a2f4a')
  grad.addColorStop(1, '#10121e')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#ff8a5c'
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-lofi-primary').trim() || '#ff8a5c' // (kept if it can't parse it)
  g.lineWidth = 14
  g.lineCap = 'round'
  g.beginPath()
  for (let x = 48; x <= 208; x += 2) g[x === 48 ? 'moveTo' : 'lineTo'](x, 128 + Math.sin(((x - 48) / 160) * Math.PI * 3) * 30)
  g.stroke()
  return (cover = c.toDataURL('image/png'))
}

// The engine for the page. mix: the saved mix (settings.sounds); music: the radio or the Player's Listen is playing in
// this page (they keep the lock screen then). Nothing plays on page load (browsers block it, and it'd be a surprise):
// the mix is restored, and the first tap on a tile, a preset or ▶ starts it.
// -> { supported, playing, muted, on (playing with something switched on: the chips show), endsAt (sleep timer, epoch ms),
//      failed (recorded layers whose file wouldn't load), start, stop, toggleMute }
export function useSounds(mix, { music = false } = {}) {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [endsAt, setEndsAt] = useState(null)
  const [supported, setSupported] = useState(true)
  const [failed, setFailed] = useState([])
  const [loaded, setLoaded] = useState(0) // bumps when a recorded loop has been decoded, so it joins in
  const en = useRef(null) // the engine (lib/sound-engine.js), made on the first tap
  const t = useRef({ idle: 0, pump: 0, slow: false, want: false, tau: TAU }).current
  // the quiet <audio> loop (lib/sounds.js quietWav): el, its Blob URL, held (this page wants it playing), cut (the
  // system paused it: a call, Siri, another app taking the audio), release (the timer that lets it go after a stop)
  const bg = useRef({ el: null, url: null, held: false, cut: false, release: 0 }).current
  const media = soundsMedia({ playing, audible: audibleLayers(mix).length, music })
  const mixRef = useRef(mix)
  mixRef.current = mix

  // The quiet loop and the playback session: on (inside a tap the first time: iOS only lets a page start media from
  // one; later the lock screen's ▶, which counts as one) and off. The sound itself stays on the Web Audio graph
  // (lib/sound-engine.js, straight to the speakers, as on a desktop): the loop only makes the page a media player.
  // (the session only once the loop exists: with no loop, nothing would ever let it go, and it'd go on pausing other apps)
  function holdOn() {
    if (!bg.el) {
      try {
        bg.url = URL.createObjectURL(new Blob([quietWav()], { type: 'audio/wav' }))
        bg.el = new Audio(bg.url)
        bg.el.loop = true
        bg.el.addEventListener('pause', onCut)
        bg.el.addEventListener('play', onBack)
      } catch {
        if (bg.url) URL.revokeObjectURL(bg.url)
        bg.el = bg.url = null
        return
      }
    }
    audioSession('playback')
    clearTimeout(bg.release)
    bg.held = true
    bg.cut = false
    if (bg.el.paused) bg.el.play().catch(() => {})
  }
  function holdOff() {
    clearTimeout(bg.release)
    bg.held = false
    bg.el?.pause()
    audioSession('auto')
  }
  // the loop's own pause / play events (lib/sounds.js loopEvent): the system pausing it stops the sounds (the lock
  // screen's ▶, or the panel's, starts them again); the system playing it again after that brings them back
  const loopState = () => ({ held: bg.held, paused: bg.el.paused, cut: bg.cut })
  function onCut() {
    if (loopEvent('pause', loopState()) !== 'cut') return
    bg.held = false
    bg.cut = true
    setPlaying(false)
  }
  function onBack() {
    const what = loopEvent('play', loopState())
    if (what === 'refuse') return bg.el.pause() // not ours to play
    if (what !== 'resume') return
    bg.cut = false
    bg.held = true
    wake()
    setPlaying(true)
  }

  // The AudioContext, made (or woken) inside a tap: iOS only lets a page start sound from one.
  function wake() {
    if (!en.current) {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext
      try {
        en.current = createEngine(new AC({ latencyHint: 'playback' })) // 'playback': bigger buffers, less CPU
      } catch {
        setSupported(false)
        return null
      }
    }
    const { ctx } = en.current
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    return en.current
  }
  const start = () => wake() && (holdOn(), setMuted(false), setPlaying(true))
  const stop = () => setPlaying(false)
  const toggleMute = () => (muted && wake(), setMuted(!muted))

  // the mix, play / pause and mute -> the graph. Each layer fades (~1.5 s) to its level; a layer that's turned off fades
  // out and then stops (its loops let go); with nothing to hear, the context is suspended once the fade is done (no CPU)
  useEffect(() => {
    const e = en.current
    if (!e) return
    // (lib/sounds.js mixPlan: a mix from another device glides like a local one, and never starts a page that's paused)
    const plan = mixPlan(mix, { playing, muted, voices: Object.fromEntries([...e.voices].map(([id, v]) => [id, v.stopT ? 'stopping' : 'on'])) })
    const tau = (t.tau = t.slow ? SLEEP_TAU : TAU)
    t.slow = false
    ramp(e.ctx, e.master.gain, plan.master, tau)
    let any = false
    for (const [id, step] of Object.entries(plan.steps)) {
      const l = layerById(id), v = e.voices.get(id)
      if (step.do === 'release') {
        ramp(e.ctx, v.gain.gain, 0)
        v.stopT = setTimeout(() => (v.stop(), e.voices.get(id) === v && e.voices.delete(id)), TAU * 5000 + 100)
        continue
      }
      let voice = v
      if (step.do === 'start') {
        if (l.kind === 'file' && !e.files.get(id)?.buffer) {
          // a recorded loop: fetched and decoded the first time it's wanted, then this runs again
          if (!failed.includes(id)) loadFile(e, l).then(() => setLoaded((n) => n + 1), () => setFailed((f) => (f.includes(id) ? f : [...f, id])))
          continue
        }
        e.voices.set(id, (voice = buildVoice(e, l)))
      }
      clearTimeout(voice.stopT)
      voice.stopT = 0
      ramp(e.ctx, voice.gain.gain, step.gain)
      any = true
    }
    clearTimeout(t.idle)
    t.want = plan.master > 0 && any
    if (t.want) {
      if (e.ctx.state !== 'running') e.ctx.resume().catch(() => {})
      e.voices.forEach((v) => pump(e, v))
      t.pump ||= setInterval(() => e.voices.forEach((v) => pump(e, v)), PUMP_MS)
    } else {
      t.idle = setTimeout(() => {
        clearInterval(t.pump)
        t.pump = 0
        e.ctx.suspend().catch(() => {})
      }, tau * 5000 + 200)
    }
  }, [mix, playing, muted, loaded, failed])

  // the quiet loop and the playback session follow the sounds: on while they play (a no-op when start() already did it
  // in the tap), let go once a stop's fade is over (any sooner, a locked phone could cut the fade short)
  useEffect(() => {
    const plan = loopPlan({ hold: media.hold, made: Boolean(bg.el), tau: t.tau })
    if (plan.hold) return holdOn()
    if (plan.release) bg.release = setTimeout(holdOff, plan.release)
    return () => clearTimeout(bg.release)
  }, [media.hold, playing])

  // The Media Session (the lock screen / notification, media keys): taken while sounds are all that plays in the page,
  // with "Sounds", the preset or what's on, and ⏯ that stop / start them. Once it's theirs it stays (the lock screen's
  // ▶ starts them again) until the radio or the Player starts and takes it back.
  // (▶ with every sound switched off meanwhile does nothing: it would only take the playback session for a moment)
  const label = soundsLabel(mix)
  const play = () => audibleLayers(mixRef.current).length > 0 && start()
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    if (media.claim && mediaSessionOwner() !== 'sounds') claimMediaSession('sounds', { play, pause: stop, stop })
    if (mediaSessionOwner() !== 'sounds') return
    if (media.claim && typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({ title: 'Sounds', artist: label || 'Ambient sounds', album: 'Sounds · wliafdew.dev', artwork: [{ src: soundsCover(), sizes: '256x256', type: 'image/png' }] })
      try {
        ms.setPositionState?.() // no progress bar: a loop has no end (and the Player may have left one)
      } catch {}
    }
    ms.playbackState = media.hold ? 'playing' : 'paused'
  }, [media.claim, media.hold, label])

  // nothing switched on any more (all tiles off, Reset): stopped, so ▶ means something next time
  useEffect(() => {
    if (playing && !audibleLayers(mix).length) setPlaying(false)
  }, [mix, playing])

  // Sleep timer: counts from when sounds start (or from a change while they play); at the end everything fades out
  // slowly (~10 s) and stops. It watches the timer's value only, so a level or preset changed on another device (cloud
  // sync) never resets a running count. A new timer value from another device does re-arm it here, as the same tap
  // would: "stop in 30 min" picked on the PC for the phone playing in the bedroom means that phone, from now (it
  // arrives a second after the tap). A page that isn't playing just shows the new value; its count starts with ▶.
  useEffect(() => setEndsAt(playing ? timerEnd(Date.now(), mix.timer) : null), [playing, mix.timer])
  useEffect(() => {
    if (!endsAt) return
    const i = setInterval(() => Date.now() >= endsAt && ((t.slow = true), setPlaying(false)), 1000)
    return () => clearInterval(i)
  }, [endsAt])

  // A context that should be sounding but isn't (iOS suspends it for a call, or a start outside a tap was refused), or
  // a quiet loop that should be playing but was refused: the next tap or key anywhere on the page, or coming back to
  // the page, wakes them
  useEffect(() => {
    const kick = () => {
      if (t.want && en.current && en.current.ctx.state !== 'running') en.current.ctx.resume().catch(() => {})
      if (bg.held && bg.el?.paused) bg.el.play().catch(() => {})
    }
    const back = () => document.visibilityState === 'visible' && kick()
    addEventListener('pointerup', kick, true)
    addEventListener('keydown', kick, true)
    document.addEventListener('visibilitychange', back)
    return () => {
      removeEventListener('pointerup', kick, true)
      removeEventListener('keydown', kick, true)
      document.removeEventListener('visibilitychange', back)
      clearInterval(t.pump)
      clearTimeout(t.idle)
      t.pump = 0
      en.current?.ctx.close().catch(() => {})
      en.current = null
      holdOff()
      if (bg.el) bg.el.removeEventListener('pause', onCut), bg.el.removeEventListener('play', onBack), bg.el.removeAttribute('src'), bg.el.load()
      if (bg.url) URL.revokeObjectURL(bg.url)
      bg.el = bg.url = null
      if (mediaSessionOwner() === 'sounds') claimMediaSession('sounds', null)
    }
  }, [])

  return { supported, playing, muted, endsAt, failed, on: playing && audibleLayers(mix).length > 0, start, stop, toggleMute }
}

const LEGEND = 'mb-2 text-[10px] font-mono uppercase tracking-widest text-lofi-muted'
const pct = (x) => Math.round(x * 100)

// The panel: ▶ / ⏸ with what plays and the volume, the presets, a tile per sound (tap: on / off; slider: its level),
// the sleep timer, Reset. Same dialog pattern as Settings (.wx-sheet). setMix(mix) saves (and syncs, for the owner).
export function SoundsPanel({ dlg, snd, mix, setMix, now, synced }) {
  const preset = presetOf(mix)
  const on = audibleLayers(mix)
  const left = minutesLeft(snd.endsAt, +(now ?? Date.now()))
  const names = on.map((id) => layerById(id).name).join(', ')
  const status = !snd.supported
    ? "This browser can't play sounds"
    : snd.playing
      ? `${snd.muted ? 'Muted' : 'Playing'} · ${names}`
      : on.length
        ? `Paused · ${names}`
        : 'Tap a sound or a preset to start'
  // a tile tapped on (or its slider moved up from off) starts the sounds: that tap is the gesture browsers want
  const toggle = (id) => {
    const l = mix.layers[id]
    setMix(setLayer(mix, id, { on: !l.on, level: !l.on && !l.level ? 0.5 : l.level }))
    if (!l.on && (!snd.playing || snd.muted)) snd.start()
  }
  const level = (id, v) => {
    const l = mix.layers[id]
    setMix(setLayer(mix, id, { level: v, on: v > 0 || l.on }))
    if (v > 0 && (!l.on || !l.level) && !snd.playing) snd.start() // (from silent: off, or dragged down to 0)
  }
  return (
    <dialog
      ref={dlg}
      aria-labelledby="snd-title"
      onClick={(e) => e.target === dlg.current && closeDialog(dlg.current)}
      onCancel={(e) => {
        e.preventDefault() // Esc: animate out first
        closeDialog(dlg.current)
      }}
      onClose={() => delete dlg.current.dataset.closing}
      className="wx-sheet sm:max-w-xl glass-panel text-lofi-text overscroll-contain"
    >
      <div className="p-5 sm:p-7 flex flex-col gap-6">
        <div className="wx-sticky flex items-center justify-between gap-4">
          <h2 id="snd-title" className="text-xl sm:text-2xl short:text-lg font-medium text-white flex items-center gap-3">
            <i className="fa-solid fa-wave-square text-lofi-primary text-lg" aria-hidden="true" /> Sounds
          </h2>
          <button
            onClick={() => closeDialog(dlg.current)}
            aria-label="Close sounds"
            className="w-9 h-9 shrink-0 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white hover:border-lofi-primary/40 transition-colors"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        {/* ▶ / ⏸, what plays, and the sounds' own volume (the music's stays on the music card) */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => (snd.playing ? snd.stop() : snd.start())}
            disabled={!snd.supported || (!snd.playing && !on.length)}
            aria-label={snd.playing ? 'Pause sounds' : 'Play sounds'}
            className="w-12 h-12 shrink-0 rounded-full bg-lofi-primary text-lofi-base flex items-center justify-center text-base shadow-lg hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <i className={`fa-solid ${snd.playing ? 'fa-pause' : 'fa-play ml-0.5'}`} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white truncate" aria-live="polite">
              {status}
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                onClick={snd.toggleMute}
                disabled={!snd.playing}
                aria-pressed={snd.muted}
                aria-label="Mute sounds"
                title={snd.muted ? 'Unmute' : 'Mute'}
                className="w-7 h-7 shrink-0 flex items-center justify-center text-lofi-muted hover:text-white transition-colors disabled:opacity-40"
              >
                <i className={`fa-solid ${snd.muted || !mix.master ? 'fa-volume-xmark' : mix.master < 0.5 ? 'fa-volume-low' : 'fa-volume-high'} text-xs`} aria-hidden="true" />
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct(mix.master)}
                onChange={(e) => setMix({ ...mix, master: Number(e.target.value) / 100 })}
                aria-label="Sounds volume"
                className="radio-volume min-w-0 flex-1"
                style={{ '--v': `${pct(mix.master)}%` }}
              />
              <span className="w-9 text-right text-[10px] font-mono text-lofi-muted tabular-nums">{pct(mix.master)}%</span>
            </div>
          </div>
        </div>

        <div role="group" aria-labelledby="snd-presets">
          <p id="snd-presets" className={LEGEND}>
            Presets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([id, name, icon]) => (
              <button
                key={id}
                aria-pressed={preset === id}
                onClick={() => (setMix(applyPreset(mix, id)), snd.start())}
                className={`h-8 px-3 rounded-full border flex items-center gap-2 font-mono text-xs transition-colors ${
                  preset === id ? 'bg-lofi-primary border-transparent text-lofi-base font-bold' : 'bg-white/5 border-white/10 text-lofi-text hover:border-white/25 hover:text-white'
                }`}
              >
                <i className={`fa-solid ${icon} text-[11px] ${preset === id ? '' : 'text-lofi-primary'}`} aria-hidden="true" /> {name}
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-labelledby="snd-mix">
          <p id="snd-mix" className={LEGEND}>
            Mix
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {shownLayers().map((l) => {
              const m = mix.layers[l.id]
              const bad = snd.failed.includes(l.id)
              const live = snd.playing && !snd.muted && m.on && m.level > 0 && !bad
              return (
                <div key={l.id} className={`min-w-0 rounded-2xl border p-2.5 flex flex-col gap-2 transition-colors ${m.on ? 'border-lofi-primary/50 bg-lofi-primary/10' : 'border-white/10 bg-white/5'}`}>
                  <button onClick={() => toggle(l.id)} aria-pressed={m.on} className="min-w-0 flex items-center gap-2.5 text-left rounded-xl group">
                    <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${m.on ? 'bg-lofi-primary text-lofi-base' : 'bg-lofi-base/50 text-lofi-primary group-hover:text-white'}`}>
                      <i className={`fa-solid ${l.icon} text-sm ${live ? 'motion-safe:animate-pulse' : ''}`} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{l.name}</span>
                      <span className={`block text-[10px] font-mono ${bad ? 'text-red-300' : 'text-lofi-muted'}`}>{bad ? "couldn't load" : m.on ? `${pct(m.level)}%` : 'off'}</span>
                    </span>
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={pct(m.level)}
                    onChange={(e) => level(l.id, Number(e.target.value) / 100)}
                    aria-label={`${l.name} level`}
                    className={`radio-volume w-full ${m.on ? '' : 'vol-grey'}`}
                    style={{ '--v': `${pct(m.level)}%` }}
                  />
                </div>
              )
            })}
          </div>
        </div>

        <Choice legend="Sleep timer" name="snd-timer" value={mix.timer} options={SOUND_TIMERS.map((m) => [m, m ? `${m} min` : 'Off'])} onChange={(v) => setMix({ ...mix, timer: v })}>
          <p className="mt-2 text-[11px] text-lofi-muted" aria-live="polite">
            {left != null ? `Fades out and stops in ${left} min` : mix.timer ? `Counts ${mix.timer} min from when sounds start, then fades out` : 'Plays until you stop it'}
          </p>
        </Choice>

        <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex items-center gap-2 text-[11px] font-mono text-lofi-muted">
            <i className={`fa-solid ${synced ? 'fa-cloud' : 'fa-laptop'} w-4 text-center`} aria-hidden="true" />
            <span>Plays alongside the music · mix {synced ? 'synced to your devices' : 'saved in this browser'}</span>
          </p>
          <button
            onClick={() => setMix(SOUNDS_DEFAULT)}
            className="h-9 px-4 rounded-full border border-white/10 font-mono text-xs text-lofi-muted hover:text-white hover:border-red-400/60 transition-colors flex items-center gap-2"
          >
            <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset
          </button>
        </div>
      </div>
    </dialog>
  )
}

// Ambient's bar and the lock screen, while sounds play: 〰 Sounds + mute / unmute in one tap
export function SoundsChip({ snd, mix, className = '' }) {
  const names = audibleLayers(mix).map((id) => layerById(id).name).join(', ')
  return (
    <button
      onClick={snd.toggleMute}
      aria-pressed={snd.muted}
      aria-label={`Mute sounds (${names})`}
      title={`Sounds: ${names}${snd.muted ? ' (muted)' : ''}`}
      className={`flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-lofi-primary ${snd.muted ? 'text-lofi-muted' : 'text-white'} ${className}`}
    >
      <i className={`fa-solid fa-wave-square text-xs ${snd.muted ? '' : 'text-lofi-primary'}`} aria-hidden="true" />
      <span className="max-sm:hidden text-xs">Sounds</span>
      <i className={`fa-solid ${snd.muted ? 'fa-volume-xmark' : 'fa-volume-high'} text-[10px] text-lofi-muted`} aria-hidden="true" />
    </button>
  )
}

// The music card's Sounds row, under every tab: 〰, what's on (the preset, the sounds that are on, or Off), ▶ / ⏸ for the
// sounds, and the panel. The same useSounds state as the panel and the chips, so they all move together (and a mix
// changed on another device shows here too). ▶ with nothing switched on opens the panel to pick some.
export function SoundsRow({ snd, mix, onOpen }) {
  const { label, state } = soundsLine(mix, snd)
  const play = () => (snd.playing ? snd.stop() : state === 'off' ? onOpen() : snd.start())
  const note = { paused: 'paused', muted: 'muted' }[state]
  const btn = 'w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div role="group" aria-label="Sounds" className="h-8 pl-3 pr-0.5 rounded-full bg-lofi-base/40 border border-white/5 flex items-center gap-2 min-w-0 font-mono text-[11px]">
      <i className={`fa-solid fa-wave-square text-[11px] shrink-0 ${state === 'playing' ? 'text-lofi-primary motion-safe:animate-pulse' : 'text-lofi-muted'}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate" aria-live="polite" title={note ? `Sounds: ${label} (${note})` : `Sounds: ${label}`}>
        <span className="text-lofi-muted">Sounds · </span>
        <span className={state === 'playing' ? 'text-white' : 'text-lofi-text'}>{label}</span>
        {note && <span className="text-lofi-muted"> · {note}</span>}
      </p>
      <button
        onClick={play}
        disabled={state === 'unsupported'}
        aria-label={snd.playing ? 'Pause sounds' : state === 'off' ? 'Play sounds: pick some first' : `Play sounds (${label})`}
        title={snd.playing ? 'Pause sounds' : state === 'off' ? 'Pick sounds' : 'Play sounds'}
        className={`${btn} ${snd.playing ? 'bg-lofi-primary text-lofi-base hover:brightness-110' : 'bg-lofi-primary/15 text-lofi-primary hover:bg-lofi-primary/25'}`}
      >
        <i className={`fa-solid ${snd.playing ? 'fa-pause' : 'fa-play ml-px'} text-[10px]`} aria-hidden="true" />
      </button>
      <button onClick={onOpen} aria-haspopup="dialog" aria-label="Open Sounds (A)" title="Sounds: rain, wind, fire… under the music (A)" className={`${btn} text-lofi-muted hover:text-white hover:bg-white/5`}>
        <i className="fa-solid fa-sliders text-[11px]" aria-hidden="true" />
      </button>
    </div>
  )
}
