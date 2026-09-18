/**
 * M305 — Das Netz öffnet als Karte, nicht als Lupe.
 *
 *   A  Notebook (1440 × 900): ein Bildpunkt je Einheit (höchstens 1,3),
 *      Detailstufe 1 — Karten-Punkte ohne Titel; das aktive Board ist im Bild.
 *   B  Großer Schirm (2200 × 1200): das ganze Netz liegt mittig im Bild,
 *      Gliederungs-Ebene „board" (nichts ausgeblendet).
 *   C  Telefon (390 × 844): Umgebung des aktiven Boards, das Board in der Mitte.
 *   D  „Was ist neu" nennt M305 zuerst.
 */
// Läuft aus dem Repository: `node pruefungen/m305-netz-start.mjs`
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
const PORT = 4526;
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
  // Karten-Ebene an: So sieht man, ob Titel (Detailstufe 2) erscheinen
  graphLayers: { cards: true, portals: true, wikis: true, projectOnly: false },
};

async function seite({ viewport = { width: 1440, height: 900 }, mobil = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobil, hasTouch: mobil });
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
  await P.waitForTimeout(900);
  return { ctx, P };
}
/** Ausschnitt, Maßstab und Lagen aus dem DOM */
const stand = (P) => P.evaluate(() => {
  const svg = document.querySelector('.ov-graph-svg');
  const [x, y, w, h] = svg.getAttribute('data-view').split(' ').map(Number);
  const r = svg.getBoundingClientRect();
  const lagen = {};
  for (const g of document.querySelectorAll('.ov-graph-node[data-board]')) {
    const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(g.getAttribute('transform') ?? '');
    if (m) lagen[g.dataset.board] = { x: Number(m[1]), y: Number(m[2]) };
  }
  return {
    view: { x, y, w, h }, svg: { w: r.width, h: r.height },
    massstab: Math.min(r.width / w, r.height / h),
    geo: [...svg.classList].find((c) => c.startsWith('geo-')),
    punkte: document.querySelectorAll('.ov-graph-dot').length,
    titel: document.querySelectorAll('.ov-graph-dot-label').length,
    lagen,
  };
});
const imBild = (s, id) => { const p = s.lagen[id]; return p && p.x > s.view.x && p.x < s.view.x + s.view.w && p.y > s.view.y && p.y < s.view.y + s.view.h; };

console.log('════ A: Notebook — ein Bildpunkt je Einheit, keine Kartentitel ════');
{
  const { ctx, P } = await seite();
  const s = await stand(P);
  console.log('   ', JSON.stringify({ view: s.view, svg: s.svg, massstab: +s.massstab.toFixed(3), geo: s.geo, punkte: s.punkte, titel: s.titel }));
  pruefe('A1 der Maßstab liegt zwischen 1 und 1,3 Bildpunkten je Einheit', s.massstab >= 0.98 && s.massstab <= 1.32, s.massstab.toFixed(3));
  pruefe('A2 Karten-Punkte ja, Kartentitel nein (Detailstufe 1)', s.punkte > 30 && s.titel === 0, `punkte=${s.punkte} titel=${s.titel}`);
  pruefe('A3 das aktive Board ist im Bild', imBild(s, 'b1'));
  pruefe('A4 Gliederungs-Ebene „board": nichts ist ausgeblendet', s.geo === 'geo-board', s.geo);
  await P.screenshot({ path: `${SD}/m305-notebook.png` });
  await ctx.close();
}

console.log('\n════ B: Großer Schirm — das ganze Netz, mittig ════');
{
  const { ctx, P } = await seite({ viewport: { width: 2200, height: 1200 } });
  const s = await stand(P);
  console.log('   ', JSON.stringify({ view: s.view, svg: s.svg, massstab: +s.massstab.toFixed(3), geo: s.geo }));
  const alle = Object.keys(s.lagen).every((id) => imBild(s, id));
  pruefe('B1 alle 13 Boards sind im Bild', alle && Object.keys(s.lagen).length === 13);
  const xs = Object.values(s.lagen).map((p) => p.x), ys = Object.values(s.lagen).map((p) => p.y);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const vx = s.view.x + s.view.w / 2, vy = s.view.y + s.view.h / 2;
  pruefe('B2 das Netz liegt in der Mitte des Bilds', Math.abs(mx - vx) < 120 && Math.abs(my - vy) < 120, `Netz (${mx.toFixed(0)},${my.toFixed(0)}) Bild (${vx.toFixed(0)},${vy.toFixed(0)})`);
  pruefe('B3 der Maßstab bleibt zwischen 1 und 1,3, keine Kartentitel', s.massstab >= 0.98 && s.massstab <= 1.32 && s.titel === 0, `${s.massstab.toFixed(3)} titel=${s.titel}`);
  pruefe('B4 Gliederungs-Ebene „board"', s.geo === 'geo-board', s.geo);
  await P.screenshot({ path: `${SD}/m305-gross.png` });
  await ctx.close();
}

console.log('\n════ C: Telefon — die Umgebung des aktiven Boards ════');
{
  const { ctx, P } = await seite({ viewport: { width: 390, height: 844 }, mobil: true });
  const s = await stand(P);
  console.log('   ', JSON.stringify({ view: s.view, svg: s.svg, massstab: +s.massstab.toFixed(3), geo: s.geo }));
  pruefe('C1 der Maßstab liegt zwischen 1 und 1,3', s.massstab >= 0.98 && s.massstab <= 1.32, s.massstab.toFixed(3));
  const p = s.lagen.b1;
  pruefe('C2 das aktive Board liegt in der Mitte', p && Math.abs(p.x - (s.view.x + s.view.w / 2)) < 2 && Math.abs(p.y - (s.view.y + s.view.h / 2)) < 2, JSON.stringify(p));
  await P.screenshot({ path: `${SD}/m305-telefon.png` });
  await ctx.close();
}

console.log('\n════ D: „Was ist neu" ════');
{
  const { ctx, P } = await seite();
  await P.locator('button[aria-label="Über PixiNotes"]').click();
  await P.locator('.about-menu [role="menuitem"]', { hasText: 'Was ist neu' }).click();
  await P.waitForSelector('.help-neu-modal');
  const eintraege = await P.locator('#help-neu li').allTextContents();
  const eintrag = eintraege.find((t) => /M305/.test(t)) ?? '';
  pruefe('D1 „Was ist neu" nennt M305 und die Lupe', /Lupe/.test(eintrag), eintrag.slice(0, 80) || 'kein Eintrag');
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
