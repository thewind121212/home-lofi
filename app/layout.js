import { Space_Mono, Work_Sans } from 'next/font/google'
import { SETTINGS_KEY, THEMES, customTheme, prePaint } from '../lib/settings'
import { SHAPE_KEY, SK_MAX, TAB_KEY, cleanShape, prePaintShape, shapeAttrs, shapeCss } from '../lib/skeleton'
import './globals.css'

const spaceMono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-space-mono' })
const workSans = Work_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-work-sans' })

export const metadata = {
  title: 'Linh Homelab',
  description: 'A lofi home page.',
  // installable (app/manifest.js); on iPhone the Home Screen app gets an opaque status bar, so nothing slides under
  // the notch (the page doesn't pad for safe areas everywhere)
  appleWebApp: { capable: true, title: 'Home', statusBarStyle: 'black' },
  other: { 'apple-mobile-web-app-capable': 'yes' }, // (Next writes the standard tag; older iOS reads only Apple's)
}
export const viewport = { themeColor: '#1a1a2e' }

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the pre-paint scripts below set style / data-motion / data-sk-* on <html> before React hydrates
    <html lang="en" className={`${spaceMono.variable} ${workSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(${prePaint})(${JSON.stringify(SETTINGS_KEY)},${JSON.stringify(THEMES)},${customTheme})` }} />
        {/* the skeletons take the shapes the cards had last time (lib/skeleton.js), before the first paint too */}
        <script dangerouslySetInnerHTML={{ __html: `(${prePaintShape})(${JSON.stringify(SHAPE_KEY)},${JSON.stringify(TAB_KEY)},${JSON.stringify(SK_MAX)},${cleanShape},${shapeCss},${shapeAttrs})` }} />
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
