// M381: Setzt das Wörterbuch src/sprache/en.json aus Teil-Dateien zusammen (Reihenfolge der Ernte, damit
// Änderungen im Verlauf lesbar bleiben) und prüft es: jeder Eintrag belegt, Platzhalter vollständig.
//   node werkzeug/sprache-bauen.mjs <teil1.json> <teil2.json> …   (spätere Dateien überschreiben frühere)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ernten } from './sprache-ernten.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const ziel = path.join(repo, 'src/sprache/en.json');
const alt = existsSync(ziel) ? JSON.parse(readFileSync(ziel, 'utf-8')) : {};
const alle = { ...alt };
for (const f of process.argv.slice(2)) Object.assign(alle, JSON.parse(readFileSync(f, 'utf-8')));
const funde = ernten();
const aus = {}; const fehlt = []; const falsch = [];
const platz = (s) => (s.match(/\{\d+\}/g) ?? []).sort().join(',');
for (const f of funde) {
  const en = alle[f.de];
  if (typeof en !== 'string' || !en) { fehlt.push(f); continue; }
  if (platz(f.de) !== platz(en)) falsch.push(`${f.de} → ${en}`);
  aus[f.de] = en;
}
// Einträge, die die Ernte nicht (mehr) kennt, bleiben erhalten, wenn sie von Hand nachgetragen wurden (zur Laufzeit gefundene Texte)
const hand = path.join(repo, 'werkzeug/sprache-nachtrag.json');
if (existsSync(hand)) for (const [de, en] of Object.entries(JSON.parse(readFileSync(hand, 'utf-8')))) aus[de] = en;
writeFileSync(ziel, JSON.stringify(aus, null, 0).replace(/","/g, '",\n"') + '\n');
console.log(`${Object.keys(aus).length} Einträge → src/sprache/en.json · ${fehlt.length} fehlen · ${falsch.length} mit falschen Platzhaltern`);
if (falsch.length) console.log(falsch.join('\n'));
if (fehlt.length) writeFileSync(path.join(repo, 'werkzeug/fehlend.json'), JSON.stringify(fehlt.map((f) => ({ de: f.de, art: f.art, stelle: f.stellen[0], kontext: (f.kontext ?? '').slice(0, 160) })), null, 1));
