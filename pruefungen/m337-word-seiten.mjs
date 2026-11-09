/**
 * M337 — Word-Dokument als Dokument-Karte (wie PDF).
 *
 *   A  Import einer .docx: Datei-Karte (Dokument), keine Notiz; Meta „2 Seiten" nach dem Aufklappen.
 *   B  Aufklappen: Seite 1 sichtbar mit ihrem Text, Seite 2 verborgen; Blätterleiste „/ 2".
 *   C  Blättern: Seite 2 zeigt ihren Text, Seite 1 ist weg.
 *   D  Stift auf Seite 2: Strich geankert, seite 2, Seitenpunkte innerhalb der Seitenmaße (pt).
 *   E  Kommentar an eine Stelle der Seite 2 (Pin + Liste).
 *   F  Zuklappen: Zähler „2 Anmerkungen"; Fokus klappt auf.
 *   G  „Als Notiz übernehmen" macht aus der Word-Karte eine Notiz mit Überschrift und Text.
 *   H  „Was ist neu" nennt M337.
 */
// Läuft aus dem Repository: `node pruefungen/m337-word-seiten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4555;
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

/* ---------- Mini-ZIP (Store), wie in m276 ---------- */

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
const docxPfad = `${SD}/m337-bericht.docx`;
writeFileSync(docxPfad, docx);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes:author', 'Tester');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Word', edges: [], drawings: [], comments: [], nodes: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
      activeId: 'b1', view: 'board' } }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);
const zustand = (P) => P.evaluate(() => {
  const karte = document.querySelector('.react-flow__node-file');
  const seiteEl = karte?.querySelector('.pdf-seite');
  const r = seiteEl?.getBoundingClientRect();
  const sichtbar = [...(karte?.querySelectorAll('section.docx') ?? [])].filter((s) => s.style.display !== 'none').map((s) => s.textContent);
  return {
    datei: !!karte, notizen: document.querySelectorAll('.react-flow__node-note').length,
    offen: !!seiteEl, nr: seiteEl?.getAttribute('data-seite') ?? null, bar: karte?.querySelector('.pdf-seite-bar')?.textContent ?? '',
    meta: karte?.querySelector('.file-body .meta')?.textContent ?? '', sichtbar, abschnitte: karte?.querySelectorAll('section.docx').length ?? 0,
    seite: r ? { l: r.left, t: r.top, w: r.width, h: r.height } : null,
    pfade: document.querySelectorAll('.drawing-layer path').length, pins: document.querySelectorAll('.comment-pin.auf-seite').length,
    aufKnopf: document.querySelector('[data-taste="pdf-aufklappen"]')?.textContent ?? null, fokus: !!document.querySelector('.app.focus-mode'),
    laedt: !!karte?.querySelector('.word-laedt'),
  };
});
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, 12)); }
  start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
}, { punkte, o });
const welle = (x0, y0, n = 24, amp = 10) => Array.from({ length: n }, (_, i) => [x0 + i * 4, y0 + Math.sin(i / 1.7) * amp]);
async function warteBis(P, f, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await P.waitForTimeout(150); } return false; }

const { ctx, P } = await seite();
console.log('════ A: Import ════');
{
  const felder = P.locator('input[type="file"]');
  const n = await felder.count();
  for (let i = 0; i < n; i++) {
    try { await felder.nth(i).setInputFiles(docxPfad); await P.waitForTimeout(1500); if ((await knoten(P)).nodes.length) break; } catch { /* nächstes */ }
  }
  const b = await knoten(P);
  pruefe('A1 die .docx liegt als Datei-Karte (Dokument), nicht als Notiz', b.nodes.length === 1 && b.nodes[0].type === 'file' && /\.docx$/.test(b.nodes[0].data.name), JSON.stringify(b.nodes.map((k) => [k.type, k.data?.name])));
  const z = await zustand(P);
  pruefe('A2 zugeklappt: Aufklappen-Knopf, keine Seite offen', !!z.aufKnopf && !z.offen, JSON.stringify({ knopf: z.aufKnopf, offen: z.offen }));
}
console.log('\n════ B: aufklappen ════');
await P.locator('[data-taste="pdf-aufklappen"]').click();
pruefe('B1 das Dokument wird aufgebaut und zeigt Seite 1', await warteBis(P, async () => { const z = await zustand(P); return z.offen && !z.laedt && z.abschnitte === 2 && z.sichtbar.length === 1 && z.seite && z.seite.h > z.seite.w; }, 15000), JSON.stringify(await zustand(P)));
let z = await zustand(P);
pruefe('B2 Seite 1 zeigt ihren Text, Seite 2 ist verborgen', /WORTMARKER-EINS/.test(z.sichtbar[0] ?? '') && !/WORTMARKER-ZWEI/.test(z.sichtbar[0] ?? ''), JSON.stringify(z.sichtbar.map((t) => t.slice(0, 60))));
pruefe('B3 Blätterleiste „/ 2", Meta „2 Seiten", Seite füllt die Kartenbreite', /\/ 2/.test(z.bar) && /2 Seiten/.test(z.meta) && z.seite && z.seite.w >= 380 && z.seite.h > z.seite.w, JSON.stringify({ bar: z.bar, meta: z.meta, seite: z.seite }));
console.log('\n════ C: blättern ════');
await P.locator('[data-taste="pdf-vor"]').click(); await P.waitForTimeout(600);
z = await zustand(P);
pruefe('C1 Seite 2 zeigt den Anhang, Seite 1 ist weg', z.nr === '2' && z.sichtbar.length === 1 && /WORTMARKER-ZWEI/.test(z.sichtbar[0]) && !/WORTMARKER-EINS/.test(z.sichtbar[0]), JSON.stringify({ nr: z.nr, s: z.sichtbar.map((t) => t.slice(0, 50)) }));
console.log('\n════ D: Stift auf Seite 2 ════');
await zug(P, welle(z.seite.l + z.seite.w * 0.3, z.seite.t + z.seite.h * 0.3), { id: 41 });
await P.waitForTimeout(900);
let b = await knoten(P);
const s1 = b.drawings ?? [];
pruefe('D1 ein Strich, geankert an der Word-Karte, auf Seite 2', s1.length === 1 && s1[0].anchor === b.nodes[0].id && s1[0].seite === 2, JSON.stringify(s1.map((s) => [s.anchor, s.seite, s.points.length])));
const pts = s1[0]?.points ?? [];
pruefe('D2 Punkte sind Seitenpunkte (A4: 595 × 842 pt, nahe 30 % / 30 %)', pts.length > 3 && pts.every(([x, y]) => x >= 0 && x <= 600 && y >= 0 && y <= 850) && Math.abs(pts[0][0] / 595.3 - 0.3) < 0.03 && Math.abs(pts[0][1] / 841.9 - 0.3) < 0.04, JSON.stringify(pts.slice(0, 2)));
pruefe('D3 der Strich liegt über der Seite', (await zustand(P)).pfade === 1);
await P.locator('[data-taste="pdf-zurueck"]').click(); await P.waitForTimeout(500);
pruefe('D4 auf Seite 1 ist er unsichtbar', (await zustand(P)).pfade === 0);
await P.locator('[data-taste="pdf-vor"]').click(); await P.waitForTimeout(500);
console.log('\n════ E: Kommentar an eine Stelle ════');
z = await zustand(P);
await P.locator('[data-taste="pdf-kommentar"]').click(); await P.waitForTimeout(200);
await P.mouse.click(z.seite.l + z.seite.w * 0.6, z.seite.t + z.seite.h * 0.2); await P.waitForTimeout(400);
await P.locator('.comment-input').fill('Zahlen prüfen'); await P.keyboard.press('Enter'); await P.waitForTimeout(700);
await P.keyboard.press('Escape'); await P.waitForTimeout(200);
b = await knoten(P); z = await zustand(P);
const k = (b.comments ?? [])[0];
pruefe('E1 Kommentar auf Seite 2 an der Stelle, Pin und Listeneintrag da', k && k.seite === 2 && Math.abs(k.px / 595.3 - 0.6) < 0.04 && z.pins === 1 && (await P.locator('[data-taste="pdf-kommentar-eintrag"]').count()) === 1, JSON.stringify({ k, pins: z.pins }));
console.log('\n════ F: zuklappen & Fokus ════');
await P.locator('[data-taste="pdf-zuklappen"]').click(); await P.waitForTimeout(600);
z = await zustand(P);
pruefe('F1 zugeklappt: keine Seite, kein Strich, Knopf nennt „2 Anmerkungen"', !z.offen && z.pfade === 0 && /2 Anmerkungen/.test(z.aufKnopf ?? ''), JSON.stringify({ offen: z.offen, knopf: z.aufKnopf }));
const kopf = await P.locator('.react-flow__node-file .file-kopf').boundingBox();
await P.mouse.dblclick(kopf.x + 10, kopf.y + kopf.height / 2);
pruefe('F2 Fokus klappt die Word-Karte auf', await warteBis(P, async () => { const z2 = await zustand(P); return z2.fokus && z2.offen && !z2.laedt; }, 15000));
await P.keyboard.press('Escape'); await P.waitForTimeout(700);
pruefe('F3 Esc: zu', !(await zustand(P)).offen);
console.log('\n════ G: Als Notiz übernehmen ════');
await P.locator('.react-flow__node-file .file-kopf').click({ position: { x: 6, y: 6 } }); await P.waitForTimeout(500);
await P.evaluate(() => [...document.querySelectorAll('.sel-toolbar button')].find((x) => x.getAttribute('aria-label') === 'Mehr')?.click()); await P.waitForTimeout(400);
const knopf = await P.evaluate(() => { const x = document.querySelector('[data-taste="als-notiz"]'); x?.click(); return x?.textContent ?? null; });
await P.waitForTimeout(1500);
b = await knoten(P);
const notiz = b.nodes.find((n) => n.type === 'note');
pruefe('G1 „Als Notiz übernehmen" steht im ⋯ und macht eine Notiz mit Überschrift und Text', !!knopf && notiz && notiz.data.blocks.some((bl) => bl.type === 'heading') && JSON.stringify(notiz.data.blocks).includes('WORTMARKER-EINS') && !b.nodes.some((n) => n.type === 'file'), JSON.stringify({ knopf, typen: b.nodes.map((n) => n.type) }));
console.log('\n════ H ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('H1 „Was ist neu" nennt M337', js.includes('Word-Dokumente als Dokument-Karte (M337)'));

await ctx.close();
await browser.close();
app.close();
console.log(`\nm337-word-seiten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
