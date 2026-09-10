/**
 * Shared by the browser check suites: wait for a condition instead of sleeping.
 *
 * Not a runnable script -- a module the check-*.ts scripts import.
 *
 * A `waitForTimeout` long enough on an idle machine is not long enough when
 * six suites, a dev server and a production build are competing for the same
 * cores. Every fixed sleep in a suite is a assertion that will eventually fail
 * for a reason that has nothing to do with the code under test. Poll for the
 * thing you are actually waiting for.
 */

/** Poll `read` until `ok` accepts its result. Returns the last value read. */
export async function until<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  { timeoutMs = 15000, intervalMs = 150 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await read();
  }
  return last;
}
