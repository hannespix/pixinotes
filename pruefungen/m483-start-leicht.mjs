/**
 * M483 — Start-JS entlasten: Auswahl-Leiste, Datei-Import, KI-Aktionen, Beispiele, Dialoge und Kalender-Abruf kommen
 * erst bei Bedarf (bzw. still im Leerlauf nach dem Start).
 *
 *   A  Start: Start-JS unter der neuen Grenze; keiner der nachgeladenen Teile ist im Start.
 *   B  Bei Bedarf: Auswahl → Leiste; Teilen-Dialog; Datei ablegen → Karte; Dock ⋯ → Bild-Export; Ebene löschen →
 *      Dialog; Browser-Erweiterung „ohne Rückfrage" → Karte. Jeder Teil kommt mit dem ersten Aufruf und tut, was er soll.
 *   C  Allererster Start → Begrüßung → „Beispiele": die Beispiele kommen nach und sind angelegt.
 *   D  Leerlauf: Ohne Zutun holt die App die Teile kurz nach dem Start still nach (Service Worker, offline); danach
 *      steht die Auswahl-Leiste bei der ersten Auswahl ohne neuen Abruf.
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m483`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 5483;
/** M483: gemessen 2 097 102 B (vorher 2 238 181 B) — Grenze mit gut 20 KB Polster, damit es nicht gleich wieder aufgebraucht ist */
// M502: Live-Team, Gehirn, Rechen-Tabelle, Kommentare, Punkte, Nachschlagen, Handschrift-Struktur, Bildtext nachgeladen — Start 2 042 564 B (vorher 2 110 339 B); Grenze GESENKT auf neuer Stand + gut 20 KB (docs/meilensteine/M502-start-leicht-2.md)
const START_JS_GRENZE = 2_065_000;
/** Was M483 aus dem Start nimmt (Dateinamen der Nachlade-Teile) */
const NACHGELADEN = ['SelectionToolbar', 'importFiles', 'aiActions', 'starter', 'ShareCardsModal', 'BildExport', 'GeteiltDialog',
  'EbeneLoeschenFenster', 'calAccounts', 'kontaktExport', 'bildBearbeiten'];

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

const note = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const stand = (nodes) => ({
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false,
});
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  if (!opt.erst) await ctx.addInitScript(([st, extra]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, [stand(nodes), opt.speicher ?? {}]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  anfragen = [];
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow', { state: 'visible' });
  if (nodes.length && !opt.erst) await P.waitForSelector('.react-flow__node', { state: 'visible' });
  return { ctx, P, fehler };
}
const jsAssets = () => [...new Set(anfragen)].filter((p) => p.startsWith('/assets/') && p.endsWith('.js')).map((p) => p.split('/').pop());
const groesse = (dateien) => dateien.reduce((a, f) => a + statSync(join(DIST, 'assets', f)).size, 0);
const teil = (name) => jsAssets().some((f) => f.startsWith(`${name}-`));
const karten = (P) => P.locator('.react-flow__node').count();
const waehle = async (P, id) => {
  await P.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 12, y: 6 } });
  return P.waitForSelector('.sel-toolbar, .sel-toolbar-dock', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
};

// ══ A: Start ═══════════════════════════════════════════════════════
console.log('\n════ A: Start ════');
const A = await seite([note('n1', 'Hallo Welt'), note('n2', 'Zweite Karte', 420, 0)]);
{
  const { P, fehler } = A;
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(400);
  const geladen = jsAssets();
  const summe = groesse(geladen);
  console.log(`  Start-JS ${(summe / 1024 / 1024).toFixed(2)} MB (${summe} B) in ${geladen.length} Dateien: ${geladen.join(', ')}`);
  pruefe(`A1 Start-JS unter ${START_JS_GRENZE} B (ist ${summe} B; vorher 2 238 181 B)`, summe < START_JS_GRENZE && summe > 1_000_000, String(summe));
  const imStart = NACHGELADEN.filter((n) => geladen.some((f) => f.startsWith(`${n}-`)));
  pruefe('A2 kein nachgeladener Teil im Start (Auswahl-Leiste, Import, KI, Beispiele, Dialoge, Kalender-Abruf)', imStart.length === 0, imStart.join(', '));
  const dateien = readdirSync(join(DIST, 'assets'));
  const fehlen = NACHGELADEN.filter((n) => !dateien.some((f) => f.startsWith(`${n}-`) && f.endsWith('.js')));
  pruefe('A3 die nachgeladenen Teile liegen als eigene Dateien im Build', fehlen.length === 0, fehlen.join(', '));
  pruefe('A4 keine Seitenfehler beim Start', fehler.length === 0, fehler.join(' | '));
}

// ══ B: Bei Bedarf ══════════════════════════════════════════════════
console.log('\n════ B: Bei Bedarf ════');
{
  const { P, fehler, ctx } = A;
  // B1 Auswahl → Leiste
  pruefe('B1 eine Karte wählen: die Auswahl-Leiste erscheint', await waehle(P, 'n1'));
  pruefe('B2 … und sie kam als eigener Teil nach', teil('SelectionToolbar'));
  // B3 Teilen-Dialog aus der Leiste
  await P.locator('.sel-toolbar button[aria-label="Teilen"], .sel-toolbar-dock button[aria-label="Teilen"]').first().click();
  const teilen = await P.waitForSelector('.share-cards-modal', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
  pruefe('B3 „Teilen" öffnet den Teilen-Dialog (nachgeladen)', teilen && teil('ShareCardsModal'));
  await P.locator('.share-cards-modal .modal-x').click();
  await P.waitForTimeout(200);
  pruefe('B4 der Teilen-Dialog schließt sich', (await P.locator('.share-cards-modal').count()) === 0);
  // Auswahl lösen
  await P.keyboard.press('Escape');
  await P.locator('.react-flow__pane').click({ position: { x: 900, y: 600 } });
  await P.waitForTimeout(200);
  // B5 Datei ablegen → Karte
  const vor = await karten(P);
  await P.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['Notiz aus einer Datei\nzweite Zeile'], 'abgelegt.txt', { type: 'text/plain' }));
    const ziel = document.querySelector('.board-wrap');
    const r = ziel.getBoundingClientRect();
    ziel.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.6 }));
  });
  await P.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length > n, vor, { timeout: 6000 }).catch(() => {});
  const nach = await karten(P);
  const text = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => n.textContent).join(' | '));
  pruefe('B5 eine Datei ablegen: der Import kommt nach und legt die Karte an', nach === vor + 1 && /Notiz aus einer Datei|abgelegt/.test(text) && teil('importFiles'), `${vor}→${nach}`);
  // B6 Dock ⋯ → Als Bild exportieren
  await P.locator('.dock [aria-label="Mehr"]').click();
  await P.locator('.dock-menu-more button', { hasText: 'Als Bild exportieren' }).click();
  const bild = await P.waitForSelector('.bild-export', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
  pruefe('B6 Dock ⋯ → „Als Bild exportieren" öffnet den Export (nachgeladen)', bild && teil('BildExport'));
  await P.keyboard.press('Escape');
  await P.waitForTimeout(200);
  pruefe('B7 Escape schließt den Export', (await P.locator('.bild-export').count()) === 0);
  // B8 Projekt mit Boards löschen → Dialog
  await P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:ebene-loeschen', { detail: { art: 'projekt', id: 'p1' } })));
  const ebene = await P.waitForSelector('.ebene-weg', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
  pruefe('B8 Projekt mit Boards löschen fragt im Dialog nach (nachgeladen)', ebene && teil('EbeneLoeschenFenster'));
  await P.keyboard.press('Escape');
  await P.waitForTimeout(200);
  pruefe('B9 Escape schließt ihn, das Projekt bleibt', (await P.locator('.ebene-weg').count()) === 0 && (await karten(P)) === nach);
  // B10 Browser-Erweiterung „ohne Rückfrage" → Karte auf dem offenen Board
  const vorE = await karten(P);
  const quittung = await P.evaluate(() => new Promise((fertig) => {
    const id = Math.random().toString(36).slice(2);
    const h = (e) => { if (e.data?.typ === 'pixinotes-erweiterung-ok' && e.data.id === id) { removeEventListener('message', h); fertig(e.data.angenommen); } };
    addEventListener('message', h);
    window.postMessage({ typ: 'pixinotes-erweiterung', id, sendung: { v: 1, art: 'auswahl', titel: 'Aus dem Browser', text: 'gesendeter Text', direkt: true } }, location.origin);
    setTimeout(() => fertig('keine Quittung'), 3000);
  }));
  await P.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length > n, vorE, { timeout: 6000 }).catch(() => {});
  pruefe('B10 Browser-Erweiterung „ohne Rückfrage": die Karte entsteht (Übernahme nachgeladen)', quittung === true && (await karten(P)) === vorE + 1 && teil('GeteiltDialog'), `${quittung} ${vorE}→${await karten(P)}`);
  pruefe('B11 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ C: Beispiele ═══════════════════════════════════════════════════
console.log('\n════ C: Erster Start → Beispiele laden ════');
{
  const { P, fehler, ctx } = await seite([], { erst: true });
  const begruessung = await P.waitForSelector('[data-taste="onb-beispiele"]', { state: 'visible', timeout: 8000 }).then(() => true, () => false);
  pruefe('C1 erster Start: die Begrüßung steht, die Beispiele sind noch nicht geladen', begruessung && !teil('starter'));
  await P.locator('[data-taste="onb-beispiele"]').click();
  const toast = await P.waitForFunction(() => /Beispiele geladen/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 6000 }).then(() => true, () => false);
  pruefe('C2 „Beispiele" lädt sie nach und meldet es', toast && teil('starter'));
  const zahlBoards = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.length ?? 0);
  await P.waitForFunction(() => (JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.length ?? 0) > 2, null, { timeout: 6000 }).catch(() => {});
  const boards = await zahlBoards();
  pruefe('C3 mehrere Beispiel-Boards sind angelegt', boards > 2, String(boards));
  pruefe('C4 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ D: Leerlauf ════════════════════════════════════════════════════
console.log('\n════ D: still im Leerlauf nachgeladen ════');
{
  const { P, fehler, ctx } = await seite([note('n1', 'Hallo Welt')]);
  const imLeerlauf = ['SelectionToolbar', 'importFiles', 'starter', 'GeteiltDialog', 'EbeneLoeschenFenster', 'ShareCardsModal', 'BildExport', 'kontaktExport'];
  const bis = Date.now() + 15000;
  while (Date.now() < bis && !imLeerlauf.every((n) => teil(n))) await P.waitForTimeout(300);
  const fehlt = imLeerlauf.filter((n) => !teil(n));
  pruefe('D1 ohne Zutun kommen Auswahl-Leiste, Import, Beispiele und Dialoge kurz nach dem Start (offline verfügbar)', fehlt.length === 0, fehlt.join(', '));
  const zahl = anfragen.filter((p) => /\/SelectionToolbar-/.test(p)).length;
  const t0 = Date.now();
  const da = await waehle(P, 'n1');
  pruefe(`D2 danach steht die Auswahl-Leiste sofort (${Date.now() - t0} ms), ohne neuen Abruf`, da && anfragen.filter((p) => /\/SelectionToolbar-/.test(p)).length === zahl);
  pruefe('D3 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
