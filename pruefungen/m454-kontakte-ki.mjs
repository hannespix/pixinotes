/**
 * M454 — Kontakte für KI und MCP, Sammel-Export.
 *
 * Offen aus M450: Die KI konnte Kontakte nur lesen, der MCP-Server kannte sie gar nicht, und jede Karte ging nur
 * einzeln als .vcf hinaus.
 *
 *   A  App-KI: Der Auftrag nennt die Kontakt-Operationen und den Inhalt der Kontakt-Karte; die KI legt einen Kontakt
 *      an und ändert die Rufnummer eines vorhandenen – ein Schritt für Rückgängig.
 *   B  MCP: Das Bearbeiten-Werkzeug beschreibt die Kontakt-Operationen; ein Kontakt wird angelegt, gelesen und
 *      über seine Kennung geändert.
 *   C  Sammel-Export: Zwei gewählte Kontakte (Rechtsklick → „2 Kontakte als vCard") und alle eines Boards (⋯ am Board)
 *      gehen als EINE .vcf hinaus – mit lib/vcard wieder einlesbar, gleiche Angaben.
 */
// Läuft aus dem Repository: `node pruefungen/m454-kontakte-ki.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5454;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
};

// lib/vcard.ts so, wie die App ihn nutzt – gebündelt und in Node geladen
const vc = await (async () => {
  const r = await build({ entryPoints: [path.join(__repo, 'src/lib/vcard.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
})();

const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const kontakte = () => [
  { id: 'c1', type: 'kontakt', position: { x: 60, y: 80 }, width: 300, data: { name: 'Anna Müller', funktion: 'Sachbearbeiterin', firma: 'Regierungspräsidium Freiburg', telefone: [{ art: 'Dienstlich', nummer: '0761 208-1234' }], emails: ['anna.mueller@example.de'], adresse: 'Kaiser-Joseph-Straße 167\n79098 Freiburg' } },
  { id: 'c2', type: 'kontakt', position: { x: 420, y: 80 }, width: 300, data: { name: 'Jürgen Weiß', firma: 'Gärtnerei Weiß', telefone: [{ art: 'Mobil', nummer: '+49 151 2345678' }], emails: ['j.weiss@example.de'], notiz: 'Ausbilder; Semikolon; und Komma,' } },
  { id: 'c3', type: 'kontakt', position: { x: 780, y: 80 }, width: 300, data: { name: 'Björn Kessler', telefone: [{ nummer: '0711 123456' }], emails: [] } },
  { id: 'n1', type: 'note', position: { x: 60, y: 420 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Ansprechpartner Ausbildung' }] } },
];

const auf = async (nodes, antworten) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((nn) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } }));
  }, nodes);
  await ctx.route(/^https?:\/\/(?!localhost)(?!api\.openai)/, (r) => r.abort());
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const aufrufe = [];
  await P.route('**/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.[0]?.content;
    aufrufe.push(typeof c === 'string' ? c : (c ?? []).map((t) => t.text ?? '').join('\n'));
    const a = antworten ? antworten(aufrufe.length) : { summary: 'ok', ops: [{ op: 'answer', text: 'ok' }] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(a) }, finish_reason: 'stop' }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, aufrufe };
};
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const anweisen = async (P, wunsch) => {
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
  await P.locator('[data-taste="ki-board-eingabe"]').fill(wunsch);
  await P.locator('.dock-menu-ai .ai-cmd-go').click();
  await P.waitForFunction(() => { const t = document.querySelector('.toast')?.textContent ?? ''; return t !== '' && !/analysiert|^KI: /.test(t); }, null, { timeout: 30000 }).catch(() => {});
  await P.waitForTimeout(1300);
};

// ---------- A: App-KI ----------
console.log('A  App-KI legt Kontakte an und ändert sie');
{
  const plan = { summary: 'Kontakte gepflegt', ops: [
    { op: 'kontakt', name: 'Clara Brandt', funktion: 'Ausbildungsberaterin', firma: 'Landratsamt', telefone: [{ nummer: '0761 2187-0', art: 'Dienstlich' }, '0170 5556667'], emails: ['clara.brandt@example.de', 'kein-mail'], adresse: 'Stadtstraße 2\\n79104 Freiburg', from: 'n1' },
    { op: 'edit_kontakt', id: 'c1', telefone: [{ nummer: '0761 208-9999', art: 'Dienstlich' }], funktion: 'Referentin' },
    { op: 'edit_kontakt', id: 'n1', name: 'falsch' },
  ] };
  const { ctx, P, aufrufe } = await auf(kontakte(), () => plan);
  await anweisen(P, 'Leg Clara Brandt als Kontakt an und ändere Annas Nummer auf 0761 208-9999');
  const prompt = aufrufe[0] ?? '';
  pruefe('A1 der Auftrag nennt die Kontakt-Operationen', prompt.includes('"op":"kontakt"') && prompt.includes('"op":"edit_kontakt"'), prompt.slice(0, 300));
  pruefe('A2 der Auftrag enthält den Kontakt mit Rufnummer und Kennung', prompt.includes('0761 208-1234') && prompt.includes('"c1"'));
  const nn = await knoten(P);
  const clara = nn.find((n) => n.type === 'kontakt' && n.data.name === 'Clara Brandt');
  pruefe('A3 neuer Kontakt mit Funktion, Firma, zwei Rufnummern, nur gültiger E-Mail, Anschrift mit Zeilenumbruch', !!clara && clara.data.funktion === 'Ausbildungsberaterin' && clara.data.firma === 'Landratsamt'
    && JSON.stringify(clara.data.telefone) === JSON.stringify([{ nummer: '0761 2187-0', art: 'Dienstlich' }, { nummer: '0170 5556667' }])
    && JSON.stringify(clara.data.emails) === '["clara.brandt@example.de"]' && clara.data.adresse === 'Stadtstraße 2\n79104 Freiburg', clara?.data);
  const anna = nn.find((n) => n.id === 'c1');
  pruefe('A4 Annas Rufnummer ersetzt, Funktion geändert, der Rest bleibt', anna?.data.telefone?.[0]?.nummer === '0761 208-9999' && anna.data.telefone.length === 1 && anna.data.funktion === 'Referentin'
    && anna.data.firma === 'Regierungspräsidium Freiburg' && anna.data.emails[0] === 'anna.mueller@example.de', anna?.data);
  pruefe('A5 die Notiz wird nicht zum Kontakt (falsche Kennung abgelehnt)', nn.find((n) => n.id === 'n1')?.type === 'note' && !('name' in (nn.find((n) => n.id === 'n1')?.data ?? {})));
  const tel = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node-kontakt a[href^="tel:"]')].map((a) => a.getAttribute('href')));
  pruefe('A6 die Karten zeigen die neuen Nummern als tel:-Links', tel.includes('tel:+497612089999') && tel.some((t) => t.startsWith('tel:+49761218')) && !tel.includes('tel:+497612081234'), tel);
  const pfeil = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges);
  pruefe('A7 „from" zieht einen Pfeil von der Notiz zum neuen Kontakt', pfeil.some((e) => e.source === 'n1' && e.target === clara?.id), pfeil);
  await P.mouse.click(1380, 860); await P.keyboard.press('Control+z'); await P.waitForTimeout(800);
  const zurueck = await knoten(P);
  pruefe('A8 Strg+Z nimmt alles in einem Schritt zurück', !zurueck.some((n) => n.data?.name === 'Clara Brandt') && zurueck.find((n) => n.id === 'c1')?.data.telefone[0].nummer === '0761 208-1234', zurueck.map((n) => n.data?.name));
  await ctx.close();
}

// ---------- B: MCP ----------
console.log('B  MCP-Server legt Kontakte an und ändert sie');
{
  const SERVER = path.join(__repo, 'release', 'pixinotes-mcp.mjs');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pn-m454-'));
  const datei = path.join(tmp, 'pixinotes-daten.json');
  const c = new Client({ name: 'pruefung', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, '--datei', datei], stderr: 'ignore' }));
  const ruf = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { text: r.content?.[0]?.text ?? '', fehler: !!r.isError }; };
  const beschr = (await c.listTools()).tools.find((w) => w.name === 'pixinotes_bearbeiten')?.description ?? '';
  pruefe('B1 das Bearbeiten-Werkzeug beschreibt Kontakt anlegen und ändern', beschr.includes('"op":"kontakt"') && beschr.includes('"op":"edit_kontakt"'));
  await ruf('pixinotes_board_anlegen', { name: 'Ansprechpartner' });
  const an = await ruf('pixinotes_bearbeiten', { board: 'Ansprechpartner', ops: [
    { op: 'kontakt', name: 'Dora Fischer', firma: 'Fischzucht Fischer', telefone: [{ nummer: '07661 1234', art: 'Dienstlich' }], emails: ['dora@example.de'] },
    { op: 'kontakt' },
  ] });
  pruefe('B2 ein Kontakt angelegt, der leere abgelehnt', /^1 von 2/.test(an.text), an.text);
  const lese = await ruf('pixinotes_board_lesen', { board: 'Ansprechpartner' });
  const kid = /\[([^\]]+)\] · kontakt/.exec(lese.text)?.[1];
  pruefe('B3 Lesen zeigt den Kontakt mit Kennung und Rufnummer', !!kid && /Dora Fischer/.test(lese.text) && /07661 1234/.test(lese.text), lese.text.slice(0, 500));
  const aend = await ruf('pixinotes_bearbeiten', { board: 'Ansprechpartner', ops: [{ op: 'edit_kontakt', id: kid, telefone: [{ nummer: '07661 9876', art: 'Mobil' }], notiz: 'Prüferin' }] });
  const stand = JSON.parse(readFileSync(datei, 'utf8'));
  const dora = stand.boards.find((b) => b.name === 'Ansprechpartner')?.nodes.find((n) => n.type === 'kontakt');
  pruefe('B4 die Änderung steht in der Datei: neue Nummer, Notiz, Firma bleibt', /^1 von 1/.test(aend.text) && dora?.data.telefone[0].nummer === '07661 9876' && dora.data.notiz === 'Prüferin' && dora.data.firma === 'Fischzucht Fischer', { aend: aend.text, d: dora?.data });
  await c.close();
}

// ---------- C: Sammel-Export ----------
console.log('C  Mehrere Kontakte als eine .vcf');
{
  const { ctx, P } = await auf(kontakte());
  const name = (id) => P.locator(`.react-flow__node[data-id="${id}"] .kontakt-name`);
  await name('c1').click(); await P.keyboard.down('Shift'); await name('c2').click(); await P.keyboard.up('Shift'); await P.waitForTimeout(300);
  const b2 = await name('c2').boundingBox();
  await P.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2, { button: 'right' }); await P.waitForTimeout(450);
  const eintrag = P.locator('.sel-more-menu [data-taste="kontakte-vcard"]');
  pruefe('C1 das Menü der Auswahl bietet „2 Kontakte als vCard"', (await eintrag.count()) === 1 && /2 Kontakte als vCard/.test(await eintrag.textContent()), await eintrag.count());
  const [dl] = await Promise.all([P.waitForEvent('download'), eintrag.click()]);
  const pfad = path.join(SD, 'm454-auswahl.vcf'); await dl.saveAs(pfad);
  const text = readFileSync(pfad, 'utf8');
  pruefe('C2 eine Datei mit zwei vCards, Dateiname nach Board (ASCII)', (text.match(/BEGIN:VCARD/g) ?? []).length === 2 && dl.suggestedFilename() === 'Buero - 2 Kontakte.vcf', dl.suggestedFilename());
  const gelesen = vc.vcardLesen(text);
  pruefe('C3 mit lib/vcard wieder eingelesen: Namen, Rufnummern, E-Mails, Anschrift, Notiz gleich', gelesen.length === 2
    && gelesen[0].name === 'Anna Müller' && gelesen[0].telefone[0].nummer === '0761 208-1234' && gelesen[0].emails[0] === 'anna.mueller@example.de' && /Kaiser-Joseph-Straße 167/.test(gelesen[0].adresse ?? '')
    && gelesen[1].name === 'Jürgen Weiß' && gelesen[1].telefone[0].nummer === '+49 151 2345678' && gelesen[1].notiz === 'Ausbilder; Semikolon; und Komma,', gelesen);
  await P.keyboard.press('Escape'); await P.waitForTimeout(250);
  // Alle eines Boards: ⋯ an der Board-Kachel der Übersicht (dasselbe Board-Menü wie im Navigator)
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box'); await P.keyboard.type('übersicht'); await P.waitForTimeout(400);
  await P.locator('.search-cmd', { hasText: 'Zur Übersicht' }).first().click(); await P.waitForTimeout(1500);
  const kachel = P.locator('.ov-board', { hasText: 'Büro' }).first();
  await kachel.hover(); await P.waitForTimeout(200);
  await kachel.locator('.ebenen-menu-knopf').click({ force: true }); await P.waitForTimeout(350);
  const alle = P.locator('[data-taste="board-kontakte"]');
  pruefe('C4 das Board-Menü bietet „Kontakte als vCard (3)"', (await alle.count()) === 1 && /\(3\)/.test(await alle.textContent()));
  const [dl2] = await Promise.all([P.waitForEvent('download'), alle.click()]);
  const pfad2 = path.join(SD, 'm454-board.vcf'); await dl2.saveAs(pfad2);
  const text2 = readFileSync(pfad2, 'utf8');
  const alleGelesen = vc.vcardLesen(text2);
  pruefe('C5 alle drei Kontakte in einer Datei, wieder einlesbar', alleGelesen.length === 3 && alleGelesen.map((k) => k.name).join() === 'Anna Müller,Jürgen Weiß,Björn Kessler' && dl2.suggestedFilename() === 'Buero - 3 Kontakte.vcf', { n: alleGelesen.map((k) => k.name), f: dl2.suggestedFilename() });
  await P.keyboard.press('Escape'); await P.waitForTimeout(250);
  await P.locator('.ov-board', { hasText: 'Büro' }).first().dblclick(); await P.waitForTimeout(1500);
  if (!(await P.locator('.react-flow__node[data-id="n1"]').count())) { await P.locator('.ov-board', { hasText: 'Büro' }).first().click(); await P.waitForTimeout(1500); }
  // Nur eine Notiz gewählt: kein Kontakt-Eintrag
  await P.locator('.react-flow__node[data-id="n1"]').click({ button: 'right', position: { x: 30, y: 12 } }); await P.waitForTimeout(400);
  pruefe('C6 ohne Kontakt in der Auswahl kein vCard-Eintrag', (await P.locator('.sel-more-menu').count()) === 1 && (await P.locator('.sel-more-menu [data-taste="kontakte-vcard"]').count()) === 0);
  await ctx.close();
}

{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  const mcp = readFileSync(path.join(__repo, 'docs/MCP.md'), 'utf8');
  pruefe('D1 Hilfe (de/en) und MCP-Doku nennen die Kontakte', /M454/.test(hilfe) && /M454/.test(hilfeEn) && /edit_kontakt/.test(mcp) && existsSync(path.join(__repo, 'docs/meilensteine/M454-kontakte-ki.md')));
}
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM454: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
