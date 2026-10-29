// A guest's read state for News and the GitHub list (app/news.js, app/github.js), kept on their device (localStorage)
// since only the owner's lives on the server: the stories / repos opened (the newest MAX) and the newest edition seen
// (the icon's dot). Storage that's off or full just forgets: nothing breaks.
const MAX = 600

// key: localStorage's -> { load() -> { read: [ids], seen: ms | null }, apply(write) } (a write as the owner's route
// takes it: { action: 'read' | 'unread', ids } | { action: 'seen', at })
export function guestReads(key) {
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null')
      return { read: Array.isArray(v?.read) ? v.read.filter((x) => typeof x === 'string') : [], seen: Number.isFinite(v?.seen) ? v.seen : null }
    } catch {
      return { read: [], seen: null }
    }
  }
  function apply(w) {
    const v = load()
    if (w.action === 'read') v.read = [...v.read.filter((id) => !w.ids.includes(id)), ...w.ids].slice(-MAX)
    else if (w.action === 'unread') v.read = v.read.filter((id) => !w.ids.includes(id))
    else if (w.action === 'seen') v.seen = Math.max(v.seen ?? 0, w.at)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {}
  }
  return { load, apply }
}
