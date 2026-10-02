/**
 * M308 — Die linke Spalte lässt sich ziehen und ausblenden.
 *
 *   A  Griff am rechten Rand: Ziehen ändert die Breite, Band und Fläche
 *      folgen, die Breite überlebt das Neuladen, Doppelklick stellt sie zurück.
 *   B  ‹-Knopf am Fuß blendet die Spalte aus (Brotkrume erscheint), „Anheften"
 *      in der Ausstülpung holt sie zurück; beides wird gemerkt.
 *   C  Telefon: weder Griff noch Knopf — dort gibt es keine Spalte.
 *   D  „Was ist neu" nennt M308.
 */
// Läuft aus dem Repository: `node pruefungen/m308-spalte.mjs`
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
const PORT = 4528;
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
    { id: 'b1', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Antrag prüfen', 60, 60), note('n2', 'Telefonnotiz', 360, 60)] },
    { id: 'b2', name: 'Wissen', edges: [], drawings: [], comments: [], nodes: [note('n3', 'Leitfaden', 60, 60)] },
  ],
  spaces: [{ id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite({ viewport = { width: 1440, height: 900 }, mobil = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobil, hasTouch: mobil });
  await ctx.addInitScript((st) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, state);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const masse = (P) => P.evaluate(() => {
  const sp = document.querySelector('.tabs.spalte');
  const wrap = document.querySelector('.board-wrap');
  return {
    spalte: sp ? Math.round(sp.getBoundingClientRect().width) : null,
    rand: wrap ? Math.round(parseFloat(getComputedStyle(wrap).marginLeft)) : null,
    navW: getComputedStyle(document.querySelector('.app')).getPropertyValue('--nav-w').trim(),
  };
});

console.log('════ A: Griff — Breite ziehen ════');
{
  const { ctx, P } = await seite();
  const griff = P.locator('.tabs.spalte .spalte-griff');
  pruefe('A1 die Spalte hat einen Griff am rechten Rand', (await griff.count()) === 1);
  const vorher = await masse(P);
  console.log('    vorher', JSON.stringify(vorher));
  pruefe('A2 Ausgangsbreite 268', vorher.spalte === 268, String(vorher.spalte));
  const g = await griff.boundingBox();
  // Die Kante folgt dem Zeiger: Die Spalte beginnt 18 Punkte vom Rand, also
  // ist die Breite am Ende „Zeiger minus 18"
  const start = g.x + g.width / 2;
  const erwartet = Math.round(start + 120 - 18);
  await P.mouse.move(start, g.y + 300);
  await P.mouse.down();
  for (let i = 1; i <= 8; i += 1) { await P.mouse.move(start + (120 * i) / 8, g.y + 300); await P.waitForTimeout(20); }
  await P.mouse.up();
  await P.waitForTimeout(400);
  const nachher = await masse(P);
  console.log('    nachher', JSON.stringify(nachher), 'erwartet', erwartet);
  pruefe('A3 die Kante folgt dem Zeiger: rund 120 Punkte breiter', Math.abs(nachher.spalte - erwartet) <= 3, `${nachher.spalte} statt ${erwartet}`);
  pruefe('A4 die Fläche rückt um dasselbe Maß mit', Math.abs((nachher.rand - vorher.rand) - (nachher.spalte - vorher.spalte)) <= 3, `${vorher.rand} → ${nachher.rand}`);
  await P.screenshot({ path: `${SD}/m308-breit.png` });
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  const geladen = await masse(P);
  pruefe('A5 die Breite überlebt das Neuladen (Vorliebe, nicht Stand)', Math.abs(geladen.spalte - erwartet) <= 3, String(geladen.spalte));
  await P.locator('.tabs.spalte .spalte-griff').dblclick();
  await P.waitForTimeout(400);
  const zurueck = await masse(P);
  pruefe('A6 Doppelklick stellt 268 wieder her', zurueck.spalte === 268, String(zurueck.spalte));
  await ctx.close();
}

console.log('\n════ B: Ausblenden und Anheften ════');
{
  const { ctx, P } = await seite();
  const zu = P.locator('.tabs.spalte .tab-spalte-zu');
  pruefe('B1 am Fuß der Spalte steht der ‹-Knopf', (await zu.count()) === 1);
  await zu.click();
  await P.waitForTimeout(600);
  pruefe('B2 die Spalte ist weg, die Brotkrume da', (await P.locator('.tabs.spalte').count()) === 0 && (await P.locator('.tab-nav').count()) === 1);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  pruefe('B3 das bleibt nach dem Neuladen so', (await P.locator('.tabs.spalte').count()) === 0);
  await P.locator('.tab-nav').first().click();
  await P.waitForSelector('.nav-panel');
  const pin = P.locator('.nav-panel .nav-anheften');
  pruefe('B4 die Ausstülpung bietet „Anheften"', (await pin.count()) === 1);
  await pin.click();
  await P.waitForTimeout(600);
  pruefe('B5 angeheftet: die Spalte ist zurück, die Ausstülpung zu', (await P.locator('.tabs.spalte').count()) === 1 && (await P.locator('.nav-panel').count()) === 0);
  await P.screenshot({ path: `${SD}/m308-angeheftet.png` });
  await ctx.close();
}

console.log('\n════ C: Telefon ════');
{
  const { ctx, P } = await seite({ viewport: { width: 390, height: 844 }, mobil: true });
  pruefe('C1 am Telefon gibt es weder Spalte, Griff noch ‹-Knopf',
    (await P.locator('.tabs.spalte').count()) === 0 && (await P.locator('.spalte-griff:visible').count()) === 0 && (await P.locator('.tab-spalte-zu').count()) === 0);
  await P.locator('.tab-nav').first().click();
  await P.waitForSelector('.nav-panel');
  pruefe('C2 und in der Ausstülpung kein „Anheften"', (await P.locator('.nav-panel .nav-anheften').count()) === 0);
  await ctx.close();
}

console.log('\n════ D: „Was ist neu" ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Was ist neu' }).click();
  await P.waitForSelector('.help-neu-modal');
  const eintraege = await P.locator('#help-neu li').allTextContents();
  const eintrag = eintraege.find((t) => /M308/.test(t)) ?? '';
  pruefe('D1 „Was ist neu" nennt M308 und den Griff', /Griff/.test(eintrag), eintrag.slice(0, 80) || 'kein Eintrag');
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
