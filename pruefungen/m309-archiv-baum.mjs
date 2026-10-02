/**
 * M309 — Archivierte Karten sind im Baum verborgen, bis man das Archiv einblendet.
 *
 *   A  Baum in der Übersicht: archivierte Karten fehlen, der Zähler zählt
 *      sie nicht mit, ein archiviertes Board fehlt; am Fuß steht
 *      „Archiv einblenden (n)".
 *   B  Einblenden: Karten und Board erscheinen gedimmt, Zähler zählt sie;
 *      Ausblenden nimmt sie wieder weg.
 *   C  Ohne Archiviertes kein Schalter.
 *   D  „Was ist neu" nennt M309.
 */
// Läuft aus dem Repository: `node pruefungen/m309-archiv-baum.mjs`
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
const PORT = 4529;
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

const note = (id, text, x, y, archived = false) => ({ id, type: 'note', width: 240, position: { x, y }, archived, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const mitArchiv = {
  boards: [
    { id: 'b1', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Antrag prüfen', 60, 60), note('n2', 'Alte Telefonnotiz', 360, 60, true), note('n3', 'Erledigte Idee', 60, 320, true)] },
    { id: 'b2', name: 'Altes Projekt', archived: true, edges: [], drawings: [], comments: [], nodes: [note('n4', 'Abschlussbericht', 60, 60)] },
  ],
  spaces: [{ id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'overview',
};
const ohneArchiv = { ...mitArchiv, boards: [{ ...mitArchiv.boards[0], nodes: [note('n1', 'Antrag prüfen', 60, 60)] }], spaces: [{ id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }] };

async function seite(st) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const baum = (P) => P.evaluate(() => {
  const zeile = [...document.querySelectorAll('.tabs.spalte .side-board')].find((z) => z.textContent.includes('Schreibtisch'));
  const karten = [...(zeile?.nextElementSibling?.querySelectorAll('.side-card') ?? [])];
  return {
    karten: karten.map((k) => k.textContent.trim()),
    gedimmt: karten.filter((k) => k.classList.contains('archiviert')).length,
    zaehler: zeile?.querySelector('.side-board-count')?.textContent.trim() ?? null,
    altesBoard: [...document.querySelectorAll('.tabs.spalte .side-board')].some((z) => z.textContent.includes('Altes Projekt')),
    schalter: document.querySelector('.tabs.spalte .side-archiv')?.textContent.trim() ?? null,
  };
});

console.log('════ A: Verborgen, bis man es einblendet ════');
{
  const { ctx, P } = await seite(mitArchiv);
  const a = await baum(P);
  console.log('   ', JSON.stringify(a));
  pruefe('A1 nur die eine lebende Karte steht unter dem Board', a.karten.length === 1 && a.karten[0] === 'Antrag prüfen', JSON.stringify(a.karten));
  pruefe('A2 der Zähler zählt die archivierten nicht mit', a.zaehler === '1', String(a.zaehler));
  pruefe('A3 das archivierte Board fehlt', a.altesBoard === false);
  pruefe('A4 am Fuß des Baums: „Archiv einblenden (3)"', /Archiv einblenden \(3\)/.test(a.schalter ?? ''), String(a.schalter));
  await P.screenshot({ path: `${SD}/m309-verborgen.png` });

  console.log('\n════ B: Einblenden und wieder ausblenden ════');
  await P.locator('.tabs.spalte .side-archiv').click();
  await P.waitForTimeout(500);
  const b = await baum(P);
  console.log('   ', JSON.stringify(b));
  pruefe('B1 alle drei Karten stehen da, zwei gedimmt', b.karten.length === 3 && b.gedimmt === 2, JSON.stringify(b));
  pruefe('B2 der Zähler zählt jetzt drei', b.zaehler === '3', String(b.zaehler));
  pruefe('B3 das archivierte Board ist gelistet', b.altesBoard === true);
  pruefe('B4 der Schalter heißt jetzt „Archiv ausblenden"', /Archiv ausblenden/.test(b.schalter ?? ''), String(b.schalter));
  await P.screenshot({ path: `${SD}/m309-eingeblendet.png` });
  await P.locator('.tabs.spalte .side-archiv').click();
  await P.waitForTimeout(500);
  const c = await baum(P);
  pruefe('B5 ausgeblendet ist wieder nur die lebende Karte da', c.karten.length === 1 && c.zaehler === '1' && !c.altesBoard, JSON.stringify(c));
  await ctx.close();
}

console.log('\n════ C: Ohne Archiviertes ════');
{
  const { ctx, P } = await seite(ohneArchiv);
  const a = await baum(P);
  pruefe('C1 kein Schalter, wenn es nichts einzublenden gibt', a.schalter === null && a.karten.length === 1, JSON.stringify(a));
  await ctx.close();
}

console.log('\n════ D: „Was ist neu" ════');
{
  const { ctx, P } = await seite(ohneArchiv);
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Was ist neu' }).click();
  await P.waitForSelector('.help-neu-modal');
  const eintraege = await P.locator('#help-neu li').allTextContents();
  const eintrag = eintraege.find((t) => /M309/.test(t)) ?? '';
  pruefe('D1 „Was ist neu" nennt M309 und das Archiv', /Archiv/.test(eintrag), eintrag.slice(0, 80) || 'kein Eintrag');
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
