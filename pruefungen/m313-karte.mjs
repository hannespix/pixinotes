/**
 * M313 — Weniger ist mehr, Etappe 2: die Karte.
 *
 *   A  Auswahl-Leiste: Duplizieren · Teilen · ⋯ · Löschen (+ Zähler); kein Verschieben-Knopf.
 *   B  ⋯: Kommentar, Eigenschaften, In Board verschieben, Werkzeuge, Weitergeben,
 *      Aufräumen — kein „Formatiert kopieren" (das steht im Teilen-Dialog);
 *      „In Board verschieben" verschiebt wirklich.
 *   C  Zeitplan-Kopf: ＋ Vorgang und ⋯ (Übernehmen, Konflikte, Gruppieren, Heute,
 *      Einpassen, Zoom, Zeit-Skala) — nicht mehr neun Knöpfe.
 *   D  Rechen-Tabelle: ＋ Zeile und ⋯ (Spalte, Auto-Summe, CSV).
 *   E  Diagramm: nur ＋-Knöpfe des Typs und ⋯ (Vorlage, Farbschema, Look, …).
 *   F  Kalender: Ansicht, Navigation, ⋯ mit Quelle — kein Quellen-Knopf im Kopf.
 *   G  „Was ist neu" nennt M313.
 */
// Läuft aus dem Repository: `node pruefungen/m313-karte.mjs`
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
const PORT = 4534;
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
const stand = {
  boards: [
    { id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [
      note('n1', 'Antrag prüfen'),
      { id: 'g1', type: 'gantt', width: 560, height: 260, position: { x: 60, y: 300 }, data: { title: 'Zeitplan', rows: [{ id: 'r1', name: 'Konzept', start: '2026-11-03', end: '2026-11-10' }] } },
      { id: 's1', type: 'sheet', width: 420, height: 220, position: { x: 700, y: 60 }, data: { title: 'Kosten', rows: 4, cols: 3, cells: {} } },
      { id: 'd1', type: 'mermaid', width: 420, height: 260, position: { x: 700, y: 320 }, data: { code: 'flowchart LR\n  A[Start] --> B[Ende]' } },
      { id: 'c1', type: 'calendar', width: 420, height: 300, position: { x: 1200, y: 60 }, data: { view: 'month' } },
    ] },
    { id: 'b2', name: 'Ideen', edges: [], drawings: [], comments: [], nodes: [note('n3', 'Formular')] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const texte = (P, sel) => P.evaluate((q) => [...document.querySelectorAll(q)].filter((el) => el.getBoundingClientRect().width > 0).map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent.trim()).replace(/\s+/g, ' ')), sel);
const waehle = async (P, id) => { await P.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 8, y: 6 } }); await P.waitForTimeout(500); };

// ══ A/B: Auswahl-Leiste und ⋯ ═════════════════════════════════════════
console.log('\n════ A: Auswahl-Leiste ════');
const { ctx, P } = await seite();
{
  await waehle(P, 'n1');
  const leiste = await P.locator('.sel-toolbar button:not(.sel-menu-fixed button)').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent.trim()));
  pruefe('A1 vier Knöpfe: Duplizieren, Teilen, Mehr, Löschen', JSON.stringify(leiste) === JSON.stringify(['Duplizieren', 'Teilen', 'Mehr', 'Löschen']), JSON.stringify(leiste));
  pruefe('A2 kein Verschieben-Knopf mehr in der Leiste', (await P.locator('.sel-toolbar [aria-label="Verschieben"]').count()) === 0);
  await P.locator('.sel-toolbar [aria-label="Mehr"]').click();
  await P.waitForTimeout(300);
  const mehr = await P.locator('.sel-more-menu button').allTextContents().then((t) => t.map((x) => x.trim()));
  console.log('    ⋯:', JSON.stringify(mehr));
  pruefe('B1 ⋯ beginnt mit Kommentar, Eigenschaften, In Board verschieben', /^Kommentar/.test(mehr[0]) && /^Eigenschaften/.test(mehr[1]) && /^In Board verschieben/.test(mehr[2]), JSON.stringify(mehr.slice(0, 3)));
  pruefe('B2 kein „Formatiert kopieren" im ⋯', !mehr.some((m) => /Formatiert kopieren/.test(m)));
  const titel = await P.locator('.sel-more-menu .sel-attr-title').allTextContents();
  pruefe('B3 Abschnitte: Werkzeuge, Weitergeben, Aufräumen', JSON.stringify(titel) === JSON.stringify(['Werkzeuge', 'Weitergeben', 'Aufräumen']), JSON.stringify(titel));
  pruefe('B4 Nachschlagen und Vorlage stehen unter Weitergeben, Archivieren zuletzt', mehr.some((m) => /Nachschlagen/.test(m)) && mehr.some((m) => /Vorlage/.test(m)) && /Archivieren/.test(mehr[mehr.length - 1]), JSON.stringify(mehr));
  await P.locator('.sel-more-menu [aria-label="Verschieben"]').click();
  await P.waitForTimeout(300);
  pruefe('B5 „In Board verschieben" öffnet die Board-Liste', (await P.locator('.sel-move-menu').count()) === 1);
  await P.locator('.sel-move-menu button', { hasText: 'Ideen' }).click();
  await P.waitForTimeout(600);
  const b2 = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((b) => b.id === 'b2').nodes.map((n) => n.id));
  pruefe('B6 … und verschiebt die Karte wirklich', b2.includes('n1'), JSON.stringify(b2));
  // Teilen-Dialog trägt das formatierte Kopieren
  await waehle(P, 's1');
  await P.locator('.sel-toolbar [aria-label="Teilen"]').click();
  await P.waitForTimeout(400);
  pruefe('B7 der Teilen-Dialog bietet „Kopieren (formatiert)"', (await P.locator('.share-cards-modal button', { hasText: /Kopieren/ }).count()) >= 1);
  await P.locator('.share-cards-modal .modal-x').click();
  await P.waitForTimeout(400);
  if (await P.locator('.modal-backdrop').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(300); }
  await P.screenshot({ path: `${SD}/m313-a-leiste.png` });
}

// ══ C: Zeitplan ═══════════════════════════════════════════════════════
console.log('\n════ C: Zeitplan-Kopf ════');
{
  await waehle(P, 'g1');
  const kopf = await texte(P, '.react-flow__node[data-id="g1"] .gantt-tools > button, .react-flow__node[data-id="g1"] .gantt-tools .ebenen-menu-knopf');
  pruefe('C1 der Kopf hat ＋ Vorgang und ⋯ — nicht neun Knöpfe', kopf.length === 2 && /Vorgang/.test(kopf[0]) && /^Mehr/.test(kopf[1]), JSON.stringify(kopf));
  pruefe('C2 kein Skalen-Auswahlfeld mehr im Kopf', (await P.locator('.gantt-scale').count()) === 0);
  // echter Klick (Maus): die ausgewählte Karte reicht ihn an das ⋯ durch
  await P.locator('.react-flow__node[data-id="g1"] .gantt-tools .ebenen-menu-knopf').click();
  await P.waitForTimeout(300);
  const m = await P.locator('.ebenen-menu button').allTextContents().then((t) => t.map((x) => x.trim()));
  pruefe('C3 ⋯: Übernehmen, Konflikte, Gruppieren, Heute, Einpassen, Zoom, Zeit-Skala', ['Aufgaben übernehmen', 'Konflikte auflösen', 'Nach Ressource gruppieren', 'Zu heute springen', 'Alles einpassen', 'Reinzoomen', 'Rauszoomen'].every((e) => m.includes(e)) && m.some((x) => /Monate|Wochen|Tage/.test(x)), JSON.stringify(m));
  await P.locator('.ebenen-menu button', { hasText: 'Alles einpassen' }).click();
  await P.waitForTimeout(400);
  pruefe('C4 ein Eintrag schließt das Menü', (await P.locator('.ebenen-menu').count()) === 0);
}

// ══ D: Rechen-Tabelle ═════════════════════════════════════════════════
console.log('\n════ D: Rechen-Tabelle ════');
{
  await waehle(P, 's1');
  const kopf = await texte(P, '.react-flow__node[data-id="s1"] .sheet-tools > button, .react-flow__node[data-id="s1"] .sheet-tools .ebenen-menu-knopf');
  pruefe('D1 der Kopf hat ＋ Zeile und ⋯', kopf.length === 2 && /Zeile/.test(kopf[0]) && /^Mehr/.test(kopf[1]), JSON.stringify(kopf));
  await P.evaluate(() => document.querySelector('.react-flow__node[data-id="s1"] .sheet-tools .ebenen-menu-knopf')?.click());
  await P.waitForTimeout(300);
  const m = await P.locator('.ebenen-menu button').allTextContents().then((t) => t.map((x) => x.trim()));
  pruefe('D2 ⋯: Spalte anhängen, Auto-Summe, Als CSV speichern', JSON.stringify(m) === JSON.stringify(['Spalte anhängen', 'Auto-Summe', 'Als CSV speichern']), JSON.stringify(m));
  await P.locator('.ebenen-menu button', { hasText: 'Spalte anhängen' }).click();
  await P.waitForTimeout(400);
  const cols = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 's1').data.cols);
  pruefe('D3 „Spalte anhängen" wirkt', cols === 4, `cols: ${cols}`);
}

// ══ E: Diagramm ═══════════════════════════════════════════════════════
console.log('\n════ E: Diagramm ════');
{
  await waehle(P, 'd1');
  // Die Diagramm-Leiste ist eine NodeToolbar (Portal außerhalb des Knotens) — nur die ausgewählte Karte hat eine
  const kopf = await texte(P, '.mm-row > button, .mm-row .ebenen-menu-knopf');
  pruefe('E1 der Kopf zeigt ＋ Schritt und ⋯ — keine Farbpunkte, kein Vorlage-Knopf', kopf.length === 2 && /Schritt/.test(kopf[0]) && /^Mehr/.test(kopf[1]), JSON.stringify(kopf));
  await P.evaluate(() => document.querySelector('.mm-row .ebenen-menu-knopf')?.click());
  await P.waitForTimeout(300);
  const titel = await P.locator('.ebenen-menu .ebenen-menu-titel').allTextContents();
  pruefe('E2 ⋯: Vorlage, Farbschema, Darstellung', JSON.stringify(titel) === JSON.stringify(['Vorlage', 'Farbschema', 'Darstellung']), JSON.stringify(titel));
  pruefe('E3 … mit Look, Richtung, Einpassen und Code', (await P.locator('.ebenen-menu button', { hasText: /Look/ }).count()) === 1 && (await P.locator('.ebenen-menu button', { hasText: /Richtung/ }).count()) === 1 && (await P.locator('.ebenen-menu button', { hasText: /Code/ }).count()) === 1);
  pruefe('E4 die Farbpunkte liegen im Menü', (await P.locator('.ebenen-menu .kopf-menu-dots .mm-dot').count()) >= 3);
  await P.locator('.ebenen-menu button', { hasText: /Look/ }).click();
  await P.waitForTimeout(1000); // der Speicher schreibt gedrosselt (400 ms)
  const look = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'd1').data.look);
  pruefe('E5 „Handgezeichneter Look" schaltet um', look === 'hand', String(look));
}

// ══ F: Kalender ═══════════════════════════════════════════════════════
console.log('\n════ F: Kalender ════');
{
  await waehle(P, 'c1');
  const kopf = await texte(P, '.react-flow__node[data-id="c1"] .cal-nav button');
  pruefe('F1 Kopf: Ansicht, ‹, heute, ›, ⋯ — kein Quellen-Knopf', kopf.length === 5 && !kopf.some((k) => /Alle Boards|Dieses Board/.test(k)) && /^Mehr/.test(kopf[4]), JSON.stringify(kopf));
  await P.evaluate(() => document.querySelector('.react-flow__node[data-id="c1"] .cal-nav [aria-label="Mehr"]')?.click());
  await P.waitForTimeout(300);
  const quelle = await P.locator('.cal-menu input[type="radio"]').count();
  pruefe('F2 ⋯ bietet die Quelle als Auswahl (Alle Boards · Nur dieses Board)', quelle >= 2, `Radios: ${quelle}`);
  await P.locator('.cal-menu label', { hasText: 'Nur dieses Board' }).click();
  await P.waitForTimeout(400);
  const scope = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'c1').data.scope);
  pruefe('F3 … und die Wahl wird gespeichert', scope === 'board', String(scope));
  await P.screenshot({ path: `${SD}/m313-f-kalender.png` });
}
await ctx.close();

// ══ G: Changelog ══════════════════════════════════════════════════════
console.log('\n════ G: Was ist neu ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt M313', js.includes('Etappe 2 — die Karte (M313)'));
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
