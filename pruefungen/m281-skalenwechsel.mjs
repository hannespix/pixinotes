/**
 * M281 — „Wechsel bei gantt zwischen Tag/Woche/Monat/Jahr funktioniert nicht
 * sauber 🤐"
 *
 * Der Befund, gemessen an einem kurzen Plan (26 Tage): JEDE Wahl sprang im
 * Auswahlfeld auf „Tage" zurück. Grund war doppelt abgelegtes Wissen — die
 * Umschaltung rechnete eine Tagesbreite aus (M279: bis zum Fensterrand
 * dehnen), das Feld leitete daraus mit eigenen Schwellen wieder eine Skala
 * ab. Bei kurzen Plänen landete die Dehnung stets im Tages-Band.
 *
 * Geprüft wird darum:
 *  · Jede Wahl GILT — bei kurzem wie langem Plan, auch mehrfach hin und her
 *  · Die Kopfzeile zeigt zur Wahl passende Zeiträume (Jahre → Jahreszahlen)
 *  · Das Fenster bleibt gefüllt (die Zeitachse wächst, nicht der Tag)
 *  · Die Tagesbreite bleibt im Band der gewählten Skala
 *  · Die „Heute"-Fahne sitzt in der Kopfzeile, nicht auf der ersten Zeile
 */
// Läuft aus dem Repository: `node pruefungen/m281-skalenwechsel.mjs`
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
const PORT = 4499;
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

// Bänder aus GanttCard.tsx (SKALEN) — die Tagesbreite muss darin bleiben
const BAND = {
  tage: [14, 48], wochen: [4, 13.5], monate: [1.2, 3.8], jahre: [0.3, 1.15],
};

const heute = new Date();
const tag = (v) => {
  const d = new Date(heute.getTime() + v * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Kurzer Plan: genau der Fall, in dem der Wechsel versagte
const KURZ = [
  { id: 'r1', name: 'Analyse', start: tag(-14), end: tag(-5), color: '#4f7cff', progress: 60 },
  { id: 'r2', name: 'Umsetzung', start: tag(-4), end: tag(11), color: '#3fa564' },
  { id: 'r3', name: 'Abnahme', start: tag(14), end: tag(14), color: '#e07a3f' },
];
// Langer Plan: der M279-Fall (Jahres-Skala füllte nur die halbe Karte)
const LANG = [
  { id: 'r1', name: 'Konzept', start: tag(-200), end: tag(-40), color: '#4f7cff' },
  { id: 'r2', name: 'Bau', start: tag(-30), end: tag(640), color: '#3fa564' },
  { id: 'r3', name: 'Übergabe', start: tag(700), end: tag(700), color: '#d44f6e' },
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function seite(rows) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((rows) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
    const nodes = [{ id: 'g1', type: 'gantt', position: { x: 30, y: 30 }, width: 900, height: 420,
      data: { title: 'Plan', rows, dayWidth: 24 } }];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
  }, rows);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
}

const zustand = (P) => P.evaluate(() => ({
  feld: document.querySelector('.gantt-scale').value,
  dw: JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.dayWidth,
  svgB: Number(document.querySelector('.gantt-svg').getAttribute('width')),
  fenster: document.querySelector('.gantt-scroll').clientWidth
    - document.querySelector('.gantt-labels').getBoundingClientRect().width,
  kopf: [...document.querySelectorAll('.gantt-kopf .gantt-month')].map((t) => t.textContent),
}));

// ══ T1/T2: Jede Wahl gilt — kurzer und langer Plan ═══════════════════
for (const [name, rows, kuerzel] of [['kurzer Plan (4 Wochen)', KURZ, 'kurz'], ['langer Plan (2,5 Jahre)', LANG, 'lang']]) {
  console.log(`\n════ ${name} ════`);
  const { ctx, P } = await seite(rows);
  // Bewusst mehrfach hin und her — der Fehler zeigte sich auch beim Zurück
  for (const ziel of ['jahre', 'monate', 'wochen', 'tage', 'jahre', 'wochen', 'monate']) {
    await P.locator('.gantt-scale').selectOption(ziel);
    await P.waitForTimeout(700);
    const z = await zustand(P);
    pruefe(`„${ziel}" wird übernommen und bleibt stehen (${kuerzel})`,
      z.feld === ziel, `Feld zeigt „${z.feld}", dayWidth ${Math.round(z.dw * 100) / 100}`);
    const [von, bis] = BAND[ziel];
    pruefe(`  … mit einer Tagesbreite im Band ${von}–${bis}`,
      z.dw >= von && z.dw <= bis + 0.01, String(Math.round(z.dw * 100) / 100));
    pruefe('  … und einem gefüllten Fenster',
      z.svgB >= z.fenster - 4, `${Math.round(z.svgB)} gegen Fenster ${Math.round(z.fenster)}`);
  }
  // Kopfzeile passt zur Wahl
  await P.locator('.gantt-scale').selectOption('jahre');
  await P.waitForTimeout(700);
  const j = await zustand(P);
  pruefe(`Jahres-Wahl zeigt Jahreszahlen in der Kopfzeile (${kuerzel})`,
    j.kopf.length > 0 && j.kopf.every((k) => /^\d{4}$/.test(k)), JSON.stringify(j.kopf.slice(0, 4)));
  await P.locator('.gantt-scale').selectOption('tage');
  await P.waitForTimeout(700);
  const t = await zustand(P);
  pruefe(`Tages-Wahl zeigt Monatsnamen und Tageszahlen (${kuerzel})`,
    t.kopf.some((k) => /\d{2}$/.test(k) && /[A-Za-zÄÖÜäöü]/.test(k))
      && await P.evaluate(() => [...document.querySelectorAll('.gantt-kopf .gantt-day')].some((e) => /^\d{1,2}$/.test(e.textContent))),
    JSON.stringify(t.kopf.slice(0, 3)));
  await P.screenshot({ path: `${SD}/m281-${kuerzel}.png`, clip: await P.locator('.gantt-card').boundingBox() });
  await ctx.close();
}

// ══ T3: Die Heute-Fahne bleibt in der Kopfzeile ══════════════════════
console.log('\n════ T3: Heute-Fahne ════');
{
  const { ctx, P } = await seite(KURZ);
  const lage = await P.evaluate(() => {
    const pille = [...document.querySelectorAll('.gantt-kopf text')].find((t) => t.textContent === 'Heute');
    if (!pille) return null;
    const b = pille.getBoundingClientRect();
    const kopfUnten = document.querySelector('.gantt-svg').getBoundingClientRect().top + 34;
    const ersteZeile = [...document.querySelectorAll('.gantt-barlabel')].map((t) => t.textContent);
    return { unten: b.bottom, kopfUnten, imKopf: b.bottom <= kopfUnten + 1, namen: ersteZeile };
  });
  console.log('   ', JSON.stringify(lage));
  pruefe('T3a die Fahne sitzt IN der Kopfzeile', lage?.imKopf === true, JSON.stringify(lage));
  pruefe('T3b sie verdeckt keinen Vorgangsnamen mehr',
    (lage?.namen ?? []).includes('Analyse'), JSON.stringify(lage?.namen));
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
