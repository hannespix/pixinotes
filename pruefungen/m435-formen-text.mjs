/**
 * M435 — Ablauf-Module (Schritt, Entscheidung, Start/Ende) mit Text-Bearbeitung wie in Notizen, und sie wachsen mit.
 *
 * Gemeldet: „Die manuellen Ablauf-Module (Entscheidung/Start/Ende/Schritt) sollen auch Text-Editing wie die
 * Notizkarten bekommen! Zudem soll sich die Größe der Module bei Überlauf anpassen …"
 *
 *   A  Doppelklick weckt denselben Editor wie in Notizen (fett, Listen …); ruhend steht der Text als schlichtes HTML.
 *      Eine aus der Palette gelegte Form ist gleich bereit zum Tippen.
 *   B  Zu viel Text: die Form wächst mit (die Raute auch in die Breite, ihre Mitte bleibt), weniger Text: sie
 *      schrumpft wieder bis auf ihre eigene Größe.
 *   C  Der Klartext (`text`) bleibt für KI, Suche und Export gepflegt; setzt jemand nur Klartext, gilt der.
 */
// Läuft aus dem Repository: `node pruefungen/m435-formen-text.mjs`
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
const PORT = 4771;
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
const s = (id, shape, x, y, text) => ({ id, type: 'shape', position: { x, y }, width: 150, height: 70, data: { shape, text, color: '#eef2ff' } });
const NODES = [s('p', 'process', 0, 0, 'Antrag prüfen'), s('d', 'decision', 300, -10, 'Vollständig?'), s('t', 'terminator', 640, 0, 'Start')];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1300, height: 820 } });
await ctx.addInitScript(([ns]) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Ablauf', edges: [], drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
}, [NODES]);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);
// Der gespeicherte Stand folgt mit kurzer Verzögerung
const karte = async (id) => { await P.waitForTimeout(1300); return P.evaluate((i) => {
  const n = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((k) => k.id === i);
  return n ? { w: n.width, h: n.height, x: n.position.x, text: n.data.text, blocks: n.data.blocks ?? null } : null;
}, id); };
const warte = (ms = 500) => P.waitForTimeout(ms);
const mitte = async (id) => { const b = await P.locator(`.react-flow__node[data-id="${id}"] .shape-body`).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const editor = (id) => P.locator(`.react-flow__node[data-id="${id}"] [contenteditable="true"]`);

console.log('A  Bearbeiten wie in Notizen');
pruefe('A1 ruhend: kein Editor, der Text steht als schlichtes HTML', (await P.locator('.react-flow__node-shape [contenteditable="true"]').count()) === 0
  && (await P.locator('.react-flow__node[data-id="p"] .shape-ruhend').innerText()).trim() === 'Antrag prüfen');
let [mx, my] = await mitte('p');
await P.mouse.dblclick(mx, my); await warte(500);
pruefe('A2 Doppelklick weckt den Notiz-Editor in der Form', (await editor('p').count()) === 1);
pruefe('A3 … und öffnet keinen Fokus', (await P.locator('.focus-sheet, [data-fokus-blatt]').count()) === 0);
await P.keyboard.press('End');
await P.keyboard.type(' sorgfältig');
await P.keyboard.press('Control+a'); await warte(150); await P.keyboard.press('Control+b'); await warte(150); await P.keyboard.press('End');
await warte(500);
let k = await karte('p');
pruefe('A4 Formatieren wie in Notizen (Strg+B: fett)', JSON.stringify(k.blocks ?? []).includes('"bold":true'), k.blocks);
pruefe('C1 der Klartext wird mitgeführt (für KI, Suche, Export)', k.text === 'Antrag prüfen sorgfältig', k.text);
await P.mouse.click(1100, 700); await warte(700);
pruefe('A5 abgewählt schläft der Editor wieder; der Text bleibt fett', (await editor('p').count()) === 0
  && (await P.locator('.react-flow__node[data-id="p"] .shape-ruhend strong, .react-flow__node[data-id="p"] .shape-ruhend [data-style-type="bold"], .react-flow__node[data-id="p"] .shape-ruhend b').count()) >= 1);

console.log('B  Mitwachsen');
const vorher = await karte('p');
[mx, my] = await mitte('p');
await P.mouse.dblclick(mx, my); await warte(400);
await P.keyboard.press('Control+End');
await P.keyboard.type(' und alle Unterlagen vollständig einsammeln, danach an die Fachabteilung weitergeben');
await P.keyboard.press('Enter'); await P.keyboard.type('- Rückfrage stellen'); await warte(700);
const gross = await karte('p');
const ueber = await P.evaluate(() => { const b = document.querySelector('.react-flow__node[data-id="p"] .shape-body'); return b.scrollHeight - b.clientHeight; });
pruefe('B1 der Schritt wächst mit seinem Text – nichts läuft über', gross.h > vorher.h + 40 && ueber <= 1, { vorher, gross, ueber });
await P.keyboard.press('Control+a'); await P.keyboard.type('Kurz'); await warte(700);
const klein = await karte('p');
pruefe('B2 weniger Text: zurück auf die eigene Größe', klein.h === 70 && klein.w === 150, klein);
await P.mouse.click(1100, 700); await warte(400);
const d0 = await karte('d');
[mx, my] = await mitte('d');
await P.mouse.dblclick(mx, my); await warte(400);
await P.keyboard.press('Control+End');
await P.keyboard.type(' Liegen alle Nachweise, Unterschriften und Anlagen zum Antrag vor?');
await warte(900);
const d1 = await karte('d');
const dUeber = await P.evaluate(() => { const b = document.querySelector('.react-flow__node[data-id="d"] .shape-body'); const i = b.querySelector('.shape-inhalt'); return i.scrollHeight <= b.clientHeight * 0.55; });
pruefe('B3 die Raute wächst in Höhe UND Breite, ihre Mitte bleibt', d1.h > d0.h + 30 && d1.w > d0.w && Math.abs((d1.x + d1.w / 2) - (d0.x + d0.w / 2)) < 2 && dUeber, { d0, d1, dUeber });
await P.screenshot({ path: path.join(SD, 'm435-formen.png') });
await P.mouse.click(1100, 700); await warte(400);

console.log('C  Klartext und Vortrag');
await P.mouse.click(1250, 800); await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter', { timeout: 5000 }); await warte(700);
let fett = false; let getippt = false;
for (let i = 0; i < 4; i += 1) {
  if (/Kurz/.test(await P.locator('.presenter .slide-shape-text').allInnerTexts().then((a) => a.join(' ')))) fett = true;
  const feld = P.locator('.presenter .slide-shape-input');
  if (!getippt && await feld.count() && /Start/.test(await feld.inputValue())) { await feld.fill('Ende'); getippt = true; }
  await P.mouse.click(5, 400); await P.keyboard.press('ArrowRight'); await warte(500);
}
pruefe('C2 im Vortrag steht Notiz-Text (Blöcke) als formatierter Text auf der Folie', fett);
await P.mouse.click(5, 400); await P.keyboard.press('Escape'); await warte(900);
const t = await karte('t');
pruefe('C3 schlichten Text im Vortrag ändern: gilt auch auf dem Board', getippt && t.text === 'Ende' && !t.blocks && (await P.locator('.react-flow__node[data-id="t"] .shape-ruhend').innerText()).trim() === 'Ende', { getippt, t });
await ctx.close();

console.log('D  Neue Form aus der Palette');
{
  const c2 = await browser.newContext({ locale: 'de-DE', viewport: { width: 1300, height: 820 } });
  await c2.addInitScript(([ns]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Ablauf', edges: [], drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
  }, [[]]);
  const Q = await c2.newPage();
  Q.on('pageerror', (e) => fehler.push(e.message));
  await Q.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await Q.waitForTimeout(1800);
  await Q.locator('.dock [aria-label="Objekt hinzufügen"]').click(); await Q.waitForSelector('.modul-palette'); await Q.waitForTimeout(300);
  const kachel = Q.locator('.modul-palette .modul-kachel', { hasText: /^Entscheidung$/ }).first();
  const da = await kachel.count();
  if (da) { await kachel.click(); await Q.waitForTimeout(700); await Q.keyboard.type('Freigabe?'); await Q.waitForTimeout(500); }
  await Q.waitForTimeout(1300);
  const neu = await Q.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.filter((n) => n.type === 'shape').map((n) => n.data.text));
  pruefe('D1 eine aus der Palette gelegte Entscheidung ist gleich bereit zum Tippen', da > 0 && neu.length === 1 && neu[0] === 'Freigabe?', { da, neu });
  await c2.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('E1 Hilfe und Umbau-Liste nennen M435', /M435/.test(hilfe) && /M435/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM435: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
