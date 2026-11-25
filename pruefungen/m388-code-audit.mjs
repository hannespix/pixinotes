/**
 * M388 — Code-Audit: was die Prüfung gefunden hat, bleibt behoben.
 *
 *   A  Rechnen und Prüfen (ohne Browser; die Bibliotheken werden dafür gebündelt):
 *      Rechen-Tabelle (leere Zellen, WENN, $A$1, RUNDEN, HEUTE), Kalender (Ende um Mitternacht, Monatsende),
 *      Kurzdaten („am 3.12."), Export-Escaping, Text aus Notiz-Tabellen, Verknüpfungen, Tastenkürzel auf
 *      deutscher Tastatur, und lib/sicher.ts: Adressen, Karten, Boards, Patches von außen.
 *   B  Im Browser — Sicherheit: Eine „Live"-Karte mit javascript:-Adresse wird nicht eingebettet; eine Datei mit
 *      javascript:-Adresse wird nicht angeklickt; ein geteiltes Board mit kaputten Karten kommt ohne Absturz an,
 *      ohne die kaputten Karten und ohne die gefährlichen Adressen.
 *   C  Im Browser — Bedienung: Leere Notiz holt sich beim Laden nicht den Cursor; „Rückgängig" im Hinweis legt nach
 *      Strg+Z nichts doppelt an; Kommentare kehren mit ihrer Karte zurück; Tasten wirken nicht durch offene
 *      Fenster; die Leertaste löst einen Knopf aus.
 *   D  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m388-code-audit.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4700;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Rechnen und Prüfen ════');
{
  const lib = (n) => JSON.stringify(path.join(__repo, 'src', 'lib', n));
  const einstieg = path.join(SD, 'm388-einstieg.ts');
  writeFileSync(einstieg, [
    `export { rechneBlatt } from ${lib('formel')};`, `export { parseIcs } from ${lib('ics')};`, `export { nextDate } from ${lib('minutes')};`,
    `export { detectDates, fristenLaden } from ${lib('dates')};`, `export { nodeToText } from ${lib('serialize')};`, `export { nodeToHtml } from ${lib('serializeFormate')};`, `export * as sicher from ${lib('sicher')};`,
    `export { patchSaeubern } from ${lib('gastPatch')};`, `export { tagLokal } from ${lib('tag')};`, `export { resolveLink, collectBacklinks } from ${lib('links')};`, `export { passt } from ${lib('tasten')};`,
  ].join('\n'));
  const aus = path.join(SD, 'm388-bündel.mjs');
  await build({ entryPoints: [einstieg], bundle: true, format: 'esm', platform: 'node', outfile: aus, logLevel: 'silent' });
  globalThis.window = { location: { href: 'https://app.example/pixinotes/', origin: 'https://app.example', pathname: '/pixinotes/' }, addEventListener() {}, dispatchEvent() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const m = await import(pathToFileURL(aus).href);
  await m.fristenLaden();   // M459: die Fristen-Erkennung lädt bei Bedarf (in der App beim ersten Text mit Datum)
  const f = m.rechneBlatt({ A1: '10', A2: '20', A3: '30', B1: '0', C1: '=MITTELWERT(A1:A5)', C2: '=ANZAHL(A1:A5)', C3: '=MIN(A1:A5)', C4: '=PRODUKT(A1:A5)', C5: '=WENN(B1=0;0;A1/B1)', C6: '=$A$1+1', C7: '=RUNDEN(1,005;2)', C8: '=RUNDEN(-2,5;0)', C9: '=A4+1', C10: '=WENN(A1/B1>1;1;2)', C11: '=HEUTE()' });
  pruefe('A1 leere Zellen zählen in MITTELWERT, ANZAHL, MIN, PRODUKT nicht mit', f.C1 === 20 && f.C2 === 3 && f.C3 === 10 && f.C4 === 6000, f);
  pruefe('A2 WENN wertet nur den gewählten Zweig (=WENN(B1=0;0;A1/B1) → 0); ein Fehler in der Bedingung bleibt ein Fehler', f.C5 === 0 && f.C10 === '#DIV/0!', [f.C5, f.C10]);
  pruefe('A3 $A$1 ist dieselbe Zelle wie A1; eine leere Zelle rechnet einzeln weiter als 0', f.C6 === 11 && f.C9 === 1, [f.C6, f.C9]);
  pruefe('A4 RUNDEN kaufmännisch: 1,005 → 1,01 und −2,5 → −3', f.C7 === 1.01 && f.C8 === -3, [f.C7, f.C8]);
  const d = new Date();
  pruefe('A5 HEUTE() und tagLokal() nennen den Tag nach der Uhr des Geräts', f.C11 === m.tagLokal() && m.tagLokal() === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, [f.C11, m.tagLokal()]);
  const ics = m.parseIcs('BEGIN:VEVENT\nSUMMARY:Ganztag\nDTSTART:20261116T000000\nDTEND:20261117T000000\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Abend\nDTSTART:20261118T220000\nDTEND:20261119T000000\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Zwei Tage\nDTSTART;VALUE=DATE:20261120\nDTEND;VALUE=DATE:20261122\nEND:VEVENT');
  pruefe('A6 Kalender: ein Ende um Punkt 0 Uhr belegt den nächsten Tag nicht; Ganztägiges über zwei Tage bleibt zwei Tage', !ics[0].end && !ics[1].end && ics[2].end === '2026-11-21', ics);
  pruefe('A7 Monatsrhythmus läuft am Monatsende nicht über (31.01. → 28.02., 30.11. + Quartal → 28.02.)', m.nextDate({ entries: [{ id: 'a', date: '2026-01-31', blocks: [] }], rhythm: 'monat' }, new Date(2026, 0, 31, 12)) === '2026-02-28' && m.nextDate({ entries: [{ id: 'a', date: '2026-11-30', blocks: [] }], rhythm: 'quartal' }, new Date(2026, 10, 30, 12)) === '2027-02-28');
  const kd = m.detectDates('Treffen am 3.12. um 10 Uhr', new Date(2026, 10, 16, 9));
  pruefe('A8 „am 3.12. um 10 Uhr" wird als Termin erkannt – auch beim zweiten Aufruf (gemerkt)', kd.length === 1 && kd[0].date.getMonth() === 11 && kd[0].date.getDate() === 3 && m.detectDates('Treffen am 3.12. um 10 Uhr', new Date(2026, 10, 16, 9))[0].date.getDate() === 3, kd);
  const h1 = m.nodeToHtml({ id: 'g', type: 'gantt', position: { x: 0, y: 0 }, data: { title: 'T', rows: [{ id: 'r', name: 'n', start: '2026-01-01', end: '2026-01-02', progress: '<img src=x onerror=alert(1)>' }] } });
  const h2 = m.nodeToHtml({ id: 't', type: 'time', position: { x: 0, y: 0 }, data: { title: 'Z', segs: [{ id: 's', date: '<script>1</script>', start: 60, end: 120, kind: '<b>x</b>' }] } });
  pruefe('A9 Export: Fortschritt, Datum und Art einer fremden Karte kommen nie als HTML an', !/<img|<script|<b>x/.test(h1 + h2) && h2.includes('&lt;script&gt;'), (h1 + h2).slice(0, 200));
  pruefe('A10 Text aus einer Notiz-Tabelle wird gelesen (Suche, KI, Text-Export)', m.nodeToText({ id: 'n', type: 'note', position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', content: [{ type: 'text', text: 'Apfel' }] }, { type: 'tableCell', content: [{ type: 'text', text: 'Birne' }] }] }] } }] } }) === 'Apfel | Birne');
  const s = m.sicher;
  pruefe('A11 eingebettet wird nur eine fremde http(s)-Adresse', s.fremdeWebAdresse('javascript:alert(1)') === null && s.fremdeWebAdresse('data:text/html,x') === null && s.fremdeWebAdresse('https://app.example/x') === null && s.fremdeWebAdresse('https://example.org/a') === 'https://example.org/a');
  pruefe('A12 eine Karte braucht Kennung, Art, Lage aus Zahlen und Inhalt', s.karteGueltig({ id: 'a', type: 'note', position: { x: 1, y: 2 }, data: {} }) && !s.karteGueltig({ id: 'a', type: 'note', data: {} }) && !s.karteGueltig({ id: 'a', type: 'note', position: { x: '1', y: 2 }, data: {} }) && !s.karteGueltig(5));
  const tool = s.karteEntschaerfen({ id: 'h', type: 'htmlapp', position: { x: 0, y: 0 }, data: { name: 'x', live: true, url: 'javascript:alert(1)' } }).data;
  const datei = s.karteEntschaerfen({ id: 'f', type: 'file', position: { x: 0, y: 0 }, data: { name: 'x.zip', dataUrl: 'javascript:alert(1)' } }).data;
  pruefe('A13 gefährliche Adressen in Tool- und Datei-Karten werden entfernt', !('url' in tool) && !('live' in tool) && !('dataUrl' in datei), [tool, datei]);
  const b = s.boardVonAussen({ id: 'FREMD', name: 'x', nodes: [{ id: 'ok', type: 'note', position: { x: 0, y: 0 }, data: {} }, { id: 'kaputt' }, 7], edges: [{ id: 'e', source: 'ok', target: 'ok' }, { id: 'e2' }] }, 'bx');
  pruefe('A14 ein Board von außen: Die Kennung bestimmt der Abrufende, kaputte Stücke fallen weg; kein Board → null', b.id === 'bx' && b.nodes.length === 1 && b.edges.length === 1 && s.boardVonAussen({ hallo: 1 }, 'bx') === null && s.boardVonAussen([1], 'bx') === null);
  const p = m.patchSaeubern({ nodes: { set: [{ id: 'a' }, { id: 'b', type: 'note', position: { x: 1, y: 1 }, data: {} }], del: ['x'] }, edges: { set: [{ id: 'e' }] } });
  pruefe('A15 ein Patch aus dem Kanal: nur gültige Karten und Verbindungen bleiben', p.nodes.set.length === 1 && p.nodes.del.length === 1 && p.edges.set.length === 0, p);
  const taste = (key, code) => ({ key, code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false });
  pruefe('A16 Alt+Z gilt der Taste, auf der Z steht (deutsche Tastatur) – nicht mehr der Taste Y', m.passt(taste('z', 'KeyY'), 'zeichnen') && !m.passt(taste('y', 'KeyZ'), 'zeichnen') && m.passt(taste('Ω', 'KeyZ'), 'zeichnen'));
  const boards = [{ id: 'b1', name: 'Eins', nodes: [{ id: 'n1', type: 'note', position: { x: 0, y: 0 }, data: { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Zielkarte' }] }] } }, { id: 'n2', type: 'note', position: { x: 0, y: 0 }, data: { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'siehe [[Zielkarte]] und [[Zwei]]' }] }] } }], edges: [] }, { id: 'b2', name: 'Zwei', nodes: [], edges: [] }];
  pruefe('A17 Verknüpfungen lösen sich über den gemerkten Titel-Index auf wie bisher', m.resolveLink('zielkarte', boards)?.nodeId === 'n1' && m.resolveLink('Zwei', boards)?.boardId === 'b2' && m.resolveLink('gibtsnicht', boards) === null && m.collectBacklinks(boards, 'b2').length === 1);
  delete globalThis.window; delete globalThis.localStorage;
}

// ---------- Browser ----------
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const t = (s) => [{ type: 'text', text: s, styles: {} }];
const note = (id, text, x, y) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: text ? [{ id: `${id}-b`, type: 'paragraph', props: {}, content: t(text), children: [] }] : [] } });
const stand = {
  boards: [{ id: 'b1', name: 'Planung', edges: [], drawings: [],
    comments: [{ id: 'c1', nodeId: 'n2', msgs: [{ author: 'Anna', at: '2026-11-15T10:00:00.000Z', text: 'Bitte prüfen' }] }],
    nodes: [
      note('n1', 'Erste Notiz', 60, 80), note('n2', 'Zweite Notiz', 340, 80), note('n3', '', 620, 80),
      { id: 'h1', type: 'htmlapp', width: 380, height: 300, position: { x: 60, y: 300 }, data: { name: 'Böses Tool', size: 0, live: true, url: 'javascript:parent.__xss=1;window.__xss=1' } },
      { id: 'f1', type: 'file', width: 260, position: { x: 480, y: 300 }, data: { name: 'Protokoll.zip', mime: 'application/zip', size: 10, dataUrl: 'javascript:window.__xss=1' } },
    ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, stand);
const P = await ctx.newPage();
const fehler = [];
P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
let dialoge = 0;
P.on('dialog', (d) => { dialoge += 1; void d.accept(); });
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);
const zustand = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const board = async (id = 'b1') => (await zustand()).boards.find((b) => b.id === id);
const warteBis = async (fn, ms = 6000) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(150); } return fn(); };
const toast = () => P.evaluate(() => document.querySelector('.toast.show')?.textContent ?? '');
const greif = (id) => P.evaluate((i) => { const r = document.querySelector(`.react-flow__node[data-id="${i}"]`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + 6]; }, id);
const frei = async () => { await P.keyboard.press('Escape'); await P.mouse.click(1300, 700); await P.waitForTimeout(300); };

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Sicherheit im Browser ════');
await P.locator('.react-flow__node[data-id="h1"] .happ-go, .react-flow__node[data-id="h1"] .happ-startbtn').first().click({ timeout: 5000 }).catch(() => {});
await P.waitForTimeout(700);
const h1 = await P.evaluate(() => ({ rahmen: [...document.querySelectorAll('iframe')].map((f) => f.getAttribute('src') ?? ''), xss: window.__xss ?? null }));
pruefe('B1 „Live"-Karte mit javascript:-Adresse: kein Rahmen damit, nichts ausgeführt, Hinweis statt Start', !h1.rahmen.some((s) => /^javascript:/i.test(s)) && h1.xss === null && /nicht einbetten/.test(await toast()), `${JSON.stringify(h1)} | ${await toast()}`);
await frei();
await P.locator('.react-flow__node[data-id="f1"] .file-body').click({ timeout: 5000 }).catch(() => {});
await P.waitForTimeout(600);
pruefe('B2 Datei-Karte mit javascript:-Adresse: der Klick „Herunterladen" führt nichts aus', (await P.evaluate(() => window.__xss ?? null)) === null);
await frei();
// geteiltes Board mit kaputten Karten und gefährlichen Adressen
const geteilt = { app: 'pixinotes-board', version: 2, board: { id: 'x9', name: 'Fremdes', gastLink: 'geheim-token', geteiltVonName: 'opfer@example.de', edges: [], nodes: [
  { id: 'g1', type: 'note', width: 240, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: t('Gute Karte') }] } },
  { id: 'g2', type: 'note', data: { color: 'yellow', blocks: [] } },
  { id: 'g3', type: 'htmlapp', width: 300, height: 200, position: { x: 300, y: 0 }, data: { name: 'T', size: 0, live: true, url: 'javascript:window.__xss=2' } },
  { id: 'g4', type: 'file', width: 260, position: { x: 0, y: 300 }, data: { name: 'a.zip', size: 1, dataUrl: 'javascript:window.__xss=2' } },
  'unsinn',
] } };
const packed = gzipSync(Buffer.from(JSON.stringify(geteilt))).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
await P.goto(`http://localhost:${PORT}/#b=${packed}`, { waitUntil: 'networkidle' });
await P.reload({ waitUntil: 'networkidle' });   // der Anker allein lädt die Seite nicht neu
await warteBis(async () => (await zustand()).boards.some((b) => /Fremdes/.test(b.name)), 8000);
const fremd = (await zustand()).boards.find((b) => /Fremdes/.test(b.name));
pruefe('B3 das geteilte Board kommt an – ohne Absturz, ohne die Karte ohne Lage und ohne den Unsinn', !!fremd && fremd.nodes.length === 3 && fehler.length === 0 && dialoge >= 1, `${fremd?.nodes.length} ${fehler.join()}`);
pruefe('B4 … und ohne die javascript:-Adressen in Tool- und Datei-Karte', !!fremd && !JSON.stringify(fremd).includes('javascript:'), JSON.stringify(fremd ?? {}).slice(0, 300));
pruefe('B5 … und ohne Einladungs-Token und Besitzer-Adresse des Absenders', !!fremd && !fremd.gastLink && !fremd.geteiltVonName && !JSON.stringify(fremd).includes('geheim-token'));
await P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first().click();
await P.waitForTimeout(900);

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Bedienung im Browser ════');
await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
pruefe('C1 die leere Notiz holt sich beim Laden des Boards nicht den Cursor', await P.evaluate(() => !document.activeElement?.closest('.react-flow__node')), await P.evaluate(() => document.activeElement?.className ?? ''));
await P.keyboard.press('n'); await P.waitForTimeout(700);
pruefe('C2 eine mit N neu angelegte Notiz bekommt ihn', await P.evaluate(() => !!document.activeElement?.closest('.react-flow__node-note')));
await P.keyboard.press('Escape'); await frei();
await warteBis(async () => (await board()).nodes.length === 6);
// löschen → Strg+Z → Hinweis-Knopf
let g = await greif('n2'); await P.mouse.click(g[0], g[1]); await P.waitForTimeout(300);
await P.keyboard.press('Delete');
await warteBis(async () => /gelöscht/.test(await toast()));
await warteBis(async () => (await board()).nodes.length === 5);
pruefe('C3 Karte gelöscht: Sie und ihr Gespräch sind weg, der Hinweis bietet „Rückgängig"', (await board()).nodes.length === 5 && ((await board()).comments ?? []).length === 0 && (await P.locator('.toast.show .toast-undo').count()) === 1);
await P.keyboard.press('Control+z');
await warteBis(async () => (await board()).nodes.length === 6);
pruefe('C4 Strg+Z holt die Karte zurück – mit ihrem Gespräch', (await board()).nodes.length === 6 && ((await board()).comments ?? []).length === 1 && (await board()).comments[0].nodeId === 'n2', JSON.stringify((await board()).comments));
if (await P.locator('.toast.show .toast-undo').count()) { await P.locator('.toast.show .toast-undo').click(); await P.waitForTimeout(900); }
const ids = (await board()).nodes.map((n) => n.id);
pruefe('C5 der Hinweis-Knopf danach legt nichts doppelt an (jede Kennung einmal)', ids.length === 6 && new Set(ids).size === 6, ids.join());
await P.keyboard.press('Control+y'); await warteBis(async () => (await board()).nodes.length === 5);
pruefe('C6 Wiederholen löscht wieder – das Gespräch geht mit', (await board()).nodes.length === 5 && ((await board()).comments ?? []).length === 0);
await P.keyboard.press('Control+z'); await warteBis(async () => (await board()).nodes.length === 6);
// Tasten wirken nicht durch Fenster
await frei();
await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
await P.locator('.modal-tabs button').first().focus();
const vorN = (await board()).nodes.length;
await P.keyboard.press('n'); await P.keyboard.press('f'); await P.waitForTimeout(600);
pruefe('C7 mit offenen Einstellungen (Fokus auf einem Knopf) legt N keine Notiz dahinter an', (await board()).nodes.length === vorN && (await P.locator('.modal-tabs').count()) === 1);
await P.keyboard.press('Control+z'); await P.waitForTimeout(500);
pruefe('C8 … und Strg+Z nimmt dahinter nichts zurück', (await board()).nodes.length === vorN);
await P.keyboard.press('Escape'); await P.waitForTimeout(400);
await frei();
await P.locator('.dock button[aria-label="Mehr"]').focus();
await P.keyboard.press('Space'); await P.waitForTimeout(500);
pruefe('C9 die Leertaste löst einen Knopf mit Tastatur-Fokus aus (Dock „Mehr" öffnet sich)', (await P.locator('.dock-menu').count()) >= 1);
await P.keyboard.press('Escape');
pruefe('C10 keine Fehler der Seite', fehler.length === 0, fehler.join(' | '));

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Texte ════');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('D1 Hilfe nennt M388 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M388)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M388)'));
pruefe('D2 docs/AUDIT.md führt die Funde; docs/UMBAU.md nennt M388', existsSync(path.join(__repo, 'docs', 'AUDIT.md')) && quelle('docs/AUDIT.md').includes('S1') && quelle('docs/UMBAU.md').includes('M388'));
pruefe('D3 der Build prüft ungenutzte Deklarationen (tsconfig)', /"noUnusedLocals": true/.test(quelle('tsconfig.json')) && /"noUnusedParameters": true/.test(quelle('tsconfig.json')));

await browser.close(); app.close();
console.log(`\nm388-code-audit: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
