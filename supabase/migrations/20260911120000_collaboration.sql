-- Collaboration: roles that mean something, and invitations.
--
-- `city_members` and the `city_role` enum have existed since the foundation,
-- but nothing enforced the role: every policy asked `burg.is_city_member`, so
-- a "viewer" could demolish a district. This migration makes the three roles
-- real and adds the invitation table that lets a second person in.
--
--   owner   founded the city; manages people; can destroy it
--   editor  everything except managing people and destroying the city
--   viewer  reads
--
-- The helpers are SECURITY DEFINER for the same reason `is_city_member` is:
-- a policy ON city_members has to query city_members without recursing into
-- its own policy.

-- --------------------------------------------------------------------------
-- Role helpers
-- --------------------------------------------------------------------------

create or replace function burg.city_role_of(target_city uuid)
returns public.city_role
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select m.role
  from public.city_members m
  where m.city_id = target_city
    and m.user_id = (select auth.uid());
$$;

/** Owner or editor: may change the contents of the city. */
create or replace function burg.can_edit_city(target_city uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select burg.city_role_of(target_city) in ('owner', 'editor');
$$;

/** Owner: may manage people, and destroy the city. */
create or replace function burg.is_city_owner(target_city uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select burg.city_role_of(target_city) = 'owner';
$$;

grant execute on function burg.city_role_of(uuid) to authenticated, anon, service_role;
grant execute on function burg.can_edit_city(uuid) to authenticated, anon, service_role;
grant execute on function burg.is_city_owner(uuid) to authenticated, anon, service_role;

-- --------------------------------------------------------------------------
-- Writes require an editor
-- --------------------------------------------------------------------------
-- Reading stays `is_city_member`; only the three writing verbs change. The
-- table list is the same one the original policy loop used.

do $$
declare
  t text;
  city_scoped text[] := array[
    'neighborhoods', 'buildings', 'tiles', 'activity',
    'building_links', 'gates', 'road_routes',
    'documents', 'data_tables', 'table_fields', 'table_rows', 'table_views',
    'boards', 'board_columns', 'board_notes', 'canvases', 'kiosk_links'
  ];
begin
  foreach t in array city_scoped loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for insert with check (burg.can_edit_city(city_id))',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update using (burg.can_edit_city(city_id)) with check (burg.can_edit_city(city_id))',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete using (burg.can_edit_city(city_id))',
      t || '_delete', t
    );
  end loop;
end;
$$;

-- A city's own row: any member could rename it before. Editors may; viewers
-- may not. Destroying it stays with the owner, which it already was.
drop policy if exists cities_update on public.cities;
create policy cities_update on public.cities for update
  using (burg.can_edit_city(id)) with check (burg.can_edit_city(id));

-- --------------------------------------------------------------------------
-- Seeing who you share a city with
-- --------------------------------------------------------------------------
-- A members list needs names. Profiles were visible only to their owner, so
-- co-members could not be named at all. This exposes exactly the profile rows
-- of people you already share a city with, and nothing else.

create or replace function burg.shares_a_city_with(other_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.city_members mine
    join public.city_members theirs on theirs.city_id = mine.city_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user
  );
$$;

grant execute on function burg.shares_a_city_with(uuid) to authenticated, anon, service_role;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()) or burg.shares_a_city_with(id));

-- --------------------------------------------------------------------------
-- Membership
-- --------------------------------------------------------------------------
-- The old single `for all` policy let the owner do everything and nobody else
-- do anything, which leaves no way to accept an invitation or to leave.

drop policy if exists city_members_write on public.city_members;

create policy city_members_owner_write on public.city_members for all
  using (burg.is_city_owner(city_id))
  with check (burg.is_city_owner(city_id));

-- Leaving is your own decision. An owner cannot leave -- they would strand the
-- city with nobody able to manage it -- so they must hand it over or delete it.
create policy city_members_leave on public.city_members for delete
  using (user_id = (select auth.uid()) and role <> 'owner');

-- --------------------------------------------------------------------------
-- Invitations
-- --------------------------------------------------------------------------
-- Invites are addressed to an email rather than a user id, because the person
-- may not have an account yet, and because the app has no way to look one up:
-- finding a user by email needs the service role, which deliberately does not
-- exist at runtime. The row is claimed on the invitee's next sign-in.

create table public.city_invites (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references public.cities (id) on delete cascade,
  email      text not null,
  role       public.city_role not null default 'viewer',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Case-insensitive: nobody thinks of Ada@x.com and ada@x.com as two people.
  constraint city_invites_role_not_owner check (role <> 'owner')
);

create unique index city_invites_unique on public.city_invites (city_id, lower(email));
create index city_invites_email_idx on public.city_invites (lower(email));

alter table public.city_invites enable row level security;

-- Members see their city's pending invites; the invitee sees their own, which
-- is what lets them claim it.
create policy city_invites_select on public.city_invites for select
  using (
    burg.is_city_member(city_id)
    or lower(email) = lower((select auth.jwt() ->> 'email'))
  );

create policy city_invites_owner_write on public.city_invites for all
  using (burg.is_city_owner(city_id))
  with check (burg.is_city_owner(city_id));

-- Claiming removes the invite, so the invitee must be able to delete their own.
create policy city_invites_claim on public.city_invites for delete
  using (lower(email) = lower((select auth.jwt() ->> 'email')));

-- Accepting is inserting yourself as a member, and is allowed only where an
-- invite addressed to you actually exists, at exactly the role it names.
create policy city_members_accept_invite on public.city_members for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.city_invites i
      where i.city_id = city_members.city_id
        and lower(i.email) = lower((select auth.jwt() ->> 'email'))
        and i.role = city_members.role
    )
  );
