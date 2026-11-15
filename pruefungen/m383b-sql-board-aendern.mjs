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
  console.log('  ÜBERSPRUNGEN: kein lokales Postgres erreichbar (service postgresql start / PN_PSQL) — board_aendern wurde hier NICHT gegen eine echte Datenbank geprüft.');
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
  const zwei = sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(dir, dateien.find((f) => /board_aendern/.test(f))), 'utf8')}`);
  pruefe('1c die neue Migration lässt sich ein zweites Mal einspielen (nichts doppelt, kein Fehler)', zwei.rc === 0 && !/ERROR/.test(zwei.aus), zwei.aus.slice(-300));
}

console.log('\n════ 2: board_aendern — Rechte, Rechnung, Antwort ════');
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
  pruefe('3b alle 120 Karten stehen im Board — keine ging im Wettlauf verloren', karten === '120', nach);
  pruefe('3c die Versionen zählen lückenlos (120 Schritte), der Stempel der Umgebung ist der letzte', Number(version) === Number(vorher) + 120 && stempel === `v${version}`, `${vorher} → ${nach}`);
}

console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
