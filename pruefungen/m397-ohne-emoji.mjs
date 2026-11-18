/**
 * M397 — Keine Emojis mehr in der Oberfläche, und ein ruhigeres Bild.
 *
 * Gewünscht: „Sobald man eine App sieht mit Emojis drin, weiß man sofort, dass es AI-generiert ist. … Wenn du Symbole
 * irgendwo einfügst, automatisch oder in Menüs oder in Texte, dann nimm bitte wenigstens monochrome, schicke Symbole."
 *
 *   A  Regel im Quelltext: kein Text der App trägt ein Emoji (Ausnahme: die Reaktionen), auch nicht das Wörterbuch,
 *      die Startseite und das Manifest; kein eigenes Violett für die KI, kein Verlauf an der Portal-Karte.
 *   B  Leeres Board: ein ruhiger Textblock ohne gestrichelte Kästchen; mit Maus stehen Maus- und Tastenwege da,
 *      am Finger der Doppeltipp und das Plus. Beide Knöpfe tun, was sie sagen.
 *   C  Marke: Wortmarke in einer Farbe, Symbol ohne Emoji, die Statusleiste trägt die Farbe des App-Grunds.
 *   D  Die Beispiele und alles, was die App dazu anzeigt, kommen ohne Emoji aus (Baum, Board, Plus-Menü,
 *      Einstellungen, Hilfe, Aufgaben).
 *   E  Alte, von der App vergebene Namen verlieren ihr Emoji – einmal; eigene Namen bleiben.
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m397-ohne-emoji.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
import { bearbeiten } from '../werkzeug/ohne-emoji.mjs';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4713;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
/** Bunte Bildzeichen: der Emoji-Block, das Emoji-Auswahlzeichen und Zeichen, die Geräte von sich aus bunt malen */
const BUNT = /[\u{1F000}-\u{1FAFF}️]|[✅✨⚡⏱⏰➕➖⬜⬛✋⚠⌨⭐⏳⌛⛔❌❓❗⚙⏹⏺⏭⏮⏫⏬⏲⛓]/u;

// ---------- A: Regel im Quelltext ----------
console.log('A  Regel im Quelltext');
{
  const dateien = (dir, aus = []) => { for (const n of readdirSync(dir)) { const p = path.join(dir, n); if (statSync(p).isDirectory()) dateien(p, aus); else if (/\.tsx?$/.test(n) && !/\.d\.ts$/.test(n)) aus.push(p); } return aus; };
  const zuAendern = []; const allein = [];
  for (const f of dateien(path.join(__repo, 'src'))) {
    const r = bearbeiten(f, readFileSync(f, 'utf-8'), /HelpOverlayEn\.tsx$/.test(f) ? 'en' : 'de');
    const rel = path.relative(__repo, f);
    if (r.geaendert) zuAendern.push(`${rel} (${r.geaendert})`);
    for (const a of r.allein) allein.push(`${rel}:${a.zeile} ${a.text}`);
  }
  pruefe('A1 kein Text der App trägt ein Emoji oder einen Geviertstrich im Satz', zuAendern.length === 0, zuAendern.slice(0, 8).join(' · '));
  const fremd = allein.filter((a) => !a.startsWith('src/lib/gruppenraum.ts:'));
  pruefe('A2 allein stehende Emojis gibt es nur noch bei den Reaktionen', fremd.length === 0 && allein.length === 8, fremd.slice(0, 8).join(' · ') || String(allein.length));
  const woerter = lies('src/sprache/en.json');
  pruefe('A3 das Wörterbuch ist frei von Emojis und Geviertstrichen', !BUNT.test(woerter) && !woerter.includes('—'), (woerter.match(new RegExp(`.{0,30}(?:${BUNT.source}).{0,30}`, 'u')) ?? [''])[0]);
  const start = lies('index.html'); const manifest = lies('public/manifest.webmanifest');
  pruefe('A4 Startseite und Manifest: kein Emoji, die Leistenfarbe ist der App-Grund', !BUNT.test(start) && !BUNT.test(manifest)
    && /name="theme-color" content="#f3f4f6"/.test(start) && /"theme_color": "#f3f4f6"/.test(manifest) && !manifest.includes('—'));
  const css = lies('src/index.css').split('\n').filter((z) => !/data-accent='violett'/.test(z)).join('\n');
  pruefe('A5 kein eigenes Violett für KI und Portal – sie tragen die Akzentfarbe', !/#5b3fd4|#4a30b8|124, ?92, ?255|#f4efff|#453c63|#beadff/.test(css));
  const portal = css.slice(css.indexOf('.portal-card {'), css.indexOf('.portal-icon'));
  pruefe('A6 die Portal-Karte hat keinen Verlauf und keine Strichelung', !/gradient|dashed/.test(portal), portal.slice(0, 200));
  const ki = `${lies('src/lib/ai.ts')}\n${lies('src/lib/aiActions.ts')}`;
  pruefe('A7 die KI wird gebeten, keine Emojis zu setzen', /keine Emojis, kompakt bleiben/.test(ki) && /setze keine Emojis in Titel, Namen und Texte/.test(ki));
}

const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async (opt = {}, saat = null) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript((s) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    if (s) localStorage.setItem('pixinotes-board', s);
  }, saat);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
/** Alle sichtbaren Texte samt Tooltips, Namen für Vorleser und Platzhaltern – als Liste der Fundstellen mit Emoji */
const bunteStellen = (P, wurzel = 'body') => P.evaluate(({ w, muster }) => {
  const re = new RegExp(muster, 'u'); const funde = [];
  const el = document.querySelector(w); if (!el) return ['FEHLT ' + w];
  const lauf = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = lauf.nextNode(); n; n = lauf.nextNode()) {
    if (n.parentElement?.closest('.reakt-wahl, .reakt-flug, script, style')) continue;
    if (re.test(n.nodeValue ?? '')) funde.push((n.nodeValue ?? '').trim().slice(0, 60));
  }
  for (const e of el.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const a of ['title', 'aria-label', 'placeholder']) { const v = e.getAttribute(a); if (v && re.test(v)) funde.push(`${a}=${v.slice(0, 60)}`); }
  }
  return funde;
}, { w: wurzel, muster: BUNT.source });
const bis = async (P, f, arg, ms = 6000) => { const ende = Date.now() + ms; for (;;) { const w = await P.evaluate(f, arg); if (w || Date.now() > ende) return w; await P.waitForTimeout(150); } };

// ---------- B: leeres Board ----------
console.log('B  Leeres Board');
const M = await auf();
{
  const P = M.P;
  const bild = await P.evaluate(() => {
    const h = document.querySelector('.empty-board-hint'); if (!h) return null;
    const sicht = (s) => { const e = h.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
    return {
      maus: sicht('.leer-maus'), finger: sicht('.leer-finger'),
      gestrichelt: [...h.querySelectorAll('*')].filter((e) => getComputedStyle(e).borderTopStyle === 'dashed').length,
      titel: h.querySelector('.leer-titel')?.textContent ?? '',
      text: h.textContent ?? '',
      linksbuendig: getComputedStyle(h.querySelector('.leer-block')).textAlign !== 'center',
      knoepfe: [...h.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), rand: getComputedStyle(b).borderTopColor, farbe: getComputedStyle(b).color })),
      akzent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    };
  });
  pruefe('B1 das leere Board zeigt einen Textblock mit Titel', bild?.titel === 'Dieses Board ist leer', bild);
  pruefe('B2 mit Maus stehen Doppelklick, Einfügen und Hineinziehen da – der Finger-Satz nicht', bild?.maus && !bild.finger && /Doppelklick/.test(bild.text) && /Strg\+V/.test(bild.text) && /Hineinziehen/.test(bild.text));
  pruefe('B3 nichts ist gestrichelt, der Block steht linksbündig', bild?.gestrichelt === 0 && bild.linksbuendig, bild);
  pruefe('B4 zwei Angebote: Vorlage und Beispiele – ohne Emoji', bild?.knoepfe.length === 2 && bild.knoepfe[0].t === 'Mit Vorlage beginnen' && bild.knoepfe[1].t === 'Beispiele laden', bild?.knoepfe);
  pruefe('B5 der leere Zustand kommt ohne Akzentfarbe aus', !!bild && bild.knoepfe.every((k) => !/79, 124, 255|53, 87, 201/.test(k.rand + k.farbe)), bild?.knoepfe);
  pruefe('B6 kein Emoji auf der leeren Fläche und in den Leisten', (await bunteStellen(P)).length === 0, await bunteStellen(P));
  await P.locator('[data-taste="leer-vorlage"]').click();
  pruefe('B7 „Mit Vorlage beginnen" öffnet die Vorlagen', await P.locator('[data-taste="vorlagen-dialog"]').waitFor({ timeout: 5000 }).then(() => true, () => false));
  pruefe('B8 … und dort steht kein Emoji', (await bunteStellen(P, '[data-taste="vorlagen-dialog"]')).length === 0, await bunteStellen(P, '[data-taste="vorlagen-dialog"]'));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
}
{
  const T = await auf({ ...devices['Pixel 7'] });
  const bild = await T.P.evaluate(() => {
    const h = document.querySelector('.empty-board-hint'); if (!h) return null;
    const sicht = (s) => { const e = h.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
    const b = h.querySelector('.leer-block').getBoundingClientRect();
    return { maus: sicht('.leer-maus'), finger: sicht('.leer-finger'), satz: h.querySelector('.leer-finger')?.textContent ?? '', passt: b.left >= 12 && b.right <= innerWidth - 12 };
  });
  pruefe('B9 am Telefon steht der Doppeltipp da – Doppelklick, Strg+V und Hineinziehen nicht', bild?.finger && !bild.maus && /Doppeltipp/.test(bild.satz), bild);
  pruefe('B10 der Block passt in die Breite des Telefons', bild?.passt === true, bild);
  await T.ctx.close();
}

// ---------- C: Marke ----------
console.log('C  Marke');
{
  const P = M.P;
  const marke = await P.evaluate(() => {
    const l = document.querySelector('.logo'); const s = l.querySelector('span');
    return { text: l.textContent, gleich: getComputedStyle(l).color === getComputedStyle(s).color,
      leiste: document.querySelector('meta[name="theme-color"]').content, grund: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      symbol: decodeURIComponent(document.querySelector('link[rel="icon"]').getAttribute('href')) };
  });
  pruefe('C1 die Wortmarke steht in einer Farbe', marke.text === 'PixiNotes' && marke.gleich, marke);
  pruefe('C2 die Statusleiste trägt die Farbe des App-Grunds', marke.leiste === '#f3f4f6' && marke.grund === '#f3f4f6', marke);
  pruefe('C3 das Symbol im Tab ist gezeichnet – kein Emoji, kein Verlauf', /<path /.test(marke.symbol) && !/<text|Gradient/.test(marke.symbol) && !BUNT.test(marke.symbol), marke.symbol.slice(0, 120));
  const D = await auf({ colorScheme: 'dark' });
  const dunkel = await D.P.evaluate(() => ({ leiste: document.querySelector('meta[name="theme-color"]').content, grund: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }));
  pruefe('C4 … auch im dunklen Design', dunkel.leiste === '#141618' && dunkel.grund === '#141618', dunkel);
  await D.ctx.close();
  // Akzentfarbe wechseln: die Leiste bleibt beim Grund
  await P.evaluate(() => { document.documentElement.dataset.accent = 'rosa'; });
  const pngs = ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].map((n) => statSync(path.join(__repo, 'public/icons', n)).size);
  pruefe('C5 die App-Symbole sind flach gezeichnet (kleine Dateien ohne Verlauf)', pngs.every((g) => g > 800 && g < 20000), pngs);
  await P.evaluate(() => { document.documentElement.dataset.accent = 'blau'; });
}

// ---------- D: Beispiele und Oberfläche ----------
console.log('D  Beispiele und Oberfläche');
{
  const P = M.P;
  await P.locator('[data-taste="leer-beispiele"]').click();
  await bis(P, () => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.length > 5);
  await P.waitForTimeout(1200);
  const namen = await P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')).state; return [...s.boards.map((b) => b.name), ...s.spaces.flatMap((x) => [x.name, ...x.projects.map((p) => p.name)])]; });
  pruefe('D1 Bereiche, Projekte und Boards der Beispiele heißen ohne Emoji', namen.length > 20 && namen.every((n) => !BUNT.test(n)), namen.filter((n) => BUNT.test(n)));
  const inhalt = await P.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards));
  const treffer = inhalt.match(new RegExp(`.{0,40}(?:${BUNT.source}).{0,20}`, 'gu')) ?? [];
  pruefe('D2 auch die Karten der Beispiele tragen kein Emoji', treffer.length === 0, treffer.slice(0, 5));
  pruefe('D3 Übersicht und Baum: kein Emoji', (await bunteStellen(P)).length === 0, await bunteStellen(P));
  for (const name of ['Schreibtisch', 'Aufgaben-Zentrale']) {
    await P.locator('.nav-tree').getByText(name, { exact: true }).first().click(); await P.waitForTimeout(1500);
    const st = await bunteStellen(P);
    pruefe(`D4 Board „${name}": kein Emoji in Karten und Leisten`, st.length === 0, st.slice(0, 6));
  }
  await P.locator('.nav-tree').getByText('Schreibtisch', { exact: true }).first().click(); await P.waitForTimeout(900);
  const portal = await P.evaluate(() => {
    const k = document.querySelector('.portal-card'); if (!k) return null;
    const s = getComputedStyle(k); const kn = getComputedStyle(k.querySelector('.portal-open'));
    return { bild: s.backgroundImage, rand: s.borderTopStyle, zeichen: !!k.querySelector('.portal-icon svg'), knopf: kn.backgroundColor };
  });
  pruefe('D5 die Portal-Karte: gezeichnetes Symbol, fester Rand, kein Verlauf, Knopf in der Akzentfarbe',
    portal?.bild === 'none' && portal.rand === 'solid' && portal.zeichen && portal.knopf === 'rgb(69, 109, 224)', portal);
  await P.locator('.dock button[aria-label="Objekt hinzufügen"]').click(); await P.waitForTimeout(500);
  const pal = await bunteStellen(P, '.modul-palette');
  pruefe('D6 das Plus-Menü zeigt gezeichnete Symbole – kein Emoji', pal.length === 0 && (await P.locator('.modul-palette .modul-kachel svg').count()) > 8, pal.slice(0, 6));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.locator('[data-taste="hilfe"]').click(); await P.locator('.help-modal').waitFor({ timeout: 8000 }); await P.waitForTimeout(600);
  const hilfe = await bunteStellen(P, '.help-modal');
  // Die Hilfe darf die acht Reaktionen nicht mehr als Zeichen aufzählen
  pruefe('D7 die Hilfe kommt ohne Emoji aus', hilfe.length === 0, hilfe.slice(0, 6));
  const reiter = await P.evaluate(() => [...document.querySelectorAll('.help-modal .help-nav button, .help-modal nav button')].map((b) => b.textContent.trim()));
  pruefe('D8 die Abschnitte der Hilfe heißen ohne Bildzeichen', reiter.length === 0 || reiter.every((t) => /^[A-Za-zÄÖÜ]/.test(t)), reiter);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  await P.locator('.nav-links-spalte, .tabs, body').first().getByText('Aufgaben', { exact: true }).first().click(); await P.waitForTimeout(1200);
  const hub = await bunteStellen(P);
  pruefe('D9 die Aufgaben-Zentrale: kein Emoji', hub.length === 0, hub.slice(0, 6));
}

// ---------- E: alte Standardnamen ----------
console.log('E  Alte Standardnamen');
{
  const saat = JSON.stringify({ version: 5, state: {
    boards: [
      { id: 'b0', name: '🏠 Mein Board', edges: [], drawings: [], nodes: [{ id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 220, height: 120, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '🎉 mein Text bleibt', styles: {} }] }] } }] },
      { id: 'b1', name: '✨ Board 2', edges: [], drawings: [], nodes: [] },
      { id: 'b2', name: '🌟 Mein Urlaub', edges: [], drawings: [], nodes: [] },
      { id: 'b3', name: '👨‍👩‍👧 Familienplan', edges: [], drawings: [], nodes: [] },
      { id: 'b4', name: '⏱️ Zeiterfassung & Abwesenheit', edges: [], drawings: [], nodes: [] },
      { id: 'b5', name: '🏠 Hausbau', edges: [], drawings: [], nodes: [] },
    ],
    spaces: [
      { id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b0', 'b1', 'b2'] }, { id: 'p2', name: '📁 Projekt 3', boardIds: ['b4', 'b5'] }] },
      { id: 's2', name: '🏡 Privat', projects: [{ id: 'p3', name: '🎈 Feste', boardIds: ['b3'] }] },
    ],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: true } });
  const A = await auf({}, saat);
  const stand = () => A.P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')).state; return { boards: s.boards.map((b) => b.name), bereiche: s.spaces.map((x) => x.name), projekte: s.spaces.flatMap((x) => x.projects.map((p) => p.name)), text: JSON.stringify(s.boards[0].nodes), marke: localStorage.getItem('pixinotes-ohne-emoji') }; });
  await bis(A.P, () => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.[0]?.name === 'Mein Board');
  const s1 = await stand();
  pruefe('E1 von der App vergebene Board-Namen verlieren das Emoji', s1.boards[0] === 'Mein Board' && s1.boards[1] === 'Board 2' && s1.boards[3] === 'Familienplan' && s1.boards[4] === 'Zeiterfassung & Abwesenheit', s1.boards);
  pruefe('E2 eigene Namen bleiben, wie sie sind', s1.boards[2] === '🌟 Mein Urlaub' && s1.boards[5] === '🏠 Hausbau' && s1.projekte.includes('🎈 Feste'), s1);
  pruefe('E3 Bereiche und Projekte ebenso', s1.bereiche.join('|') === 'Arbeit|Privat' && s1.projekte.includes('Projekt 3'), s1);
  pruefe('E4 der Inhalt der Karten wird nicht angefasst', s1.text.includes('🎉 mein Text bleibt'), s1.text.slice(0, 120));
  pruefe('E5 das geschieht einmal je Gerät', s1.marke === '1');
  pruefe('E6 der Baum zeigt die neuen Namen', await A.P.locator('.nav-tree').getByText('Mein Board', { exact: true }).count() > 0 && await A.P.locator('.nav-tree').getByText('🌟 Mein Urlaub', { exact: true }).count() > 0);
  // Wer danach selbst wieder ein Emoji vor einen solchen Namen setzt, behält es
  await A.P.evaluate(() => { const roh = JSON.parse(localStorage.getItem('pixinotes-board')); roh.state.boards[1].name = '✨ Board 2'; window.__neu = JSON.stringify(roh); });
  const neu = await A.P.evaluate(() => window.__neu);
  await A.ctx.close();
  const B = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await B.addInitScript((s) => { try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; } localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1'); localStorage.setItem('pixinotes-board', s); }, neu);
  const Q = await B.newPage(); Q.on('pageerror', (e) => fehler.push(e.message));
  await Q.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await Q.waitForTimeout(1500);
  pruefe('E7 nach dem einen Mal bleibt ein selbst gesetztes Emoji stehen', await Q.locator('.nav-tree').getByText('✨ Board 2', { exact: true }).count() > 0);
  await B.close();
  // Ein unberührtes Startboard von früher zählt weiter als unberührt: die Beispiele ersetzen es
  const alt = JSON.stringify({ version: 5, state: { boards: [{ id: 'b0', name: '🏠 Mein Board', edges: [], drawings: [], nodes: [] }],
    spaces: [{ id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', cardFocus: false, navLinks: true } });
  const C = await auf({}, alt);
  pruefe('E8 das alte, leere Startboard bietet weiter die Beispiele an', await C.P.locator('[data-taste="leer-beispiele"]').count() === 1);
  await C.ctx.close();
}

// ---------- F: Texte ----------
console.log('F  Texte');
{
  const de = lies('src/components/HelpOverlay.tsx'); const en = lies('src/components/HelpOverlayEn.tsx');
  pruefe('F1 die Hilfe nennt M397 – deutsch und englisch', de.includes('(M397)') && en.includes('(M397)'));
  const E = await auf({ locale: 'en-US' });
  await E.P.evaluate(() => localStorage.setItem('pixinotes-sprache', 'en'));
  await E.P.reload({ waitUntil: 'networkidle' }); await E.P.waitForTimeout(1500);
  const leer = await E.P.evaluate(() => document.querySelector('.empty-board-hint')?.textContent ?? '');
  pruefe('F2 das leere Board ist englisch übersetzt', /This board is empty/.test(leer) && /Start with a template/.test(leer) && /Ctrl\+V/.test(leer) && !/Dieses|Notiz|Hineinziehen/.test(leer), leer.slice(0, 200));
  pruefe('F3 … ohne Emoji', (await bunteStellen(E.P)).length === 0, await bunteStellen(E.P));
  await E.ctx.close();
  pruefe('F4 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm397-ohne-emoji: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
