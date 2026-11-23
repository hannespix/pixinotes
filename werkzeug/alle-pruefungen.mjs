// Alle Prüfungen (pruefungen/m*.mjs) nebeneinander laufen lassen statt nacheinander.
//
//   node werkzeug/alle-pruefungen.mjs                 → alle, vier gleichzeitig
//   node werkzeug/alle-pruefungen.mjs --bahnen 2      → zwei gleichzeitig
//   node werkzeug/alle-pruefungen.mjs m39 m40         → nur Dateien, deren Name so beginnt
//   node werkzeug/alle-pruefungen.mjs --bericht datei → schreibt je Datei eine Zeile dorthin, am Ende „FERTIG"
//   node werkzeug/alle-pruefungen.mjs --geaendert     → nur Reihen, die zu den seit dem Hauptzweig geänderten
//                                                       Dateien passen (M448, für schnelle Agenten-Läufe)
//   node werkzeug/alle-pruefungen.mjs --geaendert --basis origin/anderer-zweig   → gegen einen anderen Stand
//   node werkzeug/alle-pruefungen.mjs --geaendert --nur-zeigen                   → nur auflisten, nichts starten
//   node werkzeug/alle-pruefungen.mjs --ohne-datenbank → Reihen an der lokalen Datenbank (psql/pntest) auslassen
//                                                       (M468, der nächtliche CI-Lauf hat kein Postgres)
//   node werkzeug/alle-pruefungen.mjs --json datei    → Ergebnis je Reihe als JSON (nach jeder Reihe neu
//                                                       geschrieben, auch ein abgebrochener Lauf hinterlässt Daten)
//   node werkzeug/alle-pruefungen.mjs --nur-zeigen    → Auswahl auflisten (Trockenlauf), nichts starten
//   node werkzeug/alle-pruefungen.mjs m414 m383 --wiederhole 10 --bahnen 6
//                                                     → Auswahl zehnmal unter Last, ohne Einzelwiederholung;
//                                                       meldet je Reihe „x von 10 grün" und Flattern (M484)
//
// Jede Prüfung startet ihren eigenen kleinen Server und Browser. Was sich dabei in die Quere käme, läuft nie
// gleichzeitig: Dateien mit demselben Port, und die Prüfungen an der lokalen Datenbank (eine gemeinsame Datenbank).
// Fällt eine Datei durch, wird sie am Ende EINMAL allein wiederholt – unter Last kann eine Wartezeit knapp werden;
// was auch allein durchfällt, ist ein echter Fehler. Rückgabewert 1, wenn danach noch etwas rot ist.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const wert = (name, sonst) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : sonst; };
const bahnen = Math.max(1, Number(wert('--bahnen', 4)) || 4);
const bericht = wert('--bericht', '');
const jsonDatei = wert('--json', '');
const ohneDatenbank = args.includes('--ohne-datenbank');
const basis = wert('--basis', '');
const nurGeaendert = args.includes('--geaendert');
const nurZeigen = args.includes('--nur-zeigen');
// M484: --wiederhole N – jede Reihe N-mal in die Warteschlange, ohne den Einzellauf am Ende. So zeigt sich Flattern
// unter Last (rot neben grün) statt im „beim zweiten Mal grün" unterzugehen.
const wiederhole = Math.max(1, Number(wert('--wiederhole', 1)) || 1);
const filter = args.filter((a) => !a.startsWith('--'));

let dateien = readdirSync(path.join(repo, 'pruefungen'))
  .filter((n) => /^m\d.*\.mjs$/.test(n) && (filter.length === 0 || filter.some((f) => n.startsWith(f))))
  .sort();

// M448: --geaendert – welche Reihen betrifft der eigene Stand? Gezählt werden die Dateien, die sich seit dem
// gemeinsamen Vorfahren mit dem Hauptzweig geändert haben (Commits, ungespeicherte und neue Dateien). Eine Reihe
// läuft, wenn (a) sie selbst geändert ist, (b) ihre Meilenstein-Nummer zu einer geänderten Datei gehört
// (docs/meilensteine/M441-….md → m441), (c) ihr Quelltext den Dateinamen nennt („HelpOverlay.tsx",
// „syncMerge") oder (d) ein Wort des Dateinamens in ihrem Namen steckt (GanttCard.tsx → m271-gantt, m273-gantt-ui).
// Das ist eine Auswahl für schnelle Läufe, kein Ersatz für die volle Reihe vor großen Umbauten.
if (nurGeaendert) {
  const git = (...a) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' }); return r.status === 0 ? r.stdout : ''; };
  const haupt = 'claude/notes-whiteboard-design-bnwvxj';
  const ref = [basis, `origin/${haupt}`, haupt].find((r) => r && git('rev-parse', '--verify', '--quiet', r).trim());
  if (!ref) { console.log(`--geaendert: kein Vergleichsstand gefunden (origin/${haupt}); bitte --basis <ref> angeben`); process.exit(2); }
  const vorfahr = git('merge-base', 'HEAD', ref).trim() || ref;
  const geaendert = [...new Set([
    ...git('diff', '--name-only', vorfahr).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ].map((z) => z.trim()).filter(Boolean))];
  // Wörter, die fast jeder Dateiname trägt – sie würden die halbe Reihe auswählen
  const allgemein = new Set(['card', 'cards', 'karte', 'overlay', 'help', 'index', 'main', 'types', 'lib', 'utils', 'test', 'readme', 'view', 'menu', 'button', 'icons', 'sprache', 'pruefungen', 'meilensteine']);
  // Komponenten heißen oft englisch, Reihen deutsch (FocusSheet.tsx ↔ m441-fokus-wischen)
  const deutsch = { focus: 'fokus', note: 'notiz', notes: 'notiz', table: 'tabelle', calendar: 'kalender', settings: 'einstellungen', present: 'vortrag', presentation: 'vortrag', pen: 'stift', draw: 'stift', share: 'teilen', archive: 'archiv', comment: 'kommentar', shape: 'formen', arrow: 'pfeile', edge: 'pfeile', image: 'bild', export: 'export', search: 'suche', template: 'vorlagen', group: 'gruppe' };
  const woerter = (name) => name.replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2').toLowerCase().split(/[^a-z0-9äöüß]+/).map((w) => deutsch[w] ?? w).filter((w) => w.length >= 4 && !allgemein.has(w) && !/^\d+$/.test(w));
  const grund = new Map();
  const merke = (n, g) => { if (!grund.has(n)) grund.set(n, g); };
  const texte = new Map(dateien.map((n) => [n, readFileSync(path.join(repo, 'pruefungen', n), 'utf-8')]));
  for (const datei of geaendert) {
    const name = path.basename(datei);
    const stamm = name.replace(/\.[^.]+$/, '');
    const nr = /^m(\d{3})/i.exec(name)?.[1] ?? (/meilensteine\/M(\d{3})/.exec(datei)?.[1]);
    const nennbar = !allgemein.has(stamm.toLowerCase()) && stamm.length >= 4;
    const ws = datei.startsWith('src/') ? woerter(stamm) : [];
    const muster = new RegExp(`\\b${stamm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const nennt = (n) => datei.startsWith('src/') && (texte.get(n).includes(name) || (nennbar && muster.test(texte.get(n))));
    // Hilfe-Texte (HelpOverlay*.tsx) lesen über 50 Reihen mit – wer nur dort etwas ändert, will nicht die halbe
    // Reihe abwarten. Was mehr als 30 Reihen nennen, zählt deshalb nicht als Grund (Hinweis statt Auswahl).
    const nennende = dateien.filter(nennt);
    if (nennende.length > 30) console.log(`--geaendert: ${name} nennen ${nennende.length} Reihen – übergangen (bei Verdacht die volle Reihe)`);
    for (const n of dateien) {
      if (datei === `pruefungen/${n}`) merke(n, 'selbst geändert');
      else if (nr && n.startsWith(`m${nr}`)) merke(n, `Meilenstein ${nr}: ${datei}`);
      else if (nennende.length <= 30 && nennende.includes(n)) merke(n, `nennt ${name}`);
      else if (ws.some((w) => n.replace(/\.mjs$/, '').split('-').slice(1).some((t) => t.length >= 4 && (t.startsWith(w) || w.startsWith(t))))) merke(n, `Name passt zu ${datei}`);
    }
  }
  // Wächter-Reihen zählen Kacheln/Menüeinträge oder prüfen Längen und Listen (Tooltips, Hilfe, „Was ist neu",
  // Einstellungen, Text in Bildern). Fast jeder neue Meilenstein ändert dort etwas – sie laufen deshalb bei
  // --geaendert immer mit (Befund M448: m296, m299, m300, m312, m314, m316 brachen nach Merges).
  const WAECHTER = ['m296', 'm299', 'm300', 'm312', 'm314', 'm316', 'm381', 'm397'];
  for (const n of dateien) if (WAECHTER.some((w) => n.startsWith(`${w}-`))) merke(n, 'Wächter (zählt/prüft Listen)');
  console.log(`--geaendert: ${geaendert.length} geänderte Datei(en) seit ${ref} (${vorfahr.slice(0, 8)}) → ${grund.size} Reihe(n)`);
  for (const [n, g] of [...grund].sort()) console.log(`  ${n.replace(/\.mjs$/, '')}  ← ${g}`);
  if (grund.size === 0) console.log('  keine passende Reihe – für Änderungen an store.ts, src/styles/, App.tsx die volle Reihe laufen lassen');
  dateien = dateien.filter((n) => grund.has(n));
}
/** Was eine Datei für sich allein braucht: ihre Ports, und die gemeinsame Datenbank */
const sperren = (name) => {
  const text = readFileSync(path.join(repo, 'pruefungen', name), 'utf-8');
  const s = new Set();
  for (const m of text.matchAll(/\bPORT\w*\s*=\s*(\d{4,5})\b|listen\(\s*(\d{4,5})\b|localhost:(\d{4,5})\b|127\.0\.0\.1:(\d{4,5})\b/g)) s.add(`port:${m[1] ?? m[2] ?? m[3] ?? m[4]}`);
  // nur, wer wirklich die lokale Datenbank startet – „postgres_changes" in den Gruppen-Prüfungen ist ein Ereignisname
  if (/\bpsql\b|pntest/.test(text)) s.add('datenbank');
  return [...s];
};
// M468: --ohne-datenbank – dieselbe Erkennung wie für die Sperre („braucht Datenbank", M448). Ausgelassen, nicht
// gelöscht: Ausgabe und JSON nennen die Reihen, damit niemand sie für geprüft hält.
const ausgelassen = ohneDatenbank ? dateien.filter((n) => sperren(n).includes('datenbank')) : [];
if (ausgelassen.length) {
  console.log(`--ohne-datenbank: ${ausgelassen.length} Reihe(n) ausgelassen (brauchen die lokale Datenbank): ${ausgelassen.map((n) => n.replace(/\.mjs$/, '')).join(', ')}`);
  dateien = dateien.filter((n) => !ausgelassen.includes(n));
}
if (nurZeigen) {
  // bei --geaendert steht die Auswahl samt Grund schon oben
  if (!nurGeaendert) { console.log(`${dateien.length} Reihe(n):`); for (const n of dateien) console.log(`  ${n.replace(/\.mjs$/, '')}  [${sperren(n).join(', ') || 'ohne Sperre'}]`); }
  process.exit(0);
}
// M484: bei --wiederhole stehen die Durchgänge hintereinander (erst alle Reihen einmal, dann alle ein zweites Mal …),
// damit jede Reihe in jedem Durchgang neben anderen läuft und nicht ihre eigenen Wiederholungen abwartet.
const offen = Array.from({ length: wiederhole }, (_, d) => dateien.map((name) => ({ name, durchgang: d + 1, sperren: sperren(name) }))).flat();
const verlauf = new Map(dateien.map((n) => [n, []]));
const belegt = new Set();
// Sperren über alle Worktrees: Mehrere Agenten starten dieselben alten Reihen (feste Ports 4431–4776) zugleich.
// Ein Verzeichnis je Sperre unter os.tmpdir() (mkdir ist atomar), darin die PID des Halters. Stirbt der Halter,
// gilt die Sperre als frei. So warten Läufe aus verschiedenen Worktrees aufeinander, statt an EADDRINUSE zu scheitern.
const SPERR_DIR = path.join(tmpdir(), 'pixinotes-pruef-sperren');
mkdirSync(SPERR_DIR, { recursive: true });
const sperrPfad = (s) => path.join(SPERR_DIR, s.replace(/[^a-z0-9]/gi, '_'));
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const nehmen = (s) => {
  const p = sperrPfad(s);
  try { mkdirSync(p); writeFileSync(path.join(p, 'pid'), String(process.pid)); return true; } catch { /* belegt */ }
  let pid = 0;
  try { pid = Number(readFileSync(path.join(p, 'pid'), 'utf-8')); } catch { /* gerade im Anlegen */ return false; }
  if (pid && !lebt(pid)) { rmSync(p, { recursive: true, force: true }); return nehmen(s); }
  return false;
};
const freigeben = (s) => { try { if (Number(readFileSync(path.join(sperrPfad(s), 'pid'), 'utf-8')) === process.pid) rmSync(sperrPfad(s), { recursive: true, force: true }); } catch { /* schon frei */ } };
const allesNehmen = (liste) => {
  const genommen = [];
  for (const s of liste) { if (nehmen(s)) genommen.push(s); else { genommen.forEach(freigeben); return false; } }
  return true;
};
process.on('exit', () => { for (const s of belegt) freigeben(s); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const ergebnis = new Map();
if (bericht) writeFileSync(bericht, '');
const start = Date.now();
// M468: maschinenlesbares Ergebnis für den Nachtlauf (Zusammenfassung, Issue „Nachtlauf rot"). Nach jeder Reihe neu
// geschrieben – bricht der Lauf ab (Zeitlimit), bleibt der Stand bis dahin lesbar („fertig": false).
const jsonStand = { start: new Date(start).toISOString(), bahnen, fertig: false, gesamt: dateien.length, ausgelassen: ausgelassen.map((n) => n.replace(/\.mjs$/, '')), reihen: {} };
const jsonSchreiben = () => { if (jsonDatei) writeFileSync(jsonDatei, `${JSON.stringify({ ...jsonStand, minuten: Number(((Date.now() - start) / 60000).toFixed(1)), reihen: Object.values(jsonStand.reihen) }, null, 1)}\n`); };
const merkeJson = (name, r, zweiter) => {
  const reihe = name.replace(/\.mjs$/, '');
  const summe = (r.aus.match(/^.*\d+ bestanden.*$/gm) ?? []).pop()?.trim() ?? '';
  const fehler = r.rc === 0 ? [] : r.aus.split('\n').filter((z) => /✗|Error|error/.test(z)).slice(0, 8).map((z) => z.slice(0, 300));
  const alt = jsonStand.reihen[reihe];
  jsonStand.reihen[reihe] = zweiter
    ? { ...alt, rot: r.rc !== 0, rc: r.rc, sek: alt.sek + r.sek, summe: summe || alt.summe, wiederholt: true, fehler: r.rc === 0 ? alt.fehler : fehler }
    : { reihe, rot: r.rc !== 0, rc: r.rc, sek: r.sek, summe, wiederholt: false, fehler };
  jsonSchreiben();
};
jsonSchreiben();

const einmal = (name) => new Promise((fertig) => {
  const t0 = Date.now();
  let aus = '';
  const kind = spawn('timeout', ['600', process.execPath, path.join('pruefungen', name)], { cwd: repo, env: process.env });
  kind.stdout.on('data', (d) => { aus += d; });
  kind.stderr.on('data', (d) => { aus += d; });
  kind.on('close', (rc) => fertig({ rc: rc ?? 1, sek: Math.round((Date.now() - t0) / 1000), aus }));
});
// M448: Andere Agenten arbeiten in eigenen Worktrees und starten dieselben Reihen auf denselben festen Ports.
// „EADDRINUSE" heißt dann nur „Port gerade fremd belegt", kein Fehler der App – warten und neu starten
// (bis zu sechsmal, je 20 s), statt die Reihe als rot zu melden.
const lauf = async (name) => {
  for (let versuch = 1; ; versuch += 1) {
    const r = await einmal(name);
    if (r.rc === 0 || !/EADDRINUSE/.test(r.aus) || versuch >= 6) return r;
    console.log(`${name.replace(/\.mjs$/, '')} | Port fremd belegt – Versuch ${versuch + 1} in 20 s`);
    await new Promise((x) => setTimeout(x, 20000));
  }
};
const zeile = (name, r, zusatz = '') => {
  const summe = (r.aus.match(/^.*\d+ bestanden.*$/gm) ?? []).pop()?.trim() ?? '';
  const kurz = `${name.replace(/\.mjs$/, '')} | rc=${r.rc} | ${r.sek}s | ${summe}${zusatz}`;
  console.log(kurz);
  if (bericht) {
    appendFileSync(bericht, `${kurz}\n`);
    if (r.rc !== 0) appendFileSync(bericht, `${r.aus.split('\n').filter((z) => /✗|Error|error/.test(z)).slice(0, 12).map((z) => z.slice(0, 400)).join('\n')}\n`);
  }
};

await new Promise((alleFertig) => {
  let laufend = 0;
  let wartet = false; // eine Nachfrage gleichzeitig, wenn fremde Worktrees Ports halten
  const weiter = () => {
    if (offen.length === 0 && laufend === 0) { alleFertig(); return; }
    while (laufend < bahnen) {
      const i = offen.findIndex((d) => d.sperren.every((s) => !belegt.has(s)) && allesNehmen(d.sperren));
      if (i < 0) { if (offen.length && !wartet) { wartet = true; setTimeout(() => { wartet = false; weiter(); }, 3000); } break; }
      const d = offen.splice(i, 1)[0];
      for (const s of d.sperren) belegt.add(s);
      laufend += 1;
      lauf(d.name).then((r) => {
        verlauf.get(d.name).push(r);
        if (wiederhole > 1) {
          zeile(d.name, r, ` | Durchgang ${d.durchgang}/${wiederhole}${r.rc === 0 ? '' : ' | ROT'}`);
          if (r.rc !== 0 && !bericht) console.log(r.aus.split('\n').filter((z) => /✗|Error/.test(z)).slice(0, 8).map((z) => `    ${z.slice(0, 300)}`).join('\n'));
        } else {
          ergebnis.set(d.name, r);
          merkeJson(d.name, r, false);
          // M448: auch der erste Fehlschlag kommt mit Grund in den Bericht – sonst ist ein Wackler, der beim
          // Wiederholen grün wird, hinterher nicht mehr zu finden
          zeile(d.name, r, r.rc === 0 ? '' : ' | erster Lauf rot, wird allein wiederholt');
        }
        for (const s of d.sperren) { belegt.delete(s); freigeben(s); }
        laufend -= 1;
        weiter();
      });
    }
  };
  weiter();
});

if (wiederhole > 1) {
  const minuten = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`\n--wiederhole ${wiederhole}: ${minuten} min bei ${bahnen} Bahnen`);
  const flattern = [];
  for (const [name, rs] of verlauf) {
    const gruen = rs.filter((r) => r.rc === 0).length;
    const sek = rs.map((r) => r.sek);
    console.log(`  ${name.replace(/\.mjs$/, '')}: ${gruen} von ${rs.length} grün · ${Math.min(...sek)}–${Math.max(...sek)} s${gruen < rs.length ? (gruen ? ' · FLATTERT' : ' · IMMER ROT') : ''}`);
    if (gruen < rs.length) flattern.push(name.replace(/\.mjs$/, ''));
    jsonStand.reihen[name] = { reihe: name.replace(/\.mjs$/, ''), rot: gruen < rs.length, gruen, laeufe: rs.length, sek: sek.reduce((a, b) => a + b, 0), wiederholt: false, fehler: [] };
  }
  if (flattern.length) console.log(`nicht stabil: ${flattern.join(', ')}`);
  jsonStand.fertig = true;
  jsonSchreiben();
  if (bericht) appendFileSync(bericht, 'FERTIG\n');
  process.exit(flattern.length ? 1 : 0);
}

// Was durchfiel, einmal allein
const rot = [...ergebnis].filter(([, r]) => r.rc !== 0).map(([name]) => name).sort();
const bleibtRot = [];
for (const name of rot) {
  const sp = sperren(name);
  while (!allesNehmen(sp)) await new Promise((x) => setTimeout(x, 3000));
  sp.forEach((s) => belegt.add(s));
  const r = await lauf(name);
  sp.forEach((s) => { belegt.delete(s); freigeben(s); });
  zeile(name, r, r.rc === 0 ? ' | allein wiederholt: grün' : ' | auch allein rot');
  merkeJson(name, r, true);
  if (r.rc !== 0) { bleibtRot.push(name); if (!bericht) console.log(r.aus.split('\n').filter((z) => /✗|Error/.test(z)).slice(0, 12).join('\n')); }
}
const minuten = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n${dateien.length - bleibtRot.length} von ${dateien.length} Dateien grün · ${rot.length - bleibtRot.length} erst beim zweiten Mal · ${minuten} min bei ${bahnen} Bahnen`);
if (bleibtRot.length) console.log(`rot: ${bleibtRot.join(', ')}`);
if (ausgelassen.length) console.log(`ausgelassen (Datenbank): ${ausgelassen.map((n) => n.replace(/\.mjs$/, '')).join(', ')}`);
jsonStand.fertig = true;
jsonSchreiben();
if (bericht) appendFileSync(bericht, 'FERTIG\n');
process.exit(bleibtRot.length ? 1 : 0);
