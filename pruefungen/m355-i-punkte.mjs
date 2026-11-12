/**
 * M355 — i-Punkte und Umlaut-Punkte mit dem Stift.
 *
 *   A  Zeichenmodus: ein Wort, dann ein kurzer Tipp darüber → ein runder Punkt (gespeichert und sichtbar).
 *   B  „ü": zwei schnelle Tipps nebeneinander → zwei Punkte; KEIN Doppelklick (keine neue Notiz, kein Fokus).
 *   C  Stift kurz still aufgesetzt (ohne Bewegung, länger als ein Tipp) → auch ein Punkt.
 *   D  Auswahlmodus (Stift schreibt direkt): Wort auf die Fläche, Tipp darüber → Punkt.
 *   E  Ohne frisches Schreiben bleibt ein Stift-Tipp auf einen Haken oder in Text ein Klick (kein Punkt).
 *   G  Seitenstriche, die durch den M354-Fehler dicker gespeichert wurden, werden einmal gerichtet.
 *   F  „Was ist neu" nennt M355.
 */
// Läuft aus dem Repository: `node pruefungen/m355-i-punkte.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4573;
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
const stand = () => ({
  boards: [{ id: 'b1', name: 'Stift', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 260, position: { x: 1000, y: 60 }, data: { color: 'sky', blocks: [{ type: 'checkListItem', props: { checked: false }, content: 'Brot kaufen' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, handschriftAuto: false }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand());
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y, p], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'pen', isPrimary: true, clientX: x, clientY: y, pressure: p ?? 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, o.takt ?? 8)); }
  if (o.halten) await new Promise((r) => setTimeout(r, o.halten));
  if (!o.offen) start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
  return start.className?.baseVal ?? start.className;
}, { punkte, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const warte = (P, ms = 600) => P.waitForTimeout(ms);
const welle = (x0, y0, n = 24, amp = 8) => Array.from({ length: n }, (_, i) => [x0 + i * 3, y0 + Math.sin(i / 1.7) * amp + (i % 3)]);
const knotenZahl = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.length);
const fokus = (P) => P.evaluate(() => !!document.querySelector('.app.focus-mode'));
/** Ein Tipp: Stift auf, (gleich) wieder ab */
const tipp = (P, x, y, id, ms = 40) => zug(P, [[x, y]], { id, halten: ms });
const sichtbar = (P, id) => P.evaluate((id) => {
  const p = [...document.querySelectorAll('.drawing-layer path')].find((el) => el.closest('g') && el.getAttribute('d') && el.dataset && true && el.getAttribute('d').length < 40 && el.getAttribute('stroke-width'));
  return p ? { sw: Number(p.getAttribute('stroke-width')), cap: p.getAttribute('stroke-linecap') } : null;
}, id);

console.log('════ A: i-Punkt im Zeichenmodus ════');
let { ctx, P } = await seite();
await werkzeug(P, 'Stift');
await zug(P, welle(500, 420), { id: 11 }); await warte(P, 800);
const vorA = (await striche(P)).length;
await tipp(P, 530, 395, 12); await warte(P, 700);
let s = await striche(P);
const punkt = s.at(-1);
pruefe('A1 der Tipp über dem Wort wird ein Punkt (gespeichert)', s.length === vorA + 1 && punkt.points.length === 2 && Math.hypot(punkt.points[1][0] - punkt.points[0][0], punkt.points[1][1] - punkt.points[0][1]) < 0.5, JSON.stringify(s.map((x) => x.points.length)));
pruefe('A2 etwas kräftiger als der feine Strich (1,2 × 1,6)', Math.abs(punkt.width - 1.92) < 0.02, String(punkt.width));
const v = await sichtbar(P);
pruefe('A3 sichtbar: runder Punkt mit Strichbreite', !!v && v.cap === 'round' && v.sw > 1.5, JSON.stringify(v));

console.log('\n════ B: Umlaut ════');
const knotenVor = await knotenZahl(P);
await zug(P, welle(500, 520), { id: 21 }); await warte(P, 800);
const vorB = (await striche(P)).length;
await tipp(P, 520, 496, 22, 30); await warte(P, 60);
await tipp(P, 530, 496, 23, 30); await warte(P, 900);
s = await striche(P);
pruefe('B1 zwei schnelle Tipps → zwei Punkte', s.length === vorB + 2 && s.slice(-2).every((x) => x.points.length === 2), JSON.stringify(s.map((x) => x.points.length)));
pruefe('B2 kein Doppelklick: keine neue Notiz, kein Fokus', (await knotenZahl(P)) === knotenVor && !(await fokus(P)), `${knotenVor} → ${await knotenZahl(P)}`);

console.log('\n════ C: still aufgesetzt ════');
await zug(P, welle(500, 620), { id: 31 }); await warte(P, 800);
const vorC = (await striche(P)).length;
await tipp(P, 540, 597, 32, 400); await warte(P, 700);
s = await striche(P);
pruefe('C1 Stift ohne Bewegung 0,4 s aufgesetzt → Punkt', s.length === vorC + 1 && s.at(-1).points.length === 2, JSON.stringify(s.map((x) => x.points.length)));
await ctx.close();

console.log('\n════ D: Auswahlmodus, Stift schreibt direkt ════');
({ ctx, P } = await seite());
await zug(P, welle(500, 420), { id: 41 }); await warte(P, 800);
const vorD = (await striche(P)).length;
await tipp(P, 520, 396, 42); await warte(P, 700);
s = await striche(P);
pruefe('D1 Wort und Punkt darüber — beide als Striche', vorD === 1 && s.length === 2 && s[1].points.length === 2, JSON.stringify(s.map((x) => x.points.length)));

console.log('\n════ E: Tipp auf Bedienbares bleibt Klick ════');
await warte(P, 4200);   // frisches Schreiben ist vorbei
const haken = await P.locator('.react-flow__node[data-id="n1"] input[type="checkbox"]').first().boundingBox();
const vorE = (await striche(P)).length;
await tipp(P, haken.x + haken.width / 2, haken.y + haken.height / 2, 51); await warte(P, 900);
pruefe('E1 Stift-Tipp auf den Haken: kein Punkt (der Klick gehört dem Haken)', (await striche(P)).length === vorE, String((await striche(P)).length));
const karte = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
await tipp(P, karte.x + 110, karte.y + karte.height / 2, 52); await warte(P, 900);
pruefe('E2 Stift-Tipp auf den Text einer Notiz (ohne frisches Schreiben): kein Punkt', (await striche(P)).length === vorE, String((await striche(P)).length));
await ctx.close();

console.log('\n════ G: zu dick gespeicherte Seitenstriche werden einmal gerichtet ════');
{
  const c2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const st = stand();
  const linie = (id, w, extra = {}) => ({ id, tool: 'pen', color: '#16191e', width: w, anchor: 'n1', seite: 1, seitenBreite: true, points: [[10, 10], [20, 12], [30, 10], [40, 12]], ...extra });
  st.boards[0].drawings = [
    linie('a', 5.1), linie('b', 3.5), linie('c', 2.4), linie('d', 1.75),            // M354-Fehler: jedes Absetzen dicker
    linie('e', 4, { color: '#e0392b' }), linie('f', 1.75, { color: '#e0392b' }),   // zwei gewollte Breiten: bleiben
    linie('g', 9, { points: [[5, 5], [5.1, 5.1]] }),                                 // ein Punkt: bleibt
  ];
  await c2.addInitScript((st) => { if (localStorage.getItem('pixinotes-board')) return; localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st })); }, st);
  const Q = await c2.newPage();
  await Q.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await Q.waitForTimeout(2200);
  const w = Object.fromEntries((await striche(Q)).map((x) => [x.id, x.width]));
  pruefe('G1 die dicker gewordene Gruppe steht wieder auf der dünnsten Breite', w.a === 1.75 && w.b === 1.75 && w.c === 1.75 && w.d === 1.75, JSON.stringify(w));
  pruefe('G2 zwei gewollte Breiten und der Punkt bleiben', w.e === 4 && w.f === 1.75 && w.g === 9, JSON.stringify(w));
  pruefe('G3 nur einmal je Gerät', (await Q.evaluate(() => localStorage.getItem('pixinotes-m355-breiten'))) === '1');
  await c2.close();
}

console.log('\n════ F ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('F1 „Was ist neu" nennt M355', js.includes('(M355)'));

await browser.close(); app.close();
console.log(`\nm355-i-punkte: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
