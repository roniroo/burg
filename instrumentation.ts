/**
 * Server start-up. The work is in lib/db/lifecycle.ts, which only the Node.js
 * runtime imports: Next compiles this file for the Edge runtime too, and the
 * shutdown path there calls `process.exit`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("@/lib/db/lifecycle");
    await start();
  }
}
