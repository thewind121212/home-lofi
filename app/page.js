import { headers } from 'next/headers'
import { pageAccess } from '../lib/gate'
import Home from './home'

// The page, rendered per request: the proxy says who's looking (lib/gate.js pageAccess), so the dashboard (app/home.js)
// comes out of the server as they'll see it: the owner's bell and controls, or a guest's sign-in line, from the first
// paint. What the proxy doesn't say, the page still finds out in the browser. Nothing private is in it: the data
// itself only ever comes from the gated /api/private routes.
export default async function Page() {
  return <Home access={pageAccess(await headers())} />
}
