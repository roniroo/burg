-- Triggers: city_id denormalization, updated_at, profile bootstrap, and road
-- staleness. Path solving never happens here -- SQL only ever flags a route as
-- needing a re-solve; lib/roads.ts does the actual A*.

-- --------------------------------------------------------------------------
-- city_id denormalization
-- --------------------------------------------------------------------------

create or replace function burg.set_city_from_building()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select b.city_id into new.city_id from public.buildings b where b.id = new.building_id;
  if new.city_id is null then
    raise exception 'building % not found; cannot derive city_id', new.building_id;
  end if;
  return new;
end;
$$;

create or replace function burg.set_city_from_neighborhood()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select n.city_id into new.city_id from public.neighborhoods n where n.id = new.neighborhood_id;
  if new.city_id is null then
    raise exception 'neighborhood % not found; cannot derive city_id', new.neighborhood_id;
  end if;
  return new;
end;
$$;

create or replace function burg.set_city_from_source_building()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select b.city_id into new.city_id from public.buildings b where b.id = new.source_building_id;
  if new.city_id is null then
    raise exception 'building % not found; cannot derive city_id', new.source_building_id;
  end if;
  return new;
end;
$$;

create trigger buildings_set_city before insert or update of neighborhood_id
  on public.buildings for each row execute function burg.set_city_from_neighborhood();
create trigger gates_set_city before insert or update of neighborhood_id
  on public.gates for each row execute function burg.set_city_from_neighborhood();
create trigger links_set_city before insert
  on public.building_links for each row execute function burg.set_city_from_source_building();

create trigger documents_set_city before insert
  on public.documents for each row execute function burg.set_city_from_building();
create trigger data_tables_set_city before insert
  on public.data_tables for each row execute function burg.set_city_from_building();
create trigger table_fields_set_city before insert
  on public.table_fields for each row execute function burg.set_city_from_building();
create trigger table_rows_set_city before insert
  on public.table_rows for each row execute function burg.set_city_from_building();
create trigger table_views_set_city before insert
  on public.table_views for each row execute function burg.set_city_from_building();
create trigger boards_set_city before insert
  on public.boards for each row execute function burg.set_city_from_building();
create trigger board_columns_set_city before insert
  on public.board_columns for each row execute function burg.set_city_from_building();
create trigger board_notes_set_city before insert
  on public.board_notes for each row execute function burg.set_city_from_building();
create trigger canvases_set_city before insert
  on public.canvases for each row execute function burg.set_city_from_building();
create trigger kiosk_links_set_city before insert
  on public.kiosk_links for each row execute function burg.set_city_from_building();

-- --------------------------------------------------------------------------
-- updated_at
-- --------------------------------------------------------------------------

create or replace function burg.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger buildings_touch before update on public.buildings
  for each row execute function burg.touch_updated_at();
create trigger documents_touch before update on public.documents
  for each row execute function burg.touch_updated_at();
create trigger table_rows_touch before update on public.table_rows
  for each row execute function burg.touch_updated_at();
create trigger canvases_touch before update on public.canvases
  for each row execute function burg.touch_updated_at();

-- --------------------------------------------------------------------------
-- profile bootstrap
-- --------------------------------------------------------------------------

create or replace function burg.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, 'citizen'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function burg.handle_new_user();

-- --------------------------------------------------------------------------
-- road staleness
-- --------------------------------------------------------------------------

-- A link was created or destroyed: upsert the route for that unordered pair,
-- recompute link_count and tier, and flag it for re-solving. A route whose
-- count falls to zero is kept (link_count = 0) so the client can weather it
-- away over one animation cycle before deleting it.
create or replace function burg.link_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  src uuid;
  tgt uuid;
  lo  uuid;
  hi  uuid;
  n   integer;
begin
  if tg_op = 'INSERT' then
    src := new.source_building_id;
    tgt := new.target_building_id;
  else
    src := old.source_building_id;
    tgt := old.target_building_id;
  end if;

  lo := least(src, tgt);
  hi := greatest(src, tgt);

  select count(*) into n
  from public.building_links l
  where (l.source_building_id = lo and l.target_building_id = hi)
     or (l.source_building_id = hi and l.target_building_id = lo);

  insert into public.road_routes (
    city_id, scope, tier, link_count,
    a_building_id, b_building_id,
    a_neighborhood_id, b_neighborhood_id, stale
  )
  select
    ba.city_id,
    case when ba.neighborhood_id = bb.neighborhood_id
      then 'street'::public.road_scope
      else 'highway'::public.road_scope
    end,
    burg.tier_for(n), n,
    lo, hi,
    ba.neighborhood_id, bb.neighborhood_id, true
  from public.buildings ba, public.buildings bb
  where ba.id = lo and bb.id = hi
  on conflict (a_building_id, b_building_id) do update set
    link_count        = excluded.link_count,
    tier              = excluded.tier,
    scope             = excluded.scope,
    a_neighborhood_id = excluded.a_neighborhood_id,
    b_neighborhood_id = excluded.b_neighborhood_id,
    stale             = true,
    updated_at        = now();

  return null;
end;
$$;

create trigger building_links_touch_routes
  after insert or delete on public.building_links
  for each row execute function burg.link_changed();

-- Any route with this building as an endpoint must be re-solved, and so must
-- any route whose existing path now runs through the building's footprint.
create or replace function burg.building_moved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.road_routes r set
    stale = true,
    updated_at = now(),
    a_neighborhood_id = case when r.a_building_id = new.id then new.neighborhood_id else r.a_neighborhood_id end,
    b_neighborhood_id = case when r.b_building_id = new.id then new.neighborhood_id else r.b_neighborhood_id end
  where r.a_building_id = new.id or r.b_building_id = new.id;

  update public.road_routes r set stale = true, updated_at = now()
  where r.city_id = new.city_id
    and not r.stale
    and exists (
      select 1 from jsonb_array_elements(r.path) as t
      where (t.value ->> 'x')::integer between new.tile_x and new.tile_x + new.footprint_w - 1
        and (t.value ->> 'y')::integer between new.tile_y and new.tile_y + new.footprint_h - 1
    );

  -- scope may have flipped between street and highway
  update public.road_routes r set
    scope = case when r.a_neighborhood_id = r.b_neighborhood_id
      then 'street'::public.road_scope
      else 'highway'::public.road_scope
    end
  where r.a_building_id = new.id or r.b_building_id = new.id;

  return null;
end;
$$;

create trigger buildings_moved_touch_routes
  after insert or update of tile_x, tile_y, footprint_w, footprint_h, neighborhood_id
  on public.buildings
  for each row execute function burg.building_moved();

create or replace function burg.neighborhood_moved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.road_routes r set stale = true, updated_at = now()
  where r.a_neighborhood_id = new.id or r.b_neighborhood_id = new.id;
  return null;
end;
$$;

create trigger neighborhoods_moved_touch_routes
  after update of origin_x, origin_y, width, height on public.neighborhoods
  for each row execute function burg.neighborhood_moved();

create or replace function burg.gate_moved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.road_routes r set stale = true, updated_at = now()
  where r.a_gate_id = new.id or r.b_gate_id = new.id
     or r.a_neighborhood_id = new.neighborhood_id
     or r.b_neighborhood_id = new.neighborhood_id;
  return null;
end;
$$;

create trigger gates_moved_touch_routes
  after update of tile_x, tile_y, edge, edge_offset on public.gates
  for each row execute function burg.gate_moved();
