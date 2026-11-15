-- Nachgestelltes Supabase für die SQL-Prüfungen: Rollen, auth.uid() (aus der Einstellung test.uid), Speicher-Schema.
-- Danach werden die Migrationen aus supabase/migrations der Reihe nach eingespielt.
drop database if exists pntest;
create database pntest;
\c pntest
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.email() returns text language sql stable security definer as $$ select (select email from auth.users where id = auth.uid()) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', auth.email()) $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
grant usage on schema public, auth, storage to anon, authenticated;
