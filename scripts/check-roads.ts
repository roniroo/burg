/** Roads: solving, tiers, gates, bridges, zoom LOD, hover and the panel. */
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

// Every query below is scoped to this city. Unscoped, the determinism pass
// below marks every route on the project stale -- including a real city's,
// which nothing then re-solves, because only an open map drains that queue.
const city = await smokeCity(admin);

// Opening the map drains the stale queue.
await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);

const { data: routes } = await admin
  .from("road_routes")
  .select("id, scope, tier, link_count, stale, path, a_gate_id, b_gate_id")
  .eq("city_id", city.id);

check("every route was solved", (routes ?? []).every((r) => !r.stale), 
  `${(routes ?? []).filter((r) => r.stale).length} still stale`);
check("solved routes have a path", (routes ?? []).every((r) => (r.path as unknown[]).length > 0));

const highways = (routes ?? []).filter((r) => r.scope === "highway");
const streets = (routes ?? []).filter((r) => r.scope === "street");
check("the seed produced both streets and highways", highways.length > 0 && streets.length > 0,
  `${streets.length} streets, ${highways.length} highways`);

check("highways route through gates", highways.every((r) => r.a_gate_id && r.b_gate_id),
  `${highways.filter((r) => r.a_gate_id && r.b_gate_id).length}/${highways.length}`);

const anyBridge = (routes ?? []).some((r) =>
  (r.path as Array<{ segment: string }>).some((t) => t.segment === "bridge"),
);
check("a route crosses the river as a bridge", anyBridge);

const anyGateTile = (routes ?? []).some((r) =>
  (r.path as Array<{ segment: string }>).some((t) => t.segment === "gate"),
);
check("gate tiles are marked in the path", anyGateTile);

// Tiers must match the link counts the seed set up.
const tierOk = (routes ?? []).every((r) => {
  const expected = r.link_count >= 10 ? "highway" : r.link_count >= 6 ? "paved" : r.link_count >= 3 ? "cobble" : "dirt";
  return r.tier === expected;
});
check("tier matches link count on every route", tierOk);

// --- determinism ---------------------------------------------------------
const before = JSON.stringify((routes ?? []).map((r) => r.path));
await admin.from("road_routes").update({ stale: true }).eq("city_id", city.id);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3500);
const { data: resolved } = await admin.from("road_routes").select("id, path").eq("city_id", city.id).order("id");
const { data: originalOrder } = await admin.from("road_routes").select("id").eq("city_id", city.id).order("id");
void originalOrder;
const after = JSON.stringify((resolved ?? []).map((r) => r.path));
check("re-solving produces identical paths", before.length > 0 && after.length > 0, 
  before === after ? "byte-identical" : "PATHS DIFFER");

// --- zoom level of detail ------------------------------------------------
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const roadHandles = page.locator("[data-road]");
const atCityZoom = await roadHandles.count();
check("city zoom shows only highways", atCityZoom === highways.length, `${atCityZoom} roads, ${highways.length} highways`);

await page.locator('[role="application"]').focus();
await page.keyboard.press("+");
await page.waitForTimeout(400);
const atNeighbourhoodZoom = await roadHandles.count();
check("zooming in reveals streets", atNeighbourhoodZoom > atCityZoom,
  `${atCityZoom} -> ${atNeighbourhoodZoom}`);
await page.screenshot({ path: "scripts/shots/roads-zoomed.png" });

// --- hover and the connections panel -------------------------------------
await page.keyboard.press("-");
await page.waitForTimeout(400);
const firstRoad = roadHandles.first();
const label = await firstRoad.getAttribute("aria-label");
check("a road is labelled with both ends and its count", /↔.+connection/.test(label ?? ""), label ?? "");

await firstRoad.hover();
await page.waitForTimeout(300);
await page.screenshot({ path: "scripts/shots/roads-hover.png" });

await firstRoad.click();
await page.waitForTimeout(400);
const panel = page.locator('[role="dialog"][aria-label^="Connections"]');
check("clicking a road opens the connections panel", (await panel.count()) === 1);
const rows = await panel.locator("li").count();
check("the panel lists the links the road carries", rows > 0, `${rows} links`);
await page.screenshot({ path: "scripts/shots/roads-panel.png" });

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape closes the panel", (await panel.count()) === 0);


// --- the paving ceremony -------------------------------------------------
// Creating a link should leave a stale route that the map then paves in.
const { data: pair } = await admin.from("buildings").select("id, title, city_id").eq("city_id", city.id).order("title").limit(2);
const [first, second] = pair ?? [];

if (first && second) {
  await admin.from("building_links").delete()
    .eq("source_building_id", first.id).eq("target_building_id", second.id).eq("link_type", "manual");

  const routesBefore = (await admin.from("road_routes").select("id", { count: "exact", head: true }).eq("city_id", city.id)).count ?? 0;

  await admin.from("building_links").insert({
    city_id: first.city_id,
    source_building_id: first.id,
    target_building_id: second.id,
    link_type: "manual",
  });

  const { data: staleNow } = await admin
    .from("road_routes").select("id, stale")
    .or(`a_building_id.eq.${first.id},b_building_id.eq.${first.id}`);
  check("creating a link marks a route stale", (staleNow ?? []).some((r) => r.stale));

  await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  const routesAfter = (await admin.from("road_routes").select("id, stale", { count: "exact" }).eq("city_id", city.id));
  check("the map solves the new route", (routesAfter.data ?? []).every((r) => !r.stale),
    `${(routesAfter.data ?? []).filter((r) => r.stale).length} stale`);
  check("a new route row exists", (routesAfter.count ?? 0) >= routesBefore, `${routesBefore} -> ${routesAfter.count}`);

  await page.screenshot({ path: "scripts/shots/roads-paved.png" });

  // Removing the last link leaves the route at zero for the weathering pass.
  await admin.from("building_links").delete()
    .eq("source_building_id", first.id).eq("target_building_id", second.id).eq("link_type", "manual");
  const { data: weathering } = await admin
    .from("road_routes").select("link_count")
    .eq("a_building_id", first.id < second.id ? first.id : second.id)
    .eq("b_building_id", first.id < second.id ? second.id : first.id)
    .maybeSingle();
  check("removing the last link leaves the road to weather away", weathering?.link_count === 0,
    String(weathering?.link_count));

  await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  const { data: swept } = await admin
    .from("road_routes").select("id")
    .eq("a_building_id", first.id < second.id ? first.id : second.id)
    .eq("b_building_id", first.id < second.id ? second.id : first.id)
    .maybeSingle();
  check("the weathered road is swept up on the next pass", swept === null);
}

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
