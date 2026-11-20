-- Test-only stand-in for the parts of Supabase that schema.sql relies on: the API roles,
-- auth.users, auth.uid() and auth.jwt(). Never run this on a real Supabase project.
-- Roles are shared by the whole Postgres server, and test files run at the same time, so two may try to
-- create the same role at once. Each create ignores "already exists".
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
    begin
      if not exists (select 1 from pg_roles where rolname = r) then
        execute format('create role %I nologin%s', r, case when r = 'service_role' then ' bypassrls' else '' end);
      end if;
    exception when duplicate_object or unique_violation then null;
    end;
  end loop;
end $$;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

-- Supabase gives the API roles full table rights by default and lets RLS decide.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Supabase Storage's tables (supabase/022_chat_files.sql adds a bucket and a read policy). Like the real ones:
-- row level security on, full table rights for the API roles, and RLS decides.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
