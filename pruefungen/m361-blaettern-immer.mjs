/**
 * M361 — Blättern mit den Pfeiltasten geht nicht mehr verloren.
 *
 * Bisher gehörten ← / → dem Dokument nur, solange der Tastatur-Fokus IN der Seite lag. Er ging aber leicht
 * verloren: Der Blätter-Knopf wurde am Anfang/Ende grau (Chromium verschluckt dann alle Tasten), man wählte
 * ein Werkzeug, schrieb mit dem Stift oder schloss einen Kommentar. Danach blätterten nur noch die Knöpfe.
 *
 *   A  Per Knopf bis zur letzten Seite (Knopf wird grau) → ← blättert trotzdem; ebenso am Anfang.
 *   B  Tastatur-Fokus woanders (Werkzeugleiste, nirgends): ← / → blättern weiter, die Karte rückt nicht.
 *   C  Stift gewählt und auf die Seite gezeichnet: → blättert.
 *   D  Griff auf die freie Fläche, auf die Kopfzeile oder auf eine andere Karte gibt die Pfeile zurück.
 *   E  Esc gibt die Pfeile zurück.
 *   F  Fokus: per Knopf ans Ende, ← blättert.
 *   G  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m361-blaettern-immer.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4579;
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


const karte = P.locator('.react-flow__node[data-id="f1"]');
const klickSeite = async () => { const cv = await karte.locator('.pdf-seite canvas').boundingBox(); await P.mouse.click(cv.x + cv.width / 2, cv.y + cv.height / 2); await P.waitForTimeout(350); };
const knopf = async (welcher, mal = 1) => { for (let i = 0; i < mal; i++) { await karte.locator(`[data-taste="${welcher}"]`).click(); await P.waitForTimeout(350); } };

console.log('════ A: Knopf wird grau ════');
let z = await lage();
pruefe('A0 PDF aufgeklappt auf Seite 1', z.seite === '1', JSON.stringify(z));
await klickSeite();
await knopf('pdf-vor', 4); z = await lage();
const pos0 = z.pos;
pruefe('A1 per Knopf auf Seite 5 — „›" ist am Ende ohne Wirkung', z.seite === '5' && (await karte.locator('[data-taste="pdf-vor"]').getAttribute('aria-disabled')) === 'true', z.seite);
await taste('ArrowLeft'); z = await lage();
pruefe('A2 ← blättert danach weiter (Seite 4)', z.seite === '4', z.seite);
await taste('ArrowRight'); z = await lage();
pruefe('A3 → wieder Seite 5', z.seite === '5', z.seite);
await knopf('pdf-zurueck', 4); z = await lage();
pruefe('A4 per Knopf zurück auf Seite 1', z.seite === '1', z.seite);
await taste('ArrowRight'); z = await lage();
pruefe('A5 → blättert auch nach dem grauen „‹" (Seite 2)', z.seite === '2', z.seite);
await knopf('pdf-zurueck', 1); await karte.locator('[data-taste="pdf-zurueck"]').click({ force: true }); await P.waitForTimeout(300); z = await lage();
pruefe('A6 der graue Knopf blättert nicht über den Rand', z.seite === '1', z.seite);

console.log('\n════ B: Tastatur-Fokus woanders ════');
await klickSeite();
await P.evaluate(() => document.querySelector('.dock button')?.focus()); await P.waitForTimeout(150);
await taste('ArrowRight'); z = await lage();
pruefe('B1 Fokus in der Werkzeugleiste: → blättert (Seite 2)', z.seite === '2', `${z.seite} ${z.akt}`);
await P.evaluate(() => document.activeElement?.blur?.()); await P.waitForTimeout(150);
await taste('ArrowRight'); z = await lage();
pruefe('B2 Fokus nirgends: → blättert (Seite 3)', z.seite === '3', z.seite);
await karte.evaluate((el) => el.focus()); await P.waitForTimeout(150);
await taste('ArrowLeft'); z = await lage();
pruefe('B3 Fokus auf dem Kartenrahmen: ← blättert (Seite 2), die Karte rückt nicht', z.seite === '2' && z.pos === pos0, `${z.seite} ${pos0} → ${z.pos}`);
await taste('Space'); z = await lage();
pruefe('B4 Leertaste blättert ebenso (Seite 3)', z.seite === '3', z.seite);

console.log('\n════ C: Stift auf der Seite ════');
await P.keyboard.press('p'); await P.waitForTimeout(400);
const cvC = await karte.locator('.pdf-seite canvas').boundingBox();
const striche0 = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings.length);
await P.mouse.move(cvC.x + 80, cvC.y + 120); await P.mouse.down();
for (let i = 1; i <= 12; i++) await P.mouse.move(cvC.x + 80 + i * 12, cvC.y + 120 + (i % 3) * 6);
await P.mouse.up(); await P.waitForTimeout(900);
const striche1 = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings.length);
pruefe('C0 der Strich liegt auf der Seite', striche1 === striche0 + 1, `${striche0} → ${striche1}`);
await taste('ArrowRight'); z = await lage();
pruefe('C1 nach dem Zeichnen blättert → (Seite 4)', z.seite === '4', z.seite);
await taste('ArrowLeft'); z = await lage();
pruefe('C2 … und ← (Seite 3)', z.seite === '3', z.seite);
// Textmarker: ohne vorher je in die Seite geklickt zu haben
await P.keyboard.press('Escape'); await P.waitForTimeout(300);
await P.mouse.click(1200, 880); await P.waitForTimeout(300);          // Griff daneben: das Dokument ist nicht mehr „zuletzt"
await P.locator('[data-taste="zeichnen"]').click(); await P.waitForTimeout(250);      // wie am Gerät: Werkzeug über die Leiste wählen
await P.locator('.dock-menu-draw button', { hasText: 'Textmarker' }).click(); await P.waitForTimeout(350);
const werkzeug = await P.evaluate(() => (document.activeElement?.closest?.('.dock') ? 'Fokus in der Leiste' : 'Fokus woanders'));
await P.mouse.move(cvC.x + 90, cvC.y + 260); await P.mouse.down();
for (let i = 1; i <= 12; i++) await P.mouse.move(cvC.x + 90 + i * 14, cvC.y + 260);
await P.mouse.up(); await P.waitForTimeout(900);
const striche2 = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings);
pruefe('C3 ein Markerstrich liegt auf der Seite', striche2.length === striche1 + 1 && striche2[striche2.length - 1].tool === 'marker', `${striche2.length} ${striche2[striche2.length - 1]?.tool} ${werkzeug}`);
await taste('ArrowRight'); z = await lage();
pruefe('C4 mit aktivem Textmarker blättert → (Seite 4)', z.seite === '4', z.seite);
await taste('ArrowLeft'); z = await lage();
pruefe('C5 … und ← (Seite 3), die Karte rückt nicht', z.seite === '3' && z.pos === pos0, `${z.seite} ${z.pos}`);
await P.keyboard.press('Escape'); await P.waitForTimeout(300);
await P.keyboard.press('v'); await P.waitForTimeout(300);

console.log('\n════ D: Griff woandershin gibt die Pfeile zurück ════');
await klickSeite(); await taste('ArrowRight'); z = await lage();
pruefe('D0 Klick auf die Seite: → blättert (Seite 4)', z.seite === '4', z.seite);
await P.mouse.click(1200, 880); await P.waitForTimeout(300);
await taste('ArrowRight'); z = await lage();
pruefe('D1 nach einem Klick auf die freie Fläche blättert → nicht mehr', z.seite === '4', z.seite);
await klickSeite();
const box = await karte.boundingBox();
await P.mouse.click(box.x + box.width - 60, box.y + 12); await P.waitForTimeout(300);
await karte.evaluate((el) => el.focus());
await taste('ArrowRight'); z = await lage();
pruefe('D2 Griff an die Kopfzeile: die Pfeile gehören wieder der Karte (kein Blättern)', z.seite === '4' && z.gewaehlt === 'f1', JSON.stringify(z));
await taste('PageDown'); z = await lage();
pruefe('D3 Bild↓ blättert die gewählte Karte wie bisher (Seite 5)', z.seite === '5', z.seite);
await klickSeite();
await P.locator('.react-flow__node[data-id="n0"]').click({ position: { x: 20, y: 8 } }); await P.waitForTimeout(300);
await P.evaluate(() => document.activeElement?.blur?.());
await taste('ArrowLeft'); z = await lage();
pruefe('D4 Klick auf eine andere Karte: ← blättert die PDF nicht', z.seite === '5', JSON.stringify(z));

console.log('\n════ E: Esc ════');
await klickSeite(); await taste('ArrowLeft'); z = await lage();
pruefe('E0 Klick auf die Seite: ← blättert (Seite 4)', z.seite === '4', z.seite);
await taste('Escape'); await P.evaluate(() => document.activeElement?.blur?.());
await taste('ArrowLeft'); z = await lage();
pruefe('E1 nach Esc blättern die Pfeile nicht mehr', z.seite === '4', z.seite);

console.log('\n════ F: Fokus ════');
await P.mouse.click(5, 500); await P.waitForTimeout(300);
const boxF = await karte.boundingBox();
await P.mouse.click(boxF.x + boxF.width - 60, boxF.y + 12); await P.waitForTimeout(250);
await karte.evaluate((el) => el.focus());
await taste('Enter', 1400); z = await lage();
pruefe('F0 Enter öffnet die PDF im Fokus', z.fokus, JSON.stringify(z));
await knopf('pdf-vor', 5 - Number(z.seite)); z = await lage();
pruefe('F1 per Knopf ans Ende (Seite 5)', z.seite === '5', z.seite);
await taste('ArrowLeft'); z = await lage();
pruefe('F2 ← blättert im Fokus nach dem grauen Knopf (Seite 4)', z.seite === '4', z.seite);
await taste('Home'); z = await lage();
await knopf('pdf-vor', 1); await knopf('pdf-zurueck', 1); z = await lage();
await taste('ArrowRight'); z = await lage();
pruefe('F3 … und → nach dem grauen „‹" (Seite 2)', z.seite === '2', z.seite);
await taste('Escape', 900);

console.log('\n════ G: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('G1 „Was ist neu" nennt M361', js.includes('(M361)'));

await browser.close(); app.close();
console.log(`\nm361-blaettern-immer: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
