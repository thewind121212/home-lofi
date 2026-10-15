// Next calls register() once when the server starts (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// The Node server starts the Habits reminders' minute ticker (lib/habits-reminders.js); nothing for the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startReminders } = await import('./lib/habits-reminders.js')
  startReminders()
  // and the daily summaries at 06:00, 13:00, 18:00 (lib/morning-summary.js; switched off: Reminders' own 06:00 notice,
  // lib/reminders-nudge.js)
  const { startMorning } = await import('./lib/morning-summary.js')
  startMorning()
  // and the focus sessions' phase changes, on the second (lib/focus-ticker.js): the push when a focus phase ends
  const { startFocus } = await import('./lib/focus-ticker.js')
  startFocus()
}
