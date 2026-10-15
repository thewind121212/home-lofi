// Next calls register() once when the server starts (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// The Node server starts the Habits reminders' minute ticker (lib/habits-reminders.js); nothing for the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startReminders } = await import('./lib/habits-reminders.js')
  startReminders()
  // and the 06:00 morning summary (lib/morning-summary.js; switched off: Reminders' own notice, lib/reminders-nudge.js)
  const { startMorning } = await import('./lib/morning-summary.js')
  startMorning()
}
