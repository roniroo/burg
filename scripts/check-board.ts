/** Noticeboard: pin, edit, drag, colour, modes, and the promotion ceremony. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local", quiet: true });
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const boardId = process.argv[2]!;
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
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://localhost:3000/b/${boardId}`, { waitUntil: "networkidle" });
const notes = page.locator('textarea[aria-label="Note text"]');
check("seeded notes render", (await notes.count()) === 7, `${await notes.count()} notes`);

// Notes must not overlap at the default width.
const boxes = await notes.evaluateAll((els) =>
  els.map((e) => e.closest("div")!.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
);
let overlapping = 0;
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlapping++;
  }
}
check("seeded notes do not overlap", overlapping === 0, `${overlapping} overlapping pairs`);

// --- edit ----------------------------------------------------------------
const probe = `note probe ${Date.now()}`;
await notes.first().fill(probe);
await page.locator("h1").click();
await page.waitForTimeout(1500);
const { data: edited } = await admin
  .from("board_notes").select("body").eq("building_id", boardId).order("position").limit(1).single();
check("editing a note persists", edited?.body === probe, edited?.body ?? "");

// --- colour --------------------------------------------------------------
await page.locator('button[aria-label="Colour 3"]').first().click();
await page.waitForTimeout(1400);
const { data: coloured } = await admin
  .from("board_notes").select("color").eq("building_id", boardId).order("position").limit(1).single();
check("changing colour persists", coloured?.color === 3, String(coloured?.color));

// --- drag ----------------------------------------------------------------
const firstNote = page.locator('textarea[aria-label="Note text"]').first().locator("xpath=..");
const before = await firstNote.boundingBox();
await page.mouse.move(before!.x + 80, before!.y + 8);
await page.mouse.down();
// Aim at empty cork below the seeded grid, so nothing ends up covered.
await page.mouse.move(before!.x + 520, before!.y + 380, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1600);
const { data: moved } = await admin
  .from("board_notes").select("pin_x, pin_y").eq("building_id", boardId).order("position").limit(1).single();
check("dragging a note persists its position", (moved?.pin_x ?? 0) > 400 && (moved?.pin_y ?? 0) > 300, `pin_x=${moved?.pin_x} pin_y=${moved?.pin_y}`);

// --- modes ---------------------------------------------------------------
await page.getByRole("button", { name: /freeform/i }).click();
await page.waitForTimeout(1800);
const lanes = page.locator("section[aria-label]");
check("switching to columns creates lanes", (await lanes.count()) >= 3, `${await lanes.count()} lanes`);
await page.screenshot({ path: "scripts/shots/board-columns.png" });

const { data: boardRow } = await admin.from("boards").select("mode").eq("building_id", boardId).single();
check("board mode persists", boardRow?.mode === "columns", boardRow?.mode ?? "");

await page.getByRole("button", { name: /columns/i }).click();
await page.waitForTimeout(1500);
check("switching back to freeform", (await page.locator('textarea[aria-label="Note text"]').count()) > 0);

// --- promotion -----------------------------------------------------------
const notesBefore = (await admin.from("board_notes").select("id", { count: "exact", head: true }).eq("building_id", boardId)).count ?? 0;
const buildingsBefore = (await admin.from("buildings").select("id", { count: "exact", head: true })).count ?? 0;

await page.getByRole("button", { name: /^promote$/i }).last().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: /build a library/i }).click();

await page.waitForURL(/\/b\/[0-9a-f-]+/, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);

const notesAfter = (await admin.from("board_notes").select("id", { count: "exact", head: true }).eq("building_id", boardId)).count ?? 0;
const buildingsAfter = (await admin.from("buildings").select("id", { count: "exact", head: true })).count ?? 0;

check("promotion removes the note", notesAfter === notesBefore - 1, `${notesBefore} -> ${notesAfter}`);
check("promotion creates a building", buildingsAfter === buildingsBefore + 1, `${buildingsBefore} -> ${buildingsAfter}`);
check("promotion lands in the new artifact", /\/b\//.test(page.url()), page.url());

const { data: newBuilding } = await admin
  .from("buildings").select("id, title, artifact_type, tile_x, tile_y")
  .order("created_at", { ascending: false }).limit(1).single();
check("the new building is a library", newBuilding?.artifact_type === "doc", newBuilding?.artifact_type ?? "");

const { data: doc } = await admin.from("documents").select("search_text").eq("building_id", newBuilding!.id).maybeSingle();
check("the note's text became the document body", (doc?.search_text ?? "").length > 0, doc?.search_text?.slice(0, 40) ?? "");

const { data: promoLink } = await admin
  .from("building_links").select("id").eq("source_building_id", boardId)
  .eq("target_building_id", newBuilding!.id).eq("link_type", "promoted_from").maybeSingle();
check("a promoted_from link records the origin", !!promoLink);

const { data: route } = await admin
  .from("road_routes").select("stale, link_count")
  .or(`a_building_id.eq.${newBuilding!.id},b_building_id.eq.${newBuilding!.id}`).maybeSingle();
check("the promotion paves a road", !!route && route.stale, JSON.stringify(route));

await page.screenshot({ path: "scripts/shots/board-promoted.png" });

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
