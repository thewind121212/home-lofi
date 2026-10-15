import { syncOwner } from '../../../../../lib/gate.js'
import { bookView, kavitaOn, readingList } from '../../../../../lib/kavita.js'
import { publicBase } from '../../../../../lib/reading.js'

// The owner's Reading bar (app/reading.js): the books in progress in Kavita, in the owner-only zone like the settings
// next door (lib/gate.js ownerOf): the proxy's /api/private/settings location covers this path, Authelia login
// included. Guests get 404 / 403 and the page shows no bar.
//   GET -> { on: true, books: [{ id, name, pages, pagesRead, percent, readAt, href, seriesHref, cover }] (most recent
//          first), kavita (its public address, or null), at (when Kavita was asked, server clock) }
//          { on: false } Kavita isn't set up (KAVITA_URL / KAVITA_API_KEY): no bar
// 404 = not set up (no gate / no database), 403 = someone else, 502 = Kavita unreachable or said no ({ on: true,
// error }: the page keeps what it had). The list is kept 2 minutes for every tab (lib/kavita.js).
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no reading' }, who)
  if (!kavitaOn()) return json({ on: false })
  try {
    const { books, at } = await readingList()
    const pub = publicBase(process.env.KAVITA_PUBLIC_URL)
    return json({ on: true, books: books.map((b) => bookView(b, pub)), kavita: pub, at })
  } catch {
    return json({ on: true, error: 'Kavita unreachable' }, 502)
  }
}
