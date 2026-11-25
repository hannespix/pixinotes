-- M383: board_aendern gegen ein echtes Postgres (lokal; Supabase-Rollen und auth.uid() sind nachgestellt).
-- Aufruf: pruefungen/m383b-sql-board-aendern.mjs — jede Zeile „OK …"/„FEHLER …" ist eine Prüfung.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;

truncate public.board_freigaben, public.board_einladungen, public.konto_dateien;
delete from auth.users;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'anna@example.de'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bernd@example.de'),
  ('cccccccc-0000-0000-0000-000000000003', 'carla@example.de');
-- Annas Konto: Umgebung und ein Board (der Text mit Absicht eigenwillig gesetzt: json bewahrt ihn Zeichen für Zeichen)
insert into public.konto_dateien (user_id, name, inhalt, mime, groesse) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'umgebung.json', '{"app":"pixinotes","version":1,"savedAt":"2026-11-15T08:00:00.000Z","activeId":"bx","spaces":[],"reihe":["bx"],"boards":{"bx":"abc:1"},"dateien":{}}', 'application/json', 0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'board-bx.json', '{"id":"bx","name":"Planung","nodes":[{"id":"k1","position":{"x":1.50,"y":2},"data":{"t":"eins"}},{"id":"k2","data":{"t":"zwei"}},{"id":"k3","data":{"t":"drei"}}],"edges":[{"id":"e1","source":"k1","target":"k2"}],"bg":"sand"}', 'application/json', 0);
insert into public.board_freigaben (besitzer, board_id, gast_email, gast_id, rolle) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bx', 'bernd@example.de', 'bbbbbbbb-0000-0000-0000-000000000002', 'bearbeiten'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bx', 'carla@example.de', 'cccccccc-0000-0000-0000-000000000003', 'lesen');

create or replace function pg_temp.pruefe(name text, gut boolean, info text default '') returns text language sql as
$$ select case when gut then 'OK ' || name else 'FEHLER ' || name || ' — ' || coalesce(info, '') end $$;
create or replace function pg_temp.board() returns json language sql security definer as
$$ select inhalt::json from public.konto_dateien where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'board-bx.json' $$;
create or replace function pg_temp.um() returns jsonb language sql security definer as
$$ select inhalt::jsonb from public.konto_dateien where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = 'umgebung.json' $$;
create or replace function pg_temp.ver(n text) returns bigint language sql security definer as
$$ select version from public.konto_dateien where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name = n $$;
create or replace function pg_temp.ids(b json, art text) returns text language sql as
$$ select coalesce(string_agg(x->>'id', ',' order by ord), '') from json_array_elements(b->art) with ordinality as t(x, ord) $$;
/** Aufruf, der scheitern soll: liefert die Meldung */
create or replace function pg_temp.fehler(p_besitzer uuid, p_board text, p_patch json) returns text language plpgsql as
$$ begin perform public.board_aendern(p_besitzer, p_board, p_patch); return 'kein Fehler'; exception when others then return sqlerrm; end $$;
grant all on all functions in schema pg_temp to authenticated, anon;

-- ── A: die Besitzerin ──
set role authenticated;
select set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset x_
create temp table erg as select public.board_aendern('aaaaaaaa-0000-0000-0000-000000000001', 'bx',
  '{"nodes":{"set":[{"id":"k2","data":{"t":"ZWEI neu"}},{"id":"k9","data":{"t":"neun"}}],"del":["k3"]},"edges":{"del":["e1"]}}'::json,
  '2026-11-15T09:30:00.123Z') as r;
select pg_temp.pruefe('A1 Antwort nennt neue und vorige Version von Board und Umgebung', (r->>'version')::bigint = 2 and (r->>'vor')::bigint = 1 and (r->>'umgebung')::bigint = 2 and (r->>'umgebung_vor')::bigint = 1, r::text) from erg;
select pg_temp.pruefe('A2 gesetzt ersetzt an Ort und Stelle, Neues ans Ende, Gelöschtes weg', pg_temp.ids(pg_temp.board(), 'nodes') = 'k1,k2,k9' and pg_temp.board()->'nodes'->1->'data'->>'t' = 'ZWEI neu' and pg_temp.ids(pg_temp.board(), 'edges') = '', pg_temp.board()::text);
select pg_temp.pruefe('A3 die Angaben des Boards bleiben (Name, Tönung) — in ihrer Reihenfolge', pg_temp.board()->>'name' = 'Planung' and pg_temp.board()->>'bg' = 'sand' and (select string_agg(key, ',' order by ord) from json_each(pg_temp.board()) with ordinality as t(key, value, ord)) = 'id,name,nodes,edges,bg', (select string_agg(key, ',' order by ord) from json_each(pg_temp.board()) with ordinality as t(key, value, ord)));
select pg_temp.pruefe('A4 unberührte Karten bleiben Zeichen für Zeichen (1.50 bleibt 1.50)', position('"x":1.50' in pg_temp.board()::text) > 0, pg_temp.board()::text);
select pg_temp.pruefe('A5 Umgebung: Stempel „v2", Zeitpunkt des Geräts, Vorfahre = vorige Version', pg_temp.um()->'boards'->>'bx' = 'v2' and pg_temp.um()->>'savedAt' = '2026-11-15T09:30:00.123Z' and pg_temp.um()->>'basisEtag' = '1' and pg_temp.ver('umgebung.json') = 2, pg_temp.um()::text);
select pg_temp.pruefe('A6 die Größe der Zeile stimmt', (select groesse = length(inhalt) from public.konto_dateien where name = 'board-bx.json'), '');
drop table erg;
-- ein Zeitpunkt in fremder Form wird nicht übernommen
select public.board_aendern('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"drawings":{"set":[{"id":"s1","pts":[1,2]}]}}'::json, 'gestern <script>') \gset y_
select pg_temp.pruefe('A7 ein Zeitpunkt in fremder Form wird nicht übernommen (dann die Uhr des Servers)', pg_temp.um()->>'savedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' and pg_temp.um()->>'savedAt' <> '2026-11-15T09:30:00.123Z', pg_temp.um()->>'savedAt');
select pg_temp.pruefe('A8 eine Art, die es im Board noch nicht gab (Striche), kommt dazu', pg_temp.ids(pg_temp.board(), 'drawings') = 's1' and pg_temp.ids(pg_temp.board(), 'nodes') = 'k1,k2,k9', pg_temp.board()::text);

-- ── B: Gast mit Konto ──
select set_config('test.uid', 'bbbbbbbb-0000-0000-0000-000000000002', false) \gset x_
create temp table erg as select public.board_aendern('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"nodes":{"set":[{"id":"b1","data":{"t":"von Bernd"}}]}}'::json, '2030-01-01T00:00:00.000Z') as r;
select pg_temp.pruefe('B1 Bernd (Freigabe „bearbeiten") schreibt in Annas Zeile', pg_temp.ids(pg_temp.board(), 'nodes') = 'k1,k2,k9,b1' and (r->>'version')::bigint = 4 and (r->>'vor')::bigint = 3, r::text) from erg;
select pg_temp.pruefe('B2 Annas Umgebung: Stempel „v4"; der Zeitpunkt eines Gasts gilt nicht', pg_temp.um()->'boards'->>'bx' = 'v4' and pg_temp.um()->>'savedAt' <> '2030-01-01T00:00:00.000Z', pg_temp.um()::text);
select pg_temp.pruefe('B3 Bernd hat dafür keine eigene Zeile bekommen', (select count(*) from public.konto_dateien where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0);
drop table erg;

-- ── C: wer nicht darf ──
select set_config('test.uid', 'cccccccc-0000-0000-0000-000000000003', false) \gset x_
select pg_temp.pruefe('C1 Carla („nur lesen") wird abgelehnt', pg_temp.fehler('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"nodes":{"del":["k1"]}}'::json) = 'keine freigabe', pg_temp.fehler('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"nodes":{"del":["k1"]}}'::json));
select set_config('test.uid', 'dddddddd-0000-0000-0000-000000000004', false) \gset x_
select pg_temp.pruefe('C2 ein fremdes Konto ohne Freigabe wird abgelehnt', pg_temp.fehler('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"nodes":{"del":["k1"]}}'::json) = 'keine freigabe');
select set_config('test.uid', '', false) \gset x_
select pg_temp.pruefe('C3 ohne Anmeldung: abgelehnt', pg_temp.fehler('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"nodes":{"del":["k1"]}}'::json) = 'nicht angemeldet');
select pg_temp.pruefe('C4 nichts davon hat das Board geändert', pg_temp.ids(pg_temp.board(), 'nodes') = 'k1,k2,k9,b1' and pg_temp.ver('board-bx.json') = 4);
reset role;
select pg_temp.pruefe('C5 die Rolle anon darf die Funktion gar nicht aufrufen; die Hilfsfunktion niemand von außen', not has_function_privilege('anon', 'public.board_aendern(uuid, text, json, text, bigint, bigint)', 'execute') and has_function_privilege('authenticated', 'public.board_aendern(uuid, text, json, text, bigint, bigint)', 'execute') and not has_function_privilege('authenticated', 'public.board_patch_anwenden(json, json)', 'execute') and not has_function_privilege('anon', 'public.board_patch_anwenden(json, json)', 'execute'));

-- ── D: ungültig, fehlend ──
set role authenticated;
select set_config('test.uid', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset x_
select pg_temp.pruefe('D1 kein Objekt als Patch → ungültig', pg_temp.fehler('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '[1,2]'::json) = 'ungueltig');
select pg_temp.pruefe('D2 „set" ist keine Liste → ungültig', pg_temp.fehler('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"nodes":{"set":{"id":"x"}}}'::json) = 'ungueltig');
select pg_temp.pruefe('D3 ein Board, das es nicht gibt → abgelehnt', pg_temp.fehler('aaaaaaaa-0000-0000-0000-000000000001', 'gibtsnicht', '{"nodes":{"del":["k1"]}}'::json) = 'kein board');
reset role;
select pg_temp.pruefe('D4 denselben Patch noch einmal: derselbe Inhalt (Patches sind absolut)', (select pg_temp.ids((public.board_patch_anwenden(pg_temp.board(), '{"drawings":{"set":[{"id":"s1","pts":[1,2]}]}}'::json)), 'drawings')) = 's1');
select pg_temp.pruefe('D5 ein leerer Patch ändert den Inhalt nicht', (select public.board_patch_anwenden(pg_temp.board(), '{}'::json)::text = pg_temp.board()::text));

-- ── E: derselbe Patch über gast_aendern (Gast per Link) ergibt denselben Text ──
insert into public.konto_dateien (user_id, name, inhalt, mime, groesse)
  select user_id, 'board-by.json', inhalt, mime, groesse from public.konto_dateien where name = 'board-bx.json';
insert into public.board_einladungen (token, besitzer, board_id, rolle, ohne_konto) values ('tokentokentokentokentoken', 'aaaaaaaa-0000-0000-0000-000000000001', 'by', 'bearbeiten', true);
select public.gast_aendern('tokentokentokentokentoken', '{"nodes":{"set":[{"id":"k1","data":{"t":"EINS"}},{"id":"z","data":{}}],"del":["k9"]},"comments":{"set":[{"id":"c1","msgs":[]}]}}'::json) \gset g_
set role authenticated;
select public.board_aendern('aaaaaaaa-0000-0000-0000-000000000001', 'bx', '{"nodes":{"set":[{"id":"k1","data":{"t":"EINS"}},{"id":"z","data":{}}],"del":["k9"]},"comments":{"set":[{"id":"c1","msgs":[]}]}}'::json) \gset h_
reset role;
select pg_temp.pruefe('E1 board_aendern und gast_aendern rechnen gleich (Zeichen für Zeichen)', (select inhalt from public.konto_dateien where name = 'board-bx.json') = (select inhalt from public.konto_dateien where name = 'board-by.json'), (select inhalt from public.konto_dateien where name = 'board-bx.json'));
