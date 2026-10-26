/**
 * Dev helper: screenshot a route as the signed-in test user.
 *   npx tsx scripts/shot.ts /city city.png [--reduced-motion]
 */
import { chromium } from "playwright";

const path = process.argv[2] ?? "/city";
const out = process.argv[3] ?? "shot.png";
const reduced = process.argv.includes("--reduced-motion");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: reduced ? "reduce" : "no-preference",
});

const page = await context.newPage();
const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: `scripts/shots/${out}` });

console.log(`shot: scripts/shots/${out}`);
if (errors.length) console.log("console errors:\n  " + errors.join("\n  "));
else console.log("no console errors");

await browser.close();
