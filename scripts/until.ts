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

import type { Locator } from "playwright";

type Options = { timeoutMs?: number; intervalMs?: number };

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

/**
 * The DOM-shaped wrappers.
 *
 * These return the last value rather than throwing, which is the whole point:
 * a suite asserts on what came back, so a genuine failure still prints a FAIL
 * line with the value that was actually there. Playwright's own retrying
 * assertions throw instead, which ends the script and prints nothing.
 */

/** Poll a locator's count. */
export async function untilCount(
  locator: Locator,
  ok: (count: number) => boolean,
  options?: Options,
): Promise<number> {
  return until(() => locator.count(), ok, options);
}

/**
 * Poll a locator's text.
 *
 * Reads "" while the element does not exist yet, so waiting for text to appear
 * and waiting for an element to appear are the same call.
 */
export async function untilText(
  locator: Locator,
  ok: (text: string) => boolean,
  options?: Options,
): Promise<string> {
  return until(
    async () => ((await locator.count()) > 0 ? locator.innerText().catch(() => "") : ""),
    ok,
    options,
  );
}

/** Poll an attribute's value, "" when the element or attribute is absent. */
export async function untilAttribute(
  locator: Locator,
  name: string,
  ok: (value: string) => boolean,
  options?: Options,
): Promise<string> {
  return until(
    async () =>
      (await locator.count()) > 0 ? ((await locator.getAttribute(name).catch(() => "")) ?? "") : "",
    ok,
    options,
  );
}
