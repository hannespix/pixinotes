-- M328: Eigenes PixiNotes-Konto — Ablage je Nutzer.
--
-- Eine Tabelle genügt: jede Zeile ist eine „Datei" des Konto-Syncs
-- (umgebung.json, board-<id>.json, datei-<id> als Base64), genau wie im
-- App-Ordner von Google Drive oder OneDrive. `version` zählt bei jedem
-- Schreiben hoch und ist der eTag für die Vorbedingung (If-Match).
-- Row Level Security: jede Zeile gehört genau einem Nutzer (auth.uid()).
--
-- Einspielen: Supabase Dashboard → SQL Editor → diesen Inhalt ausführen,
-- oder `supabase db push` mit der CLI.

create table if not exists public.konto_dateien (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name       text        not null,
  inhalt     text        not null default '',
  mime       text        not null default 'application/json',
  groesse    integer     not null default 0,
  version    bigint      not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, name),
  constraint konto_dateien_name_laenge check (char_length(name) between 1 and 200),
  constraint konto_dateien_groesse check (char_length(inhalt) <= 6 * 1024 * 1024)
);

comment on table public.konto_dateien is 'PixiNotes Konto-Sync (M328): eine Zeile je Datei und Nutzer; version = eTag.';

-- version und updated_at bei jedem Schreiben fortschreiben
create or replace function public.konto_dateien_vor_update()
returns trigger
language plpgsql
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.user_id := old.user_id;
  return new;
end;
$$;

drop trigger if exists konto_dateien_vor_update on public.konto_dateien;
create trigger konto_dateien_vor_update
  before update on public.konto_dateien
  for each row execute function public.konto_dateien_vor_update();

-- Nur die eigenen Zeilen — lesen, anlegen, ändern, löschen
alter table public.konto_dateien enable row level security;

drop policy if exists "eigene Zeilen lesen"   on public.konto_dateien;
drop policy if exists "eigene Zeilen anlegen" on public.konto_dateien;
drop policy if exists "eigene Zeilen aendern" on public.konto_dateien;
drop policy if exists "eigene Zeilen loeschen" on public.konto_dateien;

create policy "eigene Zeilen lesen"   on public.konto_dateien for select to authenticated using (user_id = auth.uid());
create policy "eigene Zeilen anlegen" on public.konto_dateien for insert to authenticated with check (user_id = auth.uid());
create policy "eigene Zeilen aendern" on public.konto_dateien for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "eigene Zeilen loeschen" on public.konto_dateien for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.konto_dateien to authenticated;

-- Realtime: Änderungen an den eigenen Zeilen kommen sofort auf die anderen Geräte
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'konto_dateien'
    ) then
      alter publication supabase_realtime add table public.konto_dateien;
    end if;
  end if;
end $$;

-- Realtime liefert bei UPDATE die ganze Zeile nur mit REPLICA IDENTITY FULL;
-- hier reicht der Primärschlüssel (name) — er steht immer in record/old_record.
alter table public.konto_dateien replica identity default;

-- Konto samt Daten löschen — aus der App heraus, ohne Service-Schlüssel
-- (DSGVO: der Nutzer kann sein Konto selbst entfernen). Die Zeilen in
-- konto_dateien fallen über on delete cascade.
create or replace function public.konto_loeschen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.konto_loeschen() from public;
grant execute on function public.konto_loeschen() to authenticated;

-- Alles in einem Zug: prüft die Version der Umgebung (p_wenn_version; null =
-- es darf noch keine geben), schreibt dann Dateien, löscht, schreibt die
-- Umgebung — in EINER Transaktion. Passt die Version nicht, bricht alles mit
-- „vorbedingung" ab, und kein Gerät überschreibt ein anderes halbfertig.
-- Läuft als Aufrufer (security invoker): Row Level Security gilt.
create or replace function public.konto_schreiben(
  p_dateien jsonb,
  p_loeschen text[],
  p_umgebung text,
  p_wenn_version bigint
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_alt bigint;
  v_neu bigint;
  d jsonb;
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;
  select version into v_alt
    from public.konto_dateien
   where user_id = auth.uid() and name = 'umgebung.json'
   for update;
  if (p_wenn_version is null and v_alt is not null)
     or (p_wenn_version is not null and v_alt is distinct from p_wenn_version) then
    raise exception 'vorbedingung' using errcode = 'P0001';
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_dateien, '[]'::jsonb)) loop
    insert into public.konto_dateien (user_id, name, inhalt, mime, groesse)
    values (auth.uid(), d->>'name', coalesce(d->>'inhalt', ''), coalesce(d->>'mime', 'application/json'), coalesce((d->>'groesse')::integer, 0))
    on conflict (user_id, name) do update
      set inhalt = excluded.inhalt, mime = excluded.mime, groesse = excluded.groesse;
  end loop;
  if p_loeschen is not null then
    delete from public.konto_dateien where user_id = auth.uid() and name = any(p_loeschen);
  end if;
  insert into public.konto_dateien (user_id, name, inhalt, mime, groesse)
  values (auth.uid(), 'umgebung.json', p_umgebung, 'application/json', length(p_umgebung))
  on conflict (user_id, name) do update
    set inhalt = excluded.inhalt, groesse = excluded.groesse
  returning version into v_neu;
  return v_neu;
end;
$$;

revoke all on function public.konto_schreiben(jsonb, text[], text, bigint) from public;
grant execute on function public.konto_schreiben(jsonb, text[], text, bigint) to authenticated;
