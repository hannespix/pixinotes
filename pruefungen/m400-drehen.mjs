/**
 * M400 — Karten frei drehen.
 *
 * Gewünscht: „Es wäre toll, wenn man Cards etc. auch frei rotieren könnte, damit man diese auch schräg aufs Board
 * als coole Sticky Notes platzieren kann. Ist das sauber möglich?"
 *
 *   A  Eine Karte mit Winkel liegt schräg; Schatten und Auswahlrahmen drehen sich mit; gerade Karten bleiben unberührt.
 *   B  Dreh-Knopf an der markierten Karte: ziehen dreht, rastet alle 15° ein (Alt = frei), Doppelklick stellt gerade;
 *      ein Rückgängig-Schritt. Module mit eigener Bedienung (Kanban) haben keinen Knopf.
 *   C  Mehrere markierte Karten drehen sich gemeinsam.
 *   D  Größe ziehen an der schrägen Karte: in ihren Achsen, die gegenüberliegende Ecke bleibt stehen.
 *   E  Verbindungen docken an der gedrehten Seitenmitte an; der Kommentar-Pin sitzt an der gedrehten Ecke.
 *   F  Striche auf der Karte drehen sich mit.
 *   G  Befehle: „Schräg legen" und „Gerade richten".
 *   H  Verschieben, Schreiben (Auto-Größe), Neuladen; Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m400-drehen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4716;
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

const notiz = (id, x, y, w, h, text, winkel, mehr = {}) => ({ id, type: 'note', position: { x, y }, width: w, height: h, autoFit: false, ...(winkel ? { winkel } : {}), ...mehr,
  data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const kanban = (id, x, y) => ({ id, type: 'kanban', position: { x, y }, width: 420, height: 260, data: { title: 'Aufgaben', items: [{ id: 't1', text: 'Erste Aufgabe', col: 0 }] } });
const auf = async (board, sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1800, height: 1000 } });   // breit genug, dass auch der Knopf der rechten Karte im Bild liegt
  await ctx.addInitScript(([b, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], ...b }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [board, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
const stand = async (P) => { await P.waitForTimeout(650); return P.evaluate(() => { const b = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0];
  return { karten: Object.fromEntries(b.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, w: n.width, h: n.height, winkel: n.winkel ?? 0, auto: n.autoFit }])), striche: (b.drawings ?? []).map((s) => ({ id: s.id, anchor: s.anchor, points: s.points })) }; }); };
/** Was der Bildschirm zeigt: Winkel der Hülle aus der Matrix, Schatten, Umriss – und die Lage in Brett-Punkten */
const bild = (P, id) => P.evaluate((kid) => {
  const k = document.querySelector(`.react-flow__node[data-id="${kid}"]`); if (!k) return null;
  const h = k.querySelector('.card-shell');
  const m = new DOMMatrixReadOnly(getComputedStyle(h).transform);
  const v = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
  const r = h.getBoundingClientRect(); const fr = document.querySelector('.react-flow').getBoundingClientRect();
  return { grad: Math.round((Math.atan2(m.b, m.a) * 180 / Math.PI) * 10) / 10, attribut: h.getAttribute('data-winkel'),
    knotenSchatten: getComputedStyle(k).boxShadow, huelleSchatten: getComputedStyle(h).boxShadow, knotenUmriss: getComputedStyle(k).outlineStyle, huelleUmriss: getComputedStyle(h).outlineStyle,
    mitte: { x: (r.left + r.width / 2 - fr.left - v.e) / v.a, y: (r.top + r.height / 2 - fr.top - v.f) / v.a }, zoom: v.a, tx: v.e + fr.left, ty: v.f + fr.top,
    griffeBibliothek: k.querySelectorAll('.react-flow__resize-control.handle').length, eckGriffe: k.querySelectorAll('[data-taste="karte-eck-griff"]').length,
    knopf: !!k.querySelector('[data-taste="karte-drehen"]'), gewaehlt: k.classList.contains('selected') };
}, id);
const waehle = async (P, ids) => {
  await P.keyboard.press('Escape');
  await P.locator('.react-flow__pane').click({ position: { x: 1380, y: 840 } });
  for (const [i, id] of ids.entries()) await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true, modifiers: i ? ['Shift'] : [] });
  await P.waitForTimeout(350);
};
const drehe = (p, um, grad) => { const r = grad * Math.PI / 180; const c = Math.cos(r); const s = Math.sin(r); return { x: um.x + (p.x - um.x) * c - (p.y - um.y) * s, y: um.y + (p.x - um.x) * s + (p.y - um.y) * c }; };
const nah = (a, b, t = 2) => Math.abs(a - b) <= t;
/** Den Dreh-Knopf einer Karte um einen Winkel (Grad, im Uhrzeigersinn) um die Kartenmitte ziehen */
const amKnopfDrehen = async (P, id, grad, opt = {}) => {
  const k = P.locator(`.react-flow__node[data-id="${id}"] [data-taste="karte-drehen"]`);
  const kb = await k.boundingBox();
  const sb = await P.locator(`.react-flow__node[data-id="${id}"] .card-shell`).boundingBox();
  const mitte = { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 };
  const start = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 };
  await P.mouse.move(start.x, start.y); await P.mouse.down();
  if (opt.alt) await P.keyboard.down('Alt');
  const schritte = 10;
  for (let i = 1; i <= schritte; i++) { const z = drehe(start, mitte, (grad * i) / schritte); await P.mouse.move(z.x, z.y); }
  await P.waitForTimeout(120);
  const anzeige = await P.evaluate(() => document.querySelector('.dreh-anzeige')?.textContent ?? '');
  await P.mouse.up();
  if (opt.alt) await P.keyboard.up('Alt');
  await P.waitForTimeout(300);
  return anzeige;
};

// ---------- A: Darstellung ----------
console.log('A  Darstellung');
const G = await auf({ nodes: [notiz('a', 100, 140, 220, 150, 'Schräg', -8), notiz('b', 460, 140, 220, 150, 'Gerade', 0), notiz('c', 820, 140, 220, 150, 'Dritte', 0), kanban('k', 200, 420)],
  edges: [{ id: 'e1', source: 'a', target: 'b', type: 'labeled' }],
  comments: [{ id: 'k1', nodeId: 'a', msgs: [{ author: 'Anna', text: 'Schau mal', at: '2026-11-18T10:00:00.000Z' }] }] });
const P = G.P;
{
  const a = await bild(P, 'a'); const b = await bild(P, 'b');
  // Beim Laden passt die Ansicht alle Karten ins Bild – das Vermessen der Karten darf das nicht stören
  const imBild = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((k) => { const r = k.getBoundingClientRect(); return { id: k.getAttribute('data-id'), drin: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; }));
  pruefe('A0 nach dem Laden liegen alle Karten im Bild (die Ansicht ist eingepasst)', imBild.length === 4 && imBild.every((k) => k.drin), imBild);
  pruefe('A1 die Karte mit Winkel liegt schräg (−8°)', a?.grad === -8 && a.attribut === '-8', a);
  pruefe('A2 der Schatten sitzt an der schrägen Hülle, nicht am geraden Knoten', a?.knotenSchatten === 'none' && a.huelleSchatten !== 'none', a);
  pruefe('A3 eine gerade Karte bleibt, wie sie war (kein Attribut, keine Drehung, Schatten am Knoten)', b?.grad === 0 && b.attribut === null && b.knotenSchatten !== 'none' && b.huelleSchatten === 'none', b);
  await waehle(P, ['a']);
  const aw = await bild(P, 'a');
  pruefe('A4 markiert: der Auswahlrahmen dreht sich mit (an der Hülle, nicht am Knoten)', aw?.gewaehlt && aw.huelleUmriss === 'solid' && aw.knotenUmriss === 'none', aw);
  pruefe('A5 … mit vier eigenen Eck-Griffen statt der geraden der Bibliothek, dazu der Dreh-Knopf', aw?.eckGriffe === 4 && aw.griffeBibliothek === 0 && aw.knopf, aw);
  await waehle(P, ['b']);
  const bw = await bild(P, 'b');
  pruefe('A6 die gerade Karte hat die gewohnten Griffe – und ebenfalls den Dreh-Knopf', bw?.griffeBibliothek >= 4 && bw.eckGriffe === 0 && bw.knopf, bw);
  await waehle(P, ['k']);
  const kw = await bild(P, 'k');
  pruefe('A7 ein Kanban hat keinen Dreh-Knopf (Module mit eigener Bedienung bleiben gerade)', kw?.gewaehlt && !kw.knopf, kw);
}

// ---------- B: Dreh-Knopf ----------
console.log('B  Dreh-Knopf');
{
  await waehle(P, ['b']);
  let anzeige = await amKnopfDrehen(P, 'b', 28);
  let s = await stand(P);
  pruefe('B1 ziehen dreht – nahe 30° rastet der Winkel ein', s.karten.b.winkel === 30 && (await bild(P, 'b')).grad === 30, s.karten.b);
  pruefe('B2 während des Drehens steht der Winkel an der Karte', anzeige === '30°', anzeige);
  pruefe('B3 Ort und Größe der Karte bleiben', s.karten.b.x === 460 && s.karten.b.y === 140 && s.karten.b.w === 220 && s.karten.b.h === 150, s.karten.b);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(350);
  s = await stand(P);
  pruefe('B4 Strg+Z nimmt die ganze Drehung in einem Schritt zurück', s.karten.b.winkel === 0 && (await bild(P, 'b')).grad === 0, s.karten.b);
  await waehle(P, ['b']);
  await amKnopfDrehen(P, 'b', 22);
  s = await stand(P);
  pruefe('B5 zwischen den Rasten gilt der gezogene Winkel (ganze Grad)', Math.abs(s.karten.b.winkel - 22) <= 1 && Number.isInteger(s.karten.b.winkel), s.karten.b.winkel);
  await waehle(P, ['b']);
  await amKnopfDrehen(P, 'b', 7.4, { alt: true });
  s = await stand(P);
  pruefe('B6 mit Alt dreht es frei, ohne Einrasten', Math.abs(s.karten.b.winkel - 29.4) <= 1.2 && s.karten.b.winkel !== 30, s.karten.b.winkel);
  await waehle(P, ['b']);
  await P.locator('.react-flow__node[data-id="b"] [data-taste="karte-drehen"]').dblclick(); await P.waitForTimeout(350);
  s = await stand(P);
  pruefe('B7 Doppelklick auf den Knopf stellt die Karte gerade', s.karten.b.winkel === 0 && (await bild(P, 'b')).attribut === null, s.karten.b.winkel);
  const name = await P.locator('.react-flow__node[data-id="b"] [data-taste="karte-drehen"]').getAttribute('aria-label');
  pruefe('B8 der Knopf hat einen Namen und sagt, was er tut', name === 'Drehen' && /title="Drehen – Doppelklick stellt gerade"/.test(readFileSync(path.join(__repo, 'src/components/nodes/CardShell.tsx'), 'utf-8')), name);
}

// ---------- C: gemeinsam drehen ----------
console.log('C  Mehrere Karten');
{
  await waehle(P, ['b', 'c']);
  await amKnopfDrehen(P, 'c', 44);
  const s = await stand(P);
  pruefe('C1 zwei markierte Karten drehen sich gemeinsam um denselben Betrag', s.karten.c.winkel === 45 && s.karten.b.winkel === 45, [s.karten.b.winkel, s.karten.c.winkel]);
  pruefe('C2 … die nicht markierte bleibt', s.karten.a.winkel === -8);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(350);
  const z = await stand(P);
  pruefe('C3 ein Schritt zurück stellt beide wieder her', z.karten.b.winkel === 0 && z.karten.c.winkel === 0, [z.karten.b.winkel, z.karten.c.winkel]);
}

// ---------- D: Größe an der schrägen Karte ----------
console.log('D  Größe ziehen');
{
  await P.evaluate(() => 0);
  await G.ctx.close();
}
const D = await auf({ nodes: [notiz('a', 100, 140, 220, 150, 'Schräg', -8), notiz('b', 460, 140, 220, 150, 'Dreißig', 30)],
  edges: [{ id: 'e1', source: 'a', target: 'b', type: 'labeled' }],
  comments: [{ id: 'k1', nodeId: 'a', msgs: [{ author: 'Anna', text: 'Schau mal', at: '2026-11-18T10:00:00.000Z' }] }] });
{
  const P = D.P;
  await waehle(P, ['b']);
  const vor = (await stand(P)).karten.b;
  const mitteVor = { x: vor.x + vor.w / 2, y: vor.y + vor.h / 2 };
  const festVor = drehe({ x: vor.x, y: vor.y }, mitteVor, 30);            // obere linke Ecke in der Welt
  const g = await P.locator('.react-flow__node[data-id="b"] [data-ecke="1,1"]').boundingBox();
  const zoom = (await bild(P, 'b')).zoom;
  // 80 Brett-Punkte entlang der gedrehten Breite ziehen
  const zug = drehe({ x: 80 * zoom, y: 0 }, { x: 0, y: 0 }, 30);
  await P.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await P.mouse.down();
  for (let i = 1; i <= 8; i++) await P.mouse.move(g.x + g.width / 2 + (zug.x * i) / 8, g.y + g.height / 2 + (zug.y * i) / 8);
  await P.mouse.up(); await P.waitForTimeout(400);
  const nach = (await stand(P)).karten.b;
  const mitteNach = { x: nach.x + nach.w / 2, y: nach.y + nach.h / 2 };
  const festNach = drehe({ x: nach.x, y: nach.y }, mitteNach, 30);
  pruefe('D1 am unteren rechten Griff entlang der Karte gezogen: breiter, gleich hoch', nah(nach.w, vor.w + 80, 3) && nah(nach.h, vor.h, 3), { vor, nach });
  pruefe('D2 die gegenüberliegende Ecke bleibt an ihrer Stelle', nah(festNach.x, festVor.x, 1.5) && nah(festNach.y, festVor.y, 1.5), { festVor, festNach });
  pruefe('D3 die Karte bleibt schräg, die Auto-Größe ist aus (von Hand gesetzt)', nach.winkel === 30 && nach.auto === false, nach);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(350);
  const zurueck = (await stand(P)).karten.b;
  pruefe('D4 Strg+Z nimmt das Ziehen in einem Schritt zurück', nah(zurueck.w, vor.w) && nah(zurueck.x, vor.x) && nah(zurueck.y, vor.y), zurueck);
}

// ---------- E: Verbindung und Pin ----------
console.log('E  Verbindung und Kommentar-Pin');
{
  const P = D.P;
  await P.keyboard.press('Escape'); await P.locator('.react-flow__pane').click({ position: { x: 1380, y: 840 } }); await P.waitForTimeout(300);
  const d = await P.evaluate(() => document.querySelector('.react-flow__edge[data-id="e1"] path.react-flow__edge-path, .react-flow__edge path')?.getAttribute('d') ?? '');
  const m = /M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(d);
  // rechte Seitenmitte von „a" (100/140, 220 × 150), um die Mitte um −8° gedreht
  const soll = drehe({ x: 320, y: 215 }, { x: 210, y: 215 }, -8);
  pruefe('E1 die Verbindung beginnt an der gedrehten Seitenmitte der schrägen Karte', !!m && nah(Number(m[1]), soll.x, 3) && nah(Number(m[2]), soll.y, 3), { d: d.slice(0, 60), soll });
  const pin = await P.evaluate(() => { const p = document.querySelector('.comment-pin'); if (!p) return null; const r = p.getBoundingClientRect(); const v = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); const fr = document.querySelector('.react-flow').getBoundingClientRect(); return { x: (r.left + r.width / 2 - fr.left - v.e) / v.a, y: (r.top + r.height / 2 - fr.top - v.f) / v.a }; });
  const ecke = drehe({ x: 100 + 220 + 3 + 13, y: 140 - 13 + 13 }, { x: 210, y: 215 }, -8);
  pruefe('E2 der Kommentar-Pin sitzt an der gedrehten oberen rechten Ecke', !!pin && nah(pin.x, ecke.x, 6) && nah(pin.y, ecke.y, 6), { pin, ecke });
}
await D.ctx.close();

// ---------- F: Striche drehen sich mit ----------
console.log('F  Striche auf der Karte');
{
  // Eine Bild-Karte (kein Text, an dem ein Strich hängen könnte) mit einem Strich, der an ihr verankert ist
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { ctx, P: Q } = await auf({ nodes: [{ id: 'i', type: 'image', position: { x: 300, y: 200 }, width: 200, height: 200, data: { src: px, name: 'Bild.png' } }],
    drawings: [{ id: 's1', anchor: 'i', color: '#d33', width: 3, tool: 'pen', points: [[20, 10], [180, 10]] }] });
  await Q.locator('.react-flow__node[data-id="i"]').click(); await Q.waitForTimeout(400);
  await amKnopfDrehen(Q, 'i', 90);
  const s = await stand(Q);
  // Mitte (100/100): (20/10) → 90° im Uhrzeigersinn → (190/20); (180/10) → (190/180)
  const p = s.striche[0]?.points ?? [];
  pruefe('F1 das Bild steht auf 90°', s.karten.i.winkel === 90, s.karten.i);
  pruefe('F2 der verankerte Strich hat sich um die Kartenmitte mitgedreht', p.length === 2 && nah(p[0][0], 190, 1) && nah(p[0][1], 20, 1) && nah(p[1][0], 190, 1) && nah(p[1][1], 180, 1), p);
  await Q.keyboard.press('Control+z'); await Q.waitForTimeout(350);
  const z = await stand(Q);
  pruefe('F3 Strg+Z stellt Karte und Strich gemeinsam zurück', z.karten.i.winkel === 0 && nah(z.striche[0].points[0][0], 20, 0.5) && nah(z.striche[0].points[1][0], 180, 0.5), z);
  await ctx.close();
}

// ---------- F (Forts.): auf der schrägen Notiz zeichnen ----------
{
  const zeilen = Array.from({ length: 9 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Zeile ${i + 1} mit etwas Text darin`, styles: {} }] }));
  const { ctx, P: Q } = await auf({ nodes: [{ id: 'n', type: 'note', position: { x: 300, y: 160 }, width: 320, height: 240, autoFit: false, winkel: 20, data: { color: 'yellow', blocks: zeilen } }] });
  const b = await bild(Q, 'n');
  // Mitte der Karte auf dem Bildschirm, dann ein Strich entlang IHRER waagerechten Achse (20° geneigt)
  const m = { x: b.mitte.x * b.zoom + b.tx, y: b.mitte.y * b.zoom + b.ty };
  await Q.locator('.dock [aria-label="Zeichnen"]').click(); await Q.waitForTimeout(250);
  await Q.locator('.dock-menu-draw button', { hasText: 'Stift' }).click(); await Q.waitForTimeout(250);
  const r = 20 * Math.PI / 180;
  const punkte = Array.from({ length: 11 }, (_, i) => { const t = (-100 + i * 20) * b.zoom; return [m.x + t * Math.cos(r), m.y + t * Math.sin(r)]; });
  await Q.mouse.move(punkte[0][0], punkte[0][1]); await Q.mouse.down();
  for (const [x, y] of punkte.slice(1)) { await Q.mouse.move(x, y); await Q.waitForTimeout(12); }
  await Q.mouse.up(); await Q.waitForTimeout(700);
  const st = (await stand(Q)).striche[0];
  const ys = (st?.points ?? []).map((q) => q[1]); const xs = (st?.points ?? []).map((q) => q[0]);
  pruefe('F4 ein Strich auf dem Text der schrägen Notiz hängt an ihr – gespeichert in ihren Achsen (waagerecht)', !!st && st.anchor === 'n' && Math.max(...ys) - Math.min(...ys) < 6 && Math.max(...xs) - Math.min(...xs) > 170, { anchor: st?.anchor, ys: [Math.min(...ys), Math.max(...ys)], xs: [Math.min(...xs), Math.max(...xs)] });
  pruefe('F5 … mittig auf der Karte, wo er gezeichnet wurde', !!st && nah((Math.min(...xs) + Math.max(...xs)) / 2, 160, 8) && nah((Math.min(...ys) + Math.max(...ys)) / 2, 120, 12), { xs: [Math.min(...xs), Math.max(...xs)], ys: [Math.min(...ys), Math.max(...ys)] });
  await ctx.close();
}

// ---------- G: Befehle ----------
console.log('G  Schräg legen und gerade richten');
const H = await auf({ nodes: [notiz('a', 100, 140, 220, 150, 'Eins', 0), notiz('b', 460, 140, 220, 150, 'Zwei', 0), notiz('c', 820, 140, 220, 150, 'Drei', 0), kanban('k', 200, 420)] });
{
  const Q = H.P;
  await Q.locator('.react-flow__pane').click({ position: { x: 1380, y: 840 } }); await Q.keyboard.press('Control+a'); await Q.waitForTimeout(350);
  await Q.locator('[data-taste="auswahl-mehr"]').click(); await Q.waitForTimeout(200);
  await Q.locator('[data-taste="anordnen-auf"]').click(); await Q.waitForTimeout(250);
  pruefe('G1 das Anordnen-Menü bietet „Schräg legen" und „Gerade richten" (noch aus: alles gerade)', (await Q.locator('[data-anordnen="schraeg"]').count()) === 1 && await Q.locator('[data-anordnen="gerade"]').isDisabled());
  await Q.locator('[data-anordnen="schraeg"]').click(); await Q.waitForTimeout(350);
  let s = await stand(Q);
  const w = ['a', 'b', 'c'].map((id) => s.karten[id].winkel);
  pruefe('G2 „Schräg legen": jeder Zettel leicht geneigt (2° bis 7°), abwechselnd nach links und rechts', w.every((x) => Math.abs(x) >= 2 && Math.abs(x) <= 7) && w[0] < 0 && w[1] > 0 && w[2] < 0, w);
  pruefe('G3 … das Kanban bleibt gerade', s.karten.k.winkel === 0);
  pruefe('G4 … mit Meldung', /Schräg gelegt – Strg\+Z macht es rückgängig/.test(await Q.evaluate(() => document.querySelector('.toast')?.textContent ?? '')));
  await Q.keyboard.press('Escape'); await Q.locator('.react-flow__pane').click({ position: { x: 1380, y: 840 } });
  await Q.locator('.react-flow__node[data-id="b"] .card-grip').click({ force: true }); await Q.waitForTimeout(350);
  await Q.locator('[data-taste="auswahl-mehr"]').click(); await Q.waitForTimeout(250);
  pruefe('G5 an einer schrägen Karte steht „Gerade richten" im Mehr-Menü', (await Q.locator('[data-taste="gerade-richten"]').count()) === 1);
  await Q.locator('[data-taste="gerade-richten"]').click(); await Q.waitForTimeout(350);
  s = await stand(Q);
  pruefe('G6 … und stellt genau diese Karte gerade', s.karten.b.winkel === 0 && s.karten.a.winkel !== 0 && s.karten.c.winkel !== 0, ['a', 'b', 'c'].map((id) => s.karten[id].winkel));
  await Q.locator('[data-taste="auswahl-mehr"]').click(); await Q.waitForTimeout(250);
  pruefe('G7 an der geraden Karte fehlt der Eintrag', (await Q.locator('[data-taste="gerade-richten"]').count()) === 0);
  await Q.keyboard.press('Escape');
}

// ---------- H: Verschieben, Schreiben, Neuladen, Texte ----------
console.log('H  Alltag und Texte');
{
  const Q = H.P;
  // Verschieben: während des Ziehens bleibt die Karte schräg
  const griff = await Q.locator('.react-flow__node[data-id="a"] .card-grip').boundingBox();
  await Q.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2); await Q.mouse.down();
  await Q.mouse.move(griff.x + 60, griff.y + 120, { steps: 6 });
  const unterwegs = await bild(Q, 'a');
  await Q.mouse.up(); await Q.waitForTimeout(350);
  let s = await stand(Q);
  pruefe('H1 beim Verschieben bleibt die Karte schräg und wandert mit', Math.abs(unterwegs.grad) >= 2 && s.karten.a.y > 200 && s.karten.a.winkel !== 0, { unterwegs: unterwegs.grad, y: s.karten.a.y });
  // Schreiben in der schrägen Notiz: sie wächst einmal und dann nicht weiter
  await Q.evaluate(() => { const roh = JSON.parse(localStorage.getItem('pixinotes-board')); return roh; });
  await H.ctx.close();
  const lang = Array.from({ length: 14 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Zeile ${i + 1}`, styles: {} }] }));
  const W = await auf({ nodes: [{ id: 'n', type: 'note', position: { x: 300, y: 120 }, width: 220, height: 90, winkel: 6, data: { color: 'yellow', blocks: lang } }] });
  await W.P.waitForTimeout(1600);
  const h1 = (await stand(W.P)).karten.n.h; await W.P.waitForTimeout(1500); const h2 = (await stand(W.P)).karten.n.h;
  pruefe('H2 die schräge Notiz mit Auto-Größe wächst auf ihren Inhalt und bleibt dann stehen', h1 > 200 && h1 === h2 && h1 <= 640, { h1, h2 });
  await W.P.reload({ waitUntil: 'networkidle' }); await W.P.waitForTimeout(1300);
  pruefe('H3 nach dem Neuladen liegt sie weiter schräg', (await bild(W.P, 'n'))?.grad === 6);
  await W.ctx.close();
  const E = await auf({ nodes: [notiz('a', 300, 200, 220, 150, 'One', 5)] }, 'en');
  await E.P.locator('.react-flow__node[data-id="a"] .card-grip').click({ force: true }); await E.P.waitForTimeout(350);
  const t = await E.P.locator('[data-taste="karte-drehen"]').getAttribute('title');
  await E.P.locator('[data-taste="auswahl-mehr"]').click(); await E.P.waitForTimeout(250);
  const eintrag = await E.P.locator('[data-taste="gerade-richten"]').textContent();
  pruefe('H4 Knopf und Eintrag sind englisch', /Rotate – double-click straightens/.test(t ?? '') && /Straighten/.test(eintrag ?? ''), { t, eintrag });
  await E.ctx.close();
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  pruefe('H5 die Hilfe nennt M400 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M400)') && lies('src/components/HelpOverlayEn.tsx').includes('(M400)'));
  pruefe('H6 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm400-drehen: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
