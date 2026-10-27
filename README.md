# home-lofi

A lofi home page: full-screen pixel-art scene, lofi radio, live weather, and a hub of your services.
The page is **public**; server stats and internal services appear only for signed-in (or LAN) visitors.

Next.js (App Router, JavaScript) · Tailwind CSS v4 · no database.

## Features

- **Scenes**: full-screen, seamlessly looping pixel-art cities, drawn onto a canvas with smoothing off, so the pixels stay sharp up to 4K.
  The scene button in the header (a mini picture of the scene as shown, with its weather) opens the scene picker:
  the scene's weather, and a big preview that opens the full-screen gallery (saved per browser).
  Some scenes have a **day** version that plays from sunrise to sunset at the Weather card's location (see [Scenes](#scenes)).
- **Dock** (bottom right): on the dashboard the owner's ⏱ Focus, ⛰ Ambient (**H**) and 🔒 Lock (**L**); in Ambient 👁 Show
  panels and 🔒 Lock, fading and coming back with Ambient's bar (and raised above the bar where the two would meet, as on
  a phone). Full screen is **F**, Quick actions **⌘K** / **Ctrl+K** / **/**, ⚙️ Settings sits by the header's bell.
- **Header icons** (by the clock): ⚙️ Settings for everyone, then the owner's 📌 Pins, 📖 Reading, 📰 News, 🤖 Agents and the 🔔 bell.
  Reminders have no icon there: their pop-up / pill (bottom left, the pill at any hour while one is open), Ambient's chip and ⌘K open them.
- **Links**: pins can go on habits and reminders (several on one, one on several). A reminder's 🔗 button (on its row,
  in the pop-up or the list) or a routine's *Links* (Habits › routines › edit) opens the picker: tick pins on or off,
  or paste a new link to pin and link it at once. Their chips show under the reminder and on the habit's tile; a tap
  opens the link. A removed pin drops off them (its Undo brings it back).
- The page scrolls without a scrollbar of its own (panels and lists keep theirs).
- **Errors**: a crash shows the page's own screen (*Oops*, Try again / Reload) and an unknown address its 404, over a
  slowly drifting sky (`app/oops.js`); News has its own catch, so a bad edition only blanks the modal. Each crash is
  told to the server's log: `docker logs <container> | grep client-error` (where, message, stack, browser).
- **Quick actions** (`app/quick.js`, rules in `lib/quick.js`): a command palette. **⌘K** / **Ctrl+K** (in a text field
  too, not over another dialog; the same keys close it) or **/** outside a field. Type a few letters, **Enter** runs
  the top match, **↑ ↓** or **Tab / Shift+Tab** move (the typing stays in the field, as in Spotlight), a click runs a
  row, **Esc** or the backdrop closes it. While something's typed the last row searches Google for it in a new tab: the
  only row, so Enter's, when nothing here matches.
  Accents and case don't matter ("nhac" finds "nhắc"), but typed with accents the item with those accents comes first
  ("nhạc" the music, "nhắc" the reminders). The title starting with what's typed ranks first, then a word's start, a
  keyword's, the inside of a word, the initials ("hn" Hacker News); at the same kind of match actions come before apps,
  and letters merely in order ("grfn" Grafana) show only when nothing else fits. Actions: Ambient, Lock, Settings, Full screen, Weather details, play / pause the music (the radio; the owner's
  Spotify or home station, with ⏭), Sounds (the panel, play / pause, each sound on / off, each preset), the scene
  gallery, a random scene or any scene by name; the owner also gets Notifications, Reminders, Pins and the books in
  Reading (Continue in Kavita). Then every app on the Services card (the internal ones when signed in), opening in a
  new tab. The owner can type **remind buy milk** (or **nhắc mua sữa**) to add a reminder and **pin example.com** to
  pin a link (when one parses it's the top row). Nothing typed: in Ambient 👁 Show panels first, then the last few run
  (this browser), then the most useful. Never while locked. Esc in any sheet opened over Ambient (this one, Sounds,
  the inbox, Reminders…) closes just that sheet, like its ✕ or a tap outside; Esc with nothing open leaves Ambient.
- **Full screen**: **F** anywhere, or ⛶ beside 🎨 on the lock screen (also locked, where it never counts as
  an unlock; not while typing or with a dialog open). The whole page through the Fullscreen API (webkit's on iPadOS);
  no button where the browser has none (iPhone Safari). Going full screen doesn't wake Ambient's bar.
- **Ambient, Lock**: two ways to see just the scene, each with one job.

  | | when | shows | back with |
  | --- | --- | --- | --- |
  | **Ambient** (just the scene, music at hand) | ⛰ (bottom right), **H**, or by itself after Settings › Ambient after N s without input | scene + a slim bar (the music that plays: radio, Spotify or the Player, sounds, weather, time, server) + the dock (👁, 🔒). After 5 s without input the bar and the dock fade, leaving the scene, or the scene + a big clock (Settings › When the bar fades); any input brings them back, and only that (the tap, key or wheel that wakes them doesn't also press anything) | 👁 on the dock, **Esc**, **H**, or a tap / click on the bare scene while the bar shows |
  | **Lock** (I'm away, hands off) | 🔒 (on the dock, bottom right), **L** or **Space ×3** quickly (Ambient never locks) | scene + clock + weather + a breathing *swipe to unlock*, in its own look, + what's playing (Lock screen › Music) | **swiping up** anywhere (mouse or finger: far enough or a quick flick; a short one springs back), or **holding Space** ~1 s / **↑ five times**: a small bar fills in the hint's place (let go to empty it), and full, the lock slides away like a swipe |

  The lock has its own look (Settings › Lock screen, or 🎨 top right on the lock screen); Ambient's clock keeps the plain one.
  🎨 (and ⛶ beside it) shows while the pointer is in the top right corner and for 3 s after a click / tap anywhere (other keys, like
  Alt+Tab, don't wake it). Switching windows (Alt, Tab, Ctrl, Shift, Meta) doesn't wake Ambient's bar either, and the
  bar and the dock stay while the mouse rests on one of them or the keyboard is in it. Ambient never comes on by itself while locked, with a
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
    (Playing · Paused · Loading next song · Queue is empty · Stopped · Tavarian unreachable · Disconnected —
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
  whatever music plays (it never pauses the radio, the Player or Spotify, and has its own volume). A slim **Sounds row**
  at the bottom of the music card (under every tab) shows what's on (the preset, the sounds that are on, or Off), with
  ▶ / ⏸ for the sounds and a button that opens the panel; **A** opens it too: a tile per sound (tap: on / off, slider: its level), presets (Rainy café, Cozy fireplace,
  Storm night, Seaside, Deep focus), ▶ / ⏸, volume with mute, a sleep timer (15–90 min, then a slow fade out) and Reset.
  Rain, Wind, Brown noise, Fireplace and Ocean are **generated in the browser** (Web Audio, no files): noise beds and
  pre-rendered drop / crackle loops that loop seamlessly, shaped by filters and slow random envelopes (gusts, swells)
  scheduled on the audio thread, so they cost almost no CPU and keep going in a background tab. Fades are ~1.5 s, and
  with nothing to hear the audio context sleeps. The mix is a setting (saved per browser, synced for the owner); nothing
  starts by itself on load, the first tap on a tile, a preset or ▶ does. While sounds play, Ambient's bar and the lock
  screen show a small 〰 Sounds chip that mutes / unmutes. On a phone they **keep playing with the screen locked** and
  past iOS's silent switch: while they play, the page asks iOS for a `playback` audio session
  (`navigator.audioSession`, Safari 16.4+) and plays a quiet 6 s `<audio>` loop next to the Web Audio graph (the sound
  itself stays on the graph, as on a desktop). Like any music player, that pauses other apps' audio on the phone. When
  no music of the page plays, the lock screen / notification shows *Sounds* with the preset (or the sounds that are on)
  and ⏯; the radio and the Player take it back when they start. A call or another app pausing them stops the sounds;
  the lock screen's ▶ (or the panel's) starts them again. Recorded loops (Café, Birds, Thunder, City) are in the
  registry but hidden until their files exist: put `public/sounds/<id>.m4a` in place and set `ready: true` in
  `lib/sounds.js` (fetched and decoded the first time they're turned on, looped gaplessly past the encoder's padding).
- **Weather**: current conditions, a color-coded US AQI pill, and a location search. The server proxies a weather API, so the browser never calls it directly.
  - Click the card (or **Details ›**) for a details panel: a 24-hour temperature + rain chart, 7 days, air quality (PM2.5 / PM10 / O₃ and advice), sun and wind.
  - The panel loads `/api/weather/detail` only when opened, and reuses it for 10 minutes per location.
  - The card refreshes every 5 minutes. Near Ho Chi Minh City its *now* is Tan Son Nhat airport's latest report (METAR, every 30 min, swapped in by the weather API), marked *Observed at Tan Son Nhat · 14:30*; elsewhere it's Open-Meteo's forecast for the hour. With the station, *now* in the details chart and the card's Rain Chance are what it sees too (raining there = 100 %; dry = half the forecast's chance, so a storm on its way still shows); from the next hour on it's the forecast.
- **Notifications** (owner only): machines on the LAN (n8n, cron, Coolify, a script) POST a small notice to
  `/api/notify`, and it shows on every open device a moment later: a pop-up and a 🔔 badge on the dashboard, a chip on
  Ambient's bar, one quiet line under the big clock when the bar fades, a short stack on the lock screen. See
  [Notifications](#notifications-owner-only).
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

⚙️ (in the header, by the bell) opens Settings. Changes apply live and are stored **per browser** in one localStorage key
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
| Sounds | in its own panel (the music card's Sounds row / A): the mix (each sound's on / off and level), volume and sleep timer. Synced like the rest; whether sounds play right now isn't |
| Notifications | owner only, once the hub is set up: Pop-ups On / Off · Pop up for Everything / Warnings / Errors · In Ambient Show / Hide (the bar's chip and the screensaver line) · On the lock screen Titles (default: no message text, anyone walking past sees it) / Full / Count / Off |
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
| `WEATHER_API_URL` | see `docker-compose.yml` | `/api/weather`, `/api/weather/detail`, `/api/geo` |
| `PRIVATE_SERVICES_FILE` | `/config/private-services.json` | `/api/private` |
| `DISK_PATH` | `/` | disk stat in `/api/private` |
| `NOTIFY_TOKEN` | empty = off | the senders' Bearer token for `/api/notify` (≥ 16 chars; also needs `DATABASE_URL` and `OWNER_USER`), see [Notifications](#notifications-owner-only) |
| `SERVER_NAME` | `Server` (Coolify: `lenovo`) | this machine's label on the Server card |
| `HOST_AGENTS` | empty | more machines on the Server card, see [Other servers](#other-servers) |
| `KAVITA_URL`, `KAVITA_API_KEY` | empty = off (Coolify: `KAVITA_URL` = `http://10.10.0.217:5000`) | the owner's Reading bar, see [Reading](#reading-owner-only) |
| `NEWS_URL` | empty = off (Coolify: `http://10.10.0.162:8090`) | the owner's News, see [News](#news-owner-only) |
| `REMIND_URL` | empty = off (Coolify: `http://10.10.0.162:8098`) | Reminders with a time, see [Reminders with a time](#reminders-with-a-time-owner-only) |
| `PC_URL`, `PC_WAKE_TOKEN` | empty = off (Coolify: `PC_URL` = `http://10.10.0.217:5007`) | the gaming PC on the Server card and its Wake / Turn off buttons, see [Gaming PC](#gaming-pc) |
| `DB_POOL_MAX` | `4` | connections the server keeps to Postgres, all features together (`lib/db.js`). The `home_lofi` role allows 10, and a deploy runs two containers for a moment |
| `POWER_URL` | empty = hidden (Coolify: `http://power-meter:8080/power.json`) | ⚡ watts on the Server line. Docker hides the CPU's power counters (Intel RAPL) from containers, so a separate root container on the host reads them and serves a 10 s average as `{"watts","cpu","ram","at"}`; it measures CPU package + RAM, not the whole PC at the wall |

### Other servers

The Server card can show more machines (CPU, RAM, temp, disk, uptime, load, watts), one block each.
Each machine runs the small agent in [`agent/`](agent/) (a busybox container, ~1 MB RAM, port 9101,
HTTP basic auth). On that machine (needs Docker):

```bash
curl -fsSL https://static.wliafdew.dev/tools/host-agent/install.sh | bash
```

(`/tools/` on static is LAN-only: the internet only reaches `/public/`. Run it from a machine on the home network.)

It prints a line like `{"name":"debian","url":"http://10.10.0.50:9101/stats.json","token":"..."}`.
Put those lines in a JSON list in `HOST_AGENTS` (Coolify > Environment Variables), e.g.
`[{"name":"debian",...},{"name":"nas",...}]`, and redeploy. A machine whose agent doesn't answer shows
as offline. To update the agent, run the same command again (the token is kept).
For what the CPU's counter can't see (a USB fan, RAM on CPUs without a RAM counter...), add a fixed estimate
in watts to the agent's `.env`, e.g. `echo EXTRA_WATTS=7.5 >> ~/host-agent/.env && cd ~/host-agent && docker compose up -d`;
it's added to ⚡ and the tooltip shows it as estimated.

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
  later in the background; changes from your other devices come in on load, when you return to the tab, and **live**
  while the page is open (colors cross-fade). While Settings or Sounds is open, nothing incoming moves under the cursor.
- **Live**: each open owner tab keeps an event stream (`/api/private/settings/events`) that only says "another device
  saved"; the tab then pulls. A Sounds mix changed on the PC glides in on the phone that plays them about a second
  later (it never starts sounds on a device that isn't playing). A hidden tab lets the stream go at once, unless
  sounds play on it. The streams live in the server's memory: fine for the one container the app runs in.
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

**Live stream.** `/api/private/settings/events` is an event stream under the same login. The app sends
`X-Accel-Buffering: no` and pings every 20 s, but nginx strips `X-Accel-*` before passing a response on, so behind a
chain of proxies only the first one honors it. Give it its own location next to the one above, with the same login
and secrets, and turn buffering off (on every nginx in front; without it the stream may arrive late or not at all,
and sync still works on load and when you return to the tab):

```nginx
location /api/private/settings/events {
    auth_request /internal/home-lofi/authz;
    auth_request_set $home_lofi_user $upstream_http_remote_user;
    proxy_set_header Remote-User $home_lofi_user;                 # from Authelia, never from the client
    proxy_set_header x-home-gate "<GATE_SECRET>";
    proxy_set_header x-home-sync "<SYNC_SECRET>";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_pass http://home-lofi:3000;                             # same upstream as above
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

### Notifications (owner only)

Optional. A small notification hub: anything on the LAN that can make an HTTP request (n8n, a cron job, a deploy hook,
`scripts/notify.sh`) sends a notice, and the owner's open devices show it about a second later. Needs
[Settings sync](#settings-sync-owner-only) to work (it rides on its login, database and live stream), plus
`NOTIFY_TOKEN` (`openssl rand -hex 32`). Without the token the hub is off: `/api/notify` answers 404 and there's no bell.

**Send one**: `POST /api/notify` with `Authorization: Bearer <NOTIFY_TOKEN>` and a JSON body (16 KB at most):

| field | type | what it does |
| --- | --- | --- |
| `title` | string, **required**, ≤ 80 | the headline (one line) |
| `body` | string, ≤ 500 | the detail; newlines are kept; plain text, never HTML |
| `level` | `info` (default) · `success` · `warning` · `error` | the default icon and color; an `error` pop-up stays until closed, and on the screensaver warnings and errors stay while unread |
| `source` | string, ≤ 32 | who sent it (`coolify`, `backup`), in small mono text next to the time |
| `icon` | `fa:<name>` (Font Awesome solid), `fa-brands fa-<name>`, `fa-regular fa-<name>`, or an `https://` image URL | drawn in the page's icon well, like a service card's. Emoji aren't icons here: anything else falls back to the level's icon |
| `color` | `primary` · `secondary` · `highlight` · `muted` · `green` · `red` · `blue` · `purple` | the accent, from the page's own palette (the first three follow the theme). No hex values. Default: info = primary, success = green, warning = highlight, error = red |
| `url` | http(s) URL | a click on the pop-up or the inbox title opens it |
| `tag` | letters, digits, `. _ : / -`, ≤ 64 | **replaces** the earlier notice with the same tag (`deploy-home-lofi`: "started…" then "done ✓" as one item); the new one counts as new again |
| `silent` | boolean | inbox only: no pop-up |
| `ttl` | seconds, 10 – 2592000 | it goes by itself after that ("X is down" that fixes itself) |

Answers: **201** `{ id, at, warnings? }` (warnings: text cut to its limit, an icon / color / url the page can't use and
left out, unknown fields), **400** `{ error, field }` (no title, a wrong type, an unknown level, a bad tag / ttl /
silent), **401** bad token, **404** hub off, **413** too large, **415** not JSON, **429** more than 60 a minute from one
address (300 in all), **503** database down.

```sh
curl -X POST https://home.wliafdew.dev/api/notify \
  -H "Authorization: Bearer $NOTIFY_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Backup done","body":"nextcloud → b2 · 4.2 GB","level":"success","source":"backup","icon":"fa:database"}'

# the same with the helper (plain sh + curl: copy it to any box)
NOTIFY_TOKEN=… scripts/notify.sh -l success -s backup -i fa:database "Backup done" "nextcloud → b2 · 4.2 GB"
long_job && scripts/notify.sh -l success "Job done" || scripts/notify.sh -l error -t job "Job failed"
```

**On the page** (`app/notify.js`, rules in `lib/notify.js`):

- **Dashboard**: 🔔 next to the scene picker with the unread count; new ones pop up top right (6 s; hovering holds them;
  at most 3, then "+N more"). The bell or **N** opens the inbox: the newest 50 by day, ✕ to dismiss one, **Clear all**.
  It drops down under the bell (a bottom sheet on phones); a click outside or Esc closes it. Opening it reads
  everything, on every device.
- **Compact** (Ambient, bar up): a chip on the bar with the newest unread (phones: the icon and the count). It opens the inbox.
- **Screensaver** (Ambient, bar faded): one quiet line under the big clock, or a small pill at the bottom with *Scene
  only*. Info and success go after 30 minutes; warnings and errors stay until read.
- **Lock screen**: the newest 3 unread as cards above the music, then "+N more". By default **titles only** (no message
  text: anyone walking past sees the lock screen); Settings can show the full text, only a count, or nothing.
  **Swipe** a card left or right to dismiss it (like ✕ in the inbox), or the "+N more" / count pill to mark them all
  read (they leave the lock screen; the inbox keeps them). It happens on every device: there the card fades and the
  rest glide up. An upward swipe still unlocks (which way a press goes is settled in its first 8 px).

**How they arrive**: the notice goes into Postgres (two small tables, created on first use; the newest 200 are kept,
none older than 30 days). The server then says `notify` on the owner's live stream (`/api/private/settings/events`,
the one settings sync uses: one connection per device) and each open tab pulls
`/api/private/settings/notifications`. Tabs also pull on load and when they're shown again, so a phone that was
asleep catches up. What arrived since a tab last looked pops up; the backlog on a fresh load only shows on the badge.
Read state is one number per owner ("read up to id N"), so the badge clears everywhere at once.

**Proxy**: the owner's routes sit under `/api/private/settings`, so the settings-sync locations above already cover
them (nothing to add). `/api/notify` is meant for the LAN: on the **external** proxy host, block it (the token is the
lock either way, but nothing outside needs to reach it), on the proxy host's **Advanced** tab:

```nginx
location = /api/notify { return 404; }
```

### Agents (owner only)

Agents (Claude Code on a machine, the news agent, a long job) have **their own channel** on the same hub: the 🤖 next to
the bell, with its own count, its own inbox, its own read state and its own 200 kept. The bell keeps the services
(deploys, updates, CrowdSec, Habits, the morning summary). Same URL, same token, with `kind: "agent"`:

| field | type | what it does |
| --- | --- | --- |
| `kind` | `"agent"`, **required** | the agents' channel (without it, it's a service notice) |
| `agent` | string, **required**, ≤ 32 | who: `Claude Code · linh-3`, `News agent` |
| `project` | string, **required**, ≤ 48 | what it works on (the inbox groups by it): `musoni`, `home-lofi` |
| `state` | `needs-you` · `failed` · `done` · `working`, **required** | decides the look and the alerts (below) |
| `title` | string, **required**, ≤ 100 | one line |
| `content` | string, ≤ 2000 | the detail: 3 lines on the card, then **Show more**. Line breaks, `- ` / `1. ` lists and `` `code` `` are kept; never HTML |
| `session` | letters, digits, `. _ : / -`, ≤ 60 | **one card per session**: a newer message from it replaces the last one (working → needs you → done) |
| `icon` | like a notice's (`fa:<name>`, an `https://` image) | the agent's own icon in the card's well; default a robot |
| `url` | http(s) URL | the title links there (a PR, a log) |
| `ttl` | seconds, 10 – 2592000 | it goes by itself after that |

| state | looks | pop-up / phone push | counted on 🤖 |
| --- | --- | --- | --- |
| `needs-you` | amber chip; the 🤖 turns amber | yes | yes |
| `failed` | red chip; the pop-up stays until closed | yes | yes |
| `done` | green chip | no | yes |
| `working` | grey chip, a slow gear | no | no |

Unread needs-you and failed also show where the bell's do: Ambient's chip, the screensaver line and the lock screen
(swiping one there dismisses it in the 🤖 inbox). Answers are the same as a notice's (`400 { error, field }` for a
missing agent / project / title or an unknown state). The pushes read `Needs you · musoni`, then the title and content.

```sh
curl -X POST https://home.wliafdew.dev/api/notify \
  -H "Authorization: Bearer $NOTIFY_TOKEN" -H 'Content-Type: application/json' \
  -d '{"kind":"agent","agent":"Claude Code · linh-3","project":"musoni","state":"needs-you","title":"Allow: git push origin main?","session":"linh-3:4f1c"}'
```

**Claude Code**: the hook in `~/Projects/claude-notify` (setup for a machine: its `SETUP.md`) sends working on a prompt,
needs-you on a permission prompt or idle, and done with Claude's last message, one card per session.

The page: `app/agents.js` (the 🤖 and its inbox), rules in `lib/agents.js`; the owner's route is the bell's with
`?ch=agents` (`GET`, and `POST` read / dismiss / clear, each only on its own channel).

### Reminders with a time (owner only)

Optional (`REMIND_URL`). Reminders get times: the owner's **reminders API** on the Razer (`http://10.10.0.162:8098`: a
small model reads a sentence in Vietnamese or English, SQLite keeps the reminders) does the timed ones, and Reminders'
own carry-over list keeps the ones without a time. **One box** for both, in the Reminders sheet and pop-up:

- **"nhắc tôi 7h tối gọi mẹ"**, "mai 8h sáng đi khám răng", "uống thuốc 9h tối mỗi ngày": it has a time, so it's saved in
  the API (the model's title, its time, a repeat).
- **"buy milk"**, "mua sữa": no time, so it goes on the carry-over list **as typed** (the model would translate an English
  line into Vietnamese), on screen from 06:00 until it's held done, as before.
- The model takes ~5 s when it's waking up (the box says so), then ~1 s. If it fails, the text stays and **Save
  without a time** puts it on the carry-over list.
- **Where to type it:** the pill in the bottom-left corner is always there now (on the dashboard). With nothing open
  it's a quiet **+ Remind me** (or "2 coming up · next 19:00 today"); a tap opens it on the box, with the next few
  coming up and **All reminders** (the sheet). ⌘K's typed **remind …** goes through the model too, then opens the pop-up.

The sheet groups them: **Due now** (highlighted, with **Done** and **Snooze 10 min**), **Today**, **Coming up** (times
as "19:00 today", "tomorrow 08:00", "Fri 30/10 19:00", ↻ for a repeat; ✓, ✎ edit the title / day / time / repeat, a
two-tap delete), **No time** (the carry-over list), then **Done** (folded: both lists' last 50, with **Reopen**).

**When one is due**: the pop-up opens with it at any hour (Done / Snooze; tucking it holds until something else rings),
and it shows on Ambient's chip, under the big clock and on the lock screen. The server checks the API every 30 s
(`lib/timed-ticker.js`, page open or not) and sends each time a reminder rings **once** through the notification hub:
the 🔔, a pop-up, and a **push to the phones**. Done, snooze or delete takes that notice off; a snooze ending or a
repeat's next time rings again. A repeating one done moves to its next time (the API's rule).

- Only this server talks to the API: it's on the LAN with no login, so never expose port 8098 or put it behind a proxy.
  The browser asks `/api/private/settings/reminders/timed` (owner-only): `GET` (open ones), `GET ?history=1`, `POST`
  `{ action: 'add', text, plain? }` / `done` / `reopen` / `delete` / `snooze` (`minutes`) / `edit` (`title`, `when`:
  `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` in +07:00, `repeat`). 502 when the API is down; 503 `{ plain: true }` when the
  model couldn't read the sentence.
- Rules in `lib/timed.js`, the API client in `lib/timed-fetch.js` (8 s per call, 60 s for a sentence, 1 MB, no
  redirects, never says the address), the page in `app/timed.js`. Without `REMIND_URL` Reminders is the carry-over list
  alone, as before.

### The owner's assistant on the LAN (Jade)

Lets the owner's voice assistant (Jade, on the Razer) read the schedule and do a few things on the home page.
There's no token: these paths sit under `/api/private`, so the proxy's gate decides.
- On the LAN: no login.
- From the internet: Authelia's login first.
- Not through the proxy: 404.
- Writes need a JSON body, and a browser on another site is refused (403), so a web page can't ride on the LAN's trust.
- Rules: `lib/schedule.js` and `lib/assistant.js`. Tests: `lib/schedule.test.js` and `lib/assistant.test.js`.

**Read:**
- **`GET https://home.wliafdew.dev/api/private/schedule?date=YYYY-MM-DD`** (empty: today) returns the habits due that
  day and the Reminders carry-over list.
  - Each habit has `{ title, start, end, all_day, window, minutes, repeat, days, done, done_at, late, rating, identity }`.
  - Times are ISO 8601 in the habits' zone (`+07:00`).
  - Timed reminders aren't here: they live in the reminders API on the Razer.
- **`GET …/api/private/schedule/routines?days=14`** (1–60) returns every habit's routine with its streak and the last N
  days: `due`, `kept`, `on_time`, `late`, `missed`, ratings.

**Do:**
- **`POST …/api/private/assistant/remind`** `{ text, plain? }` adds a reminder the way the Reminders box does:
  - The model reads it. With a time it rings then, on the page and the phone; without one it goes on the carry-over
    list as typed.
  - Answers 201 `{ added }`.
  - 503 `{ plain: true }` means the model couldn't read it: send it again with `plain: true`.
- **`POST …/api/private/assistant/habit`** adds a habit, checked like the card's editor. It can only add: changing or
  archiving one stays on the card.
  - Body: `{ name, when: {kind:'time', at} | {kind:'window', from, to} | {kind:'any'}, days: [1..7] | ['Mon', …] |
    'daily' | 'weekdays' | 'weekends', minutes?, identity?, icon? }`.
  - Answers 201 `{ habit }`, 400 `{ error, field }`, or 409 when there are already 20.
- **`POST …/api/private/assistant/music`** `{ action: 'play' | 'pause' | 'toggle' | 'next' }`:
  - The owner's page that's **showing** presses its music card's ⏯ / ⏭ (the radio, Spotify or the home station,
    whatever the card is on), the same as Quick actions' Play.
  - It goes down the live stream (event `remote`).
  - Answers `{ sent }`, or 409 when no page is open.
  - A page nobody has tapped since it loaded may not be allowed to start sound (the browser's autoplay rule).

The owner's open pages show an added reminder or habit within a second (live stream).

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
Next to them, the owner gets the active device's **volume** (a slider + %, its name after *Now playing*): `GET` on the
same route reads the device (owner-only, never in the public `/api/spotify`), `POST { action: 'volume', percent: 0-100 }`
sets it, sent once the slider rests for 300 ms. Devices Spotify won't let anyone else set (an iPhone, some speakers)
show *Volume on <device>* instead.

### Reading (owner only)

Optional. A slim **Reading** bar under Sounds (with the Reminders and Pins bars) for the books you're partway through
in [Kavita](https://www.kavitareader.com), several at once: `Reading · Dungeon Crawler Carl · 1%`, or
`Reading · 2 books · Dungeon Crawler Carl 1%` (the latest first). A tap opens them in a sheet: cover, title, a thin
progress bar, *last read 2 h ago* and **Continue**, which opens Kavita's reader at that book's continue point (epub,
PDF or page reader) in a new tab. In progress = Kavita's own *On Deck* (started, not finished), minus books not opened
for 60 days. Nothing in progress, or Kavita not set up: no bar. Kavita down: the last list stays, quietly marked.

| env | default | what |
| --- | --- | --- |
| `KAVITA_URL` | empty = off | where this server reaches Kavita, e.g. `http://10.10.0.217:5000` (the host's LAN address: Kavita is on its own Coolify network, so its container name doesn't resolve from this one) |
| `KAVITA_API_KEY` | empty = off | a Kavita user's auth key (Kavita › User settings › API keys). **Only in Coolify's env** (or your `.env`): never in git, a log or a browser |
| `KAVITA_PUBLIC_URL` | empty = no links | Kavita's address in the owner's browser, e.g. `https://kavita.example.com` (the Continue and Open Kavita links) |
| `KAVITA_TZ` | `Asia/Ho_Chi_Minh` | Kavita's time zone: it writes read dates in its local time without an offset |

- `GET /api/private/settings/reading` (owner, like the settings next door: needs [Settings sync](#settings-sync-owner-only))
  → `{ on, books: [{ id, name, pages, pagesRead, percent, readAt, href, seriesHref, cover }], kavita }`; `{ on: false }`
  without the two vars; 502 when Kavita can't be reached. Kavita's answer is kept 2 minutes for every tab; the page asks
  on load, when it shows again or regains focus, and when the sheet opens (never on a timer).
- `GET /api/private/settings/reading/cover?id=<series>`: the cover through this server (only for a book on the list,
  a picture of 3 MB at most, `private` cache). The key only buys a short-lived token (`lib/kavita.js`), kept in memory.


### News (owner only)

The digest a news agent on another machine writes (Vietnam and tech, summarised in Vietnamese), read as a **morning
newspaper** (the look of [ThariqS/ai-newtab](https://github.com/ThariqS/ai-newtab)): cream paper, serif headlines
(Libre Bodoni, Newsreader and Libre Franklin, all with Vietnamese, loaded only when it opens), hairline rules and
columns, one red. A 📰 icon by the header's bell, with a dot when an edition you haven't opened has come in; a tap opens
it over the **whole window** (100% wide and high, not the browser's full screen; ✕, Esc or, on a phone, a drag of
its top down close it). On tablets and desktops the ⤡ button by ✕ makes it a panel again (⤢ back), remembered per device.
On top, a **masthead**: the folio (*Vol. I · No. 295*: the year and the day of the year), the paper's name (*The Dalater*), the
dateline (the day; *Morning Edition* before noon, *Afternoon Edition* after, and how many updates; what's unread);
the name folds away while you scroll down a page. It shows **a whole day** (the agent's clock): every edition of it
merged, each story once in its newest words (the agent repeats stories from run to run); stories that came since you
last looked are marked **New**; older days (the archive keeps 30) in the menu at the top, and a new day takes over at
midnight. The day comes in **pages**, picked from the section bar under the masthead: the *Front page* (the lead story
under a big headline and a drop cap, the next two down a second column, the rest under them; beside them the day **in
brief** and the sections, each with its unread and first headline; the brief and the top stories are the newest
edition's, its overview covering the day so far), then one per section (its name large, its 5/5 stories on top, the
rest in two columns on a desktop, each with its category, importance dots, source, how long ago, Hacker News points
and comments, ▾ for the key points; category chips to narrow it, *Next* at the bottom). Swipe between pages on a
phone; on a desktop ← → change pages, j / k move between stories, m marks one read or unread.
**Photos** (the agent's schema 1.6, `item.image`): the lead's under its headline and the next two's over theirs, each
with its credit; the rest a thumbnail on the right; a film's poster stays upright; a read story's photo turns grey. A
newer edition without a story's photo keeps the earlier one's; older editions (no `image`) just have none. The browser
gets them from this server (`GET /api/private/settings/news/image?f=<name>`, owner-only: the agent's `images/<name>`,
an image type only, 3 MB at most, kept privately a week), since a phone out of the house can't reach the agent.
A story's title opens it in a new tab and marks it **read** (dimmed on every device: the server keeps it); ✓ marks one
read or unread, *Mark all read* a section, ▾ shows the whole summary and the original title, 📌 pins its link. Older
days in the menu at the top. Also in ⌘K (*Open news*).
🔄 **Refresh** asks the agent for a fresh edition now, besides its scheduled 07:00 and 15:00 ones: a run takes a few
minutes, the modal says how it's going (on every device), and the new edition shows by itself when it's done (*Show
it* when an older one is open). The agent's own limits (10 minutes between runs, 10 a day) answer with how long to
wait, and the page says so.

| env | default | what |
| --- | --- | --- |
| `NEWS_URL` | empty = off (Coolify: `http://10.10.0.162:8090`) | where this server reaches the agent: `latest.json`, `archive/` (its listing), `archive/<YYYY-MM-DD_HHMM>.json`, and for Refresh `POST /api/run` and `GET /api/status` (no status: no 🔄) |

- `GET /api/private/settings/news[?day=YYYY-MM-DD]` (owner) → `{ on, digest: { edition, at, first, updates, overview,
  top, sections: [{ key, title, items }] }, day, picked, today, days: [{ day, updates, last }], latestAt, read, seen }`
  (items carry `since`: when the story first came); `{ on: false }` without
  `NEWS_URL`; 502 when the agent can't be reached and nothing was loaded yet (once loaded, the last copy stays).
  `POST { action: 'read' | 'unread', ids }` / `{ action: 'seen', at }` / `{ action: 'refresh' }` (→ `{ ok, started }`,
  or 429 `{ nextAt }`: the agent's limits). GET also has `run` (the agent's newest run: `{ state, startedAt,
  finishedAt, items, cost, error }`, its status kept 4 s) and `nextAt`; while a run is going the page asks every 8 s,
  and once it's done `latest.json` is asked again at once.
- Whatever the agent writes is checked first (`lib/news.js`): known fields only, cut to size, links http(s) only,
  importance 1–5; a story without a title or link is left out. `schema_version` isn't checked (1.2–1.5 so far, each
  only adding fields). A film's `platform` (1.5: where to watch it, e.g. `["Netflix"]`, `["Rạp chiếu"]`) shows as pills
  after its title (📺, 🎬 for the cinema; known services in their colour). `latest.json` is kept a minute, the archive's listing
  5 minutes, an archived digest for good (the newest 12). The page asks on load, when it shows again, every 10 minutes
  while on screen, when the modal opens, and when another device reads something (`news` on the live stream).
- Read stories are kept 45 days (`news_reads`), the newest edition opened in `news_seen`.

### GitHub (owner only)

The same agent's GitHub picks of the day, behind a GitHub icon next to 📰 (a dot: a list not opened yet). It opens like
News, on the same paper (the whole window or a panel, one ⤡ / ⤢ choice for both; a masthead: *The Dalater*, *GitHub*,
the day, how many repos and unread; the name folds away as you scroll): *This week* (the agent's overview, in columns
on a desktop), then the repos in ruled columns: rank, category, *New* (new on the list today), worth trying (●●●●○), name (opens it and marks it read), language,
★ stars, +★ this week, forks, licence, and a summary in Vietnamese. ▾ opens *Tính năng*, *Giúp gì khi làm app*, *Khi
nào dùng*, the quick start (copied with a tap), its homepage and topics; 📌 pins it, ✓ marks it read. Filters on top:
All / Trending / New, ★ 4+, a category (kept across openings). Older days in the menu at the top (the agent keeps 30).
Also in ⌘K (*Open GitHub trending*).

- Agent files (`NEWS_URL`): `github.json`, `github-archive/` (its listing), `github-archive/<YYYY-MM-DD_HHMM>.json`
  (the newest of each day is that day's), `github-schema.json` (schema `gh-1.0`: fields only ever added).
- Late: the list is made about 06:00. After 06:05 a list from an older day says *Chưa cập nhật* and the page asks
  again every 15 minutes (until 08:00 it says so).
- `GET /api/private/settings/github[?day=YYYY-MM-DD]` (owner) → `{ on, digest: { date, at, overview, repos }, day,
  picked, today, days: [{ day, last }], latestAt, late, retry, stale, read, seen }`; `POST { action: 'read' | 'unread',
  ids: ['owner/name'] }` / `{ action: 'seen', at }`. Checked first (`lib/github.js`), cached like News'.
- Read repos are kept with News' (`news_reads`, as `gh:<owner/name>`), the newest list opened in `github_seen`.
### Focus (owner only)

A small Pomodoro that is **the same on every device**: ⏱ at the top of the dock, over ⛰ (a ring fills as the phase goes:
the accent for focus, green for a break, grey while paused). A tap opens a sheet: the big countdown, **25 / 5** or
**50 / 10** to start, Pause / Resume, Skip, Stop, and 🍅 today. Start it on the PC and the phone's icon is already
counting; pause it on the phone and the PC pauses. While one runs, a countdown chip sits on Ambient's bar and the lock
screen. Rounds go on (focus, break, focus, …) until stopped; one left alone for 12 hours (no pause, resume or skip)
ends at its next change.

- The session lives on the server (Postgres, `DATABASE_URL`; tables `focus_sessions`, `focus_days`, `focus_claims`).
  Every answer carries the server's clock, and pages count down with it, never with their own, so all devices show the
  same mm:ss. Each change goes out on the live stream (`focus`), so other open devices follow within a second.
- The phase changes are the server's (`lib/focus-ticker.js`, a timer to the second plus a check each minute): a focus
  that runs out counts 🍅, the break starts by itself, and a notice goes to the hub and as a push to your phones
  (*Focus done · 5 min break*, *Break over · back to focus*), even with every page closed. Each change is claimed once
  in the database, so a restart or a second server never counts or buzzes twice. Pages on screen chime softly.
- `GET /api/private/settings/focus` (owner, like the settings next door) → `{ session, today: { day, n }, now, tz,
  minute, presets }`; `POST { action: 'start', preset: '25/5' | '50/10' }`, `{ action: 'pause' | 'resume' | 'skip' |
  'stop' }` → the same (409 with it when the action makes no sense now).
- `FOCUS_TEST_MINUTE_MS` (1000–59999): a minute this long, for checking a phase's end locally (e.g. `FOCUS_TEST_MINUTE_MS=2000
  npm run dev`, two browsers signed in as the owner: a 25 / 5 is 50 s / 10 s). A production server (`NODE_ENV=production`)
  ignores it unless `FOCUS_TEST_IN_PRODUCTION=1` is set as well, and logs a warning when it's on.

### Tavarian player

Optional, server side of the music card's **Player** tab: a station inside [Tavarian](https://tavarian.wliafdew.dev)
(its "home player") that plays any song you queue. Off until `TAVARIAN_TOKEN` is set.

| env | default | what |
| --- | --- | --- |
| `TAVARIAN_URL` | `https://tavarian.wliafdew.dev` | Tavarian's address (API under `/api/v1`, audio under `/home-audio/stream`) |
| `TAVARIAN_TOKEN` | empty = off | a Tavarian API token for the home player. **Only in Coolify's env** (or your `.env`): never in git, a log or a browser |
| `TAVARIAN_PROXY` | empty or `off` = direct | an HTTP proxy for this server's calls to Tavarian (API, event stream, status check), e.g. `http://10.10.0.217:1082` (the home WARP proxy, the Coolify default; set `off` there to go direct) when the direct route loses packets. If the proxy fails, the call goes direct. Browsers' audio never uses it |

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
  and only while listening. **Continuous listening** (a Tavarian that sends `linkId`): one connection
  (`streamUrl?linkId=…`) plays song after song, with Tavarian's own silence while the next one loads, so a phone's
  audio never stops between songs; a cut (skip, seek, previous, play now, pause) moves the link on, Tavarian closes the
  connection and the page joins the new link at once (the jump is heard right away). An older Tavarian: a new
  `streamId` (song change, seek, resume) swaps the audio source. Paused / idle lets it go and it comes back by itself;
  a broken stream is retried a few times (with a fresh ticket from the second try).

Routes:

| route | who | what |
| --- | --- | --- |
| `GET /api/tavarian/events` | public | Server-Sent Events: `status`, `state`, `queue`, `audio-ready`, `song-error`, `revoked`; status, state and queue right away, `: ping` every 20 s. 4 open per IP (429), 503 `tavarian_off` when not set up |
| `GET /api/tavarian/state` | public | `{ state, queue, live }` for the first paint and as the fallback when the stream can't stay open |
| `POST /api/tavarian/ticket` | public, same-origin JSON | `{ clientId }` → `{ ticket, expiresAt, streamUrl }`; audio: `streamUrl?linkId=…&clientId=…&ticket=…` (continuous) or `?streamId=…` (one song). 10 a minute per IP |
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

## Gaming PC

The Server card shows the gaming PC under the machines: CPU, RAM, GPU and power tiles (CPU and GPU temperature in
their labels), with uptime and CPU fan on its line, while it's on; a red **offline · last seen HH:MM** and dimmed tiles
while it's off. The numbers come from [Moni](https://github.com/thewind121212/moni): its Windows service broadcasts
them once a second on the LAN (UDP 5005, for the Moni clock), and `moni-relay` (that repo's `relay/`, a container on
this host with host networking) serves the latest at `GET /status`. `lib/pc.js` asks it at most every 2 s for all tabs,
and gives up after 1.5 s (a stopped relay is remembered 15 s), so `/api/private` never waits on it.

**Wake** (Wake-on-LAN): while the PC is off the owner gets a Wake button. It posts to `/api/private/settings/pc`,
which, like settings sync, is behind the Authelia login on every network (the LAN included, where the numbers
themselves are open); a guest sees **Sign in to wake**. The server then calls the relay's `POST /wake` with
`Authorization: Bearer PC_WAKE_TOKEN`; the relay sends the magic packet and reports **waking…** until the PC is back.

**Turn off**: while the PC is on the owner gets a Turn off button; a second click within 4 s (**Turn off now?**)
confirms. It posts `{ action: 'off' }` to the same route, the server calls the relay's `POST /shutdown` (same token),
and the relay sends a signed request (HMAC with its `MONI_PC_KEY`, time-limited, single use) to the Moni service on the
PC, which shuts Windows down at once, closing open apps without saving. The header shows **turning off…** until the
PC stops reporting. The button only appears once the key is set both in the relay's `.env` and in the Moni app
(Settings → Turn off from the home page); guests never see it.

| env | default | |
| --- | --- | --- |
| `PC_URL` | empty = off (Coolify: `http://10.10.0.217:5007`) | moni-relay. The host's LAN address: the relay uses host networking (LAN broadcasts don't reach a bridged container) |
| `PC_WAKE_TOKEN` | empty = no Wake / Turn off button | the relay's `MONI_WAKE_TOKEN` (≥ 16 chars). **Only in Coolify's env**: never in git, a log or a browser |

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
