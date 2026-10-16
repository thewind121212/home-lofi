'use client'

// A crash anywhere in the page (under the root layout): told to the server's log (app/report-error.js), and the page's
// own screen instead of Next's (app/oops.js). Try again re-renders it; Reload starts the page over.
import { useEffect } from 'react'
import { Oops } from './oops'
import { reportError } from './report-error'

export default function Error({ error, retry }) {
  useEffect(() => void reportError(error, 'page'), [error])
  return (
    <Oops
      code="Oops"
      title="Something broke"
      text="This page hit an error. It's been noted, so it can be fixed."
      actions={[
        { label: 'Try again', primary: true, onClick: () => retry() },
        { label: 'Reload', onClick: () => location.reload() },
      ]}
    />
  )
}
