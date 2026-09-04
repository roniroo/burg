-- Artifact payloads. One table group per building type; the building row is
-- the shared identity, so these all key on building_id.

-- Library -> document
create table public.documents (
  building_id uuid primary key references public.buildings (id) on delete cascade,
  city_id     uuid not null references public.cities (id) on delete cascade,
  content     jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  -- Plaintext mirror of `content`, written by the editor on save. Indexed for
  -- full-text search in 0007.
  search_text text not null default '',
  updated_at  timestamptz not null default now()
);

-- Warehouse -> data table
create table public.data_tables (
  building_id      uuid primary key references public.buildings (id) on delete cascade,
  city_id          uuid not null references public.cities (id) on delete cascade,
  name             text not null default 'Table',
  primary_field_id uuid
);

create table public.table_fields (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references public.cities (id) on delete cascade,
  building_id uuid not null references public.data_tables (building_id) on delete cascade,
  name        text not null,
  field_type  public.field_type not null default 'text',
  options     jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  width       integer not null default 180 check (width between 48 and 1200)
);
create index table_fields_building_idx on public.table_fields (building_id, position);

create table public.table_rows (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references public.cities (id) on delete cascade,
  building_id uuid not null references public.data_tables (building_id) on delete cascade,
  -- Keyed by field id, so adding a column is never a migration.
  data        jsonb not null default '{}'::jsonb,
  -- Primary-field text, denormalized on write so rows are searchable without
  -- the server having to know each table's schema at query time.
  search_text text not null default '',
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index table_rows_building_idx on public.table_rows (building_id, position);
create index table_rows_data_idx on public.table_rows using gin (data);

create table public.table_views (
  id                 uuid primary key default gen_random_uuid(),
  city_id            uuid not null references public.cities (id) on delete cascade,
  building_id        uuid not null references public.data_tables (building_id) on delete cascade,
  name               text not null default 'Table',
  view_type          public.view_type not null default 'table',
  filters            jsonb not null default '[]'::jsonb,
  sorts              jsonb not null default '[]'::jsonb,
  hidden_fields      jsonb not null default '[]'::jsonb,
  group_by_field_id  uuid references public.table_fields (id) on delete set null,
  position           integer not null default 0
);
create index table_views_building_idx on public.table_views (building_id, position);

alter table public.data_tables
  add constraint data_tables_primary_field_fk
  foreign key (primary_field_id) references public.table_fields (id) on delete set null;

-- Noticeboard -> board
create table public.boards (
  building_id uuid primary key references public.buildings (id) on delete cascade,
  city_id     uuid not null references public.cities (id) on delete cascade,
  mode        public.board_mode not null default 'freeform'
);

create table public.board_columns (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references public.cities (id) on delete cascade,
  building_id uuid not null references public.boards (building_id) on delete cascade,
  name        text not null,
  color       smallint not null default 1 check (color between 1 and 6),
  position    integer not null default 0
);
create index board_columns_building_idx on public.board_columns (building_id, position);

create table public.board_notes (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references public.cities (id) on delete cascade,
  building_id uuid not null references public.boards (building_id) on delete cascade,
  column_id   uuid references public.board_columns (id) on delete set null,
  body        text not null default '',
  color       smallint not null default 1 check (color between 1 and 6),
  pin_x       integer not null default 0,
  pin_y       integer not null default 0,
  -- Degrees. Freeform notes get a small random tilt when pinned.
  rotation    real not null default 0 check (rotation between -15 and 15),
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index board_notes_building_idx on public.board_notes (building_id, position);

-- Studio -> canvas
create table public.canvases (
  building_id uuid primary key references public.buildings (id) on delete cascade,
  city_id     uuid not null references public.cities (id) on delete cascade,
  scene       jsonb not null default '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Newsstand -> links
create table public.kiosk_links (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references public.cities (id) on delete cascade,
  building_id  uuid not null references public.buildings (id) on delete cascade,
  title        text not null default '',
  url          text not null,
  og_image_url text,
  note         text not null default '',
  storage_path text,
  position     integer not null default 0
);
create index kiosk_links_building_idx on public.kiosk_links (building_id, position);
