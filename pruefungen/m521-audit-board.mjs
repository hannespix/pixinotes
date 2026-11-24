/**
 * M521 — Audit Board und Präsentation: was beim Durchspielen falsch lief, als Verhalten gemessen.
 *
 *   A  Gewählter Rahmen im weiten Zoom: Der Titel bleibt der Griff (verschiebt den Rahmen samt Inhalt) — die
 *      Anfass-Linie der Oberkante lag darüber und zog stattdessen die Größe. Eck-Griff zieht weiter die Größe.
 *   B  Radierer trifft die gezeichnete Linie, nicht nur ihre Stützpunkte: begradigte Linie (2 Punkte) und
 *      eingerastetes Rechteck (5 Punkte) mitten auf der Strecke; Freihand wird weiter geteilt; Entferntes bleibt.
 *   C  Rahmen-Reise: Nach Aufgaben-Zentrale / Präsentation mitten in der Reise stellt Esc die Ansicht von VOR der
 *      Reise wieder her (vorher: 0/0 bei 100 %); die Reise läuft nach der Rückkehr weiter.
 *   D  Karten-Fokus: N legt keine (verdeckte) Notiz an, Strg+A wählt nicht das ganze Board dahinter. Ohne Fokus
 *      tun beide Tasten, was sie sollen.
 *   E  Einfügen (Strg+V) legt hinter einem offenen Fenster nichts an; auf der Fläche weiter eine Notiz.
 *   F  F2 benennt keinen Rahmen hinter einem offenen Fenster um; ohne Fenster öffnet F2 das Namensfeld.
 *   G  Eine Verbindung, die auf der eigenen Karte losgelassen wird, entsteht nicht; zur Nachbarkarte weiter schon.
 *   H  Entf mit Karte UND Verbindung gewählt: beide weg, EIN Strg+Z bringt beide zurück.
 *   I  Reihenfolge: Ein leerer Rahmen steht in der Lesefolge seiner Zeile (Rahmen-Reise beginnt links, nicht beim
 *      leeren Rahmen in der Mitte; eine Karte links kommt vor dem leeren Rahmen rechts von ihr).
 *   K  Pfeiltasten am gewählten Rahmen: Der Inhalt wandert mit, Strg+Z nimmt den Schritt zurück.
 *   L  Rahmen (mit Karte gewählt) auf ein anderes Board: archivierte Karten im Rahmen kommen mit.
 *   M  Präsentation: Der schlichte Text einer Form steht in ihrer Mitte (vorher oben, in der Raute über den Rand).
 *   N  Telefon: Der zweite Tipp eines Doppeltipps trifft nicht den Inhalt der Karte, die gerade im Fokus aufgeht.
 *   O  Die Auswahl-Leiste bleibt über einer Karte am Bildrand waagerecht im Bild.
 */
// Läuft aus dem Repository: `node pruefungen/m521-audit-board.mjs` (gegen einen anderen Build: PN_DIST=…)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5521;
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

const nz = (id, x, y, farbe = 'yellow', w = 200, h = 120) => ({ id, type: 'note', width: w, height: h, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
const fr = (id, x, y, w, h, name = id) => ({ id, type: 'frame', width: w, height: h, position: { x, y }, data: { name } });
const kt = (id, s, t) => ({ id, source: s, target: t, type: 'labeled', data: { label: '', kind: 'arrow' } });
const stand = (nodes, edges = [], drawings = []) => ({
  boards: [{ id: 'b1', name: 'Audit', comments: [], edges, drawings, nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});

async function seite(st, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', ...opt });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-stapel-gelernt', '1');
  }, { st });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1200);
  return { ctx, P };
}
const brett = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);
/** Der Speicher schreibt verzögert: warten, bis `bed` gilt (höchstens `ms`), dann den Stand liefern */
const standBis = async (P, bed, ms = 9000) => {
  const bis = Date.now() + ms; let b = await brett(P);
  while (!bed(b) && Date.now() < bis) { await P.waitForTimeout(150); b = await brett(P); }
  return b;
};
/** … bzw. bis er eine Weile gleich bleibt (für „es ist NICHTS passiert") */
const standRuhig = async (P, ms = 6000) => {
  let alt = JSON.stringify(await brett(P)); const bis = Date.now() + ms;
  for (let gleich = 0; gleich < 5 && Date.now() < bis;) { await P.waitForTimeout(200); const neu = JSON.stringify(await brett(P)); gleich = neu === alt ? gleich + 1 : 0; alt = neu; }
  return JSON.parse(alt);
};
const k = (b, id) => b.nodes.find((n) => n.id === id);
const kasten = (P, sel) => P.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
const karte = (P, id) => kasten(P, `.react-flow__node[data-id="${id}"]`);
const zoomVon = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '')?.[1] ?? 0));
const ansicht = (P) => P.evaluate(() => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? ''); return m ? { x: +m[1], y: +m[2], zoom: +m[3] } : null; });
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`) ?? document.querySelector(`.react-flow__node[data-id="${id}"] .frame-head`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const leer = (P) => P.mouse.click(1415, 780).then(() => P.waitForTimeout(250));
const gewaehlt = async (P) => (await brett(P)).nodes.filter((n) => n.selected).map((n) => n.id).sort().join(',');
const warteBis = async (P, fn, arg, ms = 8000) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const waehle = async (P, id) => { const g = await griff(P, id); await P.mouse.click(g[0], g[1]); return warteBis(P, (id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains('selected'), id); };
/** Ziehen mit Anlauf (React Flow verschluckt den ersten Schritt über der Schwelle) */
async function ziehen(P, x, y, dx, dy) {
  await P.mouse.move(x, y); await P.mouse.down();
  await P.mouse.move(x + 3, y + 3, { steps: 2 }); await P.mouse.move(x, y, { steps: 2 });
  await P.mouse.move(x + dx, y + dy, { steps: 10 });
  await P.mouse.up();
}
const einfuegen = (P, text) => P.evaluate((text) => {
  const dt = new DataTransfer(); dt.setData('text/plain', text);
  const ziel = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  ziel.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
const nah = (a, b, t = 1.5) => Math.abs(a - b) <= t;

/* ═══════════════════════ A: Rahmen im weiten Zoom ═══════════════════════ */
console.log('\n════ A: gewählter Rahmen im weiten Zoom — der Titel bleibt der Griff ════');
{
  // Die ferne Karte zieht den eingepassten Zoom unter 20 % — dort lag die Anfass-Linie ganz über dem Titel
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 900, 600, 'Rahmen'), nz('m', 100, 100), nz('fern', 6400, 3600)]));
  const z = await zoomVon(P);
  console.log(`  (Zoom ${z.toFixed(3)})`);
  pruefe('A0 der Aufbau ist im weiten Zoom (unter 22 %)', z > 0.1 && z < 0.22, z);
  pruefe('A1 der Rahmen lässt sich am Titel auswählen', await waehle(P, 'F'));
  const g = await griff(P, 'F');
  const unter = await P.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.closest('.frame-head') ? 'titel' : e?.closest('.react-flow__resize-control') ? 'linie' : String(e?.className).slice(0, 40); }, g);
  pruefe('A2 am gewählten Rahmen liegt unter dem Zeiger der Titel, nicht die Anfass-Linie', unter === 'titel', unter);
  const b0 = await brett(P);
  await ziehen(P, g[0], g[1], 60, 40);
  const b1 = await standBis(P, (b) => k(b, 'F').position.x !== 0 || k(b, 'F').height !== 600 || k(b, 'F').width !== 900);
  const F0 = k(b0, 'F'); const F1 = k(b1, 'F');
  pruefe('A3 Ziehen am Titel verschiebt den gewählten Rahmen (Größe bleibt)', F1.width === 900 && F1.height === 600 && F1.position.x > 150 && F1.position.y > 100, { x: F1.position.x, y: F1.position.y, w: F1.width, h: F1.height });
  const dx = F1.position.x - F0.position.x; const dy = F1.position.y - F0.position.y;
  pruefe('A4 … und sein Inhalt wandert mit', nah(k(b1, 'm').position.x - k(b0, 'm').position.x, dx, 0.01) && nah(k(b1, 'm').position.y - k(b0, 'm').position.y, dy, 0.01) && dx !== 0, { dx, dy, m: k(b1, 'm').position });
  // Der Eck-Griff zieht weiter die Größe
  const ecke = await kasten(P, '.react-flow__node[data-id="F"] .react-flow__resize-control.handle.bottom.right');
  await P.mouse.move(ecke.cx, ecke.cy); await P.mouse.down(); await P.mouse.move(ecke.cx + 30, ecke.cy + 20, { steps: 6 }); await P.mouse.up();
  const b2 = await standBis(P, (b) => k(b, 'F').width > 950);
  pruefe('A5 der Eck-Griff ändert weiter die Größe', k(b2, 'F').width > 950 && k(b2, 'F').height > 620 && k(b2, 'F').position.x === F1.position.x, { w: k(b2, 'F').width, h: k(b2, 'F').height });
  // Linke obere Ecke: liegt neben dem Titel, greift noch
  const lo = await kasten(P, '.react-flow__node[data-id="F"] .react-flow__resize-control.handle.top.left');
  const amLo = await P.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.react-flow__resize-control.handle'), [lo.cx - 2, lo.cy + 2]);
  pruefe('A6 der Eck-Griff oben links ist weiter zu greifen', amLo);
  await ctx.close();
}
{
  // Finger: Die Linie ist dort 16 Punkte dick — schon bei mittlerem Zoom lag sie über dem halben Titel
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 900, 600, 'Rahmen'), nz('m', 100, 100), nz('fern', 3300, 1900)]), { hasTouch: true });
  const z = await zoomVon(P);
  const g0 = await griff(P, 'F'); await P.touchscreen.tap(g0[0], g0[1]);
  const da = await warteBis(P, () => document.querySelector('.react-flow__node[data-id="F"]')?.classList.contains('selected'));
  const kopf = await kasten(P, '.react-flow__node[data-id="F"] .frame-head');
  const unten = await P.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.closest('.frame-head') ? 'titel' : e?.closest('.react-flow__resize-control') ? 'linie' : 'anderes'; }, [kopf.cx, kopf.y + kopf.h * 0.8]);
  pruefe(`A7 Finger (Zoom ${z.toFixed(2)}): auch der untere Teil des Titels gehört am gewählten Rahmen dem Titel`, da && unten === 'titel', { da, unten });
  await ctx.close();
}

/* ═══════════════════════ B: Radierer ═══════════════════════ */
console.log('\n════ B: der Radierer trifft die Linie, nicht nur ihre Stützpunkte ════');
for (const art of ['strich', 'teil']) {
  const frei = []; for (let i = 0; i <= 60; i += 1) frei.push([i * 10, 520 + (i % 2) * 2]);
  const striche = [
    { id: 'linie', tool: 'pen', color: '#16191e', width: 3, points: [[0, 0], [600, 0]] },
    { id: 'eck', tool: 'pen', color: '#16191e', width: 3, points: [[0, 120], [600, 120], [600, 360], [0, 360], [0, 120]] },
    { id: 'frei', tool: 'pen', color: '#16191e', width: 3, points: frei },
    { id: 'weit', tool: 'pen', color: '#16191e', width: 3, points: [[0, 700], [600, 700]] },
  ];
  const { ctx, P } = await seite(stand([nz('a', 900, 0)], [], striche));
  await P.evaluate((art) => localStorage.setItem('pixinotes-radierer', art), art);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForSelector('.react-flow__node'); await P.waitForTimeout(1200);
  const v = await ansicht(P);
  const schirm = (x, y) => [x * v.zoom + v.x + 0, y * v.zoom + v.y + 0];
  const fl = await kasten(P, '.react-flow');
  const zu = (x, y) => { const [sx, sy] = schirm(x, y); return [sx + fl.x, sy + fl.y]; };
  await P.keyboard.press('e');
  await warteBis(P, () => !!document.querySelector('.draw-palette'));
  const wisch = async (x0, y0, x1, y1) => { const a = zu(x0, y0); const b = zu(x1, y1); await P.mouse.move(a[0], a[1]); await P.mouse.down(); await P.mouse.move(b[0], b[1], { steps: 8 }); await P.mouse.up(); };
  // quer über die Mitte der begradigten Linie (300 Punkte von beiden Enden entfernt)
  await wisch(300, -60, 300, 60);
  let b = await standBis(P, (b) => !(b.drawings ?? []).some((s) => s.id === 'linie'), 6000);
  pruefe(`B1 (${art}) quer über die Mitte einer begradigten Linie radiert sie`, !(b.drawings ?? []).some((s) => s.id === 'linie'), (b.drawings ?? []).map((s) => s.id));
  // über die Mitte der oberen Kante des Rechtecks
  await wisch(300, 80, 300, 160);
  b = await standBis(P, (b) => !(b.drawings ?? []).some((s) => s.id === 'eck'), 6000);
  pruefe(`B2 (${art}) … und ein eingerastetes Rechteck an seiner Kante`, !(b.drawings ?? []).some((s) => s.id === 'eck'), (b.drawings ?? []).map((s) => s.id));
  // Freihand: der Strich-Radierer nimmt ihn ganz, der Teil-Radierer teilt ihn
  await wisch(300, 480, 300, 560);
  b = await standBis(P, (b) => !(b.drawings ?? []).some((s) => s.id === 'frei'), 6000);
  const reste = (b.drawings ?? []).filter((s) => s.points.some((p) => p[1] >= 500 && p[1] <= 540));
  if (art === 'strich') pruefe('B3 (strich) ein Freihand-Strich verschwindet ganz', reste.length === 0, reste.length);
  else pruefe('B3 (teil) ein Freihand-Strich wird an der Stelle geteilt (zwei Stücke)', reste.length === 2 && reste.every((s) => s.points.length > 5), reste.map((s) => s.points.length));
  const ruhe = await standRuhig(P, 3000);
  pruefe(`B4 (${art}) die Linie, über die nicht radiert wurde, bleibt`, (ruhe.drawings ?? []).some((s) => s.id === 'weit'));
  // EIN Rückgängig je Radier-Geste
  await P.keyboard.press('Escape'); await leer(P);
  await P.keyboard.press('Control+z'); await P.keyboard.press('Control+z'); await P.keyboard.press('Control+z');
  b = await standBis(P, (b) => ['linie', 'eck', 'frei'].every((id) => (b.drawings ?? []).some((s) => s.id === id)));
  pruefe(`B5 (${art}) drei Mal Strg+Z bringt alle drei Striche zurück`, ['linie', 'eck', 'frei', 'weit'].every((id) => (b.drawings ?? []).some((s) => s.id === id)) && b.drawings.length === 4, (b.drawings ?? []).map((s) => s.id));
  await ctx.close();
}

/* ═══════════════════════ C: Rahmen-Reise ═══════════════════════ */
console.log('\n════ C: Rahmen-Reise — die Ansicht von vorher übersteht Aufgaben und Präsentation ════');
{
  const { ctx, P } = await seite(stand([fr('F1', 0, 0, 500, 320, 'Eins'), nz('a', 40, 60), fr('F2', 700, 0, 500, 320, 'Zwei'), nz('b', 740, 60), nz('c', 0, 500)]));
  const gelandet = async () => { await warteBis(P, () => !!document.querySelector('.rahmen-reise-leiste') && !document.querySelector('[data-reise-flug]'), null, 10000); await P.waitForTimeout(500); };
  const zurueckBis = async (v0) => { const bis = Date.now() + 8000; let v = await ansicht(P); while (Date.now() < bis && !(v && nah(v.x, v0.x, 2) && nah(v.y, v0.y, 2) && nah(v.zoom, v0.zoom, 0.01))) { await P.waitForTimeout(150); v = await ansicht(P); } return v; };
  const v0 = await ansicht(P);
  // Grundfall (war schon richtig): Reise, Esc → Ansicht von vorher
  await P.keyboard.press('Alt+Shift+P'); await gelandet();
  const vReise = await ansicht(P);
  pruefe('C1 die Reise passt den Rahmen ein (anderer Ausschnitt)', !!vReise && vReise.zoom > v0.zoom * 1.3, vReise);
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.rahmen-reise-leiste'));
  let v = await zurueckBis(v0);
  pruefe('C2 Esc stellt die Ansicht von vorher wieder her', !!v && nah(v.x, v0.x, 2) && nah(v.y, v0.y, 2) && nah(v.zoom, v0.zoom, 0.01), { v0, v });
  // Mit Aufgaben-Zentrale dazwischen
  await P.keyboard.press('Alt+Shift+P'); await gelandet();
  await P.keyboard.press('Alt+t');
  await warteBis(P, () => !document.querySelector('.react-flow__viewport'));
  await P.keyboard.press('Alt+t');
  await P.waitForSelector('.react-flow__node'); await gelandet();
  pruefe('C3 nach der Aufgaben-Zentrale läuft die Reise weiter (Leiste da, Oberfläche zurückgetreten)', await P.evaluate(() => !!document.querySelector('.rahmen-reise-leiste') && 'nurBoard' in document.documentElement.dataset));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.rahmen-reise-leiste'));
  v = await zurueckBis(v0);
  pruefe('C4 … und Esc führt zur Ansicht von VOR der Reise (nicht nach 0/0 bei 100 %)', !!v && nah(v.x, v0.x, 2) && nah(v.y, v0.y, 2) && nah(v.zoom, v0.zoom, 0.01), { v0, v });
  pruefe('C5 … die Oberfläche ist wieder da', await P.evaluate(() => !('nurBoard' in document.documentElement.dataset) && getComputedStyle(document.querySelector('.dock')).visibility === 'visible'));
  // Mit Präsentation dazwischen
  await P.keyboard.press('Alt+Shift+P'); await gelandet();
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter');
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.presenter'));
  await P.waitForSelector('.react-flow__node'); await gelandet();
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.rahmen-reise-leiste'));
  v = await zurueckBis(v0);
  pruefe('C6 dasselbe nach einer Präsentation mitten in der Reise', !!v && nah(v.x, v0.x, 2) && nah(v.y, v0.y, 2) && nah(v.zoom, v0.zoom, 0.01), { v0, v });
  // War „Oberfläche ausblenden" schon vorher an, bleibt sie es nach der Reise — auch mit Aufgaben dazwischen
  await P.keyboard.press('Alt+b');
  await warteBis(P, () => 'nurBoard' in document.documentElement.dataset);
  await P.keyboard.press('Alt+Shift+P'); await gelandet();
  await P.keyboard.press('Alt+t');
  await warteBis(P, () => !document.querySelector('.react-flow__viewport'));
  await P.keyboard.press('Alt+t');
  await P.waitForSelector('.react-flow__node'); await gelandet();
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.rahmen-reise-leiste'));
  await P.waitForTimeout(600);
  pruefe('C7 „Oberfläche ausblenden" von vor der Reise gilt danach weiter', await P.evaluate(() => 'nurBoard' in document.documentElement.dataset));
  await ctx.close();
}

/* ═══════════════════════ D: Tasten im Karten-Fokus ═══════════════════════ */
console.log('\n════ D: Karten-Fokus — N und Strg+A treffen nicht das Board dahinter ════');
{
  const SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#3b82f6"/></svg>');
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 400, 0, 'sky'), { id: 'img', type: 'image', width: 300, height: 150, position: { x: 0, y: 300 }, data: { src: SVG, name: 'bild.svg' } }, nz('c', 400, 300, 'pink')]));
  // ohne Fokus: beide Tasten wirken
  await leer(P);
  await P.keyboard.press('Control+a');
  let b = await standBis(P, (b) => b.nodes.every((n) => n.selected));
  pruefe('D1 ohne Fokus wählt Strg+A alle Karten', b.nodes.every((n) => n.selected));
  await leer(P);
  await standBis(P, (b) => b.nodes.every((n) => !n.selected));
  // Fokus auf das Bild
  const r = await karte(P, 'img'); await P.mouse.dblclick(r.cx, r.cy);
  await P.waitForSelector('.focus-head'); await P.waitForTimeout(900);
  await P.evaluate(() => { const f = document.activeElement; if (f && f !== document.body && !f.classList.contains('react-flow__node')) f.blur(); });
  await P.keyboard.press('n');
  b = await standRuhig(P, 3500);
  pruefe('D2 im Fokus legt N keine Notiz hinter der offenen Karte an', b.nodes.length === 4, b.nodes.map((n) => n.id));
  pruefe('D3 … und der Schreib-Cursor wandert nicht in ein verdecktes Feld', await P.evaluate(() => !document.activeElement?.isContentEditable));
  await P.keyboard.press('Control+a');
  b = await standRuhig(P, 3000);
  pruefe('D4 im Fokus wählt Strg+A nicht die Karten dahinter', b.nodes.filter((n) => n.selected).map((n) => n.id).join(',') === 'img', b.nodes.filter((n) => n.selected).map((n) => n.id));
  pruefe('D5 der Fokus ist noch offen', await P.evaluate(() => !!document.querySelector('.focus-head')));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.focus-head'));
  await P.waitForTimeout(700); await leer(P);
  await P.keyboard.press('n');
  b = await standBis(P, (b) => b.nodes.length === 5);
  pruefe('D6 ohne Fokus legt N weiter eine Notiz an', b.nodes.length === 5, b.nodes.length);
  await ctx.close();
}

/* ═══════════════════════ E + F: hinter einem Fenster ═══════════════════════ */
console.log('\n════ E/F: Einfügen und F2 hinter einem offenen Fenster ════');
{
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 400, 0, 'sky'), fr('F', 0, 300, 500, 300, 'Rahmen')]));
  await leer(P);
  await einfuegen(P, 'Auf der Flaeche');
  let b = await standBis(P, (b) => b.nodes.length === 4);
  pruefe('E1 auf der Fläche wird eingefügter Text zur Notiz', b.nodes.length === 4, b.nodes.length);
  // Fenster „Karten teilen" — sein Zustand stand nicht in der Liste des Einfügens
  await waehle(P, 'a');
  await P.waitForSelector('.sel-toolbar button[aria-label="Teilen"]');
  await P.click('.sel-toolbar button[aria-label="Teilen"]');
  await P.waitForSelector('.modal-backdrop');
  await P.evaluate(() => document.querySelector('.modal-backdrop button')?.focus());
  await einfuegen(P, 'Hinter dem Fenster');
  b = await standRuhig(P, 3500);
  pruefe('E2 hinter dem offenen Fenster „Karten teilen" entsteht keine Notiz', b.nodes.length === 4, b.nodes.length);
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.modal-backdrop'));
  // F2
  await leer(P);
  pruefe('F0 Rahmen gewählt', await waehle(P, 'F'));
  await P.keyboard.press('Alt+e');
  await P.waitForSelector('.modal-backdrop');
  await P.waitForTimeout(400);
  await P.keyboard.press('F2');
  await P.waitForTimeout(700);
  pruefe('F1 hinter den Einstellungen öffnet F2 kein Namensfeld am Rahmen', await P.evaluate(() => !document.querySelector('.frame-name-input')));
  pruefe('F2 … der Fokus bleibt im Fenster', await P.evaluate(() => !!document.activeElement?.closest('.modal-backdrop, .modal, [role="dialog"]')), await P.evaluate(() => document.activeElement?.className));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.modal-backdrop'));
  await leer(P); await waehle(P, 'F');
  await P.keyboard.press('F2');
  const feld = await warteBis(P, () => document.activeElement?.classList.contains('frame-name-input'));
  pruefe('F3 ohne Fenster öffnet F2 das Namensfeld', feld);
  await P.keyboard.press('Control+a'); await P.keyboard.insertText('Neu benannt'); await P.keyboard.press('Enter');
  b = await standBis(P, (b) => k(b, 'F').data.name === 'Neu benannt');
  pruefe('F4 … und Enter übernimmt den Namen', k(b, 'F').data.name === 'Neu benannt', k(b, 'F').data.name);
  await ctx.close();
}

/* ═══════════════════════ G + H: Verbindungen ═══════════════════════ */
console.log('\n════ G/H: Verbindungen ════');
{
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 400, 0, 'sky'), nz('c', 0, 300, 'pink'), nz('d', 400, 300, 'green')], [kt('e1', 'a', 'b')]));
  const anschluss = async (id) => { const r = await karte(P, id); await P.mouse.move(r.cx, r.cy); await P.waitForTimeout(350); return P.evaluate((id) => { const h = document.querySelector(`.react-flow__node[data-id="${id}"] .react-flow__handle-right`); const r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id); };
  const verbinde = async (von, zielX, zielY) => { const h = await anschluss(von); await P.mouse.move(h[0], h[1], { steps: 4 }); await P.mouse.down(); await P.mouse.move(h[0] + 40, h[1] + 30, { steps: 4 }); await P.mouse.move(zielX, zielY, { steps: 10 }); await P.waitForTimeout(150); await P.mouse.up(); };
  const rc = await karte(P, 'c'); const rd = await karte(P, 'd');
  await verbinde('c', rc.cx, rc.cy);
  let b = await standRuhig(P, 3500);
  pruefe('G1 auf der eigenen Karte losgelassen: keine (unsichtbare) Verbindung c → c', !b.edges.some((e) => e.source === e.target) && b.edges.length === 1, b.edges.map((e) => `${e.source}>${e.target}`));
  await verbinde('c', rd.cx, rd.cy);
  b = await standBis(P, (b) => b.edges.some((e) => e.source === 'c' && e.target === 'd'));
  pruefe('G2 zur Nachbarkarte entsteht die Verbindung weiter', b.edges.some((e) => e.source === 'c' && e.target === 'd') && b.edges.length === 2, b.edges.map((e) => `${e.source}>${e.target}`));
  await leer(P);
  await P.keyboard.press('Control+z');
  b = await standBis(P, (b) => b.edges.length === 1);
  pruefe('G3 EIN Strg+Z nimmt genau diese Verbindung zurück (kein leerer Schritt davor)', b.edges.length === 1 && b.edges[0].id === 'e1', b.edges.map((e) => e.id));

  // H: Karte c und Verbindung e1 (a → b) gewählt, Entf
  const mitte = await P.evaluate(() => { const p = document.querySelector('.react-flow__edge[data-id="e1"] path'); const l = p.getTotalLength(); const pt = p.getPointAtLength(l * 0.3); const m = p.getScreenCTM(); return [pt.x * m.a + m.e, pt.y * m.d + m.f]; });
  await waehle(P, 'c');
  await P.keyboard.down('Shift'); await P.mouse.click(mitte[0], mitte[1]); await P.keyboard.up('Shift');
  b = await standBis(P, (b) => !!k(b, 'c')?.selected && !!b.edges.find((e) => e.id === 'e1')?.selected);
  pruefe('H0 Karte c und Verbindung a → b sind gewählt', !!k(b, 'c')?.selected && !!b.edges.find((e) => e.id === 'e1')?.selected);
  await P.keyboard.press('Delete');
  b = await standBis(P, (b) => !k(b, 'c') && b.edges.length === 0);
  pruefe('H1 Entf löscht die Karte UND die mitgewählte Verbindung', !k(b, 'c') && b.edges.length === 0 && !!k(b, 'a') && !!k(b, 'b'), { karten: b.nodes.map((n) => n.id), kanten: b.edges.map((e) => e.id) });
  await P.keyboard.press('Control+z');
  b = await standBis(P, (b) => !!k(b, 'c') && b.edges.length === 1);
  pruefe('H2 EIN Strg+Z bringt beide zurück', !!k(b, 'c') && b.edges.length === 1 && b.edges[0].id === 'e1', { karten: b.nodes.map((n) => n.id), kanten: b.edges.map((e) => e.id) });
  await ctx.close();
}

/* ═══════════════════════ I: Reihenfolge mit leerem Rahmen ═══════════════════════ */
console.log('\n════ I: ein leerer Rahmen steht in der Lesefolge seiner Zeile ════');
{
  // Drei Rahmen nebeneinander, der mittlere leer
  const { ctx, P } = await seite(stand([fr('L', 0, 0, 500, 320, 'Links'), nz('l1', 40, 80), fr('M', 600, 0, 500, 320, 'Mitte'), fr('R', 1200, 0, 500, 320, 'Rechts'), nz('r1', 1240, 80)]));
  const leiste = () => P.evaluate(() => `${document.querySelector('.rr-zahl')?.textContent?.replace(/\s/g, '')} ${document.querySelector('.rr-titel')?.textContent}`);
  const gelandet = async () => { await warteBis(P, () => !!document.querySelector('.rahmen-reise-leiste') && !document.querySelector('[data-reise-flug]'), null, 10000); await P.waitForTimeout(300); };
  await P.keyboard.press('Alt+Shift+P'); await gelandet();
  const folge = [await leiste()];
  for (let i = 0; i < 2; i += 1) { await P.keyboard.press('ArrowRight'); await P.waitForTimeout(250); await gelandet(); folge.push(await leiste()); }
  pruefe('I1 die Rahmen-Reise läuft von links nach rechts — der leere Rahmen in der Mitte ist der zweite', folge.join(' | ') === '1/3 Links | 2/3 Mitte | 3/3 Rechts', folge);
  await P.keyboard.press('Escape');
  await ctx.close();
}
{
  // Karten links, leerer Rahmen rechts in derselben Zeile: Der Vortrag beginnt bei der Karte
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 300, 0, 'sky'), fr('E', 700, 0, 500, 320, 'Leerer Abschnitt')]));
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter-slide');
  await P.waitForTimeout(600);
  const erste = await P.evaluate(() => ({ zahl: document.querySelector('.presenter-count')?.textContent?.replace(/\s/g, ''), text: document.querySelector('.presenter-slide')?.textContent ?? '' }));
  pruefe('I2 Präsentation: erst die Karte links, nicht der leere Rahmen rechts von ihr', erste.zahl === '1/3' && !/Leerer Abschnitt/.test(erste.text), erste.zahl + ' ' + erste.text.slice(-40));
  await P.keyboard.press('End'); await P.waitForTimeout(500);
  const letzte = await P.evaluate(() => document.querySelector('.presenter-slide')?.textContent ?? '');
  pruefe('I3 … der leere Rahmen folgt danach', /Leerer Abschnitt/.test(letzte), letzte.slice(-40));
  await P.keyboard.press('Escape');
  await ctx.close();
}
{
  // Unverändert: Ein leerer Rahmen ÜBER den Karten kommt zuerst, einer darunter zuletzt
  const { ctx, P } = await seite(stand([fr('O', 0, -400, 500, 300, 'Oben'), nz('a', 0, 0), nz('b', 300, 0, 'sky'), fr('U', 0, 400, 500, 300, 'Unten')]));
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter-slide'); await P.waitForTimeout(600);
  const erste = await P.evaluate(() => document.querySelector('.presenter-slide')?.textContent ?? '');
  await P.keyboard.press('End'); await P.waitForTimeout(500);
  const letzte = await P.evaluate(() => document.querySelector('.presenter-slide')?.textContent ?? '');
  pruefe('I4 ein leerer Rahmen über den Karten bleibt der Anfang, einer darunter das Ende', /Oben/.test(erste) && /Unten/.test(letzte), [erste.slice(-20), letzte.slice(-20)]);
  await P.keyboard.press('Escape');
  await ctx.close();
}

/* ═══════════════════════ K: Pfeiltasten am Rahmen ═══════════════════════ */
console.log('\n════ K: Pfeiltasten am gewählten Rahmen ════');
{
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 700, 400, 'Rahmen'), nz('a', 60, 80), nz('b', 360, 80, 'sky'), nz('x', 900, 80, 'pink')]));
  await waehle(P, 'F');
  await P.keyboard.press('ArrowRight'); await P.keyboard.press('ArrowRight'); await P.keyboard.press('Shift+ArrowDown');
  let b = await standBis(P, (b) => k(b, 'F').position.x === 10 && k(b, 'F').position.y === 20);
  pruefe('K1 Pfeiltasten schieben den gewählten Rahmen', k(b, 'F').position.x === 10 && k(b, 'F').position.y === 20, k(b, 'F').position);
  b = await standBis(P, (b) => k(b, 'a').position.x === 70);
  pruefe('K2 … und sein Inhalt wandert mit', k(b, 'a').position.x === 70 && k(b, 'a').position.y === 100 && k(b, 'b').position.x === 370 && k(b, 'x').position.x === 900, { a: k(b, 'a').position, b: k(b, 'b').position, x: k(b, 'x').position });
  await P.keyboard.press('Control+z');
  b = await standBis(P, (b) => k(b, 'F').position.x === 0 && k(b, 'a').position.x === 60);
  pruefe('K3 Strg+Z nimmt das Schieben zurück (Rahmen und Inhalt)', k(b, 'F').position.x === 0 && k(b, 'F').position.y === 0 && k(b, 'a').position.x === 60 && k(b, 'a').position.y === 80, { F: k(b, 'F').position, a: k(b, 'a').position });
  await ctx.close();
}

/* ═══════════════════════ L: Rahmen auf ein anderes Board ═══════════════════════ */
console.log('\n════ L: Rahmen auf ein anderes Board — archivierte Karten darin kommen mit ════');
{
  const st = stand([fr('F', 0, 0, 700, 420, 'Rahmen'), nz('a', 40, 60), { ...nz('arch', 300, 60, 'green'), archived: true }, nz('x', 900, 60, 'pink')]);
  st.boards.push({ id: 'b2', name: 'Zielboard', comments: [], edges: [], drawings: [], nodes: [nz('z1', 0, 0)] });
  st.spaces[0].projects[0].boardIds.push('b2');
  const { ctx, P } = await seite(st);
  const beide = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.map((b) => b.nodes.map((n) => n.id)));
  await waehle(P, 'F');
  const ga = await griff(P, 'a'); await P.keyboard.down('Shift'); await P.mouse.click(ga[0], ga[1]); await P.keyboard.up('Shift');
  await P.waitForSelector('.sel-toolbar button[aria-label="Mehr"]');
  await P.click('.sel-toolbar button[aria-label="Mehr"]');
  await P.waitForSelector('button[aria-label="Verschieben"]');
  await P.click('button[aria-label="Verschieben"]');
  await warteBis(P, () => [...document.querySelectorAll('button[title]')].some((x) => / › Zielboard$/.test(x.title)));
  await P.evaluate(() => [...document.querySelectorAll('button[title]')].find((x) => / › Zielboard$/.test(x.title))?.click());
  const bis = Date.now() + 8000; let s = await beide();
  while (Date.now() < bis && !s[1].includes('F')) { await P.waitForTimeout(150); s = await beide(); }
  pruefe('L1 Rahmen und Karte liegen auf dem Zielboard', s[1].includes('F') && s[1].includes('a') && !s[0].includes('F'), s);
  pruefe('L2 … die archivierte Karte aus dem Rahmen auch (nicht unsichtbar auf dem alten Board)', s[1].includes('arch') && !s[0].includes('arch') && s[0].includes('x'), s);
  await ctx.close();
}

/* ═══════════════════════ M: Form auf der Folie ═══════════════════════ */
console.log('\n════ M: Präsentation — der Text einer Form steht in ihrer Mitte ════');
{
  const form = (id, x, shape, text) => ({ id, type: 'shape', width: 200, height: 90, position: { x, y: 0 }, data: { shape, text, color: '#eef2ff' } });
  const { ctx, P } = await seite(stand([form('s1', 0, 'decision', 'Ist das Budget für das kommende Jahr schon freigegeben?'), form('s2', 300, 'process', 'Schritt')]));
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.slide-shape-input'); await P.waitForTimeout(700);
  const mass = () => P.evaluate(() => { const f = document.querySelector('.slide-shape .shape-body').getBoundingClientRect(); const t = document.querySelector('.slide-shape-input').getBoundingClientRect(); return { formMitte: (f.top + f.bottom) / 2, formH: f.height, feldMitte: (t.top + t.bottom) / 2, feldH: t.height }; });
  let m = await mass();
  pruefe('M1 Entscheidung: Das Textfeld ist so hoch wie sein Text und steht in der Mitte der Raute', nah(m.feldMitte, m.formMitte, 6) && m.feldH < m.formH * 0.45, m);
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(600);
  m = await mass();
  pruefe('M2 Schritt: eine Zeile, mittig', nah(m.feldMitte, m.formMitte, 6) && m.feldH < 60, m);
  // Weitertippen: Das Feld wächst mit und bleibt in der Mitte
  await P.click('.slide-shape-input'); await P.keyboard.press('End');
  await P.keyboard.insertText(' – und dazu noch ein zweiter, deutlich längerer Satz, der sicher in die nächste Zeile umbricht, und noch einer.');
  await P.waitForTimeout(500);
  const m2 = await mass();
  pruefe('M3 beim Tippen wächst das Feld mit dem Text und bleibt mittig', m2.feldH > m.feldH + 20 && nah(m2.feldMitte, m2.formMitte, 6), m2);
  const b = await standBis(P, (b) => /zweiter/.test(k(b, 's2').data.text));
  pruefe('M4 … und der Text ist gespeichert', /zweiter/.test(k(b, 's2').data.text));
  await ctx.close();
}

/* ═══════════════════════ N: Doppeltipp am Telefon ═══════════════════════ */
console.log('\n════ N: Telefon — der zweite Tipp eines Doppeltipps trifft nicht den Inhalt der aufgehenden Karte ════');
{
  const kb = () => ({ id: 'kb', type: 'kanban', width: 560, height: 380, position: { x: 40, y: 60 }, data: { title: 'Aufgaben', cols: ['To Do', 'In Arbeit', 'Erledigt'], wip: [null, 1, null], items: [
    { id: 't1', text: 'Angebot schreiben', col: 0 }, { id: 't2', text: 'Rechnung prüfen', col: 1 }, { id: 't3', text: 'Altes erledigt', col: 2 }, { id: 't4', text: 'Viertes', col: 0 }] } });
  const zweites = { id: 'n2', type: 'kanban', width: 560, height: 380, position: { x: 700, y: 900 }, data: { title: 'Zweites', items: [] } };
  const kern = (d) => JSON.stringify({ cols: d.cols, items: d.items.map((i) => [i.id, i.col]) });
  const soll = kern(kb().data);
  const telefon = { hasTouch: true, isMobile: true, viewport: { width: 390, height: 780 } };
  // Die beiden Stellen, an denen der zweite Tipp vorher ein Ticket verschob bzw. eine Spalte löschte — und eine dritte
  let geaendert = []; let ohneFokus = 0;
  for (const [fx, fy, pause] of [[0.7, 0.6, 90], [0.5, 0.85, 200], [0.8, 0.4, 200], [0.6, 0.2, 90]]) {
    const { ctx, P } = await seite(stand([kb(), zweites]), telefon);
    const r = await karte(P, 'kb');
    const x = r.x + r.w * fx; const y = r.y + r.h * fy;
    await P.touchscreen.tap(x, y); await P.waitForTimeout(pause); await P.touchscreen.tap(x, y);
    if (!(await warteBis(P, () => !!document.querySelector('.focus-head'), null, 6000))) ohneFokus += 1;
    await P.waitForTimeout(700);
    const b = await standRuhig(P, 3000);
    if (kern(k(b, 'kb').data) !== soll) geaendert.push(`${fx}/${fy}/${pause}: ${kern(k(b, 'kb').data)}`);
    await ctx.close();
  }
  pruefe('N1 der erste Tipp öffnet die Karte im Fokus (alle vier Stellen)', ohneFokus === 0, ohneFokus);
  pruefe('N2 der zweite Tipp ändert nichts am Kanban (kein Ticket verschoben, keine Spalte gelöscht)', geaendert.length === 0, geaendert);
  // Danach gehören Tipps wieder dem Inhalt: Schließen-Knopf des Fokus
  const { ctx, P } = await seite(stand([kb(), zweites]), telefon);
  const r = await karte(P, 'kb');
  await P.touchscreen.tap(r.cx, r.y + r.h * 0.6);
  await P.waitForSelector('.focus-head'); await P.waitForTimeout(900);
  const zu = await kasten(P, '.focus-head button');
  await P.touchscreen.tap(zu.cx, zu.cy);
  pruefe('N3 nach einer knappen Sekunde wirkt ein Tipp wieder (Fokus schließen)', await warteBis(P, () => !document.querySelector('.focus-head'), null, 6000));
  await ctx.close();
}

/* ═══════════════════════ O: Auswahl-Leiste am Rand ═══════════════════════ */
console.log('\n════ O: die Auswahl-Leiste bleibt über einer Karte am rechten Rand im Bild ════');
{
  const leiste = (P) => P.evaluate(() => { const l = document.querySelector('.sel-toolbar:not(.sel-toolbar-dock)'); if (!l) return null; const r = l.getBoundingClientRect(); const k = [...l.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return { links: r.left, rechts: r.right, breite: innerWidth, letzterRechts: Math.max(...k.map((q) => q.right)), ersterLinks: Math.min(...k.map((q) => q.left)) }; });
  const karten = [nz('a', 0, 0), nz('b', 700, 0, 'sky'), nz('c', 0, 500, 'pink')];
  // Telefon: Tipp öffnet den Fokus; nach dem Schließen bleibt die Karte gewählt, die Leiste steht über ihr
  {
    const { ctx, P } = await seite(stand(karten), { hasTouch: true, isMobile: true, viewport: { width: 390, height: 780 } });
    const r = await karte(P, 'b');
    await P.touchscreen.tap(r.cx, r.cy);
    await P.waitForSelector('.focus-head'); await P.waitForTimeout(900);
    const zu = await kasten(P, '.focus-head button'); await P.touchscreen.tap(zu.cx, zu.cy);
    await warteBis(P, () => !document.querySelector('.focus-head'));
    await warteBis(P, () => !!document.querySelector('.sel-toolbar:not(.sel-toolbar-dock)'));
    await P.waitForTimeout(900);
    const l = await leiste(P);
    pruefe('O1 Telefon: die Leiste über der Karte am rechten Rand endet im Bild', !!l && l.rechts <= l.breite && l.links >= 0, l);
    pruefe('O2 … der letzte Knopf (Löschen) ist ganz zu sehen', !!l && l.letzterRechts <= l.breite && l.ersterLinks >= 0, l);
    await ctx.close();
  }
  // Schmales Fenster mit Maus: wählen, dann die Karte halb aus dem Bild schieben
  {
    const { ctx, P } = await seite(stand(karten), { viewport: { width: 390, height: 780 } });
    const r = await karte(P, 'b');
    await P.mouse.click(r.x + 5, r.y + 5);
    await P.waitForSelector('.sel-toolbar:not(.sel-toolbar-dock)'); await P.waitForTimeout(500);
    let l = await leiste(P);
    pruefe('O3 Maus, 390 breit: die Leiste ragt nicht über den rechten Rand', !!l && l.letzterRechts <= l.breite, l);
    await P.keyboard.down('Space'); await P.mouse.move(150, 600); await P.mouse.down(); await P.mouse.move(210, 600, { steps: 5 }); await P.mouse.up(); await P.keyboard.up('Space');
    await P.waitForTimeout(600);
    l = await leiste(P);
    pruefe('O4 … auch nicht, wenn die Karte halb aus dem Bild geschoben ist', !!l && l.letzterRechts <= l.breite && l.ersterLinks >= 0, l);
    // nach links hinaus
    const ra = await karte(P, 'a'); await P.mouse.click(ra.x + 5, ra.y + 5); await P.waitForTimeout(400);
    await P.keyboard.down('Space'); await P.mouse.move(250, 600); await P.mouse.down(); await P.mouse.move(120, 600, { steps: 5 }); await P.mouse.up(); await P.keyboard.up('Space');
    await P.waitForTimeout(600);
    l = await leiste(P);
    pruefe('O5 … und links ebenso', !!l && l.ersterLinks >= 0 && l.letzterRechts <= l.breite, l);
    await ctx.close();
  }
  // Breites Fenster: mitten im Bild bleibt die Leiste mittig über der Karte (kein Versatz)
  {
    const { ctx, P } = await seite(stand(karten));
    const r = await karte(P, 'a');
    await P.mouse.click(r.x + 5, r.y + 5);
    await P.waitForSelector('.sel-toolbar:not(.sel-toolbar-dock)'); await P.waitForTimeout(500);
    const l = await leiste(P); const ra = await karte(P, 'a');
    pruefe('O6 mitten im Bild steht die Leiste wie bisher mittig über der Karte', !!l && nah((l.links + l.rechts) / 2, ra.cx, 2), { l, mitte: ra.cx });
    await ctx.close();
  }
}

await browser.close();
app.close();
if (fehler.length) { bad += 1; console.log('  ✗ Fehler auf der Seite:', fehler.slice(0, 5)); } else console.log('\n  ✓ keine Fehler auf der Seite');
console.log(`\n${ok} ✓, ${bad} ✗`);
process.exit(bad ? 1 : 0);
