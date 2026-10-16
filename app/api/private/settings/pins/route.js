import { randomBytes } from 'node:crypto'
import { sameOriginJson, syncOwner } from '../../../../../lib/gate.js'
import { clientId, liveBus } from '../../../../../lib/live.js'
import { MAX, MAX_LINKS, MAX_PINS, UNDO_MS, canUndo, cleanAction, cleanText, domainOf, safeLink, validId } from '../../../../../lib/pins.js'
import { KEEP_REMOVED, pinsStore } from '../../../../../lib/pins-store.js'
import { fetchPreview } from '../../../../../lib/pins-fetch.js'

// The owner's pins (app/pins.js), in the owner-only zone like the settings next door (lib/gate.js ownerOf): the
// proxy's /api/private/settings location covers this path, Authelia login included. Guests get 404 / 403 and the page
// shows no card.
//   GET                                   -> the state below
//   POST { url } (or action: 'add')       a link: the server fetches its preview (lib/pins-fetch.js), then keeps it on
//                                          top. Already kept: it just moves to the top (dup: true), no fetch. No
//                                          preview (blocked, too slow, not a page): kept all the same, with why
//        { action: 'refresh', id }        fetch its preview again
//        { action: 'undo', id }           right after a removal (UNDO_MS): back where it was
//        { action: 'link', id, to }       onto a habit or a reminder (to: { kind: 'habit' | 'todo', id }; MAX_LINKS
//                                          on one). An add can carry `to` too: pinned and linked in one go
//        { action: 'unlink', id, to }     off it again (the pin stays)
//   DELETE { id }                         removed (kept a little while for the Undo)
//   -> { pins: [{ id, url, domain, title, description, image, icon, site, ok, reason, addedAt }] (newest first),
//      links: [{ pin, kind, id, at }] (the kept pins' links), max, maxLinks },
//      plus for a write: pin (its id), dup, ok, reason, removed / until (the Undo's end, server clock). The owner's
//      other tabs hear 'pins' on the live stream and pull.
// 404 = not set up (no gate / no database), 403 = someone else, 400 = a bad body ({ error, field }), 409 = not
// possible now (MAX_PINS kept / the undo window passed / no such pin), 429 = too many previews at once,
// 503 = database unreachable.
const HEADERS = { 'cache-control': 'no-store, private' }
const json = (body, status = 200) => Response.json(body, { status, headers: HEADERS })
const MAX_BODY = 8_192 // a link is 2 KB at most
const MAX_FETCHES = 3 // previews on their way at once (a paste storm, a stuck site): the rest wait their turn (429)
const mkId = () => randomBytes(6).toString('hex')
// the fetcher: the tests hand in their own (no network), like lib/push.js's sender
const fetcher = () => globalThis.__homePinsFetch ?? fetchPreview

// a stored row -> what the card gets
const view = (p) => ({
  id: p.id,
  url: p.url,
  domain: domainOf(p.url),
  title: p.data.title ?? null,
  description: p.data.description ?? null,
  // (checked again on the way out: a picture's host rules apply to every row, whenever it was kept)
  image: safeLink(p.data.image) ?? null,
  icon: safeLink(p.data.icon) ?? null,
  site: p.data.site ?? null,
  ok: p.data.ok !== false,
  reason: p.data.reason ?? null,
  addedAt: p.addedAt,
})
const state = async (store, who) => {
  const [pins, links] = await Promise.all([store.list(who), store.links(who)])
  return { pins: pins.map(view), links, max: MAX_PINS, maxLinks: MAX_LINKS }
}
const tell = (who, request) => liveBus().publish(who, { kind: 'pins', at: Date.now(), from: clientId(request.headers.get('x-home-client')) })

// the fetcher's answer -> what's kept (only the fields the card shows, cut to size: whatever a fetcher returns)
async function preview(link) {
  let p
  globalThis.__homePinsFetching = (globalThis.__homePinsFetching ?? 0) + 1
  try {
    p = await fetcher()(link)
  } catch {
    p = { ok: false, reason: 'unreachable' }
  } finally {
    globalThis.__homePinsFetching--
  }
  const str = (v, n) => (typeof v === 'string' ? cleanText(v, n) : null)
  // pictures and icons: absolute, and only where a fetch could go (lib/pins.js safeLink: never into the LAN)
  const href = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? safeLink(v) : null)
  if (!p?.ok) return { ok: false, reason: typeof p?.reason === 'string' ? p.reason.slice(0, 20) : 'unreachable', icon: href(p?.icon) }
  return { ok: true, reason: null, title: str(p.title, MAX.title), description: str(p.description, MAX.description), image: href(p.image), icon: href(p.icon), site: str(p.site, MAX.site) }
}
const busy = () => (globalThis.__homePinsFetching ?? 0) >= MAX_FETCHES

async function body(request) {
  const text = await request.text()
  if (text.length > MAX_BODY) return { status: 413, out: { error: 'too large' } }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return { status: 400, out: { error: 'not JSON' } }
  }
}

export async function GET(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no pins' }, who)
  try {
    return json(await state(pinsStore(), who))
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function POST(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no pins' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  const c = cleanAction(b.value)
  if (c.error) return json({ error: c.error, field: c.field }, 400)
  const act = c.act
  try {
    const store = pinsStore()
    const conflict = async (error) => json({ error, ...(await state(store, who)) }, 409)
    // (an add with `to`: linked once it's kept; a full habit / reminder keeps the pin, unlinked, and says so)
    const linkTo = async (pin) => (act.to ? store.link(who, pin, act.to, Date.now(), MAX_LINKS) : 'ok')
    const full = `${MAX_LINKS} links at most on one: unlink one first`
    if (act.action === 'add') {
      const old = await store.byUrl(who, act.url)
      // kept already: to the top, as it is (Refresh fetches it again)
      if (old && old.removedAt == null) {
        await store.bump(who, old.id, Date.now())
        const l = await linkTo(old.id)
        tell(who, request)
        return json({ ...(await state(store, who)), pin: old.id, dup: true, ok: old.data.ok !== false, ...(l === 'full' && { linkError: full }) })
      }
      // (a new link, or a removed one coming back: either adds one, so the cap first, before any fetch)
      if ((await store.list(who)).length >= MAX_PINS) return conflict(`${MAX_PINS} pins at most: remove some first`)
      if (busy()) return json({ error: 'a few previews are on their way: try again in a moment' }, 429)
      const data = await preview(act.url)
      const id = await store.put(who, { id: mkId(), url: act.url, data, at: Date.now() })
      if (!id) return conflict(`${MAX_PINS} pins at most: remove some first`)
      const l = await linkTo(id)
      // (removed ones linger for their Undo: a write is a good moment to clear the old ones out)
      await store.prune(who, Date.now() - KEEP_REMOVED).catch(() => {})
      tell(who, request)
      return json({ ...(await state(store, who)), pin: id, dup: false, ok: data.ok, reason: data.reason, ...(l === 'full' && { linkError: full }) })
    }
    if (act.action === 'link') {
      const l = await store.link(who, act.id, act.to, Date.now(), MAX_LINKS)
      if (l === 'gone') return conflict('no such pin')
      if (l === 'full') return conflict(full)
      tell(who, request)
      return json({ ...(await state(store, who)), pin: act.id })
    }
    if (act.action === 'unlink') {
      // (not linked: nothing to do, the fresh state all the same)
      if (await store.unlink(who, act.id, act.to)) tell(who, request)
      return json({ ...(await state(store, who)), pin: act.id })
    }
    const pin = await store.get(who, act.id)
    if (act.action === 'refresh') {
      if (!pin || pin.removedAt != null) return conflict('no such pin')
      if (busy()) return json({ error: 'a few previews are on their way: try again in a moment' }, 429)
      const data = await preview(pin.url)
      if (!(await store.setData(who, pin.id, data))) return conflict('no such pin') // removed meanwhile
      tell(who, request)
      return json({ ...(await state(store, who)), pin: pin.id, ok: data.ok, reason: data.reason })
    }
    // undo
    const gone = 'the undo window has passed: paste the link again'
    if (!pin || pin.removedAt == null || !canUndo(pin.removedAt, Date.now())) return conflict(gone)
    if (!(await store.restore(who, pin.id, pin.removedAt))) return conflict(gone)
    tell(who, request)
    return json({ ...(await state(store, who)), pin: pin.id })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}

export async function DELETE(request) {
  const who = syncOwner(request)
  if (typeof who === 'number') return json({ error: 'no pins' }, who)
  if (!sameOriginJson(request)) return json({ error: 'forbidden' }, 403)
  const b = await body(request)
  if (b.status) return json(b.out, b.status)
  if (!validId(b.value?.id)) return json({ error: "id: a pin's id", field: 'id' }, 400)
  try {
    const store = pinsStore()
    const at = Date.now()
    if (!(await store.remove(who, b.value.id, at))) return json({ error: 'no such pin', ...(await state(store, who)) }, 409)
    tell(who, request)
    return json({ ...(await state(store, who)), removed: b.value.id, until: at + UNDO_MS })
  } catch {
    return json({ error: 'database unavailable' }, 503)
  }
}
