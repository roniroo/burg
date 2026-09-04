-- Full-text search. Postgres only; no external search service.
--
-- Each searchable surface gets a stored tsvector + GIN index, and
-- public.search_all unions them into one ranked result set. It runs
-- SECURITY INVOKER so RLS filters the results for free.

alter table public.documents
  add column search_tsv tsvector
  generated always as (to_tsvector('english', coalesce(search_text, ''))) stored;
create index documents_tsv_idx on public.documents using gin (search_tsv);

alter table public.buildings
  add column title_tsv tsvector
  generated always as (to_tsvector('english', coalesce(title, ''))) stored;
create index buildings_tsv_idx on public.buildings using gin (title_tsv);

alter table public.board_notes
  add column body_tsv tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;
create index board_notes_tsv_idx on public.board_notes using gin (body_tsv);

alter table public.table_rows
  add column search_tsv tsvector
  generated always as (to_tsvector('english', coalesce(search_text, ''))) stored;
create index table_rows_tsv_idx on public.table_rows using gin (search_tsv);

alter table public.neighborhoods
  add column name_tsv tsvector
  generated always as (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))) stored;
create index neighborhoods_tsv_idx on public.neighborhoods using gin (name_tsv);

create type public.search_kind as enum ('neighborhood', 'building', 'document', 'row', 'note');

create or replace function public.search_all(p_city_id uuid, p_query text)
returns table (
  kind            public.search_kind,
  id              uuid,
  building_id     uuid,
  neighborhood_id uuid,
  title           text,
  snippet         text,
  rank            real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (select websearch_to_tsquery('english', p_query) as ts)
  select * from (
  select 'neighborhood'::public.search_kind, n.id, null::uuid, n.id, n.name,
         left(n.description, 160), ts_rank(n.name_tsv, q.ts)
  from public.neighborhoods n, q
  where n.city_id = p_city_id and n.name_tsv @@ q.ts

  union all
  select 'building', b.id, b.id, b.neighborhood_id, b.title,
         b.artifact_type::text, ts_rank(b.title_tsv, q.ts)
  from public.buildings b, q
  where b.city_id = p_city_id and b.title_tsv @@ q.ts

  union all
  select 'document', d.building_id, d.building_id, b.neighborhood_id, b.title,
         ts_headline('english', d.search_text, q.ts,
                     'MaxWords=24, MinWords=8, ShortWord=3, MaxFragments=1'),
         ts_rank(d.search_tsv, q.ts)
  from public.documents d
  join public.buildings b on b.id = d.building_id, q
  where d.city_id = p_city_id and d.search_tsv @@ q.ts

  union all
  select 'row', r.id, r.building_id, b.neighborhood_id, r.search_text,
         b.title, ts_rank(r.search_tsv, q.ts)
  from public.table_rows r
  join public.buildings b on b.id = r.building_id, q
  where r.city_id = p_city_id and r.search_tsv @@ q.ts

  union all
  select 'note', nt.id, nt.building_id, b.neighborhood_id, left(nt.body, 80),
         b.title, ts_rank(nt.body_tsv, q.ts)
  from public.board_notes nt
  join public.buildings b on b.id = nt.building_id, q
  where nt.city_id = p_city_id and nt.body_tsv @@ q.ts

  ) hits (kind, id, building_id, neighborhood_id, title, snippet, rank)
  order by hits.rank desc, hits.title asc
  limit 50;
$$;

grant execute on function public.search_all(uuid, text) to authenticated, service_role;
