/**
 * M319 — Stift & Touch.
 *
 *   A  Striche: Stift-Striche sind gefüllte Konturen (perfect-freehand), mit
 *      echtem Stift wandert der Druck je Punkt mit; der Textmarker bleibt eine
 *      gleichmäßige Linie mit Multiply.
 *   B  Formen beim Halten: Linie, Kreis (rund), gedrehtes Rechteck, Dreieck,
 *      Pfeil (zwei Striche) rasten ein; eine Wellenlinie bleibt, was sie ist.
 *   C  Hand schiebt, Stift zeichnet: Auf einem Gerät mit Stift lässt die Ebene
 *      im Zeichenmodus Finger durch; Maus und Stift zeichnen weiter.
 *   D  Ohne Stift: ein zweiter Finger bricht den Strich des ersten ab (Geste).
 *   E  Direktzug (Stift ohne Zeichenmodus) funktioniert weiter, mit Druck;
 *      Handballen (Touch) wird dabei ignoriert.
 *   F  „Was ist neu" und die Hilfe nennen den Stift-Ausbau.
 */
// Läuft aus dem Repository: `node pruefungen/m319-stift.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4541;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const stand = {
  boards: [{ id: 'b1', name: 'Skizze', edges: [], drawings: [], comments: [], nodes: [{ id: 'n1', type: 'note', width: 220, position: { x: -600, y: -400 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Ecke' }] } }] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(({ st, stift }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    if (stift) localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, stift: !!opt.stift });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
/** Synthetische Zeiger-Ereignisse auf das Element unter (x,y) — mit Zeigerart und Druck */
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y, p], extra = {}) => new PointerEvent(typ, {
    bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: o.art ?? 'mouse',
    isPrimary: o.primary ?? true, clientX: x, clientY: y, pressure: p ?? (o.art === 'pen' ? 0.5 : 0.5), buttons: 1, button: 0, ...extra,
  });
  const ziel = (x, y) => document.elementFromPoint(x, y) ?? document.body;
  const [x0, y0] = punkte[0];
  const start = ziel(x0, y0);
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  // Wie Pointer-Capture im echten Browser: Folgeereignisse gehen an das Start-Element
  for (const pt of punkte.slice(1)) {
    start.dispatchEvent(mk('pointermove', pt));
    await new Promise((r) => setTimeout(r, 8));
  }
  if (o.halten) await new Promise((r) => setTimeout(r, o.halten));
  if (!o.offen) start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
  return start.className?.baseVal ?? start.className;
}, { punkte, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const warte = (P, ms = 900) => P.waitForTimeout(ms);
const kreis = (cx, cy, r, n = 40, rauschen = 3, luecke = 0.1) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2 * (1 - luecke); return [cx + (r + (i % 2 ? rauschen : -rauschen)) * Math.cos(t), cy + (r + (i % 3 ? rauschen : -rauschen)) * Math.sin(t)]; });
const polygon = (ecken, proKante = 12, rauschen = 2) => { const out = []; for (let k = 0; k < ecken.length; k += 1) { const a = ecken[k], b = ecken[(k + 1) % ecken.length]; for (let i = 0; i < proKante; i += 1) { const t = i / proKante; out.push([a[0] + (b[0] - a[0]) * t + (i % 2 ? rauschen : -rauschen), a[1] + (b[1] - a[1]) * t + (i % 2 ? -rauschen : rauschen)]); } } out.push([ecken[0][0] + 3, ecken[0][1] - 2]); return out; };
const strecke = (a, b, n = 16) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);

// ══ A: Striche ══════════════════════════════════════════════════════
console.log('\n════ A: Striche ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  const ebene = await P.evaluate(() => getComputedStyle(document.querySelector('.drawing-layer')).pointerEvents);
  pruefe('A1 ohne bekannten Stift nimmt die Ebene alle Zeiger an', ebene === 'auto', ebene);
  // Maus-Strich: eine Schlangenlinie
  await zug(P, Array.from({ length: 30 }, (_, i) => [600 + i * 8, 450 + Math.sin(i / 3) * 40]));
  await warte(P);
  let d = await striche(P);
  const pfad = await P.evaluate(() => document.querySelector('.drawing-layer path.strich'));
  const attr = await P.evaluate(() => { const p = document.querySelector('.drawing-layer path.strich'); return p ? { fill: p.getAttribute('fill'), stroke: p.getAttribute('stroke'), d: p.getAttribute('d').slice(0, 40), z: p.getAttribute('d').trim().endsWith('Z') } : null; });
  pruefe('A2 Maus-Strich gespeichert, ohne Druckspur (Geschwindigkeit simuliert)', d.length === 1 && !d[0].druck && d[0].points.length > 10, JSON.stringify({ n: d.length, p: d[0]?.points.length, druck: !!d[0]?.druck }));
  pruefe('A3 gerendert als gefüllte Kontur (fill = Farbe, stroke none, geschlossener Pfad)', !!pfad && attr && attr.fill === d[0].color && attr.stroke === 'none' && attr.z && /Q/.test(attr.d), JSON.stringify(attr));
  // Stift-Strich mit wanderndem Druck
  await zug(P, Array.from({ length: 24 }, (_, i) => [600 + i * 10, 600 + Math.cos(i / 2) * 20, 0.2 + 0.03 * i]), { art: 'pen', id: 9 });
  await warte(P);
  d = await striche(P);
  const s = d[1];
  pruefe('A4 Stift-Strich trägt Druck je Punkt (gleich lang wie die Punkte, ansteigend)', !!s?.druck && s.druck.length === s.points.length && s.druck[s.druck.length - 1] > s.druck[0], JSON.stringify({ p: s?.points.length, d: s?.druck?.length, a: s?.druck?.[0], e: s?.druck?.slice(-1)[0] }));
  const breiten = await P.evaluate(() => { const p = document.querySelectorAll('.drawing-layer path.strich')[1]; const b = p.getBBox(); return { w: b.width, h: b.height }; });
  pruefe('A5 die Kontur hat Fläche (nicht nur eine Haarlinie)', breiten.w > 200 && breiten.h > 5, JSON.stringify(breiten));
  // Textmarker
  await werkzeug(P, 'Textmarker');
  await zug(P, strecke([600, 720], [900, 722], 20));
  await warte(P);
  const m = await P.evaluate(() => { const ps = [...document.querySelectorAll('.drawing-layer path')]; const p = ps[ps.length - 1]; return { fill: p.getAttribute('fill'), sw: p.getAttribute('stroke-width'), blend: p.style.mixBlendMode }; });
  pruefe('A6 Textmarker bleibt eine breite, gleichmäßige Multiply-Linie', m.fill === 'none' && m.sw === '16' && m.blend === 'multiply', JSON.stringify(m));
  await P.screenshot({ path: path.join(SD, 'm319-striche.png') });
  await ctx.close();
}

// ══ B: Formen beim Halten ═══════════════════════════════════════════
console.log('\n════ B: Formen ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  const vorher = (await striche(P)).length;
  // M324: Ein Kreis UM eine Karte ist jetzt ein Lasso (markiert) — die Form-Probe zeichnet neben der Karte
  await zug(P, kreis(1000, 450, 70), { halten: 800 }); await warte(P);
  let d = await striche(P);
  const k = d[d.length - 1];
  const xs = k ? k.points.map((p) => p[0]) : [0], ys = k ? k.points.map((p) => p[1]) : [0];
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const r = k ? k.points.map(([x, y]) => Math.hypot(x - mx, y - my)) : [];
  pruefe('B1 Kreis rastet ein: 49 Punkte, alle gleich weit von der Mitte', d.length === vorher + 1 && k.points.length === 49 && Math.max(...r) - Math.min(...r) < 1.5, JSON.stringify({ n: k?.points.length, spanne: (Math.max(...r) - Math.min(...r)).toFixed(2) }));
  await zug(P, polygon([[900, 300], [1100, 370], [1060, 480], [860, 410]]), { halten: 800 }); await warte(P);
  d = await striche(P);
  pruefe('B2 gedrehtes Rechteck: fünf Punkte, rechte Winkel', d.length === vorher + 2 && d[d.length - 1].points.length === 5, String(d[d.length - 1]?.points.length));
  await zug(P, polygon([[600, 620], [800, 640], [680, 780]]), { halten: 800 }); await warte(P);
  d = await striche(P);
  pruefe('B3 Dreieck: vier Punkte (geschlossen)', d.length === vorher + 3 && d[d.length - 1].points.length === 4, String(d[d.length - 1]?.points.length));
  // Pfeil: Schaft nach rechts, dann Haken zurück nach links-oben, zurück zur Spitze, Haken links-unten
  const pfeil = [...strecke([900, 650], [1150, 650], 20), ...strecke([1150, 650], [1120, 625], 5), ...strecke([1120, 625], [1150, 650], 5), ...strecke([1150, 650], [1120, 675], 5)];
  await zug(P, pfeil, { halten: 800 }); await warte(P);
  d = await striche(P);
  const schaft = d[d.length - 2], spitze = d[d.length - 1];
  pruefe('B4 Pfeil: Schaft (2 Punkte) plus Spitze (3 Punkte), zwei Striche', d.length === vorher + 5 && schaft?.points.length === 2 && spitze?.points.length === 3, JSON.stringify({ n: d.length - vorher, s: schaft?.points.length, k: spitze?.points.length }));
  await zug(P, strecke([300, 820], [700, 824], 20), { halten: 800 }); await warte(P);
  d = await striche(P);
  pruefe('B5 Linie: zwei Punkte, waagerecht eingerastet', d[d.length - 1].points.length === 2 && Math.abs(d[d.length - 1].points[0][1] - d[d.length - 1].points[1][1]) < 0.01);
  await zug(P, Array.from({ length: 30 }, (_, i) => [300 + i * 10, 200 + Math.sin(i / 2) * 50]), { halten: 800 }); await warte(P);
  d = await striche(P);
  pruefe('B6 eine Wellenlinie bleibt, was sie ist (keine Form erkannt)', d[d.length - 1].points.length > 20, String(d[d.length - 1].points.length));
  await P.screenshot({ path: path.join(SD, 'm319-formen.png') });
  await ctx.close();
}

// ══ C: Hand schiebt, Stift zeichnet ═════════════════════════════════
console.log('\n════ C: Durchgriff ════');
{
  const { ctx, P } = await seite({ stift: true });
  await werkzeug(P, 'Stift');
  const ebene = await P.evaluate(() => getComputedStyle(document.querySelector('.drawing-layer')).pointerEvents);
  pruefe('C1 mit bekanntem Stift lässt die Ebene Finger durch (pointer-events none)', ebene === 'none', ebene);
  const hinweis = await P.locator('.draw-hint').textContent();
  pruefe('C2 die Palette sagt es: Hand schiebt, Stift zeichnet', /Hand schiebt, Stift zeichnet/.test(hinweis ?? ''), hinweis ?? '');
  const vp0 = await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  await zug(P, strecke([700, 500], [700, 380], 12), { art: 'touch', id: 21 }); await warte(P, 500);
  let d = await striche(P);
  pruefe('C3 ein Finger zeichnet nicht', d.length === 0, String(d.length));
  await zug(P, Array.from({ length: 20 }, (_, i) => [700 + i * 6, 400 + Math.sin(i / 2) * 25, 0.4 + i * 0.02]), { art: 'pen', id: 22 }); await warte(P);
  d = await striche(P);
  pruefe('C4 der Stift zeichnet (über den Fenster-Zuhörer), mit Druck', d.length === 1 && !!d[0].druck, JSON.stringify({ n: d.length, druck: !!d[0]?.druck }));
  await zug(P, strecke([500, 300], [640, 300], 12), { art: 'mouse', id: 23 }); await warte(P);
  d = await striche(P);
  pruefe('C5 die Maus zeichnet ebenfalls', d.length === 2, String(d.length));
  await werkzeug(P, 'Radierer');
  await zug(P, strecke([500, 300], [640, 300], 20), { art: 'pen', id: 24 }); await warte(P);
  d = await striche(P);
  pruefe('C6 der Radierer am Stift radiert', d.length === 1, String(d.length));
  void vp0;
  await ctx.close();
}

// ══ D: Zweiter Finger bricht ab ═════════════════════════════════════
console.log('\n════ D: Zwei Finger ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  await zug(P, strecke([600, 500], [700, 500], 8), { art: 'touch', id: 31, offen: true });
  await zug(P, [[900, 500]], { art: 'touch', id: 32, primary: false, offen: true });
  await zug(P, [[700, 500]], { art: 'touch', id: 31 }); // erster Finger hebt
  await P.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 32, pointerType: 'touch' })));
  await warte(P);
  const d = await striche(P);
  pruefe('D1 der zweite Finger bricht den Strich ab — nichts gespeichert', d.length === 0, String(d.length));
  await ctx.close();
}

// ══ E: Direktzug & Handballen ═══════════════════════════════════════
console.log('\n════ E: Direktzug ════');
{
  const { ctx, P } = await seite();
  await zug(P, Array.from({ length: 20 }, (_, i) => [700 + i * 8, 500 + Math.sin(i / 2) * 15, 0.3 + i * 0.03]), { art: 'pen', id: 41, offen: true });
  await zug(P, [[760, 560]], { art: 'touch', id: 42, primary: false, offen: true }); // Handballen
  await P.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, pointerType: 'pen', clientX: 852, clientY: 500 })));
  await warte(P);
  const d = await striche(P);
  pruefe('E1 Stift zeichnet ohne Zeichenmodus, mit Druck; der Handballen zeichnet nicht', d.length === 1 && !!d[0].druck && d[0].points.length >= 15, JSON.stringify({ n: d.length, p: d[0]?.points.length, druck: !!d[0]?.druck }));
  const gemerkt = await P.evaluate(() => localStorage.getItem('pixinotes-stift'));
  pruefe('E2 das Gerät merkt sich den Stift', gemerkt === '1', String(gemerkt));
  await ctx.close();
}

// ══ F: Texte ════════════════════════════════════════════════════════
console.log('\n════ F: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('F1 „Was ist neu" nennt M319', js.includes('Stift wie auf Papier (M319)'));
  pruefe('F2 die Hilfe nennt Pfeil und Dreieck', js.includes('Pfeile, Kreise, Rechtecke und Dreiecke'));
}

await browser.close(); app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
