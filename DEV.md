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

### 4. Get a city to look at

Create a user and seed the demo city in one step:

```bash
npm run seed -- you@example.com --create
```

Then sign in at http://localhost:3000/sign-in with that address. The magic-link
email will **not** leave your machine — it lands in Inbucket at
http://127.0.0.1:54324. Open it there and click the link.

Alternatively, skip the seeder entirely: sign in with any address, and the app
seeds a fresh city for you on first sign-in.

### 5. Reset when you want a clean slate

```bash
npm run db:reset      # drops, recreates, replays every migration
npm run seed -- you@example.com --create
```

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

Individual suites:

```bash
npx tsx scripts/check-map.ts                    # map interactions
npx tsx scripts/check-doc.ts <doc-building-id>  # editor, autosave, [[links]]
npx tsx scripts/check-newsstand.ts <kiosk-id>   # link rack + OpenGraph fetch
npx tsx scripts/check-a11y.ts                   # axe, normal + reduced motion
```

`npx tsx scripts/dev-ids.ts` prints the seeded building ids by type.

### Screenshots

```bash
npx tsx scripts/shot.ts /city city.png
npx tsx scripts/shot.ts /city city-rm.png --reduced-motion
```

Output lands in `scripts/shots/` (gitignored).

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

---

## Dev helper scripts

| Script | What it does |
|---|---|
| `scripts/seed.ts` | Seeds "Ideaburg". Idempotent; `--create` makes the user too. |
| `scripts/dev-reset.ts` | Deletes demo cities so the seed can run clean. **Destructive.** |
| `scripts/dev-session.ts` | Mints a browser session cookie for the check scripts. |
| `scripts/dev-ids.ts` | Prints seeded building ids by artifact type. |
| `scripts/shot.ts` | Screenshots a route as a signed-in user. |
| `scripts/check-*.ts` | The browser check suites. |

All of them read `.env.local` and need `SUPABASE_SERVICE_ROLE_KEY`.

---

## Database changes

Migrations are plain SQL in `supabase/migrations/`, named with the timestamp
convention the CLI expects. To add one:

```bash
supabase migration new my_change      # creates the file
# edit it, then:
npm run db:reset                      # replay everything locally
npm run types:gen                     # regenerate lib/database.types.ts
```

To apply to the hosted project: `supabase link --project-ref ybquniffzetaylkrkadz`
then `supabase db push`.

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
