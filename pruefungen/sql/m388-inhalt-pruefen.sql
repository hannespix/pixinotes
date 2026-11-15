-- M388: Der Auslöser konto_dateien_inhalt_pruefen gegen ein echtes Postgres.
-- Aufruf: pruefungen/m388b-sql-inhalt-pruefen.mjs — jede Zeile „OK …"/„FEHLER …" ist eine Prüfung.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

truncate public.board_freigaben, public.board_einladungen, public.konto_dateien;
delete from auth.users;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.de'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bernd@example.de');
-- Annas Konto: zwei Boards; in bx liegt ein ALTES Stück ohne Lage (aus früheren Zeiten) — es darf niemanden aufhalten
insert into public.konto_dateien (user_id, name, inhalt, mime, groesse) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'umgebung.json', '{"app":"pixinotes","version":1,"savedAt":"2026-11-15T08:00:00.000Z","activeId":"bx","spaces":[],"reihe":["bx","by"],"boards":{"bx":"abc:1","by":"abc:1"},"dateien":{}}', 'application/json', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'board-bx.json', '{"id":"bx","name":"Planung","nodes":[{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{"t":"eins"}},{"id":"alt","data":{"t":"ohne Lage"}}],"edges":[]}', 'application/json', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'board-by.json', '{"id":"by","name":"Privat","nodes":[{"id":"p1","type":"note","position":{"x":0,"y":0},"data":{"t":"privat"}}],"edges":[]}', 'application/json', 0);
insert into public.board_freigaben (besitzer, board_id, gast_email, gast_id, rolle) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bx', 'bernd@example.de', 'bbbbbbbb-0000-0000-0000-000000000002', 'bearbeiten');
insert into public.board_einladungen (token, besitzer, board_id, rolle, ohne_konto) values
  ('tok-12345678901234567890', 'aaaaaaaa-0000-0000-0000-000000000001', 'bx', 'bearbeiten', true);

create or replace function pg_temp.pruefe(name text, gut boolean, info text default '') returns text language sql as
$$ select case when gut then 'OK ' || name else 'FEHLER ' || name || ' — ' || coalesce(info, '') end $$;
create or replace function pg_temp.board(n text) returns jsonb language sql security definer as
$$ select inhalt::jsonb from public.konto_dateien where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = n $$;
create or replace function pg_temp.ver(n text) returns bigint language sql security definer as
$$ select version from public.konto_dateien where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = n $$;
create or replace function pg_temp.patch(p json) returns text language plpgsql as
$$ begin perform public.board_aendern('aaaaaaaa-0000-0000-0000-000000000001', 'bx', p); return 'ok'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.gastpatch(p json) returns text language plpgsql as
$$ begin perform public.gast_aendern('tok-12345678901234567890', p); return 'ok'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.gastganz(p text) returns text language plpgsql as
$$ begin perform public.gast_schreiben('tok-12345678901234567890', p, 'x:1', pg_temp.ver('board-bx.json')); return 'ok'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.kontoganz(p text) returns text language plpgsql as
$$ begin perform public.freigabe_schreiben('aaaaaaaa-0000-0000-0000-000000000001', 'bx', p, 'x:1', pg_temp.ver('board-bx.json')); return 'ok'; exception when others then return sqlerrm; end $$;
grant all on all functions in schema pg_temp to authenticated, anon;

-- ── A: Gast mit Konto (Bernd), wie über die Schnittstelle: Rolle „authenticated" ──
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false) \gset x_
select set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000002', false) \gset x_
select pg_temp.pruefe('A1 eine gültige Karte kommt an — das alte Stück ohne Lage hält Bernd nicht auf', pg_temp.patch('{"nodes":{"set":[{"id":"b1","type":"note","position":{"x":5,"y":6},"data":{"t":"von Bernd"}}]}}') = 'ok' and pg_temp.board('board-bx.json')->'nodes' @> '[{"id":"b1"}]', pg_temp.patch('{}'));
select pg_temp.pruefe('A2 eine Karte ohne Lage wird abgewiesen', pg_temp.patch('{"nodes":{"set":[{"id":"b2","type":"note","data":{"t":"x"}}]}}') = 'ungueltig', pg_temp.patch('{"nodes":{"set":[{"id":"b2","type":"note","data":{"t":"x"}}]}}'));
select pg_temp.pruefe('A3 eine Karte ohne Inhalt (data) wird abgewiesen', pg_temp.patch('{"nodes":{"set":[{"id":"b3","type":"note","position":{"x":1,"y":1}}]}}') = 'ungueltig', '');
select pg_temp.pruefe('A4 eine Lage aus Text wird abgewiesen', pg_temp.patch('{"nodes":{"set":[{"id":"b4","type":"note","position":{"x":"1","y":1},"data":{}}]}}') = 'ungueltig', '');
select pg_temp.pruefe('A5 eine Verbindung ohne Enden wird abgewiesen', pg_temp.patch('{"edges":{"set":[{"id":"e9"}]}}') = 'ungueltig', '');
select pg_temp.pruefe('A6 eine gültige Verbindung kommt an', pg_temp.patch('{"edges":{"set":[{"id":"e1","source":"k1","target":"b1"}]}}') = 'ok', '');
select pg_temp.pruefe('A7 ein Strich ohne Punkte / ein Gespräch ohne Beiträge werden abgewiesen', pg_temp.patch('{"drawings":{"set":[{"id":"s1"}]}}') = 'ungueltig' and pg_temp.patch('{"comments":{"set":[{"id":"c1"}]}}') = 'ungueltig', '');
select pg_temp.pruefe('A8 Strich und Gespräch in rechter Gestalt kommen an', pg_temp.patch('{"drawings":{"set":[{"id":"s1","points":[[1,2],[3,4]]}]},"comments":{"set":[{"id":"c1","nodeId":"k1","msgs":[{"text":"hallo"}]}]}}') = 'ok', '');
select pg_temp.pruefe('A9 nach den Abweisungen steht nichts Ungültiges im Board', not (pg_temp.board('board-bx.json')->'nodes' @> '[{"id":"b2"}]') and not (pg_temp.board('board-bx.json')->'nodes' @> '[{"id":"b4"}]') and jsonb_array_length(pg_temp.board('board-bx.json')->'edges') = 1, pg_temp.board('board-bx.json')::text);
-- ganzes Board schreiben (älterer Weg)
select pg_temp.pruefe('A10 ganzes Board mit FREMDER Kennung (by statt bx) wird abgewiesen — sonst überschriebe es Annas anderes Board', pg_temp.kontoganz('{"id":"by","name":"gekapert","nodes":[],"edges":[]}') = 'ungueltig' and pg_temp.board('board-bx.json')->>'id' = 'bx', pg_temp.kontoganz('{"id":"by","name":"gekapert","nodes":[],"edges":[]}'));
select pg_temp.pruefe('A11 etwas, das kein Board ist, wird abgewiesen', pg_temp.kontoganz('{"hallo":1}') = 'ungueltig' and pg_temp.kontoganz('[1,2,3]') = 'ungueltig' and pg_temp.kontoganz('{kaputt') = 'ungueltig', '');
select pg_temp.pruefe('A12 ein ganzes, gültiges Board kommt an', pg_temp.kontoganz('{"id":"bx","name":"Planung","nodes":[{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{"t":"eins neu"}}],"edges":[]}') = 'ok' and pg_temp.board('board-bx.json')->'nodes'->0->'data'->>'t' = 'eins neu', pg_temp.board('board-bx.json')::text);

-- ── B: Gast per Link (ohne Konto): Rolle „anon" ──
reset role;
set role anon;
select set_config('request.jwt.claim.role', 'anon', false) \gset x_
select set_config('test.uid', '', false) \gset x_
select pg_temp.pruefe('B1 Gast per Link: gültige Karte kommt an', pg_temp.gastpatch('{"nodes":{"set":[{"id":"g1","type":"note","position":{"x":9,"y":9},"data":{"von":"g:1","t":"Gast"}}]}}') = 'ok', pg_temp.gastpatch('{}'));
select pg_temp.pruefe('B2 Gast per Link: Karte, die keine ist, wird abgewiesen', pg_temp.gastpatch('{"nodes":{"set":[{"id":"g2"}]}}') = 'ungueltig', pg_temp.gastpatch('{"nodes":{"set":[{"id":"g2"}]}}'));
select pg_temp.pruefe('B3 Gast per Link: ganzes Board mit fremder Kennung wird abgewiesen', pg_temp.gastganz('{"id":"by","name":"x","nodes":[],"edges":[]}') = 'ungueltig', pg_temp.gastganz('{"id":"by","name":"x","nodes":[],"edges":[]}'));
select pg_temp.pruefe('B4 Annas anderes Board ist unberührt', pg_temp.board('board-by.json')->>'name' = 'Privat' and pg_temp.ver('board-by.json') = 1, pg_temp.board('board-by.json')::text);

-- ── C: die Besitzerin und die Verwaltung bleiben ungeprüft ──
reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false) \gset x_
select set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset x_
update public.konto_dateien set inhalt = '{"id":"bx","name":"Planung","nodes":[{"id":"eigenwillig"}],"edges":[]}' where name = 'board-bx.json';
select pg_temp.pruefe('C1 die Besitzerin schreibt ihr Board, wie ihre App es liefert — ohne Prüfung', pg_temp.board('board-bx.json')->'nodes'->0->>'id' = 'eigenwillig', '');
reset role;
select set_config('request.jwt.claim.role', '', false) \gset x_
select set_config('test.uid', '', false) \gset x_
update public.konto_dateien set inhalt = '{"id":"bx","name":"Planung","nodes":[{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{}}],"edges":[]}' where name = 'board-bx.json';
select pg_temp.pruefe('C2 Verwaltung (ohne Anmelde-Rolle) schreibt ungeprüft', pg_temp.board('board-bx.json')->'nodes'->0->>'id' = 'k1', '');
update public.konto_dateien set inhalt = '{"savedAt":"x"}' where name = 'umgebung.json';
select pg_temp.pruefe('C3 andere Dateien (Umgebung) prüft der Auslöser nicht', true, '');
