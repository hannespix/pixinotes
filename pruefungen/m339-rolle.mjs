/**
 * M339 — Lange Notizen scrollen in der Karte; Markierungen und Zeichnungen haften am Text.
 *
 *   A  Überlauf: Die Notiz scrollt (Rad, Daumen, Finger), der Balken zeigt den Stand,
 *      Schatten zeigen „da kommt noch was". Kurze Notizen bleiben, wie sie sind.
 *   B  Striche auf dem Text gehören zum Text: in der Notiz gezeichnet, scrollen mit,
 *      bleiben beim Absetzen pixelgenau stehen, lassen sich an ihrer sichtbaren Stelle
 *      radieren und folgen ihrem Absatz, wenn darüber Text dazukommt.
 *   C  Was über den Kartenrand ragt, bleibt an der Karte (Zeichenebene).
 *   D  Ältere Striche ohne Angabe: auf der Karte = am Text; vor dem Verkleinern festgeschrieben.
 *   E  Der Farbpunkt scrollt nicht mit. · F Hilfe.
 */
// Läuft aus dem Repository: `node pruefungen/m339-rolle.mjs`
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
const PORT = 4557;
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

const absatz = (i) => ({ id: `p${i}`, type: 'paragraph', content: `Zeile ${i} Wort${i} noch etwas Text dazu` });
const lang = Array.from({ length: 40 }, (_, i) => absatz(i + 1));
const stand = (extra = []) => ({
  boards: [{ id: 'b1', name: 'Rolle', edges: [], comments: [], drawings: extra, nodes: [
    { id: 'n1', type: 'note', width: 320, height: 260, autoFit: false, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: lang } },
    { id: 'n2', type: 'note', width: 260, position: { x: 420, y: 0 }, data: { color: 'sky', blocks: [{ id: 'k1', type: 'paragraph', content: 'Kurze Notiz' }] } },
    { id: 'n3', type: 'note', width: 280, position: { x: 760, y: 0 }, data: { color: 'mint', blocks: Array.from({ length: 70 }, (_, i) => ({ id: `q${i}`, type: 'paragraph', content: `Auto ${i}` })) } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(st, { touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: touch });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const board = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);
const striche = async (P) => { await P.waitForTimeout(1300); return (await board(P)).drawings ?? []; };
const rolle = (P, id) => P.evaluate((id) => {
  const sh = document.querySelector(`.react-flow__node[data-id="${id}"] .card-shell`); const b = sh.querySelector('.card-body');
  const d = sh.querySelector('.note-daumen'); const dr = d?.getBoundingClientRect(); const br = b.getBoundingClientRect();
  return { rollt: sh.hasAttribute('data-rollt'), oben: sh.hasAttribute('data-mehr-oben'), unten: sh.hasAttribute('data-mehr-unten'), top: b.scrollTop, max: b.scrollHeight - b.clientHeight, h: b.clientHeight,
    k: br.height / b.clientHeight, daumen: dr ? { y: dr.top - br.top, h: dr.height, x: dr.left + dr.width / 2, cy: dr.top + dr.height / 2 } : null, karte: { x: br.left, y: br.top, w: br.width, h: br.height } };
}, id);
const scrollen = async (P, id, y) => { await P.evaluate(({ id, y }) => { document.querySelector(`.react-flow__node[data-id="${id}"] .card-body`).scrollTop = y; }, { id, y }); await P.waitForTimeout(250); };
const wortRect = (P, id, wort) => P.evaluate(({ id, wort }) => {
  const root = document.querySelector(`.react-flow__node[data-id="${id}"] .bn-editor`);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let t; while ((t = w.nextNode())) { const i = t.data.indexOf(wort); if (i >= 0 && (t.data[i + wort.length] ?? ' ') === ' ') { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + wort.length); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom, cy: b.top + b.height / 2 }; } }
  return null;
}, { id, wort });
/** Bildschirm-Kästen der Strich-Pfade: in der Notiz bzw. in der Zeichenebene */
const pfade = (P, id) => P.evaluate((id) => {
  const k = (p) => { const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cy: r.top + r.height / 2 }; };
  return { innen: [...document.querySelectorAll(`.react-flow__node[data-id="${id}"] .notiz-striche path`)].map(k), ebene: [...document.querySelectorAll('.drawing-layer path')].map(k) };
}, id);
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
const strich = async (P, punkte) => {
  await P.mouse.move(punkte[0][0], punkte[0][1]); await P.mouse.down();
  for (const [x, y] of punkte.slice(1)) { await P.mouse.move(x, y); await P.waitForTimeout(12); }
  await P.mouse.up(); await P.waitForTimeout(500);
};
const ueberWort = (w) => Array.from({ length: 8 }, (_, i) => [w.x + 1 + (i * (w.w - 2)) / 7, w.cy]);

// ══ A: Überlauf ════════════════════════════════════════════════════════
console.log('\n════ A: Überlauf mit Scrollbalken ════');
{
  const { ctx, P } = await seite(stand());
  let r = await rolle(P, 'n1');
  pruefe('A1 die lange Notiz scrollt (Inhalt größer als Karte)', r.rollt && r.max > 300, JSON.stringify(r));
  pruefe('A2 am Anfang: Schatten nur unten', !r.oben && r.unten);
  const kurz = await rolle(P, 'n2');
  pruefe('A3 eine kurze Notiz hat keinen Scrollbereich und keinen Balken', !kurz.rollt && await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="n2"] .note-spur')).display === 'none'));
  const auto = await rolle(P, 'n3');
  const n3 = (await board(P)).nodes.find((n) => n.id === 'n3');
  pruefe('A4 eine Notiz ohne feste Höhe wächst mit dem Inhalt bis 640 — darüber scrollt sie', n3.height === undefined && auto.h === 640 && auto.rollt && auto.max > 100, JSON.stringify({ h: n3.height, koerper: auto.h, rollt: auto.rollt, max: auto.max }));
  // Rad über der Notiz (Rad schwenkt in der Vorgabe: Modul-Scroll gewinnt)
  await P.mouse.move(r.karte.x + 100, r.karte.y + 120);
  await P.mouse.wheel(0, 180); await P.waitForTimeout(350);
  r = await rolle(P, 'n1');
  pruefe('A5 das Rad über der Notiz scrollt ihren Text', r.top > 100, String(r.top));
  pruefe('A6 jetzt Schatten oben und unten, der Daumen ist gewandert', r.oben && r.unten && r.daumen.y > 8, JSON.stringify(r.daumen));
  pruefe('A7 die Leiste des Browsers bleibt aus', await P.evaluate(() => { const b = document.querySelector('.react-flow__node[data-id="n1"] .card-body'); return b.offsetWidth - b.clientWidth === 0; }));
  // Daumen ziehen
  const vp0 = await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  const pos0 = (await board(P)).nodes.find((n) => n.id === 'n1').position;
  await P.mouse.move(r.daumen.x, r.daumen.cy); await P.mouse.down();
  await P.mouse.move(r.daumen.x, r.daumen.cy + 60, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(400);
  const r2 = await rolle(P, 'n1');
  const pos1 = (await board(P)).nodes.find((n) => n.id === 'n1').position;
  pruefe('A8 Ziehen am Daumen scrollt — die Karte bleibt stehen, das Board auch', r2.top > r.top + 150 && pos0.x === pos1.x && pos0.y === pos1.y && vp0 === await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform), JSON.stringify({ vor: r.top, nach: r2.top, pos0, pos1 }));
  await scrollen(P, 'n1', 99999);
  const ende = await rolle(P, 'n1');
  pruefe('A9 am Ende: Schatten nur oben, Daumen unten', ende.oben && !ende.unten && Math.abs(ende.daumen.y + ende.daumen.h - (ende.karte.h - 4 * ende.k)) < 3, JSON.stringify(ende));
  // E: Farbpunkt
  const punkt = await P.evaluate(() => { const n = document.querySelector('.react-flow__node[data-id="n1"]'); const d = n.querySelector('.color-dot').getBoundingClientRect(); const k = n.getBoundingClientRect(); return { y: d.top - k.top, inBody: !!n.querySelector('.card-body .color-dot') }; });
  pruefe('E1 der Farbpunkt liegt auf der Hülle und scrollt nicht mit', !punkt.inBody && punkt.y > 0 && punkt.y < 20, JSON.stringify(punkt));
  await P.screenshot({ path: path.join(SD, 'm339-rolle.png') });
  await ctx.close();
}

// ══ B/C: Striche am Text ═══════════════════════════════════════════════
console.log('\n════ B: Markierungen haften am Text ════');
{
  const { ctx, P } = await seite(stand());
  await werkzeug(P, 'Textmarker');
  const w3 = await wortRect(P, 'n1', 'Wort3');
  await strich(P, ueberWort(w3));
  let st = await striche(P);
  pruefe('B1 der Marker auf dem Wort gehört zum Text und kennt seinen Absatz', st.length === 1 && st[0].amText === true && st[0].anchor === 'n1' && st[0].block === 'p3', JSON.stringify(st.map((s) => ({ a: s.amText, b: s.block, y: s.blockY }))));
  let p = await pfade(P, 'n1');
  pruefe('B2 er wird IN der Notiz gezeichnet, nicht in der Zeichenebene', p.innen.length === 1 && p.ebene.length === 0, JSON.stringify(p));
  pruefe('B3 … an genau der Stelle, an der er gezogen wurde', Math.abs(p.innen[0].cy - w3.cy) < 1.5 && Math.abs(p.innen[0].x - w3.x) < 3, JSON.stringify({ pfad: p.innen[0], wort: w3 }));
  // scrollen: Wort und Strich wandern gemeinsam
  await scrollen(P, 'n1', 30);
  const w3b = await wortRect(P, 'n1', 'Wort3'); p = await pfade(P, 'n1');
  pruefe('B4 beim Scrollen wandert der Strich mit dem Wort', Math.abs(w3b.cy - (w3.cy - 30 * (await rolle(P, 'n1')).k)) < 1 && Math.abs(p.innen[0].cy - w3b.cy) < 1.5, JSON.stringify({ wort: w3b.cy, pfad: p.innen[0].cy }));
  // weit gescrollt: weiter unten markieren
  await scrollen(P, 'n1', 400);
  const r = await rolle(P, 'n1');
  const sicht = await P.evaluate(() => { const b = document.querySelector('.react-flow__node[data-id="n1"] .card-body').getBoundingClientRect(); for (let i = 1; i <= 40; i += 1) { const el = [...document.querySelectorAll('.react-flow__node[data-id="n1"] .bn-block')].find((x) => x.dataset.id === `p${i}`); const rr = el.getBoundingClientRect(); if (rr.top > b.top + 60 && rr.bottom < b.bottom - 60) return i; } return 0; });
  const wn = await wortRect(P, 'n1', `Wort${sicht}`);
  await strich(P, ueberWort(wn));
  st = await striche(P);
  const neu = st.find((s) => s.block === `p${sicht}`);
  const yMitte = neu ? (Math.min(...neu.points.map((q) => q[1])) + Math.max(...neu.points.map((q) => q[1]))) / 2 : 0;
  pruefe('B5 gescrollt gezeichnet: gespeichert in Inhaltspunkten (Scrollstand eingerechnet)', !!neu && neu.amText === true && yMitte > 400 && Math.abs(yMitte - ((wn.cy - r.karte.y) / r.k + r.top)) < 2, JSON.stringify({ sicht, yMitte, soll: (wn.cy - r.karte.y) / r.k + r.top }));
  p = await pfade(P, 'n1');
  pruefe('B6 der neue Strich liegt auf seinem Wort; der erste ist nach oben weggescrollt', p.innen.length === 2 && p.innen.some((q) => Math.abs(q.cy - wn.cy) < 1.5) && p.innen.some((q) => q.cy < r.karte.y), JSON.stringify(p.innen.map((q) => q.cy)));
  pruefe('B7 Striche vergrößern den Scrollbereich nicht', (await rolle(P, 'n1')).max === r.max);
  await P.screenshot({ path: path.join(SD, 'm339-marker.png') });
  // Absatz rückt: oben kommen zwei Absätze dazu
  await P.locator('.draw-done').click(); await P.waitForTimeout(300);
  // über die Oberfläche: in die Notiz klicken, an den Anfang springen, zwei Zeilen tippen
  await scrollen(P, 'n1', 0);
  const w1 = await wortRect(P, 'n1', 'Wort1');
  await P.mouse.click(w1.x + 2, w1.cy); await P.waitForTimeout(700);
  await P.keyboard.press('Home'); await P.keyboard.type('Neu eins'); await P.keyboard.press('Enter'); await P.keyboard.type('Neu zwei'); await P.keyboard.press('Enter');
  await P.waitForTimeout(900);
  const w3c = await wortRect(P, 'n1', 'Wort3'); p = await pfade(P, 'n1');
  const naechster = p.innen.reduce((a, q) => (Math.abs(q.cy - w3c.cy) < Math.abs(a.cy - w3c.cy) ? q : a), p.innen[0]);
  pruefe('B8 kommt darüber Text dazu, rückt der Strich mit seinem Absatz', w3c.cy > w3.cy + 20 && Math.abs(naechster.cy - w3c.cy) < 2, JSON.stringify({ wortVor: w3.cy, wortNach: w3c.cy, pfad: naechster.cy }));
  await P.keyboard.press('Escape'); await P.mouse.click(1380, 860); await P.waitForTimeout(1500);
  // neu geladen: der Versatz steht nirgends — er ergibt sich wieder aus der Lage des Absatzes
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  const w3e = await wortRect(P, 'n1', 'Wort3'); p = await pfade(P, 'n1');
  pruefe('B8b nach dem Neuladen sitzt der Strich wieder auf seinem Wort', p.innen.some((q) => Math.abs(q.cy - w3e.cy) < 2), JSON.stringify({ wort: w3e.cy, pfade: p.innen.map((q) => q.cy) }));
  // Radierer an der SICHTBAREN Stelle, während gescrollt ist
  await scrollen(P, 'n1', 20);
  await werkzeug(P, 'Radierer');
  if (await P.locator('.draw-radierer-art', { hasText: 'Strich' }).count()) await P.locator('.draw-radierer-art', { hasText: 'Strich' }).click();
  const w3d = await wortRect(P, 'n1', 'Wort3');
  await strich(P, [[w3d.x + 4, w3d.cy - 6], [w3d.x + w3d.w / 2, w3d.cy], [w3d.r - 4, w3d.cy + 6]]);
  st = await striche(P);
  pruefe('B9 der Radierer trifft den Strich dort, wo man ihn sieht (gescrollt, Absatz gerückt)', st.length === 1 && st[0].block !== 'p3', JSON.stringify(st.map((s) => s.block)));
  // C: über den Rand hinaus
  await werkzeug(P, 'Stift');
  const k = (await rolle(P, 'n1')).karte;
  await strich(P, Array.from({ length: 10 }, (_, i) => [k.x + k.w - 60 + i * 14, k.y + 120 + (i % 2) * 3]));
  st = await striche(P);
  const raus = st.find((s) => s.tool === 'pen');
  p = await pfade(P, 'n1');
  pruefe('C1 ein Strich über den Kartenrand hinaus bleibt an der Karte (Zeichenebene)', !!raus && raus.anchor === 'n1' && raus.amText === false && p.ebene.length === 1, JSON.stringify({ raus: raus && { a: raus.anchor, t: raus.amText }, ebene: p.ebene.length }));
  const eb0 = p.ebene[0].cy;
  await scrollen(P, 'n1', 200);
  pruefe('C2 … und scrollt nicht mit', Math.abs((await pfade(P, 'n1')).ebene[0].cy - eb0) < 0.5);
  await ctx.close();
}

// ══ D: ältere Striche ══════════════════════════════════════════════════
console.log('\n════ D: Striche von vor M339 ════');
{
  const alt = [
    { id: 'alt1', tool: 'marker', color: '#fff200', width: 16, anchor: 'n1', points: [[40, 120], [80, 120], [120, 121], [160, 120], [200, 120], [230, 120], [240, 120], [250, 120]] },
    { id: 'alt2', tool: 'pen', color: '#3c669c', width: 2.5, anchor: 'n1', points: [[280, 100], [300, 100], [330, 102], [360, 100], [380, 100], [400, 101], [420, 100], [440, 100]] },
  ];
  const { ctx, P } = await seite(stand(alt));
  let p = await pfade(P, 'n1');
  pruefe('D1 ganz auf der Karte = am Text (in der Notiz); über den Rand = an der Karte', p.innen.length === 1 && p.ebene.length === 1, JSON.stringify({ innen: p.innen.length, ebene: p.ebene.length }));
  const y0 = p.innen[0].cy; const e0 = p.ebene[0].cy;
  await scrollen(P, 'n1', 50);
  p = await pfade(P, 'n1');
  const k = (await rolle(P, 'n1')).k;
  pruefe('D2 der alte Marker scrollt mit, der alte Rand-Strich nicht', Math.abs(p.innen[0].cy - (y0 - 50 * k)) < 1 && Math.abs(p.ebene[0].cy - e0) < 0.5, JSON.stringify({ innen: p.innen[0].cy, y0, ebene: p.ebene[0].cy }));
  pruefe('D3 bloßes Ansehen und Scrollen schreibt nichts fest', (await striche(P)).every((s) => s.amText === undefined));
  // Karte verkleinern: vorher wird festgeschrieben
  await scrollen(P, 'n1', 0);
  await P.locator('.react-flow__node[data-id="n1"] .card-grip').click({ force: true }); await P.waitForTimeout(400);
  const griff = await P.evaluate(() => { const g = [...document.querySelectorAll('.react-flow__node[data-id="n1"] .react-flow__resize-control.handle')].map((h) => h.getBoundingClientRect()).sort((a, b) => (b.left + b.top) - (a.left + a.top))[0]; return [g.left + g.width / 2, g.top + g.height / 2]; });
  await P.mouse.move(griff[0], griff[1]); await P.mouse.down();
  await P.mouse.move(griff[0], griff[1] - 150, { steps: 8 }); await P.mouse.up(); await P.waitForTimeout(600);
  const st = await striche(P);
  const n1 = (await board(P)).nodes.find((n) => n.id === 'n1');
  pruefe('D4 vor dem Verkleinern festgeschrieben: Marker am Text, Rand-Strich an der Karte', n1.height < 200 && st.find((s) => s.id === 'alt1')?.amText === true && st.find((s) => s.id === 'alt2')?.amText === false, JSON.stringify({ h: n1.height, st: st.map((s) => s.amText) }));
  await ctx.close();
}

// ══ G: Finger ══════════════════════════════════════════════════════════
console.log('\n════ G: Finger rollt die Notiz ════');
{
  const { ctx, P } = await seite(stand(), { touch: true });
  const r = await rolle(P, 'n1');
  const vp0 = await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  const zug = (x, y0, y1) => P.evaluate(async ({ x, y0, y1 }) => {
    const el = document.elementFromPoint(x, y0);
    const mk = (y) => new Touch({ identifier: 5, target: el, clientX: x, clientY: y });
    const ev = (typ, y, weg = false) => el.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true, touches: weg ? [] : [mk(y)], targetTouches: weg ? [] : [mk(y)], changedTouches: [mk(y)] }));
    ev('touchstart', y0);
    for (let i = 1; i <= 10; i += 1) { ev('touchmove', y0 + ((y1 - y0) * i) / 10); await new Promise((q) => setTimeout(q, 16)); }
    await new Promise((q) => setTimeout(q, 200)); // Finger ruht: kein Nachlauf
    ev('touchend', y1, true);
  }, { x, y0, y1 });
  await zug(r.karte.x + 120, r.karte.y + 200, r.karte.y + 60);
  await P.waitForTimeout(400);
  const r2 = await rolle(P, 'n1');
  pruefe('G1 der Finger-Zug rollt den Text um den Fingerweg', Math.abs(r2.top - 140 / r.k) < 14, `${r2.top} statt ${140 / r.k}`);
  pruefe('G2 das Board bleibt dabei stehen', vp0 === await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform));
  pruefe('G3 der Scrollbereich trägt touch-action none (der Stift schreibt statt zu scrollen)', await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="n1"] .card-body')).touchAction === 'none'));
  // am oberen Anschlag nach unten ziehen: das Board schwenkt
  await scrollen(P, 'n1', 0);
  await zug(r.karte.x + 120, r.karte.y + 60, r.karte.y + 160);
  await P.waitForTimeout(300);
  pruefe('G4 am Anschlag schwenkt der Zug das Board (wie bisher)', vp0 !== await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform));
  await ctx.close();
}

// ══ F: Texte ═══════════════════════════════════════════════════════════
console.log('\n════ F: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('F1 „Was ist neu" nennt M339', js.includes('(M339)'));

await browser.close();
app.close();
console.log(`\nm339-rolle: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
