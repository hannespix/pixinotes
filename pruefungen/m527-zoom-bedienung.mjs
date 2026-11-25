/**
 * M527 — Bedienung auf dem Board in jeder Zoomstufe gleich verlässlich.
 *
 * Gemeldet: „in manchen Zoomstufen verschwindet das Textformatierungs-Menü sofort, bevor man etwas verändern kann …
 * auch das Verschieben von Rahmen und Karten und die Auswahl ist manchmal nicht ganz intuitiv … und dass man nicht in
 * allen Zoomstufen Pfeil-Connectoren bekommt."
 *
 *   A  Formatier-Leiste: in jeder Zoomstufe gleich groß, ganz im Bild, über allem; im weiten Zoom (unter ~45 %) trifft
 *      der Klick den Knopf statt eines Anschlusspunkts der Karte (vorher: Leiste weg, nichts fett); Anzeige 130 %:
 *      die Leiste steht über dem Text; Aa-Menü bleibt offen, auch wenn die Notiz schrumpfen möchte; Entf nach einem
 *      Klick in die Leiste löscht keine Karte.
 *   B  Ruhende Notiz (noch ohne Editor): Ziehen über den Text markiert ihn und zeigt die Leiste, Doppelklick markiert
 *      das Wort — vorher war der erste Zug bzw. Doppelklick verloren.
 *   C  Pfeile: Vom Anschlusspunkt der gewählten Karte entsteht in jeder Zoomstufe ein Pfeil (vorher unter ~45 %: der
 *      Zug verschob die Karte). Im weiten Zoom stehen Anschlusspunkte und Größen-Griffe vor der Kante — ein Zug
 *      irgendwo auf der gewählten Karte verschiebt sie, die Ecke ändert weiter die Größe.
 *   D  Verbindungen trifft man in jeder Zoomstufe 20 Bildpunkte breit; die Leiste der gewählten Verbindung bleibt
 *      bildschirmgroß.
 *   E  Rahmentitel (einziger Griff des Rahmens) bleibt bildschirmgroß; der Zug daran verschiebt Rahmen samt Inhalt.
 */
// Läuft aus dem Repository: `node pruefungen/m527-zoom-bedienung.mjs` (gegen einen anderen Build: PN_DIST=…)
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
const PORT = 5527;
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

const nz = (id, x, y, text = id, w = 260, h = 160, autoFit = false) => ({ id, type: 'note', width: w, height: h, autoFit, position: { x, y }, data: { color: 'yellow', blocks: [{ id: id + 't', type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const fr = (id, x, y, w, h, name = id) => ({ id, type: 'frame', width: w, height: h, position: { x, y }, data: { name } });
const kt = (id, s, t, label = '') => ({ id, source: s, target: t, type: 'labeled', data: { label, kind: 'arrow' } });
const stand = (nodes, edges = [], extra = {}) => ({
  boards: [{ id: 'b1', name: 'Zoom', comments: [], edges, drawings: [], nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', ...extra,
});

async function seite(st, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', ...opt });
  await ctx.addInitScript(({ st }) => {
    try { if (window !== window.top) return; } catch { return; }
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-stapel-gelernt', '1');
  }, { st });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1000);
  return { ctx, P };
}
const warteBis = async (P, fn, arg, ms = 6000) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const zoomVon = (P) => P.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
const kasten = (P, sel) => P.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.right, u: r.bottom }; }, sel);
const karte = (P, id) => kasten(P, `.react-flow__node[data-id="${id}"]`);
/** Zoom genau einstellen: feine Strg-Rad-Schritte (Kneifen am Trackpad) an der Bildmitte */
async function zoomAuf(P, ziel) {
  await P.keyboard.down('Control');
  for (let i = 0; i < 120; i++) {
    const hoch = Math.log2(ziel / await zoomVon(P));
    if (Math.abs(hoch) < 0.003) break;
    await P.mouse.move(720, 450);
    await P.mouse.wheel(0, -Math.max(-0.18, Math.min(0.18, hoch)) / 0.01);
    await P.waitForTimeout(25);
  }
  await P.keyboard.up('Control');
  // der Zoom „ruht" (Board.tsx setzt --pn-inv und den weiten Zoom nach 90 ms)
  await P.waitForTimeout(350);
}
/** Karte in die Bildmitte holen (das Rad schwenkt) */
async function mitte(P, id, ziel = [720, 450]) {
  for (let i = 0; i < 6; i++) {
    const k = await karte(P, id);
    if (!k) return;
    const dx = ziel[0] - k.cx; const dy = ziel[1] - k.cy;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) break;
    // Rad auf freier Fläche (über der Werkzeugleiste unten nähme Chromium einen waagerechten Wisch als „Zurück")
    await P.mouse.move(1420, 500); await P.mouse.wheel(-dx, -dy); await P.waitForTimeout(150);
  }
}
async function aufstellen(P, id, z) { await mitte(P, id); await zoomAuf(P, z); await mitte(P, id); await P.mouse.move(5, 600); await P.waitForTimeout(150); }
const weit = (P) => P.evaluate(() => document.querySelector('.board-wrap')?.hasAttribute('data-weit'));
/** erstes Wort (5 Zeichen) einer Notiz */
const wort = (P, id) => P.evaluate((id) => {
  const p = document.querySelector(`.react-flow__node[data-id="${id}"] .bn-inline-content`); if (!p) return null;
  let t = p.firstChild; while (t && t.nodeType !== 3) t = t.firstChild; if (!t) return null;
  const rg = document.createRange(); rg.setStart(t, 0); rg.setEnd(t, 5); const b = rg.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, r: b.right, oben: b.top };
}, id);
const leiste = (P) => P.evaluate(() => {
  const t = document.querySelector('.bn-formatting-toolbar'); if (!t) return null;
  const b = t.getBoundingClientRect();
  const fett = [...t.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Fett')?.getBoundingClientRect();
  const knoepfe = [...t.querySelectorAll('button')];
  const daneben = knoepfe.filter((k) => { const q = k.getBoundingClientRect(); const cx = q.left + q.width / 2; const cy = q.top + q.height / 2; if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return true; const h = document.elementFromPoint(cx, cy); return !h || !t.contains(h); }).length;
  return { h: Math.round(b.height), w: Math.round(b.width), oben: Math.round(b.top), unten: Math.round(b.bottom), fx: fett && fett.left + fett.width / 2, fy: fett && fett.top + fett.height / 2, fett: fett && Math.round(fett.height), daneben, n: knoepfe.length };
});
const fettIn = (P, id) => P.evaluate((id) => !!document.querySelector(`.react-flow__node[data-id="${id}"] strong`), id);
async function zug(P, x, y, dx, dy) {
  await P.mouse.move(x, y); await P.mouse.down();
  await P.mouse.move(x + 4, y + 3, { steps: 2 });
  await P.mouse.move(x + dx, y + dy, { steps: 10 });
  await P.mouse.up(); await P.waitForTimeout(350);
}
/** Lage und Größe einer Karte im gespeicherten Stand */
const lage = (P, id) => P.evaluate((id) => { const n = document.querySelector(`.react-flow__node[data-id="${id}"]`); const t = new DOMMatrixReadOnly(getComputedStyle(n).transform); return { x: Math.round(t.e), y: Math.round(t.f), w: n.offsetWidth, h: n.offsetHeight }; }, id);
const matrix = [];

/* ═══════════════════════ A: Formatier-Leiste ═══════════════════════ */
console.log('\n════ A: Formatier-Leiste in jeder Zoomstufe ════');
for (const z of [0.5, 1, 2, 3]) {
  const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Hallo Welt Formatierung'), nz('B', 0, -230, 'Oben')]));
  await aufstellen(P, 'A', z);
  const w = await wort(P, 'A');
  await P.mouse.click(w.x, w.y); await P.waitForTimeout(400);
  await P.mouse.dblclick(w.x, w.y);
  await warteBis(P, () => !!document.querySelector('.bn-formatting-toolbar'));
  const l = await leiste(P);
  matrix.push(`A Zoom ${z}: Leiste ${l?.w}×${l?.h}, Knopf ${l?.fett} px, nicht treffbar ${l?.daneben}`);
  pruefe(`A1 ${z * 100} %: die Leiste ist so groß wie bei 100 % (36 Bildpunkte hoch, Knöpfe 30)`, l && Math.abs(l.h - 36) <= 2 && Math.abs(l.fett - 30) <= 2, l);
  pruefe(`A2 ${z * 100} %: jeder Knopf liegt im Bild und obenauf`, l && l.daneben === 0, l);
  if (l?.fx) { await P.mouse.click(l.fx, l.fy); }
  pruefe(`A3 ${z * 100} %: „Fett" wirkt`, await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="A"] strong')));
  if (z === 3) await P.screenshot({ path: path.join(SD, 'm527-leiste-300.png') });
  await ctx.close();
}
for (const z of [0.25, 0.4]) {
  // markiert bei 60 %, dann herausgezoomt — die Leiste steht noch, ihre Knöpfe müssen wirken
  const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Hallo Welt Formatierung'), nz('B', 0, -230, 'Oben')]));
  await aufstellen(P, 'A', 0.6);
  const w = await wort(P, 'A');
  await P.mouse.click(w.x, w.y); await P.waitForTimeout(400);
  await P.mouse.dblclick(w.x, w.y);
  await warteBis(P, () => !!document.querySelector('.bn-formatting-toolbar'));
  await zoomAuf(P, z);
  const l = await leiste(P);
  pruefe(`A4 ${z * 100} % (weiter Zoom: ${await weit(P)}): die Leiste steht und ist treffbar`, l && l.daneben === 0 && l.h >= 34, l);
  if (l?.fx) await P.mouse.click(l.fx, l.fy);
  const fett = await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="A"] strong'), undefined, 4000);
  matrix.push(`A Zoom ${z} nach dem Markieren: Leiste ${l?.h} hoch, Fett wirkt ${fett}`);
  pruefe(`A5 ${z * 100} %: ein Klick auf „Fett" wirkt (vorher traf er einen Anschlusspunkt, die Leiste verschwand)`, fett);
  pruefe(`A6 ${z * 100} %: die Leiste ist danach noch da`, await P.evaluate(() => !!document.querySelector('.bn-formatting-toolbar')));
  if (z === 0.25) await P.screenshot({ path: path.join(SD, 'm527-leiste-25.png') });
  await ctx.close();
}
{
  // Anzeige 130 %: Die Lage rechnet floating-ui in Bildschirm-Punkten
  const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Hallo Welt Formatierung')], [], { anzeige: 1.3 }));
  await mitte(P, 'A');
  const w = await wort(P, 'A');
  await P.mouse.click(w.x, w.y); await P.waitForTimeout(400);
  await P.mouse.dblclick(w.x, w.y);
  await warteBis(P, () => !!document.querySelector('.bn-formatting-toolbar'));
  const l = await leiste(P); const w2 = await wort(P, 'A');
  pruefe('A7 Anzeige 130 %: die Leiste steht über dem markierten Wort, nicht versetzt', l && l.unten <= w2.oben + 2 && l.unten >= w2.oben - 40, { l, wort: w2 });
  // Aa-Menü: öffnet unter seinem Knopf und bleibt offen
  const aa = await P.evaluate(() => { const b = [...document.querySelectorAll('.bn-formatting-toolbar button')].find((x) => x.textContent.trim() === 'Aa'); const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, u: q.bottom }; });
  await P.mouse.click(aa.x, aa.y);
  const auf = await warteBis(P, () => !!document.querySelector('.pn-typo-menu'));
  const m = await kasten(P, '.pn-typo-menu');
  pruefe('A8 das Aa-Menü öffnet direkt unter seinem Knopf', auf && m && m.y >= aa.u - 2 && m.y <= aa.u + 40 && m.r <= 1440, { m, aa });
  await ctx.close();
}
{
  // Notiz mit Auto-Größe: sie schrumpft, sobald der Fokus sie verlässt — nicht, wenn er ins Aa-Menü geht
  const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Hallo Welt Formatierung', 380, 240, true)]));
  await mitte(P, 'A');
  const w = await wort(P, 'A');
  await P.mouse.click(w.x, w.y); await P.waitForTimeout(300);
  await P.keyboard.press('End'); await P.keyboard.type('!'); await P.waitForTimeout(300);
  await P.keyboard.press('Control+A'); await P.waitForTimeout(400);
  await warteBis(P, () => !!document.querySelector('.bn-formatting-toolbar'));
  await P.evaluate(() => [...document.querySelectorAll('.bn-formatting-toolbar button')].find((x) => x.textContent.trim() === 'Aa')?.click());
  await warteBis(P, () => !!document.querySelector('.pn-typo-menu'));
  await P.waitForTimeout(1200);
  pruefe('A9 das Aa-Menü bleibt offen (die Notiz schrumpft nicht unter ihm weg)', await P.evaluate(() => !!document.querySelector('.pn-typo-menu')));
  await P.keyboard.press('Escape');
  // Entf nach einem Klick in die Leiste: löscht Text, keine Karte
  await P.keyboard.press('Control+A'); await P.waitForTimeout(400);
  await warteBis(P, () => !!document.querySelector('.bn-formatting-toolbar'));
  const l = await leiste(P);
  if (l?.fx) await P.mouse.click(l.fx, l.fy);
  await P.waitForTimeout(300);
  await P.keyboard.press('Delete'); await P.waitForTimeout(600);
  pruefe('A10 Entf nach einem Klick in die Leiste löscht den Text, nicht die Karte', await P.evaluate(() => !!document.querySelector('.react-flow__node[data-id="A"]')));
  await ctx.close();
}

/* ═══════════════════════ B: ruhende Notiz ═══════════════════════ */
console.log('\n════ B: Text einer ruhenden Notiz markieren ════');
for (const z of [0.5, 1, 2]) {
  for (const art of ['zug', 'doppelklick']) {
    const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Hallo Welt Formatierung'), fr('F', 0, 300, 600, 400, 'Rahmen'), nz('C', 60, 400, 'Drinnen ist Text')]));
    await aufstellen(P, 'C', z);
    pruefe(`B0 ${z * 100} % ${art}: die Notiz ruht (noch kein Editor)`, await P.evaluate(() => !document.querySelector('.react-flow__node[data-id="C"] [contenteditable="true"]')));
    const w = await wort(P, 'C');
    if (art === 'zug') { await P.mouse.move(w.l + 1, w.y); await P.mouse.down(); await P.mouse.move(w.r - 1, w.y, { steps: 6 }); await P.mouse.up(); }
    else await P.mouse.dblclick(w.x, w.y);
    const da = await warteBis(P, () => !!document.querySelector('.bn-formatting-toolbar') && String(getSelection()).length > 0, undefined, 4000);
    const sel = await P.evaluate(() => String(getSelection()));
    matrix.push(`B Zoom ${z} ${art}: Markierung „${sel}", Leiste ${da}`);
    pruefe(`B1 ${z * 100} % ${art} über den Text: markiert „Drinn…" und zeigt die Leiste`, da && /^Drinn/.test(sel), sel);
    pruefe(`B2 ${z * 100} % ${art}: die Karte ist dabei gewählt (wie beim wachen Editor)`, await P.evaluate(() => document.querySelector('.react-flow__node[data-id="C"]')?.classList.contains('selected')));
    await ctx.close();
  }
}

/* ═══════════════════════ C: Pfeile, Griffe, Ziehen ═══════════════════════ */
console.log('\n════ C: Pfeile ziehen und Karten greifen ════');
for (const z of [0.15, 0.25, 0.35, 0.5, 1, 3]) {
  const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Hallo Welt'), nz('B', 340, 0, 'Ziel')]));
  await aufstellen(P, 'A', z);
  const istWeit = await weit(P);
  const a = await karte(P, 'A');
  await P.mouse.click(a.cx, a.cy);
  await warteBis(P, () => document.querySelector('.react-flow__node[data-id="A"]')?.classList.contains('selected'));
  await P.mouse.move(a.cx, a.cy - 1); await P.waitForTimeout(250);
  const h = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="A"] .pn-handle')].map((e) => { const q = e.getBoundingClientRect(); const cx = q.left + q.width / 2; const cy = q.top + q.height / 2; const t = document.elementFromPoint(cx, cy); return { cx, cy, w: Math.round(q.width), trifft: !!t && (t === e || e.contains(t)), l: q.left, r: q.right, o: q.top, u: q.bottom }; }));
  const rechts = h[1]; const b = await karte(P, 'B');
  const vorA = await lage(P, 'A');
  await P.mouse.move(rechts.cx, rechts.cy); await P.mouse.down();
  await P.mouse.move(rechts.cx + 10, rechts.cy + 4, { steps: 3 });
  await P.mouse.move(Math.min(b.cx, 1400), b.cy, { steps: 10 }); await P.mouse.up();   // bei 300 % ragt B aus dem Bild
  const pfeil = await warteBis(P, () => { const e = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges; return e.length === 1 && e[0].source === 'A' && e[0].target === 'B'; }, undefined, 5000);
  const nachA = await lage(P, 'A');
  matrix.push(`C Zoom ${z} (weit ${istWeit}): Anschluss ${rechts.w} px, trifft ${rechts.trifft}, Pfeil ${pfeil}, Karte bleibt ${nachA.x === vorA.x}`);
  pruefe(`C1 ${z * 100} %: vom Anschlusspunkt der gewählten Karte entsteht ein Pfeil`, pfeil && rechts.trifft, await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges.map((e) => `${e.source}→${e.target}`)));
  pruefe(`C2 ${z * 100} %: die Karte bleibt dabei liegen`, nachA.x === vorA.x && nachA.y === vorA.y, { vorA, nachA });
  if (istWeit) {
    // Griffe vor der Kante: Anschlüsse und Ecken liegen außerhalb der Karte
    const k = await karte(P, 'A');
    const ecken = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="A"] .react-flow__resize-control.handle')].map((e) => { const q = e.getBoundingClientRect(); return { l: q.left, r: q.right, o: q.top, u: q.bottom }; }));
    const aussen = (q) => q.r <= k.x + 1 || q.l >= k.r - 1 || q.u <= k.y + 1 || q.o >= k.u - 1;
    pruefe(`C3 ${z * 100} %: die vier Anschlusspunkte stehen vor der Kante (decken die kleine Karte nicht zu)`, h.every(aussen), { h, k });
    pruefe(`C4 ${z * 100} %: die vier Größen-Ecken auch`, ecken.length === 4 && ecken.every(aussen), { ecken, k });
    // irgendwo auf der gewählten Karte ziehen: sie wandert (nicht Größe, nicht Pfeil)
    const kanten = await P.evaluate(() => document.querySelectorAll('.react-flow__edge').length);
    for (const [fx, fy] of [[0.5, 0.15], [0.5, 0.85], [0.1, 0.5], [0.9, 0.5]]) {
      const v = await lage(P, 'A'); const kk = await karte(P, 'A');
      await zug(P, kk.x + kk.w * fx, kk.y + kk.h * fy, 30, 20);
      const n = await lage(P, 'A');
      const kn = await P.evaluate(() => document.querySelectorAll('.react-flow__edge').length);
      pruefe(`C5 ${z * 100} %: Zug bei (${fx}, ${fy}) verschiebt die gewählte Karte`, (n.x !== v.x || n.y !== v.y) && n.w === v.w && n.h === v.h && kn === kanten, { v, n, kn });
    }
    // die Ecke ändert weiter die Größe
    const kk = await karte(P, 'A');
    const ecke = await kasten(P, '.react-flow__node[data-id="A"] .react-flow__resize-control.handle.bottom.right');
    const v = await lage(P, 'A');
    await zug(P, ecke.cx, ecke.cy, 40, 30);
    const n = await lage(P, 'A');
    pruefe(`C6 ${z * 100} %: die Ecke unten rechts ändert die Größe`, n.w > v.w && n.h > v.h, { v, n, kk });
    if (z === 0.25) await P.screenshot({ path: path.join(SD, 'm527-griffe-25.png'), clip: { x: kk.x - 60, y: kk.y - 60, width: kk.w + 200, height: kk.h + 120 } });
  }
  await ctx.close();
}

for (const z of [0.5, 1, 2]) {
  // Loslassen irgendwo auf der Zielkarte (Ganzkarten-Ziel) — nicht nur nahe an ihren Anschlusspunkten
  const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Hallo Welt'), nz('B', 340, 0, 'Ziel')]));
  await aufstellen(P, 'A', z);
  const a = await karte(P, 'A');
  await P.mouse.click(a.cx, a.cy);
  await warteBis(P, () => document.querySelector('.react-flow__node[data-id="A"]')?.classList.contains('selected'));
  await P.mouse.move(a.cx, a.cy - 1); await P.waitForTimeout(250);
  const h = await kasten(P, '.react-flow__node[data-id="A"] .pn-handle.react-flow__handle-right');
  const b = await karte(P, 'B');
  const ziel = [Math.min(b.x + b.w * 0.3, 1400), b.y + b.h * 0.65];
  await P.mouse.move(h.cx, h.cy); await P.mouse.down(); await P.mouse.move(h.cx + 10, h.cy + 4, { steps: 3 });
  await P.mouse.move(ziel[0], ziel[1], { steps: 10 }); await P.mouse.up();
  const pfeil = await warteBis(P, () => { const e = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges; return e.length === 1 && e[0].target === 'B'; }, undefined, 4000);
  matrix.push(`C Zoom ${z}: Loslassen mitten auf der Zielkarte ergibt einen Pfeil ${pfeil}`);
  pruefe(`C7 ${z * 100} %: losgelassen mitten auf der Zielkarte (fern ihrer Anschlusspunkte) entsteht der Pfeil`, pfeil);
  await ctx.close();
}

/* ═══════════════════════ D: Verbindungen treffen ═══════════════════════ */
console.log('\n════ D: Verbindungen treffen ════');
for (const z of [0.25, 0.5, 1, 3]) {
  const { ctx, P } = await seite(stand([nz('A', 0, 0, 'Links'), nz('B', 700, 0, 'Rechts')], [kt('e1', 'A', 'B', 'hat')]));
  await zoomAuf(P, z);
  const a = await karte(P, 'A'); const b = await karte(P, 'B');
  await P.mouse.move(1420, 500); await P.mouse.wheel((a.r + b.x) / 2 - 720 - 120, a.cy - 450); await P.waitForTimeout(300);
  const a2 = await karte(P, 'A'); const b2 = await karte(P, 'B');
  const lx = a2.r + (b2.x - a2.r) * 0.25;
  await P.mouse.click(lx, a2.cy + 6);
  const gewaehlt = await warteBis(P, () => !!document.querySelector('.react-flow__edge.selected'), undefined, 2500);
  const knopf = await kasten(P, '.edge-opts .edge-opt-btn');
  matrix.push(`D Zoom ${z}: 6 px neben der Linie gewählt ${gewaehlt}, Optionsknopf ${knopf ? Math.round(knopf.h) : '–'} px`);
  pruefe(`D1 ${z * 100} %: ein Klick 6 Bildpunkte neben die Linie wählt die Verbindung`, gewaehlt);
  pruefe(`D2 ${z * 100} %: die Knöpfe der gewählten Verbindung sind 18–32 Bildpunkte groß`, knopf && knopf.h >= 18 && knopf.h <= 32, knopf);
  await ctx.close();
}

/* ═══════════════════════ E: Rahmentitel ═══════════════════════ */
console.log('\n════ E: Rahmentitel ════');
for (const z of [0.15, 0.25, 1, 3]) {
  const { ctx, P } = await seite(stand([fr('F', 0, 0, 700, 420, 'Projekt Gartenhaus'), nz('C', 60, 120, 'Drinnen')]));
  await aufstellen(P, 'C', z);
  const kopf = await kasten(P, '.react-flow__node[data-id="F"] .frame-head');
  matrix.push(`E Zoom ${z}: Rahmentitel ${Math.round(kopf.w)}×${Math.round(kopf.h)}`);
  pruefe(`E1 ${z * 100} %: der Rahmentitel ist 24–40 Bildpunkte hoch`, kopf.h >= 24 && kopf.h <= 40, kopf);
  // Gewählt: Die Karten-Leiste steht über dem Titel, nicht auf ihm (er ist jetzt in jeder Stufe ~30 Bildpunkte hoch).
  // Bei 300 % liegt der Titel des großen Rahmens über dem Bildrand — dort nur die Größe.
  if (z <= 1) {
  await P.mouse.click(kopf.x + 10, kopf.cy);
  await warteBis(P, () => document.querySelector('.react-flow__node[data-id="F"]')?.classList.contains('selected'));
  await warteBis(P, () => !!document.querySelector('.sel-toolbar'));
  await P.waitForTimeout(300);
  const k2 = await kasten(P, '.react-flow__node[data-id="F"] .frame-head');
  const frei = await P.evaluate((k) => [[0.15, 0.5], [0.5, 0.5], [0.85, 0.5], [0.5, 0.15]].every(([fx, fy]) => !!document.elementFromPoint(k.x + k.w * fx, k.y + k.h * fy)?.closest('.frame-head')), k2);
  pruefe(`E3 ${z * 100} %: am gewählten Rahmen ist der Titel frei (Karten-Leiste und Anschlusspunkte liegen nicht darauf)`, frei, k2);
  }
  if (z <= 0.25) {
    const vF = await lage(P, 'F'); const vC = await lage(P, 'C');
    await zug(P, kopf.x + Math.min(30, kopf.w / 2), kopf.cy, 50, 30);
    const nF = await lage(P, 'F'); const nC = await lage(P, 'C');
    pruefe(`E2 ${z * 100} %: der Zug am Titel verschiebt Rahmen und Inhalt gemeinsam`, nF.x !== vF.x && nC.x - vC.x === nF.x - vF.x && nC.y - vC.y === nF.y - vF.y && nF.w === vF.w, { vF, nF, vC, nC });
  }
  await ctx.close();
}

console.log('\nMatrix:\n  ' + matrix.join('\n  '));
pruefe('Z keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close(); app.close();
console.log(`\nm527-zoom-bedienung: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
