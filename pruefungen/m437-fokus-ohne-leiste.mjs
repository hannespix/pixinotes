/**
 * M437 — Fokus mit angehefteter Seitenleiste: kein toter Streifen links.
 *
 * Gemeldet: „Wenn die Übersicht als Sidebar angeheftet ist, dann bleibt der Sidebar-Bereich als toter Raum auch im
 * Vollbild beim Fokusmodus stehen."
 *
 *   A  Ohne Fokus: Die angeheftete Leiste steht links, die Fläche beginnt rechts davon (wie bisher).
 *   B  Im Fokus: Die Leiste tritt zurück, und die Fläche reicht bis an den linken Rand — die Karte steht in der Mitte
 *      des ganzen Fensters, nicht in der Mitte des Rests.
 *   C  Auch in „Nur Inhalt" (Taste F); nach dem Fokus ist die Leiste wieder da.
 */
// Läuft aus dem Repository: `node pruefungen/m437-fokus-ohne-leiste.mjs`
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
const PORT = 4773;
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
const NODES = [
  { id: 'a', type: 'mermaid', position: { x: 0, y: 0 }, width: 320, height: 240, data: { code: 'graph TD\n  A[Idee] --> B[Prüfen]' } },
];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 860 } });
await ctx.addInitScript(([ns]) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Fokus', edges: [], drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board', navLinks: true, cardFocus: true } }));
}, [NODES]);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2000);
const mass = () => P.evaluate(() => {
  const pane = document.querySelector('.react-flow').getBoundingClientRect();
  const band = getComputedStyle(document.querySelector('.app'), '::before');
  const k = document.querySelector('.react-flow__node[data-id="a"]')?.getBoundingClientRect();
  return { links: Math.round(pane.left), breite: Math.round(pane.width), band: band.display !== 'none' && band.content !== 'none' ? Math.round(parseFloat(band.width)) : 0,
    leiste: !!document.querySelector('.tabs.spalte') && getComputedStyle(document.querySelector('.tabs.spalte')).display !== 'none',
    mitte: k ? Math.round(k.left + k.width / 2) : null };
});

console.log('A  Ohne Fokus');
const a = await mass();
pruefe('A1 die angeheftete Leiste steht links, die Fläche beginnt rechts davon', a.leiste && a.links > 200 && a.band > 200, a);

console.log('B  Im Fokus');
// Die einzige Karte wählen (Strg+A auf der Fläche), Enter öffnet den Fokus (bei Notizen hieße Enter: schreiben)
await P.mouse.click(1300, 760); await P.waitForTimeout(200);
await P.keyboard.press('Control+a'); await P.waitForTimeout(200);
await P.keyboard.press('Enter'); await P.waitForTimeout(1600);
const b = await mass();
pruefe('B1 die Leiste tritt zurück — und mit ihr ihr Band', !b.leiste && b.band === 0, b);
pruefe('B2 die Fläche reicht bis an den linken Rand (kein toter Streifen)', b.links === 0 && b.breite === 1400, b);
pruefe('B3 die Karte steht in der Mitte des ganzen Fensters', b.mitte !== null && Math.abs(b.mitte - 700) <= 6, b);
await P.waitForTimeout(1500); await P.screenshot({ path: path.join(SD, 'm437-fokus.png') });

console.log('C  Nur Inhalt');
await P.mouse.move(700, 120);
await P.keyboard.press('f'); await P.waitForTimeout(1200);
const c = await P.evaluate(() => document.documentElement.dataset.rein ?? '');
const c1 = await mass();
pruefe('C1 auch in „Nur Inhalt" kein Streifen — die Karte mittig im ganzen Schirm', c === 'fokus' && c1.links === 0 && c1.band === 0 && Math.abs(c1.mitte - 700) <= 6, { c, c1 });
await P.keyboard.press('Escape'); await P.waitForTimeout(600);
await P.keyboard.press('Escape'); await P.waitForTimeout(1200);
const d = await mass();
pruefe('C2 nach dem Fokus ist die Leiste wieder da, die Fläche rechts davon', d.leiste && d.links > 200 && d.band > 200, d);

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('D1 Hilfe und Umbau-Liste nennen M437', /M437/.test(hilfe) && /M437/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM437: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
