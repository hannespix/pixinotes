/**
 * M534 — Oberfläche, offene Punkte aus dem Audit M523.
 *
 *   A  Suche (Strg+K) umlaut- und tippfehlertolerant: „ubersicht", „vertraege", „strasse" finden „Übersicht",
 *      „Verträge", „Straße" (Karten, Boards, Befehle); die Fundstelle ist im Original markiert; archivierte Boards
 *      werden gefunden und tragen die Marke „archiviert".
 *   B  Zurück-Taste des Browsers führt durch die App: Board-Wechsel, Einstellungen, Übersicht, Karte im Fokus;
 *      Esc/✕ hinterlassen keinen toten Eintrag; Blättern im Fokus flutet den Verlauf nicht; die Adresse bleibt.
 *   C  Esc-Stapel: Vorlagen, Versionen, Sicherung, App installieren und Eingang mit der Hilfe darüber — Esc schließt
 *      zuerst die Hilfe, dann den Dialog.
 *   D  Nachladen scheitert (Netz weg): ein Hinweis an der Stelle statt „lässt sich nicht anzeigen"; „Nochmal versuchen"
 *      lädt wirklich (Einstellungen; Kanban-Karte auf dem Board).
 *   E  Service Worker räumt auf: Fassung 0 (alter Service Worker ohne Liste) → 1 → 2 → 3 über „Update + Neuladen";
 *      jede Fassung erscheint ohne Hängenbleiben, fremde und zwei Fassungen alte Dateien verschwinden aus dem Cache,
 *      die der Fassung davor bleiben; danach startet die App ohne Netz.
 *   F  Portable Datei (file://): Board wechseln und zurück, ohne Fehler (braucht release/pixinotes.html aus diesem
 *      Stand: `npm run build:single`, oder PN_SINGLE=<Datei>).
 *   G  „Als App installieren" unter Firefox/Windows nennt „Zur Taskleiste hinzufügen".
 *   Z  Keine Fehler in der Konsole.
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m534` (braucht `npm run build`)
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SINGLE = process.env.PN_SINGLE ?? path.join(__repo, 'release', 'pixinotes.html');
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const PORT = 5534;
const BASIS = `http://localhost:${PORT}/pixinotes/`;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml' };

// ── Server wie GitHub Pages (App unter /pixinotes/, Unbekanntes = 404). Für E: „Fassungen" ─────────────────────
// Fassung n ≥ 1: das Stylesheet der Seite heißt index-…-v<n>.css (Inhalt gleich), sw.js führt diesen Namen in der
// Liste. Fassung 0: sw.js ohne Liste (wie vor M534). So entstehen drei Veröffentlichungen ohne drei Builds.
let fassung = null;
const CSS = readdirSync(join(DIST, 'assets')).find((f) => /^index-.*\.css$/.test(f));
const cssName = (n) => (n >= 1 ? CSS.replace(/\.css$/, `-v${n}.css`) : CSS);
const app = http.createServer((q, r) => {
  const pfad = decodeURIComponent(q.url.split('?')[0]);
  if (!pfad.startsWith('/pixinotes/')) { r.writeHead(404); r.end(); return; }
  let rel = pfad.slice('/pixinotes/'.length) || 'index.html';
  const kopf = { 'Cache-Control': 'no-store' };
  if (fassung !== null && /-v\d+\.css$/.test(rel)) {
    const n = Number(rel.match(/-v(\d+)\.css$/)[1]);
    if (n !== fassung) { r.writeHead(404, kopf); r.end('weg'); return; }   // wie nach einem Deploy: alte Datei ist weg
    rel = `assets/${CSS}`;
  }
  const f = join(DIST, rel);
  if (!existsSync(f)) { r.writeHead(404, kopf); r.end('nicht da'); return; }
  let inhalt = readFileSync(f);
  if (fassung !== null && rel === 'index.html') inhalt = Buffer.from(inhalt.toString().replace(CSS, cssName(fassung)));
  const swListe = rel === 'sw.js' ? inhalt.toString().match(/const DATEIEN = (\[.*?\]);/s) : null;
  if (fassung !== null && swListe) {
    const text = inhalt.toString();
    const liste = JSON.parse(swListe[1]);
    inhalt = Buffer.from(fassung === 0
      ? text.replace(/const DATEIEN = \[.*?\];/s, 'const DATEIEN = [] /*__PIXINOTES_DATEIEN__*/;')
      : text.replace(/const DATEIEN = \[.*?\];/s, `const DATEIEN = ${JSON.stringify(liste.map((d) => (d === CSS ? cssName(fassung) : d)))};`));
  }
  r.writeHead(200, { 'Content-Type': TYP[extname(f)] ?? 'application/octet-stream', ...kopf });
  r.end(inhalt);
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => { if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); } };
const warteBis = async (P, fn, ms = 15000, arg) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const bleibt = async (P, fn, ms = 900, arg) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (!(await P.evaluate(fn, arg))) return false; await P.waitForTimeout(120); } return true; };
const teil = async (fn) => { try { await fn(); } catch (e) { bad += 1; console.log(`  ✗ Abschnitt abgebrochen: ${String(e.message).split('\n')[0].slice(0, 160)}`); for (const c of browser.contexts()) await c.close().catch(() => {}); } };

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const note = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 280, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const stand = (extra = {}) => ({
  boards: [
    { id: 'b1', name: 'Start', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Hallo Welt'), note('n6', 'Treffpunkt an der Straße 12', 360), note('n7', 'Dritte Karte', 720), ...(extra.b1 ?? [])] },
    { id: 'b2', name: 'Ziel', edges: [], drawings: [], comments: [], nodes: [note('n2', 'Zweites Board')] },
    { id: 'b3', name: 'Übersicht Q3', edges: [], drawings: [], comments: [], nodes: [note('n3', 'Quartal')] },
    { id: 'b4', name: 'Verträge 2026', edges: [], drawings: [], comments: [], nodes: [note('n4', 'Kaufvertrag Muster')] },
    { id: 'b5', name: 'Altes Lager', archived: true, edges: [], drawings: [], comments: [], nodes: [note('n5', 'Altbestand')] },
    // Eingang (M478) mit einem Eintrag — sonst geht die Liste gar nicht erst auf
    { id: 'pixinotes-eingang', name: 'Eingang', system: 'eingang', edges: [], drawings: [], comments: [], nodes: [{ ...note('e1', 'Geteilter Link'), data: { ...note('e1', 'Geteilter Link').data, eingang: { gruppe: 'g1', herkunft: 'teilen', wann: 1764000000000 } } }] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2', 'b3', 'b4', 'b5'] }] }],
  activeId: 'b1', view: 'board', cardFocus: extra.cardFocus ?? false, navLinks: false,
});
/** `sparen`: Datensparmodus — kein Vorladen im Leerlauf (dann lädt jeder Teil erst mit dem Aufruf) */
async function seite({ breite = 1440, hoehe = 900, touch = false, sparen = false, ua, extra, url = BASIS, route } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, hasTouch: touch, ...(ua ? { userAgent: ua } : {}), serviceWorkers: 'block' });
  if (route) await route(ctx);
  await ctx.addInitScript(([st, sparen]) => {
    if (sparen) Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) });
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes:author', 'Tester');
  }, [stand(extra), sparen]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(`pageerror: ${e.message.slice(0, 200)}`));
  P.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED|dynamically imported module|Failed to fetch/.test(m.text())) fehler.push(`console.error: ${m.text().slice(0, 200)}`); });
  await P.goto(url);
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  return { P, ctx };
}
const suche = async (P, text) => {
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box input');
  await P.locator('.search-box input').fill(text);
  await P.waitForTimeout(250);
};
const sucheZu = async (P) => { await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.search-box'), 4000); };
const board = (P) => P.evaluate(() => ['n1', 'n2', 'n3', 'n4', 'n5'].find((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)) ?? (document.querySelector('.ov-mode') ? 'übersicht' : '?'));

// ══ A: Suche ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ A: Suche ohne Umlaute, mit Tippfehlern ════');
await teil(async () => {
  const { P, ctx } = await seite();
  const boards = () => P.evaluate(() => [...document.querySelectorAll('.search-cmds')].filter((b) => b.querySelector('.search-sem-head')?.textContent === 'Boards')
    .flatMap((b) => [...b.querySelectorAll('.search-cmd')].map((x) => ({ name: x.querySelector('.hit-title')?.textContent, mark: x.querySelector('mark')?.textContent ?? '', archiv: !!x.querySelector('.hit-archiviert') }))));
  const befehle = () => P.evaluate(() => [...document.querySelectorAll('.search-cmds')].filter((b) => b.querySelector('.search-sem-head')?.textContent.includes('Befehle'))
    .flatMap((b) => [...b.querySelectorAll('.search-cmd .hit-title')].map((x) => x.textContent)));
  const karten = () => P.evaluate(() => [...document.querySelectorAll('.search-hit')].map((h) => ({ titel: h.querySelector('.hit-title')?.textContent, marks: [...h.querySelectorAll('mark')].map((m) => m.textContent) })));

  await suche(P, 'ubersicht');
  let b = await boards();
  pruefe('A1 „ubersicht" findet das Board „Übersicht Q3" — Fundstelle „Übersicht" markiert', b.some((x) => x.name === 'Übersicht Q3' && x.mark === 'Übersicht'), JSON.stringify(b));
  pruefe('A2 … und den Befehl „Zur Übersicht"', (await befehle()).includes('Zur Übersicht'), JSON.stringify(await befehle()));
  await P.locator('.search-box input').fill('vertraege'); await P.waitForTimeout(250);
  b = await boards();
  pruefe('A3 „vertraege" findet „Verträge 2026" (Board und seine Karte)', b.some((x) => x.name === 'Verträge 2026' && x.mark === 'Verträge') && (await karten()).some((k) => k.titel === 'Kaufvertrag Muster'), JSON.stringify(b));
  await P.locator('.search-box input').fill('strasse'); await P.waitForTimeout(250);
  const k = await karten();
  pruefe('A4 „strasse" findet die Karte mit „Straße", markiert ist „Straße" im Original', k.some((x) => x.titel === 'Treffpunkt an der Straße 12' && x.marks.includes('Straße')), JSON.stringify(k));
  await P.locator('.search-box input').fill('einstelungen'); await P.waitForTimeout(250);
  pruefe('A5 Tippfehler im Befehl: „einstelungen" findet „Einstellungen"', (await befehle()).includes('Einstellungen'), JSON.stringify(await befehle()));
  await P.locator('.search-box input').fill('Vertarge'); await P.waitForTimeout(250);
  pruefe('A6 Tippfehler im Board-Namen: „Vertarge" findet „Verträge 2026"', (await boards()).some((x) => x.name === 'Verträge 2026'), JSON.stringify(await boards()));
  await P.locator('.search-box input').fill('altes lager'); await P.waitForTimeout(250);
  b = await boards();
  pruefe('A7 archiviertes Board wird gefunden – mit Marke „archiviert"', b.some((x) => x.name === 'Altes Lager' && x.archiv), JSON.stringify(b));
  await P.locator('.search-box input').fill('Hallo'); await P.waitForTimeout(250);
  pruefe('A8 Wörter mit Umlaut-Umschreibung im Text bleiben findbar („Hallo" → „Hallo Welt")', (await karten()).some((x) => x.titel === 'Hallo Welt' && x.marks.includes('Hallo')));
  await sucheZu(P);
  await ctx.close();
});

// ══ B: Zurück-Taste ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ B: Zurück-Taste führt durch die App ════');
await teil(async () => {
  const { P, ctx } = await seite({ url: `${BASIS}?probe=1#ganz-oben` });
  const adresse = await P.evaluate(() => location.href);
  pruefe('B0 Verlauf wird geführt (spätestens nach dem Start-Leerlauf)', await warteBis(P, () => !!history.state?.pn, 15000), JSON.stringify(await P.evaluate(() => history.state)));
  const zurueck = async () => { await P.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {}); await P.waitForTimeout(300); };
  const vor = async () => { await P.goForward({ waitUntil: 'commit', timeout: 5000 }).catch(() => {}); await P.waitForTimeout(300); };
  // B1: Board wechseln (Strg+K → Enter), zurück, vor
  await suche(P, 'Ziel'); await P.keyboard.press('Enter');
  await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="n2"]'));
  await zurueck();
  pruefe('B1 nach einem Board-Wechsel führt „Zurück" zum vorigen Board (nicht aus der App)', await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="n1"]'), 5000) && P.url().startsWith(BASIS), `${await board(P)} ${P.url()}`);
  pruefe('B2 die Suche geht dabei nicht wieder auf', await bleibt(P, () => !document.querySelector('.search-box'), 600));
  await vor();
  pruefe('B3 „Vor" zeigt das Board wieder', await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="n2"]'), 5000), await board(P));
  // B4: Einstellungen → Zurück schließt sie
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
  await zurueck();
  pruefe('B4 Einstellungen offen, „Zurück" schließt sie – das Board bleibt', await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 5000) && (await board(P)) === 'n2', await board(P));
  // B5: Einstellungen mit Esc schließen hinterlässt keinen toten Eintrag
  const iVorher = await P.evaluate(() => history.state?.pn?.i);
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
  await P.waitForTimeout(300);
  await P.evaluate(() => document.activeElement?.blur?.()); await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 4000);
  pruefe('B5 Esc schließt die Einstellungen und geht im Verlauf mit zurück (kein toter Eintrag)', await warteBis(P, (i) => history.state?.pn?.i === i, 3000, iVorher), `${iVorher} → ${await P.evaluate(() => history.state?.pn?.i)}`);
  await zurueck();
  pruefe('B6 … das nächste „Zurück" führt zum vorigen Board, ohne die Einstellungen wieder zu öffnen', await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="n1"]'), 5000) && !(await P.locator('.modal[aria-label="Einstellungen"]').count()), await board(P));
  // B7: Übersicht und zurück
  await P.locator('[data-taste="uebersicht"]').first().click();
  await P.waitForSelector('.ov-mode');
  await zurueck();
  pruefe('B7 aus der Übersicht führt „Zurück" ins Board', await warteBis(P, () => !document.querySelector('.ov-mode') && !!document.querySelector('.react-flow__node[data-id="n1"]'), 8000), await board(P));
  pruefe('B8 die Adresse bleibt (Deep-Link, Anker)', P.url() === adresse, `${adresse} → ${P.url()}`);
  await ctx.close();
});
await teil(async () => {
  // Fokus am Telefon (Tipp öffnet die Karte), Blättern ersetzt den Eintrag
  const { P, ctx } = await seite({ breite: 900, hoehe: 800, touch: true, extra: { cardFocus: true } });
  await warteBis(P, () => !!history.state?.pn, 15000);
  const laenge = await P.evaluate(() => history.length);
  const box = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await P.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 10);
  const auf = await warteBis(P, () => !!document.querySelector('.app.focus-mode'), 8000);
  for (let k = 0; k < 3; k++) { await P.keyboard.press('Alt+ArrowDown'); await P.waitForTimeout(250); }
  const nachBlaettern = await P.evaluate(() => history.length);
  pruefe('B9 Karte im Fokus: ein Eintrag; dreimal Blättern fügt keine weiteren hinzu', auf && nachBlaettern === laenge + 1, `${laenge} → ${nachBlaettern}`);
  await P.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  pruefe('B10 „Zurück" schließt den Fokus (auch nach dem Blättern) – die App bleibt', await warteBis(P, () => !document.querySelector('.app.focus-mode'), 5000) && P.url().startsWith(BASIS));
  await ctx.close();
});

// ══ C: Esc-Stapel ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ C: Esc gehört dem obersten Fenster ════');
await teil(async () => {
  const { P, ctx } = await seite();
  const faelle = [
    ['Vorlagen', 'pixinotes:vorlagen', '[data-taste="vorlagen-dialog"]'],
    ['Versionen', 'pixinotes:versionen', '[data-taste="versionen-dialog"]'],
    ['Sicherung einspielen', 'pixinotes:sicherung-einspielen', '[data-taste="sicherung-dialog"]'],
    ['App installieren', 'pixinotes:app-installieren', '[data-taste="app-installieren"]'],
    ['Eingang', 'pixinotes:eingang', '[data-taste="eingang-liste"]'],
  ];
  for (const [name, ereignis, sel] of faelle) {
    await P.evaluate((e) => window.dispatchEvent(new CustomEvent(e, { detail: {} })), ereignis);
    if (!(await warteBis(P, (s) => !!document.querySelector(s), 10000, sel))) { pruefe(`C ${name}: öffnet`, false); continue; }
    await P.waitForTimeout(300);
    await P.keyboard.press('Alt+h'); await P.waitForSelector('.help-modal');
    await P.waitForTimeout(300);
    await P.evaluate(() => document.activeElement?.blur?.()); await P.keyboard.press('Escape');
    await warteBis(P, () => !document.querySelector('.help-modal'), 3000);
    const nachEins = await P.evaluate((s) => ({ hilfe: !!document.querySelector('.help-modal'), dialog: !!document.querySelector(s) }), sel);
    await P.evaluate(() => document.activeElement?.blur?.()); await P.keyboard.press('Escape');
    const zu = await warteBis(P, (s) => !document.querySelector(s), 3000, sel);
    pruefe(`C ${name} + Hilfe darüber: Esc schließt erst die Hilfe, dann ${name}`, !nachEins.hilfe && nachEins.dialog && zu, JSON.stringify(nachEins));
    if (!zu) { await P.keyboard.press('Escape'); await P.waitForTimeout(300); }
  }
  await ctx.close();
});

// ══ D: Nachladen robust ════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ D: Nachladen scheitert – Hinweis statt Absturz ════');
await teil(async () => {
  // Netz weg, nachdem die App stand (Datensparmodus: nichts wurde im Leerlauf vorgeladen; kein Service Worker). Nur die
  // Einstellungen sind betroffen (Abruf gesperrt, der Browser meldet „offline") — so vergiftet kein anderer Teil, der
  // ohne Netz nachladen wollte, gemeinsame Dateien (dann hülfe nur Neuladen, siehe M534-Doku)
  let sperre = true;
  const { P, ctx } = await seite({ sparen: true, route: (c) => c.route(/\/assets\/Settings-[^/]+\.js(\?.*)?$/, (r) => (sperre ? r.abort('internetdisconnected') : r.continue())) });
  await P.evaluate(() => {
    window.__m534 = 'unverändert';
    window.__netz = false;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => window.__netz });
    dispatchEvent(new Event('offline'));
  });
  await P.keyboard.press('Alt+e');
  const hinweis = await warteBis(P, () => !!document.querySelector('.nachlade-fehler'), 15000);
  const lage = await P.evaluate(() => ({ voll: !!document.querySelector('.err-full'), board: !!document.querySelector('.react-flow__node[data-id="n1"]'), text: document.querySelector('.nachlade-fehler')?.textContent ?? '' }));
  pruefe('D1 Einstellungen laden nicht (Netz weg): Hinweis an der Stelle, Board bleibt – kein „lässt sich nicht anzeigen"', hinweis && !lage.voll && lage.board && /nicht geladen/.test(lage.text), JSON.stringify(lage));
  pruefe('D1b ohne Netz startet die Seite nicht von selbst neu (die Arbeit bleibt, wo sie ist)', await P.evaluate(() => window.__m534 === 'unverändert'));
  // Noch ohne Netz „Nochmal versuchen": Der Hinweis kommt wieder, nichts bricht
  await P.locator('.nachlade-fehler button', { hasText: 'Nochmal versuchen' }).click();
  await P.waitForTimeout(400);
  pruefe('D2 noch ohne Netz: „Nochmal versuchen" zeigt wieder den Hinweis, die App steht', await warteBis(P, () => !!document.querySelector('.nachlade-fehler') && !document.querySelector('.err-full'), 8000));
  sperre = false;
  await P.evaluate(() => { window.__netz = true; dispatchEvent(new Event('online')); });
  await P.locator('.nachlade-fehler button', { hasText: 'Nochmal versuchen' }).click();
  pruefe('D3 Netz wieder da: „Nochmal versuchen" lädt wirklich – die Einstellungen gehen auf, ohne Neuladen', await warteBis(P, () => !!document.querySelector('.modal[aria-label="Einstellungen"]') && !document.querySelector('.nachlade-fehler'), 10000)
    && await P.evaluate(() => window.__m534 === 'unverändert'));
  await ctx.close();
});
await teil(async () => {
  // Wie nach einem Update: Die Datei der Karte ist auf dem Server nicht mehr da (Netz steht). Die Seite lädt einmal
  // neu (M321); kommt die Datei dann immer noch nicht, steht der Hinweis in der Karte.
  let sperre = true;
  const kanban = { id: 'k1', type: 'kanban', width: 520, height: 300, position: { x: 0, y: 260 }, data: { title: 'Plan', items: [{ id: 'i1', text: 'Aufgabe', col: 0 }] } };
  const { P, ctx } = await seite({ sparen: true, extra: { b1: [kanban] }, route: (c) => c.route(/\/assets\/KanbanCard-[^/]+\.js(\?.*)?$/, (r) => (sperre ? r.fulfill({ status: 404, body: 'weg' }) : r.continue())) });
  const hinweis = await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="k1"] .nachlade-fehler'), 15000);
  pruefe('D4 Kanban-Karte lädt nicht (Datei nach einem Update weg): Hinweis in der Karte, die anderen Karten stehen', hinweis && await P.evaluate(() => !!document.querySelector('.react-flow__node[data-id="n1"]') && !document.querySelector('.err-full')));
  sperre = false;
  await P.locator('.react-flow__node[data-id="k1"] .nachlade-fehler button', { hasText: 'Nochmal versuchen' }).click();
  pruefe('D5 „Nochmal versuchen" holt die Datei frisch und zeigt die Karte', await warteBis(P, () => !document.querySelector('.react-flow__node[data-id="k1"] .nachlade-fehler') && /Plan/.test(document.querySelector('.react-flow__node[data-id="k1"]')?.textContent ?? ''), 10000));
  await ctx.close();
});

// ══ E: Service Worker räumt auf ════════════════════════════════════════════════════════════════════════════
console.log('\n════ E: Service-Worker-Cache räumt auf, Update ohne Hängenbleiben ════');
await teil(async () => {
  const sw = readFileSync(join(DIST, 'sw.js'), 'utf8').match(/const DATEIEN = (\[.*?\]);/s);
  const liste = sw ? JSON.parse(sw[1]) : [];
  pruefe('E0 der Build setzt die Liste seiner Dateien in sw.js ein', liste.length > 20 && liste.includes(CSS), String(liste.length));
  if (!liste.length) return;
  fassung = 0;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pixinotes-onboarded', '1'); } catch { /* egal */ } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(`pageerror E: ${e.message.slice(0, 200)}`));
  await P.goto(BASIS); await P.waitForSelector('.dock');
  await P.evaluate(async () => { await navigator.serviceWorker.ready; });
  await warteBis(P, () => !!navigator.serviceWorker.controller, 10000);
  const schluessel = () => P.evaluate(async () => (await (await caches.open('pixinotes-v1')).keys()).map((r) => new URL(r.url).pathname.split('/').pop()));
  // Altlast einer früheren Veröffentlichung
  await P.evaluate(async () => { const c = await caches.open('pixinotes-v1'); await c.put('/pixinotes/assets/Alt-xyz123.js', new Response('// alt', { headers: { 'Content-Type': 'text/javascript' } })); });
  const stufe = async (n) => {
    fassung = n;
    await P.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const vorher = navigator.serviceWorker.controller;
      await reg.update();
      // auf den neuen Service Worker warten (übernimmt sofort: skipWaiting + claim)
      await new Promise((ok) => { if (navigator.serviceWorker.controller !== vorher) ok(); navigator.serviceWorker.addEventListener('controllerchange', () => ok(), { once: true }); setTimeout(ok, 10000); });
    });
    await P.reload();
    const da = await warteBis(P, () => !!document.querySelector('.dock'), 15000);
    const css = await P.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href.split('/').pop()));
    return { da, css };
  };
  let r = await stufe(1);
  await warteBis(P, async () => true, 500);
  let k = await schluessel();
  pruefe('E1 Fassung 0 → 1: erscheint ohne Hängenbleiben, die Altlast ist aus dem Cache', r.da && r.css.includes(cssName(1)) && !k.includes('Alt-xyz123.js'), JSON.stringify({ r, alt: k.includes('Alt-xyz123.js') }));
  r = await stufe(2);
  for (let i = 0; i < 20 && !(await schluessel()).includes(cssName(2)); i++) await P.waitForTimeout(300);
  k = await schluessel();
  pruefe('E2 Fassung 1 → 2: neue Fassung da; die Dateien der Fassung davor bleiben noch (offene alte Tabs)', r.da && r.css.includes(cssName(2)) && k.includes(cssName(1)) && k.includes(cssName(2)), JSON.stringify({ r, k: k.filter((x) => x.endsWith('.css')) }));
  r = await stufe(3);
  for (let i = 0; i < 20 && !(await schluessel()).includes(cssName(3)); i++) await P.waitForTimeout(300);
  k = await schluessel();
  pruefe('E3 Fassung 2 → 3: die Datei von Fassung 1 ist weg, 2 und 3 liegen im Cache', r.da && !k.includes(cssName(1)) && k.includes(cssName(2)) && k.includes(cssName(3)), JSON.stringify(k.filter((x) => x.endsWith('.css'))));
  pruefe('E4 die Einstiegsdateien bleiben im Cache (Start-Skript, React)', k.some((x) => /^index-.*\.js$/.test(x)) && k.some((x) => /^react-.*\.js$/.test(x)), String(k.length));
  await ctx.setOffline(true);
  await P.reload().catch(() => {});
  pruefe('E5 nach dem Aufräumen startet die App ohne Netz', await warteBis(P, () => !!document.querySelector('.dock'), 15000));
  await ctx.setOffline(false);
  await ctx.close();
  fassung = null;
});

// ══ F: Portable Datei ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ F: Portable Datei (file://) ════');
await teil(async () => {
  if (!existsSync(SINGLE)) { pruefe('F0 release/pixinotes.html ist gebaut (npm run build:single)', false, SINGLE); return; }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand());
  const P = await ctx.newPage();
  const lokal = [];
  P.on('pageerror', (e) => lokal.push(e.message.slice(0, 160)));
  await P.goto(pathToFileURL(SINGLE).href);
  await P.waitForSelector('.react-flow__node[data-id="n1"]', { timeout: 30000 });
  const gefuehrt = await warteBis(P, () => !!history.state?.pn, 15000);
  await suche(P, 'Ziel'); await P.keyboard.press('Enter');
  await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="n2"]'));
  await P.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
  pruefe('F1 file://: Board wechseln, „Zurück" führt zum vorigen Board, ohne Fehler', gefuehrt && await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="n1"]'), 5000) && P.url().startsWith('file:') && lokal.length === 0, lokal.join(' | '));
  await ctx.close();
});

// ══ G: Firefox ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ G: „Als App installieren" unter Firefox ════');
await teil(async () => {
  const { P, ctx } = await seite({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0' });
  await P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:app-installieren')));
  await P.waitForSelector('[data-taste="app-installieren"]');
  const text = await P.locator('[data-taste="app-installieren"]').innerText();
  pruefe('G1 Firefox unter Windows: „Zur Taskleiste hinzufügen" wird genannt', /Zur Taskleiste hinzufügen/.test(text) && /Firefox/.test(text), text.slice(0, 300));
  await ctx.close();
  const { P: P2, ctx: c2 } = await seite({ ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0' });
  await P2.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:app-installieren')));
  await P2.waitForSelector('[data-taste="app-installieren"]');
  pruefe('G2 Firefox unter Linux: weiter der Weg über Chrome oder Edge', /Chrome oder Edge/.test(await P2.locator('[data-taste="app-installieren"]').innerText()));
  await c2.close();
});

console.log('\n════ Z ════');
pruefe('Z1 keine Fehler in der Konsole', fehler.length === 0, fehler.slice(0, 6).join(' | '));

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
