/**
 * M481 — Karten ziehen wie die Boards in der Übersicht (M440).
 *
 * Gewünscht: „Die Animation und Art und Weise der Drag-and-Drop-Geschichte der Boards in der Übersicht ist super!
 * Kannst du diese super Animation auch auf alle Module etc im Board anwenden?!"
 *
 *   A  Heben: Die gegriffene Karte wird etwas größer und folgt der Maus; schnell gezogen neigt sie sich in
 *      Zugrichtung, im Stillstand schwingt die Neigung aus.
 *   B  Ausweichen: Ein Nachbar unter der Karte gleitet beiseite (nur Anzeige, nicht in den Stand) und kehrt
 *      gleitend zurück, wenn die Karte weiterzieht.
 *   C  Ablegen auf dem Nachbarn: Er bleibt ausgewichen (ohne Ruck), EIN Strg+Z nimmt Zug und Ausweichen zurück.
 *   D  Haften: Greift eine Fanglinie, liegt die Karte flach und gerade (Kante = Linie).
 *   E  Landen: Beim Loslassen senkt sie sich über mehrere Bilder, ohne Sprung, und endet exakt am Ziel.
 *   F  Weniger Bewegung: ohne Heben, Neigen und Feder.   G  Schalter „Bewegung beim Ziehen" aus = ruhig.
 *   H  Finger: Ziehen per Touch hebt und legt ab.   I  Flüssig mit 200 Karten.   J  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m481-karten-ziehen.mjs`
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
const PORT = 5481;
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
const STAND = () => ({
  boards: [{ id: 'b1', name: 'Ziehen', comments: [], edges: [], drawings: [], nodes: [
    nz('a', 0, 0), nz('b', 360, 0, 'sky'), nz('c', 0, 420, 'green'),
  ] }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});
const VIELE = () => {
  const nodes = [];
  for (let i = 0; i < 200; i += 1) nodes.push(nz(`k${i}`, (i % 20) * 230, Math.floor(i / 20) * 150, i % 3 ? 'yellow' : 'sky'));
  return { boards: [{ id: 'b1', name: 'Viele', comments: [], edges: [], drawings: [], nodes }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board' };
};

async function seite(st, opt = {}, vorlieben = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', ...opt });
  await ctx.addInitScript(({ st, v }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...v }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, v: vorlieben });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const zoomVon = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const rahmen = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, id);
const gespeichert = async (P, id, warte = 1300) => { await P.waitForTimeout(warte); return P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id).position, id); };
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`) ?? document.querySelector(`.react-flow__node[data-id="${id}"]`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 12)]; }, id);
const drehung = (P, id) => P.evaluate((id) => { const s = getComputedStyle(document.querySelector(`.react-flow__node[data-id="${id}"]`)).rotate; return s === 'none' ? 0 : parseFloat(s); }, id);
const leer = (P) => P.mouse.click(1420, 880).then(() => P.waitForTimeout(200));
/** Spur eines Elements über n Bilder (Rahmen je Bild) */
const spur = (P, id, n = 40) => P.evaluate(async ([id, n]) => {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  const out = [];
  for (let i = 0; i < n; i += 1) { await new Promise((r) => requestAnimationFrame(r)); const r = el.getBoundingClientRect(); out.push([r.left, r.top, r.width, r.height]); }
  return out;
}, [id, n]);

/* ═══════════════════════ Normale Seite ═══════════════════════ */
{
  const { ctx, P } = await seite(STAND());
  const z = await zoomVon(P);
  console.log(`  (Zoom ${z})`);
  const a0 = await rahmen(P, 'a'); const b0 = await rahmen(P, 'b');
  const aPos0 = await gespeichert(P, 'a', 0); const bPos0 = await gespeichert(P, 'b', 0);

  console.log('\n════ A: Heben und Neigen ════');
  await leer(P);
  let g = await griff(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 1, { steps: 2 }); await P.mouse.move(g[0] + 8, g[1] + 2, { steps: 2 });
  // weg von allen Fanglinien (dort läge sie flach, siehe D)
  await P.mouse.move(g[0] + 40 * z, g[1] + 150 * z, { steps: 4 }); await P.waitForTimeout(260);
  const a1 = await rahmen(P, 'a');
  pruefe('A1 die gegriffene Karte hebt sich (größer)', a1.w > a0.w * 1.02 && a1.w < a0.w * 1.08, { vorher: a0.w, jetzt: a1.w });
  pruefe('A2 … und trägt den tieferen Schatten', await P.evaluate(() => /-12px/.test(getComputedStyle(document.querySelector('.react-flow__node[data-id="a"]')).boxShadow)));
  // schnell nach unten rechts ziehen (weg von allen Fanglinien) — Neigung in Zugrichtung
  const winkel = [];
  for (let i = 1; i <= 12; i += 1) { await P.mouse.move(g[0] + 40 * z + i * 22, g[1] + 150 * z + 50 * z + i * 4); await P.waitForTimeout(16); if (i > 2) winkel.push(await drehung(P, 'a')); }
  const maxW = Math.max(...winkel);
  pruefe('A3 schnell nach rechts gezogen neigt sie sich in Zugrichtung (gedeckelt)', maxW > 1 && maxW <= 7.01, winkel.map((w) => w.toFixed(1)).join(' '));
  const a2 = await rahmen(P, 'a');
  const gNeu = [g[0] + 40 * z + 12 * 22, g[1] + 200 * z + 48];
  pruefe('A4 sie haftet an der Maus (Mitte folgt dem Zeiger)', Math.abs((a2.cx - a1.cx) - (gNeu[0] - g[0] - 40 * z)) < 12 && Math.abs((a2.cy - a1.cy) - (gNeu[1] - g[1] - 150 * z)) < 12, { a1, a2 });
  await P.waitForTimeout(700);
  pruefe('A5 im Stillstand schwingt die Neigung aus', Math.abs(await drehung(P, 'a')) < 0.3, await drehung(P, 'a'));

  console.log('\n════ B: Nachbar weicht aus und kehrt zurück ════');
  // über B ziehen: A's Mitte auf B's linke Hälfte
  const ueberB = [b0.x + b0.w * 0.3 + (g[0] - a0.cx), b0.cy + 30 * z + (g[1] - a0.cy)];
  await P.mouse.move(ueberB[0], ueberB[1], { steps: 10 }); await P.waitForTimeout(700);
  const b1 = await rahmen(P, 'b');
  const wegB = Math.hypot(b1.x - b0.x, b1.y - b0.y);
  pruefe('B1 der Nachbar unter der Karte ist beiseite geglitten', wegB > 40 * z, { b0: [b0.x, b0.y], b1: [b1.x, b1.y] });
  const bLaden = await gespeichert(P, 'b', 1400);
  pruefe('B2 … nur als Anzeige: im Stand (und damit im Live-Team) liegt er noch an seinem Platz', bLaden.x === bPos0.x && bLaden.y === bPos0.y, bLaden);
  await P.screenshot({ path: path.join(SD, 'm481-ausweichen.png') });
  // weiterziehen — B kehrt gleitend zurück
  await P.mouse.move(ueberB[0], ueberB[1] + 330 * z, { steps: 6 });
  const bSpur = await spur(P, 'b', 36);
  const bEnde = await rahmen(P, 'b');
  const stufen = new Set(bSpur.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`)).size;
  pruefe('B3 zieht die Karte weiter, kehrt der Nachbar zurück', Math.abs(bEnde.x - b0.x) < 1 && Math.abs(bEnde.y - b0.y) < 1, { b0, bEnde });
  pruefe('B4 … gleitend über mehrere Bilder', stufen >= 6, stufen);

  console.log('\n════ C: Ablegen auf dem Nachbarn – ein Schritt ════');
  await P.mouse.move(ueberB[0], ueberB[1], { steps: 8 }); await P.waitForTimeout(650);
  const bVorLos = await rahmen(P, 'b');
  await P.mouse.up();
  const bNach = await spur(P, 'b', 20);
  const sprung = Math.max(...bNach.map((p) => Math.hypot(p[0] - bVorLos.x, p[1] - bVorLos.y)));
  pruefe('C1 der ausgewichene Nachbar bleibt beim Loslassen stehen (kein Ruck)', sprung < 2, sprung);
  const aGel = await gespeichert(P, 'a'); const bGel = await gespeichert(P, 'b', 0);
  pruefe('C2 … und steht jetzt auch im Stand dort', Math.hypot(bGel.x - bPos0.x, bGel.y - bPos0.y) > 40, bGel);
  const bR = await rahmen(P, 'b');
  pruefe('C3 Anzeige und Stand stimmen überein (kein Rest-Versatz)', Math.abs(bR.x - bVorLos.x) < 1.5 && Math.abs(bR.y - bVorLos.y) < 1.5, { bR, bVorLos });
  await leer(P);
  await P.keyboard.press('Control+z');
  const aU = await gespeichert(P, 'a'); const bU = await gespeichert(P, 'b', 0);
  pruefe('C4 EIN Strg+Z nimmt Zug und Ausweichen zurück', aU.x === aPos0.x && aU.y === aPos0.y && bU.x === bPos0.x && bU.y === bPos0.y, { aGel, aU, bU });

  console.log('\n════ D: Haften an der Fanglinie ════');
  await leer(P);
  const c0 = await rahmen(P, 'c');
  g = await griff(P, 'a');
  const aJetzt = await rahmen(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 4, { steps: 2 });  // anlaufen: React Flow verschluckt den ersten Schritt über der Schwelle
  await P.mouse.move(g[0], g[1], { steps: 2 });
  // nach rechts unten, dann so, dass A's linke Kante 3 Punkte neben C's linker Kante liegt (Fang 6 px)
  await P.mouse.move(g[0] + 300, g[1] + 200 * z, { steps: 6 });
  const zielX = g[0] + (c0.x - aJetzt.x) + 3 * z;
  await P.mouse.move(zielX, g[1] + 200 * z, { steps: 8 }); await P.waitForTimeout(400);
  const linie = await P.evaluate(() => document.querySelectorAll('.fanglinie').length);
  const aF = await rahmen(P, 'a');
  pruefe('D1 die Fanglinie greift', linie > 0, linie);
  pruefe('D2 eingerastet liegt die Karte flach und gerade – ihre Kante steht auf der Linie', Math.abs(aF.w - a0.w) < 1 && Math.abs(await drehung(P, 'a')) < 0.05 && Math.abs(aF.x - c0.x) < 1, { aF: aF.x, c: c0.x, w: aF.w });
  await P.mouse.up();
  const aD = await gespeichert(P, 'a');
  pruefe('D3 abgelegt genau an der Linie', aD.x === 0, aD);

  console.log('\n════ E: Landen ════');
  await leer(P);
  g = await griff(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 4, { steps: 2 });
  await P.mouse.move(g[0] + 520, g[1] + 330, { steps: 14 }); await P.waitForTimeout(80);
  await P.mouse.move(g[0] + 560, g[1] + 340, { steps: 3 });
  const vorLos = await rahmen(P, 'a');
  await P.mouse.up();
  const sp = await spur(P, 'a', 40);
  await P.waitForTimeout(400);
  const aEnde = await rahmen(P, 'a');
  const aE = await gespeichert(P, 'a');
  const breiten = sp.map((p) => p[2]);
  const schritte = sp.slice(1).map((p, i) => Math.hypot(p[0] + p[2] / 2 - (sp[i][0] + sp[i][2] / 2), p[1] + p[3] / 2 - (sp[i][1] + sp[i][3] / 2)));
  const stufenE = new Set(breiten.map((w) => w.toFixed(1))).size;
  pruefe('E1 vor dem Loslassen gehoben', vorLos.w > a0.w * 1.02, vorLos.w);
  pruefe('E2 sie senkt sich über mehrere Bilder (federnd)', stufenE >= 5, { stufenE, breiten: breiten.slice(0, 10).map((w) => w.toFixed(1)) });
  pruefe('E3 kein Sprung: die Mitte steht still', Math.max(...schritte) < 2, Math.max(...schritte));
  pruefe('E4 sie endet exakt am Ziel (Größe wie vorher, Lage = gespeicherte Lage)', Math.abs(aEnde.w - a0.w) < 0.5
    && Math.abs(aEnde.x - (a0.x + (aE.x - aPos0.x) * z)) < 1 && Math.abs(aEnde.y - (a0.y + (aE.y - aPos0.y) * z)) < 1, { aEnde, aE });
  pruefe('E5 nach dem Landen ist die Karte ganz gerade', Math.abs(await drehung(P, 'a')) < 0.01);

  console.log('\n════ G: Schalter „Bewegung beim Ziehen" ════');
  await P.locator('[data-taste="einstellungen"]').click();
  await P.locator('.modal-tabs button', { hasText: 'Darstellung' }).click();
  await P.waitForTimeout(300);
  const schalter = P.locator('[data-taste="zieh-bewegung"]');
  pruefe('G1 der Schalter steht unter Darstellung → Bedienung und ist an', (await schalter.count()) === 1 && await schalter.isChecked());
  pruefe('G2 keine eigenen Schalter mehr für Physik oder Werfen', (await P.locator('.modal-row-check', { hasText: /Physik|Werfen|Wurf/ }).count()) === 0);
  await schalter.uncheck(); await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await leer(P);
  g = await griff(P, 'a');
  const aR = await rahmen(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  for (let i = 1; i <= 8; i += 1) { await P.mouse.move(g[0] + i * 25, g[1] + i * 5); await P.waitForTimeout(16); }
  const aAus = await rahmen(P, 'a');
  pruefe('G3 aus: die Karte folgt ohne Heben und Neigen', Math.abs(aAus.w - aR.w) < 0.5 && Math.abs(await drehung(P, 'a')) < 0.01, { w: aAus.w, vorher: aR.w });
  await P.mouse.up(); await P.waitForTimeout(300);
  await P.keyboard.press('Alt+o'); await P.waitForTimeout(300);
  pruefe('G4 Alt+O schaltet die Bewegung wieder ein', await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen')).ziehBewegung === true));
  await ctx.close();
}

/* ═══════════════════════ Weniger Bewegung ═══════════════════════ */
console.log('\n════ F: Weniger Bewegung ════');
{
  const { ctx, P } = await seite(STAND(), { reducedMotion: 'reduce' });
  const a0 = await rahmen(P, 'a');
  await leer(P);
  const g = await griff(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  const winkel = [];
  for (let i = 1; i <= 10; i += 1) { await P.mouse.move(g[0] + i * 30, g[1] + i * 10); await P.waitForTimeout(16); winkel.push(await drehung(P, 'a')); }
  const aZ = await rahmen(P, 'a');
  pruefe('F1 kein Heben, keine Neigung', Math.abs(aZ.w - a0.w) < 0.5 && winkel.every((w) => Math.abs(w) < 0.01), { w: aZ.w, winkel });
  await P.mouse.up();
  const sp = await spur(P, 'a', 20);
  pruefe('F2 keine Feder beim Loslassen (Größe bleibt)', sp.every((p) => Math.abs(p[2] - a0.w) < 0.5));
  await ctx.close();
}

/* ═══════════════════════ Finger ═══════════════════════ */
console.log('\n════ H: Finger ════');
{
  const { ctx, P } = await seite(STAND(), { hasTouch: true, isMobile: false });
  const cdp = await ctx.newCDPSession(P);
  const a0 = await rahmen(P, 'a');
  const p0 = await gespeichert(P, 'a', 0);
  const z = await zoomVon(P);
  const g = await griff(P, 'a');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g[0], y: g[1], id: 1 }] });
  await P.waitForTimeout(80);
  const breiten = [];
  for (let i = 1; i <= 14; i += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g[0] + i * 12, y: g[1] + i * 18, id: 1 }] }); await P.waitForTimeout(20); breiten.push((await rahmen(P, 'a')).w); }
  pruefe('H1 mit dem Finger gezogen hebt sich die Karte', Math.max(...breiten.slice(4)) > a0.w * 1.02, { vorher: a0.w, breiten });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await P.waitForTimeout(700);
  const aE = await rahmen(P, 'a'); const pE = await gespeichert(P, 'a');
  pruefe('H2 … und landet flach an der Stelle unter dem Finger', Math.abs(aE.w - a0.w) < 0.5 && Math.abs((pE.x - p0.x) * z - 168) < 20 && Math.abs((pE.y - p0.y) * z - 252) < 24, { pE, z });
  await ctx.close();
}

/* ═══════════════════════ Leistung ═══════════════════════ */
console.log('\n════ I: 200 Karten ════');
{
  const { ctx, P } = await seite(VIELE());
  const n = await P.evaluate(() => document.querySelectorAll('.react-flow__node').length);
  const r42 = await rahmen(P, 'k42');
  const g = [r42.cx, r42.cy];   // weiter Zoom: die ganze Karte ist der Griff (M343)
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 3, g[1] + 3, { steps: 2 }); await P.mouse.move(g[0] + 6, g[1] + 6, { steps: 2 });
  console.log(`  (Zoom ${await zoomVon(P)}, gehoben: ${await P.evaluate(() => document.querySelectorAll('[data-gehoben]').length)})`);
  const takt = P.evaluate(() => new Promise((res) => { const z = []; let l = performance.now(); let k = 0; const f = (t) => { z.push(t - l); l = t; if (++k < 90) requestAnimationFrame(f); else res(z); }; requestAnimationFrame(f); }));
  for (let i = 1; i <= 50; i += 1) { await P.mouse.move(g[0] + i * 14, g[1] + Math.sin(i / 4) * 120); await P.waitForTimeout(16); }
  const zt = (await takt).slice(3).sort((x, y) => x - y);
  const ausgewichen = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].filter((e) => e.style.translate && e.style.translate !== 'none').length);
  await P.mouse.up(); await P.waitForTimeout(500);
  const median = zt[Math.floor(zt.length / 2)];
  pruefe(`I1 ${n} Karten auf dem Board, beim Ziehen weichen Nachbarn aus`, n >= 200 && ausgewichen >= 1, { n, ausgewichen });
  pruefe('I2 der Takt hält (Median ≤ 18 ms je Bild, also ~60 fps)', median <= 18, { median, p90: zt[Math.floor(zt.length * 0.9)] });
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
console.log('\n════ J: Texte ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  const en = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  pruefe('J1 Hilfe deutsch und englisch nennen M481', /M481/.test(hilfe) && /M481/.test(hilfeEn));
  pruefe('J2 der Schalter ist übersetzt', typeof en['Bewegung beim Ziehen'] === 'string');
  pruefe('J3 Meilenstein-Datei liegt vor', existsSync(path.join(__repo, 'docs/meilensteine/M481-karten-ziehen.md')));
  pruefe('J4 eine gemeinsame Bewegungs-Datei für Übersicht und Board', /ziehGefuehl/.test(readFileSync(path.join(__repo, 'src/components/Overview.tsx'), 'utf8')) && /ziehGefuehl/.test(readFileSync(path.join(__repo, 'src/components/Board.tsx'), 'utf8')) && !existsSync(path.join(__repo, 'src/lib/physics.ts')));
}
await browser.close(); app.close();
console.log(`\nM481: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
