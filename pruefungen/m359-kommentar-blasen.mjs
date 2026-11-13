/**
 * M359 — Kommentar-Pins und -Blasen auf einer PDF-Seite liegen ÜBER der Karte, auch wenn sie gewählt ist.
 *
 *   A  Karte nicht gewählt: Pin und Blase sind an ihrer Stelle das oberste Element.
 *   B  Karte gewählt (React Flow hebt gewählte Karten auf z 1000): weiterhin oben — vorher lagen sie darunter.
 *   C  Karte wird gezogen und liegt wieder: weiterhin oben.
 *   D  Im Fokus: weiterhin oben.
 *   E  Ein Klick auf die Blase öffnet das Gespräch (sie ist erreichbar).
 *   F  „Was ist neu" nennt M359.
 */
// Läuft aus dem Repository: `node pruefungen/m359-kommentar-blasen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4577;
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
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const stand = {
  boards: [{ id: 'b1', name: 'Skript', edges: [], drawings: [], nodes: [
    { id: 'f1', type: 'file', width: 520, position: { x: 60, y: 40 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
    { id: 'n1', type: 'note', width: 220, position: { x: 700, y: 40 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Nachbar' }] } },
  ], comments: [
    { id: 'c1', nodeId: 'f1', seite: 1, px: 200, py: 260, msgs: [{ author: 'Tester', text: 'Hier fehlt eine Quelle, bitte nachtragen.', at: new Date().toISOString() }] },
    { id: 'c2', nodeId: 'f1', seite: 1, px: 330, py: 480, msgs: [{ author: 'Tester', text: 'Zweiter Punkt weiter unten auf der Seite.', at: new Date().toISOString() }] },
  ] }],
  spaces: [{ id: 's1', name: 'Studium', projects: [{ id: 'p1', name: 'BWL', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
  localStorage.setItem('pixinotes:author', 'Tester');
  localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, stand);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2600);

/** Je Pin und Blase: Was liegt an drei Stellen (Mitte, links, rechts) zuoberst? */
const oben = () => P.evaluate(() => {
  const pruef = (el) => {
    const r = el.getBoundingClientRect();
    const stellen = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]];
    return stellen.every(([x, y]) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); });
  };
  const pins = [...document.querySelectorAll('.comment-pin.auf-seite')];
  const blasen = [...document.querySelectorAll('.comment-blase')];
  const karte = document.querySelector('.react-flow__node[data-id="f1"]');
  // der Pin ist rund (seine Ecken sind durchsichtig) — dort zählt nur die Mitte
  const mitte = (el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); };
  return { pins: pins.length, blasen: blasen.length, pinsOben: pins.every(mitte), blasenOben: blasen.every(pruef), gewaehlt: karte.classList.contains('selected'), zKarte: getComputedStyle(karte).zIndex, zBlase: blasen[0] ? getComputedStyle(blasen[0]).zIndex : null, fokus: !!document.querySelector('.app.focus-mode') };
});

console.log('════ A: nicht gewählt ════');
let z = await oben();
pruefe('A1 zwei Pins und zwei Blasen auf Seite 1, alle zuoberst', z.pins === 2 && z.blasen === 2 && z.pinsOben && z.blasenOben && !z.gewaehlt, JSON.stringify(z));

console.log('\n════ B: Karte gewählt ════');
const kopf = await P.locator('.react-flow__node[data-id="f1"] .file-kopf').first().boundingBox();
await P.mouse.click(kopf.x + 12, kopf.y + kopf.height / 2); await P.waitForTimeout(500);
z = await oben();
pruefe('B1 die Karte ist gewählt', z.gewaehlt, JSON.stringify(z));
pruefe('B2 Pins und Blasen liegen weiterhin über der Karte', z.pinsOben && z.blasenOben, JSON.stringify(z));

console.log('\n════ C: nach dem Ziehen ════');
await P.mouse.move(kopf.x + 12, kopf.y + kopf.height / 2); await P.mouse.down();
await P.mouse.move(kopf.x + 60, kopf.y + 40, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(700);
z = await oben();
pruefe('C1 Karte verschoben: Pins und Blasen sind mitgekommen und liegen oben', z.pins === 2 && z.pinsOben && z.blasenOben, JSON.stringify(z));

console.log('\n════ D: im Fokus ════');
const kopf2 = await P.locator('.react-flow__node[data-id="f1"] .file-kopf').first().boundingBox();
await P.mouse.dblclick(kopf2.x + 12, kopf2.y + kopf2.height / 2); await P.waitForTimeout(1900);
z = await oben();
pruefe('D1 im Fokus liegen Pins und Blasen über der Seite', z.fokus && z.pins === 2 && z.pinsOben && z.blasenOben, JSON.stringify(z));

console.log('\n════ E: erreichbar ════');
const b = await P.locator('.comment-blase').first().boundingBox();
await P.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await P.waitForTimeout(700);
pruefe('E1 ein Klick auf die Blase öffnet das Gespräch', (await P.locator('.comment-panel').count()) === 1 && /fehlt eine Quelle/.test(await P.locator('.comment-panel').textContent()));

console.log('\n════ F ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('F1 „Was ist neu" nennt M359', js.includes('(M359)'));

await browser.close(); app.close();
console.log(`\nm359-kommentar-blasen: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
