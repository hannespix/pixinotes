/**
 * M395 — Einfache Bildbearbeitung: zuschneiden, drehen, spiegeln, gerade richten, Helligkeit, verpixeln.
 *
 * Gewünscht: „Können wir unkompliziert einfache, intuitive Bildbearbeitungsfunktionen implementieren? Wichtig
 * normalerweise: zuschneiden, rotieren …"
 *
 * Das Testbild ist ein Farbverlauf: Rot wächst nach rechts, Grün nach unten — an der Farbe einer Stelle lässt sich
 * ablesen, woher im ursprünglichen Bild sie stammt. So wird jede Funktion am Bildinhalt nachgemessen.
 *
 *   A  Einstieg: Knopf am markierten Bild und ⋯ → „Bild bearbeiten"; Esc/Abbrechen ändert nichts.
 *   B  Zuschneiden: Rahmen ziehen, verschieben, festes Format; die Karte bekommt das neue Seitenverhältnis.
 *   C  Drehen und Spiegeln — der Ausschnitt dreht mit.
 *   D  Gerade richten: keine leeren Ecken.
 *   E  Helligkeit/Kontrast/Sättigung, Automatisch.
 *   F  Verpixeln: Der Bereich ist unkenntlich und bleibt es beim Drehen; ein Tipp nimmt ihn wieder weg.
 *   G  Rückgängig holt das Original; Zurücksetzen im Editor.
 *   H  Bild aus der Geräte-Ablage: neue Kennung, Verbindungen und Kommentare ziehen mit, Rückgängig.
 *   I  Nur lesen: kein Bearbeiten. Telefon: bedienbar.
 *   J  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m395-bild-bearbeiten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4711;
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

/** Ein PNG (w × h, Farbverlauf) — ohne Bibliothek */
function png(w, h) {
  const crcTab = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const stueck = (typ, daten) => { const kopf = Buffer.alloc(8); kopf.writeUInt32BE(daten.length, 0); kopf.write(typ, 4, 'latin1'); const pruef = Buffer.alloc(4); pruef.writeUInt32BE(crc(Buffer.concat([kopf.subarray(4), daten])), 0); return Buffer.concat([kopf, daten, pruef]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const roh = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; roh[i] = Math.round(255 * x / w); roh[i + 1] = Math.round(255 * y / h); roh[i + 2] = 140; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), stueck('IHDR', ihdr), stueck('IDAT', deflateSync(roh)), stueck('IEND', Buffer.alloc(0))]);
}
const bild = png(400, 200);
const bildUrl = `data:image/png;base64,${bild.toString('base64')}`;
const stand = (rolle) => ({
  boards: [{
    id: 'b1', name: 'Bilder', drawings: [], ...(rolle ? { geteiltRolle: rolle, geteiltVon: 'u-fremd', geteiltName: 'Ada' } : {}),
    edges: [{ id: 'e1', source: 'foto', target: 'n1' }],
    comments: [{ id: 'c1', nodeId: 'foto', msgs: [{ author: 'Ada', text: 'schön', at: '2026-11-10T09:00:00.000Z' }] }],
    nodes: [
      { id: 'bild', type: 'image', width: 400, height: 200, position: { x: 80, y: 80 }, data: { src: bildUrl, name: 'verlauf.png' } },
      { id: 'foto', type: 'file', width: 300, height: 150, position: { x: 560, y: 80 }, data: { name: 'urlaub.png', mime: 'image/png', size: bild.length, lokal: true } },
      { id: 'n1', type: 'note', position: { x: 560, y: 320 }, width: 220, height: 100, data: { title: 'Notiz', blocks: [] } },
    ],
  }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const seite = async (st, geraet) => {
  const ctx = await browser.newContext(geraet ? { ...geraet, locale: 'de-DE' } : { viewport: { width: 1400, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((s) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  // das Foto liegt in der Ablage des Geräts (nicht im Board)
  await P.evaluate((url) => new Promise((fertig, weh) => {
    const q = indexedDB.open('pixinotes-sync', 1);
    q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('kv')) q.result.createObjectStore('kv'); };
    q.onsuccess = async () => { const blob = await (await fetch(url)).blob(); const t = q.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(blob, 'file:foto'); t.oncomplete = () => fertig(true); t.onerror = () => weh(t.error); };
    q.onerror = () => weh(q.error);
  }), bildUrl);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
};
const bisAuf = (P) => async (f, ms = 6000) => { const ende = Date.now() + ms; for (;;) { if (await f()) return true; if (Date.now() > ende) return false; await P.waitForTimeout(120); } };
const brettVon = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]);
const karte = async (P, id) => (await brettVon(P)).nodes.find((n) => n.id === id);
const kasten = (P, sel) => P.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
/** Ein Bild (Adresse) vermessen: Maße und Farbe an Stellen (Bruchteile) */
const lesen = (P, src, stellen) => P.evaluate(async ([s, st]) => {
  const i = new Image(); await new Promise((ok2, weh) => { i.onload = ok2; i.onerror = weh; i.src = s; });
  const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(i, 0, 0);
  return { w: c.width, h: c.height, farben: st.map(([fx, fy]) => { const d = x.getImageData(Math.min(c.width - 1, Math.round(fx * (c.width - 1))), Math.min(c.height - 1, Math.round(fy * (c.height - 1))), 1, 1).data; return [d[0], d[1], d[2], d[3]]; }) };
}, [src, stellen]);
/** Woher stammt eine Farbe? (Rot = x, Grün = y im ursprünglichen Bild, als Bruchteile) */
const herkunft = (f) => [f[0] / 255, f[1] / 255];
const nah = (a, b, t = 0.04) => Math.abs(a - b) <= t;
const waehle = async (P, id) => { await P.keyboard.press('Escape'); await P.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 30, y: 60 } }); await P.waitForTimeout(350); };
const oeffne = async (P, id) => {
  await waehle(P, id);
  await P.locator(`.react-flow__node[data-id="${id}"] [data-taste="bild-bearbeiten-auf"]`).click();
  await P.waitForSelector('.bild-editor .be-blatt canvas', { timeout: 6000 }); await P.waitForTimeout(500);
};
const ziehe = async (P, von, nach) => { await P.mouse.move(von[0], von[1]); await P.mouse.down(); await P.mouse.move((von[0] + nach[0]) / 2, (von[1] + nach[1]) / 2, { steps: 4 }); await P.mouse.move(nach[0], nach[1], { steps: 4 }); await P.mouse.up(); await P.waitForTimeout(200); };
const griff = async (P, g) => { const k = await kasten(P, `.be-griff.${g}`); return [k.l + k.w / 2, k.t + k.h / 2]; };
const fertig = async (P) => { await P.locator('[data-taste="be-fertig"]').click(); await P.waitForSelector('.bild-editor', { state: 'detached', timeout: 8000 }); await P.waitForTimeout(500); };
const regler = (P, taste, wert) => P.locator(`[data-taste="${taste}"]`).evaluate((el, v) => { const setze = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setze.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, wert);
const rueckgaengig = async (P) => { await P.keyboard.press('Escape'); await P.mouse.click(1200, 760); await P.keyboard.press('Control+z'); await P.waitForTimeout(600); };
const ECKEN = [[0.02, 0.03], [0.98, 0.03], [0.02, 0.97], [0.98, 0.97], [0.5, 0.5]];

const { ctx, P } = await seite(stand());
const bis = bisAuf(P);

console.log('\n════ A: Einstieg ════');
{
  await waehle(P, 'bild');
  pruefe('A1 am markierten Bild steht neben der Lupe ein Knopf zum Bearbeiten', (await P.locator('.react-flow__node[data-id="bild"] [data-taste="bild-bearbeiten-auf"]').isVisible()));
  await P.locator('button[data-smbtn][aria-label="Mehr"]').click();
  await P.waitForTimeout(300);
  const imMenue = await P.locator('[data-taste="bild-bearbeiten"]').count();
  pruefe('A2 im ⋯-Menü des Bildes steht „Bild bearbeiten …"', imMenue === 1);
  if (imMenue) await P.locator('[data-taste="bild-bearbeiten"]').click(); else await P.locator('.react-flow__node[data-id="bild"] [data-taste="bild-bearbeiten-auf"]').click();
  await P.waitForSelector('.bild-editor .be-blatt canvas', { timeout: 6000 }); await P.waitForTimeout(500);
  const blatt = await kasten(P, '.be-blatt'); const rahmen = await kasten(P, '.be-rahmen');
  pruefe('A3 der Editor zeigt das Bild mit dem Zuschneiderahmen über dem ganzen Bild', !!blatt && !!rahmen && nah(blatt.w / blatt.h, 2, 0.02) && Math.abs(rahmen.w - blatt.w) < 2 && Math.abs(rahmen.h - blatt.h) < 2, { blatt, rahmen });
  pruefe('A4 in der Kopfzeile stehen Name und Größe des Ergebnisses', /verlauf\.png/.test(await P.locator('.be-titel').textContent()) && /400\s×\s200/.test(await P.locator('[data-taste="be-masse"]').textContent()), await P.locator('.be-titel').textContent());
  await P.screenshot({ path: path.join(SD, 'm395-a-editor.png') });
  const s = await griff(P, 'so');
  await ziehe(P, s, [s[0] - 200, s[1] - 100]);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  pruefe('A5 Esc schließt den Editor – das Bild bleibt, wie es war, und die Karte ist noch da', (await P.locator('.bild-editor').count()) === 0 && (await karte(P, 'bild'))?.data.src === bildUrl);
}

console.log('\n════ B: Zuschneiden ════');
{
  await oeffne(P, 'bild');
  const b = await kasten(P, '.be-blatt');
  // rechte untere Ecke zur Mitte: bleibt das linke obere Viertel
  await ziehe(P, await griff(P, 'so'), [b.l + b.w / 2, b.t + b.h / 2]);
  pruefe('B1 die Größe in der Kopfzeile folgt dem Rahmen (200 × 100)', /200\s×\s100/.test(await P.locator('[data-taste="be-masse"]').textContent()), await P.locator('[data-taste="be-masse"]').textContent());
  // den Rahmen als Ganzes nach rechts unten schieben: das rechte untere Viertel
  const r = await kasten(P, '.be-rahmen');
  await ziehe(P, [r.l + r.w / 2, r.t + r.h / 2], [r.l + r.w / 2 + b.w, r.t + r.h / 2 + b.h]);
  await P.screenshot({ path: path.join(SD, 'm395-b-zuschnitt.png') });
  await fertig(P);
  const k = await karte(P, 'bild');
  const m = await lesen(P, k.data.src, ECKEN);
  const lo = herkunft(m.farben[0]); const ru = herkunft(m.farben[3]);
  pruefe('B2 das Ergebnis ist der gewählte Ausschnitt: 200 × 100, rechts unten aus dem Bild', m.w === 200 && m.h === 100 && nah(lo[0], 0.5) && nah(lo[1], 0.5) && nah(ru[0], 1) && nah(ru[1], 1), { w: m.w, h: m.h, lo, ru });
  pruefe('B3 die Karte behält ihre Breite und bekommt das Seitenverhältnis des Bildes', k.width === 400 && Math.abs(k.height - 200) <= 2, { w: k.width, h: k.height });
  pruefe('B4 das Bild im Board ist kleiner geworden (weniger vom Board-Speicher)', k.data.src.length < bildUrl.length, { neu: k.data.src.length, alt: bildUrl.length });
  await rueckgaengig(P);
  pruefe('B5 Rückgängig holt das Original zurück', (await karte(P, 'bild'))?.data.src === bildUrl);
  // festes Format
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-format"][data-format="1:1"]').click(); await P.waitForTimeout(200);
  const q = await kasten(P, '.be-rahmen');
  pruefe('B6 „1:1" macht den Rahmen quadratisch, so groß wie möglich, mittig', Math.abs(q.w - q.h) < 2 && /200\s×\s200/.test(await P.locator('[data-taste="be-masse"]').textContent()), q);
  await ziehe(P, await griff(P, 'so'), [q.r - 60, q.b - 20]);
  const q2 = await kasten(P, '.be-rahmen');
  pruefe('B7 beim Ziehen an der Ecke bleibt das Format', Math.abs(q2.w - q2.h) < 2 && q2.w < q.w - 10, q2);
  await P.locator('[data-taste="be-format"][data-format="16:9"]').click(); await P.waitForTimeout(200);
  const q3 = await kasten(P, '.be-rahmen');
  pruefe('B8 „16:9" stellt das Format um', nah(q3.w / q3.h, 16 / 9, 0.03), q3.w / q3.h);
  await P.locator('[data-taste="be-format"][data-format="16:9"]').click(); await P.waitForTimeout(200);
  const q4 = await kasten(P, '.be-rahmen');
  pruefe('B9 noch einmal getippt: hoch statt quer (9:16)', nah(q4.w / q4.h, 9 / 16, 0.03) && (await P.locator('[data-taste="be-format"][aria-pressed="true"]').textContent()) === '9:16', { v: q4.w / q4.h, t: await P.locator('[data-taste="be-format"][aria-pressed="true"]').textContent() });
  // neuen Rahmen frei aufziehen
  await P.locator('[data-taste="be-format"][data-format="Frei"]').click();
  const b2 = await kasten(P, '.be-blatt');
  await ziehe(P, [b2.l + b2.w * 0.1, b2.t + b2.h * 0.2], [b2.l + b2.w * 0.3, b2.t + b2.h * 0.4]);
  const q5 = await kasten(P, '.be-rahmen');
  pruefe('B10 außerhalb des Rahmens gezogen entsteht ein neuer Ausschnitt', nah((q5.l - b2.l) / b2.w, 0.1, 0.02) && nah(q5.w / b2.w, 0.2, 0.02) && nah(q5.h / b2.h, 0.2, 0.02), q5);
  await P.locator('[data-taste="be-zuruecksetzen"]').click(); await P.waitForTimeout(200);
  const q6 = await kasten(P, '.be-rahmen');
  pruefe('B11 „Zurücksetzen" stellt alles auf Anfang', Math.abs(q6.w - b2.w) < 2 && Math.abs(q6.h - b2.h) < 2 && (await P.locator('[data-taste="be-zuruecksetzen"]').count()) === 0);
  await P.locator('[data-taste="be-fertig"]').click(); await P.waitForTimeout(500);
  pruefe('B12 „Fertig" ohne Änderung schließt nur – nichts wird neu gespeichert', (await P.locator('.bild-editor').count()) === 0 && (await karte(P, 'bild'))?.data.src === bildUrl);
}

console.log('\n════ C: Drehen und Spiegeln ════');
{
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-rechts"]').click(); await P.waitForTimeout(300);
  const b = await kasten(P, '.be-blatt');
  pruefe('C1 nach rechts gedreht steht das Bild hochkant (1:2)', nah(b.w / b.h, 0.5, 0.02) && /200\s×\s400/.test(await P.locator('[data-taste="be-masse"]').textContent()), b);
  await fertig(P);
  let k = await karte(P, 'bild'); let m = await lesen(P, k.data.src, ECKEN);
  // im Uhrzeigersinn: oben links kommt von unten links, oben rechts von oben links
  let lo = herkunft(m.farben[0]); let ro = herkunft(m.farben[1]);
  pruefe('C2 der Inhalt ist im Uhrzeigersinn gedreht (oben links = vorher unten links)', m.w === 200 && m.h === 400 && nah(lo[0], 0) && nah(lo[1], 1) && nah(ro[0], 0) && nah(ro[1], 0), { w: m.w, h: m.h, lo, ro });
  pruefe('C3 die Karte ist hochkant geworden (gleiche Breite, doppelte Höhe)', k.width === 400 && Math.abs(k.height - 800) <= 2, { w: k.width, h: k.height });
  await rueckgaengig(P);
  await oeffne(P, 'bild');
  await P.keyboard.press('Shift+R'); await P.waitForTimeout(300);
  await fertig(P);
  k = await karte(P, 'bild'); m = await lesen(P, k.data.src, ECKEN); lo = herkunft(m.farben[0]);
  pruefe('C4 Umschalt+R dreht nach links (oben links = vorher oben rechts)', m.w === 200 && nah(lo[0], 1) && nah(lo[1], 0), lo);
  await rueckgaengig(P);
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-spiegeln"]').click(); await P.waitForTimeout(300);
  await fertig(P);
  k = await karte(P, 'bild'); m = await lesen(P, k.data.src, ECKEN); lo = herkunft(m.farben[0]); const lu = herkunft(m.farben[2]);
  pruefe('C5 Spiegeln tauscht links und rechts – oben bleibt oben', m.w === 400 && nah(lo[0], 1) && nah(lo[1], 0) && nah(lu[1], 1), { lo, lu });
  await rueckgaengig(P);
  // gedreht UND gespiegelt: „spiegeln" heißt, was man sieht
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-rechts"]').click(); await P.locator('[data-taste="be-spiegeln"]').click(); await P.waitForTimeout(300);
  await fertig(P);
  k = await karte(P, 'bild'); m = await lesen(P, k.data.src, ECKEN); lo = herkunft(m.farben[0]); ro = herkunft(m.farben[1]);
  pruefe('C6 erst drehen, dann spiegeln: getauscht wird, was man sieht (links ↔ rechts des gedrehten Bildes)', m.w === 200 && m.h === 400 && nah(lo[0], 0) && nah(lo[1], 0) && nah(ro[0], 0) && nah(ro[1], 1), { lo, ro });
  await rueckgaengig(P);
  // der Ausschnitt dreht mit
  await oeffne(P, 'bild');
  const b0 = await kasten(P, '.be-blatt');
  await ziehe(P, await griff(P, 'so'), [b0.l + b0.w / 2, b0.t + b0.h / 2]);     // linkes oberes Viertel
  await P.locator('[data-taste="be-rechts"]').click(); await P.waitForTimeout(300);
  await fertig(P);
  k = await karte(P, 'bild'); m = await lesen(P, k.data.src, ECKEN);
  const mitte = herkunft(m.farben[4]);
  pruefe('C7 erst zuschneiden, dann drehen: der Ausschnitt dreht mit (es bleibt das linke obere Viertel)', m.w === 100 && m.h === 200 && nah(mitte[0], 0.25, 0.05) && nah(mitte[1], 0.25, 0.05), { w: m.w, h: m.h, mitte });
  await rueckgaengig(P);
}

console.log('\n════ D: Gerade richten ════');
{
  await oeffne(P, 'bild');
  await regler(P, 'be-neigung', 10); await P.waitForTimeout(400);
  pruefe('D1 der Regler zeigt den Winkel', /\+10,0°/.test(await P.locator('.be-gerade output').textContent()), await P.locator('.be-gerade output').textContent());
  await fertig(P);
  const k = await karte(P, 'bild'); const m = await lesen(P, k.data.src, ECKEN);
  pruefe('D2 das Bild bleibt gleich groß und hat keine leeren Ecken', m.w === 400 && m.h === 200 && m.farben.every((f) => f[3] === 255 && Math.abs(f[2] - 140) < 12), m.farben);
  const mi = herkunft(m.farben[4]); const lo = herkunft(m.farben[0]); const ro = herkunft(m.farben[1]);
  pruefe('D3 es ist um die Mitte gedreht: die Mitte bleibt, die obere Kante läuft schräg durchs alte Bild', nah(mi[0], 0.5) && nah(mi[1], 0.5) && Math.abs(lo[1] - ro[1]) > 0.15, { mi, lo, ro });
  await rueckgaengig(P);
}

console.log('\n════ E: Helligkeit, Kontrast, Sättigung ════');
{
  await oeffne(P, 'bild');
  pruefe('E1 die Regler sind eingeklappt, bis man sie holt', (await P.locator('[data-taste="be-hell"]').count()) === 0);
  await P.locator('[data-taste="be-anpassen"]').click(); await P.waitForTimeout(200);
  await regler(P, 'be-hell', 50); await P.waitForTimeout(300);
  await fertig(P);
  let k = await karte(P, 'bild'); let m = await lesen(P, k.data.src, [[0.5, 0.5]]);
  pruefe('E2 heller: die Mitte (128, 128, 140) wird um rund 45 Stufen heller', Math.abs(m.farben[0][0] - 173) < 6 && Math.abs(m.farben[0][2] - 185) < 6, m.farben[0]);
  await rueckgaengig(P);
  // M502: den gespeicherten Stand erst lesen, wenn er steht (AGENTEN.md „unter Last") — erst das Rückgängig, dann das Ergebnis
  let vorSrc = k.data.src;
  for (let i = 0; i < 40 && (await karte(P, 'bild')).data.src === vorSrc; i += 1) await P.waitForTimeout(200);
  vorSrc = (await karte(P, 'bild')).data.src;
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-anpassen"]').click();
  await regler(P, 'be-saettigung', -100); await P.waitForTimeout(300);
  await fertig(P);
  for (let i = 0; i < 40 && (await karte(P, 'bild')).data.src === vorSrc; i += 1) await P.waitForTimeout(200);
  k = await karte(P, 'bild'); m = await lesen(P, k.data.src, [[0.9, 0.1], [0.1, 0.9]]);
  pruefe('E3 Sättigung ganz herunter: das Bild ist grau', m.farben.every((f) => Math.abs(f[0] - f[1]) < 4 && Math.abs(f[1] - f[2]) < 4), m.farben);
  await rueckgaengig(P);
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-anpassen"]').click();
  await regler(P, 'be-kontrast', 100); await P.waitForTimeout(300);
  await fertig(P);
  k = await karte(P, 'bild'); m = await lesen(P, k.data.src, [[0.1, 0.5], [0.9, 0.5]]);
  pruefe('E4 mehr Kontrast: Dunkles wird dunkler, Helles heller', m.farben[0][0] < 5 && m.farben[1][0] > 250, m.farben);
  await rueckgaengig(P);
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-anpassen"]').click();
  await P.locator('[data-taste="be-auto"]').click(); await P.waitForTimeout(300);
  const auto = { hell: await P.locator('[data-taste="be-hell"]').inputValue(), kontrast: await P.locator('[data-taste="be-kontrast"]').inputValue() };
  pruefe('E5 „Automatisch" wählt Werte passend zum Bild (dieses nutzt seinen Tonumfang nicht ganz: mehr Kontrast)', Number(auto.kontrast) > 0 && Number(auto.kontrast) <= 100, auto);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
}

console.log('\n════ F: Verpixeln ════');
{
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-verpixeln"]').click(); await P.waitForTimeout(200);
  pruefe('F1 im Verpixel-Modus ist der Zuschneiderahmen weg', (await P.locator('.be-rahmen').count()) === 0);
  const b = await kasten(P, '.be-blatt');
  await ziehe(P, [b.l + b.w * 0.5, b.t + b.h * 0.1], [b.l + b.w * 0.9, b.t + b.h * 0.9]);     // die rechte Hälfte (ohne Rand)
  pruefe('F2 ein gezogenes Rechteck wird als verpixelter Bereich gemerkt', (await P.locator('[data-taste="be-pixel"]').count()) === 1);
  await P.screenshot({ path: path.join(SD, 'm395-f-verpixelt.png') });
  // dann drehen: der Bereich bleibt auf demselben Inhalt
  await P.locator('[data-taste="be-rechts"]').click(); await P.waitForTimeout(300);
  await fertig(P);
  const k = await karte(P, 'bild');
  // gedreht (200 × 400): die alte rechte Hälfte liegt jetzt unten. Zwei Stellen dicht nebeneinander im alten Bild:
  // je fünf Stellen im Abstand von zwei Bildpunkten: im Klotz gleich, im Verlauf jede anders
  const reihe = (y0) => [0, 1, 2, 3, 4].map((i) => [0.5, y0 + (i * 2) / 399]);
  const m = await lesen(P, k.data.src, [...reihe(0.60), ...reihe(0.10)]);
  const stufen = (l) => new Set(l.map((f) => f.slice(0, 3).join(','))).size;
  pruefe('F3 im verpixelten Bereich sind benachbarte Stellen gleich (grobe Klötze), außerhalb läuft der Verlauf weiter', stufen(m.farben.slice(0, 5)) <= 2 && stufen(m.farben.slice(5)) >= 4, m.farben);
  pruefe('F4 der Bereich hat die Drehung mitgemacht (er liegt jetzt unten)', m.w === 200 && m.h === 400);
  await rueckgaengig(P);
  await oeffne(P, 'bild');
  await P.locator('[data-taste="be-verpixeln"]').click();
  const b2 = await kasten(P, '.be-blatt');
  await ziehe(P, [b2.l + b2.w * 0.2, b2.t + b2.h * 0.2], [b2.l + b2.w * 0.6, b2.t + b2.h * 0.7]);
  await P.mouse.click(b2.l + b2.w * 0.4, b2.t + b2.h * 0.4); await P.waitForTimeout(200);
  pruefe('F5 ein Tipp auf den Bereich nimmt ihn wieder weg', (await P.locator('[data-taste="be-pixel"]').count()) === 0);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
}

console.log('\n════ H: Bild aus der Geräte-Ablage ════');
{
  pruefe('H0 das Foto liegt rahmenlos auf dem Board (aus der Ablage geladen)', await bis(async () => (await P.locator('.react-flow__node[data-id="foto"] .image-card.rahmenlos img').count()) === 1));
  await oeffne(P, 'foto');
  pruefe('H1 auch ein Bild aus der Ablage öffnet sich im Editor', /urlaub\.png/.test(await P.locator('.be-titel').textContent()));
  await P.locator('[data-taste="be-rechts"]').click(); await P.waitForTimeout(300);
  await fertig(P);
  const brett = await brettVon(P);
  const neu = brett.nodes.find((n) => n.type === 'file');
  pruefe('H2 die Karte lebt unter einer neuen Kennung weiter – gleiche Stelle, gleiche Breite, neues Format', !!neu && neu.id !== 'foto' && !brett.nodes.some((n) => n.id === 'foto') && neu.position.x === 560 && neu.width === 300 && Math.abs(neu.height - 600) <= 2, neu && { id: neu.id, pos: neu.position, w: neu.width, h: neu.height });
  pruefe('H3 Verbindung und Kommentar sind mit umgezogen', brett.edges[0].source === neu?.id && brett.edges[0].target === 'n1' && brett.comments[0].nodeId === neu?.id, { kante: brett.edges[0], kommentar: brett.comments[0].nodeId });
  const inAblage = await P.evaluate((id) => new Promise((fertig2) => { const q = indexedDB.open('pixinotes-sync'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get(`file:${id}`); g.onsuccess = () => fertig2(g.result instanceof Blob ? { size: g.result.size, type: g.result.type } : null); g.onerror = () => fertig2(null); }; }), neu.id);
  pruefe('H4 das neue Bild liegt in der Ablage; die Karte nennt Größe und Typ', !!inAblage && inAblage.size === neu.data.size && inAblage.type === 'image/png' && neu.data.mime === 'image/png' && neu.data.lokal === true, { inAblage, data: { size: neu.data.size, mime: neu.data.mime } });
  pruefe('H5 auf dem Board zeigt die Karte das gedrehte Bild', await bis(async () => { const r = await kasten(P, `.react-flow__node[data-id="${neu.id}"] img`); return !!r && nah(r.w / r.h, 0.5, 0.03); }));
  const gemalt = await P.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"] img`)?.src ?? '', neu.id);
  const m = await lesen(P, gemalt, ECKEN); const lo = herkunft(m.farben[0]);
  pruefe('H6 der Inhalt ist gedreht (200 × 400, oben links = vorher unten links)', m.w === 200 && m.h === 400 && nah(lo[0], 0) && nah(lo[1], 1), { w: m.w, h: m.h, lo });
  await rueckgaengig(P);
  const zurueck = await brettVon(P);
  pruefe('H7 Rückgängig holt die alte Karte samt Verbindung und Kommentar zurück', zurueck.nodes.some((n) => n.id === 'foto') && !zurueck.nodes.some((n) => n.id === neu.id) && zurueck.edges[0].source === 'foto' && zurueck.comments[0].nodeId === 'foto');
  pruefe('H8 und ihr Bild ist noch da', await bis(async () => { const r = await kasten(P, '.react-flow__node[data-id="foto"] img'); return !!r && nah(r.w / r.h, 2, 0.05); }));
}
await ctx.close();

console.log('\n════ I: nur lesen, Telefon ════');
{
  const L = await seite(stand('lesen'));
  await L.P.locator('.react-flow__node[data-id="bild"]').click({ position: { x: 30, y: 60 } }); await L.P.waitForTimeout(400);
  const rolle = (await brettVon(L.P)).geteiltRolle;
  pruefe('I1 auf einem Board, das ich nur lesen darf, gibt es kein Bearbeiten', rolle === 'lesen' && (await L.P.locator('[data-taste="bild-bearbeiten-auf"]').count()) === 0, { rolle });
  await L.P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:bild-bearbeiten', { detail: 'bild' }))); await L.P.waitForTimeout(500);
  pruefe('I2 auch auf anderem Weg öffnet sich der Editor dort nicht', (await L.P.locator('.bild-editor').count()) === 0);
  await L.ctx.close();

  const T = await seite(stand(), devices['iPhone 13']);
  await T.P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:bild-bearbeiten', { detail: 'bild' })));
  await T.P.waitForSelector('.bild-editor .be-blatt canvas', { timeout: 6000 }); await T.P.waitForTimeout(600);
  const maß = await T.P.evaluate(() => { const e = document.querySelector('.bild-editor'); const k = document.querySelector('.be-kopf'); const l = document.querySelector('.be-leiste'); const b = document.querySelector('.be-blatt').getBoundingClientRect(); return { breit: e.scrollWidth <= e.clientWidth + 1, kopf: k.scrollWidth <= k.clientWidth + 1, blattDrin: b.left >= 0 && b.right <= window.innerWidth && b.top >= k.getBoundingClientRect().bottom - 1 && b.bottom <= l.getBoundingClientRect().top + 1, fertig: (() => { const r = document.querySelector('[data-taste="be-fertig"]').getBoundingClientRect(); return r.right <= window.innerWidth && r.width > 40; })() }; });
  pruefe('I3 am Telefon: nichts läuft über, das Bild liegt zwischen Kopfzeile und Leiste, „Fertig" ist erreichbar', maß.breit && maß.kopf && maß.blattDrin && maß.fertig, maß);
  await T.P.screenshot({ path: path.join(SD, 'm395-i-telefon.png') });
  // mit dem Finger am Griff ziehen
  const g = await T.P.evaluate(() => { const r = document.querySelector('.be-griff.so').getBoundingClientRect(); const b = document.querySelector('.be-blatt').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, bx: b.left + b.width / 2, by: b.top + b.height / 2, gw: r.width }; });
  const zeiger = (typ, x, y) => T.P.evaluate(([t, px, py]) => { const ziel = t === 'pointerdown' ? document.querySelector('.be-griff.so') : document.querySelector('.be-blatt'); ziel.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: px, clientY: py, buttons: t === 'pointerup' ? 0 : 1, isPrimary: true })); }, [typ, x, y]);
  await zeiger('pointerdown', g.x, g.y); await zeiger('pointermove', (g.x + g.bx) / 2, (g.y + g.by) / 2); await zeiger('pointermove', g.bx, g.by); await zeiger('pointerup', g.bx, g.by);
  await T.P.waitForTimeout(300);
  pruefe('I4 die Griffe sind fingergroß, und mit dem Finger gezogen folgt der Rahmen', g.gw >= 40 && /20[01]\s×\s10[01]/.test(await T.P.locator('[data-taste="be-masse"]').textContent()), { gw: g.gw, masse: await T.P.locator('[data-taste="be-masse"]').textContent() });
  await T.ctx.close();
}

console.log('\n════ J: Texte ════');
{
  const de = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
  const en = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf-8');
  pruefe('J1 die Hilfe nennt M395 – deutsch und englisch', de.includes('(M395)') && en.includes('(M395)'));
  pruefe('J2 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm395-bild-bearbeiten: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
