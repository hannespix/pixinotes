/**
 * M430 — Kanban bei wenig Breite: keine Überlappungen.
 *
 * Gemeldet (Screenshot, Fokus bei 246 %): „Kanban-Board: unsauber, wenn die Modulbreite nicht ausreicht …
 * Überlappungen im UI." Die Leiste eines Tickets (‹ Frist ✕ ›) ragte über das Ticket und die Nachbarspalte, und im
 * Spaltenkopf blieben vom Namen zwei Buchstaben („TO", „DC") — oder gar nichts.
 *
 *   A  Maus: Die Leiste beim Zeigen bleibt innerhalb des Tickets.
 *   B  Finger (Touch-Laptop, Tablet): Die Leisten stehen im Ticket, nirgends darüber hinaus; schmal als Raster.
 *   C  Spaltenkopf: Der Name bleibt lesbar breit (mindestens fünf Zeichen); Zähler und Knöpfe rücken notfalls darunter.
 *   D  Breites Kanban: alles wie bisher in einer Zeile.
 *   E  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m430-kanban-schmal.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4767;
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
const items = [['Favoriten gewählt', 0], ['Punkte vergeben, Ergebnis ansehen', 0], ['Neue Idee', 0], ['Gruppen gebildet', 1], ['Committe oft', 2], ['Schreib sinnvolle Commit-Messages', 2], ['Tests', 2]].map(([t, c], i) => ({ id: 'i' + i, text: t, col: c }));
const auf = async (touch, breite) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1000, height: 640 }, hasTouch: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(([it, w]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-fokus-ansicht', 'einpassen');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: [{ id: 'k1', type: 'kanban', position: { x: 0, y: 0 }, width: w, height: 320, data: { title: 'Demo Backlog', items: it } }] }],
      spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false } }));
  }, [items, breite]);
  const P = await ctx.newPage();
  P.on('pageerror', (er) => fehler.push(er.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  const k = await P.locator('.react-flow__node[data-id="k1"]').boundingBox();
  await P.mouse.click(k.x + 40, k.y + 10); await P.waitForTimeout(300);
  await P.locator('.react-flow__node[data-id="k1"]').evaluate((el) => el.focus()); await P.keyboard.press('Enter'); await P.waitForTimeout(1400);
  return { ctx, P };
};
const pruefen = (P) => P.evaluate(() => {
  const raus = []; const namen = []; const koepfe = [];
  for (const it of document.querySelectorAll('.kanban-item')) {
    const r = it.getBoundingClientRect(); const a = it.querySelector('.kanban-item-actions');
    if (!a) continue; const ar = a.getBoundingClientRect();
    if (getComputedStyle(a).opacity !== '0' && (ar.left < r.left - 1 || ar.right > r.right + 1)) raus.push(it.textContent.slice(0, 14));
  }
  for (const c of document.querySelectorAll('.kanban-col')) {
    const n = c.querySelector('.kanban-col-name'); const fs = parseFloat(getComputedStyle(n).fontSize);
    // so breit wie fünf Zeichen — oder, ist die Spalte schmaler, so breit wie die ganze Spalte
    const cs = getComputedStyle(c); const innen = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const b = n.offsetWidth;   // Layout-Maß wie clientWidth (der Fokus zoomt)
    namen.push(b >= innen - 2 ? 99 : Math.round(b / fs * 10) / 10);
    const h = c.querySelector('.kanban-col-head'); koepfe.push(Math.round(h.offsetHeight / fs * 10) / 10);
  }
  return { raus, namen, koepfe };
});

console.log('\n════ A/C: Maus, schmal ════');
{
  const { ctx, P } = await auf(false, 300);
  const r = await P.locator('.kanban-item').first().boundingBox();
  await P.mouse.move(r.x + 10, r.y + 8); await P.waitForTimeout(400);
  const e = await pruefen(P);
  pruefe('A1 die Leiste des Tickets bleibt im Ticket', e.raus.length === 0, e.raus);
  pruefe('C1 jeder Spaltenname mindestens fünf Zeichen breit', e.namen.every((n) => n >= 4.9), e.namen);
  await P.screenshot({ path: `${SD}/m430-maus.png` });
  await ctx.close();
}
console.log('\n════ B: Finger, schmal ════');
{
  const { ctx, P } = await auf(true, 300);
  const e = await pruefen(P);
  pruefe('B1 keine Leiste ragt aus ihrem Ticket', e.raus.length === 0, e.raus);
  pruefe('B2 Spaltennamen lesbar', e.namen.every((n) => n >= 4.9), e.namen);
  const raster = await P.evaluate(() => getComputedStyle(document.querySelector('.kanban-item-actions')).display);
  pruefe('B3 im schmalen Ticket als Raster', raster === 'grid', raster);
  await P.screenshot({ path: `${SD}/m430-finger.png` });
  await ctx.close();
}
console.log('\n════ D: breit ════');
{
  const { ctx, P } = await auf(false, 760);
  const e = await pruefen(P);
  pruefe('D1 breites Kanban: Spaltenkopf in einer Zeile', e.koepfe.every((h) => h < 3.2), e.koepfe);
  const raster = await P.evaluate(() => getComputedStyle(document.querySelector('.kanban-item-actions')).display);
  pruefe('D2 Leiste wie bisher als Zeile', raster === 'flex', raster);
  await ctx.close();
}
console.log('\n════ E ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('E1 Hilfe nennt M430', /M430/.test(hilfe));
  pruefe('E2 Umbau-Liste nennt M430', /M430/.test(umbau));
  pruefe('E3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}
await browser.close(); app.close();
console.log(`\nM430: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
