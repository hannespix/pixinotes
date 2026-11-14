/**
 * M369 — Der Radierer hat keine Farbwahl.
 *
 * In der Zeichenleiste standen beim Radierer dieselben Farbpunkte und der Farbwähler wie beim Stift; sie
 * taten dort nichts (Nutzerfrage: „Warum gibt's beim Radierer eine Farbauswahl?").
 *
 *   A  Stift und Textmarker: Farbpunkte und Farbwähler sind da.
 *   B  Radierer: keine Farbpunkte, kein Farbwähler, kein hängender Trennstrich, kein ✨ — aber Art und Größe.
 *   C  Die gewählte Stiftfarbe überlebt den Ausflug zum Radierer.
 *   D  Telefon: Die Radierer-Leiste passt in die Breite.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m369-radierer-ohne-farbe.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4587;
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
const stand = {
  boards: [{ id: 'b1', name: 'Stift', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 200, position: { x: 40, y: 60 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Rand' }] } }] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const seite = async (breite, hoehe, touch = false) => {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand);
  const P = await ctx.newPage();
  P.fehler = [];
  P.on('pageerror', (e) => P.fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return P;
};
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(300);
};
const leiste = (P) => P.evaluate(() => {
  const l = document.querySelector('.draw-palette');
  if (!l) return null;
  const sichtbar = (el) => el.getClientRects().length > 0;
  const r = l.getBoundingClientRect();
  const kinder = [...l.children].filter(sichtbar);
  return {
    farben: [...l.querySelectorAll('.draw-swatch')].filter(sichtbar).length,
    aktiv: l.querySelector('.draw-swatch.active')?.style.background ?? '',
    waehler: [...l.querySelectorAll('input[type="color"]')].filter(sichtbar).length,
    groessen: [...l.querySelectorAll('.draw-dicke')].filter(sichtbar).length,
    regler: [...l.querySelectorAll('.draw-regler')].filter(sichtbar).length,
    arten: [...l.querySelectorAll('.draw-radierer-art')].filter(sichtbar).length,
    hinweis: l.querySelector('.draw-hint')?.textContent.trim() ?? '',
    tipp: l.querySelector('.draw-hint')?.getAttribute('title') ?? '',
    // steht ein Trennstrich direkt vor dem Hinweis, trennt er nichts mehr ab
    trennerVorHinweis: kinder.some((k, i) => k.classList.contains('draw-trenner') && kinder[i + 1]?.classList.contains('draw-hint')),
    links: Math.round(r.left), rechts: Math.round(r.right), zeilen: new Set(kinder.map((k) => Math.round(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2))).size,
    breite: window.innerWidth,
  };
});

console.log('════ A: Stift und Textmarker ════');
const P = await seite(1400, 1000);
await werkzeug(P, 'Stift');
let z = await leiste(P);
pruefe('A1 Stift: Farbpunkte und Farbwähler', z.farben >= 4 && z.waehler === 1 && z.hinweis.startsWith('Stift'), JSON.stringify(z));
const stiftFarben = z.farben;
await P.locator('.draw-palette .draw-swatch').nth(2).click(); await P.waitForTimeout(200);
const gewaehlt = (await leiste(P)).aktiv;
pruefe('A2 eine andere Stiftfarbe lässt sich wählen', !!gewaehlt, gewaehlt);
await werkzeug(P, 'Textmarker');
z = await leiste(P);
pruefe('A3 Textmarker: Farbpunkte und Farbwähler', z.farben >= 3 && z.waehler === 1 && z.hinweis.startsWith('Textmarker'), JSON.stringify(z));

console.log('════ B: Radierer ════');
await werkzeug(P, 'Radierer');
z = await leiste(P);
pruefe('B1 keine Farbpunkte', z.farben === 0, String(z.farben));
pruefe('B2 kein Farbwähler', z.waehler === 0, String(z.waehler));
pruefe('B3 Art (Teil / Strich) und Größe (drei Stufen, Regler) sind da', z.arten === 2 && z.groessen === 3 && z.regler === 1, JSON.stringify(z));
pruefe('B4 kein Trennstrich, der nichts mehr abtrennt', !z.trennerVorHinweis);
pruefe('B5 „Radierer" ohne ✨ und ohne den Formen-Tipp', z.hinweis === 'Radierer' && !z.tipp.includes('Form') && z.tipp.length > 5, JSON.stringify([z.hinweis, z.tipp]));
await P.locator('.draw-palette .draw-radierer-art').nth(1).click(); await P.waitForTimeout(200);
const tipp2 = (await leiste(P)).tipp;
pruefe('B6 der Tipp nennt die gewählte Radierer-Art', tipp2 !== z.tipp && tipp2.includes('Striche'), tipp2);
await P.locator('.draw-palette .draw-radierer-art').nth(0).click();
pruefe('B7 eine Zeile, im Fenster', z.zeilen === 1 && z.links >= 0 && z.rechts <= z.breite, JSON.stringify(z));

console.log('════ C: Die Farbe überlebt ════');
await werkzeug(P, 'Stift');
z = await leiste(P);
pruefe('C1 zurück beim Stift: dieselben Farbpunkte, dieselbe Farbe gewählt', z.farben === stiftFarben && z.aktiv === gewaehlt && z.waehler === 1, JSON.stringify([z.farben, z.aktiv, gewaehlt]));
pruefe('C2 kein Fehler der Seite', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 200));
await P.context().close();

console.log('════ D: Telefon ════');
const T = await seite(390, 800, true);
const dock = T.locator('.dock [aria-label="Zeichnen"]');
if (await dock.count()) {
  await werkzeug(T, 'Radierer');
  z = await leiste(T);
  pruefe('D1 Radierer-Leiste ohne Farben, innerhalb der Breite', !!z && z.farben === 0 && z.waehler === 0 && z.links >= 0 && z.rechts <= z.breite, JSON.stringify(z));
  await werkzeug(T, 'Stift');
  const s = await leiste(T);
  pruefe('D2 sie ist schmaler als die Stift-Leiste oder gleich — nie breiter', !!s && (z.rechts - z.links) <= (s.rechts - s.links), JSON.stringify([z, s]));
} else {
  pruefe('D1 Zeichnen ist am Telefon erreichbar', false, 'Knopf fehlt');
}
await T.context().close();

console.log('════ E: Texte ════');
pruefe('E1 Hilfe nennt M369', readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8').includes('(M369)'));

await browser.close(); app.close();
console.log(`\nm369-radierer-ohne-farbe: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
