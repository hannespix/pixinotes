/**
 * M548 — Zeichen im Design „Agency": „PX" mit zwei i-Punkten (liest sich „PIXI"), über das schwarzes Wasser läuft.
 *
 *   A  Form: das Zeichen ist ein eigenes SVG (zwei Pfade, kein Text, keine Schrift), ohne Hintergrund; über dem X
 *      stehen zwei getrennte i-Punkte, darunter eine durchgehende Lücke, dann die Arme (gemessen an den Bildpunkten).
 *      Daneben leicht „NOTES"; der Name für Vorleser bleibt „PixiNotes – zur Übersicht".
 *   B  Wasser: über einen Fluss-Zyklus (26 s) ragt ein Tropfen mindestens 0,4 Strichstärken über das trockene Zeichen
 *      hinaus (M547: ~0,07), die Abweichung ist im Mittel sichtbar, und die nasse Stelle wandert (Schwerpunkt der
 *      Abweichung an mindestens drei Orten, über ≥ 40 % der Ausschnittbreite verteilt). Kanten scharf.
 *   C  Ruhe: reduzierte Bewegung und „Besser lesbar" → trockenes Zeichen ohne Filter, Bildpunkte stehen; verdeckter
 *      Tab, Zeichen außerhalb des Bildes und Zug einer Karte → das Wasser steht, kein Bild-Takt.
 *      Hauptthread-Zeit je Sekunde beim Fließen gemessen (CDP TaskDuration).
 *   D  Dunkel: Zeichen in heller Tinte, Kontrast zur Fläche ≥ 3:1 (hell ebenso).
 *   E  Klassisch und pix·el: Wortmarke „Pixi<span>Notes</span>", das Modul wird nicht geladen.
 *   F  Keine Seitenfehler.
 *
 * Bilder: M548_BILDER=<ordner> legt Standbilder (hell/dunkel, groß), eine Bildfolge über einen Fluss-Zyklus und die
 * Kopfleiste ab.
 */
// Läuft aus dem Repository: `node pruefungen/m548-agency-logo.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M548_BILDER ?? '';
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
  if (design === 'agency') await P.waitForSelector('.agency-zeichen svg.agency-px', { timeout: 30000 });
  await P.waitForTimeout(800);
  return { ctx, P };
}
const warteBis = async (P, fn, ms = 15000) => { const ende = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(150); } };

/** Ausschnitt um das Zeichen (8 Punkte Rand — das Wasser darf über den Kasten hinaus) */
const RAND = 8;
const ausschnitt = async (P) => {
  const r = await P.locator('.agency-zeichen').boundingBox();
  return { x: r.x - RAND, y: r.y - RAND, width: r.width + 2 * RAND, height: r.height + 2 * RAND, kasten: r };
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
/** Form des Wassers (ein Pfad) über `ms` in der Seite sammeln (alle 50 ms) — liefert die Zahl verschiedener Stände */
const staende = (P, ms) => P.evaluate((ms) => new Promise((fertig) => {
  const s = new Set(); const ab = performance.now();
  const iv = setInterval(() => {
    s.add(document.querySelector('.agency-px .agency-wasser')?.getAttribute('d'));
    if (performance.now() - ab > ms) { clearInterval(iv); fertig(s.size); }
  }, 50);
}), ms);
/** Hauptthread-Zeit (s) je Sekunde Wanduhr über `ms` */
const hauptthread = async (P, ms) => {
  const cdp = await P.context().newCDPSession(P);
  await cdp.send('Performance.enable');
  const lies = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  const a = await lies(); const t0 = Date.now();
  await P.waitForTimeout(ms);
  const b = await lies();
  await cdp.detach();
  return (b - a) / ((Date.now() - t0) / 1000);
};
const kontrast = (a, b) => {
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = ([r, g, bl]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Für Bilder: das Zeichen groß (600 px breit) auf eigener Fläche zeigen — es bleibt dasselbe Element, das Wasser läuft weiter */
const gross = (P) => P.evaluate(() => {
  const buehne = document.createElement('div');
  buehne.id = 'm548-buehne';
  buehne.style.cssText = 'position:fixed;left:40px;top:120px;z-index:9999;padding:70px 60px 90px;background:var(--surface);color:var(--ink)';
  const z = document.querySelector('.agency-zeichen'); z.style.width = '600px'; z.style.height = '350.9px';
  buehne.appendChild(z); document.body.appendChild(buehne);
});
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

console.log('════ A: Form des Zeichens ════');
{
  const { ctx, P } = await seite({ ruhig: true, dpr: 4 });
  const bau = await P.evaluate(() => {
    const l = document.querySelector('.logo'); const svg = l.querySelector('svg.agency-px');
    const pfade = [...svg.querySelectorAll('.agency-zeichen-form path')];
    return { pfade: pfade.length, teile: pfade.map((p) => (p.getAttribute('d').match(/M/g) ?? []).length), viewBox: svg.getAttribute('viewBox'),
      text: svg.textContent.trim(), flaechen: svg.querySelectorAll('rect, image, text, use').length, filter: svg.querySelector('g[filter]') !== null,
      zusatz: l.querySelector('.agency-zusatz')?.textContent, label: l.getAttribute('aria-label'), versteckt: l.querySelector('.agency-marke')?.getAttribute('aria-hidden'),
      alt: l.querySelectorAll('.agency-b, .agency-punkt').length };
  });
  pruefe('A eigenes SVG: zwei Pfade (P mit Punze, X aus zwei Armen und zwei i-Punkten), kein Text, keine Fläche',
    bau.pfade === 2 && bau.teile[0] === 2 && bau.teile[1] === 4 && bau.viewBox === '0 0 171 100' && bau.text === '' && bau.flaechen === 0, bau);
  pruefe('A daneben leicht „NOTES", Name für Vorleser bleibt, alte Wortmarke (Buchstaben, Punkt) ist weg',
    bau.zusatz === 'NOTES' && bau.label === 'PixiNotes – zur Übersicht' && bau.versteckt === 'true' && bau.alt === 0, bau);
  pruefe('A reduzierte Bewegung: trocken, ohne Filter', !bau.filter);
  const clip = await ausschnitt(P);
  const m = await maske(P, await foto(P, clip));
  // Spalten des X (rechts von 83/171 der Zeichenbreite), Zeilen in Zeichen-Höhe 0…100
  const skala = m.h / clip.height; const k = clip.kasten;
  const zeile = (y100) => Math.round((RAND + (k.height * y100) / 100) * skala);
  const spalte = (x171) => Math.round((RAND + (k.width * x171) / 171) * skala);
  const laeufe = (y100) => {
    const y = zeile(y100); let n = 0; let vor = 0;
    for (let x = spalte(80); x < spalte(174); x += 1) { const v = m.m[y * m.b + x]; if (v && !vor) n += 1; vor = v; }
    return n;
  };
  const leer = (y100) => { const y = zeile(y100); for (let x = spalte(80); x < spalte(174); x += 1) if (m.m[y * m.b + x]) return false; return true; };
  const oben = [4, 9, 14].map(laeufe); const luecke = [19, 21.5, 24].map(leer); const arme = [80, 90].map(laeufe);
  pruefe(`A über dem X zwei getrennte i-Punkte (Läufe je Zeile ${oben}), darunter eine durchgehende Lücke, dann die Arme (${arme})`,
    oben.every((n) => n === 2) && luecke.every(Boolean) && arme.every((n) => n === 2), { oben, luecke, arme });
  // kein Hintergrund: die Fläche hinter dem Zeichen ist die des Logo-Knopfs
  const flaeche = await P.evaluate(() => [getComputedStyle(document.querySelector('.agency-zeichen')).backgroundColor, getComputedStyle(document.querySelector('.agency-px')).backgroundColor]);
  pruefe('A kein Hintergrund am Zeichen', flaeche.every((f) => f === 'rgba(0, 0, 0, 0)'), flaeche);
  if (BILDER) {
    // großes Standbild hell: Zeichen in 600 px Breite
    await gross(P); await P.waitForTimeout(200);
    await P.locator('#m548-buehne').screenshot({ path: path.join(BILDER, 'standbild-hell.png') });
  }
  await ctx.close();
}

console.log('════ B: Wasser fließt deutlich und wandert ════');
{
  // trockenes Zeichen als Bezug: dieselbe Seite mit reduzierter Bewegung (gleiche Lage, gleiche Auflösung)
  let trocken;
  {
    const { ctx, P } = await seite({ dpr: 3, ruhig: true });
    trocken = await maske(P, await foto(P, await ausschnitt(P)));
    await ctx.close();
  }
  const { ctx, P } = await seite({ dpr: 3 });
  const clip = await ausschnitt(P);
  pruefe('B fließend: Filter an', (await warteBis(P, () => P.evaluate(() => !!document.querySelector('.agency-px g[filter]')))) !== null);
  // Kantenband des trockenen Zeichens (±1 Bildpunkt): dort weicht schon das gefilterte vom ungefilterten Bild ab
  // (Kantenglättung) — gezählt wird nur, was das Wasser wirklich hinzufügt oder wegnimmt
  const band = new Uint8Array(trocken.m.length);
  for (let y = 1; y < trocken.h - 1; y += 1) for (let x = 1; x < trocken.b - 1; x += 1) {
    const i = y * trocken.b + x; const v = trocken.m[i];
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (trocken.m[i + dy * trocken.b + dx] !== v) band[i] = 1;
  }
  // Strichstärke in Bildpunkten (20 von 100 Einheiten Versalhöhe)
  const strich = (20 / 100) * clip.kasten.height * (trocken.h / clip.height);
  const werte = []; const orte = []; let zwischen = 0; let ausbuchtung = 0;
  // ein Fluss-Zyklus dauert ~25 s; alle ~0,7 s ein Bild — dazwischen läuft die Seite ungestört (Fotos halten den
  // Bild-Takt an, und das Wasser spult nach einem hängenden Bild bewusst nicht vor)
  const ab = Date.now();
  while (Date.now() - ab < 26000) {
    const m = await maske(P, await foto(P, clip));
    let n = 0; let sx = 0; let sy = 0;
    const neu = [];
    for (let i = 0; i < m.m.length; i += 1) {
      if (band[i] || m.m[i] === trocken.m[i]) continue;
      n += 1; sx += i % m.b; sy += Math.floor(i / m.b);
      if (m.m[i]) neu.push(i);
    }
    // Ausbuchtung: wie weit ragt das Wasser über das trockene Zeichen hinaus (größter Abstand eines neuen Punkts zur
    // nächsten trockenen Tinte, in Strichstärken)
    for (const i of neu) {
      const x = i % m.b; const y = Math.floor(i / m.b); let best = Infinity;
      const R = Math.ceil(strich * 1.5);
      for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= m.b || yy >= m.h || !trocken.m[yy * m.b + xx]) continue;
        best = Math.min(best, Math.hypot(dx, dy));
      }
      ausbuchtung = Math.max(ausbuchtung, Math.min(best, R) / strich);
    }
    const anteil = n / trocken.tinte;
    werte.push(anteil);
    if (anteil > 0.02) orte.push([sx / n / m.b, sy / n / m.h]);
    zwischen = Math.max(zwischen, m.zwischen);
    await P.waitForTimeout(700);
  }
  const spitze = Math.max(...werte); const mittel = werte.reduce((a, b) => a + b, 0) / werte.length;
  // M547 ließ den Strich höchstens um eine Kontur von 0,04 em wachsen (bei 22 px Schrift unter einem Punkt, je Seite
  // ~7 % der Strichstärke). Hier muss ein Tropfen mindestens 0,4 Strichstärken über das Zeichen hinausragen — gut das
  // Fünffache — und das Wasser im Mittel sichtbar sein (≥ 2 % der Tinte verändert, an der Spitze ≥ 5 %).
  pruefe(`B deutlich: Tropfen ragt ${ausbuchtung >= 1.5 ? '≥ 1,5' : ausbuchtung.toFixed(2)} Strichstärken über das Zeichen (M547: ~0,07); Abweichung Spitze ${(spitze * 100).toFixed(1)} %, Mittel ${(mittel * 100).toFixed(1)} % (${werte.length} Bilder)`,
    ausbuchtung >= 0.4 && spitze >= 0.05 && mittel >= 0.02, werte.map((w) => w.toFixed(2)).join(' '));
  const xs = orte.map((o) => o[0]);
  const verteilt = Math.max(...xs) - Math.min(...xs);
  // „Orte" = Schwerpunkte, die mindestens 15 % der Ausschnittbreite voneinander entfernt liegen
  const verschieden = [];
  for (const o of orte) if (!verschieden.some((v) => Math.hypot(v[0] - o[0], v[1] - o[1]) < 0.15)) verschieden.push(o);
  pruefe(`B die nasse Stelle wandert: ${verschieden.length} Orte, über ${(verteilt * 100).toFixed(0)} % der Breite`, verschieden.length >= 3 && verteilt >= 0.4, verschieden.map((o) => o.map((v) => v.toFixed(2)).join('/')).join(' '));
  pruefe(`B Kanten scharf: höchstens ${(zwischen * 100).toFixed(0)} % der Randpunkte sind Zwischentöne`, zwischen < 0.4, zwischen);
  const bilder = async (ms) => { const a = await P.evaluate(() => window.__bilder); await P.waitForTimeout(ms); return ((await P.evaluate(() => window.__bilder)) - a) / (ms / 1000); };
  const t = await hauptthread(P, 4000);
  // Kopfleisten-Größe, ohne Grafikkarte (Software-Raster): 30 Bilder je Sekunde kosten ~25 ms Hauptthread je Sekunde
  pruefe(`C Hauptthread beim Fließen: ${(t * 1000).toFixed(0)} ms je Sekunde (Grenze 80)`, t < 0.08, t);
  const fliessend = await bilder(2000);

  // verdeckter Tab: nichts ändert sich, kein Bild-Takt
  await P.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await P.waitForTimeout(300);
  const verdeckt = await staende(P, 2500);
  const bv = await bilder(2000);
  pruefe(`C verdeckter Tab: das Wasser steht (${verdeckt} Stand), Bild-Takt ${bv.toFixed(1)}/s (fließend ${fliessend.toFixed(0)}/s)`, verdeckt === 1 && bv < 1 && fliessend > 20);
  await P.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  pruefe('C sichtbar: fließt weiter', (await staende(P, 1500)) > 3);

  // außerhalb des Bildes (Fokus-Modus blendet die Kopfleiste aus)
  await P.evaluate(() => { document.querySelector('.logo-wrap').style.display = 'none'; });
  await P.waitForTimeout(300);
  const weg = await staende(P, 2500);
  const bw = await bilder(2000);
  pruefe(`C Zeichen nicht zu sehen: das Wasser steht (${weg} Stand), Bild-Takt ${bw.toFixed(1)}/s`, weg === 1 && bw < 1);
  await P.evaluate(() => { document.querySelector('.logo-wrap').style.display = ''; });
  pruefe('C wieder zu sehen: fließt weiter', (await warteBis(P, async () => (await staende(P, 800)) > 3)) !== null);

  // Zug einer Karte: das Wasser steht
  const titel = await P.locator('.react-flow__node[data-id="k1"] .kanban-title').boundingBox();
  await P.mouse.move(titel.x + 60, titel.y + 4); await P.mouse.down();
  await P.mouse.move(titel.x + 90, titel.y + 30, { steps: 4 });
  await P.waitForTimeout(150);
  const imZug = staende(P, 1500);
  const z0 = Date.now();
  while (Date.now() - z0 < 1600) { const a = (Date.now() - z0) / 1600; await P.mouse.move(titel.x + 90 + 200 * a, titel.y + 30 + 80 * Math.sin(a * 6)); }
  const zug = await imZug;
  await P.mouse.up();
  pruefe(`C während eines Zugs steht das Wasser (${zug} Stand)`, zug === 1);
  pruefe('C nach dem Zug fließt es weiter', (await warteBis(P, async () => (await staende(P, 800)) > 3)) !== null);

  if (BILDER) {
    // Bildfolge über einen Fluss-Zyklus: großes Zeichen, 6 Bilder im Abstand von ~1,3 s
    await gross(P); await P.waitForTimeout(300);
    for (let i = 0; i < 6; i += 1) {
      await P.locator('#m548-buehne').screenshot({ path: path.join(BILDER, `folge-${i + 1}.png`) });
      await P.waitForTimeout(1300);
    }
  }
  await ctx.close();
}

console.log('════ C: Ruhe ════');
for (const [name, opt] of [['reduzierte Bewegung', { ruhig: true }], ['„Besser lesbar"', { lesbar: true }]]) {
  const { ctx, P } = await seite(opt);
  const clip = await ausschnitt(P);
  const a = await foto(P, clip);
  const n = await staende(P, 3000);
  const b = await foto(P, clip);
  const r = await P.evaluate(() => ({ filter: !!document.querySelector('.agency-px g[filter]'), kreise: document.querySelector('.agency-px .agency-wasser').getAttribute('d') === '' }));
  pruefe(`C ${name}: trockenes Zeichen ohne Filter, steht still (Bildpunkte gleich)`, !r.filter && r.kreise && n === 1 && a.equals(b), r);
  await ctx.close();
}

console.log('════ D: hell und dunkel ════');
for (const dunkel of [false, true]) {
  const { ctx, P } = await seite({ dunkel, ruhig: true, dpr: 4 });
  const f = await P.evaluate(() => ({ tinte: getComputedStyle(document.querySelector('.agency-px')).color, flaeche: getComputedStyle(document.querySelector('.logo')).backgroundColor }));
  const v = kontrast(rgb(f.tinte), rgb(f.flaeche));
  pruefe(`D ${dunkel ? 'dunkel' : 'hell'}: Zeichen in Tinte ${f.tinte} auf ${f.flaeche}, Kontrast ${v.toFixed(1)}:1 ≥ 3:1`, v >= 3 && (dunkel ? rgb(f.tinte)[0] > 150 : rgb(f.tinte)[0] < 80), f);
  if (BILDER && dunkel) {
    await gross(P); await P.waitForTimeout(200);
    await P.locator('#m548-buehne').screenshot({ path: path.join(BILDER, 'standbild-dunkel.png') });
  }
  await ctx.close();
}
if (BILDER) {
  for (const dunkel of [false, true]) {
    const { ctx, P } = await seite({ dunkel, dpr: 2 });
    await P.waitForTimeout(2600);
    const r = await P.locator('.topbar').boundingBox();
    await P.screenshot({ path: path.join(BILDER, `kopfleiste-${dunkel ? 'dunkel' : 'hell'}.png`), clip: { x: 0, y: 0, width: Math.min(1280, r.x + r.width + 20), height: r.y + r.height + 14 } });
    await ctx.close();
  }
}

console.log('════ E: Klassisch und pix·el unverändert ════');
for (const design of ['klassisch', 'pixel']) {
  const anfragen = [];
  const { ctx, P } = await seite({ design, anfragen });
  const html = await P.evaluate(() => document.querySelector('.logo').innerHTML);
  pruefe(`E ${design}: Wortmarke „Pixi<span>Notes</span>", kein Zeichen, Modul nicht geladen`,
    html === 'Pixi<span>Notes</span>' && !anfragen.some((u) => /agencyLogo/.test(u)), html);
  await ctx.close();
}

console.log('════ F: Seitenfehler ════');
pruefe('F keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
if (BILDER) writeFileSync(path.join(BILDER, 'LIESMICH.txt'), 'M548: Standbilder hell/dunkel, Bildfolge folge-1…6, Kopfleiste hell/dunkel.\n');

await browser.close(); app.close();
console.log(`\nM548: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
