-- M383: Karten einzeln schreiben — auch für den Besitzer und für Gäste mit Konto.
--
-- Bisher schrieb ein Gerät mit Konto nach jeder Änderung das ganze Board (konto_schreiben bzw.
-- freigabe_schreiben) und verlangte dabei die Version, auf der es aufbaut. Bei großen Boards reist so jedes Mal
-- alles; schreiben zwei zugleich, scheitert einer an der Vorbedingung, liest alles neu und führt zusammen.
-- Gäste per Link können seit M366 mehr: gast_aendern nimmt nur, was sich geändert hat. board_aendern bringt
-- denselben Weg für angemeldete Konten:
--
--   p_patch = { "nodes":    { "set": [ <Karte>, … ], "del": [ "<Kennung>", … ] },
--               "edges":    { … }, "drawings": { … }, "comments": { … } }
--
-- Der Server fügt es unter der Zeilensperre in das gespeicherte Board ein — ohne Vorbedingung. Gesetzte Objekte
-- ersetzen ihr Gegenstück (gleiche Kennung) an Ort und Stelle oder kommen ans Ende; gelöschte fallen heraus.
-- Schreiben darf der Besitzer selbst und wer eine Freigabe „bearbeiten" für das Board hat.
--
-- Antwort: { version, vor, umgebung, umgebung_vor } — neue und vorige Version des Boards und der Umgebung des
-- Besitzers. Stimmt „vor" mit dem überein, was das Gerät zuletzt kannte, hat niemand dazwischen geschrieben;
-- sonst holt es den Stand (seine Änderung ist dann schon eingearbeitet).
--
-- In der Umgebung des Besitzers steht als Stempel „v<Version>" (wie bei gast_aendern), als savedAt der vom
-- Besitzer genannte Zeitpunkt (p_saved_at) — so hält sein Gerät den eigenen Schreibvorgang nicht für fremd.
--
-- Dazu M384: board_freigaben.dateien — signierte Adressen der Anhänge und Tool-Quelltexte eines geteilten
-- Boards, vom Gerät des Besitzers eingetragen (wie board_einladungen.dateien für Gäste per Link). Der Gast
-- liest sie mit seiner Freigabe (bestehende Regel „Gast sieht seine Freigaben").
--
-- Einspielen: Supabase Dashboard → SQL Editor → ausführen. Ohne diese Migration arbeitet die App wie bisher.

-- Ein Patch auf ein Board anwenden (dieselbe Rechnung wie in gast_aendern)
create or replace function public.board_patch_anwenden(p_board json, p_patch json)
returns json
language plpgsql
immutable
set search_path = public
as $$
declare
  b json := p_board;
  art text;
  arr json;
  v_set json;
  v_del jsonb;
begin
  if p_patch is null or json_typeof(p_patch) <> 'object' or b is null or json_typeof(b) <> 'object' then
    raise exception 'ungueltig' using errcode = 'P0003';
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
  return b;
end;
$$;

revoke all on function public.board_patch_anwenden(json, json) from public, anon, authenticated;

create or replace function public.board_aendern(p_besitzer uuid, p_board_id text, p_patch json, p_saved_at text default null)
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
  -- erst das Board, dann die Umgebung — dieselbe Reihenfolge wie gast_aendern und freigabe_schreiben
  select version, inhalt into v_alt, v_text from public.konto_dateien
   where user_id = p_besitzer and name = v_name for update;
  if v_alt is null then
    raise exception 'kein board' using errcode = 'P0002';
  end if;
  v_text := public.board_patch_anwenden(v_text::json, p_patch)::text;
  update public.konto_dateien set inhalt = v_text, groesse = length(v_text)
   where user_id = p_besitzer and name = v_name
  returning version into v_neu;
  select version into v_um_alt from public.konto_dateien
   where user_id = p_besitzer and name = 'umgebung.json' for update;
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
  return jsonb_build_object('version', v_neu, 'vor', v_alt, 'umgebung', v_um_neu, 'umgebung_vor', v_um_alt);
end;
$$;

revoke all on function public.board_aendern(uuid, text, json, text) from public, anon;
grant execute on function public.board_aendern(uuid, text, json, text) to authenticated;

-- M384: Anhänge und Tool-Quelltexte für Gäste mit Konto
alter table public.board_freigaben
  add column if not exists dateien jsonb not null default '[]'::jsonb;
comment on column public.board_freigaben.dateien is 'M384: signierte Adressen der Anhänge des Boards [{id,name,mime,groesse,url}] — trägt das Gerät des Besitzers ein.';
