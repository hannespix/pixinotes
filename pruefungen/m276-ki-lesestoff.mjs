// Läuft aus dem Repository: `node pruefungen/m276-ki-lesestoff.mjs`
/**
 * M276 — Die KI liest Word, Excel und Textdateien; Bild-Dateikarten gehen
 * als Foto an bildfähige Modelle.
 *
 * Word/Excel werden als ECHTE Dateien gebaut (minimale, gültige ZIP-Archive
 * ohne Kompression — eigener Schreiber inkl. CRC32). Der Nachweis ist wie in
 * M269 die abgefangene Anfrage an den KI-Anbieter: Stehen die Marker drin?
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 4497;
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

/* ---------- Mini-ZIP-Schreiber (STORE, mit CRC32) ---------- */
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

/* ---------- Testdateien ---------- */
const txtPfad = `${SD}/m276-notizen.txt`;
writeFileSync(txtPfad, 'Besprechungsnotizen\nTEXTMARKER-BUDGET: 4.200 Euro freigegeben\nNaechster Termin offen');

const docx = zipStore([
  ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
  ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Protokoll der Sitzung</w:t></w:r></w:p><w:p><w:r><w:t>DOCXMARKER-BESCHLUSS: Die Pruefung findet am 12. Mai statt.</w:t></w:r></w:p></w:body></w:document>'],
]);
const docxPfad = `${SD}/m276-protokoll.docx`;
writeFileSync(docxPfad, docx);

const xlsx = zipStore([
  ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Kosten" sheetId="1"/></sheets></workbook>'],
  ['xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>Posten</t></is></c><c r="B1" t="inlineStr"><is><t>Betrag</t></is></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>XLSXMARKER-BEAMER</t></is></c><c r="B2"><v>899</v></c></row>'
    + '</sheetData></worksheet>'],
]);
const xlsxPfad = `${SD}/m276-kosten.xlsx`;
writeFileSync(xlsxPfad, xlsx);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function seite() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes: [], comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false,
      ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' } } }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  let gesendet = '';
  await P.route('https://api.openai.com/**', async (route) => {
    gesendet = route.request().postData() ?? '';
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'Zusammenfassung.' } }] }) });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P, holePrompt: () => gesendet };
}

async function dateiRein(P, pfad) {
  const felder = P.locator('input[type="file"]');
  const n = await felder.count();
  for (let i = 0; i < n; i++) {
    try {
      await felder.nth(i).setInputFiles(pfad);
      await P.waitForTimeout(1600);
      if (await P.locator('.file-card, .image-card').count()) return true;
    } catch { /* nächstes Feld */ }
  }
  return false;
}

async function zusammenfassen(P) {
  await P.locator('.file-card, .image-card').first().click({ position: { x: 6, y: 6 } });
  await P.waitForTimeout(700);
  await P.evaluate(() => {
    [...document.querySelectorAll('.sel-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click();
  });
  await P.waitForTimeout(500);
  await P.evaluate(() => {
    const m = document.querySelector('.sel-more-menu');
    [...(m?.querySelectorAll('button') ?? [])].find((b) => b.textContent.includes('KI-Aktionen'))?.click();
  });
  await P.waitForTimeout(500);
  await P.evaluate(() => {
    const m = document.querySelector('.sel-ai-menu');
    [...(m?.querySelectorAll('button') ?? [])].find((x) => x.textContent.includes('Zusammenfassen'))?.click();
  });
}

// ══ T1: Textdatei ════════════════════════════════════════════════════
console.log('════ T1: Textdatei ════');
{
  const { ctx, P, holePrompt } = await seite();
  pruefe('T1a die .txt liegt als Karte', await dateiRein(P, txtPfad));
  await zusammenfassen(P);
  for (let i = 0; i < 25 && !holePrompt(); i++) await P.waitForTimeout(400);
  pruefe('T1b der Textinhalt steht im KI-Kontext', holePrompt().includes('TEXTMARKER-BUDGET'),
    holePrompt().slice(0, 120));
  await ctx.close();
}

/**
 * Beim IMPORT wird Word zur Notiz und Excel zur Rechen-Tabelle — dort liest
 * die KI ohnehin mit. Der neue Lese-Pfad gilt für docx/xlsx als DATEI-KARTE:
 * so kommen sie über den Sync von einem anderen Gerät an (M269-Beipack).
 * Genau dieser Fall wird hier gestellt: Karte + Inhalt in der lokalen Ablage.
 */
async function dateiKarteSetzen(P, name, mime, base64) {
  await P.evaluate(async ({ name, mime, b64 }) => {
    const roh = atob(b64);
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pixinotes-sync', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(blob, 'file:sync1');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    const s = JSON.parse(localStorage.getItem('pixinotes-board'));
    s.state.boards[0].nodes = [{ id: 'sync1', type: 'file', position: { x: 60, y: 60 }, width: 240,
      data: { name, mime, size: blob.size, lokal: true } }];
    localStorage.setItem('pixinotes-board', JSON.stringify(s));
  }, { name, mime, b64: base64 });
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return (await P.locator('.file-card').count()) === 1;
}

// ══ T2: Word als Datei-Karte (Sync-Fall) ═════════════════════════════
console.log('\n════ T2: Word (.docx) als Datei-Karte ════');
{
  const { ctx, P, holePrompt } = await seite();
  pruefe('T2a die .docx liegt als Datei-Karte (wie nach einem Sync)',
    await dateiKarteSetzen(P, 'm276-protokoll.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      readFileSync(docxPfad).toString('base64')));
  await zusammenfassen(P);
  for (let i = 0; i < 25 && !holePrompt(); i++) await P.waitForTimeout(400);
  pruefe('T2b der Word-Text steht im KI-Kontext', holePrompt().includes('DOCXMARKER-BESCHLUSS'), '');
  pruefe('T2c samt Kontext drumherum (Absätze erhalten)', holePrompt().includes('Protokoll der Sitzung'));
  await ctx.close();
}

// ══ T3: Excel als Datei-Karte (Sync-Fall) ════════════════════════════
console.log('\n════ T3: Excel (.xlsx) als Datei-Karte ════');
{
  const { ctx, P, holePrompt } = await seite();
  pruefe('T3a die .xlsx liegt als Datei-Karte',
    await dateiKarteSetzen(P, 'm276-kosten.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      readFileSync(xlsxPfad).toString('base64')));
  await zusammenfassen(P);
  for (let i = 0; i < 25 && !holePrompt(); i++) await P.waitForTimeout(400);
  const prompt = holePrompt();
  pruefe('T3b die Zellen stehen im KI-Kontext', prompt.includes('XLSXMARKER-BEAMER'), '');
  pruefe('T3c samt Zahlwert in derselben Zeile', /XLSXMARKER-BEAMER[^"\\n]*899/.test(prompt),
    (prompt.match(/XLSXMARKER[^"]{0,60}/) ?? [''])[0]);
  await ctx.close();
}

// ══ T4: großes Foto als Datei-Karte → geht als BILD an die KI ════════
console.log('\n════ T4: Bild-Dateikarte ════');
{
  const { ctx, P, holePrompt } = await seite();
  // Ein Rausch-PNG > 1,5 MB erzeugen — im Browser, damit es ein ECHTES PNG ist
  const pngB64 = await P.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1600;
    const g = c.getContext('2d');
    const img = g.createImageData(1600, 1600);
    for (let i = 0; i < img.data.length; i++) img.data[i] = Math.floor(Math.random() * 256);
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  });
  const pngPfad = `${SD}/m276-foto.png`;
  writeFileSync(pngPfad, Buffer.from(pngB64, 'base64'));
  const gross = readFileSync(pngPfad).length;
  console.log(`    PNG: ${Math.round(gross / 1024)} KB`);
  pruefe('T4a das Test-PNG liegt über der Einbett-Grenze', gross > 1_500_000, `${gross} Bytes`);
  pruefe('T4b das große Foto liegt als Karte auf dem Board', await dateiRein(P, pngPfad),
    `file: ${await P.locator('.file-card').count()} · image: ${await P.locator('.image-card').count()}`);
  await zusammenfassen(P);
  for (let i = 0; i < 30 && !holePrompt(); i++) await P.waitForTimeout(400);
  const prompt = holePrompt();
  pruefe('T4c die Anfrage trägt ein BILD (image_url)', prompt.includes('image_url'), prompt.slice(0, 100));
  pruefe('T4d als JPEG-Daten (durch die Verkleinerung gelaufen)', prompt.includes('data:image/jpeg'));
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
