# home-lofi

A lofi home page: full-screen pixel-art scene, lofi radio, live weather, and a hub of your services.
The page is **public**; server stats and internal services appear only for signed-in (or LAN) visitors.

Next.js (App Router, JavaScript) · Tailwind CSS v4 · no database.

## Features

- **Scenes**: full-screen, seamlessly looping pixel-art cities, drawn onto a canvas with smoothing off, so the pixels stay sharp up to 4K.
  The scene button in the header (a mini picture of the scene as shown, with its weather) opens the scene picker:
  the scene's weather, and a big preview that opens the full-screen gallery (saved per browser).
  Some scenes have a **day** version that plays from sunrise to sunset at the Weather card's location (see [Scenes](#scenes)).
- **Mini window**: ⧉ (bottom right, under ⚙️) opens a picture-in-picture window that floats over other apps: the scene
  as it plays (pixel-sharp, with the dim, theme, Scene weather and day / night as on the page), the clock, the date and
  the weather (Settings › Mini window). It follows setting changes live and keeps running in a background tab; ⧉ again
  or the window's ✕ closes it. Chrome, Edge, Safari (no button in Firefox, which has no video picture-in-picture).
  From a static scene host it needs `SCENES_CORS=1` (see [Scenes](#scenes)), else it shows the clock over a night sky.
- **Ambient, Lock**: two ways to see just the scene, each with one job.

  | | when | shows | back with |
  | --- | --- | --- | --- |
  | **Ambient** (just the scene, music at hand) | ⛰ (bottom right), **H**, or by itself after Settings › Ambient after N s without input | scene + a slim bar (the music that plays: radio, Spotify or the Player, weather, time, server, 👁, 🔒). After 5 s without input the bar fades, leaving the scene, or the scene + a big clock (Settings › When the bar fades); any input brings the bar back, and only that (the tap, key or wheel that wakes it doesn't also press anything) | 👁 in the bar, **Esc**, **H**, or a tap / click on the bare scene while the bar shows |
  | **Lock** (I'm away, hands off) | 🔒 (bottom right or in the bar), **L** or **Space ×3** quickly (Ambient never locks) | scene + clock + weather + a breathing *swipe to unlock*, in its own look, + what's playing (Lock screen › Music) | **swiping up** anywhere (mouse or finger: far enough or a quick flick; a short one springs back), or **holding Space** ~1 s / **↑ five times**: a small bar fills in the hint's place (let go to empty it), and full, the lock slides away like a swipe |

  The lock has its own look (Settings › Lock screen, or 🎨 top right on the lock screen); Ambient's clock keeps the plain one.
  🎨 shows while the pointer is in the top right corner and for 3 s after a click / tap anywhere (other keys, like
  Alt+Tab, don't wake it). Switching windows (Alt, Tab, Ctrl, Shift, Meta) doesn't wake Ambient's bar either, and the
  bar stays while the mouse rests on it or the keyboard is in it. Ambient never comes on by itself while locked, with a
  dialog or dropdown open, or with text typed in a field. You always come back to where you were (dashboard or Ambient). The lock isn't saved: a reload opens unlocked
  (a screen-saver lock, not security).
- **Music**: one card, three tabs (it opens on the last one picked in this browser; switching never stops the radio):
  - **Radio** (`app/radio.js`): 30 chill stations in 7 moods (focus, chill, jazz & café, piano & classical, Asia,
    synth & retro, sleep & ambient), with the station's cover, what's on (the live stream's title, or the song on an
    internet radio) and how many are listening. ⏮ ⏭, a one-tap strip of every station, and the name opens the full list
    (filter by mood, or 📱 *Screen off*). Volume slider with mute (remembered; iOS only takes the hardware buttons), a 🌙
    sleep timer (15–90 min, fades out) and 🔗 share (`/?station=<id>` opens with that station and a pulsing ▶).
    Play / pause / switching fade (crossfade between the two kinds); a station that won't start or dies is skipped
    with a note. Media keys, headphones and the phone's lock screen control it (Media Session, with the cover).
    Two kinds of station (`lib/stations.js`):
    - **YouTube** (22): 24/7 live streams, audio only through a hidden IFrame player. No video IDs in the code: each
      station names a channel and a title word, and `/api/radio` finds the current live stream with
      [youtubei.js](https://github.com/LuanRT/YouTube.js) (no API key), cached for 1 hour, so a restarted stream is
      picked up by itself. They stop when a phone locks, and are skipped if YouTube is blocked (ad blockers).
    - **📱 Internet radio** (8): the station's own audio stream in an `<audio>` element, so it **keeps playing with a
      phone's screen off**. `/api/radio/now` reads the song from the station's now-playing API, or from the stream's
      ICY tag (`lib/radio-now.js`, cached 20 s).
  - **Spotify**: what you're listening to (a still cover tinting the card, track, artists, a live progress bar) and a
    small **Up next** (click a song: a popup with its cover and *Open in Spotify*), or an empty frame when nothing plays.
    Public; signed in as the owner you also get ⏮ ⏯ ⏭ (Spotify Premium), or *Sign in to control* in a browser where you
    were signed in before. See [Spotify now playing](#spotify-now-playing).
  - **Player** (`app/player.js`): the home page's own station inside Tavarian (see [Tavarian player](#tavarian-player)),
    live for every visitor: the song's cover tinting the card, its title, a progress bar on Tavarian's clock, plain states
    (Playing · Paused on Tavarian · Loading next song · Queue is empty · Stopped · Tavarian unreachable · Disconnected —
    new link needed / Player unavailable · Player not set up; a long title takes two lines), **Up next** (the first two)
    and the last played; *Queue ›* opens the whole list. **One round ▶ / ⏸ button**: for a visitor it listens to the
    station in this tab (at the radio's volume: the same slider and mute) or stops; starting the radio stops it and
    listening pauses the radio, so only one of them makes sound. Tuning in spins in the same button (on phones the line
    under the player is just a spinner too). Media keys and the phone's lock screen show the song and follow the same
    button. As with the YouTube stations, iOS stops it when the phone locks.
    Signed in as the owner the row is ⏮ · ▶ / ⏸ · ⏭ · volume · ＋: ▶ listens here and also resumes a paused station or
    plays a stopped queue (one tap), ⏸ pauses it for everyone and stops listening here (like a Spotify Connect pause);
    while the station plays and this tab doesn't listen, ▶ just listens here. ⏮ / ⏭ are for everyone (they spin until
    the station confirms). Also a seekable progress bar and **＋ Add** (labeled on phones, where it takes the volume
    slider's room; a round ＋ from `sm` up). Add opens a sheet (the same `<dialog>` as Settings: a bottom sheet on phones,
    centered from `sm`, animated in and out, ✕ / Esc / a tap outside closes it; only its lists scroll, never the page
    behind it) with two tabs: **Search or link**, one box for both (2+
    letters searches YouTube, each result: *Now* · *Next* · *Add*; a pasted YouTube video gets Play now / Play next /
    Add to end, a link with `list=` offers *this video* or *the whole playlist*, a playlist or Spotify link offers the
    import) and **Import playlist** (a YouTube playlist, or a Spotify playlist /
    album / track: Add to end / Play next / Play now; "Importing… this can take a while", then N added, M skipped with
    the reasons, and "first 100 only" when Tavarian cut it). Song titles in the sheet take up to two lines (the whole
    title on hover, or behind a small ⌄ on the row). In the queue every song has *Now*, *Next* and remove, and a
    handle ⋮⋮ to reorder: drag it with the mouse (a line shows where it lands), on a phone hold it ~0.4 s (a small buzz)
    then drag (a plain swipe still scrolls); ↑ / ↓ on the focused handle move it too. **Select** puts a box on every row
    (tap the row or the box; Select all / None and the count) and a bar at the bottom with **Remove selected (N)**, one
    call to Tavarian; **Clear queue** asks first like Reset all (Cancel focused, *Yes, clear* wakes after a moment, the
    question gives up after 8 s) and can also stop the current song. After ⏭ or *Now* the line under
    the player says what happens (*Skipped A · loading B…*, then *Playing B*). The station plays in several places at
    once, so mistakes can be undone: **Undo** for 5 s after Play now / ⏭ (A comes back at the second it was at, B back
    in its place), remove (back in its place), Remove selected (the songs come back in their places, added one by one:
    over 15 it says "Undo would take a while" and still offers it, with the seconds left), a move, Play next, Add and an
    import (its songs go again in one call, paced one by one on an older Tavarian when it says "too fast"). Clear queue
    has no Undo: its question is the guard. Each button locks while its request is in flight; a refusal is a plain message (already
    queued, already played, too long, live stream, not allowed outside YouTube, no YouTube match…) and changes nothing.
    Also **Playlists** (your Tavarian playlists: queue one song or all) and *Tavarian link: name · expires · Revoke link*
    (asks first, like Reset all).
  The picked tab is filled; a dot on a tab means that source is playing (Player: the station plays on Tavarian).
- **Sounds** (`app/sounds.js`, `lib/sounds.js`, `lib/sound-engine.js`): an ambient-sound mixer for everyone, under
  whatever music plays (it never pauses the radio, the Player or Spotify, and has its own volume). 〰 (bottom right,
  under ⛰) or **A** opens it: a tile per sound (tap: on / off, slider: its level), presets (Rainy café, Cozy fireplace,
  Storm night, Seaside, Deep focus), ▶ / ⏸, volume with mute, a sleep timer (15–90 min, then a slow fade out) and Reset.
  Rain, Wind, Brown noise, Fireplace and Ocean are **generated in the browser** (Web Audio, no files): noise beds and
  pre-rendered drop / crackle loops that loop seamlessly, shaped by filters and slow random envelopes (gusts, swells)
  scheduled on the audio thread, so they cost almost no CPU and keep going in a background tab. Fades are ~1.5 s, and
  with nothing to hear the audio context sleeps. The mix is a setting (saved per browser, synced for the owner); nothing
  starts by itself on load, the first tap on a tile, a preset or ▶ does. While sounds play, Ambient's bar and the lock
  screen show a small 〰 Sounds chip that mutes / unmutes. Recorded loops (Café, Birds, Thunder, City) are in the
  registry but hidden until their files exist: put `public/sounds/<id>.m4a` in place and set `ready: true` in
  `lib/sounds.js` (fetched and decoded the first time they're turned on, looped gaplessly past the encoder's padding).
- **Weather**: current conditions, a color-coded US AQI pill, and a location search. The server proxies a weather API, so the browser never calls it directly.
  - Click the card (or **Details ›**) for a details panel: a 24-hour temperature + rain chart, 7 days, air quality (PM2.5 / PM10 / O₃ and advice), sun and wind.
  - The panel loads `/api/weather/detail` only when opened, and reuses it for 10 minutes per location.
- **Steam card** (above the music): avatar with a ring in the status color, name, level, status in Steam's colors
  (Online / Playing · the game / Offline), games owned, total hours, the last 2 weeks and the recently played games;
  the Entertainment tab's Steam link shows the status too. Set `STEAM_ID` in `lib/data.js` to your SteamID64 (public profile); games owned and
  total hours need `STEAM_API_KEY` (https://steamcommunity.com/dev/apikey). Steam is asked at most once a minute.
- **Services hub**: groups you switch between with animated tabs.
  - Public cards show a live **Online · ms** status.
  - Internal cards add live stats (AdGuard, Nginx Proxy Manager, Portainer, Nextcloud, What's Up Docker, n8n, Coolify, MySpeed).
- **Private section**: server CPU / RAM / temp / disk / uptime and the internal services.
  - The reverse proxy (e.g. Authelia) decides who sees it.
  - The app fails closed: without the proxy's secret header it answers 404.

**Layout**: phones get one column (Steam · Music · Weather · Hub · Services); laptops two (Steam, Music and Weather on the
left); wide screens (≥ 1536 px, e.g. 1920×1080) three, Steam + Music | Services | Hub + Weather, so nothing scrolls on
Sites (the Hub turns compact in the narrow column). A long group like All scrolls the page while both side columns stay put.

## Settings

⚙️ (bottom right, under ⛰ and 🔒) opens Settings. Changes apply live and are stored **per browser** in one localStorage key
(`home-lofi:settings`); **Reset all** goes back to the defaults, after a confirm (Cancel is focused, *Yes, reset* wakes after a moment, and the question gives up after 8 s). For visitors nothing is sent to the server.
The owner can also sync them across devices, see [Settings sync](#settings-sync-owner-only).

| setting | options |
| --- | --- |
| Color theme | Sunset (default), Sakura, Matcha, Ocean, Lavender, Lemon, or a custom accent (the other two colors are derived from it) |
| Scene | moved to the header's scene button (scene picker): its big preview opens the scene gallery (search, 🎲 Random, arrow keys + Enter) |
| On load | Keep the last scene, or a Random one each visit |
| Scene weather | moved to the scene picker: Signature (default), Live, Clear, Drizzle, Rain, Storm, Snow, Leaves (see [Scenes](#scenes)); a line under it says what Live follows, or when a variant isn't there yet |
| Dim scene | 0–100: more scene ↔ more readable panels (50 = default) |
| Clock | 24h / 12h (header, Ambient and lock clock) |
| Temperature | °C / °F (converted in the browser) |
| Motion | System (follows the OS reduced-motion setting) / Reduced (turns animations off) |
| Ambient after / When the bar fades | Ambient after 30 s – 5 min without input (Off: only by hand, ⛰ or H); when its bar fades, show the scene only, or the scene + a big clock. The input that brings the bar back never presses anything (its click is swallowed, and the bar ignores the pointer for 0.4 s); the panels ignore the pointer for 0.4 s after they come back from Ambient or the lock, and the page doesn't scroll while they fade in; it never locks |
| Sounds | in its own panel (〰 / A): the mix (each sound's on / off and level), volume and sleep timer. Synced like the rest; whether sounds play right now isn't |
| Mini window | Weather Show / Hide · Date Show / Hide (under the ⧉ mini window's clock; changes show in an open one right away) |
| Lock screen | Clock size Big / Small / Off · Date Show / Hide · Overlay Off / Soft / Dark · Blur Off / Soft / Strong · Music Bright / Dim / Hide (what plays, above *swipe to unlock*: radio play / pause for anyone, the Player's listen / stop for anyone and ⏭ for the owner, Spotify ⏯ ⏭ for the owner, spinning until Spotify confirms; a paused Spotify stays a minute, then goes unless something changes; Dim fades it until a click / tap or the pointer comes to it) · Weather Show / Hide (under the date). Also on the lock screen itself (🎨 top right): the only settings that change while locked. Blur re-blurs the moving scene every frame, so it costs GPU (Off by default) |

## Quick start (dev)

```sh
npm install
cp .env.example .env                                         # fill in GATE_SECRET at least
cp private-services.example.json private-services.json      # optional
npm run dev        # http://localhost:3000 (binds 0.0.0.0)
npm test           # self-checks: weather mapping, AQI bands, details shaping, input validation, host stat parsers, settings
```

The scene videos are not in the repo (see [Scenes](#scenes)). Without them the page still works: the scene area is just dark.

## Configuration

Everything that is secret or specific to your network lives in two git-ignored files. Nothing is baked into the image or the browser bundle.

| file | what | template |
| --- | --- | --- |
| `.env` | `GATE_SECRET`, optional `WEATHER_API_URL`, widget URLs and credentials, settings sync | `.env.example` |
| `private-services.json` | internal service cards (`name`, `href`, `icon` or `fa`, optional `widget`) | `private-services.example.json` |

Public content (scenes list, public service cards, status checks, sign-in URL) lives in `lib/data.js`.
Change it for your own domain.

| env | default | used by |
| --- | --- | --- |
| `GATE_SECRET` | required, ≥ 16 chars | `/api/private` (see below) |
| `SCENES_URL` | empty = `/scenes` (`public/scenes`) | where scene videos load from, e.g. a static host; **build-time** (rebuild after changing). The Docker image has no scenes, see [Scenes](#scenes) |
| `SCENES_CORS` | empty | `1` = the `SCENES_URL` host sends `Access-Control-Allow-Origin`, so the mini window can draw the scene; **build-time**. Don't set it without the header: every scene would fail to load |
| `WEATHER_API_URL` | see `docker-compose.yml` | `/api/weather`, `/api/weather/detail`, `/api/geo` |
| `PRIVATE_SERVICES_FILE` | `/config/private-services.json` | `/api/private` |
| `DISK_PATH` | `/` | disk stat in `/api/private` |

### Live widget stats

Add `"widget": "<id>"` to a service in `private-services.json`, then set that widget's variables in `.env`.
- A widget is enabled when its `*_URL` is set.
- The server polls each upstream at most every 30 s.
- If one fails, its card shows no stats; nothing else breaks.

| widget id | env | shows |
| --- | --- | --- |
| `adguard` | `ADGUARD_URL` `ADGUARD_USER` `ADGUARD_PASS` | queries, blocked, filtered, latency |
| `npm` | `NPM_URL` `NPM_USER` `NPM_PASS` | enabled / disabled / total proxy hosts |
| `portainer` | `PORTAINER_URL` `PORTAINER_ENV` `PORTAINER_KEY` | running / stopped / total containers |
| `nextcloud` | `NEXTCLOUD_URL` `NEXTCLOUD_TOKEN` | CPU load, memory, free space, active users 24 h |
| `whatsupdocker` | `WUD_URL` `WUD_USER` `WUD_PASS` | monitored containers, updates available |
| `n8n` | `N8N_URL` `N8N_API_KEY` | active / total workflows, runs and failed runs in 24 h |
| `coolify` | `COOLIFY_API_URL` `COOLIFY_API_TOKEN` | running / total applications, services, databases |
| `myspeed` | `MYSPEED_URL` `MYSPEED_PASS` | ping, download, upload of the last test |

Give each widget the least privileged account or token you can, e.g. a read-only user where the service supports it.

## Private section: how access works

```
browser ──> reverse proxy (NPM) ──> home-lofi
              │  /api/private only: auth check + inject x-home-gate
              └─ Authelia: LAN → bypass, everyone else → login
```

- The whole site is public except `/api/private`.
  - On that path the proxy runs forward-auth and adds `x-home-gate: <GATE_SECRET>`.
  - Without the header the app answers **404**, so a missing proxy rule fails closed.
- Visitors who aren't allowed see a small **Sign in** card linking to your auth portal (`AUTH_URL` in `lib/data.js`).
- The locked **Internal** tab still lists your internal services by **name, icon and live up/down + ms** (public `/api/internal`),
  each card sealed and going nowhere. Their links, hosts and stats only ever come from `/api/private`.

Nginx Proxy Manager: on the proxy host's **Advanced** tab, add a custom location (adjust the Authelia include to your setup):

```nginx
location /api/private {
    # your Authelia forward-auth snippet (auth_request + error_page 401 redirect)
    include /snippets/authelia-authrequest.conf;
    proxy_set_header x-home-gate "<GATE_SECRET>";
    proxy_pass http://home-lofi:3000;
}
```

Authelia `access_control` (rules are matched top-down):

```yaml
- domain: home.example.com
  resources: ['^/api/private']
  networks: ['192.168.1.0/24']   # your LAN: no login needed at home
  policy: bypass
- domain: home.example.com
  resources: ['^/api/private']
  policy: two_factor
- domain: home.example.com
  policy: bypass                 # the rest of the page is public
```

Make sure the proxy passes the real client IP to Authelia (`X-Forwarded-For $remote_addr`, not
`$proxy_add_x_forwarded_for`). Otherwise anyone could fake a LAN address and get the bypass.

### Settings sync (owner only)

Optional. Signed in as `OWNER_USER`, your settings, saved scene and weather location follow you to every device
(volume and the services tab stay per device). Everyone else keeps them in their own browser, as before.

- **Local-first**: the page always renders from localStorage and never waits for the network. Changes go up ~1 s
  later in the background; changes from your other devices come in on load and when you return to the tab
  (colors cross-fade). While Settings or Sounds is open, nothing incoming moves under the cursor.
- **Per-setting merge**: every key carries the time it changed; the newer side wins per key, so edits on two
  devices both survive. Offline edits stay in the browser and sync when it's back.
- Settings › bottom line shows where they live: *Synced to your devices* / *Saving…* / *Offline* /
  *Saved in this browser · sign in to sync*.
- Storage: one row per owner in Postgres (`DATABASE_URL`; the table is created on first use).

`/api/private/settings` needs its **own proxy location that always asks Authelia** (also on the LAN), passes the
logged-in user on, and adds a second secret. The app trusts `Remote-User` only together with `x-home-sync`, because
on a path without a login check a client could send its own `Remote-User`. Without this location the route
answers 404 and sync stays off. On each Nginx Proxy Manager host for the page, **Advanced** tab:

```nginx
# home-lofi settings sync: always needs the Authelia login (LAN too), only for this path
location = /internal/home-lofi/authz {
    internal;
    auth_request off;   # needed where the host already has a server-level auth_request (external NPM)
    proxy_pass http://authelia_backend/api/authz/auth-request;   # your Authelia upstream
    proxy_set_header X-Original-Method $request_method;
    proxy_set_header X-Original-URL https://$http_host$request_uri;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Content-Length "";
    proxy_set_header Connection "";
    proxy_pass_request_body off;
    proxy_http_version 1.1;
}
location /api/private/settings {
    auth_request /internal/home-lofi/authz;
    auth_request_set $home_lofi_user $upstream_http_remote_user;
    proxy_set_header Remote-User $home_lofi_user;                 # from Authelia, never from the client
    proxy_set_header x-home-gate "<GATE_SECRET>";
    proxy_set_header x-home-sync "<SYNC_SECRET>";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_pass http://home-lofi:3000;                             # same upstream as your /api/private location
}
```

A request without a session gets a plain **401** (the page shows *sign in to sync*); Authelia's "remember me" keeps
the session for a month.

### Spotify now playing

Optional. The music card's Spotify tab shows what you're playing on Spotify to every visitor (a resting placeholder when nothing plays or
Spotify isn't connected yet): track,
artists, album cover and a link to the song, nothing about the account. Off until the three `SPOTIFY_*` vars are set.

1. https://developer.spotify.com/dashboard → **Create app**: Redirect URI `http://127.0.0.1:8888/callback`, API **Web API**.
2. Put its **Client ID** and **Client secret** in `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
3. `node scripts/spotify-auth.mjs` prints a consent link (scopes: what's playing, the queue, and playback control for the owner's buttons). Open it,
   agree; the browser lands on a page that doesn't load. Run `node scripts/spotify-auth.mjs '<that address>'`
   and put the printed `SPOTIFY_REFRESH_TOKEN` in your env.

The server asks Spotify at most every 10 s, whatever the number of visitors.

The owner's controls (⏮ ⏯ ⏭, and ▶ when nothing plays) post to `/api/private/settings/spotify`, inside the owner-only
proxy location of [Settings sync](#settings-sync-owner-only), so they show only when settings sync works for you. They need
Spotify Premium and a device where Spotify is open; otherwise a short message says so. A token from before the controls
still shows now playing; run the consent again to allow the queue and the buttons.

### Tavarian player

Optional, server side of the music card's **Player** tab: a station inside [Tavarian](https://tavarian.wliafdew.dev)
(its "home player") that plays any song you queue. Off until `TAVARIAN_TOKEN` is set.

| env | default | what |
| --- | --- | --- |
| `TAVARIAN_URL` | `https://tavarian.wliafdew.dev` | Tavarian's address (API under `/api/v1`, audio under `/home-audio/stream`) |
| `TAVARIAN_TOKEN` | empty = off | a Tavarian API token for the home player. **Only in Coolify's env** (or your `.env`): never in git, a log or a browser |

```
browser ──EventSource──> /api/tavarian/events ─┐            ┌─ one SSE stream ──> Tavarian /api/v1/home/events
browser ──fetch────────> /api/tavarian/state  ─┼─ home-lofi ┼─ API calls (token) ─> Tavarian /api/v1/...
owner   ──fetch────────> /api/private/settings/tavarian ┘   │
browser <──────────── audio, with a 10-minute ticket ───────┴─ Tavarian /home-audio/stream
```

- Only this server holds the token. Browsers get no Tavarian API access; only audio comes straight from Tavarian,
  with a short-lived listen ticket this server gets for each tab.
- **One upstream stream** for everyone (`lib/tavarian-hub.js`): it opens when the first browser subscribes, keeps the
  latest state and queue, fans every event out, reconnects with backoff (1 s, 2 s, 4 s … 30 s; at least 30 s after
  `too_many_streams`, since Tavarian allows 2 streams per token) and closes 60 s after the last browser leaves. A
  revoked or dead token stops it for good (until the next deploy with a new token) and every tab hears `revoked`.
- State and queue reads are cached 3 s for all visitors, keeping the last good answer when Tavarian hiccups.
- The tab (`app/player.js`, pure helpers in `lib/player.js`): one `EventSource` while the page shows (or this tab
  listens); if it can't stay open (errors, 429) it polls `/api/tavarian/state` every 5 s and tries the stream again
  every 30 s. Listen gets one ticket per tab (a random `clientId` per page load), a new one a minute before it ends
  and only while listening; a new `streamId` (song change, seek, resume) swaps the audio source, paused / loading /
  idle lets it go and it comes back by itself; a broken stream is retried a few times (with a fresh ticket from the
  second try).

Routes:

| route | who | what |
| --- | --- | --- |
| `GET /api/tavarian/events` | public | Server-Sent Events: `status`, `state`, `queue`, `audio-ready`, `song-error`, `revoked`; status, state and queue right away, `: ping` every 20 s. 4 open per IP (429), 503 `tavarian_off` when not set up |
| `GET /api/tavarian/state` | public | `{ state, queue, live }` for the first paint and as the fallback when the stream can't stay open |
| `POST /api/tavarian/ticket` | public, same-origin JSON | `{ clientId }` → `{ ticket, expiresAt, streamUrl }`; audio: `streamUrl?streamId=…&clientId=…&ticket=…`. 10 a minute per IP |
| `POST /api/private/settings/tavarian` | owner | `{ action, … }`: `add` (`youtubeUrl`, `placement`: `end` / `next` / `now`), `import` (`url`, `placement`), `play-now` / `next` (`id`), `remove`, `remove-bulk` (`ids`: 1-200 song ids → `removed`, `skipped`, `queue`), `clear` (`includeCurrent`), `reorder`, `search`, `play` / `pause` / `resume` / `skip` / `stop`, `seek`, `playlists`, `playlist-songs`, `from-playlist`, `token`, `revoke` |

The owner route sits in the owner-only proxy location of [Settings sync](#settings-sync-owner-only), like Spotify's
controls. Every call to Tavarian gives up after 5 s, except `import` (a playlist can take tens of seconds): 2 minutes,
so give that location `proxy_read_timeout 150s;` (nginx's default 60 s would cut a long import short; the songs still
arrive, the page just says to check the queue). While this server's own event stream to Tavarian is down (e.g.
`too_many_streams`) the tab asks `/api/tavarian/state` every 5 s instead, so the queue stays current. The per-IP limits read the first `X-Forwarded-For` entry, so the outermost proxy should set it to
`$remote_addr` (inner proxies append with `$proxy_add_x_forwarded_for`).

**Proxy for the event stream.** Nginx buffers responses and closes idle ones after 60 s. The app sends
`X-Accel-Buffering: no` and pings every 20 s, but set it explicitly on every nginx in front (NPM: the proxy host's
**Advanced** tab; use the same upstream as the host):

```nginx
location /api/tavarian/events {
    proxy_pass http://home-lofi:3000;          # same upstream as the proxy host
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # inner proxies: $proxy_add_x_forwarded_for
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

## Deploy (Docker)

```sh
git clone <this repo> && cd home-lofi
cp .env.example .env && nano .env                            # GATE_SECRET + widget credentials
cp private-services.example.json private-services.json && nano private-services.json
# scenes: set SCENES_URL in .env to your static host (see Scenes)
docker network create my-dns 2>/dev/null || true             # or use your proxy's network (docker-compose.yml)
docker compose up -d --build
```

- The container runs as a non-root user.
- It joins the proxy's Docker network (upstream `home-lofi:3000`).
- It publishes port 3002 on `127.0.0.1` only, so nobody can bypass the proxy.
- Create `private-services.json` before the first `up`. Otherwise Docker creates an empty directory in its place.
- Server stats come from `/proc` and `/sys`, which show host values inside a normal container, so no extra mounts are needed.

## Deploy (Coolify)

`docker-compose.coolify.yml` is the same app without the plain-Docker bits (no host port, no `.env`,
no external network). In Coolify:

1. New Resource → your GitHub repo → **Build Pack: Docker Compose**, compose file `/docker-compose.coolify.yml`.
2. Domain of service `home-lofi`: e.g. `http://home.example.com:3000` (Coolify's proxy → container port 3000).
3. Environment Variables: every `${VAR}` from the file is listed. Paste your `.env` in **Developer view**.
   `SCENES_URL` is build-time, so redeploy after changing it.
4. Deploy once, then **Persistent Storage** → `/config/private-services.json` → paste your service list
   (it starts as `[]`; Coolify keeps your edit on later deploys) → Redeploy.
5. Reverse proxy in front of Coolify: same `/api/private` rule as in [Private section](#private-section-how-access-works),
   with `proxy_set_header Host $host;` so Coolify can route by domain.

## Scenes

The scene videos are not in this repository: they are large, and the art is
[Lofi Cities](https://loficities.com) by its creator, not mine to republish. Bring your own files.

**Host them on a static server / CDN** and point `SCENES_URL` at it. That's the built-in way: the Docker image does
**not** contain scenes (`.dockerignore` skips `public/scenes/`), so images stay small and nothing is copied per deploy.
Upload to e.g. `https://static.example.com/scenes/` and set `SCENES_URL` to that before `docker compose up -d --build`.
The server must answer byte-range requests (HTTP 206), which any normal web server does. A long `Cache-Control` on that
path helps. For the ⧉ mini window to show the scene, the host must also send `Access-Control-Allow-Origin` (e.g. `*`, or
your dashboard's origin; nginx: `add_header Access-Control-Allow-Origin * always;`) and the build needs `SCENES_CORS=1`:
the page can't read pixels from another origin without it (scenes served from `/scenes` need nothing).

Optional: to serve them from the app itself instead, leave `SCENES_URL` empty and mount the folder into the container
with your own compose override (not in the default compose files):

```yaml
services:
  home-lofi:
    volumes:
      - ./public/scenes:/app/public/scenes:ro
```

In `npm run dev` / `npm start` without Docker, files in `public/scenes/` (git-ignored) are served as-is.

Each scene `<id>` needs three files (in the static folder, or `public/scenes/`):

| file | format |
| --- | --- |
| `<id>.webm` | VP9, 1920×1080, a seamless loop (Chrome, Firefox) |
| `<id>.mp4` | HEVC (`hvc1`) or H.264, same size (Safari) |
| `<id>.webp` | first frame, used as the poster |

Then add `<id>` to `SCENES` in `lib/data.js`.

**Weather variants** (optional) live in one subfolder per weather, with the same three files per scene:

```
scenes/<id>.{webm,mp4,webp}              Signature (required)
scenes/clear/<id>.{webm,mp4,webp}
scenes/drizzle/<id>.{webm,mp4,webp}
scenes/rain/<id>.{webm,mp4,webp}
scenes/thunderstorm/<id>.{webm,mp4,webp}
scenes/snow/<id>.{webm,mp4,webp}
scenes/leaves/<id>.{webm,mp4,webp}
```

The scene picker's Scene weather picks one; **Live** follows the current weather of the Weather card's location (clear sky / clouds
→ clear, fog / drizzle → drizzle, rain / showers → rain, snow → snow, thunderstorm → thunderstorm). If a variant is
missing for a scene, that scene quietly falls back to its Signature files; only a missing Signature shows the night sky.
So variants can be uploaded one scene at a time. Pixel art looks best at an integer upscale with nearest-neighbour scaling
(`ffmpeg -vf scale=1920:1080:flags=neighbor`).

**Day versions** (optional) mirror the whole layout under `day/`, same three files per scene:

```
scenes/day/<id>.{webm,mp4,webp}              Signature by day
scenes/day/<weather>/<id>.{webm,mp4,webp}    clear, drizzle, rain, thunderstorm, snow, leaves by day
```

Scenes listed in `DAY_SCENES` (`lib/data.js`) play their `day/` files from **sunrise to sunset** at the Weather card's
location, and the night files the rest of the time; every other scene is always night. Add an id once its `day/` files
are uploaded. Sunrise / sunset come with `/api/weather` (today's, as timestamps), so the switch happens on the minute
without a reload (the scene cross-fades at the same playback time, or swaps instantly with reduced motion). Without
them it uses the weather's day / night flag, and while the weather hasn't loaded (or failed) the browser's clock,
day = 06:00–18:00. Day works with every Scene weather: by day the path is `day/` + the night one (Rain →
`day/rain/<id>`). A missing day file falls back to the night file, like a missing weather variant. The scene picker
says which one plays (☀️ Daytime / 🌙 Night · follows the sun in <city>).

## Add a public service

Add `{ name, href, icon }` (or `fa: 'fa-brands fa-...'`) to a section of `SERVICES` in `lib/data.js`.
For a live **Online · ms** line, also add `status: '<id>'` and an entry in `STATUS_CHECKS`.
For a bit of fun under the name, add `deco: 'vault'` (sealed password), `'graph'` (fake live chart) or `'shell'` (cheeky terminal).
Only up/down and response time are shown publicly, never versions or internals.
Everything in `lib/data.js` is public: put internal services in `private-services.json` instead.
