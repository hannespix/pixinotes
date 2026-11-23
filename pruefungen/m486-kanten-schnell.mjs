/**
 * M486 — Ziehen mit vielen Verbindungen flüssig.
 *
 *   Z  Zählung: Beim Ziehen einer Karte auf einem Board mit 200 Karten und 100 Verbindungen zeichnen sich nur die
 *      Verbindungen neu, deren Endpunkte oder Ausweich-Hindernisse sich bewegen. Gezählt wird ohne Eingriff in die
 *      App über den React-Entwicklerhaken (gerenderte Kanten-Komponenten je Bild).
 *   L  Leistung: Bildzeit und Maus → Bild mit 100 Verbindungen gegen dasselbe Board ohne Verbindungen (die Prüf-
 *      Maschine ist oft ausgelastet — absolute Werte schwanken stark, der Abstand zum Board ohne Kanten kaum).
 *   A  Kanten weichen den gerade ausweichenden (angezeigten) Lagen aus, nicht den Lagen im Stand.
 *   R  Ruhend unverändert: dieselben Pfade wie vor dem Zug, nach dem Ablegen wie im Stand.
 */
// Läuft aus dem Repository: `node pruefungen/m486-kanten-schnell.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5486;
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

const nz = (id, x, y, farbe = 'yellow') => ({ id, type: 'note', width: 200, height: 120, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
const kante = (id, source, target) => ({ id, source, target, type: 'labeled', data: { label: '', kind: 'arrow' } });
const board = (nodes, edges) => ({
  boards: [{ id: 'b1', name: 'Viele Verbindungen', comments: [], edges, drawings: [], nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});
// 200 Karten im Raster 20 × 10, 100 Verbindungen: Nachbarn, schräg in die nächste und übernächste Reihe (viele
// laufen an fremden Karten vorbei und weichen aus — das teure Routing, M132)
const VIELE = (kanten = 100) => {
  const nodes = []; const edges = [];
  for (let i = 0; i < 200; i += 1) nodes.push(nz(`k${i}`, (i % 20) * 230, Math.floor(i / 20) * 150, i % 3 ? 'yellow' : 'sky'));
  for (let i = 0; i < kanten; i += 1) {
    const s = 2 * i; const t = (s + 1 + 20 * (i % 3)) % 200;
    edges.push(kante(`v${i}`, `k${s}`, `k${t}`));
  }
  return board(nodes, edges);
};
// Ausweichen: a wird auf b gezogen, b weicht nach unten aus — die Kante c→d lief knapp unter b durch
const AUSWEICH = () => board([
  nz('a', 0, 0), nz('b', 360, 0, 'sky'), nz('c', 0, 120, 'green'), nz('d', 780, 120, 'green'),
], [kante('w1', 'c', 'd')]);

/**
 * Zähler über den React-Entwicklerhaken (wie die React-Entwicklerwerkzeuge): je Commit die Kanten-Komponenten, die
 * wirklich gerendert haben (Fasern, die in diesem Commit neu entstanden oder mit „PerformedWork" markiert sind;
 * unberührte Teilbäume werden übersprungen). Kanten-Komponente = Funktionskomponente mit `sourceX` in den Props.
 */
const HAKEN = () => {
  const zaehl = { an: false, renders: 0, je: {}, commits: 0 };
  window.__pnZaehl = zaehl;
  const besuchen = (f) => {
    for (let c = f.child; c; c = c.sibling) {
      const neu = !c.alternate;
      if (typeof c.type === 'function' && c.memoizedProps && 'sourceX' in c.memoizedProps && 'sourcePosition' in c.memoizedProps) {
        if (neu || (c.flags & 1)) { zaehl.renders += 1; const id = c.memoizedProps.id; zaehl.je[id] = (zaehl.je[id] ?? 0) + 1; }
      }
      // Kinder wurden in diesem Commit nicht angefasst → Teilbaum überspringen
      if (!neu && c.child === c.alternate.child) continue;
      besuchen(c);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(_id, root) { if (!zaehl.an) return; zaehl.commits += 1; const cur = root.current; if (cur.alternate && cur.child === cur.alternate.child) return; besuchen(cur); },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
};

async function seite(st, { zaehlen = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  if (zaehlen) await ctx.addInitScript(HAKEN);
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const rahmen = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, id);
const zoomVon = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const pfade = (P) => P.evaluate(() => Object.fromEntries([...document.querySelectorAll('.react-flow__edge')].map((e) => [e.dataset.id, e.querySelector('path.react-flow__edge-path')?.getAttribute('d') ?? ''])));
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`) ?? document.querySelector(`.react-flow__node[data-id="${id}"]`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 12)]; }, id);

/* ═══════════════════════ Zählung ═══════════════════════ */
console.log('\n════ Z: welche Verbindungen zeichnen sich beim Ziehen neu? ════');
{
  const { ctx, P } = await seite(VIELE(), { zaehlen: true });
  const n = await P.evaluate(() => [document.querySelectorAll('.react-flow__node').length, document.querySelectorAll('.react-flow__edge').length]);
  pruefe('Z0 200 Karten, 100 Verbindungen sichtbar', n[0] >= 200 && n[1] >= 100, n);
  const haken = await P.evaluate(() => !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size);
  pruefe('Z0b der Zähler hängt an React', haken);
  const vorher = await pfade(P);
  // k42 trägt die Verbindung v21 (k42 → k63); gezogen wird ein Stück nach rechts unten durch freie Fläche
  const r = await rahmen(P, 'k42');
  await P.mouse.move(r.cx, r.cy); await P.mouse.down();
  await P.mouse.move(r.cx + 3, r.cy + 3, { steps: 2 }); await P.mouse.move(r.cx + 6, r.cy + 6, { steps: 2 });
  await P.waitForTimeout(300);
  await P.evaluate(() => { const z = window.__pnZaehl; z.an = true; z.renders = 0; z.je = {}; z.commits = 0; });
  const SCHRITTE = 20;
  for (let i = 1; i <= SCHRITTE; i += 1) { await P.mouse.move(r.cx + 6 + i * 4, r.cy + 6 + i * 2); await P.waitForTimeout(30); }
  await P.waitForTimeout(200);
  const z = await P.evaluate(() => { const z = window.__pnZaehl; z.an = false; return { renders: z.renders, je: z.je, commits: z.commits }; });
  await P.mouse.up(); await P.waitForTimeout(900);
  const ids = Object.keys(z.je);
  const jeSchritt = z.renders / SCHRITTE;
  console.log(`  (${z.commits} Commits, ${z.renders} Kanten-Renders = ${jeSchritt.toFixed(1)} je Mausbewegung, ${ids.length} verschiedene: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ' …' : ''})`);
  pruefe('Z1 die Verbindung der gezogenen Karte zeichnet sich mit (v21)', (z.je.v21 ?? 0) >= SCHRITTE / 2, z.je);
  // in der Nähe von k42 liegen gut ein Dutzend Verbindungen (Endpunkte ausweichender Nachbarn, Korridor der Kurven)
  pruefe('Z2 höchstens 20 der 100 Verbindungen zeichnen sich überhaupt neu (vorher alle 100)', ids.length <= 20, { anzahl: ids.length, ids });
  pruefe('Z3 je Mausbewegung im Schnitt höchstens 40 Kanten-Renders (vorher über 200)', jeSchritt <= 40, { jeSchritt });
  // v90, v93, v96, v99 verbinden Nachbarn in der untersten Reihe, weit weg von k42
  pruefe('Z4 weit entfernte Verbindungen (unterste Reihe) zeichnen sich nie neu', ['v90', 'v93', 'v96', 'v99'].every((id) => !ids.includes(id)), ids);
  const nachher = await pfade(P);
  const geaendert = Object.keys(vorher).filter((k) => vorher[k] !== nachher[k]);
  pruefe('R1 nach dem Ablegen hat sich die Verbindung der Karte geändert, die ferne unterste Reihe nicht', geaendert.includes('v21') && ['v90', 'v93', 'v96', 'v99'].every((k) => !geaendert.includes(k)), geaendert);
  // Rückgängig: alle 100 Pfade wieder genau wie vor dem Zug (Routing und Ausweichen im Stand unverändert)
  await P.mouse.click(1420, 880); await P.waitForTimeout(200);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(900);
  const zurueck = await pfade(P);
  const abweichend = Object.keys(vorher).filter((k) => vorher[k] !== zurueck[k]);
  pruefe('R2 nach Strg+Z stehen alle Verbindungen wieder Punkt für Punkt wie vorher', abweichend.length === 0, abweichend);
  await ctx.close();
}

/* ═══════════════════════ Leistung ═══════════════════════ */
/**
 * Ein Zug über das volle Board: Bildzeit (Abstand der Animations-Rückrufe) und Maus → Bild
 * (vom pointermove bis zum ersten Bild, in dem die gezogene Karte die neue Lage trägt).
 */
async function messen(kanten) {
  const { ctx, P } = await seite(VIELE(kanten));
  const r42 = await rahmen(P, 'k42');
  const g = [r42.cx, r42.cy];
  await P.evaluate(() => {
    const el = document.querySelector('.react-flow__node[data-id="k42"]');
    const lat = []; let t0 = 0;
    window.__pnLatenz = lat;
    window.addEventListener('pointermove', (e) => { if (!t0) t0 = e.timeStamp; }, true);
    new MutationObserver(() => { if (!t0) return; const t = t0; t0 = 0; requestAnimationFrame(() => lat.push(performance.now() - t)); })
      .observe(el, { attributes: true, attributeFilter: ['style'] });
  });
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 3, g[1] + 3, { steps: 2 }); await P.mouse.move(g[0] + 6, g[1] + 6, { steps: 2 });
  await P.waitForTimeout(300);
  await P.evaluate(() => { window.__pnLatenz.length = 0; });
  const takt = P.evaluate(() => new Promise((res) => { const z = []; let l = performance.now(); let k = 0; const f = (t) => { z.push(t - l); l = t; if (++k < 90) requestAnimationFrame(f); else res(z); }; requestAnimationFrame(f); }));
  for (let i = 1; i <= 50; i += 1) { await P.mouse.move(g[0] + i * 14, g[1] + Math.sin(i / 4) * 120); await P.waitForTimeout(16); }
  const zt = (await takt).slice(3).sort((x, y) => x - y);
  const lat = (await P.evaluate(() => window.__pnLatenz.slice())).sort((x, y) => x - y);
  const ausgewichen = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].filter((e) => e.style.translate && e.style.translate !== 'none').length);
  await P.mouse.up(); await P.waitForTimeout(600);
  await ctx.close();
  const med = (a) => a[Math.floor(a.length / 2)] ?? Infinity;
  const m = { bild: med(zt), latenz: med(lat), n: lat.length, ausgewichen };
  console.log(`  (${kanten} Verbindungen: Bildzeit Median ${m.bild.toFixed(1)} ms · Maus → Bild ${m.latenz.toFixed(1)} ms aus ${m.n} · ausgewichen ${ausgewichen})`);
  return m;
}
console.log('\n════ L: 200 Karten, 100 Verbindungen (Vergleich: dieselben Karten ohne Verbindung) ════');
{
  // je zwei Läufe, der bessere zählt (eine ausgelastete Maschine verdirbt sonst einzelne Läufe)
  const besser = (a, b) => ({ ...a, bild: Math.min(a.bild, b.bild), latenz: Math.min(a.latenz, b.latenz), n: Math.max(a.n, b.n) });
  const ohne = besser(await messen(0), await messen(0));
  const mit = besser(await messen(100), await messen(100));
  pruefe('L1 beim Ziehen weichen Karten aus', mit.ausgewichen >= 1, mit);
  // Ziel auf freier Maschine: 16,7 ms wie ohne Verbindungen. Die Prüf-Maschine ist oft voll ausgelastet — verlangt wird
  // deshalb: höchstens ein Bild mehr als dasselbe Board ohne Verbindungen (vorher waren es oft zwei bis drei)
  pruefe('L2 Bildzeit mit 100 Verbindungen höchstens ein Bild über dem Board ohne Verbindungen', mit.bild <= ohne.bild + 17.5, { mit: mit.bild, ohne: ohne.bild });
  pruefe('L3 Maus → Bild mit 100 Verbindungen höchstens 80 ms über dem Board ohne Verbindungen', mit.n >= 10 && mit.latenz <= ohne.latenz + 80, { mit: mit.latenz, ohne: ohne.latenz });
}

/* ═══════════════════════ Ausweichen der Kanten ═══════════════════════ */
console.log('\n════ A: Kanten weichen den angezeigten Lagen aus ════');
{
  const { ctx, P } = await seite(AUSWEICH());
  const z = await zoomVon(P);
  const d0 = (await pfade(P)).w1;
  const geradeVorher = !/ C [^C]+ C /.test(d0);
  pruefe('A0 ruhend läuft c→d als eine Kurve (b steht nicht im Weg)', geradeVorher, d0);
  const g = await griff(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 4, { steps: 2 }); await P.mouse.move(g[0], g[1], { steps: 2 });
  // a auf b: b weicht nach unten aus — auf die Linie c→d
  await P.mouse.move(g[0] + 360 * z, g[1] - 40 * z, { steps: 10 });
  await P.waitForTimeout(600);
  const b = await rahmen(P, 'b');
  const imWeg = await P.evaluate(() => {
    const p = document.querySelector('.react-flow__edge[data-id="w1"] path.react-flow__edge-path');
    const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect();
    const m = p.getScreenCTM(); const L = p.getTotalLength(); let treffer = 0;
    for (let i = 1; i < 60; i += 1) { const q = p.getPointAtLength((L * i) / 60); const s = new DOMPoint(q.x, q.y).matrixTransform(m); if (s.x > r.left && s.x < r.right && s.y > r.top && s.y < r.bottom) treffer += 1; }
    return { treffer, d: p.getAttribute('d') };
  });
  const verschoben = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="b"]').style.translate);
  console.log(`  (b verschoben: ${verschoben || 'nein'}, Kante durch b: ${imWeg.treffer} Punkte)`);
  pruefe('A1 b ist ausgewichen', !!verschoben && verschoben !== 'none', { verschoben, b });
  pruefe('A2 die Kante c→d läuft nicht durch die ausgewichene Karte b', imWeg.treffer === 0, imWeg);
  await P.keyboard.press('Escape'); await P.mouse.up(); await P.waitForTimeout(900);
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
console.log('\n════ T: Texte ════');
{
  pruefe('T1 Meilenstein-Datei liegt vor', existsSync(path.join(__repo, 'docs/meilensteine/M486-kanten-schnell.md')));
}
await browser.close(); app.close();
console.log(`\nM486: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
