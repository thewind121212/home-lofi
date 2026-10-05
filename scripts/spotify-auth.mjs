// One-time Spotify consent for the "now playing" pill (README "Spotify now playing").
//   1. node scripts/spotify-auth.mjs               -> prints the consent link; open it, click Agree
//   2. node scripts/spotify-auth.mjs '<address>'   -> the address the browser landed on (the page itself won't load)
//      prints SPOTIFY_REFRESH_TOKEN=... for your .env / Coolify
// Needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the environment. Read-only scopes: what's playing, what played.
import { createHash } from 'node:crypto'

const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env
const REDIRECT = 'http://127.0.0.1:8888/callback' // must match the app's Redirect URI exactly
const SCOPES = 'user-read-currently-playing user-read-recently-played'
if (!id || !secret) {
  console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET first.')
  process.exit(1)
}
// same value in both steps without storing anything: derived from the secret
const state = createHash('sha256').update(`home-lofi:${secret}`).digest('hex').slice(0, 24)

const landed = process.argv[2]
if (!landed) {
  const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES, state })
  console.log(`https://accounts.spotify.com/authorize?${q}`)
  process.exit(0)
}

const back = new URL(landed)
if (back.searchParams.get('error')) {
  console.error(`Spotify said: ${back.searchParams.get('error')}`)
  process.exit(1)
}
if (back.searchParams.get('state') !== state) {
  console.error('That address is not from this consent link (state mismatch).')
  process.exit(1)
}
const r = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
  body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code') ?? '', redirect_uri: REDIRECT }),
})
const j = await r.json()
if (!r.ok || !j.refresh_token) {
  console.error(`Token exchange failed: ${j.error_description ?? j.error ?? r.status} (the code works once, for ~10 minutes)`)
  process.exit(1)
}
console.log(`SPOTIFY_REFRESH_TOKEN=${j.refresh_token}`)
