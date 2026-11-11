/**
 * M343 — Karten greifen in jeder Zoomstufe.
 *
 *   A  Herausgezoomt (über der Weit-Grenze): Griff, Anschlusspunkte und Auswahlrahmen behalten ihre
 *      Bildschirm-Größe; der Griff zieht die Karte.
 *   B  Weiter Zoom: die ganze Karte ist der Griff (Maus zieht aus der Mitte), der Inhalt ruht,
 *      Auswahlrahmen und Anschlusspunkte der gewählten Karte sind normal groß.
 *   C  Zurück bei 100 %: alles wie vorher (Klick in den Text schreibt).
 *   D  Finger im weiten Zoom: Wisch über eine nicht gewählte Karte schwenkt, Tipp wählt, dann zieht der Finger.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m343-greifen.mjs`
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
const PORT = 4561;
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
  boards: [{ id: 'b1', name: 'Greifen', comments: [], edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'floating' }], drawings: [], nodes: [
    { id: 'n1', type: 'note', width: 300, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ id: 'a', type: 'paragraph', content: 'Erste Notiz' }, { id: 'a2', type: 'checkListItem', content: 'Haken' }] } },
    { id: 'n2', type: 'note', width: 300, position: { x: 500, y: 0 }, data: { color: 'sky', blocks: [{ id: 'b', type: 'paragraph', content: 'Zweite Notiz' }] } },
    { id: 'n3', type: 'kanban', width: 320, height: 240, position: { x: 0, y: 400 }, data: { title: 'Aufgaben', items: [{ id: 'k1', text: 'Ticket', col: 0 }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite({ touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: touch });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand() });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  return { ctx, P };
}
const zoom = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const ansicht = (P) => P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
/** Auf etwa diesen Zoom bringen (Strg+Rad auf der freien Fläche), dann ruhen lassen */
const zoomeAuf = async (P, ziel) => {
  await P.mouse.move(1300, 780);
  for (let i = 0; i < 80; i += 1) {
    const z = await zoom(P);
    if (Math.abs(z - ziel) / ziel < 0.06) break;
    await P.keyboard.down('Control'); await P.mouse.wheel(0, z > ziel ? 30 : -30); await P.keyboard.up('Control');
    await P.waitForTimeout(25);
  }
  await P.waitForTimeout(450);
  return zoom(P);
};
const karte = (P, id) => P.evaluate((id) => {
  const n = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
  const g = n.querySelector('.card-grip'); const h = [...n.querySelectorAll('.pn-handle')];
  const cs = getComputedStyle(n);
  return { k: r(n), griff: r(g), griffSichtbar: g ? getComputedStyle(g).visibility !== 'hidden' && getComputedStyle(g).opacity !== '0' : false,
    punkt: r(h[0]), punktSichtbar: h[0] ? getComputedStyle(h[0]).visibility !== 'hidden' : false,
    rahmen: parseFloat(cs.outlineWidth) * (n.getBoundingClientRect().width / n.offsetWidth), gewaehlt: n.classList.contains('selected'),
    koerper: getComputedStyle(n.querySelector('.card-body')).pointerEvents, editor: !!n.querySelector('[contenteditable="true"]') };
}, id);
const lage = (P, id) => P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id).position, id);
const weit = (P) => P.evaluate(() => !!document.querySelector('[data-weit]'));

console.log('\n════ A: herausgezoomt, Griffe in Bildschirm-Größe ════');
{
  const { ctx, P } = await seite();
  const z1 = await zoomeAuf(P, 1);
  await P.locator('.react-flow__node[data-id="n1"] .card-grip').click({ force: true }); await P.waitForTimeout(300);
  const a = await karte(P, 'n1');
  const z2 = await zoomeAuf(P, 0.55);
  let b = await karte(P, 'n1');
  console.log('    100 %:', JSON.stringify({ z: z1, griff: [a.griff.w, a.griff.h], punkt: a.punkt.w, rahmen: a.rahmen }), '· 55 %:', JSON.stringify({ z: z2, griff: [b.griff.w, b.griff.h], punkt: b.punkt.w, rahmen: b.rahmen }));
  pruefe('A1 bei ~55 % ist der Griff so groß wie bei 100 % (vorher halb so groß)', !(await weit(P)) && Math.abs(b.griff.w - a.griff.w) < 4 && Math.abs(b.griff.h - a.griff.h) < 2 && b.griffSichtbar, JSON.stringify(b.griff));
  pruefe('A0 die angeklickte Karte hat sofort einen sichtbaren Auswahlrahmen (2 Bildpunkte)', a.gewaehlt && Math.abs(a.rahmen - 2) < 0.4, String(a.rahmen));
  pruefe('A2 Anschlusspunkte und Auswahlrahmen ebenso', Math.abs(b.punkt.w - a.punkt.w) < 2 && Math.abs(b.rahmen - a.rahmen) < 0.4, JSON.stringify({ punkt: b.punkt.w, rahmen: b.rahmen }));
  pruefe('A3 der Griff sitzt weiter mittig über der Oberkante der Karte', b.griff.y + b.griff.h > b.k.y && b.griff.y < b.k.y && b.griff.cx > b.k.x && b.griff.cx < b.k.x + b.k.w, JSON.stringify({ griff: b.griff, k: b.k }));
  const p0 = await lage(P, 'n1');
  await P.mouse.move(b.griff.cx, b.griff.cy); await P.mouse.down(); await P.mouse.move(b.griff.cx + 60, b.griff.cy + 40, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(1400);
  const p1 = await lage(P, 'n1');
  pruefe('A4 am Griff gezogen bewegt sich die Karte um den Zeigerweg', (p1.x - p0.x) * z2 > 44 && (p1.x - p0.x) * z2 < 64 && (p1.y - p0.y) * z2 > 28 && (p1.y - p0.y) * z2 < 44, JSON.stringify({ p0, p1 }));

  console.log('\n════ B: weiter Zoom — die ganze Karte ist der Griff ════');
  await P.mouse.click(1380, 860); await P.waitForTimeout(200);
  const z3 = await zoomeAuf(P, 0.25);
  b = await karte(P, 'n2');
  pruefe('B1 unter ~45 % gilt „weit": der Inhalt ruht, Griff und Punkte sind weg', await weit(P) && b.koerper === 'none' && !b.griffSichtbar && !b.punktSichtbar, JSON.stringify({ z: z3, koerper: b.koerper }));
  const q0 = await lage(P, 'n2');
  await P.mouse.move(b.k.cx, b.k.cy); await P.mouse.down(); await P.mouse.move(b.k.cx + 50, b.k.cy + 30, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(1400);
  const q1 = await lage(P, 'n2');
  pruefe('B2 die Maus zieht die Karte aus ihrer Mitte (vorher nur am winzigen Griff)', (q1.x - q0.x) * z3 > 34 && (q1.x - q0.x) * z3 < 54 && (q1.y - q0.y) * z3 > 18 && (q1.y - q0.y) * z3 < 34, JSON.stringify({ q0, q1 }));
  b = await karte(P, 'n2');
  pruefe('B3 die gezogene Karte ist gewählt; Rahmen und Anschlusspunkte in Bildschirm-Größe', b.gewaehlt && Math.abs(b.rahmen - a.rahmen) < 0.5 && b.punktSichtbar && Math.abs(b.punkt.w - a.punkt.w) < 2, JSON.stringify({ rahmen: b.rahmen, punkt: b.punkt?.w }));
  // Klick genau auf das Kästchen der ersten Notiz: im weiten Zoom wählt er die Karte, statt den Haken umzulegen
  const haken = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="n1"] input[type="checkbox"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await P.mouse.click(haken[0], haken[1]); await P.waitForTimeout(1400);
  pruefe('B4 ein Klick auf ein Kästchen wählt die Karte, der Haken bleibt', (await karte(P, 'n1')).gewaehlt && !(await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.blocks[1].props?.checked)));
  // Rad über einer Karte: das Board bewegt sich (im weiten Zoom gibt es kein „nowheel")
  const v0 = await ansicht(P);
  await P.mouse.move(b.k.cx, b.k.cy); await P.mouse.wheel(0, 120); await P.waitForTimeout(400);
  pruefe('B5 das Rad über einer Karte bewegt das Board', v0 !== await ansicht(P));
  await P.screenshot({ path: path.join(SD, 'm343-weit.png') });

  console.log('\n════ C: zurück bei 100 % ════');
  await zoomeAuf(P, 1);
  await P.mouse.click(1380, 860); await P.waitForTimeout(200);
  // alles ins Bild holen (F), damit die Notiz nicht unter der Kopfleiste liegt
  await P.keyboard.press('f'); await P.waitForTimeout(900);
  const c = await karte(P, 'n1');
  pruefe('C1 „weit" ist aus, der Inhalt ist wieder bedienbar', !(await weit(P)) && c.koerper !== 'none');
  const wort = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="n1"] .bn-inline-content').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; });
  await P.mouse.click(wort[0], wort[1]); await P.waitForTimeout(700);
  pruefe('C2 ein Klick in den Text schreibt wie gewohnt', (await karte(P, 'n1')).editor);
  await ctx.close();
}

console.log('\n════ D: Finger im weiten Zoom ════');
{
  const { ctx, P } = await seite({ touch: true });
  await zoomeAuf(P, 0.25);
  const wisch = (x0, y0, x1, y1) => P.evaluate(async ({ x0, y0, x1, y1 }) => {
    const el = document.elementFromPoint(x0, y0);
    const mk = (x, y) => new Touch({ identifier: 3, target: el, clientX: x, clientY: y });
    const ev = (typ, x, y, weg = false) => el.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true, touches: weg ? [] : [mk(x, y)], targetTouches: weg ? [] : [mk(x, y)], changedTouches: [mk(x, y)] }));
    ev('touchstart', x0, y0);
    for (let i = 1; i <= 8; i += 1) { ev('touchmove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8); await new Promise((q) => setTimeout(q, 16)); }
    ev('touchend', x1, y1, true);
  }, { x0, y0, x1, y1 });
  let k = await karte(P, 'n1');
  const p0 = await lage(P, 'n1'); const v0 = await ansicht(P);
  await wisch(k.k.cx, k.k.cy, k.k.cx + 80, k.k.cy + 50); await P.waitForTimeout(1400);
  const p1 = await lage(P, 'n1');
  pruefe('D1 Wisch über eine nicht gewählte Karte schwenkt das Board, die Karte bleibt', await weit(P) && p0.x === p1.x && p0.y === p1.y && v0 !== await ansicht(P), JSON.stringify({ p0, p1 }));
  k = await karte(P, 'n1');
  await P.touchscreen.tap(k.k.cx, k.k.cy); await P.waitForTimeout(500);
  pruefe('D2 ein Tipp wählt die Karte', (await karte(P, 'n1')).gewaehlt);
  await ctx.close();
}

console.log('\n════ E: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('E1 „Was ist neu" nennt M343', js.includes('(M343)'));

await browser.close();
app.close();
console.log(`\nm343-greifen: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
