/**
 * M404 — Das Mausrad zoomt gleichmäßig und weich; Bedienung der Dokument-Karten im Zoom; weiter hineinzoomen.
 *
 * Gemeldet: „Das Zoomen mit Mausrad ist manchmal etwas schnell und ruckelig (ich glaube, es liegt daran, dass
 * manchmal 3 Stufen auf einmal gescrollt wird, je nach Einstellungen) … kann man das smoother machen, unabhängig von
 * der Mauseinstellung? Wenn man z. B. eine PDF einzoomt, damit man den Inhalt lesen kann, wird manchmal das UI und
 * die Schrift darin einfach zu groß … kann man das begrenzen? Manchmal würde ich zudem gerne noch weiter reinzoomen."
 *
 * Ursache des Ruckelns: Die Strecke des Rad-Ereignisses ging direkt in den Zoomfaktor. Eine Raste meldet je nach Maus
 * und Einstellung 100, 120 oder 300 – und über einer Karte mit Strg sprang eine einzige Raste auf das Doppelte.
 *
 *   A  Jede Raste ist derselbe Schritt (14 %): 100, 300, in Zeilen gezählt, mit und ohne Strg, über Karte und Fläche.
 *   B  Die Raste wird weich angefahren (Zwischenstufen statt Sprung); die Stelle unter dem Zeiger bleibt stehen;
 *      feine Ereignisse (Kneifen am Trackpad) folgen sofort.
 *   C  Hineinzoomen bis 600 % (vorher 250 %), heraus bis 15 %.
 *   D  Aufgeklappte PDF-Karte: Titel und Blätterleiste wachsen nur bis 130 % mit, die Seite wächst weiter; die
 *      Stelle der Seite unter dem Zeiger bleibt stehen; zugeklappt zoomt die Karte wie bisher.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m404-rad-zoom.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4720;
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
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

/** Eine kleine, gültige PDF mit n Seiten (612 × 792), je Seite ein farbiges Rechteck */
function pdfErzeugen(n) {
  const objekte = [];
  objekte.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objekte.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const inhalt = `${(i % 3) / 2} 0.2 ${1 - (i % 3) / 2} rg 80 ${600 - i * 120} 300 80 re f`;
    objekte.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R >>`);
    objekte.push(`<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
  }
  let aus = '%PDF-1.4\n';
  const offsets = [];
  objekte.forEach((o, i) => { offsets.push(aus.length); aus += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = aus.length;
  aus += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) aus += `${String(o).padStart(10, '0')} 00000 n \n`;
  aus += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return aus;
}
const pdf = pdfErzeugen(3);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const notiz = (id, x, y, text) => ({ id, type: 'note', position: { x, y }, width: 260, height: 170, autoFit: false, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const datei = (id, x, y) => ({ id, type: 'file', width: 420, position: { x, y }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } });

const auf = async (nodes, { radZoomt = false, offen = {}, sprache = '' } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([n, rz, o, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify(o));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false, wheelZoom: rz } }));
  }, [nodes, radZoomt, offen, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
};
const zoomVon = (P) => P.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
const nah = (a, b, t = 0.012) => Math.abs(a - b) <= t;
const STUFE = 1.14;
/** Ein Rad-Ereignis, wie es der Browser liefert – mit frei wählbarer Strecke und Zählweise */
const rad = (P, x, y, deltaY, mehr = {}) => P.evaluate(([px, py, dy, m]) => {
  const ziel = document.elementFromPoint(px, py);
  ziel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, clientX: px, clientY: py, deltaY: dy, deltaMode: 0, ...m }));
}, [x, y, deltaY, mehr]);
const ruhe = (P) => P.waitForTimeout(450);

// ---------- A: jede Raste derselbe Schritt ----------
console.log('A  Jede Raste ist derselbe Schritt');
{
  const { ctx, P } = await auf([notiz('a', 0, 0, 'Karte A'), notiz('b', 600, 300, 'Karte B')], { radZoomt: true });
  const karte = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const flaeche = { x: 1250, y: 200 };
  let z0 = await zoomVon(P);
  await P.mouse.move(flaeche.x, flaeche.y); await P.mouse.wheel(0, -100); await ruhe(P);
  let z1 = await zoomVon(P);
  pruefe('A1 eine Raste auf der freien Fläche: 14 % hinein', nah(z1 / z0, STUFE), z1 / z0);
  await rad(P, flaeche.x, flaeche.y, -300); await ruhe(P);
  let z2 = await zoomVon(P);
  pruefe('A2 eine Raste, die 300 meldet („drei Zeilen je Raste"): derselbe Schritt – nicht das Dreifache', nah(z2 / z1, STUFE), z2 / z1);
  await rad(P, flaeche.x, flaeche.y, -3, { deltaMode: 1 }); await ruhe(P);
  let z3 = await zoomVon(P);
  pruefe('A3 in Zeilen gezählt (drei Zeilen): derselbe Schritt', nah(z3 / z2, STUFE), z3 / z2);
  await rad(P, flaeche.x, flaeche.y, 120); await ruhe(P);
  let z4 = await zoomVon(P);
  pruefe('A4 eine Raste zurück (120): derselbe Schritt hinaus', nah(z3 / z4, STUFE), z3 / z4);
  // über einer Karte, mit Strg (vorher: eine Raste = doppelt so groß)
  const k2 = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await rad(P, k2.x, k2.y, -100, { ctrlKey: true }); await ruhe(P);
  let z5 = await zoomVon(P);
  pruefe('A5 Strg + eine Raste über einer Karte: 14 % (vorher sprang sie auf das Doppelte)', nah(z5 / z4, STUFE), z5 / z4);
  const k3 = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await rad(P, k3.x, k3.y, -100); await ruhe(P);
  let z6 = await zoomVon(P);
  pruefe('A6 ohne Strg über einer Karte (Rad zoomt): derselbe Schritt', nah(z6 / z5, STUFE), z6 / z5);
  // mehrere Rasten schnell nacheinander sammeln sich
  for (let i = 0; i < 4; i++) { await rad(P, flaeche.x, flaeche.y, 100); await P.waitForTimeout(25); }
  await P.waitForTimeout(700);
  const z7 = await zoomVon(P);
  pruefe('A7 vier schnelle Rasten ergeben genau vier Schritte', nah(z6 / z7, STUFE ** 4, 0.03), z6 / z7);
  void karte;
  await ctx.close();
}

// ---------- B: weich, am Zeiger, fein ----------
console.log('B  Weich angefahren, die Stelle unter dem Zeiger bleibt');
{
  // Standard: das Rad schwenkt, Strg + Rad zoomt
  const { ctx, P } = await auf([notiz('a', 0, 0, 'Karte A'), notiz('b', 600, 300, 'Karte B')]);
  const z0 = await zoomVon(P);
  const vor = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.4, l: r.left, t: r.top, w: r.width, h: r.height }; });
  // Verlauf Bild für Bild mitschreiben
  await P.evaluate(() => { window.__z = []; const lies = () => { window.__z.push(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a); if (window.__z.length < 40) requestAnimationFrame(lies); }; requestAnimationFrame(lies); });
  await rad(P, vor.x, vor.y, -100, { ctrlKey: true });
  await P.waitForTimeout(800);
  const verlauf = await P.evaluate(() => window.__z);
  const z1 = await zoomVon(P);
  const zwischen = [...new Set(verlauf.map((z) => Math.round(z * 1000) / 1000))].filter((z) => z > z0 + 0.002 && z < z1 - 0.002);
  const steigend = verlauf.every((z, i) => i === 0 || z >= verlauf[i - 1] - 0.0005);
  pruefe('B1 die Raste wird angefahren: mehrere Zwischenstufen, nie zurück', nah(z1 / z0, STUFE) && zwischen.length >= 3 && steigend, { z0, z1, zwischen: zwischen.length, verlauf: verlauf.slice(0, 12).map((z) => Math.round(z * 1000) / 1000) });
  const groessterSprung = Math.max(...verlauf.slice(1).map((z, i) => z / verlauf[i]));
  pruefe('B2 kein Bild springt um mehr als die halbe Raste', groessterSprung < 1 + (STUFE - 1) * 0.6, groessterSprung);
  const nach = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  pruefe('B3 die Stelle unter dem Zeiger bleibt stehen', Math.abs(nach.l + nach.w * 0.3 - vor.x) < 1.5 && Math.abs(nach.t + nach.h * 0.4 - vor.y) < 1.5, { vor, nach });
  // ohne Strg schwenkt das Rad (Standard) – kein Zoom
  await P.mouse.move(1250, 200); await P.mouse.wheel(0, 100); await ruhe(P);
  pruefe('B4 ohne Strg schwenkt das Rad wie bisher (kein Zoom)', nah(await zoomVon(P), z1, 0.002));
  // fein: Kneifen am Trackpad = Strg + kleine, gebrochene Werte – folgt sofort
  await rad(P, 1250, 200, -4.5, { ctrlKey: true });
  const sofort = await P.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a)))));
  await P.waitForTimeout(300);
  const spaeter = await zoomVon(P);
  pruefe('B5 feines Kneifen folgt sofort, ohne Nachlauf', nah(sofort / z1, 2 ** 0.045, 0.004) && nah(spaeter, sofort, 0.002), { faktor: sofort / z1, spaeter: spaeter / sofort });
  await ctx.close();
}

// ---------- C: Grenzen ----------
console.log('C  Weiter hineinzoomen');
{
  const { ctx, P } = await auf([notiz('a', 0, 0, 'Karte A'), notiz('b', 600, 300, 'Karte B')], { radZoomt: true });
  const p = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  for (let i = 0; i < 24; i++) { await rad(P, p.x, p.y, -100); await P.waitForTimeout(20); }
  await P.waitForTimeout(900);
  const gross = await zoomVon(P);
  pruefe('C1 hineinzoomen geht bis 600 % (vorher 250 %)', nah(gross, 6, 0.02), gross);
  const griff = await P.evaluate(() => getComputedStyle(document.querySelector('.board-wrap')).getPropertyValue('--pn-inv'));
  pruefe('C2 Griffe und Rahmen bleiben dabei so groß wie bei 250 %', nah(Number(griff), 0.25, 0.03), griff);
  for (let i = 0; i < 40; i++) { await rad(P, p.x, p.y, 100); await P.waitForTimeout(15); }
  await P.waitForTimeout(900);
  pruefe('C3 hinaus bis 15 %', nah(await zoomVon(P), 0.15, 0.005), await zoomVon(P));
  await ctx.close();
}

// ---------- D: Bedienung der Dokument-Karte ----------
console.log('D  Aufgeklappte PDF: die Bedienung wächst nur bis 130 % mit');
{
  const { ctx, P } = await auf([datei('offen', 0, 0), datei('zu', 700, 0)], { radZoomt: true, offen: { offen: true } });
  await P.waitForSelector('.react-flow__node[data-id="offen"] .pdf-seite canvas', { timeout: 15000 }); await P.waitForTimeout(800);
  const mass = () => P.evaluate(() => {
    const k = document.querySelector('.react-flow__node[data-id="offen"]'); const zu = document.querySelector('.react-flow__node[data-id="zu"]');
    const h = (el) => el?.getBoundingClientRect().height ?? 0;
    const seite = k.querySelector('.pdf-seite').getBoundingClientRect();
    return { zoom: new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a,
      knopf: h(k.querySelector('.pdf-seite-bar button')), titel: h(k.querySelector('.file-titel')), kopf: h(k.querySelector('.file-kopf')),
      seiteB: seite.width, seiteT: seite.top, seiteL: seite.left, seiteH: seite.height, karteB: k.getBoundingClientRect().width,
      zuTitel: h(zu.querySelector('.file-titel')), zuKopf: h(zu.querySelector('.file-kopf')), ui: getComputedStyle(document.querySelector('.board-wrap')).getPropertyValue('--pn-ui') };
  });
  const a = await mass();
  pruefe('D0 die PDF ist aufgeklappt; bei dieser Stufe wächst die Bedienung noch mit', a.seiteB > 100 && a.knopf > 10 && a.ui === '', a);
  // Zeiger auf eine Stelle der Seite, dann weit hinein
  const stelle = { fx: 0.4, fy: 0.3 };
  let p = { x: a.seiteL + a.seiteB * stelle.fx, y: a.seiteT + a.seiteH * stelle.fy };
  const rasten = Math.ceil(Math.log(3.2 / a.zoom) / Math.log(STUFE));
  for (let i = 0; i < rasten; i++) { await rad(P, p.x, p.y, -100); await P.waitForTimeout(90); }
  await P.waitForTimeout(900);
  const b = await mass();
  const f = b.zoom / a.zoom;
  pruefe('D1 weit hineingezoomt (über 300 %)', b.zoom > 3 && b.zoom <= 6, b.zoom);
  pruefe('D2 die Seite ist voll mitgewachsen', nah(b.seiteB / a.seiteB, f, 0.03), { ist: b.seiteB / a.seiteB, soll: f });
  const soll = (26 / 1) * 1.3;   // Knopf der Blätterleiste: 26 Punkte, höchstens 130 %
  pruefe('D3 die Knöpfe der Blätterleiste sind auf dem Schirm höchstens 130 % groß (nicht 300 %)', b.knopf <= soll + 1.5 && b.knopf >= soll - 3, { knopf: b.knopf, soll, ohneGrenze: 26 * b.zoom });
  pruefe('D4 … ebenso Titel und Kopf der Karte', b.kopf <= (a.kopf / a.zoom) * 1.3 + 2 && b.titel <= (a.titel / a.zoom) * 1.3 + 2, { kopf: b.kopf, titel: b.titel, bei100: a.kopf / a.zoom });
  pruefe('D5 die Stelle der Seite unter dem Zeiger ist stehen geblieben', Math.abs(b.seiteL + b.seiteB * stelle.fx - p.x) < 4 && Math.abs(b.seiteT + b.seiteH * stelle.fy - p.y) < 6, { soll: p, ist: { x: b.seiteL + b.seiteB * stelle.fx, y: b.seiteT + b.seiteH * stelle.fy } });
  pruefe('D6 die zugeklappte PDF daneben zoomt wie bisher (ihr Kopf wächst voll mit)', nah(b.zuKopf / a.zuKopf, f, 0.04), { ist: b.zuKopf / a.zuKopf, soll: f });
  // die Blätterleiste bleibt bedienbar
  await P.locator('.react-flow__node[data-id="offen"] .pdf-seite-bar [data-taste="pdf-seite-nr"]').waitFor({ timeout: 3000 }).catch(() => {});
  const leiste = await P.evaluate(() => { const b2 = document.querySelector('.react-flow__node[data-id="offen"] .pdf-seite-bar'); const r = b2.getBoundingClientRect(); return { imBild: r.bottom > 0 && r.top < window.innerHeight, t: r.top }; });
  if (!leiste.imBild) { await P.keyboard.press('Shift+1').catch(() => {}); }
  // wieder hinaus: die Bedienung ist wieder wie zuvor
  p = await P.evaluate(() => { const s = document.querySelector('.react-flow__node[data-id="offen"] .pdf-seite').getBoundingClientRect(); return { x: Math.min(Math.max(s.left + 60, 300), 1100), y: 500 }; });
  for (let i = 0; i < rasten; i++) { await rad(P, p.x, p.y, 100); await P.waitForTimeout(60); }
  await P.waitForTimeout(900);
  const c = await mass();
  pruefe('D7 wieder hinaus: alles wie zuvor', nah(c.zoom, a.zoom, 0.01) && c.ui === '' && nah(c.knopf, a.knopf, 0.6) && nah(c.kopf, a.kopf, 0.8) && nah(c.seiteB, a.seiteB, 1.5), { a, c });
  // Im Karten-Fokus bleibt die Bedienung, wie sie ist: Dort misst sich die Ansicht an der Karte aus – würde die Karte
  // beim Hineinzoomen flacher, passte sich die Ansicht neu ein und der Zoom spränge zurück
  await P.locator('.react-flow__node[data-id="offen"] .file-kopf').click({ position: { x: 12, y: 8 } }); await P.waitForTimeout(300);
  await P.keyboard.press('Alt+f'); await P.waitForTimeout(1200);
  const imFokus = await P.evaluate(() => !!document.querySelector('.app.focus-mode'));
  const fz0 = await zoomVon(P);
  const fs = await P.evaluate(() => { const s = document.querySelector('.react-flow__node[data-id="offen"] .pdf-seite').getBoundingClientRect(); return { x: s.left + s.width / 2, y: Math.min(Math.max(s.top + 200, 300), 700) }; });
  for (let i = 0; i < 9; i++) { await rad(P, fs.x, fs.y, -100, { ctrlKey: true }); await P.waitForTimeout(60); }
  await P.waitForTimeout(1200);
  const fz1 = await zoomVon(P);
  const fui = await P.evaluate(() => getComputedStyle(document.querySelector('.board-wrap')).getPropertyValue('--pn-ui'));
  pruefe('D8 im Karten-Fokus hineingezoomt: der Zoom bleibt (kein Zurückspringen), die Bedienung der Karte bleibt unverändert', imFokus && fz1 > fz0 * 2.5 && fz1 > 2 && fui === '', { imFokus, fz0, fz1, fui });
  await ctx.close();
}

// ---------- E: Texte ----------
console.log('E  Texte');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  pruefe('E1 die Hilfe nennt M404 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M404)') && lies('src/components/HelpOverlayEn.tsx').includes('(M404)'));
  pruefe('E2 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm404-rad-zoom: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
