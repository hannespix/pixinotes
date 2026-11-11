/**
 * M351 — Grabsteine: gleichzeitiges Speichern zweier Geräte verliert keine Karten mehr.
 *
 * Die Zusammenführung (src/lib/syncMerge.ts) wird direkt geprüft — gebündelt mit esbuild, ohne Browser:
 *   A  Überschrieben: Die fremde Datei kennt die neue eigene Karte nicht → sie bleibt, die fremde kommt dazu.
 *   B  Gelöscht: Nennt die fremde Datei die Löschung, verschwindet die Karte.
 *   C  Alte Dateien ohne Grabsteine: wie bisher (fehlt = gelöscht).
 *   D  Verschoben: Liegt die Karte drüben auf einem anderen Board, folgt sie dorthin (keine Verdopplung).
 *   E  Bearbeitung schlägt Löschen.   F  Boards ebenso.   G  Im Browser: Löschen legt Grabsteine an.
 */
// Läuft aus dem Repository: `node pruefungen/m351-grabsteine.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { extname, join } from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pn-m351-'));
const datei = path.join(tmp, 'merge.mjs');
execFileSync(path.join(__repo, 'node_modules/.bin/esbuild'), [path.join(__repo, 'src/lib/syncMerge.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${datei}`, '--log-level=error']);
const { dreiWegeMerge } = await import(pathToFileURL(datei).href);

const k = (id, text = id) => ({ id, type: 'note', position: { x: 0, y: 0 }, data: { blocks: [{ type: 'paragraph', content: text }] } });
const brd = (id, nodes) => ({ id, name: id, nodes, edges: [], drawings: [], comments: [] });
const sp = (boardIds) => [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds }] }];
const stand = (boards, geloescht) => ({ boards, spaces: sp(boards.map((b) => b.id)), ...(geloescht ? { geloescht } : {}) });
const ids = (erg, b = 'bx') => erg.boards.find((x) => x.id === b)?.nodes.map((n) => n.id).sort().join(',');

console.log('\n════ A–E: Karten ════');
{
  // A hat „a" angelegt und geschrieben (Basis = eigener Stand); B hat gleichzeitig „b" angelegt und A's Datei überschrieben
  const basis = stand([brd('bx', [k('x1'), k('a')])]);
  const lokal = stand([brd('bx', [k('x1'), k('a')])]);
  const fremd = stand([brd('bx', [k('x1'), k('b')])], {});
  const e = dreiWegeMerge(basis, lokal, fremd);
  pruefe('A1 überschrieben: die eigene neue Karte bleibt, die fremde kommt dazu', ids(e) === 'a,b,x1', ids(e));
  pruefe('A2 … und das Ergebnis wird zurückgeschrieben (fremdNeu)', e.fremdNeu === true && e.lokalNeu === true);
}
{
  const basis = stand([brd('bx', [k('x1'), k('a')])]);
  const lokal = stand([brd('bx', [k('x1'), k('a')])]);
  const fremd = stand([brd('bx', [k('x1')])], { a: '2026-11-11T12:00:00.000Z' });
  pruefe('B1 nennt die fremde Datei die Löschung, verschwindet die Karte', ids(dreiWegeMerge(basis, lokal, fremd)) === 'x1');
}
{
  const basis = stand([brd('bx', [k('x1'), k('a')])]);
  const lokal = stand([brd('bx', [k('x1'), k('a')])]);
  const fremd = stand([brd('bx', [k('x1')])]);
  pruefe('C1 ältere Datei ohne Grabsteine: fehlt heißt gelöscht (wie bisher)', ids(dreiWegeMerge(basis, lokal, fremd)) === 'x1');
}
{
  const basis = stand([brd('bx', [k('x1'), k('a')]), brd('by', [k('y1')])]);
  const lokal = stand([brd('bx', [k('x1'), k('a')]), brd('by', [k('y1')])]);
  const fremd = stand([brd('bx', [k('x1')]), brd('by', [k('y1'), k('a')])], {});
  const e = dreiWegeMerge(basis, lokal, fremd);
  pruefe('D1 drüben auf ein anderes Board verschoben: folgt dorthin, keine Verdopplung', ids(e, 'bx') === 'x1' && ids(e, 'by') === 'a,y1', [ids(e, 'bx'), ids(e, 'by')]);
}
{
  const basis = stand([brd('bx', [k('x1'), k('a')])]);
  const lokal = stand([brd('bx', [k('x1'), k('a', 'a geändert')])]);
  const fremd = stand([brd('bx', [k('x1')])], { a: '2026-11-11T12:00:00.000Z' });
  pruefe('E1 hier bearbeitet, drüben gelöscht: die Bearbeitung bleibt', ids(dreiWegeMerge(basis, lokal, fremd)) === 'a,x1');
}

console.log('\n════ F: Boards ════');
{
  const basis = stand([brd('bx', [k('x1')]), brd('by', [k('y1')])]);
  const lokal = stand([brd('bx', [k('x1')]), brd('by', [k('y1')])]);
  const ohne = dreiWegeMerge(basis, lokal, stand([brd('bx', [k('x1')])], {}));
  pruefe('F1 ein Board fehlt drüben ohne Grabstein: es bleibt', ohne.boards.some((b) => b.id === 'by'));
  const mit = dreiWegeMerge(basis, lokal, stand([brd('bx', [k('x1')])], { by: '2026-11-11T12:00:00.000Z' }));
  pruefe('F2 mit Grabstein: das Board wird gelöscht', !mit.boards.some((b) => b.id === 'by'));
}

console.log('\n════ G: im Browser ════');
{
  const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
  const PORT = 4569;
  const app = http.createServer((q, r) => {
    let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
    if (!existsSync(f)) f = join(DIST, 'index.html');
    r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
    r.end(readFileSync(f));
  });
  await new Promise((x) => app.listen(PORT, x));
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const st = { boards: [brd('bx', [{ ...k('x1'), width: 240, height: 120 }, { ...k('loesch'), position: { x: 400, y: 0 }, width: 240, height: 120 }])], spaces: sp(['bx']), activeId: 'bx', view: 'board' };
  await ctx.addInitScript(({ st }) => { if (localStorage.getItem('pixinotes-board')) return; localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st })); }, { st });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1600);
  const r = await P.evaluate(() => { const q = document.querySelector('.react-flow__node[data-id="loesch"]').getBoundingClientRect(); return [q.left + q.width / 2, q.top + 6]; });
  await P.mouse.click(r[0], r[1]); await P.waitForTimeout(250);
  await P.keyboard.press('Delete'); await P.waitForTimeout(900);
  const steine = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes:geloescht') ?? '{}'));
  pruefe('G1 Löschen einer Karte legt einen Grabstein an', !!steine.loesch, steine);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(900);
  const zurueck = await P.evaluate(() => !!document.querySelector('.react-flow__node[data-id="loesch"]'));
  pruefe('G2 nach Rückgängig ist die Karte wieder da (der Grabstein reist dann nicht mit)', zurueck);
  await browser.close(); app.close();
}

console.log(`\nm351-grabsteine: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
