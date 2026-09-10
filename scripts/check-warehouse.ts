/** Warehouse: grid keyboard nav, editing, views, row panel, copy/paste. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { until } from "./until";

config({ path: ".env.local", quiet: true });
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const buildingId = process.argv[2]!;
const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  // Printed as it happens: a later step that throws must not swallow the
  // results of every step before it.
  console.log(line);
  results.push(line);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://localhost:3000/b/${buildingId}`, { waitUntil: "networkidle" });
await page.waitForSelector('[role="grid"]');

const rowEls = page.locator('[role="row"][aria-rowindex]');
check("grid renders the seeded rows", (await rowEls.count()) === 12, `${await rowEls.count()} rows`);

// --- selection and keyboard movement ------------------------------------
const firstCell = page.locator('[role="gridcell"]').first();
await firstCell.click();
check("clicking selects a cell", (await page.locator('[role="gridcell"][aria-selected="true"]').count()) === 1);

const selectedText = async () => (await page.locator('[role="gridcell"][aria-selected="true"]').innerText()).trim();
const firstText = await selectedText();
await page.keyboard.press("ArrowRight");
const afterRight = await selectedText();
check("arrow right moves the selection", afterRight !== firstText, `${firstText} -> ${afterRight}`);
await page.keyboard.press("ArrowLeft");
check("arrow left moves back", (await selectedText()) === firstText);

await page.keyboard.press("ArrowDown");
const afterDown = await selectedText();
check("arrow down moves a row", afterDown !== firstText, `${firstText} -> ${afterDown}`);
await page.keyboard.press("ArrowUp");

// --- editing -------------------------------------------------------------
const probe = `edited ${Date.now()}`;
await page.keyboard.press("Enter");
await page.waitForSelector('[role="gridcell"] input', { timeout: 3000 });
check("Enter opens the cell editor", true);

await page.keyboard.type(probe);
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);

const { data: edited } = await admin
  .from("table_rows")
  .select("data, search_text")
  .eq("building_id", buildingId)
  .order("position")
  .limit(1)
  .single();
const values = Object.values((edited?.data ?? {}) as Record<string, unknown>);
check("edit persists to the database", values.includes(probe), JSON.stringify(values.slice(0, 2)));
check("primary field mirrors into search_text", edited?.search_text === probe, edited?.search_text ?? "");

// Escape must abandon an edit.
await page.locator('[role="gridcell"]').first().click();
await page.keyboard.press("Enter");
await page.waitForSelector('[role="gridcell"] input');
await page.keyboard.type("DISCARD ME");
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);
const { data: afterEscape } = await admin
  .from("table_rows").select("search_text").eq("building_id", buildingId).order("position").limit(1).single();
check("Escape abandons the edit", afterEscape?.search_text === probe, afterEscape?.search_text ?? "");

// --- copy / paste --------------------------------------------------------
await page.locator('[role="gridcell"]').first().click();
await page.keyboard.press("ControlOrMeta+c");
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check("copy puts the cell on the clipboard", clip.trim() === probe, clip.trim());

// --- views ---------------------------------------------------------------
await page.getByRole("tab", { name: /by status/i }).click();
await page.waitForTimeout(500);
const lanes = page.locator("section[aria-label]");
check("board view renders a lane per choice", (await lanes.count()) >= 3, `${await lanes.count()} lanes`);
const laneLabels = await lanes.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("lanes are labelled with their counts", laneLabels.every((l) => /\d+ items/.test(l ?? "")), laneLabels.join(" | "));
await page.screenshot({ path: "scripts/shots/warehouse-board.png" });

await page.getByRole("tab", { name: /all items/i }).click();
await page.waitForTimeout(400);
check("switching back restores the grid", (await page.locator('[role="grid"]').count()) === 1);

// --- row panel -----------------------------------------------------------
await page.locator('button[aria-label^="Open row"]').first().click();
await page.waitForSelector('[role="dialog"]');
check("row panel opens as a dialog", (await page.locator('[role="dialog"]').count()) === 1);
await page.screenshot({ path: "scripts/shots/warehouse-row.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape closes the row panel", (await page.locator('[role="dialog"]').count()) === 0);

// --- add a row -----------------------------------------------------------
const beforeDom = await rowEls.count();
const { count: beforeDb } = await admin
  .from("table_rows").select("id", { count: "exact", head: true }).eq("building_id", buildingId);
await page.getByRole("button", { name: /add row/i }).click();

// Wait for the insert rather than sleeping through it: the action is a server
// round trip, and how long that takes depends on what else is running.
const afterDb = await until(
  async () =>
    (await admin.from("table_rows").select("id", { count: "exact", head: true }).eq("building_id", buildingId)).count ?? 0,
  (n) => n === (beforeDb ?? 0) + 1,
);
check("add row inserts a row", afterDb === (beforeDb ?? 0) + 1, `db ${beforeDb} -> ${afterDb}`);

const afterDom = await until(() => rowEls.count(), (n) => n === beforeDom + 1);
check("the new row appears without a reload", afterDom === beforeDom + 1, `dom ${beforeDom} -> ${afterDom}`);

// --- gallery -------------------------------------------------------------
// The seed carries only Table and Board (as the brief specifies), so the
// gallery is exercised against a temporary view.
const { data: galleryView } = await admin
  .from("table_views")
  .insert({
    city_id: (await admin.from("data_tables").select("city_id").eq("building_id", buildingId).single()).data!.city_id,
    building_id: buildingId,
    name: "Gallery check",
    view_type: "gallery",
    position: 99,
  })
  .select("id")
  .single();

await page.reload({ waitUntil: "networkidle" });
await page.getByRole("tab", { name: /gallery check/i }).click();
await page.waitForTimeout(500);
const cards = page.locator("ul > li");
check("gallery view renders a card per row", (await cards.count()) >= 12, `${await cards.count()} cards`);
await page.screenshot({ path: "scripts/shots/warehouse-gallery.png" });
if (galleryView) await admin.from("table_views").delete().eq("id", galleryView.id);

// clean up the added row so re-runs stay stable
const { data: allRows } = await admin
  .from("table_rows").select("id, search_text").eq("building_id", buildingId).order("position");
const blank = (allRows ?? []).filter((r) => !r.search_text);
for (const r of blank) await admin.from("table_rows").delete().eq("id", r.id);

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
