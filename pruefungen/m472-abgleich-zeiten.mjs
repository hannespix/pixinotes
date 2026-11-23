/**
 * M472 — Abgleich: Zeitstempel erzeugen keine Schein-Konflikte.
 *
 * Zeit- und Merkfelder (Kartenzeit, Spaltenzeit der Tickets, Archiv-Uhr, OCR-Zeit; Liste in src/lib/abgleichZeiten.ts)
 * zählen im Drei-Wege-Abgleich nicht als Unterschied – sind zwei Fassungen sonst gleich, gilt je Feld der spätere
 * Wert. Echte Inhaltsänderungen entscheiden wie bisher.
 *
 *   L  Logik (src/lib/syncMerge.ts, gebündelt mit esbuild, zwei simulierte Geräte):
 *      dasselbe Ticket in dieselbe Spalte → kein Konflikt, spätere Spaltenzeit; verschiedene Spalten → Konflikt wie
 *      bisher; nur Kartenzeit verschieden → kein Konflikt; echte Textänderung auf beiden → Konflikt; beide archivieren
 *      bzw. holen dasselbe Ticket zurück, beide erkennen dasselbe Bild → kein Konflikt; beide Geräte rechnen
 *      dasselbe Ergebnis aus (kein Hin und Her).
 *   E  Im Browser über den Sync-Ordner: Gerät A (echte App) und Gerät B (der Test schreibt in den Ordner) ändern
 *      gleichzeitig dasselbe Kanban – vier Fälle wie oben; danach tragen A und der Ordner denselben Stand.
 *   F  Keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m472-abgleich-zeiten.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5472;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
};

// ---------- L: Logik ----------
const datei = path.join(mkdtempSync(path.join(os.tmpdir(), 'm472-')), 'merge.mjs');
execFileSync(path.join(__repo, 'node_modules/.bin/esbuild'), [path.join(__repo, 'src/lib/syncMerge.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${datei}`, '--log-level=error']);
const { dreiWegeMerge } = await import(pathToFileURL(datei).href);

const T = Date.parse('2026-11-20T09:00:00Z');
const MIN = 60_000;
const kanban = (items, { archiv, geaendert = T } = {}) => ({ id: 'k1', type: 'kanban', position: { x: 0, y: 0 }, angelegt: T - 99 * MIN, geaendert,
  data: { title: 'Umbau', cols: ['Offen', 'In Arbeit', 'Erledigt'], items, ...(archiv ? { archiv } : {}) } });
const brd = (nodes) => ({ id: 'b1', name: 'Bau', nodes, edges: [], drawings: [], comments: [] });
const stand = (nodes) => ({ boards: [brd(nodes)], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }] });
const karte = (erg, id = 'k1') => erg.boards[0].nodes.find((n) => n.id === id);
const ticket = (erg, tid, liste = 'items') => karte(erg).data[liste]?.find((it) => it.id === tid);
/** Merge auf beiden Geräten: A (lokal = a, fremd = b) und B (lokal = b, fremd = a) */
const beide = (basis, a, b) => {
  const aufA = dreiWegeMerge(stand(basis), stand(a), stand(b));
  const aufB = dreiWegeMerge(stand(basis), stand(b), stand(a));
  const kan = (x) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
  return { aufA, aufB, gleich: kan(aufA.boards) === kan(aufB.boards) };
};

console.log('L  Logik: zwei Geräte, ein gemeinsamer Vorfahre');
{
  const basis = [kanban([{ id: 't1', text: 'Statik prüfen', col: 0, spalteSeit: T - 50 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }])];
  // L1 dasselbe Ticket in dieselbe Spalte – A um 10:00, B um 10:05
  {
    const a = [kanban([{ id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: T + 60 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }], { geaendert: T + 60 * MIN })];
    const b = [kanban([{ id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: T + 65 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }], { geaendert: T + 65 * MIN })];
    const { aufA, aufB, gleich } = beide(basis, a, b);
    pruefe('L1 dieselbe Spalte: kein Konflikt (auf beiden Geräten)', aufA.bericht.konflikte === 0 && aufB.bericht.konflikte === 0, [aufA.bericht, aufB.bericht]);
    pruefe('L2 … die spätere Spaltenzeit und die spätere Kartenzeit gelten', ticket(aufA, 't1').col === 1 && ticket(aufA, 't1').spalteSeit === T + 65 * MIN && karte(aufA).geaendert === T + 65 * MIN, [ticket(aufA, 't1'), karte(aufA).geaendert]);
    pruefe('L3 … beide Geräte rechnen dasselbe aus', gleich);
    pruefe('L4 … das Gerät mit den späteren Zeiten ändert nichts, das andere übernimmt', !aufB.lokalNeu && aufB.fremdNeu && aufA.lokalNeu && !aufA.fremdNeu, [aufA.lokalNeu, aufA.fremdNeu, aufB.lokalNeu, aufB.fremdNeu]);
  }
  // L5 Spaltenzeit gemischt: A später an t1, B später an t2 (beide haben beide Tickets gleich bewegt) → je Ticket das Spätere
  {
    const a = [kanban([{ id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: T + 70 * MIN }, { id: 't2', text: 'Bauantrag', col: 1, spalteSeit: T + 61 * MIN }], { geaendert: T + 70 * MIN })];
    const b = [kanban([{ id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: T + 62 * MIN }, { id: 't2', text: 'Bauantrag', col: 1, spalteSeit: T + 69 * MIN }], { geaendert: T + 69 * MIN })];
    const { aufA, gleich } = beide(basis, a, b);
    pruefe('L5 je Ticket die spätere Spaltenzeit (nicht nur die der später geänderten Karte)', aufA.bericht.konflikte === 0 && ticket(aufA, 't1').spalteSeit === T + 70 * MIN && ticket(aufA, 't2').spalteSeit === T + 69 * MIN && gleich, [ticket(aufA, 't1'), ticket(aufA, 't2')]);
  }
  // L6 verschiedene Spalten → wie bisher: Konflikt, hiesige Fassung
  {
    const a = [kanban([{ id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: T + 60 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }], { geaendert: T + 60 * MIN })];
    const b = [kanban([{ id: 't1', text: 'Statik prüfen', col: 2, spalteSeit: T + 65 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }], { geaendert: T + 65 * MIN })];
    const { aufA, aufB } = beide(basis, a, b);
    pruefe('L6 verschiedene Spalten: Konflikt, die hiesige Fassung gilt (wie bisher)', aufA.bericht.konflikte === 1 && ticket(aufA, 't1').col === 1 && ticket(aufB, 't1').col === 2, [aufA.bericht, ticket(aufA, 't1'), ticket(aufB, 't1')]);
  }
  // L7 nur die Kartenzeit verschieden (beide haben denselben Text geschrieben)
  {
    const a = [kanban([{ id: 't1', text: 'Statik prüfen', col: 0, spalteSeit: T - 50 * MIN }, { id: 't2', text: 'Bauantrag stellen', col: 0 }], { geaendert: T + 60 * MIN })];
    const b = [kanban([{ id: 't1', text: 'Statik prüfen', col: 0, spalteSeit: T - 50 * MIN }, { id: 't2', text: 'Bauantrag stellen', col: 0 }], { geaendert: T + 63 * MIN })];
    const { aufA, gleich } = beide(basis, a, b);
    pruefe('L7 nur die Kartenzeit verschieden: kein Konflikt, die spätere gilt (M453)', aufA.bericht.konflikte === 0 && karte(aufA).geaendert === T + 63 * MIN && gleich, [aufA.bericht, karte(aufA).geaendert]);
  }
  // L8 echte Textänderung auf beiden → Konflikt
  {
    const a = [kanban([{ id: 't1', text: 'Statik prüfen', col: 0, spalteSeit: T - 50 * MIN }, { id: 't2', text: 'Bauantrag A', col: 0 }], { geaendert: T + 60 * MIN })];
    const b = [kanban([{ id: 't1', text: 'Statik prüfen', col: 0, spalteSeit: T - 50 * MIN }, { id: 't2', text: 'Bauantrag B', col: 0 }], { geaendert: T + 63 * MIN })];
    const { aufA } = beide(basis, a, b);
    pruefe('L8 echte Textänderung auf beiden: Konflikt, die hiesige gilt (wie bisher)', aufA.bericht.konflikte === 1 && ticket(aufA, 't2').text === 'Bauantrag A', [aufA.bericht, ticket(aufA, 't2')]);
  }
  // L9 gleiche Spalte, aber anderer Text am selben Ticket → Konflikt (die Zeit verdeckt keinen echten Unterschied)
  {
    const a = [kanban([{ id: 't1', text: 'Statik prüfen (A)', col: 1, spalteSeit: T + 60 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }], { geaendert: T + 60 * MIN })];
    const b = [kanban([{ id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: T + 65 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }], { geaendert: T + 65 * MIN })];
    const { aufA } = beide(basis, a, b);
    pruefe('L9 gleiche Spalte, aber anderer Text: weiter ein Konflikt', aufA.bericht.konflikte === 1 && ticket(aufA, 't1').text === 'Statik prüfen (A)', aufA.bericht);
  }
  // L10 beide Geräte archivieren dasselbe erledigte Ticket (Automatik, jede mit eigener Uhr)
  {
    const b0 = [kanban([{ id: 't3', text: 'Fassade', col: 2 }])];
    const arch = (zeit) => [kanban([], { geaendert: T - 99 * MIN, archiv: [{ id: 't3', text: 'Fassade', col: 2, erledigtAm: new Date(zeit).toISOString(), archiviertAm: new Date(zeit).toISOString() }] })];
    const { aufA, gleich } = beide(b0, arch(T + 60 * MIN), arch(T + 61 * MIN));
    const t3 = ticket(aufA, 't3', 'archiv');
    pruefe('L10 beide archivieren dasselbe Ticket: kein Konflikt, spätere Archiv-Uhr', aufA.bericht.konflikte === 0 && t3?.archiviertAm === new Date(T + 61 * MIN).toISOString() && t3?.erledigtAm === new Date(T + 61 * MIN).toISOString() && gleich, [aufA.bericht, t3]);
  }
  // L11 beide holen dasselbe Ticket aus dem Archiv zurück
  {
    const b0 = [kanban([], { archiv: [{ id: 't3', text: 'Fassade', col: 2, erledigtAm: '2026-11-01T08:00:00.000Z', archiviertAm: '2026-11-08T08:00:00.000Z' }] })];
    const zurueck = (zeit) => [kanban([{ id: 't3', text: 'Fassade', col: 2, erledigtAm: '2026-11-01T08:00:00.000Z', zurueckAm: new Date(zeit).toISOString() }], { geaendert: zeit, archiv: [] })];
    const { aufA, gleich } = beide(b0, zurueck(T + 66 * MIN), zurueck(T + 60 * MIN));
    pruefe('L11 beide holen dasselbe Ticket zurück: kein Konflikt, spätere Rückhol-Zeit', aufA.bericht.konflikte === 0 && ticket(aufA, 't3')?.zurueckAm === new Date(T + 66 * MIN).toISOString() && gleich, [aufA.bericht, ticket(aufA, 't3')]);
  }
  // L12 beide erkennen den Text im selben Bild (M452)
  {
    const bild = (ocr) => ({ id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { src: 'data:image/png;base64,AA', ...(ocr ? { ocrText: 'Rechnung 42', ocrAm: ocr, ocrFuer: 'fp1' } : {}) } });
    const { aufA, gleich } = beide([bild()], [bild(T + 60 * MIN)], [bild(T + 64 * MIN)]);
    pruefe('L12 beide erkennen dasselbe Bild: kein Konflikt, spätere Erkennungszeit', aufA.bericht.konflikte === 0 && karte(aufA, 'i1').data.ocrAm === T + 64 * MIN && gleich, [aufA.bericht, karte(aufA, 'i1').data]);
  }
  // L13 andere Feldreihenfolge (ein Gerät hat den Stempel erst nachgetragen) ist kein Unterschied
  {
    const a = [kanban([{ id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: T + 60 * MIN }, { id: 't2', text: 'Bauantrag', col: 0 }], { geaendert: T + 60 * MIN })];
    const b = [kanban([{ spalteSeit: T + 65 * MIN, col: 1, text: 'Statik prüfen', id: 't1' }, { col: 0, text: 'Bauantrag', id: 't2' }], { geaendert: T + 65 * MIN })];
    const { aufA } = beide(basis, a, b);
    pruefe('L13 andere Reihenfolge der Felder zählt nicht als Unterschied', aufA.bericht.konflikte === 0 && ticket(aufA, 't1').spalteSeit === T + 65 * MIN, aufA.bericht);
  }
}

// ---------- E: im Browser über den Sync-Ordner ----------
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

/** Sync-Ordner im Node-Prozess; Gerät B schreibt hinein, sobald Gerät A seine Änderung gemacht hat */
const ordner = new Map();
const HAUPT = 'pixinotes-daten.json';
const lies = () => { const e = ordner.get(HAUPT); return e ? JSON.parse(e.text) : null; };
const schreib = (obj) => ordner.set(HAUPT, { text: JSON.stringify(obj), lastModified: Date.now() });
let geraetB = null;   // wird beim nächsten Lesen von A ausgeführt (A hat seine Änderung dann schon gemacht)

const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
await ctx.exposeFunction('__fsLesen', (n) => {
  if (n === HAUPT && geraetB) { const f = geraetB; geraetB = null; f(); }
  return ordner.get(n) ?? null;
});
await ctx.exposeFunction('__fsSchreiben', (n, t) => { ordner.set(n, { text: t, lastModified: Date.now() }); });
await ctx.exposeFunction('__fsListe', () => [...ordner.keys()]);
await ctx.exposeFunction('__fsEntfernen', (n) => { ordner.delete(n); });
const T0 = Date.now();
const startKanban = { id: 'k1', type: 'kanban', position: { x: 40, y: 40 }, width: 720, angelegt: T0 - 9 * MIN, geaendert: T0 - 9 * MIN, data: { title: 'Umbau', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
  { id: 't1', text: 'Statik prüfen', col: 0, spalteSeit: T0 - 9 * MIN },
  { id: 't2', text: 'Bauantrag', col: 0, spalteSeit: T0 - 9 * MIN },
  { id: 't3', text: 'Fassade wählen', col: 0, spalteSeit: T0 - 9 * MIN },
  { id: 't4', text: 'Dach', col: 0, spalteSeit: T0 - 9 * MIN },
] } };
await ctx.addInitScript((st) => {
  const datei = (n) => ({
    kind: 'file', name: n,
    async getFile() {
      const e = await window.__fsLesen(n);
      if (!e) throw new DOMException('weg', 'NotFoundError');
      return new File([e.text], n, { lastModified: e.lastModified, type: 'application/json' });
    },
    async createWritable() {
      let buf = '';
      return { async write(d) { buf += typeof d === 'string' ? d : await new Response(d).text(); }, async close() { await window.__fsSchreiben(n, buf); } };
    },
  });
  const dir = {
    kind: 'directory', name: 'Team/PixiNotes',
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    async getFileHandle(n, o) { if (!(await window.__fsLesen(n)) && !o?.create) throw new DOMException('weg', 'NotFoundError'); return datei(n); },
    async *values() { for (const n of await window.__fsListe()) yield { kind: 'file', name: n }; },
    async removeEntry(n) { await window.__fsEntfernen(n); },
  };
  window.showDirectoryPicker = async () => dir;
  // Alle Hinweise mitschreiben – ein „doppelt bearbeitet" darf nicht vorkommen, wo nur die Zeit anders ist
  window.__hinweise = [];
  const mitschreiben = () => new MutationObserver(() => {
    for (const t of document.querySelectorAll('.toast')) { const s = t.textContent ?? ''; if (s && window.__hinweise[window.__hinweise.length - 1] !== s) window.__hinweise.push(s); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.body) mitschreiben(); else document.addEventListener('DOMContentLoaded', mitschreiben);
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, {
  boards: [{ id: 'b1', name: 'Bau', comments: [], drawings: [], edges: [], nodes: [startKanban] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
  ai: { provider: 'none', model: '', apiKey: '', baseUrl: '' },
});
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
P.on('dialog', (d) => d.accept());
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2500);

const hier = async () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'k1'));
const ordnerKarte = () => lies()?.boards?.[0]?.nodes?.find((n) => n.id === 'k1');
const tick = (k, id) => k?.data?.items?.find((it) => it.id === id);
const hinweise = () => P.evaluate(() => window.__hinweise.slice());
const oeffne = async (id) => { await P.locator(`.kanban-item[data-kid="${id}"] .kanban-item-text`).click(); await P.waitForTimeout(400); };
const zu = async () => { await P.keyboard.press('Escape'); await P.waitForTimeout(250); await P.evaluate(() => document.activeElement?.blur?.()); };
/** Gerät B: ändert den Stand im Ordner (gleicher Vorfahre wie A) */
const bAendert = (fn) => {
  geraetB = () => {
    const p = lies();
    const k = p.boards[0].nodes.find((n) => n.id === 'k1');
    fn(k);
    p.savedAt = new Date(Date.now() + 7).toISOString();
    schreib(p);
  };
};
/** Warten, bis A den fremden Stand eingearbeitet und das Ergebnis in den Ordner geschrieben hat */
async function einig(bed, ms = 30000) {
  const ende = Date.now() + ms;
  for (;;) {
    const h = await hier(); const o = ordnerKarte();
    const dirty = await P.evaluate(() => localStorage.getItem('pixinotes:sync-dirty'));
    const stempel = await P.evaluate(() => localStorage.getItem('pixinotes:sync-stamp'));
    const fertig = !geraetB && !dirty && stempel === lies()?.savedAt && JSON.stringify(h?.data?.items) === JSON.stringify(o?.data?.items) && bed(h);
    if (fertig || Date.now() > ende) return { h, o, fertig };
    await P.waitForTimeout(500);
  }
}

console.log('E  Im Browser: Gerät A (App) und Gerät B (Ordner) ändern zugleich dasselbe Kanban');
await P.locator('button[title^="Einstellungen"]').click(); await P.waitForTimeout(600);
await P.locator('.modal button', { hasText: 'Daten' }).first().click(); await P.waitForTimeout(500);
await P.locator('.modal button', { hasText: 'Sync-Ordner verbinden' }).click(); await P.waitForTimeout(1500);
await P.keyboard.press('Escape'); await P.waitForTimeout(400);
pruefe('E0 A hat den Ordner verbunden (Stand mit Spaltenzeiten im Ordner)', typeof tick(ordnerKarte(), 't1')?.spalteSeit === 'number', ordnerKarte()?.data?.items);

// E1 dasselbe Ticket in dieselbe Spalte – B etwas später als A
{
  const vorher = (await hinweise()).length;
  await oeffne('t1');
  await P.locator('.ticket-modal .ticket-colsel').selectOption('1'); await P.waitForTimeout(250);
  const SPAETER = Date.now() + 40_000;
  bAendert((k) => { k.data.items = k.data.items.map((it) => (it.id === 't1' ? { ...it, col: 1, spalteSeit: SPAETER } : it)); k.geaendert = SPAETER; });
  await zu();
  const { h, o, fertig } = await einig((k) => tick(k, 't1')?.spalteSeit === SPAETER);
  const neu = (await hinweise()).slice(vorher);
  pruefe('E1 dieselbe Spalte: A übernimmt die spätere Spaltenzeit von B', fertig && tick(h, 't1')?.col === 1 && tick(h, 't1')?.spalteSeit === SPAETER, [tick(h, 't1'), tick(o, 't1')]);
  pruefe('E2 … ohne „doppelt bearbeitet"', !neu.some((s) => /doppelt bearbeitet/.test(s)), neu);
  pruefe('E3 … und die spätere Kartenzeit gilt', h?.geaendert === SPAETER, [h?.geaendert, SPAETER]);
}
// E4 dasselbe Ticket in dieselbe Spalte – A später als B: A behält seine Zeit, der Ordner bekommt sie
{
  const FRUEHER = Date.now() - 60_000;
  await oeffne('t4');
  await P.locator('.ticket-modal .ticket-colsel').selectOption('1'); await P.waitForTimeout(250);
  bAendert((k) => { k.data.items = k.data.items.map((it) => (it.id === 't4' ? { ...it, col: 1, spalteSeit: FRUEHER } : it)); k.geaendert = FRUEHER; });
  await zu();
  const { h, o, fertig } = await einig((k) => tick(k, 't4')?.col === 1);
  pruefe('E4 A war später: A behält seine Spaltenzeit, der Ordner übernimmt sie', fertig && tick(h, 't4')?.spalteSeit > FRUEHER && tick(o, 't4')?.spalteSeit === tick(h, 't4')?.spalteSeit, [tick(h, 't4'), tick(o, 't4')]);
}
// E5 verschiedene Spalten → wie bisher: die hiesige Fassung gilt
{
  await oeffne('t3');
  await P.locator('.ticket-modal .ticket-colsel').selectOption('1'); await P.waitForTimeout(250);
  bAendert((k) => { k.data.items = k.data.items.map((it) => (it.id === 't3' ? { ...it, col: 2, spalteSeit: Date.now() + 30_000 } : it)); k.geaendert = Date.now() + 30_000; });
  await zu();
  const { h, o, fertig } = await einig((k) => tick(k, 't3')?.col === 1);
  pruefe('E5 verschiedene Spalten: Konflikt wie bisher – A behält „In Arbeit", der Ordner auch', fertig && tick(h, 't3')?.col === 1 && tick(o, 't3')?.col === 1, [tick(h, 't3'), tick(o, 't3')]);
}
// E6 nur die Kartenzeit verschieden: beide schreiben denselben Titel
{
  const vorher = (await hinweise()).length;
  await oeffne('t2');
  await P.locator('.ticket-modal .ticket-title').fill('Bauantrag stellen'); await P.waitForTimeout(250);
  const SPAETER = Date.now() + 45_000;
  bAendert((k) => { k.data.items = k.data.items.map((it) => (it.id === 't2' ? { ...it, text: 'Bauantrag stellen' } : it)); k.geaendert = SPAETER; });
  await zu();
  const { h, fertig } = await einig((k) => k?.geaendert === SPAETER);
  const neu = (await hinweise()).slice(vorher);
  pruefe('E6 nur die Kartenzeit verschieden: kein Konflikt, die spätere Kartenzeit gilt', fertig && tick(h, 't2')?.text === 'Bauantrag stellen' && h?.geaendert === SPAETER && !neu.some((s) => /doppelt bearbeitet/.test(s)), [tick(h, 't2'), h?.geaendert, SPAETER, neu]);
}
// E7 echte Textänderung auf beiden → wie bisher: die hiesige gilt
{
  await oeffne('t2');
  await P.locator('.ticket-modal .ticket-title').fill('Bauantrag A'); await P.waitForTimeout(250);
  bAendert((k) => { k.data.items = k.data.items.map((it) => (it.id === 't2' ? { ...it, text: 'Bauantrag B' } : it)); k.geaendert = Date.now() + 30_000; });
  await zu();
  const { h, o, fertig } = await einig((k) => tick(k, 't2')?.text === 'Bauantrag A');
  pruefe('E7 echte Textänderung auf beiden: Konflikt wie bisher, A und der Ordner tragen „Bauantrag A"', fertig && tick(h, 't2')?.text === 'Bauantrag A' && tick(o, 't2')?.text === 'Bauantrag A', [tick(h, 't2'), tick(o, 't2')]);
}

console.log('F  Fehler');
pruefe('F1 keine Seitenfehler', !fehler.length, fehler);

await browser.close();
app.close();
console.log(`\nM472: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
