/**
 * M407 — Die Rechen-Tabelle als Datentabelle: Links, Kopfzeile, Filtern und Sortieren – auch aus Excel.
 *
 * Gefragt: „Links, Daten-Tabellen, Filter-Funktionen in Excel – könnte man sowas auch irgendwie alles inline in
 * PixiNotes einbinden?"
 *
 *   A  Excel-Übernahme: Links an Zellen (Web, Mail), =HYPERLINK(…), Adressen im Text – anklickbar, in neuem Tab;
 *      Unsicheres (javascript:) wird kein Link. Der Filterbereich des Blatts kommt als Datentabelle an.
 *   B  Link bearbeiten: Stift öffnet die Zelle, das Feld „Link" ändert oder entfernt ihn; Unsicheres wird abgelehnt.
 *   C  Filtern und Sortieren als Ansicht: Werte auswählen, sortieren, „Filter aufheben" – Zeilennummern bleiben die
 *      echten, die Summenzeile bleibt unten und rechnet unverändert, Bearbeiten trifft die richtige Zelle,
 *      die Ansicht bleibt nach dem Neuladen.
 *   D  Eigene Tabelle: ⋯ → „Filtern und sortieren"; die Summenzeile wird erkannt; Kopfzeile versetzen.
 *   E  „Als Tabelle formatiert" (Excel-Tabelle mit Ergebniszeile) kommt mit Kopfzeile und Datenbereich an.
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m407-datentabelle.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4723;
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


const blattXml = (zeilen, mehr = '') => '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>' + zeilen + '</sheetData>' + mehr + '</worksheet>';
const t = (adr, text) => `<c r="${adr}" t="inlineStr"><is><t>${text}</t></is></c>`;
const n = (adr, zahl) => `<c r="${adr}"><v>${zahl}</v></c>`;
const DATEN = [['Beamer', 899, 'Kiel', 'Shop'], ['Leinwand', 101, 'Hamburg', 'Kontakt'], ['Kabel', 25, 'Kiel', ''], ['Stativ', 60, 'Bremen', 'www.beispiel.de'], ['Tasche', 40, 'Hamburg', 'unsicher'], ['Adapter', 15, 'Kiel', '']];
const zeilen = '<row r="1">' + t('A1', 'Posten') + t('B1', 'Betrag') + t('C1', 'Ort') + t('D1', 'Mehr') + '</row>'
  + DATEN.map((d, i) => `<row r="${i + 2}">${t(`A${i + 2}`, d[0])}${n(`B${i + 2}`, d[1])}${t(`C${i + 2}`, d[2])}${i === 2 ? `<c r="D4" t="str"><f>HYPERLINK("https://example.org/angebot","Angebot")</f><v>Angebot</v></c>` : d[3] ? t(`D${i + 2}`, d[3]) : ''}</row>`).join('')
  + '<row r="8">' + t('A8', 'Summe') + '<c r="B8"><f>SUM(B2:B7)</f><v>1140</v></c></row>';
const wb = (namen) => '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + namen.map((x, i) => `<sheet name="${x}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const liste = zipStore([
  ['xl/workbook.xml', wb(['Kosten'])],
  ['xl/worksheets/sheet1.xml', blattXml(zeilen, '<autoFilter ref="A1:D7"/><hyperlinks><hyperlink ref="D2" r:id="rId1"/><hyperlink ref="D3" r:id="rId2"/><hyperlink ref="D6" r:id="rId3"/><hyperlink ref="A2" location="Kosten!A8"/></hyperlinks>')],
  ['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/hyperlink" Target="https://example.org/shop?a=1&amp;b=2" TargetMode="External"/><Relationship Id="rId2" Type="${REL}/hyperlink" Target="mailto:info@example.org" TargetMode="External"/><Relationship Id="rId3" Type="${REL}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`],
]);
// „Als Tabelle formatiert": Titel in Zeile 1, Kopf in Zeile 2, drei Datenzeilen, Ergebniszeile
const tabelle = zipStore([
  ['xl/workbook.xml', wb(['Liste'])],
  ['xl/worksheets/sheet1.xml', blattXml('<row r="1">' + t('A1', 'Inventar 2026') + '</row><row r="2">' + t('A2', 'Gerät') + t('B2', 'Stück') + '</row>'
    + '<row r="3">' + t('A3', 'Laptop') + n('B3', 4) + '</row><row r="4">' + t('A4', 'Monitor') + n('B4', 9) + '</row><row r="5">' + t('A5', 'Dock') + n('B5', 2) + '</row>'
    + '<row r="6">' + t('A6', 'Ergebnis') + '<c r="B6"><f>SUBTOTAL(109,Tabelle1[Stück])</f><v>15</v></c></row>', '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>')],
  ['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table1.xml"/></Relationships>`],
  ['xl/tables/table1.xml', '<?xml version="1.0"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Tabelle1" displayName="Tabelle1" ref="A2:B6" totalsRowCount="1"><autoFilter ref="A2:B5"/><tableColumns count="2"><tableColumn id="1" name="Gerät"/><tableColumn id="2" name="Stück"/></tableColumns></table>'],
]);
const pfad = (name, inhalt) => { const p = path.join(SD, name); writeFileSync(p, inhalt); return p; };
const listePfad = pfad('m407-liste.xlsx', liste); const tabellePfad = pfad('m407-tabelle.xlsx', tabelle);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async (nodes = [], sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.route(/example\.org|beispiel\.de/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Ziel</title>ok' }));
  await ctx.addInitScript(([nn, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: nn }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [nodes, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
const daten = (P, i = 0) => P.evaluate((k) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[k]?.data ?? null, i);
const anzahl = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.length);
const einfuegen = async (P, datei) => {
  const vorher = await anzahl(P);
  const felder = P.locator('input[type="file"]');
  const c = await felder.count();
  for (let i = 0; i < c; i++) {
    try { await felder.nth(i).setInputFiles(datei); await P.waitForTimeout(1600); if ((await anzahl(P)) > vorher) break; } catch { /* nächstes Feld */ }
  }
  await P.waitForTimeout(900);
};
/** Was die Tabelle zeigt: Zeilennummern in der gezeigten Reihenfolge und der Text der ersten Spalte */
const bild = (P) => P.evaluate(() => [...document.querySelectorAll('.sheet-grid tbody tr')].map((tr) => ({ nr: Number(tr.dataset.zeile), a: tr.querySelector('td')?.textContent?.trim() ?? '', kopf: tr.classList.contains('sheet-kopfzeile') })).filter((z) => z.a !== ''));
const zelle = (P, zeile, spalte) => P.locator(`.sheet-grid tbody tr[data-zeile="${zeile}"] td`).nth(spalte);
const filterAuf = async (P, spalte) => { await P.locator(`[data-taste="sheet-filter"][data-spalte="${spalte}"]`).click(); await P.waitForSelector('[data-taste="sheet-filter-menu"]'); await P.waitForTimeout(150); };
const filterZu = async (P) => { await P.keyboard.press('Escape'); await P.waitForTimeout(200); };

// ---------- A: Excel-Übernahme ----------
console.log('A  Excel-Übernahme: Links und Filterbereich');
const V = await auf();
const P = V.P;
await einfuegen(P, listePfad);
let d = await daten(P);
pruefe('A1 die Links der Zellen kommen mit (Web, Mail) – der Sprung im Blatt und „javascript:" nicht', !!d && d.links?.D2 === 'https://example.org/shop?a=1&b=2' && d.links?.D3 === 'mailto:info@example.org' && !d.links?.D6 && !d.links?.A2, d?.links);
pruefe('A2 der Filterbereich des Blatts kommt als Datentabelle an: Kopfzeile 1, Daten bis Zeile 7, Filter an', d?.kopf === 1 && d?.bis === 7 && d?.filterAn === true, { kopf: d?.kopf, bis: d?.bis, an: d?.filterAn });
const links = await P.evaluate(() => [...document.querySelectorAll('.sheet-grid a.sheet-link')].map((a) => ({ text: a.textContent, href: a.getAttribute('href'), neu: a.target === '_blank', rel: a.rel, zeile: Number(a.closest('tr').dataset.zeile) })));
const l = (zeile) => links.find((x) => x.zeile === zeile);
pruefe('A3 D2 und D3 sind Links mit ihrem Text; sie öffnen sich in einem neuen Tab, ohne Zugriff auf diese Seite', l(2)?.text === 'Shop' && l(2)?.href === 'https://example.org/shop?a=1&b=2' && l(2)?.neu && /noopener/.test(l(2)?.rel ?? '') && l(3)?.href === 'mailto:info@example.org', links);
pruefe('A4 =HYPERLINK("…";"Angebot") zeigt „Angebot" und führt zur Adresse', l(4)?.text === 'Angebot' && l(4)?.href === 'https://example.org/angebot', l(4));
pruefe('A5 eine Adresse im Text („www.beispiel.de") wird von selbst zum Link', l(5)?.text === 'www.beispiel.de' && l(5)?.href === 'https://www.beispiel.de', l(5));
pruefe('A6 die Zelle mit dem unsicheren Ziel ist kein Link', !l(6) && links.length === 4, links.map((x) => x.zeile));
{
  const [neu] = await Promise.all([V.ctx.waitForEvent('page', { timeout: 6000 }), P.locator('.sheet-grid tr[data-zeile="2"] a.sheet-link').click()]);
  await neu.waitForURL(/example\.org/, { timeout: 6000 }).catch(() => {});
  pruefe('A7 ein Klick auf den Link öffnet ihn – die Zelle geht dabei nicht in die Bearbeitung', /example\.org\/shop/.test(neu.url()) && (await P.locator('.sheet-eingabe').count()) === 0, neu.url());
  await neu.close();
}

// ---------- B: Link bearbeiten ----------
console.log('B  Link bearbeiten');
{
  await zelle(P, 2, 3).hover(); await P.waitForTimeout(150);
  await P.locator('.sheet-grid tr[data-zeile="2"] [data-taste="sheet-link-stift"]').click(); await P.waitForTimeout(250);
  const feld = P.locator('[data-taste="sheet-link-feld"]');
  pruefe('B1 der Stift öffnet die Zelle; im Fuß steht ihr Link', (await P.locator('.sheet-eingabe').inputValue()) === 'Shop' && (await feld.inputValue()) === 'https://example.org/shop?a=1&b=2', await feld.inputValue().catch(() => ''));
  await feld.click(); await feld.fill('https://example.org/neu'); await P.keyboard.press('Enter'); await P.waitForTimeout(500);
  d = await daten(P);
  pruefe('B2 den Link ändern: übernommen, der Text der Zelle bleibt', d.links.D2 === 'https://example.org/neu' && d.cells.D2 === 'Shop' && (await P.locator('.sheet-grid tr[data-zeile="2"] a.sheet-link').getAttribute('href')) === 'https://example.org/neu', d.links);
  // einer leeren Zelle einen Link geben
  await zelle(P, 7, 3).click(); await P.waitForTimeout(200);
  await P.keyboard.type('Handbuch'); await feld.click(); await feld.fill('javascript:alert(1)'); await P.keyboard.press('Enter'); await P.waitForTimeout(600);
  d = await daten(P);
  const toast = await P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  pruefe('B3 „javascript:" als Link wird abgelehnt – der Text kommt an, der Link nicht, ein Hinweis sagt es', d.cells.D7 === 'Handbuch' && !d.links.D7 && /nur Web-, Mail- und Telefon/.test(toast) && (await P.locator('.sheet-grid tr[data-zeile="7"] a.sheet-link').count()) === 0, { toast, links: d.links });
  await zelle(P, 7, 3).click(); await P.waitForTimeout(200);
  await feld.click(); await feld.fill('www.example.org/handbuch'); await P.keyboard.press('Enter'); await P.waitForTimeout(500);
  d = await daten(P);
  pruefe('B4 eine Webadresse wird angenommen – „Handbuch" ist jetzt ein Link', d.links.D7 === 'www.example.org/handbuch' && (await P.locator('.sheet-grid tr[data-zeile="7"] a.sheet-link').getAttribute('href')) === 'https://www.example.org/handbuch', d.links);
  await P.locator('.sheet-grid tr[data-zeile="7"] td').nth(3).hover(); await P.locator('.sheet-grid tr[data-zeile="7"] [data-taste="sheet-link-stift"]').click(); await P.waitForTimeout(200);
  await feld.click(); await feld.fill(''); await P.keyboard.press('Enter'); await P.waitForTimeout(500);
  d = await daten(P);
  pruefe('B5 das Feld leeren entfernt den Link, der Text bleibt', !d.links.D7 && d.cells.D7 === 'Handbuch' && (await P.locator('.sheet-grid tr[data-zeile="7"] a.sheet-link').count()) === 0, d.links);
}

// ---------- C: filtern und sortieren ----------
console.log('C  Filtern und Sortieren – eine Ansicht');
{
  const start = await bild(P);
  pruefe('C0 die Kopfzeile trägt je Spalte einen Filterknopf; alle acht Zeilen stehen in ihrer Reihenfolge', (await P.locator('[data-taste="sheet-filter"]').count()) === 4 && start[0].kopf && start.map((z) => z.nr).join(',') === '1,2,3,4,5,6,7,8', start);
  await filterAuf(P, 'C');
  const werte = await P.evaluate(() => [...document.querySelectorAll('[data-taste="sheet-filter-wert"]')].map((w) => `${w.dataset.wert}:${w.querySelector('.sheet-filter-zahl').textContent}:${w.querySelector('input').checked ? 1 : 0}`));
  pruefe('C1 das Fenster listet die Orte mit ihrer Häufigkeit, alle gewählt', werte.join('|') === 'Bremen:1:1|Hamburg:2:1|Kiel:3:1', werte);
  await P.locator('[data-taste="sheet-filter-wert"][data-wert="Kiel"] input').click(); await P.waitForTimeout(300);
  await filterZu(P);
  let b = await bild(P);
  d = await daten(P);
  pruefe('C2 „Kiel" abgewählt: es bleiben Kopf, drei Datenzeilen und die Summe – mit ihren echten Zeilennummern', b.map((z) => z.nr).join(',') === '1,3,5,6,8' && JSON.stringify(d.filter) === '{"C":["Bremen","Hamburg"]}', b);
  const fuss = await P.locator('[data-taste="sheet-filter-stand"]').textContent();
  pruefe('C3 der Fuß sagt „3 von 6 Zeilen"; der Knopf der Spalte ist hervorgehoben', fuss === '3 von 6 Zeilen' && (await P.locator('[data-taste="sheet-filter"][data-spalte="C"]').getAttribute('class')).includes(' an'), fuss);
  const summe = await zelle(P, 8, 1).textContent();
  pruefe('C4 die Summe rechnet unverändert über alle Zeilen (1.140) – gefiltert wird nur die Ansicht', summe.trim() === '1.140', summe);
  // sortieren: Betrag absteigend
  await filterAuf(P, 'B');
  await P.locator('[data-taste="sheet-sort-ab"]').click(); await P.waitForTimeout(300);
  await filterZu(P);
  b = await bild(P);
  pruefe('C5 Betrag absteigend: Leinwand (101), Stativ (60), Tasche (40) – Kopf oben, Summe unten', b.map((z) => z.a).join(',') === 'Posten,Leinwand,Stativ,Tasche,Summe' && b.map((z) => z.nr).join(',') === '1,3,5,6,8', b);
  // bearbeiten in der sortierten Ansicht trifft die richtige Zelle
  await zelle(P, 5, 1).click(); await P.waitForTimeout(200);
  await P.keyboard.press('Control+a'); await P.keyboard.type('160'); await P.keyboard.press('Escape'); await P.waitForTimeout(100);
  await zelle(P, 5, 1).click(); await P.waitForTimeout(200);
  await P.keyboard.press('Control+a'); await P.keyboard.type('160'); await P.locator('.sheet-head').click({ position: { x: 20, y: 10 } }); await P.waitForTimeout(600);
  d = await daten(P);
  b = await bild(P);
  pruefe('C6 Stativ auf 160 gesetzt: geschrieben wird B5, die Ansicht sortiert neu (Stativ vorn), die Summe folgt (1.240)', d.cells.B5 === '160' && b.map((z) => z.a).join(',') === 'Posten,Stativ,Leinwand,Tasche,Summe' && (await zelle(P, 8, 1).textContent()).trim() === '1.240', { b5: d.cells.B5, b });
  // nach dem Neuladen steht die Ansicht noch
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  b = await bild(P);
  pruefe('C7 nach dem Neuladen steht dieselbe Ansicht', b.map((z) => z.a).join(',') === 'Posten,Stativ,Leinwand,Tasche,Summe', b);
  // Suche und „Keine/Alle" im Fenster
  await filterAuf(P, 'C');
  await P.locator('[data-taste="sheet-filter-alle"]').click(); await P.waitForTimeout(250);
  await filterZu(P);
  pruefe('C8 „Alle" hebt die Auswahl der Spalte auf – sortiert bleibt', (await bild(P)).map((z) => z.a).join(',') === 'Posten,Beamer,Stativ,Leinwand,Tasche,Kabel,Adapter,Summe', await bild(P));
  await P.locator('[data-taste="sheet-filter-weg"]').click(); await P.waitForTimeout(1100);
  d = await daten(P);
  pruefe('C9 „Filter aufheben": wieder alle Zeilen in ihrer Reihenfolge', (await bild(P)).map((z) => z.nr).join(',') === '1,2,3,4,5,6,7,8' && !d.filter && !d.sort && (await P.locator('[data-taste="sheet-filter-weg"]').count()) === 0, await bild(P));
}
await V.ctx.close();

// ---------- D: eigene Tabelle ----------
console.log('D  Eigene Tabelle: einschalten, Summenzeile, Kopfzeile versetzen');
{
  const zellen = { A1: 'Name', B1: 'Stunden', A2: 'Zoe', B2: '7', A3: 'Ali', B3: '12', A4: 'Mia', B4: '3', A5: 'Summe', B5: '=SUMME(B2:B4)', A7: 'Notiz darunter' };
  const { ctx, P: Q } = await auf([{ id: 't1', type: 'sheet', position: { x: 0, y: 0 }, width: 460, height: 340, data: { title: 'Stunden', cells: zellen, cols: 4, rows: 8 } }]);
  pruefe('D0 ohne Filter: keine Knöpfe in der Tabelle', (await Q.locator('[data-taste="sheet-filter"]').count()) === 0);
  await Q.locator('.sheet-head .kopf-mehr').first().click(); await Q.waitForTimeout(300);
  await Q.locator('[data-taste="sheet-filter-an"]').click(); await Q.waitForTimeout(400);
  let dd = await daten(Q);
  pruefe('D1 ⋯ → „Filtern und sortieren" schaltet die Datentabelle ein: Kopfzeile ist die erste Zeile', dd.filterAn === true && dd.kopf === 1 && (await Q.locator('[data-taste="sheet-filter"]').count()) === 4, dd);
  await filterAuf(Q, 'B');
  const w = await Q.evaluate(() => [...document.querySelectorAll('[data-taste="sheet-filter-wert"]')].map((x) => x.dataset.wert));
  pruefe('D2 die Summenzeile gehört nicht zu den Daten (nur 3, 7, 12 stehen zur Wahl – in Zahlenfolge)', w.join(',') === '3,7,12', w);
  await Q.locator('[data-taste="sheet-sort-auf"]').click(); await Q.waitForTimeout(300);
  await filterZu(Q);
  pruefe('D3 aufsteigend nach Stunden: Mia, Zoe, Ali – Summe und die Notiz darunter bleiben stehen', (await bild(Q)).map((z) => z.a).join(',') === 'Name,Mia,Zoe,Ali,Summe,Notiz darunter', await bild(Q));
  // eine Adresse tippen → Link
  await zelle(Q, 2, 2).click(); await Q.waitForTimeout(200);
  await Q.keyboard.type('https://example.org/zoe'); await Q.keyboard.press('Escape');
  await zelle(Q, 2, 2).click(); await Q.waitForTimeout(200);
  await Q.keyboard.type('https://example.org/zoe'); await Q.locator('.sheet-head').click({ position: { x: 20, y: 10 } }); await Q.waitForTimeout(500);
  pruefe('D4 eine getippte Webadresse ist sofort ein Link', (await Q.locator('.sheet-grid tr[data-zeile="2"] a.sheet-link').getAttribute('href')) === 'https://example.org/zoe');
  // Kopfzeile versetzen, wieder ausschalten
  await Q.locator('.sheet-head .kopf-mehr').first().click(); await Q.waitForTimeout(300);
  await Q.locator('[data-taste="sheet-kopf-runter"]').click(); await Q.waitForTimeout(300);
  await Q.keyboard.press('Escape'); await Q.mouse.click(1300, 800); await Q.waitForTimeout(1100);
  dd = await daten(Q);
  pruefe('D5 „Kopfzeile eine Zeile tiefer": Zeile 2 ist jetzt der Kopf, die Sortierung ist aufgehoben', dd.kopf === 2 && !dd.sort && (await Q.locator('.sheet-grid tr.sheet-kopfzeile').getAttribute('data-zeile')) === '2', dd);
  await Q.locator('.sheet-head .kopf-mehr').first().click(); await Q.waitForTimeout(300);
  await Q.locator('[data-taste="sheet-filter-an"]').click(); await Q.waitForTimeout(400);
  dd = await daten(Q);
  pruefe('D6 ausgeschaltet: keine Knöpfe mehr, alle Zeilen wie eingegeben', dd.filterAn === false && (await Q.locator('[data-taste="sheet-filter"]').count()) === 0 && (await bild(Q)).map((z) => z.nr).join(',') === '1,2,3,4,5,7', await bild(Q));
  await ctx.close();
}

// ---------- E: Excel-Tabelle ----------
console.log('E  „Als Tabelle formatiert"');
{
  const { ctx, P: Q } = await auf();
  await einfuegen(Q, tabellePfad);
  const dd = await daten(Q);
  pruefe('E1 Kopf in Zeile 2, Daten bis Zeile 5 (die Ergebniszeile gehört nicht dazu), Filter an', dd?.kopf === 2 && dd?.bis === 5 && dd?.filterAn === true, { kopf: dd?.kopf, bis: dd?.bis });
  await filterAuf(Q, 'B');
  await Q.locator('[data-taste="sheet-sort-ab"]').click(); await Q.waitForTimeout(300);
  await filterZu(Q);
  pruefe('E2 absteigend nach Stück: Monitor, Laptop, Dock – Titel oben, Ergebnis unten', (await bild(Q)).map((z) => z.a).join(',') === 'Inventar 2026,Gerät,Monitor,Laptop,Dock,Ergebnis', await bild(Q));
  await ctx.close();
}

// ---------- F: Texte ----------
console.log('F  Texte');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  const en = JSON.parse(lies('src/sprache/en.json'));
  pruefe('F1 englisch', en['Filtern und sortieren'] === 'Filter and sort' && en['Filter aufheben'] === 'Clear filter' && en['{0} von {1} Zeilen'] === '{0} of {1} rows', [en['Filtern und sortieren'], en['Filter aufheben'], en['{0} von {1} Zeilen']]);
  pruefe('F2 die Hilfe nennt M407 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M407)') && lies('src/components/HelpOverlayEn.tsx').includes('(M407)'));
  pruefe('F3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm407-datentabelle: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
