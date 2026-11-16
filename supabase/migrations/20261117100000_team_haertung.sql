-- M391: Team-Audit — was beim Code-Audit (docs/AUDIT.md, S9 · A12 · A13) für die Zusammenarbeit offen blieb.
--
--   1  „Nur Eigenes" gilt auch für Striche und Verbindungen. Bisher prüfte der Server die Rechte der Gäste per Link
--      nur an Karten: Mit einem selbst gebauten Aufruf ließen sich die Zeichnungen und Pfeile des Besitzers löschen,
--      obwohl er das ausgeschlossen hatte. Jetzt gilt (wie in der App): Ein Strich, den kein Gast gezeichnet hat,
--      bleibt. Eine Verbindung, die kein Gast gezogen hat, bleibt, solange ihre beiden Karten bleiben — und bei
--      „eigenes" bleibt sie auch unverändert. Kommentare sind ein Gespräch und tragen nur einen Namen; sie prüft
--      weiter die App.
--   2  p_stempel ist begrenzt (200 Zeichen, keine Steuerzeichen): Er wird in die Umgebung des Besitzers geschrieben.
--   3  freigabe_schreiben legt keine Zeile mehr an: Gibt es das Board beim Besitzer nicht (mehr), ist die Freigabe
--      gegenstandslos — vorher entstand das Board dort neu.
--   4  Eine Sperr-Reihenfolge für alle: erst die Board-Dateien, dann die Umgebung. konto_schreiben hielt es umgekehrt.
--
-- Wiederholbar: nur „create or replace". Einspielen: Supabase Dashboard → SQL Editor → ausführen.

create or replace function public.gast_stuecke_pruefen(p_alt json, p_neu json, p_recht text)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_recht is null or p_recht not in ('eigenes-loeschen', 'eigenes') then
    return;
  end if;
  -- Striche: Was kein Gast per Link gezeichnet hat, verschwindet nicht
  if exists (
    select 1
      from json_array_elements(coalesce(p_alt->'drawings', '[]'::json)) as a
     where coalesce(a->>'von', '') not like 'g:%'
       and not exists (select 1 from json_array_elements(coalesce(p_neu->'drawings', '[]'::json)) as n where n->>'id' = a->>'id')
  ) then
    raise exception 'nicht erlaubt' using errcode = 'P0004';
  end if;
  -- Verbindungen: Was kein Gast gezogen hat, bleibt, solange beide Karten bleiben; bei „eigenes" auch unverändert
  if exists (
    select 1
      from json_array_elements(coalesce(p_alt->'edges', '[]'::json)) as a
     where coalesce(a->'data'->>'von', '') not like 'g:%'
       and exists (select 1 from json_array_elements(coalesce(p_neu->'nodes', '[]'::json)) as k where k->>'id' = a->>'source')
       and exists (select 1 from json_array_elements(coalesce(p_neu->'nodes', '[]'::json)) as k where k->>'id' = a->>'target')
       and not exists (
         select 1 from json_array_elements(coalesce(p_neu->'edges', '[]'::json)) as n
          where n->>'id' = a->>'id'
            and ( p_recht <> 'eigenes'
               or ( (n->>'source') is not distinct from (a->>'source')
                and (n->>'target') is not distinct from (a->>'target')
                and (n->'data')::jsonb is not distinct from (a->'data')::jsonb ) ) )
  ) then
    raise exception 'nicht erlaubt' using errcode = 'P0004';
  end if;
end;
$$;

revoke all on function public.gast_stuecke_pruefen(json, json, text) from public, anon, authenticated;

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
  -- M391: Striche und Verbindungen, die kein Gast angelegt hat, bleiben
  perform public.gast_stuecke_pruefen(v_text::json, b, v_recht);
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
  v_alt_inhalt text;
  v_neu bigint;
  v_name text;
  v_recht text;
  v_jetzt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into e from public.board_einladungen where token = p_token and ohne_konto;
  if not found or e.rolle <> 'bearbeiten' then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  -- M391: Der Stempel landet in der Umgebung des Besitzers — kurz und ohne Steuerzeichen
  if p_stempel is null or length(p_stempel) > 200 or p_stempel ~ '[\x01-\x1f]' then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  if p_inhalt is null or length(p_inhalt) > 12000000 or left(ltrim(p_inhalt), 1) <> '{' then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  v_name := 'board-' || e.board_id || '.json';
  select version, inhalt into v_alt, v_alt_inhalt from public.konto_dateien
   where user_id = e.besitzer and name = v_name for update;
  if v_alt is null then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
  if p_wenn_version is null or v_alt is distinct from p_wenn_version then
    raise exception 'vorbedingung' using errcode = 'P0001';
  end if;
  v_recht := coalesce(e.optionen->>'gastRecht', 'alles');
  if v_recht in ('eigenes-loeschen', 'eigenes') then
    if exists (
      -- Karten, die nicht von einem Gast per Link stammen: nicht löschen, nicht archivieren, Kennung nicht
      -- umschreiben — und bei „eigenes" auch Inhalt und Lage nicht ändern
      select 1
        from jsonb_array_elements(coalesce(v_alt_inhalt::jsonb->'nodes', '[]'::jsonb)) as a
        left join jsonb_array_elements(coalesce(p_inhalt::jsonb->'nodes', '[]'::jsonb)) as n on n->>'id' = a->>'id'
       where coalesce(a->'data'->>'von', '') not like 'g:%'
         and ( n is null
            or coalesce(n->>'archived', 'false') <> coalesce(a->>'archived', 'false')
            or (n->'data'->>'von') is distinct from (a->'data'->>'von')
            or (v_recht = 'eigenes' and (
                 (n->'data') is distinct from (a->'data')
              or (n->'position') is distinct from (a->'position')
              or (n->>'parentId') is distinct from (a->>'parentId')
              or (n->>'type') is distinct from (a->>'type')))
         )
    ) or exists (
      -- Neues kommt als Gast-Karte
      select 1
        from jsonb_array_elements(coalesce(p_inhalt::jsonb->'nodes', '[]'::jsonb)) as n
        left join jsonb_array_elements(coalesce(v_alt_inhalt::jsonb->'nodes', '[]'::jsonb)) as a on a->>'id' = n->>'id'
       where a is null and coalesce(n->'data'->>'von', '') not like 'g:%'
    ) then
      raise exception 'nicht erlaubt' using errcode = 'P0004';
    end if;
  end if;
  -- M391: Striche und Verbindungen, die kein Gast angelegt hat, bleiben
  perform public.gast_stuecke_pruefen(v_alt_inhalt::json, p_inhalt::json, v_recht);
  update public.konto_dateien set inhalt = p_inhalt, groesse = length(p_inhalt)
   where user_id = e.besitzer and name = v_name
  returning version into v_neu;
  update public.konto_dateien
     set inhalt = jsonb_set(jsonb_set(jsonb_set(inhalt::jsonb, array['boards', e.board_id], to_jsonb(p_stempel), true), '{savedAt}', to_jsonb(v_jetzt), true), '{basisEtag}', to_jsonb(version::text), true)::text
   where user_id = e.besitzer and name = 'umgebung.json';
  return v_neu;
end;
$$;

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
  -- M391: Stempel begrenzen; und ein Board, das es beim Besitzer nicht (mehr) gibt, legt ein Gast nicht an
  if p_stempel is null or length(p_stempel) > 200 or p_stempel ~ '[\x01-\x1f]' then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  select version into v_alt from public.konto_dateien
   where user_id = p_besitzer and name = v_name for update;
  if v_alt is null then
    raise exception 'keine freigabe' using errcode = 'P0002';
  end if;
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

create or replace function public.konto_schreiben(
  p_dateien jsonb,
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
  -- M391: Erst die Dateien sperren, die gleich geschrieben werden (in fester Reihenfolge), DANN die Umgebung —
  -- dieselbe Reihenfolge wie gast_aendern, gast_schreiben, freigabe_schreiben und board_aendern (Board → Umgebung).
  -- Umgekehrt konnten sich das Speichern des Besitzers und das eines Gasts gegenseitig blockieren (Deadlock).
  perform 1 from public.konto_dateien
    where user_id = auth.uid()
      and name in (select d2->>'name' from jsonb_array_elements(coalesce(p_dateien, '[]'::jsonb)) as d2)
    order by name
    for update;
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
  insert into public.konto_dateien (user_id, name, inhalt, mime, groesse)
  values (auth.uid(), 'umgebung.json', p_umgebung, 'application/json', length(p_umgebung))
  on conflict (user_id, name) do update
    set inhalt = excluded.inhalt, groesse = excluded.groesse
  returning version into v_neu;
  return v_neu;
end;
$$;

revoke all on function public.gast_aendern(text, json) from public;
grant execute on function public.gast_aendern(text, json) to anon, authenticated;
revoke all on function public.gast_schreiben(text, text, text, bigint) from public;
grant execute on function public.gast_schreiben(text, text, text, bigint) to anon, authenticated;
revoke all on function public.freigabe_schreiben(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.freigabe_schreiben(uuid, text, text, text, bigint) to authenticated;
revoke all on function public.konto_schreiben(jsonb, text, bigint) from public;
grant execute on function public.konto_schreiben(jsonb, text, bigint) to authenticated;
