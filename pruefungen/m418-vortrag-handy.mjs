/**
 * M418 — Präsentation auf dem Handy: „Präsentation beenden" bleibt immer erreichbar.
 *
 * Gemeldet: „Wenn man im Präsentationsmodus auf einem Handy ist, kommt man nicht an den Schließen-Button ran.
 * Der rutscht irgendwie übers Bild raus, und man kann die Präsentation dann quasi nicht mehr schließen."
 *
 * Zwei Ursachen: Die Kopfzeile hatte mehr Knöpfe, als auf einen schmalen Schirm passen — „Beenden" stand
 * ganz rechts und wurde hinausgeschoben. Und die Präsentation lag unter Statusleiste und Kerbe
 * (viewport-fit=cover), wo kein Finger hinkommt.
 *
 *   A  Telefone hoch und quer, Folie und Tool: der Knopf liegt ganz im Bild und wird getroffen.
 *   B  Enge Kopfzeile: erst nur Symbole, dann zwei Zeilen (Name und Beenden oben) — am Laptop bleibt alles beim Alten.
 *   C  Sichere Ränder (Kerbe, Home-Leiste): Kopf- und Fußzeile liegen innerhalb.
 *   D  Ein Tool als Folie: Die Kopfzeile zieht sich zurück — die Greifkante liegt unter der Statusleiste,
 *      ein Tippen holt sie, „Beenden" schließt.
 *   E  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m418-vortrag-handy.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4752;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const nodes = [
  { id: 'n1', type: 'note', width: 280, position: { x: 0, y: 0 }, data: { color: 'mint', blocks: [{ id: 'w1', type: 'paragraph', content: 'Hallo' }] } },
  { id: 'h1', type: 'htmlapp', width: 400, height: 300, position: { x: 400, y: 0 }, data: { name: 'Rechner', size: 0 } },
];
const stand = { boards: [{ id: 'b1', name: 'Messeauftritt Frühjahr – Entwürfe und Abstimmung', edges: [], drawings: [], comments: [], nodes }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board' };

async function auf(viewport, { telefon = true, rand = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'de-DE', ...(telefon ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  if (rand) { const c = await ctx.newCDPSession(P); await c.send('Emulation.setSafeAreaInsetsOverride', { insets: rand }); }
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1400);
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(700);
  return { ctx, P };
}
const knopf = (P) => P.evaluate(() => {
  const k = document.querySelector('[aria-label="Präsentation beenden"]'); if (!k) return null;
  const r = k.getBoundingClientRect(); const h = document.querySelector('.presenter-head');
  const getroffen = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[aria-label="Präsentation beenden"]') === k;
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, getroffen, eng: h.dataset.eng, ueber: h.scrollWidth - h.clientWidth,
    name: h.firstElementChild.getBoundingClientRect().width, nameOben: Math.abs(h.firstElementChild.getBoundingClientRect().top - r.top) < 30 };
});
const imBild = (k, rand = { top: 0, bottom: 0, left: 0, right: 0 }) => !!k && k.getroffen && k.l >= rand.left && k.t >= rand.top && k.r <= k.vw - rand.right && k.b <= k.vh - rand.bottom;

console.log('A  Telefone');
for (const [name, vp] of [['320 × 568', { width: 320, height: 568 }], ['360 × 740', { width: 360, height: 740 }], ['390 × 844', { width: 390, height: 844 }], ['430 × 932', { width: 430, height: 932 }], ['quer 844 × 390', { width: 844, height: 390 }]]) {
  const { ctx, P } = await auf(vp);
  const f = await knopf(P);
  const nurSymbol = await P.evaluate(() => getComputedStyle(document.querySelector('.presenter-laser .presenter-wort')).display === 'none');
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(700);
  const t = await knopf(P);
  pruefe(`A ${name}: Beenden ganz im Bild und antippbar – Notiz und Tool`, imBild(f) && imBild(t) && f.ueber <= 0 && t.ueber <= 0, { f, t });
  if (name === '320 × 568') {
    await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(500);
    await P.screenshot({ path: path.join(SD, 'm418-320.png') });
    pruefe('B1 320 px: zwei Zeilen – oben Name und Beenden, der Name lesbar', f.eng === '2' && f.nameOben && f.name >= 100, f);
    await P.locator('[aria-label="Präsentation beenden"]').tap(); await P.waitForTimeout(500);
    pruefe('B2 Tippen auf Beenden schließt die Präsentation', (await P.locator('.presenter').count()) === 0);
  }
  if (name === '390 × 844') pruefe('B3 390 px: eine Zeile, Knöpfe nur als Symbol, der Name bleibt sichtbar', f.eng === '1' && f.name >= 60 && nurSymbol && (await P.locator('[data-taste="vortrag-laser"]').getAttribute('aria-label')) === 'Laser', f);
  await ctx.close();
}
{
  const { ctx, P } = await auf({ width: 1440, height: 900 }, { telefon: false });
  const k = await knopf(P);
  pruefe('B4 am Laptop bleibt die Kopfzeile, wie sie war (eine Zeile, „Laser" ausgeschrieben)', k.eng === '0' && imBild(k) && await P.evaluate(() => getComputedStyle(document.querySelector('.presenter-laser .presenter-wort')).display !== 'none'), k);
  await ctx.close();
}

console.log('C  Sichere Ränder');
{
  const rand = { top: 47, bottom: 34, left: 0, right: 0 };
  const { ctx, P } = await auf({ width: 390, height: 844 }, { rand });
  const k = await knopf(P);
  const fuss = await P.evaluate(() => { const r = document.querySelector('[data-taste="vortrag-weiter"]')?.getBoundingClientRect(); return r ? r.bottom : null; });
  pruefe('C1 hochkant mit Kerbe: Beenden liegt unter der Statusleiste', imBild(k, rand), k);
  pruefe('C2 „Weiter" liegt über der Home-Leiste', fuss !== null && fuss <= 844 - 34, String(fuss));
  await P.screenshot({ path: path.join(SD, 'm418-kerbe.png') });
  await ctx.close();
}
{
  const rand = { top: 0, bottom: 21, left: 47, right: 47 };
  const { ctx, P } = await auf({ width: 844, height: 390 }, { rand });
  const k = await knopf(P);
  pruefe('C3 quer mit Kerbe: Beenden liegt neben der Kerbe', imBild(k, rand), k);
  await ctx.close();
}

console.log('D  Tool als Folie');
{
  const rand = { top: 47, bottom: 34, left: 0, right: 0 };
  const { ctx, P } = await auf({ width: 390, height: 844 }, { rand });
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(3200);
  const weg = await P.evaluate(() => { const r = document.querySelector('[aria-label="Präsentation beenden"]').getBoundingClientRect(); return r.bottom; });
  pruefe('D1 die Kopfzeile hat sich zurückgezogen', weg <= 47, String(weg));
  await P.touchscreen.tap(195, 47 + 8); await P.waitForTimeout(500);
  const k = await knopf(P);
  pruefe('D2 ein Tippen knapp unter der Statusleiste holt sie zurück – Beenden ist erreichbar', imBild(k, rand), k);
  await P.locator('[aria-label="Präsentation beenden"]').tap(); await P.waitForTimeout(500);
  pruefe('D3 Beenden schließt', (await P.locator('.presenter').count()) === 0);
  await ctx.close();
}

console.log('E  Hilfe');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('E1 Hilfe nennt M418 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M418)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M418)'));
pruefe('E2 docs/UMBAU.md führt M418', quelle('docs/UMBAU.md').includes('M418'));
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM418: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
