/**
 * M394 — Stift, Textmarker, Radierer und Kommentare in der Präsentation.
 *
 * Gewünscht: „Könnte man auch im Präsentations-Modus Kommentare und Stift-Funktionen nutzbar machen?"
 *
 *   A  Auf eine Folie zeichnen (Notiz): Der Stift-Knopf in der Kopfzeile holt die Werkzeuge; Stift, Textmarker,
 *      Farben, Radierer, Rückgängig; Esc legt den Stift weg. Die Striche gehören der Folie (Seite −1, Tausendstel
 *      der Inhaltsbreite), bleiben beim Ändern der Fenstergröße an ihrer Stelle und stören das Board nicht.
 *   B  Auf eine Dokument-Seite zeichnen (PDF): gewöhnliche Seiten-Anmerkungen in Seitenpunkten — sie bleiben beim
 *      Zoomen an der Stelle, gelten je Seite und stehen danach auch auf dem Board an der Seite.
 *   C  Kommentare: Zahl am Knopf, Spalte neben der Folie, neu schreiben, antworten, erledigen; bei Dokumenten je
 *      Seite, Pins an ihrer Stelle, Sprung zu anderen Seiten. Esc: erst Stift, dann Spalte, dann Präsentation.
 *   D  Nur lesen: keine Werkzeuge, keine Eingabe — Striche und Kommentare bleiben zu sehen.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m394-stift-im-vortrag.mjs`
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
const PORT = 4710;
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
const seite = async (st) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript((s) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes:author', 'Cleo');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ p1: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, st);
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

const { ctx, P } = await seite(stand());
const bis = bisAuf(P);

console.log('\n════ A: Auf eine Folie zeichnen ════');
{
  await vortragAuf(P);
  await aufFolie(P, 'folie');
  pruefe('A1 in der Kopfzeile: ein Stift- und ein Kommentar-Knopf – keine Werkzeugleiste, solange nicht gezeichnet wird',
    (await P.locator('[data-taste="vortrag-stift"]').count()) === 1 && (await P.locator('[data-taste="vortrag-kommentare"]').count()) === 1 && (await P.locator('.folien-palette').count()) === 0);
  await P.locator('[data-taste="vortrag-stift"]').click(); await P.waitForTimeout(300);
  pruefe('A2 der Stift-Knopf holt die Werkzeuge, der Stift ist gewählt', (await P.locator('[data-taste="folien-pen"][aria-pressed="true"]').count()) === 1 && (await P.locator('.folien-stift.an.pen').count()) === 1);
  const n = await kasten(P, '.presenter-slide .slide-note');
  const von = [n.l + n.w * 0.2, n.t + 40]; const nach = [n.l + n.w * 0.6, n.t + 90];
  await ziehen(P, [von, [n.l + n.w * 0.4, n.t + 80], nach]);
  const s1 = (await striche(P, (s) => s.anchor === 'n1'))[0];
  pruefe('A3 der Strich gehört der Folie der Karte: Seite −1, Stift, rot', !!s1 && s1.seite === -1 && s1.tool === 'pen' && s1.color === '#e0392b' && s1.seitenBreite === true, s1 && { seite: s1.seite, tool: s1.tool, color: s1.color });
  const xs = s1 ? s1.points.map((p) => p[0]) : [];
  pruefe('A4 er liegt in Tausendsteln der Inhaltsbreite (20 % … 60 %)', xs.length > 1 && Math.abs(Math.min(...xs) - 200) < 12 && Math.abs(Math.max(...xs) - 600) < 12, [Math.min(...xs), Math.max(...xs)]);
  const pfad = await kasten(P, '.folien-stift svg path');
  pruefe('A5 und steht auf der Folie dort, wo gezeichnet wurde', !!pfad && Math.abs(pfad.l - von[0]) < 6 && Math.abs(pfad.r - nach[0]) < 6 && pfad.t >= von[1] - 6 && pfad.b <= nach[1] + 6, { pfad, von, nach });
  // Textmarker per Taste, andere Farbe
  await P.keyboard.press('m'); await P.waitForTimeout(200);
  pruefe('A6 M wählt den Textmarker, die Farben wechseln mit', (await P.locator('[data-taste="folien-marker"][aria-pressed="true"]').count()) === 1 && (await P.locator('[data-taste="folien-farbe"]').first().getAttribute('data-farbe')) === '#fff200');
  await P.locator('[data-taste="folien-farbe"]').nth(3).click();
  await ziehen(P, [[n.l + n.w * 0.2, n.t + 150], [n.l + n.w * 0.7, n.t + 150]]);
  const s2 = (await striche(P, (s) => s.anchor === 'n1' && s.tool === 'marker'))[0];
  pruefe('A7 der Marker-Strich trägt die gewählte Farbe und ist breit', !!s2 && s2.color === '#ff2d95' && s2.width > (s1?.width ?? 99) * 3, s2 && { color: s2.color, width: s2.width, stift: s1?.width });
  await P.screenshot({ path: path.join(SD, 'm394-a-folie.png') });
  // Radierer
  await P.keyboard.press('e'); await P.waitForTimeout(200);
  await ziehen(P, [[n.l + n.w * 0.4, n.t + 30], [n.l + n.w * 0.4, n.t + 110]]);
  pruefe('A8 der Radierer nimmt den Strich, den er berührt – den anderen nicht', await bis(async () => { const d = (await brettVon(P)).drawings ?? []; return d.length === 1 && d[0].tool === 'marker'; }), ((await brettVon(P)).drawings ?? []).map((s) => s.tool));
  await P.locator('[data-taste="folien-zurueck"]').click();
  pruefe('A9 Rückgängig holt ihn wieder', await bis(async () => ((await brettVon(P)).drawings ?? []).length === 2));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  pruefe('A10 Esc legt den Stift weg – die Präsentation bleibt, die Werkzeuge sind fort, die Striche stehen',
    (await P.locator('.presenter').count()) === 1 && (await P.locator('.folien-palette').count()) === 0 && (await P.locator('.folien-stift.an').count()) === 0 && (await P.locator('.folien-stift svg path').count()) === 2);
  pruefe('A11 ohne Stift gehört die Folie wieder dem Inhalt (die Schicht fängt nichts ab)', await P.evaluate(() => { const r = document.querySelector('.presenter-slide .slide-note').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + 50)?.closest('.slide-note'); }));
  // andere Fenstergröße: der Strich bleibt an seiner Stelle der Folie
  const rel = async () => { const f = await kasten(P, '.presenter-slide .slide-note'); const p = await kasten(P, '.folien-stift svg path.strich'); return p && f ? [(p.l - f.l) / f.w, (p.r - f.l) / f.w] : null; };
  const vorher = await rel();
  await P.setViewportSize({ width: 1100, height: 760 }); await P.waitForTimeout(700);
  const nachher = await rel();
  pruefe('A12 kleineres Fenster: der Strich bleibt an derselben Stelle des Inhalts', !!vorher && !!nachher && Math.abs(vorher[0] - nachher[0]) < 0.012 && Math.abs(vorher[1] - nachher[1]) < 0.012, { vorher, nachher });
  await P.setViewportSize({ width: 1400, height: 900 }); await P.waitForTimeout(500);
}

console.log('\n════ B: Auf eine Dokument-Seite zeichnen ════');
{
  pruefe('B0 die PDF-Folie ist offen', await aufFolie(P, 'dok') && await bis(async () => !!(await kasten(P, '.folie-dok-seite canvas')), 8000));
  await P.waitForTimeout(800);
  pruefe('B1 die Striche der Notiz-Folie stehen hier nicht', (await P.locator('.folien-stift svg path').count()) === 0);
  await P.keyboard.press('p'); await P.waitForTimeout(250);
  const s = await kasten(P, '.folie-dok-seite');
  const a = [s.l + s.w * 0.25, s.t + s.h * 0.25]; const b = [s.l + s.w * 0.5, s.t + s.h * 0.4];
  await ziehen(P, [a, [s.l + s.w * 0.4, s.t + s.h * 0.3], b]);
  const st = (await striche(P, (x) => x.anchor === 'p1'))[0];
  const xs = st ? st.points.map((p) => p[0]) : []; const ys = st ? st.points.map((p) => p[1]) : [];
  pruefe('B2 eine gewöhnliche Seiten-Anmerkung: Seite 1, Seitenpunkte (612 × 792)', !!st && st.seite === 1 && st.seitenBreite === true
    && Math.abs(Math.min(...xs) - 153) < 8 && Math.abs(Math.max(...xs) - 306) < 8 && Math.abs(Math.min(...ys) - 198) < 8 && Math.abs(Math.max(...ys) - 317) < 8,
    st && { seite: st.seite, x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] });
  const gemalt = await kasten(P, '.folie-dok-striche path');
  pruefe('B3 die Folie zeigt sie an der gezeichneten Stelle', !!gemalt && Math.abs(gemalt.l - a[0]) < 6 && Math.abs(gemalt.r - b[0]) < 6 && Math.abs(gemalt.t - a[1]) < 6 && Math.abs(gemalt.b - b[1]) < 6, { gemalt, a, b });
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.locator('[data-taste="folie-groesser"]').click(); await P.locator('[data-taste="folie-groesser"]').click(); await P.waitForTimeout(700);
  const s2 = await kasten(P, '.folie-dok-seite'); const g2 = await kasten(P, '.folie-dok-striche path');
  pruefe('B4 vergrößert: der Strich bleibt an seiner Stelle der Seite', !!g2 && s2.w > s.w * 1.3 && Math.abs((g2.l - s2.l) / s2.w - 0.25) < 0.012 && Math.abs((g2.t - s2.t) / s2.h - 0.25) < 0.012, { s2, g2 });
  // vergrößert weiterzeichnen: die Umrechnung stimmt auch dann
  await P.keyboard.press('p'); await P.waitForTimeout(250);
  const fl = await kasten(P, '.presenter-slide');
  const m = [fl.l + fl.w / 2, fl.t + fl.h / 2];
  await ziehen(P, [m, [m[0] + 60, m[1] + 10], [m[0] + 120, m[1] + 30]]);
  const neu = (await striche(P, (x) => x.anchor === 'p1' && x.id !== st.id))[0];
  const erwartet = [(m[0] - s2.l) / s2.w * 612, (m[1] - s2.t) / s2.h * 792];
  pruefe('B5 im vergrößerten Blatt gezeichnet: wieder richtige Seitenpunkte', !!neu && Math.abs(neu.points[0][0] - erwartet[0]) < 5 && Math.abs(neu.points[0][1] - erwartet[1]) < 5, { p: neu?.points[0], erwartet });
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.locator('[data-taste="folie-modus"]').click(); await P.waitForTimeout(500);
  // Seite 2
  // M405: Die Seiten blättert die Leiste am Dokument („Weiter" unten geht zur nächsten Karte)
  for (let i = 0; i < 8 && (await dokSeite(P)) !== 2; i++) { await P.locator('[data-taste="folie-vor"]').click(); await P.waitForTimeout(500); }
  await P.waitForTimeout(700);
  pruefe('B6 auf Seite 2 stehen die Striche von Seite 1 nicht', (await dokSeite(P)) === 2 && (await P.locator('.folie-dok-striche path').count()) === 0, { seite: await dokSeite(P) });
  await P.keyboard.press('m'); await P.waitForTimeout(250);
  const t = await kasten(P, '.folie-dok-seite');
  // die Seite kann höher sein als der Schirm (Seitenbreite) — gezeichnet wird im sichtbaren Teil
  const zy = Math.min(t.t + t.h * 0.6, 520);
  await ziehen(P, [[t.l + t.w * 0.2, zy], [t.l + t.w * 0.7, zy]]);
  const zwei = (await striche(P, (x) => x.anchor === 'p1' && x.seite === 2))[0];
  pruefe('B7 dort gezeichnet gehört der Strich zu Seite 2 (Textmarker)', !!zwei && zwei.tool === 'marker' && zwei.seite === 2, zwei && { seite: zwei.seite, tool: zwei.tool });
  pruefe('B7b die Folie zeigt ihn', (await P.locator('.folie-dok-striche path').count()) === 1);
  await P.keyboard.press('e'); await P.waitForTimeout(200);
  await ziehen(P, [[t.l + t.w * 0.4, zy - 40], [t.l + t.w * 0.4, zy + 40]]);
  pruefe('B8 der Radierer nimmt nur Striche dieser Seite', await bis(async () => { const d = ((await brettVon(P)).drawings ?? []).filter((x) => x.anchor === 'p1'); return d.length === 2 && d.every((x) => x.seite === 1); }), ((await brettVon(P)).drawings ?? []).map((x) => `${x.anchor}:${x.seite}`));
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
}

console.log('\n════ F: Stift schreibt, Finger rollt ════');
{
  // Seite 2 liegt in Seitenbreite offen — sie ist höher als der Schirm
  await P.keyboard.press('p'); await P.waitForTimeout(250);
  const zeiger = (typ, art, x, y, druck = 0.5) => P.evaluate(([t, a, px, py, d]) => {
    const el = document.querySelector('.folien-stift');
    el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: a === 'pen' ? 11 : 12, pointerType: a, clientX: px, clientY: py, pressure: t === 'pointerup' ? 0 : d, buttons: t === 'pointerup' ? 0 : 1, isPrimary: true }));
  }, [typ, art, x, y, druck]);
  const t = await kasten(P, '.folie-dok-seite');
  await zeiger('pointerdown', 'pen', t.l + 200, 300, 0.3);
  for (let i = 1; i <= 8; i++) await zeiger('pointermove', 'pen', t.l + 200 + i * 20, 300 + (i % 2) * 14, 0.3 + i * 0.07);
  await zeiger('pointerup', 'pen', t.l + 360, 300);
  const stift = (await striche(P, (x) => x.anchor === 'p1' && x.seite === 2))[0];
  pruefe('F1 der Stift schreibt – mit seinem Druck', !!stift && Array.isArray(stift.druck) && stift.druck.length === stift.points.length && stift.druck[stift.druck.length - 1] > stift.druck[0], stift && { punkte: stift.points.length, druck: stift.druck });
  const roll = () => P.evaluate(() => document.querySelector('.folie-dok-flaeche').scrollTop);
  const vor = await roll();
  await zeiger('pointerdown', 'touch', t.l + 300, 500);
  for (let i = 1; i <= 6; i++) await zeiger('pointermove', 'touch', t.l + 300, 500 - i * 25);
  await zeiger('pointerup', 'touch', t.l + 300, 350);
  await P.waitForTimeout(300);
  const nach = await roll();
  pruefe('F2 der Finger rollt die Seite, statt zu zeichnen', nach - vor > 100 && ((await brettVon(P)).drawings ?? []).filter((x) => x.anchor === 'p1' && x.seite === 2).length === 1, { vor, nach });
  await P.evaluate(() => { document.querySelector('.folie-dok-flaeche').scrollTop = 0; });
  await P.keyboard.press('e'); await P.waitForTimeout(200);
  await ziehen(P, [[t.l + 280, 270], [t.l + 280, 340]]);
  await bis(async () => ((await brettVon(P)).drawings ?? []).filter((x) => x.seite === 2).length === 0);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
}

console.log('\n════ C: Kommentare ════');
{
  // Seite 2 des Dokuments: Pin und Spalte
  const pin = await kasten(P, '[data-taste="folien-pin"] circle'); const t = await kasten(P, '.folie-dok-seite');
  const soll = [t.l + (300 / 612) * t.w, t.t + (400 / 792) * t.h];
  pruefe('C1 der Kommentar der Seite steht als Pin an seiner Stelle', !!pin && Math.abs((pin.l + pin.r) / 2 - soll[0]) < 4 && Math.abs((pin.t + pin.b) / 2 - soll[1]) < 4, { pin, soll });
  pruefe('C2 am Kommentar-Knopf steht die Zahl der offenen Gespräche der Karte (2)', (await P.locator('[data-taste="vortrag-kommentar-zahl"]').textContent()) === '2');
  await P.locator('[data-taste="folien-pin"]').first().click(); await P.waitForTimeout(400);
  pruefe('C3 ein Tipp auf den Pin öffnet die Spalte mit diesem Gespräch – hervorgehoben, „Seite 2"',
    (await P.locator('.folien-kommentare .fk-faden.gewaehlt', { hasText: 'Quelle für Seite zwei?' }).count()) === 1 && /Seite 2/.test(await P.locator('.fk-kopf').textContent()));
  pruefe('C4 die Spalte zeigt nur die Gespräche dieser Seite – die anderen als Sprung', (await P.locator('.fk-faden').count()) === 1 && (await P.locator('[data-taste="folien-kommentar-seite"]').textContent()).trim() === 'Seite 3');
  const fol = await kasten(P, '.presenter-slide'); const sp = await kasten(P, '.folien-kommentare');
  pruefe('C5 die Folie rückt zur Seite – die Spalte verdeckt nichts', fol.r <= sp.l + 1, { folie: fol.r, spalte: sp.l });
  await P.locator('[data-taste="folien-kommentar-text"]').fill('Bitte Seite zwei kürzen');
  await P.locator('[data-taste="folien-kommentar-senden"]').click(); await P.waitForTimeout(400);
  const neu = ((await brettVon(P)).comments ?? []).find((c) => c.msgs[0].text === 'Bitte Seite zwei kürzen');
  pruefe('C6 ein neuer Kommentar gehört zur offenen Seite, am rechten Rand, mit meinem Namen', !!neu && neu.nodeId === 'p1' && neu.seite === 2 && neu.px === 572 && neu.msgs[0].author === 'Cleo', neu);
  pruefe('C7 er steht in der Spalte und als zweiter Pin auf der Seite', (await P.locator('.fk-faden').count()) === 2 && (await P.locator('[data-taste="folien-pin"]').count()) === 2);
  await P.screenshot({ path: path.join(SD, 'm394-c-kommentare.png') });
  await P.locator('.fk-faden', { hasText: 'Quelle für Seite zwei?' }).locator('[data-taste="folien-antworten"]').click();
  await P.locator('[data-taste="folien-kommentar-text"]').fill('Steht im Anhang');
  await P.keyboard.press('Enter'); await P.waitForTimeout(400);
  const alt = ((await brettVon(P)).comments ?? []).find((c) => c.id === 'c-s2');
  pruefe('C8 Antworten hängt an das Gespräch an (Enter sendet)', alt.msgs.length === 2 && alt.msgs[1].text === 'Steht im Anhang' && ((await brettVon(P)).comments ?? []).length === 4, alt.msgs.map((m) => m.text));
  await P.locator('.fk-faden', { hasText: 'Quelle für Seite zwei?' }).locator('[data-taste="folien-erledigt"]').click(); await P.waitForTimeout(300);
  pruefe('C9 „Erledigt" hakt es ab – die Zahl am Knopf sinkt', await bis(async () => ((await brettVon(P)).comments ?? []).find((c) => c.id === 'c-s2').resolved === true) && (await P.locator('[data-taste="vortrag-kommentar-zahl"]').textContent()) === '2', await P.locator('[data-taste="vortrag-kommentar-zahl"]').textContent());
  await P.locator('[data-taste="folien-kommentar-seite"]').click(); await P.waitForTimeout(900);
  pruefe('C10 der Sprung blättert zur Seite mit dem anderen Gespräch', (await dokSeite(P)) === 3 && (await P.locator('.fk-faden', { hasText: 'Anhang fehlt' }).count()) === 1, { seite: await dokSeite(P) });
  // Notiz-Folie: Gespräche der Karte
  await aufFolie(P, 'folie');
  pruefe('C11 auf der Notiz-Folie: das Gespräch der Karte, keine Seitenangabe', (await P.locator('.fk-faden', { hasText: 'Zahl bitte prüfen' }).count()) === 1 && (await P.locator('.fk-seite').count()) === 0);
  await P.locator('[data-taste="folien-kommentar-text"]').fill('Guter Einstieg');
  await P.locator('[data-taste="folien-kommentar-senden"]').click(); await P.waitForTimeout(400);
  const k = ((await brettVon(P)).comments ?? []).find((c) => c.msgs[0].text === 'Guter Einstieg');
  pruefe('C12 ein neuer Kommentar hängt an der Karte (ohne Seite)', !!k && k.nodeId === 'n1' && k.seite == null, k);
  // Esc: Stift → Spalte → Präsentation
  await P.locator('.fk-kopf').click(); await P.keyboard.press('p'); await P.waitForTimeout(200);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  const e1 = { stift: await P.locator('.folien-palette').count(), spalte: await P.locator('.folien-kommentare').count(), vortrag: await P.locator('.presenter').count() };
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  const e2 = { spalte: await P.locator('.folien-kommentare').count(), vortrag: await P.locator('.presenter').count() };
  pruefe('C13 Esc legt erst den Stift weg, schließt dann die Spalte – die Präsentation bleibt', e1.stift === 0 && e1.spalte === 1 && e1.vortrag === 1 && e2.spalte === 0 && e2.vortrag === 1, { e1, e2 });
  await P.keyboard.press('k'); await P.waitForTimeout(200);
  pruefe('C14 K öffnet die Spalte wieder', (await P.locator('.folien-kommentare').count()) === 1);
  await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await P.waitForTimeout(600);
  pruefe('C15 das letzte Esc beendet die Präsentation', (await P.locator('.presenter').count()) === 0);
}

console.log('\n════ B′: zurück auf dem Board ════');
{
  await P.waitForTimeout(1800);
  const brett = await P.evaluate(() => ({
    notiz: document.querySelectorAll('.react-flow__node[data-id="n1"] .notiz-striche path').length,
    ebene: [...document.querySelectorAll('.drawing-layer path[data-anker]')].map((p) => p.getAttribute('data-anker')),
    pdf: !!document.querySelector('.react-flow__node[data-id="p1"] .pdf-seite'),
  }));
  pruefe('B9 auf dem Board: die Folien-Striche der Notiz liegen nicht auf der Karte', brett.notiz === 0 && !brett.ebene.includes('n1'), brett);
  pruefe('B10 die Anmerkungen der PDF-Seite stehen an der aufgeklappten Karte', brett.pdf && brett.ebene.filter((a) => a === 'p1').length === 2, brett);
  await vortragAuf(P); await aufFolie(P, 'folie');
  pruefe('B11 im nächsten Vortrag sind die Striche der Folie wieder da', await bis(async () => (await P.locator('.folien-stift svg path').count()) === 2, 4000));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
}
await ctx.close();

console.log('\n════ D: nur lesen ════');
{
  const st = stand('lesen');
  st.boards[0].drawings = [{ id: 'd1', tool: 'pen', color: '#e0392b', width: 3.6, points: [[200, 60], [400, 90], [600, 110]], anchor: 'n1', seite: -1, seitenBreite: true }];
  const L = await seite(st);
  await vortragAuf(L.P); await aufFolie(L.P, 'folie');
  const nurLesen = await L.P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].geteiltRolle);
  if (nurLesen !== 'lesen') console.log('    (das Board blieb nicht „nur lesen" – Stand:', nurLesen, ')');
  pruefe('D1 kein Stift-Knopf; die Striche der Folie sind zu sehen', nurLesen === 'lesen' && (await L.P.locator('[data-taste="vortrag-stift"]').count()) === 0 && (await L.P.locator('.folien-stift svg path').count()) === 1);
  await L.P.keyboard.press('p'); await L.P.waitForTimeout(200);
  pruefe('D2 auch die Taste holt keine Werkzeuge', (await L.P.locator('.folien-palette').count()) === 0);
  await L.P.locator('[data-taste="vortrag-kommentare"]').click(); await L.P.waitForTimeout(300);
  pruefe('D3 Kommentare lassen sich lesen – schreiben, antworten, erledigen nicht', (await L.P.locator('.fk-faden', { hasText: 'Zahl bitte prüfen' }).count()) === 1
    && (await L.P.locator('[data-taste="folien-kommentar-text"]').count()) === 0 && (await L.P.locator('[data-taste="folien-antworten"]').count()) === 0);
  await L.ctx.close();
}

console.log('\n════ E: Texte ════');
{
  const de = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
  const en = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf-8');
  pruefe('E1 die Hilfe nennt M394 – deutsch und englisch', de.includes('(M394)') && en.includes('(M394)'));
  pruefe('E2 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm394-stift-im-vortrag: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
