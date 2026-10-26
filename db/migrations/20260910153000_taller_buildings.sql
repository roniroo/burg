-- Buildings may stand taller than three storeys.
--
-- The sprite registry is the authority on what a building looks like, and its
-- tallest recipe -- "The stacks", library variant 2 -- is drawn at four floors.
-- The original check predates that recipe and refuses the row outright, so
-- neither the seed nor createBuilding can write one.
--
-- Widened to six rather than exactly four: the registry, not the database, is
-- where a silhouette is designed, and a recipe gaining a storey should not
-- need a migration of its own. Six still refuses a value that could only be a
-- mistake, and the constraint only ever relaxes, so it is safe to apply to a
-- table that already holds rows.

alter table public.buildings drop constraint if exists buildings_floors_check;

alter table public.buildings
  add constraint buildings_floors_check check (floors between 1 and 6);
