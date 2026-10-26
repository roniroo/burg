-- Plans: what a free city may do, and what paying unlocks.
--
-- The shape is the one the README argues for. Size is the wrong thing to meter
-- -- a fully seeded city is 3.4 KB, so a storage cap would be manufacturing
-- scarcity rather than recovering cost -- so what paying buys is other people:
--
--   free   5 districts, 50 buildings, nobody else
--   paid   unlimited districts and buildings, collaborators
--
-- Nothing *inside* a building is ever capped. Table rows, note length and
-- canvas nodes accrue while someone is mid-thought, and hitting a wall there
-- reads as a bug rather than a pricing decision. Only the deliberate acts are
-- metered: founding a district, raising a building.
--
-- "Cities: 1 free, unlimited paid" is in the README's table and is *not* here.
-- One city per user is assumed in several places, so it is real work rather
-- than a flag, and shipping a cap for a thing that does not exist yet would be
-- a lie in the UI.
--
-- The plan belongs to the city's *owner*, not to each member. A collaborator
-- invited into a paid city needs no subscription of their own -- they were
-- invited into somebody else's city, and being billed for reading it would be
-- absurd.

-- --------------------------------------------------------------------------
-- What Stripe told us
-- --------------------------------------------------------------------------
-- Only the server writes this table. There is no insert/update/delete policy,
-- and that absence is the enforcement: a client holding nothing but the anon
-- key cannot grant itself a plan, which it certainly could if it were allowed
-- to write its own row. The webhook and the read-time resync both go through
-- the service role for exactly this reason.
--
-- `status` is text rather than an enum on purpose. It mirrors Stripe's
-- subscription status, Stripe adds values over time, and an unknown value
-- should leave someone unentitled rather than break the webhook that was
-- trying to tell us about it. 'comped' is Burg's own addition: access granted
-- without paying, with no Stripe objects behind it.

create table public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  status                 text not null default 'none',
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

-- You may read your own plan. You may not read anyone else's, including the
-- owner's of a city you were invited into -- `burg.city_is_paid` answers the
-- only question a member has about it, and answers it without disclosing
-- billing state.
create policy subscriptions_select_own on public.subscriptions for select
  using (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- Entitlement
-- --------------------------------------------------------------------------
-- Status alone decides, deliberately. `current_period_end` is display only --
-- "renews on", or "access until" after a cancellation -- and is not part of
-- the test, because Stripe's handling of the period boundary during a failed
-- renewal is subtle enough that basing access on it would produce outages that
-- are hard to explain to someone whose card simply needs updating.
--
-- 'past_due' entitles. Stripe is still retrying at that point, and taking a
-- city's collaborators away over a retryable payment failure punishes the
-- wrong thing. When the retries are exhausted Stripe moves it to 'canceled' or
-- 'unpaid', neither of which is here.
--
-- Mirrored in lib/plan.ts, which is where the app reads the same list.
-- scripts/check-plan.ts asserts the two agree, so drift fails a check.

create or replace function burg.is_paid(target_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = target_user
      and s.status in ('active', 'trialing', 'past_due', 'comped')
  );
$$;

/** Is this city's owner paying? SECURITY DEFINER: a member has no read on the
    owner's subscription row, and should not need one to be let in. */
create or replace function burg.city_is_paid(target_city uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select burg.is_paid((select c.owner_id from public.cities c where c.id = target_city));
$$;

grant execute on function burg.is_paid(uuid) to authenticated, anon, service_role;
grant execute on function burg.city_is_paid(uuid) to authenticated, anon, service_role;

-- The free caps, in one place on this side of the wire. lib/plan.ts holds the
-- same two numbers for the app's own check and its copy in the UI; the check
-- suite reads both and fails if they diverge.
create or replace function burg.free_district_cap() returns integer
  language sql immutable as $$ select 5; $$;
create or replace function burg.free_building_cap() returns integer
  language sql immutable as $$ select 50; $$;

grant execute on function burg.free_district_cap() to authenticated, anon, service_role;
grant execute on function burg.free_building_cap() to authenticated, anon, service_role;

-- --------------------------------------------------------------------------
-- Collaborators are the paid feature
-- --------------------------------------------------------------------------
-- `city_invites_owner_write` was one `for all` policy. Splitting it is the
-- point rather than tidying: **revoking** an invitation must keep working
-- after a plan lapses. An owner who stops paying still gets to clean up, and
-- leaving them with pending invitations they cannot cancel would be a trap.

drop policy if exists city_invites_owner_write on public.city_invites;

create policy city_invites_owner_insert on public.city_invites for insert
  with check (burg.is_city_owner(city_id) and burg.city_is_paid(city_id));

create policy city_invites_owner_update on public.city_invites for update
  using (burg.is_city_owner(city_id))
  with check (burg.is_city_owner(city_id) and burg.city_is_paid(city_id));

create policy city_invites_owner_delete on public.city_invites for delete
  using (burg.is_city_owner(city_id));

-- Adding a member directly, without an invitation, is the same privilege by
-- another route -- an owner who knows a user id could otherwise skip the gate
-- entirely. Founding is not this: `city_members_found` covers inserting
-- yourself as owner, and a free city must still be foundable.
drop policy if exists city_members_owner_write on public.city_members;

create policy city_members_owner_add on public.city_members for insert
  with check (burg.is_city_owner(city_id) and burg.city_is_paid(city_id));

create policy city_members_owner_change on public.city_members for update
  using (burg.is_city_owner(city_id))
  with check (burg.is_city_owner(city_id));

create policy city_members_owner_remove on public.city_members for delete
  using (burg.is_city_owner(city_id));

-- Claiming is checked at the moment access is actually granted, not at the
-- moment the invitation was sent. Otherwise a month's subscription buys fifty
-- invitations that keep letting people in forever.
--
-- A pending invitation is not destroyed by a lapse -- `claimInvites` leaves a
-- refused row alone -- so it resumes working if the owner pays again.
drop policy if exists city_members_accept_invite on public.city_members;

create policy city_members_accept_invite on public.city_members for insert
  with check (
    user_id = (select auth.uid())
    and burg.city_is_paid(city_members.city_id)
    and exists (
      select 1
      from public.city_invites i
      where i.city_id = city_members.city_id
        and lower(i.email) = lower((select auth.jwt() ->> 'email'))
        and i.role = city_members.role
    )
  );

-- Note what is deliberately absent: nothing evicts an existing member when a
-- plan lapses. Somebody who can already read a city keeps reading it. Revoking
-- access to data people are relying on, because a card expired, is not a
-- pricing decision -- it is data loss with a billing excuse. A lapse stops new
-- people arriving, and that is all.

-- --------------------------------------------------------------------------
-- The size caps
-- --------------------------------------------------------------------------
-- Triggers rather than policies. A cap is a count, and an RLS policy that
-- counted rows would have to be written as a subquery in `with check` on every
-- insert, where it is easy to get wrong and impossible to give a decent error
-- message from. A trigger can say what happened.
--
-- Two clients racing can land one row over the cap. That is left alone on
-- purpose: the alternative is a lock on every insert for a limit whose exact
-- boundary nobody can see, and being one district over is not a failure state.
--
-- SECURITY DEFINER so the count is the city's real count, not the subset the
-- inserting user can see.

create or replace function burg.enforce_district_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used integer;
  cap  integer := burg.free_district_cap();
begin
  if burg.city_is_paid(new.city_id) then
    return new;
  end if;

  select count(*) into used from public.neighborhoods where city_id = new.city_id;
  if used >= cap then
    raise exception 'BURG_FREE_DISTRICT_CAP: the free plan covers % districts', cap;
  end if;

  return new;
end;
$$;

create or replace function burg.enforce_building_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used integer;
  cap  integer := burg.free_building_cap();
begin
  if burg.city_is_paid(new.city_id) then
    return new;
  end if;

  select count(*) into used from public.buildings where city_id = new.city_id;
  if used >= cap then
    raise exception 'BURG_FREE_BUILDING_CAP: the free plan covers % buildings', cap;
  end if;

  return new;
end;
$$;

create trigger neighborhoods_free_cap
  before insert on public.neighborhoods
  for each row execute function burg.enforce_district_cap();

create trigger buildings_free_cap
  before insert on public.buildings
  for each row execute function burg.enforce_building_cap();

-- --------------------------------------------------------------------------
-- The one question the browser may ask
-- --------------------------------------------------------------------------
-- `burg.city_is_paid` lives in `burg`, which is not exposed through PostgREST,
-- and an editor still needs to know whether the city they are building in is
-- capped. This is the public wrapper, and it answers a boolean and nothing
-- else: no amount, no status, no renewal date, so a collaborator learns what
-- they are allowed to do without learning anything about the owner's billing.
--
-- Membership-guarded, so a stranger cannot walk a list of city ids asking
-- which of them are paying customers.

create or replace function public.city_is_paid(target_city uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select burg.is_city_member(target_city) and burg.city_is_paid(target_city);
$$;

revoke all on function public.city_is_paid(uuid) from public, anon;
grant execute on function public.city_is_paid(uuid) to authenticated, service_role;
