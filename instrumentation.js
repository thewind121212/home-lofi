// Next calls register() once when the server starts (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// The Node server starts the Habits reminders' minute ticker (lib/habits-reminders.js); nothing for the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startReminders } = await import('./lib/habits-reminders.js')
  startReminders()
  // and Reminders' 06:00 notice (lib/reminders-nudge.js)
  const { startNudges } = await import('./lib/reminders-nudge.js')
  startNudges()
}
