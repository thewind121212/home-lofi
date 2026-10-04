// Public-only content. Scenes = files in public/scenes/<id>.{webm,mp4,webp}.

export const SCENES = [
  'amsterdam', 'athens', 'bangkok', 'berlin', 'budapest', 'cairo', 'cape-town', 'copenhagen', 'dubai',
  'dublin', 'florence', 'hamburg', 'hong-kong', 'istanbul', 'lisbon', 'london', 'madrid', 'mexico-city',
  'miami', 'munich', 'new-delhi', 'new-york', 'osaka', 'paris', 'prague', 'rio', 'rome', 'rome-colosseum',
  'san-francisco', 'seattle', 'seoul', 'singapore', 'sydney', 'tokyo', 'vancouver',
]

// Where scene videos are served from: '/scenes' = this app's public/scenes, or a static host / CDN
// (e.g. https://static.example.com/scenes). Build-time (NEXT_PUBLIC_), see docker-compose.yml build args.
export const SCENES_URL = (process.env.NEXT_PUBLIC_SCENES_URL || '/scenes').replace(/\/$/, '')

const S = 'https://static.wliafdew.dev/'

export const SERVICES = [
  {
    section: 'Sites',
    items: [
      { name: 'Profile', href: 'https://profile.wliafdew.dev', icon: S + 'profile-icon.png', status: 'profile' },
      { name: 'Curriculum Vitae', href: 'https://nextcloud.wliafdew.dev/s/d2n8bEKK4FJBDbW', icon: S + 'cv-icon.png', status: 'nextcloud' },
      { name: 'Weather', href: 'https://weather.wliafdew.dev', icon: S + 'weather-icon.png', status: 'weather' },
      { name: 'Uptime', href: 'https://uptime.wliafdew.dev/dashboard', icon: S + 'uptime-kuma.png', status: 'uptime' },
    ],
  },
  {
    // self-hosted apps with their own login. status = public health check (/api/status);
    // widget = extra stats shown only when signed in (/api/private)
    section: 'Apps',
    items: [
      { name: 'Nextcloud', href: 'https://nextcloud.wliafdew.dev', icon: S + 'nextcloud.png', status: 'nextcloud', widget: 'nextcloud' },
      { name: 'Passbolt', href: 'https://passbolt.wliafdew.dev', icon: S + 'passbolt.png', status: 'passbolt', secret: true },
      { name: 'n8n', href: 'https://n8n.wliafdew.dev/', icon: S + 'n8n.png', status: 'n8n', widget: 'n8n' },
    ],
  },
  {
    section: 'Developer',
    items: [
      { name: 'GitHub', href: 'https://github.com/thewind121212', fa: 'fa-brands fa-github' },
      { name: 'Daily Dev', href: 'https://app.daily.dev/', icon: S + 'dailydev.png' },
      { name: 'Hacker News', href: 'https://news.ycombinator.com/', icon: S + 'hackernews.png' },
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
      { name: 'Steam', href: 'https://steamcommunity.com/profiles/76561198132741545', icon: S + 'steam.png' },
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
  uptime: ['https://uptime.wliafdew.dev/dashboard'],
  nextcloud: ['https://nextcloud.wliafdew.dev/status.php', (j) => j?.installed === true && !j.maintenance],
  passbolt: ['https://passbolt.wliafdew.dev/healthcheck/status.json', (j) => j?.body === 'OK'],
  n8n: ['https://n8n.wliafdew.dev/healthz', (j) => j?.status === 'ok'],
}
