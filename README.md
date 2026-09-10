# Burg

A wiki-and-database workspace wearing an isometric pixel city.

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

## Design rules

8px grid · zero border-radius · zero blur · zero gradients except the sky ·
hard 2px offset shadows · integer zoom steps so pixel art never resamples ·
every transform rounded to whole pixels · stepped easing for anything
sprite-like · and a readable face for every paragraph, because a wiki you
cannot read is a toy.

Everything that loops stops under `prefers-reduced-motion` and when the tab is
hidden.

## Deploying

`render.yaml` describes the service. Set the four environment variables in the
Render dashboard, and add the deployed origin to Supabase under
**Authentication → URL Configuration → Redirect URLs**, or magic links will
bounce.
