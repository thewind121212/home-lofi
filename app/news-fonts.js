// News' newspaper type (app/news.js), with Vietnamese: Libre Bodoni for the masthead and the headlines, Newsreader for
// the stories, Libre Franklin for the small capitals (kickers, bylines). Not preloaded: the files come when the paper
// first opens, not with every page. (next/font reads these options as written: literals only, no spread)
import { Libre_Bodoni, Libre_Franklin, Newsreader } from 'next/font/google'

const display = Libre_Bodoni({ subsets: ['latin', 'vietnamese'], display: 'swap', preload: false, variable: '--font-nw-display' })
const text = Newsreader({ subsets: ['latin', 'vietnamese'], display: 'swap', preload: false, variable: '--font-nw-text', axes: ['opsz'] })
const label = Libre_Franklin({ subsets: ['latin', 'vietnamese'], display: 'swap', preload: false, variable: '--font-nw-label' })

export const paperFonts = `${display.variable} ${text.variable} ${label.variable}`
