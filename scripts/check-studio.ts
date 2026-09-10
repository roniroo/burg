/** Phase 7: the Studio. Drawing, moving, snapping, deleting, persistence. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { smokeCity } from "./smoke-city";
import { spriteFootprint } from "../lib/sprites";

config({ path: ".env.local", quiet: true });
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(line);
  results.push(line);
};

// The seed has no Studio, so make one the way build mode would -- in the
// smoke-test city, never in whichever city happens to sort first.
const city = await smokeCity(admin);
const { data: hood } = await admin.from("neighborhoods").select("id, origin_x, origin_y, width, height")
  .eq("city_id", city.id).eq("slug", "old-town").single();
const { data: taken } = await admin.from("buildings")
  .select("tile_x, tile_y, footprint_w, footprint_h").eq("city_id", city.id);

// Build mode takes the footprint from the sprite recipe, so the lot search
// has to look for room for the whole thing, not for one free tile.
const shape = spriteFootprint("studio", 1);

let lot: { x: number; y: number } | null = null;
for (let y = hood!.origin_y; y + shape.h <= hood!.origin_y + hood!.height && !lot; y++) {
  for (let x = hood!.origin_x; x + shape.w <= hood!.origin_x + hood!.width && !lot; x++) {
    const clash = (taken ?? []).some(
      (b) =>
        x < b.tile_x + b.footprint_w &&
        b.tile_x < x + shape.w &&
        y < b.tile_y + b.footprint_h &&
        b.tile_y < y + shape.h,
    );
    if (!clash) lot = { x, y };
  }
}
check("found a lot with room for a studio", !!lot, JSON.stringify(lot));

await admin.from("buildings").delete().eq("city_id", city.id).eq("title", "Sketchbook");
const studioId = crypto.randomUUID();
const made = await admin.from("buildings").insert({
  id: studioId,
  city_id: city.id,
  neighborhood_id: hood!.id,
  title: "Sketchbook",
  artifact_type: "canvas",
  sprite_key: "studio",
  sprite_variant: 1,
  tile_x: lot!.x,
  tile_y: lot!.y,
  footprint_w: shape.w,
  footprint_h: shape.h,
  floors: shape.floors,
});
check("a canvas building can be created", !made.error, made.error?.message ?? "");
await admin.from("canvases").insert({ building_id: studioId, city_id: city.id });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`http://localhost:3000/b/${studioId}`, { waitUntil: "networkidle" });
const board = page.locator("[data-studio]");
check("the studio interior opens", (await board.count()) === 1);
check("it offers exactly the five drawing tools plus select",
  (await page.getByRole("radio").count()) === 6, `${await page.getByRole("radio").count()} tools`);

const box = await board.boundingBox();
const at = (dx: number, dy: number) => ({ x: box!.x + dx, y: box!.y + dy });

// --- draw a rectangle ----------------------------------------------------
await page.getByRole("radio", { name: /rectangle/i }).click();
await page.mouse.move(at(120, 120).x, at(120, 120).y);
await page.mouse.down();
await page.mouse.move(at(280, 240).x, at(280, 240).y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(1600);

let { data: canvas } = await admin.from("canvases").select("scene").eq("building_id", studioId).single();
let scene = canvas!.scene as { nodes: Array<{ kind: string; x: number; y: number; w: number; h: number; id: string }> };
check("drawing a rectangle stores a node", scene.nodes.length === 1, `${scene.nodes.length} nodes`);
check("the node is a rectangle", scene.nodes[0]?.kind === "rect", scene.nodes[0]?.kind ?? "");
check("its origin sits on the 8px grid", scene.nodes[0]!.x % 8 === 0 && scene.nodes[0]!.y % 8 === 0,
  `${scene.nodes[0]!.x},${scene.nodes[0]!.y}`);
check("its size sits on the grid too", scene.nodes[0]!.w % 8 === 0 && scene.nodes[0]!.h % 8 === 0,
  `${scene.nodes[0]!.w}x${scene.nodes[0]!.h}`);

// --- a sticky with text --------------------------------------------------
await page.getByRole("radio", { name: /sticky/i }).click();
await page.mouse.move(at(500, 120).x, at(500, 120).y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(600);
await page.locator('textarea[aria-label="Sticky text"]').first().fill("shape of an idea");
await page.waitForTimeout(1600);

({ data: canvas } = await admin.from("canvases").select("scene").eq("building_id", studioId).single());
scene = canvas!.scene as typeof scene;
const sticky = (scene.nodes as Array<{ kind: string; text?: string }>).find((n) => n.kind === "sticky");
check("a sticky stores its text", sticky?.text === "shape of an idea", sticky?.text ?? "");

// --- freehand ------------------------------------------------------------
await page.getByRole("radio", { name: /pen/i }).click();
await page.mouse.move(at(150, 340).x, at(150, 340).y);
await page.mouse.down();
for (let i = 0; i < 8; i++) await page.mouse.move(at(150 + i * 20, 340 + (i % 3) * 12).x, at(150 + i * 20, 340 + (i % 3) * 12).y);
await page.mouse.up();
await page.waitForTimeout(1600);

({ data: canvas } = await admin.from("canvases").select("scene").eq("building_id", studioId).single());
scene = canvas!.scene as typeof scene;
const pen = (scene.nodes as Array<{ kind: string; points?: unknown[] }>).find((n) => n.kind === "pen");
check("a pen stroke stores its points", (pen?.points?.length ?? 0) > 3, `${pen?.points?.length ?? 0} points`);

await page.screenshot({ path: "scripts/shots/studio.png" });

// --- move and delete -----------------------------------------------------
await page.getByRole("radio", { name: /select/i }).click();
const rectBefore = (scene.nodes as Array<{ kind: string; x: number; id: string }>).find((n) => n.kind === "rect")!;
await page.mouse.move(at(180, 160).x, at(180, 160).y);
await page.mouse.down();
await page.mouse.move(at(260, 200).x, at(260, 200).y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(1600);

({ data: canvas } = await admin.from("canvases").select("scene").eq("building_id", studioId).single());
scene = canvas!.scene as typeof scene;
const rectAfter = (scene.nodes as Array<{ kind: string; x: number; id: string }>).find((n) => n.id === rectBefore.id)!;
check("selecting and dragging moves a node", rectAfter.x !== rectBefore.x, `${rectBefore.x} -> ${rectAfter.x}`);
check("it stays on the grid after moving", rectAfter.x % 8 === 0);

const countBefore = scene.nodes.length;
await page.keyboard.press("Delete");
await page.waitForTimeout(1600);
({ data: canvas } = await admin.from("canvases").select("scene").eq("building_id", studioId).single());
scene = canvas!.scene as typeof scene;
check("Delete removes the selected node", scene.nodes.length === countBefore - 1,
  `${countBefore} -> ${scene.nodes.length}`);

// --- reload --------------------------------------------------------------
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const drawn = await page.locator("[data-studio] .absolute.border-2").count();
check("the scene survives a reload", drawn >= 1, `${drawn} shapes`);

// --- a malformed scene must still open -----------------------------------
await admin.from("canvases").update({
  scene: { nodes: [{ id: "ok", kind: "rect", x: 0, y: 0, w: 40, h: 40 }, { kind: "broken" }, 7], viewport: { zoom: 99 } },
}).eq("building_id", studioId);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
check("a malformed node does not stop the board opening", (await page.locator("[data-studio]").count()) === 1);
check("the bad node is dropped, the good one kept",
  (await page.locator("[data-studio] .absolute.border-2").count()) === 1,
  `${await page.locator("[data-studio] .absolute.border-2").count()} shapes`);

await admin.from("buildings").delete().eq("id", studioId);

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
