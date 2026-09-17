/**
 * M298 — Kachel-Ansicht für große Module.
 *
 *   A  Kanban als Kachel: Typ, Titel, Kennzahlen; Größe gemerkt; kein Inhalt.
 *   B  „Öffnen" zeigt das ganze Modul im Fokus, Esc führt zur Kachel zurück
 *      — ohne dass die Kachel gewachsen wäre.
 *   C  „Ausklappen" bringt die alte Größe zurück; das ⋯ der Kanban-Kopfzeile
 *      klappt wieder zusammen.
 *   D  Zeitplan, Wochenplan, Protokoll-Reihe haben eigene Kennzahlen; eine
 *      Notiz bietet die Kachel nicht an.
 */
// Läuft aus dem Repository: `node pruefungen/m298-kachel.mjs`
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
const PORT = 4518;
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
const TAG = 86_400_000;
const iso = (n) => new Date(Date.now() + n * TAG).toISOString().slice(0, 10);

async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([iso1, iso3, isoM2, iso20, heute]) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    const nodes = [
      { id: 'k1', type: 'kanban', position: { x: 40, y: 40 }, width: 720, height: 420, data: { title: 'Referat 31', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
        { id: 't1', text: 'Vergabeakte prüfen', col: 0, due: iso1 }, { id: 't2', text: 'Antwort Müller', col: 0, due: isoM2 }, { id: 't3', text: 'Protokoll', col: 1 }, { id: 't4', text: 'Aktenplan', col: 2 } ] } },
      { id: 'g1', type: 'gantt', position: { x: 40, y: 520 }, width: 600, height: 260, data: { title: 'E-Akte Einführung', rows: [
        { id: 'r1', name: 'Ist-Analyse', start: isoM2, end: iso3, progress: 50 }, { id: 'r2', name: 'Schulung', start: iso3, end: iso20, progress: 0 } ] } },
      { id: 'w1', type: 'week', position: { x: 800, y: 40 }, width: 620, height: 440, data: { title: 'Dienstplan', days: 5, from: 480, to: 1080, entries: [
        { id: 'e1', day: 0, start: 540, dur: 60, text: 'Frühbesprechung' }, { id: 'e2', day: 2, start: 600, dur: 120, text: 'Sprechstunde' } ] } },
      { id: 'm1', type: 'minutes', position: { x: 800, y: 520 }, width: 420, height: 400, data: { title: 'Jour fixe', entries: [
        { id: 's1', date: heute, decisions: [{ id: 'd1', text: 'Beschluss A' }] }, { id: 's2', date: isoM2 } ] } },
      { id: 'n1', type: 'note', position: { x: 1300, y: 520 }, width: 240, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Notiz' }] } },
    ];
    const state = {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board',
    };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, [iso(1), iso(3), iso(-2), iso(20), iso(0)]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
// Der Speicher schreibt gebündelt — vor dem Lesen kurz warten
const knoten = async (P, id) => { await P.waitForTimeout(1300); return P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id), id); };
const waehle = async (P, id) => {
  await P.mouse.click(1380, 860); // Auswahl lösen
  await P.waitForTimeout(150);
  await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true });
  await P.waitForTimeout(400);
};
const alsKachel = async (P, id) => {
  await waehle(P, id);
  await P.locator('.sel-toolbar [aria-label="Mehr"]').click();
  await P.waitForTimeout(300);
  await P.locator('.sel-more-menu [aria-label="Als Kachel zeigen"]').click();
  await P.waitForTimeout(700);
};

console.log('════ A: Kanban als Kachel ════');
const { ctx, P } = await seite();
await alsKachel(P, 'k1');
const kachel = P.locator('.react-flow__node[data-id="k1"] .card-body.kachel');
pruefe('A1 die Karte zeigt die Kachel statt der Spalten', (await kachel.count()) === 1 && (await P.locator('.react-flow__node[data-id="k1"] .kanban-cols').count()) === 0);
pruefe('A2 Typ und Titel', (await kachel.locator('.kachel-typ').textContent()) === 'Kanban' && (await kachel.locator('.kachel-titel').textContent()) === 'Referat 31');
const zeilen = await kachel.locator('.kachel-zeile').allTextContents();
pruefe('A3 Kennzahlen: Tickets je Spalte, Überfälliges, nächste Frist', /Offen 2 · In Arbeit 1 · Erledigt 1/.test(zeilen[0]) && zeilen.some((z) => /1 überfällig/.test(z)) && zeilen.some((z) => /Nächste Frist/.test(z) && /Vergabeakte/.test(z)), JSON.stringify(zeilen));
const hoehe = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="k1"]').getBoundingClientRect().height);
pruefe('A4 die Kachel ist klein', hoehe < 220, `hoehe=${hoehe}`);
let k = await knoten(P, 'k1');
pruefe('A5 gespeichert: kachel an, alte Größe gemerkt', k.kachel === true && k.kachelMass?.w === 720 && k.kachelMass?.h === 420 && k.width === 300, JSON.stringify({ kachel: k.kachel, mass: k.kachelMass, w: k.width, h: k.height }));
await P.screenshot({ path: `${SD}/m298-a-kachel.png` });

console.log('════ B: Öffnen im Fokus ════');
await kachel.locator('.kachel-knopf', { hasText: 'Öffnen' }).click();
await P.waitForTimeout(900);
pruefe('B1 „Öffnen" zeigt das ganze Kanban im Fokus', (await P.locator('.app.focus-mode .pn-focused .kanban-cols').count()) === 1);
await P.keyboard.press('Escape');
await P.waitForTimeout(900);
pruefe('B2 Esc führt zur Kachel zurück', (await P.locator('.react-flow__node[data-id="k1"] .card-body.kachel').count()) === 1);
k = await knoten(P, 'k1');
pruefe('B3 … und die Kachel ist nicht gewachsen', k.height == null || k.height < 220, JSON.stringify({ h: k.height }));

console.log('════ C: Ausklappen und wieder zusammenklappen ════');
await P.locator('.react-flow__node[data-id="k1"] .kachel-knopf', { hasText: 'Ausklappen' }).click();
await P.waitForTimeout(700);
k = await knoten(P, 'k1');
pruefe('C1 „Ausklappen" bringt die alte Größe zurück', !k.kachel && k.width === 720 && k.height === 420 && (await P.locator('.react-flow__node[data-id="k1"] .kanban-cols').count()) === 1, JSON.stringify({ kachel: k.kachel, w: k.width, h: k.height }));
await P.locator('.react-flow__node[data-id="k1"]').hover();
await P.locator('.react-flow__node[data-id="k1"] .k-mehr').click({ force: true });
await P.locator('.k-menu-kachel').click();
await P.waitForTimeout(700);
pruefe('C2 das ⋯ der Kanban-Kopfzeile klappt zur Kachel zusammen', (await P.locator('.react-flow__node[data-id="k1"] .card-body.kachel').count()) === 1);

console.log('════ D: Die anderen Module und eine Notiz ════');
for (const [id, typ, muster] of [['g1', 'Zeitplan', /2 Vorgänge/], ['w1', 'Wochenplan', /2 Blöcke in 5 Spalten/], ['m1', 'Protokoll-Reihe', /2 Sitzungen/]]) {
  await alsKachel(P, id);
  const el = P.locator(`.react-flow__node[data-id="${id}"] .card-body.kachel`);
  const typText = await el.locator('.kachel-typ').textContent().catch(() => '');
  const z = await el.locator('.kachel-zeile').allTextContents().catch(() => []);
  pruefe(`D ${typ}: Kachel mit Kennzahlen`, typText === typ && z.some((t) => muster.test(t)), JSON.stringify({ typText, z }));
}
pruefe('D Protokoll zählt die Beschlüsse', (await P.locator('.react-flow__node[data-id="m1"] .kachel-zeile').allTextContents()).some((t) => /1 Beschluss/.test(t)));
await waehle(P, 'n1');
await P.locator('.sel-toolbar [aria-label="Mehr"]').click();
await P.waitForTimeout(300);
pruefe('D eine Notiz bietet die Kachel nicht an', (await P.locator('.sel-more-menu [aria-label="Als Kachel zeigen"]').count()) === 0);
await P.keyboard.press('Escape');
await P.screenshot({ path: `${SD}/m298-d-alle.png` });
await ctx.close();

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
