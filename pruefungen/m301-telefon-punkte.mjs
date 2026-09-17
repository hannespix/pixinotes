/**
 * M301 — Ein Weg am Telefon, ruhigere Karten.
 *
 *   A  Telefon (390 Punkte): die Kopfleiste trägt EINEN Knopf „Projekt › Board"
 *      statt Brotkrume und Board-Wähler; er öffnet den Baum, dort wechselt man
 *      das Board, Esc schließt.
 *   B  PC (Maus): eine ausgewählte Karte zeigt die ＋-Verbindungspunkte nur,
 *      solange die Maus auf ihr liegt.
 *   C  Touch (hover: none): die Auswahl zeigt sie weiterhin.
 *   D  Telefon: die vier Einstellungs-Reiter stehen in einer Zeile.
 *   E  Hilfe: kein Board-Wähler mehr, der Weg heißt „Projekt › Board".
 */
// Läuft aus dem Repository: `node pruefungen/m301-telefon-punkte.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
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
const PORT = 4522;
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
async function seite({ telefon = false } = {}) {
  const ctx = await browser.newContext(telefon
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('pixinotes-onboarded', '1'); });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  if (telefon) {
    // Ohne Maus: hover:none und pointer:coarse — so sieht der Browser ein Telefon
    const cdp = await ctx.newCDPSession(P);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
  }
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const deckkraft = (P, sel) => P.locator(sel).first().evaluate((el) => getComputedStyle(el).opacity);

console.log('════ A: Telefon — ein Weg ════');
{
  const { ctx, P } = await seite({ telefon: true });
  pruefe('A1 die Kopfleiste ist kompakt und trägt genau einen Weg-Knopf', (await P.locator('.tabs.kompakt').count()) === 1 && (await P.locator('.tabs .tab-pfad').count()) === 1 && (await P.locator('.tabs .tab-nav').count()) === 1);
  pruefe('A2 kein Board-Wähler mehr daneben', (await P.locator('.tab-picker, .tab-picker-wrap').count()) === 0);
  const proj = (await P.locator('.tab-pfad-proj').textContent()).trim();
  const board = (await P.locator('.tab-pfad-board').textContent()).trim();
  pruefe('A3 der Knopf zeigt „Projekt › Board"', proj.length > 1 && board.length > 1 && proj !== board, `${proj} › ${board}`);
  await P.screenshot({ path: `${SD}/m301-a-telefon.png` });
  await P.locator('.tab-pfad').tap();
  await P.waitForTimeout(300);
  pruefe('A4 Tipp öffnet den Baum mit dem aktiven Board', (await P.locator('.nav-panel .side-tree').count()) === 1 && (await P.locator('.nav-panel .side-board.active', { hasText: board }).count()) === 1);
  await P.screenshot({ path: `${SD}/m301-a-baum.png` });
  const anderes = P.locator('.nav-panel .side-board:not(.active)').first();
  const anderesName = (await anderes.locator('.side-board-name').textContent()).trim();
  await anderes.locator('.side-board-name').tap();
  await P.waitForTimeout(400);
  pruefe('A5 ein anderes Board wählen schließt den Baum und steht im Knopf', (await P.locator('.nav-panel').count()) === 0 && (await P.locator('.tab-pfad-board').textContent()).trim() === anderesName, anderesName);
  await P.locator('.tab-pfad').tap();
  await P.waitForTimeout(200);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(200);
  pruefe('A6 Esc schließt den Baum', (await P.locator('.nav-panel').count()) === 0);
  await ctx.close();
}

console.log('════ B: PC — Verbindungspunkte nur beim Zeigen ════');
{
  const { ctx, P } = await seite();
  // Eine ganz sichtbare Karte wählen (nicht unter der Navigation)
  const karte = P.locator('.react-flow__node').filter({ has: P.locator('.card-shell') }).first();
  await karte.click({ position: { x: 40, y: 12 } });
  await P.waitForTimeout(200);
  pruefe('B1 die Karte ist ausgewählt', (await P.locator('.react-flow__node.selected').count()) >= 1);
  pruefe('B2 unter der Maus sind die ＋-Punkte da', (await deckkraft(P, '.react-flow__node.selected .pn-handle')) === '1');
  await P.mouse.move(1400, 880);
  await P.waitForTimeout(350);
  pruefe('B3 Maus weg: ausgewählt, aber keine Punkte', (await P.locator('.react-flow__node.selected').count()) >= 1 && (await deckkraft(P, '.react-flow__node.selected .pn-handle')) === '0', await deckkraft(P, '.react-flow__node.selected .pn-handle'));
  await karte.hover({ position: { x: 40, y: 12 } });
  await P.waitForTimeout(350);
  pruefe('B4 Maus drauf: die Punkte kommen wieder', (await deckkraft(P, '.react-flow__node.selected .pn-handle')) === '1');
  await ctx.close();
}

console.log('════ C: Touch — Auswahl zeigt die Punkte ════');
{
  const { ctx, P } = await seite({ telefon: true });
  pruefe('C0 der Browser meldet hover:none', await P.evaluate(() => matchMedia('(hover: none)').matches));
  const karte = P.locator('.react-flow__node').filter({ has: P.locator('.card-shell') }).first();
  await karte.scrollIntoViewIfNeeded().catch(() => {});
  await karte.tap({ position: { x: 30, y: 10 } });
  await P.waitForTimeout(300);
  pruefe('C1 angetippt = ausgewählt, und die ＋-Punkte sind da', (await P.locator('.react-flow__node.selected').count()) >= 1 && (await deckkraft(P, '.react-flow__node.selected .pn-handle')) === '1', await deckkraft(P, '.react-flow__node.selected .pn-handle').catch(() => 'keine Auswahl'));
  await ctx.close();
}

console.log('════ D: Telefon — Einstellungs-Reiter in einer Zeile ════');
{
  const { ctx, P } = await seite({ telefon: true });
  await P.locator('[data-taste="einstellungen"]').tap();
  await P.waitForSelector('.modal-tabs');
  const zeilen = await P.locator('.modal-tabs button').evaluateAll((bs) => new Set(bs.map((b) => b.offsetTop)).size);
  pruefe('D1 alle vier Reiter stehen in einer Zeile', zeilen === 1 && (await P.locator('.modal-tabs button').count()) === 4, `Zeilen: ${zeilen}`);
  await P.screenshot({ path: `${SD}/m301-d-reiter.png` });
  await ctx.close();
}

console.log('════ E: Hilfe ════');
{
  const s = readFileSync(join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfe = s.slice(s.indexOf('<section id="help-start">'), s.indexOf('<section id="help-impressum">'));
  pruefe('E1 die Hilfe nennt den Weg „Projekt › Board" und keinen Board-Wähler', /Projekt › Board/.test(hilfe) && !/Board-Wähler/.test(hilfe));
  pruefe('E2 Verbinden beginnt mit dem Zeigen auf die Karte', /Mit der Maus auf eine Karte zeigen/.test(hilfe));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
