/**
 * M438 — Seitenleiste: Projekte und Boards ruhig unterscheidbar.
 *
 * Gemeldet: „In der Sidebar sehen Boards und Projekte vom Format her gleich aus … irgendwie sollte das abgesetzt
 * sein, ohne unruhig zu wirken!"
 *
 *   A  Ein Projekt trägt ein leises Ordner-Symbol und halbfette Schrift; ein Board normale Schrift, ohne Symbol.
 *   B  Die Boards eines offenen Projekts hängen eingerückt an einer feinen Linie.
 *   C  Ruhig: keine neuen Farbflächen, keine Rahmen um Zeilen; das gewählte Board trägt weiter die Akzentfläche.
 */
// Läuft aus dem Repository: `node pruefungen/m438-leiste-projekte.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 4774;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const n = (id) => ({ id, type: 'note', position: { x: 0, y: 0 }, width: 200, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: id }] } });
const BOARDS = [{ id: 'b1', name: 'Kickoff', edges: [], drawings: [], nodes: [n('a')] }, { id: 'b2', name: 'Roadmap', edges: [], drawings: [], nodes: [n('a'), n('b')] }, { id: 'b3', name: 'Ideen', edges: [], drawings: [], nodes: [] }];
const SPACES = [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Website', boardIds: ['b1', 'b2'] }, { id: 'p2', name: 'Privat', boardIds: ['b3'] }] }];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1300, height: 760 } });
await ctx.addInitScript(([bs, sp]) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: bs, spaces: sp, activeId: 'b2', view: 'board', navLinks: true } }));
}, [BOARDS, SPACES]);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1600);
const lage = await P.evaluate(() => {
  const proj = document.querySelector('.side-proj-name'); const board = document.querySelector('.side-proj-boards .side-board:not(.active) .side-board-name');
  const gruppe = document.querySelector('.side-proj-boards'); const aktiv = document.querySelector('.side-board.active');
  const cp = proj && getComputedStyle(proj); const cb = board && getComputedStyle(board); const cg = gruppe && getComputedStyle(gruppe);
  return {
    ordner: !!proj?.querySelector('svg.side-proj-ordner'), boardSymbol: !!board?.querySelector('svg'),
    projGewicht: cp ? Number(cp.fontWeight) : 0, boardGewicht: cb ? Number(cb.fontWeight) : 0,
    linie: cg ? cg.borderLeftStyle === 'solid' && parseFloat(cg.borderLeftWidth) >= 1 : false,
    einzug: gruppe && proj ? Math.round(gruppe.getBoundingClientRect().left - proj.closest('.side-proj-head').getBoundingClientRect().left) : -1,
    boardsFlaeche: board ? getComputedStyle(board.closest('.side-board')).backgroundColor : '',
    aktivFlaeche: aktiv ? getComputedStyle(aktiv).backgroundColor : '',
  };
});
console.log('A  Projekt und Board');
pruefe('A1 das Projekt trägt ein Ordner-Symbol, das Board keins', lage.ordner && !lage.boardSymbol, lage);
pruefe('A2 Projekt halbfett, Board normal', lage.projGewicht >= 600 && lage.boardGewicht <= 450, lage);
console.log('B  Gliederung');
pruefe('B1 die Boards hängen eingerückt an einer feinen Linie', lage.linie && lage.einzug >= 8, lage);
console.log('C  Ruhig');
pruefe('C1 keine Fläche hinter gewöhnlichen Boards, das gewählte trägt die Akzentfläche', /rgba\(0, 0, 0, 0\)|transparent/.test(lage.boardsFlaeche) && !/rgba\(0, 0, 0, 0\)/.test(lage.aktivFlaeche), lage);
await P.screenshot({ path: path.join(SD, 'm438-leiste.png'), clip: { x: 0, y: 0, width: 320, height: 420 } });

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('D1 Hilfe und Umbau-Liste nennen M438', /M438/.test(hilfe) && /M438/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM438: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
