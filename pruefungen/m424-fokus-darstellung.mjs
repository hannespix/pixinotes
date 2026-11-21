/**
 * M424 — Karten-Fokus: Darstellung einstellbar wie in der Präsentation.
 *
 * Gemeldet: „Im Fokus-Modus wird der Inhalt immer auf die volle Seitenbreite gestreckt und das UI auch unnötig groß
 * dargestellt. Man kann die Skalierung nicht umstellen. Das wäre aber praktisch. Immer Seitenbreite ist nicht immer
 * sinnvoll! Bitte einstellbar machen wie beim Präsentationsmodus."
 *
 *   A  Oben im Fokus ein Knopf „Darstellung" mit Menü: Automatisch, Einpassen, Seitenbreite, Originalgröße; − % +.
 *   B  Originalgröße: die Karte wie auf dem Board (100 %), die Bedienung in normaler Größe.
 *   C  Seitenbreite: die Karte so breit wie die Fläche.  D  Einpassen: die ganze Karte zwischen Kopf- und Fußleiste.
 *   E  − / + verkleinern und vergrößern von der gewählten Darstellung aus; der Knopf zeigt dann die Prozent.
 *   F  Die Darstellung bleibt gemerkt (auch nach dem Neuladen); die Stufe beginnt bei jeder Karte neu.
 *   G  Telefon: „Automatisch" füllt wie bisher die Schirmbreite, „Originalgröße" lässt die Karte, wie sie ist.
 *   H  Esc schließt nur das Menü, nicht den Fokus.
 *   I  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m424-fokus-darstellung.mjs`
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
const PORT = 4762;
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
const KARTEN = [
  { id: 'k1', type: 'kanban', position: { x: 0, y: 0 }, width: 420, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße', col: 1 }] } },
  { id: 'g1', type: 'gantt', width: 520, height: 240, position: { x: 500, y: 0 }, data: { title: 'Plan', rows: [{ id: 'r1', name: 'Vorgang A', start: '2026-11-02', end: '2026-11-09' }] } },
];
const KANTEN = [{ id: 'e1', source: 'k1', target: 'g1', type: 'floating', data: {} }];
const auf = async (opt = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opt });
  await ctx.addInitScript(([n, e]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: e, drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false } }));
  }, [KARTEN, KANTEN]);
  const P = await ctx.newPage();
  P.on('pageerror', (er) => fehler.push(er.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
};
const fokusAuf = async (P, id) => {
  const k = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  await P.mouse.click(k.x + Math.min(150, k.width / 2), k.y + 14); await P.waitForTimeout(250);
  await P.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => el.focus());
  await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
};
const stand = (P) => P.evaluate(() => {
  const k = document.querySelector('.react-flow__node.pn-focused'); const r = k?.getBoundingClientRect();
  const m = /scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '');
  const pane = document.querySelector('.react-flow').getBoundingClientRect();
  const kopf = document.querySelector('.focus-head')?.getBoundingClientRect(); const fuss = document.querySelector('.focus-nav')?.getBoundingClientRect();
  return { id: k?.dataset.id, zoom: m ? +m[1] : null, l: r?.left, t: r?.top, r: r?.right, b: r?.bottom, w: r?.width, ow: k?.offsetWidth, paneW: pane.width, paneL: pane.left, kopfU: kopf?.bottom, fussO: fuss?.top,
    knopf: document.querySelector('[data-taste="fokus-ansicht"]')?.textContent.trim() ?? null, attr: document.documentElement.dataset.fokusAnsicht ?? null };
});
const waehle = async (P, a) => {
  if (!(await P.locator('[data-taste="fokus-ansicht-menu"]').count())) await P.locator('[data-taste="fokus-ansicht"]').click();
  await P.locator(`[data-taste="fokus-ansicht-wahl"][data-ansicht="${a}"]`).click();
  await P.waitForTimeout(700);
};

console.log('A  Knopf und Menü');
const { ctx, P } = await auf();
await fokusAuf(P, 'k1');
const s0 = await stand(P);
await P.locator('[data-taste="fokus-ansicht"]').click(); await P.waitForTimeout(200);
const menu = await P.evaluate(() => [...document.querySelectorAll('[data-taste="fokus-ansicht-wahl"]')].map((b) => [b.dataset.ansicht, b.getAttribute('aria-checked'), b.textContent.trim()]));
pruefe('A1 Fokus offen, der Darstellungs-Knopf zeigt in „Automatisch" nur ein Symbol', s0.id === 'k1' && s0.knopf === '' && s0.attr === null, s0);
pruefe('A2 das Menü bietet Automatisch, Einpassen, Seitenbreite, Originalgröße – Automatisch ist gewählt', JSON.stringify(menu.map((m) => m[0])) === '["auto","einpassen","breite","original"]' && menu[0][1] === 'true' && /Originalgröße/.test(menu[3][2]), menu);
pruefe('A3 … und die Stufe mit − und +', (await P.locator('[data-taste="fokus-kleiner"]').count()) === 1 && (await P.locator('[data-taste="fokus-groesser"]').count()) === 1 && /%$/.test(await P.locator('[data-taste="fokus-stufe"]').textContent()));
await P.keyboard.press('Escape'); await P.waitForTimeout(250);
pruefe('H1 Esc schließt nur das Menü – der Fokus bleibt', (await P.locator('[data-taste="fokus-ansicht-menu"]').count()) === 0 && (await stand(P)).id === 'k1');

console.log('B/C/D  Darstellungen');
await waehle(P, 'original');
const sB = await stand(P);
pruefe('B1 Originalgröße: Zoom 100 %, die Karte so groß wie auf dem Board, der Knopf zeigt „100 %"', Math.abs(sB.zoom - 1) < 0.01 && Math.abs(sB.w - sB.ow) < 2 && sB.knopf === '100 %' && sB.attr === 'original', sB);
await P.screenshot({ path: path.join(SD, 'm424-original.png') });
await waehle(P, 'breite');
const sC = await stand(P);
pruefe('C1 Seitenbreite: die Karte fast so breit wie die Fläche', sC.w > sC.paneW - 60 && sC.w <= sC.paneW + 1, sC);
await waehle(P, 'einpassen');
const sD = await stand(P);
pruefe('D1 Einpassen: die ganze Karte zwischen Kopf- und Fußleiste, so groß wie möglich', sD.t >= sD.kopfU - 1 && sD.b <= sD.fussO + 1 && sD.l >= sD.paneL - 1 && (sD.b - sD.t > (sD.fussO - sD.kopfU) * 0.85 || sD.w > sD.paneW * 0.85), sD);

console.log('E  Stufe');
await P.locator('[data-taste="fokus-ansicht"]').click(); await P.waitForTimeout(150);
await P.locator('[data-taste="fokus-groesser"]').click(); await P.waitForTimeout(600);
const sE1 = await stand(P);
await P.locator('[data-taste="fokus-kleiner"]').click(); await P.waitForTimeout(300);
await P.locator('[data-taste="fokus-kleiner"]').click(); await P.waitForTimeout(1100);
const sE2 = await stand(P);
// (ein Modul passt seine Bedienung der Zoomstufe an — ändert sich dabei seine Höhe, rechnet „Einpassen" einmal nach)
pruefe('E1 + vergrößert um ein Viertel, zweimal − verkleinert unter die Darstellung', Math.abs(sE1.zoom / sD.zoom - 1.25) < 0.02 && sE2.zoom < sD.zoom * 0.92, { d: sD.zoom, plus: sE1.zoom, minus: sE2.zoom });
pruefe('E2 der Knopf zeigt die Prozent, das Menü bleibt für weitere Schritte offen', sE2.knopf === `${Math.round(sE2.zoom * 100)} %` && (await P.locator('[data-taste="fokus-ansicht-menu"]').count()) === 1, sE2);
await P.keyboard.press('Escape');

console.log('F  Gemerkt');
await P.locator('[data-taste="fokus-karte-vor"]').click(); await P.waitForTimeout(1300);
const sF1 = await stand(P);
pruefe('F1 nächste Karte: wieder „Einpassen", ohne die Stufe der vorigen', sF1.id === 'g1' && sF1.attr === 'einpassen' && sF1.b <= sF1.fussO + 1 && sF1.t >= sF1.kopfU - 1, sF1);
await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1600);
await fokusAuf(P, 'k1');
const sF2 = await stand(P);
pruefe('F2 nach dem Neuladen gilt „Einpassen" weiter', sF2.attr === 'einpassen' && Math.abs(sF2.zoom - sD.zoom) < 0.02 && await P.evaluate(() => localStorage.getItem('pixinotes-fokus-ansicht') === 'einpassen'), sF2);
await waehle(P, 'auto');
const sF3 = await stand(P);
pruefe('F3 zurück auf Automatisch: die bisherige Darstellung', Math.abs(sF3.zoom - s0.zoom) < 0.02 && sF3.attr === null && await P.evaluate(() => localStorage.getItem('pixinotes-fokus-ansicht') === null), { s0: s0.zoom, f3: sF3.zoom });
await ctx.close();

console.log('G  Telefon');
{
  const { ctx: c2, P: T } = await auf({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await fokusAuf(T, 'k1');
  const a = await stand(T);
  pruefe('G1 Automatisch: das Modul füllt die Schirmbreite (wie bisher)', a.ow >= 370 && a.w <= 391, a);
  await waehle(T, 'original');
  const o = await stand(T);
  pruefe('G2 Originalgröße: die Karte behält ihre Breite (420), Zoom 100 %', o.ow === 420 && Math.abs(o.zoom - 1) < 0.01, o);
  await T.screenshot({ path: path.join(SD, 'm424-telefon-original.png') });
  await waehle(T, 'einpassen');
  const e = await stand(T);
  pruefe('G3 Einpassen am Telefon: die ganze Karte im Bild', e.l >= -1 && e.r <= 391 && e.b <= e.fussO + 1, e);
  await c2.close();
}

console.log('I  Hilfe');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('I1 Hilfe nennt M424 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M424)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M424)'));
pruefe('I2 docs/UMBAU.md führt M424', quelle('docs/UMBAU.md').includes('M424'));
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM424: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
