-- M364: Gruppenarbeit per Link, auch ohne Konto.
--
-- Der Einladungslink (M360, board_einladungen) bekommt einen Schalter „ohne Konto".
-- Ist er an, darf jeder, der das Token kennt, das Board lesen und – je nach Rolle
-- des Links – schreiben, OHNE angemeldet zu sein. Der Zugang läuft ausschließlich
-- über drei Funktionen, die das Token prüfen; Tabellen bleiben für anon gesperrt.
--   gast_lesen(token)     → Board-Inhalt, Version, Rolle, Anhang-Adressen
--   gast_stand(token)     → nur Version und Rolle (billiger Blick, ob es Neues gibt)
--   gast_schreiben(token) → wie freigabe_schreiben: Vorbedingung auf die Version,
--                           Stempel und Zeitpunkt in die Umgebung des Besitzers
-- Der Schalter steht je Board beim Besitzer, Vorgabe aus. „Link widerrufen" (Zeile
-- löschen) oder Schalter aus beendet den Zugang sofort.
--
-- Live-Kanal: Jedes geteilte Board bekommt einen zufälligen Kanalnamen
-- (board_kanaele). Über ihn laufen „wer ist dabei", „wer bearbeitet welche Karte"
-- und das Mitlesen beim Tippen (Supabase Realtime: Broadcast + Presence, keine
-- Tabelle). Den Namen erfährt nur, wer das Board ohnehin lesen darf: der Besitzer
-- und Gäste mit Konto über board_kanal(), Gäste per Link über gast_lesen().
--
-- Einspielen: Supabase Dashboard → SQL Editor → ausführen.

alter table public.board_einladungen
  add column if not exists ohne_konto boolean not null default false,
  add column if not exists dateien jsonb not null default '[]'::jsonb;
comment on column public.board_einladungen.ohne_konto is 'M364: Wer das Token kennt, darf ohne Anmeldung mitarbeiten (Rolle des Links).';
comment on column public.board_einladungen.dateien is 'M364: Anhänge des Boards für Gäste — [{id, name, mime, groesse, url}] mit signierten Adressen.';

create table if not exists public.board_kanaele (
  besitzer uuid not null references auth.users (id) on delete cascade,
  board_id text not null,
  kanal    text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  primary key (besitzer, board_id)
);
comment on table public.board_kanaele is 'PixiNotes M364: Name des Live-Kanals je geteiltem Board (nur über Funktionen lesbar).';
alter table public.board_kanaele enable row level security;
revoke all on table public.board_kanaele from anon, authenticated;

-- Kanalname eines Boards (legt ihn beim ersten Mal an). Nur für die Funktionen unten.
create or replace function public.board_kanal_intern(p_besitzer uuid, p_board_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  insert into public.board_kanaele (besitzer, board_id) values (p_besitzer, p_board_id)
  on conflict (besitzer, board_id) do nothing;
  select kanal into v from public.board_kanaele where besitzer = p_besitzer and board_id = p_board_id;
  return v;
end;
$$;
revoke all on function public.board_kanal_intern(uuid, text) from public, anon, authenticated;

-- Kanalname für Angemeldete: der Besitzer selbst oder ein Gast mit Freigabe (sonst null).
-- Als Objekt { kanal }, damit später weitere Angaben dazukommen können, ohne die Funktion zu ersetzen.
create or replace function public.board_kanal(p_besitzer uuid, p_board_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if auth.uid() <> p_besitzer and not exists (
    select 1 from public.board_freigaben f
     where f.besitzer = p_besitzer and f.board_id = p_board_id and f.gast_id = auth.uid()
  ) then
    return null;
  end if;
  return jsonb_build_object('kanal', public.board_kanal_intern(p_besitzer, p_board_id));
end;
$$;
revoke all on function public.board_kanal(uuid, text) from public, anon;
grant execute on function public.board_kanal(uuid, text) to authenticated;

create or replace function public.gast_lesen(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.board_einladungen%rowtype;
  v_inhalt text;
  v_version bigint;
begin
  select * into e from public.board_einladungen where token = p_token and ohne_konto;
  if not found then
    return null;
  end if;
  select inhalt, version into v_inhalt, v_version from public.konto_dateien
   where user_id = e.besitzer and name = 'board-' || e.board_id || '.json';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'board_id', e.board_id, 'rolle', e.rolle, 'besitzer', e.besitzer,
    'inhalt', v_inhalt, 'version', v_version, 'dateien', e.dateien,
    'kanal', public.board_kanal_intern(e.besitzer, e.board_id)
  );
end;
$$;

create or replace function public.gast_stand(p_token text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object('version', d.version, 'rolle', e.rolle)
    from public.board_einladungen e
    join public.konto_dateien d on d.user_id = e.besitzer and d.name = 'board-' || e.board_id || '.json'
   where e.token = p_token and e.ohne_konto;
$$;

create or replace function public.gast_schreiben(
  p_token text,
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
  e public.board_einladungen%rowtype;
  v_alt bigint;
  v_neu bigint;
  v_name text;
  v_jetzt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into e from public.board_einladungen where token = p_token and ohne_konto;
  if not found or e.rolle <> 'bearbeiten' then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  -- Ein Board ist Text; alles darüber ist kein Board mehr (und schützt die Ablage des Besitzers)
  if p_inhalt is null or length(p_inhalt) > 12000000 or left(ltrim(p_inhalt), 1) <> '{' then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  v_name := 'board-' || e.board_id || '.json';
  select version into v_alt from public.konto_dateien
   where user_id = e.besitzer and name = v_name for update;
  if v_alt is null then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  if p_wenn_version is null or v_alt is distinct from p_wenn_version then
    raise exception 'vorbedingung' using errcode = 'P0001';
  end if;
  update public.konto_dateien set inhalt = p_inhalt, groesse = length(p_inhalt)
   where user_id = e.besitzer and name = v_name
  returning version into v_neu;
  -- basisEtag: Dieser Stand baut auf dem auf, was gerade in der Umgebung steht (ihre Version vor diesem Schreiben)
  update public.konto_dateien
     set inhalt = jsonb_set(jsonb_set(jsonb_set(inhalt::jsonb, array['boards', e.board_id], to_jsonb(p_stempel), true), '{savedAt}', to_jsonb(v_jetzt), true), '{basisEtag}', to_jsonb(version::text), true)::text
   where user_id = e.besitzer and name = 'umgebung.json';
  return v_neu;
end;
$$;

-- M330 nachgebessert: Auch das Schreiben eines Gasts MIT Konto nennt jetzt den Stand, auf dem es aufbaut.
-- Bisher blieb der Vorfahre des letzten Schreibens des Besitzers stehen; bearbeiteten Besitzer und Gast
-- nacheinander dieselbe Karte, hielt dessen Gerät die eigene, schon gesicherte Fassung für neuer.
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
     set inhalt = jsonb_set(jsonb_set(jsonb_set(inhalt::jsonb, array['boards', p_board_id], to_jsonb(p_stempel), true), '{savedAt}', to_jsonb(v_jetzt), true), '{basisEtag}', to_jsonb(version::text), true)::text
   where user_id = p_besitzer and name = 'umgebung.json';
  return v_neu;
end;
$$;

revoke all on function public.gast_lesen(text) from public;
revoke all on function public.gast_stand(text) from public;
revoke all on function public.gast_schreiben(text, text, text, bigint) from public;
grant execute on function public.gast_lesen(text) to anon, authenticated;
grant execute on function public.gast_stand(text) to anon, authenticated;
grant execute on function public.gast_schreiben(text, text, text, bigint) to anon, authenticated;
