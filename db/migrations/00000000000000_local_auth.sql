-- What Supabase used to provide before the first migration ran.
--
-- Burg's schema was written against Supabase, which arrives with roles, an
-- `auth` schema and a JWT already in place. On this machine none of that
-- exists, so this file makes the smallest version of it that the later
-- migrations can stand on, and nothing more. It sorts first on purpose.
--
-- There is one person here. `auth.uid()` answers with them -- the earliest row
-- in `auth.users` -- so every SECURITY DEFINER helper that asks "who is this"
-- keeps its meaning without a session to read it from. The app connects as the
-- database owner, which row-level security does not apply to, so the policies
-- the later migrations create are inert here. They stay because rewriting the
-- history to remove them would gain nothing and would make the files lie about
-- what the hosted database was.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;

-- Only the columns something reads: the foreign keys want `id`, and
-- `burg.handle_new_user` names the profile from `email` and the metadata.
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql
stable
as $$
  select id from auth.users order by created_at, id limit 1;
$$;

create function auth.jwt() returns jsonb
language sql
stable
as $$
  select jsonb_build_object('sub', id, 'email', email)
  from auth.users
  order by created_at, id
  limit 1;
$$;
