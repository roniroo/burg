/** Demolition: map mode, interior control, district dissolve, start fresh. */
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

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(line);
  results.push(line);
};

// Everything is scoped to the smoke-test user's city; another city on the same
// project (a real one) must not be counted, let alone cleared.
const email = process.argv[2] ?? "seedtest@burg.local";
const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
const owner = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!owner) {
  console.error(`no user ${email}`);
  process.exit(1);
}
const { data: city } = await admin.from("cities").select("id, name").eq("owner_id", owner.id).limit(1).single();

const countBuildings = async () =>
  (await admin.from("buildings").select("id", { count: "exact", head: true }).eq("city_id", city!.id)).count ?? 0;

/** Tile -> viewport point, read off the map's own camera transform. */
const screenFor = (tx: number, ty: number) =>
  page.evaluate(
    ({ tx, ty }: { tx: number; ty: number }) => {
      const world = document.querySelector("[data-world]") as HTMLElement;
      const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
      const rect = (world.parentElement as HTMLElement).getBoundingClientRect();
      return { x: rect.left + (tx - ty) * 32 * m.a + m.e, y: rect.top + ((tx + ty) * 16 + 16) * m.d + m.f };
    },
    { tx, ty },
  );

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

// --- demolishing from the map -------------------------------------------
await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const before = await countBuildings();
check("the map offers a demolish mode", (await page.getByRole("button", { name: /^demolish$/i }).count()) === 1);

await page.getByRole("button", { name: /^demolish$/i }).click();
await page.waitForTimeout(300);
const modeHint = await page.locator('[role="status"]').last().innerText();
check("demolish mode explains itself", /click a building/i.test(modeHint), modeHint.trim());
check("the world dims while demolishing",
  (await page.locator('[aria-hidden="true"].pointer-events-none.absolute.inset-0').count()) >= 1);

// The first building whose sprite is wholly on screen -- no panning needed,
// the camera frames the districts on load.
const { data: candidates } = await admin
  .from("buildings").select("id, title, artifact_type").eq("city_id", city!.id).order("created_at");
let victim: { id: string; title: string; artifact_type: string } | null = null;
let box: { x: number; y: number; width: number; height: number } | null = null;
for (const b of candidates ?? []) {
  const found = await page.locator(`[data-building="${b.id}"]`).boundingBox();
  if (found && found.x > 0 && found.y > 0 && found.x + found.width < 1400 && found.y + found.height < 900) {
    victim = b;
    box = found;
    break;
  }
}
check("found a building on screen to condemn", !!victim, victim?.title ?? "");

await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height - 6);
await page.waitForTimeout(400);
await page.screenshot({ path: "scripts/shots/demolish-condemned.png" });

const barText = await page.locator("[data-demolish-bar]").innerText();
check("the bar names the condemned building", barText.includes(victim!.title), barText.replace(/\n/g, " ").trim());
check("condemning does not open the interior", !/\/b\//.test(page.url()), page.url());

await page.getByRole("button", { name: /demolish it/i }).click();
await page.waitForTimeout(2000);

const after = await countBuildings();
check("demolishing removes the building", after === before - 1, `${before} -> ${after}`);

const { data: gone } = await admin.from("buildings").select("id").eq("id", victim!.id).maybeSingle();
check("the row is really gone", !gone);

// The artifact payload hangs off the building by cascade.
const payloadTable = { doc: "documents", table: "data_tables", board: "boards", canvas: "canvases" }[
  victim!.artifact_type
] as "documents" | "data_tables" | "boards" | "canvases" | undefined;
if (payloadTable) {
  const { data: payload } = await admin.from(payloadTable).select("building_id").eq("building_id", victim!.id).maybeSingle();
  check("its contents went with it", !payload, payloadTable);
}

// Routes are keyed on both endpoints, and cascade from either.
const { count: orphanRoutes } = await admin
  .from("road_routes").select("id", { count: "exact", head: true })
  .or(`a_building_id.eq.${victim!.id},b_building_id.eq.${victim!.id}`);
check("its roads went with it", (orphanRoutes ?? 0) === 0, `${orphanRoutes} left`);

const { count: staleHeadlines } = await admin
  .from("activity").select("id", { count: "exact", head: true }).eq("subject_id", victim!.id);
check("the ticker stops announcing it", (staleHeadlines ?? 0) === 0, `${staleHeadlines} left`);

check("demolish mode stays open for the next one",
  (await page.getByRole("button", { name: /^done$/i }).count()) === 1);

// Escape steps back out: first the condemned building, then the mode.
let second: { x: number; y: number; width: number; height: number } | null = null;
for (const b of candidates ?? []) {
  if (b.id === victim!.id) continue;
  const found = await page.locator(`[data-building="${b.id}"]`).boundingBox();
  if (found && found.x > 0 && found.y > 0 && found.x + found.width < 1400 && found.y + found.height < 900) {
    second = found;
    break;
  }
}
if (second) {
  await page.mouse.click(second.x + second.width / 2, second.y + second.height - 6);
  await page.waitForTimeout(300);
  check("a second building can be condemned",
    (await page.getByRole("button", { name: /demolish it/i }).count()) === 1);

  await page.locator('[role="application"]').focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("escape lets the condemned building go",
    (await page.getByRole("button", { name: /demolish it/i }).count()) === 0 &&
      (await page.locator("[data-demolish-bar]").count()) === 1);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("escape again leaves demolish mode",
    (await page.locator("[data-demolish-bar]").count()) === 0 &&
      (await page.getByRole("button", { name: /^build$/i }).count()) === 1);
}

// --- dissolving a district from the map ---------------------------------
// Clicking a district's open ground condemns the district; clicking a building
// on it condemns the building. What you clicked says which you meant.
await page.getByRole("button", { name: /^demolish$/i }).click();
await page.waitForTimeout(300);

const { data: mapHood } = await admin
  .from("neighborhoods").select("id, name, origin_x, origin_y, width, height")
  .eq("city_id", city!.id).order("position").limit(1).single();
const { data: onHood } = await admin
  .from("buildings").select("tile_x, tile_y, footprint_w, footprint_h").eq("neighborhood_id", mapHood!.id);

// A tile inside the district with nothing on it, that is also on screen.
let openGround: { x: number; y: number } | null = null;
for (let y = mapHood!.origin_y; y < mapHood!.origin_y + mapHood!.height && !openGround; y++) {
  for (let x = mapHood!.origin_x; x < mapHood!.origin_x + mapHood!.width && !openGround; x++) {
    const taken = (onHood ?? []).some(
      (b) => x >= b.tile_x && x < b.tile_x + b.footprint_w && y >= b.tile_y && y < b.tile_y + b.footprint_h,
    );
    if (taken) continue;
    const at = await screenFor(x, y);
    if (at.x > 20 && at.y > 100 && at.x < 1380 && at.y < 820) openGround = { x, y };
  }
}
check("found open ground inside a district", !!openGround, JSON.stringify(openGround));

const groundPoint = await screenFor(openGround!.x, openGround!.y);
await page.mouse.click(groundPoint.x, groundPoint.y + 16);
await page.waitForTimeout(400);
await page.screenshot({ path: "scripts/shots/demolish-district.png" });

const districtBar = await page.locator("[data-demolish-bar]").innerText();
check("clicking a district's ground condemns the district",
  districtBar.includes(mapHood!.name) && /dissolve it/i.test(districtBar),
  districtBar.replace(/\n/g, " ").trim());

const { count: doomed } = await admin
  .from("buildings").select("id", { count: "exact", head: true }).eq("neighborhood_id", mapHood!.id);
check("the bar counts what comes down with it",
  new RegExp(`${doomed} building`).test(districtBar), `${doomed} in it`);

await page.getByRole("button", { name: /dissolve it/i }).click();
await page.waitForTimeout(2500);

const { data: mapHoodGone } = await admin
  .from("neighborhoods").select("id").eq("id", mapHood!.id).maybeSingle();
check("dissolving from the map removes the district", !mapHoodGone, mapHood!.name);
const { count: mapHoodBuildings } = await admin
  .from("buildings").select("id", { count: "exact", head: true }).eq("neighborhood_id", mapHood!.id);
check("and the buildings standing on it", (mapHoodBuildings ?? 0) === 0);
const { count: mapHoodTiles } = await admin
  .from("tiles").select("x", { count: "exact", head: true }).eq("neighborhood_id", mapHood!.id);
check("and its ground", (mapHoodTiles ?? 0) === 0, `${mapHoodTiles} tiles left`);
check("demolish mode is still open afterwards",
  (await page.locator("[data-demolish-bar]").count()) === 1);

// Panning must still work in demolish mode -- a drag is not a pick.
const anchor = { x: 700, y: 500 };
await page.mouse.move(anchor.x, anchor.y);
await page.mouse.down();
await page.mouse.move(anchor.x + 140, anchor.y + 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
check("dragging pans instead of condemning",
  (await page.getByRole("button", { name: /dissolve it|demolish it/i }).count()) === 0);

await page.getByRole("button", { name: /^done$/i }).click();
await page.waitForTimeout(300);

// --- demolishing from inside --------------------------------------------
const { data: next } = await admin
  .from("buildings").select("id, title").eq("city_id", city!.id).limit(1).single();
await page.goto(`http://localhost:3000/b/${next!.id}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^demolish$/i }).click();
await page.waitForTimeout(200);
const question = await page.locator("text=/Everything inside goes with it/i").count();
check("the interior warns before demolishing", question === 1);
await page.getByRole("button", { name: /demolish it/i }).click();
await page.waitForURL("**/city", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
check("demolishing an interior returns to the map", /\/city$/.test(page.url()), page.url());
const { data: goneToo } = await admin.from("buildings").select("id").eq("id", next!.id).maybeSingle();
check("and removes the building", !goneToo);

// --- dissolving a district ----------------------------------------------
const { data: hood } = await admin
  .from("neighborhoods").select("id, slug, name").eq("city_id", city!.id).order("position").limit(1).single();
const { count: hoodBuildings } = await admin
  .from("buildings").select("id", { count: "exact", head: true }).eq("neighborhood_id", hood!.id);

await page.goto(`http://localhost:3000/n/${hood!.slug}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /dissolve district/i }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: /dissolve it/i }).click();
await page.waitForURL("**/city", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

const { data: hoodGone } = await admin.from("neighborhoods").select("id").eq("id", hood!.id).maybeSingle();
check("dissolving removes the district", !hoodGone, hood!.name);
const { count: orphanBuildings } = await admin
  .from("buildings").select("id", { count: "exact", head: true }).eq("neighborhood_id", hood!.id);
check("its buildings came down with it", (orphanBuildings ?? 0) === 0, `${hoodBuildings} were in it`);
const { count: orphanTiles } = await admin
  .from("tiles").select("x", { count: "exact", head: true }).eq("neighborhood_id", hood!.id);
check("its ground went back to grass", (orphanTiles ?? 0) === 0, `${orphanTiles} tiles left`);

// --- start fresh ---------------------------------------------------------
await page.goto("http://localhost:3000/directory", { waitUntil: "networkidle" });
check("the directory offers a way to start fresh", (await page.getByRole("heading", { name: /start fresh/i }).count()) === 1);

const clearButton = page.getByRole("button", { name: /clear it/i });
check("clearing is disabled until the city is named", await clearButton.isDisabled());

const nameField = page.locator("form input[type=text], form input:not([type])").last();
await nameField.fill("not the city name");
check("a wrong name leaves it disabled", await clearButton.isDisabled());

await page.getByRole("radio", { name: /everything/i }).click();
await nameField.fill(city!.name);
await page.waitForTimeout(200);
check("the right name arms it", !(await clearButton.isDisabled()));
await page.screenshot({ path: "scripts/shots/demolish-start-fresh.png" });

await clearButton.click();
await page.waitForTimeout(3000);

const finalBuildings = await countBuildings();
const { count: finalHoods } = await admin
  .from("neighborhoods").select("id", { count: "exact", head: true }).eq("city_id", city!.id);
const { count: finalTiles } = await admin
  .from("tiles").select("x", { count: "exact", head: true }).eq("city_id", city!.id).not("neighborhood_id", "is", null);
check("starting fresh clears every building", finalBuildings === 0, `${finalBuildings} left`);
check("and every district", (finalHoods ?? 0) === 0, `${finalHoods} left`);
check("and the ground they claimed", (finalTiles ?? 0) === 0, `${finalTiles} left`);

const { data: stillThere } = await admin.from("cities").select("id, name").eq("id", city!.id).maybeSingle();
check("the city itself survives", !!stillThere, stillThere?.name ?? "gone");

await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "scripts/shots/demolish-empty-city.png" });
check("the empty map still renders", (await page.locator('[role="application"]').count()) === 1);

// --- and you can build again on the cleared ground -----------------------
// A building needs a district, so the bar has to open on the survey when
// there are none left; otherwise every lot the user aims at is refused.
await page.getByRole("button", { name: /^build$/i }).click();
await page.waitForTimeout(300);
check("build opens on the district survey when the map is empty",
  (await page.getByRole("radio", { name: /^district$/i, checked: true }).count()) === 1);

await page.fill("#district-name", "First Quarter");
const point = await page.evaluate(({ tx, ty }: { tx: number; ty: number }) => {
  const world = document.querySelector("[data-world]") as HTMLElement;
  const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
  const rect = (world.parentElement as HTMLElement).getBoundingClientRect();
  return { x: rect.left + (tx - ty) * 32 * m.a + m.e, y: rect.top + ((tx + ty) * 16 + 16) * m.d + m.f };
}, { tx: 16, ty: 16 });
await page.mouse.click(point.x, point.y);
await page.waitForTimeout(2500);

const { data: reborn } = await admin
  .from("neighborhoods").select("id, name").eq("city_id", city!.id).maybeSingle();
check("a district can be founded on the cleared ground", reborn?.name === "First Quarter", reborn?.name ?? "none");
await page.screenshot({ path: "scripts/shots/demolish-rebuilt.png" });

if (errors.length) console.log(`page errors: ${errors.join(" | ")}`);
check("no page errors", errors.length === 0, errors.join(" | "));

console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
console.log("The demo city is now empty. Reseed with: npm run seed -- seedtest@burg.local");
await browser.close();
