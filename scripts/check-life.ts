/** Phase 6: day/night, ambient loops, the ticker, and the command palette. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

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
  await page.waitForTimeout(1200);
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
  await page.waitForTimeout(400);
  const dialog = page.locator('[cmdk-dialog]');
  check("cmd-K opens the palette", (await dialog.count()) === 1);

  await page.keyboard.type("roadmap");
  await page.waitForTimeout(900);
  const items = page.locator("[cmdk-item]");
  check("searching finds matching artifacts", (await items.count()) > 0, `${await items.count()} hits`);
  await page.screenshot({ path: "scripts/shots/life-palette.png" });

  const labels = await items.allInnerTexts();
  check("results say what kind of thing each hit is", labels.some((l) => /building|document|table row|note|district/i.test(l)),
    labels[0]?.replace(/\n/g, " ") ?? "");

  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  check("choosing a result navigates to it", /\/b\/|\/directory/.test(page.url()), page.url());

  await context.close();
}

// --- searching for nonsense ----------------------------------------------
{
  const { context, page } = await openCity(false, 12);
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(300);
  await page.keyboard.type("zzzzz nothing here zzzzz");
  await page.waitForTimeout(900);
  const empty = await page.locator("[cmdk-empty]").count();
  check("an empty search says so rather than hanging", empty === 1);
  await context.close();
}

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
