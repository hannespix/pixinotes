/**
 * M340 — Alle Export- und Teilen-Wege, wirklich durchgespielt.
 *
 *   A  Kopieren (formatiert + Text): Unterpunkte, Fett/Kursiv/Farbe, Links, Zitat, Nummern, Tabelle,
 *      Kanban mit Frist und Person.
 *   B  Übernahme-Link → beim Empfänger: Karten, Linien UND die Zeichnungen an den Karten.
 *   C  PDF-Datei: mehrere Seiten, Schnitt in einer Leerzeile statt mitten durch den Text.
 *   D  Bild-Export: Striche sind im Bild; „nur Auswahl" zeigt nur die Auswahl; keine Bedienelemente.
 *   E  Druck (PDF über den Druckdialog): das Fenster öffnet sich (kein blockiertes Pop-up).
 *   F  Markdown: echte Markdown-Zeichen, eine Datei.
 *   G  Drucken der Karten: Druckansicht mit Formatierung. · H Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m340-export.mjs`
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
const PORT = 4558;
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

const t = (text, styles = {}) => ({ type: 'text', text, styles });
const reich = [
  { id: 'a1', type: 'heading', props: { level: 2 }, content: [t('Besprechung Relaunch')] },
  { id: 'a2', type: 'paragraph', content: [t('Normal '), t('fett', { bold: true }), t(' und '), t('kursiv', { italic: true }), t(' und '), t('rot', { textColor: 'red' }), t(' — siehe '), { type: 'link', href: 'https://example.com/plan', content: [t('Plan')] }] },
  { id: 'a3', type: 'bulletListItem', content: [t('Punkt eins')], children: [{ id: 'a3a', type: 'bulletListItem', content: [t('Unterpunkt tief')], children: [{ id: 'a3b', type: 'checkListItem', props: { checked: true }, content: [t('ganz unten erledigt')] }] }] },
  { id: 'a4', type: 'numberedListItem', content: [t('Erstens')] },
  { id: 'a5', type: 'numberedListItem', content: [t('Zweitens')] },
  { id: 'a6', type: 'quote', content: [t('Ein Zitat')] },
  { id: 'a7', type: 'checkListItem', content: [t('Offene Aufgabe')] },
  { id: 'a8', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[t('Kopf A')], [t('Kopf B')]] }, { cells: [[t('Zelle 1')], [t('Zelle 2', { bold: true })]] }] } },
];
const lang = Array.from({ length: 90 }, (_, i) => ({ id: `l${i}`, type: 'paragraph', content: `Zeile ${i + 1}: Der schnelle braune Fuchs springt über den faulen Hund und zurück.` }));
const stand = () => ({
  boards: [{ id: 'b1', name: 'Export <Test>', comments: [],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n2', target: 'n3' }],
    drawings: [
      { id: 's1', tool: 'marker', color: '#ff2d95', width: 16, anchor: 'n1', amText: false, points: [[20, -30], [80, -30], [140, -30], [200, -30], [260, -30], [300, -30], [330, -30], [350, -30]] },
      { id: 's2', tool: 'marker', color: '#00e5ff', width: 16, points: [[40, 760], [120, 760], [200, 760], [280, 760], [360, 760], [440, 760], [520, 760], [600, 760]] },
    ],
    nodes: [
      { id: 'n1', type: 'note', width: 340, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: reich } },
      { id: 'n2', type: 'kanban', width: 320, height: 240, position: { x: 420, y: 0 }, data: { title: 'Aufgaben', columns: ['Offen', 'Fertig'], items: [{ id: 'k1', text: 'Angebot schreiben', col: 0, due: '2026-12-01', who: 'Mia', note: 'mit Anlage' }, { id: 'k2', text: 'Raum buchen', col: 1 }] } },
      { id: 'n3', type: 'note', width: 300, position: { x: 820, y: 0 }, data: { color: 'sky', blocks: [{ id: 'c1', type: 'paragraph', content: 'Nachbar' }] } },
      { id: 'n4', type: 'note', width: 420, position: { x: 0, y: 900 }, data: { color: 'white', blocks: lang } },
    ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(st, { ohneOrdner = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(({ st, ohneOrdner }) => {
    if (ohneOrdner) delete window.showDirectoryPicker;
    if (!st || localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, ohneOrdner });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  return { ctx, P };
}
const auf = async (P, url = `http://localhost:${PORT}/`) => { await P.goto(url, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800); };
const board = (P, i = 0) => P.evaluate((i) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[i], i);
const waehle = async (P, ids) => {
  await P.mouse.click(1380, 860); await P.waitForTimeout(150);
  for (const [i, id] of ids.entries()) { await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true, modifiers: i ? ['Shift'] : [] }); await P.waitForTimeout(250); }
};
const zwischenablage = (P) => P.evaluate(async () => {
  const items = await navigator.clipboard.read(); const out = {};
  for (const it of items) for (const typ of it.types) out[typ] = await (await it.getType(typ)).text();
  return out;
});
/** Farbe eines Bildpunkts einer heruntergeladenen PNG (im Browser dekodiert) */
const bildpunkte = (P, datei, punkte) => P.evaluate(async ({ b64, punkte }) => {
  const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, farben: punkte.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data)) };
}, { b64: readFileSync(datei).toString('base64'), punkte });

// ══ A: Kopieren ════════════════════════════════════════════════════════
console.log('\n════ A: Formatiert kopieren ════');
{
  const { ctx, P } = await seite(stand()); await auf(P);
  await waehle(P, ['n1', 'n2']);
  await P.locator('.sel-toolbar [aria-label="Teilen"]').click(); await P.waitForTimeout(400);
  await P.locator('.share-cards-modal button', { hasText: 'Kopieren' }).click(); await P.waitForTimeout(600);
  const z = await zwischenablage(P);
  const h = z['text/html'] ?? ''; const x = z['text/plain'] ?? '';
  pruefe('A1 Unterpunkte sind dabei — auch der tief verschachtelte Haken', h.includes('Unterpunkt tief') && h.includes('☑ ganz unten erledigt'), h.slice(0, 300));
  pruefe('A2 Fett, Kursiv und Farbe bleiben', /<b>fett<\/b>/.test(h) && /<i>kursiv<\/i>/.test(h) && /color:#e03e3e[^>]*>rot/.test(h));
  pruefe('A3 der Link bleibt ein Link', /<a href="https:\/\/example\.com\/plan"[^>]*>Plan<\/a>/.test(h));
  pruefe('A4 Zitat, nummerierte Liste und Tabelle (mit Fett in der Zelle)', /<blockquote[^>]*>Ein Zitat/.test(h) && /<ol[^>]*>\s*<li>Erstens/.test(h) && /<td[^>]*><b>Zelle 2<\/b><\/td>/.test(h));
  pruefe('A5 Kanban mit Frist, Person und Beschreibung', /Angebot schreiben.*bis 2026-12-01.*@Mia.*mit Anlage/s.test(h));
  pruefe('A6 im Klartext: Nummern gezählt, Link mit Adresse', /1\. Erstens\n2\. Zweitens/.test(x) && x.includes('Plan (https://example.com/plan)'), x.slice(0, 400));
  await ctx.close();
}

// ══ B: Übernahme-Link ══════════════════════════════════════════════════
console.log('\n════ B: Übernahme-Link → Empfänger ════');
{
  const { ctx, P } = await seite(stand()); await auf(P);
  await waehle(P, ['n1', 'n2']);
  await P.locator('.sel-toolbar [aria-label="Teilen"]').click(); await P.waitForTimeout(400);
  await P.locator('.share-cards-modal button', { hasText: 'Übernahme-Link' }).click(); await P.waitForTimeout(900);
  const link = (await zwischenablage(P))['text/plain'] ?? '';
  pruefe('B1 der Link liegt in der Zwischenablage', link.includes('#b='), link.slice(0, 80));
  await ctx.close();
  const e = await seite(null);
  e.P.on('dialog', (d) => d.accept());
  await auf(e.P, link); await e.P.waitForTimeout(1500);
  const alle = await e.P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards);
  const neu = alle.find((b) => /geteilt/.test(b.name));
  const ids = new Set((neu?.nodes ?? []).map((n) => n.id));
  pruefe('B2 beim Empfänger: beide Karten und die Linie dazwischen', !!neu && neu.nodes.length === 2 && neu.edges.length === 1 && ids.has(neu.edges[0].source) && ids.has(neu.edges[0].target), JSON.stringify({ n: neu?.nodes.length, e: neu?.edges.length }));
  pruefe('B3 die Zeichnung hängt an der NEUEN Karte (vorher zeigte sie ins Leere)', (neu?.drawings ?? []).length === 1 && ids.has(neu.drawings[0].anchor) && !ids.has('n1'), JSON.stringify((neu?.drawings ?? []).map((s) => s.anchor)));
  pruefe('B4 … und ist auf dem Board zu sehen', await e.P.evaluate(() => document.querySelectorAll('.drawing-layer path, .notiz-striche path').length) === 1);
  await e.ctx.close();
}

// ══ C: PDF ═════════════════════════════════════════════════════════════
console.log('\n════ C: PDF-Datei ════');
{
  const { ctx, P } = await seite(stand()); await auf(P);
  await waehle(P, ['n4']);
  await P.locator('.sel-toolbar [aria-label="Teilen"]').click(); await P.waitForTimeout(400);
  const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 60000 }), P.locator('.share-cards-modal button', { hasText: 'PDF-Datei' }).click()]);
  const ziel = path.join(SD, 'm340-karten.pdf'); await dl.saveAs(ziel);
  const pdf = readFileSync(ziel).toString('latin1');
  const hoehen = [...pdf.matchAll(/\/Subtype \/Image \/Width (\d+) \/Height (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const voll = Math.floor(hoehen[0][0] * ((841.89 - 72) / (595.28 - 72)));
  pruefe('C1 ein gültiges PDF mit mehreren Seiten', pdf.startsWith('%PDF-1.4') && hoehen.length >= 2 && pdf.trimEnd().endsWith('%%EOF'), JSON.stringify(hoehen));
  pruefe('C2 der Seitenschnitt liegt in einer Leerzeile (nicht stur auf der Seitenhöhe)', hoehen[0][1] < voll && hoehen[0][1] > voll * 0.8, `${hoehen[0][1]} von ${voll}`);
  await ctx.close();
}

// ══ D/E: Bild-Export ═══════════════════════════════════════════════════
console.log('\n════ D: Bild-Export ════');
{
  const { ctx, P } = await seite(stand()); await auf(P);
  const exportieren = async ({ format = 'png', auswahl = false } = {}) => {
    await P.locator('.dock [aria-label="Mehr"]').click(); await P.waitForTimeout(300);
    await P.locator('[aria-label="Als Bild exportieren"]').first().click(); await P.waitForTimeout(400);
    const d = P.locator('.bild-export');
    await d.locator('select').nth(0).selectOption(format);
    if (format !== 'svg') await d.locator('select').nth(1).selectOption('1');
    await d.locator('select').nth(2).selectOption('white');
    const kopf = d.locator('input[type="checkbox"]').nth(0); if (await kopf.isChecked()) await kopf.uncheck();
    const nur = d.locator('input[type="checkbox"]').nth(1); if (auswahl !== await nur.isChecked()) await nur.setChecked(auswahl);
    return d;
  };
  // ganzes Board
  let d = await exportieren();
  let [dl] = await Promise.all([P.waitForEvent('download', { timeout: 90000 }), d.locator('button', { hasText: 'Exportieren' }).click()]);
  let ziel = path.join(SD, 'm340-board.png'); await dl.saveAs(ziel);
  // Zuschnitt: Karten-Box + 60 Rand; Karten beginnen bei (0,0) → Bildpunkt = Board + 60 (Maßstab 1, sofern unter 4000)
  const b = await board(P);
  const n4 = b.nodes.find((n) => n.id === 'n4');
  let px = await bildpunkte(P, ziel, [[60 + 200, 60 - 30], [60 + 300, 60 + 760], [60 + 900, 60 + 20], [8, 8]]);
  const ist = (f, r, g, bl, tol = 60) => Math.abs(f[0] - r) < tol && Math.abs(f[1] - g) < tol && Math.abs(f[2] - bl) < tol;
  console.log('    Bild', px.w, 'x', px.h, JSON.stringify(px.farben));
  pruefe('D1 der Strich an der Karte ist im Bild (pink über der Notiz)', px.farben[0][0] > 200 && px.farben[0][1] < 200 && px.farben[0][2] > 100, JSON.stringify(px.farben[0]));
  pruefe('D2 der freie Strich auf der Fläche ist im Bild (türkis)', px.farben[1][0] < 180 && px.farben[1][1] > 180 && px.farben[1][2] > 200, JSON.stringify(px.farben[1]));
  pruefe('D3 die Nachbar-Karte ist im Bild, der Rand ist weiß', !ist(px.farben[2], 255, 255, 255, 12) && ist(px.farben[3], 255, 255, 255, 6), JSON.stringify([px.farben[2], px.farben[3]]));
  // nur Auswahl: n1 + n2
  await waehle(P, ['n1', 'n2']);
  d = await exportieren({ auswahl: true });
  [dl] = await Promise.all([P.waitForEvent('download', { timeout: 90000 }), d.locator('button', { hasText: 'Exportieren' }).click()]);
  ziel = path.join(SD, 'm340-auswahl.png'); await dl.saveAs(ziel);
  px = await bildpunkte(P, ziel, [[60 + 200, 60 - 30], [60 + 100, 60 + 30], [4, 4], [60 + 340 + 3, 60 + 50], [60 - 2, 60 + 60], [60 + 300, 49], [60 + 700, 49], [60 + 700, 48]]);
  console.log('    Auswahl', px.w, 'x', px.h, JSON.stringify(px.farben));
  pruefe('D4 Auswahl-Bild ist auf die zwei Karten zugeschnitten (ohne Nachbar und lange Notiz)', px.w === 740 + 120 && px.h < 900, `${px.w}x${px.h}`);
  pruefe('D5 der Strich an der gewählten Karte ist dabei', px.farben[0][0] > 200 && px.farben[0][1] < 200);
  pruefe('D6 kein Auswahlrahmen, keine Griffe im Bild (direkt neben der Karte ist es weiß)', ist(px.farben[3], 255, 255, 255, 14) && ist(px.farben[4], 255, 255, 255, 14), JSON.stringify([px.farben[3], px.farben[4]]));
  pruefe('D6b die Linie zwischen den gewählten Karten ist da, die zur nicht gewählten Karte nicht', !ist(px.farben[5], 255, 255, 255, 30) && ist(px.farben[6], 255, 255, 255, 8) && ist(px.farben[7], 255, 255, 255, 8), JSON.stringify(px.farben.slice(5)));
  void n4;
  // SVG
  d = await exportieren({ format: 'svg' });
  [dl] = await Promise.all([P.waitForEvent('download', { timeout: 90000 }), d.locator('button', { hasText: 'Exportieren' }).click()]);
  ziel = path.join(SD, 'm340-board.svg'); await dl.saveAs(ziel);
  const svg = readFileSync(ziel, 'utf8');
  pruefe('D7 SVG-Datei mit Inhalt (als Blob geladen, nicht als data:-Adresse)', svg.startsWith('<svg') && svg.includes('Besprechung Relaunch') && dl.url().startsWith('blob:'), `${svg.slice(0, 40)} · ${dl.url().slice(0, 12)}`);
  // E: Druck
  console.log('\n════ E: Druck (PDF über den Druckdialog) ════');
  await P.evaluate(() => { window.print = () => {}; });
  d = await exportieren({ format: 'print' });
  const [pop] = await Promise.all([P.waitForEvent('popup', { timeout: 20000 }), d.locator('button', { hasText: 'Exportieren' }).click()]);
  await pop.waitForFunction(() => !!document.querySelector('img'), null, { timeout: 60000 }).catch(() => {});
  pruefe('E1 das Druckfenster öffnet sich und zeigt das Bild', await pop.evaluate(() => { const i = document.querySelector('img'); return !!i && i.src.startsWith('data:image/png'); }));
  await pop.close();
  // G: Karten drucken
  console.log('\n════ G: Karten drucken ════');
  await waehle(P, ['n1']);
  await P.locator('.sel-toolbar [aria-label="Teilen"]').click(); await P.waitForTimeout(400);
  const [druck] = await Promise.all([P.waitForEvent('popup', { timeout: 20000 }), P.locator('.share-cards-modal button', { hasText: 'Drucken' }).click()]);
  await druck.waitForTimeout(500);
  const dh = await druck.evaluate(() => ({ titel: document.title, html: document.body.innerHTML }));
  pruefe('G1 Druckansicht mit Formatierung und Unterpunkten; der Titel verträgt „<Test>"', dh.titel.includes('<Test>') && dh.html.includes('<b>fett</b>') && dh.html.includes('Unterpunkt tief'), dh.titel);
  await druck.close();
  await ctx.close();
}

// ══ F: Markdown ════════════════════════════════════════════════════════
console.log('\n════ F: Markdown ════');
{
  const { ctx, P } = await seite(stand(), { ohneOrdner: true }); await auf(P);
  await P.locator('[data-taste="einstellungen"]').click(); await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  const knopf = P.locator('.modal-body button', { hasText: 'Als Markdown exportieren' }).first();
  const dls = [];
  P.on('download', (x) => dls.push(x));
  await knopf.click(); await P.waitForTimeout(1500);
  pruefe('F1 EINE Datei (vorher je Board ein Download — der Browser ließ nur den ersten durch)', dls.length === 1 && dls[0].suggestedFilename() === 'pixinotes-export.md', String(dls.map((x) => x.suggestedFilename())));
  const ziel = path.join(SD, 'm340-export.md'); if (dls[0]) await dls[0].saveAs(ziel);
  const md = dls[0] ? readFileSync(ziel, 'utf8') : '';
  pruefe('F2 echtes Markdown: Überschriften, Fett, Link', md.includes('# Export <Test>') && md.includes('## Besprechung Relaunch') && md.includes('**fett**') && md.includes('[Plan](https://example.com/plan)'), md.slice(0, 300));
  pruefe('F3 Listen mit Einrückung, Kästchen, Nummern, Zitat', /- Punkt eins\n {2}- Unterpunkt tief\n {4}- \[x\] ganz unten erledigt\n\n1\. Erstens\n2\. Zweitens/.test(md) && md.includes('> Ein Zitat') && md.includes('- [ ] Offene Aufgabe'), md.slice(0, 600));
  pruefe('F4 Tabelle und Kanban', /\| Kopf A \| Kopf B \|\n\| --- \| --- \|\n\| Zelle 1 \| \*\*Zelle 2\*\* \|/.test(md) && /### Aufgaben[\s\S]*- \[ \] Angebot schreiben \(bis 2026-12-01\) @Mia — mit Anlage/.test(md), md.slice(md.indexOf('### Aufgaben'), md.indexOf('### Aufgaben') + 200));
  await ctx.close();
}

// ══ I: Kalender als .ics ════════════════════════════════════════════════
console.log('\n════ I: Kalender-Export (.ics) ════');
{
  const st = stand();
  st.boards[0].nodes.push({ id: 'n5', type: 'calendar', width: 520, height: 420, position: { x: 1200, y: 0 }, data: {} });
  const { ctx, P } = await seite(st); await auf(P);
  const karte = P.locator('.react-flow__node[data-id="n5"]');
  await karte.locator('[aria-label="Mehr"]').first().click(); await P.waitForTimeout(400);
  await karte.locator('button', { hasText: 'Alle Termine / Zeitraum exportieren' }).click(); await P.waitForTimeout(300);
  const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 30000 }), karte.locator('.cal-export-schnell button', { hasText: 'Alle Termine' }).click()]);
  const ziel = path.join(SD, 'm340-kalender.ics'); await dl.saveAs(ziel);
  const ics = readFileSync(ziel, 'utf8');
  pruefe('I1 der Kalender exportiert alle Termine als .ics (mit der Kanban-Frist)', ics.startsWith('BEGIN:VCALENDAR') && /BEGIN:VEVENT[\s\S]*Angebot schreiben[\s\S]*END:VEVENT/.test(ics) && ics.includes('20261201'), ics.slice(0, 300));
  await ctx.close();
}

// ══ H: Texte ═══════════════════════════════════════════════════════════
console.log('\n════ H: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('H1 „Was ist neu" nennt M340', js.includes('(M340)'));

await browser.close();
app.close();
console.log(`\nm340-export: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
