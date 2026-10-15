'use client'

// The slim cards under Sounds (Reading): one line each, the Sounds card's height, so the left column reads as a stack
// of small bars. The line says how many and the newest; a tap opens the whole card in a sheet (wx-sheet: a bottom
// sheet on phones, a centered panel from sm). icon: a Lucide component. warm: tinted (something wants doing).
// onAdd: the + at the end (Reminders, Pins); left out, no + (Reading: nothing to add from here). tail: the line's end
// that never gives way (Reading's "1%"): the rest truncates before it.
import { Plus } from 'lucide-react'
import { Bone } from './skeleton'

const btn = 'w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors'

export function MiniBar({ label, icon: Icon, value, detail, tail, warm = false, onOpen, onAdd, addLabel, openLabel }) {
  return (
    <section aria-label={label} className="glass-panel rounded-3xl p-3">
      <div className={`h-8 pl-3 ${onAdd ? 'pr-0.5' : 'pr-3'} rounded-full bg-lofi-base/40 border border-white/5 flex items-center gap-2 min-w-0 font-mono text-[11px]`}>
        <Icon size={13} strokeWidth={2} className={`shrink-0 ${warm ? 'text-lofi-primary' : 'text-lofi-muted'}`} aria-hidden="true" />
        <button type="button" onClick={() => onOpen()} aria-haspopup="dialog" aria-label={openLabel} className="min-w-0 flex-1 flex text-left hover:text-white transition-colors">
          <span className="min-w-0 truncate">
            <span className="text-lofi-muted">{label} · </span>
            <span className={warm ? 'text-white' : 'text-lofi-text'}>{value}</span>
            {detail && <span className="text-lofi-muted"> · {detail}</span>}
          </span>
          {tail && <span className="shrink-0 whitespace-pre text-lofi-muted"> {tail}</span>}
        </button>
        {onAdd && (
          <button type="button" onClick={onAdd} aria-haspopup="dialog" aria-label={addLabel} title={addLabel} className={`${btn} bg-lofi-primary/15 text-lofi-primary hover:bg-lofi-primary/25`}>
            <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  )
}

// its skeleton: the same bar, the line a stand-in (owner-only like the cards: sk-owner, sk-force once the owner's known).
// add: its + too (as the bar has one); className: more skeleton classes (Reading's sk-reading)
export function MiniBarSkeleton({ label, force, add = true, className = '' }) {
  return (
    <section aria-label={label} aria-busy="true" className={`glass-panel rounded-3xl p-3 sk-owner ${force ? 'sk-force' : ''} ${className}`}>
      <span className="sr-only">Loading {label.toLowerCase()}…</span>
      <div aria-hidden="true" className={`h-8 pl-3 ${add ? 'pr-0.5' : 'pr-3'} rounded-full bg-lofi-base/40 border border-white/5 flex items-center gap-2 min-w-0 font-mono text-[11px]`}>
        <Bone w="13px" />
        <span className="min-w-0 flex-1"><Bone w="18ch" /></span>
        {add && <span className={`${btn} bg-white/5 sk-pulse`} />}
      </div>
    </section>
  )
}

// The same things as a header icon next to the bell (Reminders, Pins): the bell's square, a Lucide icon, a count badge
// when there's something to count. warm: tinted (something wants doing). Its skeleton is the bell's stand-in square
export function HeadIcon({ label, icon: Icon, count = 0, warm = false, onOpen, className = '' }) {
  return (
    <button
      type="button"
      onClick={() => onOpen()}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      className={`${className} relative w-11 h-11 shrink-0 rounded-xl bg-lofi-base/50 border border-white/5 flex items-center justify-center hover:text-lofi-primary hover:border-white/20 transition-colors ${warm ? 'text-lofi-primary' : 'text-lofi-text'}`}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-bold tabular-nums flex items-center justify-center ${warm ? 'bg-lofi-primary text-lofi-base' : 'bg-lofi-surface text-lofi-text border border-white/10'}`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
export function HeadIconSkeleton({ force, className = '' }) {
  return <span aria-hidden="true" className={`sk-owner ${force ? 'sk-force' : ''} ${className} w-11 h-11 shrink-0 rounded-xl bg-lofi-base/50 border border-white/5 sk-pulse`} />
}
