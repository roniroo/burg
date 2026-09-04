-- Row Level Security.
--
-- Every policy is one indexed check against burg.is_city_member(city_id).
-- The helper is SECURITY DEFINER so that the policy ON city_members can query
-- city_members without recursing into its own policy.

create or replace function burg.is_city_member(target_city uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.city_members m
    where m.city_id = target_city
      and m.user_id = (select auth.uid())
  );
$$;

grant execute on function burg.is_city_member(uuid) to authenticated, anon, service_role;
grant execute on function burg.tier_for(integer) to authenticated, anon, service_role;

-- profiles: you see and edit only yourself.
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- cities: membership is the gate; only the owner may create or destroy.
alter table public.cities enable row level security;
create policy cities_select on public.cities for select
  using (burg.is_city_member(id));
create policy cities_insert on public.cities for insert
  with check (owner_id = (select auth.uid()));
create policy cities_update on public.cities for update
  using (burg.is_city_member(id)) with check (burg.is_city_member(id));
create policy cities_delete on public.cities for delete
  using (owner_id = (select auth.uid()));

-- city_members: readable by fellow members; writable only by the city owner.
alter table public.city_members enable row level security;
create policy city_members_select on public.city_members for select
  using (burg.is_city_member(city_id));
create policy city_members_write on public.city_members for all
  using (exists (select 1 from public.cities c where c.id = city_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.cities c where c.id = city_id and c.owner_id = (select auth.uid())));

-- Everything else keys off city_id with an identical four-verb policy set.
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
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select using (burg.is_city_member(city_id))',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (burg.is_city_member(city_id))',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update using (burg.is_city_member(city_id)) with check (burg.is_city_member(city_id))',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for delete using (burg.is_city_member(city_id))',
      t || '_delete', t
    );
  end loop;
end;
$$;
