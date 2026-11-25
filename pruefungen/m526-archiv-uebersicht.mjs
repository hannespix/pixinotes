/**
 * M526 — Archivierte Boards belegen in der Übersicht keinen Platz mehr.
 *
 * Fehlerbericht: „archivierte Boards besetzen Platzhalter in der Übersicht … das ist komisch".
 * Ursache: Das Raster der Hierarchie-Ansicht rechnete Spalten, Reihen und Plätze aus ALLEN Boards eines Projekts,
 * auch den archivierten, die gar keine Kachel bekommen. Dort blieb ein leerer Platz stehen, das Projekt war höher
 * als nötig, und ein Projekt mit nur archivierten Boards war eine leere Fläche ohne Hinweis.
 *
 *   A  Raster: Die sichtbaren Kacheln eines Projekts liegen lückenlos — egal ob das erste, ein mittleres oder das
 *      letzte Board archiviert ist; das Projekt ist nur so hoch, wie die sichtbaren Kacheln brauchen.
 *   B  Ein Projekt, dessen Boards alle archiviert sind, zeigt „Boards hierher ziehen" wie ein leeres Projekt.
 *   C  Archivieren über das Kachel-Menü schließt die Lücke sofort; „Archiv einblenden" zeigt das Board mit Marke an
 *      seinem alten Platz; „Zurückholen" bringt es dorthin zurück, ohne andere zu überlappen.
 *   D  Ziehen mit archivierten Boards dazwischen: Die Kachel landet genau an der Stelle, an der sie losgelassen
 *      wird, und das Raster bleibt lückenlos.
 *   E  Tastatur: Nur sichtbare Kacheln sind Fokus-Stopps, in Lesereihenfolge.
 *   F  Nach Neuladen, schmal (390 px) und dunkel: dasselbe lückenlose Raster.
 */
// Läuft aus dem Repository: `node pruefungen/m526-archiv-uebersicht.mjs` (gegen einen anderen Build: PN_DIST=…)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = process.env.PN_ABLAGE ?? path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5526;
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

const brd = (id, name, archived) => ({ id, name, archived, edges: [], drawings: [], nodes: [{ id: `${id}n`, type: 'note', position: { x: 0, y: 0 }, width: 200, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: name }] } }] });
// p1: alles sichtbar (Beta wird in C über das Menü archiviert) · p2: das ERSTE archiviert · p3: alle archiviert · p4: das LETZTE archiviert
const BOARDS = [
  brd('a', 'Alpha'), brd('b', 'Beta'), brd('c', 'Gamma'), brd('d', 'Delta'),
  brd('e', 'Epsilon', true), brd('f', 'Zeta'), brd('g', 'Eta'),
  brd('h', 'Theta', true),
  brd('i', 'Iota'), brd('j', 'Kappa'), brd('k', 'Lambda', true),
];
const SPACES = [{ id: 's1', name: 'Arbeit', projects: [
  { id: 'p1', name: 'Eins', boardIds: ['a', 'b', 'c', 'd'] },
  { id: 'p2', name: 'Zwei', boardIds: ['e', 'f', 'g'] },
  { id: 'p3', name: 'Drei', boardIds: ['h'] },
  { id: 'p4', name: 'Vier', boardIds: ['i', 'j', 'k'] },
] }];

async function seite({ breite = 1440, hoehe = 900, dunkel = false } = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: breite, height: hoehe }, colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([bs, sp, dk]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: bs, spaces: sp, activeId: 'a', view: 'overview', overviewMode: 'hierarchie', ...(dk ? { theme: 'dark' } : {}) } }));
  }, [BOARDS, SPACES, dunkel]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.ov-canvas .react-flow__node-ovBoard', { timeout: 20000 });
  const mode = P.locator('.ov-mode button', { hasText: 'Hierarchie' });
  if (await mode.count() && !(await mode.evaluate((b) => b.classList.contains('on')))) await mode.click();
  await ruhig(P);
  return { ctx, P };
}
/** Warten, bis die Kacheln stillstehen (sie gleiten per CSS-Übergang) */
async function ruhig(P) {
  let vorher = '';
  for (let i = 0; i < 40; i += 1) {
    await P.waitForTimeout(150);
    const jetzt = JSON.stringify(await lage(P));
    if (jetzt === vorher) return;
    vorher = jetzt;
  }
}
/** Lage aller Kacheln und Projekte auf dem Bildschirm, relativ zur linken oberen Ecke ihres Projekts */
const lage = (P) => P.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
  const projekte = {};
  for (const n of document.querySelectorAll('.ov-canvas .react-flow__node-ovProject')) {
    projekte[n.dataset.id.slice(2)] = { ...r(n), leer: !!n.querySelector('.ov-empty') };
  }
  const kacheln = {};
  for (const n of document.querySelectorAll('.ov-canvas .react-flow__node-ovBoard')) {
    const name = n.querySelector('.ov-board-name, .ovc-tile-name, [class*="name"]')?.textContent?.trim() ?? n.textContent.trim();
    kacheln[n.dataset.id.slice(2)] = { ...r(n), name, archiv: !!n.querySelector('.archiv-marke') };
  }
  return { projekte, kacheln };
});
/** Spalte/Reihe einer Kachel im Raster ihres Projekts (aus Bildschirmmaßen, zoomunabhängig) */
function platz(L, id, pid) {
  const k = L.kacheln[id]; const p = L.projekte[pid];
  const luft = 16 * (k.w / 200);           // GAP im Verhältnis zur Kachelbreite
  const kopf = 44 * (k.w / 200);           // PROJ_HEAD
  return { s: Math.round((k.x - p.x - luft) / (k.w + luft)), r: Math.round((k.y - p.y - kopf) / (k.h + luft)) };
}
const plaetze = (L, ids, pid) => ids.map((id) => (L.kacheln[id] ? platz(L, id, pid) : null));
const lueckenlos = (L, ids, pid, spalten) => {
  const ps = plaetze(L, ids, pid);
  return ps.every((p, i) => p && p.s === i % spalten && p.r === Math.floor(i / spalten));
};
/** Höhe eines Projekts in Kachel-Reihen */
const reihen = (L, pid) => { const p = L.projekte[pid]; const k = Object.values(L.kacheln)[0]; const f = k.w / 200; return Math.round((p.h / f - 44 - 16) / (150 + 16)); };
const kachel = (P, name) => P.locator('.ov-canvas .react-flow__node-ovBoard', { hasText: name }).first();
async function kachelMenue(P, name, eintrag) {
  const k = kachel(P, name);
  await k.hover();
  await k.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForSelector('.ebenen-menu button', { timeout: 5000 });
  await P.locator('.ebenen-menu button', { hasText: eintrag }).first().click();
}
const reihe = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.spaces[0].projects.map((p) => p.boardIds.join('')));
const archiviert = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.filter((b) => b.archived).map((b) => b.id).join(''));

const { ctx, P } = await seite();

console.log('A  Raster ohne Lücken');
{
  const L = await lage(P);
  pruefe('A0 archivierte Boards haben keine Kachel', !L.kacheln.e && !L.kacheln.h && !L.kacheln.k && Object.keys(L.kacheln).length === 8, Object.keys(L.kacheln));
  pruefe('A1 erstes Board archiviert: Zeta und Eta beginnen in der ersten Spalte', lueckenlos(L, ['f', 'g'], 'p2', 3), plaetze(L, ['f', 'g'], 'p2'));
  pruefe('A2 letztes Board archiviert: Iota und Kappa lückenlos', lueckenlos(L, ['i', 'j'], 'p4', 3), plaetze(L, ['i', 'j'], 'p4'));
  pruefe('A3 Projekt „Zwei" (2 sichtbar) ist eine Reihe hoch und nur zwei Kacheln breit',
    reihen(L, 'p2') === 1 && Math.abs(L.projekte.p2.w - L.projekte.p4.w) < 2 && L.projekte.p2.w < L.projekte.p1.w - 50,
    { reihen: reihen(L, 'p2'), w2: L.projekte.p2.w, w4: L.projekte.p4.w, w1: L.projekte.p1.w });
  pruefe('A4 Projekt „Vier" (2 sichtbar, 1 archiviert) ist nicht breiter als für zwei Kacheln nötig', L.projekte.p4.w < L.projekte.p1.w - 50, { w4: L.projekte.p4.w, w1: L.projekte.p1.w });
  await P.screenshot({ path: path.join(SD, 'm526-uebersicht.png') });

  console.log('B  Projekt mit nur archivierten Boards');
  pruefe('B1 „Drei" (alles archiviert) zeigt „Boards hierher ziehen"', L.projekte.p3.leer === true, L.projekte.p3);
}

console.log('C  Archivieren, einblenden, zurückholen');
{
  const L0 = await lage(P);
  const gammaVorher = platz(L0, 'c', 'p1');
  await kachelMenue(P, 'Beta', 'Archivieren');
  await P.waitForFunction(() => ![...document.querySelectorAll('.ov-canvas .react-flow__node-ovBoard')].some((n) => n.textContent.includes('Beta')), null, { timeout: 10000 });
  await ruhig(P);
  const L = await lage(P);
  pruefe('C1 Beta (Mitte) archiviert: Alpha, Gamma, Delta stehen lückenlos in einer Reihe', lueckenlos(L, ['a', 'c', 'd'], 'p1', 3), plaetze(L, ['a', 'c', 'd'], 'p1'));
  pruefe('C2 Gamma rückt auf den frei gewordenen Platz', gammaVorher.s === 2 && platz(L, 'c', 'p1').s === 1, { vorher: gammaVorher, nachher: platz(L, 'c', 'p1') });
  pruefe('C3 „Eins" schrumpft auf eine Reihe', reihen(L, 'p1') === 1 && reihen(L0, 'p1') === 2, { vorher: reihen(L0, 'p1'), nachher: reihen(L, 'p1') });
  await P.screenshot({ path: path.join(SD, 'm526-nach-archivieren.png') });

  // Archiv einblenden: Beta erscheint mit Marke an seinem alten Platz
  await P.keyboard.press('Alt+Shift+A');
  await P.waitForFunction(() => [...document.querySelectorAll('.ov-canvas .react-flow__node-ovBoard')].some((n) => n.textContent.includes('Beta')), null, { timeout: 10000 });
  await ruhig(P);
  const L2 = await lage(P);
  pruefe('C4 mit eingeblendetem Archiv steht Beta mit Marke an seinem alten Platz (zweite Spalte)',
    L2.kacheln.b?.archiv === true && platz(L2, 'b', 'p1').s === 1 && platz(L2, 'b', 'p1').r === 0 && lueckenlos(L2, ['a', 'b', 'c', 'd'], 'p1', 3),
    { b: L2.kacheln.b, plaetze: plaetze(L2, ['a', 'b', 'c', 'd'], 'p1') });
  pruefe('C5 auch Epsilon und Theta erscheinen mit Marke', L2.kacheln.e?.archiv === true && L2.kacheln.h?.archiv === true && L2.projekte.p3.leer === false);
  await kachelMenue(P, 'Beta', 'Zurückholen');
  await P.waitForFunction(() => !JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((b) => b.id === 'b').archived, null, { timeout: 10000 });
  await P.keyboard.press('Alt+Shift+A');
  await P.waitForFunction(() => ![...document.querySelectorAll('.ov-canvas .react-flow__node-ovBoard')].some((n) => n.textContent.includes('Epsilon')), null, { timeout: 10000 });
  await ruhig(P);
  const L3 = await lage(P);
  const ueberlappt = Object.values(L3.kacheln).some((k, i, alle) => alle.some((m, j) => j > i && Math.abs(k.x - m.x) < k.w - 2 && Math.abs(k.y - m.y) < k.h - 2));
  pruefe('C6 zurückgeholt: Beta wieder an zweiter Stelle, alle vier lückenlos, nichts überlappt',
    lueckenlos(L3, ['a', 'b', 'c', 'd'], 'p1', 3) && !ueberlappt, { plaetze: plaetze(L3, ['a', 'b', 'c', 'd'], 'p1'), ueberlappt });
  pruefe('C7 die gespeicherte Reihenfolge ist unverändert', (await reihe(P))[0] === 'abcd', await reihe(P));
}

console.log('D  Ziehen mit archivierten Boards dazwischen');
{
  // Beta wieder archivieren, dann Eta (aus „Zwei") zwischen Alpha und Gamma ablegen
  await kachelMenue(P, 'Beta', 'Archivieren');
  await P.waitForFunction(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((b) => b.id === 'b').archived === true, null, { timeout: 10000 });
  await ruhig(P);
  const L = await lage(P);
  const eta = L.kacheln.g; const gamma = L.kacheln.c;
  // Gegriffen wird an einer ziehbaren Stelle der Kachel (Name und Mini-Vorschau sind „nodrag")
  const griff = await P.evaluate(({ x, y, w, h }) => {
    for (let f = 0.05; f < 0.95; f += 0.03) {
      const e = document.elementFromPoint(x + w * 0.15, y + h * f);
      if (e && e.closest('.react-flow__node-ovBoard') && !e.closest('.nodrag')) return f;
    }
    return 0.25;
  }, eta);
  const greif = { x: eta.x + eta.w * 0.15, y: eta.y + eta.h * griff };
  const ziel = { x: gamma.x + gamma.w * 0.05, y: gamma.y + gamma.h * griff };
  await P.mouse.move(greif.x, greif.y); await P.mouse.down();
  await P.mouse.move(greif.x + 10, greif.y + 4, { steps: 3 });
  for (let i = 1; i <= 16; i += 1) { await P.mouse.move(greif.x + ((ziel.x - greif.x) * i) / 16, greif.y + ((ziel.y - greif.y) * i) / 16); await P.waitForTimeout(16); }
  await P.waitForTimeout(500);
  // Während des Zugs: Vorschau lückenlos — Alpha, [Eta], Gamma, Delta
  const Lz = await lage(P);
  pruefe('D1 während des Zugs weicht Gamma auf die dritte Spalte, Delta in die zweite Reihe (kein freier Platz)',
    platz(Lz, 'c', 'p1').s === 2 && platz(Lz, 'd', 'p1').s === 0 && platz(Lz, 'd', 'p1').r === 1,
    plaetze(Lz, ['a', 'c', 'd'], 'p1'));
  await P.mouse.up();
  await P.waitForFunction(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.spaces[0].projects[0].boardIds.includes('g'), null, { timeout: 10000 }).catch(() => {});
  await ruhig(P);
  const L2 = await lage(P);
  pruefe('D2 Eta landet zwischen Alpha und Gamma, das Raster bleibt lückenlos', lueckenlos(L2, ['a', 'g', 'c', 'd'], 'p1', 3), plaetze(L2, ['a', 'g', 'c', 'd'], 'p1'));
  const r = await reihe(P);
  pruefe('D3 gespeichert: Eta vor Gamma, das archivierte Beta bleibt in der Liste', r[0] === 'abgcd' || r[0] === 'agbcd', r);
  pruefe('D4 „Zwei" hat jetzt nur noch Zeta (lückenlos, erste Spalte)', lueckenlos(L2, ['f'], 'p2', 3), plaetze(L2, ['f'], 'p2'));
}

console.log('E  Tastatur');
{
  const reihenfolge = await P.evaluate(() => [...document.querySelectorAll('.ov-canvas .react-flow__node-ovBoard')]
    .filter((n) => n.tabIndex >= 0).map((n) => n.dataset.id.slice(2)).join(''));
  pruefe('E1 Fokus-Stopps nur auf sichtbaren Kacheln, keines auf einem archivierten Board',
    !/[bekh]/.test(reihenfolge) && reihenfolge.length === 7, reihenfolge);
}

console.log('F  Neuladen, schmal, dunkel');
{
  await P.waitForTimeout(800);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector('.ov-canvas .react-flow__node-ovBoard', { timeout: 20000 });
  await ruhig(P);
  const L = await lage(P);
  pruefe('F1 nach dem Neuladen bleibt das Raster lückenlos', lueckenlos(L, ['a', 'g', 'c', 'd'], 'p1', 3) && lueckenlos(L, ['i', 'j'], 'p4', 3), plaetze(L, ['a', 'g', 'c', 'd'], 'p1'));
  pruefe('F2 archiviert sind weiterhin Beta, Epsilon, Theta, Lambda', (await archiviert(P)) === 'behk', await archiviert(P));
  await ctx.close();
}
{
  const { ctx: c2, P: P2 } = await seite({ breite: 390, hoehe: 844, dunkel: true });
  const L = await lage(P2);
  pruefe('F3 schmal (zwei Spalten): Zeta und Eta lückenlos, Iota und Kappa lückenlos', lueckenlos(L, ['f', 'g'], 'p2', 2) && lueckenlos(L, ['i', 'j'], 'p4', 2), { p2: plaetze(L, ['f', 'g'], 'p2'), p4: plaetze(L, ['i', 'j'], 'p4') });
  pruefe('F4 schmal: „Zwei" ist eine Reihe hoch, „Drei" zeigt den Leer-Hinweis', reihen(L, 'p2') === 1 && L.projekte.p3.leer === true, { r: reihen(L, 'p2'), p3: L.projekte.p3 });
  await P2.screenshot({ path: path.join(SD, 'm526-telefon-dunkel.png') });
  await c2.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM526: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
