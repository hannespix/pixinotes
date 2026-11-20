/**
 * M406 — Eine eingefügte Excel-Datei bleibt bei der Rechen-Tabelle und lässt sich wieder herunterladen.
 *
 * Gemeldet: „Eingefügte Excel-Dateien werden inline nur als direkte Tabelle angezeigt. Ich will aber auch die
 * Möglichkeit haben, die Original-Excel-Datei wieder herunterladen zu können."
 *
 * Ursache: Beim Einfügen wurde die Datei in eine Rechen-Tabelle umgewandelt und danach verworfen.
 *
 *   A  Einfügen: Die Tabelle entsteht wie bisher (Werte und Formeln); die Karte trägt jetzt die Datei – im Board
 *      (klein genug) und in der Geräte-Ablage.
 *   B  „Original" an der Quellenzeile und „Excel-Datei herunterladen" im ⋯ laden genau die eingefügte Datei
 *      herunter – Byte für Byte, unter ihrem Namen; auch nachdem die Tabelle bearbeitet wurde.
 *   C  Mehrere Blätter: Jede Karte trägt das Original; eine Kopie der Karte ebenfalls; nach dem Neuladen liegt es
 *      noch da (das Aufräumen der Geräte-Ablage lässt es liegen).
 *   D  Große Datei: nicht im Board, aber in der Geräte-Ablage – der Download geht trotzdem.
 *   E  Eine Tabelle ohne Excel-Herkunft zeigt keinen solchen Knopf; das Original reist als Anhang mit (Sync, Teilen).
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m406-excel-original.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4722;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

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


const blattXml = (zeilen) => '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + zeilen + '</sheetData></worksheet>';
const kosten = blattXml('<row r="1"><c r="A1" t="inlineStr"><is><t>Posten</t></is></c><c r="B1" t="inlineStr"><is><t>Betrag</t></is></c></row>'
  + '<row r="2"><c r="A2" t="inlineStr"><is><t>Beamer</t></is></c><c r="B2"><v>899</v></c></row>'
  + '<row r="3"><c r="A3" t="inlineStr"><is><t>Leinwand</t></is></c><c r="B3"><v>101</v></c></row>'
  + '<row r="4"><c r="A4" t="inlineStr"><is><t>Summe</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>1000</v></c></row>');
const wb = (namen) => '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + namen.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>';
const rels = (n) => '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>';
const eins = zipStore([['xl/workbook.xml', wb(['Kosten'])], ['xl/_rels/workbook.xml.rels', rels(1)], ['xl/worksheets/sheet1.xml', kosten]]);
const zwei = zipStore([['xl/workbook.xml', wb(['Kosten', 'Plan'])], ['xl/_rels/workbook.xml.rels', rels(2)], ['xl/worksheets/sheet1.xml', kosten],
  ['xl/worksheets/sheet2.xml', blattXml('<row r="1"><c r="A1" t="inlineStr"><is><t>Schritt</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Bestellen</t></is></c></row>')]]);
// groß: ein unbenutzter Eintrag von 2 MB macht die Datei zu schwer für das Board
const gross = zipStore([['xl/workbook.xml', wb(['Kosten'])], ['xl/_rels/workbook.xml.rels', rels(1)], ['xl/worksheets/sheet1.xml', kosten], ['xl/media/fuellung.bin', Buffer.alloc(2_000_000, 7)]]);
const pfad = (name, inhalt) => { const p = path.join(SD, name); writeFileSync(p, inhalt); return p; };
const einsPfad = pfad('m406-kosten.xlsx', eins); const zweiPfad = pfad('m406-mappe.xlsx', zwei); const grossPfad = pfad('m406-gross.xlsx', gross);
const sha = (b) => createHash('sha256').update(b).digest('hex');

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async (nodes = [], sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(([n, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [nodes, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
const karten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.map((n) => ({ id: n.id, type: n.type, title: n.data.title, datei: n.data.datei, size: n.data.size, lokal: n.data.lokal, mime: n.data.mime, imBoard: typeof n.data.dataUrl === 'string' ? n.data.dataUrl.length : 0, b4: n.data.cells?.B4, quelle: n.data.quelle })));
const einfuegen = async (P, datei) => {
  const vorher = (await karten(P)).length;
  const felder = P.locator('input[type="file"]');
  const n = await felder.count();
  for (let i = 0; i < n; i++) {
    try { await felder.nth(i).setInputFiles(datei); await P.waitForTimeout(1600); if ((await karten(P)).length > vorher) break; } catch { /* nächstes Feld */ }
  }
  await P.waitForTimeout(900);
};
const DB = 'pixinotes-sync';
const inAblage = (P, id) => P.evaluate(([db, kid]) => new Promise((fertig) => {
  const q = indexedDB.open(db);
  q.onerror = () => fertig(-1);
  q.onupgradeneeded = () => { try { q.transaction.abort(); } catch { /* egal */ } };
  q.onsuccess = () => { try { const t = q.result.transaction('kv', 'readonly').objectStore('kv').get(`file:${kid}`); t.onsuccess = () => { fertig(t.result ? (t.result.size ?? t.result.byteLength ?? 1) : 0); q.result.close(); }; t.onerror = () => fertig(-1); } catch { fertig(-2); } };
  setTimeout(() => fertig(-3), 4000);
}), [DB, id]);
const laden = async (P, klick) => { const [d] = await Promise.all([P.waitForEvent('download', { timeout: 8000 }), klick()]); const p = await d.path(); return { name: d.suggestedFilename(), inhalt: readFileSync(p) }; };

// ---------- A: einfügen ----------
console.log('A  Einfügen: die Tabelle wie bisher, die Datei bleibt dabei');
const V = await auf();
const P = V.P;
await einfuegen(P, einsPfad);
let ks = await karten(P);
pruefe('A1 aus der .xlsx wird eine Rechen-Tabelle mit Werten und Formel', ks.length === 1 && ks[0].type === 'sheet' && /SUM/i.test(ks[0].b4 ?? '') && ks[0].quelle === 'm406-kosten.xlsx', ks);
pruefe('A2 die Karte trägt die Datei: Name, Größe, im Board (klein genug)', ks[0].datei === 'm406-kosten.xlsx' && ks[0].size === eins.length && ks[0].imBoard > 100 && ks[0].lokal === true, ks);
pruefe('A3 … und sie liegt in der Geräte-Ablage unter der Kennung der Karte', (await inAblage(P, ks[0].id)) === eins.length, await inAblage(P, ks[0].id));

// ---------- B: herunterladen ----------
console.log('B  Das Original herunterladen');
{
  const knopf = P.locator('[data-taste="sheet-original"]');
  pruefe('B1 an der Quellenzeile steht der Knopf „Original"', (await knopf.count()) === 1 && /Original/.test(await knopf.textContent()) && (await knopf.getAttribute('aria-label')) === 'Excel-Datei herunterladen', await knopf.count());
  const d = await laden(P, () => knopf.click());
  pruefe('B2 er lädt die eingefügte Datei herunter – unter ihrem Namen, Byte für Byte', d.name === 'm406-kosten.xlsx' && d.inhalt.length === eins.length && sha(d.inhalt) === sha(eins), { name: d.name, groesse: d.inhalt.length, soll: eins.length });
  // die Tabelle bearbeiten: das Original bleibt, wie es war
  await P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')); return s.state.boards[0].nodes[0].id; });
  const zelle = P.locator('.sheet-grid td').filter({ hasText: '899' }).first();
  await zelle.dblclick(); await P.waitForTimeout(250);
  await P.keyboard.press('Control+a'); await P.keyboard.type('1899'); await P.keyboard.press('Enter'); await P.waitForTimeout(900);
  const nach = await karten(P);
  const summe = await P.evaluate(() => [...document.querySelectorAll('.sheet-grid td')].map((t) => t.textContent.trim()).filter((t) => /2[.\u00a0 ]?000/.test(t)).length);
  pruefe('B3 die Tabelle rechnet weiter (Summe jetzt 2.000)', summe >= 1, { summe, zellen: await P.evaluate(() => [...document.querySelectorAll('.sheet-grid td')].map((t) => t.textContent.trim()).filter(Boolean).slice(0, 12)) });
  // über das Menü
  await P.locator('.sheet-head .kopf-mehr').first().click(); await P.waitForTimeout(300);
  const eintrag = P.locator('[data-taste="sheet-original-menu"]');
  pruefe('B4 im ⋯ der Tabelle steht „Excel-Datei herunterladen"', (await eintrag.count()) === 1 && /Excel-Datei herunterladen/.test(await eintrag.textContent()), await eintrag.count());
  const d2 = await laden(P, () => eintrag.click());
  pruefe('B5 auch nach dem Bearbeiten ist es das unveränderte Original', d2.name === 'm406-kosten.xlsx' && sha(d2.inhalt) === sha(eins) && nach[0].datei === 'm406-kosten.xlsx', { name: d2.name, groesse: d2.inhalt.length });
}
await V.ctx.close();

// ---------- C: mehrere Blätter, Kopie, Neuladen ----------
console.log('C  Mehrere Blätter, Kopie, Neuladen');
{
  const { ctx, P: Q } = await auf();
  await einfuegen(Q, zweiPfad);
  let k = await karten(Q);
  pruefe('C1 zwei Blätter → zwei Tabellen, jede trägt das Original', k.length === 2 && k.every((x) => x.type === 'sheet' && x.datei === 'm406-mappe.xlsx' && x.size === zwei.length && x.imBoard > 100), k);
  pruefe('C2 beide liegen in der Geräte-Ablage', (await inAblage(Q, k[0].id)) === zwei.length && (await inAblage(Q, k[1].id)) === zwei.length, [await inAblage(Q, k[0].id), await inAblage(Q, k[1].id)]);
  const d = await laden(Q, () => Q.locator('[data-taste="sheet-original"]').nth(1).click());
  pruefe('C3 der Download vom zweiten Blatt ist die ganze Mappe', d.name === 'm406-mappe.xlsx' && sha(d.inhalt) === sha(zwei), d.name);
  // die erste Karte kopieren (Auswahl → Duplizieren)
  await Q.evaluate(() => 0);
  const erste = k[0].id;
  await Q.locator(`.react-flow__node[data-id="${erste}"] .sheet-head`).click({ position: { x: 14, y: 10 } }); await Q.waitForTimeout(300);
  await Q.keyboard.press('Control+d'); await Q.waitForTimeout(1200);
  k = await karten(Q);
  const kopie = k.find((x) => !['', erste].includes(x.id) && x.title === k.find((y) => y.id === erste).title && x.id !== erste);
  pruefe('C4 die Kopie einer Tabelle trägt das Original ebenfalls', k.length === 3 && !!kopie && kopie.datei === 'm406-mappe.xlsx' && kopie.imBoard > 100, k.map((x) => [x.id, x.title, x.datei]));
  pruefe('C5 … auch in der Geräte-Ablage (unter der neuen Kennung)', !!kopie && (await inAblage(Q, kopie.id)) === zwei.length, kopie && await inAblage(Q, kopie.id));
  // Neuladen, das Aufräumen der Ablage abwarten (läuft 8 s nach dem Start)
  await Q.reload({ waitUntil: 'networkidle' }); await Q.waitForTimeout(10500);
  pruefe('C6 nach dem Neuladen und dem Aufräumen liegt das Original noch in der Geräte-Ablage', (await inAblage(Q, k[0].id)) === zwei.length && (await inAblage(Q, k[1].id)) === zwei.length, [await inAblage(Q, k[0].id), await inAblage(Q, k[1].id)]);
  await ctx.close();
}

// ---------- D: große Datei ----------
console.log('D  Große Datei: nicht im Board, aber herunterladbar');
{
  const { ctx, P: Q } = await auf();
  await einfuegen(Q, grossPfad);
  const k = await karten(Q);
  pruefe('D1 die große Datei (2 MB) steht nicht im Board, aber die Karte kennt sie', k.length === 1 && k[0].datei === 'm406-gross.xlsx' && k[0].imBoard === 0 && k[0].lokal === true && k[0].size === gross.length, k);
  pruefe('D2 sie liegt in der Geräte-Ablage', (await inAblage(Q, k[0].id)) === gross.length, await inAblage(Q, k[0].id));
  const d = await laden(Q, () => Q.locator('[data-taste="sheet-original"]').click());
  pruefe('D3 der Download kommt aus der Geräte-Ablage – Byte für Byte', d.name === 'm406-gross.xlsx' && d.inhalt.length === gross.length && sha(d.inhalt) === sha(gross), { name: d.name, groesse: d.inhalt.length });
  // liegt sie weder im Board noch auf dem Gerät, sagt die Karte es – statt nichts zu tun
  await Q.evaluate(([db, id]) => new Promise((f) => { const q = indexedDB.open(db); q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); t.objectStore('kv').delete(`file:${id}`); t.oncomplete = () => { q.result.close(); f(0); }; }; setTimeout(() => f(-1), 4000); }), [DB, k[0].id]);
  await Q.locator('[data-taste="sheet-original"]').click(); await Q.waitForTimeout(900);
  const meldung = await Q.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  pruefe('D4 fehlt die Datei auf diesem Gerät, sagt es ein Hinweis', /liegt nicht auf diesem Gerät/.test(meldung), meldung);
  await ctx.close();
}

// ---------- E: ohne Herkunft, Anhang ----------
console.log('E  Ohne Excel-Herkunft kein Knopf; das Original reist als Anhang');
{
  const { ctx, P: Q } = await auf([{ id: 't1', type: 'sheet', position: { x: 0, y: 0 }, width: 460, height: 300, data: { title: 'Eigene Tabelle', cells: { A1: '1', A2: '=A1+1' }, cols: 4, rows: 6 } },
    { id: 't2', type: 'sheet', position: { x: 520, y: 0 }, width: 460, height: 300, data: { title: 'Von früher', cells: { A1: '5' }, cols: 4, rows: 6, quelle: 'alt.xlsx' } }]);
  pruefe('E1 eine selbst angelegte Tabelle und eine früher eingefügte (ohne Original) zeigen keinen Knopf', (await Q.locator('[data-taste="sheet-original"]').count()) === 0 && (await Q.locator('.sheet-quelle').count()) === 1);
  await ctx.close();
  const quelle = readFileSync(path.join(__repo, 'src/lib/syncFolder.ts'), 'utf-8');
  pruefe('E2 Rechen-Tabellen mit Original zählen zu den Karten mit Anhang (Sync, Teilen-Link, Sicherung)', /n\.type === 'sheet'[\s\S]{0,200}d\.datei\) return \{ id: n\.id, name: d\.datei/.test(quelle));
}

// ---------- F: Texte ----------
console.log('F  Texte');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  const en = JSON.parse(lies('src/sprache/en.json'));
  pruefe('F1 englisch', en['Excel-Datei herunterladen'] === 'Download Excel file' && typeof en['Die eingefügte Excel-Datei herunterladen – unverändert'] === 'string', [en['Excel-Datei herunterladen']]);
  pruefe('F2 die Hilfe nennt M406 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M406)') && lies('src/components/HelpOverlayEn.tsx').includes('(M406)'));
  pruefe('F3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm406-excel-original: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
