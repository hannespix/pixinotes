/**
 * M383 — board_aendern gegen ein ECHTES Postgres (nicht nur gegen das nachgebaute Supabase der Browser-Prüfung).
 * Braucht ein lokales Postgres (in der Entwicklungsumgebung vorhanden: `service postgresql start`, Nutzer
 * „postgres"). Fehlt es, wird die Prüfung übersprungen — laut, nicht still.
 *
 *   1  Alle Migrationen aus supabase/migrations spielen sich der Reihe nach ein (Supabase-Rollen, auth.uid()
 *      und das Speicher-Schema sind nachgestellt: pruefungen/sql/vorbereiten.sql).
 *   2  pruefungen/sql/m383-board-aendern.sql: Besitzerin, Gast mit Konto, Abgelehnte, Ungültiges, Gleichheit
 *      mit gast_aendern.
 *   3  Zwei Verbindungen schreiben gleichzeitig je 60 Karten in dasselbe Board → alle 120 stehen darin, die
 *      Versionen zählen lückenlos, der Stempel in der Umgebung ist der letzte.
 *
 * Eigener Aufruf des Datenbank-Clients: PN_PSQL="psql -q -X -h … -U …" (Vorgabe: als Nutzer postgres, lokal).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const PSQL = process.env.PN_PSQL ?? '';
const DB = 'pntest';
const befehl = (db) => (PSQL ? ['sh', ['-c', `${PSQL}${db ? ` -d ${db}` : ''}`]] : ['su', ['postgres', '-c', `psql -q -X${db ? ` -d ${db}` : ''}`]]);
const sql = (text, db = DB) => { const [c, a] = befehl(db); const r = spawnSync(c, a, { input: text, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { aus: (r.stdout ?? '') + (r.stderr ?? ''), rc: r.status ?? 1 }; };
const sqlNebenher = (text) => new Promise((fertig) => { const [c, a] = befehl(DB); const p = spawn(c, a); let aus = ''; p.stdout.on('data', (d) => { aus += d; }); p.stderr.on('data', (d) => { aus += d; }); p.on('close', (rc) => fertig({ aus, rc })); p.stdin.end(text); });

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => { if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); } };

// ---------- Ist ein Postgres da? ----------
let da = sql('select 1;', '').rc === 0;
if (!da && !PSQL) { spawnSync('service', ['postgresql', 'start'], { encoding: 'utf8' }); da = sql('select 1;', '').rc === 0; }
if (!da) {
  console.log('  ÜBERSPRUNGEN: kein lokales Postgres erreichbar (service postgresql start / PN_PSQL) – board_aendern wurde hier NICHT gegen eine echte Datenbank geprüft.');
  console.log('\n0 bestanden, 0 durchgefallen (übersprungen)');
  process.exit(0);
}

console.log('\n════ 1: Migrationen einspielen ════');
{
  const v = sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(__repo, 'pruefungen', 'sql', 'vorbereiten.sql'), 'utf8')}`, '');
  pruefe('1a die Prüf-Datenbank steht (Rollen, auth.uid(), Speicher-Schema nachgestellt)', v.rc === 0 && !/ERROR/.test(v.aus), v.aus.slice(-400));
  const dir = path.join(__repo, 'supabase', 'migrations');
  const dateien = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const fehler = [];
  for (const f of dateien) {
    const r = sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(dir, f), 'utf8')}`);
    if (r.rc !== 0 || /ERROR/.test(r.aus)) fehler.push(`${f}: ${r.aus.split('\n').filter((z) => /ERROR/.test(z)).join(' ')}`);
  }
  pruefe(`1b alle ${dateien.length} Migrationen laufen der Reihe nach durch`, fehler.length === 0 && dateien.some((f) => /board_aendern/.test(f)), fehler.join(' | '));
  // M536: die JÜNGSTE Migration zu board_aendern wiederholen. Vorher nahm `find` die erste (M383) — die legte nach
  // M529 die alte Fassung mit vier Parametern NEBEN die neue, und jeder Aufruf war mehrdeutig („is not unique").
  const neueste = dateien.filter((f) => /board_aendern/.test(f)).at(-1);
  const zwei = sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(dir, neueste), 'utf8')}`);
  pruefe(`1c die neueste Migration (${neueste}) lässt sich ein zweites Mal einspielen (nichts doppelt, kein Fehler)`, zwei.rc === 0 && !/ERROR/.test(zwei.aus), zwei.aus.slice(-300));
  const fassungen = () => sql(`\\pset tuples_only on\n\\pset format unaligned\nselect string_agg(p.oid::regprocedure::text, ' ; ' order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'board_aendern';`).aus.trim();
  const eine = fassungen();
  pruefe('1d danach gibt es genau EINE board_aendern (keine Überladung, die PostgREST mehrdeutig macht)', eine.split(' ; ').length === 1, eine);
  // Aufrufe wie PostgREST: benannte Parameter, alte App-Stände mit vier, neue mit sechs. „kein board" heißt: die
  // Funktion wurde eindeutig gefunden und lief an (die Prüf-Datenbank hat hier noch kein Board).
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const aufruf = (extra) => sql(`set role authenticated;\nselect set_config('test.uid', '${A}', false);\nselect public.board_aendern(p_besitzer => '${A}', p_board_id => 'm536-nichtda', p_patch => '{}'::json, p_saved_at => null${extra});`).aus;
  const vier = aufruf(''); const sechs = aufruf(', p_wenn_umgebung => 1, p_wenn_version => null');
  pruefe('1e Aufrufe mit 4 und mit 6 benannten Parametern lösen eindeutig auf', /kein board/.test(vier) && /kein board/.test(sechs) && !/not unique|does not exist/.test(vier + sechs), (vier + sechs).split('\n').filter((z) => /ERROR/.test(z)).join(' '));
  // Die alte Migration noch einmal (Wiederholung der Kette) und eine fremde Fassung aus einem Entwurf: die neue
  // Migration räumt beide ab.
  const alt = dateien.filter((f) => /board_aendern/.test(f))[0];
  sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(dir, alt), 'utf8')}`);
  sql(`create function public.board_aendern(p_besitzer uuid, p_board_id text, p_patch json) returns jsonb language sql as $$ select null::jsonb $$;`);
  const vorAufraeumen = fassungen().split(' ; ').length;
  const drei = sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(dir, neueste), 'utf8')}`);
  const nachAufraeumen = fassungen();
  pruefe('1f stehen andere Fassungen daneben (alte Migration erneut, Entwurf), entfernt die neueste Migration sie alle', vorAufraeumen === 3 && drei.rc === 0 && !/ERROR/.test(drei.aus) && nachAufraeumen === 'board_aendern(uuid,text,json,text,bigint,bigint)', `${vorAufraeumen} → ${nachAufraeumen} ${drei.aus.slice(-200)}`);
}

console.log('\n════ 2: board_aendern – Rechte, Rechnung, Antwort ════');
{
  const r = sql(readFileSync(path.join(__repo, 'pruefungen', 'sql', 'm383-board-aendern.sql'), 'utf8'));
  const zeilen = r.aus.split('\n').filter((z) => /^(OK|FEHLER) /.test(z));
  for (const z of zeilen) pruefe(z.replace(/^(OK|FEHLER) /, '2 ').split(' — ')[0], z.startsWith('OK '), z);
  pruefe('2 die SQL-Prüfung lief bis zum Ende (22 Prüfungen, kein Abbruch)', r.rc === 0 && zeilen.length === 22 && !/ERROR/.test(r.aus), `${zeilen.length} ${r.aus.split('\n').filter((z) => /ERROR/.test(z)).join(' ')}`);
}

console.log('\n════ 3: zwei schreiben gleichzeitig ════');
{
  const A = 'aaaaaaaa-0000-0000-0000-000000000001'; const B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const vorher = sql(`\\pset tuples_only on\n\\pset format unaligned\nselect version from public.konto_dateien where user_id = '${A}' and name = 'board-bx.json';`).aus.trim();
  const lauf = (uid, kuerzel) => `set role authenticated;\nselect set_config('test.uid', '${uid}', false);\n${Array.from({ length: 60 }, (_, i) => `select public.board_aendern('${A}', 'bx', '{"nodes":{"set":[{"id":"${kuerzel}${i}","data":{"t":"${kuerzel} ${i}"}}]}}'::json);`).join('\n')}\n`;
  const [r1, r2] = await Promise.all([sqlNebenher(lauf(A, 'anna')), sqlNebenher(lauf(B, 'bernd'))]);
  const nach = sql(`\\pset tuples_only on\n\\pset format unaligned\nselect version || '|' || (select count(*) from json_array_elements(inhalt::json->'nodes') x where x->>'id' ~ '^(anna|bernd)\\d+$') || '|' || (select inhalt::jsonb->'boards'->>'bx' from public.konto_dateien where user_id = '${A}' and name = 'umgebung.json') from public.konto_dateien where user_id = '${A}' and name = 'board-bx.json';`).aus.trim();
  const [version, karten, stempel] = nach.split('|');
  pruefe('3a beide Verbindungen laufen ohne Fehler durch (keine Verklemmung)', r1.rc === 0 && r2.rc === 0 && !/ERROR/.test(r1.aus + r2.aus), (r1.aus + r2.aus).split('\n').filter((z) => /ERROR/.test(z)).slice(0, 3).join(' '));
  pruefe('3b alle 120 Karten stehen im Board – keine ging im Wettlauf verloren', karten === '120', nach);
  pruefe('3c die Versionen zählen lückenlos (120 Schritte), der Stempel der Umgebung ist der letzte', Number(version) === Number(vorher) + 120 && stempel === `v${version}`, `${vorher} → ${nach}`);
}

console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
