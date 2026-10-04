import { Space_Mono, Work_Sans } from 'next/font/google'
import './globals.css'

const spaceMono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-space-mono' })
const workSans = Work_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-work-sans' })

export const metadata = {
  title: 'wliafdew.dev',
  description: 'A lofi home page.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${spaceMono.variable} ${workSans.variable}`}>
      <head>
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
