'use client'

import { useEffect, useRef, useState } from 'react'
import { STATE_LOOK, blocksOf, byProject, isLong, spansOf } from '../lib/agents'
import { ago, left } from '../lib/notify'
import { closeDialog, useStillPage } from './settings'
import { useFlip } from './flip'
import { flipSig } from '../lib/flip'
import { NoticeIcon, TEXT, fullDate, popUnder } from './notify'

// The agents' messages on the page (rules in lib/agents.js; the same hub as the bell, its own channel: app/notify.js
// useNotify(…, { ch: 'agents' })). The 🤖 next to the bell with its own count, and an inbox grouped by project: each
// card has the state's chip, the agent, the time, the title and the content (3 lines, then Show more). Pop-ups for
// needs-you and failed ride with the bell's (app/notify.js Toasts).

const CHIP = {
  highlight: 'text-lofi-highlight border-lofi-highlight/40 bg-lofi-highlight/10',
  red: 'text-red-400 border-red-400/40 bg-red-400/10',
  green: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  muted: 'text-lofi-muted border-white/10 bg-white/5',
}

// The header's 🤖, the bell's twin (its size and well). Its badge counts unread needs-you / failed / done (not working);
// amber while one of them needs the owner
export function AgentsIcon({ hub, onOpen, ref }) {
  const { unread } = hub
  const waiting = hub.items.some((i) => i.id > hub.read && i.state === 'needs-you')
  return (
    <button
      ref={ref}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={unread ? `Agents, ${unread} new${waiting ? ', one needs you' : ''}` : 'Agents'}
      title="Agents"
      className="relative w-11 h-11 shrink-0 rounded-xl bg-lofi-base/50 border border-white/5 flex items-center justify-center text-lofi-text hover:text-lofi-primary hover:border-white/20 transition-colors"
    >
      <i className={`fa-solid fa-robot text-sm ${waiting ? 'text-lofi-highlight' : unread ? 'text-lofi-primary' : ''}`} aria-hidden="true" />
      {unread > 0 && (
        <span
          key={unread}
          aria-hidden="true"
          className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full ${waiting ? 'bg-lofi-highlight' : 'bg-lofi-primary'} text-lofi-base text-[10px] font-mono font-bold tabular-nums flex items-center justify-center shadow-lg motion-safe:animate-[pop-in_0.25s_ease-out]`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

// The inbox: like the bell's (a bottom sheet on phones, a popover under the 🤖 from sm), grouped by project instead of
// by day. Opening it reads everything (every device); what was new keeps its dot until it closes.
export function AgentsInbox({ dlg, anchor, hub, now }) {
  const t = now ?? Date.now()
  const groups = byProject(hub.items)
  const fresh = hub.items.filter((i) => i.id > hub.shownRead && i.state !== 'working').length
  const [open, setOpen] = useState(false)
  useStillPage(dlg, open)
  const rows = useRef(null)
  useFlip(rows, flipSig(groups.flatMap(([p, list]) => [`~p:${p}`, ...list.map((i) => i.id)])), { paused: !open, resize: true })
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    const seen = new MutationObserver(() => setOpen(d.open))
    seen.observe(d, { attributes: true, attributeFilter: ['open'] })
    return () => seen.disconnect()
  }, [dlg])
  useEffect(() => {
    const onResize = () => dlg.current?.open && popUnder(dlg.current, anchor.current)
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [dlg, anchor])
  return (
    <dialog
      ref={dlg}
      aria-labelledby="agt-title"
      onClick={(e) => e.target === dlg.current && closeDialog(dlg.current)}
      onCancel={(e) => {
        e.preventDefault()
        closeDialog(dlg.current)
      }}
      onClose={() => (delete dlg.current.dataset.closing, hub.markAllRead())}
      className="wx-sheet scene-pop inbox-pop glass-panel text-lofi-text"
    >
      <div className="p-5 sm:p-4 min-h-0 flex flex-col gap-6 sm:gap-3">
        <div className="wx-sticky shrink-0 flex items-center justify-between gap-4">
          <h2 id="agt-title" tabIndex={-1} className="text-xl sm:text-base short:text-lg font-medium text-white flex items-center gap-3 sm:gap-2.5">
            <i className="fa-solid fa-robot text-lofi-primary text-lg sm:text-sm" aria-hidden="true" /> Agents
            {fresh > 0 && <span className="text-[10px] font-mono font-normal text-lofi-primary border border-lofi-primary/30 bg-lofi-primary/10 rounded-full px-2 py-0.5">{fresh} new</span>}
          </h2>
          <button
            onClick={() => closeDialog(dlg.current)}
            aria-label="Close agents"
            className="sm:hidden w-9 h-9 shrink-0 rounded-full bg-lofi-base/50 border border-white/10 flex items-center justify-center text-lofi-muted hover:text-white hover:border-lofi-primary/40 transition-colors"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div data-scroll className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y -mx-1 px-1">
          <div ref={rows} className="relative flex flex-col gap-6 sm:gap-4">
            {groups.length ? (
              groups.map(([project, list]) => (
                <section key={project} aria-label={project} className="flex flex-col gap-2">
                  <h3 data-flip-key={`~p:${project}`} className="flex items-center gap-2 text-[11px] font-mono text-lofi-muted">
                    <i className="fa-solid fa-folder text-[10px]" aria-hidden="true" />
                    <span className="truncate text-white/80">{project}</span>
                    <span className="tabular-nums">{list.length}</span>
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {list.map((i) => (
                      <AgentRow key={i.id} item={i} now={t} isNew={i.id > hub.shownRead && i.state !== 'working'} onDismiss={hub.dismiss} open={open} />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <div data-flip-key="~empty" className="py-10 sm:py-6 flex flex-col items-center gap-3 text-center">
                <span className="w-14 h-14 rounded-2xl bg-lofi-surface border border-white/5 shadow-lg flex items-center justify-center text-lofi-muted">
                  <i className="fa-solid fa-robot text-xl" aria-hidden="true" />
                </span>
                <p className="text-sm text-white">No agent messages</p>
                <p className="text-[11px] font-mono text-lofi-muted">What your agents send shows up here, by project.</p>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 pt-2 sm:pt-3 border-t border-white/5 flex items-center justify-between gap-3">
          <p className="text-[10px] font-mono text-lofi-muted">Phones buzz for needs you and failed.</p>
          <button
            onClick={hub.clear}
            disabled={!hub.items.length}
            className="shrink-0 h-9 px-4 rounded-full border border-white/10 font-mono text-xs text-lofi-muted hover:text-white hover:border-red-400/60 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-lofi-muted disabled:hover:border-white/10"
          >
            <i className="fa-solid fa-broom" aria-hidden="true" /> Clear all
          </button>
        </div>
      </div>
    </dialog>
  )
}

function AgentRow({ item, now, isNew, onDismiss, open }) {
  const s = STATE_LOOK[item.state] ?? STATE_LOOK.working
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!open) setMore(false) // each opening starts short
  }, [open])
  const long = isLong(item.content)
  return (
    <li
      data-flip-key={item.id}
      className={`group min-w-0 rounded-2xl border p-3 flex items-start gap-3 transition-colors ${isNew ? (item.state === 'needs-you' ? 'border-lofi-highlight/40 bg-lofi-highlight/5' : 'border-lofi-primary/40 bg-lofi-primary/5') : 'border-white/5 bg-lofi-base/40'}`}
    >
      <NoticeIcon item={item} className="w-10 h-10 text-base" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 min-w-0 text-[10px] font-mono text-lofi-muted">
          <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-px uppercase tracking-wider ${CHIP[s.color]}`}>
            <i className={`${s.icon} text-[9px] ${item.state === 'working' ? 'motion-safe:animate-spin [animation-duration:3s]' : ''}`} aria-hidden="true" />
            {s.label}
          </span>
          <span className="min-w-0 truncate">{item.agent}</span>
          <span className="ml-auto shrink-0" title={fullDate(item.at)}>
            {ago(item.at, now)}
          </span>
        </p>
        <p className="mt-1 flex items-baseline gap-2 min-w-0">
          {isNew && <span className={`w-1.5 h-1.5 shrink-0 rounded-full -translate-y-0.5 ${item.state === 'needs-you' ? 'bg-lofi-highlight' : 'bg-lofi-primary'}`} aria-label="new" />}
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 wrap-break-word text-sm font-medium text-white hover:text-lofi-primary transition-colors">
              {item.title}
              <i className="fa-solid fa-arrow-up-right-from-square ml-1.5 text-[9px] text-lofi-muted" aria-hidden="true" />
            </a>
          ) : (
            <span className="min-w-0 wrap-break-word text-sm font-medium text-white">{item.title}</span>
          )}
        </p>
        {item.content && (
          <div className="mt-1">
            <div className={`text-xs leading-4 text-lofi-text/80 wrap-break-word ${long && !more ? 'max-h-12 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]' : ''}`}>
              <Rich text={item.content} />
            </div>
            {long && (
              <button onClick={() => setMore((m) => !m)} aria-expanded={more} className={`mt-1 text-[10px] font-mono ${TEXT.primary} hover:text-white transition-colors`}>
                {more ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        {item.exp && <p className="mt-1 text-[10px] font-mono text-lofi-muted">goes in {left(item.exp, now)}</p>}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        aria-label={`Dismiss: ${item.title}`}
        title="Dismiss"
        className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-lofi-muted hover:text-white hover:bg-white/5 transition-colors"
      >
        <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
      </button>
    </li>
  )
}

// the content's light formatting (lib/agents.js blocksOf / spansOf), all of it React text: never HTML
function Rich({ text }) {
  const line = (l, k) => (
    <span key={k}>
      {spansOf(l).map((p, n) =>
        p.code ? (
          <code key={n} className="font-mono text-[11px] text-lofi-highlight bg-white/5 rounded px-1">
            {p.text}
          </code>
        ) : (
          p.text
        ),
      )}
    </span>
  )
  return blocksOf(text).map((b, n) =>
    b.type === 'p' ? (
      <p key={n} className="[&:not(:first-child)]:mt-1.5">
        {b.lines.map((l, k) => (
          <span key={k} className="block">
            {line(l, k)}
          </span>
        ))}
      </p>
    ) : (
      (() => {
        const List = b.type === 'ul' ? 'ul' : 'ol'
        return (
          <List key={n} className={`[&:not(:first-child)]:mt-1.5 pl-4 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-lofi-muted`}>
            {b.lines.map((l, k) => (
              <li key={k}>{line(l, k)}</li>
            ))}
          </List>
        )
      })()
    ),
  )
}
