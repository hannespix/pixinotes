-- M365: Was dürfen Gäste? — Option des Besitzers am Einladungslink.
--
-- board_einladungen.optionen = { "gastRecht": "alles" | "eigenes-loeschen" | "eigenes" }
--   alles             – Gäste bearbeiten und löschen alles (Vorgabe)
--   eigenes-loeschen  – Gäste bearbeiten alles, löschen (oder archivieren) aber nur, was Gäste angelegt haben
--   eigenes           – Gäste ändern nur, was Gäste angelegt haben; alles andere steht fest
--
-- Jede Karte trägt in data.von, wer sie angelegt hat: Gäste per Link „g:<Gerät>", Konten „k:<Nutzer>";
-- Karten von vor der Gruppenarbeit tragen nichts und gehören damit dem Besitzer. Die App hält die Rechte selbst
-- ein (auch zwischen den Gästen). gast_schreiben prüft zusätzlich, was sich ohne Anmeldung sicher prüfen lässt:
-- Ein Gast per Link kann keine Karte löschen, archivieren oder (bei „eigenes") ändern, die nicht von einem Gast
-- per Link stammt, keine Ersteller-Kennung umschreiben und Neues nur als Gast-Karte anlegen.
--
-- Einspielen: Supabase Dashboard → SQL Editor → ausführen.

alter table public.board_einladungen
  add column if not exists optionen jsonb not null default '{}'::jsonb;
comment on column public.board_einladungen.optionen is 'M365: Rechte der Gäste dieses Links — { gastRecht: alles | eigenes-loeschen | eigenes }.';

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
  return jsonb_build_object(
    'kanal', public.board_kanal_intern(p_besitzer, p_board_id),
    'optionen', coalesce((select e.optionen from public.board_einladungen e where e.besitzer = p_besitzer and e.board_id = p_board_id), '{}'::jsonb)
  );
end;
$$;

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
    'kanal', public.board_kanal_intern(e.besitzer, e.board_id),
    'optionen', e.optionen
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
  select jsonb_build_object('version', d.version, 'rolle', e.rolle, 'optionen', e.optionen)
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
  update public.konto_dateien set inhalt = p_inhalt, groesse = length(p_inhalt)
   where user_id = e.besitzer and name = v_name
  returning version into v_neu;
  update public.konto_dateien
     set inhalt = jsonb_set(jsonb_set(jsonb_set(inhalt::jsonb, array['boards', e.board_id], to_jsonb(p_stempel), true), '{savedAt}', to_jsonb(v_jetzt), true), '{basisEtag}', to_jsonb(version::text), true)::text
   where user_id = e.besitzer and name = 'umgebung.json';
  return v_neu;
end;
$$;
