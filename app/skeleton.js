'use client'

// The skeletons' pieces (lib/skeleton.js has the why): <Bone> stands in for a value inside the very element that will
// hold it (same font, same line height, so the line keeps its height), and rememberShape() keeps a card's shape
// for the next visit's first paint.
import { SHAPE_KEY, cleanShape } from '../lib/skeleton'

// w: its width (a CSS length; ch follows the line's font). block: a box of its own size (an avatar, a tile)
// (a line's stand-in sits in a plain <span>: as a flex item that span still makes a line of the parent's line height,
// where the bare block would be a flex item of its own, only as tall as itself)
export function Bone({ w = '4ch', h, block = false, round = false, className = '' }) {
  const bone = (
    <span
      aria-hidden="true"
      className={`sk-bone ${block ? 'sk-block' : ''} ${round ? 'rounded-full' : ''} ${className}`}
      style={{ width: w, ...(h && { height: h }) }}
    />
  )
  return block ? bone : <span aria-hidden="true">{bone}</span>
}

// merge into the remembered shape (only what changed is written)
export function rememberShape(patch) {
  try {
    const cur = cleanShape(JSON.parse(localStorage.getItem(SHAPE_KEY)))
    const next = cleanShape({ ...cur, ...patch })
    if (JSON.stringify(next) !== JSON.stringify(cur)) localStorage.setItem(SHAPE_KEY, JSON.stringify(next))
  } catch {}
}
