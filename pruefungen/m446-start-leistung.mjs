/**
 * M446 — Start-Leistung: schneller erster Bildaufbau.
 *
 *   A  Start-JS: Was bis zum bedienbaren Board über die Leitung kommt, bleibt unter 2,6 MB (M462)
 *      (vorher 3,58 MB). Kein Kartentyp außer den Grundkarten, keine Übersicht, Aufgaben-Zentrale,
 *      Präsentation, Suche, keine Emoji-Daten und keine Markdown-Kette beim Start.
 *   B  Startzeit: das Board steht lokal in unter 1,5 s.
 *   C  Nachgeladene Kartentypen: Tabelle und Zeitplan auf dem Board erscheinen und rechnen;
 *      Notiz, Kanban und Zeitplan lassen sich über die Palette anlegen.
 *   D  Nachgeladene Ansichten: Suche (Strg+K, auch schon vor dem Laden), Präsentation,
 *      Einstellungen, Hilfe, Übersicht, Aufgaben-Zentrale.
 *   E  Im Leerlauf nach dem Start kommen die nachgeladenen Teile still nach (Service Worker / offline).
 *   F  Die Ein-Datei-Fassung (release/pixinotes.html, falls gebaut) läuft per file:// mit
 *      nachgeladenen Kartentypen — ohne eine einzige Netzanfrage.
 */
// Läuft aus dem Repository: `node pruefungen/m446-start-leistung.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 5446;
/** Grenze knapp über dem gemessenen Stand (2,44 MB) — ein Rückschritt fällt sofort auf.
 *  M462: BlockNote 0.31 → 0.57 (Tiptap 3, Mantine 8, Emoji-Auswahl frimousse statisch
 *  im Editor-Paket) kostet +50 KB (+21 KB gzip) — Stand 2,52 MB, Grenze 2,6 MB. */
const START_JS_GRENZE = 2_600_000;

let anfragen = [];
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  anfragen.push(pfad);
  let f = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const stand = (karten) => ({
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 220, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Hallo Welt' }] } },
    ...(karten ? [
      { id: 's1', type: 'sheet', width: 460, height: 300, position: { x: 260, y: 0 }, data: { title: 'Kosten', cols: 3, rows: 5, cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '800', A3: 'Strom', B3: '95', A4: 'Summe', B4: '=SUMME(B2:B3)' } } },
      { id: 'g1', type: 'gantt', width: 700, height: 260, position: { x: 0, y: 340 }, data: { title: 'Bauplan Nord', rows: [], dayWidth: 24 } },
    ] : []),
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false,
});
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand(!!opt.karten));
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  anfragen = [];
  const t0 = Date.now();
  await P.goto(opt.url ?? `http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow', { state: 'visible' });
  const board = Date.now() - t0;
  await P.waitForSelector('.react-flow__node', { state: 'visible' });
  return { ctx, P, board, fehler };
}
const jsAssets = () => [...new Set(anfragen)].filter((p) => p.startsWith('/assets/') && p.endsWith('.js')).map((p) => p.split('/').pop());
const groesse = (dateien) => dateien.reduce((a, f) => a + statSync(join(DIST, 'assets', f)).size, 0);
const knotenText = (P, id) => P.evaluate((i) => document.querySelector(`.react-flow__node[data-id="${i}"]`)?.textContent ?? '', id);
const palette = async (P, modul) => {
  await P.locator('.dock [aria-label="Objekt hinzufügen"]').click();
  await P.waitForSelector('.modul-palette');
  await P.locator(`.modul-palette [data-modul="${modul}"]`).click();
  await P.waitForTimeout(400);
};
const knotenZahl = (P, typ) => P.locator(`.react-flow__node-${typ}`).count();
/** Befehl über die Suche (Strg+K) ausführen */
const suche = async (P, wort, befehl = wort) => {
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-box', { state: 'visible' });
  await P.keyboard.type(wort);
  await P.waitForTimeout(250);
  await P.locator('.search-cmds .search-cmd', { hasText: befehl }).first().click();
  await P.waitForTimeout(400);
};

// ══ A/B: Start ═══════════════════════════════════════════════════════
console.log('\n════ A/B: Start ════');
{
  const { ctx, P, board } = await seite();
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(400);
  const geladen = jsAssets();
  const summe = groesse(geladen);
  console.log(`  Start-JS ${(summe / 1024 / 1024).toFixed(2)} MB in ${geladen.length} Dateien: ${geladen.join(', ')}`);
  console.log(`  Board sichtbar nach ${board} ms`);
  pruefe(`A1 Start-JS unter ${(START_JS_GRENZE / 1e6).toFixed(1)} MB (ist ${(summe / 1024 / 1024).toFixed(2)} MB; vorher 3,58 MB)`, summe < START_JS_GRENZE && summe > 1_000_000, String(summe));
  const karten = geladen.filter((f) => /^(Kanban|Gantt|Calendar|Sheet|Mermaid|Week|Minutes|Time|HtmlApp|Bubbles|Shape)Card-/.test(f));
  pruefe('A2 beim Start kein seltener Kartentyp (Kanban, Zeitplan, Kalender, Tabelle, Diagramm …)', karten.length === 0, karten.join(', '));
  const ansichten = geladen.filter((f) => /^(Overview|TaskHub|Presenter|SearchOverlay|RechercheDialog|Settings|HelpOverlay)/.test(f));
  pruefe('A3 beim Start keine Übersicht, Aufgaben-Zentrale, Präsentation, Suche, Einstellungen, Hilfe', ansichten.length === 0, ansichten.join(', '));
  // Emoji-Daten und Markdown-/HTML-Kette lädt BlockNote selbst nach — sie dürfen nicht im Editor-Paket stecken
  const editor = geladen.find((f) => /^editor-/.test(f));
  const edCode = editor ? readFileSync(join(DIST, 'assets', editor), 'utf8') : '';
  pruefe('A4 das Editor-Paket ist schlank (< 1,1 MB) und trägt keine Emoji-Daten', !!editor && statSync(join(DIST, 'assets', editor)).size < 1_100_000 && !/"shortcodes"|grinning face/i.test(edCode), editor);
  // Erkennungszeichen im Quelltext: canvas-confetti → „disableForReducedMotion", html-to-image → „includeQueryParams"
  const startCode = geladen.map((f) => readFileSync(join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('A5 kein Konfetti und kein html-to-image im Start', !/disableForReducedMotion/.test(startCode) && !/includeQueryParams/.test(startCode));
  pruefe('B1 Board in unter 1,5 s sichtbar (lokal, kalt)', board < 1500, String(board));
  await P.waitForFunction(() => /Hallo Welt/.test(document.querySelector('.react-flow__node[data-id="n1"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  pruefe('B2 die Notiz zeigt ihren Text', /Hallo Welt/.test(await knotenText(P, 'n1')));
  await ctx.close();
}

// ══ C: Kartentypen bei Bedarf ═══════════════════════════════════════
console.log('\n════ C: Kartentypen bei Bedarf ════');
{
  const { ctx, P, fehler } = await seite({ karten: true });
  await P.waitForFunction(() => /895/.test(document.querySelector('.react-flow__node[data-id="s1"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const tab = await knotenText(P, 's1');
  pruefe('C1 die Rechen-Tabelle kommt nach und rechnet (=SUMME → 895)', /Miete/.test(tab) && /895/.test(tab), tab.slice(0, 80));
  await P.waitForFunction(() => /Bauplan Nord/.test(document.querySelector('.react-flow__node[data-id="g1"]')?.innerHTML ?? ''), null, { timeout: 10000 }).catch(() => {});
  const g = await P.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="g1"]'); return { html: /Bauplan Nord/.test(e?.innerHTML ?? ''), h: e?.getBoundingClientRect().height ?? 0, platzhalter: !!e?.querySelector('.karte-laedt') }; });
  pruefe('C2 der Zeitplan kommt nach (Titel, volle Höhe, kein Platzhalter mehr)', g.html && g.h > 150 && !g.platzhalter, JSON.stringify(g));
  const geladen = jsAssets();
  pruefe('C3 dafür kamen genau die Teile von Tabelle und Zeitplan, nicht Kanban oder Kalender', geladen.some((f) => /^SheetCard-/.test(f)) && geladen.some((f) => /^GanttCard-/.test(f)) && !geladen.some((f) => /^(Kanban|Calendar)Card-/.test(f)), geladen.filter((f) => /Card-/.test(f)).join(', '));
  await P.screenshot({ path: path.join(SD, 'm446-karten.png') });

  const vorher = await knotenZahl(P, 'note');
  await palette(P, 'notiz');
  await P.keyboard.type('Neue Idee');
  await P.waitForTimeout(500);
  pruefe('C4 Notiz über die Palette angelegt und beschrieben', (await knotenZahl(P, 'note')) === vorher + 1 && (await P.locator('.react-flow__node', { hasText: 'Neue Idee' }).count()) >= 1);
  await P.keyboard.press('Escape'); await P.mouse.click(1300, 820); await P.waitForTimeout(200);
  await palette(P, 'kanban');
  await P.waitForSelector('.kanban-head', { timeout: 10000 }).catch(() => {});
  pruefe('C5 Kanban über die Palette angelegt — der Kartentyp kommt nach und steht', (await knotenZahl(P, 'kanban')) === 1 && (await P.locator('.kanban-head').count()) === 1);
  await P.keyboard.press('Escape'); await P.mouse.click(1300, 820); await P.waitForTimeout(200);
  await palette(P, 'zeitplan');
  await P.waitForTimeout(300);
  await P.screenshot({ path: path.join(SD, 'm446-angelegt.png') });
  pruefe('C6 Zeitplan über die Palette angelegt', (await knotenZahl(P, 'gantt')) === 2, String(await knotenZahl(P, 'gantt')));
  pruefe('C7 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ D: Ansichten bei Bedarf ═════════════════════════════════════════
console.log('\n════ D: Ansichten bei Bedarf ════');
{
  const { ctx, P, fehler } = await seite();
  await P.waitForLoadState('networkidle');
  // Strg+K schon vor dem ersten Laden: öffnet genau einmal, ein zweites Strg+K schließt (kein Doppel-Umschalten)
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-box', { state: 'visible', timeout: 10000 }).catch(() => {});
  pruefe('D1 Strg+K öffnet die Suche, auch bevor ihr Teil geladen ist', (await P.locator('.search-box').count()) === 1);
  await P.keyboard.press('Control+k'); await P.waitForTimeout(300);
  const zu = (await P.locator('.search-box').count()) === 0;
  await P.keyboard.press('Control+k'); await P.waitForTimeout(300);
  const wiederAuf = (await P.locator('.search-box').count()) === 1;
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  pruefe('D2 Strg+K schließt und öffnet danach im Wechsel; Esc schließt', zu && wiederAuf && (await P.locator('.search-box').count()) === 0, JSON.stringify({ zu, wiederAuf }));

  await suche(P, 'Präsentieren');
  await P.waitForSelector('.presenter-slide', { state: 'visible', timeout: 10000 }).catch(() => {});
  pruefe('D3 Präsentation startet und zeigt die Notiz als Folie', /Hallo Welt/.test(await P.evaluate(() => document.querySelector('.presenter-slide')?.textContent ?? '')));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  pruefe('D4 Esc beendet die Präsentation, das Board ist zurück', (await P.locator('.presenter-slide').count()) === 0 && (await P.locator('.react-flow').count()) === 1);

  await suche(P, 'Einstellungen');
  await P.waitForSelector('[role="dialog"][aria-label="Einstellungen"]', { timeout: 10000 }).catch(() => {});
  pruefe('D5 Einstellungen öffnen', (await P.locator('[role="dialog"][aria-label="Einstellungen"]').count()) === 1);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  await suche(P, 'Hilfe', 'Anleitung');
  await P.waitForSelector('.help-modal', { timeout: 10000 }).catch(() => {});
  pruefe('D6 Hilfe öffnet', (await P.locator('.help-modal').count()) === 1);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  await suche(P, 'Aufgaben-Zentrale');
  await P.waitForSelector('.taskhub-head', { timeout: 10000 }).catch(() => {});
  pruefe('D7 Aufgaben-Zentrale öffnet', (await P.locator('.taskhub-head').count()) === 1);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  await suche(P, 'Übersicht', 'Zur Übersicht');
  await P.waitForSelector('.ov-mode', { timeout: 10000 }).catch(() => {});
  pruefe('D8 Übersicht öffnet', (await P.locator('.ov-mode').count()) === 1);
  pruefe('D9 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ E: Vorladen im Leerlauf ═════════════════════════════════════════
console.log('\n════ E: Vorladen im Leerlauf ════');
{
  const { ctx, P } = await seite();
  await P.waitForLoadState('networkidle');
  const frueh = jsAssets();
  await P.waitForFunction(() => performance.getEntriesByType('resource').some((r) => /GanttCard-/.test(r.name)), null, { timeout: 12000 }).catch(() => {});
  await P.waitForTimeout(1500);
  const spaet = jsAssets();
  const neu = spaet.filter((f) => !frueh.includes(f));
  pruefe('E1 kurz nach dem Start kommen Kartentypen und Ansichten still nach (für den Offline-Betrieb)',
    ['GanttCard-', 'KanbanCard-', 'CalendarCard-', 'Overview-', 'Presenter-', 'SearchOverlay-', 'TaskHub-'].every((p) => neu.some((f) => f.startsWith(p))), neu.join(', '));
  await ctx.close();
}

// ══ F: Ein-Datei-Fassung per file:// ════════════════════════════════
console.log('\n════ F: Ein-Datei-Fassung ════');
{
  const rel = path.join(__repo, 'release', 'pixinotes.html');
  if (!existsSync(rel)) {
    console.log('  (release/pixinotes.html fehlt — `npm run build:single` baut sie)');
  } else {
    const netz = [];
    const { ctx, P, fehler } = await seite({ karten: true, url: pathToFileURL(rel).href });
    P.on('request', (r) => { if (/^https?:/.test(r.url())) netz.push(r.url()); });
    await P.waitForFunction(() => /895/.test(document.querySelector('.react-flow__node[data-id="s1"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
    pruefe('F1 per file:// steht das Board, die Tabelle rechnet (=SUMME → 895)', /895/.test(await knotenText(P, 's1')));
    pruefe('F2 der Zeitplan erscheint', await P.evaluate(() => /Bauplan Nord/.test(document.querySelector('.react-flow__node[data-id="g1"]')?.innerHTML ?? '')));
    await palette(P, 'kanban');
    await P.waitForSelector('.kanban-head', { timeout: 10000 }).catch(() => {});
    pruefe('F3 Kanban lässt sich anlegen', (await P.locator('.kanban-head').count()) === 1);
    await P.keyboard.press('Escape'); await P.mouse.click(1300, 820); await P.waitForTimeout(200);
    await suche(P, 'Präsentieren');
    await P.waitForSelector('.presenter-slide', { timeout: 10000 }).catch(() => {});
    pruefe('F4 Präsentation läuft', (await P.locator('.presenter-slide').count()) === 1);
    pruefe('F5 keine Netzanfrage und keine Seitenfehler', netz.length === 0 && fehler.length === 0, JSON.stringify({ netz, fehler }));
    await ctx.close();
  }
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
