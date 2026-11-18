-- Минимальная заглушка окружения Supabase для локального Postgres (только для тестов).
-- Роли, схема auth, auth.uid()/auth.role()/auth.jwt() из настроек PostgREST.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'authenticator'; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
