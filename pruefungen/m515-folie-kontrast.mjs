/**
 * M515 — Präsentation im Dunkelmodus: keine helle Schrift auf hellem Grund.
 *
 * Gemeldet: „im präsentationsmodus sind in manchen modulen (schritt/start/ende etc) schriftfarben im darkmode
 * invertiert, aber deren hintergrund hell → hell auf hell nicht lesbar!"
 *
 * Gemessen wird mit werkzeug/kontrast-pruefen.mjs (kontrastScan, M492): jede sichtbare Schrift der Folie zu ihrem
 * tatsächlich gezeichneten Grund, Grenze 4,5:1. Text in SVG (Mermaid, Pixi, Flüssige Schrift) misst der Scan nicht.
 *
 *   A  Folie je Kartentyp und je Formvariante (Schritt, Entscheidung, Start/Ende, Notizfeld in allen Palettenfarben,
 *      schlichter Text und formatierter Text, dazu eigene dunkle und mittlere Füllung), Notiz in allen Papierfarben,
 *      Kanban, Gantt, Kalender, Wochenplan, Zeiterfassung, Protokoll, Rechen-Tabelle, Ideabubbles, Kontakt, E-Mail,
 *      Mermaid, Pixi, Flüssige Schrift, Datei, Bild mit Unterschrift, Portal, Rahmen-Abschnittsfolie —
 *      in Dunkel und Hell, Klassisch und pix·el, im Fenster; Dunkel zusätzlich in „Nur Inhalt" (Vollbild).
 *      Kein Treffer unter 4,5:1 (Ausnahmen unten, begründet).
 *   B  Board im Dunkeln: dieselben Formen auf dem Board ≥ 4,5:1.
 *   C  Hell bleibt, wie es war: die Schriftfarbe der Formen-Folie im Hellen ist unverändert (#16191e auf Pastell).
 *   D  Keine Seitenfehler.
 *
 * Bilder: M515_BILDER=<ordner> legt Bildschirmfotos der Formen-Folien ab (dunkel und hell).
 * Nur Bericht (ohne Prüfung, alle Treffer je Folie): M515_BERICHT=1.
 */
// Läuft aus dem Repository: `node pruefungen/m515-folie-kontrast.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M515_BILDER ?? '';
const BERICHT = !!process.env.M515_BERICHT;
// Nur zum Nachsehen: M515_NUR=<Muster> misst nur Folien, deren Kennung passt; M515_LAEUFE=<Muster> nur passende Läufe
const NUR = process.env.M515_NUR ? new RegExp(process.env.M515_NUR) : null;
const NUR_LAEUFE = process.env.M515_LAEUFE ? new RegExp(process.env.M515_LAEUFE) : null;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5515;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

// ---------- Karten: alle in einer Reihe, die Folien kommen in Lesefolge (links nach rechts) ----------
const heute = new Date();
const iso = (n) => { const d = new Date(heute.getTime() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const absatz = (text, styles = {}) => ({ type: 'paragraph', content: [{ type: 'text', text, styles }] });
const bloecke = (titel) => [absatz(titel, { bold: true }), absatz('Weiter mit dem nächsten Schritt'),
  { type: 'bulletListItem', content: [{ type: 'text', text: 'Punkt eins', styles: {} }] }];
const PALETTE = ['#eef2ff', '#e6f7ec', '#fff4e0', '#ffe9ef', '#eef7ff', '#f3eeff', '#ffffff'];   // ShapeCard SHAPE_COLORS
const FORMEN = { process: 'Schritt', decision: 'Entscheidung', terminator: 'Start/Ende', note: 'Notizfeld' };

const K = [];
let x = 0;
/** `kennung`: Text, an dem die Reihe erkennt, dass die richtige Folie offen ist (null = nicht prüfbar, z. B. Grafik) */
const neu = (id, titel, node, kennung = null, folie = true) => { K.push({ id, titel, kennung, folie, node: { id, position: { x, y: 0 }, ...node } }); x += 700; };
for (const [form, name] of Object.entries(FORMEN)) {
  for (const farbe of PALETTE) neu(`f-${form}-${farbe.slice(1)}`, `${name} ${farbe} (Text)`, { type: 'shape', width: 180, height: 90, data: { shape: form, text: `${name} ${farbe.slice(1)}`, color: farbe } }, `${name} ${farbe.slice(1)}`);
  neu(`f-${form}-bloecke`, `${name} #fff4e0 (formatiert)`, { type: 'shape', width: 200, height: 120, data: { shape: form, text: '', color: '#fff4e0', blocks: bloecke(`${name} formatiert`) } }, `${name} formatiert`);
  neu(`f-${form}-dunkel`, `${name} #1f2a44 eigene dunkle Füllung (Text)`, { type: 'shape', width: 180, height: 90, data: { shape: form, text: `${name} dunkel`, color: '#1f2a44' } }, `${name} dunkel`);
}
neu('f-process-dunkel-bloecke', 'Schritt #1f2a44 (formatiert)', { type: 'shape', width: 200, height: 120, data: { shape: 'process', text: '', color: '#1f2a44', blocks: bloecke('Schritt dunkel formatiert') } }, 'Schritt dunkel formatiert');
neu('f-process-mittel', 'Schritt #4f7cff mittlere Füllung (Text)', { type: 'shape', width: 180, height: 90, data: { shape: 'process', text: 'Schritt mittel', color: '#4f7cff' } }, 'Schritt mittel');
neu('f-process-orange', 'Schritt #ff8800 (formatiert)', { type: 'shape', width: 200, height: 120, data: { shape: 'process', text: '', color: '#ff8800', blocks: bloecke('Orange') } }, 'Orange');
for (const c of ['yellow', 'pink', 'mint', 'sky', 'white']) neu(`n-${c}`, `Notiz ${c}`, { type: 'note', width: 280, data: { color: c, blocks: bloecke(`Notiz ${c}`) } }, `Notiz ${c}`);
neu('n-hex-dunkel', 'Notiz eigene Farbe #1f2a44', { type: 'note', width: 280, data: { color: 'white', hex: '#1f2a44', blocks: bloecke('Notiz dunkel') } }, 'Notiz dunkel');
neu('n-hex-hell', 'Notiz eigene Farbe #ffd0e0', { type: 'note', width: 280, data: { color: 'white', hex: '#ffd0e0', blocks: bloecke('Notiz rosa') } }, 'Notiz rosa');
neu('kanban', 'Kanban', { type: 'kanban', width: 560, data: { title: 'Aufgaben', items: [
  { id: 'k1', text: 'Angebot schreiben', col: 0, due: iso(2), prio: 1, who: 'Anna' },
  { id: 'k2', text: 'Rechnung prüfen', col: 1, due: iso(-1), prio: 2 },
  { id: 'k3', text: 'Ablage', col: 2, prio: 3, subs: [{ id: 's1', text: 'a', done: true }, { id: 's2', text: 'b' }] },
] } }, 'Angebot schreiben');
neu('gantt', 'Gantt', { type: 'gantt', width: 600, height: 240, data: { title: 'Zeitplan', dayWidth: 24, rows: [
  { id: 'g1', name: 'Phase 1', start: iso(0), end: iso(6), color: '#4f7cff', progress: 30 },
  { id: 'g2', name: 'Phase 2', start: iso(7), end: iso(13), color: '#fff4e0' },
  { id: 'g3', name: 'Meilenstein', start: iso(14), end: iso(14), color: '#e07a3f' },
] } }, 'Phase 2');
neu('kalender', 'Kalender', { type: 'calendar', width: 360, height: 340, data: {} });
neu('woche', 'Wochenplan', { type: 'week', width: 620, height: 440, data: { title: 'Wochenplan', days: 5, from: 480, to: 1020, entries: [
  { id: 'w1', day: 0, start: 540, dur: 120, text: 'Team', color: 0 }, { id: 'w2', day: 1, start: 600, dur: 60, text: 'Kunde', color: 3, who: 'Anna' },
  { id: 'w3', day: 2, start: 660, dur: 90, text: 'Hell', colorHex: '#fff4e0' }, { id: 'w4', day: 3, start: 720, dur: 60, text: 'Dunkel', colorHex: '#1f2a44' },
] } }, 'Kunde');
neu('zeit', 'Zeiterfassung', { type: 'time', width: 460, height: 380, data: { title: 'Zeiterfassung', segs: [
  { id: 't1', date: iso(0), start: 480, end: 720, kind: 'arbeit', note: 'Vormittag' }, { id: 't2', date: iso(0), start: 720, end: 750, kind: 'pause' },
] } }, 'Vormittag');
for (const [id, titel, d] of [
  ['protokoll', 'Protokoll weiß', { color: 'white' }],
  ['protokoll-gelb', 'Protokoll gelb', { color: 'yellow' }],
  ['protokoll-dunkel', 'Protokoll eigene Farbe #1f2a44', { color: 'white', hex: '#1f2a44' }],
]) {
  neu(id, titel, { type: 'minutes', width: 520, height: 460, data: { title: titel, ...d, current: 'e1', entries: [
    { id: 'e1', date: iso(0), attendees: 'Anna, Ben', blocks: bloecke('Tagesordnung'), decisions: [{ id: 'd1', text: 'Budget freigegeben' }] },
  ] } }, titel);
}
neu('tabelle', 'Rechen-Tabelle', { type: 'sheet', width: 460, height: 300, data: { title: 'Kosten', cols: 4, rows: 5, cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1200', A3: 'Strom', B3: '80', A4: 'Summe', B4: '=SUMME(B2:B3)' } } }, 'Kosten');
neu('bubbles', 'Ideabubbles', { type: 'bubbles', width: 560, height: 440, data: { title: 'Ideen', frage: 'Was verbessern wir?',
  ideen: { i1: { text: 'Mehr Pausen', von: 'g:1', t: 1, g: 'gr1' }, i2: { text: 'Kürzere Sitzungen', von: 'g:1', t: 2 }, i3: { text: 'Kaffee', von: 'g:1', t: 3, g: 'gr1' } },
  stimmen: {}, gruppen: { gr1: { name: 'Alltag', farbe: 0, t: 1 } }, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } }, 'Mehr Pausen');
neu('kontakt', 'Kontakt', { type: 'kontakt', width: 300, data: { name: 'Anna Beispiel', funktion: 'Referentin', firma: 'Amt', telefone: [{ art: 'Mobil', nummer: '+49 170 1234567' }], emails: ['anna@example.org'], adresse: 'Hauptstr. 1\n79098 Freiburg', notiz: 'Rückruf' } }, 'Anna Beispiel');
neu('email', 'E-Mail', { type: 'email', width: 340, data: { subject: 'Termin morgen', fromName: 'Ben Muster', fromAddress: 'ben@example.org', date: new Date().toISOString(), text: 'Hallo Anna,\nbis morgen um zehn.\nBen', attachments: [] } }, 'Termin morgen');
neu('mermaid', 'Mermaid', { type: 'mermaid', width: 356, height: 384, data: { code: 'flowchart TD\n  A[Start] --> B{Prüfen}\n  B -->|ja| C[Fertig]\n  B -->|nein| D[Nacharbeit]' } });
neu('pixi', 'Pixi', { type: 'pixi', width: 192, height: 192, autoFit: false, data: { name: 'Pixi' } }, 'Pixi');
neu('fluessig', 'Flüssige Schrift', { type: 'fluessig', width: 440, height: 220, autoFit: false, data: { text: 'Hallo' } });
neu('datei', 'Datei', { type: 'file', width: 260, data: { name: 'bericht.txt', titel: 'Monatsbericht', size: 1234, mime: 'text/plain' } }, 'Monatsbericht');
neu('bild', 'Bild mit Unterschrift', { type: 'image', width: 240, data: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', name: 'foto.png', titel: 'Baustelle im Mai', rahmen: true } });
// Ein Portal ist keine Folie (es führt nur zu einem anderen Board) — es liegt trotzdem auf dem Board (Teil B)
neu('portal', 'Portal', { type: 'portal', width: 260, data: { boardId: 'b2' } }, null, false);
K.push({ id: 'rahmen', titel: 'Rahmen-Abschnittsfolie', kennung: 'Abschnitt Planung', folie: true, node: { id: 'rahmen', type: 'frame', position: { x: x + 400, y: 1600 }, width: 640, height: 420, dragHandle: '.frame-head', data: { name: 'Abschnitt Planung', color: '#fff4e0' } } });
const NODES = K.map((k) => k.node);
const F = K.filter((k) => k.folie);   // die Folien in Lesefolge
// Teil B: Formen und Notizen dicht auf einem Board (passt beim ersten Öffnen ganz ins Bild)
const BOARD_K = K.filter((k) => k.node.type === 'shape' || k.node.type === 'note');
const BOARD_NODES = BOARD_K.map((k, i) => ({ ...k.node, position: { x: (i % 7) * 320, y: Math.floor(i / 7) * 260 } }));

/**
 * Ausnahmen (begründet): keine. Liste bleibt, damit eine spätere Ausnahme hier mit Grund steht:
 *   { folie: 'id', text: /…/, grund: '…' }
 */
const AUSNAHMEN = [];
const ausgenommen = (id, t) => AUSNAHMEN.some((a) => a.folie === id && a.text.test(t.text));

async function seite({ dunkel = false, design = 'klassisch', breite = 1440, hoehe = 900, karten = NODES } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([karten, d, des]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ui: { theme: d ? 'dark' : 'light', accent: 'orange', design: des } }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Vortrag', edges: [], drawings: [], comments: [], nodes: karten }, { id: 'b2', name: 'Ziel-Board', edges: [], drawings: [], comments: [], nodes: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1', 'b2'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [karten, dunkel, design]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1200);
  return { ctx, P };
}
const warteBis = async (P, fn, ms = 15000) => { const ende = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(120); } };
const vortrag = async (P) => {
  await P.keyboard.press('Escape'); await P.mouse.click(5, 450); await P.waitForTimeout(250);
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter', { timeout: 15000 });
};
const zaehler = (P) => P.evaluate(() => document.querySelector('.presenter-count')?.textContent?.trim() ?? '');
/** Zur Folie Nummer `nr` (0-basiert) — über „Weiter" bzw. „Zurück", die Punkte reichen nur bis 24 */
async function zuFolie(P, nr) {
  for (let i = 0; i < 200; i++) {
    const [jetzt] = (await zaehler(P)).split(' /').map((s) => Number(s) - 1);
    if (jetzt === nr) break;
    // Tasten statt Knöpfe: in „Nur Inhalt" sind die Knöpfe ausgeblendet. Fokus vorher aus Feldern nehmen — dort
    // gehören Strg+Pfeile dem Text.
    await P.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur(); });
    await P.keyboard.press(jetzt < nr ? 'Control+ArrowRight' : 'Control+ArrowLeft');
    await warteBis(P, async () => (await zaehler(P)) !== `${jetzt + 1} / ${F.length}`, 4000);
  }
  // Inhalt der Folie fertig gezeichnet (Editoren, Mermaid, Blasen) — kurz ruhen lassen
  await P.waitForTimeout(350);
}
const foto = async (P, name) => { if (BILDER) await P.screenshot({ path: path.join(BILDER, `${name}.png`) }); };

/** Steht die erwartete Karte auf der Folie? (Text oder Wert eines Feldes enthält ihre Kennung) */
const folieIst = (P, kennung) => P.evaluate((k) => {
  const f = document.querySelector('.presenter-slide');
  if (!f) return false;
  const werte = [...f.querySelectorAll('textarea, input')].map((e) => e.value).join(' ');
  return `${f.innerText} ${werte}`.includes(k);
}, kennung);

/** Alle Folien scannen; liefert { id: [treffer] } */
async function alleFolien(P, wo) {
  const funde = {};
  const n = Number((await zaehler(P)).split('/ ')[1]);
  pruefe(`${wo}: ${F.length} Folien (alle Karten außer dem Portal)`, n === F.length, `(${n})`);
  const falsch = [];
  for (let i = 0; i < F.length; i++) {
    const k = F[i];
    if (NUR && !NUR.test(k.id)) continue;
    await zuFolie(P, i);
    if (k.kennung && !(await warteBis(P, () => folieIst(P, k.kennung), 6000))) falsch.push(k.id);
    const t = (await kontrastScan(P, '.presenter', { grenze: 4.5 })).filter((x) => !ausgenommen(k.id, x));
    // Kopf und Fuß des Vortrags werden mitgemessen — sie stehen auf demselben Grund und müssen ebenso lesbar sein
    if (t.length) funde[k.id] = t;
    if (BERICHT && t.length) console.log(`    ${wo} · ${k.titel}: ${t.slice(0, 4).map(trefferZeile).join(' | ')}`);
  }
  pruefe(`${wo}: jede Folie zeigt ihre Karte`, !falsch.length, falsch.join(', '));
  return funde;
}
const zusammen = (funde) => Object.entries(funde).map(([id, t]) => `${id}: ${t.slice(0, 2).map(trefferZeile).join(' | ')}`).join(' ‖ ');

const LAEUFE = [
  { name: 'Klassisch dunkel', dunkel: true, design: 'klassisch', rein: true },
  { name: 'pix·el dunkel', dunkel: true, design: 'pixel', rein: true },
  { name: 'Klassisch hell', dunkel: false, design: 'klassisch' },
  { name: 'pix·el hell', dunkel: false, design: 'pixel' },
];
const hellFarbe = {};
for (const lauf of LAEUFE) {
  if (NUR_LAEUFE && !NUR_LAEUFE.test(lauf.name)) continue;
  console.log(`A  ${lauf.name}`);
  const { ctx, P } = await seite(lauf);
  pruefe(`${lauf.name}: Thema und Design aktiv`, await P.evaluate(([d, des]) => document.documentElement.dataset.theme === (d ? 'dark' : 'light')
    && (document.documentElement.dataset.design ?? 'klassisch') === des, [lauf.dunkel, lauf.design]));
  await vortrag(P);
  const funde = await alleFolien(P, `${lauf.name}, Fenster`);
  pruefe(`${lauf.name}, Fenster: keine Schrift unter 4,5:1 auf ${F.length} Folien`, !Object.keys(funde).length, zusammen(funde));
  // Bild der Formen-Folien (Schritt, Start/Ende)
  for (const id of ['f-process-eef2ff', 'f-terminator-fff4e0', 'f-decision-e6f7ec', 'f-process-bloecke']) {
    await zuFolie(P, F.findIndex((k) => k.id === id));
    await foto(P, `${lauf.dunkel ? 'dunkel' : 'hell'}-${lauf.design}-${id}`);
  }
  if (!lauf.dunkel) {
    // C: Schriftfarbe der Formen im Hellen festhalten (Vergleich mit dem Stand vor M515)
    for (const id of ['f-process-eef2ff', 'f-process-bloecke', 'f-terminator-fff4e0']) {
      await zuFolie(P, F.findIndex((k) => k.id === id));
      hellFarbe[`${lauf.design}-${id}`] = await P.evaluate(() => {
        const el = document.querySelector('.presenter-slide .slide-shape-input, .presenter-slide .slide-shape-text .bn-inline-content');
        return el ? getComputedStyle(el).color : null;
      });
    }
  }
  if (lauf.rein) {
    // „Nur Inhalt": Vollbild ohne Bedienung
    await zuFolie(P, 0);
    await P.locator('.presenter-count').click();
    await P.keyboard.press('f');
    const rein = await warteBis(P, () => P.evaluate(() => !!document.querySelector('.presenter.rein')));
    pruefe(`${lauf.name}: „Nur Inhalt" ist an`, !!rein);
    const f2 = await alleFolien(P, `${lauf.name}, Nur Inhalt`);
    pruefe(`${lauf.name}, Nur Inhalt: keine Schrift unter 4,5:1`, !Object.keys(f2).length, zusammen(f2));
    await zuFolie(P, F.findIndex((k) => k.id === 'f-terminator-fff4e0'));
    await foto(P, `${lauf.dunkel ? 'dunkel' : 'hell'}-${lauf.design}-nur-inhalt-start-ende`);
  }
  await ctx.close();
}

console.log('B  Board: Formen und Notizen');
for (const [design, dunkel] of [['klassisch', true], ['pixel', true], ['klassisch', false]]) {
  const { ctx, P } = await seite({ dunkel, design, breite: 1600, hoehe: 1000, karten: BOARD_NODES });
  await P.waitForTimeout(900);   // einpassen (fitView) abwarten
  const schlecht = {}; let gesehen = 0;
  for (const k of BOARD_K) {
    const t = await kontrastScan(P, `.react-flow__node[data-id="${k.id}"]`, { grenze: 4.5, alle: true });
    if (t.length) gesehen += 1;
    const unter = t.filter((x) => x.v < 4.5);
    if (unter.length) schlecht[k.id] = unter;
  }
  const wo = `${design} ${dunkel ? 'dunkel' : 'hell'}`;
  pruefe(`B Board ${wo}: alle ${BOARD_K.length} Formen und Notizen gemessen`, gesehen === BOARD_K.length, `(${gesehen})`);
  pruefe(`B Board ${wo}: Schrift ≥ 4,5:1`, !Object.keys(schlecht).length, zusammen(schlecht));
  if (BERICHT) for (const [id, t] of Object.entries(schlecht)) console.log(`    Board ${wo} · ${id}: ${t.slice(0, 3).map(trefferZeile).join(' | ')}`);
  if (dunkel && design === 'klassisch') await foto(P, 'board-dunkel-klassisch');
  await ctx.close();
}

console.log('C  Hell unverändert');
// Stand vor M515: Klassisch die Tinte #16191e, pix·el seine eigene (#12280f) — auf hellem Pastell bleibt beides
// Formatierter Text: BlockNote-Grau #3f3f3f in beiden Designs
const vorher = (k) => (/bloecke/.test(k) ? 'rgb(63, 63, 63)' : k.startsWith('pixel') ? 'rgb(18, 40, 15)' : 'rgb(22, 25, 30)');
for (const [k, v] of Object.entries(hellFarbe)) pruefe(`C ${k}: Schrift im Hellen wie vorher (${vorher(k)})`, v === vorher(k), v);

pruefe('D keine Seitenfehler', fehler.length === 0, fehler);
await browser.close(); app.close();
console.log(`\n${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
