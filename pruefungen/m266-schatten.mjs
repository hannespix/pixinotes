/**
 * M266 — „schatten der linken bar komisch... auf board-ebene..."
 *
 * Gemessen war ein dunkler, RECHTECKIGER Streifen über die volle Höhe rechts
 * neben der linken Spalte: der Sticky-Schatten des aktiven Reiters (M261).
 * Er ist absolut positioniert und rechnet mit dem Reiter als Bezugsrahmen —
 * in der Spalte steht der aber auf `static` (M238), also hängte sich der
 * Verlauf an die ganze Leiste.
 *
 * Geprüft wird mit ECHTEN Bildpunkten: Wie hell ist der Grund direkt rechts
 * neben der Leiste — auf Höhe des aktiven Boards, auf Höhe eines anderen und
 * weit darunter, wo gar kein Reiter mehr ist?
 */
// Läuft aus dem Repository: `node pruefungen/m266-schatten.mjs`
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
const PORT = 4451;
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

async function seite(navLinks) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((nl) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: nl }));
    const boards = [
      { id: 'b0', name: 'Kochen/Einkaufen', edges: [], drawings: [], nodes: [] },
      { id: 'b1', name: 'Trading', edges: [], drawings: [], nodes: [] },
      { id: 'b2', name: 'Software Tools', edges: [], drawings: [], nodes: [] },
    ];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards,
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'Haushalt', boardIds: ['b0', 'b1', 'b2'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: nl } }));
  }, navLinks);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1700);
  return { ctx, P };
}

/** Helligkeitswerte einer waagerechten Linie im Bild (Rot-Kanal genügt) */
async function linie(P, x, y, breite = 16) {
  const png = await P.screenshot({ clip: { x, y, width: breite, height: 1 } });
  return P.evaluate(async (d) => {
    const i = new Image();
    i.src = `data:image/png;base64,${d}`;
    await i.decode();
    const c = document.createElement('canvas');
    c.width = i.width; c.height = 1;
    const g = c.getContext('2d');
    g.drawImage(i, 0, 0);
    const p = g.getImageData(0, 0, i.width, 1).data;
    const o = [];
    for (let x2 = 0; x2 < i.width; x2++) o.push(p[x2 * 4]);
    return o;
  }, png.toString('base64'));
}

// ══ T1: Linke Spalte — kein Streifen mehr neben der Leiste ═══════════
console.log('════ T1: linke Spalte (Standard) ════');
{
  const { ctx, P } = await seite(true);
  const o = await P.evaluate(() => {
    const t = document.querySelector('.tabs').getBoundingClientRect();
    const a = document.querySelector('.tab.active').getBoundingClientRect();
    const b = document.querySelectorAll('.tab')[1].getBoundingClientRect();
    return {
      rechts: Math.round(t.right), unten: Math.round(t.bottom),
      aktivY: Math.round(a.top + a.height / 2), andereY: Math.round(b.top + b.height / 2),
      spalte: getComputedStyle(document.querySelector('.tabs')).flexDirection,
    };
  });
  console.log('   ', JSON.stringify(o));
  pruefe('T1a die Navigation steht als Spalte', o.spalte === 'column');

  // Referenz: freier Grund weit rechts, auf gleicher Höhe
  const frei = await linie(P, o.rechts + 260, o.aktivY, 8);
  const grund = Math.round(frei.reduce((s, v) => s + v, 0) / frei.length);

  const aktiv = await linie(P, o.rechts + 2, o.aktivY);
  const andere = await linie(P, o.rechts + 2, o.andereY);
  const drunter = await linie(P, o.rechts + 2, o.unten + 40);
  console.log('    Grund ≈', grund);
  console.log('    aktive Zeile :', aktiv.join(' '));
  console.log('    andere Zeile :', andere.join(' '));
  console.log('    unter Leiste :', drunter.join(' '));

  /* Der weiche Schatten der Leiste (0 2px 10px, Alpha 0,1) darf bleiben — er
     macht höchstens rund 24 Stufen aus und läuft nach 10 Punkten aus. Der
     Fehler war ein Streifen, der die volle Höhe hinunterlief UND deutlich
     dunkler war. Geprüft wird deshalb: Bei einer NICHT aktiven Zeile darf es
     rechts neben der Leiste keinen dunklen Verlauf mehr geben. */
  const dunkelste = (a) => Math.min(...a.slice(1, 10));
  pruefe('T1b neben einer normalen Zeile bleibt es hell (nur weicher Schatten)',
    grund - dunkelste(andere) < 22, `${dunkelste(andere)} gegen Grund ${grund}`);
  pruefe('T1c neben der AKTIVEN Zeile ebenso (dort saß der Streifen)',
    grund - dunkelste(aktiv) < 22, `${dunkelste(aktiv)} gegen Grund ${grund}`);
  pruefe('T1d beide Höhen sind gleich hell — kein Streifen an einer Zeile',
    Math.abs(dunkelste(aktiv) - dunkelste(andere)) <= 6,
    `${dunkelste(aktiv)} vs ${dunkelste(andere)}`);
  pruefe('T1e unterhalb der Leiste ist der Grund unberührt',
    grund - dunkelste(drunter) < 12, `${dunkelste(drunter)} gegen ${grund}`);

  // Und: der Verlauf ist in dieser Anordnung wirklich abgeschaltet
  const pseudo = await P.evaluate(() =>
    getComputedStyle(document.querySelector('.tab.active'), '::after').content);
  pruefe('T1f der Sticky-Verlauf ist in der Spalte abgeschaltet', pseudo === 'none', pseudo);
  await ctx.close();
}

// ══ T2: Reihe oben — der Sticky-Schatten bleibt (M261) ═══════════════
console.log('\n════ T2: Kopfleisten-Anordnung behält ihren Schatten ════');
{
  const { ctx, P } = await seite(false);
  const r = await P.evaluate(() => {
    const t = document.querySelector('.tabs');
    const a = document.querySelector('.tab.active');
    return {
      reihe: getComputedStyle(t).flexDirection,
      klebt: getComputedStyle(a).position,
      verlauf: getComputedStyle(a, '::after').content,
    };
  });
  console.log('   ', JSON.stringify(r));
  pruefe('T2a oben ist es eine Reihe', r.reihe === 'row');
  pruefe('T2b der aktive Reiter klebt weiterhin', r.klebt === 'sticky');
  pruefe('T2c und behält seinen Verlauf (M261)', r.verlauf !== 'none', r.verlauf);
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
