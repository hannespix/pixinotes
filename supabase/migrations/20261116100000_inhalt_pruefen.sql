-- M388: Was Gäste in ein Board schreiben, wird geprüft.
--
-- Board-Dateien (konto_dateien, name „board-<Kennung>.json") werden nicht nur vom Besitzer geschrieben: Gäste per
-- Link (gast_schreiben, gast_aendern) und Gäste mit Konto (freigabe_schreiben, board_aendern) schreiben über
-- Funktionen mit Besitzer-Rechten hinein. Bisher wurde dabei nur die Länge geprüft. Ein Gast mit Schreibrecht
-- konnte so
--   · als Inhalt von Board X ein Board mit der Kennung Y ablegen — das Gerät des Besitzers hielt es für Y und
--     überschrieb damit dessen anderes Board;
--   · etwas ablegen, das kein Board ist — die App des Besitzers hielt das Board dann für gelöscht;
--   · Stücke ablegen, die keine Karten sind — der Abgleich des ganzen Kontos blieb daran hängen.
--
-- Ein Auslöser an der Tabelle prüft das jetzt an EINER Stelle, für alle vier Wege: Schreibt jemand anderes als
-- der Besitzer, muss der Inhalt ein Board mit der Kennung aus dem Dateinamen sein, und Karten, Verbindungen,
-- Striche und Gespräche müssen ihre Grundgestalt haben. Der Besitzer selbst und Verwaltungszugriffe (ohne
-- Anmelde-Rolle) bleiben ungeprüft — seine App schreibt, was sie liest, und alte Stände dürfen bleiben.
--
-- Fehler: P0003 „ungueltig" (wie in den Schreib-Funktionen).
--
-- Einspielen: Supabase Dashboard → SQL Editor → ausführen. Ohne diese Migration arbeitet die App wie bisher;
-- sie prüft seit M388 zusätzlich selbst, was sie vom Server liest.

create or replace function public.konto_dateien_inhalt_pruefen()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id text;
  v_rolle text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role', '');
  j jsonb;
  a jsonb := '{}'::jsonb;
begin
  if new.name !~ '^board-.+\.json$' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.inhalt is not distinct from old.inhalt then
    return new;
  end if;
  -- Verwaltung (SQL-Editor, service_role) und der Besitzer selbst
  if v_rolle not in ('anon', 'authenticated') or (auth.uid() is not null and auth.uid() = new.user_id) then
    return new;
  end if;
  v_id := substring(new.name from '^board-(.+)\.json$');
  begin
    j := new.inhalt::jsonb;
  exception when others then
    raise exception 'ungueltig' using errcode = 'P0003';
  end;
  if jsonb_typeof(j) <> 'object'
     or (j ? 'id' and (j->>'id') is distinct from v_id)
     or jsonb_typeof(j->'nodes') is distinct from 'array'
     or coalesce(jsonb_typeof(j->'edges'), 'array') <> 'array'
     or coalesce(jsonb_typeof(j->'drawings'), 'array') not in ('array', 'null')
     or coalesce(jsonb_typeof(j->'comments'), 'array') not in ('array', 'null') then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  -- Geprüft wird, was NEU oder GEÄNDERT ist: Ein altes Stück, das schon im Board des Besitzers lag, hält keinen
  -- Gast auf. (jsonb lässt sich vergleichen — die Differenz kostet einen Durchlauf, keine Schleife in der Schleife.)
  if tg_op = 'UPDATE' then
    begin
      a := old.inhalt::jsonb;
    exception when others then
      a := '{}'::jsonb;
    end;
  end if;
  if exists (
    select 1 from (
      select n from jsonb_array_elements(j->'nodes') as t(n)
      except
      select n from jsonb_array_elements(case when jsonb_typeof(a->'nodes') = 'array' then a->'nodes' else '[]'::jsonb end) as t(n)
    ) x
     where jsonb_typeof(n) <> 'object'
        or jsonb_typeof(n->'id') is distinct from 'string'
        or jsonb_typeof(n->'type') is distinct from 'string'
        or jsonb_typeof(n->'data') is distinct from 'object'
        or jsonb_typeof(n->'position'->'x') is distinct from 'number'
        or jsonb_typeof(n->'position'->'y') is distinct from 'number'
  ) or exists (
    select 1 from (
      select e from jsonb_array_elements(case when jsonb_typeof(j->'edges') = 'array' then j->'edges' else '[]'::jsonb end) as t(e)
      except
      select e from jsonb_array_elements(case when jsonb_typeof(a->'edges') = 'array' then a->'edges' else '[]'::jsonb end) as t(e)
    ) x
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e->'id') is distinct from 'string'
        or jsonb_typeof(e->'source') is distinct from 'string'
        or jsonb_typeof(e->'target') is distinct from 'string'
  ) or exists (
    select 1 from (
      select d from jsonb_array_elements(case when jsonb_typeof(j->'drawings') = 'array' then j->'drawings' else '[]'::jsonb end) as t(d)
      except
      select d from jsonb_array_elements(case when jsonb_typeof(a->'drawings') = 'array' then a->'drawings' else '[]'::jsonb end) as t(d)
    ) x
     where jsonb_typeof(d) <> 'object'
        or jsonb_typeof(d->'id') is distinct from 'string'
        or jsonb_typeof(d->'points') is distinct from 'array'
  ) or exists (
    select 1 from (
      select c from jsonb_array_elements(case when jsonb_typeof(j->'comments') = 'array' then j->'comments' else '[]'::jsonb end) as t(c)
      except
      select c from jsonb_array_elements(case when jsonb_typeof(a->'comments') = 'array' then a->'comments' else '[]'::jsonb end) as t(c)
    ) x
     where jsonb_typeof(c) <> 'object'
        or jsonb_typeof(c->'id') is distinct from 'string'
        or jsonb_typeof(c->'msgs') is distinct from 'array'
  ) then
    raise exception 'ungueltig' using errcode = 'P0003';
  end if;
  return new;
end;
$$;

drop trigger if exists konto_dateien_inhalt_pruefen on public.konto_dateien;
create trigger konto_dateien_inhalt_pruefen
  before insert or update on public.konto_dateien
  for each row execute function public.konto_dateien_inhalt_pruefen();
