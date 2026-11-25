-- M529: Vorbedingung beim kartenweisen Schreiben (board_aendern).
--
-- board_aendern (M383) fügt einen Patch unter der Zeilensperre ein — ohne Vorbedingung. Schreiben zwei Geräte
-- dieselbe Karte innerhalb derselben Anfrage-Laufzeit, gewinnt die später eintreffende GANZE Karte; die Änderung
-- des anderen Geräts ist dann überall weg (M524, „Grenzen"). Die App verkleinerte das Fenster mit einem Mini-Abruf
-- unmittelbar vor dem Schreiben, schließen konnte sie es nicht.
--
-- Neu sind zwei optionale Parameter:
--   p_wenn_umgebung  Version der Umgebung (umgebung.json) des Besitzers, auf der das Gerät aufbaut. Jeder
--                    Schreibweg (konto_schreiben, board_aendern, gast_aendern, gast_schreiben, freigabe_schreiben)
--                    zählt sie hoch — sie ist die Uhr des Kontos. Der Besitzer schickt sie mit.
--   p_wenn_version   Version der Board-Zeile, auf der das Gerät aufbaut. Gäste mit Konto schicken sie mit (die
--                    Umgebung des Besitzers kennen sie nicht).
-- Passt eine genannte Version nicht mehr, schreibt die Funktion NICHTS und meldet „vorbedingung" (P0001, wie
-- konto_schreiben). Das Gerät liest dann neu, führt Feld für Feld zusammen und schreibt erneut.
-- Ohne die Parameter (ältere App-Stände) arbeitet sie wie bisher. Die Antwort trägt zusätzlich `geprueft: true` —
-- daran erkennt die App, dass der Server die Vorbedingung kennt (und lässt den Mini-Abruf weg).
--
-- Rechte und Prüfungen bleiben unverändert: schreiben darf der Besitzer und wer eine Freigabe „bearbeiten" hat;
-- der Inhalt-Prüfer (M388, Auslöser an konto_dateien) und die Rechte der Gäste (M391) gelten weiter.
--
-- Die alte Fassung mit vier Parametern wird ersetzt (zwei Fassungen nebeneinander machte PostgREST mehrdeutig).
-- Ältere App-Stände rufen mit vier benannten Parametern auf — die neue Fassung nimmt das über die Vorgaben an.
--
-- Wiederholbar. Einspielen: Supabase Dashboard → SQL Editor → ausführen. Ohne diese Migration arbeitet die App wie
-- bisher (sie erkennt das an der Antwort 404 und schickt die Parameter dann nicht mehr).
--
-- Rückweg: die Funktion löschen und die Fassung aus 20261115100000_board_aendern.sql neu anlegen:
--   drop function if exists public.board_aendern(uuid, text, json, text, bigint, bigint);
--   -- danach den Abschnitt „create or replace function public.board_aendern …" samt revoke/grant aus
--   -- 20261115100000_board_aendern.sql ausführen.

-- M536: JEDE andere Fassung entfernen, nicht nur die bekannte mit vier Parametern. Stünde daneben noch eine
-- (andere Parameterliste aus einem Entwurf, die alte Migration ein zweites Mal eingespielt …), wären Aufrufe mit
-- benannten Parametern mehrdeutig („function … is not unique") — dann schriebe KEIN App-Stand mehr.
do $$
declare
  v_f regprocedure;
begin
  for v_f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'board_aendern'
       and p.oid::regprocedure::text <> 'board_aendern(uuid,text,json,text,bigint,bigint)'
  loop
    execute 'drop function ' || v_f::text;
  end loop;
end $$;

create or replace function public.board_aendern(
  p_besitzer uuid,
  p_board_id text,
  p_patch json,
  p_saved_at text default null,
  p_wenn_umgebung bigint default null,
  p_wenn_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ich uuid := auth.uid();
  v_alt bigint;
  v_neu bigint;
  v_um_alt bigint;
  v_um_neu bigint;
  v_text text;
  v_name text := 'board-' || p_board_id || '.json';
  v_jetzt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_ich is null then
    raise exception 'nicht angemeldet';
  end if;
  if v_ich <> p_besitzer and not exists (
    select 1 from public.board_freigaben f
     where f.besitzer = p_besitzer and f.board_id = p_board_id and f.gast_id = v_ich and f.rolle = 'bearbeiten'
  ) then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  if p_patch is null or length(p_patch::text) > 6000000 or json_typeof(p_patch) <> 'object' then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  -- erst das Board, dann die Umgebung — dieselbe Reihenfolge wie alle anderen Schreibwege (M391)
  select version, inhalt into v_alt, v_text from public.konto_dateien
   where user_id = p_besitzer and name = v_name for update;
  if v_alt is null then
    raise exception 'kein board' using errcode = 'P0002';
  end if;
  select version into v_um_alt from public.konto_dateien
   where user_id = p_besitzer and name = 'umgebung.json' for update;
  -- M529: die Vorbedingung — beide unter der Sperre geprüft, bevor irgendetwas geschrieben wird
  if p_wenn_version is not null and v_alt is distinct from p_wenn_version then
    raise exception 'vorbedingung' using errcode = 'P0001';
  end if;
  if p_wenn_umgebung is not null and v_um_alt is distinct from p_wenn_umgebung then
    raise exception 'vorbedingung' using errcode = 'P0001';
  end if;
  v_text := public.board_patch_anwenden(v_text::json, p_patch)::text;
  update public.konto_dateien set inhalt = v_text, groesse = length(v_text)
   where user_id = p_besitzer and name = v_name
  returning version into v_neu;
  if v_um_alt is not null then
    -- der Zeitpunkt des Besitzers gilt nur für ihn selbst und nur in der üblichen Form
    if v_ich = p_besitzer and p_saved_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then
      v_jetzt := p_saved_at;
    end if;
    update public.konto_dateien
       set inhalt = jsonb_set(jsonb_set(jsonb_set(inhalt::jsonb, array['boards', p_board_id], to_jsonb('v' || v_neu::text), true), '{savedAt}', to_jsonb(v_jetzt), true), '{basisEtag}', to_jsonb(v_um_alt::text), true)::text
     where user_id = p_besitzer and name = 'umgebung.json'
    returning version into v_um_neu;
  end if;
  return jsonb_build_object('version', v_neu, 'vor', v_alt, 'umgebung', v_um_neu, 'umgebung_vor', v_um_alt, 'geprueft', true);
end;
$$;

revoke all on function public.board_aendern(uuid, text, json, text, bigint, bigint) from public, anon;
grant execute on function public.board_aendern(uuid, text, json, text, bigint, bigint) to authenticated;
