/**
 * M546 — Kommentar-Pins und -Blasen lassen sich nachträglich verschieben.
 *
 * Auftrag: „kommentar bubbles in pdfs soll man nachträglich verschieben können. machmal überlagern sie content und
 * man kann ihn dann nicht mehr nachträglich ändern"
 *
 *   A  Pin auf einer PDF-Seite ziehen (Maus): steht an der neuen Stelle (Pixel), px/py im gespeicherten Stand neu,
 *      im Zug wird nichts gespeichert, kein Gespräch geht auf; Tipp ohne Bewegung öffnet das Gespräch; ein
 *      Rückgängig-Schritt je Verschieben (und Wiederholen); die Seite hält ihn fest.
 *   B  Blase aus dem Weg legen: eigener Versatz (bx/by), Linie zum Pin, der Inhalt darunter ist frei; Doppelklick
 *      und „Blase zurück" legen sie zurück; Rückgängig.
 *   C  Radierer in der Hand: die Blasen treten zurück (durchsichtig, nehmen keinen Zeiger), ein Strich unter der Blase
 *      lässt sich radieren; der Pin bleibt greifbar (ziehen verschiebt ihn, statt zu radieren).
 *   D  Nur lesen: nichts verschiebt sich, der Tipp öffnet weiter das Gespräch.
 *   E  Zoomstufen 50 % und 200 %: Pin in fester Bildschirm-Größe, Zug trifft dieselbe Stelle der Seite.
 *   F  Pin an einer Karte (ohne Seite) lässt sich verschieben (kx/ky), Rückgängig.
 *   G  Finger zieht den Pin.
 *   H  Präsentation: Pin auf der Dokument-Folie ziehen, Tipp öffnet das Gespräch.
 *   I  Hilfe nennt M546.
 */
// Läuft aus dem Repository: `node pruefungen/m546-kommentar-verschieben.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5546;
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
function pdfErzeugen(n) {
  const objekte = [];
  objekte.push('<< /Type /Catalog /Pages 2 0 R >>');
  objekte.push(`<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const inhalt = `0.5 0.2 0.5 rg 80 ${600 - i * 120} 300 80 re f`;
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
const pdf = pdfErzeugen(2);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const jetzt = new Date().toISOString();
/** Strich auf Seite 1 genau unter der Textblase von c1 (Pin bei 200/260, Blase rechts daneben) */
const strichUnterBlase = { id: 's-unter', tool: 'pen', color: '#16191e', width: 2, anchor: 'f1', seite: 1, seitenBreite: true, points: [[240, 262], [270, 266], [300, 262], [330, 266], [360, 262]] };
const stand = (rolle) => ({
  boards: [{
    id: 'b1', name: 'Skript', edges: [], ...(rolle ? { geteiltRolle: rolle, geteiltVon: 'u-fremd', geteiltName: 'Ada' } : {}),
    drawings: [strichUnterBlase],
    nodes: [
      { id: 'f1', type: 'file', width: 520, position: { x: 60, y: 40 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
      { id: 'n1', type: 'note', width: 240, height: 140, position: { x: 700, y: 60 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Nachbar' }] } },
    ],
    comments: [
      { id: 'c1', nodeId: 'f1', seite: 1, px: 200, py: 260, msgs: [{ author: 'Tester', text: 'Hier fehlt eine Quelle, bitte nachtragen.', at: jetzt }] },
      { id: 'c2', nodeId: 'n1', msgs: [{ author: 'Tester', text: 'Zur Notiz', at: jetzt }] },
    ],
  }],
  spaces: [{ id: 's1', name: 'Studium', projects: [{ id: 'p1', name: 'BWL', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const seite = async (st, opt = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: 'de-DE', ...(opt.touch ? { hasTouch: true } : {}) });
  await ctx.addInitScript((s) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes:author', 'Tester');
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.comment-pin.auf-seite', { timeout: 20000 });
  await P.waitForTimeout(600);
  return { ctx, P };
};
const warteBis = async (P, f, ms = 8000) => { const ende = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(120); } };
const brett = (P) => P.evaluate(() => { try { return JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((b) => b.id === 'b1'); } catch { return null; } });
const faden = async (P, id) => (await brett(P))?.comments?.find((c) => c.id === id) ?? null;
/** Auf einen gespeicherten Stand des Gesprächs warten, der die Bedingung erfüllt */
const fadenBis = (P, id, f, ms = 8000) => warteBis(P, async () => { const c = await faden(P, id); return c && f(c) ? c : null; }, ms);
const kasten = (P, sel) => P.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
const leinwand = (P) => kasten(P, '.react-flow__node[data-id="f1"] .pdf-seite canvas');
/** Bildschirmstelle einer Seitenstelle (Seitenpunkte) */
const aufSchirm = (c, px, py) => [c.l + (px / 612) * c.w, c.t + (py / 792) * c.h];
/** Die Stelle, auf die der Pin zeigt: Mitte seines Kastens liegt 2 × (Zoom-Kehrwert) links oben davon — wir messen gegen die Seite */
const pinStelle = async (P, sel = '.comment-pin.auf-seite') => {
  const p = await kasten(P, sel); const c = await leinwand(P);
  // Pin 22 × 22, verankert bei (13, 13) seines Kastens — skaliert um diesen Punkt
  const s = p.w / 22;
  return { x: p.l + 13 * s, y: p.t + 13 * s, w: p.w, c };
};
const ziehen = async (P, von, nach, schritte = 10) => {
  await P.mouse.move(von[0], von[1]); await P.mouse.down();
  for (let i = 1; i <= schritte; i++) await P.mouse.move(von[0] + ((nach[0] - von[0]) * i) / schritte, von[1] + ((nach[1] - von[1]) * i) / schritte);
  await P.mouse.up();
};
const panelOffen = (P) => P.locator('.comment-panel').count();
const panelZu = async (P) => { if (await panelOffen(P)) { await P.locator('.comment-panel button[aria-label="Schließen"]').click(); await P.waitForTimeout(200); } };

console.log('════ A: Pin auf der Seite ziehen ════');
{
  const { ctx, P } = await seite(stand());
  let st = await pinStelle(P);
  let soll = aufSchirm(st.c, 200, 260);
  pruefe('A1 der Pin zeigt auf seine Stelle der Seite (200/260)', Math.abs(st.x - soll[0]) < 3 && Math.abs(st.y - soll[1]) < 3, { st, soll });
  const k = st.c.w / 612;   // Bildpunkte je Seitenpunkt
  const p0 = await kasten(P, '.comment-pin.auf-seite');
  await P.mouse.move(p0.cx, p0.cy); await P.mouse.down();
  for (let i = 1; i <= 10; i++) await P.mouse.move(p0.cx + 12 * i, p0.cy + 8 * i);
  const mitten = await pinStelle(P);
  await P.waitForTimeout(900);
  const imZug = await faden(P, 'c1');
  pruefe('A2 im Zug folgt der Pin dem Zeiger (Pixel) …', Math.abs(mitten.x - (st.x + 120)) < 3 && Math.abs(mitten.y - (st.y + 80)) < 3, { mitten, st });
  pruefe('A3 … und gespeichert wird erst beim Loslassen', imZug?.px === 200 && imZug?.py === 260, imZug);
  await P.mouse.up();
  const c = (await fadenBis(P, 'c1', (x) => x.px !== 200)) ?? (await faden(P, 'c1'));
  const sollPx = 200 + 120 / k; const sollPy = 260 + 80 / k;
  pruefe('A4 px/py im gespeicherten Stand neu (≈ +120/+80 Bildpunkte auf der Seite), Seite bleibt', c && Math.abs(c.px - sollPx) < 1.5 && Math.abs(c.py - sollPy) < 1.5 && c.seite === 1, { c, sollPx, sollPy });
  st = await pinStelle(P);
  soll = aufSchirm(st.c, c.px, c.py);
  pruefe('A5 der Pin steht an der neuen Stelle', Math.abs(st.x - soll[0]) < 3 && Math.abs(st.y - soll[1]) < 3, { st, soll });
  await P.waitForTimeout(300);
  pruefe('A6 nach dem Zug ist kein Gespräch aufgegangen', (await panelOffen(P)) === 0);
  const p1 = await kasten(P, '.comment-pin.auf-seite');
  await P.mouse.click(p1.cx, p1.cy);
  await warteBis(P, async () => (await panelOffen(P)) === 1, 3000);
  pruefe('A7 ein Klick ohne Bewegung öffnet weiterhin das Gespräch', (await panelOffen(P)) === 1 && /fehlt eine Quelle/.test(await P.locator('.comment-panel').textContent()));
  const nachKlick = await faden(P, 'c1');
  pruefe('A8 … und verschiebt nichts', nachKlick.px === c.px && nachKlick.py === c.py, nachKlick);
  await panelZu(P);
  await P.mouse.click(1300, 900); await P.waitForTimeout(200);
  await P.keyboard.press('Control+z');
  const zurueck = await fadenBis(P, 'c1', (x) => x.px === 200 && x.py === 260);
  st = await pinStelle(P); soll = aufSchirm(st.c, 200, 260);
  pruefe('A9 ein Strg+Z legt den Pin zurück (Stand und Pixel)', !!zurueck && Math.abs(st.x - soll[0]) < 3 && Math.abs(st.y - soll[1]) < 3, { zurueck, st, soll });
  await P.keyboard.press('Control+Shift+z');
  const wieder = await fadenBis(P, 'c1', (x) => Math.abs(x.px - c.px) < 0.01);
  pruefe('A10 Wiederholen legt ihn wieder an die neue Stelle', !!wieder, await faden(P, 'c1'));
  // Über den Rand hinaus: der Pin bleibt auf der Seite
  const p2 = await kasten(P, '.comment-pin.auf-seite');
  await ziehen(P, [p2.cx, p2.cy], [p2.cx + 900, p2.cy - 900], 12);
  const rand = await fadenBis(P, 'c1', (x) => x.px > 600);
  pruefe('A11 über den Seitenrand gezogen bleibt er am Rand der Seite (px ≤ 612, py ≥ 0)', !!rand && rand.px <= 612 && rand.py >= 0 && rand.py < 1, rand);
  pruefe('A12 die Striche und andere Gespräche blieben unberührt', (await brett(P)).drawings.length === 1 && (await faden(P, 'c2')).kx === undefined);
  await ctx.close();
}

console.log('\n════ B: Blase aus dem Weg legen ════');
{
  const { ctx, P } = await seite(stand());
  const b0 = await kasten(P, '.comment-blase');
  const c = await leinwand(P);
  const strichStelle = aufSchirm(c, 330, 266);
  const verdeckt = await P.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.comment-blase'), strichStelle);
  pruefe('B0 vorher liegt die Blase über dem Strich (Ausgangslage)', verdeckt);
  pruefe('B1 die Linie ist da, aber nicht zu sehen (Blase neben dem Pin)', await P.evaluate(() => { const l = document.querySelector('.comment-blase-linie'); return !!l && getComputedStyle(l).display === 'none'; }));
  await ziehen(P, [b0.l + 40, b0.cy], [b0.l + 40 + 160, b0.cy + 150]);
  const g = (await fadenBis(P, 'c1', (x) => x.bx != null)) ?? (await faden(P, 'c1'));
  const k = c.w / 612;
  pruefe('B2 die Blase hat einen eigenen Versatz (bx/by), der Pin blieb (200/260)', g.bx != null && g.px === 200 && g.py === 260 && Math.abs(g.by - (-15 + 150) / k) < 2 && g.bx > 100, g);
  const b1 = await kasten(P, '.comment-blase');
  pruefe('B3 die Blase steht an der neuen Stelle (Pixel)', Math.abs(b1.l - (b0.l + 160)) < 3 && Math.abs(b1.t - (b0.t + 150)) < 3, { b0, b1 });
  const frei = await P.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest('.comment-blase'), strichStelle);
  pruefe('B4 der Inhalt unter der alten Stelle ist frei', frei);
  const linie = await P.evaluate(() => { const l = document.querySelector('.comment-blase-linie'); if (!l) return { an: false }; const r = l.getBoundingClientRect(); return { an: getComputedStyle(l).display !== 'none', w: r.width, h: r.height }; });
  pruefe('B5 eine dünne Linie verbindet Pin und Blase', linie.an && Math.hypot(linie.w, linie.h) > 120, linie);
  pruefe('B6 kein Gespräch aufgegangen', (await panelOffen(P)) === 0);
  await P.mouse.click(b1.cx, b1.cy);
  await warteBis(P, async () => (await panelOffen(P)) === 1, 3000);
  pruefe('B7 ein Klick auf die weggelegte Blase öffnet das Gespräch', (await panelOffen(P)) === 1);
  pruefe('B8 im Gespräch steht „Blase zurück"', (await P.locator('[data-taste="kommentar-blase-zurueck"]').count()) === 1);
  await P.locator('[data-taste="kommentar-blase-zurueck"]').click();
  const zu = await fadenBis(P, 'c1', (x) => x.bx === undefined && x.by === undefined);
  const b2 = await kasten(P, '.comment-blase');
  pruefe('B9 „Blase zurück" legt sie wieder neben den Pin', !!zu && Math.abs(b2.l - b0.l) < 2 && Math.abs(b2.t - b0.t) < 2, { zu, b2, b0 });
  await panelZu(P);
  await P.mouse.click(1300, 900); await P.waitForTimeout(200);
  await P.keyboard.press('Control+z');
  const rueck = await fadenBis(P, 'c1', (x) => x.bx != null);
  pruefe('B10 Strg+Z holt die Lage davor (weggelegt) zurück', !!rueck && Math.abs(rueck.bx - g.bx) < 0.01, rueck);
  const b3 = await kasten(P, '.comment-blase');
  await P.mouse.dblclick(b3.cx, b3.cy);
  const dz = await fadenBis(P, 'c1', (x) => x.bx === undefined);
  pruefe('B11 Doppelklick auf die Blase legt sie ebenfalls zurück', !!dz, await faden(P, 'c1'));
  await panelZu(P);
  await ctx.close();
}

console.log('\n════ C: Radierer in der Hand ════');
{
  const { ctx, P } = await seite(stand());
  await P.mouse.click(1300, 900); await P.waitForTimeout(150);
  await P.keyboard.press('e');
  await warteBis(P, () => P.evaluate(() => { const b = document.querySelector('.comment-blase.durchlaessig'); return !!b && Number(getComputedStyle(b).opacity) <= 0.35; }), 4000);
  const blase = await P.evaluate(() => { const b = document.querySelector('.comment-blase'); const s = getComputedStyle(b); return { op: Number(s.opacity), pe: s.pointerEvents }; });
  pruefe('C1 die Blase tritt zurück (durchsichtig, nimmt keinen Zeiger)', blase.op <= 0.35 && blase.pe === 'none', blase);
  const c = await leinwand(P);
  // quer über den Strich unter der Blase radieren
  const a = aufSchirm(c, 330, 230); const z = aufSchirm(c, 330, 300);
  await ziehen(P, a, z, 8);
  const weg = await warteBis(P, async () => ((await brett(P)).drawings ?? []).every((d) => d.id !== 's-unter') || null, 6000);
  pruefe('C2 der Strich unter der Blase lässt sich radieren', !!weg, (await brett(P)).drawings?.map((d) => d.id));
  const p0 = await kasten(P, '.comment-pin.auf-seite');
  await ziehen(P, [p0.cx, p0.cy], [p0.cx - 60, p0.cy + 90]);
  const k = c.w / 612;
  const ver = await fadenBis(P, 'c1', (x) => x.px !== 200);
  pruefe('C3 der Pin bleibt mit dem Radierer greifbar — ziehen verschiebt ihn', !!ver && Math.abs(ver.px - (200 - 60 / k)) < 1.5 && Math.abs(ver.py - (260 + 90 / k)) < 1.5, ver);
  const p1 = await kasten(P, '.comment-pin.auf-seite');
  await P.mouse.click(p1.cx, p1.cy);
  await warteBis(P, async () => (await panelOffen(P)) === 1, 3000);
  pruefe('C4 … und ein Tipp öffnet das Gespräch', (await panelOffen(P)) === 1);
  await panelZu(P);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  const zurueck = await P.evaluate(() => { const b = document.querySelector('.comment-blase'); const s = getComputedStyle(b); return { op: Number(s.opacity), pe: s.pointerEvents }; });
  pruefe('C5 Werkzeug weggelegt: die Blase ist wieder voll da', zurueck.op > 0.9 && zurueck.pe !== 'none', zurueck);
  await ctx.close();
}

console.log('\n════ D: nur lesen ════');
{
  const { ctx, P } = await seite(stand('lesen'));
  const p0 = await kasten(P, '.comment-pin.auf-seite');
  await ziehen(P, [p0.cx, p0.cy], [p0.cx + 120, p0.cy + 90]);
  await P.waitForTimeout(700);
  const p1 = await kasten(P, '.comment-pin.auf-seite');
  const c = await faden(P, 'c1');
  pruefe('D1 nur lesend geteilt: der Pin bleibt an seiner Stelle (Stand und Pixel)', c.px === 200 && c.py === 260 && Math.abs(p1.l - p0.l) < 1 && Math.abs(p1.t - p0.t) < 1, { c, p0, p1 });
  const b0 = await kasten(P, '.comment-blase');
  await ziehen(P, [b0.l + 30, b0.cy], [b0.l + 200, b0.cy + 120]);
  await P.waitForTimeout(500);
  const b1 = await kasten(P, '.comment-blase');
  pruefe('D2 die Blase bleibt ebenfalls', (await faden(P, 'c1')).bx === undefined && Math.abs(b1.l - b0.l) < 1, { b0, b1 });
  await panelZu(P);
  await P.mouse.click(p1.cx, p1.cy);
  await warteBis(P, async () => (await panelOffen(P)) === 1, 3000);
  pruefe('D3 ein Klick öffnet das Gespräch', (await panelOffen(P)) === 1);
  await ctx.close();
}

console.log('\n════ E: Zoomstufen ════');
for (const zoom of [0.5, 2]) {
  const { ctx, P } = await seite(stand());
  // über Strg+Rad: in kleinen Schritten zum Ziel
  for (let i = 0; i < 40; i++) {
    const z = await P.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
    if (Math.abs(z - zoom) / zoom < 0.04) break;
    const p = await kasten(P, '.comment-pin.auf-seite');
    const ziel = p ? [p.cx, p.cy] : [720, 500];
    await P.mouse.move(Math.min(1400, Math.max(40, ziel[0])), Math.min(960, Math.max(40, ziel[1])));
    await P.keyboard.down('Control'); await P.mouse.wheel(0, z > zoom ? 60 : -60); await P.keyboard.up('Control');
    await P.waitForTimeout(90);
  }
  await P.waitForTimeout(700);
  const z = await P.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
  const p = await kasten(P, '.comment-pin.auf-seite');
  // Bedienelemente auf dem Board (M343/M404): Kehrwert des Zooms, gekappt auf 0,6 … 7 (über 250 %: 1,5 / Zoom)
  const inv = Math.round((z > 2.5 ? 1.5 / z : Math.max(0.6, Math.min(7, 1 / z))) * 20) / 20;
  const sollW = 22 * inv * z;
  pruefe(`E1 Zoom ${Math.round(z * 100)} %: der Pin hat die Bildschirm-Größe der Bedienelemente (${sollW.toFixed(1)} Bildpunkte, bei 100 % 22)`, Math.abs(z - zoom) / zoom < 0.08 && Math.abs(p.w - sollW) < 1.5 && p.w < 34, { z, w: p.w, sollW });
  const st = await pinStelle(P);
  const soll = aufSchirm(st.c, 200, 260);
  pruefe(`E2 Zoom ${Math.round(z * 100)} %: er zeigt weiter auf 200/260`, Math.abs(st.x - soll[0]) < 3 && Math.abs(st.y - soll[1]) < 3, { st, soll });
  const k = st.c.w / 612;
  await ziehen(P, [p.cx, p.cy], [p.cx + 60, p.cy + 40]);
  const c = await fadenBis(P, 'c1', (x) => x.px !== 200);
  pruefe(`E3 Zoom ${Math.round(z * 100)} %: 60/40 Bildpunkte gezogen = 60/40 Bildpunkte auf der Seite`, !!c && Math.abs(c.px - (200 + 60 / k)) < 1.5 && Math.abs(c.py - (260 + 40 / k)) < 1.5, { c, k });
  const b = await kasten(P, '.comment-blase');
  const bMax = 192 * Math.max(1, inv * z) + 1;
  pruefe(`E4 Zoom ${Math.round(z * 100)} %: die Blase wächst nicht mit der Seite (≤ ${Math.round(bMax)} Bildpunkte breit; mit der Seite wären es ${Math.round(190 * z)})`, b.w <= bMax, b);
  await ctx.close();
}

console.log('\n════ F: Pin an einer Karte ════');
{
  const { ctx, P } = await seite(stand());
  const sel = '.comment-pin:not(.auf-seite)';
  const n = await kasten(P, '.react-flow__node[data-id="n1"]');
  const p0 = await kasten(P, sel);
  pruefe('F0 der Karten-Pin sitzt rechts außerhalb der Ecke', p0.l >= n.r - 1 && p0.cy < n.t + 14, { p0, n });
  // in die Karte, an den unteren Rand
  await ziehen(P, [p0.cx, p0.cy], [n.l + n.w * 0.3, n.t + n.h * 0.9]);
  const c = await fadenBis(P, 'c2', (x) => x.kx != null);
  pruefe('F1 kx/ky gespeichert (≈ 30 % / 90 % der Karte)', !!c && Math.abs(c.kx - 0.3) < 0.06 && Math.abs(c.ky - 0.9) < 0.06 && c.seite === undefined, c);
  const p1 = await kasten(P, sel);
  pruefe('F2 der Pin steht dort', Math.abs(p1.cx - (n.l + n.w * 0.3)) < 6 && Math.abs(p1.cy - (n.t + n.h * 0.9)) < 6, { p1, n });
  // die Karte verschieben: der Pin geht mit
  const kopf = await kasten(P, '.react-flow__node[data-id="n1"]');
  await ziehen(P, [kopf.l + 20, kopf.t + 8], [kopf.l + 20, kopf.t + 108]);
  await P.waitForTimeout(400);
  const n2 = await kasten(P, '.react-flow__node[data-id="n1"]'); const p2 = await kasten(P, sel);
  pruefe('F3 die Karte zieht ihren verschobenen Pin mit', Math.abs((p2.cy - n2.t) - (p1.cy - n.t)) < 4 && n2.t - n.t > 60, { p1, p2, n, n2 });
  await P.mouse.click(1300, 900); await P.waitForTimeout(150);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(300);
  await P.keyboard.press('Control+z');
  const zu = await fadenBis(P, 'c2', (x) => x.kx === undefined);
  const p3 = await kasten(P, sel); const n3 = await kasten(P, '.react-flow__node[data-id="n1"]');
  pruefe('F4 zweimal Strg+Z: Karte und Pin wieder an der Ecke', !!zu && p3.l >= n3.r - 1 && p3.cy < n3.t + 14, { zu, p3, n3 });
  await ctx.close();
}

console.log('\n════ G: Finger ════');
{
  const { ctx, P } = await seite(stand(), { touch: true });
  const p0 = await kasten(P, '.comment-pin.auf-seite');
  const k = (await leinwand(P)).w / 612;
  await P.evaluate(async ({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const mk = (typ, dx, dy) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y + dy, buttons: typ === 'pointerup' ? 0 : 1, button: 0 });
    el.dispatchEvent(mk('pointerdown', 0, 0));
    for (let i = 1; i <= 8; i++) { el.dispatchEvent(mk('pointermove', -10 * i, 10 * i)); await new Promise((r) => setTimeout(r, 16)); }
    el.dispatchEvent(mk('pointerup', -80, 80));
  }, { x: p0.cx, y: p0.cy });
  const c = (await fadenBis(P, 'c1', (x) => x.px !== 200)) ?? (await faden(P, 'c1'));
  pruefe('G1 mit dem Finger gezogen: Pin verschoben', c.px !== 200 && Math.abs(c.px - (200 - 80 / k)) < 1.5 && Math.abs(c.py - (260 + 80 / k)) < 1.5, c);
  await P.evaluate(async ({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const mk = (typ, dx) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: 42, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y, buttons: typ === 'pointerup' ? 0 : 1, button: 0 });
    el.dispatchEvent(mk('pointerdown', 0)); el.dispatchEvent(mk('pointermove', 5)); el.dispatchEvent(mk('pointerup', 5));
  }, { x: p0.cx - 80, y: p0.cy + 80 });
  await warteBis(P, async () => (await panelOffen(P)) === 1, 3000);
  pruefe('G2 ein Finger-Tipp mit kleinem Zittern (5 Bildpunkte) öffnet das Gespräch und verschiebt nichts', (await panelOffen(P)) === 1 && (await faden(P, 'c1')).px === c.px);
  await ctx.close();
}

console.log('\n════ H: Präsentation ════');
{
  const { ctx, P } = await seite(stand());
  await P.keyboard.press('Escape'); await P.mouse.click(1300, 900); await P.waitForTimeout(250);
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click();
  await P.waitForSelector('.presenter', { timeout: 8000 }); await P.waitForTimeout(700);
  const dok = () => P.evaluate(() => !!document.querySelector('.presenter-slide.dokument'));
  for (let i = 0; i < 6 && !(await dok()); i++) { await P.locator('[data-taste="vortrag-weiter"]').click(); await P.waitForTimeout(450); }
  await warteBis(P, () => P.evaluate(() => !!document.querySelector('[data-taste="folien-pin"]')), 8000);
  const pin = await kasten(P, '[data-taste="folien-pin"] circle'); const t = await kasten(P, '.folie-dok-seite');
  pruefe('H0 die Dokument-Folie zeigt den Pin', !!pin && !!t, { pin, t });
  if (pin && t) {
    const k = t.w / 612;
    await ziehen(P, [pin.cx, pin.cy], [pin.cx + 100, pin.cy + 50]);
    const c = await fadenBis(P, 'c1', (x) => x.px !== 200);
    pruefe('H1 in der Präsentation gezogen: px/py neu', !!c && Math.abs(c.px - (200 + 100 / k)) < 2 && Math.abs(c.py - (260 + 50 / k)) < 2, { c, k });
    const pin2 = await kasten(P, '[data-taste="folien-pin"] circle');
    pruefe('H2 der Pin steht dort', Math.abs(pin2.cx - (t.l + (c.px / 612) * t.w)) < 3 && Math.abs(pin2.cy - (t.t + (c.py / 792) * t.h)) < 3, { pin2, t });
    pruefe('H3 der Zug öffnete keine Spalte', (await P.locator('.folien-kommentare').count()) === 0);
    await P.mouse.click(pin2.cx, pin2.cy);
    await warteBis(P, async () => (await P.locator('.folien-kommentare').count()) === 1, 3000);
    pruefe('H4 ein Tipp öffnet die Spalte mit dem Gespräch', (await P.locator('.folien-kommentare').count()) === 1);
  }
  await ctx.close();
}

console.log('\n════ I ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('I1 Hilfe („Was ist neu") nennt M546', js.includes('(M546)'));
pruefe('I2 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3));

await browser.close(); app.close();
console.log(`\nm546-kommentar-verschieben: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
