#!/usr/bin/env bash
# Full verification pass.
#
# Requires `npm run dev` on :3000. DESTRUCTIVE: reseeds the demo city so the
# browser checks start from a known state -- several of them consume seeded
# data (promotion turns a note into a building, for one).
#
# Read the PASS/FAIL lines: a browser check that fails an assertion still
# exits 0, so the lines are the source of truth, not the exit code.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
step() { printf '\n=== %s ===\n' "$1"; }

step "unit tests"; npx vitest run   || fail=1
step "typecheck";  npx tsc --noEmit || fail=1
step "lint";       npx eslint .     || fail=1
step "build";      npm run build 2>&1 | grep -E "Compiled|Failed|error" || fail=1

step "reseed"
npx tsx scripts/dev-reset.ts seedtest@burg.local >/dev/null 2>&1
npm run seed -- seedtest@burg.local --create 2>&1 | grep -E "Seeded|Created" || fail=1
npx tsx scripts/dev-session.ts seedtest@burg.local || fail=1

ids=$(npx tsx scripts/dev-ids.ts 2>/dev/null | grep -v '^◇')
doc=$(echo   "$ids" | grep 'Launch Brief'      | cut -f2)
kiosk=$(echo "$ids" | grep 'References'        | cut -f2)
table=$(echo "$ids" | grep 'Roadmap'           | cut -f2)
board=$(echo "$ids" | grep 'Harbor Plaza'      | cut -f2)

# These two are first because they are the only suites that sign other accounts
# in and out, and check-legal deliberately changes the smoke user's password to
# exercise the reset flow.
step "auth";       npx tsx scripts/check-auth.ts                2>&1 | grep -E '^(PASS|FAIL)|page error'
step "legal";      npx tsx scripts/check-legal.ts               2>&1 | grep -E '^(PASS|FAIL)|page error'

# Re-mint the cookie. Not belt-and-braces: changing a password revokes every
# refresh token for that user, so the cookie minted during the reseed is dead
# the moment check-legal tests the reset flow -- and it restores the password
# afterwards, which revokes them a second time. Every cookie-driven suite below
# was silently failing on a signed-out browser, which looks like "0 rows" or an
# empty selector rather than like an auth problem.
step "re-mint cookie"; npx tsx scripts/dev-session.ts seedtest@burg.local || fail=1

step "members";    npx tsx scripts/check-members.ts             2>&1 | grep -E '^(PASS|FAIL)|page error'
step "map";        npx tsx scripts/check-map.ts                 2>&1 | grep -E '^(PASS|FAIL)|page error'
step "newsstand";  npx tsx scripts/check-newsstand.ts "$kiosk"  2>&1 | grep -E '^(PASS|FAIL)|page error'
step "document";   npx tsx scripts/check-doc.ts "$doc"          2>&1 | grep -E '^(PASS|FAIL)|page error'
step "warehouse";  npx tsx scripts/check-warehouse.ts "$table"  2>&1 | grep -E '^(PASS|FAIL)|page error'
step "board";      npx tsx scripts/check-board.ts "$board"      2>&1 | grep -E '^(PASS|FAIL)|page error'
step "build mode"; npx tsx scripts/check-build.ts               2>&1 | grep -E '^(PASS|FAIL)|page error'
step "roads";      npx tsx scripts/check-roads.ts               2>&1 | grep -E '^(PASS|FAIL)|page error'
step "life";       npx tsx scripts/check-life.ts                2>&1 | grep -E '^(PASS|FAIL)|page error'
step "studio";     npx tsx scripts/check-studio.ts              2>&1 | grep -E '^(PASS|FAIL)|page error'
step "a11y";       npx tsx scripts/check-a11y.ts                2>&1 | grep -E '^(PASS|FAIL)'
# Last: it empties the demo city, which every suite above needs.
step "demolish";   npx tsx scripts/check-demolish.ts            2>&1 | grep -E '^(PASS|FAIL)|page error'

printf '\n'
if [ "$fail" -eq 0 ]; then
  echo "Static checks passed. Review the PASS/FAIL lines above for the browser suites."
else
  echo "A static check failed."
  exit 1
fi
