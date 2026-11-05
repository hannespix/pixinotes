/**
 * M318 — Eine Leiste unten, nie zwei.
 *
 *   A  PC: Eine Karte, an der oben und unten kein Platz ist → die Auswahl-
 *      Leiste dockt unten an, das Dock fährt weg (unsichtbar, nicht klickbar),
 *      die Leiste steht in der Dock-Zeile; genau EIN ⋯ sichtbar unten.
 *   B  Auswahl aufheben → Dock wieder da, Leiste weg.
 *   C  Mit offener Spalte sitzt die Leiste mittig über der FLÄCHE (wie das Dock).
 *   D  Karte mit Platz darunter → Leiste an der Karte, Dock bleibt sichtbar.
 *   E  Telefon: unverändert eine Leiste.
 *   F  „Was ist neu" nennt M318.
 */
// Läuft aus dem Repository: `node pruefungen/m318-eine-leiste.mjs`
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
const PORT = 4540;
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

// Eine hohe Karte: oben klebt sie unter der Kopfleiste, unten reicht sie bis ans Dock
const hoch = (id, h) => ({ id, type: 'note', width: 260, height: h, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Hohe Karte' }] } });
const klein = (id) => ({ id, type: 'note', width: 240, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Kleine Karte' }] } });
const stand = (nodes) => ({
  boards: [{ id: 'b1', name: 'Planung', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(st, viewport = { width: 1440, height: 900 }, vorlieben = { schliff: 2 }, opt = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...opt });
  await ctx.addInitScript(({ st, v }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify(v));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, v: vorlieben });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
/** Karte so zoomen/schieben, dass sie von der Kopfleiste bis ans Dock reicht */
async function fuellen(P) {
  await P.evaluate(() => {
    const el = document.querySelector('.react-flow__node');
    const r = el.getBoundingClientRect();
    const kopf = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 60;
    const dock = document.querySelector('.dock')?.getBoundingClientRect().top ?? innerHeight - 80;
    const ziel = dock - kopf - 10;            // verfügbare Höhe
    const zoom = ziel / r.height;             // so hoch wie der freie Raum
    window.dispatchEvent(new CustomEvent('pixinotes:test-viewport', { detail: { zoom } }));
  }).catch(() => {});
}
const lage = (P) => P.evaluate(() => {
  const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, mitte: b.left + b.width / 2, opacity: cs.opacity, pe: cs.pointerEvents }; };
  return { dock: r('.dock'), leiste: r('.sel-toolbar-dock'), karte: r('.sel-toolbar:not(.sel-toolbar-dock)'), node: r('.react-flow__node'), kopf: r('.topbar'), h: innerHeight, w: innerWidth,
    mehrUnten: [...document.querySelectorAll('[aria-label="Mehr"]')].filter((b) => { const x = b.getBoundingClientRect(); const cs = getComputedStyle(b.closest('.dock, .sel-toolbar') ?? b); return x.top > innerHeight - 120 && x.width > 0 && cs.opacity !== '0'; }).length };
});
async function waehle(P) {
  const n = P.locator('.react-flow__node').first();
  const b = await n.boundingBox();
  await P.mouse.click(b.x + 8, b.y + 8);
  await P.waitForTimeout(500);
}

// ══ A/B: PC, Karte ohne Platz oben und unten ═════════════════════════
console.log('\n════ A: Auswahl-Leiste dockt an, Dock weicht ════');
{
  // Fensterhöhe 700: eine Karte von 560 Punkten Höhe lässt oben wie unten keinen Platz
  const { ctx, P } = await seite(stand([hoch('n1', 560)]), { width: 1200, height: 700 });
  // Karte an die Kopfleiste schieben: Ansicht so setzen, dass die Karte bei y≈kopf+8 beginnt
  await P.evaluate(() => { document.querySelector('.react-flow__node').scrollIntoView?.(); });
  await waehle(P);
  let l = await lage(P);
  // Falls die Leiste an der Karte Platz fand (Zoom), die Ansicht so verschieben, dass sie nicht mehr passt
  if (!l.leiste) {
    const dy = (l.node?.top ?? 200) - ((l.kopf?.bottom ?? 60) + 6);
    await P.keyboard.press('Escape'); await P.waitForTimeout(200);
    await P.mouse.move(900, 400); await P.mouse.down(); await P.mouse.move(900, 400 - dy, { steps: 8 }); await P.mouse.up(); await P.waitForTimeout(400);
    await waehle(P);
    l = await lage(P);
  }
  pruefe('A1 die Leiste dockt unten an (kein Platz an der Karte)', !!l.leiste, JSON.stringify({ node: l.node, kopf: l.kopf, h: l.h }));
  pruefe('A2 das Dock ist weg: unsichtbar und nicht klickbar', l.dock && l.dock.opacity === '0' && l.dock.pe === 'none', JSON.stringify(l.dock));
  pruefe('A3 die Leiste steht in der Dock-Zeile (gleicher unterer Rand ±6)', l.leiste && l.dock && Math.abs(l.leiste.bottom - (l.h - 18)) <= 6, JSON.stringify({ leiste: l.leiste?.bottom, erwartet: l.h - 18 }));
  pruefe('A4 genau EIN ⋯ unten sichtbar', l.mehrUnten === 1, String(l.mehrUnten));
  pruefe('A5 die Leiste steht dort, wo das Dock stand (gleiche Mitte)', l.leiste && l.dock && Math.abs(l.leiste.mitte - l.dock.mitte) < 4, JSON.stringify({ leiste: l.leiste?.mitte, dock: l.dock?.mitte }));
  await P.screenshot({ path: path.join(SD, 'm318-a-eine-leiste.png') });
  console.log('\n════ B: Auswahl aufheben ════');
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
  l = await lage(P);
  pruefe('B1 Leiste weg, Dock wieder sichtbar und klickbar', !l.leiste && l.dock && l.dock.opacity === '1' && l.dock.pe !== 'none', JSON.stringify(l.dock));
  await ctx.close();
}

// ══ C: Mit offener Spalte mittig über der Fläche ════════════════════
console.log('\n════ C: Spalte offen ════');
{
  const { ctx, P } = await seite(stand([hoch('n1', 560)]), { width: 1200, height: 700 }, { schliff: 2, navLinks: true });
  await waehle(P);
  let l = await lage(P);
  if (!l.leiste) {
    const dy = (l.node?.top ?? 200) - ((l.kopf?.bottom ?? 60) + 6);
    await P.keyboard.press('Escape'); await P.waitForTimeout(200);
    await P.mouse.move(900, 400); await P.mouse.down(); await P.mouse.move(900, 400 - dy, { steps: 8 }); await P.mouse.up(); await P.waitForTimeout(400);
    await waehle(P); l = await lage(P);
  }
  const spalte = await P.evaluate(() => document.querySelector('.tabs.spalte')?.getBoundingClientRect().right ?? 0);
  const flaecheMitte = spalte + (l.w - spalte) / 2;
  pruefe('C1 Leiste angedockt, Dock weg', !!l.leiste && l.dock?.opacity === '0', JSON.stringify({ leiste: !!l.leiste, dock: l.dock?.opacity }));
  pruefe('C2 Leiste mittig über der Fläche (nicht über der Spalte)', l.leiste && Math.abs(l.leiste.mitte - flaecheMitte) < 8 && l.leiste.left > spalte, JSON.stringify({ mitte: l.leiste?.mitte, flaeche: flaecheMitte, spalte }));
  await ctx.close();
}

// ══ D: Platz an der Karte → Leiste an der Karte, Dock bleibt ════════
console.log('\n════ D: Platz an der Karte ════');
{
  const { ctx, P } = await seite(stand([klein('n1')]));
  await waehle(P);
  const l = await lage(P);
  pruefe('D1 Leiste an der Karte, nicht angedockt', !!l.karte && !l.leiste);
  pruefe('D2 Dock bleibt sichtbar', l.dock && l.dock.opacity === '1' && l.dock.pe !== 'none', JSON.stringify(l.dock));
  pruefe('D3 trotzdem nur EIN ⋯ unten', l.mehrUnten === 1, String(l.mehrUnten));
  await ctx.close();
}

// ══ E: Telefon ══════════════════════════════════════════════════════
console.log('\n════ E: Telefon ════');
{
  const { ctx, P } = await seite(stand([hoch('n1', 560)]), { width: 390, height: 844 }, { schliff: 2 }, { isMobile: true, hasTouch: true });
  const n = P.locator('.react-flow__node').first();
  const b = await n.boundingBox();
  await P.touchscreen.tap(b.x + 8, b.y + 8); await P.waitForTimeout(600);
  const l = await lage(P);
  pruefe('E1 am Telefon eine Leiste: angedockt, Dock weg', !!l.leiste && l.dock?.opacity === '0', JSON.stringify({ leiste: !!l.leiste, dock: l.dock?.opacity, karte: !!l.karte }));
  await P.screenshot({ path: path.join(SD, 'm318-e-telefon.png') });
  await ctx.close();
}

// ══ F: Texte ════════════════════════════════════════════════════════
console.log('\n════ F: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('F1 „Was ist neu" nennt M318', js.includes('Eine Leiste unten, nie zwei (M318)'));
}

await browser.close(); app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
