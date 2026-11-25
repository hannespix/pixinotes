/**
 * M542 — Rahmen fangen, richten sich aus und passen ihre Größe an (wie Karten).
 *
 *   A  Rahmen ziehen: rastet an der Kante einer anderen Karte ein (Linie im Zug), der Inhalt bewegt sich exakt mit
 *      (auch im Zug kein Versatz zwischen Rahmen und Inhalt); Strg = frei.
 *   B  Raster-Fang gilt auch für Rahmen; der Inhalt behält seinen Abstand.
 *   C  Größe ändern: die rechte Kante eines Rahmens rastet an einer Nachbarkarte ein (Linie im Zug), auch bei einer
 *      Notiz; Strg = frei.
 *   D  Anordnen: zwei Rahmen oben ausrichten (samt Inhalt), gleiche Größe (Inhalt bleibt), Rahmen + Karte links
 *      ausrichten; Rückgängig je Befehl ein Schritt.
 *   E  „An Inhalt anpassen": Rahmen umschließt seine Karten mit Innenabstand; Rückgängig.
 *   F  Auto-Größe: an → Karte hineinlegen, Rahmen wächst (ein Rückgängig-Schritt mit dem Zug); Karte am Griff größer
 *      → Rahmen wächst; aus → wächst nicht mehr.
 *   G  Hilfe nennt es, keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m542-rahmen-fangen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5542;
const BILDER = process.env.M542_BILDER;   // Ordner für Bildschirmfotos (optional)
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

const nz = (id, x, y, w = 200, h = 100, farbe = 'yellow', mehr = {}) => ({ id, type: 'note', width: w, height: h, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] }, ...mehr });
const fr = (id, x, y, w, h, mehr = {}) => ({ id, type: 'frame', width: w, height: h, position: { x, y }, data: { name: id }, ...mehr });
const stand = (nodes) => ({
  boards: [{ id: 'b1', name: 'Rahmen', comments: [], drawings: [], edges: [], nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});

async function seite(st, vorlieben = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript(({ st, v }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...v }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, v: vorlieben });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node');
  await P.waitForTimeout(1500);
  return { ctx, P };
}

/** Lage der Fläche: Bildschirm = links + tx + x·z */
const flaeche = (P) => P.evaluate(() => {
  const vp = document.querySelector('.react-flow__viewport');
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(vp.style.transform);
  const r = document.querySelector('.react-flow').getBoundingClientRect();
  return { l: r.left + Number(m[1]), o: r.top + Number(m[2]), z: Number(m[3]) };
});
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
/** Gespeicherten Stand lesen, sobald `fn(nodes)` gilt (der Speicher schreibt verzögert) */
async function standBis(P, fn, ms = 8000) {
  const ab = Date.now(); let n = await knoten(P);
  while (!fn(n) && Date.now() - ab < ms) { await P.waitForTimeout(150); n = await knoten(P); }
  return n;
}
const von = (nodes, id) => nodes.find((n) => n.id === id);
const kopf = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"] .frame-head`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const griff = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const ecke = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"] .react-flow__resize-control.handle.bottom.right`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const linien = (P) => P.evaluate(() => [...document.querySelectorAll('.fanglinie')].filter((l) => getComputedStyle(l).display !== 'none').map((l) => l.className));
const leer = (P) => P.mouse.click(1400, 860).then(() => P.waitForTimeout(200));
/** Abstand zweier Knoten auf dem Bildschirm in Board-Punkten */
const domVersatz = (P, a, b, z) => P.evaluate(({ a, b, z }) => {
  const ra = document.querySelector(`.react-flow__node[data-id="${a}"]`).getBoundingClientRect();
  const rb = document.querySelector(`.react-flow__node[data-id="${b}"]`).getBoundingClientRect();
  return { dx: (rb.left - ra.left) / z, dy: (rb.top - ra.top) / z };
}, { a, b, z });
async function rahmenMenue(P, id, umschalt = false) {
  const [x, y] = await kopf(P, id);
  if (umschalt) await P.keyboard.down('Shift');
  await P.mouse.click(x, y);
  if (umschalt) await P.keyboard.up('Shift');
  await P.waitForTimeout(250);
}
async function menueRahmen(P) {
  await P.waitForSelector('.sel-toolbar [data-taste="rahmen-menue"]');
  await P.click('.sel-toolbar [data-taste="rahmen-menue"]');
  await P.waitForSelector('.sel-frame-menu');
}
/** Board-Lage eines Knotens aus dem Bildschirm (im Zug; der Stand wird erst beim Ablegen geschrieben) */
const domLage = (P, id) => P.evaluate((id) => {
  const vp = document.querySelector('.react-flow__viewport');
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(vp.style.transform);
  const f = document.querySelector('.react-flow').getBoundingClientRect();
  const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect();
  const z = Number(m[3]);
  return { x: (r.left - f.left - Number(m[1])) / z, y: (r.top - f.top - Number(m[2])) / z };
}, id);
/**
 * Ziehen bis zu einer Board-Lage: erst anziehen (React Flow beginnt den Zug erst nach ein paar Punkten), dann die
 * Lage im Zug messen und den Rest gezielt fahren. `ctrl`: Strg erst NACH dem Greifen drücken (Strg + Klick wählt sonst ab).
 */
async function ziehe(P, [x, y], id, ziel, { ctrl = false, schritte = 6 } = {}) {
  const { z } = await flaeche(P);
  await P.mouse.move(x, y); await P.mouse.down();
  // zwei Anläufe: der erste startet den Zug (die Anzeige folgt erst mit der nächsten Bewegung)
  await P.mouse.move(x + 6, y + 6, { steps: 3 }); await P.waitForTimeout(80);
  await P.mouse.move(x + 12, y + 12, { steps: 2 }); await P.waitForTimeout(200);
  const a = await domLage(P, id);
  if (ctrl) await P.keyboard.down('Control');
  const zx = x + 12 + ((ziel.x ?? a.x) - a.x) * z; const zy = y + 12 + ((ziel.y ?? a.y) - a.y) * z;
  await P.mouse.move(zx, zy, { steps: schritte }); await P.waitForTimeout(250);
  return { zx, zy };
}
async function bild(P, name) { if (BILDER) await P.waitForTimeout(500); if (BILDER) await P.screenshot({ path: path.join(BILDER, name) }); }

/* ═══════════════════════ A: Rahmen ziehen fängt ═══════════════════════ */
console.log('\n════ A: Rahmen ziehen fängt, Inhalt geht exakt mit ════');
{
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 400, 300), nz('c', 60, 80), nz('n', 600, 37, 300, 400, 'sky')]));
  const { z } = await flaeche(P);
  // 2 Punkte neben der Oberkante der Nachbarkarte (y = 37), waagerecht bei x = 1 (nichts in Reichweite)
  await ziehe(P, await kopf(P, 'F'), 'F', { x: 1, y: 35 });
  const imZug = await linien(P);
  const versatzZug = await domVersatz(P, 'F', 'c', z);
  await bild(P, 'm542-fanglinie-rahmen.png');
  await P.mouse.up();
  const n = await standBis(P, (ns) => von(ns, 'F').position.y !== 0);
  const F = von(n, 'F').position; const c = von(n, 'c').position;
  pruefe('A1 im Zug zeigt eine waagerechte Fanglinie die Ausrichtung des Rahmens', imZug.some((k) => /\bh\b/.test(k)), imZug);
  pruefe('A2 abgelegt liegt die Oberkante des Rahmens EXAKT auf der Nachbarkarte (y = 37)', F.y === 37 && Math.abs(F.x - 1) < 0.6, F);
  pruefe('A3 der Inhalt bewegt sich um genau denselben Versatz (Abstand zum Rahmen bleibt 60/80)', Math.abs(c.x - F.x - 60) < 1e-6 && Math.abs(c.y - F.y - 80) < 1e-6, { F, c });
  pruefe('A4 auch im Zug kein Versatz zwischen Rahmen und Inhalt', Math.abs(versatzZug.dx - 60) < 0.6 && Math.abs(versatzZug.dy - 80) < 0.6, versatzZug);
  // Strg: frei ablegen
  await leer(P);
  await ziehe(P, await kopf(P, 'F'), 'F', { y: 40 }, { ctrl: true });
  const mitStrg = await linien(P);
  await P.mouse.up(); await P.keyboard.up('Control');
  const n2 = await standBis(P, (ns) => von(ns, 'F').position.y !== 37);
  const F2 = von(n2, 'F').position; const c2 = von(n2, 'c').position;
  pruefe('A5 mit Strg rastet der Rahmen nicht ein (bleibt 3 Punkte neben der Kante), Inhalt geht mit', mitStrg.length === 0 && Math.abs(F2.y - 40) < 0.6 && Math.abs(c2.y - F2.y - 80) < 1e-6, { mitStrg, F2, c2 });
  // Rückgängig: der ganze Zug samt Inhalt ist ein Schritt
  await P.keyboard.press('Control+z');
  const n3 = await standBis(P, (ns) => von(ns, 'F').position.y === 37);
  pruefe('A6 Strg+Z nimmt den Zug samt Inhalt in einem Schritt zurück', von(n3, 'F').position.y === 37 && Math.abs(von(n3, 'c').position.y - 117) < 1e-6 && Math.abs(von(n3, 'c').position.x - von(n3, 'F').position.x - 60) < 1e-6, [von(n3, 'F').position, von(n3, 'c').position]);
  await ctx.close();
}

/* ═══════════════════════ B: Raster ═══════════════════════ */
console.log('\n════ B: Raster-Fang auch für Rahmen ════');
{
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 400, 300), nz('c', 60, 80)]), { gridSnap: true });
  const { z } = await flaeche(P);
  const [x, y] = await kopf(P, 'F');
  await P.mouse.move(x, y); await P.mouse.down();
  await P.mouse.move(x + 20 * z, y + 13 * z, { steps: 4 }); await P.mouse.move(x + 47 * z, y + 33 * z, { steps: 6 }); await P.waitForTimeout(200);
  await P.mouse.up();
  const n = await standBis(P, (ns) => von(ns, 'F').position.x !== 0);
  const F = von(n, 'F').position; const c = von(n, 'c').position;
  pruefe('B1 der Rahmen liegt auf dem Raster (Vielfache von 20)', F.x % 20 === 0 && F.y % 20 === 0 && F.x > 0, F);
  pruefe('B2 der Inhalt behält seinen Abstand zum Rahmen', Math.abs(c.x - F.x - 60) < 1e-6 && Math.abs(c.y - F.y - 80) < 1e-6, { F, c });
  await ctx.close();
}

/* ═══════════════════════ C: Größe ändern fängt ═══════════════════════ */
console.log('\n════ C: Größe ändern rastet an Kanten ein ════');
{
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 400, 300), nz('c', 60, 80), nz('n', 600, 400, 300, 140, 'sky'), nz('m', 0, 520, 300, 100, 'green')]));
  const { z } = await flaeche(P);
  await rahmenMenue(P, 'F');
  const [x, y] = await ecke(P, 'F');
  await P.mouse.move(x, y); await P.mouse.down();
  // rechte Kante von 400 auf 596 (4 vor der linken Kante der Nachbarkarte bei 600), Unterkante bleibt
  await P.mouse.move(x + 50 * z, y, { steps: 3 }); await P.mouse.move(x + 196 * z, y, { steps: 8 }); await P.waitForTimeout(250);
  const imZug = await linien(P);
  await bild(P, 'm542-fanglinie-groesse.png');
  await P.mouse.up();
  const n = await standBis(P, (ns) => von(ns, 'F').width !== 400);
  const F = von(n, 'F');
  pruefe('C1 im Zug zeigt eine senkrechte Fanglinie an der Nachbarkarte', imZug.some((k) => /\bv\b/.test(k)), imZug);
  pruefe('C2 die rechte Kante liegt EXAKT auf der linken Kante der Nachbarkarte (Breite 600), Lage und Höhe bleiben', F.width === 600 && F.height === 300 && F.position.x === 0 && F.position.y === 0, { w: F.width, h: F.height, p: F.position });
  pruefe('C3 der Inhalt bleibt beim Ändern der Größe liegen', von(n, 'c').position.x === 60 && von(n, 'c').position.y === 80, von(n, 'c').position);
  await P.waitForTimeout(400);
  pruefe('C4 nach dem Loslassen sind die Linien weg und die gezeichnete Breite stimmt', (await linien(P)).length === 0
    && await P.evaluate((z) => Math.abs(document.querySelector('.react-flow__node[data-id="F"]').getBoundingClientRect().width / z - 600) < 1, z), await linien(P));
  // Notiz: rechte Kante an die rechte Kante des Rahmens (600)
  await leer(P);
  const [gx, gy] = await griff(P, 'm'); await P.mouse.click(gx, gy); await P.waitForTimeout(250);
  const [mx, my] = await ecke(P, 'm');
  await P.mouse.move(mx, my); await P.mouse.down();
  await P.mouse.move(mx + 100 * z, my, { steps: 4 }); await P.mouse.move(mx + 296 * z, my, { steps: 6 }); await P.waitForTimeout(200);
  await P.mouse.up();
  const n2 = await standBis(P, (ns) => von(ns, 'm').width !== 300);
  pruefe('C5 auch eine Notiz rastet beim Ändern der Größe ein (Breite 600)', von(n2, 'm').width === 600, von(n2, 'm').width);
  // Strg: frei
  await leer(P);
  await rahmenMenue(P, 'F');
  const [x3, y3] = await ecke(P, 'F');
  await P.mouse.move(x3, y3); await P.mouse.down();
  await P.mouse.move(x3 + 1, y3, { steps: 1 }); await P.keyboard.down('Control');
  await P.mouse.move(x3 + 2 * z, y3, { steps: 2 }); await P.mouse.move(x3 + 4 * z, y3, { steps: 2 }); await P.waitForTimeout(200);
  const mitStrg = await linien(P);
  await P.mouse.up(); await P.keyboard.up('Control');
  const n3 = await standBis(P, (ns) => von(ns, 'F').width !== 600);
  pruefe('C6 mit Strg rastet die Kante nicht ein', mitStrg.length === 0 && von(n3, 'F').width > 601 && von(n3, 'F').width < 610, { mitStrg, w: von(n3, 'F').width });
  await ctx.close();
}

/* ═══════════════════════ D: Anordnen ═══════════════════════ */
console.log('\n════ D: Ausrichten, gleiche Größe – Rahmen samt Inhalt ════');
{
  const { ctx, P } = await seite(stand([
    fr('F1', 0, 0, 400, 300), nz('c1', 60, 80),
    fr('F2', 600, 60, 300, 260), nz('c2', 650, 140),
    nz('k', 0, 500, 200, 100, 'sky'),
  ]));
  await rahmenMenue(P, 'F1');
  await rahmenMenue(P, 'F2', true);
  await menueRahmen(P);
  const knopf = await P.$('.sel-frame-menu [data-taste="rahmen-anordnen"]');
  pruefe('D1 zwei gewählte Rahmen: Rahmen-Menü bietet „Anordnen …"', !!knopf);
  await bild(P, 'm542-menue-rahmen.png');
  if (knopf) {
    await knopf.click();
    await P.waitForSelector('.anordnen-menu [data-anordnen="top"]');
    await bild(P, 'm542-menue-anordnen.png');
    await P.click('.anordnen-menu [data-anordnen="top"]');
    let n = await standBis(P, (ns) => von(ns, 'F2').position.y === 0);
    pruefe('D2 oben ausrichten: der zweite Rahmen steht oben bündig (y = 0), sein Inhalt geht mit (−60)', von(n, 'F2').position.y === 0 && von(n, 'c2').position.y === 80 && von(n, 'c2').position.x === 650 && von(n, 'F1').position.y === 0 && von(n, 'c1').position.y === 80,
      n.map((k) => [k.id, k.position]));
    await menueRahmen(P);
    await P.click('.sel-frame-menu [data-taste="rahmen-anordnen"]');
    await P.waitForSelector('.anordnen-menu [data-anordnen="size"]');
    await P.click('.anordnen-menu [data-anordnen="size"]');
    n = await standBis(P, (ns) => von(ns, 'F2').width === 400);
    pruefe('D3 gleiche Größe: beide Rahmen 400 × 300, der Inhalt bleibt liegen', von(n, 'F2').width === 400 && von(n, 'F2').height === 300 && von(n, 'F2').position.x === 600 && von(n, 'c2').position.x === 650 && von(n, 'c2').position.y === 80,
      { F2: [von(n, 'F2').width, von(n, 'F2').height, von(n, 'F2').position], c2: von(n, 'c2').position });
    await P.keyboard.press('Control+z');
    n = await standBis(P, (ns) => von(ns, 'F2').width === 300);
    pruefe('D4 Strg+Z nimmt „gleiche Größe" in einem Schritt zurück (Ausrichtung bleibt)', von(n, 'F2').width === 300 && von(n, 'F2').position.y === 0, [von(n, 'F2').width, von(n, 'F2').position]);
    await P.keyboard.press('Control+z');
    n = await standBis(P, (ns) => von(ns, 'F2').position.y === 60);
    pruefe('D5 noch einmal Strg+Z: Rahmen und Inhalt wieder an der alten Stelle', von(n, 'F2').position.y === 60 && von(n, 'c2').position.y === 140, [von(n, 'F2').position, von(n, 'c2').position]);
  }
  // Rahmen + Karte: links ausrichten über ⋯ → Anordnen
  await leer(P);
  await rahmenMenue(P, 'F2');
  const [kx, ky] = await griff(P, 'k');
  await P.keyboard.down('Shift'); await P.mouse.click(kx, ky); await P.keyboard.up('Shift'); await P.waitForTimeout(300);
  await P.click('.sel-toolbar [data-taste="auswahl-mehr"]');
  const auf = await P.$('[data-taste="anordnen-auf"]');
  pruefe('D6 Rahmen + Karte gewählt: ⋯ bietet „Anordnen …"', !!auf);
  if (auf) {
    await auf.click();
    await P.waitForSelector('.anordnen-menu [data-anordnen="left"]');
    await P.click('.anordnen-menu [data-anordnen="left"]');
    const n = await standBis(P, (ns) => von(ns, 'F2').position.x === 0);
    pruefe('D7 links ausrichten: Rahmen (samt Inhalt) und Karte bündig bei x = 0', von(n, 'F2').position.x === 0 && von(n, 'c2').position.x === 50 && von(n, 'k').position.x === 0, n.map((k) => [k.id, k.position]));
  }
  await ctx.close();
}

/* ═══════════════════════ E: An Inhalt anpassen ═══════════════════════ */
console.log('\n════ E: Größe an Inhalt anpassen ════');
{
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 700, 600), nz('c1', 100, 120), nz('c2', 320, 280, 220, 100)]));
  await rahmenMenue(P, 'F');
  await menueRahmen(P);
  const knopf = await P.$('.sel-frame-menu [data-taste="rahmen-anpassen"]');
  pruefe('E1 Rahmen-Menü bietet „An Inhalt anpassen"', !!knopf);
  if (knopf) {
    await knopf.click();
    const n = await standBis(P, (ns) => von(ns, 'F').width !== 700);
    const F = von(n, 'F');
    // Inhalt 100…540 × 120…380, Innenabstand 30 (oben 46 wie beim Anordnen im Rahmen)
    pruefe('E2 der Rahmen umschließt seine Karten mit Innenabstand (70, 74, 500 × 336)', F.position.x === 70 && F.position.y === 74 && F.width === 500 && F.height === 336, { p: F.position, w: F.width, h: F.height });
    pruefe('E3 die Karten bleiben liegen', von(n, 'c1').position.x === 100 && von(n, 'c2').position.y === 280, [von(n, 'c1').position, von(n, 'c2').position]);
    await P.keyboard.press('Control+z');
    const n2 = await standBis(P, (ns) => von(ns, 'F').width === 700);
    pruefe('E4 Strg+Z: wieder 700 × 600 an der alten Stelle', von(n2, 'F').width === 700 && von(n2, 'F').height === 600 && von(n2, 'F').position.x === 0, [von(n2, 'F').width, von(n2, 'F').position]);
  }
  await ctx.close();
}

/* ═══════════════════════ F: Auto-Größe ═══════════════════════ */
console.log('\n════ F: Auto-Größe – der Rahmen wächst mit ════');
{
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 400, 300), nz('c', 60, 80), nz('n3', 700, 420, 200, 100, 'sky')]));
  const { z } = await flaeche(P);
  await rahmenMenue(P, 'F');
  await menueRahmen(P);
  const knopf = await P.$('.sel-frame-menu [data-taste="rahmen-auto"]');
  pruefe('F1 Rahmen-Menü bietet „Auto-Größe"', !!knopf);
  if (knopf) {
    await knopf.click();
    let n = await standBis(P, (ns) => von(ns, 'F').data.autoGroesse === true);
    pruefe('F2 Auto-Größe ist am Rahmen gespeichert, die Größe bleibt (Inhalt passt schon)', von(n, 'F').data.autoGroesse === true && von(n, 'F').width === 400 && von(n, 'F').height === 300, [von(n, 'F').data, von(n, 'F').width]);
    await leer(P);
    // n3 so hineinlegen, dass ihre Mitte im Rahmen liegt (380, 200), sie aber rechts über den Rand ragt (Kante bei 480);
    // mit Strg, damit nichts einrastet
    await ziehe(P, await griff(P, 'n3'), 'n3', { x: 280, y: 150 }, { ctrl: true });
    await P.mouse.up(); await P.keyboard.up('Control');
    n = await standBis(P, (ns) => von(ns, 'F').width !== 400);
    const r3 = von(n, 'n3').position.x + 200;
    pruefe('F3 hineingelegt, über den Rand: der Rahmen wächst rechts bis Kante + 30', Math.abs(von(n, 'F').width - Math.ceil(r3 + 30)) <= 1 && von(n, 'F').position.x === 0 && von(n, 'F').height === 300, { w: von(n, 'F').width, n3: von(n, 'n3').position });
    await P.keyboard.press('Control+z');
    n = await standBis(P, (ns) => von(ns, 'F').width === 400);
    pruefe('F4 Strg+Z nimmt Zug und Wachsen in einem Schritt zurück', von(n, 'F').width === 400 && von(n, 'n3').position.x === 700, [von(n, 'F').width, von(n, 'n3').position]);
    // Karte im Rahmen am Griff größer machen → Rahmen wächst unten
    await leer(P);
    const [cx, cy] = await griff(P, 'c'); await P.mouse.click(cx, cy); await P.waitForTimeout(250);
    const [ex, ey] = await ecke(P, 'c');
    await P.mouse.move(ex, ey); await P.mouse.down();
    await P.mouse.move(ex, ey + 2, { steps: 1 }); await P.keyboard.down('Control');
    await P.mouse.move(ex, ey + 60 * z, { steps: 4 }); await P.mouse.move(ex, ey + 150 * z, { steps: 6 }); await P.waitForTimeout(200);
    await P.mouse.up(); await P.keyboard.up('Control');
    n = await standBis(P, (ns) => von(ns, 'F').height !== 300);
    const unten = von(n, 'c').position.y + von(n, 'c').height;
    pruefe('F5 Karte im Rahmen größer gezogen: der Rahmen wächst unten mit (Kante + 30)', Math.abs(von(n, 'F').height - Math.ceil(unten + 30)) <= 1 && von(n, 'F').width === 400, { h: von(n, 'F').height, unten });
    // aus → wächst nicht mehr
    await leer(P);
    await rahmenMenue(P, 'F');
    await menueRahmen(P);
    const aus = await P.$eval('.sel-frame-menu [data-taste="rahmen-auto"]', (b) => b.getAttribute('aria-pressed'));
    await P.click('.sel-frame-menu [data-taste="rahmen-auto"]');
    n = await standBis(P, (ns) => von(ns, 'F').data.autoGroesse === false);
    const hVor = von(n, 'F').height;
    await leer(P);
    await ziehe(P, await griff(P, 'n3'), 'n3', { x: 280, y: 150 }, { ctrl: true });
    await P.mouse.up(); await P.keyboard.up('Control');
    n = await standBis(P, (ns) => von(ns, 'n3').position.x !== 700);
    await P.waitForTimeout(1200); n = await knoten(P);
    pruefe('F6 Auto-Größe aus (Knopf zeigte „an"): hineingelegt wächst der Rahmen nicht mehr', aus === 'true' && von(n, 'F').width === 400 && von(n, 'F').height === hVor && von(n, 'n3').position.x < 400, { aus, w: von(n, 'F').width, n3: von(n, 'n3').position });
  }
  await ctx.close();
}

/* ═══════════════════════ G: Hilfe, keine Fehler ═══════════════════════ */
console.log('\n════ G: Hilfe, keine Seitenfehler ════');
{
  const quellen = ['HelpOverlay.tsx', 'HelpOverlayEn.tsx'].map((d) => readFileSync(path.join(__repo, 'src/components', d), 'utf8'));
  pruefe('G1 die Hilfe (deutsch und englisch) nennt Fangen und Auto-Größe der Rahmen', /M542/.test(quellen[0]) && /M542/.test(quellen[1]));
  pruefe('G2 Meilenstein-Datei liegt vor', existsSync(path.join(__repo, 'docs/meilensteine/M542-rahmen-fangen.md')));
  pruefe('G3 keine Seitenfehler', fehler.length === 0, fehler);
}

await browser.close();
app.close();
console.log(`\nM542: ${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
