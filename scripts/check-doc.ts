/** Library: autosave, slash menu, [[ picker, link -> road, search indexing. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local" });
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const docId = process.argv[2]!;
const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  // Printed as it happens: a later step that throws must not swallow the
  // results of every step before it.
  console.log(line);
  results.push(line);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://localhost:3000/b/${docId}`, { waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror", { timeout: 10000 });
check("seeded content loads", (await page.locator(".ProseMirror").innerText()).includes("Harbor District is the launch"));

// Title should appear once (header), not twice.
const titleCount = (await page.locator("text=Launch Brief").count());
check("title is not duplicated in the body", titleCount === 1, `${titleCount} occurrences`);

// --- autosave -----------------------------------------------------------
const marker = `autosave probe ${Date.now()}`;
await page.locator(".ProseMirror").click();
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type(marker);
const status = page.locator('[role="status"]').first();
await status.filter({ hasText: /Saved|Not saved/ }).waitFor({ timeout: 15000 }).catch(() => {});
const statusText = (await status.innerText()).trim();
check("autosave reports saved", /saved/i.test(statusText) && !/not saved/i.test(statusText), statusText);

const { data: afterType } = await admin.from("documents").select("search_text").eq("building_id", docId).single();
check("typed text reached the database", (afterType?.search_text ?? "").includes(marker));

await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
check("text survives a reload", (await page.locator(".ProseMirror").innerText()).includes(marker));

// --- slash menu ---------------------------------------------------------
await page.locator(".ProseMirror").click();
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("/");
await page.waitForSelector('[role="listbox"]', { timeout: 3000 });
const slashCount = await page.locator('[role="option"]').count();
check("slash menu opens with block types", slashCount > 6, `${slashCount} items`);
await page.keyboard.type("quote");
await page.waitForTimeout(300);
const filtered = await page.locator('[role="option"]').allInnerTexts();
check("slash menu filters on the query", filtered.length === 1 && /Quote/.test(filtered[0] ?? ""), filtered.join(", "));
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
check("slash menu inserts the block", (await page.locator(".ProseMirror blockquote").count()) > 0);
await page.keyboard.press("Escape");

// --- [[ building picker -------------------------------------------------
const { data: recipesRow } = await admin
  .from("buildings")
  .select("id")
  .eq("title", "Recipes")
  .single();

await page.keyboard.type("See also [[");
await page.waitForSelector('[role="listbox"]', { timeout: 3000 });
const pickerItems = await page.locator('[role="option"]').allInnerTexts();
check("[[ opens the building picker", pickerItems.length > 0, pickerItems.slice(0, 3).join(" | "));

await page.keyboard.type("Recipes");
await page.waitForTimeout(400);
const recipeItems = await page.locator('[role="option"]').allInnerTexts();
check("picker filters to the typed building", recipeItems.some((t) => /Recipes/.test(t)), recipeItems.join(" | "));
await page.keyboard.press("Enter");
await page.waitForTimeout(400);

check("a building-link chip is inserted", (await page.locator("[data-building-link]").count()) > 0);
await page.locator('[role="status"]').first().filter({ hasText: /Saved|Not saved/ }).waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(900);

const { data: linksAfter } = await admin
  .from("building_links")
  .select("target_building_id")
  .eq("source_building_id", docId)
  .eq("link_type", "wiki");

const targets = (linksAfter ?? []).map((r) => r.target_building_id);
check(
  "the link became a row in building_links",
  targets.includes(recipesRow!.id),
  `${targets.length} wiki links out of this doc`,
);

// The trigger should have created (or re-staled) a route for that pair.
const { data: routes } = await admin
  .from("road_routes")
  .select("a_building_id, b_building_id, link_count, stale, scope")
  .or(`a_building_id.eq.${docId},b_building_id.eq.${docId}`);
check("a road route exists for the new link", (routes ?? []).length > 0, `${(routes ?? []).length} routes touch this doc`);
check("new route is marked stale for the solver", (routes ?? []).some((r) => r.stale));

await page.screenshot({ path: "scripts/shots/doc-linked.png" });

// --- search -------------------------------------------------------------
const { data: city } = await admin.from("cities").select("id").limit(1).single();
const { data: hits } = await admin.rpc("search_all", { p_city_id: city!.id, p_query: "reviewer queue" });
check("full-text search finds the document", (hits ?? []).some((h) => h.kind === "document"), `${(hits ?? []).length} hits`);

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
