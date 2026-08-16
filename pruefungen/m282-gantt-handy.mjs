/**
 * M282 — Der Zeitplan am Telefon.
 *
 * Nachgemessen an einem 390er-Schirm (das Hauptprüfgerät des Nutzers):
 *  · Die Werkzeugleiste ragte über die Karte hinaus — die beiden Lupen
 *    ließen sich gar nicht mehr treffen.
 *  · Die Knöpfe waren 19 Punkte hoch; das Projekt setzt seit M198 überall
 *    44 Punkte an, gerade für Menschen, die schlechter zielen können.
 *  · Die Namensspalte belegte 41 % der Breite und ließ 173 Punkte fürs
 *    Diagramm übrig — gut fünf Tage.
 *
 * Geprüft wird darum am Telefon, am Tablet und am Schreibtisch.
 */
// Läuft aus dem Repository: `node pruefungen/m282-gantt-handy.mjs`
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
const PORT = 4500;
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

const heute = new Date();
const tag = (v) => {
  const d = new Date(heute.getTime() + v * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ROWS = [
  { id: 'r1', name: 'Anforderungen sammeln', start: tag(-14), end: tag(-5), color: '#4f7cff', progress: 60 },
  { id: 'r2', name: 'Konzept schreiben', start: tag(-4), end: tag(11), color: '#3fa564', who: 'Anna Muster' },
  { id: 'r3', name: 'Abstimmung Amtsleitung', start: tag(14), end: tag(14), color: '#e07a3f' },
  { id: 'r4', name: 'Umsetzung', start: tag(16), end: tag(60), color: '#a05fd4' },
];

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

async function seite(vp, finger, kartenBreite = 340) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: finger, isMobile: finger });
  await ctx.addInitScript(({ rows, kartenBreite }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    const nodes = [{ id: 'g1', type: 'gantt', position: { x: 20, y: 90 }, width: kartenBreite, height: 300,
      data: { title: 'Projektplan des Regierungspräsidiums', rows, dayWidth: 24 } }];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: true, navLinks: false } }));
  }, { rows: ROWS, kartenBreite });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2200);
  return { ctx, P };
}

/** Maße der Werkzeugleiste und der Spalte — in LAYOUT-Punkten, wo nötig */
const messe = (P) => P.evaluate(() => {
  const karte = document.querySelector('.gantt-card').getBoundingClientRect();
  const werkzeuge = document.querySelector('.gantt-tools');
  const wb = werkzeuge.getBoundingClientRect();
  const roller = document.querySelector('.gantt-scroll').getBoundingClientRect();
  const spalte = document.querySelector('.gantt-labels').getBoundingClientRect();
  const knoepfe = [...werkzeuge.querySelectorAll('button, select')];
  // Der Board-Zoom skaliert die Karte — die Sollmaße gelten in Layout-Punkten
  const hoehen = knoepfe.map((e) => Math.round(parseFloat(getComputedStyle(e).minHeight) || e.getBoundingClientRect().height));
  const erster = knoepfe[0].getBoundingClientRect();
  return {
    ragtRaus: wb.right > karte.right + 1 || wb.left < karte.left - 1,
    ersterSichtbar: erster.left >= wb.left - 1 && erster.left < wb.right,
    kleinsteHoehe: Math.min(...hoehen),
    spalteAnteil: spalte.width / roller.width,
    spalteBreite: spalte.width,
    diagramm: Math.round(roller.width - spalte.width),
    titelDa: !!document.querySelector('.gantt-head > .kanban-title')
      && getComputedStyle(document.querySelector('.gantt-head > .kanban-title')).display !== 'none',
  };
});

// ══ T1: Telefon, Board-Ebene ═════════════════════════════════════════
console.log('════ T1: Telefon (390) auf dem Board ════');
{
  const { ctx, P } = await seite({ width: 390, height: 844 }, true);
  const m = await messe(P);
  console.log('   ', JSON.stringify(m));
  pruefe('T1a die Werkzeugleiste bleibt IN der Karte', !m.ragtRaus, JSON.stringify(m));
  pruefe('T1b sie beginnt vorn — „Vorgang hinzufügen" ist erreichbar', m.ersterSichtbar);
  pruefe('T1c die Knöpfe sind fingergerecht (≥ 40 Punkte)', m.kleinsteHoehe >= 40, String(m.kleinsteHoehe));
  pruefe('T1d die Namensspalte frisst höchstens 38 % der Breite',
    m.spalteAnteil <= 0.385, `${Math.round(m.spalteAnteil * 100)} %`);
  pruefe('T1e „Vorgang hinzufügen" wirkt auch wirklich', await P.evaluate(async () => {
    const vorher = document.querySelectorAll('.gantt-label').length;
    document.querySelector('.gantt-tools button')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelectorAll('.gantt-label').length === vorher + 1;
  }));
  await P.screenshot({ path: `${SD}/m282-handy-board.png` });
  await ctx.close();
}

// ══ T2: Telefon, Fokus ═══════════════════════════════════════════════
console.log('\n════ T2: Telefon im Fokus ════');
{
  const { ctx, P } = await seite({ width: 390, height: 844 }, true);
  const kasten = await P.locator('.gantt-card').boundingBox();
  await P.touchscreen.tap(kasten.x + kasten.width / 2, kasten.y + kasten.height - 12);
  await P.waitForTimeout(1400);
  pruefe('T2a ein Tipp öffnet den Zeitplan im Fokus',
    await P.evaluate(() => !!document.querySelector('.app.focus-mode')));
  const m = await messe(P);
  console.log('   ', JSON.stringify(m));
  pruefe('T2b auch dort bleibt die Leiste in der Karte', !m.ragtRaus, JSON.stringify(m));
  pruefe('T2c der Titel steht nur EINMAL (die Kopfzeile nennt ihn bereits)', m.titelDa === false);
  pruefe('T2d das Diagramm gewinnt Platz gegenüber der Board-Ebene',
    m.diagramm >= 220, String(m.diagramm));
  await P.screenshot({ path: `${SD}/m282-handy-fokus.png` });
  await ctx.close();
}

// ══ T3: Tablet ═══════════════════════════════════════════════════════
console.log('\n════ T3: Tablet (834) ════');
{
  const { ctx, P } = await seite({ width: 834, height: 1112 }, true);
  const m = await messe(P);
  console.log('   ', JSON.stringify(m));
  pruefe('T3a die Leiste bleibt in der Karte', !m.ragtRaus, JSON.stringify(m));
  pruefe('T3b fingergerechte Knöpfe', m.kleinsteHoehe >= 40, String(m.kleinsteHoehe));
  await ctx.close();
}

// ══ T4: Schreibtisch bleibt, wie er war ══════════════════════════════
console.log('\n════ T4: Schreibtisch (1400, Maus) ════');
{
  // Breite Karte: hier darf der Deckel für schmale Karten NICHT greifen
  const { ctx, P } = await seite({ width: 1400, height: 900 }, false, 900);
  const m = await messe(P);
  console.log('   ', JSON.stringify(m));
  pruefe('T4a nichts ragt hinaus', !m.ragtRaus);
  pruefe('T4b mit Maus bleiben die Knöpfe kompakt (keine 40-Punkte-Regel)',
    m.kleinsteHoehe < 40, String(m.kleinsteHoehe));
  pruefe('T4c der Kartentitel steht auf dem Board weiterhin da', m.titelDa === true);
  pruefe('T4d auf einer breiten Karte gilt die eingestellte Spaltenbreite ungedeckelt',
    Math.abs(m.spalteBreite - 128) < 2, `${Math.round(m.spalteBreite)} statt 128`);
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
