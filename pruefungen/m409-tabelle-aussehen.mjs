/**
 * M409 — Das Tabellen-Modul: Kopfzeilen, Rollen, Fokus – und das Aussehen aus Excel.
 *
 * Gefragt: „Tabellen-Modul noch besser machen! Filterleiste schwebt komisch überlappend über Content beim Scrollen.
 * Scrollen des Überlaufs funktioniert trotz Modulfokus nicht wie gewohnt. HTML-Hyperlinks werden als numerische
 * Inhalte angezeigt. Formatierung von Text, Zellenformate, Hintergrundfarben, Linien und Tabellenumrandungen
 * werden überhaupt nicht angezeigt."
 *
 *   A  Aussehen aus Excel: Schrift (fett, kursiv, unterstrichen, durchgestrichen, Farbe), Füllfarben, Linien,
 *      Ausrichtung, Umbruch, verbundene Zellen, Spaltenbreiten; Zahlen- und Datumsformate (€, %, Tausender,
 *      Datum hiesig, negative in Rot, Einheiten).
 *   B  Texte und Links stehen in der richtigen Zelle – auch wenn die Textliste der Datei leere Einträge hat;
 *      eine Formel, die hier nicht rechnet, zeigt den Wert, den Excel gemerkt hat.
 *   C  Kopfzeilen beim Rollen: deckend, in fester Reihenfolge übereinander, nichts scheint durch.
 *   D  Rad: unausgewählt gehört es dem Board, ausgewählt rollt es die Tabelle (mit Umschalt seitwärts);
 *      Spalten behalten eine lesbare Breite.
 *   E  Fokus: Die Tabelle passt neben die Navigation, nutzt die Höhe, das Rad rollt sie; Esc stellt alles zurück.
 *   F  Dunkle Darstellung und Telefon; keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m409-tabelle-aussehen.mjs`
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
const MUSTER = path.join(__repo, 'pruefungen', 'daten', 'm409-muster.xlsx');   // erzeugt von daten/m409-muster.py (openpyxl)
const PORT = 4725;
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



/* ---------- Eine Datei, wie Excel sie schreibt: Texte in einer gemeinsamen Liste – mit leerem Eintrag ---------- */
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const s = (adr, i) => `<c r="${adr}" t="s"><v>${i}</v></c>`;
const geteilt = zipStore([
  ['xl/workbook.xml', `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Quellen" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  // Eintrag 1 ist leer (<si/>), Eintrag 3 hat Lautschrift (<rPh>), Eintrag 4 ist formatierter Text aus zwei Läufen
  ['xl/sharedStrings.xml', `<?xml version="1.0"?><sst ${NS} count="6" uniqueCount="6"><si><t>Name</t></si><si/><si><t>Adresse</t></si><si><t>Tokio</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si><si><r><t>Pixi</t></r><r><rPr><b/></rPr><t>Notes</t></r></si><si><t>https://example.org/seite</t></si></sst>`],
  ['xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet ${NS}><sheetData>`
    + `<row r="1">${s('A1', 0)}${s('B1', 2)}${s('C1', 1)}</row>`
    + `<row r="2">${s('A2', 4)}${s('B2', 5)}</row>`
    + `<row r="3">${s('A3', 3)}${s('B3', 5)}</row>`
    + `<row r="4"><c r="A4"><f>NICHTDA(1)</f><v>42</v></c><c r="B4" t="str"><f>XLOOKUP("x",A1:A3,B1:B3)</f><v>gemerkt</v></c><c r="C4"><f>1+2</f><v>3</v></c></row>`
    + `</sheetData><hyperlinks><hyperlink ref="B3" r:id="rId1"/></hyperlinks></worksheet>`],
  ['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/hyperlink" Target="https://example.org/tokio" TargetMode="External"/></Relationships>`],
]);
const geteiltPfad = path.join(SD, 'm409-geteilt.xlsx'); writeFileSync(geteiltPfad, geteilt);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async (nodes = [], wahl = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: wahl.viewport ?? { width: 1440, height: 900 }, colorScheme: wahl.dunkel ? 'dark' : 'light', hasTouch: !!wahl.touch, isMobile: !!wahl.touch });
  await ctx.route(/example\.org/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Ziel</title>ok' }));
  await ctx.addInitScript(([nn, nav]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: nn }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: nav, clickZoom: false, physicsEnabled: false } }));
  }, [nodes, !!wahl.nav]);
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
  await P.waitForTimeout(1100);
};
/** Text und berechnetes Aussehen einer Zelle */
const zelle = (P, adr) => P.evaluate((a) => {
  const td = document.querySelector(`.sheet-grid td[data-zelle="${a}"]`); if (!td) return null;
  const sp = td.querySelector('span, a') ?? td; const c = getComputedStyle(td); const cs = getComputedStyle(sp);
  return { text: td.textContent.trim(), bg: c.backgroundColor, farbe: cs.color, fett: Number(cs.fontWeight) >= 600, kursiv: cs.fontStyle === 'italic', linie: cs.textDecorationLine,
    aus: c.textAlign, unten: `${c.borderBottomWidth} ${c.borderBottomStyle} ${c.borderBottomColor}`, rechts: `${c.borderRightWidth} ${c.borderRightStyle}`, schatten: c.boxShadow,
    spanne: td.colSpan, breit: Math.round(td.getBoundingClientRect().width), hoch: Math.round(td.getBoundingClientRect().height), umbruch: cs.whiteSpace, link: td.querySelector('a')?.getAttribute('href') ?? null };
}, adr);
const lage = (P) => P.evaluate(() => {
  const r = document.querySelector('.sheet-scroll'); const vp = document.querySelector('.react-flow__viewport'); const k = document.querySelector('.react-flow__node'); const b = k.getBoundingClientRect(); const fl = document.querySelector('.react-flow').getBoundingClientRect();
  return { oben: r.scrollTop, links: r.scrollLeft, sh: r.scrollHeight, ch: r.clientHeight, sw: r.scrollWidth, cw: r.clientWidth, vp: vp.style.transform, fokus: k.classList.contains('pn-focused'),
    karte: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], flaeche: [Math.round(fl.left), Math.round(fl.top), Math.round(fl.right), Math.round(fl.bottom)] };
});

// ---------- A: Aussehen aus Excel ----------
console.log('A  Aussehen aus Excel');
{
  const { ctx, P } = await auf();
  await einfuegen(P, MUSTER);
  const d = await daten(P);
  pruefe('A1 die Datei kommt als Rechen-Tabelle an – mit Stilen, Spaltenbreiten und der verbundenen Zelle', !!d && Array.isArray(d.stilListe) && d.stilListe.length > 5 && Object.keys(d.stile ?? {}).length > 20 && d.colW?.A > 90 && d.colW?.F > 180 && (d.verbunden ?? []).includes('A8:C8'), { stile: d?.stilListe?.length, colW: d?.colW, verbunden: d?.verbunden });
  const a1 = await zelle(P, 'A1');
  pruefe('A2 Kopfzeile: dunkelblau gefüllt, weiße fette Schrift, mittig', a1?.bg === 'rgb(31, 78, 121)' && a1.farbe === 'rgb(255, 255, 255)' && a1.fett && a1.aus === 'center', a1);
  const a3 = await zelle(P, 'A3'); const a4 = await zelle(P, 'A4');
  pruefe('A3 Füllfarben je Zelle (gelb, grün); die Schrift darauf bleibt dunkel', a3?.bg === 'rgb(255, 242, 204)' && a4?.bg === 'rgb(226, 239, 218)' && a3.farbe === 'rgb(27, 30, 36)', { a3, a4 });
  const f2 = await zelle(P, 'F2'); const f3 = await zelle(P, 'F3'); const f4 = await zelle(P, 'F4'); const a2 = await zelle(P, 'A2');
  pruefe('A4 Schrift: fett, kursiv und rot, unterstrichen, durchgestrichen', a2?.fett && f3?.kursiv && f3.farbe === 'rgb(192, 0, 0)' && /underline/.test(f4?.linie ?? '') && /line-through/.test(f2?.linie ?? ''), { a2: a2?.fett, f3, f4: f4?.linie, f2: f2?.linie });
  const b3 = await zelle(P, 'B3'); const b5 = await zelle(P, 'B5'); const b6 = await zelle(P, 'B6');
  pruefe('A5 Linien: schwarzer Rahmen um die Datenzellen, doppelte Linie über der Summe', /^1px solid rgb\(0, 0, 0\)/.test(b3?.unten ?? '') && /^1px solid/.test(b3.rechts) && /double/.test(b5?.unten ?? ''), { b3: b3?.unten, b5: b5?.unten });
  const b2 = await zelle(P, 'B2'); const c2 = await zelle(P, 'C2'); const d2 = await zelle(P, 'D2'); const b5t = b5?.text;
  pruefe('A6 Zahlenformate: Euro mit zwei Stellen, Tausenderpunkte, Prozent, Datum hiesig', b2?.text === '899,50 €' && b5t === '1.234.567,89 €' && c2?.text === '78,9%' && d2?.text === '12.05.2026' && b2.aus === 'right', { b2: b2?.text, b5: b5t, c2: c2?.text, d2: d2?.text });
  pruefe('A7 die Summe rechnet weiter und trägt ihr Format', b6?.text === '1.235.593,39 €' && b6.fett, b6);
  const a9 = await zelle(P, 'A9'); const b9 = await zelle(P, 'B9'); const c9 = await zelle(P, 'C9'); const d9 = await zelle(P, 'D9'); const e9 = await zelle(P, 'E9'); const f9 = await zelle(P, 'F9');
  pruefe('A8 weitere Formate: 50%, 1.235, 3,000, Datum mit Uhrzeit, negativ in Rot, Einheit', a9?.text === '50%' && b9?.text === '1.235' && c9?.text === '3,000' && d9?.text === '12.05.2026 14:30' && e9?.text === '-42,50' && e9.farbe === 'rgb(192, 57, 43)' && f9?.text === '12 Stück', { a9: a9?.text, b9: b9?.text, c9: c9?.text, d9: d9?.text, e9, f9: f9?.text });
  const a8 = await zelle(P, 'A8');
  pruefe('A9 verbundene Zelle: eine Zelle über drei Spalten, mittig, gefüllt', a8?.spanne === 3 && a8.aus === 'center' && a8.bg === 'rgb(221, 235, 247)' && (await P.locator('.sheet-grid td[data-zelle="B8"]').count()) === 0, a8);
  const f5 = await zelle(P, 'F5');
  pruefe('A10 Umbruch: langer Text bricht in der Zelle um, die Zeile wird höher', f5?.umbruch === 'normal' && f5.hoch > 34, f5);
  const e2 = await zelle(P, 'E2'); const e4 = await zelle(P, 'E4'); const e5 = await zelle(P, 'E5');
  pruefe('A11 Links bleiben Links (Web, Formel, Mail) – als Text, nicht als Zahl', e2?.link === 'https://example.org/beamer' && e4?.text === 'Kabel ansehen' && e4.link === 'https://example.org/kabel' && e5?.link === 'mailto:info@example.org' && e5.text === 'Mail', { e2, e4, e5 });
  const breiten = await P.evaluate(() => ['A1', 'B1', 'F1'].map((a) => Math.round(document.querySelector(`.sheet-grid td[data-zelle="${a}"]`).getBoundingClientRect().width)));
  pruefe('A12 Spaltenbreiten aus der Datei: F ist deutlich breiter als B', breiten[2] > breiten[1] + 80 && breiten[0] > breiten[1], breiten);
  pruefe('A13 der Filterbereich des Blatts kommt weiter als Datentabelle an', d?.filterAn === true && d?.kopf === 1 && (await P.locator('[data-taste="sheet-filter"]').count()) === 6, { an: d?.filterAn, kopf: d?.kopf });
  // Bearbeiten ändert das Aussehen nicht
  await P.locator('.sheet-grid td[data-zelle="B3"]').click(); await P.waitForTimeout(200);
  await P.keyboard.press('Control+a'); await P.keyboard.type('250'); await P.keyboard.press('Enter'); await P.waitForTimeout(400);
  const b3n = await zelle(P, 'B3');
  pruefe('A14 neuer Wert in formatierter Zelle: Format und Rahmen bleiben', b3n?.text === '250,00 €' && /^1px solid rgb\(0, 0, 0\)/.test(b3n.unten), b3n);
  await P.screenshot({ path: path.join(SD, 'm409-aussehen.png') });
  await ctx.close();
}

// ---------- B: Texte in der richtigen Zelle ----------
console.log('B  Gemeinsame Textliste mit leerem Eintrag; gemerkte Formelwerte');
{
  const { ctx, P } = await auf();
  await einfuegen(P, geteiltPfad);
  const d = await daten(P);
  pruefe('B1 nach einem leeren Listeneintrag verrutscht nichts: „Adresse" steht in B1, C1 ist leer', d?.cells?.A1 === 'Name' && d.cells.B1 === 'Adresse' && !d.cells.C1, d?.cells);
  pruefe('B2 die Adresse steht als Text in der Zelle – nicht ihre Nummer aus der Liste', d?.cells?.B2 === 'https://example.org/seite' && (await zelle(P, 'B2'))?.link === 'https://example.org/seite', d?.cells?.B2);
  pruefe('B3 Lautschrift gehört nicht zum Text; formatierter Text wird zusammengesetzt', d?.cells?.A3 === 'Tokio' && d.cells.A2 === 'PixiNotes', { a3: d?.cells?.A3, a2: d?.cells?.A2 });
  pruefe('B4 Link an der Zelle (über die Blatt-Beziehung) zeigt auf das Ziel', (await zelle(P, 'B3'))?.link === 'https://example.org/tokio', await zelle(P, 'B3'));
  const a4 = await zelle(P, 'A4'); const b4 = await zelle(P, 'B4'); const c4 = await zelle(P, 'C4');
  pruefe('B5 unbekannte Funktion: Es steht der Wert, den Excel gemerkt hat – kein Fehlertext', a4?.text === '42' && b4?.text === 'gemerkt', { a4: a4?.text, b4: b4?.text });
  pruefe('B6 eine Formel, die hier rechnet, bleibt Formel', d?.cells?.C4 === '=1+2' && c4?.text === '3', { roh: d?.cells?.C4, c4: c4?.text });
  await ctx.close();
}

/* Eine lange Datentabelle: 40 Zeilen, 8 Spalten, farbige Kopfzeile */
const lang = () => {
  const cells = { A1: 'Artikel', B1: 'Gruppe', C1: 'Preis', D1: 'Link', E1: 'Bemerkung', F1: 'Lager', G1: 'Ort', H1: 'Stand' };
  for (let z = 2; z <= 41; z++) { cells[`A${z}`] = `Artikel ${z - 1}`; cells[`B${z}`] = ['Holz', 'Metall', 'Glas'][z % 3]; cells[`C${z}`] = String(z * 3.5).replace('.', ','); cells[`D${z}`] = `https://example.org/${z}`; cells[`E${z}`] = 'eine längere Bemerkung zum Artikel'; cells[`F${z}`] = String(z * 2); cells[`G${z}`] = `Halle ${z % 4}`; cells[`H${z}`] = '12.05.2026'; }
  return [{ id: 't1', type: 'sheet', position: { x: 0, y: 0 }, width: 520, height: 360, data: { title: 'Lager', cells, cols: 8, rows: 41, filterAn: true, kopf: 1, stilListe: [{ f: 1, bg: '#1f4e78', fa: '#ffffff' }, { bg: '#fff2cc' }], stile: { A1: 0, B1: 0, C1: 0, D1: 0, E1: 0, F1: 0, G1: 0, H1: 0, C20: 1, C21: 1 } } }];
};
/** Was liegt an einem Punkt der Tabelle obenauf – und ist es deckend? */
const obenauf = (P) => P.evaluate(() => {
  const rEl = document.querySelector('.sheet-scroll'); const r = rEl.getBoundingClientRect();
  // M413: Im Fokus ist die Karte gezoomt – Maße aus dem Layout mit dem Maßstab auf den Schirm umrechnen
  const m = r.width / rEl.offsetWidth;
  const deckt = (el) => { const c = getComputedStyle(el); const m = /rgba?\(([^)]+)\)/.exec(c.backgroundColor); const t = m ? m[1].split(',').map((x) => parseFloat(x)) : [0, 0, 0, 0]; return (t.length < 4 || t[3] >= 0.999); };
  const an = (x, y) => { const el = document.elementFromPoint(x, y)?.closest('th, td'); if (!el) return null; const tr = el.closest('tr'); return { art: el.tagName + (tr.parentElement.tagName === 'THEAD' ? ':buchstabe' : tr.classList.contains('sheet-kopfzeile') ? ':kopf' : ':daten'), text: el.textContent.trim().slice(0, 12), deckt: deckt(el) }; };
  const kopfH = document.querySelector('.sheet-grid thead').offsetHeight * m; const zeileH = document.querySelector('.sheet-kopfzeile').offsetHeight * m;
  return { buchstabe: an(r.left + 200 * m, r.top + kopfH / 2), kopf: an(r.left + 200 * m, r.top + kopfH + zeileH / 2), ecke: an(r.left + 10 * m, r.top + kopfH / 2), kopfNr: an(r.left + 10 * m, r.top + kopfH + zeileH / 2), nr: an(r.left + 10 * m, r.top + kopfH + zeileH + 40 * m), daten: an(r.left + 200 * m, r.top + kopfH + zeileH + 40 * m),
    kopfUnten: Math.round(document.querySelector('.sheet-kopfzeile td').getBoundingClientRect().bottom - r.top), soll: Math.round(kopfH + zeileH) };
});

// ---------- C + D: Kopfzeilen beim Rollen; Rad ----------
console.log('C  Kopfzeilen beim Rollen');
{
  const { ctx, P } = await auf(lang());
  const k = await P.locator('.react-flow__node').first().boundingBox();
  const start = await lage(P);
  pruefe('D1 acht Spalten in einer schmalen Karte: Spalten bleiben lesbar breit, die Tabelle rollt seitwärts', start.sw > start.cw + 100 && (await zelle(P, 'E2')).breit >= 80, { sw: start.sw, cw: start.cw });
  await P.mouse.move(k.x + 220, k.y + 220); await P.mouse.wheel(0, 120); await P.waitForTimeout(350);
  const frei = await lage(P);
  pruefe('D2 unausgewählt gehört das Rad dem Board: Die Fläche schwenkt, die Tabelle bleibt stehen', frei.oben === 0 && frei.vp !== start.vp, frei);
  await P.locator('.sheet-grid td[data-zelle="B3"]').click(); await P.waitForTimeout(300);
  await P.keyboard.press('Escape'); await P.waitForTimeout(150);
  await P.mouse.move(k.x + 220, k.y + 160);
  for (let i = 0; i < 4; i++) { await P.mouse.wheel(0, 120); await P.waitForTimeout(120); }
  const gewaehlt = await lage(P);
  pruefe('D3 ausgewählt rollt das Rad die Tabelle – das Board bleibt stehen', gewaehlt.oben >= 400 && gewaehlt.vp === frei.vp, gewaehlt);
  const o = await obenauf(P);
  pruefe('C1 Spaltenbuchstaben und Kopfzeile stehen oben fest, die Kopfzeile direkt darunter', o.buchstabe?.art === 'TH:buchstabe' && o.kopf?.art === 'TD:kopf' && Math.abs(o.kopfUnten - o.soll) <= 1, o);
  pruefe('C2 beide sind deckend – keine Datenzeile scheint durch', o.buchstabe?.deckt && o.kopf?.deckt && o.ecke?.deckt && o.kopfNr?.deckt && o.nr?.deckt, o);
  pruefe('C3 darunter beginnen die Daten', o.daten?.art === 'TD:daten' && o.nr?.art === 'TH:daten', o);
  const farbe = await P.evaluate(() => getComputedStyle(document.querySelector('.sheet-kopfzeile td')).backgroundColor);
  pruefe('C4 eine farbige Kopfzeile behält ihre Farbe beim Rollen', farbe === 'rgb(31, 78, 120)', farbe);
  await P.keyboard.down('Shift'); await P.mouse.wheel(0, 200); await P.keyboard.up('Shift'); await P.waitForTimeout(300);
  const quer = await lage(P);
  pruefe('D4 Umschalt + Rad rollt seitwärts – wieder ohne das Board zu bewegen', quer.links >= 150 && quer.vp === frei.vp, quer);
  const o2 = await obenauf(P);
  pruefe('C5 seitwärts gerollt: Zeilennummern und Ecke stehen links fest und decken', o2.ecke?.art === 'TH:buchstabe' && o2.kopfNr?.art === 'TH:kopf' && o2.nr?.art === 'TH:daten' && o2.ecke.deckt && o2.kopfNr.deckt && o2.nr.deckt, o2);
  await P.screenshot({ path: path.join(SD, 'm409-rollen.png') });
  // am Ende des Inhalts bekommt das Board das Rad wieder
  await P.evaluate(() => { const r = document.querySelector('.sheet-scroll'); r.scrollTop = r.scrollHeight; });
  await P.waitForTimeout(150); await P.mouse.wheel(0, 120); await P.waitForTimeout(350);
  pruefe('D5 am Ende der Tabelle gehört das Rad wieder dem Board', (await lage(P)).vp !== frei.vp, await lage(P));
  // Filterknopf: leise, ohne Kasten
  const knopf = await P.evaluate(() => { const c = getComputedStyle(document.querySelector('.sheet-filter-knopf')); return { rand: c.borderTopWidth, bg: c.backgroundColor, breit: parseFloat(c.width) }; });
  pruefe('C6 der Filterknopf ist leise: kein Kasten, keine eigene Fläche', knopf.rand === '0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(knopf.bg) && knopf.breit <= 20, knopf);
  await ctx.close();
}

// ---------- E: Fokus ----------
console.log('E  Fokus neben der Navigation');
{
  const { ctx, P } = await auf(lang(), { nav: true });
  const k = await P.locator('.react-flow__node').first().boundingBox();
  await P.mouse.click(k.x + 150, k.y + 14); await P.waitForTimeout(250);
  await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
  const f = await lage(P);
  pruefe('E1 Fokus offen; die Tabelle liegt ganz in der Fläche – rechts nichts abgeschnitten', f.fokus && f.flaeche[0] > 200 && f.karte[0] >= f.flaeche[0] && f.karte[2] <= f.flaeche[2], f);
  // M413: Die Karte behält im Fokus ihre Form (vorher wuchs sie in die Höhe und sah anders aus als am Board) – sie kommt näher
  const form = (q) => (q[2] - q[0]) / (q[3] - q[1]);
  pruefe('E2 sie behält ihre Form und kommt näher: gleiches Seitenverhältnis, deutlich größer, ganz im Bild', Math.abs(form(f.karte) - k.width / k.height) < 0.02 && f.karte[2] - f.karte[0] > k.width * 1.3 && f.karte[3] <= f.flaeche[3], { ...f, vorher: [Math.round(k.width), Math.round(k.height)] });
  await P.evaluate(() => { document.querySelector('.sheet-scroll').scrollTop = 0; });
  const kf = await P.locator('.react-flow__node').first().boundingBox();
  await P.mouse.move(kf.x + 300, kf.y + 300);
  for (let i = 0; i < 2; i++) { await P.mouse.wheel(0, 120); await P.waitForTimeout(150); }
  const fr = await lage(P);
  pruefe('E3 das Rad rollt im Fokus die Tabelle – die Karte bleibt, wo sie ist', fr.oben >= 200 && fr.vp === f.vp && fr.karte.join() === f.karte.join(), fr);
  const o = await obenauf(P);
  pruefe('E4 auch im Fokus stehen die Kopfzeilen fest und decken', o.kopf?.art === 'TD:kopf' && o.kopf.deckt && o.buchstabe?.deckt, o);
  await P.screenshot({ path: path.join(SD, 'm409-fokus.png') });
  await P.keyboard.press('Escape'); await P.waitForTimeout(900);
  const z = await lage(P);
  const reste = await P.evaluate(() => ['--fokus-hoch', '--fokus-platz'].map((v) => document.documentElement.style.getPropertyValue(v)).join('|'));
  pruefe('E5 Esc schließt: Die Karte hat wieder ihr Maß', !z.fokus && Math.abs((z.karte[3] - z.karte[1]) - 360) <= 2 && Math.abs((z.karte[2] - z.karte[0]) - 520) <= 2 && reste === '|', { z, reste });
  await ctx.close();
}

// ---------- F: Dunkel, Telefon ----------
console.log('F  Dunkle Darstellung, Telefon');
{
  const { ctx, P } = await auf([], { dunkel: true });
  await P.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await einfuegen(P, MUSTER);
  const a3 = await zelle(P, 'A3'); const b2 = await zelle(P, 'B2'); const a2 = await zelle(P, 'A2');
  const hell = (rgb) => { const m = /rgba?\(([^)]+)\)/.exec(rgb ?? ''); const [r, g, b] = m ? m[1].split(',').map(Number) : [0, 0, 0]; return (r * 299 + g * 587 + b * 114) / 1000; };
  pruefe('F1 dunkel: eine hell gefüllte Zelle behält dunkle Schrift (lesbar)', a3?.bg === 'rgb(255, 242, 204)' && hell(a3.farbe) < 90, a3);
  pruefe('F2 dunkel: ungefüllte Zellen zeigen helle Schrift auf dunklem Grund', hell(b2?.farbe) > 150 && hell(a2?.farbe) > 150, { b2: b2?.farbe, a2: a2?.farbe });
  await P.screenshot({ path: path.join(SD, 'm409-dunkel.png') });
  await ctx.close();
}
{
  const { ctx, P } = await auf(lang(), { viewport: { width: 390, height: 800 }, touch: true });
  const breite = await P.evaluate(() => ({ seite: document.documentElement.scrollWidth, fenster: window.innerWidth }));
  pruefe('F3 Telefon: die Seite rollt nicht seitwärts', breite.seite <= breite.fenster + 1, breite);
  const knopf = await P.evaluate(() => { const b = document.querySelector('.sheet-filter-knopf'); if (!b) return null; const r = b.getBoundingClientRect(); const z = Number(document.querySelector('.react-flow__viewport').style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1); return { b: Math.round(r.width / z), h: Math.round(r.height / z) }; });
  pruefe('F4 Telefon: der Filterknopf bleibt groß genug für den Finger', !!knopf && knopf.b >= 28 && knopf.h >= 28, knopf);
  await ctx.close();
}
pruefe('F5 keine Fehler in der Seite', fehler.length === 0, fehler.slice(0, 3));

await browser.close(); app.close();
console.log(`\nM409: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
