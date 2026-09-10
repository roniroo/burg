/** Build mode: ghost, validity, placement, construction, keyboard path. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { smokeCity } from "./smoke-city";

config({ path: ".env.local", quiet: true });
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

// Every query below is scoped to this city: a real city on the same project
// must not be counted into an assertion, let alone written to.
const city = await smokeCity(admin);

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(line);
  results.push(line);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
await page.waitForTimeout(600);

const before = (await admin.from("buildings").select("id", { count: "exact", head: true }).eq("city_id", city.id)).count ?? 0;

// --- entering build mode -------------------------------------------------
await page.getByRole("button", { name: /^build$/i }).click();
await page.waitForTimeout(300);
check("build mode opens its toolbar", (await page.getByRole("radiogroup", { name: /building type/i }).count()) === 1);
check("the world dims while building", (await page.locator('[aria-hidden="true"].pointer-events-none.absolute.inset-0').count()) >= 1);

// --- the ghost tracks the cursor and reports validity --------------------
const viewport = await page.locator('[role="application"]').boundingBox();
// Somewhere over open grass, outside any district.
await page.mouse.move(viewport!.x + 120, viewport!.y + viewport!.height - 80);
await page.waitForTimeout(250);
const hint = await page.locator('[role="status"]').last().innerText();
check("a lot outside a district is refused with a reason", /outside/i.test(hint), hint.trim());

// --- keyboard placement inside a district --------------------------------
await page.getByRole("radio", { name: /noticeboard/i }).click();
await page.fill("#build-title", "Check Board");

// Drive the tile cursor to a known free lot with the keyboard.
const app = page.locator('[role="application"]');
await app.focus();
for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
await page.screenshot({ path: "scripts/shots/build-ghost.png" });

// Place with the pointer on a lot we know is inside Harbor District.
const { data: hood } = await admin
  .from("neighborhoods").select("origin_x, origin_y, width, height").eq("city_id", city.id).eq("slug", "harbor-district").single();
const { data: existing } = await admin.from("buildings").select("tile_x, tile_y, footprint_w, footprint_h").eq("city_id", city.id);

// First free tile in the district, computed the same way the app would.
let target: { x: number; y: number } | null = null;
for (let y = hood!.origin_y; y < hood!.origin_y + hood!.height && !target; y++) {
  for (let x = hood!.origin_x; x < hood!.origin_x + hood!.width && !target; x++) {
    const clash = (existing ?? []).some(
      (b) => x >= b.tile_x && x < b.tile_x + b.footprint_w && y >= b.tile_y && y < b.tile_y + b.footprint_h,
    );
    if (!clash) target = { x, y };
  }
}
check("found a free lot to aim at", !!target, JSON.stringify(target));

// Convert the tile to a screen point using the page's own camera.
const point = await page.evaluate(
  ({ tx, ty }: { tx: number; ty: number }) => {
    const world = document.querySelector('[data-world]') as HTMLElement;
    const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    const sx = (tx - ty) * 32;
    const sy = (tx + ty) * 16 + 16;
    const rect = (world.parentElement as HTMLElement).getBoundingClientRect();
    return { x: rect.left + sx * m.a + m.e, y: rect.top + sy * m.d + m.f };
  },
  { tx: target!.x, ty: target!.y },
);

await page.mouse.move(point.x, point.y);
await page.waitForTimeout(250);
const hint2 = await page.locator('[role="status"]').last().innerText();
check("a free lot inside a district is accepted", !/outside|already|water/i.test(hint2), hint2.trim());

await page.mouse.down();
await page.mouse.up();
await page.waitForURL(/\/b\/[0-9a-f-]+/, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

const after = (await admin.from("buildings").select("id", { count: "exact", head: true }).eq("city_id", city.id)).count ?? 0;
check("placing creates a building", after === before + 1, `${before} -> ${after}`);
check("placement opens the new interior", /\/b\//.test(page.url()), page.url());

const { data: made } = await admin
  .from("buildings").select("id, title, artifact_type, tile_x, tile_y").eq("city_id", city.id)
  .order("created_at", { ascending: false }).limit(1).single();
check("the building has the chosen type", made?.artifact_type === "board", made?.artifact_type ?? "");
check("the building has the typed name", made?.title === "Check Board", made?.title ?? "");
check("the building sits on the aimed lot", made?.tile_x === target!.x && made?.tile_y === target!.y,
  `${made?.tile_x},${made?.tile_y} vs ${target!.x},${target!.y}`);

const { data: payload } = await admin.from("boards").select("building_id").eq("building_id", made!.id).maybeSingle();
check("its artifact payload was created", !!payload);

await page.screenshot({ path: "scripts/shots/build-done.png" });

// --- the database refuses a duplicate lot --------------------------------
const dup = await admin.from("buildings").insert({
  city_id: city.id,
  neighborhood_id: (await admin.from("neighborhoods").select("id").eq("city_id", city.id).eq("slug", "harbor-district").single()).data!.id,
  title: "Should fail",
  artifact_type: "doc",
  sprite_key: "library",
  tile_x: made!.tile_x,
  tile_y: made!.tile_y,
});
check("the database refuses a second building on that lot", !!dup.error, dup.error?.code ?? "no error");


// --- district creation ---------------------------------------------------
await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const hoodsBefore = (await admin.from("neighborhoods").select("id", { count: "exact", head: true }).eq("city_id", city.id)).count ?? 0;

// Empty ground south-east of the seeded districts.
const TARGET = { tx: 24, ty: 22 };

const screenFor = (t: { tx: number; ty: number }) =>
  page.evaluate(
    ({ tx, ty }: { tx: number; ty: number }) => {
      const world = document.querySelector('[data-world]') as HTMLElement;
      const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
      const rect = (world.parentElement as HTMLElement).getBoundingClientRect();
      return {
        x: rect.left + (tx - ty) * 32 * m.a + m.e,
        y: rect.top + ((tx + ty) * 16 + 16) * m.d + m.f,
        centreX: rect.left + rect.width / 2,
        centreY: rect.top + rect.height / 2,
      };
    },
    t,
  );

// Pan the target into the middle of the view first -- exactly what a person
// would do -- so the click cannot land off-screen or on the build palette.
const initial = await screenFor(TARGET);
await page.mouse.move(initial.centreX, initial.centreY);
await page.mouse.down();
await page.mouse.move(
  initial.centreX + (initial.centreX - initial.x),
  initial.centreY + (initial.centreY - initial.y),
  { steps: 10 },
);
await page.mouse.up();
await page.waitForTimeout(400);

await page.getByRole("button", { name: /^build$/i }).click();
await page.getByRole("radio", { name: /^district$/i }).click();
await page.fill("#district-name", "Test Quarter");
await page.fill("#district-w", "5");

const districtPoint = await screenFor(TARGET);
await page.mouse.move(districtPoint.x, districtPoint.y);
await page.waitForTimeout(250);
await page.screenshot({ path: "scripts/shots/build-district.png" });
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(2500);

const hoodsAfter = (await admin.from("neighborhoods").select("id", { count: "exact", head: true }).eq("city_id", city.id)).count ?? 0;
check("founding a district creates it", hoodsAfter === hoodsBefore + 1, `${hoodsBefore} -> ${hoodsAfter}`);

const { data: quarter } = await admin
  .from("neighborhoods").select("id, slug, origin_x, origin_y, width, height, biome").eq("city_id", city.id).eq("name", "Test Quarter").maybeSingle();
check("the district has the chosen size", quarter?.width === 5, `${quarter?.width}x${quarter?.height}`);

const { count: tinted } = await admin
  .from("tiles").select("x", { count: "exact", head: true }).eq("neighborhood_id", quarter?.id ?? "");
check("its ground is tinted", (tinted ?? 0) === (quarter?.width ?? 0) * (quarter?.height ?? 0), `${tinted} tiles`);

// --- region move ---------------------------------------------------------
await page.goto(`http://localhost:3000/n/${quarter!.slug}`, { waitUntil: "networkidle" });
await page.fill("#region-originX", String(quarter!.origin_x + 2));
await page.getByRole("button", { name: /apply/i }).click();
await page.waitForTimeout(2000);

const { data: movedHood } = await admin
  .from("neighborhoods").select("origin_x").eq("id", quarter!.id).single();
check("the region form moves a district", movedHood?.origin_x === quarter!.origin_x + 2,
  `${quarter!.origin_x} -> ${movedHood?.origin_x}`);

// Overlapping another district must be refused.
await page.fill("#region-originX", "4");
await page.fill("#region-originY", "4");
await page.getByRole("button", { name: /apply/i }).click();
await page.waitForTimeout(1800);
const overlapMsg = await page.locator('form [role="status"]').innerText();
check("an overlapping move is refused", /overlap/i.test(overlapMsg), overlapMsg.trim());

await admin.from("neighborhoods").delete().eq("id", quarter!.id);

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
