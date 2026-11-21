// M425: Startvorlage für das Modul „Präsentation" (Vibe Studio) erzeugen.
//
// Vibe Studio (github.com/hannespix/vibestudio) ist der Präsentations-Editor des Betreibers: Reveal.js-Folien, die
// sich in der Datei selbst bearbeiten lassen. PixiNotes nimmt dessen leere Ein-Datei-Fassung als Vorlage und legt
// sie als App-Karte aufs Board — die Karte speichert den Entwurf des Editors (localStorage-Brücke, htmlStore.ts).
//
// Neu erzeugen (im Vibe-Studio-Ordner):
//   node tools/new-deck.mjs leer --blank --draft --force && node build.mjs
// dann hier:
//   node werkzeug/vibestudio-vorlage.mjs <vibestudio>/decks/leer/index.html
// Die Datei muss die Ein-Datei-Fassung sein (alle Bilder, Schriften und Skripte eingebettet) — sonst fehlen in der
// Karte die Assets. Ohne „--draft" liegt sie unter dist/leer/index.html.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const quelle = process.argv[2];
if (!quelle) { console.error('Aufruf: node werkzeug/vibestudio-vorlage.mjs <leere Vibe-Studio-Datei>'); process.exit(1); }
let html = readFileSync(quelle, 'utf8');

/** Ersetzungen: Name und Untertitel der leeren Titelfolie, Signatur, Fenstertitel */
const ersetzen = [
  [/<h1>[^<]*<\/h1><p>ein neuer vortrag<\/p>/, '<h1>Neue Präsentation</h1><p>Untertitel</p>'],
  [/class="signature">[^<]*<span>Vibe Studio<\/span>/, 'class="signature">Dein Name <span>Thema</span>'],
  [/<title>[^<]*<\/title>/, '<title>Präsentation</title>'],
  // „☰ Alle Vorträge" führt zur Übersicht von Vibe Studio — in der Karte gibt es die nicht (der Link liefe ins Leere)
  [/<\/head>/, '<style>#decks{display:none!important}</style></head>'],
];
for (const [muster, neu] of ersetzen) {
  if (!muster.test(html)) { console.error(`Nicht gefunden: ${muster} — hat sich die Vorlage von Vibe Studio geändert?`); process.exit(1); }
  html = html.replace(muster, neu);
}
// Externe Verweise wären in der Karte tot (Sandbox ohne Netz-Herkunft) — nur eine Warnung, kein Abbruch
const extern = html.match(/(?:src|href)="(?:assets|\.\.?)\/[^"]+"/g)?.filter((v) => v !== 'href="../index.html"');
if (extern?.length) console.warn(`Achtung, nicht eingebettete Verweise: ${[...new Set(extern)].slice(0, 5).join(', ')}`);

mkdirSync('public/vorlagen', { recursive: true });
writeFileSync('public/vorlagen/vibestudio.html', html);
console.log(`public/vorlagen/vibestudio.html geschrieben (${(html.length / 1e6).toFixed(2)} MB)`);
