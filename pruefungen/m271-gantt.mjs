/**
 * M271 — „die gantt ansicht ist noch nicht wirklich benutzbar! bitte verbessern"
 *
 * Der Audit fand vier Kernprobleme; jede Behebung wird einzeln nachgewiesen:
 *  1. Termine nur per Ziehen änderbar → jetzt Datumsfelder (Start verschiebt,
 *     Ende verlängert, nie vor Start)
 *  2. Monatsname scrollte aus dem Bild („26" statt „Aug. 26") → klebt jetzt
 *  3. kein „alles auf einen Blick" → Einpassen-Knopf
 *  4. Namensspalte fest 128 px → am Griff verstellbar
 */
// Läuft aus dem Repository: `node pruefungen/m271-gantt.mjs`
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
const PORT = 4494;
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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addInitScript(() => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  const rows = [
    { id: 'r1', name: 'Anforderungen sammeln', start: '2026-08-03', end: '2026-08-14', color: '#4f7cff', progress: 100 },
    { id: 'r2', name: 'Konzept schreiben', start: '2026-08-17', end: '2026-08-28', color: '#3fa564', dep: 'r1' },
    { id: 'r3', name: 'Umsetzung Phase 1', start: '2026-09-08', end: '2026-10-02', color: '#e07a3f', dep: 'r2' },
    { id: 'r4', name: 'Go-Live', start: '2026-11-09', end: '2026-11-09', color: '#2b2a27', dep: 'r3' },
  ];
  const nodes = [{ id: 'g1', type: 'gantt', position: { x: 30, y: 30 }, width: 980, height: 420,
    data: { title: 'Projekt', rows, dayWidth: 24 } }];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
});
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);

const zeile = (rid) => P.evaluate((r) => {
  const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
  return s.boards[0].nodes[0].data.rows.find((x) => x.id === r);
}, rid);

// ══ T1: Termine als Datum eingeben ════════════════════════════════════
console.log('════ T1: Datumsfelder ════');
await P.evaluate(() => {
  const bar = [...document.querySelectorAll('.gantt-svg rect')].find((r) => r.getAttribute('data-row') === 'r2');
  bar?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await P.waitForTimeout(600);
const felder = await P.evaluate(() => {
  const f = [...document.querySelectorAll('.gantt-rowbar input[type="date"]')];
  return f.map((x) => x.value);
});
console.log('    Datumsfelder:', JSON.stringify(felder));
pruefe('T1a die Bearbeitungsleiste zeigt Start und Ende als Datum',
  JSON.stringify(felder) === JSON.stringify(['2026-08-17', '2026-08-28']), JSON.stringify(felder));
pruefe('T1b die Dauer steht dabei', await P.evaluate(() =>
  document.querySelector('.gantt-dauer')?.textContent.trim()) === '12 Tg.',
  await P.evaluate(() => document.querySelector('.gantt-dauer')?.textContent));

// Start ändern → Vorgang VERSCHIEBT sich (Dauer bleibt)
await P.locator('.gantt-rowbar input[type="date"]').nth(0).fill('2026-08-24');
await P.waitForTimeout(500);
const r2a = await zeile('r2');
console.log('    nach Start-Änderung:', JSON.stringify(r2a));
pruefe('T1c Start-Änderung verschiebt den Vorgang', r2a.start === '2026-08-24' && r2a.end === '2026-09-04',
  JSON.stringify(r2a));

// Ende ändern → verlängert
await P.locator('.gantt-rowbar input[type="date"]').nth(1).fill('2026-09-11');
await P.waitForTimeout(500);
const r2b = await zeile('r2');
pruefe('T1d Ende-Änderung verlängert', r2b.start === '2026-08-24' && r2b.end === '2026-09-11', JSON.stringify(r2b));

// Ende vor Start → wird abgefangen
await P.locator('.gantt-rowbar input[type="date"]').nth(1).fill('2026-08-01');
await P.waitForTimeout(500);
const r2c = await zeile('r2');
pruefe('T1e ein Ende vor dem Start wird abgefangen', r2c.end === r2c.start, JSON.stringify(r2c));

// ══ T2: Der Monatsname bleibt im Bild ═════════════════════════════════
console.log('\n════ T2: klebende Monatsnamen ════');
{
  const vorher = await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    el.scrollLeft = 0;
    return [...document.querySelectorAll('.gantt-month')].map((t) => ({ t: t.textContent, x: Number(t.getAttribute('x')) }));
  });
  await P.waitForTimeout(400);
  // Weit nach rechts scrollen — mitten in einen Monat hinein
  const nachher = await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    el.scrollLeft = 900;
    return el.scrollLeft;
  });
  await P.waitForTimeout(600);
  const monate = await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    const s = el.scrollLeft;
    return {
      s,
      texte: [...document.querySelectorAll('.gantt-month')].map((t) => ({ t: t.textContent, x: Number(t.getAttribute('x')) })),
    };
  });
  console.log('    scroll:', nachher, '→', JSON.stringify(monate.texte.slice(0, 3)));
  // Der Monat, in dem wir stehen, muss seinen Namen AM SICHTBAREN RAND haben
  const sichtbar = monate.texte.filter((m) => m.x >= monate.s - 2);
  pruefe('T2a nach dem Scrollen steht ein Monatsname direkt am sichtbaren Rand',
    sichtbar.length > 0 && Math.abs(sichtbar[0].x - (monate.s + 4)) < 40,
    JSON.stringify({ s: monate.s, erster: sichtbar[0] }));
  pruefe('T2b vorher (ohne Scroll) sitzt er am Monatsanfang',
    vorher.length > 0 && vorher[0].x < 40, JSON.stringify(vorher[0]));
}

// ══ T3: Einpassen ═════════════════════════════════════════════════════
console.log('\n════ T3: Alles einpassen ════');
{
  await P.evaluate(() => {
    [...document.querySelectorAll('.gantt-tools button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Alles einpassen'))?.click();
  });
  await P.waitForTimeout(700);
  const mass = await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll');
    const svg = document.querySelector('.gantt-svg');
    return { sichtbar: el.clientWidth, breit: el.scrollWidth, svg: Number(svg.getAttribute('width')), scroll: el.scrollLeft };
  });
  console.log('   ', JSON.stringify(mass));
  pruefe('T3a der Einpassen-Knopf existiert und wirkt: kein Quer-Scrollen mehr',
    mass.breit <= mass.sichtbar + 4, JSON.stringify(mass));
  pruefe('T3b die Ansicht beginnt vorn', mass.scroll === 0, String(mass.scroll));
  // Alle Balken liegen im Sichtfenster
  const alleDa = await P.evaluate(() => {
    const el = document.querySelector('.gantt-scroll').getBoundingClientRect();
    return [...document.querySelectorAll('.gantt-svg rect[data-row]')].every((r) => {
      const b = r.getBoundingClientRect();
      return b.left >= el.left - 2 && b.right <= el.right + 2;
    });
  });
  pruefe('T3c alle Balken sind gleichzeitig zu sehen', alleDa);
}

// ══ T4: Namensspalte verstellbar ══════════════════════════════════════
console.log('\n════ T4: Namensspalte ════');
{
  const griff = await P.evaluate(() => {
    const g = document.querySelector('.gantt-spaltengriff');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, breite: document.querySelector('.gantt-labels').getBoundingClientRect().width };
  });
  pruefe('T4a es gibt einen Griff am Spaltenrand', !!griff);
  if (griff) {
    console.log('    Spaltenbreite vorher:', Math.round(griff.breite));
    await P.mouse.move(griff.x, griff.y);
    await P.mouse.down();
    for (let i = 1; i <= 8; i++) { await P.mouse.move(griff.x + i * 12, griff.y); await P.waitForTimeout(30); }
    await P.mouse.up();
    await P.waitForTimeout(600);
    const nachher = await P.evaluate(() => document.querySelector('.gantt-labels').getBoundingClientRect().width);
    console.log('    Spaltenbreite nachher:', Math.round(nachher));
    pruefe('T4b Ziehen verbreitert die Spalte um den gezogenen Weg',
      Math.abs(nachher - griff.breite - 96) < 18, `${Math.round(griff.breite)} → ${Math.round(nachher)}`);
    pruefe('T4c die Breite ist an der Karte gespeichert', await P.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
      const w = s.boards[0].nodes[0].data.labelW;
      return typeof w === 'number' && w > 190;
    }));
    const voll = await P.evaluate(() => {
      const z = document.querySelector('.gantt-label');
      return { wert: z.value, schnitt: z.scrollWidth <= z.clientWidth + 1 };
    });
    pruefe('T4d „Anforderungen sammeln" steht jetzt ungekürzt da', voll.schnitt, JSON.stringify(voll));
  }
}

// ══ T5: Ziehen am Balken geht weiterhin (Kernfunktion unversehrt) ═════
console.log('\n════ T5: Balken ziehen ════');
{
  // Auf Tages-Skala zurück, damit ein Tag messbar breit ist
  await P.evaluate(() => {
    const sel = document.querySelector('.gantt-scale');
    sel.value = 'tage';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await P.waitForTimeout(700);
  const vor = await zeile('r1');
  const lage = await P.evaluate(() => {
    const r = [...document.querySelectorAll('.gantt-svg rect[data-row]')].find((x) => x.getAttribute('data-row') === 'r1');
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, dw: b.width };
  });
  const proTag = await P.evaluate(() => {
    const svg = document.querySelector('.gantt-svg');
    const breite = svg.getBoundingClientRect().width;
    return (breite / Number(svg.getAttribute('width'))) * 24;
  });
  await P.mouse.move(lage.x, lage.y);
  await P.mouse.down();
  for (let i = 1; i <= 6; i++) { await P.mouse.move(lage.x + (proTag * 3 * i) / 6, lage.y); await P.waitForTimeout(30); }
  await P.mouse.up();
  await P.waitForTimeout(600);
  const nach = await zeile('r1');
  console.log(`    ${vor.start} → ${nach.start}`);
  pruefe('T5a der Balken lässt sich weiterhin um Tage verschieben',
    nach.start === '2026-08-06' && nach.end === '2026-08-17', JSON.stringify(nach));
}

await P.screenshot({ path: `${SD}/m271-fertig.png`, clip: { x: 0, y: 0, width: 1200, height: 640 } });

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
