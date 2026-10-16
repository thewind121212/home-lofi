'use client'

// The icons next to the header's bell (⚙️ Settings, the owner's Pins, Reading and News), and Focus on the dock: the bell's square, a Lucide icon, a count badge
// when there's something to count; a tap opens its sheet (wx-sheet: a bottom sheet on phones, a centered panel from
// sm). warm: tinted (something wants doing). ring: 0–100, a thin progress ring around the icon instead of a badge
// (Reading: how far the latest book is; a started book shows at least a sliver; Focus: how far this phase has gone).
// ringClass: the ring's colour (the accent unless said: Focus's break is a calm green). dock: the dock's round glass
// button instead of the bell's square (Focus sits on top of the dock). Its skeleton is the bell's stand-in square, or
// the dock's circle (className: more skeleton classes, e.g. Reading's sk-reading). fa: a Font Awesome glyph instead of
// the Lucide icon, as the bell and the dock's own buttons have them (Settings by the bell, Focus on the dock; a
// 'fa-brands …' one as it is: GitHub). dot: a
// small accent dot on its corner, something new without a count (News: an edition not opened yet)
const R = 13
const ROUND = 2 * Math.PI * R
const SHAPE = {
  head: 'rounded-xl bg-lofi-base/50 border border-white/5 hover:border-white/20 transition-colors',
  dock: 'glass-panel rounded-full hover:scale-105 transition',
}
export function HeadIcon({ label, icon: Icon, fa, count = 0, dot = false, warm = false, ring = null, ringClass = 'stroke-lofi-primary', dock = false, onOpen, className = '' }) {
  const arc = Number.isFinite(ring) && ring > 0 ? Math.max(4, Math.min(100, ring)) : 0
  return (
    <button
      type="button"
      onClick={() => onOpen()}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      className={`${className} relative w-11 h-11 shrink-0 ${SHAPE[dock ? 'dock' : 'head']} flex items-center justify-center hover:text-lofi-primary ${warm ? 'text-lofi-primary' : 'text-lofi-text'}`}
    >
      {ring != null && (
        <svg viewBox="0 0 30 30" className="absolute w-[30px] h-[30px] -rotate-90" aria-hidden="true">
          <circle cx="15" cy="15" r={R} fill="none" strokeWidth="2" className="stroke-white/10" />
          {arc > 0 && <circle cx="15" cy="15" r={R} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(arc / 100) * ROUND} ${ROUND}`} className={`${ringClass} transition-[stroke-dasharray,stroke] duration-700`} />}
        </svg>
      )}
      {fa ? <i className={`${fa.startsWith('fa-brands') ? '' : 'fa-solid '}${fa} ${ring != null ? 'text-[11px]' : 'text-sm'}`} aria-hidden="true" /> : <Icon size={ring != null ? 13 : 16} strokeWidth={2} aria-hidden="true" />}
      {dot && count <= 0 && <span aria-hidden="true" className="absolute top-2 right-2 w-2 h-2 rounded-full bg-lofi-primary ring-2 ring-lofi-base" />}
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
export function HeadIconSkeleton({ force, dock = false, className = '' }) {
  return <span aria-hidden="true" className={`sk-owner ${force ? 'sk-force' : ''} ${className} w-11 h-11 shrink-0 ${dock ? 'glass-panel rounded-full' : 'rounded-xl bg-lofi-base/50 border border-white/5'} sk-pulse`} />
}
