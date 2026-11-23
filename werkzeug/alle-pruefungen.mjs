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
//
// Jede Prüfung startet ihren eigenen kleinen Server und Browser. Was sich dabei in die Quere käme, läuft nie
// gleichzeitig: Dateien mit demselben Port, und die Prüfungen an der lokalen Datenbank (eine gemeinsame Datenbank).
// Fällt eine Datei durch, wird sie am Ende EINMAL allein wiederholt – unter Last kann eine Wartezeit knapp werden;
// was auch allein durchfällt, ist ein echter Fehler. Rückgabewert 1, wenn danach noch etwas rot ist.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const wert = (name, sonst) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : sonst; };
const bahnen = Math.max(1, Number(wert('--bahnen', 4)) || 4);
const bericht = wert('--bericht', '');
const basis = wert('--basis', '');
const nurGeaendert = args.includes('--geaendert');
const nurZeigen = args.includes('--nur-zeigen');
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
    // Reihe abwarten. Was mehr als 20 Reihen nennen, zählt deshalb nicht als Grund (Hinweis statt Auswahl).
    const nennende = dateien.filter(nennt);
    if (nennende.length > 20) console.log(`--geaendert: ${name} nennen ${nennende.length} Reihen – übergangen (bei Verdacht die volle Reihe)`);
    for (const n of dateien) {
      if (datei === `pruefungen/${n}`) merke(n, 'selbst geändert');
      else if (nr && n.startsWith(`m${nr}`)) merke(n, `Meilenstein ${nr}: ${datei}`);
      else if (nennende.length <= 20 && nennende.includes(n)) merke(n, `nennt ${name}`);
      else if (ws.some((w) => n.replace(/\.mjs$/, '').split('-').slice(1).some((t) => t.length >= 4 && (t.startsWith(w) || w.startsWith(t))))) merke(n, `Name passt zu ${datei}`);
    }
  }
  console.log(`--geaendert: ${geaendert.length} geänderte Datei(en) seit ${ref} (${vorfahr.slice(0, 8)}) → ${grund.size} Reihe(n)`);
  for (const [n, g] of [...grund].sort()) console.log(`  ${n.replace(/\.mjs$/, '')}  ← ${g}`);
  if (grund.size === 0) console.log('  keine passende Reihe – für Änderungen an store.ts, index.css, App.tsx die volle Reihe laufen lassen');
  dateien = dateien.filter((n) => grund.has(n));
}
if (nurZeigen) process.exit(0);
/** Was eine Datei für sich allein braucht: ihre Ports, und die gemeinsame Datenbank */
const sperren = (name) => {
  const text = readFileSync(path.join(repo, 'pruefungen', name), 'utf-8');
  const s = new Set();
  for (const m of text.matchAll(/\bPORT\w*\s*=\s*(\d{4,5})\b|listen\(\s*(\d{4,5})\b|localhost:(\d{4,5})\b|127\.0\.0\.1:(\d{4,5})\b/g)) s.add(`port:${m[1] ?? m[2] ?? m[3] ?? m[4]}`);
  // nur, wer wirklich die lokale Datenbank startet – „postgres_changes" in den Gruppen-Prüfungen ist ein Ereignisname
  if (/\bpsql\b|pntest/.test(text)) s.add('datenbank');
  return [...s];
};
const offen = dateien.map((name) => ({ name, sperren: sperren(name) }));
const belegt = new Set();
const ergebnis = new Map();
if (bericht) writeFileSync(bericht, '');
const start = Date.now();

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
  const weiter = () => {
    if (offen.length === 0 && laufend === 0) { alleFertig(); return; }
    while (laufend < bahnen) {
      const i = offen.findIndex((d) => d.sperren.every((s) => !belegt.has(s)));
      if (i < 0) break;
      const d = offen.splice(i, 1)[0];
      for (const s of d.sperren) belegt.add(s);
      laufend += 1;
      lauf(d.name).then((r) => {
        ergebnis.set(d.name, r);
        // M448: auch der erste Fehlschlag kommt mit Grund in den Bericht – sonst ist ein Wackler, der beim
        // Wiederholen grün wird, hinterher nicht mehr zu finden
        zeile(d.name, r, r.rc === 0 ? '' : ' | erster Lauf rot, wird allein wiederholt');
        for (const s of d.sperren) belegt.delete(s);
        laufend -= 1;
        weiter();
      });
    }
  };
  weiter();
});

// Was durchfiel, einmal allein
const rot = [...ergebnis].filter(([, r]) => r.rc !== 0).map(([name]) => name).sort();
const bleibtRot = [];
for (const name of rot) {
  const r = await lauf(name);
  zeile(name, r, r.rc === 0 ? ' | allein wiederholt: grün' : ' | auch allein rot');
  if (r.rc !== 0) { bleibtRot.push(name); if (!bericht) console.log(r.aus.split('\n').filter((z) => /✗|Error/.test(z)).slice(0, 12).join('\n')); }
}
const minuten = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n${dateien.length - bleibtRot.length} von ${dateien.length} Dateien grün · ${rot.length - bleibtRot.length} erst beim zweiten Mal · ${minuten} min bei ${bahnen} Bahnen`);
if (bleibtRot.length) console.log(`rot: ${bleibtRot.join(', ')}`);
if (bericht) appendFileSync(bericht, 'FERTIG\n');
process.exit(bleibtRot.length ? 1 : 0);
