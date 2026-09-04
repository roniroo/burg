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
npx tsx scripts/dev-reset.ts >/dev/null 2>&1
npm run seed -- seedtest@burg.local --create 2>&1 | grep -E "Seeded|Created" || fail=1
npx tsx scripts/dev-session.ts seedtest@burg.local || fail=1

ids=$(npx tsx scripts/dev-ids.ts 2>/dev/null | grep -v '^◇')
doc=$(echo   "$ids" | grep 'Launch Brief'      | cut -f2)
kiosk=$(echo "$ids" | grep 'References'        | cut -f2)
table=$(echo "$ids" | grep 'Roadmap'           | cut -f2)
board=$(echo "$ids" | grep 'Harbor Plaza'      | cut -f2)

step "map";        npx tsx scripts/check-map.ts                 2>&1 | grep -E '^(PASS|FAIL)|page error'
step "newsstand";  npx tsx scripts/check-newsstand.ts "$kiosk"  2>&1 | grep -E '^(PASS|FAIL)|page error'
step "document";   npx tsx scripts/check-doc.ts "$doc"          2>&1 | grep -E '^(PASS|FAIL)|page error'
step "warehouse";  npx tsx scripts/check-warehouse.ts "$table"  2>&1 | grep -E '^(PASS|FAIL)|page error'
step "board";      npx tsx scripts/check-board.ts "$board"      2>&1 | grep -E '^(PASS|FAIL)|page error'
step "build mode"; npx tsx scripts/check-build.ts               2>&1 | grep -E '^(PASS|FAIL)|page error'
step "a11y";       npx tsx scripts/check-a11y.ts                2>&1 | grep -E '^(PASS|FAIL)'

printf '\n'
if [ "$fail" -eq 0 ]; then
  echo "Static checks passed. Review the PASS/FAIL lines above for the browser suites."
else
  echo "A static check failed."
  exit 1
fi
