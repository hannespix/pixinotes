/**
 * M335 — PDF-Karte: zugeklappt klein, aufgeklappt eine Seite; Anmerkungen gehören zur Seite.
 *
 *   A  Zugeklappt: Miniatur, „3 Seiten", Aufklappen-Knopf, keine Seite offen.
 *   B  Aufklappen: eine Seite in Kartenbreite, Karte ≥ 420 breit, Blätterleiste „/ 3", Zustand im localStorage.
 *   C  Stift auf Seite 2: Strich geankert an der Karte, mit seite 2, Punkte in Seitenpunkten (0…612 × 0…792).
 *   D  Blättern: auf Seite 1 unsichtbar (Zähler ✎ 1 bleibt), auf Seite 2 wieder da.
 *   E  Verbreitern der Karte: der Strich sitzt relativ zur Seite an derselben Stelle.
 *   F  💬 + Tipp auf die Seite: Kommentar mit Seite/Stelle, Pin auf der Seite, verschwindet beim Blättern.
 *   G  Zuklappen: keine Seite, kein Strich, Knopf nennt „2 Anmerkungen".
 *   H  Fokus (Doppelklick) klappt auf, Esc klappt wieder zu.
 *   I  „Was ist neu" nennt M335.
 */
// Läuft aus dem Repository: `node pruefungen/m335-pdf-seiten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4554;
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
const pdf = pdfErzeugen(3);
const dataUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const stand = () => ({
  boards: [{ id: 'b1', name: 'PDF', edges: [], drawings: [], comments: [], nodes: [
    { id: 'f1', type: 'file', width: 300, position: { x: 40, y: 40 }, data: { name: 'bericht.pdf', mime: 'application/pdf', size: pdf.length, dataUrl } },
    { id: 'n1', type: 'note', width: 240, position: { x: 760, y: 40 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Nachbar' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite({ breite = 1400, hoehe = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes:author', 'Tester');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand());
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const zustand = (P) => P.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0];
  const karte = document.querySelector('.react-flow__node[data-id="f1"]');
  const canvas = document.querySelector('.react-flow__node[data-id="f1"] .pdf-seite canvas');
  const cr = canvas?.getBoundingClientRect();
  const pfade = [...document.querySelectorAll('.drawing-layer path')].map((p) => { const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  return {
    thumb: !!document.querySelector('.react-flow__node[data-id="f1"] .pdf-thumb'),
    seiteOffen: !!canvas, seiteNr: document.querySelector('.react-flow__node[data-id="f1"] .pdf-seite')?.getAttribute('data-seite') ?? null,
    bar: document.querySelector('.react-flow__node[data-id="f1"] .pdf-seite-bar')?.textContent ?? '',
    meta: document.querySelector('.react-flow__node[data-id="f1"] .file-body .meta')?.textContent ?? '',
    aufKnopf: document.querySelector('[data-taste="pdf-aufklappen"]')?.textContent ?? null,
    kartenBreite: karte ? Math.round(karte.getBoundingClientRect().width) : null,
    knotenBreite: st.nodes.find((n) => n.id === 'f1')?.width ?? null,
    canvas: cr ? { l: cr.left, t: cr.top, w: cr.width, h: cr.height } : null,
    pfade, striche: st.drawings ?? [], kommentare: st.comments ?? [],
    pins: [...document.querySelectorAll('.comment-pin')].map((p) => ({ seite: p.classList.contains('auf-seite'), t: p.getBoundingClientRect().top, l: p.getBoundingClientRect().left })),
    auf: localStorage.getItem('pixinotes-pdf-auf'), fokus: !!document.querySelector('.app.focus-mode'),
  };
});
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, 12)); }
  start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
}, { punkte, o });
const welle = (x0, y0, n = 24, amp = 10) => Array.from({ length: n }, (_, i) => [x0 + i * 4, y0 + Math.sin(i / 1.7) * amp]);
/** Lage des Strichs relativ zur Seite (Anteile 0…1) */
const relativ = (z) => (z.canvas && z.pfade[0] ? { x: (z.pfade[0].l - z.canvas.l) / z.canvas.w, y: (z.pfade[0].t - z.canvas.t) / z.canvas.h, w: z.pfade[0].w / z.canvas.w } : null);

const { ctx, P } = await seite();

console.log('════ A: zugeklappt ════');
let z = await zustand(P);
pruefe('A1 Miniatur, Seitenzahl im Meta, Aufklappen-Knopf — keine Seite offen', z.thumb && /3 Seiten/.test(z.meta) && z.aufKnopf?.includes('Aufklappen') && !z.seiteOffen, JSON.stringify({ meta: z.meta, knopf: z.aufKnopf, offen: z.seiteOffen }));
pruefe('A2 keine Pfade, keine Striche', z.pfade.length === 0 && z.striche.length === 0);

console.log('\n════ B: aufklappen ════');
await P.locator('[data-taste="pdf-aufklappen"]').click();
await P.waitForTimeout(1500);
z = await zustand(P);
pruefe('B1 eine Seite in der Karte, Blätterleiste „/ 3", Seite 1', z.seiteOffen && /\/ 3/.test(z.bar) && z.seiteNr === '1', JSON.stringify({ bar: z.bar, nr: z.seiteNr }));
pruefe('B2 Karte wurde auf 420 verbreitert', z.knotenBreite === 420 && z.kartenBreite >= 400, JSON.stringify({ knoten: z.knotenBreite, karte: z.kartenBreite }));
pruefe('B3 Seite füllt die Kartenbreite (Hochformat 612×792)', z.canvas && z.canvas.w > 380 && Math.abs(z.canvas.h / z.canvas.w - 792 / 612) < 0.02, JSON.stringify(z.canvas));
pruefe('B4 Zustand „auf" liegt im localStorage dieses Geräts', !!z.auf && JSON.parse(z.auf).f1 === true, z.auf);

console.log('\n════ C: Stift auf Seite 2 ════');
await P.locator('[data-taste="pdf-vor"]').click();
await P.waitForTimeout(900);
z = await zustand(P);
pruefe('C1 Seite 2 aufgeschlagen', z.seiteNr === '2', z.seiteNr);
await zug(P, welle(z.canvas.l + z.canvas.w * 0.3, z.canvas.t + z.canvas.h * 0.4), { id: 31 });
await P.waitForTimeout(900);
z = await zustand(P);
const s1 = z.striche;
pruefe('C2 ein Strich, geankert an der PDF-Karte, auf Seite 2', s1.length === 1 && s1[0].anchor === 'f1' && s1[0].seite === 2, JSON.stringify(s1.map((s) => [s.anchor, s.seite, s.points.length])));
const pts = s1[0]?.points ?? [];
pruefe('C3 Punkte sind Seitenpunkte (innerhalb 612 × 792, nahe 30 % / 40 %)', pts.length > 3 && pts.every(([x, y]) => x >= 0 && x <= 612 && y >= 0 && y <= 792) && Math.abs(pts[0][0] / 612 - 0.3) < 0.03 && Math.abs(pts[0][1] / 792 - 0.4) < 0.03, JSON.stringify(pts.slice(0, 2)));
pruefe('C4 der Strich wird über der Seite gezeichnet', z.pfade.length === 1 && relativ(z) && Math.abs(relativ(z).x - 0.3) < 0.03, JSON.stringify(relativ(z)));
const lageVorher = relativ(z);

console.log('\n════ D: blättern ════');
await P.locator('[data-taste="pdf-zurueck"]').click();
await P.waitForTimeout(800);
z = await zustand(P);
pruefe('D1 auf Seite 1 ist der Strich unsichtbar, der Zähler ✎ 1 bleibt', z.seiteNr === '1' && z.pfade.length === 0 && /✎ 1/.test(z.meta), JSON.stringify({ nr: z.seiteNr, pfade: z.pfade.length, meta: z.meta }));
await P.locator('[data-taste="pdf-vor"]').click();
await P.waitForTimeout(800);
z = await zustand(P);
pruefe('D2 zurück auf Seite 2 ist er wieder da', z.seiteNr === '2' && z.pfade.length === 1, String(z.pfade.length));

console.log('\n════ E: Karte verbreitern ════');
await P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')); s.state.boards[0].nodes[0].width = 640; localStorage.setItem('pixinotes-board', JSON.stringify(s)); });
await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
await P.locator('[data-taste="pdf-vor"]').click(); await P.waitForTimeout(1000);
z = await zustand(P);
const lageNachher = relativ(z);
pruefe('E1 nach dem Verbreitern sitzt der Strich an derselben Stelle der Seite', z.canvas.w > 600 && lageNachher && Math.abs(lageNachher.x - lageVorher.x) < 0.02 && Math.abs(lageNachher.y - lageVorher.y) < 0.02 && Math.abs(lageNachher.w - lageVorher.w) < 0.02, JSON.stringify({ vorher: lageVorher, nachher: lageNachher, breite: z.canvas.w }));

console.log('\n════ F: Kommentar an eine Stelle ════');
await P.locator('[data-taste="pdf-kommentar"]').click();
await P.waitForTimeout(200);
await P.mouse.click(z.canvas.l + z.canvas.w * 0.6, z.canvas.t + z.canvas.h * 0.25);
await P.waitForTimeout(500);
pruefe('F1 die Kommentar-Blase öffnet sich', await P.locator('.comment-compose').count() === 1);
await P.locator('.comment-input').fill('Hier fehlt eine Quelle');
await P.keyboard.press('Enter');
await P.waitForTimeout(700);
z = await zustand(P);
const k = z.kommentare[0];
pruefe('F2 Kommentar an Karte f1 mit Seite 2 und Stelle (≈ 60 % / 25 %)', z.kommentare.length === 1 && k.nodeId === 'f1' && k.seite === 2 && Math.abs(k.px / 612 - 0.6) < 0.03 && Math.abs(k.py / 792 - 0.25) < 0.03, JSON.stringify(k && { seite: k.seite, px: k.px, py: k.py }));
const pin = z.pins.find((p) => p.seite);
pruefe('F3 der Pin sitzt auf der Seite an der Stelle', pin && Math.abs((pin.l + 13 - z.canvas.l) / z.canvas.w - 0.6) < 0.04 && Math.abs((pin.t + 13 - z.canvas.t) / z.canvas.h - 0.25) < 0.04, JSON.stringify({ pin, canvas: z.canvas }));
await P.keyboard.press('Escape');
await P.locator('[data-taste="pdf-zurueck"]').click(); await P.waitForTimeout(700);
z = await zustand(P);
pruefe('F4 auf Seite 1 kein Seiten-Pin, Zähler 💬 1 bleibt', !z.pins.some((p) => p.seite) && /💬 1/.test(z.meta), JSON.stringify({ pins: z.pins, meta: z.meta }));
await P.locator('[data-taste="pdf-vor"]').click(); await P.waitForTimeout(700);
z = await zustand(P);
pruefe('F5 auf Seite 2 ist der Pin wieder da', z.pins.some((p) => p.seite));

console.log('\n════ G: zuklappen ════');
await P.locator('[data-taste="pdf-zuklappen"]').click();
await P.waitForTimeout(800);
z = await zustand(P);
pruefe('G1 zugeklappt: Miniatur statt Seite, kein Strich, kein Seiten-Pin', z.thumb && !z.seiteOffen && z.pfade.length === 0 && !z.pins.some((p) => p.seite), JSON.stringify({ thumb: z.thumb, offen: z.seiteOffen, pfade: z.pfade.length }));
pruefe('G2 der Knopf nennt „2 Anmerkungen", der Zustand ist gelöscht', /2 Anmerkungen/.test(z.aufKnopf ?? '') && !JSON.parse(z.auf ?? '{}').f1, JSON.stringify({ knopf: z.aufKnopf, auf: z.auf }));

console.log('\n════ H: Fokus klappt auf ════');
const kopf = await P.locator('.react-flow__node[data-id="f1"] .file-kopf').boundingBox();
await P.mouse.dblclick(kopf.x + 10, kopf.y + kopf.height / 2);
await P.waitForTimeout(1200);
z = await zustand(P);
pruefe('H1 im Fokus ist die Seite offen (ohne Zuklappen-Knopf)', z.fokus && z.seiteOffen && (await P.locator('[data-taste="pdf-zuklappen"]').count()) === 0, JSON.stringify({ fokus: z.fokus, offen: z.seiteOffen }));
await P.keyboard.press('Escape'); await P.waitForTimeout(800);
z = await zustand(P);
pruefe('H2 nach Esc wieder zugeklappt', !z.fokus && !z.seiteOffen && z.thumb, JSON.stringify({ fokus: z.fokus, offen: z.seiteOffen }));

console.log('\n════ I ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('I1 „Was ist neu" nennt M335', js.includes('PDFs anmerken, Seite für Seite (M335)'));

await ctx.close();
await browser.close();
app.close();
console.log(`\nm335-pdf-seiten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
