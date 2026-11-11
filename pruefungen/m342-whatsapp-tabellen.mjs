/**
 * M342 — Tabellen und Module in der WhatsApp-Nachricht.
 *
 *   A  Schmale Tabelle: Festbreitenschrift, Spalten ausgerichtet, Zahlen rechtsbündig, Kopf abgesetzt.
 *   B  Breite Tabelle: „Karteikarten" (erste Zelle fett, darunter „Spaltenkopf: Wert"), leere Zellen weg.
 *   C  Rechen-Tabelle (Karte): errechnete Werte, ohne leere Spalten, ohne Tabulatoren.
 *   D  Zeitplan, Wochenplan, Zeiterfassung: gegliedert, mit lesbarem Datum.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m342-whatsapp-tabellen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4560;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const t = (text, styles = {}) => ({ type: 'text', text, styles });
const tab = (id, zeilen) => ({ id, type: 'table', content: { type: 'tableContent', rows: zeilen.map((r) => ({ cells: r.map((c) => (typeof c === 'string' ? [t(c)] : [c])) })) } });
const stand = () => ({
  boards: [{ id: 'b1', name: 'WA', comments: [], edges: [], drawings: [], nodes: [
    { id: 'n1', type: 'note', width: 340, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [
      { id: 'a0', type: 'paragraph', content: 'Einkauf' },
      tab('a1', [['Artikel', 'Menge', 'Preis'], ['Äpfel', '3', '2,40'], ['Brot', '1', '3,10']]),
      { id: 'a2', type: 'paragraph', content: 'Danach' },
    ] } },
    { id: 'n2', type: 'note', width: 420, position: { x: 420, y: 0 }, data: { color: 'sky', blocks: [
      { id: 'b0', type: 'paragraph', content: 'Verteilung' },
      tab('b1', [['Aufgabe', 'Zuständig', 'Bis wann'], ['Angebot für den Relaunch schreiben', t('Mia Schneider', { bold: true }), 'nächste Woche'], ['Raum buchen', 'Jonas', '']]),
    ] } },
    { id: 'n3', type: 'sheet', width: 460, height: 300, position: { x: 920, y: 0 }, data: { title: 'Kosten', cols: 5, rows: 8, cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '800', A3: 'Strom', B3: '95', A4: 'Summe', B4: '=SUMME(B2:B3)' } } },
    { id: 'n4', type: 'gantt', width: 520, height: 240, position: { x: 0, y: 420 }, data: { title: 'Fahrplan', dayWidth: 24, rows: [
      { id: 'g1', name: 'Konzept', start: '2026-12-01', end: '2026-12-05', color: '#4f7cff', progress: 50, who: 'Mia' },
      { id: 'g2', name: 'Abgabe', start: '2026-12-10', end: '2026-12-10', color: '#e0a800' }] } },
    { id: 'n5', type: 'week', width: 620, height: 440, position: { x: 600, y: 420 }, data: { title: 'Stundenplan', days: 5, from: 480, to: 1020, entries: [
      { id: 'w1', day: 0, start: 480, dur: 90, text: 'Mathe', who: 'Mia' }, { id: 'w2', day: 2, start: 600, dur: 60, text: 'Sport' }] } },
    { id: 'n6', type: 'time', width: 460, height: 380, position: { x: 1300, y: 420 }, data: { title: 'Stunden', segs: [
      { id: 'z1', date: '2026-12-01', start: 480, end: 720, kind: 'arbeit' }, { id: 'z2', date: '2026-12-01', start: 720, end: 750, kind: 'pause' },
      { id: 'z3', date: '2026-12-01', start: 750, end: 960, kind: 'arbeit', note: 'Kunde' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(({ st }) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, { st: stand() });
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(2000);
/** Die WhatsApp-Nachricht für diese Karte (aus dem Link im Teilen-Dialog) */
const nachricht = async (id) => {
  await P.evaluate(() => document.querySelector('.share-cards-modal .modal-x')?.click());
  await P.mouse.click(1380, 860); await P.waitForTimeout(150);
  await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true }); await P.waitForTimeout(300);
  await P.locator('.sel-toolbar [aria-label="Teilen"]').click();
  await P.waitForSelector('.share-cards-modal a.share-ziel'); await P.waitForTimeout(200);
  const h = await P.locator('.share-cards-modal a.share-ziel').getAttribute('href');
  const text = decodeURIComponent(h.replace('https://wa.me/?text=', ''));
  console.log(text.split('\n').map((z) => `      │ ${z}`).join('\n'));
  return text;
};

console.log('\n════ A: schmale Tabelle ════');
let x = await nachricht('n1');
const block = /```([\s\S]*?)```/.exec(x)?.[1] ?? '';
const zl = block.split('\n');
pruefe('A1 in Festbreitenschrift, alle Zeilen gleich ausgerichtet', zl.length === 4 && zl[0] === 'Artikel  Menge  Preis' && zl[1] === '-'.repeat(21), JSON.stringify(zl));
pruefe('A2 Zahlen rechtsbündig unter ihrer Spalte', zl[2] === 'Äpfel        3   2,40' && zl[3] === 'Brot         1   3,10', JSON.stringify(zl.slice(2)));
pruefe('A3 keine „|"-Zeilen mehr, Text davor und danach abgesetzt', !x.includes(' | ') && /\*Einkauf\*\n\n```/.test(x) && /```\n\nDanach$/.test(x));

console.log('\n════ B: breite Tabelle ════');
x = await nachricht('n2');
pruefe('B1 je Zeile eine Karte: erste Zelle fett, darunter „Spaltenkopf: Wert"', x.includes('*Angebot für den Relaunch schreiben*\nZuständig: *Mia Schneider*\nBis wann: nächste Woche'), x);
pruefe('B2 leere Zellen bleiben weg, Karten sind abgesetzt', x.includes('\n\n*Raum buchen*\nZuständig: Jonas') && !/Bis wann:\s*(\n|$)/.test(x) && !x.includes('```'));

console.log('\n════ C: Rechen-Tabelle ════');
x = await nachricht('n3');
const rb = (/```([\s\S]*?)```/.exec(x)?.[1] ?? '').split('\n');
pruefe('C1 Titel fett, Tabelle in Festbreitenschrift ohne leere Spalten und Tabulatoren', x.startsWith('*Kosten*\n\n```') && !x.includes('\t') && rb[0] === 'Posten  Betrag', JSON.stringify(rb));
pruefe('C2 errechnete Werte, rechtsbündig', rb.some((z) => /^Summe\s+895$/.test(z)) && rb.every((z, i) => i === 1 || z.length === rb[0].length || z.length <= rb[0].length), JSON.stringify(rb));

console.log('\n════ D: Zeitplan, Wochenplan, Zeiterfassung ════');
x = await nachricht('n4');
pruefe('D1 Zeitplan: Vorgang mit lesbarem Datum, Fortschritt, Person; Meilenstein als ◆', /\*Fahrplan\*\n\n▬ Konzept: 01\.12\.(2026)?–05\.12\.(2026)? · 50 % · @Mia\n◆ Abgabe: 10\.12\.(2026)?$/.test(x), x);
x = await nachricht('n5');
pruefe('D2 Wochenplan: nach Tagen gegliedert, leere Tage weg', x === '*Stundenplan*\n\n_Montag_\n8:00–9:30 Mathe (Mia)\n\n_Mittwoch_\n10:00–11:00 Sport', JSON.stringify(x));
x = await nachricht('n6');
pruefe('D3 Zeiterfassung: je Tag mit Summe ohne Pausen', /\*Stunden\*\n\n_01\.12\.(2026)?_ · 7:30 h\n8:00–12:00 Arbeit\n12:00–12:30 Pause\n12:30–16:00 Arbeit \(Kunde\)$/.test(x), JSON.stringify(x));

console.log('\n════ E: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('E1 „Was ist neu" nennt M342', js.includes('(M342)'));

await browser.close();
app.close();
console.log(`\nm342-whatsapp-tabellen: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
