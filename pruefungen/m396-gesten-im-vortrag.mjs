/**
 * M396 — Finger-Gesten in der Präsentation, während man mit dem Stift arbeitet.
 *
 * Gewünscht: „Auch die Multitouch-Gesten sollen funktionieren, wenn man im Präsentationsmodus mit dem Stift arbeitet."
 *
 *   A  Gerät mit Stift, Stift gewählt: Der Stift schreibt; die aufgelegte Hand stört nicht. Zwei Finger schieben
 *      die Folie und zoomen die Dokument-Seite; Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen,
 *      halten = schnell zurück; ein schneller Wisch blättert; der Stift geht vor, auch wenn ein Finger schiebt.
 *   B  Gerät ohne Stift: Ein Finger zeichnet; kommt ein zweiter dazu, war es kein Strich — zwei Finger schieben.
 *   C  Ohne gewähltes Werkzeug gelten die Tipp-Gesten ebenso; in Textfeldern nicht.
 *   D  Der Schalter „Finger-Gesten" schaltet die Tipp-Gesten ab.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m396-gesten-im-vortrag.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4712;
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
const pdf = pdfErzeugen(3);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const absatz = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] });
const stand = (rolle) => ({
  boards: [{
    id: 'b1', name: 'Vortrag', edges: [], drawings: [], ...(rolle ? { geteiltRolle: rolle, geteiltVon: 'u-fremd', geteiltName: 'Ada' } : {}),
    comments: [
      { id: 'c-notiz', nodeId: 'n1', msgs: [{ author: 'Ada', text: 'Zahl bitte prüfen', at: '2026-11-10T09:00:00.000Z' }] },
      { id: 'c-s2', nodeId: 'p1', seite: 2, px: 300, py: 400, msgs: [{ author: 'Ben', text: 'Quelle für Seite zwei?', at: '2026-11-11T09:00:00.000Z' }] },
      { id: 'c-s3', nodeId: 'p1', seite: 3, px: 200, py: 200, msgs: [{ author: 'Ben', text: 'Anhang fehlt', at: '2026-11-12T09:00:00.000Z' }] },
    ],
    nodes: [
      { id: 'n1', type: 'note', position: { x: 40, y: 60 }, width: 300, height: 220, data: { title: 'Einstieg', blocks: [absatz('Erstens: worum es geht.'), absatz('Zweitens: was wir entscheiden.'), absatz('Drittens: wer was übernimmt.')] } },
      { id: 'p1', type: 'file', width: 420, position: { x: 400, y: 60 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
    ],
  }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const seite = async (st, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE', hasTouch: true });
  await ctx.addInitScript(([s, e]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes:author', 'Cleo');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ p1: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, [st, extra]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
};
const bisAuf = (P) => async (f, ms = 6000) => { const ende = Date.now() + ms; for (;;) { if (await f()) return true; if (Date.now() > ende) return false; await P.waitForTimeout(120); } };
const brettVon = (P) => P.evaluate(() => { const st = JSON.parse(localStorage.getItem('pixinotes-board')).state; return st.boards.find((b) => b.id === 'b1'); });
/** Der Speicher schreibt mit Verzögerung — auf den Stand im Gerät warten */
const striche = async (P, filter, ms = 5000) => {
  const ende = Date.now() + ms; let l = [];
  for (;;) { l = ((await brettVon(P)).drawings ?? []).filter(filter); if (l.length || Date.now() > ende) return l; await P.waitForTimeout(150); }
};
const kasten = (P, sel) => P.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const ziehen = async (P, punkte) => {
  await P.mouse.move(punkte[0][0], punkte[0][1]); await P.mouse.down();
  for (const p of punkte.slice(1)) await P.mouse.move(p[0], p[1], { steps: 6 });
  await P.mouse.up(); await P.waitForTimeout(250);
};
const vortragAuf = async (P) => {
  await P.keyboard.press('Escape'); await P.mouse.click(1200, 760); await P.waitForTimeout(250);
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click();
  await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(700);
};
const aufFolie = async (P, art) => {
  const da = () => P.evaluate((a) => (a === 'dok' ? !!document.querySelector('.presenter-slide.dokument') : !document.querySelector('.presenter-slide.dokument')), art);
  for (let i = 0; i < 8 && !(await da()); i++) { await P.locator(`[data-taste="${art === 'dok' ? 'vortrag-weiter' : 'vortrag-zurueck'}"]`).click(); await P.waitForTimeout(450); }
  await P.waitForTimeout(600);
  return da();
};
const dokSeite = (P) => P.evaluate(() => Number(document.querySelector('.folie-dok')?.getAttribute('data-seite') ?? 0));


/** Zeiger-Ereignis an der Zeichenschicht (oder an der Stelle, wenn keine Schicht fängt) */
const zeiger = (P, typ, art, id, x, y, druck = 0.5) => P.evaluate(([t, a, i, px, py, d]) => {
  const schicht = document.querySelector('.folien-stift.an');
  const el = schicht ?? document.elementFromPoint(px, py) ?? document.body;
  el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: i, pointerType: a, clientX: px, clientY: py, pressure: t === 'pointerup' ? 0 : d, buttons: t === 'pointerup' ? 0 : 1, isPrimary: i === 11 || i === 21 }));
}, [typ, art, id, x, y, druck]);
/** Berührungs-Ereignis (für die Tipp-Gesten): alle Finger der Liste liegen auf, `geaendert` sind die bewegten */
const beruehrung = (P, typ, liegen, geaendert) => P.evaluate(([t, l, g]) => {
  const el = document.elementFromPoint(g[0][1], g[0][2]) ?? document.body;
  const mk = ([i, x, y]) => new Touch({ identifier: i, target: el, clientX: x, clientY: y, touchType: 'direct' });
  const touches = l.map(mk);
  el.dispatchEvent(new TouchEvent(t, { bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: g.map(mk) }));
}, [typ, liegen, geaendert]);
/** n Finger kurz auftippen (Zeiger- und Berührungs-Ereignisse, wie ein echtes Gerät sie schickt) */
const tippe = async (P, stellen, halteMs = 60) => {
  const f = stellen.map((s, i) => [21 + i, s[0], s[1]]);
  for (let i = 0; i < f.length; i++) { await zeiger(P, 'pointerdown', 'touch', f[i][0], f[i][1], f[i][2]); await beruehrung(P, 'touchstart', f.slice(0, i + 1), [f[i]]); }
  await P.waitForTimeout(halteMs);
  for (let i = f.length - 1; i >= 0; i--) { await zeiger(P, 'pointerup', 'touch', f[i][0], f[i][1], f[i][2]); await beruehrung(P, 'touchend', f.slice(0, i), [f[i]]); }
  await P.waitForTimeout(250);
};
const stiftStrich = async (P, punkte) => {
  await zeiger(P, 'pointerdown', 'pen', 11, punkte[0][0], punkte[0][1], 0.4);
  for (const p of punkte.slice(1)) await zeiger(P, 'pointermove', 'pen', 11, p[0], p[1], 0.6);
  const l = punkte[punkte.length - 1];
  await zeiger(P, 'pointerup', 'pen', 11, l[0], l[1]);
  await P.waitForTimeout(200);
};
const linie = (x0, y0, x1, y1, n = 8) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n + (i % 2) * 6]);
const rollstand = (P) => P.evaluate(() => { const e = document.querySelector('.folie-dok-flaeche'); return e ? { oben: e.scrollTop, links: e.scrollLeft } : null; });
const zoomstand = (P) => P.evaluate(() => Number(document.querySelector('.folie-dok')?.getAttribute('data-zoom') ?? 0));
const anzahl = async (P, filter = () => true) => ((await brettVon(P)).drawings ?? []).filter(filter).length;
const toast = (P) => P.evaluate(() => document.querySelector('.toast.show')?.textContent ?? '');
const seiteBreit = async (P) => {     // Seitenbreite: die Seite ist höher als der Schirm, es gibt etwas zu rollen
  if ((await P.evaluate(() => document.querySelector('.folie-dok')?.getAttribute('data-modus'))) !== 'breite') { await P.keyboard.press('b'); await P.waitForTimeout(500); }
  await P.evaluate(() => { const e = document.querySelector('.folie-dok-flaeche'); e.scrollTop = 0; e.scrollLeft = 0; });
};

console.log('\n════ A: Gerät mit Stift ════');
{
  const { ctx, P } = await seite(stand());
  const bis = bisAuf(P);
  await vortragAuf(P);
  pruefe('A0 die PDF-Folie ist offen', await aufFolie(P, 'dok') && await bis(async () => !!(await kasten(P, '.folie-dok-seite canvas')), 8000));
  await seiteBreit(P);
  await P.keyboard.press('p'); await P.waitForTimeout(300);
  const t = await kasten(P, '.folie-dok-seite');
  // Stift schreibt, die Hand liegt dabei auf
  await zeiger(P, 'pointerdown', 'pen', 11, t.l + 200, 300, 0.4);
  await zeiger(P, 'pointermove', 'pen', 11, t.l + 240, 306, 0.5);
  const vor = await rollstand(P);
  await zeiger(P, 'pointerdown', 'touch', 21, t.l + 500, 600); await beruehrung(P, 'touchstart', [[21, t.l + 500, 600]], [[21, t.l + 500, 600]]);
  await zeiger(P, 'pointermove', 'touch', 21, t.l + 500, 480);
  await zeiger(P, 'pointermove', 'pen', 11, t.l + 300, 300, 0.6); await zeiger(P, 'pointermove', 'pen', 11, t.l + 360, 308, 0.7);
  await zeiger(P, 'pointerup', 'touch', 21, t.l + 500, 480); await beruehrung(P, 'touchend', [], [[21, t.l + 500, 480]]);
  await zeiger(P, 'pointerup', 'pen', 11, t.l + 360, 308);
  await P.waitForTimeout(300);
  const s1 = (await striche(P, (x) => x.anchor === 'p1'))[0];
  const xs = s1 ? s1.points.map((p) => p[0]) : [];
  pruefe('A1 der Stift schreibt — die aufgelegte Hand rollt nichts und unterbricht den Strich nicht', !!s1 && (await anzahl(P)) === 1 && Math.max(...xs) - Math.min(...xs) > 60 && (await rollstand(P)).oben === vor.oben, { n: await anzahl(P), xs: [Math.min(...xs), Math.max(...xs)], roll: await rollstand(P) });
  // zwei Finger schieben
  const a = [t.l + 400, 600]; const b = [t.l + 600, 600];
  await zeiger(P, 'pointerdown', 'touch', 21, a[0], a[1]); await zeiger(P, 'pointerdown', 'touch', 22, b[0], b[1]);
  for (let i = 1; i <= 6; i++) { await zeiger(P, 'pointermove', 'touch', 21, a[0], a[1] - i * 30); await zeiger(P, 'pointermove', 'touch', 22, b[0], b[1] - i * 30); }
  await zeiger(P, 'pointerup', 'touch', 22, b[0], b[1] - 180); await zeiger(P, 'pointerup', 'touch', 21, a[0], a[1] - 180);
  await P.waitForTimeout(250);
  const nach = await rollstand(P);
  pruefe('A2 zwei Finger schieben die Folie (rund 180 Punkte) — gezeichnet wird dabei nichts', Math.abs(nach.oben - vor.oben - 180) < 20 && (await anzahl(P)) === 1, { vor, nach, n: await anzahl(P) });
  // zwei Finger kneifen: zoomen um die Mitte
  const z0 = await zoomstand(P);
  const m = [t.l + 500, 450];
  await zeiger(P, 'pointerdown', 'touch', 21, m[0] - 60, m[1]); await zeiger(P, 'pointerdown', 'touch', 22, m[0] + 60, m[1]);
  for (let i = 1; i <= 6; i++) { await zeiger(P, 'pointermove', 'touch', 21, m[0] - 60 - i * 15, m[1]); await zeiger(P, 'pointermove', 'touch', 22, m[0] + 60 + i * 15, m[1]); await P.waitForTimeout(30); }
  await zeiger(P, 'pointerup', 'touch', 21, m[0] - 150, m[1]); await zeiger(P, 'pointerup', 'touch', 22, m[0] + 150, m[1]);
  await P.waitForTimeout(400);
  const z1 = await zoomstand(P);
  pruefe('A3 zwei Finger auseinander: die Seite wird größer (rund 2,5-fach)', z1 > z0 * 2 && z1 < z0 * 3, { z0, z1 });
  pruefe('A4 auch dabei entsteht kein Strich', (await anzahl(P)) === 1);
  await P.keyboard.press('Escape'); await P.locator('[data-taste="folie-modus"]').click(); await P.waitForTimeout(400); await P.keyboard.press('p'); await P.waitForTimeout(250);
  // Tipp-Gesten
  await tippe(P, [[t.l + 400, 500], [t.l + 520, 500]]);
  const t5 = await toast(P);
  pruefe('A5 Zwei-Finger-Tipp macht den Strich rückgängig — mit Meldung', await bis(async () => (await anzahl(P)) === 0) && /Rückgängig \(Zwei-Finger-Tipp\)/.test(t5), { n: await anzahl(P), t: await toast(P) });
  await tippe(P, [[t.l + 400, 500], [t.l + 520, 500], [t.l + 640, 500]]);
  const t6 = await toast(P);
  pruefe('A6 Drei-Finger-Tipp holt ihn wieder', await bis(async () => (await anzahl(P)) === 1) && /Wiederholen \(Drei-Finger-Tipp\)/.test(t6), { n: await anzahl(P), t: await toast(P) });
  // halten = schnell zurück
  await stiftStrich(P, linie(t.l + 200, 380, t.l + 380, 380)); await stiftStrich(P, linie(t.l + 200, 430, t.l + 380, 430)); await stiftStrich(P, linie(t.l + 200, 480, t.l + 380, 480));
  await bis(async () => (await anzahl(P)) === 4);
  await tippe(P, [[t.l + 500, 600], [t.l + 620, 600]], 1300);
  pruefe('A7 zwei Finger halten: Schritt für Schritt schnell zurück (mehrere Striche)', await bis(async () => (await anzahl(P)) <= 1), { n: await anzahl(P) });
  // Wisch blättert
  const seiteVor = await dokSeite(P);
  await zeiger(P, 'pointerdown', 'touch', 21, t.l + 700, 500);
  for (let i = 1; i <= 5; i++) await zeiger(P, 'pointermove', 'touch', 21, t.l + 700 - i * 40, 500 + i);
  await zeiger(P, 'pointerup', 'touch', 21, t.l + 500, 505);
  await P.waitForTimeout(900);
  pruefe('A8 ein schneller Wisch nach links blättert weiter', (await dokSeite(P)) === seiteVor + 1, { vor: seiteVor, nach: await dokSeite(P) });
  // der Stift geht vor, auch wenn ein Finger gerade schiebt
  const n0 = await anzahl(P);
  await zeiger(P, 'pointerdown', 'touch', 21, t.l + 600, 600);
  await zeiger(P, 'pointermove', 'touch', 21, t.l + 600, 590);
  await stiftStrich(P, linie(t.l + 220, 320, t.l + 400, 320));
  await zeiger(P, 'pointerup', 'touch', 21, t.l + 600, 590);
  pruefe('A9 der Stift geht vor: Er schreibt, auch wenn gerade ein Finger auf der Folie liegt', await bis(async () => (await anzahl(P)) === n0 + 1), { n0, n: await anzahl(P) });
  await P.screenshot({ path: path.join(SD, 'm396-a-stift.png') });

  console.log('\n════ C: ohne gewähltes Werkzeug ════');
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.waitForTimeout(1200);
  const n1 = await anzahl(P);
  await tippe(P, [[t.l + 400, 500], [t.l + 520, 500]]);
  pruefe('C1 auch ohne Stift in der Hand: Zwei-Finger-Tipp auf die Folie macht rückgängig', n1 > 0 && await bis(async () => (await anzahl(P)) === n1 - 1), { n1, n: await anzahl(P) });
  await aufFolie(P, 'folie');
  await P.waitForTimeout(1200);
  const n2 = await anzahl(P);
  const notiz = await kasten(P, '.presenter-slide .slide-note');
  await tippe(P, [[notiz.l + 80, notiz.t + 40], [notiz.l + 200, notiz.t + 40]]);
  await P.waitForTimeout(1200);
  pruefe('C2 im Text einer Notiz-Folie gilt die Geste nicht (dort gehören zwei Finger dem Text)', (await anzahl(P)) === n2, { n2, n: await anzahl(P) });
  await P.keyboard.press('p'); await P.waitForTimeout(250);
  await stiftStrich(P, linie(notiz.l + 60, notiz.t + 30, notiz.l + 240, notiz.t + 30));
  await bis(async () => (await anzahl(P)) === n2 + 1);
  await tippe(P, [[notiz.l + 80, notiz.t + 40], [notiz.l + 200, notiz.t + 40]]);
  pruefe('C3 mit gewähltem Stift liegt die Zeichenschicht darüber — dann gilt sie auch dort', await bis(async () => (await anzahl(P)) === n2), { n2, n: await anzahl(P) });
  await ctx.close();
}

console.log('\n════ B: Gerät ohne Stift ════');
{
  const { ctx, P } = await seite(stand());
  const bis = bisAuf(P);
  await vortragAuf(P); await aufFolie(P, 'dok'); await bis(async () => !!(await kasten(P, '.folie-dok-seite canvas')), 8000);
  await seiteBreit(P);
  await P.keyboard.press('p'); await P.waitForTimeout(300);
  const t = await kasten(P, '.folie-dok-seite');
  await zeiger(P, 'pointerdown', 'touch', 21, t.l + 200, 300);
  for (let i = 1; i <= 6; i++) await zeiger(P, 'pointermove', 'touch', 21, t.l + 200 + i * 25, 300 + (i % 2) * 8);
  await zeiger(P, 'pointerup', 'touch', 21, t.l + 350, 300);
  pruefe('B1 ohne Stift zeichnet der Finger', await bis(async () => (await anzahl(P)) === 1), { n: await anzahl(P) });
  const vor = await rollstand(P);
  await zeiger(P, 'pointerdown', 'touch', 21, t.l + 400, 600);
  await zeiger(P, 'pointermove', 'touch', 21, t.l + 402, 598);
  await zeiger(P, 'pointerdown', 'touch', 22, t.l + 600, 600);
  for (let i = 1; i <= 6; i++) { await zeiger(P, 'pointermove', 'touch', 21, t.l + 400, 600 - i * 30); await zeiger(P, 'pointermove', 'touch', 22, t.l + 600, 600 - i * 30); }
  await zeiger(P, 'pointerup', 'touch', 22, t.l + 600, 420);
  // der liegengebliebene Finger bewegt sich noch — das ist kein Strich mehr
  await zeiger(P, 'pointermove', 'touch', 21, t.l + 430, 400); await zeiger(P, 'pointermove', 'touch', 21, t.l + 470, 390);
  await zeiger(P, 'pointerup', 'touch', 21, t.l + 470, 390);
  await P.waitForTimeout(400);
  const nach = await rollstand(P);
  pruefe('B2 kommt ein zweiter Finger dazu, war es kein Strich: zwei Finger schieben, nichts wird gezeichnet', Math.abs(nach.oben - vor.oben - 180) < 24 && (await anzahl(P)) === 1, { vor, nach, n: await anzahl(P) });
  await tippe(P, [[t.l + 400, 500], [t.l + 520, 500]]);
  pruefe('B3 Zwei-Finger-Tipp: rückgängig — und kein Punkt bleibt zurück', await bis(async () => (await anzahl(P)) === 0) && (await P.waitForTimeout(800), (await anzahl(P)) === 0), { n: await anzahl(P) });
  await ctx.close();
}

console.log('\n════ D: Schalter „Finger-Gesten" aus ════');
{
  const st = stand();
  const { ctx, P } = await seite({ ...st, fingerGesten: false });
  const bis = bisAuf(P);
  await vortragAuf(P); await aufFolie(P, 'dok'); await bis(async () => !!(await kasten(P, '.folie-dok-seite canvas')), 8000);
  await P.keyboard.press('p'); await P.waitForTimeout(300);
  const t = await kasten(P, '.folie-dok-seite');
  await stiftStrich(P, linie(t.l + 200, 300, t.l + 380, 300));
  await bis(async () => (await anzahl(P)) === 1);
  const aus = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.fingerGesten);
  await tippe(P, [[t.l + 400, 500], [t.l + 520, 500]]);
  await P.waitForTimeout(1200);
  pruefe('D1 ist der Schalter aus, macht der Zwei-Finger-Tipp nichts', aus === false && (await anzahl(P)) === 1, { aus, n: await anzahl(P) });
  await ctx.close();
}

console.log('\n════ E: Texte ════');
{
  const de = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
  const en = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf-8');
  pruefe('E1 die Hilfe nennt M396 — deutsch und englisch', de.includes('(M396)') && en.includes('(M396)'));
  pruefe('E2 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm396-gesten-im-vortrag: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
