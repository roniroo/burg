-- Core city geography.
--
-- Every table below (and in later migrations) carries `city_id`, denormalized
-- from its parent by trigger. RLS then reduces to one indexed check per table
-- instead of a four-level join back to city_members.

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '',
  avatar_sprite text not null default 'citizen_01',
  created_at    timestamptz not null default now()
);

create table public.cities (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  slug       text not null,
  width      integer not null default 40 check (width between 8 and 512),
  height     integer not null default 40 check (height between 8 and 512),
  seed       bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);
create index cities_owner_idx on public.cities (owner_id);

create table public.city_members (
  city_id   uuid not null references public.cities (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      public.city_role not null default 'owner',
  primary key (city_id, user_id)
);
create index city_members_user_idx on public.city_members (user_id);

create table public.neighborhoods (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references public.cities (id) on delete cascade,
  name         text not null,
  slug         text not null,
  description  text not null default '',
  biome        public.biome not null default 'downtown',
  crest_sprite text not null default 'crest_01',
  status       public.neighborhood_status not null default 'planning',
  origin_x     integer not null,
  origin_y     integer not null,
  width        integer not null check (width > 0),
  height       integer not null check (height > 0),
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (city_id, slug)
);
create index neighborhoods_city_idx on public.neighborhoods (city_id);

create table public.buildings (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references public.cities (id) on delete cascade,
  neighborhood_id uuid not null references public.neighborhoods (id) on delete cascade,
  title           text not null,
  artifact_type   public.artifact_type not null,
  sprite_key      text not null,
  sprite_variant  smallint not null default 1 check (sprite_variant between 1 and 3),
  -- tile_x / tile_y are CITY space, not neighborhood space.
  tile_x          integer not null,
  tile_y          integer not null,
  footprint_w     smallint not null default 1 check (footprint_w between 1 and 4),
  footprint_h     smallint not null default 1 check (footprint_h between 1 and 4),
  floors          smallint not null default 1 check (floors between 1 and 3),
  color_variant   smallint not null default 1,
  is_pinned       boolean not null default false,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index buildings_neighborhood_idx on public.buildings (neighborhood_id);
create index buildings_city_idx on public.buildings (city_id);

-- Cheap fast path with a legible error for the common 1x1 collision.
create unique index buildings_origin_unique on public.buildings (city_id, tile_x, tile_y);

-- The real guard. Footprints are multi-tile, so origin uniqueness is not
-- enough: a 2x2 at (4,4) overlaps a 1x1 at (5,5) without colliding origins.
-- Boxes are shrunk by 0.5 because Postgres box overlap (&&) treats a shared
-- boundary as an overlap, which would reject legitimately adjacent buildings.
alter table public.buildings add constraint buildings_no_overlap
  exclude using gist (
    city_id with =,
    box(
      point(tile_x, tile_y),
      point(tile_x + footprint_w - 0.5, tile_y + footprint_h - 0.5)
    ) with &&
  );

create table public.tiles (
  city_id         uuid not null references public.cities (id) on delete cascade,
  x               integer not null,
  y               integer not null,
  terrain         public.terrain not null default 'grass',
  neighborhood_id uuid references public.neighborhoods (id) on delete set null,
  primary key (city_id, x, y)
);
create index tiles_neighborhood_idx on public.tiles (neighborhood_id);

create table public.activity (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references public.cities (id) on delete cascade,
  actor_id     uuid references auth.users (id) on delete set null,
  verb         text not null,
  subject_type text not null,
  subject_id   uuid,
  headline     text not null,
  created_at   timestamptz not null default now()
);
create index activity_city_time_idx on public.activity (city_id, created_at desc);
