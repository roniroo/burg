import { closeDatabase, database } from "@/lib/db/server";

/**
 * Open the database when the server starts, and close it when the desktop app
 * says so. Called once, from instrumentation.ts.
 *
 * Opening here rather than on the first request means a data directory that
 * will not open fails the launch, where the desktop app can say so, instead of
 * failing whichever page happened to be asked for first.
 *
 * The desktop app runs this server as an Electron utility process and asks it
 * to stop with a "shutdown" message rather than a signal, because Next's own
 * SIGTERM handler exits immediately and the database deserves a clean close.
 */

type ParentPort = { on(event: "message", listener: (message: { data: unknown }) => void): void };

export async function start(): Promise<void> {
  await database();

  const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
  parentPort?.on("message", async ({ data }) => {
    if (data !== "shutdown") return;
    try {
      await closeDatabase();
      console.log("[burg] database closed cleanly");
    } finally {
      process.exit(0);
    }
  });
}
