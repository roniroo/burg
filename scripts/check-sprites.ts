/** Sprites: upload, the image route, hit area, wearing one, building in one, taking it off, deleting. */
import { chromium, type Page } from "playwright";
import { admin, BASE_URL } from "./local-db";
import { smokeCity } from "./smoke-city";
import { until, untilCount, untilText } from "./until";
import { canPlace, type Footprint, type Terrain } from "../lib/placement";

const city = await smokeCity(admin);

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(line);
  results.push(line);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** A PNG drawn on the spot in the page: transparent, with one solid block. */
async function makePng(p: Page, width: number, height: number, block: { x: number; y: number; w: number; h: number }) {
  const dataUrl = await p.evaluate(
    ({ width, height, block }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#c65f3a";
      context.fillRect(block.x, block.y, block.w, block.h);
      return canvas.toDataURL("image/png");
    },
    { width, height, block },
  );
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

// Names this run will create, so a re-run starts clean.
for (const name of ["check tower", "check plaza"]) await admin.from("custom_sprites").delete().eq("name", name);

// --- upload ----------------------------------------------------------------
await page.goto(`${BASE_URL}/sprites`, { waitUntil: "networkidle" });

// 128 wide is a 2x2 lot at the map's scale. A tower in the middle; the corners are transparent.
const tower = await makePng(page, 128, 160, { x: 40, y: 40, w: 48, h: 120 });
await page.setInputFiles("#sprite-file", { name: "check-tower.png", mimeType: "image/png", buffer: tower });

const lotW = await until(() => page.inputValue("#sprite-lot-w"), (v) => v === "2");
check("a 128-pixel image is read as a 2x2 lot", lotW === "2" && (await page.inputValue("#sprite-lot-h")) === "2", lotW);
check("the name comes from the file", (await page.inputValue("#sprite-name")) === "check tower", await page.inputValue("#sprite-name"));
const note = await page.getByText(/every pixel stays sharp|smoothed/).first().textContent();
check("art at the map's scale is promised sharp pixels", /stays sharp/.test(note ?? ""), note ?? "");

await page.getByRole("button", { name: /add to the library/i }).click();
const stored = await until(
  async () =>
    (await admin.from("custom_sprites").select("id, width, height, footprint_w, footprint_h, hit_area").eq("name", "check tower").maybeSingle()).data,
  (row) => !!row,
);
check("uploading stores the sprite", !!stored);
check("with its size and lot", stored?.width === 128 && stored?.height === 160 && stored?.footprint_w === 2 && stored?.footprint_h === 2,
  JSON.stringify(stored && { w: stored.width, h: stored.height, fw: stored.footprint_w, fh: stored.footprint_h }));

const hull = (stored?.hit_area ?? "").split(" ").map((p) => p.split(",").map(Number) as [number, number]);
const xs = hull.map(([x]) => x);
const ys = hull.map(([, y]) => y);
check("its hit area is the painted block, not the image", Math.min(...xs) === 40 && Math.max(...xs) === 88 && Math.min(...ys) === 40 && Math.max(...ys) === 160,
  stored?.hit_area ?? "");

const card = await untilCount(page.locator(`[data-sprite="${stored?.id}"]`), (n) => n === 1);
check("the library lists it", card === 1);

// --- the image route ---------------------------------------------------------
const image = await page.request.get(`${BASE_URL}/api/sprites/${stored?.id}`);
const body = await image.body();
check("the image is served as uploaded", image.status() === 200 && image.headers()["content-type"] === "image/png" && body.equals(tower),
  `${image.status()} ${image.headers()["content-type"]} ${body.length} bytes`);
const missing = await page.request.get(`${BASE_URL}/api/sprites/00000000-0000-4000-8000-000000000000`);
check("an unknown sprite is a 404", missing.status() === 404, String(missing.status()));

// --- a file that is not a PNG is refused before upload ------------------------
await page.setInputFiles("#sprite-file", { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not a picture") });
// Next's route announcer is also role="alert", so match on the message itself.
const refusal = await untilText(page.getByRole("alert").filter({ hasText: /open|PNG/ }), (t) => t.trim().length > 0);
check("a broken image is refused with a reason", /would not open/i.test(refusal), refusal.trim());

// --- picking lots with the app's own rules ------------------------------------
const [{ data: hoods }, { data: buildings }, { data: tiles }] = await Promise.all([
  admin.from("neighborhoods").select("id, origin_x, origin_y, width, height").eq("city_id", city.id),
  admin.from("buildings").select("id, title, neighborhood_id, tile_x, tile_y, footprint_w, footprint_h").eq("city_id", city.id),
  admin.from("tiles").select("x, y, terrain").eq("city_id", city.id),
]);
const terrain = new Map((tiles ?? []).map((t) => [`${t.x},${t.y}`, t.terrain as Terrain]));
const fits = (b: NonNullable<typeof buildings>[number], w: number, h: number) => {
  const region = (hoods ?? []).find((n) => n.id === b.neighborhood_id);
  if (!region) return false;
  return canPlace({
    footprint: { tile_x: b.tile_x, tile_y: b.tile_y, footprint_w: w, footprint_h: h },
    region,
    occupied: (buildings ?? []).filter((o) => o.id !== b.id) as Footprint[],
    terrainAt: (x, y) => terrain.get(`${x},${y}`) ?? "grass",
    city,
  }).ok;
};

// The building that will wear the tower: room for 2x2 where it stands, and on screen.
await page.goto(`${BASE_URL}/city`, { waitUntil: "networkidle" });
await untilCount(page.locator("[data-building]"), (n) => n > 0);
const viewport = await page.locator('[role="application"]').boundingBox();
let wearer: NonNullable<typeof buildings>[number] | null = null;
for (const b of buildings ?? []) {
  if (!fits(b, 2, 2)) continue;
  const box = await page.locator(`[data-building="${b.id}"]`).boundingBox();
  if (box && box.x > viewport!.x + 40 && box.x + box.width < viewport!.x + viewport!.width - 40 && box.y > viewport!.y + 120 && box.y + box.height < viewport!.y + viewport!.height - 80) {
    wearer = b;
    break;
  }
}
check("found an on-screen building with room for a 2x2", !!wearer, wearer?.title ?? "");

// --- wearing it ----------------------------------------------------------------
await page.goto(`${BASE_URL}/b/${wearer!.id}`, { waitUntil: "networkidle" });
await page.selectOption("#building-look", stored!.id);
const worn = await until(
  async () => (await admin.from("buildings").select("custom_sprite_id, footprint_w, footprint_h").eq("id", wearer!.id).single()).data,
  (row) => row?.custom_sprite_id === stored!.id,
);
check("a building can put the sprite on", worn?.custom_sprite_id === stored!.id);
check("and takes its lot", worn?.footprint_w === 2 && worn?.footprint_h === 2, `${worn?.footprint_w}x${worn?.footprint_h}`);

await page.goto(`${BASE_URL}/city`, { waitUntil: "networkidle" });
const drawn = await untilCount(page.locator(`[data-building="${wearer!.id}"] image`), (n) => n === 1);
check("the map draws the uploaded image", drawn === 1);
const href = await page.locator(`[data-building="${wearer!.id}"] image`).getAttribute("href");
check("from the library", href === `/api/sprites/${stored!.id}`, href ?? "");

// The image box is the lot's width; the painted block is its middle third.
const box = await page.locator(`[data-building="${wearer!.id}"]`).boundingBox();
const hit = (fx: number, fy: number) =>
  page.evaluate(
    ({ x, y }) => (document.elementFromPoint(x, y)?.closest("[data-building]") as HTMLElement | null)?.dataset.building ?? null,
    { x: box!.x + box!.width * fx, y: box!.y + box!.height * fy },
  );
check("clicking the painted block reaches the building", (await hit(0.5, 0.6)) === wearer!.id);
check("clicking its transparent corner does not", (await hit(0.06, 0.08)) !== wearer!.id);

// --- building in it ------------------------------------------------------------
const harbor = (await admin.from("neighborhoods").select("id, origin_x, origin_y, width, height").eq("city_id", city.id).eq("slug", "harbor-district").single()).data;
const { data: standing } = await admin.from("buildings").select("tile_x, tile_y, footprint_w, footprint_h").eq("city_id", city.id);
let lot: { x: number; y: number } | null = null;
for (let y = harbor!.origin_y; y < harbor!.origin_y + harbor!.height && !lot; y++) {
  for (let x = harbor!.origin_x; x < harbor!.origin_x + harbor!.width && !lot; x++) {
    const ok = canPlace({
      footprint: { tile_x: x, tile_y: y, footprint_w: 2, footprint_h: 2 },
      region: harbor!,
      occupied: (standing ?? []) as Footprint[],
      terrainAt: (tx, ty) => terrain.get(`${tx},${ty}`) ?? "grass",
      city,
    }).ok;
    if (ok) lot = { x, y };
  }
}
check("found a free 2x2 lot to build on", !!lot, JSON.stringify(lot));

await page.goto(`${BASE_URL}/city`, { waitUntil: "networkidle" });
await untilCount(page.locator("[data-building]"), (n) => n > 0);
await page.getByRole("button", { name: /^build$/i }).click();
await page.getByRole("radio", { name: /noticeboard/i }).click();
await page.fill("#build-title", "Check Tower");
await page.selectOption("#build-look", stored!.id);

const point = await page.evaluate(
  ({ tx, ty }) => {
    const world = document.querySelector("[data-world]") as HTMLElement;
    const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    const rect = (world.parentElement as HTMLElement).getBoundingClientRect();
    return { x: rect.left + (tx - ty) * 32 * m.a + m.e, y: rect.top + ((tx + ty) * 16 + 16) * m.d + m.f };
  },
  { tx: lot!.x, ty: lot!.y },
);
await page.mouse.move(point.x, point.y);
const ghost = await untilCount(page.locator(`image[href="/api/sprites/${stored!.id}"]`), (n) => n >= 2);
check("the ghost shows the chosen sprite", ghost >= 2, `${ghost} images`);
await page.mouse.down();
await page.mouse.up();
const built = await until(
  async () => (await admin.from("buildings").select("id, custom_sprite_id, footprint_w, footprint_h, tile_x, tile_y").eq("city_id", city.id).eq("title", "Check Tower").maybeSingle()).data,
  (row) => !!row,
);
check("building in a sprite stores it", built?.custom_sprite_id === stored!.id);
check("on the sprite's lot, where it was aimed", built?.footprint_w === 2 && built?.footprint_h === 2 && built?.tile_x === lot!.x && built?.tile_y === lot!.y,
  JSON.stringify(built));

// --- refused when it will not fit ----------------------------------------------
const plaza = await makePng(page, 256, 200, { x: 0, y: 72, w: 256, h: 128 });
const { data: plazaRow } = await (async () => {
  await page.goto(`${BASE_URL}/sprites`, { waitUntil: "networkidle" });
  await page.setInputFiles("#sprite-file", { name: "check-plaza.png", mimeType: "image/png", buffer: plaza });
  await until(() => page.inputValue("#sprite-lot-w"), (v) => v === "4");
  await page.getByRole("button", { name: /add to the library/i }).click();
  return { data: await until(async () => (await admin.from("custom_sprites").select("id").eq("name", "check plaza").maybeSingle()).data, (r) => !!r) };
})();
// Re-read: the tower just built stands beside other buildings, which is what
// a 4x4 cannot squeeze past.
const { data: now } = await admin.from("buildings").select("id, title, neighborhood_id, tile_x, tile_y, footprint_w, footprint_h").eq("city_id", city.id);
buildings!.splice(0, buildings!.length, ...(now ?? []));
const cramped = (buildings ?? []).find((b) => b.id !== wearer!.id && !fits(b, 4, 4));
check("found a building with no room for a 4x4", !!cramped && !!plazaRow, cramped?.title ?? "");
if (cramped && plazaRow) {
  const { data: before } = await admin.from("buildings").select("custom_sprite_id, footprint_w, footprint_h").eq("id", cramped.id).single();
  await page.goto(`${BASE_URL}/b/${cramped.id}`, { waitUntil: "networkidle" });
  await page.selectOption("#building-look", plazaRow.id);
  const why = await untilText(page.getByRole("alert").filter({ hasText: /lot/ }), (t) => /needs a 4×4 lot/.test(t));
  check("a sprite too big for the lot is refused with the reason", /needs a 4×4 lot/.test(why), why.trim());
  const { data: afterRefusal } = await admin.from("buildings").select("custom_sprite_id, footprint_w, footprint_h").eq("id", cramped.id).single();
  check("and the building is left as it was", JSON.stringify(afterRefusal) === JSON.stringify(before), JSON.stringify(afterRefusal));
  check("the picker goes back to what it wears", (await page.inputValue("#building-look")) === (before?.custom_sprite_id ?? ""));
}

// --- taking it off -------------------------------------------------------------
await page.goto(`${BASE_URL}/b/${wearer!.id}`, { waitUntil: "networkidle" });
await page.selectOption("#building-look", "");
const off = await until(
  async () => (await admin.from("buildings").select("custom_sprite_id").eq("id", wearer!.id).single()).data,
  (row) => row?.custom_sprite_id === null,
);
check("the usual look can be put back", off?.custom_sprite_id === null);

// --- deleting ------------------------------------------------------------------
await page.goto(`${BASE_URL}/sprites`, { waitUntil: "networkidle" });
const towerCard = page.locator(`[data-sprite="${stored!.id}"]`);
const question = await towerCard.getByRole("button", { name: /^delete$/i }).click().then(() => towerCard.textContent());
check("deleting says who is wearing it", /building wearing it goes back/.test(question ?? ""), (question ?? "").replace(/\s+/g, " ").slice(0, 120));
await towerCard.getByRole("button", { name: /delete it/i }).click();
const gone = await until(
  async () => (await admin.from("custom_sprites").select("id").eq("id", stored!.id).maybeSingle()).data,
  (row) => row === null,
);
check("deleting removes it from the library", gone === null);
const { data: orphan } = await admin.from("buildings").select("custom_sprite_id").eq("id", built!.id).single();
check("and the building that wore it goes back to its usual look", orphan?.custom_sprite_id === null);

if (plazaRow) await admin.from("custom_sprites").delete().eq("id", plazaRow.id);

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
