/**
 * M297 — Eine Navigation statt drei.
 *
 *   A  Ab Tablet-Breite: die linke Spalte ist ein Rahmen mit dem ganzen Baum,
 *      die Fläche beginnt rechts davon, keine rechte Seitenleiste, kein
 *      Navigator-Popup; aktives Projekt und Board sind aufgeklappt, die Suche
 *      filtert, Alt+U blendet die Spalte aus, Alt+W springt in die Suche.
 *   B  Übersicht: Spalte bleibt, „Hierarchie | Netz" steht genau einmal.
 *   C  Schmal: Kopfleiste mit Brotkrume, die denselben Baum als Ausstülpung öffnet.
 */
// Läuft aus dem Repository: `node pruefungen/m297-navigation.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4517;
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

const note = (id, text, x, y) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const state = {
  boards: [
    { id: 'b1', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Antrag prüfen', 60, 60), note('n2', 'Telefonnotiz', 360, 60), note('n3', 'Ideen', 60, 320)] },
    { id: 'b2', name: 'Aufgaben', edges: [], drawings: [], comments: [], nodes: [note('n4', 'Wochenplan', 60, 60)] },
    { id: 'b3', name: 'Wissen', edges: [], drawings: [], comments: [], nodes: [note('n5', 'E-Akte Leitfaden', 60, 60), note('n6', 'Antrag Muster', 360, 60)] },
    { id: 'b4', name: 'Kontakte', edges: [], drawings: [], comments: [], nodes: [] },
    { id: 'b5', name: 'Familienplan', edges: [], drawings: [], comments: [], nodes: [note('n7', 'Einkauf', 60, 60)] },
  ],
  spaces: [
    { id: 's1', name: '🏢 Arbeitsplatz', projects: [
      { id: 'p1', name: 'Täglicher Einstieg', boardIds: ['b1', 'b2'] },
      { id: 'p2', name: 'Wissensbasis', boardIds: ['b3', 'b4'] },
    ] },
    { id: 's2', name: '🏡 Privat', projects: [{ id: 'p3', name: 'Familie', boardIds: ['b5'] }] },
  ],
  activeId: 'b1', view: 'board',
};
async function seite({ viewport = { width: 1440, height: 900 }, mobil = false, view = 'board' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobil, hasTouch: mobil });
  await ctx.addInitScript((st) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { ...state, view });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}

console.log('════ A: Die Spalte als Rahmen ════');
{
  const { ctx, P } = await seite();
  pruefe('A1 die linke Spalte trägt den Baum', (await P.locator('.tabs.spalte .side-tree').count()) === 1);
  pruefe('A2 keine Brotkrume, keine rechte Seitenleiste, kein Seitenleisten-Knopf',
    (await P.locator('.tab-nav').count()) === 0 && (await P.locator('.sidepanel, .sidepanel-fahne, [aria-label="Seitenleiste"]').count()) === 0);
  const namen = await P.locator('.tabs .side-space-name').allTextContents();
  pruefe('A3 beide Bereiche stehen im Baum', namen.length === 2 && namen[0].includes('Arbeitsplatz') && namen[1].includes('Privat'), JSON.stringify(namen));
  pruefe('A4 alle drei Projekte stehen da', (await P.locator('.tabs .side-proj-head').count()) === 3);
  pruefe('A5 nur das aktive Projekt ist aufgeklappt (seine zwei Boards sichtbar, die anderen nicht)',
    (await P.locator('.tabs .side-board').count()) === 2 && (await P.locator('.tabs .side-board', { hasText: 'Wissen' }).count()) === 0);
  pruefe('A6 das aktive Board ist markiert und zeigt seine Karten',
    (await P.locator('.tabs .side-board.active', { hasText: 'Schreibtisch' }).count()) === 1 && (await P.locator('.tabs .side-card').count()) === 3);
  const lage = await P.evaluate(() => {
    const spalte = document.querySelector('.tabs').getBoundingClientRect();
    const karten = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect().left);
    return { rechts: spalte.right, links: Math.min(...karten) };
  });
  pruefe('A7 die Fläche beginnt rechts der Spalte — keine Karte darunter', lage.links >= lage.rechts, JSON.stringify(lage));
  await P.screenshot({ path: `${SD}/m297-a-spalte.png` });

  // Anderes Projekt aufklappen und ein Board öffnen
  await P.locator('.tabs .side-proj-head', { hasText: 'Wissensbasis' }).locator('.side-board-arrow').click();
  await P.waitForTimeout(300);
  pruefe('A8 der Pfeil klappt ein Projekt auf', (await P.locator('.tabs .side-board', { hasText: 'Wissen' }).count()) === 1);
  await P.locator('.tabs .side-board', { hasText: 'Wissen' }).locator('.side-board-name').click();
  await P.waitForTimeout(800);
  pruefe('A9 Klick auf ein Board öffnet es', (await P.locator('.tabs .side-board.active', { hasText: 'Wissen' }).count()) === 1
    && (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId)) === 'b3');

  // Suche
  await P.locator('.tabs .side-tree-find').fill('Antrag');
  await P.waitForTimeout(400);
  const treffer = await P.locator('.tabs .side-card').allTextContents();
  pruefe('A10 die Suche zeigt nur passende Karten — über alle Projekte', treffer.length === 2 && treffer.every((t) => /Antrag/.test(t)), JSON.stringify(treffer));
  pruefe('A11 … und ein Board ohne Treffer verschwindet', (await P.locator('.tabs .side-board', { hasText: 'Kontakte' }).count()) === 0);
  await P.locator('.tabs .side-tree-find').fill('');

  // Alt+U / Alt+W
  await P.mouse.click(900, 700);
  await P.keyboard.press('Alt+U');
  await P.waitForTimeout(500);
  pruefe('A12 Alt+U blendet die Spalte aus — Kopfleiste mit Brotkrume', (await P.locator('.tabs.spalte').count()) === 0 && (await P.locator('.tab-nav').count()) === 1);
  await P.keyboard.press('Alt+U');
  await P.waitForTimeout(500);
  pruefe('A13 Alt+U holt sie zurück', (await P.locator('.tabs.spalte .side-tree').count()) === 1);
  await P.keyboard.press('Alt+W');
  await P.waitForTimeout(300);
  pruefe('A14 Alt+W springt in die Suche des Baums', await P.evaluate(() => document.activeElement?.classList.contains('side-tree-find') === true));
  await ctx.close();
}

console.log('════ B: Übersicht ════');
{
  const { ctx, P } = await seite({ view: 'overview' });
  pruefe('B1 auch in der Übersicht steht die Spalte mit dem Baum', (await P.locator('.tabs.spalte .side-tree').count()) === 1);
  const schalter = await P.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Netz' && b.getBoundingClientRect().width > 0).length);
  pruefe('B2 „Netz" gibt es genau einmal — in der Übersicht', schalter === 1, `netz=${schalter}`);
  await P.locator('.ov-mode button', { hasText: 'Netz' }).click();
  await P.waitForTimeout(1500);
  pruefe('B3 das Netz öffnet dort', (await P.locator('.ov-graph').count()) === 1);
  await ctx.close();
}

console.log('════ C: Schmal — Kopfleiste und Ausstülpung ════');
{
  const { ctx, P } = await seite({ viewport: { width: 720, height: 900 } });
  pruefe('C1 unter 861 Punkten: Kopfleiste mit Brotkrume statt Spalte', (await P.locator('.tabs.spalte').count()) === 0 && (await P.locator('.tab-nav').count()) === 1);
  await P.locator('.tab-nav').click();
  await P.waitForTimeout(500);
  pruefe('C2 die Brotkrume öffnet denselben Baum als Ausstülpung', (await P.locator('.nav-panel .side-tree').count()) === 1 && (await P.locator('.nav-panel .side-board', { hasText: 'Schreibtisch' }).count()) === 1);
  await P.locator('.nav-panel .side-board', { hasText: 'Aufgaben' }).locator('.side-board-name').click();
  await P.waitForTimeout(700);
  pruefe('C3 ein Board wählen schließt die Ausstülpung und öffnet das Board', (await P.locator('.nav-panel').count()) === 0
    && (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId)) === 'b2');
  await P.keyboard.press('Alt+W');
  await P.waitForTimeout(400);
  pruefe('C4 Alt+W öffnet die Ausstülpung', (await P.locator('.nav-panel').count()) === 1);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);
  pruefe('C5 Esc schließt sie', (await P.locator('.nav-panel').count()) === 0);
  await P.screenshot({ path: `${SD}/m297-c-schmal.png` });
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
