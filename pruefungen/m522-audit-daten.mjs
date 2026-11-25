/**
 * M522 — Bugfixing-Audit „Daten, Abgleich und Team".
 *
 * Fremde Inhalte (geteilter Link, Sync-Datei, Team-Paket, ein schon beschädigter gespeicherter Stand) bringen PixiNotes
 * nicht mehr als Ganzes zu Fall; gelöschte Projekte und Bereiche kommen über den Abgleich nicht zurück; ein Board aus
 * einem Team-Paket steht nur in einem Projekt.
 *
 * Zwei Arten von Geräten:
 *   · die echte App aus dist/ (was der Nutzer sieht: läuft sie, was steht im Speicher), und
 *   · das „Labor": der echte Speicher und die echten Abgleich-Bibliotheken ohne Oberfläche (aus dem Quelltext
 *     gebündelt, wie m472 es für syncMerge tut) — für Wege, die sonst einen Ordner-Dialog oder zwei Rechner bräuchten.
 *     Der Sync-Ordner ist dabei eine nachgebaute Ordner-API über einem Ordner im Node-Prozess (Gerüst aus m311).
 *
 *   A  Geteilter Link (#b=…) mit kaputten Karten (Kanban ohne Tickets, Zeitplan ohne Zeilen, Notiz mit Text statt
 *      Blöcken …), kaputten Verbindungen, Strichen und Gesprächen: Das Board kommt an, die App läuft — auch nach dem
 *      Neuladen, in Übersicht, Aufgaben und Suche.
 *   B  Ein gespeicherter Stand, der schon beschädigt ist (Board ohne Kartenliste, Karte ohne Lage, Kanban ohne
 *      Tickets): Die App richtet ihn beim ersten Fehler selbst und läuft; nichts Lesbares fällt weg.
 *   C  Sync-Ordner: eine Datei mit einem Board ohne Kartenliste und kaputten Karten — „Stand laden" und der laufende
 *      Abgleich nehmen das Heile, lassen das Kaputte weg, löschen deswegen nichts Hiesiges, und heilen die Datei.
 *   D  Team-Paket (Projekt beitreten) mit kaputten Boards: nur Heiles kommt an. Ein Board, das hier in einem anderen
 *      Projekt lag, steht danach in genau einem.
 *   E  Zwei Geräte am Sync-Ordner: A löscht ein Projekt (samt Board) und einen leeren Bereich — auf B verschwinden
 *      sie, und sie kommen auf A nicht zurück. Danach schreibt keiner mehr (kein Hin und Her). Rückgängig holt den
 *      Grabstein zurück; „geteilt" bekommt nie einen.
 *   F  Was heil ist, bleibt unberührt: Beispiele und frisch angelegte Karten gehen unverändert durch die Prüfung
 *      (dasselbe Objekt); die Sicherung übersteht die Rundreise (Karten, Verbindungen, Striche, Gespräche, Tönung,
 *      Look); der Drei-Wege-Abgleich kommt in 400 Zufallsläufen auf beiden Geräten zum selben Stand.
 *   H  Nur lesend geteiltes Board: Eine Karte meldet keinen Erfolg („Arbeit beendet"), wenn der Leseschutz die Änderung
 *      verworfen hat — der Hinweis nennt den Grund. Auf dem eigenen Board bleibt alles wie bisher.
 *   G  Keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m522-audit-daten.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
/** Quelltext für das Labor (zum Gegenprüfen gegen einen älteren Stand: PN_QUELLE=/pfad/zum/alten/baum) */
const QUELLE = process.env.PN_QUELLE ?? __repo;
const PORT = 5522;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 900) : JSON.stringify(info).slice(0, 900)}`); }
};

// ---------- Labor bündeln: Speicher + Abgleich, im Browser unter window.__pn ----------
const tmp = mkdtempSync(path.join(os.tmpdir(), 'm522-'));
const q = (p) => JSON.stringify(path.join(QUELLE, p));
const neu = existsSync(path.join(QUELLE, 'src/lib/sicherGestalt.ts'));
writeFileSync(path.join(tmp, 'labor.ts'), `
import * as store from ${q('src/store')};
import * as syncFolder from ${q('src/lib/syncFolder')};
import * as projectSync from ${q('src/lib/projectSync')};
import * as grabsteine from ${q('src/lib/grabsteine')};
import * as sicher from ${q('src/lib/sicher')};
import * as sicherung from ${q('src/lib/sicherung')};
import * as nodes from ${q('src/lib/nodes')};
import * as starter from ${q('src/lib/starter')};
${neu ? `import * as sicherGestalt from ${q('src/lib/sicherGestalt')};` : 'const sicherGestalt = null;'}
(window as unknown as Record<string, unknown>).__pn = { ...store, syncFolder, projectSync, grabsteine, sicher, sicherung, nodes, starter, sicherGestalt };
`);
const esbuild = path.join(__repo, 'node_modules/.bin/esbuild');
execFileSync(esbuild, [path.join(tmp, 'labor.ts'), '--bundle', '--format=iife', '--platform=browser', `--outfile=${path.join(tmp, 'labor.js')}`, '--log-level=error',
  '--define:import.meta.env.VITE_SUPABASE_URL=""', '--define:import.meta.env.VITE_SUPABASE_ANON_KEY=""', '--define:import.meta.env.DEV=false', '--define:import.meta.env.BASE_URL="/"']);
execFileSync(esbuild, [path.join(QUELLE, 'src/lib/syncMerge.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${path.join(tmp, 'merge.mjs')}`, '--log-level=error']);
const { dreiWegeMerge } = await import(pathToFileURL(path.join(tmp, 'merge.mjs')).href);

const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const app = http.createServer((req, r) => {
  const pfad = req.url.split('?')[0];
  if (pfad === '/__labor') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<!doctype html><meta charset="utf-8"><title>Labor</title><body><script src="/__labor.js"></script></body>'); return; }
  if (pfad === '/__labor.js') { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(readFileSync(path.join(tmp, 'labor.js'))); return; }
  let f = path.join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

// ---------- Helfer ----------
const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes = []) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const stand = (boards, spaces) => ({ boards, spaces: spaces ?? [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: boards.map((b) => b.id) }] }], activeId: boards[0].id, view: 'board' });
const seitenFehler = [];
/** Der Sync-Ordner im Node-Prozess: Name → { text, lastModified } */
const neuerOrdner = () => ({ dateien: new Map(), schreiben: 0 });
async function kontext(roh, ordner) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1, locale: 'de-DE' });
  if (ordner) {
    await ctx.exposeFunction('__fsLesen', (n) => ordner.dateien.get(n) ?? null);
    await ctx.exposeFunction('__fsSchreiben', (n, text) => { ordner.schreiben += 1; ordner.dateien.set(n, { text, lastModified: Date.now() + ordner.schreiben }); });
    await ctx.exposeFunction('__fsListe', () => [...ordner.dateien.keys()]);
    await ctx.exposeFunction('__fsEntfernen', (n) => { ordner.dateien.delete(n); });
  }
  await ctx.addInitScript(([st, mitOrdner]) => {
    if (mitOrdner) {
      // Nachgebaute File-System-Access-API über den Node-Ordner (wie m311)
      const datei = (n) => ({
        kind: 'file', name: n,
        async getFile() { const e = await window.__fsLesen(n); if (!e) throw new DOMException('weg', 'NotFoundError'); return new File([e.text], n, { lastModified: e.lastModified, type: 'application/json' }); },
        async createWritable() { let buf = ''; return { async write(d) { buf += typeof d === 'string' ? d : await new Response(d).text(); }, async close() { await window.__fsSchreiben(n, buf); } }; },
      });
      const dir = {
        kind: 'directory', name: 'Nextcloud/PixiNotes',
        queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        async getFileHandle(n, o) { if (!(await window.__fsLesen(n)) && !o?.create) throw new DOMException('weg', 'NotFoundError'); return datei(n); },
        async *values() { for (const n of await window.__fsListe()) yield { kind: 'file', name: n }; },
        async removeEntry(n) { await window.__fsEntfernen(n); },
      };
      window.showDirectoryPicker = async () => dir;
    }
    // nur einmal je Gerät säen — jede weitere Seite (Neuladen, Labor → App) findet den Stand vor, den die vorige hinterließ
    if (localStorage.getItem('__m522')) return;
    localStorage.setItem('__m522', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    if (st) localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [roh ?? null, !!ordner]);
  return ctx;
}
async function seite(ctx, pfad = '/') {
  const P = await ctx.newPage();
  P.abgefangen = [];
  P.on('pageerror', (e) => { seitenFehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('console', (m) => { if (m.type() === 'error' && /Fehler abgefangen/.test(m.text())) P.abgefangen.push(m.text().slice(0, 160)); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}${pfad}`, { waitUntil: 'load' });
  if (pfad === '/__labor') await P.waitForFunction(() => !!window.__pn);
  else await P.waitForSelector('.react-flow, .err-box', { timeout: 20000 }).catch(() => {});
  return P;
}
async function warteBis(P, fn, ms = 15000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { try { if (await fn()) return true; } catch { /* weiter */ } await P.waitForTimeout(200); }
  try { return !!(await fn()); } catch { return false; }
}
const zustand = (P) => P.evaluate(() => { try { return JSON.parse(localStorage.getItem('pixinotes-board')).state; } catch { return null; } });
/** Ist ein ganzer Teil der App ausgefallen (nicht nur eine Karte)? */
const ausfall = (P) => P.locator('.err-box.err-full').count();
const karteAusgefallen = (P) => P.locator('.react-flow__node .err-box').count();
const karteDa = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`).count();
/** Übersicht, Aufgaben und Suche öffnen — rechnen über alle Karten aller Boards */
async function rundgang(P) {
  const aus = [];
  if (await ausfall(P)) return ['App'];
  await P.locator('button', { hasText: 'Übersicht' }).first().click({ timeout: 5000 }).catch(() => aus.push('Übersicht nicht erreichbar')); await P.waitForTimeout(700);
  if (await ausfall(P)) aus.push('Übersicht');
  await P.locator('button', { hasText: 'Aufgaben' }).first().click({ timeout: 5000 }).catch(() => aus.push('Aufgaben nicht erreichbar')); await P.waitForTimeout(700);
  if (await ausfall(P)) aus.push('Aufgaben');
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.keyboard.press('Control+k'); await P.waitForTimeout(300); await P.keyboard.type('an'); await P.waitForTimeout(700);
  if (await ausfall(P)) aus.push('Suche');
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  return aus;
}
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Karten, wie sie nur von außen kommen: gültige Hülle (Kennung, Art, Lage), kaputter Inhalt
const KAPUTT = [
  { id: 'k1', type: 'kanban', position: { x: 420, y: 80 }, data: { title: 'Ohne Tickets' } },
  { id: 'k2', type: 'gantt', position: { x: 80, y: 320 }, data: { title: 'Ohne Zeilen' } },
  { id: 'k3', type: 'note', position: { x: 420, y: 320 }, data: { blocks: 'kein Feld' } },
  { id: 'k4', type: 'email', position: { x: 760, y: 80 }, data: { subject: 'Ohne Anhänge' } },
  { id: 'k5', type: 'time', position: { x: 760, y: 320 }, data: { title: 'Ohne Abschnitte' } },
  { id: 'k6', type: 'week', position: { x: 80, y: 560 }, data: { title: 'Ohne Einträge' } },
  { id: 'k7', type: 'kanban', position: { x: 420, y: 560 }, data: { title: 'Schräge Tickets', items: [null, 5, { id: 't1' }, { id: 't2', text: 'Bleibt', col: 1 }], cols: 5 } },
  { id: 'k8', type: 'shape', position: { x: 760, y: 560 }, data: { text: { kein: 'Text' } } },
  // Zahlen, die Schleifen treiben — daran hing die ganze Seite (Zufallslauf im Audit)
  { id: 'k9', type: 'gantt', position: { x: 1100, y: 80 }, data: { title: 'Pixel je Tag als Liste', dayWidth: [[]], rows: [{ id: 'r1', name: 'Vorgang', start: '2026-11-17', end: '2026-11-27' }] } },
  { id: 'k10', type: 'sheet', position: { x: 1100, y: 320 }, data: { title: 'Zehn Millionen Spalten', cols: 10000000, rows: true } },
  { id: 'k11', type: 'sheet', position: { x: 1100, y: 560 }, data: { title: 'Zahl als Zelle', cells: { A1: '1', B1: -1 }, cols: 5, rows: 8 } },
  { id: 'k12', type: 'week', position: { x: 1440, y: 80 }, data: { title: 'Woche ohne Ende', days: 5, from: -1e9, to: 1e12, entries: [] } },
];

// ══ A ═══════════════════════════════════════════════════════════════
console.log('A  Geteilter Link mit kaputtem Inhalt');
{
  const payload = { app: 'pixinotes-board', version: 2, board: {
    id: 'fremd', name: 'Geteiltes Board',
    nodes: [note('g1', 'Gut angekommen', 80, 80), ...KAPUTT],
    edges: [null, 'x', { id: 'e1', source: 'g1', target: 'k1' }, { id: 'e2' }],
    drawings: [{ id: 's1' }, null, { id: 's2', points: [null, 'x', [10, 10], [40, 40]], color: '#f00', width: 3 }],
    comments: [{ id: 'c1', nodeId: 'g1', msgs: [null, { author: 'Anna', text: 'Hallo', at: '2026-11-20T09:00:00.000Z' }] }, { id: 'c2', nodeId: 'g1' }],
  } };
  const ctx = await kontext(stand([board('eigen', 'Mein Board')]));
  const P = await seite(ctx, `/#b=${b64url(zlib.gzipSync(JSON.stringify(payload)))}`);
  const da = await warteBis(P, async () => (await zustand(P))?.boards.some((b) => /Geteiltes Board/.test(b.name)), 12000);
  await P.waitForTimeout(1200);
  const st = await zustand(P);
  const gb = st?.boards.find((b) => /Geteiltes Board/.test(b.name));
  pruefe('A1 das geteilte Board kommt an (trotz kaputter Verbindungen, Striche und Gespräche)', da && !!gb, st?.boards.map((b) => b.name));
  pruefe('A2 die App läuft, die heile Notiz steht da', (await ausfall(P)) === 0 && (await P.locator('.react-flow__node', { hasText: 'Gut angekommen' }).count()) === 1, { ausfall: await ausfall(P), abgefangen: P.abgefangen });
  const kb = (art, titel) => gb?.nodes.find((n) => n.type === art && (n.data.title === titel || n.data.subject === titel));
  const schraeg = kb('kanban', 'Schräge Tickets');
  pruefe('A3 kaputter Inhalt ist gerichtet, nicht verworfen: alle 13 Karten sind da, Listen sind Listen',
    gb?.nodes.length === 13 && Array.isArray(kb('kanban', 'Ohne Tickets')?.data.items) && Array.isArray(kb('gantt', 'Ohne Zeilen')?.data.rows)
    && Array.isArray(kb('email', 'Ohne Anhänge')?.data.attachments) && Array.isArray(kb('time', 'Ohne Abschnitte')?.data.segs) && Array.isArray(kb('week', 'Ohne Einträge')?.data.entries)
    && !gb.nodes.some((n) => n.type === 'note' && typeof n.data.blocks === 'string'),
    gb?.nodes.map((n) => [n.type, Object.keys(n.data)]));
  pruefe('A4 … ein Ticket ohne Text und Spalte bleibt ein Ticket, was kein Ticket ist, fällt weg',
    schraeg?.data.items.length === 2 && schraeg.data.items.every((it) => typeof it.id === 'string' && typeof it.text === 'string' && typeof it.col === 'number') && schraeg.data.items.some((it) => it.text === 'Bleibt' && it.col === 1) && schraeg.data.cols === undefined,
    schraeg?.data);
  const nk = (id) => gb?.nodes.find((n) => n.data.title === id)?.data;
  pruefe('A4b Zahlen außerhalb jedes Sinns fallen weg (Pixel je Tag als Liste, zehn Millionen Spalten, Woche von −1e9 bis 1e12), eine Zahl als Zelle wird ihr Text',
    !!nk('Pixel je Tag als Liste') && nk('Pixel je Tag als Liste').dayWidth === undefined && nk('Zehn Millionen Spalten')?.cols === undefined && nk('Zehn Millionen Spalten')?.rows === undefined
    && nk('Zahl als Zelle')?.cells.B1 === '-1' && nk('Woche ohne Ende')?.from === undefined && nk('Woche ohne Ende')?.to === undefined,
    [nk('Pixel je Tag als Liste'), nk('Zehn Millionen Spalten'), nk('Zahl als Zelle'), nk('Woche ohne Ende')]);
  pruefe('A5 nur gültige Verbindungen, Striche (nur Zahlenpaare) und Beiträge', gb?.edges.length === 1 && gb.drawings.length === 1 && gb.drawings[0].points.length === 2 && (gb.comments ?? []).length === 1 && gb.comments[0].msgs.length === 1,
    { e: gb?.edges, d: gb?.drawings, c: gb?.comments });
  pruefe('A6 keine einzelne Karte ist ausgefallen', (await karteAusgefallen(P)) === 0, await karteAusgefallen(P));
  await P.reload({ waitUntil: 'load' }); await P.waitForSelector('.react-flow, .err-box', { timeout: 20000 }).catch(() => {}); await P.waitForTimeout(1200);
  pruefe('A7 nach dem Neuladen läuft die App weiter (der Stand ist gespeichert)', (await ausfall(P)) === 0 && (await P.locator('.react-flow__node').count()) >= 13, { ausfall: await ausfall(P), karten: await P.locator('.react-flow__node').count() });
  const tot = await rundgang(P);
  pruefe('A8 Übersicht, Aufgaben und Suche laufen (sie rechnen über alle Karten)', tot.length === 0, tot);
  await P.screenshot({ path: path.join(__repo, 'pruefungen', 'ablage', 'm522-a-link.png') }).catch(() => {});
  await ctx.close();
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('B  Ein schon beschädigter gespeicherter Stand');
{
  const kaputt = { ...stand([
    { id: 'm', name: 'Eins', edges: [], nodes: [note('gut', 'Nachbar lebt', 80, 80), { id: 'ohneLage', type: 'note', data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Ohne Lage' }] } }, { id: 'kan', type: 'kanban', position: { x: 420, y: 80 }, data: { title: 'Ohne Tickets' } }] },
    { id: 'ohneKarten', name: 'Ohne Kartenliste' },
    { id: 'ohneKanten', name: 'Ohne Verbindungen', nodes: [note('n3', 'Drittes Board')] },
  ]) };
  const ctx = await kontext(kaputt);
  const P = await seite(ctx);
  await warteBis(P, async () => (await P.locator('.react-flow__node', { hasText: 'Nachbar lebt' }).count()) === 1, 12000);
  await P.waitForTimeout(800);
  pruefe('B1 die App richtet den Stand selbst und läuft', (await ausfall(P)) === 0 && (await P.locator('.react-flow__node', { hasText: 'Nachbar lebt' }).count()) === 1, { ausfall: await ausfall(P), text: (await P.locator('body').innerText()).slice(0, 120) });
  pruefe('B2 die Karte ohne Lage ist nicht verschwunden – sie hat jetzt eine', (await P.locator('.react-flow__node', { hasText: 'Ohne Lage' }).count()) === 1);
  const gesichert = await warteBis(P, async () => { const s = await zustand(P); return Array.isArray(s?.boards.find((b) => b.id === 'ohneKarten')?.nodes) && !!s.boards[0].nodes.find((n) => n.id === 'ohneLage')?.position; }, 8000);
  const st = await zustand(P);
  pruefe('B3 der gerichtete Stand liegt im Speicher: Kartenlisten, Lage, Ticketliste', gesichert && st.boards.length === 3 && Array.isArray(st.boards[2].edges) && Array.isArray(st.boards[0].nodes.find((n) => n.id === 'kan')?.data.items), st?.boards.map((b) => [b.id, Array.isArray(b.nodes), Array.isArray(b.edges)]));
  const vorher = P.abgefangen.length;
  await P.reload({ waitUntil: 'load' }); await P.waitForSelector('.react-flow, .err-box', { timeout: 20000 }).catch(() => {}); await P.waitForTimeout(1200);
  pruefe('B4 nach dem Neuladen: kein Fehler mehr (nichts mehr zu richten)', (await ausfall(P)) === 0 && (await karteAusgefallen(P)) === 0 && P.abgefangen.length === vorher, P.abgefangen.slice(vorher));
  const tot = await rundgang(P);
  pruefe('B5 Übersicht, Aufgaben und Suche laufen', tot.length === 0, tot);
  await ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('C  Sync-Ordner mit beschädigter Datei');
{
  const ordner = neuerOrdner();
  const HAUPT = 'pixinotes-daten.json';
  const lokal = stand([board('bx', 'Planung', [note('x1', 'Planung Notiz')])]);
  const datei = (savedAt, boards) => ordner.dateien.set(HAUPT, { text: JSON.stringify({ app: 'pixinotes', version: 2, savedAt, boards, spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx', 'kaputt', 'by'] }] }], activeId: 'bx' }), lastModified: Date.now() });
  const schraeg = { id: 'by', name: 'Schräg', edges: 'x', nodes: [{ id: 'q1', type: 'kanban', position: { x: 1, y: 2 }, data: {} }, { id: 'q2', type: 'note', data: { blocks: [] } }, note('q3', 'Heil im schrägen Board')] };
  datei('2026-11-24T10:00:00.000111Z', [board('bx', 'Planung', [note('x1', 'Planung Notiz'), note('x2', 'Vom Zweitgerät', 400, 60)]), { id: 'kaputt', name: 'Ohne Karten' }, schraeg]);
  const ctx = await kontext(lokal, ordner);
  const L = await seite(ctx, '/__labor');
  // „Sync-Ordner verbinden → Stand laden" (Einstellungen): lesen und übernehmen
  const r1 = await L.evaluate(async () => {
    const { syncFolder, useBoard, flushPersist } = window.__pn;
    const h = await syncFolder.pickSyncFolder();
    const remote = await syncFolder.readSync(h);
    let uebernommen = false;
    try { uebernommen = remote ? syncFolder.applySync(remote) : false; } catch (e) { return { uebernommen: `WURF ${e}`, boards: [] }; }
    flushPersist();
    const s = useBoard.getState();
    return { uebernommen, boards: s.boards.map((b) => ({ id: b.id, name: b.name, nodes: Array.isArray(b.nodes) ? b.nodes.map((n) => ({ id: n.id, lage: !!n.position, items: n.type === 'kanban' ? Array.isArray(n.data.items) : null })) : null, edges: Array.isArray(b.edges) })) };
  });
  const by1 = r1.boards.find((b) => b.id === 'by');
  pruefe('C1 „Stand laden": das Heile kommt an (neue Notiz, schräges Board), das Board ohne Kartenliste nicht', r1.uebernommen === true && r1.boards.find((b) => b.id === 'bx')?.nodes.length === 2 && !!by1 && !r1.boards.some((b) => b.id === 'kaputt'), r1);
  pruefe('C2 … die Karte ohne Lage fällt weg, das Kanban ohne Tickets hat eine Ticketliste, Verbindungen sind eine Liste', by1?.nodes.length === 2 && by1.nodes.every((n) => n.lage) && by1.nodes.find((n) => n.id === 'q1')?.items === true && by1.edges === true, by1);
  // Laufender Abgleich: Das „andere Gerät" schreibt eine neue Datei — mit einer neuen Notiz, einer kaputten Karte und dem
  // Board „Schräg" diesmal ganz ohne Kartenliste
  datei('2026-11-24T10:05:00.000222Z', [board('bx', 'Planung', [note('x1', 'Planung Notiz'), note('x2', 'Vom Zweitgerät', 400, 60), note('x3', 'Zweite Runde', 700, 60), { id: 'x4', type: 'gantt', position: { x: 60, y: 300 }, data: {} }]), { id: 'by', name: 'Schräg' }]);
  const vorSchreiben = ordner.schreiben;
  const r2 = await L.evaluate(async () => {
    const { syncFolder, useBoard, flushPersist } = window.__pn;
    let erg; try { erg = await syncFolder.checkSyncRemote(true); } catch (e) { erg = `WURF ${e}`; }
    flushPersist();
    const s = useBoard.getState();
    return { erg, bx: s.boards.find((b) => b.id === 'bx')?.nodes?.map((n) => [n.id, n.type === 'gantt' ? Array.isArray(n.data.rows) : true]), by: s.boards.find((b) => b.id === 'by')?.nodes?.length ?? null };
  });
  pruefe('C3 laufender Abgleich: die neue Notiz kommt an, die kaputte Karte gerichtet', r2.erg === 'zusammengefuehrt' && r2.bx?.some((n) => n[0] === 'x3') && r2.bx?.find((n) => n[0] === 'x4')?.[1] === true, r2);
  pruefe('C4 … das Board, das in der Datei kaputt war, wird hier NICHT gelöscht', r2.by === 2, r2);
  const geheilt = JSON.parse(ordner.dateien.get(HAUPT).text);
  pruefe('C5 … und die Datei ist danach geheilt (dieses Gerät hat seinen Stand zurückgeschrieben)', ordner.schreiben > vorSchreiben && geheilt.boards.every((b) => Array.isArray(b.nodes) && Array.isArray(b.edges)) && geheilt.boards.find((b) => b.id === 'by')?.nodes?.length === 2, { geschrieben: ordner.schreiben - vorSchreiben, boards: geheilt.boards.map((b) => [b.id, Array.isArray(b.nodes)]) });
  const r3 = await L.evaluate(async () => { const { syncFolder } = window.__pn; try { return await syncFolder.checkSyncRemote(true); } catch (e) { return `WURF ${e}`; } });
  pruefe('C6 danach ist Ruhe (derselbe Stand noch einmal: nichts zu tun)', r3 === 'ruhe' && ordner.schreiben === vorSchreiben + 1, { r3, schreiben: ordner.schreiben - vorSchreiben });
  await L.close();
  const P = await seite(ctx);
  await P.waitForTimeout(1000);
  pruefe('C7 die App läuft mit diesem Stand', (await ausfall(P)) === 0 && (await P.locator('.react-flow__node', { hasText: 'Zweite Runde' }).count()) === 1, { ausfall: await ausfall(P) });
  await ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('D  Team-Paket');
{
  const ordner = neuerOrdner();
  ordner.dateien.set('pixinotes-projekt-team1.json', { lastModified: Date.now(), text: JSON.stringify({ app: 'pixinotes-projekt', version: 1, savedAt: '2026-11-24T09:00:00.000Z', project: { id: 'team1', name: 'Team-Projekt' },
    boards: [{ id: 'tz', name: 'Kaputt' }, { id: 'ty', name: 'Team-Board', edges: [], nodes: [{ id: 'k', type: 'note' }, { id: 'kk', type: 'kanban', position: { x: 0, y: 0 }, data: {} }, note('tn', 'Vom Team')] }] }) });
  const ctx = await kontext(stand([board('eigen', 'Mein Board', [note('e1', 'Eigenes')])]), ordner);
  const L = await seite(ctx, '/__labor');
  const r = await L.evaluate(async () => {
    const { projectSync, useBoard, flushPersist } = window.__pn;
    let wurf = null; let erg = null;
    try { erg = await projectSync.joinProjectFolder(); } catch (e) { wurf = String(e); }
    flushPersist();
    const s = useBoard.getState();
    return { wurf, namen: erg?.names, boards: s.boards.map((b) => ({ id: b.id, nodes: Array.isArray(b.nodes) ? b.nodes.map((n) => [n.id, !!n.position, n.type === 'kanban' ? Array.isArray(n.data?.items) : true]) : null })), projekte: s.spaces.flatMap((sp) => sp.projects.map((p) => [p.id, p.boardIds])) };
  });
  const ty = r.boards.find((b) => b.id === 'ty');
  pruefe('D1 „Projekt beitreten": das Team-Board kommt an, das Board ohne Kartenliste nicht', !r.wurf && !!ty && !r.boards.some((b) => b.id === 'tz') && r.projekte.some((p) => p[0] === 'team1' && p[1].join() === 'ty'), r);
  pruefe('D2 … nur Karten mit Lage, das Kanban ohne Tickets hat eine Ticketliste', ty?.nodes.length === 2 && ty.nodes.every((n) => n[1] && n[2]), ty);
  await L.close();
  const P = await seite(ctx);
  await P.waitForTimeout(800);
  pruefe('D3 die App läuft danach', (await ausfall(P)) === 0, await ausfall(P));
  await P.close();
  // Ein Board aus dem Paket lag hier inzwischen in einem anderen Projekt
  const L2 = await seite(ctx, '/__labor');
  const r2 = await L2.evaluate(() => {
    const { useBoard } = window.__pn; const S = () => useBoard.getState();
    S().addProject(S().spaces[0].id, 'Ablage');
    const ablage = S().spaces[0].projects.find((p) => p.name === 'Ablage').id;
    S().moveBoard('ty', ablage);
    const vor = S().spaces.flatMap((sp) => sp.projects.map((p) => [p.name, p.boardIds.join()]));
    S().importProject({ id: 'team1', name: 'Team-Projekt' }, [{ id: 'ty', name: 'Team-Board neu', nodes: [], edges: [] }]);
    const alle = S().spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds));
    return { vor, nach: S().spaces.flatMap((sp) => sp.projects.map((p) => [p.name, p.boardIds.join()])), wieOft: alle.filter((id) => id === 'ty').length, name: S().boards.find((b) => b.id === 'ty')?.name };
  });
  pruefe('D4 ein Board aus dem Paket steht danach in genau EINEM Projekt (lag hier in einem anderen)', r2.wieOft === 1 && r2.nach.some((p) => p[0] === 'Team-Projekt' && p[1] === 'ty') && r2.name === 'Team-Board neu', r2);
  await ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('E  Zwei Geräte am Sync-Ordner: Projekt und Bereich löschen');
{
  const ordner = neuerOrdner();
  const start = () => stand(
    [board('a', 'Alpha', [note('a1', 'A1')]), board('b', 'Beta', [note('b1', 'B1')]), board('c', 'Gamma', [note('c1', 'C1')])],
    [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Eins', boardIds: ['a', 'b'] }, { id: 'p2', name: 'Zwei', boardIds: ['c'] }] }, { id: 's2', name: 'Privat', projects: [{ id: 'p3', name: 'Leer', boardIds: [] }] }],
  );
  const ctxA = await kontext(start(), ordner); const ctxB = await kontext(start(), ordner);
  const A = await seite(ctxA, '/__labor'); const B = await seite(ctxB, '/__labor');
  const ebenen = (P) => P.evaluate(() => { const s = window.__pn.useBoard.getState(); return { bereiche: s.spaces.map((sp) => sp.id), projekte: s.spaces.flatMap((sp) => sp.projects.map((p) => p.id)), boards: s.boards.map((b) => b.id) }; });
  const pruefen = (P) => P.evaluate(async () => { try { return await window.__pn.syncFolder.checkSyncRemote(true); } catch (e) { return `WURF ${e}`; } });
  // A verbindet und schreibt, B verbindet und lädt (gemeinsame Basis)
  await A.evaluate(async () => { const { syncFolder, grabsteine } = window.__pn; grabsteine.initGrabsteine(); const h = await syncFolder.pickSyncFolder(); await syncFolder.writeSync(h); });
  await B.evaluate(async () => { const { syncFolder, grabsteine } = window.__pn; grabsteine.initGrabsteine(); const h = await syncFolder.pickSyncFolder(); syncFolder.applySync(await syncFolder.readSync(h)); });
  await B.waitForTimeout(300);
  // A löscht Projekt „Zwei" samt Board und den Bereich „Privat"
  const steine = await A.evaluate(async () => {
    const { useBoard, syncFolder, grabsteine } = window.__pn; const S = () => useBoard.getState();
    S().removeProject('p2', { boards: 'loeschen' });
    S().removeProject('p3');
    S().removeSpace('s2');
    await new Promise((x) => setTimeout(x, 100));
    const g = Object.keys(grabsteine.grabsteineFuer(S().boards, S().spaces));
    await syncFolder.writeSync(await syncFolder.getSyncHandle());
    return g;
  });
  pruefe('E1 das Löschen von Projekt und Bereich hinterlässt Grabsteine (nicht nur für Board und Karte)', ['p2', 'p3', 's2', 'c', 'c1'].every((id) => steine.includes(id)), steine);
  const rB = await pruefen(B);
  const eB = await ebenen(B);
  pruefe('E2 auf dem zweiten Gerät verschwinden Projekt, Bereich und Board', rB === 'zusammengefuehrt' && !eB.projekte.includes('p2') && !eB.projekte.includes('p3') && !eB.bereiche.includes('s2') && !eB.boards.includes('c') && eB.boards.join() === 'a,b', { rB, eB });
  const schreibenNachB = ordner.schreiben;
  const rA = await pruefen(A);
  const eA = await ebenen(A);
  pruefe('E3 … und kommen auf dem ersten nicht zurück', !eA.projekte.includes('p2') && !eA.projekte.includes('p3') && !eA.bereiche.includes('s2') && eA.boards.join() === 'a,b', { rA, eA });
  const r2 = [await pruefen(B), await pruefen(A), await pruefen(B)];
  pruefe('E4 danach schreibt keiner mehr (kein Hin und Her)', ordner.schreiben === schreibenNachB && r2.every((x) => x === 'ruhe' || x === 'gleich'), { r2, mehr: ordner.schreiben - schreibenNachB });
  // Hat nur B etwas an einem Projekt geändert, das A löscht, bleibt es (Bearbeitung schlägt Löschen) — und A bekommt es zurück
  await B.evaluate(async () => { const { useBoard, syncFolder } = window.__pn; useBoard.getState().addBoard('Neu auf B', 'p1'); await syncFolder.writeSync(await syncFolder.getSyncHandle()); });
  await pruefen(A);
  const eA2 = await ebenen(A);
  pruefe('E5 ein neues Board vom zweiten Gerät kommt weiter an (Grabsteine löschen nichts Fremdes)', eA2.boards.length === 3 && eA2.projekte.includes('p1'), eA2);
  // Rückgängig nimmt den Grabstein zurück; „geteilt" bekommt nie einen
  const r3 = await A.evaluate(async () => {
    const { useBoard, grabsteine } = window.__pn; const S = () => useBoard.getState();
    S().addProject('s1', 'Kurz'); const pid = S().spaces[0].projects.find((p) => p.name === 'Kurz').id;
    S().removeProject(pid);
    await new Promise((x) => setTimeout(x, 50));
    const weg = pid in grabsteine.grabsteineFuer(S().boards, S().spaces);
    S().ebeneZurueck();
    await new Promise((x) => setTimeout(x, 50));
    const wiederDa = !(pid in grabsteine.grabsteineFuer(S().boards, S().spaces));
    useBoard.setState({ spaces: [...S().spaces, { id: 'geteilt', name: 'Geteilt mit mir', projects: [{ id: 'geteilt-p', name: 'Geteilt', boardIds: [] }] }] });
    useBoard.setState({ spaces: S().spaces.filter((sp) => sp.id !== 'geteilt') });
    await new Promise((x) => setTimeout(x, 50));
    return { weg, wiederDa, geteilt: 'geteilt' in grabsteine.grabsteineFuer(S().boards, S().spaces) };
  });
  pruefe('E6 Rückgängig holt das Projekt samt Grabstein zurück; der Bereich „geteilt" bekommt keinen', r3.weg && r3.wiederDa && !r3.geteilt, r3);
  await ctxA.close(); await ctxB.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('F  Heiles bleibt unberührt');
{
  const ctx = await kontext(null);
  const L = await seite(ctx, '/__labor');
  const r = await L.evaluate(async () => {
    const { useBoard, sicherGestalt, sicher, nodes, starter, sicherung, syncFolder } = window.__pn; const S = () => useBoard.getState();
    await sicher.gestaltLaden?.();
    const bsp = starter.buildStarter();
    const p = { x: 0, y: 0 };
    const frisch = [nodes.makeNote(p, {}), nodes.makeKanban(p), nodes.makeGantt(p), nodes.makeWeek(p), nodes.makeTime(p), nodes.makeMinutes(p), nodes.makeSheet(p), nodes.makeBubbles(p), nodes.makeKontakt(p), nodes.makeCalendar(p), nodes.makeFrame(p), nodes.makeMermaid(p), nodes.makePortal(p), nodes.makePixi(p), nodes.makeFluessig(p),
      nodes.makeShape(p, 'process'), nodes.makeImage(p, 'data:image/png;base64,AAAA', 'bild.png'), nodes.makeHtmlApp(p, { name: 'tool.html', size: 12 }),
      nodes.makeEmail(p, { subject: 'Betreff', fromName: 'Anna', text: 'Hallo', attachments: [{ name: 'a.pdf', size: 3 }] }), nodes.makeFile(p, { name: 'bericht.pdf', size: 12, mime: 'application/pdf' })];
    const alle = [...bsp.boards.flatMap((b) => b.nodes), ...frisch];
    const veraendert = alle.filter((n) => !sicher.karteGueltig(n) || sicher.karteEntschaerfen(n) !== n).map((n) => [n.type, JSON.stringify(n.data).slice(0, 120)]);
    const standGleich = sicherGestalt ? sicherGestalt.standVonAussen(bsp) === bsp : null;
    // Sicherung: Rundreise
    useBoard.setState({ boards: bsp.boards, spaces: bsp.spaces, activeId: bsp.firstBoardId });
    const gross = 'data:image/png;base64,' + btoa(String.fromCharCode(...Array.from({ length: 6000 }, (_, i) => (i * 7) % 256)));
    useBoard.setState({ boards: S().boards.map((b, i) => (i === 0 ? {
      ...b, bg: 'mint', look: { theme: 'dark', design: 'pixel', accent: 'gruen' },
      nodes: [...b.nodes, { id: 'bild1', type: 'image', position: { x: 5, y: 5 }, data: { src: gross, name: 'gross.png' } }, { id: 'datei1', type: 'file', position: { x: 50, y: 5 }, data: { name: 'bericht.pdf', size: 5, mime: 'application/pdf', lokal: true } }, { id: 'rahmen1', type: 'frame', position: { x: 0, y: 0 }, width: 400, height: 300, data: { name: 'Rahmen Ä' } }],
      drawings: [{ id: 'st1', points: [[1, 1, 0.5], [9, 9, 0.5]], color: '#f00', width: 3 }, { id: 'st2', points: [[1, 1], [2, 2]], color: '#00f', width: 2, anchor: b.nodes[0].id }],
      comments: [{ id: 'c1', nodeId: b.nodes[0].id, msgs: [{ author: 'Ä', text: 'Größe?', at: '2026-11-20T09:00:00.000Z' }] }],
      edges: [...b.edges, { id: 'kante1', source: b.nodes[0].id, target: 'bild1', label: 'führt zu' }],
    } : b)) });
    await syncFolder.idbSet('file:datei1', new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'application/pdf' }));
    const kan = (x) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, v[k]])) : v));
    const original = JSON.parse(JSON.stringify(S().boards));
    const g = await sicherung.sicherungBauen('alles');
    const s = await sicherung.sicherungLesen(g.blob);
    const anders = original.filter((o) => kan(o) !== kan(s.boards.find((x) => x.id === o.id))).map((o) => o.name);
    S().resetAll();
    await syncFolder.idbDel('file:datei1');
    await sicherung.sicherungEinspielen(s, 'ersetzen');
    const nach = S().boards;
    const anders2 = original.filter((o) => kan(o) !== kan(nach.find((x) => x.id === o.id))).map((o) => o.name);
    const f = await syncFolder.idbGet('file:datei1');
    return { karten: alle.length, veraendert, standGleich, boards: original.length, anders, anders2, entschaerft: s.entschaerft, datei: f instanceof Blob ? [...new Uint8Array(await f.arrayBuffer())].join() : String(f) };
  });
  pruefe(`F1 ${r.karten} heile Karten (Beispiele und frisch angelegte aller 20 Arten) gehen unverändert durch die Prüfung – dasselbe Objekt`, r.karten > 90 && r.veraendert.length === 0, r.veraendert);
  pruefe('F2 ein heiler Stand bleibt dasselbe Objekt (kein Umschreiben, kein Schein-Unterschied im Abgleich)', r.standGleich === true, r.standGleich);
  pruefe('F3 Sicherung lesen: jedes Board wie vorher (Karten, Verbindungen, Striche, Gespräche, Tönung, Look, großes Bild), nichts entschärft', r.anders.length === 0 && r.entschaerft === 0 && r.boards >= 18, { anders: r.anders, entschaerft: r.entschaerft });
  pruefe('F4 „Alles leeren" und einspielen: jedes Board wie vorher, die Datei aus dem Gerätespeicher ist zurück', r.anders2.length === 0 && r.datei === '1,2,3,4,5', { anders: r.anders2, datei: r.datei });
  await ctx.close();
}
{
  // Drei-Wege-Abgleich: zwei Geräte, zufällige Änderungen, Protokoll wie syncFolder (lesen, mischen, schreiben, Basis)
  let seed = 522;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const ri = (n) => Math.floor(rnd() * n); const pick = (xs) => xs[ri(xs.length)];
  let z = 0; const nid = (p) => `${p}${++z}`;
  const klon = (x) => JSON.parse(JSON.stringify(x));
  const kan = (x) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
  const basisStand = () => {
    const boards = []; const projekte = [];
    for (let p = 0; p < 2; p += 1) {
      const ids = [];
      for (let i = 0; i < 2; i += 1) {
        const b = board(nid('b'), `Board ${z}`, [0, 1, 2, 3].map(() => note(nid('n'), `Text ${z}`, ri(900), ri(600))));
        b.edges.push({ id: nid('e'), source: b.nodes[0].id, target: b.nodes[1].id });
        b.drawings.push({ id: nid('s'), points: [[0, 0], [5, 5]], color: '#000', width: 2, anchor: b.nodes[2].id });
        b.comments.push({ id: nid('c'), nodeId: b.nodes[0].id, msgs: [{ author: 'A', text: 'hallo', at: '2026-11-20T09:00:00.000Z' }] });
        boards.push(b); ids.push(b.id);
      }
      projekte.push({ id: nid('p'), name: `Projekt ${z}`, boardIds: ids });
    }
    return { boards, spaces: [{ id: 'sp1', name: 'Arbeit', projects: [projekte[0]] }, { id: 'sp2', name: 'Privat', projects: [projekte[1]] }] };
  };
  const aendern = (st, wer, neuIds) => {
    for (let i = 0, n = 1 + ri(4); i < n; i += 1) {
      const b = pick(st.boards); const art = ri(9);
      if (art === 0) { const k = note(nid(`n${wer}`), `neu ${wer}`); b.nodes.push(k); neuIds.push(k.id); }
      else if (art === 1) { pick(b.nodes).data.blocks = [{ type: 'paragraph', content: `geändert ${wer} ${ri(99)}` }]; }
      else if (art === 2 && b.nodes.length > 2) { const k = pick(b.nodes); if (neuIds.includes(k.id)) neuIds.splice(neuIds.indexOf(k.id), 1); b.nodes = b.nodes.filter((x) => x !== k); b.edges = b.edges.filter((e) => e.source !== k.id && e.target !== k.id); b.drawings = b.drawings.filter((s) => s.anchor !== k.id); b.comments = b.comments.filter((c) => c.nodeId !== k.id); }
      else if (art === 3) { pick(b.nodes).position = { x: ri(900), y: ri(600) }; }
      else if (art === 4) { b.name = `Umbenannt ${wer} ${ri(99)}`; }
      else if (art === 5) { const nb = board(nid(`b${wer}`), `Neu ${wer}`, [note(nid(`n${wer}`), 'x')]); st.boards.push(nb); pick(st.spaces.flatMap((s) => s.projects)).boardIds.push(nb.id); neuIds.push(nb.id); }
      else if (art === 6) { b.nodes.reverse(); }
      else if (art === 7) { const alle = st.spaces.flatMap((s) => s.projects); const ziel = pick(alle); for (const p of alle) p.boardIds = p.boardIds.filter((x) => x !== b.id); ziel.boardIds.push(b.id); }
      else if (art === 8) { pick(b.comments)?.msgs.push({ author: wer, text: `Antwort ${wer}`, at: `2026-11-21T0${ri(9)}:00:00.000Z` }); }
    }
  };
  const fehler = [];
  for (let lauf = 0; lauf < 400; lauf += 1) {
    const basis = basisStand(); const neuIds = [];
    const ger = { A: { lokal: klon(basis), basis: klon(basis) }, B: { lokal: klon(basis), basis: klon(basis) } };
    aendern(ger.A.lokal, 'A', neuIds); aendern(ger.B.lokal, 'B', neuIds);
    let ordner = klon(basis);
    try {
      let runden = 0; let ruhig = 0;
      while (runden < 12 && ruhig < 2) {
        const g = ger[runden % 2 === 0 ? 'A' : 'B'];
        const erg = dreiWegeMerge(g.basis, g.lokal, klon(ordner));
        if (erg.lokalNeu) g.lokal = { boards: erg.boards, spaces: erg.spaces };
        if (erg.fremdNeu) ordner = klon({ boards: erg.boards, spaces: erg.spaces });
        g.basis = klon(ordner);
        ruhig = erg.lokalNeu || erg.fremdNeu ? 0 : ruhig + 1; runden += 1;
      }
      if (ruhig < 2) fehler.push(`${lauf}: kommt nicht zur Ruhe`);
      if (kan(ger.A.lokal) !== kan(ger.B.lokal)) fehler.push(`${lauf}: verschiedene Stände`);
      const da = new Set(ger.A.lokal.boards.flatMap((b) => [b.id, ...b.nodes.map((n) => n.id)]));
      for (const id of neuIds) if (!da.has(id)) fehler.push(`${lauf}: ${id} verloren`);
      const inH = ger.A.lokal.spaces.flatMap((sp) => sp.projects.flatMap((p) => p.boardIds));
      if (new Set(inH).size !== inH.length || ger.A.lokal.boards.some((b) => !inH.includes(b.id))) fehler.push(`${lauf}: Hierarchie`);
    } catch (e) { fehler.push(`${lauf}: ${e.message}`); }
  }
  {
    // Drüben gelöscht, hier bearbeitet: Das Board bleibt — und zwar in SEINEM Projekt
    const b = (id, text) => board(id, id, [note(`n${id}`, text)]);
    const raeume = (p2) => [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Eins', boardIds: ['b1'] }] }, { id: 's2', name: 'Privat', projects: [{ id: 'p2', name: 'Zwei', boardIds: p2 }] }];
    const basis = { boards: [b('b1', 'x'), b('b2', 'x'), b('b3', 'x')], spaces: raeume(['b2', 'b3']) };
    const hier = { boards: [b('b1', 'x'), b('b2', 'x'), b('b3', 'hier bearbeitet')], spaces: raeume(['b2', 'b3']) };
    const drueben = { boards: [b('b1', 'x'), b('b2', 'x')], spaces: raeume(['b2']) };
    const erg = dreiWegeMerge(basis, hier, drueben);
    const wo = erg.spaces.flatMap((sp) => sp.projects).filter((p) => p.boardIds.includes('b3')).map((p) => p.id);
    pruefe('F6 ein Board, das drüben gelöscht und hier bearbeitet wurde, bleibt in seinem Projekt (sprang ins erste)', erg.boards.some((x) => x.id === 'b3') && wo.join() === 'p2', { wo, spaces: erg.spaces });
  }
  pruefe('F5 Drei-Wege-Abgleich, 400 Zufallsläufe: beide Geräte enden im selben Stand, kommen zur Ruhe, nichts Neues geht verloren, jedes Board genau einmal in der Hierarchie', fehler.length === 0, fehler.slice(0, 5));
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('H  Nur lesen: kein Erfolg melden, wo nichts gespeichert wurde');
{
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const seit = Math.max(0, d.getHours() * 60 + d.getMinutes() - 120);
  const zeit = (id) => ({ id, type: 'time', position: { x: 80, y: 80 }, width: 440, data: { title: 'Zeit', segs: [{ id: 's1', date: iso, start: seit, kind: 'arbeit' }] } });
  const fremd = { ...board('lz', 'Nur zum Lesen', [zeit('zeitFremd')]), geteiltVon: 'uid-fremd', geteiltVonName: 'anna@example.de', geteiltRolle: 'lesen' };
  const ctx = await kontext(stand([fremd, board('eigen', 'Mein Board', [zeit('zeitEigen')])]));
  const P = await seite(ctx);
  await P.waitForSelector('.react-flow__node[data-id="zeitFremd"] .time-stop', { timeout: 15000 });
  /** Jeden Hinweis mitschreiben, der während des Handgriffs erscheint (M484: nicht hinterher abfragen) */
  const mitschreiben = () => P.evaluate(() => {
    const w = window; w.__hinweise = [];
    const merken = () => { const t = document.querySelector('.toast')?.textContent; if (t && w.__hinweise.at(-1) !== t) w.__hinweise.push(t); };
    w.__beob?.disconnect(); w.__beob = new MutationObserver(merken); w.__beob.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const hinweise = () => P.evaluate(() => window.__hinweise ?? []);
  const segEnde = async (bid, kid) => (await zustand(P)).boards.find((b) => b.id === bid).nodes.find((n) => n.id === kid).data.segs[0].end;
  await mitschreiben();
  await P.locator('.react-flow__node[data-id="zeitFremd"] .time-stop').click();
  await warteBis(P, async () => (await hinweise()).length > 0, 4000);
  await P.waitForTimeout(600);
  const h1 = await hinweise();
  pruefe('H1 nur lesen: „Stop" meldet NICHT „Arbeit beendet" – gespeichert wurde nichts', !h1.some((t) => /beendet/.test(t)) && (await segEnde('lz', 'zeitFremd')) === undefined, h1);
  pruefe('H2 … sondern sagt, warum nichts geschah (nur zum Lesen freigegeben)', h1.some((t) => /nur zum Lesen freigegeben/.test(t)), h1);
  // Gegenprobe auf dem eigenen Board: dort bleibt die Erfolgsmeldung, und es wird gespeichert
  await P.locator('.tabs.spalte .side-board', { hasText: 'Mein Board' }).first().click();
  await P.waitForSelector('.react-flow__node[data-id="zeitEigen"] .time-stop', { timeout: 15000 });
  await P.waitForTimeout(5200);   // der Hinweis von eben ist verklungen
  await mitschreiben();
  await P.locator('.react-flow__node[data-id="zeitEigen"] .time-stop').click();
  await warteBis(P, async () => (await hinweise()).some((t) => /beendet/.test(t)), 4000);
  const beendet = await warteBis(P, async () => typeof (await segEnde('eigen', 'zeitEigen')) === 'number', 4000);
  const h3 = await hinweise();
  pruefe('H3 eigenes Board: „Arbeit beendet (…)" wie bisher, und der Abschnitt ist gespeichert', h3.some((t) => /Arbeit beendet/.test(t)) && beendet, h3);
  await ctx.close();
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('G  Fehler');
pruefe('G1 keine Seitenfehler', seitenFehler.length === 0, seitenFehler.slice(0, 4));

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
