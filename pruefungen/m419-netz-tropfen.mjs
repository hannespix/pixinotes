/**
 * M419 — Das Netz im Tropfen-Look, ruhiger und flüssiger.
 *
 * Gemeldet: „…wenn man die Netzansicht bei der Übersicht auch noch mit den neuen Tropfen-Bubbles gestalten könnte
 * und die Netzansicht ein bisschen überarbeiten kann, damit sie schöner ist. … leistungsoptimiert, weil die
 * Netzansicht oft für Ruckler sorgt, wenn alles eingeblendet ist."
 *
 *   A  Tropfen: Boards als flache Pastell-Tropfen in der Farbe ihres Bereichs (sanfter Verlauf, kein Schatten, kein
 *      Glanz — „Der 3D-Effekt passt nicht zum sleeken Flat-Design"), Karten-Punkte
 *      als kleine Tropfen; Bereiche und Projekte als randlose Inseln aus verschmolzenen Kreisen; Wikilinks als
 *      Perlenschnur; Bereichsnamen in der Serife; Ebenen-Schalter als leise Chips.
 *   B  Leistung: kein SVG-Filter im Netz; der Ausschnitt bewegt eine HTML-Ebene (will-change nur während der
 *      Bewegung, danach scharf); Zoomen hält den Takt.
 *   C  Bedienung wie zuvor: Board treffen, ziehen (die Insel zieht mit), öffnen; Chips schalten die Ebenen.
 *   D  Dunkler Modus: leisere Inseln.
 *   E  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m419-netz-tropfen.mjs`
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
const PORT = 4754;
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
// ---------- Stand wie im Screenshot: zwei Bereiche, fünf Projekte, 13 Boards ----------
const note = (id, text, x, y) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
let nId = 0;
const board = (id, name, karten, texte = []) => {
  const nodes = texte.map((t, i) => note(`n${nId++}`, t, 60 + (i % 3) * 300, 60 + Math.floor(i / 3) * 220));
  for (let i = nodes.length; i < karten; i += 1) nodes.push(note(`n${nId++}`, `${name} · Karte ${i + 1}`, 60 + (i % 3) * 300, 60 + Math.floor(i / 3) * 220));
  return { id, name, edges: [], drawings: [], comments: [], nodes };
};
const state = {
  boards: [
    board('b1', 'Schulbesuche', 3),
    board('b2', 'Beratungsfälle', 21, ['Siehe [[Fachwerker]] und [[Prüferentschädigungen]]']),
    board('b3', 'Prüferentschädigungen', 4),
    board('b4', 'Fachwerker', 0),
    board('b5', 'Karriere RPF', 7),
    board('b6', 'Qualifizierung', 5),
    board('b7', 'Jour Fixe', 17, ['Themen: [[Abschluss-Prüfungen]], [[Beratungsfälle]]']),
    board('b8', 'Abschluss-Prüfungen', 6),
    board('b9', 'Ultimativer Urlaub', 8, ['Nächste Reise: [[Amrum 2026]]']),
    board('b10', 'Amrum 2026', 8, ['Vorher noch: [[Jour Fixe]], [[Schulbesuche]], [[Beratungsfälle]]']),
    board('b11', 'Kochen/Einkaufen', 8),
    board('b12', 'Software Tools', 3),
    board('b13', 'Trading', 3),
  ],
  spaces: [
    { id: 's1', name: 'Arbeit', projects: [
      { id: 'p1', name: 'Prüfung', boardIds: ['b1', 'b2', 'b3', 'b4'] },
      { id: 'p2', name: 'Laufbahn', boardIds: ['b5', 'b6'] },
      { id: 'p3', name: 'Termine', boardIds: ['b7', 'b8'] },
    ] },
    { id: 's2', name: 'Privat', projects: [
      { id: 'p4', name: 'Reisen', boardIds: ['b9', 'b10'] },
      { id: 'p5', name: 'Haushalt', boardIds: ['b11', 'b12', 'b13'] },
    ] },
  ],
  activeId: 'b1', view: 'overview', graphLayers: { cards: true, portals: true, wikis: true, regionen: true, physik: true, projectOnly: false },
};

async function seite(dunkel = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, state);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  await P.locator('.ov-mode button', { hasText: 'Netz' }).click();
  await P.waitForSelector('.ov-graph-node[data-board]');
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const takt = (P, wie) => P.evaluate(async (wie) => {
  const t = []; let last = performance.now(); let an = true;
  const f = (n) => { t.push(n - last); last = n; if (an) requestAnimationFrame(f); }; requestAnimationFrame(f);
  const el = document.querySelector('.ov-graph-svg'); const r = el.getBoundingClientRect();
  for (let i = 0; i < 40; i++) {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: i < 20 ? -50 : 50, ctrlKey: wie === 'pinch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
    await new Promise((x) => setTimeout(x, 25));
  }
  an = false; await new Promise((x) => setTimeout(x, 40));
  t.sort((a, b) => a - b); return { n: t.length, median: t[Math.floor(t.length / 2)], p90: t[Math.floor(t.length * 0.9)] };
}, wie);

console.log('A  Tropfen');
const { ctx, P } = await seite();
const a = await P.evaluate(() => {
  const g = document.querySelector('.ov-graph-node[data-board="b9"]');
  const tropfen = g.querySelector('circle.ov-tropfen');
  const grad = document.getElementById((tropfen.getAttribute('fill').match(/#([^)]+)/) ?? [])[1]);
  const stops = grad ? [...grad.querySelectorAll('stop')].map((s) => getComputedStyle(s).stopColor) : [];
  const inseln = [...document.querySelectorAll('.ov-insel')].map((i) => ({ k: i.className.baseVal, kreise: i.querySelectorAll('circle').length, bruecken: i.querySelectorAll('line').length, op: +getComputedStyle(i).opacity }));
  const wiki = document.querySelector('.ov-kante-wiki');
  const huelle = document.querySelector('.ov-region path');
  const spaceText = document.querySelector('.ov-region-space text');
  return {
    fill: tropfen.getAttribute('fill'), stops, flach: grad?.tagName === 'linearGradient' && !g.querySelector('ellipse') && !document.querySelector('.ov-graph-svg radialGradient'),
    letzterKreis: [...g.querySelectorAll('circle')].pop() === tropfen,
    punkte: [...document.querySelectorAll('.ov-graph-dot circle')].slice(0, 3).map((c) => c.getAttribute('fill')),
    inseln, wiki: wiki && wiki.getAttribute('stroke-dasharray'), wikiCap: wiki && getComputedStyle(wiki).strokeLinecap,
    huelle: huelle && +getComputedStyle(huelle).fillOpacity, raumSchrift: spaceText && getComputedStyle(spaceText).fontFamily,
  };
});
pruefe('A1 ein Board ist ein flacher Tropfen in der Farbe seines Bereichs (Privat = zweite Farbe): sanfter Verlauf, kein Schatten, kein Glanz', a.fill === 'url(#netz-tropfen-1)' && a.stops.length === 3 && new Set(a.stops).size === 3 && a.flach && a.letzterKreis, a);
pruefe('A2 die Karten-Punkte sind kleine Tropfen', a.punkte.length > 0 && a.punkte.every((f) => /^url\(#netz-tropfen-\d\)$/.test(f ?? '')), a.punkte);
const raum = a.inseln.filter((i) => / ov-insel-space/.test(i.k)); const proj = a.inseln.filter((i) => / ov-insel-project/.test(i.k));
pruefe('A3 Bereiche und Projekte sind Inseln: je Board ein Kreis, Brücken verbinden alle (Spannbaum)', raum.length === 2 && proj.length === 5 && a.inseln.every((i) => i.kreise >= 1 && i.bruecken === i.kreise - 1) && raum.some((i) => i.kreise === 8), a.inseln);
pruefe('A4 randlos und leise: die Hülle selbst ist unsichtbar, die Inseln sind zarte Flächen', a.huelle === 0 && a.inseln.every((i) => i.op > 0 && i.op < 0.12), { h: a.huelle, op: a.inseln.map((i) => i.op) });
pruefe('A5 Wikilinks als Perlenschnur (runde Punkte)', /^0[ ,]/.test(a.wiki ?? '') && a.wikiCap === 'round', a);
pruefe('A6 Bereichsnamen in der Serife', /Newsreader/.test(a.raumSchrift ?? ''), a.raumSchrift);
const chips = await P.evaluate(() => [...document.querySelectorAll('.ov-graph-toggle')].map((l) => ({ t: l.textContent.trim(), an: l.querySelector('input').checked, bg: getComputedStyle(l).backgroundColor, rund: parseFloat(getComputedStyle(l).borderRadius) > 20, kaestchen: +getComputedStyle(l.querySelector('input')).opacity })));
const an = chips.find((c) => c.an); const aus = chips.find((c) => !c.an);
pruefe('A7 Ebenen-Schalter als runde Chips – an: getönt, aus: ohne Fläche; das Kästchen bleibt unsichtbar bedienbar', an && aus && an.rund && an.bg !== aus.bg && /rgba\(0, 0, 0, 0\)|transparent/.test(aus.bg) && chips.every((c) => c.kaestchen === 0), chips);
await P.screenshot({ path: path.join(SD, 'm419-netz.png') });

console.log('B  Leistung');
const b = await P.evaluate(() => ({ filter: document.querySelectorAll('.ov-graph-svg [filter], .ov-graph-svg filter').length, ebene: document.querySelector('.ov-graph-ebene')?.tagName, trafo: document.querySelector('.ov-graph-ebene')?.style.transform, vpTrafo: document.querySelector('.ov-graph-vp')?.style.transform ?? '' }));
pruefe('B1 kein SVG-Filter im Netz (Weichzeichner kosteten beim Zoomen bis 0,5 s je Bild)', b.filter === 0, b);
pruefe('B2 der Ausschnitt bewegt eine HTML-Ebene (transform am div, nicht an der SVG-Gruppe)', b.ebene === 'DIV' && /scale\(/.test(b.trafo ?? '') && !b.vpTrafo, b);
const wc = await P.evaluate(async () => {
  const el = document.querySelector('.ov-graph-svg'); const r = el.getBoundingClientRect(); const eb = document.querySelector('.ov-graph-ebene');
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, clientX: r.left + 300, clientY: r.top + 300, bubbles: true, cancelable: true }));
  await new Promise((x) => setTimeout(x, 60));
  const waehrend = getComputedStyle(eb).willChange;
  await new Promise((x) => setTimeout(x, 450));
  return { waehrend, danach: getComputedStyle(eb).willChange };
});
pruefe('B3 will-change nur während der Bewegung – danach zeichnet der Browser wieder scharf', wc.waehrend === 'transform' && wc.danach === 'auto', wc);
const t = await takt(P, 'rad');
pruefe('B4 Zoomen mit dem Rad hält den Takt (Median ≤ 20 ms je Bild)', t.median <= 20 && t.n >= 45, t);

console.log('C  Bedienung');
const c = await P.evaluate(() => {
  const g = document.querySelector('.ov-graph-node[data-board="b2"]'); const r = g.querySelector('circle.ov-tropfen').getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  return { x, y, treffer: document.elementFromPoint(x, y)?.closest('.ov-graph-node')?.getAttribute('data-board') };
});
pruefe('C1 ein Board wird an seinem Tropfen getroffen', c.treffer === 'b2', c);
await P.mouse.move(c.x, c.y); await P.mouse.down();
for (let i = 1; i <= 12; i++) { await P.mouse.move(c.x + i * 8, c.y + i * 4); await P.waitForTimeout(16); }
const mitten = await P.evaluate(() => {
  const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(document.querySelector('.ov-graph-node[data-board="b2"]').getAttribute('transform'));
  const k = document.querySelector('.ov-insel-project circle[cx]'); const alle = [...document.querySelectorAll('.ov-insel circle')];
  const mein = alle.filter((e) => Math.abs(+e.getAttribute('cx') - +m[1]) < 0.01 && Math.abs(+e.getAttribute('cy') - +m[2]) < 0.01);
  return { x: +m[1], y: +m[2], mein: mein.length, k: !!k };
});
await P.mouse.up(); await P.waitForTimeout(300);
pruefe('C2 ziehen bewegt das Board – seine Insel-Kreise (Bereich und Projekt) ziehen mit', mitten.mein === 2, mitten);
await P.locator('.ov-graph-toggle', { hasText: 'Karten' }).click(); await P.waitForTimeout(500);
pruefe('C3 ein Chip schaltet die Ebene (Karten aus → keine Karten-Punkte)', (await P.locator('.ov-graph-dot').count()) === 0 && !(await P.locator('.ov-graph-toggle', { hasText: 'Karten' }).locator('input').isChecked()));
await P.locator('.ov-graph-toggle', { hasText: 'Karten' }).click(); await P.waitForTimeout(400);
const ziel = await P.evaluate(() => {
  for (const g of document.querySelectorAll('.ov-graph-node[data-board]:not(.here)')) {
    const r = g.querySelector('circle.ov-tropfen').getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x > 400 && x < 1300 && y > 150 && y < 820 && document.elementFromPoint(x, y)?.closest('.ov-graph-node') === g) return { id: g.dataset.board, x, y };
  }
  return null;
});
if (ziel) { await P.mouse.click(ziel.x, ziel.y); await P.waitForTimeout(900); }
pruefe('C4 ein Klick auf einen Tropfen öffnet das Board', !!ziel && await P.evaluate((id) => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId === id && !document.querySelector('.ov-graph-svg'), ziel.id), ziel);
await ctx.close();

console.log('D  Dunkel');
{
  const { ctx: c2, P: Q } = await seite(true);
  const d = await Q.evaluate(() => ({ insel: +getComputedStyle(document.querySelector('.ov-insel-space')).opacity }));
  pruefe('D1 dunkler Modus: Inseln leiser', d.insel < 0.06, d);
  await Q.screenshot({ path: path.join(SD, 'm419-netz-dunkel.png') });
  await c2.close();
}

console.log('E  Hilfe');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('E1 Hilfe nennt M419 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M419)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M419)'));
pruefe('E2 docs/UMBAU.md führt M419', quelle('docs/UMBAU.md').includes('M419'));
pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM419: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
