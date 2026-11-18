/**
 * M392 — PDF-Vorschau scharf in jeder Kartengröße; Fotos aus der Geräte-Ablage ohne Rahmen.
 *
 * Gemeldet: „Die Auflösung von PDF-Dateien (als kleine Karte im Board) ist oft so grob, dass man Schrift und
 * Inhalte kaum entziffern kann. Man muss erst die Karte größer ziehen." und „Bei Fotos auf dem Board wird immer
 * noch der Rahmen angezeigt."
 *
 *   A  PDF: Das Bild der Seite hat so viele Bildpunkte, wie es auf dem Schirm einnimmt — in Ruhe, hineingezoomt
 *      (ohne die Karte größer zu ziehen) und im Fokus. Beim Neumalen blitzt die Seite nicht leer auf. Eine Karte
 *      außerhalb des Bildes wird nicht mit hochgerechnet; die Größe ist gedeckelt; herausgezoomt wird es wieder klein.
 *   B  Dasselbe auf einem Schirm mit doppelter Dichte.
 *   C  Fotos: Ein Bild, das als Datei abgelegt ist, liegt rahmenlos auf dem Board wie jedes andere Bild — keine
 *      Kopfzeile, kein Rand, kein Schatten; ⋯ → „Mit Rahmen" holt die Karte zurück. Auch frisch eingefügt bei
 *      fast vollem Stand; der Hinweis dazu kommt einmal, nicht bei jedem Foto.
 *   D  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m392-pdf-schaerfe-bilder.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4708;
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

/** Eine kleine, gültige PDF mit n Seiten (612 × 792), je Seite ein farbiges Rechteck */
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
const pdf = pdfErzeugen(3);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const bild = png(320, 200);
const bildUrl = `data:image/png;base64,${bild.toString('base64')}`;
const datei = (id, x, y, w, name = 'skript.pdf') => ({ id, type: 'file', width: w, position: { x, y }, data: { name, mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } });
const brett = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const stand = () => ({
  boards: [
    brett('b1', 'Skripte', [
      datei('klein', 80, 120, 220),            // zugeklappt, schmal — der gemeldete Fall
      datei('fern', 9000, 6000, 220),          // weit außerhalb des Bildes
    ]),
    brett('b2', 'Breit', [datei('riesig', 80, 80, 2400)]),      // sehr breit — für den Deckel
    brett('b3', 'Lesen', [datei('offen', 80, 80, 420)]),        // aufgeklappt — für den Fokus
    brett('b4', 'Fotos', [
      { id: 'foto', type: 'file', width: 240, position: { x: 80, y: 120 }, data: { name: 'urlaub.png', mime: 'image/png', size: bild.length, dataUrl: bildUrl } },
      { id: 'bild', type: 'image', width: 240, height: 150, position: { x: 420, y: 120 }, data: { src: bildUrl, name: 'eingebettet.png' } },
    ]),
  ],
  spaces: [{ id: 's1', name: 'Studium', projects: [{ id: 'p1', name: 'BWL', boardIds: ['b1', 'b2', 'b3', 'b4'] }] }],
  activeId: 'b1', view: 'board',
});
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const seite = async (dichte, st = stand()) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dichte, locale: 'de-DE' });
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ offen: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2500);
  return { ctx, P };
};
/** Bitmap gegen Schirm: wie viele Bildpunkte hat das Canvas je Gerätepunkt, den es auf dem Schirm einnimmt? */
const schaerfe = (P, id) => P.evaluate((i) => {
  const c = document.querySelector(`.react-flow__node[data-id="${i}"] canvas`);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { bitmap: c.width, hoch: c.height, schirm: Math.round(r.width * window.devicePixelRatio), je: c.width / (r.width * window.devicePixelRatio) };
}, id);
const zoom = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const mitte = (P, id) => P.evaluate((i) => { const r = document.querySelector(`.react-flow__node[data-id="${i}"]`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
/** Mit Strg+Rad auf die Karte zoomen, bis der Board-Zoom mindestens `ziel` ist */
const zoomeAuf = async (P, id, ziel) => {
  for (let i = 0; i < 60 && (await zoom(P)) < ziel; i++) {
    const m = await mitte(P, id);
    await P.mouse.move(m[0], m[1]);
    await P.keyboard.down('Control'); await P.mouse.wheel(0, -160); await P.keyboard.up('Control');
    await P.waitForTimeout(60);
  }
};
const zoomeHeraus = async (P, ziel) => {
  for (let i = 0; i < 80 && (await zoom(P)) > ziel; i++) {
    await P.mouse.move(800, 500);
    await P.keyboard.down('Control'); await P.mouse.wheel(0, 160); await P.keyboard.up('Control');
    await P.waitForTimeout(60);
  }
};
/** Zum Board mit diesem Namen blättern (Alt+→), bis es offen ist */
const brettAuf = async (P, name) => {
  const offen = () => P.evaluate(() => { const st = JSON.parse(localStorage.getItem('pixinotes-board')).state; return st.boards.find((b) => b.id === st.activeId)?.name; });
  await P.keyboard.press('Escape'); await P.mouse.click(1500, 940); await P.waitForTimeout(200);
  for (let i = 0; i < 6 && (await offen()) !== name; i++) { await P.keyboard.press('Alt+ArrowRight'); await P.waitForTimeout(900); }
  await P.waitForTimeout(1200);
  return (await offen()) === name;
};
const bis = async (P, fn, ms = 6000) => { const e = Date.now() + ms; let v; while (Date.now() < e) { v = await fn(); if (v) return v; await P.waitForTimeout(150); } return fn(); };

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: PDF – so fein gemalt, wie es zu sehen ist ════');
{
  const { ctx, P } = await seite(1);
  // Das Board passt beim Öffnen alles ein (die ferne Karte macht es winzig) — erst auf etwa 100 % heran
  await zoomeAuf(P, 'klein', 1);
  await P.waitForTimeout(1200);
  const z0 = await zoom(P);
  const r0 = await bis(P, async () => { const s = await schaerfe(P, 'klein'); return s && s.je >= 0.98 && s.je <= 2.2 ? s : null; }) ?? await schaerfe(P, 'klein');
  pruefe('A1 in Ruhe: Die schmale PDF-Karte hat mindestens so viele Bildpunkte, wie sie auf dem Schirm einnimmt (und höchstens gut das Doppelte)', !!r0 && z0 >= 1 && z0 < 1.5 && r0.bitmap >= r0.schirm * 0.98 && r0.je <= 2.2, { z0, ...r0 });
  // Leer-Wächter: Während des Zoomens und Neumalens darf die Seite nie durchsichtig (= geleert) sein
  await P.evaluate(() => {
    window.__leer = 0; window.__proben = 0;
    const c = document.querySelector('.react-flow__node[data-id="klein"] canvas');
    const lauf = () => { try { const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data; window.__proben += 1; if (d[3] === 0) window.__leer += 1; } catch { /* egal */ } window.__wache = requestAnimationFrame(lauf); };
    lauf();
  });
  await zoomeAuf(P, 'klein', 2.4);
  const z1 = await zoom(P);
  const r1 = await bis(P, async () => { const s = await schaerfe(P, 'klein'); return s && s.je >= 0.98 ? s : null; });
  pruefe(`A2 hineingezoomt (Board-Zoom ${z1.toFixed(2)}), OHNE die Karte größer zu ziehen: Das Bild wird nachgemalt und ist wieder so fein wie der Schirm`, z1 >= 2.4 && !!r1 && r1.bitmap >= r1.schirm * 0.98 && r1.je <= 2.2 && r1.bitmap > (r0?.bitmap ?? 0) * 1.5, { z1, ...(r1 ?? await schaerfe(P, 'klein')) });
  const wache = await P.evaluate(() => { cancelAnimationFrame(window.__wache); return { leer: window.__leer, proben: window.__proben }; });
  pruefe('A3 beim Neumalen blitzt die Seite nicht leer auf (das alte Bild bleibt, bis das neue fertig ist)', wache.proben >= 5 && wache.leer === 0, wache);
  const rf = await schaerfe(P, 'fern');
  pruefe('A4 eine PDF-Karte außerhalb des Bildes wird nicht mit hochgerechnet', !!rf && rf.bitmap <= 220 * 2 + 20 && (rf.bitmap < (r1?.bitmap ?? 0)), rf);
  await P.screenshot({ path: path.join(SD, 'm392-hineingezoomt.png') });
  // wieder auf rund 100 %
  await zoomeHeraus(P, 0.6); await P.waitForTimeout(300);
  await zoomeAuf(P, 'klein', 1);
  const zr = await zoom(P);
  const rz = await bis(P, async () => { const s = await schaerfe(P, 'klein'); return s && s.bitmap <= (r1?.bitmap ?? 9999) * 0.8 && s.je >= 0.98 ? s : null; }, 6000);
  pruefe('A5 wieder auf rund 100 %: Das Bild wird wieder klein (der Speicher wird frei) und bleibt scharf', !!rz && rz.bitmap < (r1?.bitmap ?? 0) && rz.je <= 2.2, { zr, ...(rz ?? await schaerfe(P, 'klein')) });
  // Deckel: eine sehr breite Karte, ganz hineingezoomt
  await brettAuf(P, 'Breit');
  await zoomeAuf(P, 'riesig', 2.4);
  await P.waitForTimeout(2500);
  const zMax = await zoom(P);
  const rMax = await schaerfe(P, 'riesig');
  pruefe(`A6 eine 2400 Punkte breite Karte bei ${zMax.toFixed(1)}× Zoom: Das Bild bleibt unter 8 Millionen Bildpunkten und 4096 Punkten Breite`, !!rMax && zMax >= 2.4 && rMax.bitmap * rMax.hoch <= 8_050_000 && rMax.bitmap <= 4096 && rMax.bitmap >= 2300, { zMax, ...rMax });
  // aufgeklappte Seite im Fokus
  await brettAuf(P, 'Lesen');
  const vor = await schaerfe(P, 'offen');
  const m = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="offen"] .file-kopf').getBoundingClientRect(); return [r.right - 14, r.top + 8]; });
  await P.mouse.click(m[0], m[1]); await P.waitForTimeout(250);
  await P.keyboard.press('Enter'); await P.waitForTimeout(1800);
  const imFokus = await P.evaluate(() => !!document.querySelector('.focus-head'));
  const zf = await zoom(P);
  const rfok = await bis(P, async () => { const s = await schaerfe(P, 'offen'); return s && s.je >= 0.98 ? s : null; });
  pruefe(`A7 im Fokus (Board-Zoom ${zf.toFixed(2)}): Die aufgeklappte Seite ist so fein wie der Schirm`, imFokus && !!rfok && rfok.bitmap >= rfok.schirm * 0.98 && (zf <= 1.05 || rfok.bitmap > (vor?.bitmap ?? 0)), { imFokus, zf, vor, ...(rfok ?? await schaerfe(P, 'offen')) });
  await P.screenshot({ path: path.join(SD, 'm392-fokus.png') });
  await ctx.close();
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: doppelte Dichte ════');
{
  const { ctx, P } = await seite(2);
  const r0 = await schaerfe(P, 'klein');
  pruefe('B1 in Ruhe: zwei Gerätepunkte je Punkt sind mitgerechnet', !!r0 && r0.bitmap >= r0.schirm * 0.98, r0);
  await zoomeAuf(P, 'klein', 2.5);
  const r1 = await bis(P, async () => { const s = await schaerfe(P, 'klein'); return s && s.je >= 0.98 ? s : null; });
  pruefe('B2 hineingezoomt: wieder so fein wie der Schirm', !!r1 && r1.bitmap >= r1.schirm * 0.98, r1 ?? await schaerfe(P, 'klein'));
  await ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Fotos ohne Rahmen ════');
{
  const { ctx, P } = await seite(1);
  await brettAuf(P, 'Fotos');
  const lage = (id) => P.evaluate((i) => {
    const k = document.querySelector(`.react-flow__node[data-id="${i}"]`);
    const karte = k.querySelector('.card-shell > :not(.react-flow__handle):not(.card-grip)') ?? k;
    const koerper = k.querySelector('.image-card, .file-card');
    const img = k.querySelector('img');
    const cs = getComputedStyle(koerper); const ns = getComputedStyle(k);
    const a = k.getBoundingClientRect(); const b = img?.getBoundingClientRect();
    return { klasse: koerper.className, kopf: !!k.querySelector('.file-kopf'), meta: !!k.querySelector('.file-body'), schatten: ns.boxShadow, grund: cs.backgroundColor, rand: cs.padding,
      bildFuellt: !!b && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2, masse: [Math.round(a.width), Math.round(a.height), b ? Math.round(b.width) : 0, b ? Math.round(b.height) : 0], karte: karte.tagName };
  }, id);
  const foto = await bis(P, async () => { const l = await lage('foto'); return l.bildFuellt ? l : null; }) ?? await lage('foto');
  const eingebettet = await lage('bild');
  pruefe('C1 ein Foto, das als Datei abgelegt ist: keine Kopfzeile, keine Größenangabe – nur das Bild', /image-card/.test(foto.klasse) && /rahmenlos/.test(foto.klasse) && !foto.kopf && !foto.meta, foto);
  pruefe('C2 … ohne Schatten, Fläche und Rand; das Bild füllt die Karte', foto.schatten === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(foto.grund) && foto.rand === '0px' && foto.bildFuellt, foto);
  pruefe('C3 … genau wie ein eingebettetes Bild daneben', foto.schatten === eingebettet.schatten && foto.grund === eingebettet.grund && foto.rand === eingebettet.rand && /rahmenlos/.test(eingebettet.klasse), [foto, eingebettet]);
  await P.screenshot({ path: path.join(SD, 'm392-fotos.png') });
  // markieren: Bildunterschrift außerhalb; ⋯ → „Mit Rahmen" holt die Karte zurück
  const m = await mitte(P, 'foto');
  await P.mouse.click(m[0], m[1]); await P.waitForTimeout(400);
  const unterschrift = await P.evaluate(() => { const u = document.querySelector('.react-flow__node[data-id="foto"] .img-name.unterschrift'); const k = document.querySelector('.react-flow__node[data-id="foto"]').getBoundingClientRect(); return u ? { text: u.textContent, unter: u.getBoundingClientRect().top >= k.bottom - 1 } : null; });
  pruefe('C4 markiert: Der Name steht als Bildunterschrift UNTER dem Bild (außerhalb der Karte)', !!unterschrift && /urlaub\.png/.test(unterschrift.text) && unterschrift.unter, unterschrift);
  await P.locator('button[aria-label="Mehr"]').first().click(); await P.waitForTimeout(400);
  const schalter = P.locator('[data-taste="bild-rahmen"]');
  pruefe('C5 ⋯ bietet „Mit Rahmen (als Karte)" auch für das abgelegte Foto', (await schalter.count()) === 1 && /Mit Rahmen/.test(await schalter.textContent()));
  await schalter.click(); await P.waitForTimeout(600);
  const mit = await lage('foto');
  pruefe('C6 … und holt die Datei-Karte mit Kopfzeile zurück', /file-card/.test(mit.klasse) && mit.kopf && mit.schatten !== 'none', mit);
  await P.locator('button[aria-label="Mehr"]').first().click(); await P.waitForTimeout(400);
  await P.locator('[data-taste="bild-rahmen"]').click(); await P.waitForTimeout(600);
  pruefe('C7 … und wieder weg', /rahmenlos/.test((await lage('foto')).klasse));
  await ctx.close();
}
{
  // Fast voller Stand: Ein eingefügtes Foto geht in die Geräte-Ablage — und liegt trotzdem rahmenlos da
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript(() => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    const notiz = (id, text) => ({ id, type: 'note', width: 260, position: { x: 60, y: 60 }, data: { color: 'yellow', blocks: [{ id: `${id}p`, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }] } });
    // Budget 4.000.000 Zeichen: Der Ballast liegt in einem zweiten, nie gezeigten Board
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Voll', edges: [], drawings: [], comments: [], nodes: [notiz('n1', 'Aktenvermerk')] }, { id: 'b9', name: 'Ballast', edges: [], drawings: [], comments: [], nodes: [notiz('n9', 'x'.repeat(3_975_000))] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b9'] }] }], activeId: 'b1', view: 'board' } }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2500);
  const einfuegen = () => P.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 320;
    const g = c.getContext('2d'); const d = g.createImageData(500, 320);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'foto.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  });
  const toasts = async (ms) => { const s = new Set(); for (let i = 0; i < ms / 250; i++) { await P.waitForTimeout(250); const t = await P.evaluate(() => document.querySelector('.toast.show')?.textContent ?? null); if (t) s.add(t.trim()); } return [...s]; };
  await P.locator('.react-flow__pane').click({ position: { x: 900, y: 300 } }); await P.waitForTimeout(300);
  await einfuegen();
  const t1 = await toasts(4000);
  const knoten = async () => (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes)).filter((n) => n.id !== 'n1');
  const k1 = await knoten();
  const sicht1 = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node-file')].map((k) => ({ rahmenlos: !!k.querySelector('.image-card.rahmenlos'), kopf: !!k.querySelector('.file-kopf'), schatten: getComputedStyle(k).boxShadow })));
  pruefe('C8 fast voller Stand: Das eingefügte Foto liegt in der Geräte-Ablage (Datei, ohne Base64 im Stand)', k1.length === 1 && k1[0].type === 'file' && k1[0].data.lokal === true && !k1[0].data.dataUrl, k1.map((n) => [n.type, n.data.lokal]));
  pruefe('C9 … und erscheint trotzdem rahmenlos als Bild', sicht1.length === 1 && sicht1[0].rahmenlos && !sicht1[0].kopf && sicht1[0].schatten === 'none', sicht1);
  pruefe('C10 der Hinweis nennt den Zustand – ohne „Datei-Karte"', t1.some((t) => /Speicher fast voll/.test(t)) && !t1.some((t) => /Datei-Karte/.test(t)), t1);
  await P.waitForTimeout(4500);
  await einfuegen();
  const t2 = await toasts(3500);
  pruefe('C11 beim zweiten Foto kommt er nicht noch einmal', (await knoten()).length === 2 && !t2.some((t) => /Speicher fast voll/.test(t)), t2);
  await ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Texte ════');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf8');
  pruefe('D1 die Hilfe nennt M392 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M392)') && lies('src/components/HelpOverlayEn.tsx').includes('(M392)'));
  pruefe('D2 keine Fehler in der Konsole', fehler.length === 0, fehler.slice(0, 3));
}

await browser.close(); app.close();
console.log(`\nm392-pdf-schaerfe-bilder: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
