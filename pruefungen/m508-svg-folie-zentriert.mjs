/**
 * M508 — SVG-Inhalte in der Präsentation mittig und groß.
 *
 * Gemeldet: „svg inhalte werden bei präsentationsansicht immer linksbündig angezeigt! ich will lieber zentriert!"
 * Ursache: Bild-Karten laufen auf der Folie als <img> mit höchstens 600 Punkten Breite in einem Kasten, der sich nach
 * der Bildgröße richtet. Ein SVG, das breiter als 600 Punkte angegeben ist, machte den Kasten folienbreit – das Bild
 * hing 600 Punkte breit am linken Rand. Ein SVG ohne feste Größe (nur viewBox, Breite in Prozent) schrumpfte auf 0 × 0.
 *
 * Gemessen wird an den Bildpunkten (Bildschirmfoto der Folie): die Grafik ist ganz magenta, ihr Rahmen im Foto ist das,
 * was man sieht.
 *   A  Bild-Karte mit SVG: nur viewBox · viewBox + 1200 × 675 · 300 × 400 ohne viewBox (hochkant, klein) · Breite und
 *      Höhe in Prozent – je waagrecht und senkrecht mittig (± 2 px), Folie in einer Richtung zu ≥ 90 % gefüllt,
 *      Seitenverhältnis bleibt.
 *   B  Dasselbe in pix·el dunkel und hell, Klassisch dunkel, im großen Fenster und in „Nur Inhalt" (Vollbild ohne Bedienung).
 *   C  Zoomen: „−" verkleinert um die Mitte, „+" vergrößert um die Mitte, „0" führt zurück; Strg + Rad über der Mitte.
 *   D  SVG als Datei-Karte (Dokument-Folie): mittig in ihrer Fläche und groß.
 *   E  Leseschutz: Skripte im SVG laufen nicht, das SVG steht nicht als Element in der Seite.
 *   F  Fotos (PNG) bleiben, wie sie waren: kleines Foto in seiner Größe mittig; ein breites Foto 600 Punkte breit –
 *      jetzt ebenfalls mittig statt am linken Rand.
 */
// Läuft aus dem Repository: `node pruefungen/m508-svg-folie-zentriert.mjs` (braucht `npm run build`)
// Bilder: M508_BILDER=<ordner> legt Bildschirmfotos der Folien ab.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M508_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5508;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

// Die Grafik ist ganz magenta (eine Fläche über die ganze viewBox) – im Foto leicht zu finden
const svgText = (kopf, w = 400, h = 225, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${kopf}>${extra}<rect x="0" y="0" width="${w}" height="${h}" fill="#ff00ff"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#c000c0"/></svg>`;
const svgUrl = (kopf, w, h, extra) => `data:image/svg+xml;base64,${Buffer.from(svgText(kopf, w, h, extra)).toString('base64')}`;
function png(w, h) {
  const crcTab = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const stueck = (typ, daten) => { const kopf = Buffer.alloc(8); kopf.writeUInt32BE(daten.length, 0); kopf.write(typ, 4, 'latin1'); const pruef = Buffer.alloc(4); pruef.writeUInt32BE(crc(Buffer.concat([kopf.subarray(4), daten])), 0); return Buffer.concat([kopf, daten, pruef]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const roh = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; roh[i] = 255; roh[i + 1] = 0; roh[i + 2] = 255; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), stueck('IHDR', ihdr), stueck('IDAT', deflateSync(roh)), stueck('IEND', Buffer.alloc(0))]);
}
const pngUrl = (w, h) => `data:image/png;base64,${png(w, h).toString('base64')}`;
const SKRIPT = '<script>top.__m508 = "skript"</script>';

// Folien in Lesereihenfolge (links nach rechts)
const bild = (id, x, src, name) => ({ id, type: 'image', position: { x, y: 0 }, width: 240, height: 150, data: { src, name } });
const FAELLE = [
  { id: 'nurViewbox', titel: 'nur viewBox 16:9', node: (x) => bild('nurViewbox', x, svgUrl('viewBox="0 0 400 225"', 400, 225, SKRIPT), 'karte.svg'), verh: 400 / 225 },
  { id: 'breit', titel: 'viewBox + 1200 × 675 (breiter als 600)', node: (x) => bild('breit', x, svgUrl('viewBox="0 0 400 225" width="1200" height="675"'), 'campfire.svg'), verh: 400 / 225 },
  { id: 'hoch', titel: '300 × 400 ohne viewBox (klein, hochkant)', node: (x) => bild('hoch', x, svgUrl('width="300" height="400"', 300, 400), 'hoch.svg'), verh: 300 / 400 },
  { id: 'prozent', titel: 'Breite/Höhe 100 % + viewBox', node: (x) => bild('prozent', x, svgUrl('viewBox="0 0 400 225" width="100%" height="100%"'), 'prozent.svg'), verh: 400 / 225 },
];
const KARTEN = [
  ...FAELLE.map((f, i) => f.node(i * 400)),
  { id: 'datei', type: 'file', position: { x: 1600, y: 0 }, width: 240, data: { name: 'plan.svg', mime: 'image/svg+xml', size: 400, dataUrl: svgUrl('viewBox="0 0 400 225"') } },
  bild('fotoKlein', 2000, pngUrl(480, 300), 'klein.png'),
  bild('fotoBreit', 2400, pngUrl(1200, 600), 'breit.png'),
];
const NR = Object.fromEntries(KARTEN.map((k, i) => [k.id, i]));

async function seite({ dunkel = false, design = 'klassisch', breite = 1440, hoehe = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([karten, d, des]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ui: { theme: d ? 'dark' : 'light', accent: 'orange', design: des } }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Campfire', edges: [], drawings: [], nodes: karten }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [KARTEN, dunkel, design]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1200);
  // Hilfsseite zum Auslesen der Bildschirmfotos (Canvas)
  const H = await ctx.newPage();
  return { ctx, P, H };
}
const warteBis = async (P, fn, ms = 15000) => { const ende = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(150); } };
const vortrag = async (P) => {
  await P.keyboard.press('Escape'); await P.mouse.click(700, 700); await P.waitForTimeout(250);
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter', { timeout: 15000 });
};
const zuFolie = async (P, nr) => {
  await P.locator('.presenter-dots button').nth(nr).click();
  await warteBis(P, () => P.evaluate((n) => document.querySelector('.presenter-count')?.textContent?.trim().startsWith(`${n + 1} /`), nr));
  await P.locator('.presenter-count').click(); // Fokus aus dem Knopf, damit Tasten die Folie meinen
  await P.waitForTimeout(500);
};
/** Rahmen der Fläche, in der der Inhalt stehen soll: die Folie ohne ihren Innenabstand bzw. die Dokument-Fläche */
const flaeche = (P) => P.evaluate(() => {
  const dok = document.querySelector('.presenter .folie-dok-flaeche');
  const el = dok ?? document.querySelector('.presenter-slide');
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  const pl = dok ? 0 : parseFloat(cs.paddingLeft); const pr = dok ? 0 : parseFloat(cs.paddingRight);
  const pt = dok ? 0 : parseFloat(cs.paddingTop); const pb = dok ? 0 : parseFloat(cs.paddingBottom);
  // Rollbalken-Platz (scrollbar-gutter) zählt nicht zur Fläche
  const gx = (el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)) / 2;
  return { l: r.left + pl + gx, r: r.right - pr - gx, t: r.top + pt, b: r.bottom - pb, dok: !!dok };
});
/** Rahmen der magentafarbenen Bildpunkte im Bildschirmfoto */
async function magenta(P, H) {
  const buf = await P.screenshot();
  return H.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let l = Infinity; let r = -1; let t = Infinity; let u = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] > 150 && d[i + 1] < 60 && d[i + 2] > 150) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > u) u = y; }
    }
    return r < 0 ? null : { l, r: r + 1, t, b: u + 1 };
  }, buf.toString('base64'));
}
const foto = async (P, name) => { if (BILDER) await P.screenshot({ path: path.join(BILDER, `${name}.png`) }); };
/** Mittig (± 2 px) und in einer Richtung zu ≥ 90 % gefüllt? */
async function lage(P, H) {
  const m = await warteBis(P, () => magenta(P, H), 8000);
  const f = await flaeche(P);
  if (!m) return { m: null, f };
  const fw = f.r - f.l; const fh = f.b - f.t; const w = m.r - m.l; const h = m.b - m.t;
  return { links: Math.round(m.l - f.l), rechts: Math.round(f.r - m.r), oben: Math.round(m.t - f.t), unten: Math.round(f.b - m.b),
    fuellX: Math.round((w / fw) * 1000) / 1000, fuellY: Math.round((h / fh) * 1000) / 1000, verh: w / h, w, h, f };
}
const mittig = (a) => !!a?.w && Math.abs(a.links - a.rechts) <= 2 && Math.abs(a.oben - a.unten) <= 2;
const gross = (a) => !!a?.w && (a.fuellX >= 0.9 || a.fuellY >= 0.9) && a.links >= -1 && a.rechts >= -1 && a.oben >= -1 && a.unten >= -1;

async function alleFaelle(P, H, wo) {
  for (const fall of FAELLE) {
    await zuFolie(P, NR[fall.id]);
    const a = await lage(P, H);
    pruefe(`${wo}: ${fall.titel} – mittig`, mittig(a), a);
    pruefe(`${wo}: ${fall.titel} – groß, Seitenverhältnis bleibt`, gross(a) && Math.abs(a.verh - fall.verh) / fall.verh < 0.03, a);
    if (fall.id === 'breit') await foto(P, `nachher-${wo.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
  }
}

// ---------- A: Bild-Karten mit SVG, Klassisch hell ----------
console.log('A  Bild-Karte mit SVG (Klassisch hell, Fenster)');
{
  const { ctx, P, H } = await seite();
  await vortrag(P);
  await alleFaelle(P, H, 'Klassisch hell');

  // ---------- C: Zoomen ----------
  console.log('C  Zoomen bleibt mittig');
  await zuFolie(P, NR.breit);
  const vorher = await lage(P, H);
  await P.keyboard.press('-'); await P.keyboard.press('-');
  const klein = await warteBis(P, async () => { const a = await lage(P, H); return a.w && a.w < vorher.w * 0.7 ? a : null; });
  pruefe('C1 „−" verkleinert – die Grafik bleibt in der Mitte', mittig(klein) && klein.w < vorher.w * 0.7, klein);
  await P.keyboard.press('0');
  const zurueck = await warteBis(P, async () => { const a = await lage(P, H); return a.w && Math.abs(a.w - vorher.w) <= 2 ? a : null; });
  pruefe('C2 „0" führt zurück zu mittig und groß', mittig(zurueck) && gross(zurueck), zurueck);
  await P.keyboard.press('+'); await P.keyboard.press('+');
  const gr = await warteBis(P, () => P.evaluate(() => {
    const f = document.querySelector('.presenter-slide'); const k = f.querySelector('.slide-svg'); if (!f.classList.contains('gezoomt')) return null;
    const r = k.getBoundingClientRect(); const fr = f.getBoundingClientRect();
    return { mx: r.left + r.width / 2, my: r.top + r.height / 2, fx: fr.left + f.clientLeft + f.clientWidth / 2, fy: fr.top + f.clientTop + f.clientHeight / 2, w: r.width, fw: f.clientWidth };
  }));
  pruefe('C3 „+" vergrößert um die Mitte der Folie', !!gr && gr.w > gr.fw * 1.2 && Math.abs(gr.mx - gr.fx) <= 3 && Math.abs(gr.my - gr.fy) <= 3, gr);
  await P.keyboard.press('0'); await P.waitForTimeout(300);
  const fl = await flaeche(P);
  await P.mouse.move((fl.l + fl.r) / 2, (fl.t + fl.b) / 2);
  await P.keyboard.down('Control');
  for (let i = 0; i < 3; i++) { await P.mouse.wheel(0, 100); await P.waitForTimeout(60); }
  await P.keyboard.up('Control');
  const rad = await warteBis(P, async () => { const a = await lage(P, H); return a.w && a.w < vorher.w * 0.9 ? a : null; });
  pruefe('C4 Strg + Rad über der Mitte verkleinert – die Grafik bleibt mittig', mittig(rad), rad);
  await P.keyboard.press('0'); await P.waitForTimeout(300);

  // ---------- D: Datei-Karte ----------
  console.log('D  SVG als Datei-Karte (Dokument-Folie)');
  await zuFolie(P, NR.datei);
  await P.waitForSelector('.presenter .folie-dok-flaeche img', { timeout: 10000 });
  const d = await lage(P, H);
  pruefe('D1 Datei-SVG steht mittig in der Dokument-Fläche', !!d.f.dok && mittig(d), d);
  pruefe('D2 … und füllt sie in einer Richtung zu ≥ 90 %', gross(d), d);

  // ---------- E: Leseschutz ----------
  console.log('E  Leseschutz');
  await zuFolie(P, NR.nurViewbox);
  const schutz = await P.evaluate(() => ({ skript: window.__m508 ?? null, svgEl: !!document.querySelector('.presenter-slide .slide-svg svg'),
    script: !!document.querySelector('.presenter-slide script'), img: document.querySelector('.presenter-slide .slide-svg img')?.tagName ?? null }));
  pruefe('E1 das Skript im SVG läuft nicht', schutz.skript === null, schutz);
  pruefe('E2 das SVG kommt als Bild auf die Folie, nicht als Element der Seite', schutz.img === 'IMG' && !schutz.svgEl && !schutz.script, schutz);

  // ---------- F: Fotos ----------
  console.log('F  Fotos (PNG)');
  await zuFolie(P, NR.fotoKlein);
  const fk = await lage(P, H);
  pruefe('F1 kleines Foto: eigene Größe (480 × 300), mittig – wie bisher', mittig(fk) && fk.w === 480 && fk.h === 300, fk);
  await zuFolie(P, NR.fotoBreit);
  const fb = await lage(P, H);
  pruefe('F2 breites Foto: 600 Punkte breit wie bisher – jetzt mittig statt am linken Rand', mittig(fb) && fb.w === 600 && fb.h === 300, fb);
  await ctx.close();
}

// ---------- B: Designs, großes Fenster, „Nur Inhalt" ----------
console.log('B  pix·el dunkel/hell, Klassisch dunkel, großes Fenster, Nur Inhalt');
{
  const { ctx, P, H } = await seite({ dunkel: true, design: 'pixel' });
  await vortrag(P);
  pruefe('B0 pix·el ist aktiv', (await P.evaluate(() => document.documentElement.dataset.design)) === 'pixel');
  await alleFaelle(P, H, 'pix·el dunkel');
  // Nur Inhalt = Vollbild ohne Bedienung
  await zuFolie(P, NR.breit);
  await P.keyboard.press('f');
  await warteBis(P, () => P.evaluate(() => !!document.querySelector('.presenter.rein')));
  await P.waitForTimeout(500);
  const rein = await lage(P, H);
  pruefe('B1 pix·el dunkel, „Nur Inhalt": mittig und groß', mittig(rein) && gross(rein), rein);
  await foto(P, 'nachher-pixel-dunkel-nur-inhalt');
  await ctx.close();
}
{
  const { ctx, P, H } = await seite({ dunkel: false, design: 'pixel', breite: 1920, hoehe: 1080 });
  await vortrag(P);
  await alleFaelle(P, H, 'pix·el hell 1920×1080');
  await ctx.close();
}
{
  const { ctx, P, H } = await seite({ dunkel: true, design: 'klassisch', breite: 1280, hoehe: 800 });
  await vortrag(P);
  await alleFaelle(P, H, 'Klassisch dunkel 1280×800');
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler);
await browser.close(); app.close();
console.log(`\n${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
