/**
 * M363 — Dokumente am Telefon bedienen und annotieren; Dokumente in der Präsentation lesbar und blätterbar.
 *
 * Telefon (iPhone-Maße, echte Touch-Ereignisse über CDP):
 *   A  Fokus: Die PDF-Seite passt auf die Schirmbreite (vorher rechts abgeschnitten); die Fußleiste trägt
 *      Seiten-Pfeile, Seitenzahl, Stift, Textmarker, Radierer, Kommentar — in Daumen-Größe.
 *   B  Blättern: Knopf, Wisch über die Seite, Seitenzahl tippen; eine neue Seite beginnt oben.
 *   C  Zoom: zwei Finger vergrößern, ein Finger schiebt das Blatt (bis an die Kanten, ohne zu blättern),
 *      Blättern behält den Zoom, Doppeltipp zurück/heran.
 *   D  Annotieren: Textmarker mit dem Finger (zwei Finger zoomen weiter), Radierer, Kommentar an eine Stelle.
 *   E  Präsentation am Telefon: Seite füllt die Breite, mit Anmerkungen; Wisch und Rand-Tipp blättern,
 *      zwei Finger zoomen, Doppeltipp zurück.
 * Desktop:
 *   F  Präsentation: PDF als Seite statt Dateiname; „Seitenbreite" wenn die ganze Seite zu klein wäre;
 *      Leertaste rollt erst, blättert dann; nach der letzten Seite die nächste Folie, rückwärts die letzte
 *      Seite; + / − / 0 / B; Pfeile nach einem Klick auf „Weiter"; Seitensprung; Word-Dokument als Folie.
 *   G  Fokus am Desktop unverändert (Zoom 1 bei hoher Seite).   H  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m363-telefon-dokumente.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium, devices } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4581;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
/** PDF mit Text: n Seiten A4, Überschrift und 34 Zeilen */
function pdfText(n) {
  const obj = [];
  obj.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: n }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  obj.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < n; i++) {
    let s = `BT /F1 22 Tf 60 770 Td (Kapitel ${i + 1}: Grundlagen der Kostenrechnung) Tj ET\n`;
    for (let z = 0; z < 34; z++) s += `BT /F1 11 Tf 60 ${735 - z * 19} Td (Zeile ${z + 1} auf Seite ${i + 1}: Die Deckungsbeitragsrechnung trennt fixe und variable Kosten sauber.) Tj ET\n`;
    obj.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    obj.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  }
  let aus = '%PDF-1.4\n'; const off = [];
  obj.forEach((o, i) => { off.push(aus.length); aus += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = aus.length;
  aus += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n`;
  for (const o of off) aus += `${String(o).padStart(10, '0')} 00000 n \n`;
  aus += `trailer\n<< /Size ${obj.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return aus;
}
const pdf = pdfText(4);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
/* ---------- Word-Dokument (zwei Seiten) wie in m337 ---------- */
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
const docxUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docx.toString('base64')}`;

const note = (id, text, x, y) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const stand = (mitWord) => ({
  boards: [{ id: 'b1', name: 'Skript', edges: [], comments: [], drawings: [
    { id: 'd1', tool: 'marker', color: '#ffe066', width: 14, anchor: 'f1', seite: 1, seitenBreite: true, gerade: true, points: [[60, 110], [420, 110]] },
    { id: 'd2', tool: 'pen', color: '#e03131', width: 2.5, anchor: 'f1', seite: 2, seitenBreite: true, points: [[80, 600], [120, 590], [160, 610], [200, 585], [240, 612], [280, 588], [320, 606], [360, 590]] },
  ], nodes: [
    note('n1', 'Vorweg', 40, 40),
    { id: 'f1', type: 'file', width: 520, position: { x: 340, y: 40 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
    note('n2', 'Danach', 900, 40),
    ...(mitWord ? [{ id: 'w1', type: 'file', width: 520, position: { x: 1200, y: 40 }, data: { name: 'bericht.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: docx.length, dataUrl: docxUrl } }] : []),
  ] }],
  spaces: [{ id: 's1', name: 'Studium', projects: [{ id: 'p1', name: 'BWL', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
async function geraet(opt, st) {
  const ctx = await browser.newContext(opt);
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes:author', 'Anna');
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true, w1: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
}
const board = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);

// ══════════════════════════ Telefon ══════════════════════════
const T = await geraet({ ...devices['iPhone 13'] }, stand(false));
const P = T.P;
const cdp = await T.ctx.newCDPSession(P);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
const zug = async (x1, y1, x2, y2, schritte = 6) => { await touch('touchStart', [[x1, y1]]); for (let i = 1; i <= schritte; i++) { await touch('touchMove', [[x1 + (x2 - x1) * i / schritte, y1 + (y2 - y1) * i / schritte]]); await P.waitForTimeout(16); } await touch('touchEnd', []); await P.waitForTimeout(750); };
const kneifen = async (cx, cy, a, b) => { await touch('touchStart', [[cx - a, cy], [cx + a, cy]]); for (let i = 1; i <= 8; i++) { const d = a + (b - a) * i / 8; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await P.waitForTimeout(16); } await touch('touchEnd', []); await P.waitForTimeout(800); };
const doppeltipp = async (x, y) => { await P.touchscreen.tap(x, y); await P.waitForTimeout(90); await P.touchscreen.tap(x, y); await P.waitForTimeout(900); };
const lage = () => P.evaluate(() => {
  const k = document.querySelector('.react-flow__node[data-id="f1"]');
  const r = k?.getBoundingClientRect();
  const c = k?.querySelector('.pdf-seite canvas')?.getBoundingClientRect();
  const m = /scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '');
  return {
    b: innerWidth, h: innerHeight, links: r ? Math.round(r.left) : null, rechts: r ? Math.round(r.right) : null, oben: r ? Math.round(r.top) : null,
    seiteB: c ? Math.round(c.width) : 0, seiteOben: c ? Math.round(c.top) : 0, zoom: m ? Number(m[1]) : 0,
    seite: Number(k?.querySelector('.pdf-seite')?.getAttribute('data-seite') ?? 0), fokus: !!document.querySelector('.app.focus-mode'),
  };
});

console.log('════ A: Fokus am Telefon ════');
{
  const k = await P.locator('.react-flow__node[data-id="f1"]').boundingBox();
  await P.touchscreen.tap(k.x + k.width / 2, k.y + Math.min(k.height / 2, 120)); await P.waitForTimeout(1600);
}
let z = await lage();
const fit = z.zoom;
pruefe('A1 ein Tipp öffnet die PDF im Fokus', z.fokus, z);
pruefe('A2 die Karte passt in die Schirmbreite (nichts abgeschnitten)', z.links >= 0 && z.rechts <= z.b && z.seiteB >= z.b * 0.88, z);
const leiste = await P.evaluate(() => [...document.querySelectorAll('.focus-nav.dokument button')].map((b) => { const r = b.getBoundingClientRect(); return [b.getAttribute('data-taste') ?? b.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height), r.right <= innerWidth + 1 && r.left >= -1]; }));
pruefe('A3 Fußleiste: Seiten-Pfeile, Stift, Textmarker, Radierer, Kommentar — alle ≥ 44 Punkte und im Bild',
  ['fokus-seite-zurueck', 'fokus-stift', 'fokus-marker', 'fokus-radierer', 'fokus-kommentar', 'fokus-seite-vor'].every((t) => leiste.some((l) => l[0] === t && l[1] >= 44 && l[2] >= 44 && l[3])), leiste);
pruefe('A4 Kopfzeile und Leiste nennen die Seite', /Seite 1 von 4/.test(await P.locator('.focus-title').textContent()) && (await P.locator('[data-taste="fokus-seite-nr"]').inputValue()) === '1');
await P.screenshot({ path: path.join(SD, 'm363-fokus.png') });

console.log('\n════ B: Blättern ════');
await P.locator('[data-taste="fokus-seite-vor"]').tap(); await P.waitForTimeout(600); z = await lage();
pruefe('B1 „›" in der Fußleiste → Seite 2', z.seite === 2, z.seite);
await zug(300, 350, 80, 350); z = await lage();
pruefe('B2 Wisch nach links über die Seite → Seite 3', z.seite === 3, z.seite);
await zug(80, 350, 300, 350); z = await lage();
pruefe('B3 Wisch nach rechts → Seite 2', z.seite === 2, z.seite);
// nach unten rollen, dann blättern: die neue Seite beginnt oben
await zug(200, 520, 200, 160); const gerollt = await lage();
await P.locator('[data-taste="fokus-seite-vor"]').tap(); await P.waitForTimeout(800); z = await lage();
pruefe('B4 ein senkrechter Zug rollt die Seite; nach dem Blättern beginnt die neue oben', gerollt.oben < 0 && gerollt.seite === 2 && z.seite === 3 && z.oben > 0, { gerollt: gerollt.oben, danach: z.oben });
await P.locator('[data-taste="fokus-seite-nr"]').tap(); await P.keyboard.type('4'); await P.keyboard.press('Enter'); await P.waitForTimeout(700); z = await lage();
pruefe('B5 Seitenzahl tippen springt (Seite 4); „›" ist am Ende ohne Wirkung', z.seite === 4 && (await P.locator('[data-taste="fokus-seite-vor"]').getAttribute('aria-disabled')) === 'true', z.seite);
await P.locator('[data-taste="fokus-seite-nr"]').tap(); await P.keyboard.type('2'); await P.keyboard.press('Enter'); await P.waitForTimeout(700);

console.log('\n════ C: Zoom ════');
await kneifen(195, 320, 45, 140); z = await lage();
const gezoomt = z.zoom;
pruefe('C1 zwei Finger vergrößern die Seite', z.zoom > fit * 1.8 && z.rechts - z.links > z.b * 1.8, z);
await zug(320, 350, 60, 350); const geschoben = await lage();
pruefe('C2 ein Finger schiebt das vergrößerte Blatt seitwärts — und blättert dabei nicht', geschoben.links < z.links - 150 && geschoben.seite === 2, { vor: z.links, nach: geschoben.links, seite: geschoben.seite });
for (let i = 0; i < 4; i++) await zug(330, 350, 40, 350);
z = await lage();
pruefe('C3 … bis an die rechte Kante, nicht darüber hinaus', z.rechts >= z.b - 12 && z.rechts <= z.b + 2, z);
await P.locator('[data-taste="fokus-seite-vor"]').tap(); await P.waitForTimeout(800); z = await lage();
pruefe('C4 Blättern behält den Zoom', z.seite === 3 && Math.abs(z.zoom - gezoomt) < 0.01, z);
await doppeltipp(200, 350); z = await lage();
pruefe('C5 Doppeltipp: zurück auf Schirmbreite', Math.abs(z.zoom - fit) < 0.01 && z.links >= 0 && z.rechts <= z.b, z);
await doppeltipp(200, 350); z = await lage();
pruefe('C6 Doppeltipp: heran', z.zoom > fit * 2 && z.seite === 3, z);
await kneifen(195, 320, 140, 20); z = await lage();
pruefe('C7 zusammenkneifen: nie kleiner als eingepasst', Math.abs(z.zoom - fit) < 0.02 && z.links >= 0, z);

console.log('\n════ D: Annotieren ════');
await P.locator('[data-taste="fokus-marker"]').tap(); await P.waitForTimeout(500);
pruefe('D1 Textmarker ist an (Knopf zeigt es)', (await P.locator('[data-taste="fokus-marker"]').getAttribute('aria-pressed')) === 'true');
const n0 = (await board(P)).drawings.length;
await zug(80, 300, 300, 300, 10); await P.waitForTimeout(700);
let b = await board(P);
const neu = b.drawings[b.drawings.length - 1];
pruefe('D2 ein Fingerstrich markiert auf der Seite (Seite 3 dieser PDF)', b.drawings.length === n0 + 1 && neu.tool === 'marker' && neu.anchor === 'f1' && neu.seite === 3, neu && { tool: neu.tool, seite: neu.seite });
z = await lage();
pruefe('D3 dabei hat sich nichts verschoben und nicht geblättert', z.seite === 3 && Math.abs(z.zoom - fit) < 0.02, z);
await kneifen(195, 320, 45, 130); z = await lage(); b = await board(P);
pruefe('D4 zwei Finger zoomen auch mit Textmarker — ohne Strich', z.zoom > fit * 1.5 && b.drawings.length === n0 + 1, { zoom: z.zoom, striche: b.drawings.length });
await kneifen(195, 320, 140, 20);
await P.locator('[data-taste="fokus-radierer"]').tap(); await P.waitForTimeout(400);
const laenge = (bb) => bb.drawings.filter((s) => s.anchor === 'f1' && s.seite === 3 && s.tool === 'marker').reduce((sum, s) => sum + (Math.max(...s.points.map((p) => p[0])) - Math.min(...s.points.map((p) => p[0]))), 0);
const vorher = laenge(b);
// über die markierte Zeile radieren (der Marker ist auf die Textzeile eingerastet — ihre Höhe aus dem Strich)
const markerY = await P.evaluate(() => { const g = document.querySelector('.marker-gruppe path, path[stroke-linecap="butt"]'); const r = g?.getBoundingClientRect(); return r ? r.top + r.height / 2 : 300; });
for (const dy of [-3, 3]) await zug(50, markerY + dy, 340, markerY + dy, 16);
await P.waitForTimeout(600); b = await board(P);
pruefe('D5 der Radierer nimmt die Markierung (fast) ganz wieder weg', vorher > 100 && laenge(b) < vorher * 0.35, { vorher, nachher: laenge(b) });
await P.locator('[data-taste="fokus-radierer"]').tap(); await P.waitForTimeout(300);
await P.locator('[data-taste="fokus-kommentar"]').tap(); await P.waitForTimeout(500);
pruefe('D6 „Kommentar an eine Stelle" ist an', (await P.locator('[data-taste="fokus-kommentar"]').getAttribute('aria-pressed')) === 'true' && (await P.locator('.pdf-seite.pin-modus').count()) === 1);
await P.touchscreen.tap(200, 380); await P.waitForTimeout(900);
pruefe('D7 Tipp auf die Seite öffnet den Kommentar zu dieser Stelle (Seite 3)', (await P.locator('.comment-panel').count()) === 1 && /Seite 3/.test(await P.locator('.comment-panel-head').textContent()) && /dieser Stelle/.test(await P.locator('.comment-input').getAttribute('placeholder')));
await P.locator('.comment-input').fill('Formel prüfen'); await P.locator('.comment-send').tap(); await P.waitForTimeout(900); b = await board(P);
pruefe('D8 der Kommentar hängt an der Stelle', b.comments.length === 1 && b.comments[0].seite === 3 && b.comments[0].px > 0 && b.comments[0].py > 0 && b.comments[0].msgs[0].text === 'Formel prüfen', b.comments[0]);
await P.locator('.comment-panel-tools button[aria-label="Schließen"]').tap().catch(() => {}); await P.waitForTimeout(400);
await P.screenshot({ path: path.join(SD, 'm363-fokus-kommentar.png') });

console.log('\n════ E: Präsentation am Telefon ════');
await P.locator('[data-taste="fokus-seite-nr"]').tap(); await P.keyboard.type('1'); await P.keyboard.press('Enter'); await P.waitForTimeout(600);
await P.locator('.focus-nav .focus-act.nur-zeichen').tap(); await P.waitForTimeout(2200);
const folie = () => P.evaluate(() => {
  const d = document.querySelector('.folie-dok'); const bl = document.querySelector('.folie-dok-seite')?.getBoundingClientRect();
  const c = document.querySelector('.folie-dok-seite canvas'); const fl = document.querySelector('.folie-dok-flaeche');
  let tinte = 0;
  if (c && c.width > 10) { const x = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data; for (let i = 0; i < x.length; i += 4 * 97) if (x[i] < 120 && x[i + 3] > 200) tinte += 1; }
  return { da: !!d, seite: Number(d?.dataset.seite ?? 0), seiten: Number(d?.dataset.seiten ?? 0), zoom: Number(d?.dataset.zoom ?? 0), modus: d?.dataset.modus, blattB: bl ? Math.round(bl.width) : 0, blattLinks: bl ? Math.round(bl.left) : 0,
    tinte, striche: document.querySelectorAll('.folie-dok-striche path').length, rollTop: fl ? Math.round(fl.scrollTop) : 0, rollbarX: fl ? fl.scrollWidth > fl.clientWidth + 2 : false,
    zaehler: document.querySelector('.presenter-count')?.textContent ?? '', fuss: !!document.querySelector('.presenter-foot') && getComputedStyle(document.querySelector('.presenter-foot')).display !== 'none', b: innerWidth };
});
let f = await folie();
pruefe('E1 „▶" im Fokus startet die Präsentation bei diesem Dokument, auf der offenen Seite', f.da && f.seite === 1 && f.seiten === 4 && /2 \/ 3/.test(f.zaehler), f);
pruefe('E2 die Seite füllt die Breite und zeigt Inhalt (kein Dateiname)', f.blattB >= f.b * 0.9 && f.tinte > 20, f);
pruefe('E3 Anmerkungen vom Board liegen auf der Seite', f.striche >= 1, f.striche);
pruefe('E4 am Telefon weicht die Fußleiste der Präsentation der Seite; die Dokument-Knöpfe sind ≥ 44 Punkte',
  !f.fuss && await P.evaluate(() => [...document.querySelectorAll('.folie-dok-leiste button')].every((b) => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44)));
await P.screenshot({ path: path.join(SD, 'm363-vortrag-telefon.png') });
await zug(300, 300, 70, 300); f = await folie();
pruefe('E5 Wisch nach links → Seite 2 (mit dem Stiftstrich von dort)', f.seite === 2 && f.striche >= 1, f);
await P.touchscreen.tap(370, 300); await P.waitForTimeout(900); f = await folie();
pruefe('E6 Tipp auf den rechten Rand → Seite 3', f.seite === 3, f.seite);
await kneifen(195, 300, 45, 140); f = await folie();
pruefe('E7 zwei Finger vergrößern; das Blatt wird breiter als der Schirm und rollbar', f.zoom > 1.8 && f.blattB > f.b * 1.8 && f.rollbarX, f);
await zug(300, 300, 70, 300); f = await folie();
pruefe('E8 vergrößert rollt der Wisch das Blatt, statt zu blättern', f.seite === 3, f.seite);
await doppeltipp(195, 300); f = await folie();
pruefe('E9 Doppeltipp: zurück auf die ganze Seite', Math.abs(f.zoom - 1) < 0.01 && f.blattB <= f.b, f);
await P.locator('[data-taste="folie-vor"]').tap(); await P.waitForTimeout(700);
await P.locator('[data-taste="folie-vor"]').tap(); await P.waitForTimeout(900);
pruefe('E10 „›" nach der letzten Seite führt zur nächsten Folie', (await P.locator('.folie-dok').count()) === 0 && /3 \/ 3/.test(await P.locator('.presenter-count').textContent()), await P.locator('.presenter-count').textContent());
await T.ctx.close();

// ══════════════════════════ Desktop ══════════════════════════
console.log('\n════ F: Präsentation am Desktop ════');
const D = await geraet({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, stand(true));
const Q = D.P;
const taste = async (k, ms = 500) => { await Q.keyboard.press(k); await Q.waitForTimeout(ms); };
const dfolie = () => Q.evaluate(() => {
  const d = document.querySelector('.folie-dok'); const bl = document.querySelector('.folie-dok-seite')?.getBoundingClientRect(); const fl = document.querySelector('.folie-dok-flaeche');
  return { da: !!d, art: d?.dataset.art, seite: Number(d?.dataset.seite ?? 0), seiten: Number(d?.dataset.seiten ?? 0), zoom: Number(d?.dataset.zoom ?? 0), modus: d?.dataset.modus, blattB: bl ? Math.round(bl.width) : 0, blattH: bl ? Math.round(bl.height) : 0,
    rollTop: fl ? Math.round(fl.scrollTop) : 0, platzH: fl ? fl.clientHeight : 0, zaehler: document.querySelector('.presenter-count')?.textContent ?? '', text: document.querySelector('.presenter-slide')?.textContent?.slice(0, 80) ?? '' };
});
await taste('Alt+p', 1500);
await taste('ArrowRight', 2000);
let g = await dfolie();
pruefe('F1 die PDF ist eine Seite, kein Dateiname', g.da && g.art === 'pdf' && g.seiten === 4 && !/skript\.pdf \(/.test(g.text), g);
pruefe('F2 die ganze Seite wäre hier zu klein zum Lesen → die Folie beginnt in Seitenbreite', g.modus === 'breite' && g.blattB >= 1000 && g.blattH > g.platzH, g);
await Q.screenshot({ path: path.join(SD, 'm363-vortrag-desktop.png') });
await taste('Space', 900); g = await dfolie();
pruefe('F3 Leertaste rollt zuerst die Seite weiter (noch Seite 1)', g.seite === 1 && g.rollTop > 200, g);
let druecke = 0;
while (druecke < 8 && (await dfolie()).seite === 1) { await taste('Space', 900); druecke += 1; }
g = await dfolie();
pruefe('F4 am Seitenende blättert sie; die neue Seite beginnt oben', g.seite === 2 && g.rollTop === 0 && druecke <= 4, { ...g, druecke });
await taste('0', 700); g = await dfolie();
pruefe('F5 „0": ganze Seite — passt in die Höhe', g.modus === 'seite' && g.blattH <= g.platzH + 1 && g.zoom === 1, g);
await taste('ArrowRight'); await taste('ArrowRight'); g = await dfolie();
pruefe('F6 → blättert Seite für Seite (Seite 4)', g.seite === 4, g.seite);
await taste('ArrowRight', 900); g = await dfolie();
pruefe('F7 nach der letzten Seite kommt die nächste Folie', !g.da && /3 \/ 4/.test(g.zaehler), g);
await taste('ArrowLeft', 1500); g = await dfolie();
pruefe('F8 rückwärts landet man auf der letzten Seite des Dokuments', g.da && g.seite === 4, g);
await taste('+', 500); await taste('+', 700); g = await dfolie();
pruefe('F9 „+" vergrößert', g.zoom > 1.4, g.zoom);
pruefe('F9b die gewählte Ansicht (ganze Seite) blieb beim Zurückkommen erhalten', g.modus === 'seite', g.modus);
await taste('b', 700); g = await dfolie();
pruefe('F10 „B" wechselt die Ansicht (Seitenbreite, 100 %)', g.modus === 'breite' && g.zoom === 1, g);
await Q.locator('[data-taste="folie-seite-nr"]').click(); await Q.keyboard.press('Control+a'); await Q.keyboard.type('2'); await Q.keyboard.press('Enter'); await Q.waitForTimeout(800); g = await dfolie();
pruefe('F11 Seitenzahl eingeben springt (Seite 2)', g.seite === 2, g.seite);
await taste('0', 500);
// Klick auf „Weiter" bis ans Ende der Präsentation — danach müssen die Pfeile noch gehen
for (let i = 0; i < 12; i++) { if ((await Q.locator('[data-taste="vortrag-weiter"]').getAttribute('aria-disabled')) === 'true') break; await Q.locator('[data-taste="vortrag-weiter"]').click(); await Q.waitForTimeout(450); }
await Q.waitForTimeout(1500);
g = await dfolie();
pruefe('F12 „Weiter" führt durch alle Seiten bis zur letzten Folie: das Word-Dokument, als Seite', g.da && g.art === 'word' && /4 \/ 4/.test(g.zaehler) && g.seite === g.seiten && g.seiten === 2, g);
pruefe('F13 die Word-Seite zeigt ihren Text', /WORTMARKER-ZWEI/.test(await Q.evaluate(() => [...document.querySelectorAll('.folie-dok section.docx')].filter((s) => s.style.display !== 'none').map((s) => s.textContent).join(' '))));
await taste('ArrowLeft', 800); g = await dfolie();
pruefe('F14 nach dem (grau gewordenen) „Weiter" blättert ← weiter (Word Seite 1)', g.art === 'word' && g.seite === 1, g);
await taste('Escape', 800);
pruefe('F15 Esc beendet die Präsentation', (await Q.locator('.presenter').count()) === 0);

console.log('\n════ G: Fokus am Desktop ════');
{
  const box = await Q.locator('.react-flow__node[data-id="f1"]').boundingBox();
  await Q.mouse.click(box.x + box.width - 60, box.y + 12); await Q.waitForTimeout(250);
  await Q.locator('.react-flow__node[data-id="f1"]').evaluate((el) => el.focus());
  await taste('Enter', 1500);
  const d = await Q.evaluate(() => { const m = /scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? ''); const r = document.querySelector('.react-flow__node[data-id="f1"]').getBoundingClientRect(); return { zoom: m ? Number(m[1]) : 0, links: r.left, rechts: r.right, b: innerWidth, leiste: !!document.querySelector('.focus-nav.dokument [data-taste="fokus-marker"]') }; });
  pruefe('G1 hohe Seite am breiten Schirm: weiter in Lesegröße (Zoom 1), ganz im Bild', Math.abs(d.zoom - 1) < 0.01 && d.links >= 0 && d.rechts <= d.b, d);
  pruefe('G2 die Dokument-Leiste gibt es auch hier', d.leiste);
  await taste('Escape', 800);
}

console.log('\n════ H: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((x) => x.endsWith('.js')).map((x) => readFileSync(path.join(DIST, 'assets', x), 'utf8')).join('\n');
  pruefe('H1 „Was ist neu" nennt M363', js.includes('(M363)'));
}
await D.ctx.close();
await browser.close(); app.close();
console.log(`\nm363-telefon-dokumente: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
