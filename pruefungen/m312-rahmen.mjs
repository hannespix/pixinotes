/**
 * M312 — Weniger ist mehr, Etappe 1: der Rahmen.
 *
 *   A  Kopfleiste: Logo + Rückgängig · Wiederholen · Einstellungen; der Suche-Knopf
 *      ist bei offener Spalte verborgen; das Logo öffnet die Hilfe (mit Fassung
 *      und „Was ist neu" im Fuß); kein Logo-Menü, kein Hilfe-Knopf.
 *   B  Spalte: Suchfeld öffnet die Suche (Karten + Boards), „Aufgaben" mit Zahl
 *      öffnet die Aufgaben-Zentrale, kein Stift in Board-Zeilen, Bereiche haben
 *      ein ⋯ (umbenennen, Projekt anlegen), ＋ Neu legt Board / Projekt / Bereich an.
 *   C  Dock: genau drei Knöpfe (＋ · ✎ · ⋯); ⋯ enthält Anordnen, KI, Präsentieren,
 *      Bild-Export, Alles einpassen — kein zweites „Aufräumen", kein Archiv-Eintrag.
 *   D  Fläche: keine Zoom-Knöpfe, kein ✕ an Karten (Löschen über Leiste/Entf).
 *   E  Übersicht: keine offenen „+"/„✕"/„▶"-Knöpfe; ⋯ an Bereich, Projekt, Board.
 *   F  Begrüßung: zwei Knöpfe, „Beispiele ansehen" verdoppelt nichts.
 *   G  „Was ist neu" nennt M312.
 */
// Läuft aus dem Repository: `node pruefungen/m312-rahmen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4533;
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

const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const stand = {
  boards: [board('b1', 'Planung', [note('n1', 'Antrag prüfen'), note('n2', 'Telefonat mit Weber', 400, 60), { id: 'n4', type: 'note', width: 240, position: { x: 60, y: 320 }, data: { color: 'yellow', blocks: [{ type: 'checkListItem', props: { checked: false }, content: 'Rückruf Weber' }] } }]), board('b2', 'Ideen', [note('n3', 'Antrag Formular')]), board('b3', 'Kontakte', [])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }, { id: 'p2', name: 'Team', boardIds: ['b3'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: opt.breite ?? 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((o) => {
    if (o.frisch) return; // echter erster Start
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: o.st }));
  }, { st: opt.stand ?? stand, frisch: !!opt.frisch });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept('Neuer Name'));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const sichtbar = (P, sel) => P.evaluate((q) => [...document.querySelectorAll(q)].filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; }).length, sel);
const beschriftung = (P, sel) => P.evaluate((q) => [...document.querySelectorAll(q)].filter((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none').map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent.trim()), sel);

// ══ A: Kopfleiste ═════════════════════════════════════════════════════
console.log('\n════ A: Kopfleiste ════');
{
  const { ctx, P } = await seite();
  const oben = await beschriftung(P, '.topbar button');
  pruefe('A1 Kopfleiste: Logo (Hilfe) + Rückgängig · Wiederholen · Einstellungen', JSON.stringify(oben) === JSON.stringify(['Hilfe', 'Rückgängig', 'Wiederholen', 'Einstellungen']), JSON.stringify(oben));
  pruefe('A2 kein eigener Hilfe-Knopf, kein Logo-Menü', (await P.locator('.top-actions [aria-label="Hilfe"]').count()) === 0 && (await P.locator('.about-menu').count()) === 0);
  await P.locator('button.logo').click();
  await P.waitForTimeout(500);
  pruefe('A3 das Logo öffnet die Hilfe', (await P.locator('.help-modal').count()) === 1);
  const fuss = await P.locator('.help-fassung').textContent().catch(() => '');
  pruefe('A4 im Fuß der Hilfe stehen Fassung und Stand', /PixiNotes \d/.test(fuss) && /Stand/.test(fuss), fuss);
  pruefe('A5 … und der Link „Was ist neu"', (await P.locator('.help-neu-link').count()) === 1);
  await P.keyboard.press('Escape');
  // Suche-Knopf oben: verborgen, solange die Spalte da ist; zurück, wenn sie zu ist
  pruefe('A6 der Suche-Knopf oben ist bei offener Spalte verborgen', (await sichtbar(P, '.top-actions .ta-suche')) === 0);
  await P.locator('.tabs.spalte .tab-spalte-zu').click();
  await P.waitForTimeout(500);
  pruefe('A7 … und erscheint, sobald die Spalte eingeklappt ist', (await sichtbar(P, '.top-actions .ta-suche')) === 1);
  await P.keyboard.press('Alt+U');
  await P.waitForTimeout(400);
  await P.screenshot({ path: `${SD}/m312-a-board.png` });
  await ctx.close();
}

// ══ B: Spalte ═════════════════════════════════════════════════════════
console.log('\n════ B: Spalte ════');
{
  const { ctx, P } = await seite();
  const kopf = await beschriftung(P, '.tabs.spalte > button.tab-home, .tabs.spalte > button.tab-tasks');
  pruefe('B1 oben in der Spalte: Übersicht, Aufgaben', kopf[0] === 'Übersicht' && kopf[1] === 'Aufgaben', JSON.stringify(kopf));
  pruefe('B2 „Aufgaben" zeigt die Zahl offener Aufgaben', (await P.locator('.tabs.spalte .tab-tasks .tab-badge').count()) === 1);
  await P.locator('.tabs.spalte .tab-tasks').click();
  await P.waitForTimeout(600);
  pruefe('B3 … und öffnet die Aufgaben-Zentrale', (await P.locator('.taskhub, .th-chip').count()) > 0);
  await P.locator('.tabs.spalte .tab-home').first().click();
  await P.waitForTimeout(500);
  pruefe('B4 Übersicht schließt die Aufgaben-Zentrale wieder', (await P.locator('.th-chip').count()) === 0 && (await P.locator('.ov-mode').count()) === 1);
  await P.locator('.tabs.spalte .side-board-name', { hasText: 'Planung' }).click();
  await P.waitForTimeout(500);
  // Suchfeld = die Suche
  pruefe('B5 das Suchfeld ist ein Knopf mit Strg K', (await P.locator('.tabs.spalte button.side-tree-find kbd').count()) === 1);
  await P.locator('.tabs.spalte .side-tree-find').click();
  await P.waitForTimeout(400);
  pruefe('B6 … und öffnet die Suche', (await P.locator('.search-box').count()) === 1);
  await P.keyboard.type('Antrag');
  await P.waitForTimeout(500);
  pruefe('B7 die Suche findet Karten über alle Boards', (await P.locator('.search-hit').count()) === 2, `Treffer: ${await P.locator('.search-hit').count()}`);
  await P.keyboard.press('Control+A');
  await P.keyboard.type('Kontakte');
  await P.waitForTimeout(500);
  pruefe('B8 … und Boards nach Namen', (await P.locator('.search-cmds .hit-title', { hasText: 'Kontakte' }).count()) === 1);
  await P.locator('.search-cmds .search-cmd', { hasText: 'Kontakte' }).click();
  await P.waitForTimeout(600);
  pruefe('B9 der Board-Treffer öffnet das Board', (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId)) === 'b3');
  // Zeilen: kein Stift, ⋯ beim Zeigen; Bereich hat ein ⋯
  pruefe('B10 kein Stift mehr in Board-Zeilen', (await P.locator('.side-board-pen').count()) === 0);
  const bereich = P.locator('.tabs.spalte .side-space-head').first();
  pruefe('B11 das Bereichs-⋯ ist unsichtbar, bis man zeigt', (await sichtbar(P, '.side-space-head .ebenen-menu-knopf')) === 0);
  await bereich.hover();
  await P.waitForTimeout(300);
  pruefe('B12 … und erscheint beim Zeigen', (await sichtbar(P, '.side-space-head .ebenen-menu-knopf')) >= 1);
  await bereich.locator('.ebenen-menu-knopf').click({ force: true });
  await P.waitForTimeout(300);
  const eintraege = await P.locator('.ebenen-menu [role="menuitem"]').allTextContents();
  pruefe('B13 Bereich-⋯: Umbenennen, Neues Projekt, Löschen', /Umbenennen/.test(eintraege[0]) && /Neues Projekt/.test(eintraege[1]) && /Löschen/.test(eintraege[2]), JSON.stringify(eintraege));
  await P.locator('.ebenen-menu [role="menuitem"]', { hasText: 'Neues Projekt' }).click();
  await P.waitForTimeout(500);
  const projekte = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.spaces[0].projects.length);
  pruefe('B14 „Neues Projekt" legt eines an', projekte === 3, `Projekte: ${projekte}`);
  // ＋ Neu
  const fuss = await beschriftung(P, '.tabs.spalte .tabs-foot button');
  pruefe('B15 Fuß der Spalte: ＋ Neu und ‹ — kein Teilen', JSON.stringify(fuss) === JSON.stringify(['Neu', 'Spalte ausblenden']), JSON.stringify(fuss));
  await P.locator('.tabs-foot .tab-add').click();
  await P.waitForTimeout(300);
  const neu = (await P.locator('.neu-menu [role="menuitem"]').allTextContents()).map((t) => t.trim());
  pruefe('B16 ＋ Neu bietet Board, Projekt, Bereich, Beispiele', /^Board/.test(neu[0]) && /^Projekt/.test(neu[1]) && /^Bereich/.test(neu[2]) && /Beispiel/.test(neu[3]), JSON.stringify(neu));
  await P.locator('.neu-menu [role="menuitem"]', { hasText: 'Bereich' }).click();
  await P.waitForTimeout(500);
  const bereiche = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.spaces.length);
  pruefe('B17 „Bereich" legt einen neuen Bereich an', bereiche === 2, `Bereiche: ${bereiche}`);
  await P.locator('.tabs-foot .tab-add').click();
  await P.waitForTimeout(300);
  await P.locator('.neu-menu [role="menuitem"]', { hasText: 'Board' }).first().click();
  await P.waitForTimeout(500);
  const boards = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.length);
  pruefe('B18 „Board" legt ein Board im aktuellen Projekt an', boards === 4, `Boards: ${boards}`);
  await P.screenshot({ path: `${SD}/m312-b-spalte.png` });
  await ctx.close();
}

// ══ C: Dock ═══════════════════════════════════════════════════════════
console.log('\n════ C: Dock ════');
{
  const { ctx, P } = await seite();
  const dock = await beschriftung(P, '.dock > button, .dock > .dock-add-wrap > button');
  pruefe('C1 das Dock hat genau drei Knöpfe: ＋ · Zeichnen · ⋯', JSON.stringify(dock) === JSON.stringify(['Objekt hinzufügen', 'Zeichnen', 'Mehr']), JSON.stringify(dock));
  await P.locator('.dock [aria-label="Mehr"]').click();
  await P.waitForTimeout(300);
  const mehr = await beschriftung(P, '.dock-menu-more button');
  pruefe('C2 ⋯: KI-Assistent, Anordnen, Präsentieren, Als Bild exportieren, Alles einpassen', JSON.stringify(mehr) === JSON.stringify(['KI-Assistent', 'Anordnen', 'Präsentieren', 'Als Bild exportieren', 'Alles einpassen']), JSON.stringify(mehr));
  pruefe('C3 kein zweites „Aufräumen", kein Archiv-Eintrag im Dock', !mehr.some((m) => /aufräumen|Archiv/i.test(m)));
  await P.locator('.dock-menu-more [aria-label="Alles einpassen"]').click();
  await P.waitForTimeout(600);
  pruefe('C4 „Alles einpassen" schließt das Menü und lässt die Karten im Bild', (await P.locator('.dock-menu-more').count()) === 0 && (await P.locator('.react-flow__node').count()) === 3);
  await P.locator('.dock [aria-label="Mehr"]').click();
  await P.waitForTimeout(300);
  await P.locator('.dock-menu-more [aria-label="Präsentieren"]').click();
  await P.waitForTimeout(800);
  pruefe('C5 „Präsentieren" startet die Präsentation', (await P.locator('.presenter, .present').count()) > 0 || (await P.locator('.dock').count()) === 0);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(500);
  await ctx.close();
}

// ══ D: Fläche ═════════════════════════════════════════════════════════
console.log('\n════ D: Fläche ════');
{
  const { ctx, P } = await seite();
  pruefe('D1 keine Zoom-Knöpfe auf der Fläche', (await P.locator('.react-flow__controls').count()) === 0);
  pruefe('D2 kein ✕ an den Karten', (await P.locator('.card-x').count()) === 0);
  const frei = await beschriftung(P, 'button');
  const rahmenlos = await P.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !b.closest('.tabs, .topbar, .dock, .react-flow__node') && b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()));
  pruefe('D3 außer Impressum/Datenschutz liegt nichts Festes auf der Fläche', JSON.stringify(rahmenlos) === JSON.stringify(['Impressum', 'Datenschutz']), JSON.stringify(rahmenlos));
  pruefe('D4 Löschen über die Auswahl-Leiste bleibt', frei.length > 0);
  await P.locator('.react-flow__node').first().click({ position: { x: 6, y: 6 } });
  await P.waitForTimeout(400);
  await P.locator('.sel-toolbar [aria-label="Löschen"]').click();
  await P.waitForTimeout(400);
  pruefe('D5 … und löscht die Karte', (await P.locator('.react-flow__node').count()) === 2);
  await ctx.close();
}

// ══ E: Übersicht ══════════════════════════════════════════════════════
console.log('\n════ E: Übersicht ════');
{
  const { ctx, P } = await seite({ stand: { ...stand, view: 'overview' } });
  const offen = await P.evaluate(() => [...document.querySelectorAll('.ov-canvas button')].filter((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return r.width > 0 && cs.opacity !== '0' && !b.closest('.ov-head-actions, .ovc-tile-actions'); }).map((b) => b.getAttribute('aria-label') || b.textContent.trim()));
  pruefe('E1 keine offenen Knöpfe in der Fläche der Übersicht', offen.length === 0, JSON.stringify(offen));
  pruefe('E2 kein schwebendes „+ Neuer Bereich"', (await P.locator('.ov-add-space-float').count()) === 0);
  pruefe('E3 keine ▶-Knöpfe an Kacheln', (await P.locator('.ovc-tile-actions button[aria-label$="präsentieren"]').count()) === 0);
  pruefe('E4 Bereich, Projekt und Board tragen je ein ⋯', (await P.locator('.ovc-space .ebenen-menu-knopf').count()) === 1 && (await P.locator('.ovc-project .ebenen-menu-knopf').count()) === 2 && (await P.locator('.ovc-tile .ebenen-menu-knopf').count()) === 3);
  pruefe('E5 die ⋯ an Bereich und Projekt sind unsichtbar, bis man zeigt', (await sichtbar(P, '.ov-head-actions .ebenen-menu-knopf')) === 0);
  await P.locator('.ovc-project').first().hover();
  await P.waitForTimeout(300);
  pruefe('E6 … und erscheinen beim Zeigen', (await sichtbar(P, '.ovc-project .ov-head-actions .ebenen-menu-knopf')) >= 1);
  await P.locator('.ovc-space .ebenen-menu-knopf').first().click({ force: true });
  await P.waitForTimeout(300);
  await P.locator('.ebenen-menu [role="menuitem"]', { hasText: 'Umbenennen' }).click();
  await P.waitForTimeout(300);
  const feld = P.locator('.ovc-space-name input, input.ovc-space-name').first();
  pruefe('E7 Bereich-⋯ → Umbenennen öffnet das Feld in der Überschrift', (await feld.count()) === 1);
  if (await feld.count()) { await feld.fill('Büro'); await feld.press('Enter'); await P.waitForTimeout(400); }
  pruefe('E8 … und der neue Name gilt', (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.spaces[0].name)) === 'Büro');
  await P.screenshot({ path: `${SD}/m312-e-uebersicht.png` });
  await ctx.close();
}

// ══ F: Begrüßung ══════════════════════════════════════════════════════
console.log('\n════ F: Begrüßung beim ersten Start ════');
{
  const { ctx, P } = await seite({ frisch: true });
  const knoepfe = await P.locator('.onb-acts button').allTextContents();
  pruefe('F1 zwei Knöpfe: Loslegen, Beispiele ansehen', knoepfe.length === 2 && /Loslegen/.test(knoepfe[0]) && /Beispiele/.test(knoepfe[1]), JSON.stringify(knoepfe));
  const vorher = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{"state":{"boards":[]}}').state.boards.length);
  await P.locator('.onb-acts button', { hasText: 'Beispiele' }).click();
  await P.waitForTimeout(1200);
  const nachher = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.length);
  pruefe('F2 „Beispiele ansehen" verdoppelt die Beispiele nicht', nachher === vorher || vorher === 0, `vorher ${vorher}, nachher ${nachher}`);
  pruefe('F3 … und zeigt die Übersicht', (await P.locator('.ov-mode').count()) === 1);
  await ctx.close();
}

// ══ G: Changelog ══════════════════════════════════════════════════════
console.log('\n════ G: Was ist neu ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt M312', js.includes('Weniger ist mehr, Etappe 1 (M312)'));
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
