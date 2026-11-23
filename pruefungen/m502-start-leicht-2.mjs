/**
 * M502 — Start-JS wieder entlasten: Live-Team (Vorführen, Mauszeiger, Gruppenraum), Gehirn, Rechen-Tabelle,
 * Kommentar-Ebene, Punkte, Nachschlagen, Handschrift-Struktur und der Wächter der Bild-Texterkennung kommen erst bei
 * Bedarf (bzw. still im Leerlauf nach dem Start).
 *
 *   A  Start: Start-JS unter der neuen Grenze; keiner der neu nachgeladenen Teile ist im Start.
 *   B  Bei Bedarf (Leerlauf-Vorladen abgeschaltet über „Datensparmodus"): Punkte-Modus → Leiste und Marke;
 *      ⋯ → Nachschlagen → Fenster; ⋯ → Kommentar → Gespräch und Pin. Jeder Teil kommt mit dem ersten Aufruf und tut,
 *      was er soll. Ohne Live-Kanal bleibt das Live-Team draußen.
 *   C  Ein Board mit Rechen-Tabelle, Kommentar und Punkten öffnen (Raster künstlich verzögert): Platzhalter in der
 *      Gestalt der Tabelle, kein Sprung der Notiz, danach rechnet die Tabelle; Pin und Marke stehen.
 *   D  Leerlauf: Ohne Zutun holt die App die Teile kurz nach dem Start still nach (Service Worker, offline).
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m502`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 5502;
/** M502: gemessen 2 044 571 B mit M501 (vorher 2 112 358 B) — Grenze mit gut 20 KB Polster (siehe M502-start-leicht-2.md) */
const START_JS_GRENZE = 2_065_000;
/** Was M502 aus dem Start nimmt (Dateinamen der Nachlade-Teile; Groß/klein zählt: Mauszeiger ≠ mauszeiger) */
const NACHGELADEN = ['vorfuehren', 'Vorfuehren', 'mauszeiger', 'Mauszeiger', 'gruppenraum', 'Gruppenraum', 'brain', 'RechenTabelleGitter',
  'CommentLayer', 'Punkte', 'LookupPanel', 'handschriftStruktur', 'textInBildern'];
const LIVE_TEAM = ['vorfuehren', 'Vorfuehren', 'mauszeiger', 'Mauszeiger', 'gruppenraum', 'Gruppenraum'];

let anfragen = [];
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  anfragen.push(pfad);
  let f = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const note = (id, text, x = 0, y = 0, extra = {}) => ({ id, type: 'note', width: 300, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }], ...extra } });
const stand = (nodes, comments = []) => ({
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments, nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false,
});
/** `sparen`: Datensparmodus — dann holt die App nichts im Leerlauf nach; was lädt, lädt mit dem Aufruf */
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  if (opt.verzoegern) await ctx.route(opt.verzoegern, async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
  await ctx.addInitScript(([st, sparen]) => {
    if (sparen) Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) });
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes:author', 'Tester');
  }, [stand(nodes, opt.kommentare ?? []), !!opt.sparen]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  anfragen = [];
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow', { state: 'visible' });
  if (nodes.length) await P.waitForSelector('.react-flow__node', { state: 'visible' });
  return { ctx, P, fehler };
}
const jsAssets = () => [...new Set(anfragen)].filter((p) => p.startsWith('/assets/') && p.endsWith('.js')).map((p) => p.split('/').pop());
const groesse = (dateien) => dateien.reduce((a, f) => a + statSync(join(DIST, 'assets', f)).size, 0);
const teil = (name) => jsAssets().some((f) => f.startsWith(`${name}-`));
const warteTeil = async (P, name, ms = 15000) => { const bis = Date.now() + ms; while (Date.now() < bis && !teil(name)) await P.waitForTimeout(100); return teil(name); };
const waehle = async (P, id) => {
  await P.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 12, y: 6 } });
  return P.waitForSelector('.sel-toolbar, .sel-toolbar-dock', { state: 'visible', timeout: 8000 }).then(() => true, () => false);
};
const sichtbar = (P, sel, ms = 8000) => P.waitForSelector(sel, { state: 'visible', timeout: ms }).then(() => true, () => false);

// ══ A: Start ═══════════════════════════════════════════════════════
console.log('\n════ A: Start ════');
{
  const { P, fehler, ctx } = await seite([note('n1', 'Hallo Welt'), note('n2', 'Zweite Karte', 420, 0)]);
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(400);
  const geladen = jsAssets();
  const summe = groesse(geladen);
  console.log(`  Start-JS ${(summe / 1024 / 1024).toFixed(2)} MB (${summe} B) in ${geladen.length} Dateien: ${geladen.join(', ')}`);
  pruefe(`A1 Start-JS unter ${START_JS_GRENZE} B (ist ${summe} B; vorher 2 112 358 B)`, summe < START_JS_GRENZE && summe > 1_000_000, String(summe));
  const imStart = NACHGELADEN.filter((n) => teil(n));
  pruefe('A2 kein neu nachgeladener Teil im Start (Live-Team, Gehirn, Rechen-Tabelle, Kommentare, Punkte, Nachschlagen, Handschrift, Bildtext)', imStart.length === 0, imStart.join(', '));
  const dateien = readdirSync(join(DIST, 'assets'));
  const fehlen = NACHGELADEN.filter((n) => !dateien.some((f) => f.startsWith(`${n}-`) && f.endsWith('.js')));
  pruefe('A3 die nachgeladenen Teile liegen als eigene Dateien im Build', fehlen.length === 0, fehlen.join(', '));
  pruefe('A4 keine Seitenfehler beim Start', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ B: Bei Bedarf ══════════════════════════════════════════════════
console.log('\n════ B: Bei Bedarf (ohne Leerlauf-Vorladen) ════');
{
  const { P, fehler, ctx } = await seite([note('n1', 'Photosynthese'), note('n2', 'Zweite Karte', 420, 0)], { sparen: true });
  await P.waitForLoadState('networkidle');
  // B1 Punkte-Modus: Leiste, Karte antippen → Marke
  pruefe('B1 vor dem Aufruf: Punkte, Nachschlagen und Kommentare sind nicht geladen', !teil('Punkte') && !teil('LookupPanel') && !teil('CommentLayer'));
  await P.locator('.dock button[aria-label="Mehr"]').click();
  await P.locator('[data-taste="punkte-modus"]').click();
  const leiste = await sichtbar(P, '[data-taste="punkte-leiste"]');
  pruefe('B2 Dock ⋯ → „Punkte vergeben": die Leiste kommt nach', leiste && teil('Punkte'));
  await P.locator('.react-flow__node[data-id="n2"]').click({ position: { x: 40, y: 20 } });
  const marke = await P.waitForFunction(() => document.querySelector('[data-taste="punkte-marke"][data-karte="n2"]')?.dataset.zahl === '1', null, { timeout: 8000 }).then(() => true, () => false);
  pruefe('B3 … und eine Karte antippen gibt ihr einen Punkt (Marke an der Karte)', marke);
  await P.keyboard.press('Escape');
  await P.waitForFunction(() => !document.querySelector('[data-taste="punkte-leiste"]'), null, { timeout: 8000 }).catch(() => {});
  pruefe('B4 Esc beendet den Modus, die Marke bleibt', (await P.locator('[data-taste="punkte-leiste"]').count()) === 0 && (await P.locator('[data-taste="punkte-marke"]').count()) === 1);
  // B5 Nachschlagen
  pruefe('B5 eine Karte wählen: die Auswahl-Leiste erscheint', await waehle(P, 'n1'));
  await P.locator('.sel-toolbar [aria-label="Mehr"], .sel-toolbar-dock [aria-label="Mehr"]').first().click();
  await P.locator('.sel-more-menu button', { hasText: 'Nachschlagen' }).click();
  const lookup = await sichtbar(P, '.lookup-panel');
  const begriff = lookup ? await P.locator('.lookup-panel input').first().inputValue().catch(() => '') : '';
  pruefe('B6 ⋯ → „Nachschlagen" öffnet das Fenster mit dem Begriff der Karte (nachgeladen)', lookup && teil('LookupPanel') && /Photosynthese/.test(begriff), begriff);
  await P.locator('.lookup-panel').press('Escape');
  await P.waitForFunction(() => !document.querySelector('.lookup-panel'), null, { timeout: 5000 }).catch(() => {});
  pruefe('B7 Esc schließt es', (await P.locator('.lookup-panel').count()) === 0);
  // B8 Kommentar
  await waehle(P, 'n1');
  await P.locator('.sel-toolbar [aria-label="Mehr"], .sel-toolbar-dock [aria-label="Mehr"]').first().click();
  await P.locator('.sel-more-menu button', { hasText: /^\s*Kommentar/ }).first().click();
  const panel = await sichtbar(P, '.comment-panel');
  pruefe('B8 ⋯ → „Kommentar" öffnet das Gespräch (Kommentar-Ebene nachgeladen)', panel && teil('CommentLayer'));
  await P.locator('.comment-panel .comment-input').fill('Quelle fehlt noch');
  await P.locator('.comment-panel .comment-input').press('Enter');
  const pin = await sichtbar(P, '.comment-pin');
  const gespeichert = await P.waitForFunction(() => /Quelle fehlt noch/.test(localStorage.getItem('pixinotes-board') ?? ''), null, { timeout: 8000 }).then(() => true, () => false);
  pruefe('B9 … der Kommentar steht als Pin an der Karte und ist gespeichert', pin && gespeichert);
  const live = LIVE_TEAM.filter((n) => teil(n));
  pruefe('B10 ohne Live-Kanal bleibt das Live-Team (Vorführen, Zeiger, Gruppenraum) draußen', live.length === 0, live.join(', '));
  pruefe('B11 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ C: Board mit Tabelle, Kommentar, Punkten ════════════════════════
console.log('\n════ C: Rechen-Tabelle mit Platzhalter, Kommentar und Punkte beim Öffnen ════');
{
  const ZELLEN = { A1: 'Miete', B1: '800', A2: 'Strom', B2: '95', A3: 'Summe', B3: '=SUMME(B1:B2)' };
  const tabelle = { id: 't1', type: 'note', width: 360, position: { x: 0, y: 0 }, data: { color: 'white', blocks: [
    { id: 'tb1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Kosten', styles: {} }], children: [] },
    { id: 'tb2', type: 'rechentabelle', props: { zellen: JSON.stringify(ZELLEN), stil: '{}', spalten: 2, zeilen: 3 }, children: [] },
    { id: 'tb3', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Darunter', styles: {} }], children: [] },
  ] } };
  const gepunktet = note('n2', 'Mit Punkt', 480, 0, { punkte: { 'k:anna': { n: 1, t: 1_700_000_000_000 } } });
  const kommentare = [{ id: 'c1', nodeId: 'n2', px: 40, py: 20, msgs: [{ author: 'Anna', text: 'Gute Idee', at: new Date().toISOString() }] }];
  const { P, fehler, ctx } = await seite([tabelle, gepunktet], { sparen: true, kommentare, verzoegern: /RechenTabelleGitter-/ });
  const platz = await sichtbar(P, '.rt-platzhalter', 8000);
  const vorher = platz ? await P.evaluate(() => ({
    h: document.querySelector('.rt-platzhalter').getBoundingClientRect().height,
    zeilen: document.querySelectorAll('.rt-platzhalter tr').length,
    unten: document.querySelector('.react-flow__node[data-id="t1"]').getBoundingClientRect().height,
  })) : null;
  pruefe('C1 solange das Raster lädt, steht ein Platzhalter in Zeilen und Spalten der Tabelle', !!vorher && vorher.zeilen === 3 && vorher.h > 40, JSON.stringify(vorher));
  const summe = await P.waitForFunction(() => [...document.querySelectorAll('.rt-tabelle .rt-wert')].some((b) => /895/.test(b.textContent ?? '')), null, { timeout: 15000 }).then(() => true, () => false);
  pruefe('C2 danach rechnet die Tabelle (=SUMME → 895)', summe && teil('RechenTabelleGitter'));
  const nachher = await P.evaluate(() => ({
    h: document.querySelector('.rt-block').getBoundingClientRect().height,
    unten: document.querySelector('.react-flow__node[data-id="t1"]').getBoundingClientRect().height,
  }));
  console.log(`    Platzhalter ${vorher?.h.toFixed(1)} px, Raster ${nachher.h.toFixed(1)} px; Notiz ${vorher?.unten.toFixed(1)} → ${nachher.unten.toFixed(1)} px`);
  pruefe('C3 die Notiz springt nicht (Höhe ± 6 px)', !!vorher && Math.abs(nachher.unten - vorher.unten) <= 6 && Math.abs(nachher.h - vorher.h) <= 6, `${vorher?.unten} → ${nachher.unten}`);
  const pin = await sichtbar(P, '.comment-pin');
  pruefe('C4 ein Board mit Kommentar: die Kommentar-Ebene lädt gleich mit, der Pin steht', pin && teil('CommentLayer'));
  const marke = await P.waitForFunction(() => document.querySelector('[data-taste="punkte-marke"][data-karte="n2"]')?.dataset.zahl === '1', null, { timeout: 8000 }).then(() => true, () => false);
  pruefe('C5 ein Board mit Punkten: die Marke steht an der Karte', marke && teil('Punkte'));
  pruefe('C6 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ D: Leerlauf ════════════════════════════════════════════════════
console.log('\n════ D: still im Leerlauf nachgeladen ════');
{
  const { P, fehler, ctx } = await seite([note('n1', 'Hallo Welt')]);
  const imLeerlauf = ['RechenTabelleGitter', 'CommentLayer', 'Punkte', 'LookupPanel', 'Vorfuehren', 'Mauszeiger', 'Gruppenraum', 'handschriftStruktur', 'brain', 'textInBildern'];
  const bis = Date.now() + 20000;
  while (Date.now() < bis && !imLeerlauf.every((n) => teil(n))) await P.waitForTimeout(300);
  const fehlt = imLeerlauf.filter((n) => !teil(n));
  pruefe('D1 ohne Zutun kommen Rechen-Tabelle, Kommentare, Punkte, Nachschlagen, Live-Anzeigen, Handschrift, Gehirn und Bildtext kurz nach dem Start', fehlt.length === 0, fehlt.join(', '));
  pruefe('D2 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
