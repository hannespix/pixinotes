/**
 * M390 — Logik-Audit: was beim Durchspielen der Abläufe gefunden wurde, bleibt behoben.
 *
 *   A  Rechnen und Lesen (ohne Browser): Zahlen in der Tabelle, Fristen mit Anker, Links beim Umbenennen,
 *      Markdown-Export, Text-Import, Archiv-Frist der Tickets.
 *   B  Fristen an der Notiz: „bis morgen" meint den Tag nach dem SCHREIBEN — nicht jeden Tag neu.
 *   C  Boards: Umbenennen nimmt die [[Links]] mit; archivierte Boards zählen nicht als Arbeitsfläche.
 *   D  Tasten und Schritte: nichts wirkt hinter einem offenen Fenster; Pfeiltasten und Duplizieren sind EIN
 *      Schritt; „Rückgängig" in der Meldung nimmt genau diese Handlung zurück.
 *   E  Planung: Erledigt-Spalte bleibt, Protokoll-Punkte lassen sich in der Aufgaben-Zentrale abhaken,
 *      Zeiterfassung über Mitternacht, „heute" im Zeitplan nach der Uhr des Geräts.
 *   F  Sicherung: Vorlagen und Anhänge reisen mit — hin und zurück.
 *   G  Finger: ein Ticket ziehen schwenkt das Board nicht. Anzeige 150 %: Fenster passen ins Bild.
 *   H  WebDAV: Zwei Geräte schreiben gleichzeitig — keines überschreibt das andere.
 */
// Läuft aus dem Repository: `node pruefungen/m390-logik-audit.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4703; const DAV = 4723;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const t = (s) => [{ type: 'text', text: s, styles: {} }];
const para = (id, text) => ({ id, type: 'paragraph', props: {}, content: t(text), children: [] });
const check = (id, text, checked = false) => ({ id, type: 'checkListItem', props: { checked }, content: t(text), children: [] });
const note = (id, blocks, x, y, extra = {}) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks, ...extra } });
const brett = (id, name, nodes, edges = [], extra = {}) => ({ id, name, nodes, edges, drawings: [], comments: [], ...extra });
const standMit = (boards, extra = {}) => ({ boards, spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: boards.map((b) => b.id) }] }], activeId: boards[0].id, view: 'board', ...extra });

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Rechnen und Lesen ════');
{
  const lib = (n) => JSON.stringify(path.join(__repo, 'src', 'lib', n));
  const einstieg = path.join(SD, 'm390-einstieg.ts');
  writeFileSync(einstieg, [
    `export { rechneBlatt } from ${lib('formel')};`, `export { detectDates, hatRelativesDatum, fristenLaden } from ${lib('dates')};`,
    `export { fristAnkerPflegen, fristenDerNotiz } from ${lib('fristAnker')};`, `export { linksUmbenennen } from ${lib('links')};`,
    `export { blocksToMarkdown } from ${lib('serialize')};`, `export { textZuBloecken } from ${lib('textNotiz')};`,
    `export { holeZurueck, autoArchivLauf } from ${lib('ticketArchiv')};`, `export { frameMembers } from ${lib('arrange')};`,
  ].join('\n'));
  const aus = path.join(SD, 'm390-bündel.mjs');
  await build({ entryPoints: [einstieg], bundle: true, format: 'esm', platform: 'node', outfile: aus, logLevel: 'silent' });
  globalThis.window = { location: { href: 'https://app.example/pixinotes/', origin: 'https://app.example', pathname: '/pixinotes/' }, addEventListener() {}, dispatchEvent() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // Zwei der Bibliotheken ziehen den Store nach — der braucht beim Laden ein (leeres) Dokument
  globalThis.document = { addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} }, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } }, hidden: false, visibilityState: 'visible' };
  globalThis.navigator ??= { userAgent: 'node', language: 'de-DE' };
  const m = await import(pathToFileURL(aus).href);
  await m.fristenLaden();   // M459: die Fristen-Erkennung lädt bei Bedarf (in der App beim ersten Text mit Datum)

  const f = m.rechneBlatt({ A1: '0721 9260', A2: '01067', A3: '1 250', A4: '3.000', A5: '1.5', A6: '12 345 6', B1: '=A3+A4', B2: '=A5*2', B3: '=SUMME(A1:A2)', B4: '=ANZAHL(A1:A6)' });
  pruefe('A1 „1 250" und „3.000" sind Zahlen (Tausender), „1.5" bleibt eine Dezimalzahl', f.B1 === 4250 && f.B2 === 3, [f.B1, f.B2]);
  pruefe('A2 Telefonnummer, Postleitzahl und Kennung rechnen nicht mit (0721 9260 · 01067 · 12 345 6)', f.B3 === 0 && f.B4 === 3, [f.B3, f.B4]);

  const mo = new Date(2026, 10, 16, 10); const fr = new Date(2026, 10, 20, 10);
  const frei = m.detectDates('Bericht bis morgen', fr);
  const fest = m.detectDates('Bericht bis morgen', fr, new Date(2026, 10, 16, 0, 0, 1));
  pruefe('A3 „bis morgen" mit Anker (Montag geschrieben) ist am Freitag der Dienstag – und überfällig', frei[0]?.date.getDate() === 21 && fest[0]?.date.getDate() === 17 && fest[0]?.urgency === 'overdue', [frei[0], fest[0]]);
  pruefe('A4 relativ sind „morgen", „Freitag", „nächste Woche" – ein festes Datum nicht', m.hatRelativesDatum('bis morgen') && m.hatRelativesDatum('am Freitag fertig') && m.hatRelativesDatum('nächste Woche') && !m.hatRelativesDatum('am 20.11.2026') && !m.hatRelativesDatum('kein Termin'));
  const bl = [para('p1', 'Bericht bis morgen'), para('p2', 'fest am 20.11.2026'), para('p3', 'ohne alles')];
  const a1 = m.fristAnkerPflegen(bl, undefined, '2026-11-16');
  const a2 = m.fristAnkerPflegen(bl, a1, '2026-11-20');
  const a3 = m.fristAnkerPflegen([para('p1', 'Bericht bis übermorgen'), bl[1], bl[2]], a1, '2026-11-20');
  pruefe('A5 der Anker entsteht nur für relative Angaben und bleibt, solange der Text derselbe ist', JSON.stringify(a1) === '{"p1":["2026-11-16","Bericht bis morgen"]}' && a2 === a1, [a1, a2]);
  pruefe('A6 ändert sich der Text, gilt der Tag der Änderung', a3?.p1?.[0] === '2026-11-20', a3);
  const fn = m.fristenDerNotiz([para('p1', 'Bericht bis morgen'), check('c1', 'Abgabe am 12.11.2026', true), { id: 'h', type: 'heading', props: { level: 1 }, content: t('Montag, 16. November 2026'), children: [] }, para('p4', 'Jacke abholen (offen seit 02.11.)')], a1, fr);
  pruefe('A7 Fristen der Notiz: abgehakte Punkte, reine Datums-Überschriften und „(offen seit …)" zählen nicht', fn.length === 1 && fn[0].date.getDate() === 17, fn.map((d) => [d.label, d.date.toISOString()]));
  pruefe('A8 … am Schreibtag selbst ist dieselbe Frist „morgen" (nicht überfällig)', m.fristenDerNotiz([bl[0]], a1, mo)[0]?.urgency === 'soon');

  const um = m.linksUmbenennen([para('p', 'Siehe [[ziele]] und [[Andere]]'), { id: 'x', type: 'bulletListItem', content: t('nichts'), children: [para('k', 'tief: [[Ziele]]')] }], 'Ziele', 'Jahresziele');
  pruefe('A9 Umbenennen schreibt [[Links]] um – ohne Rücksicht auf Groß/Klein, auch in Unterpunkten, andere bleiben', um?.[0].content[0].text === 'Siehe [[Jahresziele]] und [[Andere]]' && um?.[1].children[0].content[0].text === 'tief: [[Jahresziele]]' && m.linksUmbenennen([para('p', 'kein Link')], 'Ziele', 'X') === null, um);

  const md = m.blocksToMarkdown([para('p', '2 * 3 = 6 und a_b_c <b>fett</b>'), para('q', '# keine Überschrift'), para('r', '1. kein Listenpunkt'), para('s', '- kein Punkt')]);
  pruefe('A10 Markdown-Export: Zeichen mit Bedeutung sind entschärft (Stern, Unterstrich, <, Zeilenanfänge)', md.includes('2 \\* 3 = 6') && md.includes('a\\_b\\_c') && md.includes('\\<b>') && /^\\# keine/m.test(md) && /^1\\\. kein/m.test(md) && /^\\- kein/m.test(md), md);

  const tx = await m.textZuBloecken('vermerk.txt', '# Kein Titel\n* kein Punkt\nPlatzhalter <Name> und __doppelt__\n\n- [x] erledigt\n1. erstens');
  const zeilen = tx.map((b) => [b.type, typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text).join('')]);
  pruefe('A11 eine .txt-Datei ist Text, kein Markdown: Zeile für Zeile, nichts geht verloren; nur eindeutige Listen werden Listen', JSON.stringify(zeilen) === JSON.stringify([['heading', 'vermerk'], ['paragraph', '# Kein Titel'], ['paragraph', '* kein Punkt'], ['paragraph', 'Platzhalter <Name> und __doppelt__'], ['checkListItem', 'erledigt'], ['numberedListItem', 'erstens']]), zeilen);

  const alt = new Date(Date.now() - 30 * 864e5).toISOString();
  const zur = m.holeZurueck({ autoArchiv: true, items: [], archiv: [{ id: 'tk', text: 'alt', col: 2, erledigtAm: alt, archiviertAm: alt }] }, ['tk']);
  const lauf = m.autoArchivLauf({ autoArchiv: true, items: zur.items, archiv: zur.archiv });
  const spaeter = m.autoArchivLauf({ autoArchiv: true, items: zur.items, archiv: zur.archiv }, new Date(Date.now() + 8 * 864e5));
  pruefe('A12 ein zurückgeholtes Ticket behält sein Erledigt-Datum, wandert aber nicht sofort wieder ins Archiv – erst nach neuer Frist', zur.items[0].erledigtAm === alt && lauf === null && spaeter?.archiviert === 1, [zur.items[0], lauf, spaeter?.archiviert]);

  const rahmen = { id: 'f', type: 'frame', width: 400, height: 300, position: { x: 0, y: 0 }, data: {} };
  const drin = { id: 'n', type: 'note', width: 100, height: 60, position: { x: 50, y: 50 }, data: {} };
  const archiviert = { id: 'z', type: 'note', width: 100, height: 60, position: { x: 200, y: 50 }, data: {}, archived: true };
  pruefe('A13 ein Rahmen nimmt beim Verschieben auch seine archivierten Karten mit (sonst lägen sie später daneben)', m.frameMembers(rahmen, [rahmen, drin, archiviert]).length === 1 && m.frameMembers(rahmen, [rahmen, drin, archiviert], false, true).length === 2);
}

// ══ Browser ═════════════════════════════════════════════════════════
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
/** Neues Profil mit vorgegebenem Stand; opt.zeit = feste Uhr, opt.ls = weitere Einträge im Speicher */
const profil = async (st, opt = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: opt.tz ?? 'Europe/Berlin', acceptDownloads: true, ...(opt.ctx ?? {}) });
  await ctx.addInitScript(({ st, ls }) => {
    if (localStorage.getItem('pixinotes-board') || sessionStorage.getItem('x-init')) return;
    sessionStorage.setItem('x-init', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    if (st) localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, ls: opt.ls ?? {} });
  const P = await ctx.newPage();
  if (opt.zeit) await P.clock.setFixedTime(new Date(opt.zeit));
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 300)); });
  const dialoge = [];
  P.on('dialog', (d) => { dialoge.push(d.message()); void d.accept(); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  const zustand = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? 'null')?.state ?? null);
  const board = async (id) => { const s = await zustand(); return s.boards.find((b) => b.id === (id ?? s.activeId)); };
  const bis = async (fn, ms = 6000) => { const e = Date.now() + ms; let v; while (Date.now() < e) { v = await fn(); if (v) return v; await P.waitForTimeout(200); } return fn(); };
  const toast = () => P.evaluate(() => document.querySelector('.toast.show')?.textContent ?? '');
  const knoten = (id) => P.locator(`.react-flow__node[data-id="${id}"]`);
  const frei = async () => { await P.keyboard.press('Escape'); await P.mouse.click(1470, 500); await P.waitForTimeout(300); };
  return { ctx, P, dialoge, zustand, board, bis, toast, knoten, frei };
};

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Fristen an der Notiz ════');
{
  const st = standMit([brett('b1', 'Planung', [
    note('n1', [para('p1', 'Bericht bis morgen')], 60, 80, { fristAnker: { p1: ['2026-11-10', 'Bericht bis morgen'] } }),
    note('n2', [check('c1', 'Abgabe am 12.11.2026', true)], 340, 80),
    note('n3', [para('p3', 'Entwurf bis morgen')], 620, 80),
  ])]);
  const h = await profil(st, { zeit: '2026-11-16T10:00:00+01:00' });
  const chip = (id) => h.P.evaluate((i) => [...document.querySelectorAll(`.react-flow__node[data-id="${i}"] .due-chip`)].map((e) => `${e.className} ${e.textContent}`), id);
  const c1 = await chip('n1');
  pruefe('B1 „bis morgen", vor sechs Tagen geschrieben: Die Notiz zeigt den 11.11. als überfällig (nicht „morgen")', c1.length === 1 && /due-overdue/.test(c1[0]) && /11\.11\./.test(c1[0]), c1);
  pruefe('B2 ein abgehakter Punkt trägt keine Frist mehr', (await chip('n2')).length === 0, await chip('n2'));
  // Eine Notiz ohne Anker (Altbestand): Der Anker wird nachgetragen — mit dem heutigen Tag
  const a3 = await h.bis(async () => (await h.board()).nodes.find((n) => n.id === 'n3').data.fristAnker);
  pruefe('B3 Altbestand ohne Anker: Der heutige Tag wird beim Start nachgetragen', a3?.p3?.[0] === '2026-11-16', a3);
  // Neuen Text schreiben → Anker von heute
  await h.P.mouse.click(1000, 600); await h.P.keyboard.press('n'); await h.P.waitForTimeout(600);
  await h.P.keyboard.type('Angebot bis Freitag'); await h.P.waitForTimeout(400); await h.frei();
  const neu = await h.bis(async () => (await h.board()).nodes.find((n) => JSON.stringify(n.data.blocks ?? '').includes('Angebot bis Freitag') && n.data.fristAnker));
  pruefe('B4 neu geschrieben: Die Notiz merkt sich den Schreibtag zur relativen Angabe', !!neu && Object.values(neu.data.fristAnker)[0][0] === '2026-11-16', neu?.data);
  // Vier Tage später: dieselbe Notiz zeigt weiter Freitag, den 20.11.
  await h.P.clock.setFixedTime(new Date('2026-11-23T10:00:00+01:00'));
  await h.P.reload({ waitUntil: 'networkidle' }); await h.P.waitForTimeout(1500);
  const cNeu = await chip(neu?.id);
  pruefe('B5 eine Woche später steht dort weiter der 20.11. – überfällig, nicht der nächste Freitag', cNeu.length === 1 && /20\.11\./.test(cNeu[0]) && /due-overdue/.test(cNeu[0]), cNeu);
  await h.ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Boards ════');
{
  const st = standMit([
    brett('b1', 'Planung', [note('n1', [para('p1', 'Siehe [[Ziele]] für das Jahr')], 60, 80)]),
    brett('b2', 'Ziele', [note('z1', [para('pz', 'Ziel eins')], 60, 80)]),
    brett('b3', 'Altlast', [note('x1', [para('px', 'alt')], 60, 80)], [], { archived: true }),
  ]);
  const h = await profil(st);
  const zeile = (name) => h.P.locator('.side-board', { hasText: name }).first();
  await zeile('Ziele').locator('.ebenen-menu-knopf').click({ force: true }); await h.P.waitForTimeout(300);
  await h.P.locator('.ebenen-menu button', { hasText: 'Umbenennen' }).first().click(); await h.P.waitForTimeout(400);
  const feld = h.P.locator('.side-board-name input, input.side-board-name').first();
  await feld.fill('Jahresziele'); await feld.press('Enter'); await h.P.waitForTimeout(900);
  const txt = JSON.stringify((await h.board('b1')).nodes[0].data.blocks);
  pruefe('C1 Board umbenannt: Der [[Link]] in der Notiz heißt mit – er zeigt weiter auf das Board', txt.includes('[[Jahresziele]]') && !txt.includes('[[Ziele]]'), txt);
  // Löschen von „Jahresziele" (b1 bleibt als einziges sichtbares) — erlaubt; danach b1 löschen — verboten
  await zeile('Jahresziele').locator('.ebenen-menu-knopf').click({ force: true }); await h.P.waitForTimeout(300);
  await h.P.locator('.ebenen-menu button', { hasText: 'Löschen' }).first().click(); await h.P.waitForTimeout(900);
  let s = await h.zustand();
  pruefe('C2 ein Board gelöscht: Die Ansicht bleibt auf einem sichtbaren Board (nicht auf dem archivierten)', !s.boards.some((b) => b.id === 'b2') && s.activeId === 'b1', [s.boards.map((b) => b.id), s.activeId]);
  await zeile('Planung').locator('.ebenen-menu-knopf').click({ force: true }); await h.P.waitForTimeout(300);
  const loeschen = h.P.locator('.ebenen-menu button', { hasText: 'Löschen' }).first();
  if (await loeschen.count()) { await loeschen.click(); await h.P.waitForTimeout(900); }
  s = await h.zustand();
  pruefe('C3 das letzte SICHTBARE Board bleibt – auch wenn im Archiv noch eines liegt', s.boards.some((b) => b.id === 'b1') && s.activeId === 'b1', [s.boards.map((b) => b.id), await h.toast()]);
  await h.ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Tasten und Schritte ════');
{
  const st = standMit([brett('b1', 'Paar', [note('a1', [para('pa', 'Anfang')], 200, 200), note('a2', [para('pb', 'Ende')], 600, 200)], [{ id: 'e1', source: 'a1', target: 'a2' }])]);
  const h = await profil(st);
  const lage = async () => { const b = await h.board(); return { n: b.nodes.length, e: b.edges.length, x: b.nodes.find((n) => n.id === 'a1')?.position.x }; };
  await h.knoten('a1').click({ position: { x: 8, y: 8 } }); await h.P.waitForTimeout(300);
  await h.P.keyboard.press('Alt+e'); await h.P.waitForSelector('.modal-tabs');
  await h.P.keyboard.press('Delete'); await h.P.keyboard.press('Backspace'); await h.P.waitForTimeout(500);
  pruefe('D1 Entf bei offenen Einstellungen löscht die Karte dahinter nicht', (await lage()).n === 2 && await h.P.locator('.modal-tabs').count() === 1, await lage());
  await h.P.keyboard.press('Escape'); await h.P.waitForTimeout(400);
  // Pfeiltasten: drei Schritte, EIN Rückgängig
  await h.knoten('a1').click({ position: { x: 8, y: 8 } }); await h.P.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await h.P.keyboard.press('ArrowRight'); await h.P.waitForTimeout(80); }
  await h.P.waitForTimeout(900);
  const x1 = (await lage()).x;
  await h.P.keyboard.press('Control+z'); await h.P.waitForTimeout(900);
  pruefe('D2 drei Pfeiltasten-Schritte hintereinander sind EIN Rückgängig-Schritt', x1 > 200 && (await lage()).x === 200, [x1, (await lage()).x]);
  // Duplizieren zweier verbundener Karten: Pfeil kommt mit, EIN Schritt
  await h.P.keyboard.press('Control+a'); await h.P.waitForTimeout(300);
  await h.P.keyboard.press('Control+d'); await h.P.waitForTimeout(900);
  const d1 = await lage();
  await h.P.keyboard.press('Control+z'); await h.P.waitForTimeout(900);
  const d2 = await lage();
  pruefe('D3 Duplizieren zweier verbundener Karten nimmt den Pfeil mit – und ist EIN Schritt', d1.n === 4 && d1.e === 2 && d2.n === 2 && d2.e === 1, [d1, d2]);
  // Löschen → „Rückgängig" in der Meldung holt Karte UND Pfeil
  await h.frei(); await h.knoten('a2').click({ position: { x: 8, y: 8 } }); await h.P.waitForTimeout(200);
  await h.P.keyboard.press('Delete'); await h.P.waitForTimeout(600);
  const weg = await lage();
  await h.P.locator('.toast.show .toast-undo').click(); await h.P.waitForTimeout(900);
  pruefe('D4 „Rückgängig" in der Meldung holt die gelöschte Karte samt Pfeil zurück', weg.n === 1 && weg.e === 0 && (await lage()).n === 2 && (await lage()).e === 1, [weg, await lage()]);
  // Zwei Notizen färben: EIN Schritt
  await h.frei(); await h.P.keyboard.press('Control+a'); await h.P.waitForTimeout(400);
  await h.P.locator('button[aria-label="Mehr"]').first().click(); await h.P.waitForTimeout(400);
  await h.P.locator('.sel-farbe').nth(2).click(); await h.P.waitForTimeout(700);
  const farben = async () => (await h.board()).nodes.map((n) => n.data.color).join();
  const f1 = await farben();
  await h.frei(); await h.P.keyboard.press('Control+z'); await h.P.waitForTimeout(900);
  pruefe('D5 zwei Karten auf einmal gefärbt – EIN Rückgängig stellt beide zurück', f1 !== 'yellow,yellow' && new Set(f1.split(',')).size === 1 && (await farben()) === 'yellow,yellow', [f1, await farben()]);
  await h.ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Planung ════');
{
  const st = standMit([brett('b1', 'Planung', [
    { id: 'k1', type: 'kanban', width: 620, position: { x: 40, y: 40 }, data: { title: 'Projekt', cols: ['Offen', 'In Arbeit', 'Fertig'], items: [{ id: 'T1', text: 'Ticket in Arbeit', col: 1 }, { id: 'T2', text: 'Ticket offen', col: 0 }] } },
    { id: 'm1', type: 'minutes', width: 420, height: 420, position: { x: 700, y: 40 }, data: { title: 'Jour fixe', color: 'white', agenda: [], rhythm: 'woche', carryOpen: true, entries: [{ id: 'e1', date: '2026-11-16', blocks: [check('mc1', 'Protokollpunkt erledigen')] }] } },
    { id: 't1', type: 'time', width: 520, height: 400, position: { x: 40, y: 480 }, data: { title: 'Zeiterfassung', segs: [{ id: 's1', date: '2026-11-15', start: 1380, kind: 'arbeit' }] } },
  ])]);
  const h = await profil(st, { zeit: '2026-11-16T10:00:00+01:00' });
  await h.knoten('k1').locator('.kanban-col-x[title^="Spalte löschen"]').nth(2).click({ force: true }); await h.P.waitForTimeout(500);
  const k = (await h.board()).nodes.find((n) => n.id === 'k1').data;
  pruefe('E1 die Erledigt-Spalte lässt sich nicht löschen, solange davor Tickets liegen (sie gälten sonst als erledigt)', k.cols.length === 3 && k.items.find((i) => i.id === 'T1').col === 1 && /erledigt/.test(await h.toast()), [k.cols, await h.toast()]);
  // Zeiterfassung: läuft seit gestern 23:00, jetzt 10:00 → Stopp teilt um Mitternacht
  await h.knoten('t1').locator('.time-stop').click(); await h.P.waitForTimeout(700);
  const segs = (await h.board()).nodes.find((n) => n.id === 't1').data.segs.map((s) => [s.date, s.start, s.end]);
  pruefe('E2 Zeiterfassung über Mitternacht: gestern 23:00–24:00 und heute 0:00–10:00 (nicht 23:00–10:00 = minus 13 Stunden)', JSON.stringify(segs.sort()) === JSON.stringify([['2026-11-15', 1380, 1440], ['2026-11-16', 0, 600]]), segs);
  // Aufgaben-Zentrale: Protokollpunkt abhaken
  await h.frei(); await h.P.locator('[data-taste="aufgaben"]').click(); await h.P.waitForTimeout(900);
  const zeile = h.P.locator('.task-row', { hasText: 'Protokollpunkt erledigen' }).first();
  pruefe('E3 der offene Punkt aus dem Protokoll steht in der Aufgaben-Zentrale', await zeile.count() === 1);
  await zeile.locator('input[type="checkbox"]').first().click({ force: true }); await h.P.waitForTimeout(900);
  const e = (await h.board()).nodes.find((n) => n.id === 'm1').data.entries[0].blocks[0];
  pruefe('E4 dort abgehakt = im Protokoll abgehakt', e.props.checked === true, e);
  await h.ctx.close();
}
{
  // „Heute" im Zeitplan nach der Uhr des Geräts: Auckland ist am 16.11. 22:00 UTC schon im 17.11.
  const st = standMit([brett('b1', 'Plan', [{ id: 'g1', type: 'gantt', width: 900, height: 320, position: { x: 40, y: 40 }, data: { title: 'Zeitplan', dayWidth: 24, rows: [{ id: 'r1', name: 'Phase 1', start: '2026-11-10', end: '2026-11-25', color: '#4f7cff' }] } }])]);
  const h = await profil(st, { zeit: '2026-11-16T22:00:00Z', tz: 'Pacific/Auckland' });
  await h.knoten('g1').locator('.gantt-addzeile').click({ force: true }); await h.P.waitForTimeout(700);
  const rows = (await h.board()).nodes.find((n) => n.id === 'g1').data.rows;
  pruefe('E5 Zeitplan: „heute" ist der Tag am Gerät (Auckland, 17.11.) – nicht der in Greenwich', rows.length === 2 && rows[1].start === '2026-11-17', rows.map((r) => r.start));
  await h.ctx.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Sicherung ════');
{
  const vorlage = { id: 'v1', name: 'Besprechung', node: note('vn', [para('vp', 'Vorlagen-Text')], 0, 0) };
  const st = standMit([brett('b1', 'Planung', [note('n1', [para('p1', 'Inhalt eins')], 60, 80)])], { templates: [vorlage] });
  const h = await profil(st);
  await h.P.keyboard.press('Alt+e'); await h.P.waitForSelector('.modal-tabs');
  await h.P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await h.P.waitForTimeout(300);
  const [dl] = await Promise.all([h.P.waitForEvent('download'), h.P.locator('.modal button', { hasText: 'Datei exportieren' }).click()]);
  const pfad = path.join(SD, 'm390-sicherung.json'); await dl.saveAs(pfad);
  const datei = JSON.parse(readFileSync(pfad, 'utf8'));
  pruefe('F1 die Sicherung enthält die eigenen Vorlagen', JSON.stringify(datei).includes('Vorlagen-Text') && JSON.stringify(datei).includes('Besprechung'), Object.keys(datei));
  await h.ctx.close();
  // Auf einem frischen Gerät laden
  const h2 = await profil(standMit([brett('bx', 'Leer', [])]));
  await h2.P.keyboard.press('Alt+e'); await h2.P.waitForSelector('.modal-tabs');
  await h2.P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await h2.P.waitForTimeout(300);
  await h2.P.locator('.modal input[type="file"][accept*="json"]').first().setInputFiles(pfad); await h2.P.waitForTimeout(1800);
  const s2 = await h2.bis(async () => { const s = await h2.zustand(); return s.boards.some((b) => b.name === 'Planung') ? s : null; });
  pruefe('F2 zurückgeladen: Board UND Vorlage sind wieder da', !!s2 && s2.templates?.length === 1 && s2.templates[0].name === 'Besprechung', [s2?.boards.map((b) => b.name), s2?.templates, h2.dialoge]);
  pruefe('F3 vor dem Ersetzen fragt GENAU eine Rückfrage', h2.dialoge.length === 1, h2.dialoge);
  await h2.ctx.close();
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Finger und Anzeige ════');
{
  const st = standMit([brett('b1', 'Planung', [{ id: 'k1', type: 'kanban', width: 620, position: { x: 60, y: 60 }, data: { title: 'Projekt', items: [{ id: 'T1', text: 'Ticket ziehen', col: 0 }] } }])]);
  const h = await profil(st, { ctx: { viewport: { width: 1180, height: 820 }, hasTouch: true } });
  const cdp = await h.ctx.newCDPSession(h.P);
  const sicht = () => h.P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  const von = await h.P.evaluate(() => { const r = document.querySelector('.kanban-item-text').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const ziel = await h.P.evaluate(() => { const c = document.querySelectorAll('.kanban-col')[1].getBoundingClientRect(); return [c.left + c.width / 2, c.top + 90]; });
  const v0 = await sicht();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: von[0], y: von[1], id: 1 }] });
  await h.P.waitForTimeout(600);
  for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: von[0] + (ziel[0] - von[0]) * i / 12, y: von[1] + (ziel[1] - von[1]) * i / 12, id: 1 }] }); await h.P.waitForTimeout(30); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await h.P.waitForTimeout(900);
  const col = (await h.board()).nodes[0].data.items[0].col;
  pruefe('G1 Finger: Ein Ticket halten und ziehen legt es in die nächste Spalte – das Board schwenkt nicht mit', col === 1 && (await sicht()) === v0, [col, v0, await sicht()]);
  await h.ctx.close();
}
{
  const h = await profil(standMit([brett('b1', 'Planung', [note('n1', [para('p1', 'Text')], 60, 80)])]), { ctx: { viewport: { width: 1280, height: 720 } } });
  await h.P.keyboard.press('Alt+e'); await h.P.waitForSelector('.modal-tabs');
  await h.P.locator('.modal .seg button', { hasText: '150' }).click(); await h.P.waitForTimeout(500);
  await h.P.keyboard.press('Escape'); await h.P.waitForTimeout(300);
  await h.P.keyboard.press('Alt+e'); await h.P.waitForSelector('.modal-tabs'); await h.P.waitForTimeout(400);
  const m = await h.P.evaluate(() => { const r = document.querySelector('.modal').getBoundingClientRect(); return { zoom: document.documentElement.style.zoom, oben: Math.round(r.top), unten: Math.round(r.bottom), hoch: window.innerHeight }; });
  pruefe('G2 Anzeige 150 % auf 1280×720: Das Einstellungs-Fenster passt ganz ins Bild', Number(m.zoom) === 1.5 && m.oben >= 0 && m.unten <= 720 + 1, m);
  await h.P.keyboard.press('Escape'); await h.P.keyboard.press('Alt+h'); await h.P.waitForTimeout(600);
  const hi = await h.P.evaluate(() => { const r = document.querySelector('.help-modal')?.getBoundingClientRect(); return r ? { oben: Math.round(r.top), unten: Math.round(r.bottom) } : null; });
  pruefe('G3 … und die Hilfe ebenso', !!hi && hi.oben >= 0 && hi.unten <= 720 + 1, hi);
  await h.ctx.close();
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: WebDAV – zwei Geräte gleichzeitig ════');
{
  const dav = { body: null, n: 0, etag: null, mitIfMatch: true, log: [], nachLesen: null };
  const srv = http.createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': q.headers.origin ?? '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': dav.mitIfMatch ? 'Authorization, Content-Type, If-Match' : 'Authorization, Content-Type', 'Access-Control-Expose-Headers': 'ETag' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); r.end(); return; }
    if (q.method === 'GET') {
      if (!dav.body) { r.writeHead(404, cors); r.end(); return; }
      r.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: dav.etag }); r.end(dav.body);
      if (dav.nachLesen) { const f = dav.nachLesen; dav.nachLesen = null; f(); }
      return;
    }
    if (q.method === 'PUT') {
      let txt = ''; q.on('data', (c) => { txt += c; }); q.on('end', () => {
        const wenn = q.headers['if-match'];
        if (wenn && wenn !== dav.etag) { dav.log.push('PUT 412'); r.writeHead(412, cors); r.end(); return; }
        dav.body = txt; dav.etag = `"v${++dav.n}"`; dav.log.push(`PUT 204 ${wenn ? 'bedingt' : 'frei'}`);
        r.writeHead(204, { ...cors, ETag: dav.etag }); r.end();
      }); return;
    }
    r.writeHead(405, cors); r.end();
  });
  await new Promise((x) => srv.listen(DAV, x));
  const dnote = (id, text, x, y) => note(id, [para(`${id}-b`, text)], x, y);
  const starte = () => profil(standMit([brett('b1', 'Planung', [dnote('n1', 'Erste Notiz', 60, 80)])]), { ctx: { viewport: { width: 1440, height: 900 } }, ls: { 'pixinotes-webdav': JSON.stringify({ url: `http://localhost:${DAV}/ordner`, user: 'u', secret: 'p', auto: true }) } });
  const warte = async (fn, ms = 20000) => { const e = Date.now() + ms; while (Date.now() < e) { if (await fn()) return true; await new Promise((x) => setTimeout(x, 200)); } return fn(); };
  const neueNotiz = async (P, text) => { await P.mouse.click(1000, 600); await P.keyboard.press('n'); await P.waitForTimeout(500); await P.keyboard.type(text); await P.keyboard.press('Escape'); await P.mouse.click(1300, 760); };
  const fremd = (text) => () => { const p = JSON.parse(dav.body); p.boards[0].nodes.push(dnote(`f${dav.n}`, text, 700, 400)); p.savedAt = new Date(Date.now() + 1000).toISOString(); dav.body = JSON.stringify(p); dav.etag = `"v${++dav.n}"`; };
  {
    const h = await starte();
    await neueNotiz(h.P, 'Zweite Notiz');
    pruefe('H1 erster Upload (die Datei fehlte): geschrieben', await warte(() => !!dav.body && /Zweite Notiz/.test(dav.body)), dav.log.join(' | '));
    dav.log.length = 0;
    dav.nachLesen = fremd('Vom zweiten Gerät');
    await neueNotiz(h.P, 'Dritte Notiz');
    await warte(() => /Dritte Notiz/.test(dav.body) && /Vom zweiten Gerät/.test(dav.body), 25000);
    pruefe('H2 schreibt ein zweites Gerät zwischen Lesen und Schreiben, wird der überholte Stand abgelehnt (412) – einmal', dav.log.filter((l) => l === 'PUT 412').length === 1, dav.log.join(' | '));
    pruefe('H3 danach liegt auf dem Server BEIDES: die Karte des zweiten Geräts und die eigene neue', /Dritte Notiz/.test(dav.body) && /Vom zweiten Gerät/.test(dav.body) && /Zweite Notiz/.test(dav.body));
    pruefe('H4 … und die fremde Karte ist auch im eigenen Board angekommen', await warte(async () => /Vom zweiten Gerät/.test(await h.P.evaluate(() => localStorage.getItem('pixinotes-board')))));
    pruefe('H5 das erfolgreiche Schreiben trug die Bedingung (If-Match)', dav.log.some((l) => l === 'PUT 204 bedingt'), dav.log.join(' | '));
    await h.ctx.close();
  }
  {
    // Ein Server, dessen CORS-Regel If-Match nicht erlaubt: weiter schreiben wie früher, statt gar nicht
    dav.mitIfMatch = false; dav.body = null; dav.etag = null; dav.log.length = 0;
    const h = await starte();
    await neueNotiz(h.P, 'Notiz A'); await warte(() => !!dav.body && /Notiz A/.test(dav.body));
    await neueNotiz(h.P, 'Notiz B');
    pruefe('H6 erlaubt der Server If-Match nicht (CORS), schreibt PixiNotes ohne Bedingung weiter', await warte(() => /Notiz B/.test(dav.body ?? '')), dav.log.join(' | '));
    pruefe('H7 … und merkt sich das, statt bei jedem Speichern erneut zu scheitern', (await h.P.evaluate(() => localStorage.getItem('pixinotes-webdav-ohne-bedingung'))) !== null);
    await h.ctx.close();
  }
  srv.close();
}

// ══ Texte ═══════════════════════════════════════════════════════════
console.log('\n════ Texte ════');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf8');
  pruefe('T1 die Hilfe nennt M390 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M390)') && lies('src/components/HelpOverlayEn.tsx').includes('(M390)'));
  pruefe('T2 die Audit-Liste führt die Logik-Funde mit Stand', /## 3 · Logik-Audit/.test(lies('docs/AUDIT.md')) && !/\| L\d+ \|[^\n]*⏳/.test(lies('docs/AUDIT.md')));
  pruefe('T3 keine Fehler in der Konsole', fehler.length === 0, fehler.slice(0, 3));
}

await browser.close(); app.close();
console.log(`\nm390-logik-audit: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
