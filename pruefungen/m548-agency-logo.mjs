/**
 * Agency-Marke (M548, überarbeitet in M550): echte Bildpunkte beim Verformen von
 * pixi, selbsttätiger Rücklauf, Pausen, Kontrast und die beiden anderen Designs.
 * M548_BILDER=<ordner> legt eine groß gerenderte Folge und die Kopfleisten ab.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M548_BILDER ?? '';
const DAUER = 0.82;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5548;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const KANBAN = { id: 'k1', type: 'kanban', position: { x: 300, y: 300 }, width: 440, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße nehmen', col: 1 }] } };
const brett = (nodes) => ({ boards: [{ id: 'b0', name: 'Studio', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', cardFocus: false, navLinks: false, clickZoom: false });

/** Neue Seite; `design` = 'agency' | 'pixel' | 'klassisch' */
async function seite({ dunkel = false, design = 'agency', lesbar = false, anfragen = null, ruhig = false, dpr = 2 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: dpr, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light', reducedMotion: ruhig ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([s, d, des, les]) => {
    if (localStorage.getItem('pixinotes-onboarded')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...(les ? { lesbareSchrift: true } : {}),
      ui: { theme: d ? 'dark' : 'light', accent: 'orange', design: des } }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [brett([KANBAN]), dunkel, design, lesbar]);
  // Bild-Takt der Seite zählen (requestAnimationFrame-Rückrufe) — auf dem ruhenden Board nutzt ihn sonst niemand
  await ctx.addInitScript(() => {
    window.__bilder = 0;
    const roh = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => roh((t) => { window.__bilder += 1; f(t); });
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  if (anfragen) P.on('request', (q) => anfragen.push(q.url()));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  if (design === 'agency') await P.waitForSelector('.agency-wortmarke svg', { state: 'attached' });
  await P.evaluate(() => document.fonts.ready);
  return { ctx, P };
}

const ausschnitt = async (P) => {
  const r = await P.locator('.agency-wortmarke svg').boundingBox();
  return { x: r.x - 2, y: r.y - 3, width: r.width + 4, height: r.height + 6 };
};
/**
 * Bildpunkte eines Fotos als Tinten-Maske (in der Seite dekodiert): 1 = Tinte, 0 = Fläche; dazu der Anteil der
 * Zwischentöne (Kantenglättung) unter allen Punkten, die nicht reine Fläche sind.
 */
const maske = (P, png) => P.evaluate(async (b64) => {
  const bild = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
  const c = new OffscreenCanvas(bild.width, bild.height); const g = c.getContext('2d'); g.drawImage(bild, 0, 0);
  const d = g.getImageData(0, 0, bild.width, bild.height).data;
  const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const grund = lum(0); const tinte = []; let w = 0; let n = 0; let halb = 0;
  // Tinte = mehr als halb so weit vom Grund wie die dunkelste/hellste Stelle
  let fern = 0; for (let i = 0; i < d.length; i += 4) fern = Math.max(fern, Math.abs(lum(i) - grund));
  for (let i = 0; i < d.length; i += 4) {
    const a = Math.abs(lum(i) - grund) / Math.max(1, fern);
    tinte.push(a > 0.5 ? 1 : 0);
    if (a > 0.08) { n += 1; if (a < 0.92) halb += 1; }
    if (a > 0.5) w += 1;
  }
  return { b: bild.width, h: bild.height, m: tinte, tinte: w, zwischen: n ? halb / n : 0 };
}, png.toString('base64'));
const foto = async (P, clip) => P.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } });

/** Vier Buchstaben und zwei i-Punkte. Überhängende Konturen dürfen sich in einer Spalte kreuzen. */
function zusammenhaengendeFlaechen({ b, h, m }) {
  const offen = Uint8Array.from(m);
  let anzahl = 0;
  for (let i = 0; i < offen.length; i++) {
    if (!offen[i]) continue;
    const flaeche = [i];
    offen[i] = 0;
    for (let j = 0; j < flaeche.length; j++) {
      const p = flaeche[j];
      const x = p % b;
      const y = Math.floor(p / b);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const u = x + dx;
        const v = y + dy;
        const nachbar = v * b + u;
        if (u < 0 || u >= b || v < 0 || v >= h || !offen[nachbar]) continue;
        offen[nachbar] = 0;
        flaeche.push(nachbar);
      }
    }
    if (flaeche.length >= 3) anzahl += 1;
  }
  return anzahl;
}
/** Pausieren darf die Flüssigkeit nicht zum Anfang des Zugs zurücksetzen. */
const zeit = (P) => P.locator('.agency-wortmarke svg').evaluate((svg) => svg.getCurrentTime());
const pausePruefen = async (P, dauer = 1100) => {
  const stand = await zeit(P);
  const bilder = await P.evaluate(() => window.__bilder);
  await P.waitForTimeout(dauer);
  // Ein fast erreichtes Ende und der folgende Halt können sich um wenige SVG-Mikrosekunden unterscheiden.
  return { stand, gleich: Math.abs(await zeit(P) - stand) < 0.00001, bilder: (await P.evaluate(() => window.__bilder)) - bilder };
};
const wartenAufZeit = (P, min, max) => P.waitForFunction(([a, b]) => {
  const t = document.querySelector('.agency-wortmarke svg').getCurrentTime();
  return t >= a && t <= b;
}, [min, max]);
const wartenAufWeiterlauf = (P, stand) => P.waitForFunction((vorher) => {
  return Math.abs(document.querySelector('.agency-wortmarke svg').getCurrentTime() - vorher) > 0.005;
}, stand);
const tabVerdeckt = (P, an) => P.evaluate((verdeckt) => {
  if (verdeckt) Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  else delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange'));
}, an);
const kontrast = (a, b) => {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = ([r, g, bl]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

console.log('════ A: Die Konturen von pixi verformen sich ════');
{
  const { ctx, P } = await seite({ dpr: 4 });
  await tabVerdeckt(P, true);
  const svg = P.locator('.agency-wortmarke svg');
  const zumBild = (anteil) => svg.evaluate((e, t) => e.setCurrentTime(t), anteil * DAUER);
  const clip = await ausschnitt(P);
  await zumBild(0);
  const standbild = await foto(P, clip);
  const trocken = await maske(P, standbild);
  const film = [];
  for (const s of [0.11, 0.22, 0.34, 0.47, 0.59, 0.71, 0.84, 1]) {
    await zumBild(s);
    const m = await maske(P, await foto(P, clip));
    let links = 0; let rechts = 0;
    for (let x = 0; x < m.b; x++) {
      for (let y = 0; y < m.h; y++) {
        const i = y * m.b + x;
        if (m.m[i] === trocken.m[i]) continue;
        if (x < m.b / 3) links += 1;
        if (x > 2 * m.b / 3) rechts += 1;
      }
    }
    film.push({ s, links, rechts, flaechen: zusammenhaengendeFlaechen(m), klar: m.zwischen < 0.4 });
  }
  pruefe('A Die Flüssigkeit beginnt links sichtbar in der Schrift',
    film.some(({ s, links, rechts }) => s < 0.3 && links >= 20 && rechts === 0), film);
  pruefe('A Die Flüssigkeit erreicht später den rechten Teil von pixi',
    film.some(({ s, rechts }) => s >= 0.34 && rechts >= 20), film);
  pruefe('A Vier lesbare Buchstaben mit zwei i-Punkten und scharfen Kanten',
    film.every(({ flaechen, klar }) => flaechen === 6 && klar), film);
  await zumBild(0);
  pruefe('A Die Grundform bleibt beim Rücklauf pixelgleich', standbild.equals(await foto(P, clip)));

  if (BILDER) {
    const marke = P.locator('.agency-wortmarke');
    await marke.evaluate((e) => {
      const skalierung = 600 / e.getBoundingClientRect().width;
      const stil = getComputedStyle(e);
      const punkt = e.querySelector('.agency-trennpunkt');
      const { width, height } = punkt.getBoundingClientRect();
      e.style.fontSize = `${parseFloat(stil.fontSize) * skalierung}px`;
      e.style.gap = `${parseFloat(stil.columnGap) * skalierung}px`;
      punkt.style.width = `${width * skalierung}px`;
      punkt.style.height = `${height * skalierung}px`;
      const buehne = document.createElement('div');
      buehne.id = 'logo-buehne';
      buehne.className = 'logo';
      buehne.style.cssText = 'position:fixed;left:35px;top:120px;z-index:9999;height:auto;padding:22px 38px;background:var(--surface);color:var(--ink)';
      buehne.appendChild(e);
      document.body.appendChild(buehne);
    });
    for (const [i, s] of [0, 0.22, 0.4, 0.55, 0.74, 1].entries()) {
      await zumBild(s);
      await P.locator('#logo-buehne').screenshot({ path: path.join(BILDER, `folge-${i + 1}.png`) });
    }
  }
  await ctx.close();
}

console.log('════ B: Atmen, Rücklauf und Ruhe ════');
{
  const { ctx, P } = await seite();
  await wartenAufZeit(P, 0.12, 0.74);
  pruefe('B Die Kontur kommt ohne Zeigergeste in Bewegung', await zeit(P) > 0);

  await tabVerdeckt(P, true);
  const verdeckt = await pausePruefen(P);
  pruefe('B Im verdeckten Tab stehen SVG-Zeit und Bild-Takt', verdeckt.gleich && verdeckt.bilder < 2, verdeckt);
  await tabVerdeckt(P, false);
  await wartenAufWeiterlauf(P, verdeckt.stand);
  await wartenAufZeit(P, DAUER - 0.00001, DAUER + 0.00001);
  const gipfel = await pausePruefen(P, 400);
  pruefe('B Die Kontur hält auf dem Gipfel ohne Bild-Takt inne', gipfel.gleich && gipfel.bilder <= 2, gipfel);
  await wartenAufZeit(P, 0.12, 0.7);
  pruefe('B Nach dem Gipfel läuft die Form von selbst zurück', await zeit(P) < gipfel.stand);
  await wartenAufZeit(P, 0, 0);
  const ruhe = await pausePruefen(P, 850);
  // Die App darf dazwischen vereinzelt ein Bild anfordern. Das Logo hat in der Pause keinen Bild-Takt.
  pruefe('B Zwischen den Gesten ruht die Grundform ohne Bild-Takt', ruhe.gleich && ruhe.bilder <= 2, ruhe);

  await wartenAufZeit(P, 0.1, 0.68);
  const kopfleiste = P.locator('.logo-wrap');
  await kopfleiste.evaluate((e) => new Promise((fertig) => {
    const beobachter = new IntersectionObserver(([eintrag]) => {
      if (!eintrag.isIntersecting) { beobachter.disconnect(); fertig(); }
    });
    beobachter.observe(e);
    e.style.display = 'none';
  }));
  const weg = await pausePruefen(P);
  pruefe('B Bei unsichtbarer Kopfleiste steht die Animation', weg.gleich && weg.bilder < 2, weg);
  await kopfleiste.evaluate((e) => { e.style.display = ''; });
  await wartenAufWeiterlauf(P, weg.stand);

  const titel = await P.locator('.react-flow__node[data-id="k1"] .kanban-title').boundingBox();
  await wartenAufZeit(P, 0.1, 0.68);
  await P.mouse.move(titel.x + 60, titel.y + 4);
  await P.mouse.down();
  await P.mouse.move(titel.x + 125, titel.y + 50, { steps: 3 });
  const zug = await pausePruefen(P);
  await P.mouse.up();
  pruefe('B Beim Ziehen bleibt die laufende Form stehen', zug.gleich, zug);
  await wartenAufWeiterlauf(P, zug.stand);
  pruefe('B Nach dem Ablegen läuft die Form an ihrer Position weiter', await zeit(P) > 0);
  await ctx.close();
}

console.log('════ C: Lesbarkeit und Kontrast ════');
for (const [name, opt] of [['reduzierte Bewegung', { ruhig: true }], ['„Besser lesbar"', { lesbar: true }]]) {
  const { ctx, P } = await seite(opt);
  const sicht = await P.locator('.agency-wortmarke-text').evaluate((e) => getComputedStyle(e).visibility);
  await P.locator('.logo').hover();
  const ruhe = await pausePruefen(P);
  pruefe(`C ${name}: Text sichtbar und auch beim Zeigen statisch`, sicht === 'visible' && ruhe.gleich && await zeit(P) === 0);
  pruefe(`C ${name}: Systemzeiger bleibt sichtbar`, !(await P.locator('.agency-zeiger').isVisible()));
  await ctx.close();
}
for (const dunkel of [false, true]) {
  const { ctx, P } = await seite({ dunkel, ruhig: true, dpr: 2 });
  const f = await P.locator('.logo').evaluate((e) => {
    const s = getComputedStyle(e);
    return { tinte: s.color, flaeche: s.backgroundColor };
  });
  const v = kontrast(rgb(f.tinte), rgb(f.flaeche));
  pruefe(`C ${dunkel ? 'Dunkel' : 'Hell'}: ${v.toFixed(1)}:1 Kontrast der Wortmarke`, v >= 4.5, f);
  if (BILDER) {
    const r = await P.locator('.topbar').boundingBox();
    const clip = { x: 0, y: 0, width: r.x + r.width + 12, height: r.y + r.height + 12 };
    await P.screenshot({ clip, path: path.join(BILDER, `kopfleiste-${dunkel ? 'dunkel' : 'hell'}.png`) });
  }
  await ctx.close();
}

console.log('════ D: Klassisch und pix·el ════');
for (const design of ['klassisch', 'pixel']) {
  const anfragen = [];
  const { ctx, P } = await seite({ design, anfragen });
  const html = await P.evaluate(() => document.querySelector('.logo').innerHTML);
  pruefe(`D ${design}: bekannte Wortmarke, kein Agency-Modul`,
    html === 'Pixi<span>Notes</span>' && !anfragen.some((u) => /agencyLogo/.test(u)), html);
  await ctx.close();
}
pruefe('D Keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
if (BILDER) writeFileSync(path.join(BILDER, 'LIESMICH.txt'), 'M550: Konturen als Bildfolge und Kopfleiste (Hell/Dunkel).\n');
await browser.close(); app.close();
console.log(`\nM548: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
