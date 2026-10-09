// Public-only content. Scenes = files in public/scenes/<id>.{webm,mp4,webp}.

export const SCENES = [
  'amsterdam', 'athens', 'bangkok', 'barcelona', 'berlin', 'budapest', 'buenos-aires', 'cairo', 'cape-town',
  'chicago', 'copenhagen', 'dubai', 'dublin', 'florence', 'hamburg', 'hong-kong', 'istanbul', 'kyoto', 'lisbon',
  'london', 'madrid', 'marrakech', 'mexico-city', 'miami', 'munich', 'new-delhi', 'new-york', 'osaka', 'paris',
  'prague', 'rio', 'rome', 'rome-colosseum', 'san-francisco', 'seattle', 'seoul', 'singapore', 'sydney', 'tokyo',
  'vancouver', 'venice',
]

// Scenes that also have day versions (<SCENES_URL>/day/..., same layout as the night files): played from sunrise to
// sunset at the Weather card's location, the rest of the time (and for every other scene) the night files.
// Add an id once its day/ files are uploaded; a missing day file still falls back to the night one.
export const DAY_SCENES = ['amsterdam', 'bangkok', 'barcelona', 'berlin', 'cairo', 'dubai', 'hong-kong', 'istanbul', 'kyoto', 'lisbon', 'london', 'marrakech', 'mexico-city', 'new-delhi', 'new-york', 'paris', 'prague', 'rio', 'rome', 'seattle', 'seoul', 'singapore', 'sydney', 'tokyo', 'venice']

// Where scene videos are served from: '/scenes' = this app's public/scenes, or a static host / CDN
// (e.g. https://static.example.com/scenes). Build-time (NEXT_PUBLIC_), see docker-compose.yml build args.
export const SCENES_URL = (process.env.NEXT_PUBLIC_SCENES_URL || '/scenes').replace(/\/$/, '')

// your Steam profile (SteamID64): the Steam card's link and its live status (lib/steam.js)
export const STEAM_ID = '76561198132741545'

const S = 'https://static.wliafdew.dev/public/' // (only /public is served to the public)

export const SERVICES = [
  {
    section: 'Sites',
    items: [
      { name: 'Profile', href: 'https://profile.wliafdew.dev', icon: S + 'profile-icon.png', status: 'profile' },
      { name: 'Curriculum Vitae', href: 'https://nextcloud.wliafdew.dev/s/d2n8bEKK4FJBDbW', icon: S + 'cv-icon.png', status: 'nextcloud' },
      { name: 'Weather', href: 'https://weather.wliafdew.dev', icon: S + 'weather-icon.png', status: 'weather' },
      { name: 'Musoni', href: 'https://musoni.wliafdew.dev', icon: 'https://musoni.wliafdew.dev/favicon.svg', status: 'musoni' },
      { name: 'Tavarian', href: 'https://tavarian.wliafdew.dev', icon: 'https://tavarian.wliafdew.dev/tavarian-logo.webp', status: 'tavarian' },
    ],
  },
  {
    // self-hosted apps with their own login. status = public health check (/api/status);
    // widget = extra stats shown only when signed in (/api/private)
    section: 'Apps',
    items: [
      { name: 'Nextcloud', href: 'https://nextcloud.wliafdew.dev', icon: S + 'nextcloud.png', status: 'nextcloud', widget: 'nextcloud' },
      { name: 'Passbolt', href: 'https://passbolt.wliafdew.dev', icon: S + 'passbolt.png', status: 'passbolt', deco: 'vault' },
      { name: 'n8n', href: 'https://n8n.wliafdew.dev/', icon: S + 'n8n.png', status: 'n8n', widget: 'n8n' },
      { name: 'Grafana', href: 'https://grafana.wliafdew.dev', fa: 'fa-solid fa-chart-line', status: 'grafana', deco: 'graph' },
      { name: 'Termix', href: 'https://terminal.wliafdew.dev', fa: 'fa-solid fa-terminal', status: 'termix', deco: 'shell' },
    ],
  },
  {
    section: 'Developer',
    items: [
      { name: 'GitHub', href: 'https://github.com/thewind121212', fa: 'fa-brands fa-github' },
      { name: 'Gitea', href: 'https://git.wliafdew.dev', fa: 'fa-brands fa-git-alt', status: 'gitea' },
      { name: 'Daily Dev', href: 'https://app.daily.dev/', icon: S + 'dailydev.png' },
      { name: 'Hacker News', href: 'https://news.ycombinator.com/', icon: S + 'hackernews.png' },
      { name: 'Simon Willison', href: 'https://simonwillison.net/', icon: S + 'simonwillison.png' },
    ],
  },
  {
    section: 'Contact',
    items: [
      { name: 'Facebook', href: 'https://www.facebook.com/tranduylinh.linh.5/', icon: S + 'facebook.png' },
      { name: 'LinkedIn', href: 'https://www.linkedin.com/in/tr%E1%BA%A7n-duy-linh-5988a5180/', icon: S + 'linkedin.png' },
      { name: 'Discord', href: 'https://discord.com/users/360376059515895808', icon: S + 'discord.png' },
    ],
  },
  {
    section: 'Entertainment',
    items: [
      { name: 'YouTube', href: 'https://www.youtube.com/@jadealdemir3097', icon: S + 'youtube.png' },
      { name: 'Vuniper', href: 'https://vuniper.com/movies', icon: S + 'vuniper.png' },
      { name: 'Steam', href: `https://steamcommunity.com/profiles/${STEAM_ID}`, icon: S + 'steam.png', deco: 'steam' },
      { name: 'Spotify', href: 'https://open.spotify.com/', fa: 'fa-brands fa-spotify' },
      { name: 'IMDb', href: 'https://www.imdb.com/', fa: 'fa-brands fa-imdb' },
      { name: 'RogerEbert', href: 'https://www.rogerebert.com/', icon: S + 'rogerebert.png' },
    ],
  },
]

// Authelia portal guarding /api/private (sign in / sign out links on the page)
export const AUTH_URL = 'https://auth.wliafdew.dev'

// Public "is it up" checks: [URL, ok(json)?]. Without ok(), any HTTP status < 400 (after redirects) counts as up.
// Only up/down + response time is shown, never versions or internals.
export const STATUS_CHECKS = {
  profile: ['https://profile.wliafdew.dev'],
  weather: ['https://weather.wliafdew.dev'],
  musoni: ['https://musoni.wliafdew.dev'],
  tavarian: ['https://tavarian.wliafdew.dev/login'], // / only redirects here: one request less
  nextcloud: ['https://nextcloud.wliafdew.dev/status.php', (j) => j?.installed === true && !j.maintenance],
  passbolt: ['https://passbolt.wliafdew.dev/healthcheck/status.json', (j) => j?.body === 'OK'],
  n8n: ['https://n8n.wliafdew.dev/healthz', (j) => j?.status === 'ok'],
  grafana: ['https://grafana.wliafdew.dev/api/health', (j) => j?.database === 'ok'],
  termix: ['https://terminal.wliafdew.dev'],
  gitea: ['https://git.wliafdew.dev/api/healthz', (j) => j?.status === 'pass'],
}
