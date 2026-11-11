/**
 * M344 — Ruhiges Ziehen, Fanglinien, Tastatur auf dem Board.
 *
 *   A  Beim Ziehen wird die Karte nicht mehr vergrößert oder geneigt.
 *   B  Fanglinien: nahe an der Oberkante einer anderen Karte abgelegt → exakt bündig; Linie während
 *      des Ziehens; Strg legt frei ab.
 *   C  Tastatur: Alt+↓/↑ und Tab (nächste/vorige Karte), Strg+Pfeil (Richtung), Enter (hinein),
 *      Esc (heraus), Pfeile (verschieben), Strg+D, + − 0, V/P.
 *   D  Fokus: Alt+↓ blättert. · E Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m344-fang-tasten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4562;
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
const stand = () => ({
  boards: [{ id: 'b1', name: 'Fang', comments: [], edges: [], drawings: [], nodes: [
    { id: 'n1', type: 'note', width: 300, height: 140, autoFit: false, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ id: 'a', type: 'paragraph', content: 'Erste' }] } },
    { id: 'n2', type: 'note', width: 300, height: 140, autoFit: false, position: { x: 520, y: 37 }, data: { color: 'sky', blocks: [{ id: 'b', type: 'paragraph', content: 'Zweite' }] } },
    { id: 'n3', type: 'kanban', width: 320, height: 240, position: { x: 13, y: 420 }, data: { title: 'Aufgaben', items: [{ id: 'k1', text: 'Ticket', col: 0 }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand() });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  return { ctx, P };
}
const zoom = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const knoten = async (P) => { await P.waitForTimeout(1300); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes); };
const lage = async (P, id) => (await knoten(P)).find((n) => n.id === id).position;
const griff = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const gewaehlt = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id));
const leer = (P) => P.mouse.click(1380, 860).then(() => P.waitForTimeout(200));

console.log('\n════ A/B: ruhiges Ziehen und Fanglinien ════');
{
  const { ctx, P } = await seite();
  const z = await zoom(P);
  // n2 liegt 37 unter der Oberkante von n1 → 33 nach oben ziehen (4 daneben): rastet auf y = 0
  let g = await griff(P, 'n2');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 2, g[1] - 10 * z, { steps: 3 }); await P.mouse.move(g[0] + 2, g[1] - 36 * z, { steps: 5 }); await P.waitForTimeout(150);
  const unterwegs = await P.evaluate(() => {
    const n = document.querySelector('.react-flow__node[data-id="n2"]');
    return { zieht: n.classList.contains('dragging'), t: getComputedStyle(n.querySelector('.card-shell')).transform, linien: [...document.querySelectorAll('.fanglinie')].map((l) => l.className) };
  });
  await P.mouse.up();
  pruefe('A1 beim Ziehen bleibt die Karte unverändert (keine Vergrößerung, keine Neigung)', unterwegs.zieht && (unterwegs.t === 'none' || unterwegs.t === 'matrix(1, 0, 0, 1, 0, 0)'), JSON.stringify(unterwegs));
  pruefe('B1 während des Ziehens zeigt eine waagerechte Linie die Ausrichtung', unterwegs.linien.some((c) => /\bh\b/.test(c)), JSON.stringify(unterwegs.linien));
  let p = await lage(P, 'n2');
  pruefe('B2 abgelegt liegt die Oberkante EXAKT auf der der Nachbarkarte (y = 0)', p.y === 0, JSON.stringify(p));
  pruefe('B3 nach dem Ablegen sind die Linien weg', await P.evaluate(() => document.querySelectorAll('.fanglinie').length) === 0);
  // senkrecht: n3 (x = 13) nach links an die linke Kante von n1 (x = 0)
  await leer(P);
  g = await griff(P, 'n3');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] - 5 * z, g[1] + 1, { steps: 3 }); await P.mouse.move(g[0] - 12 * z, g[1] + 1, { steps: 4 }); await P.waitForTimeout(120);
  const senk = await P.evaluate(() => [...document.querySelectorAll('.fanglinie')].map((l) => l.className));
  await P.mouse.up();
  p = await lage(P, 'n3');
  pruefe('B4 linke Kanten bündig (x = 0), mit senkrechter Linie', p.x === 0 && senk.some((c) => /\bv\b/.test(c)), JSON.stringify({ p, senk }));
  const yVorStrg = (await lage(P, 'n2')).y;
  // Strg: frei ablegen — 4 neben der Kante bleibt 4 daneben
  await leer(P);
  g = await griff(P, 'n2');
  await P.keyboard.down('Control');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0], g[1] + 3 * z, { steps: 2 }); await P.mouse.move(g[0], g[1] + 7 * z, { steps: 3 }); await P.waitForTimeout(120);
  const mitStrg = await P.evaluate(() => document.querySelectorAll('.fanglinie').length);
  await P.mouse.up(); await P.keyboard.up('Control');
  p = await lage(P, 'n2');
  pruefe('B5 mit Strg gezogen rastet nichts ein (die Karte bleibt wenige Punkte neben der Kante)', mitStrg === 0 && yVorStrg === 0 && p.y > 1 && p.y < 9, JSON.stringify({ mitStrg, p }));
  await ctx.close();
}

console.log('\n════ C: Tastatur ════');
{
  const { ctx, P } = await seite();
  await leer(P);
  await P.keyboard.press('Alt+ArrowDown'); await P.waitForTimeout(350);
  const erste = await gewaehlt(P);
  await P.keyboard.press('Alt+ArrowDown'); await P.waitForTimeout(350);
  const zweite = await gewaehlt(P);
  await P.keyboard.press('Alt+ArrowUp'); await P.waitForTimeout(350);
  pruefe('C1 Alt+↓ wählt die erste Karte, dann die nächste; Alt+↑ geht zurück', erste.join() === 'n1' && zweite.join() === 'n2' && (await gewaehlt(P)).join() === 'n1', JSON.stringify([erste, zweite]));
  await P.keyboard.press('Tab'); await P.waitForTimeout(350);
  const nachTab = await gewaehlt(P);
  await P.keyboard.press('Shift+Tab'); await P.waitForTimeout(350);
  pruefe('C2 Tab springt zur nächsten Karte, Umschalt+Tab zurück', nachTab.join() === 'n2' && (await gewaehlt(P)).join() === 'n1', JSON.stringify(nachTab));
  await P.keyboard.press('Control+ArrowDown'); await P.waitForTimeout(350);
  const unten = await gewaehlt(P);
  await P.keyboard.press('Control+ArrowUp'); await P.waitForTimeout(350);
  await P.keyboard.press('Control+ArrowRight'); await P.waitForTimeout(350);
  pruefe('C3 Strg+Pfeil springt in die Richtung: unten das Kanban, rechts die zweite Notiz', unten.join() === 'n3' && (await gewaehlt(P)).join() === 'n2', JSON.stringify(unten));
  // Pfeile verschieben die gewählte Karte
  const v0 = await lage(P, 'n2');
  await P.keyboard.press('ArrowRight'); await P.keyboard.press('ArrowRight'); await P.waitForTimeout(200);
  const v1 = await lage(P, 'n2');
  pruefe('C4 die Pfeiltasten verschieben die gewählte Karte', v1.x > v0.x && v1.y === v0.y, JSON.stringify({ v0, v1 }));
  // Enter → schreiben → Esc → Karte bleibt gewählt
  await P.keyboard.press('Alt+ArrowUp'); await P.waitForTimeout(350);
  await P.keyboard.press('Enter'); await P.waitForTimeout(900);
  const imText = await P.evaluate(() => !!document.activeElement?.closest('.react-flow__node[data-id="n1"] [contenteditable="true"]'));
  await P.keyboard.type(' dazu'); await P.waitForTimeout(300);
  const text = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="n1"] .bn-inline-content').textContent);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  const raus = await P.evaluate(() => !document.activeElement?.closest('[contenteditable="true"]'));
  pruefe('C5 Enter setzt den Cursor ans Ende der Notiz — man schreibt sofort weiter', imText && text === 'Erste dazu', JSON.stringify({ imText, text }));
  pruefe('C6 Esc verlässt den Text, die Karte bleibt gewählt', raus && (await gewaehlt(P)).join() === 'n1', JSON.stringify(await gewaehlt(P)));
  // Strg+D
  const n0 = (await knoten(P)).length;
  await P.keyboard.press('Control+d'); 
  pruefe('C7 Strg+D dupliziert die gewählte Karte', (await knoten(P)).length === n0 + 1);
  // Zoom
  const z0 = await zoom(P);
  await P.keyboard.press('-'); await P.waitForTimeout(400);
  const z1 = await zoom(P);
  await P.keyboard.press('0'); await P.waitForTimeout(500);
  pruefe('C8 − zoomt heraus, 0 stellt 100 % her', z1 < z0 && Math.abs(await zoom(P) - 1) < 0.01, JSON.stringify({ z0, z1 }));
  // Werkzeug
  await P.keyboard.press('p'); await P.waitForTimeout(300);
  const stift = await P.locator('.draw-palette').count();
  await P.keyboard.press('v'); await P.waitForTimeout(300);
  pruefe('C9 P wählt den Stift, V zurück zur Auswahl', stift === 1 && await P.locator('.draw-palette').count() === 0);

  console.log('\n════ D: Fokus ════');
  await leer(P);
  await P.locator('.react-flow__node[data-id="n3"] .card-grip').click({ force: true }); await P.waitForTimeout(400);
  const vorEnter = await gewaehlt(P);
  await P.keyboard.press('Enter'); await P.waitForTimeout(900);
  const fokus1 = await P.evaluate(() => document.querySelector('.react-flow__node.pn-focused')?.dataset.id ?? null);
  await P.keyboard.press('Alt+ArrowDown'); await P.waitForTimeout(900);
  const fokus2 = await P.evaluate(() => document.querySelector('.react-flow__node.pn-focused')?.dataset.id ?? null);
  pruefe('D1 Enter auf einem Modul öffnet es im Fokus', vorEnter.join() === 'n3' && fokus1 === 'n3', JSON.stringify({ vorEnter, fokus1 }));
  pruefe('D2 Alt+↓ blättert im Fokus zur nächsten Karte', !!fokus2 && fokus2 !== fokus1, String(fokus2));
  await ctx.close();
}

console.log('\n════ E: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('E1 „Was ist neu" nennt M344, die Tabelle kennt die neuen Kürzel', js.includes('(M344)') && js.includes('zur Karte in dieser Richtung springen') && js.includes('ohne Fanglinien frei ablegen'));

await browser.close();
app.close();
console.log(`\nm344-fang-tasten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
