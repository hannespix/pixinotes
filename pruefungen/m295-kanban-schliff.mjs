/**
 * M295 — Kanban entrümpelt.
 *
 * Die dichteste Karte trug am meisten: sechs Symbolknöpfe im Kopf, Ticket-
 * Text buchstabenweise umgebrochen, Tags doppelt, bei ausgewählter Karte die
 * Aktionen aller Tickets, Panels in der Karte, Erledigtes von heute so groß
 * wie von vor sechs Tagen. Diese Reihe prüft:
 *   A  Kopfzeile: nur Filter und ⋯; das ⋯-Menü hat die Handgriffe; die
 *      Statuszeile zeigt laufende Automatiken und den Archiv-Zähler.
 *   B  Ticket-Zeile: Text in voller Breite, Tag nur als Chip, Aktionen
 *      nicht bei bloßer Auswahl der Karte.
 *   C  Erledigt-Spalte: Heute · Diese Woche · Älter, „Älter" zugeklappt,
 *      Gruppe archivieren.
 *   D  Kompakte Tickets (persistiert), Archiv und Einsammeln als Fenster.
 */
// Läuft aus dem Repository: `node pruefungen/m295-kanban-schliff.mjs`
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
const PORT = 4515;
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
const now = new Date();
const wt = (now.getDay() + 6) % 7; // Montag = 0
const heute = new Date(now.getTime() - 3_600_000).toISOString();
const montag = new Date(now.getFullYear(), now.getMonth(), now.getDate() - wt, 8, 0).toISOString();
const alt = new Date(now.getTime() - 20 * TAG).toISOString();
const erwarteteGruppen = wt === 0 ? 2 : 3; // am Montag fällt „Diese Woche" mit „Heute" zusammen

async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([heute, montag, alt]) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    const items = [
      { id: 't1', text: 'Vergabeakte prüfen #vergabe', col: 0, due: '2026-12-01', who: 'Anna Berg', prio: 1, subs: [{ id: 's1', text: 'Unterlagen', done: true }, { id: 's2', text: 'Prüfvermerk' }] },
      { id: 't2', text: 'Sitzungsraum buchen', col: 0, prio: 3 },
      { id: 't3', text: 'Kickoff-Protokoll versenden', col: 1, who: 'Anna Berg' },
      { id: 'd1', text: 'Aktenplan aktualisieren', col: 2, erledigtAm: heute },
      { id: 'd2', text: 'Telefonliste pflegen', col: 2, erledigtAm: montag },
      { id: 'd3', text: 'Altakten aussondern', col: 2, erledigtAm: alt },
      { id: 'd4', text: 'Beschaffung Monitore', col: 2, erledigtAm: alt },
      { id: 'd5', text: 'Jahresstatistik melden', col: 2, erledigtAm: alt },
    ];
    const data = { title: 'Referat 31', cols: ['Offen', 'In Arbeit', 'Erledigt'], items, archiv: [{ id: 'a1', text: 'Dienstplan Juli', col: 2, erledigtAm: alt, archiviertAm: alt }], autoArchiv: true, autoArchivTage: 30, autoCollect: false };
    const state = {
      boards: [{ id: 'b0', name: 'Aufgaben', edges: [], drawings: [], comments: [], nodes: [{ id: 'k1', type: 'kanban', position: { x: 60, y: 60 }, width: 720, data }] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board',
    };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, [heute, montag, alt]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const gespeichert = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data);

console.log('════ A: Kopfzeile, Menü, Statuszeile ════');
{
  const { ctx, P } = await seite();
  const knoepfe = await P.locator('.kanban-head .kanban-addcol').count();
  pruefe('A1 die Kopfzeile hat genau zwei Knöpfe: Filter und ⋯', knoepfe === 2, `knoepfe=${knoepfe}`);
  pruefe('A2 die Statuszeile zeigt das Archiv mit Zähler und Automatik', (await P.locator('.kanban-status .k-archiv-head').textContent()).includes('1') && /nach 30 Tagen/.test(await P.locator('.kanban-status').textContent()));
  pruefe('A3 kein Auto-Einsammeln-Chip, solange es aus ist', (await P.locator('.kanban-status .k-status-chip').count()) === 1);
  await P.locator('.k-mehr').click({ force: true });
  await P.waitForTimeout(300);
  const menu = P.locator('.k-menu');
  pruefe('A4 das ⋯-Menü öffnet als Fenster über der App', (await menu.count()) === 1 && (await P.evaluate(() => document.querySelector('.k-menu')?.parentElement === document.body)));
  const text = await menu.textContent();
  pruefe('A5 … mit Einsammeln, Automatik, Archiv, Kompakt und Spalte', /einsammeln/i.test(text) && /Auto-Einsammeln/.test(text) && /Archiv \(1\)/.test(text) && /Kompakte Tickets/.test(text) && /Spalte hinzufügen/.test(text), text);
  pruefe('A6 „Erledigte archivieren (5)" bietet die ganze Spalte an', /Erledigte archivieren \(5\)/.test(text), text);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(200);
  pruefe('A7 Esc schließt das Menü', (await P.locator('.k-menu').count()) === 0);
  await P.locator('.k-mehr').click({ force: true });
  await P.locator('.k-menu button', { hasText: 'Auto-Einsammeln einschalten' }).click();
  await P.waitForTimeout(500);
  pruefe('A8 Auto-Einsammeln aus dem Menü erscheint in der Statuszeile', (await P.locator('.kanban-status').textContent()).includes('Auto-Einsammeln'));
  await P.screenshot({ path: `${SD}/m295-a-kopf.png` });
  await ctx.close();
}

console.log('════ B: Ticket-Zeile ════');
{
  const { ctx, P } = await seite();
  const t1 = P.locator('.kanban-item[data-kid="t1"]');
  const textEl = t1.locator('.kanban-item-text');
  pruefe('B1 der Tag steht nicht mehr im Text', !(await textEl.textContent()).includes('#vergabe'), await textEl.textContent());
  pruefe('B2 … sondern als Chip', (await t1.locator('.k-label', { hasText: 'vergabe' }).count()) === 1);
  const breite = await P.evaluate(() => {
    const it = document.querySelector('.kanban-item[data-kid="t2"]');
    const tx = it.querySelector('.kanban-item-text');
    const fs = parseFloat(getComputedStyle(tx).fontSize) || 12;
    return { item: it.getBoundingClientRect().width, text: tx.getBoundingClientRect().width, zeilen: Math.round(tx.getBoundingClientRect().height / (fs * 1.4)) };
  });
  pruefe('B3 der Text nutzt die Breite des Tickets („Sitzungsraum buchen" auf einer Zeile)', breite.text > breite.item * 0.6 && breite.zeilen <= 1, JSON.stringify(breite));
  // Karte auswählen → die Aktionen der Tickets bleiben verborgen
  await P.locator('.react-flow__node').first().click({ position: { x: 40, y: 8 } });
  await P.waitForTimeout(300);
  await P.mouse.move(5, 5);
  await P.waitForTimeout(200);
  const op = await P.evaluate(() => getComputedStyle(document.querySelector('.kanban-item[data-kid="t3"] .kanban-item-actions')).opacity);
  pruefe('B4 bei ausgewählter Karte zeigen die Tickets ihre Aktionen NICHT', Number(op) === 0, `opacity=${op}`);
  await P.locator('.kanban-item[data-kid="t3"]').hover();
  await P.waitForTimeout(250);
  const op2 = await P.evaluate(() => getComputedStyle(document.querySelector('.kanban-item[data-kid="t3"] .kanban-item-actions')).opacity);
  pruefe('B5 … beim Zeigen aufs Ticket schon', Number(op2) === 1, `opacity=${op2}`);
  await ctx.close();
}

console.log('════ C: Erledigt nach Zeit ════');
{
  const { ctx, P } = await seite();
  const koepfe = await P.locator('.k-done-head').count();
  pruefe(`C1 die Erledigt-Spalte hat ${erwarteteGruppen} Zeitgruppen`, koepfe === erwarteteGruppen, `koepfe=${koepfe}`);
  const aelter = P.locator('.k-done-head[data-done-gruppe="aelter"]');
  pruefe('C2 „Älter" zählt 3 und ist zugeklappt', (await aelter.textContent()).includes('3') && (await aelter.locator('.k-done-toggle').getAttribute('aria-expanded')) === 'false');
  pruefe('C3 die alten Tickets sind nicht zu sehen', (await P.locator('.kanban-item[data-kid="d3"]').count()) === 0);
  pruefe('C4 das heutige schon', (await P.locator('.kanban-item[data-kid="d1"]').count()) === 1);
  await aelter.locator('.k-done-toggle').click();
  await P.waitForTimeout(200);
  pruefe('C5 Aufklappen zeigt sie', (await P.locator('.kanban-item[data-kid="d3"]').count()) === 1);
  await aelter.hover();
  await aelter.locator('.k-done-archiv').click();
  await P.waitForTimeout(600);
  const g = await gespeichert(P);
  pruefe('C6 die Gruppe „Älter" lässt sich mit einem Griff archivieren', g.archiv.length === 4 && !g.items.some((it) => it.id === 'd3'), JSON.stringify(g.archiv.map((a) => a.id)));
  pruefe('C7 der Zähler in der Statuszeile steht auf 4', (await P.locator('.kanban-status .k-head-count').textContent()) === '4');
  await P.screenshot({ path: `${SD}/m295-c-gruppen.png` });
  await ctx.close();
}

console.log('════ D: Kompakt und Fenster ════');
{
  const { ctx, P } = await seite();
  await P.locator('.k-mehr').click({ force: true });
  await P.locator('.k-menu button', { hasText: 'Kompakte Tickets' }).click();
  await P.waitForTimeout(500);
  pruefe('D1 Kompakt-Modus: die Karte trägt die Klasse', (await P.locator('.kanban-body.k-kompakt').count()) === 1);
  pruefe('D2 … Labels und Chips sind ausgeblendet', (await P.evaluate(() => getComputedStyle(document.querySelector('.kanban-item[data-kid="t1"] .k-labels')).display)) === 'none');
  pruefe('D3 … und der Zustand ist gespeichert', (await gespeichert(P)).kompakt === true);
  await P.locator('.k-mehr').click({ force: true });
  await P.locator('.k-menu-archiv').click();
  await P.waitForTimeout(400);
  const imBody = await P.evaluate(() => {
    const el = document.querySelector('.k-archiv-panel');
    return !!el && !!el.closest('.ticket-modal-backdrop') && el.closest('.ticket-modal-backdrop').parentElement === document.body && !el.closest('.react-flow__node');
  });
  pruefe('D4 das Archiv öffnet als Fenster über der App, nicht in der Karte', imBody);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);
  pruefe('D5 Esc schließt es', (await P.locator('.k-archiv-panel').count()) === 0);
  await P.locator('.k-mehr').click({ force: true });
  await P.locator('.k-menu button', { hasText: 'Einsammeln konfigurieren' }).click();
  await P.waitForTimeout(400);
  pruefe('D6 Einsammeln konfigurieren ebenso', (await P.evaluate(() => !!document.querySelector('body > .ticket-modal-backdrop .collect-panel'))));
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);
  pruefe('D7 … und schließt mit Esc', (await P.locator('.collect-panel').count()) === 0);
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
