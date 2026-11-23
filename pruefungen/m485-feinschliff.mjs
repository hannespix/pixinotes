/**
 * M485 — Feinschliff Ziehen und Rechtschreibung (Nachzug zu M481 und M482).
 *
 *   K  Kanten folgen der sichtbaren Karte: der gehobenen (vergrößerten) und den ausweichenden Nachbarn — Bild für
 *      Bild, ohne Nachlauf, ohne Speichern während des Zugs; nach dem Ablegen ohne doppelten Versatz.
 *   W  Kettenreaktion: Eine ausweichende Karte nimmt ihre Nachbarin mit (bis drei Stufen, gedämpft), die vierte
 *      bleibt liegen; „weniger Bewegung" = einstufig. Ein Strg+Z nimmt alles zurück.
 *   L  Flüssig mit 200 Karten und 20 Verbindungen (der Beobachter liest nur Karten mit Verbindung).
 *   C  Codeblock und Inline-Code einer Notiz ohne Rechtschreibprüfung, Fließtext mit.
 *   T  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m485-feinschliff.mjs`
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
const PORT = 5485;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const nz = (id, x, y, farbe = 'yellow') => ({ id, type: 'note', width: 200, height: 120, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
const kante = (id, source, target) => ({ id, source, target, type: 'labeled', data: { label: '', kind: 'arrow' } });
const board = (nodes, edges) => ({
  boards: [{ id: 'b1', name: 'Feinschliff', comments: [], edges, drawings: [], nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});
// a wird auf b gezogen; b, d, e, f stehen in einer Spalte mit 20 Punkten Luft — die Kette läuft nach unten
const STAND = () => board([
  nz('a', 0, 0), nz('b', 360, 0, 'sky'), nz('d', 360, 140, 'green'), nz('e', 360, 280, 'sky'), nz('f', 360, 420, 'green'),
  nz('g', 900, 150, 'sky'), nz('h', -600, 300, 'green'),
], [kante('e1', 'd', 'g'), kante('e2', 'a', 'h')]);
const VIELE = () => {
  const nodes = []; const edges = [];
  for (let i = 0; i < 200; i += 1) nodes.push(nz(`k${i}`, (i % 20) * 230, Math.floor(i / 20) * 150, i % 3 ? 'yellow' : 'sky'));
  for (let i = 0; i < 199; i += 10) edges.push(kante(`v${i}`, `k${i}`, `k${i + 1}`));
  return board(nodes, edges);
};

async function seite(st, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', ...opt });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, st);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const zoomVon = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const rahmen = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, id);
const stand = (P) => P.evaluate(() => Object.fromEntries(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.map((n) => [n.id, n.position])));
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`) ?? document.querySelector(`.react-flow__node[data-id="${id}"]`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 12)]; }, id);
const leer = (P) => P.mouse.click(1420, 880).then(() => P.waitForTimeout(200));

/**
 * Wo endet die Kante `kid` an der Karte `nid` auf dem Bildschirm, und wo müsste sie nach der sichtbaren Karte enden
 * (Mitte der Seite `seite`: 'links' | 'rechts')? Liest Pfad und Karte im selben Bild.
 */
const KANTE_JS = `(([kid, nid, seite, ende]) => {
  const p = document.querySelector('.react-flow__edge[data-id="' + kid + '"] path.react-flow__edge-path');
  const zahlen = (p.getAttribute('d').match(/-?[\\d.]+(e-?\\d+)?/g) || []).map(Number);
  const [x, y] = ende === 'start' ? zahlen.slice(0, 2) : zahlen.slice(-2);
  const m = p.getScreenCTM();
  const pt = new DOMPoint(x, y).matrixTransform(m);
  const r = document.querySelector('.react-flow__node[data-id="' + nid + '"]').getBoundingClientRect();
  const sx = seite === 'links' ? r.left : r.right;
  return { dx: pt.x - sx, dy: pt.y - (r.top + r.height / 2), x: pt.x, y: pt.y, rx: sx, ry: r.top + r.height / 2 };
})`;
const kantenEnde = (P, kid, nid, seite, ende) => P.evaluate(`${KANTE_JS}(${JSON.stringify([kid, nid, seite, ende])})`);
/** Abweichung Kante ↔ Karte über n Bilder (je Bild gemessen) */
const kantenSpur = (P, kid, nid, seite, ende, n = 30) => P.evaluate(`(async () => {
  const f = ${KANTE_JS}; const out = [];
  for (let i = 0; i < ${n}; i += 1) { await new Promise((r) => requestAnimationFrame(r)); const k = f(${JSON.stringify([kid, nid, seite, ende])}); out.push([Math.round(Math.hypot(k.dx, k.dy) * 10) / 10, Math.round(k.y)]); }
  return out;
})()`);

/* ═══════════════════════ Kanten und Kette ═══════════════════════ */
{
  const { ctx, P } = await seite(STAND());
  const z = await zoomVon(P);
  console.log(`  (Zoom ${z})`);
  const r0 = Object.fromEntries(await Promise.all(['a', 'b', 'd', 'e', 'f'].map(async (id) => [id, await rahmen(P, id)])));
  const s0 = await stand(P);
  const k0 = await kantenEnde(P, 'e1', 'd', 'rechts', 'start');
  pruefe('K0 ruhend: die Kante d→g endet an d (rechte Seitenmitte)', Math.hypot(k0.dx, k0.dy) < 1.5, k0);

  console.log('\n════ W/K: a auf b ziehen ════');
  await leer(P);
  const g = await griff(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 4, { steps: 2 }); await P.mouse.move(g[0], g[1], { steps: 2 });
  // a nach (333, -47): überdeckt b von oben — b weicht nach unten aus, schiebt d, d schiebt e; f liegt eine Stufe zu tief
  const ziel = [g[0] + 333 * z, g[1] - 47 * z];
  // Die Spur läuft schon während der Mausbewegung (ein Zugschritt kostet im Prüf-Chromium viel, die Übergänge sind kurz)
  const spurHinP = kantenSpur(P, 'e1', 'd', 'rechts', 'start', 60);
  await P.mouse.move(ziel[0], ziel[1], { steps: 12 });
  const spurHin = await spurHinP;
  await P.waitForTimeout(500);
  const r1 = Object.fromEntries(await Promise.all(['a', 'b', 'd', 'e', 'f'].map(async (id) => [id, await rahmen(P, id)])));
  const weg = (id) => Math.hypot(r1[id].x - r0[id].x, r1[id].y - r0[id].y) / z;
  console.log(`  (ausgewichen: b ${weg('b').toFixed(0)}, d ${weg('d').toFixed(0)}, e ${weg('e').toFixed(0)}, f ${weg('f').toFixed(1)} Punkte)`);
  pruefe('W1 b weicht aus (erste Stufe)', weg('b') > 60, weg('b'));
  pruefe('W2 … und nimmt d mit (zweite Stufe)', weg('d') > 40, weg('d'));
  pruefe('W3 … d nimmt e mit (dritte Stufe)', weg('e') > 20, weg('e'));
  pruefe('W4 gedämpft: jede Stufe bewegt sich weniger (b > d > e)', weg('b') > weg('d') && weg('d') > weg('e'), [weg('b'), weg('d'), weg('e')]);
  pruefe('W5 begrenzt: die vierte Karte (f) bleibt liegen', weg('f') < 0.5, weg('f'));
  pruefe('W6 keine Karte liegt mehr auf einer anderen (b/d/e ohne Überdeckung)', ['b', 'd', 'e'].every((id, i, l) => i === 0 || r1[l[i - 1]].y + r1[l[i - 1]].h <= r1[id].y + 0.5), r1);
  await P.screenshot({ path: path.join(SD, 'm485-kette.png') });

  const kD = await kantenEnde(P, 'e1', 'd', 'rechts', 'start');
  pruefe('K1 die Kante d→g folgt dem ausgewichenen d (rechte Seitenmitte der sichtbaren Karte)', Math.hypot(kD.dx, kD.dy) < 1.5 && Math.abs(kD.y - k0.y) > 30 * z, { kD, vorher: k0.y });
  const maxHin = Math.max(...spurHin.map((p) => p[0]));
  const stufenHin = new Set(spurHin.map((p) => p[1])).size;
  pruefe('K2 … Bild für Bild, ohne Nachlauf (Abweichung ≤ 1,5 px über den ganzen Übergang)', maxHin <= 1.5 && stufenHin >= 4, { maxHin, stufenHin, spur: spurHin.slice(0, 12) });
  const kA = await kantenEnde(P, 'e2', 'a', 'links', 'start');
  pruefe('K3 die Kante a→h endet an der GEHOBENEN Karte a (größer, linke Seitenmitte)', r1.a.w > r0.a.w * 1.03 && Math.hypot(kA.dx, kA.dy) < 1.5, { kA, w: r1.a.w, w0: r0.a.w });
  const sZug = await stand(P);
  pruefe('K4 während des Zugs wird nichts gespeichert (b, d, e im Stand unverändert)', ['b', 'd', 'e'].every((id) => sZug[id].x === s0[id].x && sZug[id].y === s0[id].y), sZug);

  // weg von b: alle gleiten zurück — die Kante folgt jedem Bild
  const spurZurueckP = kantenSpur(P, 'e1', 'd', 'rechts', 'start', 60);
  await P.mouse.move(ziel[0], ziel[1] - 260 * z, { steps: 3 });
  const spurZurueck = await spurZurueckP;
  await P.waitForTimeout(400);
  const maxZ = Math.max(...spurZurueck.map((p) => p[0]));
  pruefe('K5 zurückgleiten: Kante bleibt an d (≤ 1,5 px je Bild)', maxZ <= 1.5 && new Set(spurZurueck.map((p) => p[1])).size >= 4, { maxZ, spur: spurZurueck.slice(0, 12) });
  const dZ = await rahmen(P, 'd');
  pruefe('K6 … und d ist wieder an seinem Platz', Math.abs(dZ.y - r0.d.y) < 1 && Math.abs(dZ.x - r0.d.x) < 1, { dZ, d0: r0.d });

  // wieder auf b und dort ablegen
  await P.mouse.move(ziel[0], ziel[1], { steps: 6 }); await P.waitForTimeout(700);
  await P.mouse.up();
  const spurAb = await kantenSpur(P, 'e1', 'd', 'rechts', 'start', 30);
  const maxAb = Math.max(...spurAb.map((p) => p[0]));
  pruefe('K7 abgelegt: die Kante springt nicht (kein doppelter Versatz, ≤ 1,5 px je Bild)', maxAb <= 1.5, { maxAb, spur: spurAb.slice(0, 10) });
  await P.waitForTimeout(900);
  const sAb = await stand(P);
  const kEnde = await kantenEnde(P, 'e1', 'd', 'rechts', 'start');
  const kAEnde = await kantenEnde(P, 'e2', 'a', 'links', 'start');
  pruefe('K8 nach dem Landen: Kanten an den Karten (a flach, d an neuer Lage)', Math.hypot(kEnde.dx, kEnde.dy) < 1 && Math.hypot(kAEnde.dx, kAEnde.dy) < 1, { kEnde, kAEnde });
  pruefe('W7 die Kette steht jetzt im Stand (b, d, e verschoben, f nicht)', sAb.b.y > s0.b.y + 60 && sAb.d.y > s0.d.y + 40 && sAb.e.y > s0.e.y + 20 && sAb.f.y === s0.f.y, sAb);
  const translate = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].filter((e) => e.style.translate && e.style.translate !== 'none').length);
  pruefe('W8 kein Rest-Versatz an den Knoten', translate === 0, translate);
  await leer(P);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(1300);
  const sU = await stand(P);
  pruefe('W9 EIN Strg+Z nimmt Zug und ganze Kette zurück', ['a', 'b', 'd', 'e'].every((id) => sU[id].x === s0[id].x && sU[id].y === s0[id].y), sU);
  await ctx.close();
}

/* ═══════════════════════ Weniger Bewegung ═══════════════════════ */
console.log('\n════ W: weniger Bewegung ════');
{
  const { ctx, P } = await seite(STAND(), { reducedMotion: 'reduce' });
  const z = await zoomVon(P);
  const b0 = await rahmen(P, 'b'); const d0 = await rahmen(P, 'd');
  await leer(P);
  const g = await griff(P, 'a');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 4, g[1] + 4, { steps: 2 }); await P.mouse.move(g[0], g[1], { steps: 2 });
  await P.mouse.move(g[0] + 333 * z, g[1] - 47 * z, { steps: 10 }); await P.waitForTimeout(500);
  const b1 = await rahmen(P, 'b'); const d1 = await rahmen(P, 'd');
  pruefe('W10 b weicht aus, d bleibt (keine Kette)', Math.abs(b1.y - b0.y) > 40 * z && Math.abs(d1.y - d0.y) < 0.5, { b: b1.y - b0.y, d: d1.y - d0.y });
  const k = await kantenEnde(P, 'e1', 'd', 'rechts', 'start');
  pruefe('W11 die Kante folgt auch hier (an d)', Math.hypot(k.dx, k.dy) < 1.5, k);
  await P.mouse.up(); await P.waitForTimeout(400);
  await ctx.close();
}

/* ═══════════════════════ Leistung ═══════════════════════ */
console.log('\n════ L: 200 Karten, 20 Verbindungen ════');
{
  const { ctx, P } = await seite(VIELE());
  const n = await P.evaluate(() => [document.querySelectorAll('.react-flow__node').length, document.querySelectorAll('.react-flow__edge').length]);
  const r42 = await rahmen(P, 'k42');
  const g = [r42.cx, r42.cy];
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 3, g[1] + 3, { steps: 2 }); await P.mouse.move(g[0] + 6, g[1] + 6, { steps: 2 });
  const takt = P.evaluate(() => new Promise((res) => { const z = []; let l = performance.now(); let k = 0; const f = (t) => { z.push(t - l); l = t; if (++k < 90) requestAnimationFrame(f); else res(z); }; requestAnimationFrame(f); }));
  for (let i = 1; i <= 50; i += 1) { await P.mouse.move(g[0] + i * 14, g[1] + Math.sin(i / 4) * 120); await P.waitForTimeout(16); }
  const zt = (await takt).slice(3).sort((x, y) => x - y);
  const ausgewichen = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].filter((e) => e.style.translate && e.style.translate !== 'none').length);
  await P.mouse.up(); await P.waitForTimeout(500);
  const median = zt[Math.floor(zt.length / 2)];
  console.log(`  (${n[0]} Karten, ${n[1]} Kanten, ausgewichen ${ausgewichen}, Median ${median.toFixed(1)} ms, p90 ${zt[Math.floor(zt.length * 0.9)].toFixed(1)} ms)`);
  pruefe('L1 beim Ziehen über das volle Board weichen Karten aus (mit Kette)', n[0] >= 200 && ausgewichen >= 2, { n, ausgewichen });
  pruefe('L2 der Takt hält mit Verbindungen (Median ≤ 18 ms je Bild)', median <= 18, { median });
  await ctx.close();
}

/* ═══════════════════════ Codeblock ohne Rechtschreibprüfung ═══════════════════════ */
console.log('\n════ C: Codeblock in der Notiz ════');
{
  const notiz = { id: 'no', type: 'note', width: 360, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [
    { id: 'p1', type: 'paragraph', content: 'Fließtext mit Fehlr' },
    { id: 'c1', type: 'codeBlock', props: { language: 'text' }, content: 'const zahl = 1' },
    { id: 'p2', type: 'paragraph', content: [{ type: 'text', text: 'Aufruf ', styles: {} }, { type: 'text', text: 'npm ci', styles: { code: true } }] },
  ] } };
  const { ctx, P } = await seite(board([notiz], []));
  const knoten = P.locator('.react-flow__node[data-id="no"]');
  const bn = await knoten.boundingBox();
  await P.mouse.dblclick(bn.x + 60, bn.y + 30); await P.waitForTimeout(700);
  await knoten.locator('[data-content-type="paragraph"] .bn-inline-content').first().click(); await P.waitForTimeout(300);
  const lies = () => P.evaluate(() => {
    const k = document.querySelector('.react-flow__node[data-id="no"]');
    const code = k.querySelector('[data-content-type="codeBlock"] code');
    const text = k.querySelector('[data-content-type="paragraph"] .bn-inline-content');
    const inline = [...k.querySelectorAll('[data-content-type="paragraph"] code')][0];
    return { code: code?.spellcheck, codeBlock: code?.closest('[data-content-type="codeBlock"]')?.spellcheck, text: text?.spellcheck, inline: inline?.spellcheck, inlineGibt: !!inline, bearbeitbar: !!k.querySelector('[contenteditable="true"]') };
  });
  const c1 = await lies();
  pruefe('C1 die Notiz ist im Bearbeiten', c1.bearbeitbar, c1);
  pruefe('C2 Fließtext wird geprüft (spellcheck = true)', c1.text === true, c1);
  pruefe('C3 Codeblock ohne Prüfung (spellcheck = false)', c1.code === false && c1.codeBlock === false, c1);
  pruefe('C4 Inline-Code ohne Prüfung', c1.inlineGibt && c1.inline === false, c1);
  // im Codeblock tippen — der Editor zeichnet den Block neu, das Attribut bleibt
  await knoten.locator('[data-content-type="codeBlock"] code').click(); await P.waitForTimeout(200);
  await P.keyboard.press('End'); await P.keyboard.type(' + zwei'); await P.waitForTimeout(500);
  const c2 = await lies();
  pruefe('C5 nach dem Tippen im Codeblock bleibt er ohne Prüfung, der Fließtext mit', c2.code === false && c2.text === true, c2);
  const gespeichert = await P.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.blocks));
  pruefe('C6 der getippte Code ist gespeichert (Block-Typ unverändert)', /codeBlock/.test(gespeichert) && /zwei/.test(gespeichert), gespeichert.slice(0, 200));
  // neuen Codeblock über ``` anlegen
  await knoten.locator('[data-content-type="paragraph"] .bn-inline-content').first().click(); await P.waitForTimeout(150);
  await P.keyboard.press('End'); await P.keyboard.press('Enter'); await P.keyboard.type('``` '); await P.waitForTimeout(400);
  await P.keyboard.type('let neu'); await P.waitForTimeout(300);
  const neu = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="no"] [data-content-type="codeBlock"] code')].map((c) => c.spellcheck));
  pruefe('C7 ein neu angelegter Codeblock (```) ist ebenfalls ohne Prüfung', neu.length >= 2 && neu.every((s) => s === false), neu);
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
console.log('\n════ T: Texte ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('T1 Hilfe deutsch und englisch nennen M485', /M485/.test(hilfe) && /M485/.test(hilfeEn));
  pruefe('T2 Meilenstein-Datei liegt vor', existsSync(path.join(__repo, 'docs/meilensteine/M485-feinschliff.md')));
}
await browser.close(); app.close();
console.log(`\nM485: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
