/**
 * M500 — Flüssige Schrift (Liquid Type von Hannes Pix als Karte).
 *
 *   A  Anlegen über ＋ (Suchwort „liquid“) → Karte mit „Hallo“; die Engine (motor-*.js) ist nicht im Start-JS und
 *      kommt erst, wenn eine solche Karte sichtbar ist; Start-JS unter der Grenze von M483.
 *   B  Die Fläche zeichnet: Tinte auf der Karte, die Form folgt dem Text (breites „Wasserfall“ vs. schmales „I“).
 *   C  Text im Fokus ändern (Feld der Werkzeugleiste) → nach Neuladen erhalten; gespeichert sind nur Text + Optionen.
 *   D  Die Maus über der Karte verändert das Bild; markiert zieht ein Druck die Flüssigkeit, Halten lässt sie platzen.
 *   E  Ruhe: kommt die Flüssigkeit zur Ruhe, läuft kein Takt mehr; eine Karte außerhalb des Sichtfelds lädt nichts
 *      und rechnet nicht; gepannt aus dem Bild bzw. bei verdecktem Tab hört der Takt auf.
 *   F  Leistung: Bilder je Sekunde mit 1 und 3 Karten unter Bewegung; höchstens drei Karten rechnen zugleich.
 *   G  Reduzierte Bewegung: ruhend gezeichnet, kein Takt.
 *   H  Ohne WebGL2: der Text als normale Schrift mit kurzer Meldung.
 *   I  Hell/Dunkel: die Tinte folgt dem Thema (dunkel → helle Flüssigkeit); Bildschirmfotos.
 *   J  Präsentation: die Karte lebt auf der Folie; Export/KI lesen den Text.
 *   K  Ein-Datei-Fassung (release/pixinotes.html, falls mit dieser Karte gebaut) zeigt die Karte offline per file://.
 */
// Läuft aus dem Repository: `node pruefungen/m500-fluessige-schrift.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5500;
const START_JS_GRENZE = 2_120_000;
/** NUR=K (oder NUR=AF …) lässt nur diese Abschnitte laufen — zum schnellen Nachprüfen */
const laufe = (teil) => !process.env.NUR || [...teil].some((b) => process.env.NUR.includes(b));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
let anfragen = [];
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  anfragen.push(pfad);
  let f = path.join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const fl = (id, text, x, y, extra = {}) => ({ id, type: 'fluessig', width: 440, height: 220, autoFit: false, position: { x, y }, data: { text, ...extra } });
const note = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const stand = (nodes, ui) => ({
  boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, ...(ui ? { ui } : {}),
});
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: opt.reduziert ? 'reduce' : 'no-preference' });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`) && !u.href.startsWith('file:'), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(([st, ohneGl]) => {
    if (ohneGl) {
      const alt = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (art, ...rest) { return art === 'webgl2' ? null : alt.call(this, art, ...rest); };
    }
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand(nodes, opt.ui), !!opt.ohneGl]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  anfragen = [];
  await P.goto(opt.url ?? `http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow', { state: 'visible', timeout: 30000 });
  return { ctx, P, fehler };
}
const warteBis = async (P, fn, ms = 15000, arg) => P.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
const zaehler = (P) => P.evaluate(() => ({ ...(window.pixinotesFluessig ?? { takte: 0, laufend: 0, flaechen: 0 }) }));
/** Tinte der Fläche einer Karte: Anteil, Rahmen und ein grobes Abbild zum Vergleichen */
const tinte = (P, id) => P.evaluate((kid) => {
  const c = document.querySelector(`.react-flow__node[data-id="${kid}"] canvas.fl-flaeche`);
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; const bild = [];
  let hell = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const k = (y * c.width + x) * 4 + 3;
    if (d[k] > 128) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; hell += d[k - 3]; }
    if (x % 4 === 0 && y % 4 === 0) bild.push(d[k] > 128 ? 1 : 0);
  }
  return { anteil: n / (c.width * c.height), breite: x1 - x0, hoehe: y1 - y0, bild, rot: n ? hell / n : 0, w: c.width };
}, id);
const unterschied = (a, b) => { let n = 0; for (let i = 0; i < Math.min(a.bild.length, b.bild.length); i++) if (a.bild[i] !== b.bild[i]) n++; return n; };
const ruht = (P, id) => warteBis(P, (kid) => document.querySelector(`.react-flow__node[data-id="${kid}"] canvas.fl-flaeche`)?.__fluessig?.zustand().ruht === true, 15000, id);
const mitte = async (P, id) => { const b = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
/** Ansicht auf eine Karte: mit dem Rad hinschwenken (panOnScroll), mit Strg+Rad hineinzoomen, bis sie ~breit genug ist */
async function aufKarte(P, id, breite = 400) {
  for (let r = 0; r < 40; r++) {
    const b = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
    if (!b) return false;
    const dx = b.x + b.width / 2 - 640, dy = b.y + b.height / 2 - 380;
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) { await P.mouse.move(640, 380); await P.mouse.wheel(dx, dy); await P.waitForTimeout(80); continue; }
    if (b.width >= breite) return true;
    await P.mouse.move(640, 380); await P.keyboard.down('Control'); await P.mouse.wheel(0, -240); await P.keyboard.up('Control'); await P.waitForTimeout(80);
  }
  return false;
}
const gespeichert = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}'));
const jsAssets = () => [...new Set(anfragen)].filter((p) => p.startsWith('/assets/') && p.endsWith('.js')).map((p) => p.split('/').pop());

// ══ A: Anlegen, Start-JS ═══════════════════════════════════════════
console.log('\n════ A: Anlegen und Start ════');
if (laufe('A')) {
  const { ctx, P, fehler } = await seite([note('n1', 'Hallo Welt')]);
  await P.waitForLoadState('networkidle');
  await P.waitForTimeout(400);
  const start = jsAssets();
  const summe = start.reduce((a, f) => a + statSync(path.join(DIST, 'assets', f)).size, 0);
  console.log(`  Start-JS ${summe} B in ${start.length} Dateien`);
  pruefe(`A1 Start-JS unter ${START_JS_GRENZE} B (ist ${summe} B)`, summe < START_JS_GRENZE && summe > 1_000_000, String(summe));
  pruefe('A2 die Engine ist nicht im Start', !start.some((f) => f.startsWith('motor-')), start.join(', '));
  pruefe('A3 die Engine liegt als eigene Datei im Build', readdirSync(path.join(DIST, 'assets')).some((f) => f.startsWith('motor-') && f.endsWith('.js')));
  await P.locator('.dock .dock-add-wrap').nth(0).locator('button').first().click();
  await P.fill('.modul-suche input', 'liquid');
  pruefe('A4 die Palette findet „Flüssige Schrift“ über „liquid“', await P.locator('.modul-kachel[data-modul="fluessig"]').count() === 1);
  await P.locator('.modul-kachel[data-modul="fluessig"]').click();
  const da = await warteBis(P, () => !!document.querySelector('.react-flow__node-fluessig canvas.fl-flaeche')?.__fluessig);
  pruefe('A5 eine Karte liegt auf dem Board, die Engine lief an', da);
  pruefe('A6 die Engine kam erst jetzt (motor-*.js nachgeladen)', jsAssets().some((f) => f.startsWith('motor-')));
  const id = await P.locator('.react-flow__node-fluessig').first().getAttribute('data-id');
  await ruht(P, id);
  const t = await tinte(P, id);
  pruefe('A7 die Karte zeigt „Hallo“ als Tinte', !!t && t.anteil > 0.03, JSON.stringify(t && { anteil: t.anteil }));
  const st = await gespeichert(P);
  const n = st.state.boards[0].nodes.find((x) => x.type === 'fluessig');
  pruefe('A8 gespeichert ist nur der Text (keine Simulation)', n?.data?.text === 'Hallo' && Object.keys(n.data).every((k) => ['text', 'zaeh', 'farbe', 'lebendig'].includes(k)), JSON.stringify(n?.data));
  pruefe('A9 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ B–E: eine Karte im Bild, eine weit draußen ═════════════════════
console.log('\n════ B–E: Zeichnen, Text, Maus, Ruhe ════');
if (laufe('BCDE')) {
  const { ctx, P, fehler } = await seite([fl('f1', 'Wasserfall', 0, 0), fl('f2', 'Draußen', 9000, 6000)]);
  await P.waitForSelector('.react-flow__node[data-id="f1"]', { state: 'attached' });
  await P.waitForTimeout(500);
  pruefe('B0 Ansicht auf die erste Karte (die zweite liegt weit draußen)', await aufKarte(P, 'f1'));
  await warteBis(P, () => !!document.querySelector('[data-id="f1"] canvas.fl-flaeche')?.__fluessig);
  await ruht(P, 'f1');
  const breit = await tinte(P, 'f1');
  pruefe('B1 die Fläche zeichnet Tinte', !!breit && breit.anteil > 0.03, JSON.stringify(breit && { anteil: breit.anteil }));
  await P.screenshot({ path: path.join(SD, 'm500-hell.png') });

  // C: markieren, Text im Feld der Werkzeugleiste ändern
  const m = await mitte(P, 'f1');
  await P.mouse.click(m.b.x + 6, m.b.y + 6);
  await P.waitForSelector('[data-id="f1"].selected', { timeout: 5000 }).catch(() => {});
  await P.locator('[data-id="f1"] .fl-text').fill('I');
  await P.locator('[data-id="f1"] .fl-text').press('Enter');
  await warteBis(P, () => document.querySelector('[data-id="f1"] canvas.fl-flaeche')?.__fluessig?.zustand().ruht === false, 3000);
  await ruht(P, 'f1');
  const schmal = await tinte(P, 'f1');
  pruefe('B2 die Form folgt dem Text: „I“ ist viel schmaler als „Wasserfall“', !!schmal && schmal.breite < breit.breite * 0.4, JSON.stringify({ breit: breit.breite, schmal: schmal?.breite }));
  await P.locator('[data-id="f1"] .fl-text').fill('Welle');
  await warteBis(P, () => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state?.boards?.[0]?.nodes?.find((n) => n.id === 'f1')?.data?.text === 'Welle', 8000);
  const f2geladen = await P.evaluate(() => !!document.querySelector('[data-id="f2"] canvas.fl-flaeche')?.__fluessig);
  pruefe('E1 die Karte außerhalb des Sichtfelds hat die Engine nicht angehängt', !f2geladen && (await zaehler(P)).flaechen === 1, JSON.stringify(await zaehler(P)));
  await P.reload();
  await P.waitForSelector('.react-flow__node[data-id="f1"]', { state: 'attached' });
  await P.waitForTimeout(500);
  await aufKarte(P, 'f1');
  await warteBis(P, () => !!document.querySelector('[data-id="f1"] canvas.fl-flaeche')?.__fluessig);
  pruefe('C1 nach Neuladen steht „Welle“ im Feld', await P.locator('[data-id="f1"] .fl-text').inputValue() === 'Welle');
  await ruht(P, 'f1');
  const welle = await tinte(P, 'f1');
  pruefe('C2 … und als Tinte (breiter als „I“)', !!welle && welle.breite > schmal.breite * 2, JSON.stringify({ welle: welle?.breite }));

  // E2: in Ruhe kein Takt
  const z0 = await zaehler(P); await P.waitForTimeout(1200); const z1 = await zaehler(P);
  pruefe('E2 in Ruhe läuft kein Takt (rAF-Zähler steht)', z1.takte === z0.takte && z1.laufend === 0, JSON.stringify({ z0, z1 }));

  // D: Maus über die Schrift (unmarkiert: schubsen und Magnet)
  await P.mouse.click(1200, 760); await P.waitForTimeout(200);
  const vor = await tinte(P, 'f1');
  const mm = await mitte(P, 'f1');
  const zd0 = await zaehler(P);
  for (let i = 0; i <= 12; i++) await P.mouse.move(mm.b.x + mm.b.width * (0.2 + 0.05 * i), mm.y + Math.sin(i) * 20, { steps: 2 });
  const nach = await tinte(P, 'f1');
  const zd1 = await zaehler(P);
  pruefe('D1 die Maus über der Karte verändert das Bild', unterschied(vor, nach) > 40, String(unterschied(vor, nach)));
  pruefe('D2 dabei läuft der Takt', zd1.takte > zd0.takte, JSON.stringify({ zd0, zd1 }));
  // Bildfolge für die Rückmeldung
  const folge = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) await P.mouse.move(mm.b.x + mm.b.width * (0.25 + 0.12 * (i + k / 4)), mm.y + (k % 2 ? 25 : -25), { steps: 2 });
    folge.push(await P.locator('.react-flow__node[data-id="f1"]').screenshot());
  }
  await P.mouse.move(1200, 760);
  // markiert: drücken und halten lässt platzen
  await ruht(P, 'f1');
  await P.mouse.click(mm.b.x + 6, mm.b.y + 6);
  await P.waitForSelector('[data-id="f1"].selected', { timeout: 5000 }).catch(() => {});
  pruefe('D3 markiert gehört der Druck der Flüssigkeit (nodrag)', await P.evaluate(() => document.querySelector('[data-id="f1"] canvas.fl-flaeche').classList.contains('nodrag')));
  const posVor = await P.locator('.react-flow__node[data-id="f1"]').boundingBox();
  const ruhig = await tinte(P, 'f1');
  await P.mouse.move(mm.x - 40, mm.y - 10); await P.mouse.down(); await P.waitForTimeout(700);
  folge.push(await P.locator('.react-flow__node[data-id="f1"]').screenshot());
  const geplatzt = await tinte(P, 'f1');
  await P.mouse.up();
  const posNach = await P.locator('.react-flow__node[data-id="f1"]').boundingBox();
  pruefe('D4 gedrückt halten lässt die Flüssigkeit platzen (Bild stark verändert)', unterschied(ruhig, geplatzt) > unterschied(vor, nach), JSON.stringify({ platzen: unterschied(ruhig, geplatzt) }));
  pruefe('D5 … und die Karte bleibt liegen', Math.abs(posVor.x - posNach.x) < 1 && Math.abs(posVor.y - posNach.y) < 1);
  await ruht(P, 'f1');
  folge.push(await P.locator('.react-flow__node[data-id="f1"]').screenshot());
  const zurueck = await tinte(P, 'f1');
  pruefe('D6 sie findet wieder zusammen', unterschied(ruhig, zurueck) < unterschied(ruhig, geplatzt) / 3, JSON.stringify({ zurueck: unterschied(ruhig, zurueck) }));
  // Bildfolge als ein PNG (nebeneinander) über eine Seite im selben Browser zusammensetzen
  const bp = await ctx.newPage();
  await bp.setContent(`<body style="margin:0;display:flex;gap:6px;background:#ddd">${folge.map((b) => `<img src="data:image/png;base64,${b.toString('base64')}" style="height:180px">`).join('')}</body>`);
  await bp.screenshot({ path: path.join(SD, 'm500-bildfolge.png'), fullPage: true });
  await bp.close();

  // E3: aus dem Bild gepannt → Takt hört auf
  await P.mouse.click(1200, 760); await P.waitForTimeout(150);
  await P.mouse.move(mm.x, mm.y);
  for (let i = 0; i < 6; i++) await P.mouse.move(mm.x + i * 15, mm.y + (i % 2) * 20, { steps: 2 });
  await P.mouse.move(1200, 700);
  await P.mouse.wheel(0, 2500); await P.waitForTimeout(300); await P.mouse.wheel(2500, 0);
  const draussen = await warteBis(P, () => document.querySelector('[data-id="f1"] canvas.fl-flaeche')?.__fluessig?.zustand().sichtbar === false, 5000);
  await P.waitForTimeout(300);
  const ze0 = await zaehler(P); await P.waitForTimeout(800); const ze1 = await zaehler(P);
  pruefe('E3 aus dem Bild gepannt ruht die Simulation (kein Takt)', draussen && ze1.takte === ze0.takte, JSON.stringify({ draussen, ze0, ze1 }));
  await P.mouse.wheel(-2500, 0); await P.waitForTimeout(300); await P.mouse.wheel(0, -2500);
  await warteBis(P, () => document.querySelector('[data-id="f1"] canvas.fl-flaeche')?.__fluessig?.zustand().sichtbar === true, 5000);

  // E4: verdeckter Tab → kein Takt, auch wenn sie gerade lief
  await P.mouse.click(mm.b.x + 6, mm.b.y + 6);
  await P.mouse.move(mm.x - 40, mm.y); await P.mouse.down(); await P.waitForTimeout(550); await P.mouse.up();
  await P.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await P.waitForTimeout(150);
  const zh0 = await zaehler(P); await P.waitForTimeout(800); const zh1 = await zaehler(P);
  pruefe('E4 bei verdecktem Tab läuft kein Takt', zh1.takte === zh0.takte, JSON.stringify({ zh0, zh1 }));
  await P.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  pruefe('E5 wieder sichtbar läuft sie weiter und kommt zur Ruhe', await ruht(P, 'f1'));
  pruefe('B3 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ F: Leistung ═════════════════════════════════════════════════════
console.log('\n════ F: Leistung ════');
async function fps(P, ids) {
  const punkte = [];
  for (const id of ids) punkte.push(await mitte(P, id));
  await P.evaluate(() => { window.__bilder = 0; const z = () => { window.__bilder++; requestAnimationFrame(z); }; requestAnimationFrame(z); });
  const t0 = Date.now(); const b0 = await P.evaluate(() => window.__bilder);
  let maxLaufend = 0;
  for (let r = 0; r < 3; r++) for (const p of punkte) {
    for (let i = 0; i < 8; i++) await P.mouse.move(p.b.x + p.b.width * (0.2 + 0.075 * i), p.y + (i % 2 ? 20 : -20), { steps: 3 });
    maxLaufend = Math.max(maxLaufend, (await zaehler(P)).laufend);
  }
  const b1 = await P.evaluate(() => window.__bilder);
  return { fps: Math.round((b1 - b0) / ((Date.now() - t0) / 1000)), maxLaufend };
}
if (laufe('F')) {
  const { ctx, P } = await seite([fl('p1', 'Eins', 0, 0)]);
  await warteBis(P, () => !!document.querySelector('[data-id="p1"] canvas.fl-flaeche')?.__fluessig); await ruht(P, 'p1');
  const eins = await fps(P, ['p1']);
  await ctx.close();
  const { ctx: c3, P: P3 } = await seite([fl('p1', 'Eins', 0, 0), fl('p2', 'Zwei', 480, 0), fl('p3', 'Drei', 0, 260), fl('p4', 'Vier', 480, 260)]);
  await warteBis(P3, () => document.querySelectorAll('canvas.fl-flaeche').length === 4 && [...document.querySelectorAll('canvas.fl-flaeche')].every((c) => c.__fluessig));
  for (const id of ['p1', 'p2', 'p3', 'p4']) await ruht(P3, id);
  const vier = await fps(P3, ['p1', 'p2', 'p3', 'p4']);
  console.log(`  Bilder je Sekunde unter Bewegung: 1 Karte ${eins.fps}, 4 Karten ${vier.fps} (gleichzeitig rechnend höchstens ${vier.maxLaufend})`);
  pruefe('F1 höchstens drei Karten rechnen gleichzeitig', vier.maxLaufend <= 3 && vier.maxLaufend >= 1, JSON.stringify(vier));
  pruefe('F2 die Seite bleibt flüssig genug (≥ 15 Bilder/s auch mit vier Karten, Software-Grafik)', eins.fps >= 15 && vier.fps >= 15, JSON.stringify({ eins, vier }));
  await c3.close();
}

// ══ G: Reduzierte Bewegung ═════════════════════════════════════════
console.log('\n════ G: Reduzierte Bewegung ════');
if (laufe('G')) {
  const { ctx, P, fehler } = await seite([fl('r1', 'Ruhig', 0, 0)], { reduziert: true });
  await warteBis(P, () => !!document.querySelector('[data-id="r1"] canvas.fl-flaeche')?.__fluessig);
  await warteBis(P, () => { const c = document.querySelector('[data-id="r1"] canvas.fl-flaeche'); return c && c.width > 10; });
  await P.waitForTimeout(300);
  const t = await tinte(P, 'r1');
  const m = await mitte(P, 'r1');
  for (let i = 0; i < 6; i++) await P.mouse.move(m.b.x + m.b.width * (0.2 + 0.1 * i), m.y, { steps: 2 });
  const z = await zaehler(P);
  pruefe('G1 ruhend gezeichnet: Tinte da, kein Takt', !!t && t.anteil > 0.03 && z.takte === 0, JSON.stringify({ anteil: t?.anteil, z }));
  pruefe('G2 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ H: Ohne WebGL2 ═════════════════════════════════════════════════
console.log('\n════ H: Ohne WebGL2 ════');
if (laufe('H')) {
  const { ctx, P, fehler } = await seite([fl('w1', 'Ohne Grafik', 0, 0)], { ohneGl: true });
  const da = await P.waitForSelector('[data-id="w1"] .fl-ersatz', { timeout: 15000 }).then(() => true, () => false);
  pruefe('H1 ohne WebGL2 steht der Text als normale Schrift', da && /Ohne Grafik/.test(await P.locator('[data-id="w1"] .fl-ersatz-text').innerText()));
  pruefe('H2 mit kurzer Meldung', /WebGL2/.test(await P.locator('[data-id="w1"] .fl-hinweis').innerText().catch(() => '')));
  pruefe('H3 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ I: Dunkel ══════════════════════════════════════════════════════
console.log('\n════ I: Dunkel ════');
if (laufe('I')) {
  const { ctx, P, fehler } = await seite([fl('d1', 'Nachtschrift', 0, 0), fl('d2', 'Akzent', 0, 260, { farbe: 'akzent' })], { ui: { theme: 'dark', accent: 'blau' } });
  await warteBis(P, () => !!document.querySelector('[data-id="d1"] canvas.fl-flaeche')?.__fluessig);
  await ruht(P, 'd1'); await ruht(P, 'd2');
  const t = await tinte(P, 'd1');
  pruefe('I1 im Dunkeln ist die Flüssigkeit hell', !!t && t.rot > 180, JSON.stringify({ rot: t?.rot }));
  const a = await tinte(P, 'd2');
  pruefe('I2 die Akzent-Karte trägt eine andere Farbe', !!a && Math.abs(a.rot - t.rot) > 20, JSON.stringify({ akzent: a?.rot }));
  await P.screenshot({ path: path.join(SD, 'm500-dunkel.png') });
  await P.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await warteBis(P, () => { const c = document.querySelector('[data-id="d1"] canvas.fl-flaeche'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) return d[i - 3] < 90; return false; }, 5000);
  const hell = await tinte(P, 'd1');
  pruefe('I3 Themenwechsel: die Tinte folgt sofort (hell → dunkle Flüssigkeit)', !!hell && hell.rot < 90, JSON.stringify({ rot: hell?.rot }));
  pruefe('I4 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ J: Präsentation, Export ═══════════════════════════════════════
console.log('\n════ J: Präsentation und Export ════');
if (laufe('J')) {
  const { ctx, P, fehler } = await seite([fl('j1', 'Vortrag', 0, 0)]);
  await warteBis(P, () => !!document.querySelector('[data-id="j1"] canvas.fl-flaeche')?.__fluessig);
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-box', { state: 'visible' });
  await P.keyboard.type('Vortrag'); await P.waitForTimeout(500);
  const treffer = await P.evaluate(() => /Vortrag/.test(document.querySelector('.search-box')?.innerText ?? '') && /Flüssige Schrift|Vortrag/.test(document.querySelector('.search-box')?.innerText ?? ''));
  pruefe('J1 die Suche findet die Karte über ihren Text', treffer);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-box', { state: 'visible' });
  await P.keyboard.type('Präsentieren'); await P.waitForTimeout(300);
  await P.locator('.search-cmds .search-cmd', { hasText: 'Präsentieren' }).first().click();
  const folie = await P.waitForSelector('.presenter-slide .slide-fluessig canvas.fl-flaeche', { timeout: 15000 }).then(() => true, () => false);
  pruefe('J2 die Karte lebt auf der Folie (eigene Fläche)', folie);
  if (folie) {
    await warteBis(P, () => [...document.querySelectorAll('.slide-fluessig canvas.fl-flaeche')].some((c) => c.__fluessig?.zustand().ruht), 15000);
    await P.screenshot({ path: path.join(SD, 'm500-folie.png') });
  }
  pruefe('J3 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ K: Ein-Datei-Fassung ════════════════════════════════════════════
console.log('\n════ K: Ein-Datei-Fassung ════');
if (laufe('K')) {
  const rel = process.env.PN_SINGLE ?? path.join(__repo, 'release', 'pixinotes.html');
  if (!existsSync(rel) || !readFileSync(rel, 'utf8').includes('fl-flaeche')) {
    console.log('  (release/pixinotes.html ohne diese Karte — `npm run build:single` baut sie; der Release-Lauf nach dem Merge prüft sie)');
  } else {
    const netz = [];
    const { ctx, P, fehler } = await seite([fl('s1', 'Offline', 0, 0)], { url: pathToFileURL(rel).href });
    P.on('request', (r) => { if (/^https?:/.test(r.url())) netz.push(r.url()); });
    await warteBis(P, () => !!document.querySelector('[data-id="s1"] canvas.fl-flaeche')?.__fluessig, 30000);
    await ruht(P, 's1');
    const t = await tinte(P, 's1');
    pruefe('K1 per file:// zeichnet die Karte ihre Flüssigkeit', !!t && t.anteil > 0.03, JSON.stringify(t && { anteil: t.anteil }));
    pruefe('K2 keine Netzanfrage und keine Seitenfehler', netz.length === 0 && fehler.length === 0, JSON.stringify({ netz, fehler }));
    await ctx.close();
  }
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
