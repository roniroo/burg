#!/usr/bin/env bash
# Full verification pass. Requires `npm run dev` on :3000 and a session cookie
# at /tmp/burg-cookie.txt (mint one with scripts/dev-session.ts).
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
step() { printf '\n=== %s ===\n' "$1"; }

step "unit tests";      npx vitest run           || fail=1
step "typecheck";       npx tsc --noEmit         || fail=1
step "lint";            npx eslint .             || fail=1
step "build";           npm run build 2>&1 | grep -E "Compiled|Failed|error" || fail=1

ids=$(npx tsx scripts/dev-ids.ts 2>/dev/null | grep -v '^◇')
doc=$(echo "$ids" | grep 'Launch Brief' | cut -f2)
kiosk=$(echo "$ids" | grep 'References'  | cut -f2)

step "map";        npx tsx scripts/check-map.ts        2>&1 | grep -E '^(PASS|FAIL)|page error' || fail=1
step "newsstand";  npx tsx scripts/check-newsstand.ts "$kiosk" 2>&1 | grep -E '^(PASS|FAIL)|page error' || fail=1
step "document";   npx tsx scripts/check-doc.ts "$doc"  2>&1 | grep -E '^(PASS|FAIL)|page error' || fail=1
step "a11y";       npx tsx scripts/check-a11y.ts       2>&1 | grep -E '^(PASS|FAIL)' || fail=1

printf '\n'
if [ "$fail" -eq 0 ]; then
  echo "All steps ran. Read the PASS/FAIL lines above: a browser check that"
  echo "fails an assertion still exits 0, so the lines are the source of truth."
else
  echo "At least one step exited non-zero."
  exit 1
fi
