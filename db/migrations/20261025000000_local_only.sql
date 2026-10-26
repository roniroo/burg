-- Burg on one machine: the paid plan comes out.
--
-- The caps existed to recover what hosting cost. On a desktop there is no
-- hosting and nobody to bill, so all they could still do is stop the one
-- person here from building their own city. The triggers go, and with them
-- everything that only existed to answer "is this city paying?".
--
-- Collaboration's tables stay. Nothing writes to them any more, but the owner
-- still has a `city_members` row, and the role it records is what the app
-- reads to decide whether to show the building controls.

drop trigger if exists neighborhoods_free_cap on public.neighborhoods;
drop trigger if exists buildings_free_cap on public.buildings;
drop function if exists burg.enforce_district_cap();
drop function if exists burg.enforce_building_cap();
drop function if exists burg.free_district_cap();
drop function if exists burg.free_building_cap();

-- `cascade` takes the invite and membership policies that also asked for the
-- plan. Nothing here is subject to policies (see the local auth migration), so
-- they are not replaced.
drop function if exists public.city_is_paid(uuid);
drop function if exists burg.city_is_paid(uuid) cascade;
drop function if exists burg.is_paid(uuid);
drop table if exists public.subscriptions;
