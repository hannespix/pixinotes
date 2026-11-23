/**
 * M381 — Eingebaute englische Oberfläche.
 *
 *   A  Umschalten: Deutsch ist die Vorgabe und lädt kein Wörterbuch; Einstellungen → Sprache → English lädt neu,
 *      die Oberfläche ist englisch und bleibt es; zurück geht es genauso.
 *   B  Rundgang auf Englisch durch die ganze Oberfläche (Board, Dock, Palette, Auswahl, Menüs, Übersicht, Aufgaben,
 *      Suche, Einstellungen, Vorlagen, Präsentation, Module): Es bleibt kein deutscher Text der Oberfläche stehen.
 *   C  Inhalte der Nutzer bleiben, wie sie sind — auch wenn sie wie ein Wort der Oberfläche lauten.
 *   D  Bewegliches: Meldungen mit Namen, Mehrzahl, Rückfragen des Browsers, Datum, Editor.
 *   E  Sprachhinweis bietet Englisch an; Startnamen; Telefon.
 *   F  Pflege: Kein Text der Oberfläche fehlt im Wörterbuch; Hilfe-Eintrag.
 *
 * Läuft aus dem Repository: node pruefungen/m381-englisch.mjs   (PN_DIST=… für einen anderen Bau)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4693;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const abrufe = [];
const app = http.createServer((q, r) => {
  const pfad = decodeURIComponent(q.url.split('?')[0]);
  abrufe.push(pfad);
  let f = path.join(DIST, pfad);
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.setHeader('content-type', TYP[path.extname(f)] ?? 'application/octet-stream');
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

// ---------- Vorrat ----------
// Inhalte der Nutzer tragen alle „Nutzer" im Text — oder sind bewusst Wörter der Oberfläche (C)
const heute = new Date().toISOString().slice(0, 10);
const karten = () => [
  { id: 'n1', type: 'note', width: 260, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 3 }, content: 'Nutzer-Notiz' }, { type: 'paragraph', content: 'Speichern' }, { type: 'checkListItem', props: { checked: false }, content: 'Nutzer-Aufgabe bis morgen' }] } },
  { id: 'k1', type: 'kanban', width: 430, position: { x: 300, y: 0 }, data: { title: 'Nutzer-Kanban', items: [{ id: 't1', text: 'Löschen', col: 0 }, { id: 't2', text: 'Nutzer-Ticket', col: 1, due: heute, who: 'Nutzerin Anna' }, { id: 't3', text: 'Nutzer fertig', col: 2 }] } },
  { id: 'g1', type: 'gantt', width: 560, height: 240, position: { x: 760, y: 0 }, data: { title: 'Nutzer-Zeitplan', dayWidth: 24, rows: [{ id: 'r1', name: 'Nutzer-Phase', start: heute, end: heute, color: '#4f7cff' }] } },
  { id: 'c1', type: 'calendar', width: 430, height: 340, position: { x: 0, y: 330 }, data: {} },
  { id: 'w1', type: 'week', width: 620, height: 440, position: { x: 460, y: 330 }, data: { title: 'Nutzer-Woche', days: 5, from: 480, to: 1020, entries: [{ id: 'e1', day: 0, start: 540, dur: 90, text: 'Nutzer-Block', color: 0 }] } },
  { id: 'z1', type: 'time', width: 460, height: 380, position: { x: 1110, y: 330 }, data: { title: 'Nutzer-Zeit', segs: [] } },
  { id: 'm1', type: 'minutes', width: 380, height: 420, position: { x: 0, y: 800 }, data: { title: 'Nutzer-Protokoll', color: 'white', entries: [{ id: 'x1', date: heute, blocks: [{ type: 'paragraph', content: 'Nutzer-Protokolltext' }] }], agenda: ['Nutzer-TOP'], rhythm: 'woche', carryOpen: true } },
  { id: 's1', type: 'sheet', width: 460, height: 300, position: { x: 410, y: 800 }, data: { title: 'Nutzer-Tabelle', cells: { A1: 'Nutzer', B1: '12' }, cols: 4, rows: 5 } },
  { id: 'b1', type: 'bubbles', width: 560, height: 440, position: { x: 900, y: 800 }, data: { title: 'Nutzer-Ideen', frage: 'Nutzer-Frage?', ideen: { i1: { text: 'Nutzer-Idee', von: 'g:x', t: 1 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } },
  { id: 'd1', type: 'mermaid', width: 356, height: 384, position: { x: 1500, y: 0 }, data: { code: 'flowchart TD\n  A[Nutzer-Start] --> B[Nutzer-Ende]' } },
  { id: 'f1', type: 'shape', width: 150, height: 70, position: { x: 1500, y: 800 }, data: { shape: 'process', text: 'Nutzer-Form', color: '#eef2ff' } },
  { id: 'p1', type: 'portal', width: 200, position: { x: 1700, y: 800 }, data: {} },
];
const REIHE = ['note', 'kanban', 'gantt', 'calendar', 'week', 'time', 'minutes', 'sheet', 'bubbles', 'mermaid', 'shape', 'portal'];
// Je Kartenart ein eigenes Board: Die Karte liegt dann groß im Bild und lässt sich bedienen
const stand = () => {
  const boards = karten().map((k) => ({ id: `b-${k.type}`, name: `Nutzer-Board ${k.type}`, nodes: [{ ...k, position: { x: 0, y: 0 } }], edges: [], drawings: [], comments: [] }));
  boards.push({ id: 'b2', name: 'Aufgaben', nodes: [], edges: [] });
  return { boards, spaces: [{ id: 's1', name: 'Nutzer-Bereich', projects: [{ id: 'p1', name: 'Nutzer-Projekt', boardIds: boards.map((b) => b.id) }] }], activeId: 'b-note', view: 'board' };
};

async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: opt.locale ?? 'de-DE', ...(opt.telefon ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.addInitScript(({ st, sprache, frisch, mensch }) => {
    if (mensch) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    if (sessionStorage.getItem('pn-test-bereit')) return;
    sessionStorage.setItem('pn-test-bereit', '1');
    if (!frisch) { localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st })); }
    if (sprache) localStorage.setItem('pixinotes-sprache', sprache);
  }, { st: stand(), sprache: opt.sprache ?? null, frisch: !!opt.frisch, mensch: !!opt.mensch });
  const P = await ctx.newPage();
  P.fehler = []; P.dialoge = [];
  P.on('pageerror', (e) => { P.fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => { P.dialoge.push(d.message()); d.accept().catch(() => {}); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  return { ctx, P };
}
const lang = (P) => P.evaluate(() => document.documentElement.lang);
const gespeichert = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
/** Lücken: deutsche Texte ohne Eintrag — ohne die Inhalte des Vorrats und ohne Texte, die schon englisch sind */
const NUTZER = /Nutzer|^Speichern$|^Löschen$|^Aufgaben$|^PixiNotes$|^Pixi$|^Notes$/;
/** Sieht der Text deutsch aus? (Umlaute, häufige deutsche Wörter und Endungen) — englische Texte fremder Bausteine sind keine Lücken */
const DEUTSCH = /[äöüßÄÖÜ]|\b(der|die|das|den|dem|und|oder|nicht|mit|für|auf|von|zum|zur|ein|eine|einen|als|ist|sind|wird|werden|kein|keine|noch|schon|jetzt|hier|dort|bitte|aus|bei|nach|vor|über|unter|zwischen|alle|alles|mehr|neu|neue|neuer|neues|heute|morgen|gestern|ja|nein|dieses|diese|dieser|deine|dein|ich|du|wir|sie|wenn|dann|nur|auch|bis|ohne|statt|kann|darf|soll|muss)\b|[a-z](ung|ungen|keit|lich|ieren|iert|chen|schaft)\b|\b[A-Z][a-z]+(en|er)\b .*\b[a-z]+en\b/;
const SCHON_ENGLISCH = /^(Press enter or space|Press delete|React Flow|Mini Map|zoom (in|out)|fit view|toggle interactivity|Control Panel)|^((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? )?(\d{1,2}[/.] ?)?(\d{1,2}[/.]\d{2,4}|\d{1,2} )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?[a-z]*\.? ?\d{0,4}$|^xxxxx\./i;
const luecken = async (P) => (await P.evaluate(() => window.__pnSprachLuecken?.() ?? [])).filter((t) => !NUTZER.test(t) && !SCHON_ENGLISCH.test(t) && DEUTSCH.test(t) && !/^[\d\s.,:/%+\-–·×()]+$/.test(t));
const esc = async (P, n = 1) => { for (let i = 0; i < n; i++) { await P.keyboard.press('Escape'); await P.waitForTimeout(180); } };

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: umschalten ════');
{
  abrufe.length = 0;
  const { ctx, P } = await seite();
  pruefe('A1 Vorgabe ist Deutsch: lang="de", deutsche Knöpfe', (await lang(P)) === 'de' && (await P.locator('[data-taste="einstellungen"]').getAttribute('title')) === 'Einstellungen', await lang(P));
  pruefe('A2 Deutsch lädt kein Wörterbuch und beobachtet nichts', !abrufe.some((a) => /\/en-[^/]+\.js$/.test(a)) && (await P.evaluate(() => typeof window.__pnSprachLuecken)) === 'undefined', abrufe.filter((a) => /en-/.test(a)).join(','));
  await P.locator('[data-taste="einstellungen"]').click(); await P.waitForTimeout(400);
  const wahl = P.locator('[data-taste="sprache"] button');
  pruefe('A3 Einstellungen → Darstellung: Sprache mit „Deutsch" und „English"', (await wahl.count()) === 2 && (await wahl.allTextContents()).join('|') === 'Deutsch|English' && (await P.locator('[data-taste="sprache"] button.on').textContent()) === 'Deutsch', (await wahl.allTextContents()).join('|'));
  await P.locator('[data-sprache-wahl="en"]').click();
  await P.waitForLoadState('networkidle'); await P.waitForTimeout(1500);
  pruefe('A4 „English" lädt die Seite neu – lang="en", Wörterbuch geladen', (await lang(P)) === 'en' && abrufe.some((a) => /\/en-[^/]+\.js$/.test(a)), `${await lang(P)}`);
  const titel = await P.locator('[data-taste="einstellungen"]').getAttribute('title');
  const dock = await P.locator('.dock').evaluate((d) => [...d.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || '').filter(Boolean));
  pruefe('A5 Kopfleiste und Dock sprechen Englisch (Beschriftungen und Tooltips)', titel === 'Settings' && dock.some((t) => /^More/.test(t)) && !dock.some((t) => /Mehr|Zeichnen|hinzufügen/.test(t)), JSON.stringify([titel, dock]));
  pruefe('A6 die Navigation: „Overview", „Tasks", Suchfeld „Search …"', /Overview/.test(await P.locator('.tabs').textContent()) && /Tasks/.test(await P.locator('.tabs').textContent()) && !/Übersicht/.test(await P.locator('.tabs').textContent()), (await P.locator('.tabs').textContent()).slice(0, 120));
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1200);
  pruefe('A7 nach neuem Laden bleibt es Englisch', (await lang(P)) === 'en' && (await P.locator('[data-taste="einstellungen"]').getAttribute('title')) === 'Settings');
  await P.screenshot({ path: `${SD}/m381-a-board.png` });
  await P.locator('[data-taste="einstellungen"]').click(); await P.waitForTimeout(400);
  pruefe('A8 in den englischen Einstellungen heißt die Zeile „Language", die Wahl bleibt „Deutsch | English"', /Language/.test(await P.locator('.modal-row', { has: P.locator('[data-taste="sprache"]') }).textContent()) && (await P.locator('[data-taste="sprache"] button').allTextContents()).join('|') === 'Deutsch|English' && (await P.locator('[data-taste="sprache"] button.on').textContent()) === 'English');
  await P.screenshot({ path: `${SD}/m381-a-einstellungen.png` });
  await P.locator('[data-sprache-wahl="de"]').click();
  await P.waitForLoadState('networkidle'); await P.waitForTimeout(1500);
  pruefe('A9 zurück auf „Deutsch": wieder deutsch', (await lang(P)) === 'de' && (await P.locator('[data-taste="einstellungen"]').getAttribute('title')) === 'Einstellungen');
  pruefe('A10 die Daten sind beim Wechsel unberührt geblieben', (await gespeichert(P)).boards.length === karten().length + 1 && (await gespeichert(P)).boards[0].name === 'Nutzer-Board note');
  pruefe('A11 keine Skriptfehler', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 300));
  await ctx.close();
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Rundgang auf Englisch ════');
const { ctx: ctxB, P } = await seite({ sprache: 'en' });
const gefunden = new Map();   // Lücke → Schritt, in dem sie zuerst auftauchte
const schritte = [];
const schritt = async (name, fn) => {
  let gut = true;
  try { await fn(); } catch (e) { gut = false; console.log(`    (Schritt „${name}" nicht ausführbar: ${String(e.message).split('\n')[0].slice(0, 120)})`); }
  await P.waitForTimeout(250);
  for (const l of await luecken(P)) if (!gefunden.has(l)) gefunden.set(l, name);
  schritte.push([name, gut]);
};
const knoten = (art) => P.locator(`.react-flow__node-${art}`).first();
/** Die Karte ins Bild holen: ihr Eintrag im Baum der Navigation springt hin */
/** ＋ Neu aufklappen (ein zweiter Klick klappte es wieder zu) */
const neuAuf = async () => { if (!(await P.locator('.neu-menu').count())) { await P.locator('.tabs-foot .tab-add').click(); await P.waitForTimeout(300); } };
const boardMenue = async () => { await P.mouse.click(1380, 860); const z = P.locator('.side-board.active'); await z.hover(); if (!(await P.locator('[data-taste="board-freigeben"]').count())) { await z.locator('.ebenen-menu-knopf').click({ force: true }); await P.waitForTimeout(350); } };
const mehrAuf = async () => { if (!(await P.locator('.dock-menu-more').count())) { await P.locator('.dock .dock-add-wrap').last().locator('button').first().click(); await P.waitForTimeout(350); } };
const springe = async (art) => {
  await esc(P);
  const offen = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state).then((z) => z.view === 'board' && z.activeId, () => null);
  if (offen !== `b-${art}`) { await P.locator('.side-board-name', { hasText: `Nutzer-Board ${art}` }).first().click(); await P.waitForTimeout(900); }
  await P.mouse.move(1380, 860);
};
const waehle = async (art) => { await knoten(art).click({ position: { x: 14, y: 7 }, force: true }); await P.waitForTimeout(350); };
await schritt('Board', async () => { await P.waitForTimeout(600); });
await schritt('Dock ＋ (Palette)', async () => { await P.locator('.dock .dock-add-wrap').nth(0).locator('button').first().click(); await P.waitForTimeout(400); await P.screenshot({ path: `${SD}/m381-b-palette.png` }); await esc(P); });
await schritt('Dock Zeichnen', async () => { await P.locator('[data-taste="zeichnen"]').click(); await P.waitForTimeout(500); await P.screenshot({ path: `${SD}/m381-b-zeichnen.png` }); await esc(P, 2); });
await schritt('Dock Mehr', async () => { await mehrAuf(); await P.screenshot({ path: `${SD}/m381-b-mehr.png` }); await esc(P); await P.mouse.click(1380, 860); });
for (const art of ['note', 'kanban', 'gantt', 'calendar', 'week', 'time', 'minutes', 'sheet', 'bubbles', 'mermaid', 'shape', 'portal']) {
  await schritt(`Karte ${art}: auswählen, Leiste, Menüs`, async () => {
    const k = knoten(art);
    await springe(art);
    await waehle(art);
    // Menüs in der Karte (⋯) und in der Auswahl-Leiste öffnen und wieder schließen
    const menues = k.locator('.ebenen-menu-knopf, .k-mehr');
    for (let i = 0; i < Math.min(3, await menues.count()); i++) { await menues.nth(i).click({ force: true }).catch(() => {}); await P.waitForTimeout(300); await esc(P); }
    const leiste = P.locator('.selection-toolbar, .sel-toolbar').first();
    if (await leiste.count()) { const mehr = leiste.locator('button[aria-haspopup], button.sel-mehr'); for (let i = 0; i < Math.min(4, await mehr.count()); i++) { await mehr.nth(i).click({ force: true }).catch(() => {}); await P.waitForTimeout(300); await esc(P); } }
    await P.mouse.click(1400, 880); await P.waitForTimeout(200);
  });
}
await schritt('Rechtsklick auf die Fläche', async () => { await P.mouse.click(1420, 500, { button: 'right' }); await P.waitForTimeout(350); await esc(P); });
await schritt('Rechtsklick auf eine Karte', async () => { await springe('note'); await knoten('note').click({ button: 'right', position: { x: 30, y: 8 }, force: true }); await P.waitForTimeout(350); await P.screenshot({ path: `${SD}/m381-b-kontext.png` }); await esc(P); });
await schritt('Notiz bearbeiten, „/"-Menü', async () => { await springe('note'); await knoten('note').locator('.note-editor').first().click({ position: { x: 30, y: 40 } }); await P.waitForTimeout(600); await P.keyboard.press('Control+End'); await P.keyboard.press('Enter'); await P.keyboard.type('/'); await P.waitForTimeout(700); await P.screenshot({ path: `${SD}/m381-b-slash.png` }); await esc(P); await P.mouse.click(1400, 880); });
await schritt('Kanban: Ticket öffnen', async () => { await springe('kanban'); await knoten('kanban').locator('.kanban-item').first().dblclick({ force: true }); await P.waitForTimeout(500); await P.screenshot({ path: `${SD}/m381-b-ticket.png` }); await esc(P, 2); });
await schritt('Wochenplan: Block öffnen', async () => { await springe('week'); await knoten('week').locator('.week-entry').first().click({ force: true }); await P.waitForTimeout(400); await P.mouse.click(1400, 880); });
await schritt('Bubbles: Menü und Liste', async () => { await springe('bubbles'); const b = knoten('bubbles'); await b.locator('[data-taste="bub-regeln"]').click({ force: true }).catch(() => {}); await P.waitForTimeout(300); await esc(P); await b.locator('[data-taste="bub-ansicht"]').click({ force: true }).catch(() => {}); await P.waitForTimeout(300); await b.locator('[data-taste="bub-ansicht"]').click({ force: true }).catch(() => {}); });
await schritt('＋ Neu', async () => { await neuAuf(); await P.screenshot({ path: `${SD}/m381-b-neu.png` }); });
await schritt('Vorlagen-Dialog', async () => { await neuAuf(); await P.locator('[data-taste="neu-vorlage"]').click(); await P.locator('[data-taste="vorlagen-dialog"]').waitFor({ timeout: 6000 }); await P.waitForTimeout(300); await P.screenshot({ path: `${SD}/m381-b-vorlagen.png` }); await esc(P); });
await schritt('Board-Menü in der Navigation', async () => { await boardMenue(); await P.screenshot({ path: `${SD}/m381-b-boardmenue.png` }); });
await schritt('Link-Dialog', async () => { await boardMenue(); await P.locator('[data-taste="board-link"]').click(); await P.waitForTimeout(600); await esc(P, 2); });
await schritt('Suche', async () => { await P.mouse.click(1380, 860); await P.keyboard.press('Control+k'); await P.waitForTimeout(400); await P.keyboard.type('note'); await P.waitForTimeout(500); await P.screenshot({ path: `${SD}/m381-b-suche.png` }); await esc(P, 2); });
await schritt('Aufgaben-Zentrale', async () => { await P.locator('[data-taste="aufgaben"]').first().click(); await P.waitForTimeout(700); await P.screenshot({ path: `${SD}/m381-b-aufgaben.png` }); await esc(P, 2); });
for (const [i, name] of [[0, 'Darstellung'], [1, 'Daten'], [2, 'Dienste']]) {
  await schritt(`Einstellungen: ${name}`, async () => { await P.locator('[data-taste="einstellungen"]').click(); await P.waitForTimeout(350); await P.locator('.modal-tabs button').nth(i).click(); await P.waitForTimeout(500); await P.screenshot({ path: `${SD}/m381-b-einstellungen-${i}.png`, fullPage: false }); await esc(P, 2); });
}
await schritt('Hilfe-Rahmen', async () => { await P.locator('[data-taste="hilfe"]').click(); await P.waitForTimeout(700); await P.screenshot({ path: `${SD}/m381-b-hilfe.png` }); await esc(P, 2); });
await schritt('Präsentation', async () => { await mehrAuf(); await P.locator('[data-taste="praesentieren"]').click(); await P.waitForTimeout(900); await P.screenshot({ path: `${SD}/m381-b-vortrag.png` }); for (let i = 0; i < 3; i++) { await P.locator('[data-taste="vortrag-weiter"]').click().catch(() => {}); await P.waitForTimeout(350); } await esc(P, 2); });
await schritt('Übersicht', async () => { await P.locator('.tabs button', { has: P.locator('svg') }).filter({ hasText: 'Overview' }).first().click(); await P.waitForTimeout(900); await P.screenshot({ path: `${SD}/m381-b-uebersicht.png` }); });
await schritt('zurück ins Board', async () => { await springe('note'); });
const offen = [...gefunden.entries()];
console.log(`    ${schritte.filter((s) => s[1]).length} von ${schritte.length} Schritten ausgeführt`);
if (offen.length) console.log('    Lücken:\n' + offen.map(([t, s]) => `      ${JSON.stringify(t)}   ← ${s}`).join('\n'));
pruefe('B1 der Rundgang lief vollständig', schritte.every((s) => s[1]), schritte.filter((s) => !s[1]).map((s) => s[0]).join(', '));
pruefe('B2 kein deutscher Text der Oberfläche blieb ohne Übersetzung', offen.length === 0, `${offen.length} Lücken`);
// Gegenprobe am Bildschirm: sichtbare Texte außerhalb der Inhalte tragen keine deutschen Kennwörter
const reste = await P.evaluate(() => {
  const aus = '[translate="no"], [contenteditable="true"], .bn-editor, .ProseMirror, code, textarea, [data-sprache="aus"]';
  const de = /\b(und|oder|nicht|löschen|speichern|hinzufügen|öffnen|schließen|Karte|Karten|Einstellungen|Übersicht|Aufgaben|rückgängig|auswählen|bearbeiten|ziehen|neue[rs]?|keine?)\b/i;
  const funde = [];
  const lauf = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
    const t = n.data.trim();
    if (!t || !de.test(t) || n.parentElement.closest(aus) || /Nutzer/.test(t)) continue;
    const r = n.parentElement.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) funde.push(t.slice(0, 70));
  }
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) for (const a of ['title', 'aria-label', 'placeholder']) { const t = el.getAttribute(a); if (t && de.test(t) && !/Nutzer/.test(t)) funde.push(`@${a}: ${t.slice(0, 70)}`); }
  return [...new Set(funde)];
});
pruefe('B3 Gegenprobe: auf dem Board steht außerhalb der Inhalte kein deutsches Wort mehr', reste.length === 0, JSON.stringify(reste.slice(0, 12)));
pruefe('B4 keine Skriptfehler im ganzen Rundgang', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 300));

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Inhalte bleiben ════');
await springe('note');
pruefe('C1 eine Notiz mit dem Wort „Speichern" zeigt weiter „Speichern"', /Speichern/.test(await knoten('note').textContent()) && !/\bSave\b/.test(await knoten('note').textContent()), (await knoten('note').textContent()).slice(0, 80));
await springe('kanban');
pruefe('C2 ein Ticket namens „Löschen" heißt weiter „Löschen"', (await knoten('kanban').locator('.kanban-item-text').allTextContents()).includes('Löschen'), (await knoten('kanban').locator('.kanban-item-text').allTextContents()).join('|'));
const kartenNamen = await P.locator('.side-card').allTextContents();
pruefe('C3b Karten ohne eigenen Titel heißen in der Navigation englisch (Calendar, Diagram, Project portal) – eigene Titel bleiben', kartenNamen.some((n) => /^Calendar \(month view/.test(n)) && kartenNamen.includes('Diagram') && kartenNamen.includes('Project portal') && kartenNamen.includes('Nutzer-Kanban') && !kartenNamen.some((n) => /Kalender|Diagramm/.test(n)), kartenNamen.join('|'));
pruefe('C3 ein Board namens „Aufgaben" heißt in der Navigation weiter „Aufgaben"', (await P.locator('.side-board-name').allTextContents()).includes('Aufgaben'), (await P.locator('.side-board-name').allTextContents()).join('|'));
const tk = /Nutzer-Kanban/.test(await knoten('kanban').textContent());
await springe('week'); const tw = /Nutzer-Woche/.test(await knoten('week').textContent());
await springe('bubbles'); const tb = /Nutzer-Frage/.test(await knoten('bubbles').locator('[data-taste="bub-frage"]').inputValue());
pruefe('C4 Titel der Karten bleiben (Nutzer-Kanban, Nutzer-Woche, Frage der Bubbles)', tk && tw && tb, JSON.stringify([tk, tw, tb]));
const sp = await gespeichert(P);
pruefe('C5 im Speicher steht alles unverändert deutsch (die Übersetzung fasst keine Daten an)', sp.boards[0].name === 'Nutzer-Board note' && JSON.stringify(sp.boards.find((b) => b.id === 'b-kanban').nodes[0].data.items.map((i) => i.text)) === JSON.stringify(['Löschen', 'Nutzer-Ticket', 'Nutzer fertig']) && sp.spaces[0].name === 'Nutzer-Bereich');

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Bewegliches ════');
const toast = () => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
await neuAuf();
await P.locator('[data-taste="neu-vorlage"]').click(); await P.locator('[data-taste="vorlagen-dialog"]').waitFor({ timeout: 6000 });
await P.locator('[data-taste="vorlage"][data-vorlage="swot"]').click(); await P.waitForTimeout(900);
pruefe('D1 Meldung mit Namen: „Board “SWOT” created from template."', /Board “SWOT” created from template\./.test(await toast()), await toast());
// alles auswählen (Board der Vorlage: acht Karten) und duplizieren → Mehrzahl
await P.mouse.click(1400, 880); await P.keyboard.press('Control+a'); await P.waitForTimeout(400);
const zahl = await P.locator('.sel-count').textContent().catch(() => '');
pruefe('D2 Auswahl-Leiste zählt englisch („… selected")', /\d+ selected/.test(zahl) && !/ausgewählt/.test(zahl), zahl);
await P.keyboard.press('Control+d'); await P.waitForTimeout(600);
const t2 = await toast();
pruefe('D3 Mehrzahl in einer Meldung: „cards", nicht „cardn"', /cards duplicated/i.test(t2) && !/cardn|Karte/.test(t2), t2);
await P.keyboard.press('Control+z'); await P.waitForTimeout(400);
await P.mouse.click(1400, 880); await P.waitForTimeout(200);
await springe('minutes');
// Rückfrage des Browsers (confirm): Protokoll-Sitzung löschen
P.dialoge.length = 0;
await waehle('minutes');
// M489: Sitzung löschen steht im ⋯-Menü der Sitzung
await knoten('minutes').locator('.pr-mehr').click({ force: true }).catch(() => {}); await P.waitForTimeout(200);
await knoten('minutes').locator('.pr-menue .pr-gefahr').click({ force: true }).catch(() => {}); await P.waitForTimeout(500);
pruefe('D4 Rückfragen des Browsers sind englisch', P.dialoge.length >= 1 && /Delete|delete/.test(P.dialoge[0]) && !/löschen/.test(P.dialoge[0]), JSON.stringify(P.dialoge).slice(0, 200));
await P.keyboard.press('Control+z'); await P.waitForTimeout(400); await P.mouse.click(1400, 880);
await springe('calendar');
const kal = await knoten('calendar').textContent();
pruefe('D5 der Kalender nennt Monat und Wochentage englisch', /(January|February|March|April|May|June|July|August|September|October|November|December)/.test(kal) && /Mon|Tue|Wed/.test(kal) && !/Dezember|Januar|Oktober/.test(kal), kal.slice(0, 120));
await springe('kanban');
const frist = await knoten('kanban').locator('.kanban-item', { hasText: 'Nutzer-Ticket' }).textContent();
pruefe('D6 Fristen sind englisch formatiert („today")', /today/i.test(frist) && !/heute/.test(frist), frist.slice(0, 120));
await springe('note');
await knoten('note').locator('.note-editor').first().click({ position: { x: 30, y: 40 } }); await P.waitForTimeout(600);
await P.keyboard.press('Control+End'); await P.keyboard.press('Enter'); await P.keyboard.type('/'); await P.waitForTimeout(700);
const slash = await P.evaluate(() => document.querySelector('.bn-suggestion-menu, [role="listbox"]')?.textContent ?? '');
pruefe('D7 das „/"-Menü des Editors ist englisch', /Heading|Paragraph|List/.test(slash) && !/Überschrift|Absatz/.test(slash), slash.slice(0, 160));
await esc(P); await P.mouse.click(1400, 880);
pruefe('D8 keine Skriptfehler', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 300));
await ctxB.close();

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Sprachhinweis, Start, Telefon ════');
{
  const { ctx, P: Q } = await seite({ locale: 'en-US', mensch: true, frisch: true });
  const h = Q.locator('[data-taste="sprach-hinweis"]');
  pruefe('E1 englischer Browser, erste Öffnung: Der Hinweis nennt die eingebaute englische Oberfläche und bietet „English"', (await h.count()) === 1 && /English interface is built in/.test(await h.textContent()) && (await Q.locator('[data-taste="sprach-englisch"]').count()) === 1, (await h.textContent().catch(() => '')).slice(0, 160));
  await Q.locator('[data-taste="sprach-englisch"]').click();
  await Q.waitForLoadState('networkidle'); await Q.waitForTimeout(1500);
  pruefe('E2 ein Klick auf „English" stellt um', (await lang(Q)) === 'en' && (await Q.locator('[data-taste="sprach-hinweis"]').count()) === 0);
  const namen = await Q.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')).state; return [s.spaces[0].name, s.spaces[0].projects[0].name, s.boards[0].name]; });
  pruefe('E3 der unberührte Start heißt dann englisch (Work · General · My board)', JSON.stringify(namen) === JSON.stringify(['Work', 'General', 'My board']), JSON.stringify(namen));
  pruefe('E4 das leere Board bietet Vorlagen und Beispiele englisch an', /Start with a template/.test(await Q.locator('[data-taste="leer-vorlage"]').textContent()) && /Load samples/.test(await Q.locator('[data-taste="leer-beispiele"]').textContent()));
  await Q.screenshot({ path: `${SD}/m381-e-start.png` });
  await ctx.close();
}
{
  const { ctx, P: Q } = await seite({ sprache: 'en' });
  // eigene Namen bleiben beim Umschalten
  pruefe('E5 eigene Namen bleiben beim Umschalten (kein „Work" über einen eigenen Bereich)', (await gespeichert(Q)).spaces[0].name === 'Nutzer-Bereich');
  await ctx.close();
}
{
  const { ctx, P: T } = await seite({ sprache: 'en', viewport: { width: 390, height: 780 }, telefon: true });
  const quer = async () => T.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const q1 = await quer();
  await T.locator('.dock .dock-add-wrap').last().locator('button').first().tap(); await T.waitForTimeout(400);
  const menue = await T.locator('.dock-menu-more').evaluate((m) => { const r = m.getBoundingClientRect(); return { l: r.left, r: r.right, quer: m.scrollWidth - m.clientWidth }; });
  await T.screenshot({ path: `${SD}/m381-e-telefon.png` });
  pruefe('E6 Telefon: englische Beschriftungen passen – nichts läuft quer über, das Menü liegt im Bild', q1 <= 1 && menue.l >= 0 && menue.r <= 390 && menue.quer <= 1 && T.fehler.length === 0, JSON.stringify([q1, menue]));
  await ctx.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Pflege ════');
let fehlend = '';
try { execFileSync('node', [path.join(__repo, 'werkzeug/sprache-ernten.mjs'), '--fehlend'], { encoding: 'utf-8' }); } catch (e) { fehlend = String(e.stdout ?? e.message); }
pruefe('F1 jeder Text der Oberfläche im Quelltext hat einen Eintrag im Wörterbuch', fehlend === '', fehlend.split('\n').slice(0, 12).join(' ¦ '));
const wb = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf-8'));
const platz = (s) => (s.match(/\{\d+\}/g) ?? []).sort().join(',');
const kaputt = Object.entries(wb).filter(([de, en]) => typeof en !== 'string' || !en || platz(de) !== platz(en));
pruefe('F2 das Wörterbuch ist vollständig belegt, Platzhalter stimmen überall', Object.keys(wb).length > 2000 && kaputt.length === 0, `${Object.keys(wb).length} Einträge, kaputt: ${JSON.stringify(kaputt.slice(0, 3))}`);
const haupt = /assets\/(index-[^"]+\.js)/.exec(readFileSync(path.join(DIST, 'index.html'), 'utf-8'))?.[1];
const teile = readdirSync(path.join(DIST, 'assets'));
pruefe('F3 das Wörterbuch ist ein eigenes Paket und steckt nicht im Start', teile.some((t) => /^en-.*\.js$/.test(t)) && !!haupt && !/Start with a template/.test(readFileSync(path.join(DIST, 'assets', haupt), 'utf-8')), String(haupt));
const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
pruefe('F4 „Was ist neu" nennt die englische Oberfläche (M381), neueste zuerst', /\(M381\)/.test(hilfe) && /English/.test(hilfe.slice(hilfe.indexOf('(M381)'), hilfe.indexOf('(M381)') + 900)) && hilfe.indexOf('(M381)') < hilfe.indexOf('(M380)'));

console.log(`\n  m381-englisch: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
