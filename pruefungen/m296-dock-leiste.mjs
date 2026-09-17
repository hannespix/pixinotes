/**
 * M296 — Dock, Menüs und Auswahl-Leiste entrümpelt.
 *
 *   A  ＋-Menü: fünf Einträge und „Weitere Module"; aufgeklappt kommt der Rest.
 *   B  ⋯-Menü: „Aufräumen" ist ein Knopf, die Varianten liegen dahinter,
 *      der Physik-Schalter ist weg (⚙ → Bedienung).
 *   C  Auswahl-Leiste: sechs Elemente; Kopieren und Schrift liegen im ⋯.
 *   D  Sprechblase verschwindet bei einem Tastendruck.
 *   E  Minimap erst ab zehn Karten; Rechtliches am Telefon nicht mehr unter dem Dock.
 */
// Läuft aus dem Repository: `node pruefungen/m296-dock-leiste.mjs`
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
const PORT = 4516;
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

/** Board mit n Notizen (Starter-Umgebung ist zu groß und zu wechselhaft) */
const seedBoard = (n) => {
  const nodes = [];
  for (let i = 0; i < n; i += 1) {
    nodes.push({ id: `n${i}`, type: 'note', width: 240, position: { x: 80 + (i % 4) * 300, y: 80 + Math.floor(i / 4) * 220 },
      data: { color: 'yellow', blocks: [{ type: 'paragraph', content: `Notiz ${i + 1}` }] } });
  }
  return {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes }, { id: 'b1', name: 'Zweites', edges: [], drawings: [], comments: [], nodes: [] }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0', 'b1'] }] }],
    activeId: 'b0', view: 'board',
  };
};
async function seite({ karten = 3, viewport = { width: 1440, height: 900 }, mobil = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobil, hasTouch: mobil });
  await ctx.addInitScript((state) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, seedBoard(karten));
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}

console.log('════ A: ＋-Menü ════');
{
  const { ctx, P } = await seite();
  await P.locator('[aria-label="Objekt hinzufügen"]').click();
  await P.waitForTimeout(300);
  const eintraege = await P.locator('.dock-menu > button').count();
  const labels = await P.locator('.dock-menu .dock-menu-label').count();
  pruefe('A1 fünf Einträge plus „Weitere Module", keine Gruppen-Überschriften', eintraege === 6 && labels === 0, `eintraege=${eintraege} labels=${labels}`);
  const texte = await P.locator('.dock-menu > button').allTextContents();
  pruefe('A2 die fünf: Notiz, Kanban, Rechen-Tabelle, Datei oder Bild, Zeitplan', ['Notiz', 'Kanban', 'Rechen-Tabelle', 'Datei oder Bild', 'Zeitplan'].every((t) => texte.some((x) => x.includes(t))), JSON.stringify(texte));
  const hoehe = await P.evaluate(() => document.querySelector('.dock-menu').getBoundingClientRect().height);
  pruefe('A3 das Menü ist kürzer als der halbe Bildschirm', hoehe < 450, `hoehe=${hoehe}`);
  await P.locator('.dock-menu-mehr').click();
  await P.waitForTimeout(300);
  const mehr = await P.locator('.dock-menu > button').count();
  pruefe('A4 „Weitere Module" klappt den Rest auf', mehr > 18 && (await P.locator('.dock-menu .dock-menu-label').count()) >= 4, `mehr=${mehr}`);
  await P.screenshot({ path: `${SD}/m296-a-plus.png` });
  await P.keyboard.press('Escape');
  await ctx.close();
}

console.log('════ B: ⋯-Menü des Docks ════');
{
  const { ctx, P } = await seite({ karten: 4 });
  await P.locator('.dock [aria-label="Mehr"]').click();
  await P.waitForTimeout(300);
  const text = await P.locator('.dock-menu-more').textContent();
  pruefe('B1 „Aufräumen" ist ein Knopf', (await P.locator('.dock-menu-more [aria-label="Board aufräumen"]').count()) === 1 && /Aufräumen/.test(text));
  pruefe('B2 die Varianten liegen dahinter', /Anordnen & Hintergrund/.test(text), text);
  pruefe('B3 kein Physik-Schalter mehr im Dock', !/Physik/.test(text), text);
  await P.locator('.dock-menu-more [aria-label="Board aufräumen"]').click();
  await P.waitForTimeout(1600);
  const toast = await P.locator('.toast.show').textContent().catch(() => '');
  pruefe('B4 Aufräumen ordnet sofort mit der Voreinstellung', /Aufgeräumt/.test(toast), toast);
  await ctx.close();
}

console.log('════ C: Auswahl-Leiste ════');
{
  const { ctx, P } = await seite();
  await P.locator('.react-flow__node').first().click({ position: { x: 30, y: 6 } });
  await P.waitForTimeout(500);
  const knoepfe = await P.locator('.sel-toolbar button:not(.sel-menu-fixed button)').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));
  pruefe('C1 sechs Elemente: Duplizieren, Verschieben, Teilen, Mehr, Löschen + Zähler', JSON.stringify(knoepfe) === JSON.stringify(['Duplizieren', 'Verschieben', 'Teilen', 'Mehr', '']), JSON.stringify(knoepfe));
  pruefe('C2 kein „Kopieren" und keine Schrift-Taste in der Leiste', !knoepfe.some((k) => /Kopieren|Schrift/.test(k)));
  await P.locator('.sel-toolbar [aria-label="Mehr"]').click();
  await P.waitForTimeout(300);
  const mehr = await P.locator('.sel-more-menu').textContent();
  pruefe('C3 im ⋯ liegen „Formatiert kopieren" und „Schrift & Größe"', /Formatiert kopieren/.test(mehr) && /Schrift & Größe/.test(mehr), mehr);
  await P.locator('.sel-more-menu [aria-label="Schrift & Größe"]').click();
  await P.waitForTimeout(300);
  pruefe('C4 „Schrift & Größe" öffnet das Schrift-Menü', (await P.locator('.sel-font-menu').count()) === 1);
  await P.screenshot({ path: `${SD}/m296-c-leiste.png` });
  await P.keyboard.press('Escape');
  await ctx.close();
}

console.log('════ D: Sprechblase ════');
{
  const { ctx, P } = await seite();
  await P.locator('.react-flow__node').first().click({ position: { x: 30, y: 6 } });
  await P.waitForTimeout(400);
  await P.locator('.sel-toolbar [aria-label="Mehr"]').hover();
  await P.waitForTimeout(700);
  pruefe('D1 die Sprechblase erscheint beim Zeigen', (await P.locator('.tipbox').count()) === 1);
  await P.keyboard.press('Alt+T');
  await P.waitForTimeout(400);
  pruefe('D2 … und verschwindet beim Tastendruck (Aufgaben-Zentrale offen)', (await P.locator('.tipbox').count()) === 0);
  await ctx.close();
}

console.log('════ E: Minimap und Telefon ════');
{
  const { ctx, P } = await seite({ karten: 4 });
  pruefe('E1 vier Karten: keine Minimap', (await P.locator('.pn-minimap').count()) === 0);
  await ctx.close();
  const b = await seite({ karten: 12 });
  pruefe('E2 zwölf Karten: Minimap da', (await b.P.locator('.pn-minimap').count()) === 1);
  await b.ctx.close();
  const c = await seite({ viewport: { width: 390, height: 844 }, mobil: true });
  const legal = await c.P.evaluate(() => { const el = document.querySelector('.legal-corner'); return el ? getComputedStyle(el).display : 'fehlt'; });
  pruefe('E3 am Telefon liegen Impressum/Datenschutz nicht auf der Fläche', legal === 'none' || legal === 'fehlt', legal);
  await c.ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
