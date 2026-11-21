/**
 * M417 — Flache Karten mit leisen Rändern.
 *
 * Gewünscht: „flat, clean, randlose Bubbles und Module … mit wenig sichtbaren Rändern und Grenzen" — und nach dem
 * ersten Entwurf mit perspektivischen Pfeilschatten: „Der 3D-Effekt passt nicht zum sleeken Flat-Design."
 *
 *   A  Karten: eine leise 1-px-Kante, der Schatten nur ein Hauch (kein Schwebeschatten) — hell und dunkel.
 *   B  Angehoben (unter dem Zeiger): etwas deutlicher umrissen, aber flach.
 *   C  Pfeile flach: kein Schatten, keine Maske unter oder an den Verbindungen.
 *   D  Hoher Kontrast behält kräftige Kanten.
 *   E  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m417-flache-karten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4750;
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
const nodes = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 260, data: { color: 'white', blocks: [{ type: 'paragraph', content: 'Erste Karte' }] } },
  { id: 'n2', type: 'note', position: { x: 480, y: 160 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Zweite Karte' }] } },
];
const edges = [{ id: 'e1', source: 'n1', target: 'n2', type: 'labeled', data: {} }];
async function auf({ dunkel = false, kontrast = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([ns, es, k]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    if (k) localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ hoherKontrast: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Test', edges: es, drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
  }, [nodes, edges, kontrast]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
/** box-shadow zerlegen: je Schatten { y, blur, spread, alpha } */
const teile = (s) => [...s.matchAll(/rgba?\(([^)]+)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/g)].map((m) => {
  const c = m[1].split(',').map(Number); return { alpha: c.length > 3 ? c[3] : 1, y: +m[3], blur: +m[4], spread: +(m[5] ?? 0) };
});
const schatten = (P) => P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="n1"]')).boxShadow);

console.log('A/B/C  hell');
{
  const { ctx, P } = await auf();
  const t = teile(await schatten(P));
  const kante = t.find((x) => x.blur === 0 && x.spread === 1); const weich = t.filter((x) => x !== kante);
  pruefe('A1 hell: leise Kante (≤ 7 % Deckkraft), Schatten nur ein Hauch (Unschärfe ≤ 2 px, kein Versatz über 1 px)', !!kante && kante.alpha <= 0.07 && weich.every((x) => x.blur <= 2 && x.y <= 1), t);
  await P.locator('.react-flow__node[data-id="n1"]').hover(); await P.waitForTimeout(400);
  const h = teile(await schatten(P));
  const hk = h.find((x) => x.blur === 0 && x.spread === 1);
  pruefe('B1 unter dem Zeiger: deutlicher umrissen, aber flach (Unschärfe ≤ 6 px, Versatz ≤ 2 px)', !!hk && hk.alpha > kante.alpha && h.filter((x) => x !== hk).every((x) => x.blur <= 6 && x.y <= 2), h);
  const c = await P.evaluate(() => ({ kanten: document.querySelectorAll('.react-flow__edge').length, schatten: document.querySelectorAll('.react-flow__edge .pn-kante-schatten, .react-flow__edge [filter]').length, maske: [...document.querySelectorAll('.react-flow__edge path')].some((p) => (getComputedStyle(p).mask ?? 'none') !== 'none' && getComputedStyle(p).maskImage !== 'none') }));
  pruefe('C1 Pfeile flach: kein Schatten, keine Maske an der Verbindung', c.kanten === 1 && c.schatten === 0 && !c.maske, c);
  await ctx.close();
}
console.log('A  dunkel');
{
  const { ctx, P } = await auf({ dunkel: true });
  const t = teile(await schatten(P));
  const kante = t.find((x) => x.blur === 0 && x.spread === 1);
  pruefe('A2 dunkel: leise helle Kante, Schatten nur ein Hauch', !!kante && kante.alpha <= 0.07 && t.filter((x) => x !== kante).every((x) => x.blur <= 2 && x.y <= 1), t);
  await ctx.close();
}
console.log('D  hoher Kontrast');
{
  const { ctx, P } = await auf({ kontrast: true });
  const an = await P.evaluate(() => document.documentElement.dataset.kontrast);
  const t = teile(await schatten(P));
  const kante = t.find((x) => x.blur === 0 && x.spread === 1);
  pruefe('D1 hoher Kontrast: kräftige Kante (≥ 25 %)', an === 'hoch' && !!kante && kante.alpha >= 0.25, { an, t });
  await ctx.close();
}
console.log('E  Hilfe');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('E1 Hilfe nennt M417 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M417)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M417)'));
pruefe('E2 docs/UMBAU.md führt M417', quelle('docs/UMBAU.md').includes('M417'));
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM417: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
