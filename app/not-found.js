import { Oops } from './oops'

// Any address that isn't a page here: the 404, over the same drifting sky as the error screen
export const metadata = { title: 'Home · not found' }

export default function NotFound() {
  return <Oops code="404" title="Nothing here" text="This page drifted off somewhere. The way home is right here." actions={[{ label: 'Go home', primary: true, href: '/' }]} />
}
