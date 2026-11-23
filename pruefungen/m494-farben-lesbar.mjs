/**
 * M494 — Farben lesbar auf jeder Fläche.
 *
 *   A  Editor-Farben (BlockNote: jede Schriftfarbe, jede Hintergrundfarbe und jede Kombination) auf einer WEISSEN
 *      Notiz im Dunkeln — ruhend und im Editor — sowie im Protokoll im Thema (dunkel) und im Protokoll mit dunkler
 *      eigener Farbe (hell): jede Stelle ≥ 4,5:1.
 *   B  Hell bleibt unverändert: dieselbe Notiz im Hellen und eine gelbe Haftnotiz im Dunkeln zeigen genau BlockNotes
 *      Farben (helles Papier).
 *   C  Schrift auf frei gewählten Farben (hell, mittel, dunkel): Gantt-Balken (mit und ohne Fortschritt),
 *      Kalender-Streifen der Wochenansicht und farbige Termine im Tagesdialog, Wochenplan-Blöcke (Palette und freie
 *      Farben), Zeiterfassung mit laufender Pause, Kanban-Etiketten — in Hell und Dunkel ≥ 4,5:1.
 *   D  Nicht-Text-Kontrast (WCAG 1.4.11, werkzeug/kontrast-pruefen.mjs randScan/fokusScan): Ränder von
 *      Eingabefeldern und Kästchen sowie Fokusringe in den wichtigsten Dialogen ≥ 3:1, in Hell und Dunkel.
 *   E  Keine Seitenfehler.
 *
 * Bilder: M494_BILDER=<ordner> legt Bildschirmfotos ab (Editor-Farben dunkel, Gantt mit freien Farben).
 */
// Läuft aus dem Repository: `node pruefungen/m494-farben-lesbar.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, randScan, fokusScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M494_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5494;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const heute = new Date(); const iso = (n) => { const d = new Date(heute.getTime() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const meldung = (liste) => liste.slice(0, 4).map(trefferZeile).join(' | ');

// ---------- Inhalt: alle Editor-Farben ----------
const FARBEN = ['gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const span = (text, styles = {}) => ({ type: 'text', text, styles });
const farbBloecke = () => [
  // je Schriftfarbe eine Zeile (auf dem Papier)
  { type: 'paragraph', content: FARBEN.map((f) => span(`${f} `, { textColor: f })) },
  // je Hintergrundfarbe eine Zeile: Standardschrift darauf und jede Schriftfarbe darauf
  ...FARBEN.map((g) => ({ type: 'paragraph', content: [span(`${g}:`, { backgroundColor: g }), ...FARBEN.map((f) => span(` ${f.slice(0, 3)}`, { textColor: f, backgroundColor: g }))] })),
];
const BLOCKNOTE_HELL = { red: 'rgb(224, 62, 62)', gray: 'rgb(155, 154, 151)', blueGrund: 'rgb(221, 235, 241)' };

const stand = (nodes) => ({ boards: [{ id: 'b0', name: 'Prüfung', edges: [], drawings: [], comments: [], nodes }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' });
async function seite(nodes, { dunkel = true, hoehe = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: hoehe }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([s, d]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ theme: d ? 'dark' : 'light' }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [stand(nodes), dunkel]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30_000 });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const foto = async (P, name, sel) => {
  if (!BILDER) return;
  if (sel) await P.locator(sel).first().screenshot({ path: path.join(BILDER, `${name}.png`) });
  else await P.screenshot({ path: path.join(BILDER, `${name}.png`) });
};
/** Alle Textstellen mit Editor-Farbe unter `sel` (gefärbte Schrift oder gefärbter Grund in ihrer Kette) */
const farbStellen = async (P, sel) => (await kontrastScan(P, sel, { alle: true }))
  .filter((t) => /^(gray|brown|red|orange|yellow|green|blue|purple|pink):?$|^(gra|bro|red|ora|yel|gre|blu|pur|pin)$/.test(t.text));
const auswerten = (name, liste, mindest) => {
  const schlecht = liste.filter((t) => t.v < 4.5);
  const min = liste.length ? Math.min(...liste.map((t) => t.v)) : 0;
  pruefe(`${name}: ${liste.length} farbige Stellen, alle ≥ 4,5:1 (min ${min})`, liste.length >= mindest && !schlecht.length,
    liste.length < mindest ? `(nur ${liste.length} gefunden)` : meldung(schlecht));
};

console.log('════ A: Editor-Farben auf dunklem Papier ════');
{
  const { ctx, P } = await seite([
    { id: 'w1', type: 'note', width: 760, height: 560, position: { x: 80, y: 60 }, data: { color: 'white', blocks: farbBloecke() } },
  ], { dunkel: true });
  const sel = '.react-flow__node[data-id="w1"]';
  auswerten('A weiße Notiz dunkel, ruhend', await farbStellen(P, sel), 90);
  await foto(P, 'dunkel-editor-farben', sel);
  // In den Editor: BlockNote zeichnet die Farben jetzt selbst (data-style-type)
  await P.locator(`${sel} .card-grip`).first().click({ force: true }).catch(() => {});
  await P.locator(`${sel} .notiz-ruhend, ${sel} .bn-editor`).first().click(); await P.waitForTimeout(1200);
  const imEditor = await P.locator(`${sel} [data-style-type]`).count();
  pruefe(`A Editor geöffnet (${imEditor} gefärbte Stellen von BlockNote)`, imEditor >= 90);
  auswerten('A weiße Notiz dunkel, im Editor', await farbStellen(P, sel), 90);
  await ctx.close();
}
{
  const eintrag = { id: 'x1', date: iso(0), attendees: 'Anna', blocks: farbBloecke(), decisions: [] };
  for (const [name, data, dunkel] of [
    ['Protokoll im Thema (dunkel)', { title: 'Farben', color: 'white', entries: [eintrag], current: 'x1' }, true],
    ['Protokoll in dunkler eigener Farbe (hell)', { title: 'Farben', color: 'white', hex: '#1f2a44', entries: [eintrag], current: 'x1' }, false],
  ]) {
    const { ctx, P } = await seite([{ id: 'm1', type: 'minutes', width: 760, height: 720, position: { x: 80, y: 40 }, data }], { dunkel });
    const sel = '.react-flow__node[data-id="m1"]';
    auswerten(`A ${name}`, await farbStellen(P, sel), 90);
    await ctx.close();
  }
}

console.log('════ B: Hell und helles Papier unverändert ════');
{
  const farbeVon = (P, sel) => P.evaluate((sel) => {
    const rot = document.querySelector(`${sel} [data-text-color="red"]:not([data-background-color]), ${sel} [data-style-type="textColor"][data-value="red"]`);
    const blau = document.querySelector(`${sel} [data-background-color="blue"], ${sel} [data-style-type="backgroundColor"][data-value="blue"]`);
    const grau = document.querySelector(`${sel} [data-text-color="gray"], ${sel} [data-style-type="textColor"][data-value="gray"]`);
    return { red: rot && getComputedStyle(rot).color, gray: grau && getComputedStyle(grau).color, blueGrund: blau && getComputedStyle(blau).backgroundColor };
  }, sel);
  {
    const { ctx, P } = await seite([{ id: 'w1', type: 'note', width: 760, height: 560, position: { x: 80, y: 60 }, data: { color: 'white', blocks: farbBloecke() } }], { dunkel: false });
    const f = await farbeVon(P, '.react-flow__node[data-id="w1"]');
    pruefe(`B weiße Notiz hell: BlockNotes Farben (${f.red}, ${f.gray}, ${f.blueGrund})`, f.red === BLOCKNOTE_HELL.red && f.gray === BLOCKNOTE_HELL.gray && f.blueGrund === BLOCKNOTE_HELL.blueGrund, JSON.stringify(f));
    await ctx.close();
  }
  {
    const { ctx, P } = await seite([{ id: 'y1', type: 'note', width: 760, height: 560, position: { x: 80, y: 60 }, data: { color: 'yellow', blocks: farbBloecke() } }], { dunkel: true });
    const f = await farbeVon(P, '.react-flow__node[data-id="y1"]');
    pruefe(`B gelbe Haftnotiz dunkel: helles Papier, BlockNotes Farben (${f.red})`, f.red === BLOCKNOTE_HELL.red && f.gray === BLOCKNOTE_HELL.gray && f.blueGrund === BLOCKNOTE_HELL.blueGrund, JSON.stringify(f));
    await ctx.close();
  }
}

console.log('════ C: Schrift auf frei gewählten Farben ════');
// Palette: hell, mittel (die schwierige Mitte um Leuchtdichte 0,2), dunkel
const PALETTE = ['#f6e58d', '#ffd166', '#4f7cff', '#3fa564', '#e07a3f', '#a05fd4', '#d44f6e', '#8a8375', '#2aa198', '#2b2a27', '#1d3557', '#6b2737'];
const ganttZeilen = PALETTE.map((c, i) => ({ id: `r${i}`, name: `Vorgang ${i + 1}`, start: iso(-2), end: iso(9), color: c, ...(i % 2 ? { progress: 55 } : {}) }));
const kalenderTermine = PALETTE.map((c, i) => ({ id: `e${i}`, date: iso(i % 7 - 3), endDate: iso((i % 7) - 2), title: `Termin ${i + 1}`, color: c }));
const wocheBloecke = [
  ...[0, 1, 2, 3, 4, 5].map((c, i) => ({ id: `p${i}`, day: i % 5, start: 480 + Math.floor(i / 5) * 120, dur: 90, text: `Palette ${c}`, color: c, who: 'Anna' })),
  ...PALETTE.map((c, i) => ({ id: `f${i}`, day: i % 5, start: 720 + Math.floor(i / 5) * 100, dur: 80, text: `Frei ${i + 1}`, colorHex: c, who: 'Gerd' })),
];
/** Gantt: Schrift jedes Innen-Namens gegen den gezeichneten Balken (über der Diagrammfläche gemischt) und gegen
 *  den Fortschritts-Teil — SVG liest der allgemeine Scan nicht, darum hier eigens */
const ganttMessen = (P) => P.evaluate(() => {
  const rgba = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const t = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [t[0], t[1], t[2], t.length > 3 ? t[3] : 1]; };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const farbe = (s) => (s.startsWith('#') ? [...hex(s), 1] : rgba(s));
  const lum = ([r, g, b]) => { const k = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b); };
  const v = (a, b) => { const A = lum(a); const B = lum(b); return Math.round(((Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05)) * 100) / 100; };
  const misch = (o, u, a) => [0, 1, 2].map((i) => o[i] * a + u[i] * (1 - a));
  const grund = rgba(getComputedStyle(document.querySelector('.gantt-scroll')).backgroundColor);
  return [...document.querySelectorAll('.gantt-bar text.gantt-barlabel.innen')].map((t) => {
    const g = t.closest('g');
    const rects = [...g.querySelectorAll('rect')];
    const balken = rects.find((r) => r.dataset.row);
    const b = farbe(balken.getAttribute('fill'));
    const flaeche = misch(b, grund, Number(balken.getAttribute('opacity') ?? 1));
    const schrift = rgba(getComputedStyle(t).fill);
    const fortschritt = rects.find((r) => !r.dataset.row && /rgba/.test(r.getAttribute('fill') || ''));
    const teile = [flaeche];
    if (fortschritt) { const f = farbe(fortschritt.getAttribute('fill')); teile.push(misch(f, flaeche, f[3])); }
    return { text: t.textContent, farbe: balken.getAttribute('fill'), v: Math.min(...teile.map((x) => v(schrift, x))), fortschritt: !!fortschritt };
  });
});
for (const dunkel of [false, true]) {
  const name = dunkel ? 'dunkel' : 'hell';
  const { ctx, P } = await seite([
    { id: 'g1', type: 'gantt', width: 760, height: 470, position: { x: 40, y: 40 }, data: { title: 'Zeitplan', dayWidth: 24, rows: ganttZeilen } },
    { id: 'c1', type: 'calendar', width: 620, height: 380, position: { x: 820, y: 40 }, data: { view: 'week', myEvents: kalenderTermine } },
    { id: 'wk', type: 'week', width: 760, height: 470, position: { x: 40, y: 540 }, data: { title: 'Wochenplan', days: 5, from: 480, to: 1080, entries: wocheBloecke } },
    { id: 't1', type: 'time', width: 460, height: 360, position: { x: 820, y: 440 }, data: { title: 'Zeiterfassung', segs: [{ id: 's1', date: iso(0), start: 480, end: 600, kind: 'arbeit' }, { id: 's2', date: iso(0), start: 600, kind: 'pause' }] } },
    { id: 'k1', type: 'kanban', width: 420, height: 260, position: { x: 1300, y: 440 }, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot #dringend #büro #rechnung', col: 0 }, { id: 'b', text: 'Maße #gelb #grün', col: 1 }] } },
  ], { dunkel, hoehe: 1100 });
  await P.waitForSelector('.gantt-bar text.gantt-barlabel.innen', { timeout: 15_000 });
  const g = await ganttMessen(P);
  const gs = g.filter((x) => x.v < 4.5);
  pruefe(`C ${name} Gantt: ${g.length} Balken-Namen (${g.filter((x) => x.fortschritt).length} mit Fortschritt) ≥ 4,5:1 (min ${Math.min(...g.map((x) => x.v))})`,
    g.length >= PALETTE.length - 1 && !gs.length, gs.map((x) => `${x.farbe} ${x.v}`).join(', '));
  await foto(P, `${name}-gantt-freie-farben`, '.react-flow__node[data-id="g1"]');
  for (const [id, was, mindest] of [['c1', 'Kalender-Streifen (Woche)', 6], ['wk', 'Wochenplan-Blöcke', 15], ['t1', 'Zeiterfassung (Pause läuft)', 3], ['k1', 'Kanban-Etiketten', 5]]) {
    const alle = await kontrastScan(P, `.react-flow__node[data-id="${id}"]`, { alle: true });
    const schlecht = alle.filter((t) => t.v < 4.5);
    pruefe(`C ${name} ${was}: ${alle.length} Stellen ≥ 4,5:1`, alle.length >= mindest && !schlecht.length, alle.length < mindest ? `(nur ${alle.length})` : meldung(schlecht));
  }
  // Pause läuft: der Knopf trägt die Pausenfläche
  const pause = await P.evaluate(() => { const b = [...document.querySelectorAll('.react-flow__node[data-id="t1"] button')].find((x) => /Pause/.test(x.textContent) && getComputedStyle(x).backgroundColor !== 'rgba(0, 0, 0, 0)'); return b ? getComputedStyle(b).backgroundColor : null; });
  pruefe(`C ${name} Zeiterfassung: laufende Pause gefüllt (${pause})`, !!pause && pause !== 'rgb(156, 111, 28)');
  // Tagesdialog: farbige Termin-Titel
  const zelle = P.locator('.react-flow__node[data-id="c1"] .cal-cell').nth(3);
  await zelle.click({ position: { x: 6, y: 60 } }); await P.waitForSelector('.cal-dayedit', { timeout: 6000 });
  const tag = await kontrastScan(P, '.cal-dayedit', { alle: true });
  const titel = tag.filter((t) => /cal-dayedit-title/.test(t.klasse));
  pruefe(`C ${name} Tagesdialog: ${titel.length} farbige Titel, alles ≥ 4,5:1`, titel.length >= 1 && !tag.some((t) => t.v < 4.5), meldung(tag.filter((t) => t.v < 4.5)));
  await ctx.close();
}

console.log('════ D: Nicht-Text-Kontrast der wichtigsten Dialoge ════');
for (const dunkel of [false, true]) {
  const name = dunkel ? 'dunkel' : 'hell';
  const { ctx, P } = await seite([
    { id: 'c1', type: 'calendar', width: 620, height: 380, position: { x: 820, y: 40 }, data: { view: 'week', myEvents: kalenderTermine.slice(0, 3) } },
    { id: 'wk', type: 'week', width: 620, height: 420, position: { x: 100, y: 40 }, data: { title: 'Wochenplan', days: 5, from: 480, to: 1080, entries: wocheBloecke.slice(0, 3) } },
  ], { dunkel });
  const zu = async () => { await P.keyboard.press('Escape'); await P.waitForTimeout(300); await P.keyboard.press('Escape'); await P.waitForTimeout(300); };
  const dialog = async (titel, auf, sel, { fokus = true } = {}) => {
    try { await auf(); await P.waitForTimeout(800); } catch (e) { pruefe(`D ${name} ${titel}: öffnet`, false, e.message.split('\n')[0]); return; }
    if (!(await P.locator(sel).count())) { pruefe(`D ${name} ${titel}: öffnet`, false, `(${sel} fehlt)`); return; }
    const alle = await randScan(P, sel, { alle: true });
    const r = alle.filter((t) => t.v < 3);
    pruefe(`D ${name} ${titel}: ${alle.length} Bedienelemente, Ränder ≥ 3:1`, !r.length, meldung(r));
    if (fokus) {
      const f = await fokusScan(P, sel, { schritte: 18, alle: true });
      const fs = f.filter((t) => t.v < 3);
      pruefe(`D ${name} ${titel}: ${f.length} Fokusringe ≥ 3:1`, f.length > 0 && !fs.length, fs.slice(0, 4).map((t) => `${t.v} ${t.quelle} „${t.text}" ${t.pfad}`).join(' | '));
    }
    await zu();
  };
  await dialog('Einstellungen (Darstellung)', () => P.locator('[data-taste="einstellungen"]').first().click(), '.modal');
  for (const reiter of ['Daten', 'Dienste']) {
    await dialog(`Einstellungen (${reiter})`, async () => { await P.locator('[data-taste="einstellungen"]').first().click(); await P.waitForTimeout(500); await P.locator('.modal-tabs button', { hasText: reiter }).first().click(); }, '.modal .modal-body', { fokus: false });
  }
  await dialog('Suche', async () => { await P.mouse.click(1300, 960); await P.keyboard.press('Control+k'); await P.waitForTimeout(300); await P.keyboard.type('Woche'); }, '.search-box');
  await dialog('Aufgaben-Zentrale', () => P.locator('[data-taste="aufgaben"]').first().click(), '.taskhub');
  await dialog('Hilfe', () => P.locator('[data-taste="hilfe"]').first().click(), '.help-modal');
  await dialog('Modul-Palette', () => P.locator('.dock button').first().click(), '.modul-palette');
  await dialog('Kalender: Tagesdialog', async () => { await P.locator('.react-flow__node[data-id="c1"] .cal-cell').nth(2).click({ position: { x: 6, y: 60 } }); }, '.cal-dayedit', { fokus: false });
  await dialog('Wochenplan: Block bearbeiten', async () => { await P.locator('.react-flow__node[data-id="wk"] .week-entry').first().click(); }, '.week-pop', { fokus: false });
  await ctx.close();
}

console.log('════ E: Seitenfehler ════');
pruefe('E: keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));

await browser.close(); app.close();
console.log(`\nM494: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
