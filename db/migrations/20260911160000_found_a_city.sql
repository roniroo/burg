-- Founding a city from inside the app.
--
-- `seedIdeaburg` inserts the city, then the owner's membership, and its comment
-- claims "the insert order satisfies RLS at every step, so no service-role key
-- is required". That was never true. The membership insert has always been
-- refused with 42501, and the path is only exercised as the signed-in user by
-- `ensureCity`; `scripts/seed.ts` runs the same function with the service role,
-- which bypasses RLS. Every city that exists was made by the script, so the
-- broken path stayed hidden -- helped by `ensureCity` swallowing seed errors,
-- deliberately, because a failed seed must not block sign-in. A brand-new user
-- signed in fine and landed on "No city yet".
--
-- Two layers had to be crossed, and only the first is obvious:
--
--   1. `city_members_owner_write` asks `burg.is_city_owner(city_id)`, which
--      reads `city_members`. At founding that table has no row yet, so it is
--      false. (Before `20260911120000_collaboration.sql` this policy tested
--      `cities.owner_id` directly, which failed for reason 2 instead.)
--
--   2. A policy expression runs as the querying user, so a subquery against
--      another table gets that table's RLS too. `cities_select` is
--      `burg.is_city_member(id)` and has been since the foundation, so the
--      city row a founder just inserted is invisible to them until the
--      membership exists. Testing `cities.owner_id` from inside a policy on
--      `city_members` therefore cannot work, however it is written -- which is
--      why restoring the original predicate does not fix this.
--
-- Hence a SECURITY DEFINER helper, for the same reason `is_city_member` is one:
-- it has to read a table whose own policy would otherwise hide the answer.
--
-- `cities.owner_id` is the right authority for this one insert. `cities_insert`
-- only ever admits a row whose `owner_id` is the caller, so a city cannot
-- arrive claiming somebody else owns it. Managing *other* people stays with
-- `burg.is_city_owner`, i.e. membership -- that is what a transfer of ownership
-- would move, and it must not be reachable from here.
--
-- The stronger alternative is an `after insert on cities` trigger that adds the
-- membership itself, making "every city has an owner member" structural rather
-- than merely permitted. It is the better invariant and it is not taken here:
-- it would make `seedIdeaburg`'s own membership insert a duplicate-key failure,
-- so it needs an app change alongside a live schema change. Worth doing on its
-- own, deliberately.

create or replace function burg.owns_city_row(target_city uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.cities c
    where c.id = target_city
      and c.owner_id = (select auth.uid())
  );
$$;

grant execute on function burg.owns_city_row(uuid) to authenticated, anon, service_role;

-- Superseded within this migration: the first attempt tested `cities` inline
-- and was defeated by layer 2 above.
drop policy if exists city_members_found on public.city_members;

create policy city_members_found on public.city_members for insert
  with check (
    -- Yourself only, as owner only, and only for a city that says it is yours.
    user_id = (select auth.uid())
    and role = 'owner'
    and burg.owns_city_row(city_id)
  );
