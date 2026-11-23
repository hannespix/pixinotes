/**
 * M443 — MCP-Schnittstelle: KI-Modelle legen von außen Boards an, lesen und füllen sie – mit allen Modulen.
 *
 * Gewünscht: „Ich hätte gerne eine MCP-Schnittstelle, dass ich mit KI-Modellen von außen einfach ein Board
 * erstellen/bearbeiten/füllen kann. Auch die Spezial-Module sollen optimal durch die MCP genutzt werden können."
 *
 *   A  Der Server (release/pixinotes-mcp.mjs, eine Datei) startet über stdio und bietet seine Werkzeuge an.
 *   B  Board anlegen (in Bereich/Projekt) und mit allen Modularten füllen: Notiz (Markdown), Kanban, Rechen-Tabelle
 *      (mit Formel), Zeitplan, Diagramm, Wochenplaner, Protokoll, Ideen, Zeiterfassung, Form; Ungültiges wird benannt.
 *   C  Lesen liefert die Teile mit Kennungen; damit lassen sich Module gezielt ändern (Ticket, Zeile, Pfeil).
 *   D  Ende zu Ende mit der App: Die App ist mit einem Sync-Ordner verbunden, der MCP-Server bearbeitet genau diesen
 *      Ordner, während der Mensch tippt – die App führt von allein zusammen: das neue Board steht da, alle Module
 *      zeigen sich, das alte Board hat die Ergänzung, und nichts Eigenes geht verloren.
 */
// Läuft aus dem Repository: `node pruefungen/m443-mcp.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 4778;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const SERVER = path.join(__repo, 'release', 'pixinotes-mcp.mjs');
const verbinden = async (datei) => {
  const c = new Client({ name: 'pruefung', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, '--datei', datei], stderr: 'ignore' }));
  return c;
};
const ruf = async (c, name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { text: r.content?.[0]?.text ?? '', fehler: !!r.isError }; };

console.log('A  Server');
pruefe('A0 die Server-Datei ist gebaut', existsSync(SERVER));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pn-mcp-'));
const datei1 = path.join(tmp, 'pixinotes-daten.json');
const c1 = await verbinden(datei1);
const werkzeuge = (await c1.listTools()).tools;
const namen = werkzeuge.map((w) => w.name);
pruefe('A1 Werkzeuge: Übersicht, Lesen, Anlegen, Bearbeiten, Umbenennen', ['pixinotes_uebersicht', 'pixinotes_board_lesen', 'pixinotes_board_anlegen', 'pixinotes_bearbeiten', 'pixinotes_board_umbenennen'].every((n) => namen.includes(n)), namen);
const beschr = werkzeuge.find((w) => w.name === 'pixinotes_bearbeiten')?.description ?? '';
pruefe('A2 das Bearbeiten-Werkzeug beschreibt die Operationen aller Module', ['"op":"note"', '"op":"kanban"', '"op":"sheet"', '"op":"set_cells"', '"op":"add_tickets"', '"op":"edit_ticket"', '"op":"add_gantt_rows"', '"op":"add_week_entries"', '"op":"add_session"', '"op":"add_ideas"', '"op":"edit_mermaid"', '"op":"add_time"', '"op":"move"'].every((o) => beschr.includes(o)), beschr.slice(0, 200));

console.log('B  Anlegen und füllen');
const an = await ruf(c1, 'pixinotes_board_anlegen', { name: 'Produktstart', bereich: 'Arbeit', projekt: 'Launch' });
const bid = /\[([^\]]+)\]/.exec(an.text)?.[1];
pruefe('B1 Board angelegt, mit Kennung', !!bid && !an.fehler, an.text);
const ops = [
  { op: 'note', title: 'Ziel', text: '**Launch** im *März*\n- [ ] Landingpage\n- [x] Domain' },
  { op: 'kanban', title: 'Aufgaben', columns: ['Offen', 'In Arbeit', 'Erledigt'], items: [{ text: 'Texte schreiben', who: 'Anna', prio: 1 }, { text: 'Bilder', column: 'In Arbeit' }] },
  { op: 'sheet', title: 'Budget', rows: [['Posten', 'Betrag'], ['Ads', '1200'], ['Design', '800'], ['Summe', '=SUMME(B2:B3)']], filter: true },
  { op: 'gantt', title: 'Zeitplan', rows: [{ name: 'Konzept', start: '2026-12-01', end: '2026-12-10' }, { name: 'Start', start: '2026-12-15', end: '2026-12-15' }] },
  { op: 'mermaid', code: 'flowchart TD\n  A[Idee] --> B[Launch]' },
  { op: 'week', title: 'Woche', entries: [{ day: 0, start: 540, dur: 60, text: 'Standup' }] },
  { op: 'minutes', title: 'Jour fixe', sessions: [{ date: '2026-11-23', attendees: 'Anna, Ben', text: '- Status', decisions: ['Go'] }] },
  { op: 'bubbles', title: 'Ideen', question: 'Wie heißt das Produkt?', ideas: ['Nova', 'Pixel'] },
  { op: 'time', title: 'Zeiten' },
  { op: 'shape', shape: 'decision', text: 'Fertig?' },
  { op: 'gibtsnicht' },
];
const fuell = await ruf(c1, 'pixinotes_bearbeiten', { board: 'Produktstart', ops });
pruefe('B2 zehn Module angelegt, die unbekannte Operation wird benannt', /^10 von 11/.test(fuell.text) && /gibtsnicht/.test(fuell.text), fuell.text);
const stand = JSON.parse(readFileSync(datei1, 'utf8'));
const b = stand.boards.find((x) => x.id === bid);
const arten = b ? b.nodes.map((n) => n.type).sort().join(',') : '';
pruefe('B3 in der Datei: ein PixiNotes-Stand mit allen zehn Modularten', stand.app === 'pixinotes' && arten === 'bubbles,gantt,kanban,mermaid,minutes,note,shape,sheet,time,week', arten);
const notiz = b?.nodes.find((n) => n.type === 'note');
pruefe('B4 Markdown wird zu echtem Notiz-Inhalt (fett, kursiv, Checkliste)', JSON.stringify(notiz?.data?.blocks ?? []).includes('"bold":true') && JSON.stringify(notiz?.data?.blocks ?? []).includes('"italic":true') && (notiz?.data?.blocks ?? []).some((x) => x.type === 'checkListItem' && x.props?.checked), notiz?.data?.blocks);
const lagen = (b?.nodes ?? []).map((n) => [n.position.x, n.position.y, n.width ?? 300, n.height ?? 200]);
const ueber = lagen.some((a, i) => lagen.some((q, j) => j > i && a[0] < q[0] + q[2] && q[0] < a[0] + a[2] && a[1] < q[1] + q[3] && q[1] < a[1] + a[3]));
pruefe('B5 die neuen Karten überdecken sich nicht', !ueber, lagen);

console.log('C  Lesen und gezielt ändern');
const lese = await ruf(c1, 'pixinotes_board_lesen', { board: bid });
const kan = /\[([^\]]+)\] · kanban/.exec(lese.text)?.[1]; const tab = /\[([^\]]+)\] · sheet/.exec(lese.text)?.[1];
const ticket = /\[([^\]]+)\] Offen · Texte schreiben/.exec(lese.text)?.[1];
pruefe('C1 Lesen zeigt Karten und ihre Teile mit Kennungen, Formeln mit Ergebnis', !!kan && !!tab && !!ticket && /=SUMME\(B2:B3\) → 2\.000/.test(lese.text), lese.text.slice(0, 400));
const aend = await ruf(c1, 'pixinotes_bearbeiten', { board: bid, ops: [
  { op: 'edit_ticket', id: kan, ticket, column: 'Erledigt' },
  { op: 'add_rows', id: tab, rows: [['Druck', '300']] },
  { op: 'edge', source: kan, target: tab, label: 'Kosten' },
  { op: 'move', id: tab, x: 2000, y: 0 },
] });
pruefe('C2 Ticket verschoben, Zeile ergänzt, Pfeil gezogen, Karte verlegt', /^4 von 4/.test(aend.text), aend.text);
const lese2 = await ruf(c1, 'pixinotes_board_lesen', { board: bid });
pruefe('C3 die Summenzeile rechnet die neue Zeile mit, das Ticket ist erledigt, der Pfeil steht', /Druck \| 300/.test(lese2.text) && /=SUMME\(B2:B4\) → 2\.300/.test(lese2.text) && /Erledigt · Texte schreiben/.test(lese2.text) && /„Kosten"/.test(lese2.text), lese2.text.slice(0, 900));
const um = await ruf(c1, 'pixinotes_board_umbenennen', { board: bid, name: 'Produktstart 2027' });
const ueb = await ruf(c1, 'pixinotes_uebersicht');
pruefe('C4 Umbenennen und Übersicht (Bereich → Projekt → Board)', /Produktstart 2027/.test(um.text) && /Bereich „Arbeit"[\s\S]*Projekt „Launch"[\s\S]*Produktstart 2027 · 10 Karten/.test(ueb.text), ueb.text);
const falsch = await ruf(c1, 'pixinotes_board_lesen', { board: 'gibt es nicht' });
pruefe('C5 ein unbekanntes Board wird als Fehler gemeldet, mit der Liste der vorhandenen', falsch.fehler && /Produktstart 2027/.test(falsch.text), falsch);
await c1.close();

console.log('D  Ende zu Ende mit der App');
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 900 } });
// Der Sync-Ordner ist ein echtes Verzeichnis auf der Platte: die App schreibt über die nachgebaute Ordner-API hinein,
// der MCP-Server direkt (wie ein Cloud-Client, der die Datei von einem anderen Gerät hereinspiegelt)
const ordner2 = path.join(tmp, 'Nextcloud', 'PixiNotes'); mkdirSync(ordner2, { recursive: true });
const datei2 = path.join(ordner2, 'pixinotes-daten.json');
const imOrdner = (n) => path.join(ordner2, path.basename(n));
await ctx.exposeFunction('__fsLesen', (n) => (existsSync(imOrdner(n)) ? { text: readFileSync(imOrdner(n), 'utf8'), lastModified: Math.round(statSync(imOrdner(n)).mtimeMs) } : null));
await ctx.exposeFunction('__fsSchreiben', (n, text) => { writeFileSync(imOrdner(n), text); });
await ctx.exposeFunction('__fsListe', () => readdirSync(ordner2));
await ctx.exposeFunction('__fsEntfernen', (n) => { rmSync(imOrdner(n), { force: true }); });
await ctx.addInitScript(() => {
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
    kind: 'directory', name: 'Nextcloud/PixiNotes',
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    async getFileHandle(n, o) { if (!(await window.__fsLesen(n)) && !o?.create) throw new DOMException('weg', 'NotFoundError'); return datei(n); },
    async *values() { for (const n of await window.__fsListe()) yield { kind: 'file', name: n }; },
    async removeEntry(n) { await window.__fsEntfernen(n); },
  };
  window.showDirectoryPicker = async () => dir;
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'alt', name: 'Altes Board', edges: [], drawings: [], nodes: [{ id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Meine Notiz' }] } }] }], spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'Alltag', boardIds: ['alt'] }] }], activeId: 'alt', view: 'board' } }));
});
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
P.on('dialog', (d) => d.accept());
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);
await P.locator('[data-taste="einstellungen"]').click(); await P.waitForTimeout(400);
await P.locator('.modal button', { hasText: /^Daten$/ }).first().click(); await P.waitForTimeout(400);
await P.locator('.modal button', { hasText: 'Sync-Ordner verbinden' }).click(); await P.waitForTimeout(1500);
await P.keyboard.press('Escape'); await P.waitForTimeout(300);
pruefe('D1 die App schreibt ihren Stand in den Sync-Ordner', existsSync(datei2) && JSON.parse(readFileSync(datei2, 'utf8')).boards?.some((x) => x.id === 'alt'));
const zustand = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const warteBis = async (fn, ms = 25000) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(500); } return fn(); };
// Der Mensch tippt in der App, während die KI über MCP an genau diesem Ordner arbeitet
await P.mouse.dblclick(900, 600); await P.waitForTimeout(700);
await P.keyboard.type('Lokal getippt', { delay: 15 }); await P.waitForTimeout(300); await P.keyboard.press('Escape'); await P.waitForTimeout(300);
const c2 = await verbinden(ordner2);
const an2 = await ruf(c2, 'pixinotes_board_anlegen', { name: 'Von der KI', bereich: 'Privat', projekt: 'Alltag' });
const bid2 = /\[([^\]]+)\]/.exec(an2.text)?.[1];
await ruf(c2, 'pixinotes_bearbeiten', { board: bid2, ops: ops.slice(0, 10) });
await ruf(c2, 'pixinotes_bearbeiten', { board: 'Altes Board', ops: [{ op: 'note', title: 'Ergänzung', text: 'Von außen angelegt', color: 'mint' }] });
await c2.close();
// Die App bemerkt die fremde Änderung von allein (Ordner-Überwachung) und führt zusammen
const da = await warteBis(async () => { const s = await zustand(); return s.boards.some((x) => x.name === 'Von der KI') && JSON.stringify(s.boards).includes('Von außen angelegt'); });
pruefe('D2 die App übernimmt die Arbeit der KI ohne Klick', da);
const ganz = await warteBis(async () => (readFileSync(datei2, 'utf8').includes('Lokal getippt') && readFileSync(datei2, 'utf8').includes('Von außen angelegt')), 15000);
pruefe('D2b … und der Ordner trägt danach beides (Eigenes und das der KI)', ganz);
const baum = await P.evaluate(() => [...document.querySelectorAll('.tabs.spalte .side-board-name')].map((e) => e.textContent.trim()));
pruefe('D2c das Board der KI steht in der Seitenleiste neben dem eigenen', baum.includes('Von der KI') && baum.includes('Altes Board'), baum);
const altStand = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((x) => x.id === 'alt').nodes.map((n) => JSON.stringify(n.data).slice(0, 300)));
pruefe('D3 das alte Board hat die Ergänzung der KI – und behält, was lokal getippt wurde', altStand.some((t) => /Von außen angelegt/.test(t)) && altStand.some((t) => /Lokal getippt/.test(t)) && altStand.some((t) => /Meine Notiz/.test(t)), altStand);
await P.locator('.tabs.spalte .side-board-name', { hasText: 'Von der KI' }).click(); await P.waitForTimeout(2000);
const sicht = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => [...n.classList].find((c) => c.startsWith('react-flow__node-'))?.replace('react-flow__node-', '')).sort());
pruefe('D4 alle zehn Module erscheinen auf dem Board', ['bubbles', 'gantt', 'kanban', 'mermaid', 'minutes', 'note', 'shape', 'sheet', 'time', 'week'].every((t) => sicht.includes(t)), sicht);
const inhalt = await P.evaluate(() => document.querySelector('.react-flow')?.innerText ?? '');
pruefe('D5 ihre Inhalte stehen da (Ticket, Tabelle mit Summe, Vorgang, Sitzung, Idee)', ['Texte schreiben', '2.000', 'Konzept', 'Standup', 'Nova', 'Fertig?'].every((t) => inhalt.includes(t)), inhalt.slice(0, 500));
await P.keyboard.press('Shift+1'); await P.waitForTimeout(800);
await P.screenshot({ path: path.join(SD, 'm443-mcp-board.png') });
// Einrichtung in der App: leise eingeklappt unter Dienste → KI-Assistent
await P.locator('[data-taste="einstellungen"]').click(); await P.waitForTimeout(400);
await P.locator('.modal button', { hasText: /^Dienste$/ }).first().click(); await P.waitForTimeout(400);
const mcp = await P.evaluate(() => { const d = document.querySelector('.modal [data-taste="mcp"]'); return d && { offen: d.open, link: d.querySelector('a')?.getAttribute('href'), code: d.querySelector('pre')?.textContent }; });
pruefe('E2 die Einrichtung steht eingeklappt in den Diensten, mit Download und Eintrag fürs KI-Programm', mcp && !mcp.offen && mcp.link === 'pixinotes-mcp.mjs' && /"--ordner"/.test(mcp.code ?? '') && /mcpServers/.test(mcp.code ?? ''), mcp);
await P.keyboard.press('Escape'); await P.waitForTimeout(300);
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('E1 Hilfe, Umbau-Liste und Doku nennen M443', /M443/.test(hilfe) && /M443/.test(umbau) && existsSync(path.join(__repo, 'docs/MCP.md')));
}
await browser.close(); app.close();
console.log(`\nM443: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
