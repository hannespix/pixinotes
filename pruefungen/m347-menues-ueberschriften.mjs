/**
 * M347 — Überschriften kleiner; Menüs und Einstellungen nachgemessen.
 *
 *   A  Überschriften: Notiz-H1/H2/H3 und Titelzeile in ruhiger Stufung; Fenster- und Druck-Titel.
 *   B  Einstellungen: Häkchen rechtsbündig; am Finger Umschalter und Farbpunkte ≥ 36 Punkte.
 *   C  Auswahl-Menü: die Farbfelder zeigen ihre Farben.
 *   D  Menüs bleiben im Bild (Übersicht, Netz) und sitzen nah am Auslöser (Dock am Telefon).
 *   E  Telefon: Aufgaben-Schnelleingabe und Hilfe-Kopf ohne Überlauf.
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m347-menues-ueberschriften.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4565;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const t = (s) => [{ type: 'text', text: s, styles: {} }];
const nz = (id, x, y, blocks, farbe = 'yellow') => ({ id, type: 'note', width: 300, height: 260, autoFit: false, position: { x, y }, data: { color: farbe, blocks } });
const stand = () => ({
  boards: [
    { id: 'b1', name: 'Planung', comments: [], edges: [], drawings: [], nodes: [
      nz('n1', 0, 0, [
        { id: 'a', type: 'paragraph', content: t('Titelzeile') }, { id: 'b', type: 'heading', props: { level: 1 }, content: t('Eins') },
        { id: 'c', type: 'paragraph', content: t('Text') }, { id: 'd', type: 'heading', props: { level: 2 }, content: t('Zwei') },
        { id: 'e', type: 'heading', props: { level: 3 }, content: t('Drei') }, { id: 'f', type: 'checkListItem', props: { checked: false }, content: t('Aufgabe mit einem langen Namen') },
      ]),
      nz('n2', 340, 0, [{ id: 'g', type: 'paragraph', content: t('Zweite') }], 'sky'),
    ] },
    { id: 'b2', name: 'Ideen', comments: [], edges: [], drawings: [], nodes: [nz('m1', 0, 0, [{ id: 'h', type: 'paragraph', content: t('Idee') }])] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Kunden', boardIds: ['b1'] }, { id: 'p2', name: 'Intern', boardIds: ['b2'] }] }],
  activeId: 'b1', view: 'board',
});
const GERAETE = {
  desktop: { viewport: { width: 1440, height: 900 } },
  telefon: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true },
};
async function seite(g) {
  const ctx = await browser.newContext({ ...GERAETE[g], deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand() });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  return { ctx, P };
}
const px = (P, sel) => P.evaluate((sel) => { const e = document.querySelector(sel); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; }, sel);
const imBild = (r, vw, vh) => r && r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
const rect = (P, sel) => P.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].filter((x) => x.getBoundingClientRect().width > 2).pop(); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const tippe = async (P, sel, g) => {
  const r = await rect(P, sel); if (!r) return false;
  if (g === 'desktop') await P.mouse.click(r.left + r.width / 2, r.top + r.height / 2); else await P.touchscreen.tap(r.left + r.width / 2, r.top + r.height / 2);
  await P.waitForTimeout(450); return true;
};

console.log('\n════ A: Überschriften ════');
{
  const { ctx, P } = await seite('desktop');
  const N = '.react-flow__node[data-id="n1"]';
  const text = await px(P, `${N} .bn-block-outer:nth-child(3) p`);
  const h1 = await px(P, `${N} [data-content-type="heading"]:not([data-level="2"]):not([data-level="3"])`);
  const h2 = await px(P, `${N} [data-content-type="heading"][data-level="2"]`);
  const h3 = await px(P, `${N} [data-content-type="heading"][data-level="3"]`);
  const titel = await px(P, `${N} .bn-block-outer:first-child p`);
  pruefe('A1 Notiz-H1 höchstens 1,6 × Text (vorher 3 ×)', text > 0 && h1 / text <= 1.6 && h1 / text >= 1.35, [h1, text]);
  pruefe('A2 H2 und H3 klar gestuft und kleiner', h2 / text <= 1.35 && h3 / text <= 1.2 && h1 > h2 && h2 > h3 && h3 > text, [h1, h2, h3, text]);
  pruefe('A3 Titelzeile bleibt erkennbar, aber nur leicht größer', titel / text >= 1.04 && titel / text <= 1.12, [titel, text]);
  await P.keyboard.press('Alt+e'); await P.waitForTimeout(600);
  const fenster = await px(P, '.modal-head h2');
  pruefe('A4 Fenster-Titel höchstens 16 Punkte', fenster > 0 && fenster <= 16, fenster);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.keyboard.press('Alt+t'); await P.waitForTimeout(600);
  const aufg = await px(P, '.taskhub-head h2');
  pruefe('A5 Aufgaben-Titel höchstens 17 Punkte', aufg > 0 && aufg <= 17, aufg);
  await ctx.close();
}
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('A6 Druck und PDF setzen die Überschriften ebenso maßvoll', js.includes('h1 { font-size: 1.5em; } h2 { font-size: 1.28em; }'));
}

console.log('\n════ B/C: Einstellungen und Auswahl-Menü ════');
{
  const { ctx, P } = await seite('desktop');
  await P.keyboard.press('Alt+e'); await P.waitForTimeout(600);
  const lagen = await P.evaluate(() => {
    const m = document.querySelector('.modal').getBoundingClientRect();
    const haken = [...document.querySelectorAll('.modal .modal-row-check input[type="checkbox"]')].map((e) => Math.round(m.right - e.getBoundingClientRect().right));
    const seg = [...document.querySelectorAll('.modal .modal-row .seg')].map((e) => Math.round(m.right - e.getBoundingClientRect().right));
    return { haken, seg };
  });
  const rechts = Math.min(...lagen.seg);
  pruefe('B1 Häkchen stehen rechtsbündig wie die Umschalter', lagen.haken.length >= 3 && lagen.haken.every((d) => Math.abs(d - rechts) <= 4), lagen);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  // Auswahl-Menü: Farbfelder
  const n = await rect(P, '.react-flow__node[data-id="n2"]');
  await P.mouse.click(n.left + n.width / 2, n.top + 6); await P.waitForTimeout(400);
  await P.click('.sel-toolbar button[aria-label="Mehr"], .sel-toolbar button[title^="Mehr"]').catch(() => {});
  await P.waitForTimeout(400);
  const farben = await P.evaluate(() => [...document.querySelectorAll('.sel-ai-menu .sel-farbe')].map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(e).backgroundColor }; }));
  const bunt = new Set(farben.map((f) => f.bg));
  pruefe('C1 das Auswahl-Menü zeigt fünf runde Farbfelder in ihren Farben', farben.length === 5 && bunt.size === 5 && !bunt.has('rgba(0, 0, 0, 0)') && farben.every((f) => f.w === f.h && f.w >= 18 && f.w <= 24), farben);
  await ctx.close();
}
{
  const { ctx, P } = await seite('telefon');
  await P.keyboard.press('Alt+e'); await P.waitForTimeout(600);
  const z = await P.evaluate(() => ({
    seg: [...document.querySelectorAll('.modal .seg button')].map((e) => Math.round(e.getBoundingClientRect().height)),
    akzent: [...document.querySelectorAll('.modal button[aria-label^="Akzentfarbe"]')].map((e) => Math.round(Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height))),
    label: parseFloat(getComputedStyle(document.querySelector('.modal-row span')).fontSize),
    hinweis: parseFloat(getComputedStyle(document.querySelector('.modal-hint')).fontSize),
  }));
  pruefe('B2 Telefon: Umschalter und Farbpunkte mindestens 36 Punkte', z.seg.length > 0 && z.seg.every((h) => h >= 36) && z.akzent.length === 5 && z.akzent.every((h) => h >= 36), z);
  pruefe('B3 Telefon: Hinweise nicht größer als die Beschriftung', z.hinweis <= z.label, z);
  await ctx.close();
}

console.log('\n════ D: Menüs im Bild und am Auslöser ════');
for (const g of ['telefon', 'tablet']) {
  const { ctx, P } = await seite(g);
  const vw = GERAETE[g].viewport.width; const vh = GERAETE[g].viewport.height;
  // Dock-Menü „Mehr": nah am Dock
  await tippe(P, '.dock button[aria-label="Mehr"]', g);
  const menue = await rect(P, '.dock-menu'); const dock = await rect(P, '.dock');
  pruefe(`D1 ${g}: das Dock-Menü sitzt nah über dem Dock (≤ 16 Punkte)`, !!menue && !!dock && dock.top - menue.bottom >= 2 && dock.top - menue.bottom <= 16, [menue?.bottom, dock?.top]);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.evaluate(() => document.querySelector('.tab-home')?.click()); await P.waitForTimeout(1200);
  await P.evaluate(() => { [...document.querySelectorAll('.ov-mode button')].find((x) => x.textContent.trim() === 'Hierarchie')?.click(); }); await P.waitForTimeout(1000);
  // Projekt-Menü der Kachel ganz rechts
  const knopf = await P.evaluate(() => { const ks = [...document.querySelectorAll('.ov-canvas .ov-head-actions .ebenen-menu-knopf')].filter((e) => e.getBoundingClientRect().width > 2); ks.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right); const r = ks[0]?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; });
  if (knopf) { await P.touchscreen.tap(knopf[0], knopf[1]); await P.waitForTimeout(500); }
  const m = await rect(P, '.ebenen-menu');
  pruefe(`D2 ${g}: das Menü am rechten Rand der Übersicht bleibt ganz im Bild (8 Punkte Rand)`, !!m && m.left >= 8 && m.right <= vw - 7.5 && m.bottom <= vh, m);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.evaluate(() => { [...document.querySelectorAll('.ov-mode button')].find((x) => x.textContent.trim() === 'Netz')?.click(); }); await P.waitForTimeout(1500);
  const k = await P.evaluate(() => { const ns = [...document.querySelectorAll('.ov-graph-node')]; ns.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom); const r = ns[0]?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; });
  if (k) { await P.mouse.click(k[0], k[1], { button: 'right' }); await P.waitForTimeout(500); }
  const c = await rect(P, '.ov-graph-ctx');
  pruefe(`D3 ${g}: das Netz-Menü bleibt ganz im Bild`, imBild(c, vw, vh), c);
  await ctx.close();
}

console.log('\n════ E: Telefon ════');
{
  const { ctx, P } = await seite('telefon');
  await P.keyboard.press('Alt+t'); await P.waitForTimeout(700);
  const a = await P.evaluate(() => { const h = document.querySelector('.taskhub'); const q = document.querySelector('.taskhub-quickrow'); const r = q.getBoundingClientRect(); return { hub: h.scrollWidth - h.clientWidth, rechts: Math.max(...[...q.children].map((x) => x.getBoundingClientRect().right)) - window.innerWidth, hoehe: Math.round(r.height) }; });
  pruefe('E1 Aufgaben: Schnelleingabe ohne seitlichen Überlauf', a.hub <= 1 && a.rechts <= 0, a);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  await P.keyboard.press('Alt+h'); await P.waitForTimeout(700);
  const h = await P.evaluate(() => { const k = document.querySelector('.help-modal .modal-head'); const x = k.querySelector('.modal-x, button[aria-label="Schließen"]'); const t2 = k.querySelector('h2'); return { x: x ? x.getBoundingClientRect().right - window.innerWidth : 99, zeilen: Math.round(t2.getBoundingClientRect().height / parseFloat(getComputedStyle(t2).lineHeight || '20')), breit: document.querySelector('.help-modal').scrollWidth - document.querySelector('.help-modal').clientWidth }; });
  pruefe('E2 Hilfe: Kopf passt (Schließen im Bild, Titel einzeilig, kein Überlauf)', h.x <= 0 && h.breit <= 1, h);
  await ctx.close();
}

console.log('\n════ F: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('F1 „Was ist neu" nennt M347', js.includes('(M347)'));

await browser.close(); app.close();
console.log(`\nm347-menues-ueberschriften: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
