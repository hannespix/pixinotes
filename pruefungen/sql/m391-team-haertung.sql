-- M391: Rechte der Gäste an Strichen und Verbindungen, Stempel-Länge, kein Anlegen über die Freigabe, Sperr-Reihenfolge.
-- Aufruf: pruefungen/m391b-sql-team-haertung.mjs — jede Zeile „OK …"/„FEHLER …" ist eine Prüfung.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

truncate public.board_freigaben, public.board_einladungen, public.konto_dateien;
delete from auth.users;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.de'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bernd@example.de');
create or replace function pg_temp.grund() returns text language sql as $$ select
  '{"id":"bx","name":"Planung","nodes":['
  || '{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{"t":"eins"}},'
  || '{"id":"k2","type":"note","position":{"x":300,"y":2},"data":{"t":"zwei"}},'
  || '{"id":"g1","type":"note","position":{"x":600,"y":2},"data":{"von":"g:x1","t":"Gast"}}],'
  || '"edges":[{"id":"e1","source":"k1","target":"k2","data":{"label":"führt zu","kind":"arrow"}},'
  || '{"id":"e2","source":"k1","target":"g1","data":{"label":"","kind":"arrow","von":"g:x1"}},'
  || '{"id":"e3","source":"k2","target":"g1","data":{"label":"alt","kind":"arrow"}}],'
  || '"drawings":[{"id":"s1","points":[[1,2],[3,4]]},{"id":"s2","points":[[5,6],[7,8]],"von":"g:x1"}],"comments":[]}' $$;
insert into public.konto_dateien (user_id, name, inhalt, mime, groesse) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'umgebung.json', '{"app":"pixinotes","version":1,"savedAt":"2026-11-15T08:00:00.000Z","activeId":"bx","spaces":[],"reihe":["bx"],"boards":{"bx":"abc:1"},"dateien":{}}', 'application/json', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'board-bx.json', pg_temp.grund(), 'application/json', 0);
insert into public.board_freigaben (besitzer, board_id, gast_email, gast_id, rolle) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bx', 'bernd@example.de', 'bbbbbbbb-0000-0000-0000-000000000002', 'bearbeiten'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bz', 'bernd@example.de', 'bbbbbbbb-0000-0000-0000-000000000002', 'bearbeiten');
insert into public.board_einladungen (token, besitzer, board_id, rolle, ohne_konto, optionen) values
  ('tok-12345678901234567890', 'aaaaaaaa-0000-0000-0000-000000000001', 'bx', 'bearbeiten', true, '{"gastRecht":"eigenes-loeschen"}');

create or replace function pg_temp.pruefe(name text, gut boolean, info text default '') returns text language sql as
$$ select case when gut then 'OK ' || name else 'FEHLER ' || name || ' — ' || coalesce(info, '') end $$;
create or replace function pg_temp.board() returns jsonb language sql security definer as
$$ select inhalt::jsonb from public.konto_dateien where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'board-bx.json' $$;
create or replace function pg_temp.ver(n text) returns bigint language sql security definer as
$$ select version from public.konto_dateien where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = n $$;
create or replace function pg_temp.zeilen() returns bigint language sql security definer as
$$ select count(*) from public.konto_dateien $$;
create or replace function pg_temp.recht(r text) returns void language sql security definer as
$$ update public.board_einladungen set optionen = jsonb_build_object('gastRecht', r) where token = 'tok-12345678901234567890' $$;
create or replace function pg_temp.zurueck() returns void language sql security definer as
$$ update public.konto_dateien set inhalt = pg_temp.grund() where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'board-bx.json' $$;
-- „nicht erlaubt" trägt den Code P0004 (assert_failure) — den fängt „when others" nicht, darum eigens genannt
create or replace function pg_temp.gastpatch(p json) returns text language plpgsql as
$$ begin perform public.gast_aendern('tok-12345678901234567890', p); return 'ok'; exception when assert_failure then return sqlerrm; when others then return sqlerrm; end $$;
create or replace function pg_temp.gastganz(p text, st text default 'x:1') returns text language plpgsql as
$$ begin perform public.gast_schreiben('tok-12345678901234567890', p, st, pg_temp.ver('board-bx.json')); return 'ok'; exception when assert_failure then return sqlerrm; when others then return sqlerrm; end $$;
create or replace function pg_temp.kontoganz(b text, p text, st text default 'x:1') returns text language plpgsql as
$$ begin perform public.freigabe_schreiben('aaaaaaaa-0000-0000-0000-000000000001', b, p, st, null); return 'ok'; exception when assert_failure then return sqlerrm; when others then return sqlerrm; end $$;
create or replace function pg_temp.hat(art text, kennung text) returns boolean language sql as
$$ select exists (select 1 from jsonb_array_elements(pg_temp.board()->art) x where x->>'id' = kennung) $$;
create or replace function pg_temp.kontoalt() returns text language plpgsql as
$$ begin perform public.konto_schreiben('[]'::jsonb, '{"app":"pixinotes"}', 1); return 'ok'; exception when assert_failure then return sqlerrm; when others then return sqlerrm; end $$;
grant all on all functions in schema pg_temp to authenticated, anon;

-- ── A: Gast per Link, Recht „eigenes-loeschen" ──
set role anon;
select set_config('request.jwt.claim.role', 'anon', false) \gset x_
select set_config('test.uid', '', false) \gset x_
select pg_temp.pruefe('A1 den Strich der Besitzerin löschen: abgewiesen', pg_temp.gastpatch('{"drawings":{"del":["s1"]}}') = 'nicht erlaubt' and pg_temp.hat('drawings', 's1'), pg_temp.gastpatch('{"drawings":{"del":["s1"]}}'));
select pg_temp.pruefe('A2 den Strich eines Gasts löschen: geht', pg_temp.gastpatch('{"drawings":{"del":["s2"]}}') = 'ok' and not pg_temp.hat('drawings', 's2'), '');
select pg_temp.pruefe('A3 die Verbindung der Besitzerin löschen: abgewiesen', pg_temp.gastpatch('{"edges":{"del":["e1"]}}') = 'nicht erlaubt' and pg_temp.hat('edges', 'e1'), pg_temp.gastpatch('{"edges":{"del":["e1"]}}'));
select pg_temp.pruefe('A4 die Verbindung eines Gasts löschen: geht', pg_temp.gastpatch('{"edges":{"del":["e2"]}}') = 'ok' and not pg_temp.hat('edges', 'e2'), '');
select pg_temp.pruefe('A5 „eigenes-loeschen" darf alles bearbeiten: die Beschriftung der fremden Verbindung ändern geht', pg_temp.gastpatch('{"edges":{"set":[{"id":"e1","source":"k1","target":"k2","data":{"label":"neu","kind":"arrow"}}]}}') = 'ok' and pg_temp.board()->'edges'->0->'data'->>'label' = 'neu', '');
select pg_temp.pruefe('A6 Neues anlegen geht: Strich und Verbindung', pg_temp.gastpatch('{"drawings":{"set":[{"id":"s9","points":[[1,1],[2,2]],"von":"g:x2"}]},"edges":{"set":[{"id":"e9","source":"k2","target":"k1","data":{"label":"","kind":"arrow","von":"g:x2"}}]}}') = 'ok' and pg_temp.hat('drawings', 's9') and pg_temp.hat('edges', 'e9'), '');
select pg_temp.pruefe('A7 die eigene Karte löschen nimmt die fremde Verbindung an ihr mit — das ist erlaubt', pg_temp.gastpatch('{"nodes":{"del":["g1"]},"edges":{"del":["e3"]}}') = 'ok' and not pg_temp.hat('nodes', 'g1') and not pg_temp.hat('edges', 'e3'), '');

-- ── B: Recht „eigenes" ──
reset role;
select pg_temp.zurueck();
select pg_temp.recht('eigenes');
set role anon;
select pg_temp.pruefe('B1 „eigenes": die fremde Verbindung umbeschriften: abgewiesen', pg_temp.gastpatch('{"edges":{"set":[{"id":"e1","source":"k1","target":"k2","data":{"label":"gekapert","kind":"arrow"}}]}}') = 'nicht erlaubt' and pg_temp.board()->'edges'->0->'data'->>'label' = 'führt zu', '');
select pg_temp.pruefe('B2 … umhängen ebenso', pg_temp.gastpatch('{"edges":{"set":[{"id":"e1","source":"k2","target":"k1","data":{"label":"führt zu","kind":"arrow"}}]}}') = 'nicht erlaubt', '');
select pg_temp.pruefe('B3 … unverändert mitschicken stört nicht', pg_temp.gastpatch('{"edges":{"set":[{"id":"e1","source":"k1","target":"k2","data":{"kind":"arrow","label":"führt zu"}}]}}') = 'ok', pg_temp.gastpatch('{"edges":{"set":[{"id":"e1","source":"k1","target":"k2","data":{"kind":"arrow","label":"führt zu"}}]}}'));
select pg_temp.pruefe('B4 die eigene Verbindung ändern geht', pg_temp.gastpatch('{"edges":{"set":[{"id":"e2","source":"k1","target":"g1","data":{"label":"meins","kind":"arrow","von":"g:x1"}}]}}') = 'ok', '');
-- ganzes Board (älterer Weg)
select pg_temp.pruefe('B5 ganzes Board ohne den Strich der Besitzerin: abgewiesen', pg_temp.gastganz(replace(pg_temp.board()::text, '{"id": "s1", "points": [[1, 2], [3, 4]]}, ', '')) = 'nicht erlaubt' and pg_temp.hat('drawings', 's1'), pg_temp.gastganz(replace(pg_temp.board()::text, '{"id": "s1", "points": [[1, 2], [3, 4]]}, ', '')));
select pg_temp.pruefe('B6 ganzes Board unverändert: geht', pg_temp.gastganz(pg_temp.board()::text) = 'ok', pg_temp.gastganz(pg_temp.board()::text));
select pg_temp.pruefe('B7 ein Stempel mit 300 Zeichen: abgewiesen', pg_temp.gastganz(pg_temp.board()::text, repeat('x', 300)) = 'ungueltig', pg_temp.gastganz(pg_temp.board()::text, repeat('x', 300)));

-- ── C: Recht „alles" ──
reset role;
select pg_temp.recht('alles');
set role anon;
select pg_temp.pruefe('C1 „alles": Strich und Verbindung der Besitzerin löschen geht', pg_temp.gastpatch('{"drawings":{"del":["s1"]},"edges":{"del":["e1"]}}') = 'ok' and not pg_temp.hat('drawings', 's1') and not pg_temp.hat('edges', 'e1'), '');

-- ── D: Gast mit Konto (Bernd) ──
reset role;
select pg_temp.zurueck();
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false) \gset x_
select set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000002', false) \gset x_
select pg_temp.pruefe('D1 freigabe_schreiben mit 300 Zeichen Stempel: abgewiesen', pg_temp.kontoganz('bx', pg_temp.board()::text, repeat('x', 300)) = 'ungueltig', pg_temp.kontoganz('bx', pg_temp.board()::text, repeat('x', 300)));
select pg_temp.pruefe('D2 freigabe_schreiben für ein Board, das es bei der Besitzerin nicht gibt: abgewiesen — keine Zeile entsteht', pg_temp.kontoganz('bz', '{"id":"bz","name":"neu","nodes":[],"edges":[]}') = 'keine freigabe' and pg_temp.zeilen() = 2, pg_temp.kontoganz('bz', '{"id":"bz","name":"neu","nodes":[],"edges":[]}') || ' ' || pg_temp.zeilen());
select pg_temp.pruefe('D3 freigabe_schreiben für das geteilte Board: geht', pg_temp.kontoganz('bx', pg_temp.board()::text) = 'ok', pg_temp.kontoganz('bx', pg_temp.board()::text));

-- ── E: die Besitzerin (Anna) speichert wie immer; Sperr-Reihenfolge ──
select set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset x_
select pg_temp.pruefe('E1 konto_schreiben schreibt Board und Umgebung und liefert die neue Version',
  public.konto_schreiben(jsonb_build_array(jsonb_build_object('name', 'board-bx.json', 'inhalt', pg_temp.grund(), 'mime', 'application/json', 'groesse', 10)), '{"app":"pixinotes","savedAt":"2026-11-16T08:00:00.000Z","boards":{"bx":"neu:1"}}', pg_temp.ver('umgebung.json')) = pg_temp.ver('umgebung.json'), '');
select pg_temp.pruefe('E2 konto_schreiben mit veralteter Version: Vorbedingung', pg_temp.kontoalt() = 'vorbedingung', pg_temp.kontoalt());
reset role;
select pg_temp.pruefe('E3 konto_schreiben sperrt erst die Dateien, dann die Umgebung (wie die Gast-Funktionen: Board → Umgebung)',
  position('order by name' in pg_get_functiondef('public.konto_schreiben(jsonb,text,bigint)'::regprocedure)) > 0
  and position('order by name' in pg_get_functiondef('public.konto_schreiben(jsonb,text,bigint)'::regprocedure)) < position('name = ''umgebung.json''' in pg_get_functiondef('public.konto_schreiben(jsonb,text,bigint)'::regprocedure)), '');
select pg_temp.pruefe('E4 die Prüf-Funktion ist von außen nicht aufrufbar', not has_function_privilege('anon', 'public.gast_stuecke_pruefen(json,json,text)', 'execute') and not has_function_privilege('authenticated', 'public.gast_stuecke_pruefen(json,json,text)', 'execute'), '');
