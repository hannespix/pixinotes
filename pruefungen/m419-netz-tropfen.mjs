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
 *
 * M423: „Netzansicht bitte tropfiger und mit mehr farbigen Verläufen wie bei den Ideabubbles … organischer."
 * Die Inseln sind jetzt zwei Canvas-Flächen (lib/netzTropfen.ts: weichzeichnen, hart schneiden, Farben laufen
 * ineinander); jedes Projekt hat einen eigenen Ton, jedes Board einen eigenen Verlauf. A1–A4, C2, D1 und F prüfen das.
 *
 * M439: „Netzansicht muss noch besser werden. Blur zu krass, Schrift verblasst hinter dem Fog … Blur-Ebene nur für
 * Farbfelder nutzen, gerne harte Kanten ohne Rand für die Blasen und Verbindungen, aber mit schönen Farbverläufen."
 * G prüft: Blasen und Punkte ohne Rand, Verbindungen im Farbverlauf von Board zu Board, Farbflächen klar begrenzt und
 * fein gerechnet, Schrift kräftig.
 */
// Läuft aus dem Repository: `node pruefungen/m419-netz-tropfen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
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
  /** Eine Fläche auswerten: Deckkraft (CSS), wie viel ist bemalt, wie viele verschiedene Töne (in 12 Stufen) */
  const flaeche = (sel) => {
    const c = document.querySelector(sel); if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let bemalt = 0; let kante = 0; const toene = new Set();
    for (let i = 0; i < d.length; i += 16) {
      const al = d[i + 3]; if (al > 200) bemalt++; else if (al > 10) kante++;
      if (al > 200) { const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn > 0.08) { let h = mx === r ? (g - b) / (mx - mn) : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h = ((h * 60) + 360) % 360; toene.add(Math.floor(h / 30)); } }
    }
    const n = d.length / 16;
    return { op: +getComputedStyle(c).opacity, bemalt: bemalt / n, kante: kante / n, toene: toene.size, gemalt: +(c.dataset.gemalt ?? 0), breite: parseFloat(c.style.width) };
  };
  const inseln = { raum: flaeche('.ov-flaeche-raum'), projekt: flaeche('.ov-flaeche-projekt') };
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
pruefe('A1 ein Board ist ein flacher Tropfen mit eigenem Verlauf (zwei Töne), kein Schatten, kein Glanz', a.fill === 'url(#nt-b9)' && a.stops.length === 2 && new Set(a.stops).size === 2 && a.flach && a.letzterKreis, a);
pruefe('A2 die Karten-Punkte tragen den Verlauf ihres Boards', a.punkte.length > 0 && a.punkte.every((f) => /^url\(#nt-b\d+\)$/.test(f ?? '')), a.punkte);
const { raum, projekt } = a.inseln;
pruefe('A3 (M423) Bereiche und Projekte sind organische Tropfen-Flächen: bemalt, mit weicher Kante, gemalt', !!raum && !!projekt && raum.bemalt > 0.1 && projekt.bemalt > 0.05 && projekt.kante > 0.005 && raum.gemalt > 0 && projekt.gemalt > 0, a.inseln);
pruefe('A4 (M423) farbig: in den Projekt-Tropfen laufen mehrere Töne ineinander (mindestens 4 von 12 Farbtonstufen)', !!projekt && projekt.toene >= 4, a.inseln);
pruefe('A4b randlos und leise: die Hülle selbst ist unsichtbar, die Flächen durchscheinend', a.huelle === 0 && raum.op > 0 && raum.op < projekt.op && projekt.op < 0.6, { h: a.huelle, raum: raum.op, projekt: projekt.op });
pruefe('A5 Wikilinks als Perlenschnur (runde Punkte)', /^0[ ,]/.test(a.wiki ?? '') && a.wikiCap === 'round', a);
pruefe('A6 Bereichsnamen in der Serife', /Newsreader/.test(a.raumSchrift ?? ''), a.raumSchrift);
const chips = await P.evaluate(() => [...document.querySelectorAll('.ov-graph-toggle')].map((l) => ({ t: l.textContent.trim(), an: l.querySelector('input').checked, bg: getComputedStyle(l).backgroundColor, rund: parseFloat(getComputedStyle(l).borderRadius) > 20, kaestchen: +getComputedStyle(l.querySelector('input')).opacity })));
const an = chips.find((c) => c.an); const aus = chips.find((c) => !c.an);
pruefe('A7 Ebenen-Schalter als runde Chips – an: getönt, aus: ohne Fläche; das Kästchen bleibt unsichtbar bedienbar', an && aus && an.rund && an.bg !== aus.bg && /rgba\(0, 0, 0, 0\)|transparent/.test(aus.bg) && chips.every((c) => c.kaestchen === 0), chips);
await P.screenshot({ path: path.join(SD, 'm419-netz.png') });

console.log('G  Sauber (M439)');
const g = await P.evaluate(() => {
  const tropfen = [...document.querySelectorAll('circle.ov-tropfen, .ov-graph-dot circle')];
  const ohneRand = tropfen.every((c) => { const cs = getComputedStyle(c); return cs.stroke === 'none' || parseFloat(cs.strokeWidth) === 0; });
  const kanten = [...document.querySelectorAll('.ov-kante-portal, .ov-kante-wiki')];
  const verlaeufe = kanten.map((k) => { const id = (/url\(["']?#([^"')]+)/.exec(k.style.stroke ?? '') ?? [])[1]; const v = id && document.getElementById(id); return v ? [...v.querySelectorAll('stop')].map((st) => getComputedStyle(st).stopColor) : null; });
  const c = document.querySelector('.ov-flaeche-projekt');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let voll = 0; let saum = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] > 245) voll++; else if (d[i] > 10) saum++; }
  const t = document.querySelector('.ov-graph-node text'); const ts = getComputedStyle(t);
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  return { ohneRand, n: tropfen.length, kanten: kanten.length, verlaeufe: verlaeufe.slice(0, 4), alleVerlauf: verlaeufe.every((v) => v && v.length === 2), bunt: verlaeufe.some((v) => v && v[0] !== v[1]),
    aufloesung: c.width, saumAnteil: saum / Math.max(1, voll + saum), schrift: { fill: ts.fill, op: +ts.fillOpacity, gewicht: +ts.fontWeight }, ink };
});
pruefe('G1 Blasen und Karten-Punkte: harte Kante ohne Rand', g.n > 5 && g.ohneRand, g);
pruefe('G2 Verbindungen im Farbverlauf von Board zu Board (ohne Rand, nicht grau)', g.kanten > 0 && g.alleVerlauf && g.bunt, g.verlaeufe);
pruefe('G3 Farbflächen klar begrenzt (schmaler Saum statt Nebel) und fein gerechnet', g.saumAnteil < 0.12 && g.aufloesung >= 600, { saum: g.saumAnteil, aufloesung: g.aufloesung });
pruefe('G4 die Schrift steht kräftig über allem (volle Deckkraft, halbfett)', g.schrift.op === 1 && g.schrift.gewicht >= 600, g.schrift);

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
// M448: Die Takt-Grenze (20 ms = 60 Hz mit Spiel) gilt für einen ruhigen Rechner. Laufen mehrere Prüfungen
// oder Agenten gleichzeitig (Last über der Kernzahl), zeichnet Chromium auch ohne eigene Schuld nur jedes zweite
// Bild – dann gilt 40 ms (30 Hz): ein echter Einbruch (100 ms je Bild) fällt weiter auf, Fremdlast nicht.
const unterLast = os.loadavg()[0] > os.cpus().length;
const taktGrenze = unterLast ? 40 : 20;
if (unterLast) console.log(`  (Rechner unter Last ${os.loadavg()[0].toFixed(1)} bei ${os.cpus().length} Kernen – Takt-Grenze ${taktGrenze} ms)`);
const t = await takt(P, 'rad');
pruefe(`B4 Zoomen mit dem Rad hält den Takt (Median ≤ ${taktGrenze} ms je Bild)`, t.median <= taktGrenze && t.n >= (unterLast ? 25 : 45), t);

console.log('C  Bedienung');
const c = await P.evaluate(() => {
  const g = document.querySelector('.ov-graph-node[data-board="b2"]'); const r = g.querySelector('circle.ov-tropfen').getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  return { x, y, treffer: document.elementFromPoint(x, y)?.closest('.ov-graph-node')?.getAttribute('data-board') };
});
pruefe('C1 ein Board wird an seinem Tropfen getroffen', c.treffer === 'b2', c);
// M423: Takt beim Ziehen — die Fläche wird dabei neu gemalt (halbe Auflösung, jedes dritte Bild)
const zugTakt = P.evaluate(async () => { const t = []; let last = performance.now(); let an = true; const f = (n) => { t.push(n - last); last = n; if (an) requestAnimationFrame(f); }; requestAnimationFrame(f); await new Promise((x) => setTimeout(x, 900)); an = false; t.sort((x, y) => x - y); return { n: t.length, median: t[Math.floor(t.length / 2)] }; });
await P.mouse.move(c.x, c.y); await P.mouse.down();
for (let i = 1; i <= 12; i++) { await P.mouse.move(c.x + i * 8, c.y + i * 4); await P.waitForTimeout(16); }
for (let i = 1; i <= 24; i++) { await P.mouse.move(c.x + 96 + Math.sin(i / 4) * 40, c.y + 48 + i); await P.waitForTimeout(16); }
const zt = await zugTakt;
pruefe(`C1b (M423) Ziehen hält den Takt, obwohl die Tropfen-Fläche mitfließt (Median ≤ ${taktGrenze} ms)`, zt.median <= taktGrenze && zt.n >= (unterLast ? 22 : 40), zt);
const vorher = await P.evaluate(() => +(document.querySelector('.ov-flaeche-projekt').dataset.gemalt ?? 0));
await P.mouse.up(); await P.waitForTimeout(1500);
const mitten = await P.evaluate(() => {
  // Liegt unter dem gezogenen Board jetzt Fläche? (Lage des Boards → Bildpunkt der Projekt-Fläche)
  const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(document.querySelector('.ov-graph-node[data-board="b2"]').getAttribute('transform'));
  const c = document.querySelector('.ov-flaeche-projekt'); const t = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(c.style.transform);
  const sx = c.width / parseFloat(c.style.width); const px = Math.floor((+m[1] - +t[1]) * sx); const py = Math.floor((+m[2] - +t[2]) * sx);
  return { gemalt: +(c.dataset.gemalt ?? 0), deck: c.getContext('2d').getImageData(px, py, 1, 1).data[3] };
});
pruefe('C2 (M423) ziehen bewegt das Board – die Tropfen-Fläche fließt mit (neu gemalt, unter dem Board deckend)', mitten.gemalt > vorher && mitten.deck > 200, { vorher, ...mitten });
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
  const d = await Q.evaluate(() => ({ raum: +getComputedStyle(document.querySelector('.ov-flaeche-raum')).opacity, projekt: +getComputedStyle(document.querySelector('.ov-flaeche-projekt')).opacity }));
  pruefe('D1 dunkler Modus: Flächen leiser als hell', d.raum < 0.2 && d.projekt < 0.46, d);
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
