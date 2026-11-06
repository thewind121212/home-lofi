'use client'

import { useEffect, useState } from 'react'

// The room the page has: the visual viewport ({ h, top }). An on-screen keyboard takes its share there, also where the
// layout viewport stays as it was (iOS, and Chrome on Android since 108): innerHeight would never know
// (on: listening only while the sheet is open). full: the layout viewport's height, to tell a keyboard by
export function useRoom(on) {
  // (the server's render: no screen yet; nothing drawn depends on it before the box has the focus)
  const read = () =>
    typeof window === 'undefined' ? { h: 0, top: 0, full: 0 }
    : { h: Math.round(window.visualViewport?.height ?? innerHeight), top: Math.round(window.visualViewport?.offsetTop ?? 0), full: innerHeight }
  const [room, setRoom] = useState(read)
  useEffect(() => {
    if (!on) return
    const vv = window.visualViewport
    const on_ = () => setRoom((r) => {
      const n = read()
      return n.h === r.h && n.top === r.top && n.full === r.full ? r : n
    })
    const at = vv ?? window
    at.addEventListener('resize', on_)
    vv?.addEventListener('scroll', on_)
    on_()
    return () => (at.removeEventListener('resize', on_), vv?.removeEventListener('scroll', on_))
  }, [on])
  return room
}
