# home-lofi

A lofi home page: full-screen pixel-art scene, lofi radio, live weather, and a hub of your services.
The page is **public**; server stats and internal services appear only for signed-in (or LAN) visitors.

Next.js (App Router, JavaScript) · Tailwind CSS v4 · no database.

## Features

- **Scenes**: full-screen, seamlessly looping pixel-art cities, drawn onto a canvas with smoothing off, so the pixels stay sharp up to 4K.
  There's a scene picker (saved per browser) and a focus mode that hides the panels.
- **Music**: Lofi Girl radio through the YouTube IFrame API. It only starts when you click, and has volume control.
- **Weather**: current conditions, a color-coded US AQI pill, and a location search. The server proxies a weather API, so the browser never calls it directly.
  - Click the card (or **Details ›**) for a details panel: next 24 hours, 7 days, air quality (PM2.5 / PM10 / O₃ and advice), sun and wind.
  - The panel loads `/api/weather/detail` only when opened, and reuses it for 10 minutes per location.
- **Services hub**: groups you switch between with animated tabs.
  - Public cards show a live **Online · ms** status.
  - Internal cards add live stats (AdGuard, Nginx Proxy Manager, Portainer, Nextcloud, What's Up Docker, n8n, MySpeed).
- **Private section**: server CPU / RAM / temp / disk / uptime and the internal services.
  - The reverse proxy (e.g. Authelia) decides who sees it.
  - The app fails closed: without the proxy's secret header it answers 404.

## Quick start (dev)

```sh
npm install
cp .env.example .env                                         # fill in GATE_SECRET at least
cp private-services.example.json private-services.json      # optional
npm run dev        # http://localhost:3000 (binds 0.0.0.0)
npm test           # self-checks: weather mapping, AQI bands, details shaping, input validation, host stat parsers
```

The scene videos are not in the repo (see [Scenes](#scenes)). Without them the page still works: the scene area is just dark.

## Configuration

Everything that is secret or specific to your network lives in two git-ignored files. Nothing is baked into the image or the browser bundle.

| file | what | template |
| --- | --- | --- |
| `.env` | `GATE_SECRET`, optional `WEATHER_API_URL`, widget URLs and credentials | `.env.example` |
| `private-services.json` | internal service cards (`name`, `href`, `icon` or `fa`, optional `widget`) | `private-services.example.json` |

Public content (scenes list, public service cards, status checks, sign-in URL) lives in `lib/data.js`.
Change it for your own domain.

| env | default | used by |
| --- | --- | --- |
| `GATE_SECRET` | required, ≥ 16 chars | `/api/private` (see below) |
| `SCENES_URL` | empty = `public/scenes` | where scene videos load from, e.g. a static host; **build-time** (rebuild after changing) |
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

## Deploy (Docker)

```sh
git clone <this repo> && cd home-lofi
cp .env.example .env && nano .env                            # GATE_SECRET + widget credentials
cp private-services.example.json private-services.json && nano private-services.json
# scenes: set SCENES_URL in .env to your static host, or copy files into public/scenes/ (see Scenes)
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
[Lofi Cities](https://loficities.com) by its creator, not mine to republish. Bring your own files and either:

- **host them on a static server / CDN** (recommended: keeps the image small, nothing to copy per deploy). Upload to e.g.
  `https://static.example.com/scenes/` and set `SCENES_URL` to that before `docker compose up -d --build`. The server must
  answer byte-range requests (HTTP 206), which any normal web server does. A long `Cache-Control` on that path helps.
- or **serve them from this app**: put them in `public/scenes/` (git-ignored) before building.

Each scene `<id>` needs three files in `public/scenes/`:

| file | format |
| --- | --- |
| `<id>.webm` | VP9, 1920×1080, a seamless loop (Chrome, Firefox) |
| `<id>.mp4` | HEVC (`hvc1`) or H.264, same size (Safari) |
| `<id>.webp` | first frame, used as the poster |

Then add `<id>` to `SCENES` in `lib/data.js`. Pixel art looks best at an integer upscale with nearest-neighbour scaling
(`ffmpeg -vf scale=1920:1080:flags=neighbor`).

## Add a public service

Add `{ name, href, icon }` (or `fa: 'fa-brands fa-...'`) to a section of `SERVICES` in `lib/data.js`.
For a live **Online · ms** line, also add `status: '<id>'` and an entry in `STATUS_CHECKS`.
Only up/down and response time are shown publicly, never versions or internals.
Everything in `lib/data.js` is public: put internal services in `private-services.json` instead.
