/**
 * M506 — Flüssige Schrift ohne Rahmen und Hintergrund.
 * (Nutzerwunsch: „liquid text bitte rahmenlos und ohne hintergrund anbieten wenn ohne fokus")
 *
 *   A  Ruhend (hell): kein Schatten, keine Fläche, kein Rand, keine runden Ecken; um die Karte herum und auf ihr steht
 *      Bildpunkt für Bildpunkt der Board-Grund, wenn man nur die Flüssigkeit ausblendet — auch mit dem Zeiger darauf.
 *      Die Flüssigkeit zeichnet; Kontrast der Tinte zum Board-Grund ≥ 3:1.
 *   B  Klickfläche: liegt über der Schrift (Schrift + Magnet-Rand), nicht über der leeren Kartenfläche. Ein Klick in die
 *      leere Kartenecke markiert nichts und erreicht die Notiz darunter; ein Druck auf der Schrift zieht die Karte;
 *      die Maus über der Schrift schubst die Flüssigkeit weiter.
 *   C  Markiert: Auswahlrahmen, Griffe zum Skalieren und die Bedienung unter der Karte; weiter ohne Fläche. Jetzt
 *      gehört die ganze Karte dem Zeiger (Druck in der Ecke greift die Flüssigkeit, nicht das Board).
 *   D  Karten-Fokus: dort bekommt die Karte ihre Fläche und einen dezenten Rand zurück.
 *   E  Dunkel und Board-Tönung: ruhend wieder nur die Flüssigkeit, die Tönung bleibt sichtbar; Akzent-Tinte ≥ 3:1.
 *   F  Präsentation: die Folie zeigt die Flüssigkeit ohne Kartenrahmen.
 *   G  Bild-Export: „Transparent" lässt die Kartenfläche durchsichtig, „Wie das Board" zeigt dort den Board-Grund.
 * Bilder ruhend/markiert hell und dunkel nach PN_BILDER (Standard pruefungen/ablage/).
 */
// Läuft aus dem Repository: `node pruefungen/m506-fluessig-rahmenlos.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5506;
const laufe = (teil) => !process.env.NUR || [...teil].some((b) => process.env.NUR.includes(b));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  let f = path.join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const fl = (id, text, x, y, extra = {}) => ({ id, type: 'fluessig', width: 440, height: 220, autoFit: false, position: { x, y }, data: { text, ...extra } });
const note = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const stand = (nodes, ui, bg) => ({
  boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], comments: [], nodes, ...(bg ? { bg } : {}) }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, ...(ui ? { ui } : {}),
});
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((st) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand(nodes, opt.ui, opt.bg));
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow', { state: 'visible', timeout: 30000 });
  return { ctx, P, fehler };
}
const warteBis = async (P, fn, ms = 15000, arg) => P.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
const flaeche = (id) => `.react-flow__node[data-id="${id}"] canvas.fl-flaeche`;
const ruht = (P, id) => warteBis(P, (sel) => document.querySelector(sel)?.__fluessig?.zustand().ruht === true, 20000, flaeche(id));
const bereit = (P, id) => warteBis(P, (sel) => !!document.querySelector(sel)?.__fluessig?.zustand().umriss, 20000, flaeche(id));
const knoten = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
/** Lage der Karte auf dem Board (Fluss-Koordinaten aus dem transform des Knotens — unabhängig vom Schwenken) */
const lageAufBoard = (P, id) => P.evaluate((kid) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(document.querySelector(`.react-flow__node[data-id="${kid}"]`).style.transform); return { x: +m[1], y: +m[2] }; }, id);
const schwenk = (P) => P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
/** Aussehen der Karte: berechnete Stile von Knoten und Kartenkörper, Lage der Klickfläche */
const aussehen = (P, id) => P.evaluate((kid) => {
  const k = document.querySelector(`.react-flow__node[data-id="${kid}"]`);
  const b = k.querySelector('.fluessig-card');
  const t = k.querySelector('.fl-treffer');
  const sk = getComputedStyle(k), sb = getComputedStyle(b);
  const r = k.getBoundingClientRect(), tr = t.getBoundingClientRect();
  // sichtbar = hat Maße, ist nicht versteckt und weder es selbst noch ein Vorfahr ist (fast) durchsichtig
  const deckend = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) if (+getComputedStyle(x).opacity < 0.05) return false; return true; };
  const sichtbar = (sel) => [...k.querySelectorAll(sel)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && deckend(e)).length;
  return {
    schatten: sk.boxShadow, koerperSchatten: sb.boxShadow, grund: sb.backgroundColor, rand: sb.borderTopWidth, randStil: sb.borderTopStyle,
    ecken: sb.borderRadius, umriss: sk.outlineStyle, zeiger: sk.pointerEvents, gewaehlt: k.classList.contains('selected'),
    karte: { x: r.left, y: r.top, w: r.width, h: r.height }, treffer: { x: tr.left, y: tr.top, w: tr.width, h: tr.height },
    griffe: sichtbar('.react-flow__resize-control.handle'), werkzeuge: sichtbar('.fl-werkzeuge'), griff: sichtbar('.card-grip > *'),
  };
}, id);
/** Zwei Bildschirmfotos gleicher Größe vergleichen: Zahl der Bildpunkte, die sich merklich unterscheiden */
const unterschied = (P, a, b) => P.evaluate(async ([x, y]) => {
  const lade = async (d) => { const i = new Image(); i.src = `data:image/png;base64,${d}`; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const p = await lade(x), q = await lade(y);
  let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 12) n++;
  return { n, gesamt: p.length / 4 };
}, [a.toString('base64'), b.toString('base64')]);
/** Rahmen-Probe: Ausschnitt um die Karte (14 px Rand), einmal nur ohne Flüssigkeit, einmal ganz ohne Karte */
async function nurFluessigkeit(P, id) {
  const a = await aussehen(P, id);
  const clip = { x: Math.max(0, Math.round(a.karte.x) - 14), y: Math.max(0, Math.round(a.karte.y) - 14), width: Math.round(a.karte.w) + 28, height: Math.round(a.karte.h) + 28 };
  await P.evaluate((sel) => { document.querySelector(sel).style.visibility = 'hidden'; }, flaeche(id));
  const ohneTinte = await P.screenshot({ clip });
  await P.evaluate((kid) => { document.querySelector(`.react-flow__node[data-id="${kid}"]`).style.visibility = 'hidden'; }, id);
  const ohneKarte = await P.screenshot({ clip });
  await P.evaluate(([sel, kid]) => { document.querySelector(sel).style.visibility = ''; document.querySelector(`.react-flow__node[data-id="${kid}"]`).style.visibility = ''; }, [flaeche(id), id]);
  return unterschied(P, ohneTinte, ohneKarte);
}
/** Tinte der Fläche: mittlere Farbe der deckenden Bildpunkte gegen den Board-Grund (WCAG-Kontrast) */
const kontrast = (P, id) => P.evaluate((sel) => {
  const c = document.querySelector(sel);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 250) { n++; r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const tinte = n ? [r / n, g / n, b / n] : [0, 0, 0];
  const grundText = getComputedStyle(document.querySelector('.react-flow')).backgroundColor;
  const grund = grundText.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = ([R, G, B]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
  const l1 = lum(tinte), l2 = lum(grund);
  return { anteil: n / (d.length / 4), tinte: tinte.map(Math.round), grund: grundText, verhaeltnis: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) };
}, flaeche(id));
const mitteTreffer = (a) => ({ x: a.treffer.x + a.treffer.w / 2, y: a.treffer.y + a.treffer.h / 2 });
const weg = async (P) => { await P.mouse.move(1260, 790); await P.mouse.click(1260, 790); await P.waitForTimeout(150); };
const ablegen = async (P, id, name) => {
  const a = await aussehen(P, id);
  await P.screenshot({ path: path.join(SD, name), clip: { x: Math.max(0, a.karte.x - 40), y: Math.max(0, a.karte.y - 40), width: a.karte.w + 80, height: a.karte.h + 110 } });
};

// ══ A–C: hell ══════════════════════════════════════════════════════
console.log('\n════ A: ruhend, hell ════');
if (laufe('ABC')) {
  // Notiz unter der linken unteren Ecke der flüssigen Karte (die Karte liegt darüber)
  const { ctx, P, fehler } = await seite([note('n1', 'Darunter', -150, 175), fl('f1', 'Hallo', 0, 0)]);
  const da = await bereit(P, 'f1');
  pruefe('A0 die Engine lief an und meldet den Umriss der Schrift', da);
  await ruht(P, 'f1');
  await weg(P);
  let a = await aussehen(P, 'f1');
  console.log('   ', JSON.stringify({ schatten: a.schatten, grund: a.grund, rand: a.rand, ecken: a.ecken, zeiger: a.zeiger, karte: a.karte, treffer: a.treffer }));
  pruefe('A1 kein Schatten (Knoten und Körper)', a.schatten === 'none' && a.koerperSchatten === 'none', `${a.schatten} / ${a.koerperSchatten}`);
  pruefe('A2 keine Fläche, kein Rand, keine runden Ecken', a.grund === 'rgba(0, 0, 0, 0)' && a.rand === '0px' && a.ecken === '0px', `${a.grund} ${a.rand} ${a.ecken}`);
  pruefe('A3 kein Auswahlrahmen, keine Griffe, keine Bedienung', a.umriss === 'none' && a.griffe === 0 && a.werkzeuge === 0 && a.griff === 0, JSON.stringify(a));
  let probe = await nurFluessigkeit(P, 'f1');
  pruefe('A4 ohne die Flüssigkeit ist die Karte unsichtbar: Bildpunkt für Bildpunkt Board-Grund (± 14 px)', probe.n === 0, JSON.stringify(probe));
  const k = await kontrast(P, 'f1');
  console.log('    Tinte', JSON.stringify(k));
  pruefe('A5 die Flüssigkeit zeichnet (Tinte auf der Karte)', k.anteil > 0.03, String(k.anteil));
  pruefe('A6 Kontrast Tinte : Board-Grund ≥ 3:1', k.verhaeltnis >= 3, k.verhaeltnis.toFixed(2));
  await ablegen(P, 'f1', 'm506-ruhend-hell.png');
  // Zeiger auf der Schrift: es kommt weder Schatten noch Griff dazu
  const m = mitteTreffer(a);
  await P.mouse.move(m.x, m.y); await P.waitForTimeout(600);
  const ah = await aussehen(P, 'f1');
  probe = await nurFluessigkeit(P, 'f1');
  pruefe('A7 mit dem Zeiger auf der Schrift: weiter kein Schatten, kein Griff, keine Fläche', ah.schatten === 'none' && ah.griff === 0 && ah.griffe === 0 && probe.n === 0, JSON.stringify({ s: ah.schatten, g: ah.griff, probe }));

  console.log('\n════ B: Klickfläche ════');
  await weg(P); await ruht(P, 'f1');
  a = await aussehen(P, 'f1');
  const innen = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  pruefe('B1 die Klickfläche liegt in der Karte und ist kleiner als sie', a.treffer.w < a.karte.w - 4 || a.treffer.h < a.karte.h - 4, JSON.stringify({ karte: a.karte, treffer: a.treffer }));
  const tinteRahmen = await P.evaluate((sel) => {
    const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const r = c.getBoundingClientRect();
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const s = r.width / c.width;
    return { x: r.left + x0 * s, y: r.top + y0 * s, w: (x1 - x0) * s, h: (y1 - y0) * s };
  }, flaeche('f1'));
  pruefe('B2 … und deckt die gezeichnete Schrift ab', tinteRahmen.x >= a.treffer.x - 2 && tinteRahmen.y >= a.treffer.y - 2 && tinteRahmen.x + tinteRahmen.w <= a.treffer.x + a.treffer.w + 2 && tinteRahmen.y + tinteRahmen.h <= a.treffer.y + a.treffer.h + 2, JSON.stringify({ tinte: tinteRahmen, treffer: a.treffer }));
  // leere Kartenecke links unten (über der Notiz): außerhalb der Klickfläche, innerhalb der Karte
  const ecke = { x: a.karte.x + 8, y: a.karte.y + a.karte.h - 8 };
  pruefe('B3 die Probe-Ecke liegt in der Karte, aber außerhalb der Klickfläche', innen(ecke, a.karte) && !innen(ecke, a.treffer), JSON.stringify(ecke));
  const oben = await P.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.closest('.react-flow__node')?.dataset.id ?? e?.className?.toString().slice(0, 40); }, [ecke.x, ecke.y]);
  pruefe('B4 in der leeren Ecke liegt für den Zeiger die Notiz darunter (nicht die flüssige Karte)', oben === 'n1', String(oben));
  await P.mouse.click(ecke.x, ecke.y); await P.waitForTimeout(300);
  const gew = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((e) => e.dataset.id));
  pruefe('B5 ein Klick in die leere Ecke markiert die Notiz darunter, nicht die flüssige Karte', gew.includes('n1') && !gew.includes('f1'), JSON.stringify(gew));
  await weg(P);
  // leere Ecke rechts oben (dort liegt nichts): ein Zug dort verschiebt die Karte nicht
  const ro = { x: a.karte.x + a.karte.w - 6, y: a.karte.y + 6 };
  if (!innen(ro, a.treffer)) {
    const vor = await lageAufBoard(P, 'f1'); const sv = await schwenk(P);
    await P.mouse.move(ro.x, ro.y); await P.mouse.down(); await P.mouse.move(ro.x + 60, ro.y + 40, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(250);
    const nach = await lageAufBoard(P, 'f1'); const sn = await schwenk(P);
    const gew2 = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((e) => e.dataset.id));
    pruefe('B6 ein Zug in der leeren Ecke schwenkt das Board – die Karte bleibt an ihrem Platz und unmarkiert', vor.x === nach.x && vor.y === nach.y && sv !== sn && !gew2.includes('f1'), JSON.stringify({ vor, nach, sv, sn, gew2 }));
  } else pruefe('B6 Ecke rechts oben liegt außerhalb der Klickfläche', false, JSON.stringify({ ro, t: a.treffer }));
  await weg(P);
  // Schubsen: die Maus über der Schrift verändert das Bild
  const bild = () => P.evaluate((sel) => { const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const o = []; for (let i = 3; i < d.length; i += 16) o.push(d[i] > 128 ? 1 : 0); return o; }, flaeche('f1'));
  await ruht(P, 'f1');
  const vorB = await bild();
  for (let i = 0; i <= 12; i++) await P.mouse.move(a.treffer.x + a.treffer.w * (0.15 + 0.06 * i), a.treffer.y + a.treffer.h / 2 + Math.sin(i) * 18, { steps: 2 });
  const nachB = await bild();
  let diff = 0; for (let i = 0; i < vorB.length; i++) if (vorB[i] !== nachB[i]) diff++;
  pruefe('B7 die Maus über der Schrift schubst die Flüssigkeit (ruhend, unmarkiert)', diff > 40, String(diff));
  await weg(P); await ruht(P, 'f1');
  // Greifen auf der Schrift zieht die Karte
  a = await aussehen(P, 'f1');
  const g = mitteTreffer(a);
  const vorZ = await lageAufBoard(P, 'f1');
  await P.mouse.move(g.x, g.y); await P.mouse.down(); await P.mouse.move(g.x + 80, g.y + 50, { steps: 8 }); await P.mouse.up(); await P.waitForTimeout(300);
  const nachZ = await lageAufBoard(P, 'f1');
  pruefe('B8 ein Zug auf der Schrift verschiebt die Karte', nachZ.x - vorZ.x > 40 && nachZ.y - vorZ.y > 25, JSON.stringify({ vorZ, nachZ }));

  console.log('\n════ C: markiert ════');
  await weg(P); await ruht(P, 'f1');
  a = await aussehen(P, 'f1');
  const c0 = mitteTreffer(a);
  await P.mouse.click(c0.x, c0.y);
  await P.waitForSelector('.react-flow__node[data-id="f1"].selected', { timeout: 5000 }).catch(() => {});
  await P.mouse.move(1260, 790); await P.waitForTimeout(400);
  const am = await aussehen(P, 'f1');
  console.log('   ', JSON.stringify({ umriss: am.umriss, griffe: am.griffe, werkzeuge: am.werkzeuge, grund: am.grund, zeiger: am.zeiger }));
  pruefe('C1 ein Klick auf die Schrift markiert die Karte – mit Auswahlrahmen', am.gewaehlt && am.umriss === 'solid', `${am.gewaehlt} ${am.umriss}`);
  pruefe('C2 Griffe zum Skalieren und die Bedienung sind da', am.griffe >= 4 && am.werkzeuge === 1, JSON.stringify({ g: am.griffe, w: am.werkzeuge }));
  pruefe('C3 weiter ohne Fläche und ohne Schatten', am.grund === 'rgba(0, 0, 0, 0)' && am.schatten === 'none', `${am.grund} ${am.schatten}`);
  const ecke2 = { x: am.karte.x + 8, y: am.karte.y + am.karte.h - 8 };
  const obenM = await P.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.react-flow__node')?.dataset.id ?? null, [ecke2.x, ecke2.y]);
  pruefe('C4 markiert gehört die ganze Karte dem Zeiger (Ecke = flüssige Karte)', obenM === 'f1', String(obenM));
  await ablegen(P, 'f1', 'm506-markiert-hell.png');
  pruefe('C5 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));

  console.log('\n════ D: Karten-Fokus ════');
  await P.locator('.react-flow__node[data-id="f1"]').evaluate((el) => el.focus());
  await P.keyboard.press('Enter');
  const fok = await warteBis(P, () => !!document.querySelector('.react-flow__node.pn-focused[data-id="f1"]'), 8000);
  pruefe('D1 die Karte öffnet im Fokus', fok);
  if (fok) {
    await P.waitForTimeout(800);
    const af = await aussehen(P, 'f1');
    pruefe('D2 im Fokus bekommt sie Fläche und dezenten Rand zurück', af.grund !== 'rgba(0, 0, 0, 0)' && af.rand === '1px' && af.randStil === 'solid', `${af.grund} ${af.rand} ${af.randStil}`);
    pruefe('D3 … und die Bedienung', af.werkzeuge === 1);
  }
  await ctx.close();
}

// ══ E: dunkel, Tönung ═══════════════════════════════════════════════
console.log('\n════ E: dunkel und Board-Tönung ════');
if (laufe('E')) {
  const { ctx, P, fehler } = await seite([fl('d1', 'Nacht', 0, 0), fl('d2', 'Akzent', 0, 280, { farbe: 'akzent' })], { ui: { theme: 'dark', accent: 'blau' } });
  await bereit(P, 'd1'); await bereit(P, 'd2');
  await ruht(P, 'd1'); await ruht(P, 'd2');
  await weg(P);
  const a = await aussehen(P, 'd1');
  pruefe('E1 dunkel: kein Schatten, keine Fläche, kein Rand', a.schatten === 'none' && a.grund === 'rgba(0, 0, 0, 0)' && a.rand === '0px', `${a.schatten} ${a.grund} ${a.rand}`);
  const probe = await nurFluessigkeit(P, 'd1');
  pruefe('E2 dunkel: ohne die Flüssigkeit nur Board-Grund', probe.n === 0, JSON.stringify(probe));
  const k1 = await kontrast(P, 'd1'); const k2 = await kontrast(P, 'd2');
  console.log('    Tinte', JSON.stringify({ k1, k2 }));
  pruefe('E3 dunkel: helle Tinte, Kontrast ≥ 3:1 (Schrift und Akzent)', k1.verhaeltnis >= 3 && k2.verhaeltnis >= 3, `${k1.verhaeltnis.toFixed(2)} / ${k2.verhaeltnis.toFixed(2)}`);
  await ablegen(P, 'd1', 'm506-ruhend-dunkel.png');
  const m = await aussehen(P, 'd1');
  await P.mouse.click(m.treffer.x + m.treffer.w / 2, m.treffer.y + m.treffer.h / 2);
  await P.waitForSelector('.react-flow__node[data-id="d1"].selected', { timeout: 5000 }).catch(() => {});
  await P.mouse.move(1260, 790); await P.waitForTimeout(400);
  const am = await aussehen(P, 'd1');
  pruefe('E4 dunkel markiert: Auswahlrahmen und Griffe, keine Fläche', am.umriss === 'solid' && am.griffe >= 4 && am.grund === 'rgba(0, 0, 0, 0)', JSON.stringify({ u: am.umriss, g: am.griffe, grund: am.grund }));
  await ablegen(P, 'd1', 'm506-markiert-dunkel.png');
  pruefe('E5 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
  // Getöntes Board (gelb, hell): die Tönung steht auch dort, wo die Karte liegt
  const t = await seite([fl('t1', 'Tönung', 0, 0, { farbe: 'akzent' })], { bg: 'gelb' });
  await bereit(t.P, 't1'); await ruht(t.P, 't1'); await weg(t.P);
  const pt = await nurFluessigkeit(t.P, 't1');
  const kt = await kontrast(t.P, 't1');
  pruefe('E6 getöntes Board: ohne die Flüssigkeit nur die Tönung, Akzent-Tinte ≥ 3:1', pt.n === 0 && /250, 243, 217/.test(kt.grund) && kt.verhaeltnis >= 3, JSON.stringify({ pt, kt }));
  await ablegen(t.P, 't1', 'm506-ruhend-getoent.png');
  await t.ctx.close();
}

// ══ F: Präsentation ═══════════════════════════════════════════════
console.log('\n════ F: Präsentation ════');
if (laufe('F')) {
  const { ctx, P, fehler } = await seite([fl('j1', 'Vortrag', 0, 0)]);
  await bereit(P, 'j1');
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-box', { state: 'visible' });
  await P.keyboard.type('Präsentieren'); await P.waitForTimeout(300);
  await P.locator('.search-cmds .search-cmd', { hasText: 'Präsentieren' }).first().click();
  const folie = await P.waitForSelector('.presenter-slide .slide-fluessig canvas.fl-flaeche', { timeout: 15000 }).then(() => true, () => false);
  pruefe('F1 die Karte lebt auf der Folie', folie);
  if (folie) {
    const s = await P.evaluate(() => { const e = document.querySelector('.slide-fluessig'); const c = getComputedStyle(e); return { grund: c.backgroundColor, rand: c.borderTopWidth, schatten: c.boxShadow }; });
    pruefe('F2 auf der Folie ohne Fläche, Rand und Schatten', s.grund === 'rgba(0, 0, 0, 0)' && s.rand === '0px' && s.schatten === 'none', JSON.stringify(s));
    await warteBis(P, () => [...document.querySelectorAll('.slide-fluessig canvas.fl-flaeche')].some((c) => c.__fluessig?.zustand().ruht), 15000);
    await P.screenshot({ path: path.join(SD, 'm506-folie.png') });
  }
  pruefe('F3 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ G: Bild-Export ═════════════════════════════════════════════════
console.log('\n════ G: Bild-Export ════');
if (laufe('G')) {
  const { ctx, P, fehler } = await seite([fl('x1', 'Export', 0, 0)]);
  await bereit(P, 'x1'); await ruht(P, 'x1'); await weg(P);
  const grund = await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow')).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
  const exportiere = async (hintergrund, name) => {
    await P.locator('.dock [aria-label="Mehr"]').click(); await P.waitForTimeout(300);
    await P.locator('[aria-label="Als Bild exportieren"]').first().click(); await P.waitForTimeout(400);
    const d = P.locator('.bild-export');
    await d.locator('select').nth(0).selectOption('png');
    await d.locator('select').nth(1).selectOption('1');
    await d.locator('select').nth(2).selectOption(hintergrund);
    const kopf = d.locator('input[type="checkbox"]').nth(0); if (await kopf.isChecked()) await kopf.uncheck();
    const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 90000 }), d.locator('button', { hasText: 'Exportieren' }).click()]);
    const ziel = path.join(SD, name); await dl.saveAs(ziel);
    return P.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      // Ecken der Karte (Karte ab Bildpunkt 60/60, 440 × 220) und deckende Tinte in der Mitte
      const px = (x, y) => Array.from(d.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
      let tinte = 0; for (let y = 60 + 40; y < 60 + 180; y++) for (let x = 60 + 40; x < 60 + 400; x++) if (d[(y * img.width + x) * 4 + 3] > 250) { const i = (y * img.width + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 200) tinte++; }
      return { w: img.width, h: img.height, ecken: [px(64, 64), px(60 + 436, 64), px(64, 60 + 216), px(60 + 436, 60 + 216)], tinte };
    }, readFileSync(ziel).toString('base64'));
  };
  const t = await exportiere('transparent', 'm506-export-transparent.png');
  console.log('   ', JSON.stringify(t));
  pruefe('G1 Export „Transparent": die Kartenecken sind durchsichtig (kein Kartenrahmen, keine Fläche)', t.ecken.every((p) => p[3] === 0), JSON.stringify(t.ecken));
  pruefe('G2 … und die Schrift ist im Bild', t.tinte > 2000, String(t.tinte));
  const b = await exportiere('beige', 'm506-export-board.png');
  const gleich = (p) => Math.abs(p[0] - grund[0]) + Math.abs(p[1] - grund[1]) + Math.abs(p[2] - grund[2]) < 10 && p[3] === 255;
  pruefe('G3 Export „Wie das Board": an den Kartenecken steht der Board-Grund', b.ecken.every(gleich), JSON.stringify({ ecken: b.ecken, grund }));
  pruefe('G4 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
