/**
 * M322 — Der Stift schwenkt nicht mehr die Seite.
 *
 *   React Flow schwenkt (d3-zoom) und zieht Karten (d3-drag) über TOUCH-
 *   Ereignisse. iPadOS/Android melden den Stift zusätzlich als Touch
 *   (touchType 'stylus'). Nachgestellt wird genau diese Doppelmeldung:
 *   pointerdown(pen) → touchstart(stylus) → … am selben Ziel.
 *
 *   A  Zeichenmodus mit bekanntem Stift (Durchgriff): die Stift-Touches
 *      erreichen React Flow NICHT, der Ausschnitt bleibt stehen, der Strich
 *      wird gespeichert; ein Handballen-Touch während des Zugs ebenso tabu.
 *   B  Finger ohne Stift-Zug: Touches erreichen React Flow weiterhin, der
 *      Ausschnitt schwenkt (Hand schiebt).
 *   C  Direktzug (Auswahlmodus, Stift auf freier Fläche): ebenfalls dicht.
 *   D  Stift über einer Notiz im Auswahlmodus: schreibt (M325), geankert; sein
 *      Touch-Doppel bleibt vor React Flow.
 *   E  „Was ist neu" nennt M322.
 */
// Läuft aus dem Repository: `node pruefungen/m322-stift-touch.mjs`
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
const PORT = 4544;
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

const stand = {
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes: [{ id: 'n1', type: 'note', width: 220, position: { x: -600, y: -400 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Ecke' }] } }] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  // Zähler: welche Touch-Ereignisse erreichen React Flow (Bubble-Phase am Renderer)?
  await P.evaluate(() => {
    window.__rf = { touchstart: 0, touchmove: 0 };
    const r = document.querySelector('.react-flow__renderer') ?? document.querySelector('.react-flow');
    for (const t of ['touchstart', 'touchmove']) r.addEventListener(t, () => { window.__rf[t] += 1; });
  });
  return { ctx, P };
}
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
/**
 * Doppelmeldung wie iPadOS/Android: je Punkt erst das Pointer-Ereignis, dann
 * das Touch-Ereignis — beide an das Element unter dem Startpunkt. `art`:
 * 'pen' (Stift, touchType stylus) oder 'touch' (Finger, touchType direct).
 */
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7; const art = o.art ?? 'pen';
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  const pe = (typ, [x, y], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: art, isPrimary: o.primary ?? true, clientX: x, clientY: y, pressure: 0.5, buttons: 1, button: 0, ...extra });
  const te = (typ, [x, y], ende = false) => {
    const t = new Touch({ identifier: id, target: start, clientX: x, clientY: y, pageX: x, pageY: y, touchType: art === 'pen' ? 'stylus' : 'direct' });
    return new TouchEvent(typ, { bubbles: true, cancelable: true, composed: true, touches: ende ? [] : [t], targetTouches: ende ? [] : [t], changedTouches: [t] });
  };
  const bericht = { touchstartDefaultPrevented: false };
  start.dispatchEvent(pe('pointerdown', punkte[0]));
  const ts = te('touchstart', punkte[0]); start.dispatchEvent(ts); bericht.touchstartDefaultPrevented = ts.defaultPrevented;
  for (const pt of punkte.slice(1)) {
    start.dispatchEvent(pe('pointermove', pt));
    start.dispatchEvent(te('touchmove', pt));
    await new Promise((r) => setTimeout(r, 8));
  }
  if (!o.offen) {
    const last = punkte[punkte.length - 1];
    start.dispatchEvent(pe('pointerup', last, { buttons: 0 }));
    start.dispatchEvent(te('touchend', last, true));
  }
  bericht.ziel = start.className?.baseVal ?? start.className;
  return bericht;
}, { punkte, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const ausschnitt = (P) => P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
const zaehler = (P) => P.evaluate(() => ({ ...window.__rf }));
const welle = (x0, y0, n = 24) => Array.from({ length: n }, (_, i) => [x0 + i * 8, y0 + Math.sin(i / 3) * 30]);

// ══ A: Zeichenmodus, Stift als Doppelmeldung ════════════════════════
console.log('\n════ A: Zeichenmodus — Stift-Touches erreichen React Flow nicht ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  const ebene = await P.evaluate(() => getComputedStyle(document.querySelector('.drawing-layer')).pointerEvents);
  pruefe('A1 Ausgangslage: Stift bekannt, Ebene durchlässig (Hand schiebt, Stift zeichnet)', ebene === 'none', ebene);
  const vorher = await ausschnitt(P);
  const b = await zug(P, welle(600, 450), { art: 'pen', id: 11 });
  await P.waitForTimeout(900);
  const z = await zaehler(P);
  pruefe('A2 touchstart/touchmove des Stifts erreichen React Flow NICHT', z.touchstart === 0 && z.touchmove === 0, JSON.stringify(z));
  pruefe('A3 der Stift-touchstart ist abgebrochen (defaultPrevented)', b.touchstartDefaultPrevented === true, JSON.stringify(b));
  pruefe('A4 der Ausschnitt steht still (kein Schwenken unter dem Strich)', (await ausschnitt(P)) === vorher, `${vorher} → ${await ausschnitt(P)}`);
  const d = await striche(P);
  pruefe('A5 der Strich ist gespeichert', d.length === 1 && d[0].points.length > 10, String(d.length));
  // Handballen: zweiter Touch (Finger) WÄHREND der Stift unten ist
  await zug(P, welle(600, 600), { art: 'pen', id: 12, offen: true });
  const ball = await P.evaluate(() => {
    const el = document.elementFromPoint(700, 700) ?? document.body;
    const t = new Touch({ identifier: 99, target: el, clientX: 700, clientY: 700, touchType: 'direct' });
    const ev = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] });
    el.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, rf: { ...window.__rf } };
  });
  pruefe('A6 ein Handballen-Touch während des Stift-Zugs bleibt ebenfalls vor React Flow', ball.prevented && ball.rf.touchstart === 0, JSON.stringify(ball));
  await P.evaluate(() => { const el = document.elementFromPoint(784, 600) ?? document.body; el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 12, pointerType: 'pen', clientX: 784, clientY: 600, buttons: 0 })); });
  await P.waitForTimeout(400);
  await ctx.close();
}

// ══ B: Finger ohne Stift-Zug schiebt weiter ═════════════════════════
console.log('\n════ B: Finger schiebt weiter ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  const vorher = await ausschnitt(P);
  // Echte Finger-Berührung über das Chrome-DevTools-Protokoll (erzeugt Touch- UND Pointer-Ereignisse wie ein Gerät)
  const cdp = await ctx.newCDPSession(P);
  const finger = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await finger('touchStart', 900, 650);
  for (let i = 1; i <= 8; i += 1) { await finger('touchMove', 900 + i * 25, 650 + i * 15); await P.waitForTimeout(20); }
  await finger('touchEnd', 1100, 770);
  await P.waitForTimeout(600);
  // (d3-zoom schluckt den touchstart selbst per stopImmediatePropagation — der Zähler sieht ihn nicht; entscheidend ist der Ausschnitt)
  pruefe('B1 Finger-Touches erreichen React Flow: der Ausschnitt hat sich bewegt (Hand schiebt)', (await ausschnitt(P)) !== vorher, `${vorher} → ${await ausschnitt(P)}`);
  pruefe('B2 der Finger hat nicht gezeichnet', (await striche(P)).length === 0);
  // Synthetische Doppelmeldung eines Fingers (touchType direct) ohne Stift-Zug: nicht abgebrochen
  const b = await zug(P, [[900, 650], [940, 670], [1000, 700]], { art: 'touch', id: 21 });
  pruefe('B3 ein Finger-touchstart ohne laufenden Stift-Zug wird nicht abgebrochen', b.touchstartDefaultPrevented === false, JSON.stringify(b));
  await ctx.close();
}

// ══ C: Direktzug im Auswahlmodus ════════════════════════════════════
console.log('\n════ C: Direktzug ════');
{
  const { ctx, P } = await seite();
  const vorher = await ausschnitt(P);
  await zug(P, welle(900, 650), { art: 'pen', id: 31 });
  await P.waitForTimeout(900);
  const z = await zaehler(P);
  pruefe('C1 Direktzug: Stift-Touches bleiben vor React Flow, Ausschnitt steht', z.touchstart === 0 && (await ausschnitt(P)) === vorher, JSON.stringify(z));
  pruefe('C2 Direktzug: Strich gespeichert', (await striche(P)).length === 1);
  await ctx.close();
}

// ══ D: Stift über einer Karte bleibt normaler Zeiger ════════════════
console.log('\n════ D: Stift über Karte ════');
{
  const { ctx, P } = await seite();
  const box = await P.locator('.react-flow__node').first().boundingBox();
  const x = box.x + 14, y = box.y + box.height - 10; // Kartenkörper unten links, kein Anschluss-Punkt
  const b = await zug(P, [[x, y], [x + 10, y + 5], [x + 30, y + 10]], { art: 'pen', id: 41 });
  await P.waitForTimeout(500);
  const z = await zaehler(P);
  // M325: „Der Stift schreibt, der Finger bedient" — auf einer Notiz schreibt der Stift auch im Auswahlmodus;
  // sein Touch-Doppel darf React Flow dann ebenfalls nicht erreichen (sonst zöge die Karte mit)
  pruefe('D1 über einer Notiz schreibt der Stift (M325): sein touchstart bleibt vor React Flow', b.touchstartDefaultPrevented === true && z.touchstart === 0 && /card|react-flow__node/.test(b.ziel), JSON.stringify({ z, b }));
  const d = await striche(P);
  pruefe('D2 dabei entsteht ein an die Karte geankerter Strich', d.length === 1 && d[0].anchor === 'n1', JSON.stringify(d.map((s) => s.anchor)));
  await ctx.close();
}

// ══ E: Texte ════════════════════════════════════════════════════════
console.log('\n════ E: Texte ════');
{
  const code = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('E1 „Was ist neu" nennt M322', code.includes('Stift schwenkt nicht mehr die Seite (M322)'));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
