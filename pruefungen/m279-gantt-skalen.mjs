// Läuft aus dem Repository: `node pruefungen/m279-gantt-skalen.mjs`
/**
 * M279 — „prüfe alle Zeit Optionen ob sie funktionieren … so unkompliziert
 * und professionell wie Miro."
 *
 * Datenlage wie ein echtes Projekt (10 Vorgänge über 2,5 Jahre). Geprüft
 * werden die im Screenshot-Audit gefundenen Schwächen:
 *  · Skalenwechsel hält den ZEITPUNKT fest (kein Sprung an ein Zufallsdatum)
 *  · Jahres-Skala füllt mindestens das Fenster (kein halber weißer Kasten)
 *  · Q1 trägt sein Label (fehlte)
 *  · rechter Auslauf: letzte Raute + Namen bleiben im Bild
 *  · das Raster füllt die Karte bis unten (Geisterzeilen)
 *  · die Heute-Fahne verdeckt keine Kopf-Beschriftung
 *  · das Innen-Label klemmt am sichtbaren Rand
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 4502;
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

const ROWS = [
  { id: 'r1', name: 'Konzeptphase', start: '2026-01-12', end: '2026-03-20', color: '#4f7cff', progress: 100 },
  { id: 'r2', name: 'Ausschreibung', start: '2026-03-23', end: '2026-06-30', color: '#3fa564', progress: 75, dep: 'r1' },
  { id: 'r3', name: 'Vergabe', start: '2026-07-01', end: '2026-07-01', color: '#e07a3f' },
  { id: 'r4', name: 'Planung Bauabschnitt 1', start: '2026-07-06', end: '2026-11-27', color: '#a05fd4', progress: 40, who: 'Anna Muster' },
  { id: 'r5', name: 'Bau Abschnitt 1', start: '2027-01-04', end: '2027-08-31', color: '#d44f6e', dep: 'r4' },
  { id: 'r6', name: 'Zwischenabnahme', start: '2027-09-01', end: '2027-09-01', color: '#2b2a27' },
  { id: 'r7', name: 'Planung Bauabschnitt 2', start: '2027-03-01', end: '2027-07-30', color: '#4f7cff', who: 'B. Beispiel' },
  { id: 'r8', name: 'Bau Abschnitt 2', start: '2027-09-06', end: '2028-04-28', color: '#3fa564', dep: 'r6' },
  { id: 'r9', name: 'Restarbeiten', start: '2028-05-01', end: '2028-06-16', color: '#e07a3f' },
  { id: 'r10', name: 'Übergabe', start: '2028-06-30', end: '2028-06-30', color: '#d44f6e' },
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
await ctx.addInitScript((rows) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  const nodes = [{ id: 'g1', type: 'gantt', position: { x: 30, y: 30 }, width: 1080, height: 480,
    data: { title: 'Bauprojekt', rows, dayWidth: 24 } }];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
    spaces: [{ id: 's1', name: 'P', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
}, ROWS);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);

/** Datum in der Fenstermitte (aus Scroll-Stand und Tagesbreite gerechnet) */
const mittenTag = () => P.evaluate(() => {
  const el = document.querySelector('.gantt-scroll');
  const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
  const g = s.boards[0].nodes.find((n) => n.type === 'gantt');
  const dw = g.data.dayWidth ?? 24;
  const labelW = g.data.labelW ?? 128;
  return (el.scrollLeft + (el.clientWidth - labelW) / 2) / dw;   // Tage seit minD
});

// ══ T1: Skalenwechsel hält den Zeitpunkt fest ════════════════════════
console.log('════ T1: Zeit-Anker beim Skalenwechsel ════');
{
  const vorher = await mittenTag();
  await P.locator('.gantt-scale').selectOption('monate');
  await P.waitForTimeout(800);
  const nachher = await mittenTag();
  console.log(`    Mitte vorher Tag ${Math.round(vorher)}, nachher Tag ${Math.round(nachher)}`);
  pruefe('T1a Tage → Monate bleibt am selben Datum (±14 Tage)',
    Math.abs(vorher - nachher) < 14, `${Math.round(vorher)} → ${Math.round(nachher)}`);
  await P.locator('.gantt-scale').selectOption('wochen');
  await P.waitForTimeout(800);
  const zurueck = await mittenTag();
  pruefe('T1b Monate → Wochen ebenso', Math.abs(nachher - zurueck) < 14,
    `${Math.round(nachher)} → ${Math.round(zurueck)}`);
}

// ══ T2: Jahres-Skala füllt das Fenster ═══════════════════════════════
console.log('\n════ T2: Jahres-Skala ════');
{
  await P.locator('.gantt-scale').selectOption('jahre');
  await P.waitForTimeout(800);
  const j = await P.evaluate(() => {
    const svg = document.querySelector('.gantt-svg');
    const scroll = document.querySelector('.gantt-scroll');
    const quartale = [...document.querySelectorAll('.gantt-kopf .gantt-day')].map((t) => t.textContent);
    return { svgB: Number(svg.getAttribute('width')), fenster: scroll.clientWidth, quartale };
  });
  console.log('   ', JSON.stringify(j));
  pruefe('T2a das Diagramm füllt mindestens das Fenster', j.svgB >= j.fenster - 160,
    `${Math.round(j.svgB)} gegen Fenster ${j.fenster}`);
  pruefe('T2b Q1 trägt sein Label', j.quartale.includes('Q1'), JSON.stringify(j.quartale));
  pruefe('T2c alle vier Quartale kommen vor',
    ['Q1', 'Q2', 'Q3', 'Q4'].every((q) => j.quartale.includes(q)), JSON.stringify(j.quartale));
}

// ══ T3: Nichts läuft rechts aus dem Bild ═════════════════════════════
console.log('\n════ T3: Rechter Auslauf ════');
{
  const r = await P.evaluate(() => {
    const svgB = Number(document.querySelector('.gantt-svg').getAttribute('width'));
    // das ÄUSSERSTE gezeichnete Element (Raute der Übergabe + ihr Label)
    let maxRechts = 0;
    for (const el of document.querySelectorAll('.gantt-bar polygon, .gantt-barlabel')) {
      const b = el.getBBox ? el.getBBox() : null;
      if (b) maxRechts = Math.max(maxRechts, b.x + b.width);
    }
    return { svgB, maxRechts: Math.round(maxRechts) };
  });
  console.log('   ', JSON.stringify(r));
  pruefe('T3a Rauten und Namen enden VOR dem Diagrammrand', r.maxRechts <= r.svgB, JSON.stringify(r));
}

// ══ T4: Raster bis zur Unterkante ════════════════════════════════════
console.log('\n════ T4: Geisterzeilen füllen die Karte ════');
{
  const g = await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    const baender = document.querySelectorAll('.gantt-zeile').length;
    const svgH = Number(document.querySelector('.gantt-svg').getAttribute('height'));
    return { baender, svgH, innenH: el.clientHeight };
  });
  console.log('   ', JSON.stringify(g));
  pruefe('T4a es gibt mehr Bänder als Vorgänge (Geisterzeilen)', g.baender > 10, String(g.baender));
  pruefe('T4b das Raster reicht bis zur Unterkante', g.svgH >= g.innenH - 26, `${g.svgH} gegen ${g.innenH}`);
}

// ══ T5: Heute-Fahne verdeckt keine Kopf-Beschriftung ═════════════════
console.log('\n════ T5: Heute-Fahne ════');
{
  await P.locator('.gantt-scale').selectOption('tage');
  await P.waitForTimeout(800);
  await P.locator('button[title="Zu heute springen"]').click();
  await P.waitForTimeout(600);
  const f = await P.evaluate(() => {
    const fahne = [...document.querySelectorAll('.gantt-kopf rect')].find((r) => r.getAttribute('fill') === '#d84b3d');
    if (!fahne) return null;
    const fy = Number(fahne.getAttribute('y'));
    // Kopfzeile endet bei HEAD_H=34 — die Fahne muss DARUNTER beginnen
    return { y: fy, unterKopf: fy >= 34 };
  });
  console.log('   ', JSON.stringify(f));
  pruefe('T5a die Fahne sitzt unter der Kopfzeile (verdeckt keine Tageszahl)', f?.unterKopf === true, JSON.stringify(f));
}

// ══ T6: Innen-Label klemmt am sichtbaren Rand ════════════════════════
console.log('\n════ T6: Balken-Label beim Scrollen ════');
{
  // zu „Planung Bauabschnitt 1" scrollen, so dass der BALKENANFANG links raus ist
  await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    const balken = [...document.querySelectorAll('.gantt-bar rect[data-row="r4"]')][0];
    el.scrollLeft = Number(balken.getAttribute('x')) + 300;
  });
  await P.waitForTimeout(600);
  const l = await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    const label = [...document.querySelectorAll('.gantt-barlabel.innen')].find((t) => t.textContent.includes('Planung Bauabschnitt 1'));
    if (!label) return null;
    const x = Number(label.getAttribute('x'));
    return { x, scrollLeft: el.scrollLeft, sichtbar: x >= el.scrollLeft - 130 };
  });
  console.log('   ', JSON.stringify(l));
  pruefe('T6a der Name klemmt im sichtbaren Bereich', l?.sichtbar === true, JSON.stringify(l));
}

const box = await P.locator('.gantt-card').boundingBox();
await P.screenshot({ path: `${SD}/m279-endstand.png`, clip: box });
console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
