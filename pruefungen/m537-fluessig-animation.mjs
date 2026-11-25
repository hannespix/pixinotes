/**
 * M537 — Flüssige Schrift fließt wieder flüssig (Regression aus M535: Zeitlupe und Ruckeln).
 *
 * Ursache: Weckte sich eine Fläche MITTEN in einem Takt (der Qualitätsregler tastet neu ab, „lebendig" weckt sich
 * danach selbst – seit M535), forderte der Takt am Ende trotzdem noch ein Bild an. Es liefen dann zwei (später mehr)
 * Ketten nebeneinander: je Bild doppelt gerechnet und gezeichnet, weniger Bilder je Sekunde, der Regler drosselte
 * weiter und startete die nächste Kette. Außerdem blieb eine angehaltene Schrift (Maus 2 s still über ihr) stehen,
 * wenn die Maus danach wegging.
 *
 * Gemessen wird Verhalten: Takte der Flüssigkeit je Bild des Browsers (eigener requestAnimationFrame-Zähler der
 * Seite; lastunabhängig, höchstens ein Takt je Bild) und Pixel der Fläche über die Zeit.
 *
 *   A  Anlegen: die Schrift setzt sich sichtbar zusammen (Pixel ändern sich), höchstens ein Takt je Bild.
 *   B  Wecken mitten im Takt (wie der Qualitätsregler): danach weiter höchstens ein Takt je Bild, die Schrift bewegt
 *      sich weiter; echter Weg: CPU gedrosselt, bis der Regler umschaltet – danach ebenso.
 *   C  Maus: Bewegung über der Schrift verändert das Bild; 2 s still darüber → steht (M535, gewollt); Bewegung → fließt
 *      sofort weiter; Maus weg nach dem Anhalten → „lebendig" fließt weiter, eine gewöhnliche Schrift schwingt aus und
 *      schläft (ruht) statt verbogen stehen zu bleiben.
 *   D  Neuladen, dunkel + pix·el, gezoomt, markiert, neben anderen Karten: setzt sich zusammen, lebt, ein Takt je Bild.
 */
// Läuft aus dem Repository: `node pruefungen/m537-fluessig-animation.mjs` (braucht `npm run build`)
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
const PORT = 5537;
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

const fl = (id, text, x, y, extra = {}, w = 440, h = 220) => ({ id, type: 'fluessig', width: w, height: h, autoFit: false, position: { x, y }, data: { text, ...extra } });
const note = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const stand = (nodes, ui) => ({
  boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, ...(ui ? { ui } : {}),
});
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(([st]) => {
    try { if (window !== window.top) return; } catch { return; }
    // Bilder des Browsers zählen (lastunabhängiger Maßstab: höchstens ein Takt der Flüssigkeit je Bild)
    window.__bilder = 0; const zaehl = () => { window.__bilder++; requestAnimationFrame(zaehl); }; requestAnimationFrame(zaehl);
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand(nodes, opt.ui)]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow__node-fluessig', { state: 'visible', timeout: 30000 });
  return { ctx, P, fehler };
}
const warteBis = async (P, fn, ms = 15000, arg) => P.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
const flaeche = (P, id) => warteBis(P, (kid) => !!document.querySelector(`.react-flow__node[data-id="${kid}"] canvas.fl-flaeche`)?.__fluessig?.zustand().teilchen, 30000, id);
const zustand = (P, id) => P.evaluate((kid) => document.querySelector(`.react-flow__node[data-id="${kid}"] canvas.fl-flaeche`)?.__fluessig?.zustand(), id);
/** Grobes Abbild der Fläche (jede 4. Zeile/Spalte: Tinte ja/nein) */
const abbild = (P, id) => P.evaluate((kid) => {
  const c = document.querySelector(`.react-flow__node[data-id="${kid}"] canvas.fl-flaeche`);
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const bild = []; let n = 0;
  for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) { const v = d[(y * c.width + x) * 4 + 3] > 128 ? 1 : 0; bild.push(v); n += v; }
  return { bild, n };
}, id);
const unterschied = (a, b) => { if (!a || !b) return -1; let n = 0; for (let i = 0; i < Math.min(a.bild.length, b.bild.length); i++) if (a.bild[i] !== b.bild[i]) n++; return n; };
/** Ändert sich das Bild innerhalb von `ms`? (größter Unterschied zu den Bildern davor) */
async function bewegtSich(P, id, ms = 1200, schritte = 4) {
  const a = await abbild(P, id); let max = 0;
  for (let i = 0; i < schritte; i++) { await P.waitForTimeout(ms / schritte); max = Math.max(max, unterschied(a, await abbild(P, id))); }
  return max;
}
/** Takte der Flüssigkeit und Bilder des Browsers in `ms` */
async function takteJeBild(P, ms = 2000) {
  const z = () => P.evaluate(() => ({ t: window.pixinotesFluessig?.takte ?? 0, s: window.pixinotesFluessig?.schritte ?? 0, b: window.__bilder }));
  const a = await z(); await P.waitForTimeout(ms); const b = await z();
  const bilder = b.b - a.b;
  return { takte: b.t - a.t, schritte: b.s - a.s, bilder, jeBild: bilder ? +((b.t - a.t) / bilder).toFixed(2) : 0 };
}
const kasten = async (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
/** Maus über die Schrift ziehen (ohne Taste) und dort stehen lassen */
async function ueberSchrift(P, id) {
  const r = await P.evaluate((kid) => { const t = document.querySelector(`.react-flow__node[data-id="${kid}"] .fl-treffer`).getBoundingClientRect(); return { x: t.left, y: t.top, w: t.width, h: t.height }; }, id);
  for (let i = 0; i <= 16; i++) { await P.mouse.move(r.x + r.w * (0.25 + i * 0.03), r.y + r.h * (0.45 + Math.sin(i / 2) * 0.1)); await P.waitForTimeout(30); }
  return r;
}

// ──────────────────────────────── A + B ────────────────────────────────
if (laufe('AB')) {
  console.log('\n════ A: Anlegen · B: Wecken mitten im Takt ════');
  const { ctx, P, fehler } = await seite([fl('f1', 'Welle', 300, 220, { lebendig: true })]);
  await P.mouse.move(5, 790);
  const da = await flaeche(P, 'f1');
  pruefe('A0 die Fläche steht (WebGL2)', da);
  const zusammen = await bewegtSich(P, 'f1', 1200);
  pruefe('A1 die Schrift setzt sich sichtbar zusammen (Pixel ändern sich)', zusammen > 20, { zusammen });
  const t0 = await takteJeBild(P, 1500);
  pruefe('A2 höchstens ein Takt je Bild', t0.bilder > 5 && t0.jeBild <= 1.05, t0);

  // B1: genau das, was der Qualitätsregler tut, wenn er die Teilchenzahl senkt – mitten im Takt neu abtasten. Danach
  // weckt sich „lebendig" selbst (M535). Vorher entstand dabei eine zweite Takt-Kette.
  await P.evaluate(() => {
    const f = document.querySelector('canvas.fl-flaeche').__fluessig;
    const pr = Object.getPrototypeOf(f); const alt = pr.schritt; let n = 0;
    pr.schritt = function (...a) { const r = alt.apply(this, a); if (n < 3) { n++; this.abtasten(false); } return r; };
  });
  await P.waitForTimeout(400);
  const t1 = await takteJeBild(P, 2000);
  pruefe('B1 nach dem Wecken mitten im Takt: weiter höchstens ein Takt je Bild (keine zweite Kette)', t1.bilder > 5 && t1.jeBild <= 1.05, t1);
  pruefe('B2 … und jeder Takt rechnet genau einen Schritt (kein leerer Doppeltakt mit dt = 0)', t1.schritte <= t1.takte && t1.schritte >= t1.takte * 0.9, t1);
  // Bewegung sichtbar: lebendig zieht nach 4 s Ruhe eine unsichtbare Hand durch die Schrift
  await P.waitForTimeout(3000);
  const leb = await bewegtSich(P, 'f1', 1600);
  pruefe('B3 „lebendig" bewegt sich danach weiter (Pixel)', leb > 3, { leb });

  // B4: echter Weg – CPU stark drosseln, bis der Qualitätsregler umschaltet, dann wieder freigeben
  const cdp = await ctx.newCDPSession(P);
  const vorher = await P.evaluate(() => sessionStorage.getItem('pixinotes-fluessig-qualitaet'));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
  const umgeschaltet = await warteBis(P, (v) => sessionStorage.getItem('pixinotes-fluessig-qualitaet') !== v, 25000, vorher);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await P.waitForTimeout(800);
  const t2 = await takteJeBild(P, 2000);
  console.log(`    Regler ${umgeschaltet ? 'umgeschaltet' : 'nicht umgeschaltet'}: ${vorher} → ${await P.evaluate(() => sessionStorage.getItem('pixinotes-fluessig-qualitaet'))}`);
  pruefe('B4 Qualitätsregler schaltet unter Last um – danach höchstens ein Takt je Bild', t2.bilder > 5 && t2.jeBild <= 1.05, { umgeschaltet, ...t2 });
  pruefe('B5 keine Seitenfehler', fehler.length === 0, fehler);
  await ctx.close();
}

// ──────────────────────────────── C ────────────────────────────────
if (laufe('C')) {
  console.log('\n════ C: Maus – bewegen, anhalten, weiterfließen, weggehen ════');
  const { ctx, P, fehler } = await seite([fl('f1', 'Welle', 300, 220, { lebendig: true }), fl('g1', 'Ruhe', 300, 520)]);
  await P.mouse.move(5, 790);
  await flaeche(P, 'f1'); await flaeche(P, 'g1');
  await P.waitForTimeout(2600); // Zusammensetzen vorbei
  const a = await abbild(P, 'f1');
  await ueberSchrift(P, 'f1');
  pruefe('C1 Maus über der Schrift verändert das Bild', unterschied(a, await abbild(P, 'f1')) > 3, unterschied(a, await abbild(P, 'f1')));
  const halt = await warteBis(P, () => document.querySelector('.react-flow__node[data-id="f1"] canvas.fl-flaeche').__fluessig.zustand().angehalten, 6000);
  await P.waitForTimeout(300);
  const steht = await bewegtSich(P, 'f1', 800);
  pruefe('C2 2 s still über der Karte: sie hält an, das Bild steht (M535)', halt && steht === 0, { halt, steht });
  const vorBewegung = await abbild(P, 'f1');
  const r = await P.evaluate(() => { const t = document.querySelector('.react-flow__node[data-id="f1"] .fl-treffer').getBoundingClientRect(); return { x: t.left + t.width * 0.5, y: t.top + t.height * 0.5 }; });
  await P.mouse.move(r.x + 30, r.y + 6, { steps: 4 });
  await P.waitForTimeout(250);
  const weiter = unterschied(vorBewegung, await abbild(P, 'f1'));
  pruefe('C3 eine Bewegung lässt sie sofort weiterfließen', weiter > 0, { weiter });
  await warteBis(P, () => document.querySelector('.react-flow__node[data-id="f1"] canvas.fl-flaeche').__fluessig.zustand().angehalten, 6000);
  await P.mouse.move(5, 790, { steps: 3 });
  await P.waitForTimeout(300);
  const t = await takteJeBild(P, 1500);
  pruefe('C4 Maus weg nach dem Anhalten: „lebendig" läuft weiter (Takte)', t.takte > 5 && t.jeBild <= 1.05, t);
  // C5: gewöhnliche Schrift, vom Magnet gehalten, angehalten, dann Maus weg → schwingt aus und schläft
  await ueberSchrift(P, 'g1');
  const haltG = await warteBis(P, () => document.querySelector('.react-flow__node[data-id="g1"] canvas.fl-flaeche').__fluessig.zustand().angehalten, 6000);
  await P.mouse.move(5, 790, { steps: 3 });
  const schlaeft = await warteBis(P, () => document.querySelector('.react-flow__node[data-id="g1"] canvas.fl-flaeche').__fluessig.zustand().ruht === true, 30000);
  pruefe('C5 gewöhnliche Schrift: vom Magnet gehalten und angehalten, Maus weg → schwingt aus und schläft', haltG && schlaeft, { haltG, schlaeft, z: await zustand(P, 'g1') });
  pruefe('C6 keine Seitenfehler', fehler.length === 0, fehler);
  await ctx.close();
}

// ──────────────────────────────── D ────────────────────────────────
if (laufe('D')) {
  console.log('\n════ D: Neuladen · dunkel + pix·el · Zoom · markiert · andere Karten ════');
  const nodes = [fl('f1', 'Welle', 300, 220, { lebendig: true }), note('n1', 'Daneben', 0, 0), note('n2', 'Noch eine', 800, 0)];
  const { ctx, P, fehler } = await seite(nodes, { ui: { theme: 'dark', accent: 'orange', design: 'pixel' } });
  await P.mouse.move(5, 790);
  await flaeche(P, 'f1');
  const dunkel = await P.evaluate(() => document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark'));
  pruefe('D1 dunkel + pix·el: die Schrift setzt sich zusammen (Pixel)', (await bewegtSich(P, 'f1', 1200)) > 20, { dunkel });
  await P.reload();
  await P.waitForSelector('.react-flow__node-fluessig', { state: 'visible', timeout: 30000 });
  await P.mouse.move(5, 790);
  await flaeche(P, 'f1');
  const nachLaden = await bewegtSich(P, 'f1', 1200);
  pruefe('D2 nach dem Neuladen setzt sie sich wieder zusammen (Pixel)', nachLaden > 20, { nachLaden });
  const t = await takteJeBild(P, 1500);
  pruefe('D3 nach dem Neuladen höchstens ein Takt je Bild', t.bilder > 5 && t.jeBild <= 1.05, t);
  // Zoom (Strg+Rad) – die Größe der Fläche bleibt, sie lebt weiter
  await P.mouse.move(640, 400);
  for (let i = 0; i < 3; i++) { await P.keyboard.down('Control'); await P.mouse.wheel(0, -200); await P.keyboard.up('Control'); await P.waitForTimeout(120); }
  await P.mouse.move(5, 790);
  await P.waitForTimeout(400);
  const zt = await takteJeBild(P, 1500);
  pruefe('D4 gezoomt: rechnet weiter, höchstens ein Takt je Bild', zt.takte > 5 && zt.jeBild <= 1.05, zt);
  // Markiert (greifbar): ein Klick auf die Schrift; danach Maus weg – lebt weiter
  const k = await kasten(P, 'f1');
  if (k) {
    const r = await P.evaluate(() => { const t = document.querySelector('.react-flow__node[data-id="f1"] .fl-treffer').getBoundingClientRect(); return { x: t.left + 4, y: t.top + 4 }; });
    await P.mouse.click(r.x, r.y);
    await P.mouse.move(5, 790, { steps: 3 });
    await P.waitForTimeout(400);
    const mt = await takteJeBild(P, 1500);
    pruefe('D5 markiert: rechnet weiter, höchstens ein Takt je Bild', mt.takte > 5 && mt.jeBild <= 1.05, mt);
  } else pruefe('D5 markiert', false, 'Karte nicht im Bild');
  await P.screenshot({ path: path.join(SD, 'm537-fluessig.png') });
  pruefe('D6 keine Seitenfehler', fehler.length === 0, fehler);
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
