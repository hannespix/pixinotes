/**
 * M468 — Nächtlicher CI-Lauf aller Prüfreihen (.github/workflows/nachtlauf.yml).
 *
 * Ohne Browser und ohne Port: geprüft wird das Werkzeug, das der Lauf benutzt.
 *   A  Läufer: --ohne-datenbank lässt genau die Reihen an der lokalen Datenbank aus und nennt sie,
 *      --nur-zeigen startet nichts, ohne die Option bleiben die Datenbank-Reihen in der Auswahl.
 *   B  Auswertung (werkzeug/nachtlauf-melden.cjs) gegen ein nachgebautes GitHub: rot → EIN Issue „Nachtlauf rot"
 *      mit Label und den roten Reihen, wieder rot → dasselbe Issue erneuert, grün → geschlossen, Build kaputt →
 *      rot ohne Ergebnisdatei, Teilauswahl → Issue unberührt; Zusammenfassung nennt grün/rot je Reihe und Dauer.
 *   C  werkzeug/chromium-pfad.mjs: Pfad des installierten Chromiums, laut scheitern, wenn er fehlt.
 *   D  Workflow: nachts geplant, von Hand startbar, darf Issues schreiben, lässt die Datenbank-Reihen aus,
 *      begrenzt die Laufzeit, legt Bericht und JSON ab.
 *
 * Läuft aus dem Repository: node pruefungen/m468-nachtlauf.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __repo = fileURLToPath(new URL('..', import.meta.url));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const knoten = (args, env = {}) => spawnSync(process.execPath, args, { cwd: __repo, encoding: 'utf8', env: { ...process.env, ...env } });
const tmp = mkdtempSync(path.join(tmpdir(), 'm468-'));

// ---------- A Läufer ----------
const alle = readdirSync(path.join(__repo, 'pruefungen')).filter((n) => /^m\d.*\.mjs$/.test(n));
// Das Muster des Läufers zusammengesetzt: stünde es wörtlich hier, hielte der Läufer DIESE Reihe für eine
// Datenbank-Reihe – der erste Nachtlauf ließ m468 genau deshalb aus.
const DB_MUSTER = new RegExp(['\\bps', 'ql\\b|pn', 'test'].join(''));
const mitDb = alle.filter((n) => DB_MUSTER.test(readFileSync(path.join(__repo, 'pruefungen', n), 'utf-8'))).map((n) => n.replace(/\.mjs$/, ''));
const ohne = knoten(['werkzeug/alle-pruefungen.mjs', '--ohne-datenbank', '--nur-zeigen']);
const gelistet = [...ohne.stdout.matchAll(/^ {2}(m\S+)/gm)].map((m) => m[1]);
pruefe('A1 es gibt Reihen an der lokalen Datenbank (sonst prüft A nichts)', mitDb.length >= 3, mitDb);
pruefe('A1b diese Reihe selbst gilt nicht als Datenbank-Reihe', !mitDb.includes('m468-nachtlauf'), mitDb);
pruefe('A2 --ohne-datenbank --nur-zeigen endet ohne Fehler', ohne.status === 0, ohne.stderr);
pruefe('A3 keine Datenbank-Reihe in der Auswahl', gelistet.length > 0 && mitDb.every((n) => !gelistet.includes(n)), gelistet.filter((n) => mitDb.includes(n)));
pruefe('A4 alle übrigen Reihen sind dabei', gelistet.length === alle.length - mitDb.length, `${gelistet.length} von ${alle.length - mitDb.length}`);
pruefe('A5 die ausgelassenen Reihen werden genannt', mitDb.every((n) => new RegExp(`ausgelassen[^\\n]*${n}`).test(ohne.stdout)), ohne.stdout.split('\n')[0]);
const mit = knoten(['werkzeug/alle-pruefungen.mjs', '--nur-zeigen']);
const gelistetMit = [...mit.stdout.matchAll(/^ {2}(m\S+)/gm)].map((m) => m[1]);
pruefe('A6 ohne die Option bleiben die Datenbank-Reihen in der Auswahl', mitDb.every((n) => gelistetMit.includes(n)) && gelistetMit.length === alle.length, gelistetMit.length);

// ---------- B Auswertung gegen ein nachgebautes GitHub ----------
const require = createRequire(import.meta.url);
const melden = require(path.join(__repo, 'werkzeug', 'nachtlauf-melden.cjs'));
const reihe = (name, rot, wiederholt = rot, sek = 42) => ({ reihe: name, rot, rc: rot ? 1 : 0, sek, summe: rot ? '3 bestanden, 1 fehlgeschlagen' : '4 bestanden, 0 fehlgeschlagen', wiederholt, fehler: rot ? ['  ✗ B2 Knopf fehlt'] : [] });
const ergebnis = (reihen, fertig = true) => { const f = path.join(tmp, `e${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify({ start: '2026-11-23T02:17:00Z', bahnen: 3, fertig, gesamt: 4, minuten: 41.5, ausgelassen: ['m383b-sql-board-aendern'], reihen })); return f; };
const rotDatei = ergebnis([reihe('m300-a', false), reihe('m301-b', true), reihe('m302-c', false, true), reihe('m303-d', false)]);
const gruenDatei = ergebnis([reihe('m300-a', false), reihe('m301-b', false), reihe('m302-c', false), reihe('m303-d', false)]);
const issues = []; const kommentare = []; const labels = new Set(); let nr = 10;
const github = {
  paginate: async (_f, p) => issues.filter((i) => i.state === p.state && i.labels.includes(p.labels)),
  rest: { issues: {
    listForRepo: () => {},
    getLabel: async (p) => { if (!labels.has(p.name)) { const e = new Error('Not Found'); e.status = 404; throw e; } },
    createLabel: async (p) => { labels.add(p.name); },
    create: async (p) => { const i = { number: nr++, title: p.title, labels: p.labels, state: 'open', body: p.body }; issues.push(i); return { data: i }; },
    update: async (p) => { const i = issues.find((x) => x.number === p.issue_number); if (p.body) i.body = p.body; if (p.state) { i.state = p.state; i.grund = p.state_reason; } },
    createComment: async (p) => kommentare.push(p),
  } },
};
let zusammenfassung = ''; let fehlgeschlagen = '';
const core = { summary: { addRaw(t) { zusammenfassung = t; return this; }, async write() {} }, info: () => {}, setFailed: (m) => { fehlgeschlagen = m; } };
const context = { repo: { owner: 'pix', repo: 'pixinotes' } };
const lauf = (datei, extra = {}) => { fehlgeschlagen = ''; return melden({ github, context, core, datei, bau: 'success', lauf: 'failure', laufUrl: `https://github.com/pix/pixinotes/actions/runs/${nr}`, ...extra }); };

await lauf(rotDatei);
pruefe('B1 rot legt EIN Issue „Nachtlauf rot" mit Label nachtlauf an', issues.length === 1 && issues[0].title === 'Nachtlauf rot' && issues[0].labels.includes('nachtlauf') && labels.has('nachtlauf'), issues);
pruefe('B2 das Issue nennt die rote Reihe, den Lauf-Link und die Wackler', /m301-b/.test(issues[0].body) && /actions\/runs\//.test(issues[0].body) && /Wackler[^\n]*m302-c/.test(issues[0].body) && !/- \[ \] `m300-a`/.test(issues[0].body), issues[0].body);
pruefe('B3 der Schritt meldet rot', /Nachtlauf rot/.test(fehlgeschlagen), fehlgeschlagen);
pruefe('B4 Zusammenfassung: grün/rot je Reihe mit Dauer', /## Nachtlauf: rot/.test(zusammenfassung) && /\| m301-b \| rot \| 0:42 \|/.test(zusammenfassung) && /\| m300-a \| grün \| 0:42 \|/.test(zusammenfassung) && /\| m302-c \| grün \(2\. Lauf\)/.test(zusammenfassung) && /3 von 4 Reihen grün/.test(zusammenfassung), zusammenfassung.slice(0, 400));
pruefe('B5 Zusammenfassung nennt die ausgelassene Datenbank-Reihe', /ausgelassen[^\n]*m383b/.test(zusammenfassung));
const erstesIssue = issues[0].number;
await lauf(rotDatei);
pruefe('B6 wieder rot: dasselbe Issue wird erneuert und kommentiert, kein zweites', issues.length === 1 && kommentare.length === 1 && kommentare[0].issue_number === erstesIssue && /Weiter rot/.test(kommentare[0].body), { issues: issues.length, kommentare });
await lauf(gruenDatei, { lauf: 'success' });
pruefe('B7 grün schließt das Issue (erledigt) mit Kommentar', issues[0].state === 'closed' && issues[0].grund === 'completed' && /Wieder grün/.test(kommentare.at(-1).body) && !fehlgeschlagen, issues[0]);
pruefe('B8 grüne Zusammenfassung ohne Abschnitt „Rot"', /## Nachtlauf: grün/.test(zusammenfassung) && !/### Rot/.test(zusammenfassung));
await lauf(gruenDatei, { lauf: 'success' });
pruefe('B9 grün ohne offenes Issue tut nichts', issues.length === 1 && kommentare.length === 2, kommentare.length);
await lauf(path.join(tmp, 'gibt-es-nicht.json'), { bau: 'failure', lauf: 'skipped' });
pruefe('B10 Build kaputt (keine Ergebnisdatei): neues Issue nennt den Bau', issues.length === 2 && issues[1].state === 'open' && /nicht gebaut/.test(issues[1].body) && /nicht gebaut/.test(fehlgeschlagen), issues[1]?.body);
await lauf(ergebnis([reihe('m300-a', false)], false), { lauf: 'failure' });
pruefe('B11 abgebrochener Lauf (fertig: false) zählt als rot', issues.length === 2 && /abgebrochen/.test(issues[1].body) && /nach 1 von 4 Reihen/.test(issues[1].body), issues[1].body);
const vorher = JSON.stringify(issues);
await lauf(gruenDatei, { lauf: 'success', teilauswahl: 'm30' });
pruefe('B12 Hand-Lauf über eine Teilauswahl lässt das Issue offen', JSON.stringify(issues) === vorher && issues[1].state === 'open');
await lauf(rotDatei, { teilauswahl: 'm30' });
pruefe('B13 rote Teilauswahl: Schritt rot, aber kein Issue', JSON.stringify(issues) === vorher && /Teilauswahl rot/.test(fehlgeschlagen), fehlgeschlagen);

// ---------- C Chromium-Pfad ----------
const leer = path.join(tmp, 'browser-leer');
mkdirSync(leer);
const fehlt = knoten(['werkzeug/chromium-pfad.mjs'], { PLAYWRIGHT_BROWSERS_PATH: leer });
pruefe('C1 ohne installiertes Chromium: Rückgabewert 1 und Hinweis auf die Installation', fehlt.status === 1 && /playwright-core install/.test(fehlt.stderr), fehlt.stderr);
const erwartet = /„([^"]+)"/.exec(fehlt.stderr)?.[1] ?? '';
if (erwartet.startsWith(leer)) { mkdirSync(path.dirname(erwartet), { recursive: true }); writeFileSync(erwartet, ''); }
const da = knoten(['werkzeug/chromium-pfad.mjs'], { PLAYWRIGHT_BROWSERS_PATH: leer });
pruefe('C2 mit installiertem Chromium: genau der Pfad auf stdout', da.status === 0 && da.stdout.trim() === erwartet && erwartet.startsWith(leer), { rc: da.status, aus: da.stdout, erwartet });

// ---------- D Workflow ----------
const wf = readFileSync(path.join(__repo, '.github', 'workflows', 'nachtlauf.yml'), 'utf-8');
pruefe('D1 nachts geplant und von Hand startbar', /schedule:\s*\n\s*- cron: '\d+ [0-5] \* \* \*'/.test(wf) && /workflow_dispatch:/.test(wf));
pruefe('D2 darf Issues schreiben', /permissions:[\s\S]*issues: write/.test(wf));
pruefe('D3 alle Reihen ohne Datenbank, mit Bericht und JSON', /alle-pruefungen\.mjs[^\n]*--ohne-datenbank/.test(wf) && /--bericht nachtlauf-bericht\.txt/.test(wf) && /--json nachtlauf-ergebnis\.json/.test(wf));
pruefe('D4 Laufzeit begrenzt (Job und Prüfschritt)', (wf.match(/timeout-minutes: \d+/g) ?? []).length >= 2);
pruefe('D5 Chromium installiert, PW_CHROMIUM aus dem Hilfsskript', /playwright-core install[^\n]*chromium/.test(wf) && /PW_CHROMIUM=\$\(node werkzeug\/chromium-pfad\.mjs\)/.test(wf));
pruefe('D6 Bericht als Artefakt und Auswertung laufen auch nach Rot', /upload-artifact[\s\S]*nachtlauf-bericht\.txt/.test(wf) && (wf.match(/if: always\(\)/g) ?? []).length >= 2 && /nachtlauf-melden\.cjs/.test(wf));

rmSync(tmp, { recursive: true, force: true });
console.log(`\n  m468-nachtlauf: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
