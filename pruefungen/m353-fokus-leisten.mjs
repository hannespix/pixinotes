/**
 * M353 — Im Fokus liegt eine PDF-/Word-Seite ganz zwischen Kopfzeile und unteren Leisten.
 *
 *   A  Breite Karte mit Querformat-Seite (Bildschirmfoto-Fall, 1920×1140): Unterkante der Karte über
 *      Werkzeug- und Blätter-Leiste, Oberkante unter der Kopfzeile.
 *   B  Hochformat (A4) im 1400×900-Fenster: ebenso.
 *   C  Blättern (M352) hält die Seite im freien Bereich.
 *   D  Notiz im Fokus: wie bisher nicht verkleinert (Zoom ≥ 1).
 *   E  „Was ist neu" nennt M353.
 */
// Läuft aus dem Repository: `node pruefungen/m353-fokus-leisten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4571;
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
function pdfErzeugen(n, B = 612, H = 792) {
  const objekte = [];
  objekte.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objekte.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const inhalt = `${(i % 3) / 2} 0.2 ${1 - (i % 3) / 2} rg 80 ${600 - i * 120} 300 80 re f`;
    objekte.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${B} ${H}] /Contents ${4 + i * 2} 0 R >>`);
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
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function geraet({ breite, hoehe, B, H, kartenBreite }) {
  const pdf = pdfErzeugen(4, B, H);
  const dataUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
  const st = {
    boards: [{ id: 'b1', name: 'PDF', edges: [], drawings: [], comments: [], nodes: [
      { id: 'f1', type: 'file', width: kartenBreite, position: { x: 40, y: 40 }, data: { name: 'abteilung-2-nachhaltige-unternehmensentwicklung.pdf', mime: 'application/pdf', size: pdf.length, dataUrl } },
      { id: 'n1', type: 'note', width: 260, position: { x: kartenBreite + 120, y: 40 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Kurze Notiz' }] } },
    ] }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
    activeId: 'b1', view: 'board',
  };
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
}
async function fokus(P, id) {
  const b = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  await P.mouse.click(b.x + b.width - 40, b.y + 10); await P.waitForTimeout(250);
  await P.keyboard.press('Enter'); await P.waitForTimeout(1800);
}
/** Lage der Fokus-Karte gegen Kopfzeile und unterste freie Kante (oberste untere Leiste) */
const lage = (P, id) => P.evaluate((id) => {
  const k = document.querySelector(`.react-flow__node[data-id="${id}"] .card-body`) ?? document.querySelector(`.react-flow__node[data-id="${id}"]`);
  const r = k.getBoundingClientRect();
  const leisten = [...document.querySelectorAll('.focus-nav, .sel-toolbar-dock')].filter((el) => el.getBoundingClientRect().height > 0);
  const frei = Math.min(window.innerHeight, ...leisten.map((el) => el.getBoundingClientRect().top));
  const kopf = document.querySelector('.focus-head')?.getBoundingClientRect().bottom ?? 0;
  const zoom = Number((document.querySelector('.react-flow__viewport').style.transform.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? 1);
  return { oben: Math.round(r.top), unten: Math.round(r.bottom), frei: Math.round(frei), kopf: Math.round(kopf), leisten: leisten.length, zoom,
    fokus: !!document.querySelector('.app.focus-mode'), seite: document.querySelector(`.react-flow__node[data-id="${id}"] .pdf-seite`)?.getAttribute('data-seite') };
}, id);
const innen = (z) => z.fokus && z.unten <= z.frei && z.oben >= z.kopf;

console.log('════ A: Querformat, breite Karte, 1920×1140 ════');
{
  const { ctx, P } = await geraet({ breite: 1920, hoehe: 1140, B: 960, H: 540, kartenBreite: 1150 });
  await fokus(P, 'f1');
  const z = await lage(P, 'f1');
  pruefe('A1 Fokus offen, Leisten unten da', z.fokus && z.leisten >= 1, JSON.stringify(z));
  pruefe('A2 die ganze Karte liegt zwischen Kopfzeile und Leisten', innen(z), JSON.stringify(z));
  await P.keyboard.press('PageDown'); await P.waitForTimeout(900);
  const z2 = await lage(P, 'f1');
  pruefe('C1 nach Bild↓ (Seite 2) weiterhin ganz im freien Bereich', z2.seite === '2' && innen(z2), JSON.stringify(z2));
  await ctx.close();
}

console.log('\n════ A2: 4:3-Folie im App-Fenster 1920×1105 (Werkzeugleiste dockt an) ════');
{
  const { ctx, P } = await geraet({ breite: 1920, hoehe: 1105, B: 960, H: 720, kartenBreite: 1150 });
  await fokus(P, 'f1');
  await P.waitForTimeout(800);
  const z = await lage(P, 'f1');
  pruefe('A3 auch mit angedockter Werkzeugleiste liegt die Karte ganz darüber', innen(z), JSON.stringify(z));
  await ctx.close();
}

console.log('\n════ B: Hochformat A4, 1400×900 ════');
{
  const { ctx, P } = await geraet({ breite: 1400, hoehe: 900, B: 595, H: 842, kartenBreite: 420 });
  await fokus(P, 'f1');
  const z = await lage(P, 'f1');
  pruefe('B1 die A4-Seite liegt ganz zwischen Kopfzeile und Leisten', innen(z), JSON.stringify(z));
  pruefe('B2 und bleibt lesbar groß (Zoom ≥ 0,55)', z.zoom >= 0.55, String(z.zoom));
  await P.keyboard.press('Escape'); await P.waitForTimeout(900);

  console.log('\n════ D: Notiz ════');
  const nb = await P.locator('.react-flow__node[data-id="n1"]').boundingBox();
  await P.mouse.dblclick(nb.x + nb.width / 2, nb.y + nb.height / 2); await P.waitForTimeout(1800);
  if (!(await P.evaluate(() => !!document.querySelector('.app.focus-mode')))) { await P.keyboard.press('Escape'); await P.waitForTimeout(200); await P.keyboard.press('Alt+f'); await P.waitForTimeout(1800); }
  const n = await lage(P, 'n1');
  pruefe('D1 eine Notiz wird im Fokus nicht verkleinert (Zoom ≥ 1)', n.fokus && n.zoom >= 1, JSON.stringify(n));
  await ctx.close();
}

console.log('\n════ E ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('E1 „Was ist neu" nennt M353', js.includes('(M353)'));

await browser.close(); app.close();
console.log(`\nm353-fokus-leisten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
