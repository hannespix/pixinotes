/**
 * M475 — Stylesheet in Teildateien je Bereich.
 *
 * `src/index.css` (~8 600 Zeilen) war der größte Konflikt-Hotspot paralleler Agenten. Jetzt liegt das Stylesheet in
 * `src/styles/NN-bereich.css`; `src/index.css` bindet die Teile nur noch per @import in fester Reihenfolge ein.
 * Die Kaskade hängt an dieser Reihenfolge – diese Reihe hält sie fest:
 *
 *   A  Aufbau: index.css enthält nur Kommentare und @import-Zeilen; jede Datei in src/styles/ wird genau einmal
 *      eingebunden, jede eingebundene Datei gibt es; die Nummern im Namen steigen in Einbinde-Reihenfolge.
 *   B  „Bedienung nur im Fokus" (M421): 99-bedienung-im-fokus.css wird zuletzt eingebunden, trägt die drei Listen
 *      (Übergang, Zeiger, Finger) mit derselben Klassenliste – und im gebauten Stylesheet sind ihre Regeln die
 *      letzten.
 *   C  Verhalten im Browser: Schriften aus den Teildateien laden (url() wurde beim Verschieben umgeschrieben), die
 *      Bedienung einer Kanban-Karte ist in Ruhe unsichtbar und markiert sichtbar, Tokens aus 00-tokens.css greifen.
 */
// Läuft aus dem Repository: `node pruefungen/m475-css-teile.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { cssTeile } from '../werkzeug/css-quelle.mjs';
import { regeln } from '../werkzeug/css-vergleich.mjs';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5475;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const lies = (p) => readFileSync(path.join(__repo, p), 'utf8');

console.log('\n════ A: Aufbau ════');
const index = lies('src/index.css');
const ohneKommentare = index.replace(/\/\*[\s\S]*?\*\//g, '');
const fremd = ohneKommentare.split('\n').map((z) => z.trim()).filter((z) => z && !/^@import\s+['"]\.\/styles\/[\w-]+\.css['"];$/.test(z));
pruefe('A1 src/index.css enthält nur @import-Zeilen auf src/styles/ (keine Regel)', fremd.length === 0, fremd.slice(0, 3));
const teile = cssTeile(__repo);
const dateien = readdirSync(path.join(__repo, 'src/styles')).filter((d) => d.endsWith('.css')).map((d) => `src/styles/${d}`);
const doppelt = teile.filter((t, i) => teile.indexOf(t) !== i);
const fehlt = dateien.filter((d) => !teile.includes(d));
const weg = teile.filter((t) => !existsSync(path.join(__repo, t)));
pruefe('A2 jede Teildatei genau einmal eingebunden, jede eingebundene vorhanden', teile.length >= 10 && !doppelt.length && !fehlt.length && !weg.length, { doppelt, fehlt, weg });
const nummern = teile.map((t) => Number((/\/(\d+)-/.exec(t) ?? [])[1]));
pruefe('A3 Nummern im Dateinamen steigen in Einbinde-Reihenfolge', nummern.every((n, i) => Number.isFinite(n) && (i === 0 || n > nummern[i - 1])), teile);
pruefe('A4 Tokens zuerst: 00-tokens.css trägt das erste :root mit den Mauszeiger-Variablen (M464)',
  teile[0] === 'src/styles/00-tokens.css' && /:root\s*\{[\s\S]*--zeiger-/.test(lies(teile[0]).split(/\n\}/)[0] + '\n}'));
const andereCss = readdirSync(path.join(__repo, 'src')).filter((d) => d.endsWith('.css') && d !== 'index.css');
pruefe('A5 keine weiteren Stylesheets neben index.css in src/', andereCss.length === 0, andereCss);

console.log('\n════ B: Bedienung nur im Fokus zuletzt ════');
const LETZTE = 'src/styles/99-bedienung-im-fokus.css';
pruefe('B1 99-bedienung-im-fokus.css wird zuletzt eingebunden', teile[teile.length - 1] === LETZTE, teile.slice(-2));
const fokusCss = lies(LETZTE);
const listen = [...fokusCss.matchAll(/:(?:where|is)\(\s*\n([\s\S]*?)\n\s*\)\s*\{/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
pruefe('B2 die drei Listen (Übergang, Zeiger, Finger) stehen dort und sind gleich', listen.length >= 3 && listen.every((l) => l === listen[0]) && /kanban-add/.test(listen[0]), listen.length);
const gebaut = readdirSync(path.join(DIST, 'assets')).filter((d) => /^index-.*\.css$/.test(d));
let letzte = [];
// M510: dahinter die vierte Liste – „Oberfläche ausblenden" (html[data-nur-board])
if (gebaut.length === 1) letzte = regeln(readFileSync(path.join(DIST, 'assets', gebaut[0]), 'utf8')).slice(-5);
pruefe('B3 im gebauten Stylesheet sind die Regeln aus 99-… die letzten',
  letzte.length === 5 && /^@keyframes pn-bedienung-ein/.test(letzte[0]) && /^@media\(hover:none\)/.test(letzte[3]) && /^html\[data-nur-board\]/.test(letzte[4]), letzte.map((r) => r.slice(0, 40)));

console.log('\n════ C: Verhalten im Browser ════');
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const KARTEN = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Quartal' }] } },
  { id: 'k1', type: 'kanban', position: { x: 400, y: 0 }, width: 420, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }] } },
];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 900 } });
await ctx.addInitScript((n) => {
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: n }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false } }));
}, KARTEN);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
const geladen = [];
P.on('response', (r) => { if (/\.woff2$/.test(r.url()) && r.ok()) geladen.push(path.basename(r.url())); });
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);
const schriften = await P.evaluate(async () => {
  await Promise.all([document.fonts.load('16px "Kalam"'), document.fonts.load('16px "PN Geist"')]);
  return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/['"]/g, ''));
});
pruefe('C1 Schriften aus den Teildateien laden (Kalam aus 54-…, Geist aus 70-…) – url() stimmt',
  schriften.includes('Kalam') && schriften.includes('PN Geist') && geladen.some((g) => /kalam/i.test(g)) && geladen.some((g) => /geist/i.test(g)), { schriften, geladen });
const deckkraft = () => P.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="k1"] .kanban-add'); return e ? Number(getComputedStyle(e).opacity) : null; });
await P.mouse.move(1350, 850); await P.waitForTimeout(300);
const ruhe = await deckkraft();
const k = await P.locator('.react-flow__node[data-id="k1"]').boundingBox();
await P.mouse.click(k.x + 150, k.y + 14); await P.mouse.move(1350, 850); await P.waitForTimeout(500);
const markiert = await deckkraft();
pruefe('C2 Bedienung (M421) in Ruhe unsichtbar, markiert sichtbar', ruhe === 0 && markiert === 1, { ruhe, markiert });
const token = await P.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zeiger-fadenkreuz').trim());
pruefe('C3 Tokens aus 00-tokens.css greifen (--zeiger-fadenkreuz gesetzt)', /^url\(/.test(token), token.slice(0, 40));
pruefe('C4 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close(); app.close();
console.log(`\n${ok} ok, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
