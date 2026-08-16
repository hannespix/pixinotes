/**
 * M280 — „gantt sieht immernoch komisch abgeschnitten aus! in machen Modi!!!"
 *
 * Der Befund aus den Bildschirmfotos: Überall dort, wo eine Beschriftung
 * länger war als ihr Platz, endete sie mitten im Buchstaben — in der
 * Namensspalte („Planung Bauabschr"), am Balken, in der Kopfzeile („APR."
 * als Rest von „APR. 27", ein einzelnes „3" von „KW 23").
 *
 * Geprüft wird in ALLEN vier Zeitskalen:
 *  · keine Beschriftung ragt über den sichtbaren Rand hinaus
 *  · zu lange Namen enden mit „…", nicht mitten im Wort
 *  · die Namensspalte kürzt mit Auslassungspunkten
 *  · weiche Kanten zeigen an, dass es weitergeht — und verschwinden am Ende
 */
// Läuft aus dem Repository: `node pruefungen/m280-gantt-schnitt.mjs`
// Voraussetzung: `npm run build` (die Reihe prüft den dist/-Stand) und ein
// Chromium — Pfad über die Umgebungsvariable PW_CHROMIUM, sonst der
// Standardpfad der Claude-Umgebung.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4498;
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

// Echte Projektlage: lange Namen, mehrere Jahre, Meilensteine
const ROWS = [
  { id: 'r1', name: 'Konzeptphase', start: '2026-01-12', end: '2026-03-20', color: '#4f7cff', progress: 100 },
  { id: 'r2', name: 'Ausschreibung und Vergabeverfahren', start: '2026-03-23', end: '2026-06-30', color: '#3fa564', progress: 75 },
  { id: 'r3', name: 'Vergabe', start: '2026-07-01', end: '2026-07-01', color: '#e07a3f' },
  { id: 'r4', name: 'Planung Bauabschnitt 1 mit Fachplanern', start: '2026-07-06', end: '2026-11-27', color: '#a05fd4', who: 'Anna Muster' },
  { id: 'r5', name: 'Bau Abschnitt 1', start: '2027-01-04', end: '2027-08-31', color: '#d44f6e' },
  { id: 'r6', name: 'Zwischenabnahme durch die Bauleitung', start: '2027-09-01', end: '2027-09-01', color: '#2b2a27' },
  { id: 'r7', name: 'Planung Bauabschnitt 2', start: '2027-03-01', end: '2027-07-30', color: '#4f7cff' },
  { id: 'r8', name: 'Bau Abschnitt 2', start: '2027-09-06', end: '2028-04-28', color: '#3fa564' },
  { id: 'r9', name: 'Restarbeiten', start: '2028-05-01', end: '2028-06-16', color: '#e07a3f' },
  { id: 'r10', name: 'Übergabe', start: '2028-06-30', end: '2028-06-30', color: '#d44f6e' },
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript((rows) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  const nodes = [{ id: 'g1', type: 'gantt', position: { x: 30, y: 30 }, width: 900, height: 440,
    data: { title: 'Bauprojekt', rows, dayWidth: 24 } }];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
}, ROWS);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);

/**
 * Welche Beschriftung wird vom Fensterrand ZERSCHNITTEN?
 *
 * Gesucht ist nicht, was außerhalb liegt — weggescrolltes Material ist bei
 * einem Roller normal und unsichtbar. Gesucht ist, was den Rand KREUZT:
 * halb im Bild, halb abgehackt. Genau das sah der Nutzer.
 */
const zerschnitten = () => P.evaluate(() => {
  const roller = document.querySelector('.gantt-scroll').getBoundingClientRect();
  const spalte = document.querySelector('.gantt-labels').getBoundingClientRect();
  const links = Math.max(roller.left, spalte.right);
  const rechts = roller.right;
  const raus = [];
  for (const t of document.querySelectorAll('.gantt-svg text')) {
    const b = t.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.left < rechts - 1 && b.right > rechts + 1) raus.push({ t: t.textContent, seite: 'rechts', d: Math.round(b.right - rechts) });
    else if (b.right > links + 1 && b.left < links - 1) raus.push({ t: t.textContent, seite: 'links', d: Math.round(links - b.left) });
  }
  return raus;
});

// ══ T1–T4: alle vier Zeitskalen, jeweils vorn und weit gescrollt ═════
for (const skala of ['tage', 'wochen', 'monate', 'jahre']) {
  console.log(`\n════ Skala „${skala}" ════`);
  await P.locator('.gantt-scale').selectOption(skala);
  await P.waitForTimeout(800);
  await P.evaluate(() => { document.querySelector('.gantt-scroll').scrollLeft = 0; });
  await P.waitForTimeout(500);
  const vorn = await zerschnitten();
  pruefe(`${skala}: am Anfang wird keine Beschriftung zerschnitten`, vorn.length === 0, JSON.stringify(vorn.slice(0, 4)));

  // Mitten hinein rollen — dort trifft es die Beschriftungen am härtesten
  await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) * 0.45);
  });
  await P.waitForTimeout(600);
  const mitte = await zerschnitten();
  pruefe(`${skala}: auch mitten im Zeitraum wird nichts zerschnitten`, mitte.length === 0, JSON.stringify(mitte.slice(0, 4)));

  // … und ans Ende
  await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    el.scrollLeft = el.scrollWidth;
  });
  await P.waitForTimeout(600);
  const ende = await zerschnitten();
  pruefe(`${skala}: am Ende ebenfalls nichts`, ende.length === 0, JSON.stringify(ende.slice(0, 4)));
  await P.screenshot({ path: `${SD}/m280-${skala}.png`, clip: await P.locator('.gantt-card').boundingBox() });
}

// ══ T5: Gekürzt wird mit „…" ═════════════════════════════════════════
console.log('\n════ T5: Kürzen statt abhacken ════');
{
  await P.locator('.gantt-scale').selectOption('monate');
  await P.waitForTimeout(700);
  /* Eine Stelle suchen, an der ein langer Name am rechten Rand ANSTEHT —
     nur dort muss überhaupt gekürzt werden. Ohne dieses Suchen prüfte der
     Test bloß eine Ansicht, in der alles bequem hineinpasst. */
  let namen = [];
  for (const anteil of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    await P.evaluate((a) => {
      const el = document.querySelector('.gantt-scroll');
      el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) * a);
    }, anteil);
    await P.waitForTimeout(400);
    namen = await P.evaluate(() =>
      [...document.querySelectorAll('.gantt-svg .gantt-barlabel')].map((t) => t.textContent));
    if (namen.some((n) => n.endsWith('…'))) break;
  }
  console.log('   ', JSON.stringify(namen));
  pruefe('T5a am Rand anstehende Namen enden mit „…"',
    namen.some((n) => n.endsWith('…')), JSON.stringify(namen));
  pruefe('T5b kein Name endet mit einem halben Wortrest ohne Auslassung',
    namen.every((n) => n.endsWith('…') || ROWS.some((r) => r.name === n)), JSON.stringify(namen));
  pruefe('T5c die Namensspalte kürzt mit Auslassungspunkten', await P.evaluate(() =>
    getComputedStyle(document.querySelector('.gantt-label')).textOverflow === 'ellipsis'));
  pruefe('T5d beim Bearbeiten fällt die Kürzung weg (man sieht, was man tippt)', await P.evaluate(() => {
    const el = document.querySelector('.gantt-label');
    el.focus();
    const wert = getComputedStyle(el).textOverflow;
    el.blur();
    return wert === 'clip';
  }));
}

// ══ T6: Weiche Kanten zeigen „geht weiter" ═══════════════════════════
console.log('\n════ T6: Weiche Kanten am Rollrand ════');
{
  await P.evaluate(() => { document.querySelector('.gantt-scroll').scrollLeft = 0; });
  await P.waitForTimeout(500);
  const vorn = await P.evaluate(() => {
    const w = document.querySelector('.gantt-scrollwrap');
    return { links: w.classList.contains('mehr-links'), rechts: w.classList.contains('mehr-rechts') };
  });
  pruefe('T6a am Anfang nur rechts eine Kante', vorn.rechts && !vorn.links, JSON.stringify(vorn));
  await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    el.scrollLeft = el.scrollWidth;
  });
  await P.waitForTimeout(600);
  const ende = await P.evaluate(() => {
    const w = document.querySelector('.gantt-scrollwrap');
    return { links: w.classList.contains('mehr-links'), rechts: w.classList.contains('mehr-rechts') };
  });
  pruefe('T6b am Ende nur links eine Kante', ende.links && !ende.rechts, JSON.stringify(ende));
  // Alles eingepasst: gar keine Kante
  await P.evaluate(() => {
    [...document.querySelectorAll('.gantt-tools button')]
      .find((b) => (b.getAttribute('title') ?? '').startsWith('Alles einpassen'))?.click();
  });
  await P.waitForTimeout(800);
  const passt = await P.evaluate(() => {
    const w = document.querySelector('.gantt-scrollwrap');
    return { links: w.classList.contains('mehr-links'), rechts: w.classList.contains('mehr-rechts') };
  });
  pruefe('T6c ist alles eingepasst, verschwinden beide Kanten', !passt.links && !passt.rechts, JSON.stringify(passt));
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
