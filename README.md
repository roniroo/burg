# Burg

A wiki-and-database workspace wearing an isometric pixel city.

A Mac app that keeps everything on your Mac: no account, no server, no
subscription.

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

Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript strict · PGlite
(Postgres in WebAssembly, in-process) · Electron · TipTap 3 · TanStack Virtual ·
motion 13 · anime.js 4 · Vitest · Playwright.

One app: the Next.js server and its database run inside Burg.app, and the
window talks to them over loopback. Your city is a directory in
`~/Library/Application Support/Burg`.

## Getting started

```bash
npm install
npm run dev               # http://localhost:3000, with its own dev database
npm run desktop:package   # dist-desktop/Burg-<version>-arm64.dmg
```

See **[DEV.md](DEV.md)** for the database, the desktop app, backups, and the
test suites.

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
| `lib/custom-sprites.ts` | Sprites you upload: how a PNG sits on its lot, and the outline of its painted pixels that takes the clicks. |
| `lib/props.ts` | Street furniture, scattered as a pure function of the tile rather than stored. |
| `lib/db/` | The database: PGlite, the migration runner, and a PostgREST for one person that the app's postgrest-js queries are answered by. |
| `db/migrations/` | Schema, triggers, full-text search. Applied by the app itself on launch. |
| `desktop/` | The Electron shell: starts the server, opens the window, closes the database on quit. |
| `scripts/check-*.ts` | Browser check suites (see DEV.md). |

Those `lib/` modules are pure — no React, no DOM, no database — which is why
they carry the unit tests. Components import them; components never re-derive
the maths.

## What changed when it came home

Burg was a hosted service — Render, Supabase, Stripe — until October 2026, and
that version is preserved at the git tag `hosted-final`. Render and Supabase
were shut down on 2026-10-26, once the real city was safely home. Coming home
took out
everything that only made sense with other people on the other end:

- **Sign-in.** There is one person, so there is nobody to tell apart. The door
  is `proxy.ts`: loopback only, and in the app a per-launch token only the
  app's window holds.
- **Sharing.** Cities were shared through roles enforced by row-level security.
  The tables are still there and the owner's role still decides what the UI
  shows, but there is nobody to invite.
- **Plans.** The free caps — 5 districts, 50 buildings — existed to recover
  hosting costs. With no hosting, all they could still do is stop you building
  your own city, so the `local_only` migration takes them out.

The schema is otherwise exactly the hosted one, and the real city was copied
across row for row before the hosted project went. The script that did it,
`scripts/import-hosted.ts`, was removed once there was nothing left to import
from; it is in the history.

## Design rules

8px grid · zero border-radius · zero blur · zero gradients except the sky ·
hard 2px offset shadows · integer zoom steps so pixel art never resamples ·
every transform rounded to whole pixels · stepped easing for anything
sprite-like · and a readable face for every paragraph, because a wiki you
cannot read is a toy.

Everything that loops stops under `prefers-reduced-motion` and when the tab is
hidden.
