/** Phase 6: day/night, ambient loops, the ticker, and the command palette. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { untilCount } from "./until";

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(line);
  results.push(line);
};

const browser = await chromium.launch();
const errors: string[] = [];

async function openCity(reduced: boolean, clockHour?: number) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await context.addCookies([cookie]);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  if (clockHour !== undefined) {
    // Pin the clock so the phase under test is deterministic.
    await page.addInitScript(`{
      const fixed = new Date();
      fixed.setHours(${clockHour}, 0, 0, 0);
      const Real = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends Real {
        constructor(...args) { super(...(args.length ? args : [fixed.getTime()])); }
        static now() { return fixed.getTime(); }
      };
    }`);
  }

  await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
  await untilCount(page.locator("[data-building]"), (n) => n > 0);
  return { context, page };
}

// --- day/night -----------------------------------------------------------
{
  const { context, page } = await openCity(false, 12);
  const world = page.locator("[data-phase]").first();
  check("midday is the day phase", (await world.getAttribute("data-phase")) === "day",
    (await world.getAttribute("data-phase")) ?? "");
  check("lamps are off at midday", (await world.getAttribute("data-lamps")) === "off");
  await page.screenshot({ path: "scripts/shots/life-day.png" });
  await context.close();
}

{
  const { context, page } = await openCity(false, 23);
  const world = page.locator("[data-phase]").first();
  check("late evening is the night phase", (await world.getAttribute("data-phase")) === "night",
    (await world.getAttribute("data-phase")) ?? "");
  check("lamps are on at night", (await world.getAttribute("data-lamps")) === "on");
  await page.screenshot({ path: "scripts/shots/life-night.png" });
  await context.close();
}

// --- ticker --------------------------------------------------------------
{
  const { context, page } = await openCity(false, 12);
  const ticker = page.locator('section[aria-label="Recent activity"]');
  check("the ticker renders headlines", (await ticker.count()) === 1);
  const text = await ticker.innerText();
  check("headlines read as newspaper copy", text.trim().length > 20, text.slice(0, 60).replace(/\n/g, " "));

  // The bird should exist and be animated.
  const birdOpacity = await page
    .locator("svg polygon[points='0,4 4,0 6,4 8,2 10,4 14,0 16,4 8,6']")
    .first()
    .evaluate((el) => getComputedStyle(el.parentElement!.parentElement!).opacity);
  check("ambient life is present when motion is allowed", birdOpacity !== "0", birdOpacity);
  await context.close();
}

// --- reduced motion ------------------------------------------------------
{
  const { context, page } = await openCity(true, 12);
  const ticker = page.locator('section[aria-label="Recent activity"]');
  check("the ticker still shows activity under reduced motion", (await ticker.count()) === 1);

  const scrolls = await ticker.locator("div.w-max").count();
  check("the ticker does not scroll under reduced motion", scrolls === 0, `${scrolls} scrolling tracks`);

  const list = await ticker.locator("li").count();
  check("it becomes a plain list instead", list > 0, `${list} items`);

  const birdOpacity = await page
    .locator("svg polygon[points='0,4 4,0 6,4 8,2 10,4 14,0 16,4 8,6']")
    .first()
    .evaluate((el) => getComputedStyle(el.parentElement!.parentElement!).opacity);
  check("ambient loops are off under reduced motion", birdOpacity === "0", birdOpacity);
  await context.close();
}

// --- command palette -----------------------------------------------------
{
  const { context, page } = await openCity(false, 12);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.locator('[cmdk-dialog]');
  const opened = await untilCount(dialog, (n) => n === 1);
  check("cmd-K opens the palette", opened === 1, `${opened} dialogs`);

  await page.keyboard.type("roadmap");

  // Hits are debounced and then fetched from Postgres, so wait for the list
  // rather than guessing how long that takes.
  const items = page.locator("[cmdk-item]");
  await items.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  check("searching finds matching artifacts", (await items.count()) > 0, `${await items.count()} hits`);
  await page.screenshot({ path: "scripts/shots/life-palette.png" });

  const labels = await items.allInnerTexts();
  check("results say what kind of thing each hit is", labels.some((l) => /building|document|table row|note|district/i.test(l)),
    labels[0]?.replace(/\n/g, " ") ?? "");

  // The results arrive inside a transition, so the list can commit a frame
  // before cmdk has marked an item active. Enter with nothing selected does
  // nothing at all, which is what used to flake here.
  await page.locator('[cmdk-item][aria-selected="true"]').first()
    .waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  check("a result is selected and ready for Enter",
    (await page.locator('[cmdk-item][aria-selected="true"]').count()) === 1);

  await page.keyboard.press("Enter");
  await page.waitForURL(/\/b\/|\/directory/, { timeout: 15000 }).catch(() => {});
  check("choosing a result navigates to it", /\/b\/|\/directory/.test(page.url()), page.url());

  await context.close();
}

// --- searching for nonsense ----------------------------------------------
{
  const { context, page } = await openCity(false, 12);
  await page.keyboard.press("ControlOrMeta+k");
  await untilCount(page.locator("[cmdk-dialog]"), (n) => n === 1);
  await page.keyboard.type("zzzzz nothing here zzzzz");
  // The search is debounced and then goes to the server, so the empty state
  // is the thing to wait for.
  const empty = await untilCount(page.locator("[cmdk-empty]"), (n) => n === 1);
  check("an empty search says so rather than hanging", empty === 1, `${empty} empty states`);
  await context.close();
}

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
