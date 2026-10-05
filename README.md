# home-lofi

A lofi home page: full-screen pixel-art scene, lofi radio, live weather, and a hub of your services.
The page is **public**; server stats and internal services appear only for signed-in (or LAN) visitors.

Next.js (App Router, JavaScript) · Tailwind CSS v4 · no database.

## Features

- **Scenes**: full-screen, seamlessly looping pixel-art cities, drawn onto a canvas with smoothing off, so the pixels stay sharp up to 4K.
  A full-screen gallery picks the scene (saved per browser).
- **Hide, Screensaver, Lock**: three ways to see just the scene, each with one job.

  | | when | shows | back with |
  | --- | --- | --- | --- |
  | **Hide** (I'm still here) | 👁 (bottom right) or **H** | scene + a mini bar (the music that plays: radio or Spotify, weather, time, server, 🔒) | 👁 in the bar, **Esc** or **H** |
  | **Screensaver** (I'm away) | Settings › Screensaver after N s without input | scene (+ big clock), "move to wake" for a moment | any input |
  | **Lock** (I'm away, hands off) | 🔒 (bottom right) or **L** (the screensaver never locks) | scene + clock + weather + **swipe to unlock**, in its own look, + what's playing (Lock screen › Music) | **swiping** the knob across, or **holding Space** ~1 s (let go to stop); → five times |

  The lock has its own look (Settings › Lock screen, or 🎨 on the lock screen); the screensaver keeps the plain one.
  After 3 s without use the lock's controls fold smoothly into a small breathing *swipe to unlock* and what's playing
  glides down into their place; bringing the pointer to the bottom, a click / tap anywhere or holding Space opens them
  again (other keys, like Alt+Tab, don't). Switching windows (Alt, Tab, Ctrl, Shift, Meta) doesn't wake the screensaver either.
  You always come back to where you were (dashboard or Hide). The lock isn't saved: a reload opens unlocked
  (a screen-saver lock, not security).
- **Music**: one card, three tabs (it opens on the last one picked in this browser; switching never stops the radio):
  - **Radio**: Lofi Girl through the YouTube IFrame API. It only starts when you click, and has volume control.
  - **Spotify**: what you're listening to (a still cover tinting the card, track, artists, a live progress bar) and a
    small **Up next** (click a song: a popup with its cover and *Open in Spotify*), or an empty frame when nothing plays.
    Public; signed in as the owner you also get ⏮ ⏯ ⏭ (Spotify Premium), or *Sign in to control* in a browser where you
    were signed in before. See [Spotify now playing](#spotify-now-playing).
  - **Player**: your own "play any song" player, coming soon.
  The picked tab is filled; a dot on a tab means that source is playing.
- **Weather**: current conditions, a color-coded US AQI pill, and a location search. The server proxies a weather API, so the browser never calls it directly.
  - Click the card (or **Details ›**) for a details panel: a 24-hour temperature + rain chart, 7 days, air quality (PM2.5 / PM10 / O₃ and advice), sun and wind.
  - The panel loads `/api/weather/detail` only when opened, and reuses it for 10 minutes per location.
- **Steam card** (Entertainment): live status in Steam's colors (Online / Playing · the game / Offline), games owned,
  total hours and the last 2 weeks. Set `STEAM_ID` in `lib/data.js` to your SteamID64 (public profile); games owned and
  total hours need `STEAM_API_KEY` (https://steamcommunity.com/dev/apikey). Steam is asked at most once a minute.
- **Services hub**: groups you switch between with animated tabs.
  - Public cards show a live **Online · ms** status.
  - Internal cards add live stats (AdGuard, Nginx Proxy Manager, Portainer, Nextcloud, What's Up Docker, n8n, Coolify, MySpeed).
- **Private section**: server CPU / RAM / temp / disk / uptime and the internal services.
  - The reverse proxy (e.g. Authelia) decides who sees it.
  - The app fails closed: without the proxy's secret header it answers 404.

## Settings

The gear in the header opens Settings. Changes apply live and are stored **per browser** in one localStorage key
(`home-lofi:settings`); **Reset all** goes back to the defaults. For visitors nothing is sent to the server.
The owner can also sync them across devices, see [Settings sync](#settings-sync-owner-only).

| setting | options |
| --- | --- |
| Color theme | Sunset (default), Sakura, Matcha, Ocean, Lavender, Lemon, or a custom accent (the other two colors are derived from it) |
| Scene | opens the scene gallery: search, 🎲 Random, arrow keys + Enter |
| On load | Keep the last scene, or a Random one each visit |
| Scene weather | Signature (default), Live, Clear, Drizzle, Rain, Storm, Snow, Leaves (see [Scenes](#scenes)) |
| Dim scene | 0–100: more scene ↔ more readable panels (50 = default) |
| Clock | 24h / 12h (header and screensaver / lock clock) |
| Temperature | °C / °F (converted in the browser) |
| Motion | System (follows the OS reduced-motion setting) / Reduced (turns animations off) |
| Screensaver after / Show | after 30 s – 5 min without input, fade the panels away and show the scene only, or the scene + a big clock. Any input brings them back; it never locks |
| Lock screen | Clock size Big / Small / Off · Date Show / Hide · Overlay Off / Soft / Dark · Blur Off / Soft / Strong · Music Bright / Dim / Hide (what plays, above the unlock slider: radio play / pause for anyone, Spotify ⏯ ⏭ for the owner; Dim fades it with the controls when idle) · Weather Show / Hide (under the date). Also on the lock screen itself (🎨 next to the unlock pill): the only settings that change while locked. Blur re-blurs the moving scene every frame, so it costs GPU (Off by default) |

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
  (colors cross-fade). While Settings is open, nothing incoming moves under the cursor.
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
path helps.

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

Settings › Scene weather picks one; **Live** follows the current weather of the Weather card's location (clear sky / clouds
→ clear, fog / drizzle → drizzle, rain / showers → rain, snow → snow, thunderstorm → thunderstorm). If a variant is
missing for a scene, that scene quietly falls back to its Signature files; only a missing Signature shows the night sky.
So variants can be uploaded one scene at a time. Pixel art looks best at an integer upscale with nearest-neighbour scaling
(`ffmpeg -vf scale=1920:1080:flags=neighbor`).

## Add a public service

Add `{ name, href, icon }` (or `fa: 'fa-brands fa-...'`) to a section of `SERVICES` in `lib/data.js`.
For a live **Online · ms** line, also add `status: '<id>'` and an entry in `STATUS_CHECKS`.
For a bit of fun under the name, add `deco: 'vault'` (sealed password), `'graph'` (fake live chart) or `'shell'` (cheeky terminal).
Only up/down and response time are shown publicly, never versions or internals.
Everything in `lib/data.js` is public: put internal services in `private-services.json` instead.
