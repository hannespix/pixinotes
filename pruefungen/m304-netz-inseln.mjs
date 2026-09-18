/**
 * M304 — Das Netz als Landkarte mit Inseln.
 *
 *   A  Physik aus (Voreinstellung): nichts bewegt sich, jedes Board liegt in
 *      seinem Bereich, Bereichs- und Projekt-Hüllen überlappen sich nicht,
 *      kein Board liegt auf einem anderen, die Beschriftung sitzt über dem
 *      obersten Board, die Lage ist deterministisch, „Alles einpassen" zeigt alles.
 *   B  Physik an: ruhiger Start aus der Startlage; ein in den fremden Bereich
 *      gezogenes Board kehrt nach dem Loslassen heim.
 *   C  Karten-Ebene: die Projekt-Hüllen umschließen die Karten-Punkte, die
 *      größeren Fußabdrücke halten Abstand.
 *   D  „Was ist neu" nennt M304 zuerst.
 */
// Läuft aus dem Repository: `node pruefungen/m304-netz-inseln.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4525;
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

// ---------- Stand wie im Screenshot: zwei Bereiche, fünf Projekte, 13 Boards ----------
const note = (id, text, x, y) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
let nId = 0;
const board = (id, name, karten, texte = []) => {
  const nodes = texte.map((t, i) => note(`n${nId++}`, t, 60 + (i % 3) * 300, 60 + Math.floor(i / 3) * 220));
  for (let i = nodes.length; i < karten; i += 1) nodes.push(note(`n${nId++}`, `${name} · Karte ${i + 1}`, 60 + (i % 3) * 300, 60 + Math.floor(i / 3) * 220));
  return { id, name, edges: [], drawings: [], comments: [], nodes };
};
const state = {
  boards: [
    board('b1', 'Schulbesuche', 3),
    board('b2', 'Beratungsfälle', 21, ['Siehe [[Fachwerker]] und [[Prüferentschädigungen]]']),
    board('b3', 'Prüferentschädigungen', 4),
    board('b4', 'Fachwerker', 0),
    board('b5', 'Karriere RPF', 7),
    board('b6', 'Qualifizierung', 5),
    board('b7', 'Jour Fixe', 17, ['Themen: [[Abschluss-Prüfungen]], [[Beratungsfälle]]']),
    board('b8', 'Abschluss-Prüfungen', 6),
    board('b9', 'Ultimativer Urlaub', 8, ['Nächste Reise: [[Amrum 2026]]']),
    board('b10', 'Amrum 2026', 8, ['Vorher noch: [[Jour Fixe]], [[Schulbesuche]], [[Beratungsfälle]]']),
    board('b11', 'Kochen/Einkaufen', 8),
    board('b12', 'Software Tools', 3),
    board('b13', 'Trading', 3),
  ],
  spaces: [
    { id: 's1', name: '🏢 Arbeit', projects: [
      { id: 'p1', name: 'Prüfung', boardIds: ['b1', 'b2', 'b3', 'b4'] },
      { id: 'p2', name: 'Laufbahn', boardIds: ['b5', 'b6'] },
      { id: 'p3', name: 'Termine', boardIds: ['b7', 'b8'] },
    ] },
    { id: 's2', name: '🏠 Privat', projects: [
      { id: 'p4', name: 'Reisen', boardIds: ['b9', 'b10'] },
      { id: 'p5', name: 'Haushalt', boardIds: ['b11', 'b12', 'b13'] },
    ] },
  ],
  activeId: 'b1', view: 'overview',
};
const bereichVon = {};
for (const sp of state.spaces) for (const p of sp.projects) for (const id of p.boardIds) bereichVon[id] = sp.id;

async function seite({ viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, state);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  await P.locator('.ov-mode button', { hasText: 'Netz' }).click();
  await P.waitForSelector('.ov-graph-node[data-board]');
  await P.waitForTimeout(800);
  return { ctx, P };
}

/** Board-Lagen aus dem DOM (Graph-Koordinaten) */
const lagen = (P) => P.evaluate(() => {
  const out = {};
  for (const g of document.querySelectorAll('.ov-graph-node[data-board]')) {
    const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(g.getAttribute('transform') ?? '');
    if (m) out[g.dataset.board] = { x: Number(m[1]), y: Number(m[2]) };
  }
  return out;
});
const schwerpunkt = (pos, ids) => {
  const p = ids.map((id) => pos[id]).filter(Boolean);
  return { x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length };
};
const abstand = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Jedes Board näher am eigenen Bereich als an jedem fremden? */
const heimisch = (pos) => {
  const sp = {};
  for (const s of state.spaces) sp[s.id] = schwerpunkt(pos, s.projects.flatMap((p) => p.boardIds));
  const fremd = [];
  for (const id of Object.keys(pos)) {
    const eigen = abstand(pos[id], sp[bereichVon[id]]);
    for (const s of state.spaces) if (s.id !== bereichVon[id] && abstand(pos[id], sp[s.id]) < eigen) fremd.push(id);
  }
  return fremd;
};
const kleinsterAbstand = (pos) => {
  const ids = Object.keys(pos); let min = Infinity; let paar = '';
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const d = abstand(pos[ids[i]], pos[ids[j]]);
    if (d < min) { min = d; paar = `${ids[i]}/${ids[j]}`; }
  }
  return { min, paar };
};
/** Zwei Hüllen-Pfade überschneiden sich, wenn ein Punkt der einen in der anderen liegt */
const huellenGetrennt = (P, a, b) => P.evaluate(([ka, kb]) => {
  const pa = document.querySelector(`.ov-region[data-region="${ka}"] path`);
  const pb = document.querySelector(`.ov-region[data-region="${kb}"] path`);
  if (!pa || !pb) return { fehlt: true };
  const drin = (von, inn) => {
    const L = von.getTotalLength(); let n = 0;
    for (let i = 0; i < 80; i += 1) { const q = von.getPointAtLength((i / 80) * L); if (inn.isPointInFill(new DOMPoint(q.x, q.y))) n += 1; }
    return n;
  };
  return { fehlt: false, aInB: drin(pa, pb), bInA: drin(pb, pa) };
}, [a, b]);
const getrennt = async (P, a, b) => { const r = await huellenGetrennt(P, a, b); return { gut: !r.fehlt && r.aInB === 0 && r.bInA === 0, info: JSON.stringify(r) }; };

console.log('════ A: Physik aus — die Landkarte liegt still ════');
{
  const { ctx, P } = await seite();
  const n = await P.locator('.ov-graph-node[data-board]').count();
  pruefe('A1 alle 13 Boards stehen im Netz', n === 13, String(n));
  const physik = P.locator('.ov-graph-toggle', { hasText: 'Physik' }).locator('input');
  pruefe('A2 Physik ist aus, bis man sie einschaltet', !(await physik.isChecked()));
  const l0 = await lagen(P);
  await P.waitForTimeout(1500);
  const l1 = await lagen(P);
  const bewegt = Math.max(...Object.keys(l0).map((id) => abstand(l0[id], l1[id])));
  pruefe('A3 nichts bewegt sich von selbst', bewegt < 0.5, `größte Bewegung ${bewegt.toFixed(2)}`);
  const fremd = heimisch(l0);
  pruefe('A4 jedes Board liegt bei seinem Bereich, auch „Amrum 2026" trotz Wikilinks in die Arbeit', fremd.length === 0, fremd.join(','));
  const s12 = await getrennt(P, 's-s1', 's-s2');
  pruefe('A5 die Bereichs-Hüllen überlappen sich nicht', s12.gut, s12.info);
  let projekteGut = true; let info = '';
  for (const [a, b] of [['p-p1', 'p-p2'], ['p-p1', 'p-p3'], ['p-p2', 'p-p3'], ['p-p4', 'p-p5']]) {
    const r = await getrennt(P, a, b);
    if (!r.gut) { projekteGut = false; info += `${a}/${b}:${r.info} `; }
  }
  pruefe('A6 die Projekt-Hüllen eines Bereichs überlappen sich nicht', projekteGut, info);
  const { min, paar } = kleinsterAbstand(l0);
  pruefe('A7 kein Board liegt auf einem anderen (Fußabdruck ≥ 100)', min >= 100, `${paar} ${min.toFixed(0)}`);
  // Beschriftung über dem obersten Board des Bereichs
  const label = await P.evaluate(() => {
    const out = {};
    for (const g of document.querySelectorAll('.ov-region-space[data-region]')) {
      const t = g.querySelector('text');
      out[g.dataset.region] = { x: Number(t.getAttribute('x')), y: Number(t.getAttribute('y')), text: t.textContent };
    }
    return out;
  });
  let labelGut = true; info = '';
  for (const s of state.spaces) {
    const ids = s.projects.flatMap((p) => p.boardIds);
    const oben = ids.reduce((b, id) => (l0[id].y < l0[b].y ? id : b), ids[0]);
    const lb = label[`s-${s.id}`];
    const gut = lb && Math.abs(lb.x - l0[oben].x) < 1 && lb.y < l0[oben].y - 60 && lb.text.includes(s.name.replace(/^\S+\s/, ''));
    if (!gut) { labelGut = false; info += `${s.id}: ${JSON.stringify(lb)} oben=${oben}@${JSON.stringify(l0[oben])} `; }
  }
  pruefe('A8 der Bereichsname steht über dem obersten Board, nicht irgendwo im Leeren', labelGut, info);
  // Deterministisch: dieselben Daten, dieselbe Karte
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  await P.locator('.ov-mode button', { hasText: 'Netz' }).click();
  await P.waitForSelector('.ov-graph-node[data-board]');
  await P.waitForTimeout(600);
  const l2 = await lagen(P);
  const abw = Math.max(...Object.keys(l0).map((id) => abstand(l0[id], l2[id])));
  pruefe('A9 nach dem Neuladen liegt alles genau dort wie vorher', abw < 0.01, `Abweichung ${abw.toFixed(2)}`);
  // Alles einpassen zeigt das ganze Netz
  await P.locator('button[aria-label="Alles einpassen"]').click();
  await P.waitForTimeout(400);
  const view = (await P.getAttribute('.ov-graph-svg', 'data-view')).split(' ').map(Number);
  const [vx, vy, vw, vh] = view;
  const drin = Object.values(l2).every((p) => p.x > vx && p.x < vx + vw && p.y > vy && p.y < vy + vh);
  pruefe('A10 „Alles einpassen" zeigt jedes Board', drin && vw > 1100, `view=${view.join(' ')}`);
  // …und zwar RECHTS der Navigationsspalte, nicht darunter
  const spalte = await P.locator('.tabs.spalte').boundingBox();
  const kreise = await P.locator('.ov-graph-node[data-board] circle:last-child').evaluateAll((els) => els.map((c) => c.getBoundingClientRect().left));
  const linkster = Math.min(...kreise);
  pruefe('A12 kein Board liegt unter der Navigationsspalte', !!spalte && linkster > spalte.x + spalte.width, `Spalte bis ${spalte ? Math.round(spalte.x + spalte.width) : '?'}, linkstes Board ab ${Math.round(linkster)}`);
  const linien = await P.locator('.ov-graph-vp > line').count();
  pruefe('A11 die Wikilinks über die Bereiche hinweg bleiben als Linien sichtbar', linien >= 5, String(linien));
  await P.screenshot({ path: `${SD}/m304-netz-still.png` });
  await ctx.close();
}

console.log('\n════ B: Physik an — ruhiger Start, Heimkehr nach dem Ziehen ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Alles einpassen"]').click();
  await P.waitForTimeout(300);
  const l0 = await lagen(P);
  await P.locator('.ov-graph-toggle', { hasText: 'Physik' }).locator('input').click();
  await P.waitForTimeout(3500);
  const l1 = await lagen(P);
  const bewegt = Math.max(...Object.keys(l0).map((id) => abstand(l0[id], l1[id])));
  pruefe('B1 mit Physik federt das Netz nur nach, statt sich neu zu sortieren', bewegt < 80, `größte Bewegung ${bewegt.toFixed(0)}`);
  pruefe('B2 danach liegt weiter jedes Board bei seinem Bereich', heimisch(l1).length === 0, heimisch(l1).join(','));
  const s12 = await getrennt(P, 's-s1', 's-s2');
  pruefe('B3 die Bereichs-Hüllen bleiben getrennt', s12.gut, s12.info);
  const { min, paar } = kleinsterAbstand(l1);
  pruefe('B4 kein Board liegt auf einem anderen', min >= 100, `${paar} ${min.toFixed(0)}`);
  // „Amrum 2026" (Privat) mitten in die Arbeit ziehen und loslassen
  const schirm = async (id) => {
    const r = await P.locator(`.ov-graph-node[data-board="${id}"] circle`).last().boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const arbeit = state.spaces[0].projects.flatMap((p) => p.boardIds);
  const ziele = await Promise.all(arbeit.map(schirm));
  const ziel = { x: ziele.reduce((a, q) => a + q.x, 0) / ziele.length, y: ziele.reduce((a, q) => a + q.y, 0) / ziele.length };
  const von = await schirm('b10');
  await P.mouse.move(von.x, von.y);
  await P.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await P.mouse.move(von.x + ((ziel.x - von.x) * i) / 12, von.y + ((ziel.y - von.y) * i) / 12); await P.waitForTimeout(30); }
  await P.waitForTimeout(300);
  const mitten = await lagen(P);
  const spA = schwerpunkt(mitten, arbeit);
  const spP = schwerpunkt(mitten, state.spaces[1].projects.flatMap((p) => p.boardIds).filter((id) => id !== 'b10'));
  pruefe('B5 am Finger liegt es in der Arbeit', abstand(mitten.b10, spA) < abstand(mitten.b10, spP), JSON.stringify(mitten.b10));
  await P.mouse.up();
  await P.waitForTimeout(4000);
  const l2 = await lagen(P);
  pruefe('B6 losgelassen kehrt es in seinen Bereich zurück', heimisch(l2).length === 0, heimisch(l2).join(','));
  const s12b = await getrennt(P, 's-s1', 's-s2');
  pruefe('B7 und die Bereichs-Hüllen sind wieder getrennt', s12b.gut, s12b.info);
  await P.screenshot({ path: `${SD}/m304-netz-physik.png` });
  await ctx.close();
}

console.log('\n════ C: Karten-Ebene — die Hüllen umschließen die Punkte ════');
{
  const { ctx, P } = await seite();
  await P.locator('.ov-graph-toggle', { hasText: 'Karten' }).locator('input').click();
  await P.waitForTimeout(800);
  await P.locator('button[aria-label="Alles einpassen"]').click();
  await P.waitForTimeout(500);
  const punkte = await P.locator('.ov-graph-dot').count();
  pruefe('C1 die Karten-Punkte hängen an den Boards', punkte > 30, String(punkte));
  const draussen = await P.evaluate((projVon) => {
    const out = [];
    for (const g of document.querySelectorAll('.ov-graph-node[data-board]')) {
      const id = g.dataset.board;
      const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(g.getAttribute('transform'));
      const path = document.querySelector(`.ov-region[data-region="p-${projVon[id]}"] path`);
      const sat = document.querySelector(`.ov-graph-vp > g[transform="translate(${m[1]} ${m[2]})"]:not(.ov-graph-node)`);
      if (!path || !sat) { out.push(`${id}:fehlt`); continue; }
      for (const c of sat.querySelectorAll('.ov-graph-dot circle')) {
        const x = Number(m[1]) + Number(c.getAttribute('cx')), y = Number(m[2]) + Number(c.getAttribute('cy'));
        if (!path.isPointInFill(new DOMPoint(x, y))) { out.push(id); break; }
      }
    }
    return out;
  }, Object.fromEntries(state.spaces.flatMap((s) => s.projects.flatMap((p) => p.boardIds.map((id) => [id, p.id])))));
  pruefe('C2 jeder Karten-Punkt liegt in der Projekt-Hülle seines Boards', draussen.length === 0, draussen.join(','));
  const { min, paar } = kleinsterAbstand(await lagen(P));
  pruefe('C3 mit Karten halten die Boards mehr Abstand (Fußabdruck ≥ 128)', min >= 128, `${paar} ${min.toFixed(0)}`);
  const s12 = await getrennt(P, 's-s1', 's-s2');
  pruefe('C4 die Bereichs-Hüllen überlappen sich auch mit Karten nicht', s12.gut, s12.info);
  await P.screenshot({ path: `${SD}/m304-netz-karten.png` });
  await ctx.close();
}

console.log('\n════ D: „Was ist neu" ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Was ist neu' }).click();
  await P.waitForSelector('.help-neu-modal');
  const erster = await P.locator('#help-neu li').first().textContent();
  pruefe('D1 der erste Eintrag ist M304 und nennt die Inseln', /M304/.test(erster) && /Inseln/.test(erster), erster.slice(0, 80));
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
