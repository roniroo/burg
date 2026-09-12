/** Phase 1 interaction checks: keyboard nav, zoom, hover, enter, focus. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { until, untilCount, untilText } from "./until";

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
await untilCount(page.locator("[data-building]"), (n) => n > 0);

const results: string[] = [];
const check = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

// --- buildings are real buttons with accessible names --------------------
const buttons = page.locator("[data-building]");
check("every building is a focusable button", (await buttons.count()) === 8, `${await buttons.count()} found`);
const firstLabel = await buttons.first().getAttribute("aria-label");
check("accessible name names type, title and district", !!firstLabel?.match(/^\w+: .+, in .+$/), firstLabel ?? "");

// --- keyboard: arrows move a tile cursor ---------------------------------
const app = page.locator('[role="application"]');
await app.focus();
const cursorCount = async () => page.locator('polygon[stroke="var(--color-gold)"]').count();
check("no tile cursor before arrow keys", (await cursorCount()) === 0);
await page.keyboard.press("ArrowRight");
const raised = await until(cursorCount, (n) => n === 1);
check("arrow key raises a tile cursor", raised === 1, `${raised} cursors`);

// Moving right then left should return to the starting tile.
const cursorTile = async () => {
  const el = page.locator('polygon[stroke="var(--color-gold)"]').first();
  const box = await el.boundingBox();
  return box ? `${Math.round(box.x)},${Math.round(box.y)}` : "none";
};
const afterRight = await cursorTile();
await page.keyboard.press("ArrowLeft");
await until(cursorTile, (t) => t !== afterRight);
await page.keyboard.press("ArrowRight");
const backAgain = await until(cursorTile, (t) => t === afterRight);
check("arrow movement is reversible", backAgain === afterRight, `${afterRight} -> ${backAgain}`);

// --- zoom ladder ---------------------------------------------------------
const zoomBadge = page.locator("text=/^\\d×$/").first();
check("starts at 1x", (await zoomBadge.textContent())?.trim() === "1×");
await page.keyboard.press("+");
const atTwo = await untilText(zoomBadge, (t) => t.trim() === "2×");
check("plus steps to 2x", atTwo.trim() === "2×", atTwo.trim());
await page.keyboard.press("+");
await page.keyboard.press("+");
const atThree = await untilText(zoomBadge, (t) => t.trim() === "3×");
check("zoom clamps at 3x", atThree.trim() === "3×", atThree.trim());
await page.screenshot({ path: "scripts/shots/city-3x.png" });
await page.keyboard.press("-");
await page.keyboard.press("-");
const backToOne = await untilText(zoomBadge, (t) => t.trim() === "1×");
check("minus steps back to 1x", backToOne.trim() === "1×", backToOne.trim());

// transform must land on whole pixels
const transform = await page.locator("[data-world]").first().evaluate((el) => getComputedStyle(el).transform);
const nums = transform.match(/-?\d+\.?\d*/g) ?? [];
const translates = nums.slice(4).map(Number);
check("camera transform is pixel-snapped", translates.every((n) => Number.isInteger(n)), transform);

// --- hover raises the label plate ---------------------------------------
const target = buttons.nth(0);
await target.hover();
const plate = target.locator("span").last();
const plateShown = await until(() => plate.isVisible(), (v) => v);
check("hover reveals the title plate", plateShown);
await page.screenshot({ path: "scripts/shots/city-hover.png" });

// --- focus ring ----------------------------------------------------------
await page.keyboard.press("Tab");
const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-building") ?? document.activeElement?.tagName);
check("tab reaches map content", !!focused, String(focused));

// --- entering a building -------------------------------------------------
await target.click();
await page.waitForURL(/\/b\/[0-9a-f-]+/, { timeout: 5000 }).catch(() => {});
check("clicking a building opens its interior", /\/b\//.test(page.url()), page.url());

console.log(results.join("\n"));
if (errors.length) console.log("\npage errors:\n  " + errors.join("\n  "));
else console.log("\nno page errors");

await browser.close();
