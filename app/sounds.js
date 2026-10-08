'use client'

// Sounds: the ambient-sound mixer (rain, wind, brown noise, a fireplace, the sea) for everyone, under whatever music
// plays. The rules and the raw sound live in lib/sounds.js, the Web Audio graph in lib/sound-engine.js; this is the
// hook that runs it for the page, the panel (the dock's 〰 button / A) and the little mute chip on Ambient's bar and the
// lock screen. Sounds never touch the radio, the home station or Spotify: their own graph, their own volume.
import { useEffect, useRef, useState } from 'react'
import {
  LAYERS, PRESETS, SOUND_TIMERS, SOUNDS_DEFAULT, applyPreset, audibleLayers, layerById, minutesLeft, mixGains, presetOf, setLayer, shownLayers, timerEnd,
} from '../lib/sounds'
import { SLEEP_TAU, TAU, buildVoice, createEngine, loadFile, pump, ramp } from '../lib/sound-engine'
import { Choice, closeDialog } from './settings'

const PUMP_MS = 20_000 // top up the envelopes (lib/sound-engine.js AHEAD = 90 s: plenty for a throttled hidden tab)

// The engine for the page. mix: the saved mix (settings.sounds). Nothing plays on page load (browsers block it, and
// it'd be a surprise): the mix is restored, and the first tap on a tile, a preset or ▶ starts it.
// -> { supported, playing, muted, on (playing with something switched on: the chips show), endsAt (sleep timer, epoch ms),
//      failed (recorded layers whose file wouldn't load), start, stop, toggleMute }
export function useSounds(mix) {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [endsAt, setEndsAt] = useState(null)
  const [supported, setSupported] = useState(true)
  const [failed, setFailed] = useState([])
  const [loaded, setLoaded] = useState(0) // bumps when a recorded loop has been decoded, so it joins in
  const en = useRef(null) // the engine (lib/sound-engine.js), made on the first tap
  const t = useRef({ idle: 0, pump: 0, slow: false, want: false }).current

  // The AudioContext, made (or woken) inside a tap: iOS only lets a page start sound from one. Not 'playback' for
  // iOS's audio session: that would stop the Spotify app playing on the same phone, and sounds go along with music.
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
  const start = () => wake() && (setMuted(false), setPlaying(true))
  const stop = () => setPlaying(false)
  const toggleMute = () => (muted && wake(), setMuted(!muted))

  // the mix, play / pause and mute -> the graph. Each layer fades (~1.5 s) to its level; a layer that's turned off fades
  // out and then stops (its loops let go); with nothing to hear, the context is suspended once the fade is done (no CPU)
  useEffect(() => {
    const e = en.current
    if (!e) return
    const g = mixGains(mix, { playing, muted })
    const tau = t.slow ? SLEEP_TAU : TAU
    t.slow = false
    ramp(e.ctx, e.master.gain, g.master, tau)
    let any = false
    for (const l of LAYERS) {
      const v = e.voices.get(l.id), want = g.layers[l.id]
      if (want > 0 && (v || playing)) {
        let voice = v
        if (!voice) {
          if (l.kind === 'file' && !e.files.get(l.id)?.buffer) {
            // a recorded loop: fetched and decoded the first time it's wanted, then this runs again
            if (!failed.includes(l.id)) loadFile(e, l).then(() => setLoaded((n) => n + 1), () => setFailed((f) => (f.includes(l.id) ? f : [...f, l.id])))
            continue
          }
          e.voices.set(l.id, (voice = buildVoice(e, l)))
        }
        clearTimeout(voice.stopT)
        voice.stopT = 0
        ramp(e.ctx, voice.gain.gain, want)
        any = true
      } else if (v && !v.stopT) {
        ramp(e.ctx, v.gain.gain, 0)
        v.stopT = setTimeout(() => (v.stop(), e.voices.get(l.id) === v && e.voices.delete(l.id)), TAU * 5000 + 100)
      }
    }
    clearTimeout(t.idle)
    t.want = g.master > 0 && any
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

  // nothing switched on any more (all tiles off, Reset): stopped, so ▶ means something next time
  useEffect(() => {
    if (playing && !audibleLayers(mix).length) setPlaying(false)
  }, [mix, playing])

  // Sleep timer: counts from when sounds start (or from a change while they play); at the end everything fades out
  // slowly (~10 s) and stops
  useEffect(() => setEndsAt(playing ? timerEnd(Date.now(), mix.timer) : null), [playing, mix.timer])
  useEffect(() => {
    if (!endsAt) return
    const i = setInterval(() => Date.now() >= endsAt && ((t.slow = true), setPlaying(false)), 1000)
    return () => clearInterval(i)
  }, [endsAt])

  // A context that should be sounding but isn't (iOS suspends it for a call or a locked screen, or a start outside a
  // tap was refused): the next tap or key anywhere on the page wakes it
  useEffect(() => {
    const kick = () => t.want && en.current && en.current.ctx.state !== 'running' && en.current.ctx.resume().catch(() => {})
    addEventListener('pointerup', kick, true)
    addEventListener('keydown', kick, true)
    return () => {
      removeEventListener('pointerup', kick, true)
      removeEventListener('keydown', kick, true)
      clearInterval(t.pump)
      clearTimeout(t.idle)
      t.pump = 0
      en.current?.ctx.close().catch(() => {})
      en.current = null
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
