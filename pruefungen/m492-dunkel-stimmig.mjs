/**
 * M492 — Dunkelmodus überall stimmig: Editor-Menüs und Restfarben.
 *
 *   A  Dunkel: Einfügen-Menü („/"), Formatierungs-Leiste, Schrift-Menü (Aa), Farbwahl und Link-Werkzeug einer
 *      Notiz auf gelbem Papier haben eine dunkle Fläche, jede Schrift darin ≥ 4,5:1 und jedes Symbol ≥ 3:1.
 *   B  Dunkel: Seitenmenü einer Protokoll-Sitzung — Griffe auf dem Papier ≥ 3:1, das Griff-Menü dunkel, ≥ 4,5:1.
 *   C  Hell: dieselben Menüs bleiben hell (nichts verschoben).
 *   D  Kontrast-Scan (werkzeug/kontrast-pruefen.mjs) in Dunkel über jeden Kartentyp — ruhend, ausgewählt, im
 *      Fokus — und über die wichtigsten Fenster: keine Schrift unter 4,5:1 außer den begründeten Ausnahmen unten.
 *   E  Keine Seitenfehler.
 *
 * Bilder: mit M492_BILDER=<ordner> legt die Reihe Bildschirmfotos der Menüs ab (für Vorher/Nachher).
 */
// Läuft aus dem Repository: `node pruefungen/m492-dunkel-stimmig.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M492_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5492;
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

/**
 * Begründete Ausnahmen (Text unter 4,5:1, der so bleibt). Jede mit Grund; der Scan nimmt sie aus.
 * M494: Die beiden Ausnahmen (Kalender-Streifen der Wochenansicht, Gantt-Balken: Schrift auf der frei gewählten
 * Zeilenfarbe) sind gestrichen — die Schrift folgt jetzt der Helligkeit der Fläche (lib/lesbareSchrift.ts).
 */
const AUSNAHMEN = [];
const ausnahme = (t) => AUSNAHMEN.some((a) => a.klasse.test(t.pfad) || a.klasse.test(t.klasse));

const absatz = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] });
const KARTEN = [
  { id: 'n1', type: 'note', width: 340, height: 240, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Notiz' }, absatz('Ein ruhiger Auftritt.'), { type: 'checkListItem', content: 'Angebot prüfen' }] } },
  { id: 'n2', type: 'note', width: 300, height: 160, data: { blocks: [absatz('Notiz ohne Farbe'), absatz('Zweite Zeile')] } },
  { id: 'n3', type: 'note', width: 300, height: 160, data: { color: 'white', blocks: [absatz('Weiße Notiz')] } },
  { id: 'n4', type: 'note', width: 300, height: 160, data: { color: 'sky', blocks: [absatz('Blaue Notiz')] } },
  { id: 'k1', type: 'kanban', width: 420, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße', col: 1 }] } },
  { id: 'g1', type: 'gantt', width: 560, height: 260, data: { title: 'Zeitplan', dayWidth: 24, rows: [{ id: 'r1', name: 'Planung', start: iso(0), end: iso(6), color: '#4f7cff' }, { id: 'r2', name: 'Bau', start: iso(5), end: iso(14), color: '#3fa564' }] } },
  { id: 'c1', type: 'calendar', width: 430, height: 340, data: {} },
  { id: 'b1', type: 'bubbles', width: 560, height: 440, data: { title: 'Ideen', frage: 'Was verbessern wir?', ideen: { i1: { text: 'Mehr Licht', von: 'g:x', t: 1 }, i2: { text: 'Sitzecke', von: 'g:x', t: 2 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } },
  { id: 'w1', type: 'week', width: 620, height: 440, data: { title: 'Wochenplan', days: 5, from: 480, to: 1020, entries: [{ id: 'e1', day: 0, start: 540, dur: 90, text: 'Jour fixe', color: 0 }] } },
  { id: 't1', type: 'time', width: 460, height: 380, data: { title: 'Zeiterfassung', segs: [{ id: 's1', date: iso(0), start: 480, end: 600, kind: 'arbeit' }, { id: 's2', date: iso(0), start: 600, end: 630, kind: 'pause' }] } },
  { id: 'm1', type: 'minutes', width: 420, height: 440, data: { title: 'Jour fixe', color: 'yellow', entries: [{ id: 'x1', date: iso(0), attendees: 'Anna, Gerd', blocks: [{ id: 'q1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Stand' }, { id: 'q2', type: 'paragraph', content: 'Alles im Plan.' }, { id: 'q3', type: 'checkListItem', props: { checked: false }, content: 'Gerd: Angebot einholen' }], decisions: [] }], current: 'x1' } },
  { id: 'r1', type: 'sheet', width: 460, height: 300, data: { title: 'Budget', cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1200', A3: 'Strom', B3: '180', A4: 'Summe', B4: '=SUMME(B2:B3)' }, cols: 4, rows: 6 } },
  { id: 'd1', type: 'mermaid', width: 356, height: 384, data: { code: 'flowchart TD\n  A[Start] --> B[Ende]' } },
  { id: 'f1', type: 'shape', width: 150, height: 70, data: { shape: 'process', text: 'Form', color: '#eef2ff' } },
  { id: 'h1', type: 'htmlapp', width: 380, height: 300, data: { name: 'Rechner', size: 0 } },
  { id: 'p1', type: 'portal', width: 220, data: {} },
  { id: 'e1', type: 'email', width: 300, data: { subject: 'Rückruf', fromName: 'Erika Muster', fromAddress: 'erika@example.org', text: 'Bitte zurückrufen.', attachments: [] } },
  { id: 'fi1', type: 'file', width: 240, data: { name: 'bericht.pdf', size: 12000, mime: 'application/pdf' } },
  { id: 'ko1', type: 'kontakt', width: 300, data: { name: 'Anna Müller', funktion: 'Sachbearbeiterin', firma: 'RP Freiburg', telefone: [{ art: 'Dienstlich', nummer: '0761 208-1234' }], emails: ['anna@example.de'] } },
  { id: 'fr1', type: 'frame', width: 400, height: 200, data: { name: 'Rahmen' } },
];
// Ein Eintrag im Eingang (M478), damit sich das Eingangs-Fenster öffnen lässt
const eingangBoard = { id: 'pixinotes-eingang', name: 'Eingang', edges: [], drawings: [], comments: [], nodes: [
  { id: 'ein1', type: 'note', width: 300, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [absatz('Geteilter Link zum Angebot')], eingang: { gruppe: 'g1', herkunft: 'teilen', wann: Date.now() - 3_600_000 } } }] };
const stand = (nodes) => ({ boards: [{ id: 'b0', name: 'Prüfung', edges: [], drawings: [], comments: [], nodes }, eingangBoard], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' });

async function seite(nodes, { dunkel = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([s, d]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ theme: d ? 'dark' : 'light' }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [stand(nodes), dunkel]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const foto = async (P, name) => { if (BILDER) await P.screenshot({ path: path.join(BILDER, `${name}.png`) }); };

/** Fläche (deckend gemischt) und Leuchtdichte eines Elements; dazu der Kontrast seiner Symbole (SVG) zur Fläche */
const flaeche = (P, sel) => P.evaluate((sel) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
  if (!el) return null;
  const rgba = (s) => { const f = /color\(srgb ([^)]+)\)/.exec(s || ''); if (f) { const t = f[1].split(/[ /]+/).filter(Boolean).map(Number); return [t[0] * 255, t[1] * 255, t[2] * 255, t.length > 3 ? t[3] : 1]; }
    const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return [0, 0, 0, 0]; const t = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [t[0], t[1], t[2], t.length > 3 ? t[3] : 1]; };
  const lum = ([r, g, b]) => { const k = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b); };
  const grund = (e0) => { const sch = []; for (let e = e0; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) sch.push(c); if (c[3] >= 1) break; }
    let f = sch.length && sch[sch.length - 1][3] >= 1 ? sch.pop() : [18, 18, 18, 1]; while (sch.length) { const c = sch.pop(); f = [0, 1, 2].map((i) => c[i] * c[3] + f[i] * (1 - c[3])); } return f; };
  const v = (a, b) => { const A = lum(a); const B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const g = grund(el);
  // Symbole: Strichfarbe (currentColor) der SVGs in Knöpfen, die nicht deaktiviert sind
  const symbole = [...el.querySelectorAll('button:not([disabled]) svg, [role="menuitem"] svg')]
    .filter((s) => s.getBoundingClientRect().width > 0)
    .map((s) => { const c = rgba(getComputedStyle(s).color); return Math.round(v(c, grund(s.parentElement)) * 100) / 100; });
  return { L: Math.round(lum(g) * 1000) / 1000, grund: g.map(Math.round), symbolMin: symbole.length ? Math.min(...symbole) : null, symbole: symbole.length };
}, sel);

const textMenue = async (P, sel, name, { dunkel = true } = {}) => {
  const f = await flaeche(P, sel);
  if (!f) { pruefe(`${name}: sichtbar`, false, `(${sel} fehlt)`); return; }
  // Farbmuster „A" der Farbwahl zählen nicht als Text: sie zeigen die Farbe selbst (auf hellem Papier, wie im Text)
  const t = (await kontrastScan(P, sel, { alle: true })).filter((x) => !/bn-color-icon/.test(x.pfad));
  const schlecht = t.filter((x) => x.v < 4.5);
  if (dunkel) {
    pruefe(`${name}: Fläche dunkel (L=${f.L})`, f.L < 0.06, JSON.stringify(f.grund));
    pruefe(`${name}: ${t.length} Texte, alle ≥ 4,5:1`, t.length > 0 && schlecht.length === 0, schlecht.slice(0, 4).map(trefferZeile).join(' | '));
    if (f.symbole) pruefe(`${name}: ${f.symbole} Symbole ≥ 3:1 (min ${f.symbolMin})`, f.symbolMin >= 3);
  } else {
    pruefe(`${name} (hell): Fläche hell (L=${f.L})`, f.L > 0.8, JSON.stringify(f.grund));
  }
};

const notizMenues = async (dunkel) => {
  const name = dunkel ? 'dunkel' : 'hell';
  const { ctx, P } = await seite([{ ...KARTEN[0], position: { x: 380, y: 120 } }, { ...KARTEN.find((k) => k.id === 'm1'), position: { x: 820, y: 80 } }], { dunkel });
  const n = P.locator('.react-flow__node[data-id="n1"]');
  await n.locator('.bn-editor').click(); await P.waitForTimeout(500);
  // Einfügen-Menü
  await P.keyboard.press('Control+End'); await P.keyboard.press('Enter'); await P.keyboard.type('/'); await P.waitForTimeout(700);
  await foto(P, `${name}-einfuegen-menue`);
  await textMenue(P, '.bn-suggestion-menu', `A ${name}: Einfügen-Menü „/"`, { dunkel });
  await P.keyboard.press('Escape'); await P.keyboard.press('Backspace'); await P.keyboard.press('Backspace'); await P.waitForTimeout(200);
  // Formatierungs-Leiste: Text markieren
  await P.keyboard.press('Control+Home'); await P.keyboard.down('Shift'); await P.keyboard.press('End'); await P.keyboard.up('Shift'); await P.waitForTimeout(800);
  await foto(P, `${name}-formatierungs-leiste`);
  await textMenue(P, '.bn-formatting-toolbar', `A ${name}: Formatierungs-Leiste`, { dunkel });
  // Schrift-Menü (Aa)
  const aa = P.locator('.bn-formatting-toolbar .pn-typo-knopf').first();
  if (await aa.count()) {
    await aa.click(); await P.waitForTimeout(500);
    await foto(P, `${name}-schrift-menue`);
    await textMenue(P, '.pn-typo-menu', `A ${name}: Schrift-Menü (Aa)`, { dunkel });
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  } else pruefe(`A ${name}: Schrift-Knopf da`, false);
  // Farbwahl
  if (!(await P.locator('.bn-formatting-toolbar').count())) { await P.keyboard.press('Control+Home'); await P.keyboard.down('Shift'); await P.keyboard.press('End'); await P.keyboard.up('Shift'); await P.waitForTimeout(700); }
  await P.locator('.bn-formatting-toolbar [data-test="colors"]').click(); await P.waitForTimeout(500);
  await foto(P, `${name}-farbwahl`);
  await textMenue(P, '.bn-menu-dropdown:has(.bn-color-icon), .mantine-Menu-dropdown:has(.bn-color-icon)', `A ${name}: Farbwahl`, { dunkel });
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  // Link-Werkzeug
  if (!(await P.locator('.bn-formatting-toolbar').count())) { await P.keyboard.press('Control+Home'); await P.keyboard.down('Shift'); await P.keyboard.press('End'); await P.keyboard.up('Shift'); await P.waitForTimeout(700); }
  await P.locator('.bn-formatting-toolbar [data-test="createLink"]').click(); await P.waitForTimeout(500);
  await P.keyboard.type('beispiel.de'); await P.waitForTimeout(200);
  await foto(P, `${name}-link-werkzeug`);
  await textMenue(P, '.bn-panel-popover .bn-popover-content, .bn-link-toolbar, .mantine-Popover-dropdown:has(input)', `A ${name}: Link-Werkzeug`, { dunkel });
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  // B Protokoll: Seitenmenü mit Griff-Menü
  await P.mouse.click(1380, 860); await P.waitForTimeout(300);
  const m = P.locator('.react-flow__node[data-id="m1"]');
  await m.locator('.card-grip').click({ force: true }); await P.waitForTimeout(400);
  await m.locator('.bn-editor').click(); await P.waitForTimeout(400);
  const zeile = await m.locator('.bn-block-content').nth(1).boundingBox();
  await P.mouse.move(zeile.x + 30, zeile.y + zeile.height / 2); await P.waitForTimeout(600);
  const seiten = await flaeche(P, '.react-flow__node[data-id="m1"] .bn-side-menu');
  if (dunkel) pruefe(`B ${name}: Seitenmenü auf dem Papier – Griffe ≥ 3:1 (min ${seiten?.symbolMin})`, seiten && seiten.symbole > 0 && seiten.symbolMin >= 3, JSON.stringify(seiten));
  else pruefe(`B ${name}: Seitenmenü da`, !!seiten);
  const griff = m.locator('.bn-side-menu [draggable="true"], .bn-side-menu button').last();
  // Der Griff liegt am Kartenrand unter der Größen-Kante von React Flow — Klick direkt auf den Knopf
  await griff.dispatchEvent('click'); await P.waitForTimeout(500);
  await foto(P, `${name}-seitenmenue`);
  await textMenue(P, '.bn-menu-dropdown.bn-drag-handle-menu, .mantine-Menu-dropdown', `B ${name}: Griff-Menü des Seitenmenüs`, { dunkel });
  await P.keyboard.press('Escape');
  await ctx.close();
};

console.log('════ A/B: Editor-Menüs in Dunkel ════');
await notizMenues(true);
console.log('════ C: dieselben Menüs in Hell ════');
await notizMenues(false);

console.log('════ D: Kontrast-Scan Dunkel – jeder Kartentyp ════');
const meldung = (liste) => liste.slice(0, 4).map(trefferZeile).join(' | ');
for (const k of KARTEN) {
  const { ctx, P } = await seite([{ ...k, position: { x: 140, y: 100 } }]);
  const node = P.locator(`.react-flow__node[data-id="${k.id}"]`);
  const ruhe = (await kontrastScan(P)).filter((t) => !ausnahme(t));
  const box = await node.boundingBox();
  await P.mouse.click(box.x + Math.min(150, box.width / 2), box.y + 12); await P.waitForTimeout(600);
  const auswahl = (await kontrastScan(P)).filter((t) => !ausnahme(t));
  await node.evaluate((el) => el.focus()); await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
  const fokus = (await kontrastScan(P)).filter((t) => !ausnahme(t));
  pruefe(`D ${k.type}/${k.id}: ruhend ${ruhe.length}, ausgewählt ${auswahl.length}, Fokus ${fokus.length} Stellen unter 4,5:1`,
    !ruhe.length && !auswahl.length && !fokus.length, meldung([...ruhe, ...auswahl, ...fokus]));
  await ctx.close();
}

console.log('════ D: Kontrast-Scan Dunkel – Fenster ════');
{
  const alle = KARTEN.map((k, i) => ({ ...k, position: { x: (i % 5) * 640, y: Math.floor(i / 5) * 520 } }));
  const { ctx, P } = await seite(alle);
  const fenster = async (name, auf, sel = 'body') => {
    try { await auf(); await P.waitForTimeout(900); } catch (e) { pruefe(`D Fenster ${name}: öffnet`, false, e.message.split('\n')[0]); return; }
    const t = (await kontrastScan(P, sel)).filter((x) => !ausnahme(x));
    pruefe(`D Fenster ${name}: keine Stelle unter 4,5:1`, t.length === 0, meldung(t));
    await foto(P, `dunkel-fenster-${name}`);
    await P.keyboard.press('Escape'); await P.waitForTimeout(350); await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  };
  await fenster('Board', async () => {});
  await fenster('Einstellungen', () => P.locator('[data-taste="einstellungen"]').first().click());
  await fenster('Hilfe', () => P.locator('[data-taste="hilfe"]').first().click());
  await fenster('Suche', async () => { await P.mouse.click(1300, 860); await P.keyboard.press('Control+k'); await P.waitForTimeout(300); await P.keyboard.type('Notiz'); });
  await fenster('Aufgaben-Zentrale', () => P.locator('[data-taste="aufgaben"]').first().click());
  await fenster('Kontextmenü', () => P.mouse.click(1300, 860, { button: 'right' }));
  await fenster('Modul-Palette', () => P.locator('.dock button').first().click());
  await fenster('Eingang', () => P.locator('[data-taste="eingang"]').first().click());
  await fenster('Präsentation', async () => { await P.mouse.click(1300, 860); await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter', { timeout: 6000 }); }, '.presenter');
  await fenster('Übersicht', () => P.getByText('Übersicht', { exact: true }).first().click());
  await ctx.close();
}

console.log('════ E: Seitenfehler ════');
pruefe('E: keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));

await browser.close(); app.close();
console.log(`\nM492: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
