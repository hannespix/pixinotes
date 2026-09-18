/**
 * M306 — Hüllen ohne Haken.
 *
 *   A  Jede Bereichs- und Projekt-Hülle im Netz ist konvex: Entlang der
 *      Kontur kippt die Drehrichtung nirgends (kein Haken, keine Schleife) —
 *      ohne und mit Karten-Ebene.
 *   B  „Was ist neu" nennt M306.
 */
// Läuft aus dem Repository: `node pruefungen/m306-huellen-glatt.mjs`
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
const PORT = 4527;
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

async function seite({ karten = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 2200, height: 1200 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((st) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { ...state, graphLayers: { cards: karten, portals: true, wikis: true, projectOnly: false } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  await P.locator('.ov-mode button', { hasText: 'Netz' }).click();
  await P.waitForSelector('.ov-graph-node[data-board]');
  await P.waitForTimeout(900);
  return { ctx, P };
}

/** Je Hülle: Zahl der Stellen, an denen die Kontur nach INNEN knickt (Haken) */
const haken = (P) => P.evaluate(() => {
  const out = {};
  for (const g of document.querySelectorAll('.ov-region[data-region]')) {
    const path = g.querySelector('path');
    const L = path.getTotalLength();
    const N = 360;
    const pts = [];
    for (let i = 0; i < N; i += 1) { const q = path.getPointAtLength((i / N) * L); pts.push({ x: q.x, y: q.y }); }
    // Umlaufsinn aus der Fläche (Schnürsenkel), dann jede Ecke dagegen prüfen
    let flaeche = 0;
    for (let i = 0; i < N; i += 1) { const a = pts[i], b = pts[(i + 1) % N]; flaeche += a.x * b.y - b.x * a.y; }
    const sinn = Math.sign(flaeche);
    let innen = 0;
    for (let i = 0; i < N; i += 1) {
      const a = pts[(i + N - 1) % N], b = pts[i], c = pts[(i + 1) % N];
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
      const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
      const kreuz = (ux * vy - uy * vx) / (lu * lv);   // Sinus des Knickwinkels
      if (kreuz * sinn < -0.08) innen += 1;              // deutlich nach innen geknickt
    }
    out[g.dataset.region] = innen;
  }
  return out;
});

console.log('════ A: Alle Hüllen sind konvex ════');
for (const karten of [false, true]) {
  const { ctx, P } = await seite({ karten });
  const h = await haken(P);
  const schlecht = Object.entries(h).filter(([, n]) => n > 0);
  pruefe(`A${karten ? 2 : 1} ${karten ? 'mit' : 'ohne'} Karten-Ebene: keine Hülle knickt nach innen (${Object.keys(h).length} Hüllen)`,
    Object.keys(h).length >= 7 && schlecht.length === 0, JSON.stringify(h));
  await P.screenshot({ path: `${SD}/m306-huellen-${karten ? 'karten' : 'ohne'}.png` });
  await ctx.close();
}

console.log('\n════ B: „Was ist neu" ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Was ist neu' }).click();
  await P.waitForSelector('.help-neu-modal');
  const eintraege = await P.locator('#help-neu li').allTextContents();
  const eintrag = eintraege.find((t) => /M306/.test(t)) ?? '';
  pruefe('B1 „Was ist neu" nennt M306 und die Haken', /Haken/.test(eintrag), eintrag.slice(0, 80) || 'kein Eintrag');
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
