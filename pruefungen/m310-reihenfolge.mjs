/**
 * M310 — Boards sortieren: manuell, alphabetisch, nach Erstellung.
 *
 *   A  Projekt-Menü „Reihenfolge": manuell (wie gespeichert), alphabetisch,
 *      nach Erstellung — Baum und Übersichts-Kacheln folgen; Umbenennen fügt
 *      ein Board in die alphabetische Reihenfolge ein; neues Board ebenso.
 *   B  Ziehen im Baum sortiert um und macht ein sortiertes Projekt manuell.
 *   C  Ziehen einer Kachel in der Übersicht sortiert innerhalb des Projekts um.
 *   D  „Was ist neu" nennt M310.
 */
// Läuft aus dem Repository: `node pruefungen/m310-reihenfolge.mjs`
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
const PORT = 4530;
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

const note = (id, text) => ({ id, type: 'note', width: 240, position: { x: 60, y: 60 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name) => ({ id, name, edges: [], drawings: [], comments: [], nodes: [note(`${id}-n`, `${name} Notiz`)] });
// Anlege-Reihenfolge (Board-Stand): Mango, Zebra, Apfel — gespeicherte Reihenfolge im Projekt: Zebra, Apfel, Mango
const state = {
  boards: [board('b2', 'Mango'), board('b3', 'Zebra'), board('b1', 'Apfel')],
  spaces: [{ id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b3', 'b1', 'b2'] }] }],
  activeId: 'b1', view: 'overview',
};
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    // Nur beim ERSTEN Laden setzen — ein Neuladen soll den gespeicherten Stand zeigen (A8)
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, state);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const baumReihe = (P) => P.evaluate(() => [...document.querySelectorAll('.tabs.spalte .side-board .side-board-name')].map((b) => b.textContent.trim()));
const kachelReihe = (P) => P.evaluate(() => [...document.querySelectorAll('.ov-canvas .ovc-tile')]
  .map((t) => ({ name: t.querySelector('.ov-board-name, b, strong, h4')?.textContent.trim() ?? t.textContent.trim().split('\n')[0], x: t.getBoundingClientRect().left, y: t.getBoundingClientRect().top }))
  .sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.name));
async function reihenfolgeWaehlen(P, label) {
  await P.locator('.tabs.spalte .side-proj-head .ebenen-menu-knopf').first().click();
  await P.locator('.ebenen-menu .ebenen-menu-reihenfolge').click();
  await P.locator('.ebenen-menu [role="menuitemradio"]', { hasText: label }).click();
  await P.waitForTimeout(500);
}

console.log('════ A: Sortierart im Projekt-Menü ════');
{
  const { ctx, P } = await seite();
  pruefe('A1 manuell: der Baum zeigt die gespeicherte Reihenfolge', JSON.stringify(await baumReihe(P)) === JSON.stringify(['Zebra', 'Apfel', 'Mango']), JSON.stringify(await baumReihe(P)));
  await P.locator('.tabs.spalte .side-proj-head .ebenen-menu-knopf').first().click();
  const eintrag = await P.locator('.ebenen-menu .ebenen-menu-reihenfolge').textContent();
  pruefe('A2 das Projekt-Menü nennt „Reihenfolge: Manuell …"', /Reihenfolge: Manuell/.test(eintrag ?? ''), String(eintrag));
  await P.locator('.ebenen-menu .ebenen-menu-reihenfolge').click();
  const optionen = await P.locator('.ebenen-menu [role="menuitemradio"]').allTextContents();
  pruefe('A3 drei Arten: Manuell, Alphabetisch, Nach Erstellung', optionen.length === 3 && /Alphabetisch/.test(optionen[1]) && /Erstellung/.test(optionen[2]), JSON.stringify(optionen));
  await P.locator('.ebenen-menu [role="menuitemradio"]', { hasText: 'Alphabetisch' }).click();
  await P.waitForTimeout(500);
  const alpha = await baumReihe(P);
  pruefe('A4 alphabetisch: Apfel, Mango, Zebra', JSON.stringify(alpha) === JSON.stringify(['Apfel', 'Mango', 'Zebra']), JSON.stringify(alpha));
  const kacheln = await kachelReihe(P);
  pruefe('A5 die Kacheln der Übersicht folgen', kacheln.length === 3 && kacheln[0].startsWith('Apfel') && kacheln[2].startsWith('Zebra'), JSON.stringify(kacheln));
  await P.screenshot({ path: `${SD}/m310-alphabetisch.png` });
  // Umbenennen fügt neu ein: Apfel → Zypresse
  const zeile = P.locator('.tabs.spalte .side-board', { hasText: 'Apfel' }).first();
  await zeile.locator('.side-board-pen').click();
  const feld = P.locator('.tabs.spalte .side-board input').first();
  await feld.fill('Zypresse');
  await feld.press('Enter');
  await P.waitForTimeout(500);
  const nachUmbenennen = await baumReihe(P);
  pruefe('A6 Umbenennen rückt das Board an seinen Platz: Mango, Zebra, Zypresse', JSON.stringify(nachUmbenennen) === JSON.stringify(['Mango', 'Zebra', 'Zypresse']), JSON.stringify(nachUmbenennen));
  await reihenfolgeWaehlen(P, 'Nach Erstellung');
  const erstellt = await baumReihe(P);
  pruefe('A7 nach Erstellung: Mango, Zebra, Zypresse (Anlege-Reihenfolge)', JSON.stringify(erstellt) === JSON.stringify(['Mango', 'Zebra', 'Zypresse']), JSON.stringify(erstellt));
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  await P.locator('.tabs.spalte .side-proj-head .ebenen-menu-knopf').first().click();
  const gemerkt = await P.locator('.ebenen-menu .ebenen-menu-reihenfolge').textContent();
  pruefe('A8 die Sortierart ist im Stand gemerkt', /Nach Erstellung/.test(gemerkt ?? ''), String(gemerkt));
  await P.keyboard.press('Escape');
  await ctx.close();
}

console.log('\n════ B: Ziehen im Baum ════');
{
  const { ctx, P } = await seite();
  const zeile = (name) => P.locator('.tabs.spalte .side-board', { hasText: name }).first();
  pruefe('B1 Board-Zeilen sind ziehbar', (await zeile('Zebra').getAttribute('draggable')) === 'true');
  // Zebra hinter Mango (Ablegen in der unteren Hälfte der Mango-Zeile)
  const m = await zeile('Mango').boundingBox();
  await zeile('Zebra').dragTo(zeile('Mango'), { targetPosition: { x: m.width / 2, y: m.height - 3 } });
  await P.waitForTimeout(500);
  const r1 = await baumReihe(P);
  pruefe('B2 Zebra hinter Mango gezogen: Apfel, Mango, Zebra', JSON.stringify(r1) === JSON.stringify(['Apfel', 'Mango', 'Zebra']), JSON.stringify(r1));
  // Mango vor Apfel (obere Hälfte)
  const a = await zeile('Apfel').boundingBox();
  await zeile('Mango').dragTo(zeile('Apfel'), { targetPosition: { x: a.width / 2, y: 3 } });
  await P.waitForTimeout(500);
  const r2 = await baumReihe(P);
  pruefe('B3 Mango vor Apfel gezogen: Mango, Apfel, Zebra', JSON.stringify(r2) === JSON.stringify(['Mango', 'Apfel', 'Zebra']), JSON.stringify(r2));
  // In einem alphabetischen Projekt ziehen → wird manuell
  await reihenfolgeWaehlen(P, 'Alphabetisch');
  const z = await zeile('Zebra').boundingBox();
  await zeile('Apfel').dragTo(zeile('Zebra'), { targetPosition: { x: z.width / 2, y: z.height - 3 } });
  await P.waitForTimeout(500);
  const r3 = await baumReihe(P);
  await P.locator('.tabs.spalte .side-proj-head .ebenen-menu-knopf').first().click();
  const art = await P.locator('.ebenen-menu .ebenen-menu-reihenfolge').textContent();
  await P.keyboard.press('Escape');
  pruefe('B4 Ziehen im sortierten Projekt: Reihenfolge Mango, Zebra, Apfel und Art „Manuell"', JSON.stringify(r3) === JSON.stringify(['Mango', 'Zebra', 'Apfel']) && /Manuell/.test(art ?? ''), `${JSON.stringify(r3)} ${art}`);
  await P.screenshot({ path: `${SD}/m310-gezogen.png` });
  await ctx.close();
}

console.log('\n════ C: Kachel in der Übersicht ziehen ════');
{
  const { ctx, P } = await seite();
  const kachel = (name) => P.locator('.ov-canvas .ovc-tile', { hasText: name }).first();
  const vorher = await kachelReihe(P);
  const z = await kachel('Mango').boundingBox();   // letzte Kachel
  const a = await kachel('Zebra').boundingBox();   // erste Kachel
  // Mango vor die erste Kachel ziehen
  await P.mouse.move(z.x + z.width / 2, z.y + 12);
  await P.mouse.down();
  for (let i = 1; i <= 10; i += 1) { await P.mouse.move(z.x + z.width / 2 + ((a.x - 40 - z.x) * i) / 10, z.y + 12 + ((a.y - z.y) * i) / 10); await P.waitForTimeout(25); }
  await P.mouse.up();
  await P.waitForTimeout(800);
  const nachher = await baumReihe(P);
  pruefe('C1 die Kachel nach ganz links gezogen: Mango zuerst', nachher[0] === 'Mango' && nachher.length === 3, `${JSON.stringify(vorher)} → ${JSON.stringify(nachher)}`);
  const kacheln = await kachelReihe(P);
  pruefe('C2 die Kacheln rasten in der neuen Reihenfolge ein', kacheln[0].startsWith('Mango'), JSON.stringify(kacheln));
  await P.screenshot({ path: `${SD}/m310-kachel.png` });
  await ctx.close();
}

console.log('\n════ D: „Was ist neu" ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Was ist neu' }).click();
  await P.waitForSelector('.help-neu-modal');
  const eintraege = await P.locator('#help-neu li').allTextContents();
  const eintrag = eintraege.find((t) => /M310/.test(t)) ?? '';
  pruefe('D1 „Was ist neu" nennt M310 und die Reihenfolge', /Reihenfolge/.test(eintrag), eintrag.slice(0, 80) || 'kein Eintrag');
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
