/**
 * M440 — Boards in der Übersicht ziehen: haften, ausweichen, federnd ablegen.
 *
 * Gewünscht: „Beim Verschieben von einzelnen Boards in der Übersicht sollen schicke Drag-and-Drop-Animationen sichtbar
 * werden … Boards sollen visuell an der Maus haften und mitgezogen werden und an entsprechender Stelle von der Maus
 * smooth abgelegt werden. Schöne flüssige Animationen, physikalisch korrekt mit Verdrängung etc."
 *
 *   A  Haften: Die gegriffene Kachel hebt sich (größer, Schatten) und folgt der Maus Punkt für Punkt.
 *   B  Neigung: Bei schneller Bewegung neigt sie sich in Zugrichtung, im Stillstand schwingt sie aus.
 *   C  Verdrängung: Schon während des Ziehens weichen die Kacheln im Ziel-Projekt aus, das Projekt wächst mit und
 *      ist leise markiert; im alten Projekt rücken die übrigen nach.
 *   D  Ablegen: Die Kachel gleitet weich (über mehrere Bilder) in ihren Platz, die Reihenfolge ist übernommen.
 *   E  Flüssig: Beim Ziehen hält die Seite den Takt.
 */
// Läuft aus dem Repository: `node pruefungen/m440-uebersicht-ziehen.mjs`
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
const PORT = 4775;
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
const brd = (id, name) => ({ id, name, edges: [], drawings: [], nodes: [{ id: `${id}n`, type: 'note', position: { x: 0, y: 0 }, width: 200, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: name }] } }] });
const BOARDS = [brd('a', 'Alpha'), brd('b', 'Beta'), brd('c', 'Gamma'), brd('d', 'Delta'), brd('e', 'Epsilon'), brd('f', 'Zeta')];
const SPACES = [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Eins', boardIds: ['a', 'b', 'c'] }, { id: 'p2', name: 'Zwei', boardIds: ['d', 'e', 'f'] }] }];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([bs, sp]) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: bs, spaces: sp, activeId: 'a', view: 'overview' } }));
}, [BOARDS, SPACES]);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1800);
const mode = P.locator('.ov-mode button', { hasText: 'Hierarchie' });
if (await mode.count()) { await mode.click(); await P.waitForTimeout(900); }
const kachel = (name) => P.locator('.ov-canvas .react-flow__node-ovBoard', { hasText: name }).first();
const rahmen = (name) => kachel(name).boundingBox();
const projekt = (id) => P.locator(`.ov-canvas .react-flow__node[data-id="p-${id}"]`).boundingBox();
const reihe = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.spaces[0].projects.map((p) => p.boardIds.join('')));

const g0 = await rahmen('Gamma'); const d0 = await rahmen('Delta'); const e0 = await rahmen('Epsilon'); const f0 = await rahmen('Zeta'); const p20 = await projekt('p2');
pruefe('Ausgangslage: sechs Kacheln in zwei Projekten', !!g0 && !!d0 && !!p20, { g0, d0 });

console.log('A  Haften');
const greif = { x: g0.x + g0.width / 2, y: g0.y + 30 };
await P.mouse.move(greif.x, greif.y);
await P.mouse.down();
await P.mouse.move(greif.x + 10, greif.y + 4, { steps: 3 }); await P.waitForTimeout(80);
// Schnell nach rechts (Neigung) — Richtung Delta (erste Kachel im zweiten Projekt)
const ziel = { x: d0.x + 30, y: d0.y + 30 };
// M518: Die Neigung hängt am TEMPO der Hand (Punkte je Millisekunde). Vorher bestand der Zug aus 14 Schritten mit je
// einer Abfrage dazwischen – unter Last dauerte jeder Schritt ein Vielfaches, der „schnelle" Zug war dann langsam,
// die Kachel neigte sich zu Recht nur um 1,18° und B1 (> 1,2°) war rot. Jetzt folgt der Ort der Uhr: Die Strecke
// wird in festen 300 ms zurückgelegt, egal wie viele Schritte die Maschine in dieser Zeit schafft; Neigung und
// Größe schreibt die Seite selbst je Bild mit (keine Abfrage mitten im Zug).
await P.evaluate(() => {
  window.__neig = []; window.__neigAn = true;
  const bild = () => {
    if (!window.__neigAn) return;
    const t = document.querySelector('.ov-canvas .react-flow__node-ovBoard.dragging .ovc-tile');
    if (t) { const m = new DOMMatrix(getComputedStyle(t).transform); window.__neig.push({ winkel: Math.atan2(m.b, m.a) * 180 / Math.PI, skala: Math.hypot(m.a, m.b) }); }
    requestAnimationFrame(bild);
  };
  requestAnimationFrame(bild);
});
const ZUG_MS = 300; const zugAb = Date.now();
for (;;) {
  const a = Math.min(1, (Date.now() - zugAb) / ZUG_MS);
  await P.mouse.move(greif.x + (ziel.x - greif.x) * a, greif.y + (ziel.y - greif.y) * a);
  if (a >= 1) break;
  await P.waitForTimeout(12);
}
await P.waitForFunction(() => window.__neig.length >= 4, null, { timeout: 8000 }).catch(() => {});
const neigungen = await P.evaluate(() => { window.__neigAn = false; return window.__neig; });
const unten = await P.evaluate(() => { const n = document.querySelector('.ov-canvas .react-flow__node-ovBoard.dragging'); if (!n) return null; const r = n.getBoundingClientRect(); return { cx: r.left + r.width / 2, top: r.top }; });
const skala = Math.max(...neigungen.filter(Boolean).map((n) => n.skala));
pruefe('A1 die gegriffene Kachel hebt sich (größer) und trägt Schatten', skala > 1.03 && await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node-ovBoard.dragging .ovc-tile')).boxShadow !== 'none'), { skala });
// Die Kachel folgt der Maus: Abstand Griffpunkt → Kachel bleibt erhalten
const dx = (unten?.cx ?? 0) - ziel.x; const dx0 = g0.x + g0.width / 2 - greif.x;
pruefe('A2 sie haftet an der Maus (der Griffpunkt bleibt, wo er war)', !!unten && Math.abs(dx - dx0) < 14, { dx, dx0 });

console.log('B  Neigung');
const maxWinkel = Math.max(...neigungen.filter(Boolean).map((n) => n.winkel));
pruefe('B1 beim schnellen Zug nach rechts neigt sie sich in Zugrichtung', maxWinkel > 1.2 && maxWinkel < 8.5, { maxWinkel, bilder: neigungen.length, zugMs: ZUG_MS });

console.log('C  Verdrängung');
await P.waitForTimeout(650);
const winkelRuhe = await P.evaluate(() => { const t = document.querySelector('.react-flow__node-ovBoard.dragging .ovc-tile'); const m = new DOMMatrix(getComputedStyle(t).transform); return Math.abs(Math.atan2(m.b, m.a) * 180 / Math.PI); });
pruefe('B2 im Stillstand schwingt die Neigung aus', winkelRuhe < 0.6, winkelRuhe);
const d1 = await rahmen('Delta'); const f1 = await rahmen('Zeta'); const p21 = await projekt('p2');
const markiert = await P.evaluate(() => !!document.querySelector('.ov-canvas .react-flow__node.ovc-ziel[data-id="p-p2"]'));
pruefe('C1 schon beim Ziehen weicht Delta aus (macht Platz)', d1.x > d0.x + 40 || d1.y > d0.y + 40, { d0: [d0.x, d0.y], d1: [d1.x, d1.y] });
pruefe('C2 das Ziel-Projekt wächst mit (eine Reihe mehr) und ist leise markiert', p21.height > p20.height + 30 && markiert, { vorher: p20.height, nachher: p21.height, markiert });
pruefe('C3 Zeta rückt in die neue Reihe', f1.y > f0.y + 40, { f0: f0.y, f1: f1.y });
await P.screenshot({ path: path.join(SD, 'm440-ziehen.png') });

console.log('D  Ablegen');
const vorLos = await P.evaluate(() => { const r = document.querySelector('.ov-canvas .react-flow__node-ovBoard.dragging').getBoundingClientRect(); return [r.left, r.top]; });
await P.mouse.up();
const spur = await P.evaluate(async () => {
  const el = [...document.querySelectorAll('.ov-canvas .react-flow__node-ovBoard')].find((n) => n.textContent.includes('Gamma'));
  const out = [];
  for (let i = 0; i < 40; i += 1) { await new Promise((r) => requestAnimationFrame(r)); const r = el.getBoundingClientRect(); out.push([Math.round(r.left), Math.round(r.top)]); }
  return out;
});
await P.waitForTimeout(400);
const g2 = await rahmen('Gamma'); const d2 = await rahmen('Delta');
const verschieden = new Set(spur.map((p) => p.join(','))).size;
pruefe('D1 die Kachel gleitet über mehrere Bilder in ihren Platz (kein Sprung)', verschieden >= 6, { verschieden, start: vorLos, spur: spur.slice(0, 6) });
pruefe('D2 sie landet auf dem Platz vor Delta', Math.abs(g2.y - d2.y) < 4 && g2.x < d2.x, { g2: [g2.x, g2.y], d2: [d2.x, d2.y] });
await P.waitForTimeout(900);
const r = await reihe();
pruefe('D3 die Reihenfolge ist übernommen: Gamma vor Delta im zweiten Projekt', r[0] === 'ab' && r[1] === 'cdef', r);

console.log('E  Flüssig');
const b0 = await rahmen('Alpha');
await P.mouse.move(b0.x + b0.width / 2, b0.y + 30); await P.mouse.down();
const takt = P.evaluate(() => new Promise((res) => { const z = []; let l = performance.now(); let n = 0; const f = (t) => { z.push(t - l); l = t; if (++n < 70) requestAnimationFrame(f); else res(z); }; requestAnimationFrame(f); }));
for (let i = 1; i <= 30; i += 1) { await P.mouse.move(b0.x + b0.width / 2 + i * 12, b0.y + 30 + Math.sin(i / 3) * 40); await P.waitForTimeout(12); }
const z = (await takt).slice(2).sort((x, y) => x - y);
await P.mouse.move(b0.x + b0.width / 2, b0.y + 30, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(600);
const median = z[Math.floor(z.length / 2)];
pruefe('E1 beim Ziehen hält die Seite den Takt (Median ≤ 20 ms je Bild)', median <= 20, { median, p90: z[Math.floor(z.length * 0.9)] });

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('F1 Hilfe und Umbau-Liste nennen M440', /M440/.test(hilfe) && /M440/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM440: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
