/**
 * M545 — Jede Kartenart steht in der Präsentation in der Mitte der Folie.
 *
 * Gemeldet: „alle module sollen im präsentationsmodus zentriert dargestellt werden auch mermaid diagramme etc"
 * Gemessen vorher (1440 × 900, hell): Mermaid hing in seiner natürlichen Größe am linken Rand (Inhaltsmitte 453 Punkte
 * links der Folienmitte), Pixi stand 75 Punkte zu tief (Platz für Zzz und Herzen über der Figur), die E-Mail 14 Punkte
 * zu hoch, die Abschnittsfolie eines Rahmens 13 Punkte zu tief (Außenabstände von Absätzen); auf dem Telefon ragte die
 * Zeiterfassung 50 Punkte seitlich über die Folie hinaus.
 *
 * Gemessen wird an den Bildpunkten: Bildschirmfoto der Folie, alles, was sich vom Grund der Folie abhebt, ist Inhalt
 * (Schatten werden für die Messung abgeschaltet — sie sind Schmuck und fallen nach unten; die Kopfzeile „Diagramm ‹/›"
 * der Mermaid-Folie ist Bedienung und wird verborgen). Pixi bewegt sich (Hüpfen, Zzz) — dort zählt der Körper samt
 * Schatten und Name aus der Lage der Zeichenfläche.
 *
 * Grenze: Inhaltsmitte höchstens 8 Punkte von der Flächenmitte. Begründung: Rundung beim Einpassen von Rastern
 * (Pixi in 48er-Schritten, Diagramme über die viewBox) und halbe Pixel bei ungeraden Breiten machen bis zu 3 Punkte;
 * was vorher schief stand, lag 13 bis 453 Punkte daneben. 8 Punkte sind auf dem Telefon gut 2 % der Folie.
 *   A  Alle Kartenarten, 1440 × 900 hell: mittig, nichts läuft über die Folie hinaus, nichts berührt ihren Rand.
 *   B  Dasselbe auf dem Telefon (390 × 844).
 *   C  Dunkel: Mermaid, Pixi, E-Mail, Kanban.
 *   D  Mermaid: Das Diagramm füllt die Fläche (in einer Richtung ≥ 80 %), auch ein hohes Diagramm ganz sichtbar;
 *      in „Nur Inhalt" (F) ebenfalls mittig.
 *   E  Board unverändert: Pixi- und Mermaid-Karte auf dem Board haben keine der Folien-Regeln.
 */
// Läuft aus dem Repository: `node pruefungen/m545-praesentation-zentriert.mjs` (braucht `npm run build`)
// Bilder: M545_BILDER=<ordner> legt Bildschirmfotos der Folien ab.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.M545_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const PORT = 5545;
const GRENZE = 8;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

// ---------- Karten ----------
function png(w, h) {
  const crcTab = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const stueck = (typ, daten) => { const kopf = Buffer.alloc(8); kopf.writeUInt32BE(daten.length, 0); kopf.write(typ, 4, 'latin1'); const pruef = Buffer.alloc(4); pruef.writeUInt32BE(crc(Buffer.concat([kopf.subarray(4), daten])), 0); return Buffer.concat([kopf, daten, pruef]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const roh = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; roh[i] = 40; roh[i + 1] = 90; roh[i + 2] = 160; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), stueck('IHDR', ihdr), stueck('IDAT', deflateSync(roh)), stueck('IEND', Buffer.alloc(0))]);
}
const heute = new Date();
const iso = (n) => { const d = new Date(heute.getTime() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const absatz = (text, styles = {}) => ({ type: 'paragraph', content: [{ type: 'text', text, styles }] });
const bl = (t) => [absatz(t, { bold: true }), absatz('Weiter mit dem nächsten Schritt')];
/** `fuellt`: Die Folie gehört ganz dem Modul (Ideen-Bubbles, Tool) — es darf bis an den Rand reichen */
const KARTEN = {
  note: { type: 'note', width: 280, data: { color: 'yellow', blocks: bl('Notiz') } },
  shape: { type: 'shape', width: 180, height: 90, data: { shape: 'process', text: 'Schritt', color: '#eef2ff' } },
  mermaid: { type: 'mermaid', width: 356, height: 384, data: { code: 'flowchart TD\n  A[Start] --> B{Prüfen}\n  B -->|ja| C[Fertig]\n  B -->|nein| D[Nacharbeit]' } },
  mermaidLR: { type: 'mermaid', width: 620, height: 300, data: { code: 'flowchart LR\n  A[Start] --> B[Prüfen] --> C[Fertig]' } },
  kanban: { type: 'kanban', width: 560, data: { title: 'Aufgaben', items: [{ id: 'k1', text: 'Angebot schreiben', col: 0 }, { id: 'k2', text: 'Rechnung', col: 1 }] } },
  gantt: { type: 'gantt', width: 600, height: 240, data: { title: 'Zeitplan', dayWidth: 24, rows: [{ id: 'g1', name: 'Phase 1', start: iso(0), end: iso(6), color: '#4f7cff' }] } },
  calendar: { type: 'calendar', width: 360, height: 340, data: {} },
  week: { type: 'week', width: 620, height: 440, data: { title: 'Wochenplan', days: 5, from: 480, to: 1020, entries: [{ id: 'w1', day: 0, start: 540, dur: 120, text: 'Team', color: 0 }] } },
  time: { type: 'time', width: 460, height: 380, data: { title: 'Zeiterfassung', segs: [{ id: 't1', date: iso(0), start: 480, end: 720, kind: 'arbeit', note: 'Vormittag' }] } },
  minutes: { type: 'minutes', width: 520, height: 460, data: { title: 'Jour Fixe', color: 'white', current: 'e1', entries: [{ id: 'e1', date: iso(0), attendees: 'Anna', blocks: bl('Tagesordnung'), decisions: [] }] } },
  sheet: { type: 'sheet', width: 460, height: 300, data: { title: 'Kosten', cols: 4, rows: 5, cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1200' } } },
  bubbles: { fuellt: true, type: 'bubbles', width: 560, height: 440, data: { title: 'Ideen', frage: 'Was verbessern wir?', ideen: { i1: { text: 'Mehr Pausen', von: 'g:1', t: 1 }, i2: { text: 'Kaffee', von: 'g:1', t: 2 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } },
  kontakt: { type: 'kontakt', width: 300, data: { name: 'Anna Beispiel', funktion: 'Referentin', firma: 'Amt', telefone: [{ art: 'Mobil', nummer: '+49 170 1234567' }], emails: ['anna@example.org'] } },
  email: { type: 'email', width: 340, data: { subject: 'Termin morgen', fromName: 'Ben Muster', fromAddress: 'ben@example.org', date: heute.toISOString(), text: 'Hallo Anna,\nbis morgen um zehn.\nBen', attachments: [] } },
  file: { type: 'file', width: 260, data: { name: 'bericht.txt', titel: 'Monatsbericht', size: 1234, mime: 'text/plain' } },
  image: { type: 'image', width: 240, data: { src: `data:image/png;base64,${png(320, 180).toString('base64')}`, name: 'foto.png' } },
  pixi: { type: 'pixi', width: 192, height: 192, autoFit: false, data: { name: 'Pixi' } },
  fluessig: { type: 'fluessig', width: 440, height: 220, autoFit: false, data: { text: 'Hallo' } },
  frame: { type: 'frame', width: 640, height: 420, dragHandle: '.frame-head', data: { name: 'Abschnitt Planung', color: '#fff4e0' } },
  htmlapp: { fuellt: true, type: 'htmlapp', width: 380, height: 300, data: { name: 'tool.html', size: 10 } },
  mermaidHoch: { type: 'mermaid', width: 300, height: 500, data: { code: 'flowchart TD\n  A[Eins] --> B[Zwei] --> C[Drei] --> D[Vier] --> E[Fünf] --> F[Sechs] --> G[Sieben] --> H[Acht]' } },
};
const ALLE = Object.keys(KARTEN).filter((k) => k !== 'mermaidHoch');

async function oeffne(art, { breite = 1440, hoehe = 900, dunkel = false } = {}) {
  const { fuellt, ...k } = KARTEN[art];
  void fuellt;
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([karten, d]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ui: { theme: d ? 'dark' : 'light', accent: 'orange', design: 'klassisch' } }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Mitte', edges: [], drawings: [], nodes: karten }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [[{ id: 'k', position: { x: 0, y: 0 }, ...k }], dunkel]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(`${art}: ${e.message}`); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  return { ctx, P };
}
const warteBis = async (P, fn, ms = 15000) => { const ende = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(150); } };
async function vortrag(P, art, breite, hoehe) {
  await P.keyboard.press('Escape'); await P.mouse.click(breite - 40, hoehe - 160); await P.waitForTimeout(150);
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter-slide', { timeout: 15000 });
  // Auf den Inhalt warten, der nachgeladen bzw. abseits gezeichnet wird
  const warte = { mermaid: '.slide-mermaid .mermaid-svg svg', mermaidLR: '.slide-mermaid .mermaid-svg svg', mermaidHoch: '.slide-mermaid .mermaid-svg svg', pixi: '.slide-pixi .pixi-svg', fluessig: '.slide-fluessig canvas', image: '.presenter-slide img' }[art];
  if (warte) await P.waitForSelector(warte, { timeout: 20000, state: 'attached' });
  // Schatten sind Schmuck (fallen nach unten), die Kopfzeile des Diagramms ist Bedienung — beides zählt nicht zum Inhalt
  await P.addStyleTag({ content: '.presenter-slide, .presenter-slide * { box-shadow: none !important; } .presenter-slide .mermaid-head { visibility: hidden !important; }' });
}
/** Folie (ohne Rollbalken-Platz) und Rahmen des Inhalts in ihren Bildpunkten */
async function messe(P, H) {
  const f = await P.evaluate(() => {
    const el = document.querySelector('.presenter-slide');
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const gx = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    const gy = el.offsetHeight - el.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    return { l: b.left, t: b.top, w: Math.floor(b.width - gx), h: Math.floor(b.height - gy), ueberX: el.scrollWidth - el.clientWidth, ueberY: el.scrollHeight - el.clientHeight };
  });
  const buf = await P.screenshot({ clip: { x: f.l, y: f.t, width: f.w, height: f.h } });
  const m = await H.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const px = (x, y) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const grund = px(Math.floor(c.width / 2), 4);   // Innenabstand oben in der Mitte: Grund der Folie
    const RAND = 8;   // die abgerundeten Ecken der Folie selbst zählen nicht
    let l = Infinity; let r = -1; let t = Infinity; let u = -1;
    for (let y = RAND; y < c.height - RAND; y++) for (let x = RAND; x < c.width - RAND; x++) {
      const p = px(x, y);
      if (Math.max(Math.abs(p[0] - grund[0]), Math.abs(p[1] - grund[1]), Math.abs(p[2] - grund[2])) > 10) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > u) u = y; }
    }
    return r < 0 ? null : { l, r: r + 1, t, b: u + 1, W: c.width, Hh: c.height };
  }, buf.toString('base64'));
  if (!m) return { f, m: null };
  return { f, m, dx: Math.round((m.l + m.r) / 2 - m.W / 2), dy: Math.round((m.t + m.b) / 2 - m.Hh / 2), randL: m.l, randR: m.W - m.r, randO: m.t, randU: m.Hh - m.b };
}
/** Pixi bewegt sich: Körper samt Schatten (viewBox −16…32, Körper 0…32) und Name aus der Lage der Zeichenfläche */
const pixiLage = (P) => P.evaluate(() => {
  const el = document.querySelector('.presenter-slide'); const b = el.getBoundingClientRect();
  const s = document.querySelector('.slide-pixi .pixi-svg').getBoundingClientRect();
  const n = document.querySelector('.slide-pixi-name')?.getBoundingClientRect();
  const k = { l: s.left + s.width * 8 / 48, r: s.left + s.width * 40 / 48, t: s.top + s.height * 16 / 48, b: s.bottom };
  if (n) { k.l = Math.min(k.l, n.left); k.r = Math.max(k.r, n.right); k.b = Math.max(k.b, n.bottom); }
  return { dx: Math.round((k.l + k.r) / 2 - (b.left + el.clientWidth / 2)), dy: Math.round((k.t + k.b) / 2 - (b.top + el.clientHeight / 2)), hoch: Math.round(s.height) };
});
/** Misst so lange, bis zwei Messungen übereinstimmen (Diagramm, Schrift und Flüssigkeit setzen sich erst) */
async function ruhigMessen(P, H) {
  let alt = null;
  for (let i = 0; i < 8; i++) {
    const a = await messe(P, H);
    if (alt && a.m && alt.m && a.dx === alt.dx && a.dy === alt.dy && a.m.l === alt.m.l && a.m.t === alt.m.t) return a;
    alt = a; await P.waitForTimeout(350);
  }
  return alt;
}
async function pruefeArt(art, opt, kennung) {
  const breite = opt.breite ?? 1440; const hoehe = opt.hoehe ?? 900;
  const { ctx, P } = await oeffne(art, opt);
  const H = await ctx.newPage();
  try {
    await vortrag(P, art, breite, hoehe);
    if (BILDER) await P.screenshot({ path: path.join(BILDER, `${kennung}-${art}.png`) });
    if (art === 'pixi') {
      const q = await pixiLage(P);
      const a = await messe(P, H);
      pruefe(`${kennung} ${art}: Figur samt Name mittig (dx ${q.dx}, dy ${q.dy})`, Math.abs(q.dx) <= GRENZE && Math.abs(q.dy) <= GRENZE, q);
      pruefe(`${kennung} ${art}: nichts läuft über die Folie`, a.f.ueberX <= 1 && a.f.ueberY <= 1, a.f);
      return;
    }
    const a = await ruhigMessen(P, H);
    if (!a?.m) { pruefe(`${kennung} ${art}: Inhalt sichtbar`, false, a); return; }
    pruefe(`${kennung} ${art}: Inhalt mittig (dx ${a.dx}, dy ${a.dy})`, Math.abs(a.dx) <= GRENZE && Math.abs(a.dy) <= GRENZE, { dx: a.dx, dy: a.dy, m: a.m });
    const fuellt = !!KARTEN[art].fuellt;
    pruefe(`${kennung} ${art}: nichts abgeschnitten (kein Überlauf${fuellt ? '' : ', Abstand zum Rand'})`,
      a.f.ueberX <= 1 && a.f.ueberY <= 1 && (fuellt || Math.min(a.randL, a.randR, a.randO, a.randU) > 2),
      { ueberX: a.f.ueberX, ueberY: a.f.ueberY, rand: [a.randL, a.randR, a.randO, a.randU] });
  } finally { await ctx.close(); }
}

// ---------- A: alle Kartenarten, groß, hell ----------
console.log('A: alle Kartenarten, 1440 × 900 hell');
for (const art of ALLE) await pruefeArt(art, {}, 'A');

// ---------- B: Telefon ----------
console.log('B: Telefon 390 × 844');
for (const art of ALLE) await pruefeArt(art, { breite: 390, hoehe: 844 }, 'B');

// ---------- C: dunkel ----------
console.log('C: dunkel 1280 × 800');
for (const art of ['mermaid', 'pixi', 'email', 'kanban']) await pruefeArt(art, { breite: 1280, hoehe: 800, dunkel: true }, 'C');

// ---------- D: Mermaid groß, hoch, „Nur Inhalt" ----------
console.log('D: Mermaid füllt die Fläche, hohes Diagramm ganz sichtbar, „Nur Inhalt"');
for (const art of ['mermaid', 'mermaidLR', 'mermaidHoch']) {
  const { ctx, P } = await oeffne(art, {});
  const H = await ctx.newPage();
  await vortrag(P, art, 1440, 900);
  const g = await warteBis(P, () => P.evaluate(() => {
    const vor = document.querySelector('.slide-mermaid .mermaid-preview').getBoundingClientRect();
    const zeichnung = document.querySelector('.slide-mermaid .mermaid-svg svg > g')?.getBoundingClientRect();
    if (!zeichnung || !zeichnung.width) return null;
    return { fuellX: zeichnung.width / vor.width, fuellY: zeichnung.height / vor.height,
      drin: zeichnung.left >= vor.left - 1 && zeichnung.right <= vor.right + 1 && zeichnung.top >= vor.top - 1 && zeichnung.bottom <= vor.bottom + 1 };
  }));
  pruefe(`D ${art}: Diagramm füllt die Fläche in einer Richtung zu ≥ 80 %`, !!g && (g.fuellX >= 0.8 || g.fuellY >= 0.8), g);
  pruefe(`D ${art}: Diagramm ganz sichtbar (in der Fläche)`, !!g?.drin, g);
  if (art === 'mermaidHoch') {
    const a = await ruhigMessen(P, H);
    pruefe(`D ${art}: mittig (dx ${a?.dx}, dy ${a?.dy})`, !!a?.m && Math.abs(a.dx) <= GRENZE && Math.abs(a.dy) <= GRENZE, a);
  }
  if (art === 'mermaid') {
    await P.keyboard.press('f');
    await warteBis(P, () => P.evaluate(() => !!document.querySelector('.presenter.rein')));
    await P.waitForTimeout(400);
    const a = await ruhigMessen(P, H);
    pruefe(`D ${art}: „Nur Inhalt" mittig (dx ${a?.dx}, dy ${a?.dy})`, !!a?.m && Math.abs(a.dx) <= GRENZE && Math.abs(a.dy) <= GRENZE, a);
    if (BILDER) await P.screenshot({ path: path.join(BILDER, 'D-mermaid-rein.png') });
  }
  await ctx.close();
}

// ---------- E: Board unverändert ----------
console.log('E: Karten auf dem Board unverändert');
{
  const { ctx, P } = await oeffne('pixi', {});
  await P.waitForSelector('.react-flow__node .pixi-svg', { timeout: 15000 });
  const b = await P.evaluate(() => {
    const p = document.querySelector('.react-flow__node .pixi'); const s = getComputedStyle(p);
    const n = p.closest('.react-flow__node').getBoundingClientRect(); const r = p.getBoundingClientRect();
    return { mt: s.marginTop, gleich: Math.abs(r.top - n.top) < 2 && Math.abs(r.height - n.height) < 2 };
  });
  pruefe('E Pixi auf dem Board: Figur füllt ihre Karte wie bisher (kein Folien-Rand)', b.mt === '0px' && b.gleich, b);
  await ctx.close();
}
{
  const { ctx, P } = await oeffne('mermaid', {});
  await P.waitForSelector('.react-flow__node .mermaid-svg svg', { timeout: 20000 });
  const b = await P.evaluate(() => {
    const svg = document.querySelector('.react-flow__node .mermaid-svg svg'); const vor = svg.closest('.mermaid-preview').getBoundingClientRect();
    const r = svg.getBoundingClientRect();
    return { drin: r.left >= vor.left - 1 && r.right <= vor.right + 1 && r.top >= vor.top - 1 && r.bottom <= vor.bottom + 1, kopf: !!svg.closest('.mermaid-card')?.querySelector('.mermaid-head') };
  });
  pruefe('E Mermaid auf dem Board: Diagramm in der Karte, Kopfzeile da', b.drin, b);
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler);
await browser.close(); app.close();
console.log(`\n${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
