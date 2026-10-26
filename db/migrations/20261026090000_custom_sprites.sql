-- Sprites you draw yourself.
--
-- Every built-in building is generated geometry (lib/sprites.ts). These are
-- images: a PNG uploaded once into a library that belongs to this machine
-- rather than to one city, and worn by any building that picks it.
--
-- A sprite declares the lot it is drawn for. The rule the built-in art follows
-- holds here too -- a footprint is not independent of its sprite -- so a
-- building that puts one on takes its footprint, and the placement check runs
-- against that shape.
--
-- The image lives in the database rather than beside it, so that backing up
-- the data folder backs up the art.

create table public.custom_sprites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  image       bytea not null,
  -- The PNG's own size in pixels. The map scales it to the lot's width.
  width       integer not null check (width between 1 and 2048),
  height      integer not null check (height between 1 and 2048),
  footprint_w smallint not null check (footprint_w between 1 and 4),
  footprint_h smallint not null check (footprint_h between 1 and 4),
  -- The outline of the opaque pixels, "x,y x,y ...", in image pixels. A
  -- building's hit area is its art, not its bounding box (see globals.css), and
  -- the transparent corners of an image are not art.
  hit_area    text not null,
  created_at  timestamptz not null default now()
);

-- Deleting a sprite hands its buildings back their usual look. They keep the
-- sprite's footprint, which the generated art can draw at any size.
alter table public.buildings
  add column custom_sprite_id uuid references public.custom_sprites (id) on delete set null;

create index buildings_custom_sprite_idx on public.buildings (custom_sprite_id);
