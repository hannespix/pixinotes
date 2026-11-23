/**
 * M464 — Mauszeiger überall gut sichtbar (Windows).
 *
 * Nutzermeldung: „maus cursor ist in manchen modulen/situationen in windows kaum sichtbar!"
 * Ursache: Das System-Fadenkreuz (`cursor: crosshair`) ist unter Windows ein 1-px-Kreuz, das die Pixel darunter
 * invertiert — auf mittelgrauen Flächen und Screenshots verschwindet es, bei 150 % Anzeige ist es haarfein. Und
 * der Laser in der Präsentation versteckte den Zeiger (`cursor: none`), auch solange noch kein Laserpunkt stand.
 *
 *   A  Regeln im Stylesheet: `cursor: none` nur an den zwei bekannten Stellen (Laser mit sichtbarem Punkt, ruhender
 *      Zeiger im Vollbild „Nur Inhalt"); jedes eigene url() hat einen System-Fallback; kein nacktes `crosshair` mehr.
 *   B  Board-Zeichnen: Stift und Textmarker zeigen das eigene Fadenkreuz, der Radierer das gut sichtbare `cell`.
 *   C  Weitere Stellen (Anschluss-Punkte zum Verbinden, PDF-Pin, Bild bearbeiten): berechneter Zeiger = Fadenkreuz.
 *   D  Präsentation: Stift → Fadenkreuz; Laser per L ohne Mausbewegung → Zeiger bleibt sichtbar; bewegt → Punkt
 *      sichtbar und erst dann `none`; Maus verlässt die Folie → Zeiger wieder da.
 *   E  Nur-Inhalt-Vollbild: ruhend weg, bewegt wieder da.
 *   F  Das Zeigerbild selbst: ≤ 32 px, Hotspot im Bild, auf hellem, mittelgrauem und dunklem Grund mit kräftigem
 *      Kontrast (dunkle UND helle Randpixel) — bei Anzeige 100 % und 150 %, im hellen und im dunklen Design.
 */
// Läuft aus dem Repository: `node pruefungen/m464-mauszeiger.mjs` (braucht `npm run build`)
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
const PORT = 5464;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const absatz = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] });
const stand = {
  boards: [{
    id: 'b1', name: 'Zeiger', edges: [], drawings: [], comments: [],
    nodes: [
      { id: 'n1', type: 'note', position: { x: 40, y: 60 }, width: 300, height: 220, data: { title: 'Einstieg', blocks: [absatz('Erstens.'), absatz('Zweitens.')] } },
      { id: 'n2', type: 'note', position: { x: 420, y: 60 }, width: 300, height: 220, data: { title: 'Weiter', blocks: [absatz('Drittens.')] } },
    ],
  }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const seite = async ({ dunkel = false, dpr = 1 } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE', deviceScaleFactor: dpr, colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(({ s }) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes:author', 'Cleo');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, { s: stand });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2000);
  return { ctx, P };
};
const zeigerVon = (P, sel) => P.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).cursor : null; }, sel);
const istFadenkreuz = (c) => typeof c === 'string' && /^url\("data:image\/svg\+xml/.test(c) && /\b12 12, crosshair$/.test(c.trim());
/** Ein Element mit diesen Klassen in den passenden Rahmen setzen und den berechneten Zeiger lesen */
const zeigerFuer = (P, html) => P.evaluate((h) => {
  const box = document.createElement('div'); box.innerHTML = h; box.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(box);
  const ziel = box.querySelector('[data-ziel]');
  const c = ziel ? getComputedStyle(ziel).cursor : null;
  box.remove(); return c;
}, html);

const { ctx, P } = await seite();

console.log('\n════ A: Regeln im Stylesheet ════');
{
  const regeln = await P.evaluate(() => {
    const aus = [];
    const lauf = (liste) => { for (const r of Array.from(liste)) {
      if (r.cssRules) lauf(r.cssRules);
      if (!r.style) continue;
      const c = r.style.getPropertyValue('cursor');
      const v = r.style.getPropertyValue('--zeiger-fadenkreuz');
      if (c) aus.push({ sel: r.selectorText, c: c.trim() });
      if (v) aus.push({ sel: r.selectorText, c: v.trim(), variable: true });
    } };
    for (const s of Array.from(document.styleSheets)) { try { lauf(s.cssRules); } catch { /* fremd */ } }
    return aus;
  });
  const nichts = regeln.filter((r) => r.c === 'none');
  pruefe('A1 `cursor: none` nur beim sichtbaren Laserpunkt und beim ruhenden Zeiger im Vollbild',
    nichts.length === 2 && nichts.every((r) => /laser-punkt\.mein\[data-sichtbar\]|data-rein-ruhe/.test(r.sel)), nichts.map((r) => r.sel));
  const urls = regeln.filter((r) => /url\(/.test(r.c));
  pruefe('A2 jedes eigene Zeigerbild hat einen System-Fallback (`…, crosshair` o. ä.)',
    urls.length >= 1 && urls.every((r) => /,\s*[a-z-]+$/.test(r.c)), urls.map((r) => r.c.slice(-30)));
  const nackt = regeln.filter((r) => r.c === 'crosshair' && !/react-flow__handle\.connectionindicator/.test(r.sel ?? ''));
  const rfUeberschrieben = await zeigerFuer(P, '<div class="react-flow"><div class="react-flow__handle connectionindicator" data-ziel></div></div>');
  pruefe('A3 kein nacktes System-Fadenkreuz mehr (auch das von React Flow an Anschlüssen ist überschrieben)',
    nackt.length === 0 && istFadenkreuz(rfUeberschrieben), { nackt: nackt.map((r) => r.sel), rfUeberschrieben });
}

console.log('\n════ B: Zeichnen auf dem Board ════');
{
  const werkzeug = async (name) => {
    await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
    if (await P.locator('.dock-menu-draw').count() === 0) { await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250); }
    await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(300);
  };
  await werkzeug('Stift');
  const stift = await zeigerVon(P, '.drawing-layer');
  pruefe('B1 Stift: eigenes Fadenkreuz mit Fallback', istFadenkreuz(stift), stift);
  await werkzeug('Textmarker');
  pruefe('B2 Textmarker: dasselbe Fadenkreuz', istFadenkreuz(await zeigerVon(P, '.drawing-layer')));
  await werkzeug('Radierer');
  pruefe('B3 Radierer: das System-„cell" (unter Windows dickes weißes Plus mit Rand)', (await zeigerVon(P, '.drawing-layer')) === 'cell');
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
}

console.log('\n════ C: Verbinden, PDF-Pin, Bild bearbeiten ════');
{
  const handle = await zeigerVon(P, '.react-flow__node .pn-handle');
  pruefe('C1 Anschluss-Punkt einer Karte (Verbinden): Fadenkreuz', istFadenkreuz(handle), handle);
  pruefe('C2 PDF-Seite im Pin-Modus: Fadenkreuz', istFadenkreuz(await zeigerFuer(P, '<div class="pdf-seite pin-modus" data-ziel></div>')));
  pruefe('C3 Bild bearbeiten (Zeichenblatt): Fadenkreuz', istFadenkreuz(await zeigerFuer(P, '<div class="be-blatt" data-ziel></div>')));
}

console.log('\n════ D: Präsentation – Stift und Laser ════');
{
  await P.keyboard.press('Escape'); await P.mouse.click(1200, 760); await P.waitForTimeout(250);
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click();
  await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(800);
  await P.locator('[data-taste="vortrag-stift"]').click(); await P.waitForTimeout(300);
  pruefe('D1 Stift auf der Folie: Fadenkreuz', istFadenkreuz(await zeigerVon(P, '.folien-stift.an')));
  await P.keyboard.press('e'); await P.waitForTimeout(200);
  pruefe('D2 Radierer auf der Folie: „cell"', (await zeigerVon(P, '.folien-stift.an')) === 'cell');
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  // Maus ruht mitten auf der Folie, dann L: vorher war der Zeiger weg, ohne dass ein Punkt stand
  const f = await P.locator('.presenter-slide').boundingBox();
  const mitte = [f.x + f.width / 2, f.y + f.height / 2];
  await P.mouse.move(mitte[0], mitte[1]); await P.waitForTimeout(150);
  await P.keyboard.press('l'); await P.waitForTimeout(300);
  const lage = () => P.evaluate(() => { const l = document.querySelector('.folien-laser.an'); const p = l?.querySelector('.laser-punkt.mein'); return l ? { zeiger: getComputedStyle(l).cursor, punkt: p ? Number(getComputedStyle(p).opacity) : -1 } : null; });
  const l1 = await lage();
  pruefe('D3 Laser per L, Maus nicht bewegt: noch kein Punkt – der Systemzeiger bleibt sichtbar', !!l1 && l1.punkt === 0 && l1.zeiger !== 'none', l1);
  await P.mouse.move(mitte[0] + 30, mitte[1] + 10, { steps: 3 }); await P.waitForTimeout(200);
  const l2 = await lage();
  pruefe('D4 bewegt: der Laserpunkt steht und ersetzt den Zeiger (`none` nur jetzt)', !!l2 && l2.punkt === 1 && l2.zeiger === 'none', l2);
  await P.mouse.move(5, 5, { steps: 4 }); await P.waitForTimeout(200);
  const l3 = await lage();
  pruefe('D5 Maus verlässt die Folie: Punkt weg, Zeiger wieder da', !!l3 && l3.punkt === 0 && l3.zeiger !== 'none', l3);
  await P.keyboard.press('l'); await P.waitForTimeout(200);
  await P.mouse.move(mitte[0], mitte[1], { steps: 3 }); await P.waitForTimeout(150);
  await P.keyboard.press('l'); await P.waitForTimeout(300);
  const l4 = await lage();
  pruefe('D6 Laser aus und wieder an (Maus ruht): Zeiger sichtbar, kein Rest vom letzten Punkt', !!l4 && l4.punkt === 0 && l4.zeiger !== 'none', l4);
  await P.keyboard.press('l'); await P.waitForTimeout(200);
}

console.log('\n════ E: Nur-Inhalt-Vollbild ════');
{
  await P.mouse.move(700, 450); await P.keyboard.press('f'); await P.waitForTimeout(700);
  await P.mouse.move(720, 460); await P.waitForTimeout(2300);
  pruefe('E1 ruhend im Vollbild: Zeiger ausgeblendet (gewollt)', await P.evaluate(() => getComputedStyle(document.body).cursor === 'none'));
  await P.mouse.move(700, 300); await P.waitForTimeout(150);
  pruefe('E2 bewegt: sofort wieder sichtbar', await P.evaluate(() => getComputedStyle(document.body).cursor !== 'none'));
  await P.keyboard.press('Escape'); await P.waitForTimeout(600);
}
const bild = (await P.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zeiger-fadenkreuz'))).trim();
await ctx.close();

console.log('\n════ F: Das Zeigerbild – Größe und Kontrast ════');
const url = (bild.match(/url\("([^"]+)"\)/) ?? [])[1];
pruefe('F0 Variable --zeiger-fadenkreuz trägt ein Bild', !!url, bild.slice(0, 60));
for (const dpr of [1, 1.5]) {
  for (const dunkel of [false, true]) {
    const s = await seite({ dunkel, dpr });
    const name = `${dunkel ? 'dunkel' : 'hell'} ${dpr * 100} %`;
    const thema = await s.P.evaluate(() => document.documentElement.dataset.theme ?? 'light');
    const r = await s.P.evaluate(async (u) => {
      const img = new Image(); img.src = u; await img.decode();
      const w = img.naturalWidth; const h = img.naturalHeight;
      const dpr = window.devicePixelRatio; const W = Math.round(w * dpr); const H = Math.round(h * dpr);
      const gruende = { hell: [255, 255, 255], board: null, grau: [128, 128, 128], dunkel: [30, 30, 30] };
      // Auch der echte Board-Hintergrund dieses Designs
      const pane = document.querySelector('.react-flow') ?? document.body;
      const m = getComputedStyle(pane).backgroundColor.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
      gruende.board = m.slice(0, 3);
      const aus = { w, h, W, H };
      for (const [k, g] of Object.entries(gruende)) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d'); x.fillStyle = `rgb(${g})`; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H);
        const d = x.getImageData(0, 0, W, H).data;
        const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const bg = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
        let dunkelPx = 0; let hellPx = 0; let abgehoben = 0;
        for (let i = 0; i < d.length; i += 4) { const L = lum(i); if (L < 50) dunkelPx++; if (L > 205) hellPx++; if (Math.abs(L - bg) > 90) abgehoben++; }
        // als Anteil der CSS-Pixelfläche, damit 100 % und 150 % vergleichbar sind
        aus[k] = { bg: Math.round(bg), dunkel: +(dunkelPx / dpr / dpr).toFixed(1), hell: +(hellPx / dpr / dpr).toFixed(1), abgehoben: +(abgehoben / dpr / dpr).toFixed(1) };
      }
      return aus;
    }, url);
    pruefe(`F1 ${name} (Design ${thema}): Bild 24×24 CSS-px (≤ 32), Hotspot 12 12 liegt darin`, r.w === 24 && r.h === 24 && /\b12 12,/.test(bild), { w: r.w, h: r.h });
    for (const k of ['hell', 'board', 'grau', 'dunkel']) {
      const g = r[k];
      // Ein dünnes 1-px-Kreuz hätte ~40 px² — hier zählen dunkler Kern UND heller Rand je ≥ 30 px², abgehoben ≥ 30 px²
      pruefe(`F2 ${name} auf ${k} (Helligkeit ${g.bg}): dunkler Kern und heller Rand, deutlich abgehoben`, g.dunkel >= 30 && g.hell >= 30 && g.abgehoben >= 30, g);
    }
    await s.ctx.close();
  }
}
pruefe('F3 keine Seitenfehler', fehler.length === 0, fehler);

// Bild zum Anschauen: Zeiger auf vier Gründen, vergrößert
{
  const ctx2 = await browser.newContext({ viewport: { width: 520, height: 160 } });
  const S = await ctx2.newPage();
  await S.setContent(`<body style="margin:0;display:flex">${['#fff', '#808080', '#1e1e1e', '#f5e6a8'].map((g) => `<div style="width:130px;height:160px;background:${g};display:grid;place-items:center"><img src="${url}" style="width:96px;height:96px"></div>`).join('')}</body>`);
  await S.waitForTimeout(200);
  await S.screenshot({ path: path.join(SD, 'm464-fadenkreuz.png') });
  await ctx2.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
