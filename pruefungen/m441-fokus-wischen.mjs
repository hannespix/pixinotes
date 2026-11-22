/**
 * M441 — Vollbild-Fokus am Telefon: mit einem Wisch zur nächsten Karte.
 *
 * Gewünscht: „Wenn man im Fokus-Modus in die Full-Screen-Ansicht wechselt, soll man auch mit typischen Touch-Gesten am
 * Smartphone zum nächsten Modul wechseln können!"
 *
 *   A  In „Nur Inhalt" (Kopf und Fuß sind weg) wischt ein Finger nach links → nächste Karte, nach rechts → vorige —
 *      überall auf dem Schirm, auch über die Karte hinweg.
 *   B  Kein Wechsel bei: senkrechtem Wisch (Rollen), Zwei-Finger-Geste, seitlichem Rollen in der Karte (breite
 *      Tabelle), zu langsamem Zug.
 *   C  Außerhalb des Vollbilds bleibt die Karte selbst wisch-frei (dort wischt man am Kopf/Fuß, wie bisher).
 */
// Läuft aus dem Repository: `node pruefungen/m441-fokus-wischen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 4776;
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
const note = (id, x, text) => ({ id, type: 'note', position: { x, y: 0 }, width: 240, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
// eine breite Tabelle als dritte Karte (rollt seitlich)
const zellen = {}; for (let c = 0; c < 14; c++) for (let z = 1; z <= 4; z++) zellen[`${String.fromCharCode(65 + c)}${z}`] = `Wert ${c}-${z}`;
const NODES = [note('a', 0, 'Erste Karte'), note('b', 320, 'Zweite Karte'),
  { id: 't', type: 'sheet', position: { x: 640, y: 0 }, width: 300, height: 220, data: { title: 'Breit', cells: zellen, cols: 14, rows: 4 } }];
const EDGES = [{ id: 'e1', source: 'a', target: 'b', type: 'labeled', data: {} }, { id: 'e2', source: 'b', target: 't', type: 'labeled', data: {} }];
const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE' });
await ctx.addInitScript(([ns, es]) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Wischen', edges: es, drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board', cardFocus: true } }));
}, [NODES, EDGES]);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2000);
const cdp = await ctx.newCDPSession(P);
const W = P.viewportSize().width; const H = P.viewportSize().height;
/** Ein Finger (oder zwei) wischt von a nach b in `ms` Millisekunden */
const wisch = async (von, nach, ms = 180, zwei = false) => {
  const pkt = (p, k) => (zwei ? [{ x: p[0], y: p[1], id: 1 }, { x: p[0] + 60 * k, y: p[1] + 10, id: 2 }] : [{ x: p[0], y: p[1], id: 1 }]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pkt(von, 1) });
  const n = 8;
  for (let i = 1; i <= n; i += 1) {
    const p = [von[0] + ((nach[0] - von[0]) * i) / n, von[1] + ((nach[1] - von[1]) * i) / n];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pkt(p, 1) });
    await P.waitForTimeout(ms / n);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await P.waitForTimeout(900);
};
const fokus = () => P.evaluate(() => document.querySelector('.react-flow__node.pn-focused')?.dataset.id ?? null);

// Fokus öffnen: am Telefon öffnet ein Tipp die Karte
const a = await P.locator('.react-flow__node[data-id="a"]').boundingBox();
await P.touchscreen.tap(a.x + a.width / 2, a.y + 12); await P.waitForTimeout(1300);
pruefe('Ausgangslage: die erste Karte ist im Fokus', (await fokus()) === 'a', await fokus());

console.log('C  Ohne Vollbild');
await wisch([W * 0.75, H * 0.5], [W * 0.15, H * 0.5]);
pruefe('C1 außerhalb des Vollbilds wechselt ein Wisch über die Karte nicht (dort wischt man am Kopf/Fuß)', (await fokus()) === 'a', await fokus());

console.log('A  Im Vollbild');
await P.keyboard.press('f'); await P.waitForTimeout(1000);
pruefe('A0 „Nur Inhalt" ist an', (await P.evaluate(() => document.documentElement.dataset.rein)) === 'fokus');
await wisch([W * 0.8, H * 0.5], [W * 0.2, H * 0.52]);
pruefe('A1 nach links wischen → nächste Karte', (await fokus()) === 'b', await fokus());
await wisch([W * 0.2, H * 0.4], [W * 0.85, H * 0.42]);
pruefe('A2 nach rechts wischen → vorige Karte', (await fokus()) === 'a', await fokus());
await wisch([W * 0.8, 40], [W * 0.15, 46]);
pruefe('A3 auch am oberen Rand, wo sonst nichts ist', (await fokus()) === 'b', await fokus());
pruefe('A4 der Vollbild bleibt dabei an', (await P.evaluate(() => document.documentElement.dataset.rein)) === 'fokus');

console.log('B  Kein Wechsel');
await wisch([W * 0.5, H * 0.75], [W * 0.45, H * 0.25]);
pruefe('B1 senkrecht wischen (rollen) wechselt nicht', (await fokus()) === 'b', await fokus());
await wisch([W * 0.7, H * 0.5], [W * 0.2, H * 0.5], 180, true);
pruefe('B2 zwei Finger wechseln nicht', (await fokus()) === 'b', await fokus());
await wisch([W * 0.8, H * 0.5], [W * 0.2, H * 0.5], 1400);
pruefe('B3 ein langsamer Zug wechselt nicht', (await fokus()) === 'b', await fokus());
// zur Tabelle und dort in der Tabelle seitlich rollen
await wisch([W * 0.8, H * 0.5], [W * 0.2, H * 0.5]);
pruefe('B4 weiter zur breiten Tabelle', (await fokus()) === 't', await fokus());
const roll = await P.evaluate(() => { const r = [...document.querySelectorAll('.react-flow__node.pn-focused *')].find((e) => e.scrollWidth > e.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(e).overflowX)); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + Math.min(b.height / 2, 60), vor: r.scrollLeft }; });
if (roll) {
  await wisch([roll.x + 100, roll.y], [roll.x - 100, roll.y], 220);
  const nach = await P.evaluate(() => { const r = [...document.querySelectorAll('.react-flow__node.pn-focused *')].find((e) => e.scrollWidth > e.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(e).overflowX)); return r?.scrollLeft ?? 0; });
  pruefe('B5 in einer Tabelle, die seitlich noch weiter kann, gehört der Wisch der Tabelle – die Karte bleibt', (await fokus()) === 't', { fokus: await fokus(), vor: roll.vor, nach });
  // am rechten Anschlag blättert derselbe Wisch weiter
  await P.evaluate(() => { const r = [...document.querySelectorAll('.react-flow__node.pn-focused *')].find((e) => e.scrollWidth > e.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(e).overflowX)); r.scrollLeft = r.scrollWidth; });
  await wisch([roll.x + 100, roll.y], [roll.x - 100, roll.y], 220);
  pruefe('B6 am Anschlag der Tabelle blättert der Wisch zur nächsten Karte', (await fokus()) === 'a', await fokus());
} else pruefe('B5 die Tabelle rollt seitlich', false, 'kein seitlich rollbarer Bereich gefunden');
await P.screenshot({ path: path.join(SD, 'm441-wischen.png') });

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('D1 Hilfe und Umbau-Liste nennen M441', /M441/.test(hilfe) && /M441/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM441: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
