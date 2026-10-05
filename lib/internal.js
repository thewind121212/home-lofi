import { readFile } from 'node:fs/promises'
import { check } from './status'

// The internal service list (private-services.json). Server-only. Same item shape as SERVICES[].items in lib/data.js.
// Missing/invalid file -> [].
export async function internalServices() {
  try {
    const list = JSON.parse(await readFile(/*turbopackIgnore: true*/ process.env.PRIVATE_SERVICES_FILE || '/config/private-services.json', 'utf8'))
    // drop items the client card can't render safely (it does new URL(href); no javascript: links)
    return Array.isArray(list)
      ? list.filter((s) => {
          try {
            return typeof s.name === 'string' && /^https?:$/.test(new URL(s.href).protocol)
          } catch {
            return false
          }
        })
      : []
  } catch {
    return []
  }
}

// up/down + ms from probing each service's own link (< 500 = up: an auth wall still means it's alive), cached per URL
export const liveOf = (list) => Promise.all(list.map((s) => check(s.href, null, 500)))
