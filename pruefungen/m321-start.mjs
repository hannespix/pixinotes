/**
 * M321 — Start & Leistung.
 *
 *   A  Paket-Schnitt: Der Mermaid-Rohtext (3,5 MB) ist eine eigene Datei, die
 *      beim Start NICHT geladen wird; Fremdcode liegt in stabilen Paketen
 *      (react · editor · fluss), der eigene Code getrennt davon. Beim Start
 *      kommen weniger als 3,8 MB JS (vorher 6,3 MB).
 *   B  Bei Bedarf: Liegt ein Diagramm auf dem Board, kommt der Mermaid-Teil
 *      nach und das Diagramm wird gerendert (SVG).
 *   C  E-Mail-Parser (postal-mime) ist ein eigener Nachlade-Teil.
 *   D  Veraltete Chunk-Namen nach einem Deploy: `vite:preloadError` lädt die
 *      Seite genau EINMAL neu (Stempel in sessionStorage), nicht in Schleife.
 *   E  Startzeit: Dock und erste Karte sichtbar in unter 1,5 s (lokal, kalt).
 *   F  Die Ein-Datei-Fassung bleibt eine Datei und trägt Mermaid eingebettet.
 *   G  „Was ist neu" nennt M321.
 */
// Läuft aus dem Repository: `node pruefungen/m321-start.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4543;
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

const stand = (mitDiagramm) => ({
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 220, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Hallo' }] } },
    ...(mitDiagramm ? [{ id: 'd1', type: 'mermaid', width: 420, height: 260, position: { x: 300, y: 0 }, data: { code: 'flowchart LR\n  A[Start] --> B[Ende]' } }] : []),
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand(!!opt.diagramm));
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  anfragen = [];
  const t0 = Date.now();
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.dock', { state: 'visible' });
  const dock = Date.now() - t0;
  await P.waitForSelector('.react-flow__node', { state: 'visible' });
  const karte = Date.now() - t0;
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(600);
  return { ctx, P, dock, karte };
}
const js = (liste) => [...new Set(liste)].filter((p) => /\.js$/.test(p)).map((p) => p.split('/').pop());
const bytes = (dateien) => dateien.reduce((a, f) => a + (existsSync(join(DIST, 'assets', f)) ? statSync(join(DIST, 'assets', f)).size : 0), 0);
const assets = readdirSync(join(DIST, 'assets'));

// ══ A: Paket-Schnitt ════════════════════════════════════════════════
console.log('\n════ A: Paket-Schnitt ════');
{
  const mermaid = assets.filter((f) => /^mermaid\.min-.*\.js$/.test(f));
  pruefe('A1 der Mermaid-Rohtext ist eine eigene Datei (> 3 MB)', mermaid.length === 1 && statSync(join(DIST, 'assets', mermaid[0])).size > 3_000_000, JSON.stringify(mermaid));
  const pakete = ['react', 'editor', 'fluss'].map((n) => assets.find((f) => new RegExp(`^${n}-.*\\.js$`).test(f)));
  pruefe('A2 Fremdcode in stabilen Paketen react · editor · fluss', pakete.every(Boolean), JSON.stringify(pakete));
  const haupt = assets.filter((f) => /^index-.*\.js$/.test(f)).map((f) => statSync(join(DIST, 'assets', f)).size).sort((a, b) => b - a)[0];
  pruefe('A3 der eigene App-Teil ist unter 1,5 MB (vorher 6,1 MB in einer Datei)', haupt < 1_500_000, String(haupt));
  const { ctx, P, dock, karte } = await seite();
  const geladen = js(anfragen);
  const summe = bytes(geladen);
  pruefe('A4 beim Start wird kein Mermaid geladen', !geladen.some((f) => /mermaid/.test(f)), geladen.join(', '));
  pruefe('A5 beim Start kein PDF-, XLSX-, MSG- oder E-Mail-Parser', !geladen.some((f) => /pdf|xlsx|postal|msgreader|native-/.test(f)), geladen.filter((f) => /pdf|xlsx|postal|msgreader|native-/.test(f)).join(', '));
  pruefe(`A6 Start-JS unter 3,8 MB (ist ${(summe / 1024 / 1024).toFixed(2)} MB in ${geladen.length} Dateien; vorher 6,3 MB)`, summe < 3_800_000 && summe > 1_000_000, String(summe));
  console.log(`  ⏱ Dock sichtbar nach ${dock} ms, erste Karte nach ${karte} ms`);
  pruefe('E1 Dock und erste Karte in unter 1,5 s sichtbar (lokal, kalt)', dock < 1500 && karte < 1500, JSON.stringify({ dock, karte }));
  await ctx.close();
}

// ══ B: Diagramm bei Bedarf ══════════════════════════════════════════
console.log('\n════ B: Diagramm lädt nach ════');
{
  const { ctx, P } = await seite({ diagramm: true });
  await P.waitForSelector('.mermaid-card svg[aria-roledescription], .mermaid-card svg[id^="mermaid"]', { timeout: 15000 }).catch(() => null);
  await P.waitForTimeout(500);
  const geladen = js(anfragen);
  pruefe('B1 mit Diagramm auf dem Board kommt der Mermaid-Teil nach', geladen.some((f) => /^mermaid\.min-/.test(f)), geladen.join(', '));
  const svg = await P.evaluate(() => { const alle = [...document.querySelectorAll('.mermaid-card svg')].map((s) => ({ text: [...s.querySelectorAll('.nodeLabel, text, foreignObject')].map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').slice(0, 80), w: s.getBoundingClientRect().width })).sort((a, b) => b.w - a.w); return alle[0] ?? null; });
  pruefe('B2 das Diagramm ist gerendert (SVG mit Start → Ende)', !!svg && /Start/.test(svg.text) && /Ende/.test(svg.text) && svg.w > 50, JSON.stringify(svg));
  pruefe('B3 das Mermaid-Bundle läuft als globales Script (window.mermaid)', await P.evaluate(() => typeof window.mermaid?.render === 'function'));
  await P.screenshot({ path: path.join(SD, 'm321-diagramm.png') });
  await ctx.close();
}

// ══ C: E-Mail-Parser als eigener Teil ═══════════════════════════════
console.log('\n════ C: E-Mail-Parser ════');
{
  const pm = assets.filter((f) => /^postal-mime-.*\.js$/.test(f));
  pruefe('C1 postal-mime ist ein eigener Nachlade-Teil', pm.length === 1, JSON.stringify(pm));
  const quelle = readFileSync(path.join(__repo, 'src', 'lib', 'parseEmail.ts'), 'utf8');
  pruefe('C2 parseEml importiert den Parser erst beim Aufruf', /await import\('postal-mime'\)/.test(quelle) && !/^import PostalMime/m.test(quelle));
}

// ══ D: Einmaliges Neuladen bei veralteten Teilen ════════════════════
console.log('\n════ D: Neuladen bei veralteten Chunk-Namen ════');
{
  const { ctx, P } = await seite();
  const stempel = await P.evaluate(() => sessionStorage.getItem('pixinotes-neu-geladen'));
  pruefe('D1 ohne Fehler kein Stempel', stempel === null, String(stempel));
  const navsVorher = await P.evaluate(() => performance.getEntriesByType('navigation').length);
  await Promise.all([
    P.waitForNavigation({ waitUntil: 'load' }).catch(() => null),
    P.evaluate(() => window.dispatchEvent(new Event('vite:preloadError'))),
  ]);
  await P.waitForSelector('.dock', { state: 'visible' });
  const gestempelt = await P.evaluate(() => sessionStorage.getItem('pixinotes-neu-geladen'));
  pruefe('D2 ein Nachlade-Fehler lädt die Seite neu und merkt sich den Build-Stempel', !!gestempelt && /\d{4}-\d{2}-\d{2}/.test(gestempelt) && navsVorher === 1, String(gestempelt));
  // Zweiter Fehler im selben Build: KEIN Neuladen mehr (keine Schleife)
  await P.evaluate(() => { window.__m321 = 1; window.dispatchEvent(new Event('vite:preloadError')); });
  await P.waitForTimeout(1500);
  const nochDa = await P.evaluate(() => window.__m321);
  pruefe('D3 ein zweiter Fehler im selben Build lädt NICHT erneut (keine Schleife)', nochDa === 1, String(nochDa));
  await ctx.close();
}

// ══ F: Ein-Datei-Fassung ════════════════════════════════════════════
console.log('\n════ F: Ein-Datei-Fassung ════');
{
  const rel = path.join(__repo, 'release', 'pixinotes.html');
  const html = existsSync(rel) ? readFileSync(rel, 'utf8') : '';
  pruefe('F1 release/pixinotes.html ist EINE Datei mit eingebettetem Mermaid (> 8 MB, kein <script src>)', html.length > 8_000_000 && /mermaid/.test(html) && !/<script[^>]+src=/.test(html), String(html.length));
}

// ══ G: Texte ════════════════════════════════════════════════════════
console.log('\n════ G: Texte ════');
{
  const code = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt „Schneller Start (M321)"', code.includes('Schneller Start (M321)'));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
