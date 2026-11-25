/**
 * M538 — Schlussrunde nach dem Audit: die letzten offenen Punkte aus M529, M530, M532 und M533, als Verhalten gemessen.
 *
 *   D  Strg+D im Karten-Fokus legt keine Kopie unsichtbar hinter die offene Karte, sondern sagt, wie es geht; ohne
 *      Fokus dupliziert Strg+D wie bisher.
 *
 * Läuft aus dem Repository: `node pruefungen/m538-schlussrunde.mjs [D …]` (gegen einen anderen Build: PN_DIST=…)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = Number(process.env.M538_PORT ?? 5538);
const NUR = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());
const will = (x) => NUR.length === 0 || NUR.includes(x);
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

const nz = (id, x, y, farbe = 'yellow', w = 200, h = 120) => ({ id, type: 'note', width: w, height: h, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
const stand = (nodes, edges = [], drawings = []) => ({
  boards: [{ id: 'b1', name: 'Erstes', comments: [], edges, drawings, nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});

async function seite(st) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-stapel-gelernt', '1');
  }, { st });
  // Hinweise mitschreiben (kurze Toasts nicht hinterher abfragen, M484)
  await ctx.addInitScript(() => {
    window.__hinweise = [];
    new MutationObserver(() => { const t = document.querySelector('.toast.show'); const s = t?.textContent?.trim(); if (s && window.__hinweise[window.__hinweise.length - 1] !== s) window.__hinweise.push(s); })
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1200);
  return { ctx, P };
}
const alleBoards = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards);
const brett = async (P, id = 'b1') => (await alleBoards(P)).find((b) => b.id === id);
const standBis = async (P, bed, ms = 9000, id = 'b1') => {
  const bis = Date.now() + ms; let b = await brett(P, id);
  while (!bed(b) && Date.now() < bis) { await P.waitForTimeout(150); b = await brett(P, id); }
  return b;
};
const standRuhig = async (P, ms = 6000) => {
  let alt = JSON.stringify(await alleBoards(P)); const bis = Date.now() + ms;
  for (let gleich = 0; gleich < 5 && Date.now() < bis;) { await P.waitForTimeout(200); const neu = JSON.stringify(await alleBoards(P)); gleich = neu === alt ? gleich + 1 : 0; alt = neu; }
  return JSON.parse(alt).find((b) => b.id === 'b1');
};
const kasten = (P, sel) => P.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
const karte = (P, id) => kasten(P, `.react-flow__node[data-id="${id}"]`);
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const warteBis = async (P, fn, arg, ms = 8000) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const waehle = async (P, id) => { const g = await griff(P, id); await P.mouse.click(g[0], g[1]); return warteBis(P, (id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains('selected'), id); };
const hinweise = (P) => P.evaluate(() => window.__hinweise.slice());
const fokusAuf = async (P, id) => {
  const r = await karte(P, id); await P.mouse.dblclick(r.cx, r.cy);
  await P.waitForSelector('.focus-head'); await P.waitForTimeout(900);
};

/* ═══════════════════════ D: Strg+D im Karten-Fokus ═══════════════════════ */
if (will('D')) {
  console.log('\n════ D: Strg+D im Karten-Fokus ════');
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 400, 0, 'sky')]));
  await fokusAuf(P, 'a');
  // Der Tastatur-Fokus liegt mal im Text, mal auf der Karte — beides prüfen
  await P.evaluate(() => (document.activeElement)?.blur?.());
  await P.keyboard.press('Control+d');
  await warteBis(P, () => window.__hinweise.some((h) => /nicht dupliziert/.test(h)));
  pruefe('D1 Strg+D im Fokus sagt, dass die offene Karte nicht dupliziert wird', (await hinweise(P)).some((h) => /nicht dupliziert.*Esc/.test(h)), await hinweise(P));
  let b = await standRuhig(P, 3000);
  pruefe('D2 … und legt keine Kopie hinter die offene Karte', b.nodes.length === 2, b.nodes.map((n) => n.id));
  const imText = await P.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="a"] [contenteditable="true"]'); if (!e) return false; e.focus(); return document.activeElement === e; });
  if (imText) {
    await P.keyboard.press('Control+d');
    b = await standRuhig(P, 3000);
    pruefe('D3 … auch nicht, wenn der Schreib-Cursor im Text steht', b.nodes.length === 2, b.nodes.map((n) => n.id));
  } else pruefe('D3 Schreib-Cursor im Text der offenen Notiz', false, 'kein Textfeld');
  pruefe('D4 die Karte bleibt offen', await P.evaluate(() => !!document.querySelector('.focus-head')));
  for (let i = 0; i < 4 && await P.evaluate(() => !!document.querySelector('.focus-head')); i += 1) { await P.keyboard.press('Escape'); await P.waitForTimeout(400); }
  await warteBis(P, () => !document.querySelector('.focus-head'));
  await P.waitForTimeout(700);
  await waehle(P, 'b');
  await P.keyboard.press('Control+d');
  b = await standBis(P, (b) => b.nodes.length === 3);
  pruefe('D5 ohne Fokus dupliziert Strg+D die gewählte Karte wie bisher', b.nodes.length === 3, b.nodes.map((n) => n.id));
  await ctx.close();
}

await browser.close();
app.close();
if (fehler.length) { bad += 1; console.log('  ✗ Fehler auf der Seite:', fehler.slice(0, 5)); } else console.log('\n  ✓ keine Fehler auf der Seite');
console.log(`\n${ok} ✓, ${bad} ✗`);
process.exit(bad ? 1 : 0);
