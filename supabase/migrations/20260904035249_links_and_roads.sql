-- The link graph and its physical rendering as roads.
--
-- `building_links` is the source of truth. `road_routes` is derived: one row
-- per unordered building pair, carrying the solved tile path. Paths are solved
-- in app code (lib/roads.ts) and written back; SQL only ever marks them stale.

create table public.building_links (
  id                 uuid primary key default gen_random_uuid(),
  city_id            uuid not null references public.cities (id) on delete cascade,
  source_building_id uuid not null references public.buildings (id) on delete cascade,
  target_building_id uuid not null references public.buildings (id) on delete cascade,
  link_type          public.link_type not null default 'wiki',
  created_at         timestamptz not null default now(),
  constraint building_links_no_self check (source_building_id <> target_building_id),
  unique (source_building_id, target_building_id, link_type)
);
create index building_links_source_idx on public.building_links (source_building_id);
create index building_links_target_idx on public.building_links (target_building_id);
create index building_links_city_idx on public.building_links (city_id);

-- Perimeter openings. ALL inter-neighborhood traffic routes through a gate;
-- without that rule the highway layer turns into spaghetti.
create table public.gates (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references public.cities (id) on delete cascade,
  neighborhood_id uuid not null references public.neighborhoods (id) on delete cascade,
  edge            public.edge_side not null,
  -- Distance along that edge from its origin corner, in tiles. Named
  -- `edge_offset` because `offset` is a reserved word.
  edge_offset     integer not null default 0 check (edge_offset >= 0),
  tile_x          integer not null,
  tile_y          integer not null,
  is_auto         boolean not null default true
);
create index gates_neighborhood_idx on public.gates (neighborhood_id);

create table public.road_routes (
  id                uuid primary key default gen_random_uuid(),
  city_id           uuid not null references public.cities (id) on delete cascade,
  scope             public.road_scope not null,
  tier              public.road_tier not null default 'dirt',
  -- [{ x, y, segment }] where segment in ('road','bridge','steps','gate').
  path              jsonb not null default '[]'::jsonb,
  link_count        integer not null default 0,
  a_building_id     uuid not null references public.buildings (id) on delete cascade,
  b_building_id     uuid not null references public.buildings (id) on delete cascade,
  a_neighborhood_id uuid references public.neighborhoods (id) on delete cascade,
  b_neighborhood_id uuid references public.neighborhoods (id) on delete cascade,
  a_gate_id         uuid references public.gates (id) on delete set null,
  b_gate_id         uuid references public.gates (id) on delete set null,
  stale             boolean not null default true,
  updated_at        timestamptz not null default now(),
  -- Endpoints are stored normalized (a < b) so each pair has exactly one row.
  constraint road_routes_normalized check (a_building_id < b_building_id),
  unique (a_building_id, b_building_id)
);
create index road_routes_stale_idx on public.road_routes (city_id, stale);
create index road_routes_a_idx on public.road_routes (a_building_id);
create index road_routes_b_idx on public.road_routes (b_building_id);
create index road_routes_hoods_idx on public.road_routes (a_neighborhood_id, b_neighborhood_id);
