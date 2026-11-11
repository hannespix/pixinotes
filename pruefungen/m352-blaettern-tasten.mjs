/**
 * M352 — Blättern mit der Tastatur in PDF- und Word-Karten.
 *
 *   A  Gewählte, aufgeklappte Karte: Bild↓/Bild↑ blättern; die Karte bleibt, wo sie ist.
 *   B  … Pfeile blättern dort NICHT (sie gehören der Karte), Pos1 nicht (erste Karte).
 *   C  Klick auf die Seite: →/←, Leertaste/Umschalt+Leertaste, Pos1/Ende blättern; Karte und Ansicht ruhen.
 *   D  Am Rand: Bild↑ auf Seite 1 bleibt auf 1, die Ansicht schwenkt nicht.
 *   E  Im Seitennummer-Feld gehören die Pfeile dem Feld.
 *   F  Fokus (Zoom auf die Karte): → / Ende / ← blättern.
 *   G  Hilfe: Tastenkürzel nennen Bild↓/Bild↑, „Was ist neu" nennt M352.
 */
// Läuft aus dem Repository: `node pruefungen/m352-blaettern-tasten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4570;
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
const pdf = pdfErzeugen(5);
const dataUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const stand = {
  boards: [{ id: 'b1', name: 'PDF', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n0', type: 'note', width: 200, position: { x: 0, y: 40 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Erste' }] } },
    { id: 'f1', type: 'file', width: 420, position: { x: 260, y: 40 }, data: { name: 'bericht.pdf', mime: 'application/pdf', size: pdf.length, dataUrl } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
  localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, stand);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);

const lage = () => P.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0];
  const vp = document.querySelector('.react-flow__viewport')?.style.transform ?? '';
  return {
    seite: document.querySelector('.react-flow__node[data-id="f1"] .pdf-seite')?.getAttribute('data-seite') ?? null,
    pos: JSON.stringify(s.nodes.find((n) => n.id === 'f1')?.position),
    gewaehlt: [...document.querySelectorAll('.react-flow__node.selected')].map((el) => el.dataset.id).join(),
    akt: (document.activeElement?.className?.baseVal ?? document.activeElement?.className ?? '').toString().slice(0, 60),
    vp, fokus: !!document.querySelector('.app.focus-mode'),
  };
});
const taste = async (k, ms = 450) => { await P.keyboard.press(k); await P.waitForTimeout(ms); };

console.log('════ A: gewählte Karte, Bild↓/Bild↑ ════');
let z = await lage();
pruefe('A0 PDF aufgeklappt auf Seite 1', z.seite === '1', JSON.stringify(z));
// Karte wählen: Klick auf die Kopfzeile
const box = await P.locator('.react-flow__node[data-id="f1"]').boundingBox();
await P.mouse.click(box.x + box.width - 60, box.y + 12); await P.waitForTimeout(300);
z = await lage();
const pos0 = z.pos;
pruefe('A1 die PDF-Karte ist gewählt', z.gewaehlt === 'f1', z.gewaehlt);
await taste('PageDown'); z = await lage();
pruefe('A2 Bild↓ → Seite 2', z.seite === '2', z.seite);
await taste('PageDown'); await taste('PageUp'); z = await lage();
pruefe('A3 Bild↓, Bild↑ → wieder Seite 2', z.seite === '2', z.seite);
pruefe('A4 die Karte liegt noch an derselben Stelle', z.pos === pos0, `${pos0} → ${z.pos}`);

console.log('\n════ B: Pfeile und Pos1 gehören auf dem Board der Karte ════');
await P.locator('.react-flow__node[data-id="f1"]').evaluate((el) => el.focus());
await taste('ArrowRight'); z = await lage();
pruefe('B1 → blättert die nur gewählte Karte nicht', z.seite === '2', z.seite);
await taste('Home'); z = await lage();
pruefe('B2 Pos1 wählt wie bisher die erste Karte (n0), Seite bleibt', z.gewaehlt === 'n0' && z.seite === '2', JSON.stringify(z));

console.log('\n════ C: Klick auf die Seite ════');
const cv = await P.locator('.react-flow__node[data-id="f1"] .pdf-seite canvas').boundingBox();
await P.mouse.click(cv.x + cv.width / 2, cv.y + cv.height / 2); await P.waitForTimeout(400);
z = await lage();
const posC = z.pos; const vpC = z.vp;
const imFokus = await P.evaluate(() => !!document.activeElement?.closest?.('.pdf-seite'));
pruefe('C0 die Seite hat den Tastatur-Fokus', imFokus);
await taste('ArrowRight'); z = await lage();
pruefe('C1 → Seite 3', z.seite === '3', z.seite);
await taste('Space'); z = await lage();
pruefe('C2 Leertaste → Seite 4', z.seite === '4', z.seite);
await taste('Shift+Space'); z = await lage();
pruefe('C3 Umschalt+Leertaste → Seite 3', z.seite === '3', z.seite);
await taste('End'); z = await lage();
pruefe('C4 Ende → Seite 5', z.seite === '5', z.seite);
await taste('ArrowRight'); z = await lage();
pruefe('C5 → auf der letzten Seite bleibt Seite 5', z.seite === '5', z.seite);
await taste('Home'); z = await lage();
pruefe('C6 Pos1 → Seite 1', z.seite === '1', z.seite);
await taste('ArrowLeft'); z = await lage();
pruefe('C7 ← blättert, verschiebt die Karte aber nicht', z.seite === '1' && z.pos === posC, `${z.seite} ${posC} → ${z.pos}`);

console.log('\n════ D: am Rand ════');
await taste('PageUp'); z = await lage();
pruefe('D1 Bild↑ auf Seite 1 bleibt auf Seite 1, die Ansicht schwenkt nicht', z.seite === '1' && z.vp === vpC, `${z.seite} ${vpC} → ${z.vp}`);

console.log('\n════ E: Seitennummer-Feld ════');
await P.locator('.react-flow__node[data-id="f1"] [data-taste="pdf-seite-nr"]').click(); await P.waitForTimeout(200);
await taste('ArrowRight'); await taste('End'); z = await lage();
pruefe('E1 im Feld blättern Pfeile und Ende nicht', z.seite === '1', z.seite);
await P.keyboard.press('Control+a'); await P.keyboard.type('4'); await taste('Enter', 700); z = await lage();
pruefe('E2 Eingabe 4 + Enter springt weiterhin zu Seite 4', z.seite === '4', z.seite);

console.log('\n════ F: Fokus ════');
await P.mouse.click(5, 500); await P.waitForTimeout(300);
await P.locator('.react-flow__node[data-id="f1"]').evaluate((el) => el.focus());
const boxF = await P.locator('.react-flow__node[data-id="f1"]').boundingBox();
await P.mouse.click(boxF.x + boxF.width - 60, boxF.y + 12); await P.waitForTimeout(250);
await taste('Enter', 1400); z = await lage();
pruefe('F0 Enter öffnet die PDF im Fokus', z.fokus, JSON.stringify(z));
const s0 = Number(z.seite);
await P.evaluate(() => (document.activeElement)?.blur?.());
await taste('ArrowRight'); z = await lage();
pruefe('F1 → im Fokus: nächste Seite', Number(z.seite) === Math.min(5, s0 + 1), `${s0} → ${z.seite}`);
await taste('End'); z = await lage();
pruefe('F2 Ende im Fokus → Seite 5', z.seite === '5', z.seite);
await taste('ArrowLeft'); z = await lage();
pruefe('F3 ← im Fokus → Seite 4', z.seite === '4', z.seite);
await taste('Escape', 900); z = await lage();
pruefe('F4 Esc schließt den Fokus wie bisher', !z.fokus);

console.log('\n════ G: Hilfe ════');
await taste('Alt+h', 800);
const hilfe = await P.evaluate(() => document.querySelector('.modal')?.textContent ?? '');
pruefe('G1 Tastenkürzel nennen Bild↓ und Bild↑ fürs Blättern', /Bild↓/.test(hilfe) && /Bild↑/.test(hilfe) && /nächste Seite/.test(hilfe));
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('G2 „Was ist neu" nennt M352', js.includes('Blättern mit der Tastatur (M352)'));

await browser.close(); app.close();
console.log(`\nm352-blaettern-tasten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
