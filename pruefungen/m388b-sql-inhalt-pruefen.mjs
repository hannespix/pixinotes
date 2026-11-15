/**
 * M388 — Was Gäste in ein Board schreiben, wird geprüft: der Auslöser konto_dateien_inhalt_pruefen gegen ein ECHTES
 * Postgres. Braucht ein lokales Postgres (`service postgresql start`, Nutzer „postgres"); fehlt es, wird die
 * Prüfung übersprungen — laut, nicht still.
 *
 *   1  Alle Migrationen spielen sich der Reihe nach ein; die neue lässt sich ein zweites Mal einspielen.
 *   2  pruefungen/sql/m388-inhalt-pruefen.sql: Gast mit Konto und Gast per Link — gültige Stücke kommen an,
 *      ungültige werden abgewiesen, ein Board mit fremder Kennung ebenso; ein altes Stück im Board hält niemanden
 *      auf; Besitzerin und Verwaltung bleiben ungeprüft.
 *   3  Die Prüfung aus M383 läuft danach unverändert durch (der Auslöser stört die bisherigen Wege nicht).
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
  console.log('  ÜBERSPRUNGEN: kein lokales Postgres erreichbar (service postgresql start / PN_PSQL) — der Auslöser wurde hier NICHT gegen eine echte Datenbank geprüft.');
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
  pruefe(`1b alle ${dateien.length} Migrationen laufen der Reihe nach durch`, fehler.length === 0 && dateien.some((f) => /inhalt_pruefen/.test(f)), fehler.join(' | '));
  const zwei = sql(`\\set ON_ERROR_STOP 1\n${readFileSync(path.join(dir, dateien.find((f) => /inhalt_pruefen/.test(f))), 'utf8')}`);
  pruefe('1c die neue Migration lässt sich ein zweites Mal einspielen (nichts doppelt, kein Fehler)', zwei.rc === 0 && !/ERROR/.test(zwei.aus), zwei.aus.slice(-300));
}

console.log('\n════ 2: Inhalt prüfen ════');
{
  const r = sql(readFileSync(path.join(__repo, 'pruefungen', 'sql', 'm388-inhalt-pruefen.sql'), 'utf8'));
  const zeilen = r.aus.split('\n').filter((z) => /^(OK|FEHLER) /.test(z));
  for (const z of zeilen) pruefe(z.replace(/^(OK|FEHLER) /, '2 ').split(' — ')[0], z.startsWith('OK '), z);
  pruefe('2 die SQL-Prüfung lief bis zum Ende (19 Prüfungen, kein Abbruch)', r.rc === 0 && zeilen.length === 19 && !/ERROR/.test(r.aus), `${zeilen.length} ${r.aus.split('\n').filter((z) => /ERROR/.test(z)).join(' ')}`);
}

console.log('\n════ 3: die bisherigen Wege ════');
{
  const r = sql(readFileSync(path.join(__repo, 'pruefungen', 'sql', 'm383-board-aendern.sql'), 'utf8'));
  const zeilen = r.aus.split('\n').filter((z) => /^(OK|FEHLER) /.test(z));
  pruefe('3 die Prüfung aus M383 (board_aendern: Rechte, Rechnung, Antwort) läuft unverändert durch', r.rc === 0 && zeilen.length === 22 && zeilen.every((z) => z.startsWith('OK ')) && !/ERROR/.test(r.aus), zeilen.filter((z) => !z.startsWith('OK ')).join(' | ') + r.aus.split('\n').filter((z) => /ERROR/.test(z)).join(' '));
}

console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
