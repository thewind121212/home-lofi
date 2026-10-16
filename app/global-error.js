'use client'

// A crash in the root layout itself (rare: app/error.js catches the page's): its own document, the same screen
import { useEffect } from 'react'
import { Oops } from './oops'
import { reportError } from './report-error'

export default function GlobalError({ error, retry }) {
  useEffect(() => void reportError(error, 'global'), [error])
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#14142a' }}>
        <title>Home · something broke</title>
        <Oops
          code="Oops"
          title="Something broke"
          text="The page couldn't start. It's been noted, so it can be fixed."
          actions={[
            { label: 'Reload', primary: true, onClick: () => location.reload() },
            { label: 'Try again', onClick: () => retry() },
          ]}
        />
      </body>
    </html>
  )
}
