-- Burg foundation: extensions, enums, and the internal helper schema.
--
-- Helper functions live in `burg` rather than `public` so they are not exposed
-- through PostgREST. Anything the browser must call by RPC (search_all) stays
-- in `public`.

create extension if not exists btree_gist;

create schema if not exists burg;
grant usage on schema burg to authenticated, anon, service_role;

create type public.artifact_type as enum ('doc', 'table', 'board', 'canvas', 'kiosk');
create type public.biome as enum ('downtown', 'harbor', 'forest', 'desert', 'snow');
create type public.neighborhood_status as enum ('planning', 'building', 'shipped', 'archived');
create type public.link_type as enum ('wiki', 'relation', 'promoted_from', 'manual');
create type public.road_tier as enum ('dirt', 'cobble', 'paved', 'highway');
create type public.road_scope as enum ('street', 'highway');
create type public.terrain as enum ('grass', 'cobble', 'water', 'park', 'road');
create type public.city_role as enum ('owner', 'editor', 'viewer');
create type public.edge_side as enum ('north', 'east', 'south', 'west');
create type public.field_type as enum (
  'text', 'long_text', 'number', 'currency', 'select', 'multi_select',
  'date', 'checkbox', 'url', 'person', 'relation'
);
create type public.view_type as enum ('table', 'board', 'gallery');
create type public.board_mode as enum ('freeform', 'columns');

-- Road tier is derived from link count, never stored by hand.
create or replace function burg.tier_for(link_count integer)
returns public.road_tier
language sql
immutable
as $$
  select case
    when link_count >= 10 then 'highway'::public.road_tier
    when link_count >= 6  then 'paved'::public.road_tier
    when link_count >= 3  then 'cobble'::public.road_tier
    else 'dirt'::public.road_tier
  end;
$$;
