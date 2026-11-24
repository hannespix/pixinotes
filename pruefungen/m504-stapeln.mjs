/**
 * M504 — Karten bewusst übereinander legen und stapeln.
 *
 * Gewünscht: „momentan kann man karten nichtmehr übereinander ziehen, da sie ja immer ausweichen. es wäre toll eine
 * entsprechende funktion zu haben dass man im bedarf auch manuell stapel oder übereinander setzen kann."
 *
 *   A  Ohne Verweilen: Der Nachbar weicht aus, abgelegt bleibt er beiseite, die Karte liegt dort, wo sie losgelassen
 *      wurde (wie M481).
 *   B  Verweilen: Hält man kurz still, kommt das Ziel zurück unter die Karte und trägt eine Markierung; abgelegt liegt
 *      die Karte im Kaskaden-Versatz darauf (gemessen: Lage im Stand und auf dem Bildschirm, obenauf), EIN Strg+Z.
 *   C  Weiterbewegen hebt das Ziel auf (es weicht wieder aus).
 *   D  Auf einen Stapel: Die Karte kommt auf die oberste Karte des Stapels.
 *   E  Alt: niemand weicht aus, frei übereinander (auch wenn Alt erst mitten im Zug kommt).
 *   F  Finger: Verweilen per Touch.   G  Weniger Bewegung: Stapeln geht auch dort.
 *   H  Einmal-Hinweis, wenn jemand lange über einer Karte hin und her zieht — nur einmal.   I  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m504-stapeln.mjs`
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
const PORT = 5504;
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

const nz = (id, x, y, farbe = 'yellow') => ({ id, type: 'note', width: 200, height: 120, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
// a und b nebeneinander, c weit unten, rechts ein Stapel aus s1 und s2 (Kaskade 26/46 wie „Stapeln")
const STAND = () => ({
  boards: [{ id: 'b1', name: 'Stapeln', comments: [], edges: [], drawings: [], nodes: [
    nz('a', 0, 0), nz('b', 360, 0, 'sky'), nz('c', 0, 480, 'green'), nz('s1', 760, 0, 'pink'), nz('s2', 786, 46, 'pink'),
  ] }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});

async function seite(st, opt = {}, gelernt = true) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', ...opt });
  await ctx.addInitScript(({ st, gelernt }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    if (gelernt) localStorage.setItem('pixinotes-stapel-gelernt', '1');
  }, { st, gelernt });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node[data-id="s2"]', { timeout: 30000 });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const zoomVon = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const rahmen = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, id);
const knoten = (P) => P.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, z: n.zIndex ?? 0 }])));
/** Auf den gespeicherten Stand warten, bis `bed` gilt (der Speicher schreibt verzögert) */
const standBis = async (P, bed, ms = 8000) => {
  const bis = Date.now() + ms; let s = await knoten(P);
  while (!bed(s) && Date.now() < bis) { await P.waitForTimeout(150); s = await knoten(P); }
  return s;
};
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`) ?? document.querySelector(`.react-flow__node[data-id="${id}"]`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 12)]; }, id);
const leer = (P) => P.mouse.click(1420, 880).then(() => P.waitForTimeout(200));
const markiert = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-stapel-ziel]')].map((e) => e.getAttribute('data-id')));
const warteBis = async (P, fn, arg, ms = 6000) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
/** Ziehen ohne Verweilen: alle 120 ms ein kleines Stück hin und her (mehr als die Ruhe-Toleranz) */
const zappeln = async (P, x, y, ms) => { const bis = Date.now() + ms; let i = 0; while (Date.now() < bis) { i += 1; await P.mouse.move(x + (i % 2 ? 16 : 0), y); await P.waitForTimeout(110); } await P.mouse.move(x, y); };
/** Greifen und anlaufen (React Flow verschluckt den ersten Schritt über der Schwelle) */
async function greifen(P, id) {
  const g = await griff(P, id);
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 4, { steps: 2 }); await P.mouse.move(g[0], g[1], { steps: 2 });
  return g;
}
const nah = (a, b, t = 1.5) => Math.abs(a.x - b.x) < t && Math.abs(a.y - b.y) < t;

/* ═══════════════════════ Maus ═══════════════════════ */
{
  const { ctx, P } = await seite(STAND());
  const z = await zoomVon(P);
  console.log(`  (Zoom ${z})`);
  const s0 = await knoten(P);
  const a0 = await rahmen(P, 'a'); const b0 = await rahmen(P, 'b');
  // a so über b, dass a's Mitte auf b's linker Hälfte liegt (deutlich überdeckt)
  const ueberB = (g) => [g[0] + (b0.x - a0.x) + 50 * z, g[1] + 30 * z];

  console.log('\n════ A: ohne Verweilen weicht das Ziel aus ════');
  await leer(P);
  let g = await greifen(P, 'a');
  let ziel = ueberB(g);
  await P.mouse.move(ziel[0], ziel[1], { steps: 10 });
  await zappeln(P, ziel[0], ziel[1], 1000);
  const bA = await rahmen(P, 'b');
  pruefe('A1 über b gezogen (ohne stillzuhalten) weicht b aus', Math.hypot(bA.x - b0.x, bA.y - b0.y) > 40 * z, { b0: [b0.x, b0.y], bA: [bA.x, bA.y] });
  pruefe('A2 … keine Stapel-Markierung', (await markiert(P)).length === 0, await markiert(P));
  await P.mouse.up();
  let sA = await standBis(P, (s) => s.a.x !== s0.a.x);
  pruefe('A3 abgelegt: b bleibt beiseite, a liegt dort, wo sie losgelassen wurde (nicht im Stapel-Versatz)',
    Math.hypot(sA.b.x - s0.b.x, sA.b.y - s0.b.y) > 40 && Math.abs(sA.a.x - (s0.b.x + 50)) < 20 && Math.abs(sA.a.y - 30) < 20, sA);
  await leer(P);
  await P.keyboard.press('Control+z');
  sA = await standBis(P, (s) => s.a.x === s0.a.x && s.b.x === s0.b.x && s.b.y === s0.b.y);
  pruefe('A4 Strg+Z: alles wieder wie vorher', nah(sA.a, s0.a, 0.01) && nah(sA.b, s0.b, 0.01), sA);
  await P.waitForTimeout(500);

  console.log('\n════ B: verweilen legt die Karte auf b ════');
  await leer(P);
  g = await greifen(P, 'a');
  ziel = ueberB(g);
  await P.mouse.move(ziel[0], ziel[1], { steps: 10 });
  await zappeln(P, ziel[0], ziel[1], 400);   // erst weicht b aus …
  const bAus = await rahmen(P, 'b');
  const t0 = Date.now();
  const markiertJa = await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="b"][data-stapel-ziel]'));
  const dauer = Date.now() - t0;
  pruefe('B1 still gehalten wird b zum Ziel (Markierung) – nach rund einer halben Sekunde', markiertJa && dauer >= 300, { markiertJa, dauer });
  const bZurueck = await warteBis(P, ([x, y]) => { const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect(); return Math.abs(r.left - x) < 1 && Math.abs(r.top - y) < 1; }, [b0.x, b0.y]);
  pruefe('B2 … b hört auf auszuweichen und kommt zurück unter die Karte', Math.hypot(bAus.x - b0.x, bAus.y - b0.y) > 30 * z && bZurueck, { bAus: [bAus.x, bAus.y], b0: [b0.x, b0.y] });
  const markierung = await P.evaluate(() => { const cs = getComputedStyle(document.querySelector('.react-flow__node[data-id="b"]')); return [cs.outlineStyle, cs.outlineWidth]; });
  pruefe('B3 die Markierung ist eine ruhige gestrichelte Linie', markierung[0] === 'dashed' && parseFloat(markierung[1]) >= 2, markierung);
  const aOben = await P.evaluate(() => { const a = document.querySelector('.react-flow__node[data-id="a"]'); const r = a.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.react-flow__node')?.getAttribute('data-id'); });
  pruefe('B4 die gezogene Karte liegt sichtbar über b', aOben === 'a', aOben);
  await P.screenshot({ path: path.join(SD, 'm504-ziel.png') });
  const sZug = await knoten(P);
  pruefe('B5 während des Zugs steht nichts Neues im Stand', nah(sZug.b, s0.b, 0.01), sZug.b);
  await P.mouse.up();
  const sB = await standBis(P, (s) => s.a.x === s0.b.x + 26 && s.a.y === s0.b.y + 46);
  pruefe('B6 abgelegt liegt a auf b im Stapel-Versatz (26/46 wie „Stapeln") – b unverändert', sB.a.x === s0.b.x + 26 && sB.a.y === s0.b.y + 46 && nah(sB.b, s0.b, 0.01), sB);
  pruefe('B7 a liegt obenauf (zIndex über b)', sB.a.z > sB.b.z, [sB.a.z, sB.b.z]);
  pruefe('B8 die Markierung ist weg', (await markiert(P)).length === 0);
  const gelandet = await warteBis(P, ([x, y]) => { const r = document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect(); return Math.abs(r.left - x) < 1 && Math.abs(r.top - y) < 1 && !document.querySelector('.react-flow__node[data-id="a"]').style.translate; }, [b0.x + 26 * z, b0.y + 46 * z]);
  pruefe('B9 auf dem Bildschirm steht a genau im Versatz über b (ohne Rest-Versatz)', gelandet, await rahmen(P, 'a'));
  await P.screenshot({ path: path.join(SD, 'm504-gestapelt.png') });
  await leer(P);
  await P.keyboard.press('Control+z');
  const sU = await standBis(P, (s) => nah(s.a, s0.a, 0.01));
  pruefe('B10 EIN Strg+Z nimmt das Stapeln zurück', nah(sU.a, s0.a, 0.01) && nah(sU.b, s0.b, 0.01), sU);
  await P.waitForTimeout(500);

  console.log('\n════ C: weiterbewegen hebt das Ziel auf ════');
  await leer(P);
  g = await greifen(P, 'a');
  ziel = ueberB(g);
  await P.mouse.move(ziel[0], ziel[1], { steps: 10 });
  const cZiel = await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="b"][data-stapel-ziel]'));
  await P.mouse.move(ziel[0] + 60, ziel[1] + 10, { steps: 6 });
  await zappeln(P, ziel[0] + 60, ziel[1] + 10, 400);
  const cWeg = (await markiert(P)).length === 0;
  const bC = await rahmen(P, 'b');
  pruefe('C1 weiterbewegt: keine Markierung mehr, b weicht wieder aus', cZiel && cWeg && Math.hypot(bC.x - b0.x, bC.y - b0.y) > 30 * z, { cZiel, cWeg, bC: [bC.x, bC.y] });
  // weg von b, zurück an den Platz
  await P.mouse.move(g[0], g[1], { steps: 10 }); await P.mouse.up();
  const sC = await standBis(P, (s) => nah(s.b, s0.b, 0.01) && Math.hypot(s.a.x - s0.a.x, s.a.y - s0.a.y) < 30);
  pruefe('C2 woanders abgelegt: kein Stapel, b an seinem Platz', nah(sC.b, s0.b, 0.01) && !(sC.a.x === s0.b.x + 26), sC);
  await P.waitForTimeout(400);

  console.log('\n════ D: auf einen vorhandenen Stapel ════');
  await leer(P);
  const r1 = await rahmen(P, 's1'); const aD0 = await rahmen(P, 'a');
  g = await greifen(P, 'a');
  // über s1 (die untere Karte des Stapels) stillhalten
  const ueberS1 = [g[0] + (r1.x - aD0.x) + 10 * z, g[1] + (r1.y - aD0.y) + 10 * z];
  await P.mouse.move(ueberS1[0], ueberS1[1], { steps: 12 });
  const dZiel = await warteBis(P, () => document.querySelectorAll('.react-flow__node[data-stapel-ziel]').length === 1);
  await P.mouse.up();
  const sD = await standBis(P, (s) => s.a.x === s0.s2.x + 26 && s.a.y === s0.s2.y + 46);
  pruefe('D1 die Karte kommt auf die oberste Karte des Stapels (s2 + 26/46)', dZiel && sD.a.x === s0.s2.x + 26 && sD.a.y === s0.s2.y + 46, { dZiel, a: sD.a, s2: s0.s2 });
  pruefe('D2 der Stapel selbst bleibt liegen', nah(sD.s1, s0.s1, 0.01) && nah(sD.s2, s0.s2, 0.01), sD);
  await leer(P); await P.keyboard.press('Control+z');
  await standBis(P, (s) => nah(s.a, s0.a, 0.01));
  await P.waitForTimeout(500);

  console.log('\n════ E: Alt – niemand weicht aus ════');
  await leer(P);
  g = await greifen(P, 'a');
  ziel = ueberB(g);
  await P.keyboard.down('Alt');
  await P.mouse.move(ziel[0], ziel[1], { steps: 10 });
  await P.waitForTimeout(1100);   // auch langes Stillhalten macht mit Alt keinen Stapel
  const bE = await rahmen(P, 'b');
  pruefe('E1 mit Alt weicht b nicht aus', nah(bE, b0, 0.6), { bE: [bE.x, bE.y], b0: [b0.x, b0.y] });
  pruefe('E2 … und wird nicht zum Stapel-Ziel', (await markiert(P)).length === 0);
  const aE = await rahmen(P, 'a');
  await P.mouse.up();
  await P.keyboard.up('Alt');
  const sE = await standBis(P, (s) => s.a.x !== s0.a.x);
  const erwartetX = s0.a.x + (aE.x - aD0.x) / z; const erwartetY = s0.a.y + (aE.y - aD0.y) / z;
  pruefe('E3 frei übereinander abgelegt: a liegt genau dort (über b), b unverändert',
    Math.abs(sE.a.x - erwartetX) < 10 && Math.abs(sE.a.y - erwartetY) < 10 && nah(sE.b, s0.b, 0.01) && sE.a.x > s0.b.x && sE.a.x < s0.b.x + 200, { a: sE.a, erwartet: [erwartetX, erwartetY] });
  await leer(P); await P.keyboard.press('Control+z');
  await standBis(P, (s) => nah(s.a, s0.a, 0.01));
  await P.waitForTimeout(500);
  // Alt erst mitten im Zug — ohne Mausbewegung
  await leer(P);
  g = await greifen(P, 'a');
  ziel = ueberB(g);
  await P.mouse.move(ziel[0], ziel[1], { steps: 10 });
  await zappeln(P, ziel[0], ziel[1], 300);
  const bVor = await rahmen(P, 'b');
  await P.keyboard.down('Alt');
  const zurueck = await warteBis(P, ([x, y]) => { const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect(); return Math.abs(r.left - x) < 1 && Math.abs(r.top - y) < 1; }, [b0.x, b0.y]);
  pruefe('E4 Alt mitten im Zug: b (eben noch ausgewichen) gleitet zurück', Math.hypot(bVor.x - b0.x, bVor.y - b0.y) > 30 * z && zurueck, { bVor: [bVor.x, bVor.y] });
  await P.keyboard.up('Alt');
  const wiederAus = await warteBis(P, ([x, y]) => { const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect(); return Math.hypot(r.left - x, r.top - y) > 30; }, [b0.x, b0.y], 3000);
  pruefe('E5 Alt losgelassen: b weicht wieder aus', wiederAus);
  await P.mouse.move(g[0], g[1], { steps: 8 }); await P.mouse.up();
  await P.waitForTimeout(600);
  await ctx.close();
}

/* ═══════════════════════ Finger ═══════════════════════ */
console.log('\n════ F: Finger ════');
{
  const { ctx, P } = await seite(STAND(), { hasTouch: true, isMobile: false });
  const cdp = await ctx.newCDPSession(P);
  const s0 = await knoten(P);
  const a0 = await rahmen(P, 'a'); const b0 = await rahmen(P, 'b');
  const z = await zoomVon(P);
  const g = await griff(P, 'a');
  const dx = (b0.x - a0.x) + 50 * z; const dy = 30 * z;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g[0], y: g[1], id: 1 }] });
  await P.waitForTimeout(80);
  for (let i = 1; i <= 14; i += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g[0] + (dx * i) / 14, y: g[1] + (dy * i) / 14, id: 1 }] }); await P.waitForTimeout(20); }
  // leichtes Zittern des Fingers (unter der Toleranz) zählt als Stillhalten
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g[0] + dx + 3, y: g[1] + dy - 2, id: 1 }] });
  const fZiel = await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="b"][data-stapel-ziel]'));
  pruefe('F1 mit dem Finger still gehalten wird b zum Ziel', fZiel);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const sF = await standBis(P, (s) => s.a.x === s0.b.x + 26 && s.a.y === s0.b.y + 46);
  pruefe('F2 … und die Karte liegt auf b', sF.a.x === s0.b.x + 26 && sF.a.y === s0.b.y + 46, sF);
  await ctx.close();
}

/* ═══════════════════════ Weniger Bewegung ═══════════════════════ */
console.log('\n════ G: weniger Bewegung ════');
{
  const { ctx, P } = await seite(STAND(), { reducedMotion: 'reduce' });
  const s0 = await knoten(P);
  const z = await zoomVon(P);
  const a0 = await rahmen(P, 'a'); const b0 = await rahmen(P, 'b');
  await leer(P);
  const g = await greifen(P, 'a');
  await P.mouse.move(g[0] + (b0.x - a0.x) + 50 * z, g[1] + 30 * z, { steps: 10 });
  const gZiel = await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="b"][data-stapel-ziel]'));
  await P.mouse.up();
  const sG = await standBis(P, (s) => s.a.x === s0.b.x + 26 && s.a.y === s0.b.y + 46);
  pruefe('G1 auch bei „weniger Bewegung" legt Verweilen die Karte auf b', gZiel && sG.a.x === s0.b.x + 26 && sG.a.y === s0.b.y + 46, sG);
  await ctx.close();
}

/* ═══════════════════════ Hinweis ═══════════════════════ */
console.log('\n════ H: Einmal-Hinweis ════');
{
  const { ctx, P } = await seite(STAND(), {}, false);
  const z = await zoomVon(P);
  const toasts = [];
  await P.exposeFunction('m504Toast', (t) => toasts.push(t));
  await P.evaluate(() => { const t = document.querySelector('.toast'); new MutationObserver(() => { if (t.classList.contains('show')) window.m504Toast(t.textContent); }).observe(t, { attributes: true, childList: true, subtree: true, characterData: true }); });
  const a0 = await rahmen(P, 'a'); const b0 = await rahmen(P, 'b');
  const jagen = async () => {
    await leer(P);
    const g = await greifen(P, 'a');
    const ziel = [g[0] + (b0.x - a0.x) + 50 * z, g[1] + 30 * z];
    await P.mouse.move(ziel[0], ziel[1], { steps: 8 });
    await zappeln(P, ziel[0], ziel[1], 2600);   // hin und her über b, ohne stillzuhalten
    await P.mouse.move(g[0], g[1], { steps: 8 }); await P.mouse.up();
    await P.waitForTimeout(500);
  };
  await jagen();
  const hinweise = () => toasts.filter((t) => /kurz still/.test(t));
  pruefe('H1 wer lange über b hin und her zieht, bekommt einmal den Hinweis aufs Stillhalten (und Alt)', hinweise().length >= 1 && /Alt/.test(hinweise()[0]), toasts);
  const n = hinweise().length;
  await jagen();
  pruefe('H2 … nur einmal', hinweise().length === n && await P.evaluate(() => localStorage.getItem('pixinotes-stapel-gelernt') === '1'), toasts);
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
console.log('\n════ I: Texte ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  const en = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  const quelle = readFileSync(path.join(__repo, 'src/lib/ziehGefuehl.ts'), 'utf8');
  pruefe('I1 Hilfe deutsch und englisch nennen M504', /M504/.test(hilfe) && /M504/.test(hilfeEn));
  const texte = [...quelle.matchAll(/STAPEL_HINWEIS(?:_FINGER)? = '([^']+)'/g)].map((m) => m[1]);
  pruefe('I2 die Hinweise sind übersetzt', texte.length === 2 && texte.every((t) => typeof en[t] === 'string'), texte);
  pruefe('I3 Meilenstein-Datei liegt vor', existsSync(path.join(__repo, 'docs/meilensteine/M504-stapeln.md')));
}
await browser.close(); app.close();
console.log(`\nM504: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
