-- M366: Gruppenarbeit für viele — Änderungen kartenweise statt als ganzes Board.
--
-- gast_schreiben (M364) schickt das ganze Board und verlangt die Version, auf der es aufbaut. Bei wenigen
-- Teilnehmern ist das gut; schreiben viele zugleich, scheitert fast jeder an der Vorbedingung, liest das ganze
-- Board neu und versucht es wieder. gast_aendern nimmt stattdessen nur, was sich geändert hat:
--
--   p_patch = { "nodes":    { "set": [ <Karte>, … ], "del": [ "<Kennung>", … ] },
--               "edges":    { … }, "drawings": { … }, "comments": { … } }
--
-- Der Server fügt es unter der Zeilensperre in das gespeicherte Board ein — ohne Vorbedingung, also ohne
-- Wiederholungen. Gesetzte Objekte ersetzen ihr Gegenstück (gleiche Kennung) an Ort und Stelle oder kommen ans
-- Ende; gelöschte fallen heraus. Antwort: { version, vor } — die neue Version und die, auf die sie folgt; damit
-- erkennen die Geräte, ob ihnen eine Änderung fehlt. Die Rechte der Gäste (M365) gelten wie bei gast_schreiben,
-- geprüft nur an den betroffenen Karten.
--
-- Mit dem Typ json (nicht jsonb) bleibt jedes Objekt Zeichen für Zeichen so, wie das Gerät es geschickt hat.
-- In der Umgebung des Besitzers steht als Stempel „v<Version>" — sein Gerät liest das Board dann neu.
--
-- Einspielen: Supabase Dashboard → SQL Editor → ausführen.

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
begin
  select * into e from public.board_einladungen where token = p_token and ohne_konto;
  if not found or e.rolle <> 'bearbeiten' then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  if p_patch is null or length(p_patch::text) > 6000000 or json_typeof(p_patch) <> 'object' then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  v_name := 'board-' || e.board_id || '.json';
  select version, inhalt into v_alt, v_text from public.konto_dateien
   where user_id = e.besitzer and name = v_name for update;
  if v_alt is null then
    raise exception 'keine freigabe' using errcode = 'P0002';
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
  v_text := b::text;
  update public.konto_dateien set inhalt = v_text, groesse = length(v_text)
   where user_id = e.besitzer and name = v_name
  returning version into v_neu;
  update public.konto_dateien
     set inhalt = jsonb_set(jsonb_set(jsonb_set(inhalt::jsonb, array['boards', e.board_id], to_jsonb('v' || v_neu::text), true), '{savedAt}', to_jsonb(v_jetzt), true), '{basisEtag}', to_jsonb(version::text), true)::text
   where user_id = e.besitzer and name = 'umgebung.json';
  return jsonb_build_object('version', v_neu, 'vor', v_alt);
end;
$$;

revoke all on function public.gast_aendern(text, json) from public;
grant execute on function public.gast_aendern(text, json) to anon, authenticated;
