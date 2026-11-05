/**
 * M323 — Notiz nachgeschärft.
 *
 *   A  Titelzeile: erster Absatz einer mehrzeiligen Notiz fett/größer; eine
 *      einzeilige Notiz bleibt normal.
 *   B  Farbe: Farbpunkt öffnet eine Palette (5 Farben + eigene); ⋯ zeigt
 *      „Farbe" für Notizen und färbt mehrere auf einmal.
 *   C  Checklisten-Fortschritt „1/3 erledigt" → „3/3", Konfetti beim letzten Haken.
 *   D  Termine: „12.11." und „am 3.12. um 10 Uhr" werden erkannt, „12.11" ist
 *      keine Telefonnummer; echte Rufnummer bleibt Chip.
 *   E  Auto-Größe: das „/"-Menü bläht die Karte nicht auf; nach dem Löschen
 *      von Text schrumpft die Notiz nach dem Verlassen.
 *   F  Strg+V mit Text auf dem Board → Notiz mit Überschrift, Punkten, Haken.
 *   G  Aufgaben-Zentrale: ein Haken dort kommt im offenen Editor an.
 *   H  „/"-Vorlagen: Besprechung, Tagesplan …, „Heute" fügt das Datum ein.
 *   I  Fokus: Lesetypografie (≥ 15,5 px).
 *   J  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m323-notiz.mjs`
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
const PORT = 4545;
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

const lang = Array.from({ length: 12 }, (_, i) => ({ type: 'paragraph', content: `Absatz ${i + 1} mit etwas Text, damit die Karte wächst.` }));
const stand = {
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 280, position: { x: -600, y: -380 }, data: { color: 'yellow', blocks: [
      { type: 'paragraph', content: 'Einkauf Wochenende' },
      { type: 'checkListItem', props: { checked: true }, content: 'Milch' },
      { type: 'checkListItem', content: 'Brot' },
      { type: 'checkListItem', content: 'Butter' },
      { type: 'paragraph', content: 'Anruf 0151 2345678, Termin am 12.11. um 10 Uhr, Abgabe am 3.12.' },
    ] } },
    { id: 'n2', type: 'note', width: 280, position: { x: -280, y: -380 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Kurze Idee' }] } },
    // n3 hat eine GESPEICHERTE Höhe (wie nach einem Wachsen der Auto-Größe) — nur so lässt sich Schrumpfen prüfen
    { id: 'n3', type: 'note', width: 280, height: 480, position: { x: 40, y: -380 }, data: { color: 'white', blocks: lang } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', konfetti: true,
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st, spalte }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    // Die Aufgaben-Zentrale öffnet über die linke Spalte (navLinks) — dafür `spalte: true`
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: !!spalte }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, spalte: !!opt.spalte });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
}
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const karte = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
const hoehe = (P, id) => P.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"] .card-shell`)?.getBoundingClientRect().height ?? 0, id);
const warte = (P, ms = 600) => P.waitForTimeout(ms);
const chips = (P, id) => P.evaluate((id) => [...document.querySelectorAll(`.react-flow__node[data-id="${id}"] .due-chip`)].map((c) => ({ cls: c.className, t: c.textContent.trim() })), id);

// ══ A: Titelzeile ═══════════════════════════════════════════════════
console.log('\n════ A: Titelzeile ════');
{
  const { ctx, P } = await seite();
  const gewicht = (id) => P.evaluate((id) => { const p = document.querySelector(`.react-flow__node[data-id="${id}"] .bn-block-outer:first-child .bn-block-content p`); return p ? { w: getComputedStyle(p).fontWeight, s: parseFloat(getComputedStyle(p).fontSize) } : null; }, id);
  const a = await gewicht('n1'); const b = await gewicht('n2');
  pruefe('A1 erste Zeile einer mehrzeiligen Notiz ist Titel (fett, größer)', !!a && Number(a.w) >= 600 && a.s > 14, JSON.stringify(a));
  pruefe('A2 eine einzeilige Notiz bleibt normal', !!b && Number(b.w) < 600, JSON.stringify(b));
  await P.screenshot({ path: path.join(SD, 'm323-board.png') });
  await ctx.close();
}

// ══ B: Farbe ════════════════════════════════════════════════════════
console.log('\n════ B: Farbe ════');
{
  const { ctx, P } = await seite();
  await karte(P, 'n2').click({ position: { x: 8, y: 8 } }); await warte(P, 400);
  await karte(P, 'n2').locator('.color-dot').click(); await warte(P, 300);
  const pal = karte(P, 'n2').locator('.note-farben');
  pruefe('B1 Farbpunkt öffnet die Palette mit fünf Farben und eigener Farbe', (await pal.count()) === 1 && (await pal.locator('.note-farbe').count()) === 5 && (await pal.locator('input[type=color]').count()) === 1);
  pruefe('B2 die aktuelle Farbe ist markiert', await pal.locator('.note-farbe-sky').evaluate((e) => e.classList.contains('on')));
  await P.screenshot({ path: path.join(SD, 'm323-farben.png') });
  await pal.locator('.note-farbe-pink').click(); await warte(P, 400);
  let n = (await knoten(P)).find((k) => k.id === 'n2');
  pruefe('B3 Klick auf Rosa färbt die Notiz und schließt die Palette', n.data.color === 'pink' && (await karte(P, 'n2').locator('.note-farben').count()) === 0, n.data.color);
  // Mehrere Notizen über ⋯ → Farbe
  await P.keyboard.press('Escape');
  await karte(P, 'n1').click({ position: { x: 8, y: 8 } }); await warte(P, 200);
  await karte(P, 'n2').click({ position: { x: 8, y: 8 }, modifiers: ['Shift'] }); await warte(P, 400);
  await P.locator('.sel-toolbar [aria-label="Mehr"], .sel-toolbar-dock [aria-label="Mehr"]').first().click(); await warte(P, 400);
  const reihe = P.locator('.sel-more-menu .sel-farben');
  pruefe('B4 ⋯ zeigt für Notizen eine Farbreihe', (await reihe.count()) === 1 && (await reihe.locator('.sel-farbe').count()) === 5);
  await reihe.locator('.note-farbe-mint').click(); await warte(P, 400);
  const ks = await knoten(P);
  pruefe('B5 die Farbe gilt für beide ausgewählten Notizen', ks.find((k) => k.id === 'n1').data.color === 'mint' && ks.find((k) => k.id === 'n2').data.color === 'mint');
  await ctx.close();
}

// ══ C: Checklisten-Fortschritt ══════════════════════════════════════
console.log('\n════ C: Checkliste ════');
{
  const { ctx, P } = await seite();
  const fort = karte(P, 'n1').locator('.note-fortschritt');
  pruefe('C1 „1/3 erledigt" mit Balken unter der Notiz', (await fort.count()) === 1 && /1\/3 erledigt/.test(await fort.textContent()));
  pruefe('C2 die einzeilige Notiz zeigt keinen Fortschritt', (await karte(P, 'n2').locator('.note-fortschritt').count()) === 0);
  const boxen = karte(P, 'n1').locator('.note-editor input[type=checkbox]');
  await boxen.nth(1).click(); await warte(P, 500);
  pruefe('C3 ein Haken → „2/3 erledigt"', /2\/3 erledigt/.test(await fort.textContent()), await fort.textContent());
  const canvasVorher = await P.evaluate(() => document.querySelectorAll('canvas').length);
  await boxen.nth(2).click(); await warte(P, 700);
  pruefe('C4 der letzte Haken → „3/3", fertig-Zustand', /3\/3 erledigt/.test(await fort.textContent()) && (await fort.evaluate((e) => e.classList.contains('fertig'))));
  const canvasNachher = await P.evaluate(() => document.querySelectorAll('canvas').length);
  pruefe('C5 Konfetti beim letzten Haken (Konfetti eingeschaltet)', canvasNachher > canvasVorher, `${canvasVorher} → ${canvasNachher}`);
  await ctx.close();
}

// ══ D: Termine & Telefon ════════════════════════════════════════════
console.log('\n════ D: Termine & Telefon ════');
{
  const { ctx, P } = await seite();
  const c = await chips(P, 'n1');
  const termine = c.filter((x) => /due-/.test(x.cls) && !/ent-chip|link-chip/.test(x.cls));
  pruefe('D1 „12.11." und „3.12." werden als Termine erkannt', termine.some((t) => /12\.11\./.test(t.t)) && termine.some((t) => /03\.12\./.test(t.t)), JSON.stringify(termine));
  const tel = c.filter((x) => /ent-chip-tel/.test(x.cls));
  pruefe('D2 „12.11" ist keine Telefonnummer, 0151 2345678 schon', tel.length === 1 && /0151/.test(tel[0].t), JSON.stringify(tel));
  await ctx.close();
}

// ══ E: Auto-Größe ═══════════════════════════════════════════════════
console.log('\n════ E: Auto-Größe ════');
{
  const { ctx, P } = await seite();
  const h0 = await hoehe(P, 'n2');
  await karte(P, 'n2').locator('.bn-editor').first().click(); await warte(P, 300);
  await P.keyboard.press('End'); await P.keyboard.press('Enter'); await P.keyboard.type('/'); await warte(P, 900);
  const menue = await P.locator('.bn-suggestion-menu').count();
  await P.keyboard.press('Escape'); await P.keyboard.press('Backspace'); await P.keyboard.press('Backspace'); await warte(P, 300);
  await P.mouse.click(1200, 800); await warte(P, 1600);
  const h1 = await hoehe(P, 'n2');
  pruefe('E1 das „/"-Menü bläht die Karte nicht dauerhaft auf', menue === 1 && h1 <= h0 + 30, `${h0} → ${h1} (Menü ${menue})`);
  // Schrumpfen: langer Text raus
  const h2 = await hoehe(P, 'n3');
  await karte(P, 'n3').locator('.bn-editor').first().click(); await warte(P, 300);
  await P.keyboard.press('Control+a'); await P.keyboard.press('Delete'); await P.keyboard.type('Kurz.'); await warte(P, 400);
  const h3 = await hoehe(P, 'n3');
  await P.mouse.click(1200, 800); await warte(P, 1800);
  const h4 = await hoehe(P, 'n3');
  pruefe('E2 beim Tippen bleibt die Höhe stehen, nach dem Verlassen schrumpft die Notiz auf den Inhalt', h3 >= h2 - 5 && h4 < h2 - 80 && h4 >= 90, `${h2} → ${h3} → ${h4}`);
  await P.screenshot({ path: path.join(SD, 'm323-schrumpf.png') });
  await ctx.close();
}

// ══ F: Strg+V mit Text ══════════════════════════════════════════════
console.log('\n════ F: Text einfügen ════');
{
  const { ctx, P } = await seite();
  await P.mouse.click(1200, 800); await warte(P, 300);
  await P.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '# Plan\nErster Satz.\n- eins\n- [ ] zwei\n- [x] drei\n1. vier');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await warte(P, 800);
  const neu = (await knoten(P)).find((k) => !['n1', 'n2', 'n3'].includes(k.id));
  const typen = neu?.data.blocks.map((b) => b.type) ?? [];
  pruefe('F1 Text aus der Zwischenablage wird eine Notiz mit Überschrift, Punkten, Haken und Nummer', !!neu && neu.type === 'note' && typen.join(',') === 'heading,paragraph,bulletListItem,checkListItem,checkListItem,numberedListItem' && neu.data.blocks[4].props.checked === true, typen.join(','));
  pruefe('F2 Hinweis „Notiz aus der Zwischenablage"', /Zwischenablage/.test(await P.evaluate(() => document.querySelector('.toast')?.textContent ?? '')));
  await ctx.close();
}

// ══ G: Aufgaben-Zentrale → offener Editor ═══════════════════════════
console.log('\n════ G: Aufgaben-Rückweg ════');
{
  const { ctx, P } = await seite({ spalte: true });
  await P.locator('.tab-tasks').first().click(); await warte(P, 700);
  const zeile = P.locator('.taskhub .task-row', { hasText: 'Brot' }).first();
  pruefe('G1 die Aufgabe „Brot" steht in der Zentrale', (await zeile.count()) === 1);
  await zeile.locator('input[type=checkbox]').first().click(); await warte(P, 800);
  const n1 = (await knoten(P)).find((k) => k.id === 'n1');
  pruefe('G2 der Haken steht im Stand — und extEpoch ist hochgezählt, damit ein offener Editor ihn übernimmt', n1.data.blocks.find((b) => b.content?.[0]?.text === 'Brot' || b.content === 'Brot')?.props?.checked === true && typeof n1.data.extEpoch === 'number' && n1.data.extEpoch >= 1, JSON.stringify({ epoch: n1.data.extEpoch }));
  // Die Zentrale blendet das Board aus; nach dem Schließen zeigt der Editor den Haken
  await P.keyboard.press('Escape'); await warte(P, 900);
  const imEditor = await P.evaluate(() => { const items = [...document.querySelectorAll('.react-flow__node[data-id="n1"] [data-content-type="checkListItem"]')]; return items.map((i) => ({ t: i.textContent.trim(), c: i.querySelector('input[type=checkbox]')?.checked })); });
  pruefe('G3 nach dem Schließen zeigt der Editor den Haken', imEditor.find((i) => /Brot/.test(i.t))?.c === true, JSON.stringify(imEditor));
  await ctx.close();
}

// ══ H: Vorlagen & Heute ═════════════════════════════════════════════
console.log('\n════ H: Vorlagen ════');
{
  const { ctx, P } = await seite();
  await karte(P, 'n2').locator('.bn-editor').first().click(); await warte(P, 300);
  await P.keyboard.press('End'); await P.keyboard.press('Enter'); await P.keyboard.type('/bespr'); await warte(P, 900);
  const eintrag = P.locator('.bn-suggestion-menu-item', { hasText: 'Besprechung' }).first();
  pruefe('H1 „/bespr" findet die Vorlage Besprechung', (await eintrag.count()) === 1);
  await eintrag.click(); await warte(P, 700);
  let n2 = (await knoten(P)).find((k) => k.id === 'n2');
  const typen = n2.data.blocks.map((b) => b.type);
  const texte = n2.data.blocks.map((b) => (Array.isArray(b.content) ? b.content.map((c) => c.text).join('') : ''));
  pruefe('H2 die Vorlage steht in der Notiz (Überschrift mit Datum, Themen, Entscheidungen, Aufgaben)', typen.includes('heading') && typen.includes('checkListItem') && texte.some((t) => /^Besprechung .*\d{4}/.test(t)) && texte.includes('Aufgaben'), texte.join(' | ').slice(0, 160));
  pruefe('H3 der leere Absatz wurde ersetzt, nicht stehen gelassen', !(typen[1] === 'paragraph' && texte[1] === ''), typen.slice(0, 3).join(','));
  // Heute
  await P.keyboard.press('Control+End'); await P.keyboard.press('Enter'); await P.keyboard.type('/heute'); await warte(P, 900);
  const heute = P.locator('.bn-suggestion-menu-item', { hasText: 'Heute' }).first();
  await heute.click(); await warte(P, 600);
  n2 = (await knoten(P)).find((k) => k.id === 'n2');
  // BlockNote hält am Ende immer einen leeren Absatz bereit — der letzte Block MIT Text zählt
  const texteAlle = n2.data.blocks.map((b) => (Array.isArray(b.content) ? b.content.map((c) => c.text).join('') : ''));
  const lt = [...texteAlle].reverse().find(Boolean) ?? '';
  pruefe('H4 „/heute" fügt das Datum ein', /\d{2}\.\d{2}\.\d{4}/.test(lt), lt);
  await ctx.close();
}

// ══ I: Fokus ════════════════════════════════════════════════════════
console.log('\n════ I: Fokus ════');
{
  const { ctx, P } = await seite();
  const box = await karte(P, 'n1').boundingBox();
  await P.mouse.dblclick(box.x + 6, box.y + box.height - 6); await warte(P, 1200);
  const f = await P.evaluate(() => { const ed = document.querySelector('.pn-focused .note-editor .bn-editor'); return ed ? { fs: parseFloat(getComputedStyle(ed).fontSize), w: ed.getBoundingClientRect().width } : null; });
  pruefe('I1 im Fokus liest sich die Notiz größer (≥ 15,5 px) und in Lesebreite', !!f && f.fs >= 15.5 && f.w < 1000, JSON.stringify(f));
  await P.screenshot({ path: path.join(SD, 'm323-fokus.png') });
  await ctx.close();
}

// ══ J: Texte ════════════════════════════════════════════════════════
console.log('\n════ J: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('J1 „Was ist neu" nennt „Notiz, nachgeschärft (M323)"', js.includes('Notiz, nachgeschärft (M323)'));
  pruefe('J2 die Hilfe nennt die aktuelle Leiste A− / A+ statt A₋ / A₊ / A₊₊', js.includes('A− / A+') && !js.includes('A₋ / A₊ / A₊₊'));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
