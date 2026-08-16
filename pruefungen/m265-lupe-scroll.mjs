/**
 * M265 — zwei Meldungen zur Zoom-Ansicht:
 *   (1) „man kann aber nicht richtig gut im eingezoomten alles anschauen …
 *        das Scrollen ist nicht sauber"
 *   (2) „in der Zoom-Ansicht bei Dateien und Cards wird unten links der
 *        Board-Zoom halb verdeckt! diesen sauber positionieren"
 */
// Läuft aus dem Repository: `node pruefungen/m265-lupe-scroll.mjs`
// Voraussetzung: `npm run build` (die Reihe prüft den dist/-Stand) und ein
// Chromium — Pfad über die Umgebungsvariable PW_CHROMIUM, sonst der
// Standardpfad der Claude-Umgebung.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4431;

writeFileSync(`${SD}/ticket.pdf`, `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj
4 0 obj<</Length 40>>stream
BT /F1 9 Tf 40 800 Td (ICE Fahrkarte) Tj ET
endstream endobj
trailer<</Root 1 0 R/Size 5>>
%%EOF`);

const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const BILD = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#334"/><text x="20" y="60" font-size="40" fill="#fff">LINKS</text><text x="700" y="560" font-size="40" fill="#fff">RECHTS</text></svg>',
).toString('base64');

async function seite(nodes = [], w = 1200, h = 900, prefs = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([n, p]) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify(p));
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'T', edges: [], drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'S', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: true, ...p } }));
  }, [nodes, prefs]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}

// ══ T1: Im vergrößerten Bild ist ALLES erreichbar ════════════════════
console.log('════ T1: Scrollen im eingezoomten Zustand ════');
{
  const { ctx, P } = await seite([
    { id: 'i1', type: 'image', position: { x: 200, y: 200 }, width: 300, data: { src: BILD, name: 'plan.svg' } },
  ]);
  await P.click('.bild-lupe-auf');
  await P.waitForTimeout(600);
  // kräftig hineinzoomen
  for (let i = 0; i < 4; i++) await P.click('.lupe-knoepfe button[aria-label="Vergrößern"]');
  await P.waitForTimeout(800);

  const m = await P.evaluate(() => {
    const f = document.querySelector('.pdf-page');
    const c = f.querySelector('img, canvas');
    const inhalt = Math.round(c.getBoundingClientRect().width);
    // Ganz nach links und ganz nach rechts scrollen und schauen, welcher
    // Ausschnitt des Inhalts wirklich erreichbar ist
    f.scrollLeft = 0;
    const linksKante = c.getBoundingClientRect().left - f.getBoundingClientRect().left;
    f.scrollLeft = 999999;
    const rechtsKante = c.getBoundingClientRect().right - f.getBoundingClientRect().right;
    return {
      inhalt, sicht: Math.round(f.clientWidth),
      scrollWidth: Math.round(f.scrollWidth),
      linksKante: Math.round(linksKante), rechtsKante: Math.round(rechtsKante),
      justify: getComputedStyle(f).justifyContent,
    };
  });
  console.log('   ', JSON.stringify(m));
  pruefe('T1a der Inhalt ist breiter als das Fenster (sonst prüft der Test nichts)',
    m.inhalt > m.sicht + 50, `${m.inhalt} vs ${m.sicht}`);
  pruefe('T1b die linke Kante ist erreichbar (vorher unerreichbar: zentriertes Flex)',
    m.linksKante >= -1, `${m.linksKante}px abgeschnitten`);
  pruefe('T1c die rechte Kante ist erreichbar', m.rechtsKante <= 1, `${m.rechtsKante}px übrig`);
  pruefe('T1d der Scrollbereich deckt den ganzen Inhalt ab',
    m.scrollWidth >= m.inhalt - 2, `${m.scrollWidth} < ${m.inhalt}`);

  // Auch senkrecht: unten muss ankommen, wer scrollt
  const senk = await P.evaluate(() => {
    const f = document.querySelector('.pdf-page');
    const c = f.querySelector('img, canvas');
    f.scrollTop = 999999;
    return {
      unten: Math.round(c.getBoundingClientRect().bottom - f.getBoundingClientRect().bottom),
      hoehe: Math.round(c.getBoundingClientRect().height), sicht: Math.round(f.clientHeight),
    };
  });
  console.log('   ', JSON.stringify(senk));
  pruefe('T1e auch die Unterkante ist erreichbar', senk.unten <= 1, `${senk.unten}px übrig`);
  await ctx.close();
}

// ══ T2: Board-Zoom im Karten-Fokus ═══════════════════════════════════
console.log('\n════ T2: Board-Zoom in der Fokus-Ansicht ════');
{
  const { ctx, P } = await seite([
    { id: 'i1', type: 'image', position: { x: 200, y: 200 }, width: 300, data: { src: BILD, name: 'plan.svg' } },
  ], 820, 1120);
  // Karte in den Fokus holen (Klick — cardFocus ist an)
  await P.dblclick('.image-card img');
  await P.waitForTimeout(1200);
  const fokus = await P.evaluate(() => {
    const f = document.querySelector('.focus-head');
    const c = document.querySelector('.react-flow__controls');
    const sichtbar = c ? getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0 : false;
    return {
      imFokus: !!f,
      steuerSichtbar: sichtbar,
      box: c && sichtbar ? (() => { const b = c.getBoundingClientRect();
        return { l: Math.round(b.left), b: Math.round(b.bottom), h: Math.round(b.height) }; })() : null,
      fensterHoehe: window.innerHeight,
    };
  });
  console.log('   ', JSON.stringify(fokus));
  pruefe('T2a die Karte ist im Fokus', fokus.imFokus);
  pruefe('T2b der Board-Zoom steht dort nicht mehr halb verdeckt herum',
    !fokus.steuerSichtbar, JSON.stringify(fokus.box));
  await ctx.close();
}

// ══ T3: Auf dem Board bleibt der Zoom, vollständig sichtbar ══════════
console.log('\n════ T3: auf dem Board unverändert erreichbar ════');
{
  const { ctx, P } = await seite([], 1200, 900, { cardFocus: false });
  const b = await P.evaluate(() => {
    const c = document.querySelector('.react-flow__controls');
    if (!c || getComputedStyle(c).display === 'none') return null;
    const r = c.getBoundingClientRect();
    // Liegt etwas darüber? Mitte des obersten Knopfes abfragen
    const oben = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
    return {
      l: Math.round(r.left), b: Math.round(r.bottom), r: Math.round(r.right),
      imBild: r.left >= 0 && r.bottom <= window.innerHeight + 1,
      darueber: oben ? (oben.closest('.react-flow__controls') ? 'frei' : oben.className) : 'nichts',
    };
  });
  console.log('   ', JSON.stringify(b));
  pruefe('T3a der Board-Zoom ist da', !!b);
  pruefe('T3b vollständig im Bild', !!b && b.imBild, JSON.stringify(b));
  pruefe('T3c und nichts liegt darüber', b?.darueber === 'frei', String(b?.darueber));
  await ctx.close();
}

// ══ T4: Datei-Karte im Fokus — dasselbe Bild ═════════════════════════
console.log('\n════ T4: Datei-Karte im Fokus ════');
{
  // „am PC mit einem Klick öffnen" — sonst müsste man doppelklicken, und der
  // Doppelklick auf den Titel benennt um (M263).
  const { ctx, P } = await seite([], 820, 1120, { fokusEinKlick: true });
  await P.click('.dock button[aria-label="Objekt hinzufügen"]');
  await P.waitForTimeout(400);
  const [ch] = await Promise.all([
    P.waitForEvent('filechooser'),
    P.click('.dock-menu button:has-text("Datei einfügen")'),
  ]);
  await ch.setFiles(`${SD}/ticket.pdf`);
  await P.waitForTimeout(2500);
  await P.click('.file-icon');
  await P.waitForTimeout(1400);
  const r = await P.evaluate(() => {
    const c = document.querySelector('.react-flow__controls');
    const karte = document.querySelector('.pn-focused');
    return {
      imFokus: !!document.querySelector('.focus-head'),
      steuerSichtbar: c ? getComputedStyle(c).display !== 'none' : false,
      karteLinks: karte ? Math.round(karte.getBoundingClientRect().left) : null,
      karteBreite: karte ? Math.round(karte.getBoundingClientRect().width) : null,
      fenster: window.innerWidth,
    };
  });
  console.log('   ', JSON.stringify(r));
  pruefe('T4a auch hier ist der Board-Zoom weg', r.imFokus && !r.steuerSichtbar, JSON.stringify(r));
  /* Ab 700 Punkten ist die Fokus-Karte bewusst ein BLATT über dem Board
     (M228) — also nicht randlos, aber vollständig im Bild und mittig. */
  pruefe('T4b die Karte liegt vollständig und mittig im Bild',
    r.karteLinks > 0 && r.karteLinks + r.karteBreite <= r.fenster
      && Math.abs(r.karteLinks - (r.fenster - r.karteLinks - r.karteBreite)) <= 2, JSON.stringify(r));
  await ctx.close();
}

// ══ T5: Dasselbe für die PDF-Seite (M264 bleibt heil) ════════════════
console.log('\n════ T5: PDF-Seite zoomen und ganz ansehen ════');
{
  const { ctx, P } = await seite([], 1200, 900, { cardFocus: false });
  await P.click('.dock button[aria-label="Objekt hinzufügen"]');
  await P.waitForTimeout(400);
  const [ch] = await Promise.all([
    P.waitForEvent('filechooser'),
    P.click('.dock-menu button:has-text("Datei einfügen")'),
  ]);
  await ch.setFiles(`${SD}/ticket.pdf`);
  await P.waitForTimeout(2500);
  await P.click('.pdf-thumb');
  await P.waitForTimeout(1500);
  const vor = await P.evaluate(() => {
    const c = document.querySelector('.pdf-page canvas');
    return { breite: Math.round(c.getBoundingClientRect().width), bitmap: c.width };
  });
  for (let i = 0; i < 4; i++) await P.click('.lupe-knoepfe button[aria-label="Vergrößern"]');
  await P.waitForTimeout(2000);
  const nach = await P.evaluate(() => {
    const f = document.querySelector('.pdf-page');
    const c = f.querySelector('canvas');
    f.scrollLeft = 0;
    const links = Math.round(c.getBoundingClientRect().left - f.getBoundingClientRect().left);
    return { breite: Math.round(c.getBoundingClientRect().width), bitmap: c.width, links,
      scrollWidth: Math.round(f.scrollWidth) };
  });
  console.log('   ', JSON.stringify(vor), '→', JSON.stringify(nach));
  pruefe('T5a die PDF-Seite wird größer', nach.breite > vor.breite * 1.8, `${vor.breite} → ${nach.breite}`);
  pruefe('T5b und dabei neu gerendert (scharf)', nach.bitmap > vor.bitmap * 1.8, `${vor.bitmap} → ${nach.bitmap}`);
  pruefe('T5c die linke Kante der Seite ist erreichbar', nach.links >= -1, `${nach.links}px`);
  pruefe('T5d der Scrollbereich deckt die ganze Seite ab',
    nach.scrollWidth >= nach.breite - 2, `${nach.scrollWidth} < ${nach.breite}`);
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
