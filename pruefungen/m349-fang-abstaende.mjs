/**
 * M349 — Fangen an Abständen.
 *
 *   A  Mitte: Eine Karte zwischen zwei Nachbarn in derselben Reihe rastet genau mittig ein; zwei
 *      waagerechte Abstandsmarken mit gleichem Maß zeigen es.
 *   B  Gleicher Abstand: Hinter zwei Karten mit 60 Punkten Abstand rastet die dritte im selben Abstand ein.
 *   C  Senkrecht ebenso (Mitte zwischen zwei Karten einer Spalte).
 *   D  Strg legt frei ab; nach dem Ablegen sind die Marken weg.   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m349-fang-abstaende.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4567;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const nz = (id, x, y, farbe = 'yellow') => ({ id, type: 'note', width: 200, height: 120, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
const stand = () => ({
  boards: [{ id: 'b1', name: 'Abstände', comments: [], edges: [], drawings: [], nodes: [
    nz('a1', 0, 0), nz('b1', 600, 0), nz('c1', 280, 0, 'sky'),          // A: Mitte = 300
    nz('a2', 0, 400), nz('b2', 260, 400), nz('c2', 540, 400, 'sky'),    // B: gleicher Abstand 60 → 520
    nz('d1', 1100, 0), nz('d2', 1100, 400), nz('e1', 1100, 190, 'sky'), // C: senkrechte Mitte = 200
  ] }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
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
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
const z = Number(await P.evaluate(() => /scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const lage = async (id) => { await P.waitForTimeout(1300); return P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id).position, id); };
const griff = (id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const leer = () => P.mouse.click(1420, 880).then(() => P.waitForTimeout(200));
const marken = () => P.evaluate(() => [...document.querySelectorAll('.fang-abstand')].map((m) => ({ art: m.classList.contains('h') ? 'h' : 'v', mass: Number(m.textContent) })));
/** Karte um (dx, dy) Board-Punkte ziehen, unterwegs die Marken lesen */
async function ziehen(id, dx, dy, strg = false) {
  await leer();
  const g = await griff(id);
  if (strg) await P.keyboard.down('Control');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + dx * z * 0.4, g[1] + dy * z * 0.4, { steps: 3 });
  await P.mouse.move(g[0] + dx * z, g[1] + dy * z, { steps: 5 }); await P.waitForTimeout(150);
  const m = await marken();
  await P.mouse.up();
  if (strg) await P.keyboard.up('Control');
  return m;
}
console.log(`  (Zoom ${z})`);

console.log('\n════ A: mittig zwischen zwei Karten ════');
{
  const m = await ziehen('c1', 17, 1);
  const p = await lage('c1');
  pruefe('A1 abgelegt liegt die Karte genau mittig (x = 300)', p.x === 300 && p.y === 0, p);
  const h = m.filter((x) => x.art === 'h');
  pruefe('A2 unterwegs zwei waagerechte Abstandsmarken mit gleichem Maß (100)', h.length === 2 && h.every((x) => x.mass === 100), m);
  pruefe('A3 nach dem Ablegen sind die Marken weg', (await marken()).length === 0);
}

console.log('\n════ B: gleicher Abstand ════');
{
  const m = await ziehen('c2', -17, 1);
  const p = await lage('c2');
  pruefe('B1 die dritte Karte rastet im selben Abstand ein (x = 520)', p.x === 520 && p.y === 400, p);
  const h = m.filter((x) => x.art === 'h');
  pruefe('B2 zwei Marken zeigen beide Abstände (60 und 60)', h.length === 2 && h.every((x) => x.mass === 60), m);
}

console.log('\n════ C: senkrecht ════');
{
  const m = await ziehen('e1', 1, 7);
  const p = await lage('e1');
  pruefe('C1 senkrecht mittig zwischen zwei Karten einer Spalte (y = 200)', p.y === 200 && p.x === 1100, p);
  const v = m.filter((x) => x.art === 'v');
  pruefe('C2 zwei senkrechte Marken mit gleichem Maß (80)', v.length === 2 && v.every((x) => x.mass === 80), m);
}

console.log('\n════ D: Strg ════');
{
  // c1 aus der Mitte (300) ein Stück nach rechts — mit Strg rastet es nicht zurück
  // (die Ziehschwelle schluckt am Anfang ein paar Punkte; entscheidend ist: nicht 300)
  const m = await ziehen('c1', 5, 0, true);
  const p = await lage('c1');
  pruefe('D1 mit Strg keine Marken und kein Einrasten', m.length === 0 && p.x > 300.5 && p.x < 306, { m, p });
}

console.log('\n════ E: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('E1 „Was ist neu" nennt M349', js.includes('(M349)'));

await browser.close(); app.close();
console.log(`\nm349-fang-abstaende: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
