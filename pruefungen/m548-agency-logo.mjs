/**
 * Agency-Marke: selbsttätiger Rücklauf, Pausen, Kontrast und die beiden anderen
 * Designs. Die Bildfolge der Lottie-Formen prüft M554.
 * M548_BILDER=<ordner> legt die Kopfleiste in Hell und Dunkel ab.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M548_BILDER ?? '';
const LETZTES_BILD = 25;
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
async function seite({ dunkel = false, design = 'agency', lesbar = false, anfragen = null, ruhig = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light', reducedMotion: ruhig ? 'reduce' : 'no-preference' });
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
  if (design === 'agency' && !lesbar && !ruhig) {
    await P.waitForSelector('.agency-pixi[data-agency-frame] svg path[d]', { state: 'attached' });
  }
  await P.evaluate(() => document.fonts.ready);
  return { ctx, P };
}

const bildstand = (P) => P.locator('.agency-pixi').evaluate((e) => ({
  frame: e.dataset.agencyFrame === undefined ? null : Number(e.dataset.agencyFrame),
  konturen: [...e.querySelectorAll('svg path[d]')].map((pfad) => pfad.getAttribute('d')).join('/'),
}));
const pausePruefen = async (P, dauer = 1100) => {
  const stand = await bildstand(P);
  const bilder = await P.evaluate(() => window.__bilder);
  await P.waitForTimeout(dauer);
  const nachher = await bildstand(P);
  return { stand: stand.frame, gleich: nachher.frame === stand.frame && nachher.konturen === stand.konturen,
    bilder: (await P.evaluate(() => window.__bilder)) - bilder };
};
const wartenAufBild = (P, min, max) => P.waitForFunction(([a, b]) => {
  const frame = Number(document.querySelector('.agency-pixi')?.dataset.agencyFrame);
  return frame >= a && frame <= b;
}, [min, max]);
const weiterBei = async (P, stand) => P.waitForFunction((vorher) => {
  const frame = Number(document.querySelector('.agency-pixi')?.dataset.agencyFrame);
  return Math.abs(frame - vorher) > 0.15 ? { frame } : false;
}, stand).then(async (h) => (await h.jsonValue()).frame);
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

console.log('════ B: Atmen, Rücklauf und Ruhe ════');
{
  const { ctx, P } = await seite();
  await wartenAufBild(P, 4, 22);
  pruefe('B Die Kontur kommt ohne Zeigergeste in Bewegung', (await bildstand(P)).frame > 0);

  await tabVerdeckt(P, true);
  const verdeckt = await pausePruefen(P);
  pruefe('B Im verdeckten Tab bleiben die laufende Form und der Bild-Takt stehen',
    verdeckt.stand > 0 && verdeckt.gleich && verdeckt.bilder < 2, verdeckt);
  await tabVerdeckt(P, false);
  pruefe('B Nach dem Tab-Wechsel setzt die Bewegung an derselben Stelle fort',
    Math.abs(await weiterBei(P, verdeckt.stand) - verdeckt.stand) < 2, verdeckt);
  await wartenAufBild(P, LETZTES_BILD, LETZTES_BILD);
  const gipfel = await pausePruefen(P, 400);
  pruefe('B Die Kontur hält auf dem Gipfel ohne Bild-Takt inne', gipfel.gleich && gipfel.bilder <= 2, gipfel);
  await wartenAufBild(P, 4, 21);
  pruefe('B Nach dem Gipfel läuft die Form von selbst zurück', (await bildstand(P)).frame < gipfel.stand);
  await wartenAufBild(P, 0, 0);
  const ruhe = await pausePruefen(P, 850);
  // Die App darf dazwischen vereinzelt ein Bild anfordern. Das Logo hat in der Pause keinen Bild-Takt.
  pruefe('B Zwischen den Gesten ruht die Grundform ohne Bild-Takt', ruhe.gleich && ruhe.bilder <= 2, ruhe);

  await wartenAufBild(P, 3, 21);
  const kopfleiste = P.locator('.logo-wrap');
  await kopfleiste.evaluate((e) => new Promise((fertig) => {
    const beobachter = new IntersectionObserver(([eintrag]) => {
      if (!eintrag.isIntersecting) { beobachter.disconnect(); fertig(); }
    });
    beobachter.observe(e);
    e.style.display = 'none';
  }));
  const weg = await pausePruefen(P);
  pruefe('B Bei unsichtbarer Kopfleiste steht die Animation', weg.stand > 0 && weg.gleich && weg.bilder < 2, weg);
  await kopfleiste.evaluate((e) => { e.style.display = ''; });
  pruefe('B Bei sichtbarer Kopfleiste setzt die Bewegung an derselben Stelle fort',
    Math.abs(await weiterBei(P, weg.stand) - weg.stand) < 2, weg);

  const titel = await P.locator('.react-flow__node[data-id="k1"] .kanban-title').boundingBox();
  await wartenAufBild(P, 3, 21);
  await P.mouse.move(titel.x + 60, titel.y + 4);
  await P.mouse.down();
  await P.mouse.move(titel.x + 125, titel.y + 50, { steps: 3 });
  const zug = await pausePruefen(P);
  await P.mouse.up();
  pruefe('B Beim Ziehen bleibt die laufende Form stehen', zug.stand > 0 && zug.gleich, zug);
  pruefe('B Nach dem Ablegen läuft die Form an ihrer Position weiter',
    Math.abs(await weiterBei(P, zug.stand) - zug.stand) < 2, zug);
  await ctx.close();
}

console.log('════ C: Lesbarkeit und Kontrast ════');
for (const [name, opt] of [['reduzierte Bewegung', { ruhig: true }], ['„Besser lesbar"', { lesbar: true }]]) {
  const { ctx, P } = await seite(opt);
  await P.locator('.logo').hover();
  const ruhe = await pausePruefen(P);
  pruefe(`C ${name}: Text sichtbar und auch beim Zeigen statisch`, ruhe.gleich && (ruhe.stand === 0 || ruhe.stand === null)
    && await P.locator('.agency-wortmarke-text').isVisible() && !(await P.locator('.agency-pixi svg').isVisible()));
  pruefe(`C ${name}: Systemzeiger bleibt sichtbar`, !(await P.locator('.agency-zeiger').isVisible()));
  await ctx.close();
}
for (const dunkel of [false, true]) {
  const { ctx, P } = await seite({ dunkel });
  const f = await P.locator('.logo').evaluate((e) => {
    const pfade = e.querySelectorAll('.agency-pixi svg path[d][fill]');
    const tinte = [...new Set(Array.from(pfade, (p) => getComputedStyle(p).fill))];
    const notes = getComputedStyle(e.querySelector('.agency-notes')).color;
    return { tinte, notes, flaeche: getComputedStyle(e).backgroundColor };
  });
  const v = Math.min(...[...f.tinte, f.notes].map((farbe) => kontrast(rgb(farbe), rgb(f.flaeche))));
  pruefe(`C ${dunkel ? 'Dunkel' : 'Hell'}: ${v.toFixed(1)}:1 Kontrast der Wortmarke`, f.tinte.length > 0 && v >= 4.5, f);
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
await browser.close(); app.close();
console.log(`\nM548: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
