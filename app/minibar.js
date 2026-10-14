'use client'

// The slim cards under Sounds (Reminders, Pins): one line each, the Sounds card's height, so the left column reads as a
// stack of small bars. The line says how many and the newest; a tap opens the whole card in a sheet (wx-sheet: a bottom
// sheet on phones, a centered panel from sm). icon: a Lucide component. warm: tinted (something wants doing).
import { Plus } from 'lucide-react'
import { Bone } from './skeleton'

const btn = 'w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors'

export function MiniBar({ label, icon: Icon, value, detail, warm = false, onOpen, onAdd, addLabel, openLabel }) {
  return (
    <section aria-label={label} className="glass-panel rounded-3xl p-3">
      <div className="h-8 pl-3 pr-0.5 rounded-full bg-lofi-base/40 border border-white/5 flex items-center gap-2 min-w-0 font-mono text-[11px]">
        <Icon size={13} strokeWidth={2} className={`shrink-0 ${warm ? 'text-lofi-primary' : 'text-lofi-muted'}`} aria-hidden="true" />
        <button type="button" onClick={() => onOpen()} aria-haspopup="dialog" aria-label={openLabel} className="min-w-0 flex-1 truncate text-left hover:text-white transition-colors">
          <span className="text-lofi-muted">{label} · </span>
          <span className={warm ? 'text-white' : 'text-lofi-text'}>{value}</span>
          {detail && <span className="text-lofi-muted"> · {detail}</span>}
        </button>
        <button type="button" onClick={onAdd} aria-haspopup="dialog" aria-label={addLabel} title={addLabel} className={`${btn} bg-lofi-primary/15 text-lofi-primary hover:bg-lofi-primary/25`}>
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

// its skeleton: the same bar, the line a stand-in (owner-only like the cards: sk-owner, sk-force once the owner's known)
export function MiniBarSkeleton({ label, force }) {
  return (
    <section aria-label={label} aria-busy="true" className={`glass-panel rounded-3xl p-3 sk-owner ${force ? 'sk-force' : ''}`}>
      <span className="sr-only">Loading {label.toLowerCase()}…</span>
      <div aria-hidden="true" className="h-8 pl-3 pr-0.5 rounded-full bg-lofi-base/40 border border-white/5 flex items-center gap-2 min-w-0 font-mono text-[11px]">
        <Bone w="13px" />
        <span className="min-w-0 flex-1"><Bone w="18ch" /></span>
        <span className={`${btn} bg-white/5 sk-pulse`} />
      </div>
    </section>
  )
}
