-- M538: Vorbedingung auch in gast_aendern (Restfenster aus M533).
--
-- Ein Gast per Link schreibt kartenweise (gast_aendern, M366): Der Server ersetzt jede geschickte Karte als Ganzes.
-- Seit M533 sieht das Gerät vor dem Schreiben einer Karte, die eben noch ein anderer in der Hand hatte, auf dem Server
-- nach (gast_stand) und arbeitet dessen neuen Stand erst ein. Es blieb das Fenster EINER Anfrage: Speichert der andere
-- genau zwischen diesem Blick und dem Schreiben, ersetzt der Gast die Karte mit dem Text, den er noch kannte — der neue
-- Text des anderen ist überall weg.
--
-- Neu ist eine optionale Vorbedingung IM PATCH:
--   p_patch = { "nodes": { … }, …, "wenn": { "version": <Version der Board-Zeile> } }
-- Passt die Version der Board-Zeile nicht mehr, schreibt die Funktion NICHTS und meldet „vorbedingung" (P0001, wie
-- board_aendern und gast_schreiben). Das Gerät liest dann neu, führt Feld für Feld zusammen und schreibt erneut.
-- Die App schickt sie nur bei solchen Karten — in großen Gruppen scheiterten sonst die meisten Schritte an Änderungen
-- anderer an ANDEREN Karten (darum hat gast_aendern seit M366 keine Vorbedingung). Die Antwort trägt zusätzlich
-- `geprueft: true` — daran erkennt die App, dass der Server die Vorbedingung kennt.
--
-- Warum im Patch und nicht als dritter Parameter (wie p_wenn_version bei board_aendern, M529): Die Signatur
-- gast_aendern(text, json) bleibt dieselbe. Es entsteht nie eine zweite Fassung daneben — auch nicht, wenn jemand eine
-- ältere Migration (20261114200000_gast_aendern.sql, 20261117100000_team_haertung.sql) noch einmal einspielt; die
-- ersetzt dann nur diese Fassung (die Vorbedingung fehlt wieder, die App merkt es an der Antwort ohne `geprueft` und
-- schreibt wie vorher). Mit zwei Fassungen wäre jeder Aufruf mehrdeutig („is not unique") und KEIN Gast schriebe mehr
-- (Befund M536 bei board_aendern). Ältere Server lassen den Schlüssel „wenn" einfach liegen (sie rechnen nur nodes,
-- edges, drawings und comments): ohne Migration also derselbe Aufruf, ohne Vorbedingung, ohne Fehler.
--
-- Unverändert: Rechte der Gäste (M365/M391, gast_stuecke_pruefen), Prüfung des Inhalts (M388, Auslöser an
-- konto_dateien), Sperr-Reihenfolge Board → Umgebung, Rechnung des Patches, Antwort { version, vor }.
--
-- Wiederholbar. Einspielen: Supabase Dashboard → SQL Editor → ausführen. Die App braucht sie nicht.
--
-- Rückweg: den Abschnitt „create or replace function public.gast_aendern …" samt revoke/grant aus
-- 20261117100000_team_haertung.sql erneut ausführen (gleiche Signatur, ersetzt diese Fassung). Die App fällt von selbst
-- auf den Weg ohne Vorbedingung zurück.

-- Sicherheitshalber jede andere Fassung entfernen (ein Entwurf mit anderer Parameterliste o. Ä.) — wie M536.
do $$
declare
  v_f regprocedure;
begin
  for v_f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'gast_aendern'
       and p.oid::regprocedure::text <> 'gast_aendern(text,json)'
  loop
    execute 'drop function ' || v_f::text;
  end loop;
end $$;

create or replace function public.gast_aendern(p_token text, p_patch json)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.board_einladungen%rowtype;
  v_alt bigint;
  v_neu bigint;
  v_text text;
  v_name text;
  v_recht text;
  b json;
  art text;
  arr json;
  v_set json;
  v_del jsonb;
  v_jetzt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_wenn bigint;
begin
  select * into e from public.board_einladungen where token = p_token and ohne_konto;
  if not found or e.rolle <> 'bearbeiten' then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  if p_patch is null or length(p_patch::text) > 6000000 or json_typeof(p_patch) <> 'object' then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  -- M538: optionale Vorbedingung im Patch: { "wenn": { "version": <Version der Board-Zeile> } }
  if (p_patch->'wenn') is not null and json_typeof(p_patch->'wenn') <> 'null' then
    if json_typeof(p_patch->'wenn') <> 'object' or coalesce(p_patch->'wenn'->>'version', '') !~ '^[0-9]{1,18}$' then
      raise exception 'ungueltig' using errcode = 'P0003';
    end if;
    v_wenn := (p_patch->'wenn'->>'version')::bigint;
  end if;
  v_name := 'board-' || e.board_id || '.json';
  select version, inhalt into v_alt, v_text from public.konto_dateien
   where user_id = e.besitzer and name = v_name for update;
  if v_alt is null then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  -- M538: die Vorbedingung — unter der Sperre geprüft, bevor irgendetwas geschrieben wird
  if v_wenn is not null and v_alt is distinct from v_wenn then
    raise exception 'vorbedingung' using errcode = 'P0001';
  end if;
  b := v_text::json;
  v_recht := coalesce(e.optionen->>'gastRecht', 'alles');
  if v_recht in ('eigenes-loeschen', 'eigenes') then
    if exists (
      -- Karten, die nicht von einem Gast per Link stammen: nicht löschen, nicht archivieren, Kennung nicht
      -- umschreiben — und bei „eigenes" auch Inhalt und Lage nicht ändern
      select 1
        from json_array_elements(coalesce(b->'nodes', '[]'::json)) as a
       where coalesce(a->'data'->>'von', '') not like 'g:%'
         and ( coalesce((p_patch->'nodes'->'del')::jsonb, '[]'::jsonb) ? (a->>'id')
            or exists (
                 select 1 from json_array_elements(coalesce(p_patch->'nodes'->'set', '[]'::json)) as n
                  where n->>'id' = a->>'id'
                    and ( coalesce(n->>'archived', 'false') <> coalesce(a->>'archived', 'false')
                       or (n->'data'->>'von') is distinct from (a->'data'->>'von')
                       or (v_recht = 'eigenes' and (
                            (n->'data')::jsonb is distinct from (a->'data')::jsonb
                         or (n->'position')::jsonb is distinct from (a->'position')::jsonb
                         or (n->>'parentId') is distinct from (a->>'parentId')
                         or (n->>'type') is distinct from (a->>'type')))) ) )
    ) or exists (
      -- Neues kommt als Gast-Karte
      select 1
        from json_array_elements(coalesce(p_patch->'nodes'->'set', '[]'::json)) as n
       where coalesce(n->'data'->>'von', '') not like 'g:%'
         and not exists (select 1 from json_array_elements(coalesce(b->'nodes', '[]'::json)) as a where a->>'id' = n->>'id')
    ) then
      raise exception 'nicht erlaubt' using errcode = 'P0004';
    end if;
  end if;
  foreach art in array array['nodes', 'edges', 'drawings', 'comments'] loop
    v_set := coalesce(p_patch->art->'set', '[]'::json);
    v_del := coalesce((p_patch->art->'del')::jsonb, '[]'::jsonb);
    if json_typeof(v_set) <> 'array' or jsonb_typeof(v_del) <> 'array' then
      raise exception 'ungueltig' using errcode = 'P0003';
    end if;
    if json_array_length(v_set) = 0 and jsonb_array_length(v_del) = 0 then
      continue;
    end if;
    select coalesce(json_agg(x.wert order by x.ord), '[]'::json) into arr
      from (
        select coalesce(s.value, a.value) as wert, a.ord as ord
          from json_array_elements(coalesce(b->art, '[]'::json)) with ordinality as a(value, ord)
          left join json_array_elements(v_set) as s(value) on s.value->>'id' = a.value->>'id'
         where not (v_del ? (a.value->>'id'))
        union all
        select s.value, 1000000000 + s.ord
          from json_array_elements(v_set) with ordinality as s(value, ord)
         where not (v_del ? (s.value->>'id'))
           and not exists (select 1 from json_array_elements(coalesce(b->art, '[]'::json)) as a where a->>'id' = s.value->>'id')
      ) x;
    -- den einen Schlüssel ersetzen; die übrigen bleiben, in ihrer Reihenfolge
    select json_object_agg(k.key, k.value order by k.ord) into b
      from (
        select j.key, case when j.key = art then arr else j.value end as value, j.ord
          from json_each(b) with ordinality as j(key, value, ord)
        union all
        select art, arr, 1000000000 where (b->art) is null
      ) k;
  end loop;
  -- M391: Striche und Verbindungen, die kein Gast angelegt hat, bleiben
  perform public.gast_stuecke_pruefen(v_text::json, b, v_recht);
  v_text := b::text;
  update public.konto_dateien set inhalt = v_text, groesse = length(v_text)
   where user_id = e.besitzer and name = v_name
  returning version into v_neu;
  update public.konto_dateien
     set inhalt = jsonb_set(jsonb_set(jsonb_set(inhalt::jsonb, array['boards', e.board_id], to_jsonb('v' || v_neu::text), true), '{savedAt}', to_jsonb(v_jetzt), true), '{basisEtag}', to_jsonb(version::text), true)::text
   where user_id = e.besitzer and name = 'umgebung.json';
  return jsonb_build_object('version', v_neu, 'vor', v_alt, 'geprueft', true);
end;
$$;

revoke all on function public.gast_aendern(text, json) from public;
grant execute on function public.gast_aendern(text, json) to anon, authenticated;
