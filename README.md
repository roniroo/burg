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
| `lib/plan.ts` | The free caps and what a subscription status entitles. Mirrored by the `plans` migration, which is where it is enforced. |
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

## Plans

Collaboration is the paid feature. The free plan is a city of your own; paying
is what lets other people into it, and lifts the two caps on the deliberate
acts.

| | Free | Paid — $8/month |
|---|---|---|
| Districts | 5 | unlimited |
| Buildings | 50 | unlimited |
| Anything *inside* a building | uncapped | uncapped |
| Collaborators | — | editors and viewers |

`/plan` shows the city's usage against its caps, reads the price from Stripe
rather than repeating it, and hands off to Stripe Checkout and the Billing
Portal — no card detail ever reaches this server.

The numbers live in `lib/plan.ts` for the app and in the `plans` migration for
the database, which is the only place they are enforced;
`scripts/check-plan.ts` asserts the two agree, so the duplication cannot rot
quietly.

### Why this shape

**Size is the wrong thing to meter.** The fully seeded demo city — 3 districts,
8 buildings, 12 table rows, 11 notes — is **3.4 KB** of content. Supabase's free
tier is 500 MB, so that is room for roughly 150,000 cities before storage costs
anything. Hosting is about $7/month for Render plus $25 when Supabase Pro
becomes necessary, so **four subscribers cover the infrastructure at any
plausible data volume** — which is where the $8 comes from. A size cap would not
be recovering costs; it would be manufacturing scarcity in a product whose whole
appeal is a city that looks inhabited. Capping someone at ten buildings makes
the map look like a failed settlement.

**The lever worth pulling is collaboration.** People pay for "my collaborator
can see this" far more reliably than for "more rows in my own notes".

**Never cap what is inside a building.** Table rows, note length and canvas
nodes accrue invisibly while someone is mid-thought, and hitting that wall
feels like a bug rather than a pricing decision. Only the deliberate acts are
metered: founding a district, raising a building. Fifty because the seed alone
is eight, a district holds about 48 lots, and 50 is where someone has stopped
trying Burg and started depending on it. Below about 25 you are taxing
evaluation.

**A lapse never evicts anybody.** Somebody who can already read a city keeps
reading it; what stops is new people arriving. Revoking access to data people
rely on because a card expired is data loss with a billing excuse. `past_due`
still counts as paid for the same reason — Stripe is still retrying, and the
card usually just needs updating.

"Cities: 1 free, unlimited paid" is **not** implemented. One city per user is
assumed in several places, so it is real work rather than a flag, and shipping
a cap for a thing that does not exist yet would be a lie in the UI.

There is also a `comped` status: the paid plan with no Stripe objects behind
it, set by hand for the accounts that should not be billed.

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
| **Billing** | Stripe — one product, one monthly price, one webhook |
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

**Billing changed one deployment invariant.** `SUPABASE_SERVICE_ROLE_KEY` used
to be deliberately absent from the web service, because the app never needed it
at runtime. It does now: Stripe is not a signed-in user, so writing somebody's
subscription row is necessarily a cross-RLS write, and `public.subscriptions`
has no insert or update policy precisely so that a browser holding the anon key
cannot grant itself the paid plan. The webhook and the read-time resync are the
only runtime uses — see *Billing* in [DEV.md](DEV.md). Without the key, billing
is the only thing that breaks; the rest of the app never asks for it.

Setting it up again from scratch would need `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the Render dashboard — they are baked
into the client bundle at build time, so they must be present during the build,
not only at runtime — and the deployed origin added to Supabase under
**Authentication → URL Configuration** as both the Site URL and a redirect URL.
Nothing else pins the origin; the app derives it from the incoming request, so
that allow list is the one place a deploy can get auth wrong.
