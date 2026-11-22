/**
 * M431 — Präsentation verlassen: das Board steht auf der zuletzt gezeigten Karte.
 *
 * Gewünscht: „Wenn man den Präsentationsmodus verlässt, soll zur letzten in der Präsentation aktiven Karte oder Modul
 * gesprungen werden."
 *
 *   A  Drei Folien weiter, Esc: Die Präsentation ist zu, das Board fährt zur dritten Karte (markiert sie nicht: Bei
 *      Dokumenten wirkte das wie „aufschlagen", beim Vorführen bis auf die anderen Geräte).
 *   B  Über den Knopf „Präsentation beenden" ebenso.
 *   C  Aus dem Karten-Fokus präsentiert: nach dem Beenden zurück auf dem Board, bei der zuletzt gezeigten Karte.
 *   D  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m431-vortrag-ende.mjs`
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
const PORT = 4768;
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
const KARTEN = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Eins' }] } },
  { id: 'n2', type: 'kanban', position: { x: 1400, y: 0 }, width: 420, height: 260, data: { title: 'Zwei', items: [{ id: 'a', text: 'Angebot', col: 0 }] } },
  { id: 'n3', type: 'note', position: { x: 2800, y: 900 }, width: 260, data: { color: 'green', blocks: [{ type: 'paragraph', content: 'Drei' }] } },
];
const KANTEN = [{ id: 'e1', source: 'n1', target: 'n2', type: 'floating', data: {} }, { id: 'e2', source: 'n2', target: 'n3', type: 'floating', data: {} }];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(([n, e]) => {
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: e, drawings: [], nodes: n }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false } }));
}, [KARTEN, KANTEN]);
const P = await ctx.newPage();
P.on('pageerror', (er) => fehler.push(er.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);
const mitte = (id) => P.evaluate((i) => { const r = document.querySelector(`.react-flow__node[data-id="${i}"]`)?.getBoundingClientRect(); const p = document.querySelector('.react-flow').getBoundingClientRect(); return r ? { dx: Math.round(r.left + r.width / 2 - (p.left + p.width / 2)), dy: Math.round(r.top + r.height / 2 - (p.top + p.height / 2)), sel: document.querySelector(`.react-flow__node[data-id="${i}"]`).classList.contains('selected') } : null; }, id);
const vortrag = async () => { await P.mouse.click(1380, 860); await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(700); };

console.log('\n════ A: Esc ════');
await vortrag();
await P.keyboard.press('ArrowRight'); await P.waitForTimeout(500);
await P.keyboard.press('ArrowRight'); await P.waitForTimeout(500);
const zaehler = (await P.locator('.presenter-count').textContent()).replace(/\s+/g, ' ');
await P.keyboard.press('Escape'); await P.waitForTimeout(1300);
const a = await mitte('n3');
pruefe('A1 Präsentation zu', (await P.locator('.presenter').count()) === 0, zaehler);
pruefe('A2 das Board steht auf der dritten Karte (mittig), ohne die Auswahl zu ändern', !!a && Math.abs(a.dx) < 30 && Math.abs(a.dy) < 30 && !a.sel, a);

console.log('\n════ B: Knopf ════');
await vortrag();
await P.keyboard.press('ArrowRight'); await P.waitForTimeout(500);
await P.locator('[data-taste="vortrag-zu"]').click(); await P.waitForTimeout(1300);
const b = await mitte('n2');
pruefe('B1 über „Beenden": auf der zweiten Karte', !!b && Math.abs(b.dx) < 30 && Math.abs(b.dy) < 30 && !b.sel, b);

console.log('\n════ C: aus dem Fokus ════');
{
  const k = await P.locator('.react-flow__node[data-id="n2"]').boundingBox();
  await P.mouse.click(k.x + Math.min(150, k.width / 2), k.y + 14); await P.waitForTimeout(250);
  await P.locator('.react-flow__node[data-id="n2"]').evaluate((el) => el.focus()); await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
  const knopf = P.locator('.focus-nav button[aria-label="Ab dieser Karte präsentieren"]');
  if (await knopf.count()) {
    await knopf.click(); await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(700);
    await P.keyboard.press('ArrowRight'); await P.waitForTimeout(500);
    await P.keyboard.press('Escape'); await P.waitForTimeout(1300);
    const c = await mitte('n3');
    pruefe('C1 zurück auf dem Board (kein Fokus), bei der zuletzt gezeigten Karte', (await P.locator('.focus-head').count()) === 0 && !!c && Math.abs(c.dx) < 30 && Math.abs(c.dy) < 30, c);
  } else pruefe('C1 Knopf „Ab dieser Karte präsentieren" im Fokus', false, k);
}

console.log('\n════ D ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('D1 Hilfe nennt M431', /M431/.test(hilfe));
  pruefe('D2 Umbau-Liste nennt M431', /M431/.test(umbau));
  pruefe('D3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}
await browser.close(); app.close();
console.log(`\nM431: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
