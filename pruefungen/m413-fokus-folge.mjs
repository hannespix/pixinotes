/**
 * M413 — Fokus und Präsentation: eine Reihenfolge nach Pfeilen, Seiten und Karten getrennt, Zoom gemerkt, Form behalten.
 *
 * Gemeldet: „Wenn Cards im Fokus sind, soll das Weiterschalten zur nächsten Card sich mehr an Verknüpfungen und Pfeilen
 * orientieren. Bei mehrseitigen PDF auch wie im Präsentationsmodus im Fokusmodus darauf achten, dass inline geblättert,
 * aber auch direkt zum nächsten Inhalt gesprungen werden kann. Auch den Präsentationsmodus (Reihenfolge genauso
 * gestalten)." – „Auch den Fokus-Zoom merken, manchmal will man näher ran … dann bei der nächsten Card gleiche
 * Zoomstufe." – „Oft verändert sich im Fokuszoom das Aussehen der Cards, anderes Seitenverhältnis."
 *
 *   A  Fokus: Die nächste Karte ist die, auf die der Pfeil zeigt – nicht die, die daneben liegt. Lose Karten folgen
 *      in Leserichtung.
 *   B  Dokument im Fokus: außen Karte, innen Seite – an derselben Stelle wie bei jeder anderen Karte.
 *   C  Der Zoom bleibt beim Weiterschalten; nach dem Schließen ist er vergessen.
 *   D  Die Karte behält im Fokus ihr Seitenverhältnis (Notiz, Tabelle, Planer).
 *   E  Präsentation: dieselbe Reihenfolge.
 *   F  Telefon: unten die Seiten, im Kopf die Karten.
 *   G  Texte, Englisch.
 */
// Läuft aus dem Repository: `node pruefungen/m413-fokus-folge.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 4729;
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
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

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
const pdf = pdfErzeugen(3);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const notiz = (id, x, y, text) => ({ id, type: 'note', position: { x, y }, width: 260, height: 170, autoFit: false, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
// Lage (Leserichtung wäre: Start, PDF, Zweite, Ziel, Plan, Lose) – die Pfeile sagen: Start → Ziel → PDF → Zweite
const KARTEN = [
  notiz('n1', 0, 0, 'Start'),
  { id: 'f1', type: 'file', width: 300, position: { x: 400, y: 0 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
  notiz('n2', 900, 0, 'Zweite'),
  notiz('n3', 0, 560, 'Ziel'),
  { id: 'g1', type: 'gantt', width: 320, height: 220, position: { x: 400, y: 560 }, data: { title: 'Plan', rows: [{ id: 'r1', name: 'Vorgang A', start: '2026-11-02', end: '2026-11-09' }] } },
  notiz('n4', 900, 560, 'Lose'),
];
const pfeil = (id, source, target) => ({ id, source, target, type: 'floating', data: {} });
const KANTEN = [pfeil('e1', 'n1', 'n3'), pfeil('e2', 'n3', 'f1'), pfeil('e3', 'f1', 'n2')];

const auf = async (sprache = '', opt = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript(([n, e, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: e, drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [KARTEN, KANTEN, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (er) => fehler.push(er.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
};
// Enter öffnet den Fokus bei allem außer der Notiz (dort beginnt es das Schreiben) – zur Notiz führt der Weg über den Planer
const fokusAuf = async (P, id) => {
  const ueber = /^n/.test(id) ? 'g1' : id;
  const k = await P.locator(`.react-flow__node[data-id="${ueber}"]`).boundingBox();
  await P.mouse.click(k.x + Math.min(150, k.width / 2), k.y + 14); await P.waitForTimeout(250);
  await P.locator(`.react-flow__node[data-id="${ueber}"]`).evaluate((el) => el.focus());
  await P.keyboard.press('Enter'); await P.waitForTimeout(1400);
  for (let i = 0; i < 6 && (await P.evaluate(() => document.querySelector('.react-flow__node.pn-focused')?.getAttribute('data-id'))) !== id; i++) {
    await P.locator('[data-taste="fokus-karte-vor"]').click(); await P.waitForTimeout(1200);
  }
};
const stand = (P) => P.evaluate(() => {
  const k = document.querySelector('.react-flow__node.pn-focused'); const r = k?.getBoundingClientRect();
  const m = /scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '');
  const ort = (t) => { const e = document.querySelector(`[data-taste="${t}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), b: Math.round(b.width), h: Math.round(b.height), aus: e.getAttribute('aria-disabled') === 'true', in: !!e.closest('.focus-nav'), kopf: !!e.closest('.focus-head') }; };
  return { id: k?.getAttribute('data-id') ?? null, zoom: m ? Number(m[1]) : 0, form: r ? r.width / r.height : 0, breit: r ? Math.round(r.width) : 0, hoch: r ? Math.round(r.height) : 0,
    links: r ? Math.round(r.left) : 0, rechts: r ? Math.round(r.right) : 0, oben: r ? Math.round(r.top) : 0, unten: r ? Math.round(r.bottom) : 0, b: innerWidth, h: innerHeight,
    kopf: (document.querySelector('.focus-title span')?.textContent ?? '').trim(), seite: Number(k?.querySelector('.pdf-seite')?.getAttribute('data-seite') ?? 0),
    karteVor: ort('fokus-karte-vor'), karteZurueck: ort('fokus-karte-zurueck'), seiteVor: ort('fokus-seite-vor'), seiteZurueck: ort('fokus-seite-zurueck'), kopfVor: ort('fokus-kopf-karte-vor'), kopfZurueck: ort('fokus-kopf-karte-zurueck') };
});
const klick = async (P, t, ms = 1300) => { await P.locator(`[data-taste="${t}"]`).click(); await P.waitForTimeout(ms); };
const formAmBoard = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => { const r = el.getBoundingClientRect(); return r.width / r.height; });
const warteAufPdf = (P) => P.waitForFunction(() => /von 3|of 3/.test(document.querySelector('.focus-title span')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});

// ---------- A: Reihenfolge im Fokus ----------
console.log('A  Fokus: weiter entlang der Pfeile');
const { ctx, P } = await auf();
const formen = {}; for (const id of ['n1', 'g1', 'f1']) formen[id] = await formAmBoard(P, id);
await fokusAuf(P, 'n1');
const a0 = await stand(P);
pruefe('A1 Fokus auf „Start": Karte 1 von 6', a0.id === 'n1' && /1 von 6/.test(a0.kopf), a0);
const tipp = await P.evaluate(() => document.querySelector('[data-taste="fokus-karte-vor"]')?.getAttribute('title') ?? '');
pruefe('A2 der Knopf nennt das Ziel: die Karte am Pfeil („Ziel"), nicht die Nachbarin', /Nächste Karte: Ziel/.test(tipp), tipp);
const weg = ['n1'];
for (let i = 0; i < 5; i++) { await klick(P, 'fokus-karte-vor'); weg.push((await stand(P)).id); }
pruefe('A3 der Weg folgt den Pfeilen (Start → Ziel → PDF → Zweite), danach die losen Karten in Leserichtung', weg.join(' ') === 'n1 n3 f1 n2 g1 n4', weg.join(' '));
await klick(P, 'fokus-karte-vor');
pruefe('A4 nach der letzten Karte geht es bei der ersten weiter', (await stand(P)).id === 'n1', await stand(P));
await klick(P, 'fokus-karte-zurueck'); await klick(P, 'fokus-karte-zurueck');
pruefe('A5 „Vorige Karte" geht denselben Weg zurück', (await stand(P)).id === 'g1', await stand(P));
await P.keyboard.press('Alt+ArrowUp'); await P.waitForTimeout(1300);
pruefe('A6 Alt + ↑ ebenso', (await stand(P)).id === 'n2', await stand(P));
await P.locator('.focus-title').click(); await P.waitForTimeout(150);
await P.keyboard.press('Control+ArrowLeft'); await P.waitForTimeout(1300); await warteAufPdf(P);
pruefe('A7 Strg + ← wie in der Präsentation: die PDF', (await stand(P)).id === 'f1', await stand(P));

// ---------- B: Dokument ----------
console.log('B  Dokument: außen Karte, innen Seite');
const b0 = await stand(P);
pruefe('B1 der Kopf nennt Karte und Seite', /3 von 6/.test(b0.kopf) && /Seite 1 von 3/.test(b0.kopf), b0.kopf);
pruefe('B2 Karten-Knöpfe außen und an derselben Stelle wie bei der Notiz', !!b0.karteVor && Math.abs(b0.karteVor.x - a0.karteVor.x) <= 1 && Math.abs(b0.karteVor.y - a0.karteVor.y) <= 1 && Math.abs(b0.karteZurueck.x - a0.karteZurueck.x) <= 1, { notiz: a0.karteVor, dok: b0.karteVor });
pruefe('B3 Seiten-Knöpfe innen, um die Seitenzahl – „Vorherige Seite" auf Seite 1 grau', !!b0.seiteVor && b0.seiteVor.in && b0.seiteZurueck.aus && !b0.seiteVor.aus && b0.seiteZurueck.x > b0.karteZurueck.x && b0.seiteVor.x < b0.karteVor.x && b0.seiteVor.b >= 40, b0);
pruefe('B4 am breiten Schirm stehen keine Karten-Knöpfe im Kopf', !b0.kopfVor && !b0.kopfZurueck, b0);
await klick(P, 'fokus-seite-vor', 800);
const b1 = await stand(P);
pruefe('B5 „Nächste Seite" blättert im Dokument: Seite 2, dieselbe Karte', b1.id === 'f1' && b1.seite === 2 && /Seite 2 von 3/.test(b1.kopf), b1);
await klick(P, 'fokus-karte-vor');
const b2 = await stand(P);
pruefe('B6 „Nächste Karte" springt mitten aus dem Dokument zur nächsten Karte (vorher blätterte der Knopf Seiten)', b2.id === 'n2', b2);
await klick(P, 'fokus-karte-zurueck'); await warteAufPdf(P); await P.waitForTimeout(500);
pruefe('B7 zurück im Dokument liegt Seite 2 noch offen', (await stand(P)).id === 'f1' && (await stand(P)).seite === 2, await stand(P));
await P.screenshot({ path: path.join(SD, 'm413-dokument.png') });
await P.keyboard.press('Escape'); await P.waitForTimeout(900);

// ---------- C: Zoom merken ----------
console.log('C  Der Zoom bleibt beim Weiterschalten');
await fokusAuf(P, 'n1');
const c0 = await stand(P);
await P.mouse.move(c0.links + c0.breit / 2, c0.oben + c0.hoch / 2);
await P.keyboard.down('Control');
for (let i = 0; i < 4; i++) { await P.mouse.wheel(0, -120); await P.waitForTimeout(140); }
await P.keyboard.up('Control'); await P.waitForTimeout(500);
const c1 = await stand(P);
pruefe('C1 Strg + Rad zoomt im Fokus näher heran', c1.zoom > c0.zoom * 1.15, { vorher: c0.zoom, nachher: c1.zoom });
await klick(P, 'fokus-karte-vor');
const c2 = await stand(P);
pruefe('C2 die nächste Karte kommt in derselben Zoomstufe', c2.id === 'n3' && Math.abs(c2.zoom - c1.zoom) < 0.02, { gemerkt: c1.zoom, naechste: c2.zoom });
pruefe('C3 … und beginnt oben links im Bild (nichts Wichtiges abgeschnitten)', c2.oben >= 0 && c2.links >= -2 || c2.breit <= c2.b, c2);
await klick(P, 'fokus-karte-zurueck');
pruefe('C4 auch zurück bleibt die Stufe', Math.abs((await stand(P)).zoom - c1.zoom) < 0.02, await stand(P));
await P.keyboard.press('Escape'); await P.waitForTimeout(900);
await fokusAuf(P, 'n1');
const c3 = await stand(P);
pruefe('C5 nach dem Schließen ist die Stufe vergessen: der Fokus öffnet wieder eingepasst', Math.abs(c3.zoom - c0.zoom) < 0.02, { erst: c0.zoom, jetzt: c3.zoom });

// ---------- D: Form ----------
console.log('D  Die Karte behält ihre Form');
pruefe('D1 Notiz: gleiches Seitenverhältnis wie am Board, größer', Math.abs(c3.form - formen.n1) < 0.03 && c3.zoom > 1.2, { board: formen.n1, fokus: c3.form, zoom: c3.zoom });
for (let i = 0; i < 4; i++) await klick(P, 'fokus-karte-vor');
const d1 = await stand(P);
pruefe('D2 Planer: gleiches Seitenverhältnis (vorher auf die Schirmbreite gezogen)', d1.id === 'g1' && Math.abs(d1.form - formen.g1) < 0.03 && d1.rechts <= d1.b && d1.unten <= d1.h, { board: formen.g1, fokus: d1.form, d1 });
await P.screenshot({ path: path.join(SD, 'm413-planer.png') });
await klick(P, 'fokus-karte-zurueck'); await klick(P, 'fokus-karte-zurueck'); await warteAufPdf(P); await P.waitForTimeout(500);
const d2 = await stand(P);
pruefe('D3 PDF: Seite in Lesegröße, ganz im Bild', d2.id === 'f1' && d2.links >= 0 && d2.rechts <= d2.b && d2.breit >= 500, d2);
await P.keyboard.press('Escape'); await P.waitForTimeout(900);

// ---------- E: Präsentation ----------
console.log('E  Präsentation: dieselbe Reihenfolge');
await P.mouse.click(1300, 420); await P.waitForTimeout(250);
await P.keyboard.press('Alt+p');
await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(900);
const folie = () => P.evaluate(() => ({ zaehler: (document.querySelector('.presenter-count')?.textContent ?? '').replace(/\s+/g, ' ').trim(), dok: !!document.querySelector('.presenter .folie-dok'), gantt: !!document.querySelector('.presenter-slide .gantt, .presenter-slide [class*="gantt"]'), text: document.querySelector('.presenter-slide .bn-editor')?.textContent?.slice(0, 20) ?? '' }));
const reihe = [];
for (let i = 0; i < 6; i++) {
  const f = await folie(); reihe.push(f.dok ? 'PDF' : f.text || (f.gantt ? 'Plan' : '?'));
  if (i < 5) { await P.locator('[data-taste="vortrag-weiter"]').click({ force: true }); await P.waitForTimeout(800); }
}
pruefe('E1 sechs Folien in der Reihenfolge des Fokus', reihe.join(' ') === 'Start Ziel PDF Zweite Plan Lose', reihe.join(' '));
await P.keyboard.press('Escape'); await P.waitForTimeout(1200);
// M431: Das Board steht danach auf der zuletzt gezeigten Karte — für den nächsten Schritt wieder alles ins Bild
await P.mouse.click(1420, 880); await P.waitForTimeout(200); await P.keyboard.press('f'); await P.waitForTimeout(900);
// Aus dem Fokus in die Präsentation und zurück: Das Board steht wieder da, wo es vor dem Fokus stand
const ansicht = () => P.evaluate(() => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? ''); return m ? m.slice(1).map(Number) : null; });
const vorher = await ansicht();
await fokusAuf(P, 'f1'); await warteAufPdf(P);
const imFokus = await ansicht();
await P.locator('.focus-nav button[aria-label="Ab dieser Karte präsentieren"]').click();
await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(900);
pruefe('E2 „Ab dieser Karte präsentieren" beginnt auf dieser Karte (3 / 6)', (await folie()).zaehler === '3 / 6' && (await folie()).dok, await folie());
await P.locator('[data-taste="vortrag-weiter"]').click({ force: true }); await P.waitForTimeout(800);
await P.keyboard.press('Escape'); await P.waitForTimeout(1400);
// M431 (statt „das Board steht wie vor dem Fokus"): zurück auf dem Board, mittig bei der zuletzt gezeigten Karte
const nachVortrag = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="n2"]').getBoundingClientRect(); const p = document.querySelector('.react-flow').getBoundingClientRect(); return { fokus: !!document.querySelector('.focus-head'), dx: Math.round(r.left + r.width / 2 - p.left - p.width / 2), dy: Math.round(r.top + r.height / 2 - p.top - p.height / 2) }; });
pruefe('E3 nach der Präsentation auf dem Board, bei der zuletzt gezeigten Karte (4 / 6 = „Zweite")', !nachVortrag.fokus && Math.abs(nachVortrag.dx) < 40 && Math.abs(nachVortrag.dy) < 40 && !!vorher && !!imFokus, nachVortrag);
await ctx.close();

// ---------- F: Telefon ----------
console.log('F  Telefon: unten die Seiten, im Kopf die Karten');
{
  const { ctx: c, P: T } = await auf('', { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const k = await T.locator('.react-flow__node[data-id="f1"]').boundingBox();
  await T.touchscreen.tap(k.x + k.width / 2, k.y + Math.min(k.height / 2, 120)); await T.waitForTimeout(1600);
  await warteAufPdf(T); await T.waitForTimeout(400);
  const f0 = await stand(T);
  pruefe('F1 PDF im Fokus; unten außen stehen die Seiten-Knöpfe (≥ 44 Punkte)', f0.id === 'f1' && !!f0.seiteVor && f0.seiteVor.in && f0.seiteVor.b >= 44 && f0.seiteVor.h >= 44 && f0.seiteZurueck.x <= 12 && f0.seiteVor.x + f0.seiteVor.b >= f0.b - 12, f0);
  pruefe('F2 die Karten-Knöpfe stehen im Kopf (≥ 44 Punkte), unten keine', !!f0.kopfVor && f0.kopfVor.kopf && f0.kopfVor.b >= 44 && f0.kopfVor.h >= 44 && !f0.karteVor && !f0.karteZurueck, f0);
  await T.locator('[data-taste="fokus-seite-vor"]').tap(); await T.waitForTimeout(800);
  pruefe('F3 unten blättert die Seite', (await stand(T)).seite === 2 && (await stand(T)).id === 'f1', await stand(T));
  await T.screenshot({ path: path.join(SD, 'm413-telefon.png') });
  await T.locator('[data-taste="fokus-kopf-karte-vor"]').tap(); await T.waitForTimeout(1400);
  const f1 = await stand(T);
  pruefe('F4 der Knopf im Kopf führt zur nächsten Karte am Pfeil („Zweite")', f1.id === 'n2', f1);
  pruefe('F5 bei der Notiz stehen die Karten-Knöpfe wieder unten außen, der Kopf ist frei', !!f1.karteVor && f1.karteVor.in && !f1.kopfVor && !f1.seiteVor, f1);
  pruefe('F6 nichts ragt seitlich aus dem Schirm', await T.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await c.close();
}

// ---------- G: Englisch ----------
console.log('G  Englisch');
{
  const { ctx: c, P: E } = await auf('en');
  await fokusAuf(E, 'f1'); await warteAufPdf(E);
  const t = await E.evaluate(() => ({ kopf: document.querySelector('.focus-title span')?.textContent ?? '', vor: document.querySelector('[data-taste="fokus-karte-vor"]')?.getAttribute('aria-label') ?? '', tipp: document.querySelector('[data-taste="fokus-karte-vor"]')?.getAttribute('title') ?? '', seite: document.querySelector('[data-taste="fokus-seite-vor"]')?.getAttribute('aria-label') ?? '' }));
  pruefe('G1 Kopf und Knöpfe sind übersetzt', /3 of 6/.test(t.kopf) && /Page 1 of 3/.test(t.kopf) && t.vor === 'Next card' && /Next card: Zweite/.test(t.tipp) && t.seite === 'Next page', t);
  await c.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nM413: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
