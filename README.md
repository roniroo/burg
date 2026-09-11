# Burg

A wiki-and-database workspace wearing an isometric pixel city.

**Live at [burg-30n7.onrender.com](https://burg-30n7.onrender.com)** — invite-only.

The costume is the information architecture, not decoration. A neighbourhood is
a project, a building is an artifact, and the sprite *is* the type — a library
is a document, a warehouse is a table. Links between artifacts are drawn as
roads, so the shape of the road network is the shape of the knowledge base: you
can see which projects depend on each other from the city zoom, before reading
a single label.

The city is never the only way in. `/directory` reaches everything the map can,
`⌘K` searches all of it, and every building is a real focusable button with an
accessible name.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript strict · Supabase
(Postgres, Auth, Storage, RLS) · TipTap 3 · TanStack Virtual · motion 13 ·
anime.js 4 · Vitest · Playwright.

One deployable: a single Next.js service on Render, plus Supabase.

## Getting started

See **[DEV.md](DEV.md)** — it covers running locally against a Dockerised
Supabase stack or the hosted project, seeding a demo city, and the test suites.

```bash
npm install
npm run db:start      # local Supabase via the CLI
npm run docker:env    # capture its keys
npm run docker:up     # the app
npm run seed -- you@example.com --create
```

## What is where

| Path | |
|---|---|
| `lib/iso.ts` | Tile ↔ screen projection. The only place the maths lives. |
| `lib/roads.ts` | A* road routing, deterministic, with the braiding cost function. |
| `lib/placement.ts` | Lot validity, mirroring the database's exclusion constraint. |
| `lib/table/model.ts` | Data-table cell coercion, filtering, sorting, grouping. |
| `lib/canvas/model.ts` | Whiteboard scene model and its tolerant parser. |
| `lib/daylight.ts` | The day/night cycle as a pure function of the clock. |
| `lib/sprites.ts` | The one typed sprite registry. No component names a sprite. It also owns each building's footprint — see `spriteFootprint`. |
| `lib/props.ts` | Street furniture, scattered as a pure function of the tile rather than stored. |
| `supabase/migrations/` | Schema, RLS, triggers, full-text search. |
| `scripts/check-*.ts` | Browser check suites (see DEV.md). |

Those `lib/` modules are pure — no React, no DOM, no database — which is why
they carry the unit tests. Components import them; components never re-derive
the maths.

## Sharing

A city can be shared. `owner` manages people and can delete the city, `editor`
builds and demolishes, `viewer` reads. The roles are enforced by row-level
security, not by hiding buttons, and the check suite proves it against the
database rather than against the UI.

Invitations go to an email address and are claimed on that person's next
sign-in, so inviting someone who does not have an account yet works — though
signup is closed, so an account has to be made for them.

## On charging for it

Notes from costing this out, kept here so the reasoning is not lost.

**Size is the wrong thing to meter.** The fully seeded demo city — 3 districts,
8 buildings, 12 table rows, 11 notes — is **3.4 KB** of content. Supabase's free
tier is 500 MB, so that is room for roughly 150,000 cities before storage costs
anything. Hosting is about $7/month for Render plus $25 when Supabase Pro
becomes necessary, so **four subscribers cover the infrastructure at any
plausible data volume**. A size cap would not be recovering costs; it would be
manufacturing scarcity in a product whose whole appeal is a city that looks
inhabited. Capping someone at ten buildings makes the map look like a failed
settlement.

**The lever worth pulling is collaboration**, which is why it is built. People
pay for "my collaborator can see this" far more reliably than for "more rows in
my own notes".

If a size tier is wanted anyway, the shape that does least damage:

| | Free | Paid |
|---|---|---|
| Cities | 1 | unlimited |
| Districts | 5 | unlimited |
| Buildings | 50 | unlimited |
| Anything *inside* a building | uncapped | uncapped |
| Collaborators | — | ✓ |

Fifty because the seed alone is eight, a district holds about 48 lots, and 50
is where someone has stopped trying Burg and started depending on it. Below
about 25 you are taxing evaluation.

**Never cap what is inside a building.** Table rows, note length and canvas
nodes accrue invisibly while someone is mid-thought, and hitting that wall
feels like a bug rather than a pricing decision. Cap the deliberate acts:
founding a district, raising a building.

Two caveats. One city per user is currently assumed in places, so "unlimited
cities" is real work rather than a flag. And enforcement belongs in
`createBuilding` and `createNeighborhood`, which already validate centrally —
a plan check goes in beside the placement check.

## Design rules

8px grid · zero border-radius · zero blur · zero gradients except the sky ·
hard 2px offset shadows · integer zoom steps so pixel art never resamples ·
every transform rounded to whole pixels · stepped easing for anything
sprite-like · and a readable face for every paragraph, because a wiki you
cannot read is a toy.

Everything that loops stops under `prefers-reduced-motion` and when the tab is
hidden.

## Where it runs

Two hosted pieces and nothing else:

| | |
|---|---|
| **App** | [burg-30n7.onrender.com](https://burg-30n7.onrender.com) — Render web service `burg` (`srv-dahka42d0e5s73foab9g`), Node, Oregon, starter plan |
| **Data** | Supabase project `ybquniffzetaylkrkadz` — Postgres, Auth, Storage, RLS |
| **Source** | `github.com/roniroo/burg`, branch `main` |

Pushing to `main` deploys: Render watches the branch and runs
`npm ci && npm run build`, then `npm run start`, with `/sign-in` as the health
check. There is no CI in front of it — `npm run check` is a thing you run, not
something that gates the push.

**A deploy does not touch the database.** The build only builds the Next app, so
a new migration in `supabase/migrations/` ships its code and not its schema.
Apply migrations yourself before or alongside the push — see *Database changes*
in [DEV.md](DEV.md).

Invite-only: public signup is off, so accounts are made with
`npm run seed -- <email> --create`, which goes through the admin API.

Setting it up again from scratch would need `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the Render dashboard — they are baked
into the client bundle at build time, so they must be present during the build,
not only at runtime — and the deployed origin added to Supabase under
**Authentication → URL Configuration** as both the Site URL and a redirect URL.
Nothing else pins the origin; the app derives it from the incoming request, so
that allow list is the one place a deploy can get auth wrong.
