# Developing Burg

Burg is one Next.js app with its database inside it. There is no server to
host and nothing to sign up for: the same code runs as `npm run dev` while you
work on it, and as **Burg.app** when you use it.

| | Database | Use when |
|---|---|---|
| **Dev server** | `.burg-data/` in the repo | Working on the code. The check suites reseed and wreck it freely. |
| **Burg.app** | `~/Library/Application Support/Burg/data` | Using Burg. Your real city lives here. |

The two never share a directory, and nothing in the repo can reach the app's.

The hosted version — Render, Supabase, Stripe, sign-in, sharing — is preserved
at the git tag **`hosted-final`**.

---

## Prerequisites

- **macOS on Apple silicon** for the app. The dev server runs anywhere Node does.
- **Node 20.9+** (Next 16's floor). The app does not need it: it runs on the
  Node inside Electron.

```bash
npm install
```

That is all. No Docker, no CLI logins, no `.env.local`.

---

## Running it

```bash
npm run dev           # http://localhost:3000, bound to 127.0.0.1
```

The first request opens `.burg-data/`, applies every migration, makes the one
owner this database belongs to, and founds the demo city, Ideaburg. Delete the
directory for a clean slate; the next request starts again from nothing.

To clear a city without deleting anything else, use the app: **Directory →
Start fresh** demolishes every building, or every building and district, once
you type the city's name. Piece by piece, the map's **Demolish** mode takes
both — click a building to condemn it, or a district's open ground to condemn
the district — and a building also comes down from the button beside its
interior's breadcrumb, or from the Directory.

---

## The database

**PGlite** — Postgres compiled to WebAssembly — running inside the Next.js
server process, with its files in one directory. It is the same Postgres the
hosted project ran, so `db/migrations/` applies unchanged: triggers, full-text
search, and the lot exclusion constraint that needs `btree_gist`.

| File | |
|---|---|
| `lib/db/open.ts` | Opens a data directory and applies any migration it has not seen, each in its own transaction. Applied versions are recorded in `local.migrations`. |
| `lib/db/server.ts` | The one open database per process, the first-launch owner and seed, `createClient()`, `getOwner()`. |
| `lib/db/rest.ts` | A PostgREST for one person, in-process. See below. |
| `lib/db/client.ts` | A postgrest-js client whose `fetch` is `rest.ts`. |
| `lib/db/lifecycle.ts` | Opens the database at server start; closes it when the app quits. |

**One process opens a data directory at a time.** That is PGlite's rule, and it
shapes three things here: the dev server keeps its database on `globalThis` so
a hot reload reuses it; the check scripts reach the dev database *through* the
dev server rather than opening it themselves; and `next build` is forbidden from
opening it at all (`database()` throws during a build, and `createClient()` calls
`connection()` so no page is prerendered against it).

### Why the queries still look like Supabase

Every query in the app is a postgrest-js chain — `.from("buildings").select(...)
.eq("city_id", id)` — written when the app talked to Supabase. Rather than
rewrite 180-odd call sites, `lib/db/rest.ts` answers those requests the way
PostgREST did: it turns the URL into SQL against the local database and replies
with a PostgREST-shaped `Response`. The call sites and the generated types did
not change.

It implements the part of PostgREST's grammar this codebase uses — columns,
aliases, casts, foreign-key embeds, the common filters, `or=`, ordering,
paging, counts, `.single()`, insert/upsert/update/delete with
`return=representation`, and RPC — and refuses anything else with a
`PGRST100` error rather than guessing. Results are serialised by Postgres
(`json_agg`), as PostgREST does it, so timestamps and jsonb come back in the
shape they always had, and errors keep their SQLSTATE (`23505`, `23P01`), which
the app reads.

`lib/db/rest.test.ts` checks it through postgrest-js against a real in-memory
Postgres, and finishes by seeding Ideaburg through it.

One trap it has already fallen into: a bare relation name in a SQL expression
means the whole row only when no column shares the name. The translator used
`json_agg(x)` over a subquery called `x`, `tiles` has an `x` column, and every
tile came back as a bare number — so the road solver saw no river and the map
lost its terrain. Internal aliases now start with two underscores, which no
column may.

### Who is "the user"

There is one person. `auth.users` holds exactly one row, and `auth.uid()` in
SQL answers with it (`db/migrations/00000000000000_local_auth.sql`), so the
SECURITY DEFINER helpers written for Supabase keep their meaning. The app
connects as the database owner, which row-level security does not apply to: the
policies from the hosted era are still in the migrations and inert here.

### Database changes

Migrations are plain SQL in `db/migrations/`, applied in filename order. To add
one, write `db/migrations/<yyyymmddhhmmss>_what_it_does.sql`. The dev server
applies it on its next start, and the app on its next launch — every user's
database migrates itself, so a migration that fails takes that launch down with
it. Test it against a copy first (see *Backups*).

`lib/database.types.ts` was generated by the Supabase CLI from the hosted
schema and has been edited by hand since (the `subscriptions` table and
`city_is_paid` were removed with the plans). Keep it in step with any migration
by hand, or regenerate it with `supabase gen types typescript --db-url <url>`
against any Postgres the migrations have been applied to.

---

## The desktop app

```bash
npm run desktop           # build, then run it from the checkout
npm run desktop:package   # build Burg.app and a .dmg in dist-desktop/
```

Install by opening `dist-desktop/Burg-<version>-arm64.dmg` and dragging Burg to
Applications. The app is **ad-hoc signed**: Apple silicon will not run an
unsigned binary, and a Developer ID is only needed to hand the app to other
people. Built on this Mac, it opens with no warning. Copied to another Mac it
will need right-click → **Open** the first time.

| | |
|---|---|
| `desktop/main.mjs` | The Electron main process — the whole of the app's own code. |
| `desktop/prepare.mjs` | Finishes `.next/standalone` (static files, `public/`) and checks it has what the app needs at runtime. |
| `desktop/after-pack.cjs` | Copies the server into the bundle; electron-builder's own copier mishandles `node_modules`. |
| `electron-builder.yml` | Packaging, signing, and the Electron fuses. |

How it fits together: the app starts the standalone Next server as an Electron
**utility process** — Electron's own Node — on a free loopback port, points
`BURG_DATA_DIR` at Application Support, and opens a window on it. On quit it
sends the server a `shutdown` message, and the server closes the database
before it exits, so the files are a clean checkpoint rather than a crash to
recover from. The server log says `[burg] database closed cleanly` when that
worked.

**The door.** With no sign-in, `proxy.ts` is the only thing between the
database and anything else on the machine:

- It refuses any request whose `Host` is not loopback. The server only listens
  on 127.0.0.1, but a web page can still reach it through DNS rebinding, and
  its requests then carry the rebinding name in `Host`.
- In the app, it refuses any request without the launch token. The app starts
  the server with a fresh random `BURG_LAUNCH_TOKEN` and gives its window the
  same token as a cookie, so other programs and other accounts on the Mac find
  a port that answers 403.

**The fuses** (`electronFuses` in `electron-builder.yml`) stop the packaged app
honouring `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`. The first is
not theoretical: VS Code and Cursor export `ELECTRON_RUN_AS_NODE=1` into their
terminals, `open` passes the caller's environment on, and an Electron app that
honours it starts as a bare Node with no script and quits at once, silently.
`npm run desktop` unsets it for the same reason.

**Pixel art and zoom.** The window refuses pinch-zoom and the View menu has no
zoom items: a fractional page zoom resamples every sprite. The map has its own
integer zoom.

### Where things are

| | |
|---|---|
| Your city | `~/Library/Application Support/Burg/data` — **File → Show Data Folder** |
| The server's log | `~/Library/Logs/Burg/server.log`, rewritten each launch — **File → Show Server Log** |

`BURG_DATA_DIR=/some/dir npm run desktop` runs the app against another
directory, which is how to try something without touching the real city.

### Backups

The data folder *is* the database. Quit Burg, then copy the folder somewhere.
Restoring is quitting Burg and copying it back. Do not copy it while Burg is
open: the files are mid-write.

### Bringing a city over from the hosted version

```bash
npm run import:hosted -- --email you@example.com --dry-run   # counts, writes nothing
npm run import:hosted -- --email you@example.com             # into the app's folder
```

Quit Burg first. It needs `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, and only ever reads the hosted
project. It copies every city that address owns, keeping its user id so every
row still points at the right person, and leaves out invitations, other
people's memberships and billing. Rows go in inside one transaction with
triggers off, the way a restore is done, and the transaction only commits if
every count matches and every foreign key resolves. `--replace` allows it to
wipe what is already there; `--data-dir` aims it somewhere else.

`veronica.leigh.head@gmail.com`'s city was imported on 2026-10-25 and checked
row for row against the hosted copy.

---

## Testing

### Unit tests

The pure modules — projection maths, the table model, document flattening —
and the local PostgREST, which runs a real Postgres in memory.

```bash
npm test              # vitest run
npm run test:watch
```

### Static checks

```bash
npm run typecheck     # tsc --noEmit, strict
npm run lint          # eslint, flat config
npm run build         # full production build
```

### Browser checks

These drive a real Chromium against the dev server and assert on behaviour:
keyboard navigation, the zoom ladder, pixel snapping, autosave, the suggestion
menus, link-to-road reconciliation, and accessibility.

```bash
npm run dev           # in one terminal
npm run check         # in another
```

`npm run check` reseeds the demo city first, because several suites consume
seeded data — promotion turns a note into a building, for one. It is
destructive to the dev database and can reach nothing else: suites talk to the
database through `/api/dev/rest` (see `scripts/local-db.ts`), a route that only
exists under `next dev` and refuses any request without an `apikey` header, so
a web page cannot use it either.

**No suite sleeps.** There is not a single `waitForTimeout` left in
`scripts/check-*.ts`, and adding one back is how a suite starts failing for
reasons that have nothing to do with the code under test. A duration long
enough on an idle laptop is not long enough when a dev server, a production
build and a dozen suites are competing for the same cores. `scripts/until.ts`
is the whole answer: `until` polls any read until a predicate accepts it, and
`untilCount` / `untilText` / `untilAttribute` do the same for a locator. They
return the **last value read** rather than throwing, which is the point --
a genuine failure still prints a FAIL line with the value that was actually
there, where Playwright's own retrying assertions would end the script.

Two traps worth knowing, because both produced real flakes here:

- **Wait for the last write, not the first.** `createNeighborhood` inserts the
  district and *then* tints its ground; waiting for the district row and
  reading the tiles is a race. Promotion removes a note and adds a building.
  Start fresh is a cascade.
- **The database moving is not the page moving.** Waiting for a row to appear
  and then asserting on rendered text races the revalidation. Either wait for
  the page too, or -- better -- wait for the two to *agree*, which is what the
  demolish bar's building count does.

Suites resolve their city through `scripts/smoke-city.ts` and filter by the id
it returns, so a second city made by hand while poking at the dev server is
never counted into an assertion. Any new suite must do the same.

Individual suites:

```bash
npx tsx scripts/check-map.ts                    # camera, keyboard, zoom ladder
npx tsx scripts/check-doc.ts <doc-id>           # editor, autosave, [[links]]
npx tsx scripts/check-newsstand.ts <kiosk-id>   # link rack + OpenGraph fetch
npx tsx scripts/check-warehouse.ts <table-id>   # grid, views, row panel, paste
npx tsx scripts/check-board.ts <board-id>       # notes, modes, promotion
npx tsx scripts/check-build.ts                  # build mode, districts, regions
npx tsx scripts/check-roads.ts                  # solving, gates, bridges, LOD
npx tsx scripts/check-life.ts                   # day/night, ticker, ⌘K
npx tsx scripts/check-studio.ts                 # whiteboard tools and saving
npx tsx scripts/check-sprites.ts                # upload, hit area, looks, refusal, delete
npx tsx scripts/check-a11y.ts                   # axe, normal + reduced motion
npx tsx scripts/check-demolish.ts               # demolish, dissolve, start fresh
```

`check-demolish.ts` runs last in `npm run check` and leaves the demo city
empty, because that is what it is testing. Reseed afterwards with
`npx tsx scripts/dev-reset.ts && npm run seed`.

A browser check that fails an assertion still exits 0 — the PASS/FAIL lines are
the source of truth, not the exit code.

`npx tsx scripts/dev-ids.ts` prints the seeded building ids by type.

### Screenshots

```bash
npx tsx scripts/shot.ts /city city.png
npx tsx scripts/shot.ts /city city-rm.png --reduced-motion
```

Output lands in `scripts/shots/`.

### Sprites and footprints

`lib/sprites.ts` is the whole art department: every building, terrain tile,
road and prop is generated geometry, and no component names a sprite or writes
a polygon. Re-arting Burg means editing that file and nothing else.

A building's footprint is **not** independent of its sprite.
`spriteFootprint(key, variant)` returns the shape a recipe is drawn for, and
`createBuilding`, the seed and the placement check all read it. The lit
(lower-right) face spans the H axis, so an elongated building wants its long
side on H or its facade lands on the short end. If a stored footprint drifts
from its recipe the sprite is squeezed onto the wrong face and `depthFor()`
sorts it against the wrong neighbours — `scripts/dev-footprints.ts` finds and
repairs that.

**A building's hit area is its art, not its bounding box.** The button around
a sprite is a rectangle and an isometric silhouette does not fill one, so for
anything bigger than 1x1 the rectangle's empty corners reach several tiles past
the drawing. A 2x3 warehouse used to claim five tiles of visibly bare ground to
its west: you clicked cobble in demolish mode and condemned a building drawn
four tiles away. The fix is three lines of CSS in `globals.css` rather than any
geometry -- SVG's `visiblePainted` is already the default hit-testing rule for
a shape, and the sprite is nothing but `<polygon>` with no backing rect, so the
button opts out of being a target and the polygons opt back in. Keyboard focus
is untouched; `pointer-events` says nothing about tab order.

Note what is *not* a bug: a two-storey building legitimately covers the tiles
behind it, so clicking there condemns the building rather than the district.
That is what isometric depth means, and it is why a test looking for "open
ground" has to ask the page what is under the point rather than assume an empty
footprint is clickable -- see `check-demolish.ts`.

### Custom sprites

`/sprites` is a library of your own PNGs, shared by every
city on the machine. A building wears one from the **Look** picker on its page,
or is built in one from the Build bar's **Look** select.

A custom sprite declares its lot, 1×1 to 4×4, and the footprint rule above holds
for it too: a building that puts one on takes that footprint where it stands,
through the same `canPlace` as building and moving, and is refused with the
reason if it will not fit. Taking it off returns the recipe's footprint when
there is room and otherwise keeps the one it has, since the generated art can
draw itself at any size. Deleting a sprite hands its buildings back their usual
look (`on delete set null`).

Layout is in `lib/custom-sprites.ts`: the image is scaled to exactly the lot's
width and stands on the lot's bottom corner. A lot is 32 pixels across for every
tile of width and every tile of depth, so art drawn at that width, or an exact
multiple, keeps every pixel whole; anything else is smoothed, and the uploader
says so. **Download a blank lot** gives a PNG at the right size with the tiles
marked, to draw over.

The hit-area rule holds by construction. The uploader traces the convex hull of
the image's opaque pixels in the browser — where there is a canvas — and
`CustomSprite` draws it as an invisible polygon over the image, so the
`[data-building] polygon` rule in `globals.css` makes exactly the painted part
clickable. The server checks the bytes are a PNG of the size the browser
reported (`pngSize` reads IHDR) and that the outline fits inside it.

Images live in the database (`custom_sprites.image`, bytea), so backing up the
data folder backs up the art. They are served from `/api/sprites/<id>` — behind
the launch token like everything else — and read and written with raw SQL in
`lib/db/sprites.ts`, because through the PostgREST layer a bytea becomes a hex
string in JSON. Uploads are server actions; `next.config.ts` raises their body
limit to fit the 5 MB cap.

Street furniture has no table behind it: `lib/props.ts` derives the scatter
from the tile's coordinates and the city's seed, so it is stable across
reloads without a row per lamp post. Nobody can place a lamp deliberately;
when that is worth having, `propAt` becomes the fallback for a `prop` column
on `tiles` rather than being replaced by it.

### What to check by hand

The automated checks do not cover feel. Worth looking at yourself:

- **Pan and zoom.** Drag the map; wheel to zoom. It should step 1× → 2× → 3×
  with no intermediate blur, and the point under the cursor should stay put.
- **Reduced motion.** Turn on *System Settings → Accessibility → Display →
  Reduce motion* and reload. Ambient motion stops and entering a building
  becomes an instant cut.
- **Keyboard only.** Tab to the map, then arrow keys — the cursor moves tile by
  tile along screen axes, and Enter opens whatever is under it. `/directory`
  must reach everything the map can.
- **The day/night cycle** follows your own clock, so the city is dark when it
  is dark where you are. To see the other end of the day without waiting,
  change your system clock, or read `lib/daylight.ts`, which is a pure function
  of the time you hand it.
- **The sprites.** Windows, doors and shopfronts are all one token, so the
  whole city lights at dusk. Chimney smoke is the only loop the sprites own
  and it stops under reduced motion.
- **Roads.** Open the map and give it a few seconds: any route the database has
  flagged stale is solved on load and paves itself in. Add a `[[link]]` in a
  document and come back to the map to watch a new road appear.
- **The app's quit.** Quit Burg and look at the end of the server log for
  `database closed cleanly`.

---

## Dev helper scripts

| Script | What it does |
|---|---|
| `scripts/seed.ts` | `npm run seed`: founds Ideaburg in the dev database if it has none. Needs the dev server. |
| `scripts/dev-reset.ts` | Deletes every city in the dev database. **Destructive**, and only able to reach the dev database. |
| `scripts/local-db.ts` | Not a script — the postgrest-js client every suite and dev script uses, pointed at the dev server. |
| `scripts/smoke-city.ts` | Not a script — the module every check suite imports to resolve which city it may touch. |
| `scripts/dev-footprints.ts` | Reports buildings whose stored footprint has drifted from the shape their sprite recipe is drawn for; `--fix` writes the recipe's shape back, skipping any that would then overlap. |
| `scripts/dev-ids.ts` | Prints seeded building ids by artifact type. |
| `scripts/shot.ts` | Screenshots a route. |
| `scripts/import-hosted.ts` | `npm run import:hosted`: copies a city from the hosted project into the app. |
| `scripts/check-*.ts` | The browser check suites. |

---

## Troubleshooting

**Burg.app opens and immediately disappears.** Read
`~/Library/Logs/Burg/server.log`. If the log was not rewritten at all, the
shell itself did not start — run
`/Applications/Burg.app/Contents/MacOS/Burg` from a terminal to see why. If
the log ends in an error, the server could not open the data folder; the app
says so in a dialog, too.

**`npm run desktop` opens nothing and prints a Node error about `electron`
exports.** `ELECTRON_RUN_AS_NODE` is set in your terminal (editor terminals set
it). The npm script unsets it; if you run `electron` yourself, prefix
`env -u ELECTRON_RUN_AS_NODE`.

**The database will not open, or loses writes.** Two processes opened the
same data directory — usually two dev servers in one checkout, or a dev server
started with `BURG_DATA_DIR` pointing at the app's folder while the app was
open. PGlite expects to be the only process using its directory, and nothing
here stops a second one. Stop both, and
never point the dev server at the app's folder while Burg is running.

**Check scripts fail with "could not read the dev database".** `npm run dev`
is not running, or is on another port: set `BURG_URL`.

**Building ids in the check scripts 404.** Re-seeding assigns new ids. Get
current ones with `npx tsx scripts/dev-ids.ts`.

**Link previews in the Newsstand show only the address.** Fetching a page's
title and image is the one thing Burg does on the network, and it needs the
network. Offline, links still save; they just have no preview.
