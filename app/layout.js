import { Space_Mono, Work_Sans } from 'next/font/google'
import { SETTINGS_KEY, THEMES, customTheme, prePaint } from '../lib/settings'
import './globals.css'

const spaceMono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-space-mono' })
const workSans = Work_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-work-sans' })

export const metadata = {
  title: 'wliafdew.dev',
  description: 'A lofi home page.',
  // installable (app/manifest.js); on iPhone the Home Screen app gets an opaque status bar, so nothing slides under
  // the notch (the page doesn't pad for safe areas everywhere)
  appleWebApp: { capable: true, title: 'Home', statusBarStyle: 'black' },
  other: { 'apple-mobile-web-app-capable': 'yes' }, // (Next writes the standard tag; older iOS reads only Apple's)
}
export const viewport = { themeColor: '#1a1a2e' }

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the pre-paint script below sets style / data-motion on <html> before React hydrates
    <html lang="en" className={`${spaceMono.variable} ${workSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(${prePaint})(${JSON.stringify(SETTINGS_KEY)},${JSON.stringify(THEMES)},${customTheme})` }} />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
          integrity="sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </head>
      <body className="font-sans antialiased min-h-screen selection:bg-lofi-primary selection:text-lofi-base">
        {children}
      </body>
    </html>
  )
}
