-- M330: Geteilte Boards zwischen Konten.
--
-- Der Besitzer trägt die E-Mail eines Gasts für ein Board ein. Meldet sich der
-- Gast mit dieser E-Mail an, übernimmt freigaben_annehmen() die Zeile auf sein
-- Konto (gast_id). Danach darf er die Board-Zeile des Besitzers lesen (Policy
-- auf konto_dateien) und über freigabe_schreiben schreiben — die Funktion
-- prüft die Freigabe, schreibt das Board mit Versions-Vorbedingung und trägt
-- Stempel und Zeitpunkt in die Umgebung des Besitzers ein, damit dessen
-- Geräte den neuen Stand sehen wie jede eigene Änderung.
--
-- Einspielen: Supabase Dashboard → SQL Editor → ausführen.

create table if not exists public.board_freigaben (
  id         uuid        primary key default gen_random_uuid(),
  besitzer   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id   text        not null,
  gast_email text        not null,
  gast_id    uuid        references auth.users (id) on delete cascade,
  rolle      text        not null default 'bearbeiten' check (rolle in ('bearbeiten', 'lesen')),
  created_at timestamptz not null default now(),
  constraint board_freigaben_eindeutig unique (besitzer, board_id, gast_email),
  constraint board_freigaben_email check (position('@' in gast_email) > 1)
);
comment on table public.board_freigaben is 'PixiNotes M330: Board eines Besitzers für die E-Mail eines Gasts freigegeben.';

alter table public.board_freigaben enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'board_freigaben' and policyname = 'Besitzer verwaltet Freigaben') then
    create policy "Besitzer verwaltet Freigaben" on public.board_freigaben for all to authenticated
      using (besitzer = auth.uid()) with check (besitzer = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'board_freigaben' and policyname = 'Gast sieht seine Freigaben') then
    create policy "Gast sieht seine Freigaben" on public.board_freigaben for select to authenticated
      using (gast_id = auth.uid() or lower(gast_email) = lower(coalesce(auth.jwt() ->> 'email', '')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'board_freigaben' and policyname = 'Gast verlaesst Freigabe') then
    create policy "Gast verlaesst Freigabe" on public.board_freigaben for delete to authenticated
      using (gast_id = auth.uid());
  end if;
  -- Gäste lesen die Board-Zeile des Besitzers
  if not exists (select 1 from pg_policies where tablename = 'konto_dateien' and policyname = 'Gast liest freigegebene Boards') then
    create policy "Gast liest freigegebene Boards" on public.konto_dateien for select to authenticated
      using (exists (
        select 1 from public.board_freigaben f
         where f.besitzer = konto_dateien.user_id and f.gast_id = auth.uid()
           and konto_dateien.name = 'board-' || f.board_id || '.json'
      ));
  end if;
end $$;

grant select, insert, update, delete on public.board_freigaben to authenticated;
revoke all on table public.board_freigaben from anon;

-- Offene Einladungen für die eigene E-Mail übernehmen; liefert die Zahl
create or replace function public.freigaben_annehmen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or mail = '' then
    return 0;
  end if;
  update public.board_freigaben
     set gast_id = auth.uid()
   where gast_id is null and lower(gast_email) = mail;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Was ist für mich freigegeben? (mit E-Mail des Besitzers für die Anzeige)
create or replace function public.freigaben_fuer_mich()
returns table (besitzer uuid, besitzer_email text, board_id text, rolle text)
language sql
security definer
set search_path = public
stable
as $$
  select f.besitzer, u.email::text, f.board_id, f.rolle
    from public.board_freigaben f
    join auth.users u on u.id = f.besitzer
   where f.gast_id = auth.uid();
$$;

-- Ein freigegebenes Board schreiben: Vorbedingung auf die Version der Board-Zeile,
-- danach Stempel und Zeitpunkt in der Umgebung des Besitzers nachziehen.
create or replace function public.freigabe_schreiben(
  p_besitzer uuid,
  p_board_id text,
  p_inhalt text,
  p_stempel text,
  p_wenn_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alt bigint;
  v_neu bigint;
  v_name text := 'board-' || p_board_id || '.json';
  v_jetzt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.board_freigaben f
     where f.besitzer = p_besitzer and f.board_id = p_board_id and f.gast_id = auth.uid() and f.rolle = 'bearbeiten'
  ) then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  select version into v_alt from public.konto_dateien
   where user_id = p_besitzer and name = v_name for update;
  if p_wenn_version is not null and v_alt is distinct from p_wenn_version then
    raise exception 'vorbedingung' using errcode = 'P0001';
  end if;
  insert into public.konto_dateien (user_id, name, inhalt, mime, groesse)
  values (p_besitzer, v_name, p_inhalt, 'application/json', length(p_inhalt))
  on conflict (user_id, name) do update set inhalt = excluded.inhalt, groesse = excluded.groesse
  returning version into v_neu;
  update public.konto_dateien
     set inhalt = jsonb_set(jsonb_set(inhalt::jsonb, array['boards', p_board_id], to_jsonb(p_stempel), true), '{savedAt}', to_jsonb(v_jetzt), true)::text
   where user_id = p_besitzer and name = 'umgebung.json';
  return v_neu;
end;
$$;

revoke all on function public.freigaben_annehmen() from public, anon;
revoke all on function public.freigaben_fuer_mich() from public, anon;
revoke all on function public.freigabe_schreiben(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.freigaben_annehmen() to authenticated;
grant execute on function public.freigaben_fuer_mich() to authenticated;
grant execute on function public.freigabe_schreiben(uuid, text, text, text, bigint) to authenticated;

-- Realtime: neue oder entfernte Freigaben kommen sofort an
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_freigaben') then
      alter publication supabase_realtime add table public.board_freigaben;
    end if;
  end if;
end $$;
