/**
 * M538 — gast_aendern mit Vorbedingung gegen ein ECHTES Postgres (Gerüst aus m383b).
 * Braucht ein lokales Postgres (`service postgresql start`, Nutzer „postgres"); fehlt es, wird die Prüfung laut
 * übersprungen. Eigene Datenbank `pntest538` (parallel laufende SQL-Reihen anderer Meilensteine nutzen `pntest`).
 *
 *   1  Alle Migrationen der Reihe nach auf einer frischen Datenbank; danach gibt es genau EINE gast_aendern(text, json),
 *      Aufrufe mit benannten Parametern (wie PostgREST) lösen eindeutig auf, mit und ohne Vorbedingung im Patch; die
 *      neue Migration lässt sich wiederholen; ältere Migrationen erneut eingespielt legen KEINE zweite Fassung daneben,
 *      ein Entwurf mit anderer Parameterliste wird abgeräumt.
 *   2  Vorbedingung (`p_patch.wenn.version`): passende Version schreibt (Antwort mit `geprueft`), abweichende schreibt
 *      NICHTS und meldet „vorbedingung"; ohne sie wie bisher; eine ungültige wird abgewiesen. Rechte der Gäste und Inhaltsprüfung gelten weiter, auch mit
 *      Vorbedingung; anon darf die Funktion aufrufen.
 *
 * Eigener Aufruf des Datenbank-Clients: PN_PSQL="psql -q -X -h … -U …" (Vorgabe: als Nutzer postgres, lokal).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const PSQL = process.env.PN_PSQL ?? '';
const DB = 'pntest538';
const befehl = (db) => (PSQL ? ['sh', ['-c', `${PSQL}${db ? ` -d ${db}` : ''}`]] : ['su', ['postgres', '-c', `psql -q -X${db ? ` -d ${db}` : ''}`]]);
const sql = (text, db = DB) => { const [c, a] = befehl(db); const r = spawnSync(c, a, { input: text, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { aus: (r.stdout ?? '') + (r.stderr ?? ''), rc: r.status ?? 1 }; };
const wert = (text) => sql(`\\pset tuples_only on\n\\pset format unaligned\n${text}`).aus.trim();

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => { if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); } };

let da = sql('select 1;', '').rc === 0;
if (!da && !PSQL) { spawnSync('service', ['postgresql', 'start'], { encoding: 'utf8' }); da = sql('select 1;', '').rc === 0; }
if (!da) {
  console.log('  ÜBERSPRUNGEN: kein lokales Postgres erreichbar (service postgresql start / PN_PSQL) – gast_aendern wurde hier NICHT gegen eine echte Datenbank geprüft.');
  console.log('\n0 bestanden, 0 durchgefallen (übersprungen)');
  process.exit(0);
}

const dir = path.join(__repo, 'supabase', 'migrations');
const dateien = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const einspielen = (f) => sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(dir, f), 'utf8')}`);
const NEU = '20261125120000_gast_aendern_vorbedingung.sql';
const fassungen = () => wert(`select string_agg(p.oid::regprocedure::text, ' ; ' order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'gast_aendern';`);

console.log('\n════ 1: Migrationen, genau eine Fassung ════');
{
  const vor = readFileSync(path.join(__repo, 'pruefungen', 'sql', 'vorbereiten.sql'), 'utf8').replace(/\bpntest\b/g, DB);
  const v = sql(`\\set ON_ERROR_STOP 1\n${vor}`, '');
  pruefe('1a frische Prüf-Datenbank (Rollen, auth.uid(), Speicher-Schema nachgestellt)', v.rc === 0 && !/ERROR/.test(v.aus), v.aus.slice(-400));
  const fehler = [];
  for (const f of dateien) { const r = einspielen(f); if (r.rc !== 0 || /ERROR/.test(r.aus)) fehler.push(`${f}: ${r.aus.split('\n').filter((z) => /ERROR/.test(z)).join(' ')}`); }
  pruefe(`1b alle ${dateien.length} Migrationen laufen der Reihe nach durch (die neue ist dabei)`, fehler.length === 0 && dateien.includes(NEU), fehler.join(' | '));
  pruefe('1c danach gibt es genau EINE gast_aendern (text, json) — die Signatur bleibt', fassungen() === 'gast_aendern(text,json)', fassungen());
  // Aufrufe wie PostgREST: benannte Parameter. „keine freigabe" heißt: eindeutig gefunden und angelaufen.
  const aufruf = (patch) => sql(`set role anon;\nselect public.gast_aendern(p_token => 'gibtsnicht', p_patch => '${patch}'::json);`).aus;
  const zwei = aufruf('{}'); const drei = aufruf('{"wenn":{"version":3}}');
  pruefe('1d Aufrufe mit benannten Parametern lösen eindeutig auf (ältere App-Stände und mit Vorbedingung)', /keine freigabe/.test(zwei) && /keine freigabe/.test(drei) && !/not unique|does not exist/.test(zwei + drei), (zwei + drei).split('\n').filter((z) => /ERROR/.test(z)).join(' '));
  const nochmal = einspielen(NEU);
  pruefe('1e die neue Migration lässt sich ein zweites Mal einspielen', nochmal.rc === 0 && !/ERROR/.test(nochmal.aus) && fassungen() === 'gast_aendern(text,json)', nochmal.aus.slice(-300));
  // Ältere Migrationen erneut (Wiederholung der Kette): KEINE zweite Fassung daneben (Befund M536 bei board_aendern)
  einspielen('20261114200000_gast_aendern.sql'); einspielen('20261117100000_team_haertung.sql');
  pruefe('1f ältere Migrationen erneut eingespielt: weiter genau eine Fassung (Aufrufe bleiben eindeutig)', fassungen() === 'gast_aendern(text,json)' && /keine freigabe/.test(aufruf('{"wenn":{"version":3}}')), fassungen());
  // … und ein Entwurf mit anderer Parameterliste daneben → die neue Migration räumt ihn ab
  sql(`create function public.gast_aendern(p_token text) returns jsonb language sql as $$ select null::jsonb $$;`);
  const vorher = fassungen().split(' ; ').length;
  const dritt = einspielen(NEU);
  pruefe('1g steht ein Entwurf daneben, entfernt die neue Migration ihn', vorher === 2 && dritt.rc === 0 && !/ERROR/.test(dritt.aus) && fassungen() === 'gast_aendern(text,json)', `${vorher} → ${fassungen()} ${dritt.aus.slice(-200)}`);
  const recht = wert(`select has_function_privilege('anon', 'public.gast_aendern(text, json)', 'execute') and has_function_privilege('authenticated', 'public.gast_aendern(text, json)', 'execute');`);
  pruefe('1h anon und authenticated dürfen sie aufrufen (Gäste ohne Konto)', recht === 't', recht);
}

console.log('\n════ 2: Vorbedingung, Rechte, Inhalt ════');
{
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const T = 'tok-53853853853853853853';
  const aufbau = sql(`\\set ON_ERROR_STOP 1
truncate public.board_freigaben, public.board_einladungen, public.konto_dateien;
delete from auth.users;
insert into auth.users (id, email) values ('${A}', 'anna@example.de');
insert into public.konto_dateien (user_id, name, inhalt, mime, groesse) values
  ('${A}', 'umgebung.json', '{"app":"pixinotes","version":1,"savedAt":"2026-11-25T08:00:00.000Z","activeId":"bx","spaces":[],"reihe":["bx"],"boards":{"bx":"abc:1"},"dateien":{}}', 'application/json', 0),
  ('${A}', 'board-bx.json', '{"id":"bx","name":"Planung","nodes":[{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{"t":"eins"}},{"id":"g1","type":"note","position":{"x":300,"y":2},"data":{"von":"g:x1","t":"Gast"}}],"edges":[],"drawings":[],"comments":[]}', 'application/json', 0);
insert into public.board_einladungen (token, besitzer, board_id, rolle, ohne_konto, optionen) values ('${T}', '${A}', 'bx', 'bearbeiten', true, '{}');
create or replace function public.m538_fehler(p json, w bigint) returns text language plpgsql as
$$ begin perform public.gast_aendern('${T}', case when w is null then p else (p::jsonb || jsonb_build_object('wenn', jsonb_build_object('version', w)))::json end); return 'ok'; exception when others then return sqlerrm || ' [' || sqlstate || ']'; end $$;
grant execute on function public.m538_fehler(json, bigint) to anon;
`);
  pruefe('2a Board, Umgebung und Einladung angelegt', aufbau.rc === 0 && !/ERROR/.test(aufbau.aus), aufbau.aus.slice(-300));
  const ver = () => Number(wert(`select version from public.konto_dateien where name = 'board-bx.json';`));
  const text = () => wert(`select inhalt::json->'nodes'->0->'data'->>'t' from public.konto_dateien where name = 'board-bx.json';`);
  const v0 = ver();
  const r1 = wert(`set role anon;\nselect public.gast_aendern(p_token => '${T}', p_patch => '{"nodes":{"set":[{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{"t":"Gerds Text"}}]},"wenn":{"version":${v0}}}'::json);`);
  let j = {}; try { j = JSON.parse(r1.split('\n').pop()); } catch { /* bleibt leer */ }
  pruefe('2b passende Version: geschrieben, Antwort { version, vor, geprueft }', Number(j.version) === v0 + 1 && Number(j.vor) === v0 && j.geprueft === true && text() === 'Gerds Text', r1);
  const v1 = ver();
  const um1 = wert(`select inhalt::json->'boards'->>'bx' from public.konto_dateien where name = 'umgebung.json';`);
  pruefe('2c Umgebung des Besitzers trägt den Stempel „v<Version>" wie bisher', um1 === `v${v1}`, um1);
  const f = wert(`set role anon;\nselect public.m538_fehler('{"nodes":{"set":[{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{"t":"Hannas alter Text"}}]}}'::json, ${v0});`);
  pruefe('2d veraltete Version: „vorbedingung" (P0001)', /vorbedingung \[P0001\]/.test(f), f);
  pruefe('2e … und NICHTS geschrieben (Text, Version, Umgebung unverändert)', text() === 'Gerds Text' && ver() === v1
    && wert(`select inhalt::json->'boards'->>'bx' from public.konto_dateien where name = 'umgebung.json';`) === `v${v1}`, `${text()} ${ver()}`);
  const r2 = wert(`set role anon;\nselect public.gast_aendern('${T}', '{"nodes":{"set":[{"id":"n2","type":"note","position":{"x":9,"y":9},"data":{"t":"neu"}}]}}'::json);`);
  let j2 = {}; try { j2 = JSON.parse(r2.split('\n').pop()); } catch { /* */ }
  pruefe('2f ohne Vorbedingung (ältere App-Stände, Aufruf mit zwei Parametern): schreibt wie bisher', Number(j2.version) === v1 + 1, r2);
  // Rechte der Gäste gelten auch mit Vorbedingung
  wert(`update public.board_einladungen set optionen = '{"gastRecht":"eigenes"}' where token = '${T}';`);
  const v2 = ver();
  const g = wert(`set role anon;\nselect public.m538_fehler('{"nodes":{"set":[{"id":"k1","type":"note","position":{"x":1,"y":2},"data":{"t":"gekapert"}}]}}'::json, ${v2});`);
  pruefe('2g „eigenes": fremde Karte ändern bleibt abgewiesen, auch mit passender Vorbedingung', /nicht erlaubt/.test(g) && text() === 'Gerds Text' && ver() === v2, g);
  const gOk = wert(`set role anon;\nselect public.m538_fehler('{"nodes":{"set":[{"id":"g1","type":"note","position":{"x":300,"y":2},"data":{"von":"g:x1","t":"Gast neu"}}]}}'::json, ${v2});`);
  pruefe('2h … die eigene Gast-Karte mit Vorbedingung ändern geht', gOk === 'ok' && ver() === v2 + 1, gOk);
  // Inhaltsprüfung (M388) gilt weiter: eine Karte ohne Lage wird abgewiesen — auch mit passender Vorbedingung
  wert(`update public.board_einladungen set optionen = '{}' where token = '${T}';`);
  const v3 = ver();
  const kaputt = wert(`select set_config('request.jwt.claim.role', 'anon', false);\nset role anon;\nselect public.m538_fehler('{"nodes":{"set":[{"id":"b9","type":"note","data":{"t":"x"}}]}}'::json, ${v3});`);
  pruefe('2i die Inhaltsprüfung (M388) gilt mit Vorbedingung: Karte ohne Lage abgewiesen, nichts geschrieben', /ungueltig/.test(kaputt) && ver() === v3, kaputt);
  const v4 = ver();
  const ungueltig = wert(`set role anon;\nselect public.m538_fehler('{"nodes":{"set":[{"id":"g1","type":"note","position":{"x":1,"y":1},"data":{"von":"g:x1"}}]},"wenn":{"version":"drei"}}'::json, null);`);
  pruefe('2j eine Vorbedingung in falscher Form wird abgewiesen (nichts geschrieben)', /ungueltig/.test(ungueltig) && ver() === v4, ungueltig);
  sql(`drop function public.m538_fehler(json, bigint);`);
}

sql(`drop database if exists ${DB};`, '');
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
