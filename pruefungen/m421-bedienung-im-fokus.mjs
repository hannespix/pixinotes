/**
 * M421 — Bedienung nur im Fokus.
 *
 * Gewünscht: „Das UI bei den Ideabubbles etc. immer nur einblenden, wenn das Modul im Fokus ist. Diesen Ansatz bitte
 * für alle Module mit sichtbarem UI, außer es ist wichtig, dass Bestandteile des UIs immer angezeigt werden …
 * Dann wird es sleeker und cleaner."
 *
 *   A  In Ruhe zeigt jede Karte nur Inhalt: Werkzeuge, Eingabezeilen, Blättern und Schritte sind unsichtbar —
 *      Titel, Daten, Spaltenköpfe, Balken, Zellen bleiben.
 *   B  Nichts springt: Die Bedienung behält ihren Platz, Inhalt liegt markiert genau dort wie in Ruhe.
 *   C  Markieren (ein Klick in die Karte) blendet sofort ein — nur bei dieser Karte.
 *   D  Zeiger: beim Überfahren blitzt nichts auf; ruht der Zeiger, kommt die Bedienung. Tastatur-Fokus genügt auch.
 *   E  Ausnahmen (Zustand ist Inhalt): offene Abstimmung, laufende Zeiterfassung, gesetzter Filter.
 *   F  Finger: Unsichtbares fängt keinen Tipp; antippen markiert und blendet ein.
 *   G  Präsentation zeigt alles.
 *   H  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m421-bedienung-im-fokus.mjs`
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
const PORT = 4757;
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
const heute = new Date().toISOString().slice(0, 10);
const plus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const nodes = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Notiz' }, { type: 'paragraph', content: 'Ein ruhiger Auftritt mit großen Flächen.' }, { type: 'checkListItem', content: 'Angebot prüfen' }] } },
  { id: 'k1', type: 'kanban', position: { x: 340, y: 0 }, width: 420, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße', col: 1 }] } },
  { id: 'g1', type: 'gantt', width: 560, height: 260, position: { x: 800, y: 0 }, data: { title: 'Zeitplan', dayWidth: 24, rows: [{ id: 'r1', name: 'Planung', start: heute, end: plus(6), color: '#4f7cff' }, { id: 'r2', name: 'Bau', start: plus(5), end: plus(14), color: '#3fa564' }] } },
  { id: 'c1', type: 'calendar', width: 430, height: 340, position: { x: 1400, y: 0 }, data: {} },
  { id: 'b1', type: 'bubbles', width: 560, height: 440, position: { x: 0, y: 380 }, data: { title: 'Ideen', frage: 'Was verbessern wir?', ideen: { i1: { text: 'Mehr Licht', von: 'g:x', t: 1 }, i2: { text: 'Sitzecke', von: 'g:x', t: 2 }, i3: { text: 'Kaffee', von: 'g:y', t: 3 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } },
  { id: 'w1', type: 'week', width: 620, height: 440, position: { x: 600, y: 380 }, data: { title: 'Wochenplan', days: 5, from: 480, to: 1020, entries: [{ id: 'e1', day: 0, start: 540, dur: 90, text: 'Jour fixe', color: 0 }] } },
  { id: 't1', type: 'time', width: 460, height: 380, position: { x: 1260, y: 380 }, data: { title: 'Zeiterfassung', segs: [] } },
  { id: 'm1', type: 'minutes', width: 380, height: 420, position: { x: 0, y: 860 }, data: { title: 'Jour fixe', color: 'white', entries: [{ id: 'x1', date: heute, blocks: [{ type: 'heading', props: { level: 3 }, content: 'TOP 1: Stand' }, { type: 'paragraph', content: 'Alles im Plan.' }] }], agenda: ['Stand'] } },
  { id: 'r1', type: 'sheet', width: 460, height: 300, position: { x: 420, y: 860 }, data: { title: 'Budget', cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1200', A3: 'Strom', B3: '180', A4: 'Summe', B4: '=SUMME(B2:B3)' }, cols: 4, rows: 6 } },
  { id: 'd1', type: 'mermaid', width: 356, height: 384, position: { x: 920, y: 860 }, data: { code: 'flowchart TD\n  A[Start] --> B[Ende]' } },
  { id: 'f1', type: 'shape', width: 150, height: 70, position: { x: 1320, y: 860 }, data: { shape: 'process', text: 'Form', color: '#eef2ff' } },
  { id: 'h1', type: 'htmlapp', width: 380, height: 300, position: { x: 1320, y: 980 }, data: { name: 'Rechner', size: 0 } },
  { id: 'p1', type: 'portal', width: 200, position: { x: 1520, y: 860 }, data: {} },
];

/** Was in Ruhe verschwindet – je Modul */
const BEDIENUNG = {
  k1: ['.kanban-add'],
  g1: ['.gantt-tools', '.gantt-addzeile'],
  c1: ['.cal-nav'],
  b1: ['.bub-schritte', '.bub-leiste', '.bub-gruppe-neu', '.bub-ansicht', '.bub-zahl'],
  t1: ['.time-rec', '.time-nav', '.time-empty'],
  m1: ['.minutes-nav', '.minutes-new', '.minutes-setup-btn', '.minutes-top-add', '.minutes-decision-add'],
  r1: ['.sheet-tools', '.sheet-fuss'],
  h1: ['.happ-size', '.happ-head .happ-btn'],
};
/** Was bleibt – Inhalt */
const INHALT = {
  k1: ['.kanban-col-head', '.kanban-card, .kanban-item, .kanban-col'],
  g1: ['.gantt-svg rect[data-row]', '.gantt-label'],
  c1: ['.cal-grid', '.cal-head'],
  b1: ['.bub-blase', '.bub-frage-feld'],
  t1: ['.time-title, .time-head'],
  m1: ['.minutes-head', '.minutes-meta input[type="date"]'],
  r1: ['.sheet-grid td'],
  h1: ['.happ-head'],
};
async function auf({ knoten = nodes, telefon = false, viewport = { width: 1900, height: 1400 } } = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport, deviceScaleFactor: 1, ...(telefon ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript((ns) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Alle Module', edges: [], drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board' } }));
  }, knoten);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(3000);
  return { ctx, P };
}
/** Deckkraft je Auswahl (kleinste über das Element und seine Vorfahren bis zur Karte) */
const deckkraft = (P, liste) => P.evaluate((liste) => {
  const out = {};
  for (const [id, sels] of Object.entries(liste)) for (const sel of sels) {
    const k = document.querySelector(`.react-flow__node[data-id="${id}"]`); const e = k?.querySelector(sel);
    if (!e) { out[`${id} ${sel}`] = null; continue; }
    let o = 1; for (let v = e; v && v !== k; v = v.parentElement) o = Math.min(o, +getComputedStyle(v).opacity);
    out[`${id} ${sel}`] = Math.round(o * 100) / 100;
  }
  return out;
}, liste);
const lage = (P) => P.evaluate(() => {
  const out = {};
  for (const [id, sel] of [['k1', '.kanban-col'], ['g1', '.gantt-svg'], ['c1', '.cal-grid'], ['b1', '.bub-buehne'], ['t1', '.time-wrap'], ['m1', '.minutes-meta'], ['r1', '.sheet-grid'], ['h1', '.happ-body']]) {
    const k = document.querySelector(`.react-flow__node[data-id="${id}"]`); const e = k?.querySelector(sel); if (!e) { out[id] = null; continue; }
    const r = e.getBoundingClientRect(); const kr = k.getBoundingClientRect();
    out[id] = [r.left, r.top, r.width, r.height, kr.width, kr.height].map((v) => Math.round(v * 10) / 10).join(' ');
  }
  return out;
});
const LEER = [1000, 110];   // freie Fläche zwischen Kopfleiste und Karten

console.log('A  In Ruhe');
const { ctx, P } = await auf();
await P.mouse.move(...LEER); await P.waitForTimeout(700);
const ruhe = await deckkraft(P, BEDIENUNG);
pruefe('A1 jede Bedienung ist unsichtbar', Object.values(ruhe).every((o) => o === 0), ruhe);
const inhalt = await deckkraft(P, INHALT);
pruefe('A2 der Inhalt bleibt sichtbar', Object.values(inhalt).every((o) => o !== null && o > 0.5), inhalt);
const lageRuhe = await lage(P);
await P.screenshot({ path: path.join(SD, 'm421-ruhe.png') });

console.log('C  Markieren');
const kb = await P.locator('.react-flow__node[data-id="k1"]').boundingBox();
await P.mouse.click(kb.x + 200, kb.y + 180);
await P.waitForTimeout(260);
const nachKlick = await deckkraft(P, BEDIENUNG);
pruefe('C1 ein Klick in die Karte markiert sie und blendet ihre Bedienung sofort ein', await P.locator('.react-flow__node[data-id="k1"]').evaluate((e) => e.classList.contains('selected')) && nachKlick['k1 .kanban-add'] > 0.9, nachKlick);
pruefe('C2 … nur bei dieser Karte', Object.entries(nachKlick).filter(([k]) => !k.startsWith('k1')).every(([, o]) => o === 0), nachKlick);
await P.keyboard.press('Control+a'); await P.waitForTimeout(500);
const alle = await deckkraft(P, BEDIENUNG);
pruefe('C3 alle markiert: alle Bedienung da', Object.values(alle).every((o) => o > 0.3), alle);
await P.screenshot({ path: path.join(SD, 'm421-markiert.png') });
console.log('B  Nichts springt');
const lageMarkiert = await lage(P);
pruefe('B1 Inhalt und Kartengröße liegen markiert genau wie in Ruhe', JSON.stringify(lageRuhe) === JSON.stringify(lageMarkiert) && Object.values(lageRuhe).every(Boolean), [lageRuhe, lageMarkiert]);
await P.keyboard.press('Escape'); await P.mouse.click(...LEER); await P.waitForTimeout(600);
pruefe('C4 Auswahl aufgehoben: wieder Ruhe', Object.values(await deckkraft(P, BEDIENUNG)).every((o) => o === 0));

console.log('D  Zeiger und Tastatur');
const gb = await P.locator('.react-flow__node[data-id="g1"]').boundingBox();
await P.mouse.move(gb.x + 200, gb.y + 120);
await P.waitForTimeout(120);
const sofort = (await deckkraft(P, { g1: BEDIENUNG.g1 }))['g1 .gantt-tools'];
await P.waitForTimeout(900);
const geruht = (await deckkraft(P, { g1: BEDIENUNG.g1 }))['g1 .gantt-tools'];
pruefe('D1 beim Überfahren blitzt nichts auf – ruht der Zeiger, kommt die Bedienung', sofort < 0.15 && geruht > 0.9, { sofort, geruht });
await P.mouse.move(...LEER); await P.waitForTimeout(500);
pruefe('D2 Zeiger weg: wieder Ruhe', (await deckkraft(P, { g1: BEDIENUNG.g1 }))['g1 .gantt-tools'] === 0);
await P.locator('.react-flow__node[data-id="k1"] .kanban-add input').focus(); await P.waitForTimeout(300);
pruefe('D3 Tastatur-Fokus in der Karte genügt', (await deckkraft(P, { k1: BEDIENUNG.k1 }))['k1 .kanban-add'] > 0.9);
await P.keyboard.type('Neues Ticket'); await P.keyboard.press('Enter'); await P.waitForTimeout(400);
pruefe('D4 … und die Eingabe funktioniert wie zuvor', await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'k1').data.items.some((i) => i.text === 'Neues Ticket')));
await P.evaluate(() => document.activeElement?.blur()); await P.mouse.click(...LEER);
await ctx.close();

console.log('E  Ausnahmen');
{
  const knoten = [
    { id: 'b1', type: 'bubbles', width: 560, height: 440, position: { x: 0, y: 0 }, data: { title: 'Ideen', frage: 'Was verbessern wir?', ideen: { i1: { text: 'Mehr Licht', von: 'g:x', t: 1 }, i2: { text: 'Sitzecke', von: 'g:x', t: 2 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'offen', punkte: 3, t: 1 } } },
    { id: 't1', type: 'time', width: 460, height: 380, position: { x: 620, y: 0 }, data: { title: 'Zeiterfassung', segs: [{ id: 's1', date: heute, start: 1, kind: 'arbeit' }] } },
    { id: 'r1', type: 'sheet', width: 460, height: 300, position: { x: 1140, y: 0 }, data: { title: 'Budget', cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1200', A3: 'Strom', B3: '180' }, cols: 3, rows: 5, kopf: 1, filterAn: true, sort: { spalte: 'B', ab: true } } },
  ];
  const { ctx: c2, P: Q } = await auf({ knoten });
  await Q.mouse.move(...LEER); await Q.waitForTimeout(700);
  const e = await deckkraft(Q, { b1: ['.bub-schritte', '.bub-leiste'], t1: ['.time-live', '.time-nav'], r1: ['.sheet-fuss', '.sheet-tools'] });
  pruefe('E1 offene Abstimmung: Schritte und Leiste der Ideabubbles bleiben', e['b1 .bub-schritte'] > 0.5 && e['b1 .bub-leiste'] > 0.5, e);
  pruefe('E2 laufende Zeiterfassung: die Anzeige „● Arbeit · seit …" bleibt, das Blättern nicht', e['t1 .time-live'] > 0.5 && e['t1 .time-nav'] === 0, e);
  pruefe('E3 sortierte Tabelle: die Fußzeile mit „Filter aus" bleibt, die Werkzeuge nicht', e['r1 .sheet-fuss'] > 0.5 && e['r1 .sheet-tools'] === 0, e);
  await c2.close();
}

console.log('F  Finger');
{
  const knoten = [nodes.find((n) => n.id === 'k1')].map((n) => ({ ...n, position: { x: 0, y: 0 }, width: 330 }));
  const { ctx: c3, P: T } = await auf({ knoten, telefon: true, viewport: { width: 390, height: 780 } });
  const vor = await T.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="k1"] .kanban-add'); const cs = getComputedStyle(e); return { o: +cs.opacity, pe: cs.pointerEvents, hover: matchMedia('(hover: none)').matches }; });
  pruefe('F1 in Ruhe unsichtbar – und fängt keinen Tipp', vor.hover && vor.o === 0 && vor.pe === 'none', vor);
  const r = await T.locator('.react-flow__node[data-id="k1"] .kanban-add').boundingBox();
  await T.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await T.waitForTimeout(500);
  const nach = await T.evaluate(() => { const k = document.querySelector('.react-flow__node[data-id="k1"]'); const cs = getComputedStyle(k.querySelector('.kanban-add')); return { markiert: k.classList.contains('selected'), o: +cs.opacity, pe: cs.pointerEvents, fokusImFeld: document.activeElement?.closest('.kanban-add') != null }; });
  pruefe('F2 ein Tipp auf die Stelle markiert die Karte und blendet ein – ohne das Feld schon zu öffnen', nach.markiert && nach.o > 0.9 && nach.pe !== 'none' && !nach.fokusImFeld, nach);
  await T.locator('.react-flow__node[data-id="k1"] .kanban-add input').tap(); await T.waitForTimeout(300);
  pruefe('F3 der zweite Tipp bedient', await T.evaluate(() => document.activeElement?.closest('.kanban-add') != null));
  await c3.close();
}

console.log('G  Präsentation');
{
  const { ctx: c4, P: V } = await auf({ knoten: [nodes.find((n) => n.id === 'k1')] });
  await V.mouse.click(...LEER); await V.keyboard.press('Alt+p');
  await V.waitForSelector('.presenter', { timeout: 5000 }); await V.waitForTimeout(900);
  const g = await V.evaluate(() => { const e = document.querySelector('.presenter-slide .kanban-add'); return e ? +getComputedStyle(e).opacity : null; });
  pruefe('G1 auf der Folie ist die Bedienung da (die Regel gilt nur auf dem Board)', g === null || g > 0.9, String(g));
  await c4.close();
}

console.log('H  Hilfe');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('H1 Hilfe nennt M421 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M421)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M421)'));
pruefe('H2 docs/UMBAU.md führt M421', quelle('docs/UMBAU.md').includes('M421'));
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM421: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
