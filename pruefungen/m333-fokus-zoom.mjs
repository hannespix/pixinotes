/**
 * M333 — Fokus ist ein Zoom im Board, kein eigenes Blatt.
 *
 *   A  Tablet: ein Finger-Tipp auf die Notiz fährt die Kamera heran — die Karte
 *      füllt den Schirm (≥ 70 % Breite), bleibt im Flow (kein transform:none),
 *      die anderen Karten treten zurück; Kopf- und Blätterleiste stehen.
 *   B  Im Fokus schreibt der Stift auf der Karte: ein Strich entsteht (geankert
 *      an der Karte), der Fokus bleibt offen.
 *   C  Zwei Finger (Pinch) schließen den Fokus nicht; ein kurzer Tipp daneben schon —
 *      und die Kamera fährt zur vorherigen Ansicht zurück.
 *   D  Modul (Zeitplan) im Fokus: Zoom 1, aber die Karte füllt die Breite.
 *   E  PC: Doppelklick öffnet, Esc schließt, Rückweg; Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m333-fokus-zoom.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4552;
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
  boards: [{ id: 'b1', name: 'Fokus', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 260, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Eine Notiz zum Schreiben' }] } },
    { id: 'n2', type: 'note', width: 240, position: { x: 400, y: 0 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Nachbar' }] } },
    { id: 'g1', type: 'gantt', width: 320, height: 220, position: { x: 0, y: 320 }, data: { title: 'Plan', rows: [{ id: 'r1', name: 'Vorgang A', start: '2026-11-02', end: '2026-11-09' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite({ breite = 1024, hoehe = 768, touch = true, stift = true, einKlick = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, hasTouch: touch });
  await ctx.addInitScript(({ st, stift, einKlick }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, ...(einKlick ? { fokusEinKlick: true } : {}) }));
    if (stift) localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand(), stift, einKlick });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
}
const lage = (P, id) => P.evaluate((id) => {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  const r = el?.getBoundingClientRect();
  const vp = document.querySelector('.react-flow__viewport');
  return { fokus: !!document.querySelector('.app.focus-mode'), kopf: !!document.querySelector('.focus-head'), nav: !!document.querySelector('.focus-nav'),
    links: r ? Math.round(r.left) : null, breite: r ? Math.round(r.width) : null, oben: r ? Math.round(r.top) : null, hoehe: r ? Math.round(r.height) : null,
    transform: vp?.style.transform ?? '', pnFocused: !!el?.classList.contains('pn-focused'),
    nachbarOpacity: getComputedStyle(document.querySelector('.react-flow__node[data-id="n2"]')).opacity,
    zeichenebene: getComputedStyle(document.querySelector('.drawing-layer') ?? document.body).display,
    fenster: window.innerWidth, zoom: getComputedStyle(document.documentElement).getPropertyValue('--fokus-zoom').trim() };
}, id);
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, 8)); }
  start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
}, { punkte, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const welle = (x0, y0, n = 18, amp = 10) => Array.from({ length: n }, (_, i) => [x0 + i * 3, y0 + Math.sin(i / 1.7) * amp]);
/** Finger-Geste (TouchEvent) auf der Fläche */
const geste = (P, finger, o = {}) => P.evaluate(async ({ finger, o }) => {
  const mk = (typ, aktiv, geaendert) => {
    const t = (f) => new Touch({ identifier: f.id, target: document.elementFromPoint(f.x, f.y) ?? document.body, clientX: f.x, clientY: f.y, pageX: f.x, pageY: f.y, radiusX: 8, radiusY: 8, force: .5 });
    return new TouchEvent(typ, { bubbles: true, cancelable: true, composed: true, touches: aktiv.map(t), targetTouches: aktiv.map(t), changedTouches: geaendert.map(t) });
  };
  const ziel = document.elementFromPoint(finger[0].von.x, finger[0].von.y) ?? document.body;
  const start = finger.map((f) => ({ id: f.id, x: f.von.x, y: f.von.y }));
  ziel.dispatchEvent(mk('touchstart', start, start));
  const schritte = o.schritte ?? 10;
  for (let s = 1; s <= schritte; s += 1) {
    const jetzt = finger.map((f) => ({ id: f.id, x: f.von.x + (f.bis.x - f.von.x) * s / schritte, y: f.von.y + (f.bis.y - f.von.y) * s / schritte }));
    ziel.dispatchEvent(mk('touchmove', jetzt, jetzt));
    await new Promise((r) => setTimeout(r, o.takt ?? 30));
  }
  const ende = finger.map((f) => ({ id: f.id, x: f.bis.x, y: f.bis.y }));
  ziel.dispatchEvent(mk('touchend', [], ende));
}, { finger, o });

// ══ A: Tipp = Zoom ══════════════════════════════════════════════════
console.log('\n════ A: Ein Tipp fährt die Kamera auf die Karte ════');
{
  const { ctx, P } = await seite();
  const vorher = await lage(P, 'n1');
  const box = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await P.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 10);
  await P.waitForTimeout(900);
  const l = await lage(P, 'n1');
  pruefe('A1 Fokus an, Kopf- und Blätterleiste stehen', l.fokus && l.kopf && l.nav, JSON.stringify(l));
  pruefe('A2 die Karte bleibt im Flow — die Fläche ist verschoben und vergrößert, nicht transform:none', /scale\(/.test(l.transform) && !/scale\(1\)/.test(l.transform) && l.pnFocused, l.transform);
  pruefe('A3 die Karte füllt den Schirm (≥ 70 % Breite, im Bild, mittig)', l.breite >= l.fenster * 0.7 && l.links >= 0 && l.links + l.breite <= l.fenster && Math.abs(l.links - (l.fenster - l.links - l.breite)) <= 3, JSON.stringify(l));
  pruefe('A4 die Nachbarkarte tritt zurück (gedimmt), die Zeichenebene bleibt sichtbar', parseFloat(l.nachbarOpacity) < 0.5 && l.zeichenebene !== 'none', JSON.stringify({ o: l.nachbarOpacity, z: l.zeichenebene }));
  pruefe('A5 Zoom-Stufe für Text am Finger > 1 (hochskaliert)', parseFloat(l.zoom) > 1.2, l.zoom);
  await P.screenshot({ path: path.join(SD, 'm333-fokus.png') });

  // ══ B: Stift schreibt im Fokus ════════════════════════════════════
  console.log('\n════ B: Der Stift schreibt auf der fokussierten Karte ════');
  const k = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await zug(P, welle(k.x + 40, k.y + k.height - 40), { id: 21 });
  await P.waitForTimeout(500);
  const s1 = await striche(P);
  pruefe('B1 ein Stift-Strich entsteht im Fokus — geankert an der Karte', s1.length === 1 && s1[0].anchor === 'n1', JSON.stringify(s1.map((s) => [s.tool, s.anchor, s.points.length])));
  pruefe('B2 der Fokus bleibt dabei offen', (await lage(P, 'n1')).fokus);

  // ══ C: Pinch bleibt, Tipp daneben schließt ═══════════════════════
  console.log('\n════ C: Zwei Finger schließen nicht, ein Tipp daneben schon ════');
  const mitte = { x: l.fenster / 2, y: 400 };
  await geste(P, [{ id: 1, von: { x: mitte.x - 40, y: mitte.y }, bis: { x: mitte.x - 90, y: mitte.y } }, { id: 2, von: { x: mitte.x + 40, y: mitte.y }, bis: { x: mitte.x + 90, y: mitte.y } }], { schritte: 8, takt: 40 });
  await P.waitForTimeout(500);
  pruefe('C1 nach einem Pinch ist der Fokus noch offen', (await lage(P, 'n1')).fokus);
  // Tipp auf freie Fläche rechts unten (neben der Karte)
  const frei = await P.evaluate(() => { const r = document.querySelector('.react-flow__node.pn-focused').getBoundingClientRect(); return { x: Math.min(window.innerWidth - 20, r.right + 10), y: Math.min(window.innerHeight - 120, r.bottom + 40) }; });
  await P.touchscreen.tap(frei.x, frei.y);
  await P.waitForTimeout(900);
  const nachher = await lage(P, 'n1');
  pruefe('C2 ein kurzer Tipp neben die Karte schließt den Fokus', !nachher.fokus, JSON.stringify(nachher));
  pruefe('C3 … und die Kamera steht wieder wie vorher', Math.abs(nachher.links - vorher.links) <= 3 && Math.abs(nachher.breite - vorher.breite) <= 3, `vorher ${vorher.links}/${vorher.breite}, nachher ${nachher.links}/${nachher.breite}`);

  // ══ D: Modul im Fokus ═════════════════════════════════════════════
  console.log('\n════ D: Ein Modul (Zeitplan) bekommt Breite statt Pixel ════');
  const g = await P.locator('.react-flow__node[data-id="g1"]').boundingBox();
  await P.touchscreen.tap(g.x + g.width / 2, g.y + g.height - 10);
  await P.waitForTimeout(1000);
  const lg = await lage(P, 'g1');
  pruefe('D1 Zoom 1 — und die Karte füllt die Schirmbreite', lg.fokus && lg.zoom === '1' && lg.breite >= lg.fenster - 10 && lg.links >= 0, JSON.stringify(lg));
  await P.keyboard.press('Escape'); await P.waitForTimeout(700);
  pruefe('D2 Esc schließt', !(await lage(P, 'g1')).fokus);
  await ctx.close();
}

// ══ E: PC ═══════════════════════════════════════════════════════════
console.log('\n════ E: Mit der Maus — Doppelklick öffnet, Esc schließt ════');
{
  // Am PC mit „Mit einem Klick öffnen" (⚙ → Darstellung), wie in m265 — der Doppelklick in einer Notiz markiert Wörter
  const { ctx, P } = await seite({ breite: 1440, hoehe: 900, touch: false, stift: false, einKlick: true });
  const vorher = await lage(P, 'n1');
  const box = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await P.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
  await P.waitForTimeout(900);
  const l = await lage(P, 'n1');
  pruefe('E1 ein Klick öffnet den Fokus als Zoom, maßvoll (Zoom ≤ 1,25)', l.fokus && parseFloat(l.zoom) <= 1.25 && parseFloat(l.zoom) >= 1, JSON.stringify(l));
  pruefe('E2 die Karte wird dabei breiter (bis 720 Punkte), bleibt im Bild', l.breite > vorher.breite && l.links >= 0 && l.links + l.breite <= l.fenster, JSON.stringify({ vorher: vorher.breite, jetzt: l.breite }));
  await P.keyboard.press('Escape'); await P.waitForTimeout(700);
  const n = await lage(P, 'n1');
  pruefe('E3 Esc schließt, Kamera und Kartenbreite wie vorher', !n.fokus && Math.abs(n.breite - vorher.breite) <= 3 && Math.abs(n.links - vorher.links) <= 3, JSON.stringify({ vorher, n }));
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('E4 „Was ist neu" nennt M333', js.includes('Fokus ist jetzt ein Zoom (M333)'));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
