'use client'

// The owner's icons next to the header's bell (Reminders, Pins, Reading): the bell's square, a Lucide icon, a count badge
// when there's something to count; a tap opens its sheet (wx-sheet: a bottom sheet on phones, a centered panel from
// sm). warm: tinted (something wants doing). Its skeleton is the bell's stand-in square (className: more skeleton
// classes, e.g. Reading's sk-reading)
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
