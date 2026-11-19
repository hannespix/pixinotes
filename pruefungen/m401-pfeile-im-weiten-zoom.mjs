/**
 * M401 — Pfeilspitzen bleiben beim Herauszoomen im Maß.
 *
 * Gemeldet: „Beim Rauszoomen erscheinen die Pfeile bei extremen Zoomstufen unnatürlich groß."
 *
 * Ursache: Im weiten Zoom hielt das Stylesheet die Linie bei 2 Bildpunkten. Die Pfeilspitze ist an die Linienstärke
 * gebunden (8-fach) – sie stand mit 16 Bildpunkten vor Karten, die nur noch 20 breit waren.
 *
 *   A  Normale Zoomstufe: Linie und Spitze wie bisher (Linienstärke der Verbindung).
 *   B  Weiter Zoom: Die Linie bleibt sichtbar (mindestens 0,75 Bildpunkte), die Spitze misst höchstens rund 7
 *      Bildpunkte – deutlich kleiner als die Karte, auf die sie zeigt.
 *   C  Sehr weiter Zoom: weiter im Maß, ohne Sprung an der Grenze.
 *   D  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m401-pfeile-im-weiten-zoom.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4717;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const notiz = (id, x, y) => ({ id, type: 'note', position: { x, y }, width: 220, height: 150, autoFit: false, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text: id, styles: {} }] }] } });
/** Zwei Karten im Abstand `weite` – die Ansicht passt sie ein, je weiter auseinander, desto kleiner der Zoom */
const auf = async (weite) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((w) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    const n = (id, x, y) => ({ id, type: 'note', position: { x, y }, width: 220, height: 150, autoFit: false, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text: id, styles: {} }] }] } });
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b0', name: 'Test', drawings: [], nodes: [n('a', 0, 0), n('b', w, w * 0.4)], edges: [{ id: 'e1', source: 'a', target: 'b', type: 'labeled' }] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, weite);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
};
void notiz;
/** Zoom, Linienstärke und Größe der Pfeilspitze in Bildpunkten, dazu die Breite einer Karte auf dem Bildschirm */
const messen = (P) => P.evaluate(() => {
  const v = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
  const pfad = document.querySelector('.react-flow__edge .react-flow__edge-path');
  const stark = parseFloat(getComputedStyle(pfad).strokeWidth);
  const id = (pfad.getAttribute('marker-end') ?? '').replace(/^url\(#|\)$/g, '').replace(/"/g, '');
  const marke = document.getElementById(id);
  const mw = Number(marke?.getAttribute('markerWidth') ?? 0);
  const karte = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect();
  return { zoom: Math.round(v.a * 1000) / 1000, weit: document.querySelector('.board-wrap').hasAttribute('data-weit'), linieFlaeche: stark, linie: Math.round(stark * v.a * 100) / 100, spitze: Math.round(stark * v.a * mw * 100) / 100, karte: Math.round(karte.width * 10) / 10, mw };
});

// ---------- A: normale Zoomstufe ----------
console.log('A  Normale Zoomstufe');
{
  const { ctx, P } = await auf(700);
  const m = await messen(P);
  pruefe('A1 die Ansicht ist nicht „weit"', m.zoom > 0.5 && !m.weit, m);
  pruefe('A2 Linie und Spitze wie bisher: Linienstärke der Verbindung, Spitze das Achtfache', m.linieFlaeche >= 1.5 && m.linieFlaeche <= 2.6 && m.mw === 8, m);
  await ctx.close();
}

// ---------- B: weiter Zoom ----------
console.log('B  Weiter Zoom');
let weit;
{
  const { ctx, P } = await auf(7000);
  weit = await messen(P);
  pruefe('B1 die Ansicht ist „weit" (unter 45 %)', weit.zoom < 0.3 && weit.weit, weit);
  pruefe('B2 die Linie bleibt sichtbar: mindestens 0,75 Bildpunkte', weit.linie >= 0.74, weit);
  pruefe('B3 … aber nicht mehr 2 Bildpunkte stark', weit.linie <= 1.0, weit);
  pruefe('B4 die Pfeilspitze misst höchstens rund 7 Bildpunkte (vorher 16)', weit.spitze <= 7.6 && weit.spitze >= 5.5, weit);
  pruefe('B5 … und ist deutlich kleiner als die Karte, auf die sie zeigt', weit.spitze < weit.karte * 0.4, { spitze: weit.spitze, karte: weit.karte });
  await ctx.close();
}

// ---------- C: sehr weit, und die Grenze ----------
console.log('C  Sehr weiter Zoom und die Grenze');
{
  const { ctx, P } = await auf(16000);
  const m = await messen(P);
  pruefe('C1 auch sehr weit draußen bleibt die Spitze bei rund 6 Bildpunkten', m.zoom < weit.zoom && m.spitze <= 6.6 && m.spitze >= 5.5 && m.linie >= 0.74, m);
  await ctx.close();
  // knapp unter der Grenze: kein Sprung gegenüber der natürlichen Stärke knapp darüber
  const G = await auf(2600);
  const g = await messen(G.P);
  pruefe('C2 an der Grenze zum weiten Zoom springt nichts: die Linie liegt bei knapp einem Bildpunkt', g.zoom > 0.3 && g.zoom < 0.6 && g.linie >= 0.75 && g.linie <= 1.25, g);
  await G.ctx.close();
}

// ---------- D: Texte ----------
console.log('D  Texte');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  pruefe('D1 die Hilfe nennt M401 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M401)') && lies('src/components/HelpOverlayEn.tsx').includes('(M401)'));
  pruefe('D2 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm401-pfeile-im-weiten-zoom: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
