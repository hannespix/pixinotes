/**
 * M432 — Pfeile mit Tiefe: ein perspektivischer Schatten unter jeder Verbindung, die Linie gewinnt zum Ziel an Kraft.
 *
 * Gemeldet: „Die 3D-Überlagerungen bei den Pfeilen mit perspektivischen Schatten etc. sind cool und machen Eindruck!"
 * (Verantwortungsplaner) — und später: „3D-Schatten bei Pfeilen etc. fehlen mir noch … das hattest du doch schon mal
 * alles vorbereitet!" Die Karten bleiben flach (M417), die Verbindungen heben sich ab.
 *
 *   A  Unter jeder Verbindung liegt ein weicher Schatten. An den Enden berührt er die Karten, zur Mitte hin liegt er
 *      tiefer — als höbe sich der Pfeil in der Mitte vom Board ab.
 *   B  Die Linie läuft vom Start blasser zum Ziel kräftig (Richtung und Tiefe); Farbe und Stil bleiben, wie gewählt.
 *   C  Eine gewählte Verbindung steht in voller Kraft; bei hohem Kontrast gibt es keinen Schatten.
 */
// Läuft aus dem Repository: `node pruefungen/m432-pfeile-tiefe.mjs`
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
const PORT = 4769;
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
const n = (id, x, y, text, color = 'yellow') => ({ id, type: 'note', position: { x, y }, width: 220, data: { color, blocks: [{ type: 'paragraph', content: text }] } });
const NODES = [n('a', 0, 0, 'Idee'), n('b', 420, 160, 'Prüfen', 'sky'), n('c', 840, 0, 'Umsetzen', 'mint')];
const EDGES = [{ id: 'e1', source: 'a', target: 'b', type: 'labeled', data: { label: 'weiter' } }, { id: 'e2', source: 'a', target: 'c', type: 'labeled', data: { color: '#e8590c' } }];
const auf = async (kontrast = false) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(([ns, es, k]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'x', name: 'Ablauf', edges: es, drawings: [], nodes: ns }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board', hoherKontrast: k } }));
  }, [NODES, EDGES, kontrast]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2500);
  return { ctx, P };
};
/** Linie und Schatten einer Verbindung: Anfang, Mitte, Ende (Board-Koordinaten) */
const messen = (P, id) => P.evaluate((i) => {
  const g = document.querySelector(`.react-flow__edge[data-id="${i}"]`);
  const linie = g?.querySelector('.react-flow__edge-path'); const schatten = document.querySelector(`.pn-schatten-ebene .pn-kante-schatten[data-kante="${i}"]`);
  if (!linie || !schatten) return null;
  const punkte = (p) => { const L = p.getTotalLength(); const a = p.getPointAtLength(0); const m = p.getPointAtLength(L / 2); const e = p.getPointAtLength(L); return { a: [a.x, a.y], m: [m.x, m.y], e: [e.x, e.y] }; };
  const verlauf = /url\(["']?#([^"')]+)/.exec(linie.style.stroke ?? '')?.[1];
  const stops = verlauf ? [...document.getElementById(verlauf)?.querySelectorAll('stop') ?? []].map((s) => Number(getComputedStyle(s).stopOpacity)) : [];
  const farbe = verlauf ? getComputedStyle(document.getElementById(verlauf).querySelector('stop')).stopColor : linie.style.stroke;
  const ebene = schatten.closest('svg.pn-schatten-ebene');
  const zahl = document.querySelectorAll(`.pn-kante-schatten[data-kante="${i}"]`).length;
  return { linie: punkte(linie), schatten: punkte(schatten), sichtbar: getComputedStyle(ebene).display !== 'none', farbe, maske: !!verlauf, stops, zahl, filter: schatten.getAttribute('filter'), weich: getComputedStyle(ebene).filter, ebenen: document.querySelectorAll('svg.pn-schatten-ebene').length, unten: ebene.parentElement.firstElementChild === ebene || ebene.parentElement.querySelector(':scope > svg') === ebene };
}, id);

console.log('A  Schatten');
const { ctx, P } = await auf();
const e1 = await messen(P, 'e1'); const e2 = await messen(P, 'e2');
pruefe('A1 jede Verbindung hat einen weichen Schatten – eine Linie je Pfeil in EINER gemeinsamen Ebene unter allen Pfeilen, ein einziger Weichzeichner darüber (M434)', !!e1 && !!e2 && e1.zahl === 1 && e2.zahl === 1 && !e1.filter && e1.ebenen === 1 && e1.unten && /blur\(/.test(e1.weich), { e1, e2 });
const nah = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5;
pruefe('A2 an den Enden berührt der Schatten die Karten (gleiche Endpunkte wie die Linie)', nah(e1.linie.a, e1.schatten.a) && nah(e1.linie.e, e1.schatten.e) && nah(e2.linie.a, e2.schatten.a) && nah(e2.linie.e, e2.schatten.e), { e1, e2 });
pruefe('A3 zur Mitte hin liegt er tiefer – der Pfeil hebt sich ab (lange Verbindung stärker)', e1.schatten.m[1] - e1.linie.m[1] > 4 && e2.schatten.m[1] - e2.linie.m[1] > e1.schatten.m[1] - e1.linie.m[1], { e1: e1.schatten.m[1] - e1.linie.m[1], e2: e2.schatten.m[1] - e2.linie.m[1] });

console.log('B  Verlauf');
pruefe('B1 die Linie läuft vom Start blasser zum Ziel kräftig', e1.maske && e1.stops.length === 2 && e1.stops[0] < e1.stops[1] && e1.stops[1] === 1, e1.stops);
pruefe('B2 die eigene Farbe bleibt (orange)', /232, 89, 12|#e8590c/i.test(e2.farbe), e2.farbe);
await P.screenshot({ path: path.join(SD, 'm432-pfeile.png') });

console.log('C  Auswahl, Kontrast');
const mitte = await P.evaluate(() => { const l = document.querySelector('.react-flow__edge[data-id="e2"] .react-flow__edge-path'); const L = l.getTotalLength(); const q = l.getPointAtLength(L * 0.4); const m = l.getScreenCTM(); return [m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f]; });
await P.mouse.click(mitte[0], mitte[1]);
await P.waitForTimeout(400);
const gewaehlt = await P.evaluate(() => { const l = document.querySelector('.react-flow__edge[data-id="e2"] .react-flow__edge-path'); return { gewaehlt: document.querySelector('.react-flow__edge[data-id="e2"]').classList.contains('selected'), strich: l.style.stroke }; });
pruefe('C1 eine gewählte Verbindung steht in voller Kraft (ohne Verlauf)', gewaehlt.gewaehlt && !/url\(/.test(gewaehlt.strich), gewaehlt);
// M434: ⚙ → Darstellung → „Pfeilschatten" schaltet ihn ab (und gespeichert)
await P.keyboard.press('Escape');
await P.locator('[data-taste="einstellungen"]').click(); await P.waitForTimeout(300);
const schalter = P.locator('[data-taste="pfeil-schatten"]');
const vorher = await schalter.isChecked();
await schalter.uncheck(); await P.waitForTimeout(1500);
const aus = await P.evaluate(() => ({ zahl: document.querySelectorAll('.pn-kante-schatten').length, gespeichert: JSON.parse(localStorage.getItem('pixinotes-board')).state.pfeilSchatten }));
pruefe('C3 Einstellungen → Darstellung: „Pfeilschatten" aus → keine Schatten, gemerkt', vorher && aus.zahl === 0 && aus.gespeichert === false, { vorher, aus });
await schalter.check(); await P.waitForTimeout(300);
pruefe('C4 wieder an → Schatten zurück', (await P.locator('.pn-kante-schatten').count()) === 2);
await ctx.close();
{
  const { ctx: c2, P: Q } = await auf(true);
  const k = await messen(Q, 'e1');
  pruefe('C2 hoher Kontrast: kein Schatten', !!k && !k.sichtbar, k);
  await c2.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('D1 Hilfe und Umbau-Liste nennen M432', /M432/.test(hilfe) && /M432/.test(umbau));
}
await browser.close(); app.close();
console.log(`\nM432: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
