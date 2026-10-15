import { syncOwner } from '../../../../../../lib/gate.js'
import { kavitaOn, lastList, readingList, seriesCover } from '../../../../../../lib/kavita.js'

// A book's cover for the owner's Reading sheet, from Kavita through this server (the key and its token stay here).
//   GET ?id=<series id>[&v=…] -> the picture (png / jpeg / webp…, 3 MB at most). v only versions the address (the
//   cover file's name: a new cover isn't served from the browser's cache); it isn't sent anywhere.
// Only a book on the reading list (the last one Kavita gave, else asked now): not a way to read any cover by id.
// 404 = not set up / not on the list / Kavita off, 403 = someone else, 400 = not an id, 502 = Kavita failed.
const NO = { 'cache-control': 'no-store, private' }
const fail = (error, status) => Response.json({ error }, { status, headers: NO })

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return fail('no reading', who)
  if (!kavitaOn()) return fail('no reading', 404)
  const raw = new URL(request.url).searchParams.get('id') ?? ''
  const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(id) || id > 2 ** 31 - 1) return fail('id: a series id', 400)
  try {
    const list = lastList() ?? (await readingList())
    if (!list.books.some((b) => b.id === id)) return fail('not on the reading list', 404)
    const { type, body } = await seriesCover(id)
    return new Response(body, {
      headers: {
        'content-type': type,
        'content-length': String(body.byteLength),
        // the owner's own browser only (never a shared cache); a day, the address changes with the cover
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  } catch {
    return fail('Kavita unreachable', 502)
  }
}
