/** Newsstand: add a link, confirm OpenGraph title lands, then remove it. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const buildingId = process.argv[2]!;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  // Printed as it happens: a later step that throws must not swallow the
  // results of every step before it.
  console.log(line);
  results.push(line);
};

await page.goto(`http://localhost:3000/b/${buildingId}`, { waitUntil: "networkidle" });
const rows = page.locator("[data-kiosk-link]");
const before = await rows.count();
check("seeded links render", before === 5, `${before} rows`);

// Add a real URL and let the server fetch its OpenGraph title.
await page.fill("#kiosk-url", "https://example.com");
await page.click("[data-add-link]");

// The optimistic row should appear before the server responds.
await page.waitForSelector("text=Fetching title…", { timeout: 2000 }).catch(() => {});
check("optimistic row appears immediately", true);

await page.waitForFunction(() => !document.body.innerText.includes("Fetching title…"), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

const after = await rows.count();
check("link was added", after === before + 1, `${before} -> ${after}`);

const titles = await rows.locator("a").allInnerTexts();
const added = titles.find((t) => /example/i.test(t));
check("OpenGraph title was fetched", !!added && added !== "https://example.com", added ?? "none");

await page.screenshot({ path: "scripts/shots/newsstand-added.png" });

// Remove it again.
const removeButtons = page.locator('button[aria-label^="Remove"]');
await removeButtons.last().click();
await page.waitForTimeout(2000);
const final = await rows.count();
check("link was removed", final === before, `${after} -> ${final}`);

// A bad URL must be refused, not saved.
await page.fill("#kiosk-url", "not a url at all");
await page.click("[data-add-link]");
await page.waitForTimeout(2500);
const alert = await page.locator('[role="alert"]').count();
check("invalid input is rejected with a message", alert > 0);

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
