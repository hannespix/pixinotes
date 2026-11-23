/**
 * M482 — Rechtschreibprüfung des Browsers in Karten und Modulen.
 *
 * Gemeldet: „Was auch noch fehlt ist die Standard-Browser-Rechtschreibkorrektur in den Cards und Modulen!"
 *
 * Die Wellenlinie selbst ist ohne Bildschirm nicht messbar (der Browser zeichnet sie nur mit Wörterbuch). Gemessen
 * wird, was der Browser dafür befragt: `el.spellcheck` des Feldes, in dem gerade bearbeitet wird.
 *
 *   A  Felder für freien Text prüfen im Bearbeiten: Notiz, Ticket (Titel und Beschreibung), Gantt-Vorgang,
 *      Tabellen-Textzelle, Protokoll, Form-Text, Kontakt-Notiz, Kommentar, Kartentitel — ausdrücklich als Attribut.
 *   B  Ausnahmen ohne Prüfung: Formel- und Zahlenzelle (auch eine Zelle, die beim Tippen zur Formel wird),
 *      Mermaid-Code, Suche, Webseite/E-Mail/Telefon, Datum. Dort auch keine Autokorrektur der Telefone.
 *   C  Ruhende Karten sind nicht bearbeitbar (keine Wellenlinien ohne Bearbeiten).
 *   D  Einstellung „Rechtschreibung prüfen" aus: überall aus, auch nach dem Neuladen; wieder an: wieder an.
 */
// Läuft aus dem Repository: `node pruefungen/m482-rechtschreibung.mjs`
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
const PORT = 5482;
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

const NODES = [
  { id: 'no', type: 'note', position: { x: 0, y: 0 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Hallo Welt mit Fehlr' }] } },
  { id: 'kb', type: 'kanban', position: { x: 300, y: 0 }, width: 480, data: { title: 'Kanbn', items: [{ id: 't1', text: 'Tikcet schreiben', col: 0 }] } },
  { id: 'gt', type: 'gantt', position: { x: 820, y: 0 }, width: 620, height: 240, data: { title: 'Plan', dayWidth: 24, rows: [{ id: 'r1', name: 'Vorgnag', start: '2026-11-20', end: '2026-11-28', color: '#4f7cff' }] } },
  { id: 'tb', type: 'sheet', position: { x: 0, y: 330 }, width: 460, height: 240, data: { title: 'Kosten', cols: 4, rows: 5, cells: { A1: 'Postn', B1: '800', B2: '=SUMME(B1:B1)' } } },
  { id: 'pr', type: 'minutes', position: { x: 500, y: 330 }, width: 380, height: 380, data: { title: 'Jour fixe', color: 'white', entries: [{ id: 'x1', date: '2026-11-23', blocks: [{ type: 'paragraph', content: 'Alles im Plan.' }] }], agenda: ['Stand'], rhythm: 'woche', carryOpen: true } },
  { id: 'ko', type: 'kontakt', position: { x: 920, y: 330 }, width: 300, data: { name: 'Anna Müller', telefone: [{ art: 'Dienstlich', nummer: '0761 208' }], emails: ['a@b.de'], web: 'example.de', notiz: 'Ausbilder' } },
  { id: 'fo', type: 'shape', position: { x: 0, y: 760 }, width: 150, height: 70, data: { shape: 'process', text: 'Antrag prüfn', color: '#eef2ff' } },
  { id: 'mm', type: 'mermaid', position: { x: 300, y: 760 }, width: 320, height: 240, data: { code: 'graph TD\n  A[Idee] --> B[Prüfen]' } },
];
const STAND = { version: 5, state: {
  boards: [{ id: 'b0', name: 'Rechtschreibung', edges: [], drawings: [], nodes: NODES,
    comments: [{ id: 'c1', nodeId: 'no', msgs: [{ author: 'Anna', at: '2026-11-15T10:00:00.000Z', text: 'Bitte prüfen' }] }] }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' } };

const neu = async (rsAus) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1600, height: 1100 } });
  await ctx.addInitScript(([stand, aus]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    if (aus) localStorage.setItem('pixinotes-rechtschreibung', '0');
    localStorage.setItem('pixinotes-board', JSON.stringify(stand));
  }, [STAND, rsAus]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
};
const warte = (P, ms = 400) => P.waitForTimeout(ms);
/** Wie steht die Prüfung im gerade bearbeiteten Feld? */
const aktiv = (P) => P.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  return { tag: a.tagName, typ: a.type ?? '', sc: a.spellcheck, attr: a.getAttribute('spellcheck'), ac: a.getAttribute('autocorrect'), ed: a.isContentEditable || ['INPUT', 'TEXTAREA'].includes(a.tagName) };
});
const leer = (P) => P.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur(); });
const knoten = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
const neben = async (P) => { await P.mouse.click(1580, 1080); await warte(P, 300); };

/** Alle Stellen einmal durchgehen; je Stelle { name, wert, frei } — frei = Feld für freien Text */
async function rundgang(P) {
  const erg = [];
  const merke = async (name, frei) => { erg.push({ name, frei, wert: await aktiv(P) }); };

  // Notiz: Doppelklick weckt den Editor
  const bn = await knoten(P, 'no').boundingBox();
  await P.mouse.dblclick(bn.x + 60, bn.y + bn.height / 2); await warte(P, 600);
  await knoten(P, 'no').locator('[contenteditable="true"]').first().click(); await warte(P, 200);
  await merke('Notiz-Editor', true);
  await neben(P);

  // Ticket: öffnen, Titel und Beschreibung, Frist (Datum)
  await knoten(P, 'kb').locator('.kanban-item-text').first().click(); await warte(P, 500);
  await P.locator('input.ticket-title').click(); await warte(P, 150);
  await merke('Ticket-Titel', true);
  await P.locator('textarea.ticket-note').click(); await warte(P, 150);
  await merke('Ticket-Beschreibung', true);
  await P.locator('.ticket-meta-row input[type="date"]').first().focus(); await warte(P, 150);
  await merke('Ticket-Frist (Datum)', false);
  await P.keyboard.press('Escape'); await warte(P, 300);
  await neben(P);

  // Kartentitel (Doppelklick benennt um)
  await knoten(P, 'kb').locator('.kanban-title').click(); await warte(P, 300);
  await knoten(P, 'kb').locator('.kanban-title').dblclick(); await warte(P, 300);
  if (!(await aktiv(P))) console.log('    (Titel)', await P.evaluate(() => [document.activeElement?.outerHTML?.slice(0, 120), document.querySelectorAll('input.kanban-title').length]));
  await merke('Kartentitel', true);
  await P.keyboard.press('Escape'); await warte(P, 200);
  await neben(P);

  // Gantt-Vorgang
  await knoten(P, 'gt').locator('input.gantt-label').first().click(); await warte(P, 200);
  await merke('Gantt-Vorgang', true);
  await P.keyboard.press('Escape'); await neben(P);

  // Tabelle: Textzelle, Zahl, Formel, Zelle wird beim Tippen zur Formel
  const zelle = async (adr) => { await knoten(P, 'tb').locator(`td[data-zelle="${adr}"]`).click(); await warte(P, 250); };
  await zelle('A1'); await merke('Tabelle-Textzelle', true); await P.keyboard.press('Escape'); await warte(P, 150);
  await zelle('B1'); await merke('Tabelle-Zahlenzelle', false); await P.keyboard.press('Escape'); await warte(P, 150);
  await zelle('B2'); await merke('Tabelle-Formelzelle', false); await P.keyboard.press('Escape'); await warte(P, 150);
  await zelle('A3'); await P.keyboard.type('Text'); await warte(P, 100); await merke('Tabelle-neue Zelle mit Text', true);
  await P.keyboard.press('Control+a'); await P.keyboard.type('=1+2'); await warte(P, 100); await merke('Tabelle-Zelle wird zur Formel', false);
  await P.keyboard.press('Escape'); await neben(P);

  // Protokoll: Eintrag (Editor)
  await knoten(P, 'pr').locator('.bn-editor').first().click(); await warte(P, 400);
  await merke('Protokoll', true);
  await neben(P);

  // Form mit Notiz-Text (M435)
  const bf = await knoten(P, 'fo').locator('.shape-body').boundingBox();
  await P.mouse.dblclick(bf.x + bf.width / 2, bf.y + bf.height / 2); await warte(P, 500);
  await merke('Form-Text', true);
  await neben(P);

  // Kontakt: bearbeiten
  await knoten(P, 'ko').locator('button[aria-label="Bearbeiten"]').click(); await warte(P, 400);
  const kf = knoten(P, 'ko');
  await kf.locator('textarea[aria-label="Notiz"]').click(); await warte(P, 150); await merke('Kontakt-Notiz', true);
  await kf.locator('input[aria-label="Name"]').click(); await warte(P, 150); await merke('Kontakt-Name', true);
  await kf.locator('input[aria-label="Webseite"]').click(); await warte(P, 150); await merke('Kontakt-Webseite (URL)', false);
  await kf.locator('input[aria-label="E-Mail"]').first().click(); await warte(P, 150); await merke('Kontakt-E-Mail', false);
  await kf.locator('input[aria-label="Rufnummer"]').first().click(); await warte(P, 150); await merke('Kontakt-Telefon', false);
  await kf.locator('button[aria-label="Fertig"]').click(); await warte(P, 300);
  await neben(P);

  // Mermaid-Code
  await knoten(P, 'mm').click({ position: { x: 150, y: 140 } }); await warte(P, 400);
  const mehr = P.locator('button[title^="Mehr: Vorlage"]');
  if (await mehr.count()) {
    await mehr.first().click(); await warte(P, 300);
    await P.locator('button[role="menuitem"]', { hasText: 'Code anzeigen' }).first().click(); await warte(P, 400);
    await knoten(P, 'mm').locator('textarea.mermaid-code').click(); await warte(P, 150);
    await merke('Mermaid-Code', false);
  } else erg.push({ name: 'Mermaid-Code', frei: false, wert: 'kein Menü' });
  await neben(P);

  // Kommentar: Nadel öffnen, Antwort schreiben
  await P.locator('.comment-pin').first().click(); await warte(P, 500);
  await P.locator('.comment-compose textarea.comment-input').click(); await warte(P, 150);
  await merke('Kommentar', true);
  await leer(P);

  // Globale Suche (Strg+K)
  await P.keyboard.press('Control+k'); await warte(P, 500);
  await merke('Suche (Strg+K)', false);
  await P.keyboard.press('Escape'); await warte(P, 300);
  return erg;
}

console.log('A/B  Rechtschreibung an (Vorgabe)');
{
  const { ctx, P } = await neu(false);
  pruefe('A0 die Wurzel gibt die Haltung vor (html spellcheck=true)', await P.evaluate(() => document.documentElement.getAttribute('spellcheck') === 'true'));
  console.log('C  Ruhende Karten');
  pruefe('C1 ruhend sind Notiz und Form nicht bearbeitbar (dort keine Wellenlinien)', await P.evaluate(() =>
    !document.querySelector('.react-flow__node[data-id="no"] [contenteditable="true"], .react-flow__node[data-id="fo"] [contenteditable="true"]')));
  const erg = await rundgang(P);
  for (const e of erg) {
    const w = e.wert;
    if (e.frei) pruefe(`A ${e.name}: Prüfung an (ausdrücklich)`, !!w && w.ed && w.sc === true && w.attr === 'true', w);
    else pruefe(`B ${e.name}: Prüfung aus, keine Autokorrektur`, !!w && typeof w === 'object' && w.ed && w.sc === false && w.ac === 'off', w);
  }
  await P.screenshot({ path: path.join(SD, 'm482-rechtschreibung.png') });

  console.log('D  Einstellung');
  await P.locator('button[title^="Einstellungen"]').click(); await warte(P, 600);
  const schalter = P.locator('[data-taste="rechtschreibung"]');
  pruefe('D1 „Rechtschreibung prüfen" steht in den Einstellungen und ist an', (await schalter.count()) === 1 && (await schalter.isChecked()));
  await schalter.uncheck(); await warte(P, 200);
  pruefe('D2 aus: die Wurzel schaltet sofort ab', await P.evaluate(() => document.documentElement.spellcheck === false && localStorage.getItem('pixinotes-rechtschreibung') === '0'));
  await P.keyboard.press('Escape'); await warte(P, 400);
  const bn = await knoten(P, 'no').boundingBox();
  await P.mouse.dblclick(bn.x + 60, bn.y + bn.height / 2); await warte(P, 500);
  const w = await aktiv(P);
  pruefe('D3 … und die Notiz prüft im Bearbeiten nicht mehr', !!w && w.sc === false, w);
  await neben(P);
  await ctx.close();
}

console.log('D  Ausgeschaltet (nach dem Neuladen)');
{
  const { ctx, P } = await neu(true);
  const erg = await rundgang(P);
  const an = erg.filter((e) => !e.wert || typeof e.wert !== 'object' || e.wert.sc !== false);
  pruefe(`D4 aus: an keiner der ${erg.length} Stellen geprüft`, an.length === 0, an);
  pruefe('D5 Autokorrektur der Telefone bleibt in freiem Text unangetastet', erg.filter((e) => e.frei).every((e) => e.wert?.ac !== 'off'), erg.filter((e) => e.frei && e.wert?.ac === 'off').map((e) => e.name));
  await P.reload({ waitUntil: 'networkidle' }); await warte(P, 2000);
  await P.locator('button[title^="Einstellungen"]').click(); await warte(P, 600);
  await P.locator('[data-taste="rechtschreibung"]').check(); await warte(P, 200);
  await P.keyboard.press('Escape'); await warte(P, 400);
  await knoten(P, 'kb').locator('.kanban-item-text').first().click(); await warte(P, 500);
  await P.locator('textarea.ticket-note').click(); await warte(P, 150);
  const w = await aktiv(P);
  pruefe('D6 wieder an: das Ticket prüft wieder', !!w && w.sc === true, w);
  await ctx.close();
}

pruefe('Z keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3));
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
