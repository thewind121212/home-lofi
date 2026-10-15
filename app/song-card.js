'use client'

// A song's card, the same wherever a song is pressed (the Spotify tab: the one playing and Up next; the Player tab:
// the one playing and its Up next / Last played rows): the big cover, title, artists, album and a link out. A sheet
// like the others (.wx-sheet: the bottom sheet on phones, a small centered panel from sm; ✕, Esc or the backdrop close
// it, the page stays still). It opens as it mounts; onClosed: it has gone (unmount it then).
// t: { track, artists: [], album, art, url }; kicker: the line over the cover; eq: the green bars (it's playing)
import { useEffect, useRef } from 'react'
import { closeDialog, useStillPage } from './settings'

// where the link goes, from its host: Spotify (its green) or YouTube; anything else, plainly
function linkOut(url) {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  if (host === 'open.spotify.com') return { label: 'Open in Spotify', icon: 'fa-brands fa-spotify', cls: 'bg-[#1db954] text-lofi-base' }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return { label: 'Open on YouTube', icon: 'fa-brands fa-youtube', cls: 'bg-[#ff0033] text-white' }
  return { label: 'Open the link', icon: 'fa-solid fa-arrow-up-right-from-square', cls: 'bg-lofi-primary text-lofi-base' }
}

export function SongSheet({ t, kicker, eq = false, onClosed }) {
  const dlg = useRef(null)
  useStillPage(dlg, true)
  useEffect(() => {
    const d = dlg.current
    d?.open || d?.showModal()
  }, [])
  const close = () => closeDialog(dlg.current)
  const artists = (t.artists ?? []).filter(Boolean).join(', ')
  const out = t.url ? linkOut(t.url) : null
  return (
    <dialog
      ref={dlg}
      aria-labelledby="song-title"
      onClick={(e) => e.target === dlg.current && close()}
      onCancel={(e) => (e.preventDefault(), close())}
      onClose={() => (delete dlg.current.dataset.closing, onClosed())}
      className="wx-sheet sm:max-w-sm glass-panel text-lofi-text overscroll-contain"
    >
      <div className="relative p-5 sm:p-6 flex flex-col items-center text-center">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-lofi-base/60 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white transition-colors"
        >
          <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
        </button>
        <p className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-lofi-muted mb-3">
          {eq && (
            <span className="flex items-end gap-px h-2.5" aria-hidden="true">
              {['60%', '100%', '45%'].map((h, i) => (
                <span key={i} className="w-[2px] rounded-full bg-[#1db954] origin-bottom animate-eq" style={{ height: h, animationDelay: `${i * -0.23}s` }} />
              ))}
            </span>
          )}
          {kicker}
        </p>
        {t.art ? (
          <img src={t.art} alt="" width={176} height={176} className="w-44 h-44 rounded-2xl object-cover shadow-2xl ring-1 ring-white/10 mb-4" />
        ) : (
          <span className="w-44 h-44 rounded-2xl bg-lofi-surface flex items-center justify-center text-lofi-muted mb-4">
            <i className="fa-solid fa-music text-3xl" aria-hidden="true" />
          </span>
        )}
        <h2 id="song-title" className="w-full text-base font-medium text-white line-clamp-2 break-words">{t.track}</h2>
        {artists && <p className="w-full text-sm text-lofi-muted truncate">{artists}</p>}
        {t.album && <p className="w-full text-[11px] font-mono text-lofi-muted/80 truncate mt-0.5">{t.album}</p>}
        {out && (
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-4 h-9 px-5 rounded-full text-xs font-bold flex items-center gap-2 hover:scale-105 transition-transform ${out.cls}`}
          >
            <i className={out.icon} aria-hidden="true" /> {out.label}
          </a>
        )}
      </div>
    </dialog>
  )
}
