/**
 * M356 — Textmarker für bessere Lesbarkeit.
 *
 *   A  Freie Fläche: ein wackeliger, waagerechter Markerstrich wird gerade (runde Enden, gewählte Breite).
 *   B  Schräg bleibt Freihand.
 *   C  Auf dem Text einer Notiz: Balken in Zeilenhöhe, auf der Zeile, von Wortanfang bis Wortende, gerade Kanten.
 *   D  Unter der Zeile (Unterstreichen): nur begradigt, nicht eingerastet.
 *   E  Zweimal über dieselbe Stelle: eine Gruppe je Farbe trägt die Deckkraft — kein Nachdunkeln.
 *   F  PDF-Seite mit Text: der Marker rastet auf die Zeile der Seite ein (Seitenstrich, gerade).
 *   G  „Was ist neu" nennt M356.
 */
// Läuft aus dem Repository: `node pruefungen/m356-textmarker.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4574;
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
/** Eine PDF (612 × 792) mit einer Textzeile in Helvetica 24 bei Grundlinie y=700 */
function pdfMitText() {
  const inhalt = 'BT /F1 24 Tf 100 700 Td (Hallo Welt Textmarker Zeile) Tj ET';
  const objekte = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let aus = '%PDF-1.4\n'; const offsets = [];
  objekte.forEach((o, i) => { offsets.push(aus.length); aus += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = aus.length;
  aus += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) aus += `${String(o).padStart(10, '0')} 00000 n \n`;
  aus += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return aus;
}
const pdf = pdfMitText();
const dataUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const stand = () => ({
  boards: [{ id: 'b1', name: 'Marker', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 420, position: { x: 60, y: 80 }, data: { color: 'sky', blocks: [
      { type: 'paragraph', content: 'Die Lesbarkeit steigt, wenn der Leuchtstift gerade auf der Zeile liegt und nichts verdeckt.' },
      { type: 'paragraph', content: 'Zweite Zeile mit mehreren Wörtern zum Unterstreichen.' },
    ] } },
    { id: 'f1', type: 'file', width: 520, position: { x: 620, y: 60 }, data: { name: 'text.pdf', mime: 'application/pdf', size: pdf.length, dataUrl } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, handschriftAuto: false }));
  localStorage.setItem('pixinotes-stift', '1');
  localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, stand());
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2400);
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
const letzter = async (P) => (await striche(P)).at(-1);
const wackel = (x1, x2, y, amp = 3) => Array.from({ length: 24 }, (_, i) => [x1 + ((x2 - x1) * i) / 23, y + Math.sin(i / 1.3) * amp]);
/** Bildschirm-Kästen der Wörter eines Absatzes der Notiz (index) */
const woerter = (P, absatz) => P.evaluate((absatz) => {
  const karte = document.querySelector('.react-flow__node[data-id="n1"]');
  const lauf = document.createTreeWalker(karte, NodeFilter.SHOW_TEXT);
  const texte = [];
  for (let k = lauf.nextNode(); k; k = lauf.nextNode()) if ((k.nodeValue ?? '').trim().length > 20) texte.push(k);
  const k = texte[absatz]; const out = []; const r = document.createRange();
  for (const m of k.nodeValue.matchAll(/\S+/g)) { r.setStart(k, m.index); r.setEnd(k, m.index + m[0].length); const q = r.getBoundingClientRect(); out.push({ w: m[0], l: q.left, t: q.top, r: q.right, b: q.bottom }); }
  return out;
}, absatz);
/** Lage des letzten Marker-Pfads am Bildschirm */
const bild = (P, wo = '.drawing-layer') => P.evaluate((wo) => {
  const ps = [...document.querySelectorAll(`${wo} .marker-gruppe path`)]; const p = ps.at(-1);
  if (!p) return null;
  const z = Number((document.querySelector('.react-flow__viewport').style.transform.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? 1);
  const b = p.getBoundingClientRect();
  return { l: b.left, r: b.right, mitte: (b.top + b.bottom) / 2, sw: Number(p.getAttribute('stroke-width')) * z, cap: p.getAttribute('stroke-linecap'), svg: !!p.closest('.notiz-striche') };
}, wo);

await werkzeug(P, 'Textmarker');

console.log('════ A: freie Fläche ════');
await zug(P, wackel(200, 480, 640), { id: 11, art: 'mouse' }); await warte(P, 800);
let s = await letzter(P);
pruefe('A1 wackelig-waagerecht → gerade (alle Punkte auf einer Höhe), Breite wie gewählt (14), runde Enden', s.tool === 'marker' && s.points.every((p) => Math.abs(p[1] - s.points[0][1]) < 0.01) && s.width === 14 && !s.gerade, JSON.stringify({ w: s.width, g: s.gerade, n: s.points.length }));
pruefe('A2 mit Zwischenpunkten (der Radierer kann den Strich teilen)', s.points.length > 6, String(s.points.length));

console.log('\n════ B: schräg ════');
await zug(P, Array.from({ length: 20 }, (_, i) => [200 + i * 10, 700 + i * 6]), { id: 12, art: 'mouse' }); await warte(P, 800);
s = await letzter(P);
pruefe('B1 ein schräger Strich bleibt, wie er ist (nicht waagerecht gezogen)', Math.abs(s.points.at(-1)[1] - s.points[0][1]) > 60 && !s.gerade, JSON.stringify(s.points.slice(0, 2)));

console.log('\n════ C: auf der Textzeile einer Notiz ════');
const w1 = await woerter(P, 0);
const zeile1 = w1.filter((q) => Math.abs(q.t - w1[0].t) < 3);
const von = zeile1[1]; const bis = zeile1[3];   // zweites bis viertes Wort der ersten Zeile
const yz = (von.t + von.b) / 2;
await zug(P, wackel(von.l + 3, bis.r - 3, yz + 2, 2.5), { id: 21, art: 'mouse' }); await warte(P, 900);
s = await letzter(P);
// Striche auf dem Text zeichnet die Notiz selbst (M339)
let b = await bild(P, '.react-flow__node[data-id="n1"] .notiz-striche');
pruefe('C1 eingerastet: gerade Kanten, an der Notiz geankert', s.gerade === true && s.anchor === 'n1' && b?.cap === 'butt', JSON.stringify({ g: s.gerade, a: s.anchor, cap: b?.cap }));
pruefe('C2 Balken in Zeilenhöhe, mittig auf der Zeile', !!b && Math.abs(b.sw - (von.b - von.t)) < 2 && Math.abs(b.mitte - yz) < 1.5, JSON.stringify({ sw: b?.sw, zeile: von.b - von.t, mitte: b?.mitte, yz }));
pruefe('C3 von Wortanfang bis Wortende', !!b && Math.abs(b.l - (von.l - 1.5)) < 2 && Math.abs(b.r - (bis.r + 1.5)) < 2, JSON.stringify({ l: b?.l, r: b?.r, soll: [von.l, bis.r] }));

console.log('\n════ D: unterstreichen ════');
const w2 = await woerter(P, 1);
const u = w2[1];
await zug(P, wackel(u.l, w2[3].r, u.b + 1, 1.5), { id: 31, art: 'mouse' }); await warte(P, 900);
s = await letzter(P);
pruefe('D1 Strich an der Unterkante der Zeile: begradigt, aber nicht eingerastet (Breite bleibt 14)', !s.gerade && s.width === 14 && s.points.every((p) => Math.abs(p[1] - s.points[0][1]) < 0.01), JSON.stringify({ g: s.gerade, w: s.width }));

console.log('\n════ E: kein Nachdunkeln ════');
await zug(P, wackel(220, 460, 642), { id: 41, art: 'mouse' }); await warte(P, 800);
const gruppen = await P.evaluate(() => [...document.querySelectorAll('.drawing-layer .marker-gruppe')].map((g) => ({ n: g.querySelectorAll('path').length, op: g.getAttribute('opacity'), blend: g.style.mixBlendMode, eigene: [...g.querySelectorAll('path')].filter((p) => p.getAttribute('opacity')).length })));
pruefe('E1 eine Gruppe je Farbe trägt Deckkraft 0,5 und Multiply; die Striche darin sind deckend', gruppen.length === 1 && gruppen[0].n >= 3 && gruppen[0].op === '0.5' && gruppen[0].blend === 'multiply' && gruppen[0].eigene === 0, JSON.stringify(gruppen));

console.log('\n════ F: PDF-Seite mit Text ════');
const cv = await P.locator('.react-flow__node[data-id="f1"] .pdf-seite canvas').boundingBox();
const k = cv.width / 612;
// Text: Grundlinie y=700 von unten → 92 von oben; Schrift 24 → Zeilenkasten etwa 72…98 Seitenpunkte
const yText = cv.y + 85 * k;
await zug(P, wackel(cv.x + 110 * k, cv.x + 300 * k, yText + 1, 2), { id: 51, art: 'mouse' }); await warte(P, 1000);
s = await letzter(P);
pruefe('F1 der Marker gehört zur Seite und ist eingerastet', s.gerade === true && s.seite === 1 && s.anchor === 'f1', JSON.stringify({ g: s.gerade, seite: s.seite, a: s.anchor }));
pruefe('F2 Balken auf der Textzeile (Mitte ~85 Seitenpunkte, Höhe ~25)', Math.abs(s.points[0][1] - 85) < 3 && Math.abs(s.width - 25.4) < 3, JSON.stringify({ y: s.points[0][1], w: s.width }));
pruefe('F3 so lang, wie überstrichen (innerhalb der Zeile)', Math.abs(s.points[0][0] - 110) < 4 && Math.abs(s.points.at(-1)[0] - 300) < 4, JSON.stringify([s.points[0][0], s.points.at(-1)[0]]));

console.log('\n════ G ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('G1 „Was ist neu" nennt M356', js.includes('(M356)'));

await browser.close(); app.close();
console.log(`\nm356-textmarker: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
