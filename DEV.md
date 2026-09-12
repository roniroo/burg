# Running Burg locally

Burg is one Next.js app plus a Supabase project (Postgres, Auth, Storage). You
can run it two ways:

| | Backend | Use when |
|---|---|---|
| **A. Fully local** | Supabase CLI stack in Docker | Normal development. Free, offline, destroy and recreate at will. |
| **B. Hosted** | The shared `burg` Supabase project | Checking behaviour against real data, or when Docker is unavailable. |

Path A is the default and the one this document leads with.

> **Not yet executed end-to-end.** The Docker setup below was written and
> reviewed but never run on the machine that authored it — Docker was not
> installed there. Expect to hit at least one rough edge on first run; the
> troubleshooting section covers the likely ones.

---

## Prerequisites

- **Docker Desktop** (or any Docker with Compose v2), running.
- **Node 20+** — only needed for the host-side helper commands.
- **Supabase CLI** — `brew install supabase/tap/supabase`.

---

## A. Fully local

### 1. Start the backend

```bash
npm run db:start      # supabase start
```

First run pulls several images and takes a few minutes. It brings up Postgres,
Auth, Storage, Realtime and Studio, then applies every migration in
`supabase/migrations/` in order.

When it finishes it prints the local URLs and keys:

| Service | URL |
|---|---|
| API | http://127.0.0.1:54321 |
| Studio (table browser) | http://127.0.0.1:54323 |
| Inbucket (catches all outgoing email) | http://127.0.0.1:54324 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

### 2. Capture the local keys

```bash
npm run docker:env
```

Writes `.env.docker` (gitignored) with the local stack's anon and service-role
keys. These are the CLI's fixed development credentials — identical on every
machine, not secrets.

### 3. Start the app

```bash
npm run docker:up     # docker compose up --build
```

Then open **http://localhost:3000**. Source is bind-mounted, so edits hot-reload.

### 4. Sign in

Burg is **invite-only**: `enable_signup` is off, so the Create account form
refuses and says so. Make yourself an account through the seeder instead, which
uses the admin API and is unaffected:

```bash
npm run seed -- you@example.com --create
```

Then sign in with the password it prints. Your city is seeded on first sign-in.

Password is the primary way in. There are two other options, both with caveats
worth knowing:

- **Email me a link.** Magic links work, but a link only signs you in *in the
  browser that asked for it* — the PKCE proof is held there. Opening it on your
  phone gives "code verifier not found". Against the hosted project, Supabase's
  built-in mail server also allows only a few messages an hour. Locally, mail
  never leaves your machine: it lands in Inbucket at http://127.0.0.1:54324.
- **Continue with Google.** Needs the provider configured in Supabase.

Email confirmation is switched **on**, and public signup is **off**. The two go
together: confirmation was disabled while anyone could sign up, because the
built-in mail server allows only two messages an hour and a confirmation step
made signup a coin flip. With signup closed nobody is waiting on that email, and
confirmation being on means reopening signup later cannot hand out accounts for
addresses nobody owns. **Configure real SMTP before reopening signup.**

Both settings live in `supabase/config.toml` as well, matching the hosted
project, so a stray `supabase config push` cannot silently reopen the door.

### 5. Reset when you want a clean slate

```bash
npm run db:reset      # drops, recreates, replays every migration
npm run seed -- you@example.com --create
```

To clear a city without touching the database, use the app: **Directory →
Start fresh** demolishes every building, or every building and district, once
you type the city's name. Piece by piece, the map's **Demolish** mode takes
both — click a building to condemn it, or a district's open ground to condemn
the district — and a building also comes down from the button beside its
interior's breadcrumb, or from the Directory. A district can be dissolved from
its own page or the Directory too.

`npm run db:stop` shuts the stack down; data survives until `db:reset`.

---

## B. Against the hosted project

No Docker needed.

```bash
cp .env.example .env.local
```

Fill in from the Supabase dashboard
(`Project Settings → API keys`, project `ybquniffzetaylkrkadz`):

```
NEXT_PUBLIC_SUPABASE_URL=https://ybquniffzetaylkrkadz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=...        # only needed for the CLI seeder
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then:

```bash
npm install
npm run dev
```

Magic-link emails are really sent, to a real inbox.

---

## Testing

### Unit tests

Pure modules only — projection maths, the table model, document flattening.
No database, no browser, no network.

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

These drive a real Chromium against a running dev server and assert on
behaviour: keyboard navigation, the zoom ladder, pixel snapping, autosave,
the suggestion menus, link-to-road reconciliation, and accessibility.

They need two things: the app running, and a session cookie.

```bash
# 1. app running (either path above)
npm run dev

# 2. mint a session cookie for a seeded user
npx tsx scripts/dev-session.ts you@example.com > /tmp/burg-cookie.txt

# 3. run everything
npm run check
```

`npm run check` reseeds the demo city first, because several suites consume
seeded data — promotion turns a note into a building, for one. It is
destructive to the demo city and nothing else: the reseed and every suite are
scoped to `seedtest@burg.local`.

**No suite sleeps.** There is not a single `waitForTimeout` left in
`scripts/check-*.ts`, and adding one back is how a suite starts failing for
reasons that have nothing to do with the code under test. A duration long
enough on an idle laptop is not long enough when a dev server, a production
build and fifteen suites are competing for the same cores. `scripts/until.ts`
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

**The cookie is re-minted mid-run, and it has to be.** Changing a password
revokes every refresh token for that user, and `check-legal` deliberately
changes the smoke user's password to exercise the reset flow — then changes it
back, revoking them a second time. Without a re-mint, every cookie-driven suite
after it drives a **signed-out** browser: the pages 307 to `/sign-in`, so the
assertions report "0 rows" or an empty selector rather than anything that looks
like an auth problem, and the suites that open with a `page.fill` throw and
print nothing at all. If a run goes quiet after *legal*, this is why.

That scoping is load-bearing, not tidiness. The hosted project holds a real
city alongside the smoke-test one, and an unscoped `admin.from(...)` reaches
both: `.eq("slug", "harbor-district").single()` matches two rows and throws, a
bare `count` totals someone else's buildings into an assertion, and
`check-roads` used to mark **every** route on the project stale — including a
real city's, which nothing then re-solves, because only an open map drains
that queue. Suites resolve their city through `scripts/smoke-city.ts` and
filter by the id it returns. Any new suite must do the same.

Individual suites:

```bash
npx tsx scripts/check-map.ts                    # camera, keyboard, zoom ladder
npx tsx scripts/check-doc.ts <doc-id>           # editor, autosave, [[links]]
npx tsx scripts/check-newsstand.ts <kiosk-id>   # link rack + OpenGraph fetch
npx tsx scripts/check-warehouse.ts <table-id>   # grid, views, row panel, paste
npx tsx scripts/check-board.ts <board-id>       # notes, modes, promotion
npx tsx scripts/check-build.ts                  # build mode, districts, regions
npx tsx scripts/check-roads.ts                  # solving, gates, LOD, paving
npx tsx scripts/check-life.ts                   # day/night, ticker, ⌘K
npx tsx scripts/check-auth.ts                   # password, sign out, link shapes,
                                                #   closed signup, invited accounts
npx tsx scripts/check-studio.ts                 # whiteboard tools and saving
npx tsx scripts/check-a11y.ts                   # axe, normal + reduced motion
npx tsx scripts/check-demolish.ts               # demolish, dissolve, start fresh
npx tsx scripts/check-legal.ts                  # terms, privacy, password reset
npx tsx scripts/check-members.ts                # invitations, roles, what each may do
```

`check-demolish.ts` runs last in `npm run check` and leaves the demo city
empty, because that is what it is testing. Reseed afterwards with
`npm run seed -- seedtest@burg.local`. It is scoped to one account, so a real
city on the same project is never touched.

A browser check that fails an assertion still exits 0 — the PASS/FAIL lines are
the source of truth, not the exit code.

`npx tsx scripts/dev-ids.ts` prints the seeded building ids by type.

### Screenshots

```bash
npx tsx scripts/shot.ts /city city.png
npx tsx scripts/shot.ts /city city-rm.png --reduced-motion
```

Output lands in `scripts/shots/` (gitignored).

### Sharing a city

Three roles, and they are enforced by RLS rather than by the UI:

| | reads | builds and demolishes | manages people | deletes the city |
|---|---|---|---|---|
| `owner` | ✓ | ✓ | ✓ | ✓ |
| `editor` | ✓ | ✓ | | |
| `viewer` | ✓ | | | |

`city_members` and the `city_role` enum existed from the foundation, but until
`20260911120000_collaboration.sql` **nothing enforced the role** — every policy
asked `burg.is_city_member`, so a viewer could demolish a district. Writes now
go through `burg.can_edit_city` and people-management through
`burg.is_city_owner`.

Hiding a button is a courtesy; the policy is the boundary. `check-members.ts`
asserts against the database with a really-signed-in client, not against the
UI, because a test that only checked the button would pass just as happily if
the policies were missing.

**RLS does not raise on a refused UPDATE or DELETE.** The row is filtered out
of the statement's view, so it matches nothing and reports success having
changed nothing. Assert on the row's state afterwards, never on whether the
client saw an error.

Invitations are addressed to an **email**, not a user id, because the app
cannot look a user up by address — that needs the service role, which the
request-scoped client never has — and because the person may have no account
yet. `claimInvites()` runs from `ensureCity()` on every sign-in and
turns any invite for that address into membership. Since signup is closed,
someone invited still needs an account made for them with
`npm run seed -- <email> --create`.

### Plans and billing

Collaboration is the paid feature; the caps are 5 districts and 50 buildings.
The reasoning is in the README — this is how to work on it.

```bash
# One sandbox, once. Prints keys; claim it before it expires (7 days).
stripe sandbox create --from-git
stripe sandbox claim

# .env.local
STRIPE_SECRET_KEY=...          # the sandbox's secret key
STRIPE_PRICE_ID=price_...      # the monthly price
STRIPE_WEBHOOK_SECRET=whsec_...   # printed by `stripe listen`, below

# Events, while you work. Leave it running.
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Creating the product and price, if starting from nothing:

```bash
stripe products create --name "Burg" \
  --description "Unlimited districts and buildings, and people to share the city with."
stripe prices create --product prod_... --unit-amount 800 --currency usd \
  -d "recurring[interval]=month"
```

**Two things keep `public.subscriptions` honest, and the overlap is deliberate:**

| | |
|---|---|
| the webhook | Stripe tells us the moment anything changes. |
| `syncUser` | `/plan` re-reads Stripe when it renders, so the state is right on the screen where it matters even if a webhook was missed, never configured, or arrived out of order. |

Both write from a **fresh read of Stripe** rather than from the event payload,
because delivery is not ordered — a stale `customer.subscription.updated` can
land after the `deleted` that superseded it. This is not theoretical: during
the build the `stripe listen` session reconnected and dropped the checkout
events entirely, and the row was correct anyway because `/plan?checkout=done`
resynced it.

**The webhook needs `SUPABASE_SERVICE_ROLE_KEY`, and this is new.** It used to
be absent from the web service on purpose. Stripe is not a signed-in user, so
writing somebody's subscription row is necessarily a cross-RLS write; and
`public.subscriptions` deliberately has **no insert or update policy**, because
a user who could write their own row would just set `status = 'active'` through
PostgREST and take the paid plan for free. `check-plan.ts` asserts exactly
that. So billing is the one runtime consumer of the key — nothing else in the
app asks for it, and without it billing is the only thing that breaks.

The rejected alternative, recorded so the reasoning is not lost: a
`SECURITY DEFINER` function guarded by its own secret, so a leak grants a free
subscription rather than the whole database. Genuinely a narrower blast radius,
and not taken — it needs a second secret managed outside migrations to guard
the one thing the first secret would be used for, and "the webhook writes with
the service role" is the shape a reviewer can check at a glance.

**The period end is on the subscription *item*, not the subscription.** Recent
API versions moved it; reading `subscription.current_period_end` silently gives
`undefined`, which is how a "renews on" line quietly goes blank. See
`periodEnd()` in `lib/billing.ts`.

Statuses that entitle: `active`, `trialing`, `past_due`, and Burg's own
`comped`. `past_due` is on the list because Stripe is still retrying, and
taking a city's collaborators away over a card that needs updating punishes the
wrong thing.

To comp an account — the paid plan with no Stripe objects behind it:

```sql
insert into public.subscriptions (user_id, status)
select id, 'comped' from auth.users where email = 'them@example.com'
on conflict (user_id) do update set status = 'comped', updated_at = now();
```

`veronica.leigh.head@gmail.com` is comped, so the real city is not boxed in by
its own pricing experiment. `seedtest@burg.local` is left on a real
subscription, which is what the browser checks run against.

Testing a card: `4242 4242 4242 4242`, any future expiry, any CVC. Untick
**Save my information for faster checkout** on Stripe's page first — leaving it
on makes the phone number required and the submit silently fails validation.

`check-plan.ts` proves the caps and the gate against the database: it builds a
throwaway city, fills it to exactly 50 buildings and 5 districts, and asserts
the next insert is refused by the trigger. It uses a scratch city rather than
the demo one precisely because proving the building boundary means inserting 50
of them. Note the triggers fire for the service role too — RLS is bypassed by
it, triggers are not — which is why those assertions can use `admin` and still
be testing the real boundary.

### The public pages

`/terms` and `/privacy` are rendered from `docs/terms.md` and
`docs/private-policy.md` at request time, and they are in the middleware's
`PUBLIC_PATHS` — someone has to be able to read the terms before agreeing to
them, and a privacy policy behind a login is not a privacy policy.

`lib/markdown.ts` reads them. It is a deliberately small parser covering only
what those two files use, and it returns **typed blocks rather than an HTML
string**, so the renderer sets every string through React and there is no
`dangerouslySetInnerHTML` anywhere. Both the unit tests and `check-legal.ts`
assert that the rendered page contains exactly as many words as the source
file: a legal page that quietly drops a clause is the failure that matters.

Editing a policy is editing the Markdown — a reviewed commit with a diff and a
date, which is what "Last updated" on a policy page is supposed to mean.

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
  Reduce motion* (macOS) and reload. Ambient motion stops and entering a
  building becomes an instant cut.
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

---

## Dev helper scripts

| Script | What it does |
|---|---|
| `scripts/seed.ts` | Seeds "Ideaburg". Idempotent; `--create` makes the user too. |
| `scripts/dev-reset.ts` | Deletes one account's city so the seed can run clean, defaulting to `seedtest@burg.local`. **Destructive**; `--all` takes every city on the project, real ones included. |
| `scripts/smoke-city.ts` | Not a script — the module every check suite imports to resolve which city it may touch. |
| `scripts/dev-footprints.ts` | Reports buildings whose stored footprint has drifted from the shape their sprite recipe is drawn for; `--fix` writes the recipe's shape back, skipping any that would then overlap. |
| `scripts/dev-session.ts` | Mints a browser session cookie for the check scripts. |
| `scripts/dev-ids.ts` | Prints seeded building ids by artifact type. |
| `scripts/shot.ts` | Screenshots a route as a signed-in user. |
| `scripts/check-*.ts` | The browser check suites. |

All of them read `.env.local` and need `SUPABASE_SERVICE_ROLE_KEY`.

---

## Production

Burg is live at **https://burg-30n7.onrender.com**.

| | |
|---|---|
| Service | Render web service `burg`, id `srv-dahka42d0e5s73foab9g` |
| Dashboard | https://dashboard.render.com/web/srv-dahka42d0e5s73foab9g |
| Workspace | "Get A Head" (`tea-d8u80gtaeets738mt85g`) |
| Runtime | Node 22, Oregon, `starter` plan |
| Build / start | `npm ci && npm run build` → `npm run start`, health check `/sign-in` |
| Source | `github.com/roniroo/burg`, branch `main`, auto-deploy on |
| Data | Supabase `ybquniffzetaylkrkadz` — the same project local dev talks to |

Render assigned the `-30n7` suffix; the host is **not** `burg.onrender.com`.

### Deploying

Push to `main`. That is the whole procedure — Render builds and swaps in the new
version, usually in about two minutes. Nothing gates the push: there is no CI,
so `npm run check` is a thing you choose to run first.

Watch it, or roll back, from the dashboard above, or from the CLI:

```bash
# The CLI refreshes an expired token on first use; no `render login` needed.
render deploys list srv-dahka42d0e5s73foab9g --output json --confirm
render logs --resources srv-dahka42d0e5s73foab9g --limit 50 --confirm
render logs --resources srv-dahka42d0e5s73foab9g --tail --confirm   # follow
```

A rollback is redeploying an earlier commit from the dashboard's Deploys tab.

### A deploy does not touch the database

The build only builds the Next app. A new file in `supabase/migrations/` ships
its **code** and not its **schema**, and the mismatch shows up as a runtime
error against a table or constraint that is not there yet. Apply the migration
first — see *Database changes* below — then push.

This has already bitten once: the sprite work needed `floors` to allow four
storeys, and the seed failed outright until the constraint was widened on the
hosted project by hand.

### Production is the same database as local dev

`.env.local` points at `ybquniffzetaylkrkadz`, so unless you are running the
Docker stack, **your dev server is writing to the same Postgres the live site
uses**. That is why every check suite is scoped to `seedtest@burg.local` — see
the note under *Browser checks*. Nothing stops a stray script from reaching the
real city except that scoping.

---

## Supabase project settings

`supabase/config.toml` is **not** the source of truth for the hosted project —
the project was created before the file existed. `supabase config push`
overwrites the remote auth config with everything in that file, and it applies
immediately whether or not you confirm the diff it prints. It has already done
that once here: it moved `site_url` to 127.0.0.1, wiped the redirect allow
list, disabled MFA and mangled the SMS templates, all of which had to be put
back by hand.

Change one setting at a time through the dashboard, or with the Management API:

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)   # macOS keychain
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mailer_autoconfirm": true}' \
  https://api.supabase.com/v1/projects/ybquniffzetaylkrkadz/config/auth
```

config.toml has since been aligned with the hosted project so a stray push is
less destructive, but it is still not a command to reach for casually.

## Database changes

Migrations are plain SQL in `supabase/migrations/`, named with the timestamp
convention the CLI expects. To add one:

```bash
supabase migration new my_change      # creates the file
# edit it, then:
npm run db:reset                      # replay everything locally
npm run types:gen                     # regenerate lib/database.types.ts
```

To apply to the hosted project — remember a deploy will not do this for you:

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
        supabase/migrations/<file>.sql)" \
  https://api.supabase.com/v1/projects/ybquniffzetaylkrkadz/database/query
```

That is one statement batch against the live database, and it is how
`20260910153000_taller_buildings.sql` was applied. It returns `[]` on success;
re-read the affected object afterwards to confirm.

`supabase link --project-ref ybquniffzetaylkrkadz && supabase db push` is the
supported route and does the same job, but the project was created before it
was ever linked, so its migration history table does not know about the
migrations already applied — a push would try to replay them and fail on
objects that exist. Link and repair the history first if you want to use it.
Either way, write the migration file too: it is the record of the schema, even
when it was not the thing that ran.

**Never edit `lib/database.types.ts` by hand** — it is generated.

---

## Troubleshooting

**`supabase start` fails or hangs.** Docker Desktop is not running, or ports
54321–54324 are taken. `supabase stop --no-backup` then retry.

**Compose can't reach Supabase.** The app talks to `host.docker.internal:54321`.
On Linux that name needs the `extra_hosts` entry in `docker-compose.yml` (it is
there) and a reasonably recent Docker. Verify from inside the container:

```bash
docker compose exec web curl -s http://host.docker.internal:54321/rest/v1/ | head
```

**Edits don't hot-reload.** Bind-mount file events don't cross the VM boundary
on macOS and Windows, which is why `WATCHPACK_POLLING=true` is set. If it still
misses changes, restart the container.

**"Invalid API key".** `.env.docker` is stale — `supabase start` regenerates
keys after a `db:reset` in some versions. Re-run `npm run docker:env` and
restart compose.

**Magic link goes nowhere.** On the local stack, mail never leaves the machine.
Open Inbucket at http://127.0.0.1:54324.

**Check scripts fail with a redirect to /sign-in.** The cookie in
`/tmp/burg-cookie.txt` has expired. Re-run `scripts/dev-session.ts`.

**Building ids in the check scripts 404.** Re-seeding assigns new ids. Get
current ones with `npx tsx scripts/dev-ids.ts`.
