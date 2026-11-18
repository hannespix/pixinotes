// Alle Prüfungen (pruefungen/m*.mjs) nebeneinander laufen lassen statt nacheinander.
//
//   node werkzeug/alle-pruefungen.mjs                 → alle, vier gleichzeitig
//   node werkzeug/alle-pruefungen.mjs --bahnen 2      → zwei gleichzeitig
//   node werkzeug/alle-pruefungen.mjs m39 m40         → nur Dateien, deren Name so beginnt
//   node werkzeug/alle-pruefungen.mjs --bericht datei → schreibt je Datei eine Zeile dorthin, am Ende „FERTIG"
//
// Jede Prüfung startet ihren eigenen kleinen Server und Browser. Was sich dabei in die Quere käme, läuft nie
// gleichzeitig: Dateien mit demselben Port, und die Prüfungen an der lokalen Datenbank (eine gemeinsame Datenbank).
// Fällt eine Datei durch, wird sie am Ende EINMAL allein wiederholt – unter Last kann eine Wartezeit knapp werden;
// was auch allein durchfällt, ist ein echter Fehler. Rückgabewert 1, wenn danach noch etwas rot ist.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const wert = (name, sonst) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : sonst; };
const bahnen = Math.max(1, Number(wert('--bahnen', 4)) || 4);
const bericht = wert('--bericht', '');
const filter = args.filter((a) => !a.startsWith('--'));

const dateien = readdirSync(path.join(repo, 'pruefungen'))
  .filter((n) => /^m\d.*\.mjs$/.test(n) && (filter.length === 0 || filter.some((f) => n.startsWith(f))))
  .sort();
/** Was eine Datei für sich allein braucht: ihre Ports, und die gemeinsame Datenbank */
const sperren = (name) => {
  const text = readFileSync(path.join(repo, 'pruefungen', name), 'utf-8');
  const s = new Set();
  for (const m of text.matchAll(/\bPORT\w*\s*=\s*(\d{4,5})\b|listen\(\s*(\d{4,5})\b|localhost:(\d{4,5})\b|127\.0\.0\.1:(\d{4,5})\b/g)) s.add(`port:${m[1] ?? m[2] ?? m[3] ?? m[4]}`);
  if (/psql|pntest|postgres/i.test(text)) s.add('datenbank');
  return [...s];
};
const offen = dateien.map((name) => ({ name, sperren: sperren(name) }));
const belegt = new Set();
const ergebnis = new Map();
if (bericht) writeFileSync(bericht, '');
const start = Date.now();

const lauf = (name) => new Promise((fertig) => {
  const t0 = Date.now();
  let aus = '';
  const kind = spawn('timeout', ['600', process.execPath, path.join('pruefungen', name)], { cwd: repo, env: process.env });
  kind.stdout.on('data', (d) => { aus += d; });
  kind.stderr.on('data', (d) => { aus += d; });
  kind.on('close', (rc) => fertig({ rc: rc ?? 1, sek: Math.round((Date.now() - t0) / 1000), aus }));
});
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
        if (r.rc === 0) zeile(d.name, r);
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
