/**
 * M354 — Stift: Stärken stufenlos, Vorgabe fein, Stärke passt zur Ansicht und zur Seite; Vorschlag über dem Text.
 *
 *   A  Palette Stift: drei Stufen, „Fein" gewählt, Regler; ein Strich bei Zoom 1 hat Breite 1,2.
 *   B  Regler: 0,6 → der nächste Strich ist 0,6 breit; die Wahl bleibt nach dem Neuladen.
 *   C  Ansicht: bei Zoom 2 wird „fein" auf dem Board halb so breit (gleich dick am Schirm).
 *   D  Textmarker: drei Breiten (Mittel vorgewählt), „Breit" zeichnet 22.
 *   E  Radierer: drei Größen; „Groß" radiert einen Strich, den „Klein" verfehlt.
 *   F  PDF-Seite: Breite in Seitenpunkten; zieht man die Karte breiter, wird der Strich dicker.
 *   G  „Was ist neu" nennt M354.
 */
// Läuft aus dem Repository: `node pruefungen/m354-stift-staerken.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4572;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
/** Eine kleine, gültige PDF mit n Seiten (612 × 792), je Seite ein farbiges Rechteck an anderer Stelle */
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
const pdf = pdfErzeugen(2);
const dataUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const stand = (mitPdf) => ({
  boards: [{ id: 'b1', name: 'Stift', edges: [], drawings: [], comments: [], nodes: mitPdf
    ? [{ id: 'f1', type: 'file', width: 420, position: { x: 40, y: 40 }, data: { name: 'blatt.pdf', mime: 'application/pdf', size: pdf.length, dataUrl } }]
    : [{ id: 'n1', type: 'note', width: 200, position: { x: 1100, y: 60 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Rand' }] } }] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(mitPdf = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, handschriftAuto: false }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand(mitPdf));
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y, p], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'pen', isPrimary: true, clientX: x, clientY: y, pressure: p ?? 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, o.takt ?? 8)); }
  if (o.halten) await new Promise((r) => setTimeout(r, o.halten));
  if (!o.offen) start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
  return start.className?.baseVal ?? start.className;
}, { punkte, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const warte = (P, ms = 600) => P.waitForTimeout(ms);
const welle = (x0, y0, n = 18, amp = 14) => Array.from({ length: n }, (_, i) => [x0 + i * 3, y0 + Math.sin(i / 1.7) * amp + (i % 3) * 2]);
const letzter = async (P) => (await striche(P)).at(-1);
const zoomAuf = (P, z) => P.evaluate((z) => window.dispatchEvent(new CustomEvent('pixinotes:test-zoom', { detail: z })), z);

console.log('════ A: Stift-Palette ════');
let { ctx, P } = await seite();
await werkzeug(P, 'Stift');
const stufen = P.locator('.draw-palette .draw-dicke');
pruefe('A1 drei Stufen, „Fein" vorgewählt, dazu ein Regler', (await stufen.count()) === 3 && (await stufen.nth(0).evaluate((e) => e.classList.contains('on'))) && (await P.locator('.draw-palette .draw-regler').count()) === 1);
await zug(P, welle(500, 400), { id: 21 }); await warte(P, 400);
pruefe('A2 ein Strich bei Zoom 1 ist 1,2 breit (fein)', (await letzter(P))?.width === 1.2, String((await letzter(P))?.width));

console.log('\n════ B: stufenlos ════');
await P.locator('.draw-palette .draw-regler').fill('0.6'); await warte(P, 150);
await zug(P, welle(500, 480), { id: 22 }); await warte(P, 400);
pruefe('B1 Regler auf 0,6 → der Strich ist 0,6 breit', (await letzter(P))?.width === 0.6, String((await letzter(P))?.width));
pruefe('B2 keine Stufe hervorgehoben, der Wert steht daneben', (await P.locator('.draw-palette .draw-dicke.on').count()) === 0 && /0,6/.test(await P.locator('.draw-staerke-wert').textContent()));
await P.reload({ waitUntil: 'networkidle' }); await warte(P, 1600);
await werkzeug(P, 'Stift');
pruefe('B3 die Wahl bleibt nach dem Neuladen', (await P.locator('.draw-palette .draw-regler').inputValue()) === '0.6');

console.log('\n════ C: Stärke folgt der Ansicht ════');
await stufen.nth(0).click(); await warte(P, 100);
// Zoom 2 um die Mitte (Strg+Mausrad)
await P.mouse.move(700, 450);
for (let i = 0; i < 6; i++) { await P.keyboard.down('Control'); await P.mouse.wheel(0, -100); await P.keyboard.up('Control'); await warte(P, 80); }
await warte(P, 500);
const z = await P.evaluate(() => Number((document.querySelector('.react-flow__viewport').style.transform.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? 1));
await zug(P, welle(600, 500), { id: 23 }); await warte(P, 400);
const wC = (await letzter(P))?.width;
pruefe('C1 vergrößert (Zoom > 1,3) zeichnet „fein" auf dem Board dünner — am Schirm gleich dick', z > 1.3 && Math.abs(wC * z - 1.2) < 0.05, `zoom ${z} breite ${wC}`);
await ctx.close();

console.log('\n════ D: Textmarker ════');
({ ctx, P } = await seite());
await werkzeug(P, 'Textmarker');
const mb = P.locator('.draw-palette .draw-dicke[aria-label^="Markerbreite"]');
pruefe('D1 drei Markerbreiten, „Mittel" vorgewählt', (await mb.count()) === 3 && (await mb.nth(1).evaluate((e) => e.classList.contains('on'))));
await mb.nth(2).click(); await warte(P, 100);
await zug(P, [[400, 300], [460, 300], [520, 300], [580, 300], [640, 300], [700, 300], [760, 300], [820, 300]], { id: 31, art: 'mouse' }); await warte(P, 400);
pruefe('D2 „Breit" zeichnet mit Breite 22', (await letzter(P))?.width === 22, String((await letzter(P))?.width));
await ctx.close();

console.log('\n════ E: Radierer ════');
({ ctx, P } = await seite());
await werkzeug(P, 'Stift');
// leicht gewellt, damit er nicht zur Linie einrastet — die Punkte liegen dicht (3 Pt.)
await zug(P, welle(450, 500, 60, 1.5), { id: 41 }); await warte(P, 400);
const punkteE = (await striche(P))[0]?.points.length;
const vorE = (await striche(P)).length;
await werkzeug(P, 'Radierer');
const rg = P.locator('.draw-palette .draw-dicke[aria-label^="Radierergröße"]');
pruefe('E1 drei Radierergrößen, „Mittel" vorgewählt', (await rg.count()) === 3 && (await rg.nth(1).evaluate((e) => e.classList.contains('on'))));
await rg.nth(0).click(); await warte(P, 100);
await zug(P, [[540, 518], [545, 518], [550, 518]], { id: 42 }); await warte(P, 900);
const nachKlein = await striche(P);
pruefe('E2 „Klein" (6) verfehlt den Strich 18 Punkte daneben', nachKlein.length === vorE && nachKlein[0].points.length === punkteE, JSON.stringify(nachKlein.map((s) => s.points.length)));
await rg.nth(2).click(); await warte(P, 100);
await zug(P, [[540, 518], [545, 518], [550, 518]], { id: 43 }); await warte(P, 900);
const nachGross = await striche(P);
pruefe('E3 „Groß" (24) erwischt ihn an derselben Stelle', JSON.stringify(nachGross) !== JSON.stringify(nachKlein), JSON.stringify(nachGross.map((s) => s.points.length)));
await ctx.close();

console.log('\n════ F: PDF-Seite ════');
({ ctx, P } = await seite(true));
await werkzeug(P, 'Stift');
const cv = await P.locator('.react-flow__node[data-id="f1"] .pdf-seite canvas').boundingBox();
// Fünf Punkte: bleibt eine Linie mit stroke-width (keine Freihand-Kontur) — so lässt sich die Breite am Bild ablesen
const y0 = cv.y + cv.height * 0.4;
await zug(P, [[cv.x + 100, y0], [cv.x + 130, y0 + 1], [cv.x + 160, y0], [cv.x + 190, y0 + 1], [cv.x + 220, y0]], { id: 51 }); await warte(P, 500);
const s1 = await letzter(P);
const k = await P.evaluate(() => { const c = document.querySelector('.react-flow__node[data-id="f1"] .pdf-seite canvas'); return c.getBoundingClientRect().width / 612; });
pruefe('F1 der Strich gehört zur Seite, Breite in Seitenpunkten (1,2 ÷ Maßstab)', s1?.seite === 1 && s1.seitenBreite === true && Math.abs(s1.width - 1.2 / k) < 0.05, JSON.stringify({ w: s1?.width, k, seite: s1?.seite }));
const bild = () => P.evaluate(() => Number(document.querySelector('.drawing-layer path[data-anker="f1"]')?.getAttribute('stroke-width') ?? NaN));
const vorF = await bild();
pruefe('F2 gezeichnet wird er so dick, wie gewählt (1,2)', Math.abs(vorF - 1.2) < 0.05, String(vorF));
// Karte doppelt so breit (Speicher) — die Seite wird doppelt so groß gerendert
await P.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('pixinotes-board'));
  raw.state.boards[0].nodes[0].width = 840;
  localStorage.setItem('pixinotes-board', JSON.stringify(raw));
});
await P.reload({ waitUntil: 'networkidle' }); await warte(P, 2400);
const nachF = await bild();
pruefe('F3 Karte doppelt so breit → der Strich wird mit der Seite doppelt so dick', nachF / vorF > 1.8 && nachF / vorF < 2.2, `${vorF} → ${nachF}`);
await ctx.close();

console.log('\n════ G ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('G1 „Was ist neu" nennt M354', js.includes('(M354)'));

await browser.close(); app.close();
console.log(`\nm354-stift-staerken: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
