/**
 * M348 — Der Strich erscheint sofort.
 *
 *   A  Während des Zugs wächst der sichtbare Strich mit JEDER Bewegung (vorher erschien er erst beim Absetzen).
 *   B  Zeit vom Zeiger-Ereignis bis zur sichtbaren Änderung unter 4 ms (auch mit 300 Strichen auf dem Board).
 *   C  Nach dem Absetzen: genau ein gespeicherter Strich, kein laufender Pfad mehr; vorhergesagte Punkte
 *      werden nie gespeichert.
 *   D  Textmarker ebenso.   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m348-stift-sofort.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4566;
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
const alte = Array.from({ length: 300 }, (_, i) => ({ id: 'alt' + i, tool: 'pen', color: '#333', width: 2.5, points: Array.from({ length: 40 }, (_, k) => [i * 3 + k * 2, 900 + Math.sin(k / 3) * 20]) }));
const stand = () => ({
  boards: [{ id: 'b1', name: 'Stift', comments: [], edges: [], drawings: alte, nodes: [] }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(({ st }) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, { st: stand() });
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
await P.evaluate(() => {
  window.__lat = []; let t0 = 0;
  window.addEventListener('pointermove', () => { t0 = performance.now(); }, true);
  new MutationObserver(() => { if (t0) { window.__lat.push(performance.now() - t0); t0 = 0; } })
    .observe(document.querySelector('.react-flow'), { subtree: true, attributes: true, attributeFilter: ['d'], childList: true });
});
const laufend = () => P.evaluate(() => { const e = document.querySelector('.drawing-layer .strich-laufend'); return e ? e.getAttribute('d').length : -1; });
const gespeichert = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings);

async function zug(werkzeug, y) {
  await P.keyboard.press(werkzeug); await P.waitForTimeout(250);
  await P.evaluate(() => { window.__lat = []; });
  await P.mouse.move(200, y); await P.mouse.down();
  const laengen = [];
  for (let i = 1; i <= 40; i += 1) { await P.mouse.move(200 + i * 9, y + Math.sin(i / 3) * 30); laengen.push(await laufend()); }
  await P.mouse.up(); await P.waitForTimeout(1400);
  return laengen;
}

console.log('\n════ A–C: Stift ════');
{
  const l = await zug('p', 250);
  let wuchs = 0; for (let i = 1; i < l.length; i += 1) if (l[i] !== l[i - 1]) wuchs += 1;
  pruefe('A1 der laufende Strich ist während des Zugs zu sehen', l.every((x) => x > 0), l.slice(0, 5));
  pruefe('A2 er ändert sich mit (fast) jeder Bewegung', wuchs >= 36, `${wuchs} von 39`);
  const lat = await P.evaluate(() => window.__lat.slice().sort((a, b) => a - b));
  const median = lat[Math.floor(lat.length / 2)]; const p90 = lat[Math.floor(lat.length * 0.9)];
  pruefe('B1 Ereignis → sichtbare Änderung: Median unter 4 ms, 90 % unter 8 ms (300 Striche auf dem Board)', lat.length >= 36 && median < 4 && p90 < 8, { n: lat.length, median, p90 });
  const ds = await gespeichert();
  const neu = ds.filter((s) => !s.id.startsWith('alt'));
  pruefe('C1 nach dem Absetzen: genau ein neuer gespeicherter Strich', neu.length === 1 && neu[0].tool === 'pen', neu.length);
  pruefe('C2 kein laufender Pfad mehr, der Strich steht in der Ebene', (await laufend()) === -1 && (await P.evaluate(() => document.querySelectorAll('.drawing-layer path').length)) === 301);
  const xs = neu[0].points.map((p) => p[0]);
  pruefe('C3 gespeichert ist nur, was der Stift berührt hat (keine Vorhersage über das Ende hinaus)', Math.max(...xs) <= Math.max(...xs.slice(0, -1), xs[xs.length - 1]) && neu[0].points.length <= 42, { n: neu[0].points.length, maxX: Math.max(...xs) });
}

console.log('\n════ D: Textmarker ════');
{
  const l = await zug('m', 450);
  let wuchs = 0; for (let i = 1; i < l.length; i += 1) if (l[i] !== l[i - 1]) wuchs += 1;
  pruefe('D1 der Textmarker wächst ebenso mit jeder Bewegung', l.every((x) => x > 0) && wuchs >= 36, `${wuchs} von 39`);
  const ds = await gespeichert();
  pruefe('D2 danach ein gespeicherter Textmarker-Strich', ds.filter((s) => !s.id.startsWith('alt') && s.tool === 'marker').length === 1);
}

console.log('\n════ E: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('E1 „Was ist neu" nennt M348', js.includes('(M348)'));

await browser.close(); app.close();
console.log(`\nm348-stift-sofort: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
