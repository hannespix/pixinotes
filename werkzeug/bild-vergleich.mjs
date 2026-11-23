#!/usr/bin/env node
// M475: Bildschirmfotos zweier Builds pixelgenau vergleichen (für Umbauten, die nichts sichtbar ändern dürfen).
//   node werkzeug/bild-vergleich.mjs <dist-alt> <dist-neu> [ablage]
// Beide Builds laufen nebeneinander (Ports 5475/6475), jede Ansicht wird in beiden gleich aufgerufen und
// fotografiert; verglichen werden die Bildpunkte (Canvas im Browser), nicht die PNG-Bytes.
// Ansichten: Board hell/dunkel, Karte im Fokus, Präsentation, Einstellungen, Telefon.
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const [, , ALT, NEU, ABLAGE = path.join(process.cwd(), 'pruefungen', 'ablage', 'bild-vergleich')] = process.argv;
if (!ALT || !NEU) { console.error('Aufruf: node werkzeug/bild-vergleich.mjs <dist-alt> <dist-neu> [ablage]'); process.exit(2); }
mkdirSync(ABLAGE, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = (dir, port) => new Promise((ok) => {
  const s = http.createServer((q, r) => {
    let f = path.join(dir, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
    if (!existsSync(f)) f = path.join(dir, 'index.html');
    r.writeHead(200, { 'Content-Type': TYP[path.extname(f)] ?? 'application/octet-stream' });
    r.end(readFileSync(f));
  });
  s.listen(port, () => ok(s));
});
const sA = await server(ALT, 5475); const sN = await server(NEU, 6475);

const absatz = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] });
const KARTEN = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Quartal' }, absatz('Umsatz wächst'), { type: 'checkListItem', props: { checked: true }, content: 'Angebot' }] } },
  { id: 'n2', type: 'note', position: { x: 0, y: 300 }, width: 300, height: 180, data: { title: 'Weiß', blocks: [absatz('Erstens.'), absatz('Zweitens.')] } },
  { id: 'k1', type: 'kanban', position: { x: 400, y: 0 }, width: 420, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße', col: 1 }] } },
  { id: 's1', type: 'shape', position: { x: 420, y: 360 }, width: 200, height: 110, data: { shape: 'decision', label: 'Ja?' } },
];
const KANTEN = [{ id: 'e1', source: 'n1', target: 'k1', type: 'floating', data: { label: 'weiter' } }];
const stand = { boards: [{ id: 'b1', name: 'Vergleich', edges: KANTEN, drawings: [], comments: [], nodes: KARTEN }],
  spaces: [{ id: 'sp', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false };

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text'] });
const seite = async (port, { dunkel = false, telefon = false } = {}) => {
  const ctx = await browser.newContext(telefon
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light', reducedMotion: 'reduce' }
    : { viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light', reducedMotion: 'reduce' });
  await ctx.addInitScript(({ s, dunkel: d }) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes:author', 'Cleo');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...(d ? { theme: 'dark' } : {}) }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
    // feste Zeit, damit Uhrzeiten und „vor n Minuten" in beiden Builds gleich sind
    const fest = new Date('2026-11-23T10:00:00').getTime(); const D = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends D { constructor(...a) { super(...(a.length ? a : [fest])); } static now() { return fest; } };
  }, { s: stand, dunkel });
  const P = await ctx.newPage();
  await P.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  await P.addStyleTag({ content: '*{caret-color:transparent!important}' });
  return { ctx, P };
};
const fokusAuf = async (P, id) => {
  const k = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  await P.mouse.click(k.x + Math.min(150, k.width / 2), k.y + 14); await P.waitForTimeout(250);
  await P.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => el.focus());
  await P.keyboard.press('Enter'); await P.waitForTimeout(1500);
};
const ANSICHTEN = [
  ['board-hell', {}, async () => {}],
  ['board-dunkel', { dunkel: true }, async () => {}],
  ['board-auswahl', {}, async (P) => { const k = await P.locator('.react-flow__node[data-id="k1"]').boundingBox(); await P.mouse.click(k.x + 150, k.y + 14); await P.mouse.move(5, 5); await P.waitForTimeout(800); }],
  ['board-zeiger-ruht', {}, async (P) => { const k = await P.locator('.react-flow__node[data-id="k1"]').boundingBox(); await P.mouse.move(k.x + 200, k.y + 150); await P.waitForTimeout(1200); }],
  ['fokus-notiz', {}, async (P) => fokusAuf(P, 'n1')],
  ['fokus-kanban-dunkel', { dunkel: true }, async (P) => fokusAuf(P, 'k1')],
  ['praesentation', {}, async (P) => { await P.mouse.click(1300, 820); await P.waitForTimeout(250); await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter', { timeout: 6000 }); await P.waitForTimeout(1200); }],
  ['einstellungen', {}, async (P) => { await P.locator('[data-taste="einstellungen"]').click(); await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(700); }],
  ['einstellungen-dunkel', { dunkel: true }, async (P) => { await P.locator('[data-taste="einstellungen"]').click(); await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(700); }],
  ['telefon', { telefon: true }, async () => {}],
  ['telefon-dunkel', { telefon: true, dunkel: true }, async () => {}],
];
let gleich = 0; let anders = 0;
const pixel = async (P, buf) => P.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let h = 0;
  for (let i = 0; i < d.length; i += 1) h = (h * 31 + d[i]) >>> 0;
  return { w: c.width, h: c.height, summe: h };
}, buf.toString('base64'));
for (const [name, opt, tun] of ANSICHTEN) {
  const bilder = [];
  for (const port of [5475, 6475]) {
    const { ctx, P } = await seite(port, opt);
    try { await tun(P); } catch (e) { console.log(`  ! ${name} (${port}): ${e.message.split('\n')[0]}`); }
    const buf = await P.screenshot({ animations: 'disabled' });
    writeFileSync(path.join(ABLAGE, `${name}-${port === 5475 ? 'alt' : 'neu'}.png`), buf);
    bilder.push({ buf, px: await pixel(P, buf) });
    await ctx.close();
  }
  const gl = bilder[0].buf.equals(bilder[1].buf) || JSON.stringify(bilder[0].px) === JSON.stringify(bilder[1].px);
  if (gl) gleich += 1; else anders += 1;
  console.log(`  ${gl ? '✓' : '✗'} ${name} ${bilder[0].px.w}×${bilder[0].px.h}${gl ? ' pixelgleich' : ' UNTERSCHIEDLICH'}`);
}
await browser.close(); sA.close(); sN.close();
console.log(`\n${gleich} pixelgleich, ${anders} unterschiedlich – Bilder in ${ABLAGE}`);
process.exit(anders ? 1 : 0);
