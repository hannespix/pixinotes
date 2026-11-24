/**
 * M505 — Fanglinien rasten weich ein, die Zieh-Animation läuft weiter.
 *
 * Rückmeldung: „das einrasten bei den fanglinien lässt die schöne schwunganimation jedesmal ruckelig abbrechen.
 * bekommt man es auch hin dass fanglinien funktionieren und trotzdem die animation sauber läuft?"
 *
 * Gemessen wird die SICHTBARE Lage der gezogenen Karte je Bild (rAF, Zeitstempel des Bilds), zusammen mit der
 * letzten Zeigerlage. Die Abweichung e = Kartenmitte − Zeiger ist beim freien Ziehen konstant; ein Einrasten
 * verschiebt sie um den Fang-Versatz. Vor M505 geschah das in einem Bild (bis 6 Punkte, im Raster 20 × Zoom),
 * jetzt gleitet sie: je 16,7 ms höchstens ein Bruchteil davon (zeitbasiert gemessen wie m429/m496).
 *
 *   A  Annähern an die Fangkante (langsam): kein Sprung > 3 px je 16,7 ms, Fanglinie greift, Kante sitzt am Ende
 *      genau auf der Linie, die Kante (Verbindung) folgt der sichtbaren Karte Bild für Bild.
 *   B  Lösen aus der Fangweite: ebenso ohne Sprung.
 *   C  Schnell auf die Fangkante: die Neigung klingt über mehrere Bilder ab statt schlagartig; danach flach.
 *   D  Ablegen auf der Fangstelle: Endlage exakt (Stand), landet ohne Sprung.
 *   E  Raster: die Karte gleitet von Rasterpunkt zu Rasterpunkt (kein Sprung um eine ganze Rasterweite),
 *      abgelegt auf Vielfachen von 20; Strg legt frei ab.
 *   F  Strg/⌘ beim Fanglinien-Ziehen: frei ablegen wie bisher.
 *   G  Weniger Bewegung: ohne Gleiten (wie bisher), Endlage exakt.
 *   H  Meilenstein-Datei, Hilfe, keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m505-fang-weich.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5505;
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
const STAND = () => ({
  boards: [{ id: 'b1', name: 'Fang', comments: [], drawings: [],
    nodes: [nz('a', 0, 0), nz('c', 0, 420, 'green')],
    edges: [{ id: 'e1', source: 'a', target: 'c', type: 'labeled', data: { label: '', kind: 'arrow' } }] }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});

async function seite(opt = {}, vorlieben = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', ...opt });
  await ctx.addInitScript(({ st, v }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...v }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: STAND(), v: vorlieben });
  // Spur: je Bild Kartenmitte, Breite, Drehung, letzter Zeiger, Fanglinien, Kantenanfang (Bildschirm-Punkte).
  // Gemessen wird NACH allen Bild-Rückrufen der App (und den React-Renderings, die sie auslösen): Ein Rückruf ganz am
  // Anfang des Bilds kippt die Breite einer Sonde, deren ResizeObserver erst nach Stil und Layout desselben Bilds
  // feuert — also genau den Stand, der gemalt wird.
  await ctx.addInitScript(() => {
    const s = { an: false, spur: [], zx: 0, zy: 0, ts: 0 };
    window.__m505 = s;
    addEventListener('pointermove', (e) => { s.zx = e.clientX; s.zy = e.clientY; }, true);
    const messen = () => {
      if (!s.an) return;
      const el = document.querySelector('.react-flow__node[data-id="a"]');
      const p = document.querySelector('.react-flow__edge[data-id="e1"] path.react-flow__edge-path');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rot = getComputedStyle(el).rotate;
      let kx = NaN;
      if (p) { const z = (p.getAttribute('d').match(/-?[\d.]+(e-?\d+)?/g) || []).map(Number); const pt = new DOMPoint(z[0], z[1]).matrixTransform(p.getScreenCTM()); kx = pt.x; }
      s.spur.push({ t: s.ts, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, rot: rot === 'none' ? 0 : parseFloat(rot), zx: s.zx, zy: s.zy, fang: document.querySelectorAll('.fanglinie').length, kx });
    };
    let sonde = null; let breit = false;
    const lauf = (ts) => {
      s.ts = ts;
      if (!sonde && document.body) {
        sonde = document.createElement('div');
        sonde.style.cssText = 'position:fixed;left:0;top:0;height:1px;width:1px;opacity:0;pointer-events:none';
        document.body.appendChild(sonde);
        new ResizeObserver(messen).observe(sonde);
      }
      if (sonde && s.an) { breit = !breit; sonde.style.width = breit ? '2px' : '1px'; }
      requestAnimationFrame(lauf);
    };
    requestAnimationFrame(lauf);
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const zoomVon = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const rahmen = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, id);
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`) ?? document.querySelector(`.react-flow__node[data-id="${id}"]`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 12)]; }, id);
const leer = (P) => P.mouse.click(1420, 880).then(() => P.waitForTimeout(200));
const drehung = (P) => P.evaluate(() => { const s = getComputedStyle(document.querySelector('.react-flow__node[data-id="a"]')).rotate; return s === 'none' ? 0 : parseFloat(s); });
/** Lage im Stand – erst, wenn sie eine Weile gleich bleibt (der Speicher schreibt verzögert) */
const gespeichert = async (P, id) => {
  let alt = ''; let gleich = 0;
  for (let i = 0; i < 40 && gleich < 3; i += 1) {
    await P.waitForTimeout(200);
    const p = await P.evaluate((id) => JSON.stringify(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === id).position), id);
    gleich = p === alt ? gleich + 1 : 0; alt = p;
  }
  return JSON.parse(alt);
};
const spurAn = (P) => P.evaluate(() => { window.__m505.spur = []; window.__m505.an = true; });
const spurAus = (P) => P.evaluate(() => { window.__m505.an = false; return window.__m505.spur; });
/**
 * Größter Sprung der Abweichung Karte − Zeiger je 16,7 ms (achse 'x' | 'y'). Ein ausgefallenes Bild erlaubt
 * anteilig mehr; der Zeiger selbst bewegt sich in den langsamen Abschnitten höchstens 1 Punkt je Schritt.
 */
const sprung = (spur, achse = 'x') => {
  let max = 0; let wo = -1;
  for (let i = 1; i < spur.length; i += 1) {
    const a = spur[i - 1]; const b = spur[i];
    const e0 = achse === 'x' ? a.cx - a.zx : a.cy - a.zy; const e1 = achse === 'x' ? b.cx - b.zx : b.cy - b.zy;
    const je = Math.abs(e1 - e0) / Math.max(1, (b.t - a.t) / 16.7);
    if (je > max) { max = je; wo = i; }
  }
  return { max: Math.round(max * 100) / 100, wo };
};
/** Langsam (1 Bildpunkt je Schritt, ein Bild Pause) waagerecht von x0 nach x1 */
async function langsam(P, x0, x1, y) {
  const s = Math.sign(x1 - x0);
  for (let x = x0; s > 0 ? x <= x1 : x >= x1; x += s) { await P.mouse.move(x, y); await P.waitForTimeout(16); }
}

/** Greifen und anlaufen (React Flow verschluckt den ersten Schritt über der Schwelle) */
async function greifen(P) {
  const g = await griff(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 4, { steps: 2 });
  await P.mouse.move(g[0], g[1], { steps: 2 });
  return g;
}

/* ═══════════════════════ Fanglinien ═══════════════════════ */
{
  const { ctx, P } = await seite();
  const z = await zoomVon(P);
  console.log(`  (Zoom ${z})`);
  const a0 = await rahmen(P, 'a'); const c0 = await rahmen(P, 'c');

  console.log('\n════ A: Annähern an die Fangkante ════');
  await leer(P);
  let g = await greifen(P);
  // nach unten in die Lücke zwischen a und c, 40 Punkte rechts der Fangkante (c.links)
  const y = g[1] + 200 * z;
  const xRaster = g[0] + 40 * z;          // Zeiger, bei dem a.links 40 Flächen-Punkte rechts von c.links liegt
  await P.mouse.move(xRaster, y, { steps: 10 }); await P.waitForTimeout(500);
  await spurAn(P);
  // langsam bis 2 Flächen-Punkte vor die Kante (Fangweite: 6 Bildschirm-Punkte)
  const xFang = Math.round(g[0] + 2 * z);
  await langsam(P, Math.round(xRaster), xFang, y);
  await P.waitForTimeout(400);
  let sp = await spurAus(P);
  const sA = sprung(sp);
  const griffen = sp.findIndex((f) => f.fang > 0);
  pruefe('A1 die Fanglinie greift', griffen > 0, { griffen });
  console.log(`    (größter Sprung beim Einrasten ${sA.max} px je 16,7 ms)`);
  pruefe('A2 kein Sprung beim Einrasten: höchstens 3 Punkte je 16,7 ms', sA.max <= 3, sA);
  // gleitet über mehrere Bilder: zwischen dem ersten Bild mit Linie und der Ruhe liegen Zwischenlagen
  // Mitte statt Kante: die gehobene Karte ist breiter, ihre sichtbare Kante läge sonst schon vor dem Einrasten dort
  const kanteAb = sp.slice(Math.max(0, griffen)).map((f) => Math.round((f.cx - c0.cx) * 10) / 10);
  const angekommen = kanteAb.findIndex((d) => Math.abs(d) < 0.5);
  pruefe('A3 … sie gleitet über mehrere Bilder an die Linie (nicht im ersten Bild schon dort)', angekommen >= 2, kanteAb.slice(0, 10));
  const aF = await rahmen(P, 'a');
  pruefe('A4 in Ruhe steht die Kante genau auf der Linie, flach und gerade', Math.abs(aF.x - c0.x) < 0.6 && Math.abs(aF.w - a0.w) < 0.6 && Math.abs(await drehung(P)) < 0.05, { aF: aF.x, c: c0.x, w: aF.w, w0: a0.w });
  const kAbw = sp.filter((f) => !Number.isNaN(f.kx)).map((f) => Math.abs(f.kx - f.cx));
  pruefe('A5 die Verbindung folgt der sichtbaren Karte Bild für Bild (Abweichung ≤ 1,5 px)', kAbw.length > 10 && Math.max(...kAbw) <= 1.5, { max: Math.max(...kAbw).toFixed(2), um: sp.slice(Math.max(0, griffen - 2), griffen + 10).map((f) => [Math.round((f.kx - f.cx) * 10) / 10, f.fang]) });

  console.log('\n════ B: Lösen aus der Fangweite ════');
  await spurAn(P);
  await langsam(P, xFang, Math.round(g[0] + 30 * z), y);
  await P.waitForTimeout(300);
  sp = await spurAus(P);
  const sB = sprung(sp);
  const geloest = sp.findIndex((f, i) => i > 0 && sp[i - 1].fang > 0 && f.fang === 0);
  pruefe('B1 die Fanglinie lässt los', geloest > 0, { geloest });
  console.log(`    (größter Sprung beim Lösen ${sB.max} px je 16,7 ms)`);
  pruefe('B2 kein Sprung beim Lösen: höchstens 3 Punkte je 16,7 ms', sB.max <= 3, sB);
  const aB = await rahmen(P, 'a');
  pruefe('B3 frei folgt die Karte wieder dem Zeiger (Abstand wie beim Greifen)', Math.abs((aB.cx - (Math.round(g[0] + 30 * z))) - (a0.cx - g[0])) < 2.5, { aB: aB.cx, g: g[0], a0: a0.cx });

  console.log('\n════ C: Schnell auf die Fangkante – Neigung klingt ab ════');
  // weit rechts anlaufen, dann schnell nach links, der letzte Schritt landet 2 Punkte vor der Kante
  await P.mouse.move(g[0] + 420 * z, y, { steps: 6 }); await P.waitForTimeout(500);
  await spurAn(P);
  const schritte = 14;
  for (let i = 1; i <= schritte; i += 1) { await P.mouse.move(g[0] + 420 * z - ((420 - 2) * z * i) / schritte, y); await P.waitForTimeout(16); }
  await P.waitForTimeout(500);
  sp = await spurAus(P);
  const iG = sp.findIndex((f) => f.fang > 0);
  const rotG = iG > 0 ? Math.abs(sp[iG - 1].rot) : 0;
  const danach = iG > 0 ? sp.slice(iG - 1, iG + 30) : [];
  // größter Abfall der Neigung in einem Bild (Anteil des Werts davor), nur solange sie noch spürbar ist
  let abfall = 0;
  for (let i = 1; i < danach.length; i += 1) {
    const v = Math.abs(danach[i - 1].rot); const n = Math.abs(danach[i].rot);
    if (v > 0.4) abfall = Math.max(abfall, (v - n) / v / Math.max(1, (danach[i].t - danach[i - 1].t) / 16.7));
  }
  const bisFlach = danach.findIndex((f) => Math.abs(f.rot) < rotG * 0.1);
  console.log(`    (Neigung je Bild ab dem Einrasten: ${danach.slice(0, 10).map((f) => f.rot.toFixed(2)).join(' ')})`);
  pruefe('C1 sie kommt geneigt an (sonst misst C nichts)', rotG > 1, rotG);
  pruefe('C2 die Neigung fällt nie schlagartig (höchstens 75 % in einem Bild)', abfall <= 0.75, { abfall: abfall.toFixed(2), rot: danach.slice(0, 8).map((f) => f.rot.toFixed(2)) });
  pruefe('C3 … sondern klingt über mehrere Bilder ab', bisFlach >= 3, { bisFlach });
  pruefe('C4 danach liegt sie flach und gerade auf der Linie', Math.abs(await drehung(P)) < 0.05 && Math.abs((await rahmen(P, 'a')).x - c0.x) < 0.6);

  console.log('\n════ D: Ablegen auf der Fangstelle ════');
  const vorLos = await rahmen(P, 'a');
  await spurAn(P);
  await P.mouse.up();
  await P.waitForTimeout(700);
  sp = await spurAus(P);
  const maxWeg = Math.max(...sp.map((f) => Math.hypot(f.cx - vorLos.cx, f.cy - vorLos.cy)));
  pruefe('D1 die Karte bleibt beim Loslassen an der Linie (kein Sprung)', maxWeg < 1.5, maxWeg);
  const aD = await gespeichert(P, 'a');
  pruefe('D2 abgelegt exakt auf der Kante (Stand x = 0)', aD.x === 0, aD);
  await ctx.close();
}

/* ═══════════════════════ Ablegen mitten im Gleiten ═══════════════════════ */
{
  console.log('\n════ D: Loslassen, während sie noch gleitet ════');
  const { ctx, P } = await seite();
  const z = await zoomVon(P);
  const c0 = await rahmen(P, 'c');
  await leer(P);
  const g = await greifen(P);
  const y = g[1] + 200 * z;
  await P.mouse.move(g[0] + 30 * z, y, { steps: 8 }); await P.waitForTimeout(400);
  await spurAn(P);
  // ein Schritt in die Fangweite und sofort loslassen
  await P.mouse.move(g[0] + 5 * z, y); await P.mouse.up();
  await P.waitForTimeout(900);
  const sp = await spurAus(P);
  const xs = sp.map((f) => f.cx);
  let schrittMax = 0;
  for (let i = 1; i < xs.length; i += 1) schrittMax = Math.max(schrittMax, Math.abs(xs[i] - xs[i - 1]) / Math.max(1, (sp[i].t - sp[i - 1].t) / 16.7));
  // der Zeiger selbst springt 25 × Zoom Punkte; danach darf die Karte höchstens um diesen Schritt plus wenig springen
  const nachZeiger = sp.findIndex((f) => Math.abs(f.zx - (g[0] + 5 * z)) < 1);
  const rest = sp.slice(nachZeiger + 1).map((f) => f.cx);
  let restMax = 0;
  for (let i = 1; i < rest.length; i += 1) restMax = Math.max(restMax, Math.abs(rest[i] - rest[i - 1]));
  const erstes = sp[nachZeiger];
  pruefe('D3 im Bild des Loslassens steht sie noch neben der Linie (gleitet statt springt)', !!erstes && Math.abs(erstes.cx - erstes.w / 2 - c0.x) > 1, erstes && { links: erstes.cx - erstes.w / 2, c: c0.x });
  pruefe('D3b nach dem Loslassen landet sie gleitend (kein Sprung > 3 Punkte je Bild)', restMax <= 3, { restMax, schrittMax });
  const aE = await rahmen(P, 'a');
  pruefe('D4 … und steht am Ende genau auf der Kante', Math.abs(aE.x - c0.x) < 0.6, { aE: aE.x, c: c0.x });
  pruefe('D5 im Stand exakt (x = 0)', (await gespeichert(P, 'a')).x === 0);
  await ctx.close();
}

/* ═══════════════════════ Raster ═══════════════════════ */
{
  console.log('\n════ E: Raster ════');
  const { ctx, P } = await seite({}, { gridSnap: true });
  const z = await zoomVon(P);
  await leer(P);
  const g = await greifen(P);
  const y = g[1] + 200 * z;
  await P.mouse.move(g[0] + 7, y, { steps: 6 }); await P.waitForTimeout(400);
  await spurAn(P);
  await langsam(P, Math.round(g[0] + 7), Math.round(g[0] + 7 + 50 * z), y);
  await P.waitForTimeout(400);
  const sp = await spurAus(P);
  const sE = sprung(sp);
  const eWerte = sp.map((f) => f.cx - f.zx);
  const spanne = Math.max(...eWerte) - Math.min(...eWerte);
  console.log(`    (größter Sprung im Raster ${sE.max} px je 16,7 ms, Rasterweite ${20 * z} px)`);
  pruefe('E1 das Raster greift (die Karte steht zwischen den Rasterpunkten still)', spanne > 12 * z, { spanne, z });
  pruefe('E2 von Rasterpunkt zu Rasterpunkt gleitet sie (kein Sprung über eine halbe Rasterweite)', sE.max <= 10 * z, { ...sE, grenze: 10 * z });
  await P.mouse.up();
  const p = await gespeichert(P, 'a');
  pruefe('E3 abgelegt auf Vielfachen von 20', p.x % 20 === 0 && p.y % 20 === 0, p);
  // Strg im Raster: frei ablegen (vorher griff das Raster trotzdem)
  await leer(P);
  const g2 = await greifen(P);
  await P.keyboard.down('Control');
  await P.mouse.move(g2[0] + 7 * z, g2[1] + 33 * z, { steps: 8 }); await P.waitForTimeout(200);
  await P.mouse.up(); await P.keyboard.up('Control');
  const p2 = await gespeichert(P, 'a');
  pruefe('E4 mit Strg legt sie auch im Raster frei ab', p2.x % 20 !== 0 || p2.y % 20 !== 0, p2);
  await ctx.close();
}

/* ═══════════════════════ Strg frei ═══════════════════════ */
{
  console.log('\n════ F: Strg legt frei ab ════');
  const { ctx, P } = await seite();
  const z = await zoomVon(P);
  await leer(P);
  const g = await greifen(P);
  const y = g[1] + 200 * z;
  await P.keyboard.down('Control');
  await P.mouse.move(g[0] + 30 * z, y, { steps: 8 });
  await P.mouse.move(g[0] + 3 * z, y, { steps: 6 }); await P.waitForTimeout(200);
  const linien = await P.evaluate(() => document.querySelectorAll('.fanglinie').length);
  await P.mouse.up(); await P.keyboard.up('Control');
  const p = await gespeichert(P, 'a');
  pruefe('F1 mit Strg keine Fanglinie, die Karte bleibt neben der Kante', linien === 0 && p.x !== 0 && Math.abs(p.x) < 6, { linien, p });
  await ctx.close();
}

/* ═══════════════════════ Weniger Bewegung ═══════════════════════ */
{
  console.log('\n════ G: Weniger Bewegung ════');
  const { ctx, P } = await seite({ reducedMotion: 'reduce' });
  const z = await zoomVon(P);
  const c0 = await rahmen(P, 'c');
  await leer(P);
  const g = await greifen(P);
  const y = g[1] + 200 * z;
  await P.mouse.move(g[0] + 20 * z, y, { steps: 8 }); await P.waitForTimeout(400);
  await spurAn(P);
  await langsam(P, Math.round(g[0] + 20 * z), Math.round(g[0] + 2 * z), y);
  await P.waitForTimeout(200);
  const sp = await spurAus(P);
  const iG = sp.findIndex((f) => f.fang > 0);
  // ohne Gleiten: im ersten Bild mit Linie steht die Kante schon auf der Linie
  const r0 = iG >= 0 ? sp[iG] : null;
  pruefe('G1 die Fanglinie greift', iG > 0);
  pruefe('G2 ohne Gleiten: im Bild, in dem die Linie erscheint, sitzt die Karte schon (wie bisher)', !!r0 && Math.abs((r0.cx - r0.w / 2) - c0.x) < 0.6, r0 && { links: r0.cx - r0.w / 2, c: c0.x });
  pruefe('G3 keine Neigung, kein Heben', sp.every((f) => Math.abs(f.rot) < 0.01 && Math.abs(f.w - c0.w) < 0.6));
  await P.mouse.up();
  pruefe('G4 Endlage exakt (x = 0)', (await gespeichert(P, 'a')).x === 0);
  await ctx.close();
}

/* ═══════════════════════ Doku ═══════════════════════ */
console.log('\n════ H: Doku ════');
{
  const md = path.join(__repo, 'docs', 'meilensteine', 'M505-fang-weich.md');
  pruefe('H1 Meilenstein-Datei vorhanden', existsSync(md) && /Ursache/.test(readFileSync(md, 'utf8')));
  pruefe('H2 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3));
}

await browser.close();
app.close();
console.log(`\n${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
