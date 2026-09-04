/** Accessibility + reduced-motion checks across the main routes. */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
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

// Audit every interior type that exists, not just the two static routes.
const { data: buildings } = await admin.from("buildings").select("id, artifact_type, title");
const routeFor = (type: string) => {
  const match = (buildings ?? []).find((b) => b.artifact_type === type);
  return match ? `/b/${match.id}` : null;
};

const ROUTES = [
  "/city",
  "/directory",
  routeFor("doc"),
  routeFor("table"),
  routeFor("kiosk"),
].filter((r): r is string => r !== null);

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const browser = await chromium.launch();

for (const reduced of [false, true]) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await context.addCookies([cookie]);
  const page = await context.newPage();

  for (const path of ROUTES) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const label = `${path}${reduced ? " (reduced motion)" : ""}`;
    if (results.violations.length === 0) {
      console.log(`PASS  axe clean: ${label}`);
    } else {
      console.log(`FAIL  axe violations on ${label}:`);
      for (const v of results.violations) {
        console.log(`        [${v.impact}] ${v.id}: ${v.help}`);
        for (const n of v.nodes.slice(0, 2)) console.log(`          ${n.target.join(" ")}`);
      }
    }
  }

  if (reduced) {
    // Under reduced motion the camera must cut, not animate.
    await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const world = page.locator('[role="application"] > div').first();
    // The global stylesheet clamps every transition to 0.001ms, so the
    // computed duration is always effectively zero. The meaningful check is
    // that the component's own reduced-motion branch ran and wrote
    // `transition: none` inline rather than a stepped camera move.
    const inline = await world.getAttribute("style");
    const cameraIsCut = /transition:\s*none/.test(inline ?? "");
    console.log(
      cameraIsCut
        ? "PASS  camera is an instant cut under reduced motion"
        : `FAIL  camera still animates under reduced motion (${inline})`,
    );

    const computed = await world.evaluate((el) => getComputedStyle(el).transitionDuration);
    const seconds = parseFloat(computed);
    console.log(
      seconds <= 0.001
        ? `PASS  computed transition is instant (${computed})`
        : `FAIL  computed transition still runs (${computed})`,
    );
  }

  await context.close();
}

await browser.close();
