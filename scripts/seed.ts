/**
 * Seed the demo city into the dev database: `npm run seed`
 *
 * Requires `npm run dev`, and reaches the database through it (see
 * local-db.ts). Idempotent -- re-running is a no-op once Ideaburg exists. The
 * dev server founds Ideaburg by itself the first time it opens an empty
 * database; this is for after `scripts/dev-reset.ts` has cleared it.
 */
import { seedIdeaburg } from "../lib/seed/ideaburg";
import { admin } from "./local-db";

// The owner is the one person in the database; the earliest profile is theirs,
// for the same reason `auth.uid()` picks the earliest user.
const { data: owner, error } = await admin
  .from("profiles")
  .select("id")
  .order("created_at")
  .limit(1)
  .maybeSingle();

if (error || !owner) {
  console.error(
    error
      ? `Could not reach the dev database: ${error.message}\nIs npm run dev running?`
      : "The dev database has no owner yet. Load http://localhost:3000 once, then re-run.",
  );
  process.exit(1);
}

const result = await seedIdeaburg(admin, owner.id);
console.log(
  result.created
    ? `Seeded Ideaburg (${result.cityId}).`
    : `Ideaburg already exists (${result.cityId}); nothing to do.`,
);
