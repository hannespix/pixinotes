/**
 * M358 — PDF- und Word-Karten merken sich die zuletzt offene Seite (am Gerät).
 *
 *   A  PDF auf Seite 3 blättern, neu laden → wieder Seite 3 (Leiste und Seite).
 *   B  Zuklappen und wieder aufklappen → Seite 3.
 *   C  Eine zweite PDF-Karte bleibt unabhängig auf Seite 1; ihr Blättern ändert die erste nicht.
 *   D  Im Fokus öffnet die Karte auf der gemerkten Seite; dort Geblättertes gilt nach Esc auf dem Board weiter.
 *   E  Gemerkte Seite, die es nicht gibt (9 von 5) → letzte Seite.
 *   F  Word-Dokument: Seite 2, neu laden → Seite 2.
 *   G  Zurück auf Seite 1 räumt den Eintrag ab; der Lesestand steht nicht im Board (kein Sync-Inhalt).
 *   H  „Was ist neu" nennt M358.
 */
// Läuft aus dem Repository: `node pruefungen/m358-letzte-seite.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4576;
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
const crcTab = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTab[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zipStore(eintraege) {
  const teile = []; const zentral = []; let offset = 0;
  for (const [name, inhalt] of eintraege) {
    const nameB = Buffer.from(name);
    const daten = Buffer.from(inhalt);
    const crc = crc32(daten);
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4);
    kopf.writeUInt32LE(crc, 14); kopf.writeUInt32LE(daten.length, 18); kopf.writeUInt32LE(daten.length, 22);
    kopf.writeUInt16LE(nameB.length, 26);
    teile.push(kopf, nameB, daten);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6);
    z.writeUInt32LE(crc, 16); z.writeUInt32LE(daten.length, 20); z.writeUInt32LE(daten.length, 24);
    z.writeUInt16LE(nameB.length, 28); z.writeUInt32LE(offset, 42);
    zentral.push(z, nameB);
    offset += 30 + nameB.length + daten.length;
  }
  const zStart = offset;
  const zBuf = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(zBuf.length, 12); ende.writeUInt32LE(zStart, 16);
  return Buffer.concat([...teile, zBuf, ende]);
}

/* ---------- Test-Word-Dokument: zwei Seiten (A4), Überschrift + Absätze, expliziter Seitenumbruch ---------- */
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const absatz = (t, stil) => `<w:p>${stil ? `<w:pPr><w:pStyle w:val="${stil}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const dokument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>`
  + absatz('Projektbericht Nordhafen', 'Heading1')
  + absatz('WORTMARKER-EINS: Dies ist der erste Absatz auf Seite eins des Berichts.')
  + absatz('Ein zweiter Absatz mit weiterem Text, damit die Seite nicht leer wirkt.')
  + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
  + absatz('Anhang', 'Heading1')
  + absatz('WORTMARKER-ZWEI: Der Anhang steht auf Seite zwei.')
  + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`
  + `</w:body></w:document>`;
const stile = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
const docx = zipStore([
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
  ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
  ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
  ['word/document.xml', dokument],
  ['word/styles.xml', stile],
]);
const pdf = pdfErzeugen(5);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const docxUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docx.toString('base64')}`;
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const stand = {
  boards: [{ id: 'b1', name: 'Skripte', edges: [], drawings: [], comments: [], nodes: [
    { id: 'f1', type: 'file', width: 420, position: { x: 40, y: 40 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
    { id: 'f2', type: 'file', width: 420, position: { x: 520, y: 40 }, data: { name: 'folien.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
    { id: 'w1', type: 'file', width: 420, position: { x: 1000, y: 40 }, data: { name: 'bericht.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: docx.length, dataUrl: docxUrl } },
  ] }],
  spaces: [{ id: 's1', name: 'Studium', projects: [{ id: 'p1', name: 'BWL', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
  localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true, f2: true, w1: true }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, stand);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2600);

const karte = (id) => `.react-flow__node[data-id="${id}"]`;
const seite = (id) => P.evaluate((sel) => ({
  attr: document.querySelector(`${sel} .pdf-seite`)?.getAttribute('data-seite') ?? null,
  feld: document.querySelector(`${sel} [data-taste="pdf-seite-nr"]`)?.value ?? null,
  von: document.querySelector(`${sel} .pdf-seite-von`)?.textContent ?? null,
}), karte(id));
const vor = async (id, n = 1) => { for (let i = 0; i < n; i += 1) { await P.locator(`${karte(id)} [data-taste="pdf-vor"]`).click(); await P.waitForTimeout(450); } };
const gemerkt = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-pdf-seite') ?? '{}'));
const neuLaden = async () => { await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(2600); };

console.log('════ A: neu laden ════');
await vor('f1', 2);
let s = await seite('f1');
pruefe('A1 auf Seite 3 geblättert, am Gerät gemerkt', s.attr === '3' && (await gemerkt()).f1 === 3, JSON.stringify({ s, g: await gemerkt() }));
await neuLaden();
s = await seite('f1');
pruefe('A2 nach dem Neuladen wieder Seite 3 (Seite und Leiste „3 / 5")', s.attr === '3' && s.feld === '3' && /\/ 5/.test(s.von ?? ''), JSON.stringify(s));

console.log('\n════ B: zu- und aufklappen ════');
await P.locator(`${karte('f1')} [data-taste="pdf-zuklappen"]`).click(); await P.waitForTimeout(600);
await P.locator(`${karte('f1')} [data-taste="pdf-aufklappen"]`).click(); await P.waitForTimeout(1500);
s = await seite('f1');
pruefe('B1 wieder aufgeklappt steht sie auf Seite 3', s.attr === '3', JSON.stringify(s));

console.log('\n════ C: jede Karte für sich ════');
s = await seite('f2');
pruefe('C1 die zweite PDF steht auf Seite 1', s.attr === '1', JSON.stringify(s));
await vor('f2', 1);
pruefe('C2 ihr Blättern ändert die erste nicht', (await seite('f2')).attr === '2' && (await seite('f1')).attr === '3' && (await gemerkt()).f2 === 2);

console.log('\n════ D: Fokus ════');
const kopf = await P.locator(`${karte('f1')} .file-kopf`).first().boundingBox();
await P.mouse.dblclick(kopf.x + 8, kopf.y + kopf.height / 2); await P.waitForTimeout(1800);
s = await seite('f1');
const imFokus = await P.evaluate(() => !!document.querySelector('.app.focus-mode'));
pruefe('D1 im Fokus öffnet die Karte auf Seite 3', imFokus && s.attr === '3', JSON.stringify({ imFokus, s }));
await P.keyboard.press('PageDown'); await P.waitForTimeout(700);
await P.keyboard.press('Escape'); await P.waitForTimeout(1200);
s = await seite('f1');
pruefe('D2 im Fokus weitergeblättert (Seite 4) — gilt nach Esc auf dem Board', s.attr === '4' && (await gemerkt()).f1 === 4, JSON.stringify({ s, g: await gemerkt() }));

console.log('\n════ E: gemerkte Seite gibt es nicht ════');
await P.evaluate(() => { const m = JSON.parse(localStorage.getItem('pixinotes-pdf-seite') ?? '{}'); m.f2 = 9; localStorage.setItem('pixinotes-pdf-seite', JSON.stringify(m)); });
await neuLaden();
s = await seite('f2');
pruefe('E1 Seite 9 von 5 → die letzte Seite (5), sichtbar gerendert', s.attr === '5' && s.feld === '5' && (await P.locator(`${karte('f2')} .pdf-seite canvas`).count()) === 1, JSON.stringify(s));

console.log('\n════ F: Word ════');
await P.waitForTimeout(1200);
let w = await seite('w1');
pruefe('F0 das Word-Dokument hat zwei Seiten und steht auf Seite 1', w.attr === '1' && /\/ 2/.test(w.von ?? ''), JSON.stringify(w));
await vor('w1', 1);
await neuLaden(); await P.waitForTimeout(1500);
w = await seite('w1');
const sichtbar = await P.evaluate((sel) => [...document.querySelectorAll(`${sel} .word-inhalt section.docx`)].filter((x) => x.getBoundingClientRect().height > 0 && getComputedStyle(x).display !== 'none').map((x) => /WORTMARKER-ZWEI/.test(x.textContent) ? 2 : 1).join(), karte('w1'));
pruefe('F1 nach dem Neuladen steht das Word-Dokument auf Seite 2 (und zeigt sie)', w.attr === '2' && sichtbar === '2', JSON.stringify({ w, sichtbar }));

console.log('\n════ G: Aufräumen und kein Sync-Inhalt ════');
await P.locator(`${karte('w1')} [data-taste="pdf-zurueck"]`).click(); await P.waitForTimeout(500);
pruefe('G1 zurück auf Seite 1 räumt den Eintrag ab', !('w1' in (await gemerkt())), JSON.stringify(await gemerkt()));
const brett = await P.evaluate(() => localStorage.getItem('pixinotes-board'));
pruefe('G2 der Lesestand steht nicht im Board', !/"seiteOffen"|pdf-seite|"letzteSeite"/.test(brett) && !/"f1"[^}]*"seite":4/.test(brett));

console.log('\n════ H ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('H1 „Was ist neu" nennt M358', js.includes('(M358)'));

await browser.close(); app.close();
console.log(`\nm358-letzte-seite: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
