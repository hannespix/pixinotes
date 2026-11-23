/**
 * M490 — Einstellungen „Bedienung“ aufgeräumt: Einrasten wählbar, „Lebendige Fläche“ abgelöst.
 *
 *   A  Standard „Fanglinien“: eine nahe an die Oberkante einer anderen Karte gezogene Karte liegt bündig.
 *   B  Einstellungen → Darstellung: Segment „Einrasten: Aus · Fanglinien · Raster“, „Fanglinien“ an;
 *      „Lebendige Fläche“ ist weg, „Konfetti beim Erledigen“ steht als eigener Schalter da.
 *   C  „Aus“: dieselbe Bewegung rastet nicht ein, es erscheinen keine Fanglinien.
 *   D  „Raster“: die abgelegte Karte liegt auf Vielfachen von 20.
 *   E  Alt+R schaltet zwischen Raster und dem vorherigen Modus, die Einstellung zeigt es.
 *   F  Neuladen: der gewählte Modus bleibt.
 *   G  Migration: wer gridSnap an hatte, steht auf „Raster“; Alt+R führt zurück zu „Fanglinien“.
 *   H  Konfetti-Schalter wirkt: letzter Haken einer Checkliste wirft Konfetti nur, wenn er an ist.
 *   I  Klick-Zoom ist weg: ein alter Stand mit Klick-Zoom an bewegt die Ansicht beim Klick nicht mehr.
 */
// Läuft aus dem Repository: `node pruefungen/m490-fang-optionen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const SD = process.env.SD ?? path.join(process.env.TMPDIR ?? '/tmp', 'pixinotes-shots');
mkdirSync(SD, { recursive: true });
const PORT = 5490;
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

const stand = (extra = {}) => ({
  boards: [{ id: 'b1', name: 'Fang', comments: [], edges: [], drawings: [], nodes: [
    { id: 'n1', type: 'note', width: 300, height: 140, autoFit: false, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ id: 'a', type: 'paragraph', content: 'Erste' }] } },
    { id: 'n2', type: 'note', width: 300, height: 140, autoFit: false, position: { x: 520, y: 37 }, data: { color: 'sky', blocks: [{ id: 'b', type: 'paragraph', content: 'Zweite' }] } },
    { id: 'n3', type: 'note', width: 300, height: 160, autoFit: false, position: { x: 13, y: 420 }, data: { color: 'mint', blocks: [{ id: 'h1', type: 'checkListItem', props: { checked: false }, content: 'Letzter Haken' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', ...extra,
});
async function seite({ vorlieben = {}, extra = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st, v }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...v }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand(extra), v: vorlieben });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  return { ctx, P };
}
const zoom = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const knoten = async (P) => { await P.waitForTimeout(1300); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes); };
const lage = async (P, id) => (await knoten(P)).find((n) => n.id === id).position;
const griff = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const leer = (P) => P.mouse.click(1380, 860).then(() => P.waitForTimeout(200));
const vorlieben = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen') ?? '{}'));

/** n2 liegt 37 unter der Oberkante von n1 – um 36 nach oben ziehen (die Ziehschwelle schluckt ein paar Punkte, wie in m344). Liefert Linien unterwegs + Lage danach. */
async function ziehN2(P, dy = -36, dx = 2) {
  await leer(P);
  const z = await zoom(P);
  const g = await griff(P, 'n2');
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + dx / 2, g[1] + (dy / 3) * z, { steps: 3 });
  await P.mouse.move(g[0] + dx, g[1] + dy * z, { steps: 5 }); await P.waitForTimeout(150);
  const linien = await P.evaluate(() => document.querySelectorAll('.fanglinie').length);
  await P.mouse.up();
  return { linien, p: await lage(P, 'n2') };
}
const oeffne = async (P) => {
  await P.locator('[data-taste="einstellungen"]').click(); await P.waitForSelector('.modal-tabs');
  await P.locator('.modal-tabs button', { hasText: 'Darstellung' }).click(); await P.waitForTimeout(300);
};
const schliesse = async (P) => { await P.keyboard.press('Escape'); await P.waitForTimeout(400); };
const modus = (P) => P.evaluate(() => document.querySelector('[data-taste="einrasten"] button.on')?.dataset.einrasten ?? null);
const waehle = async (P, v) => { await P.locator(`[data-taste="einrasten"] [data-einrasten="${v}"]`).click(); await P.waitForTimeout(300); };
const zeilen = (P) => P.evaluate(() => [...document.querySelectorAll('.modal-section .modal-row > span:first-child')].map((s) => s.textContent.trim()));
const amRaster = (p) => p.x % 20 === 0 && p.y % 20 === 0;

console.log('\n════ A: Standard „Fanglinien" ════');
{
  const { ctx, P } = await seite();
  const r = await ziehN2(P);
  pruefe('A1 ohne Wahl rastet die Karte an der Oberkante der Nachbarkarte ein (y = 0)', r.p.y === 0, JSON.stringify(r));
  pruefe('A2 während des Ziehens zeigt sich eine Fanglinie', r.linien > 0, String(r.linien));

  console.log('\n════ B: Einstellungen → Darstellung ════');
  await oeffne(P);
  const z = await zeilen(P);
  pruefe('B1 „Einrasten" steht im Abschnitt Bedienung, Fanglinien sind gewählt', z.includes('Einrasten') && (await modus(P)) === 'fang', JSON.stringify({ z, m: await modus(P) }));
  pruefe('B2 „Lebendige Fläche" ist weg, „Konfetti beim Erledigen" steht als eigener Schalter da',
    !z.includes('Lebendige Fläche') && (await P.locator('.modal-row-check', { hasText: 'Konfetti beim Erledigen' }).locator('input[type=checkbox]').count()) === 1, JSON.stringify(z));
  pruefe('B3 die drei Wahlmöglichkeiten heißen Aus · Fanglinien · Raster',
    JSON.stringify(await P.locator('[data-taste="einrasten"] button').allTextContents()) === JSON.stringify(['Aus', 'Fanglinien', 'Raster']));
  await P.locator('.modal').screenshot({ path: `${SD}/m490-b-einstellungen.png` });

  await schliesse(P);
  await ctx.close();
}

console.log('\n════ C: „Aus" ════');
{
  // frische Seite: n2 liegt wieder 37 unter der Oberkante, gezogen wird dieselbe Bewegung wie in A
  const { ctx, P } = await seite();
  await oeffne(P);
  await waehle(P, 'aus');
  pruefe('C1 „Aus" ist gewählt und als Vorliebe gespeichert', (await modus(P)) === 'aus' && (await vorlieben(P)).fangLinien === false && (await vorlieben(P)).gridSnap === false);
  await schliesse(P);
  const aus = await ziehN2(P);
  pruefe('C2 dieselbe Bewegung rastet nicht ein – die Karte bleibt wenige Punkte neben der Kante', aus.p.y > 1 && aus.p.y < 9, JSON.stringify(aus.p));
  pruefe('C3 keine Fanglinie beim Ziehen', aus.linien === 0, String(aus.linien));

  console.log('\n════ D: „Raster" ════');
  await oeffne(P);
  await waehle(P, 'raster');
  pruefe('D1 „Raster" gewählt, gridSnap gespeichert', (await modus(P)) === 'raster' && (await vorlieben(P)).gridSnap === true);
  await schliesse(P);
  const ra = await ziehN2(P, 47, 13);
  pruefe('D2 die abgelegte Karte liegt auf Vielfachen von 20', amRaster(ra.p), JSON.stringify(ra.p));
  pruefe('D3 keine Fanglinien im Raster-Modus', ra.linien === 0, String(ra.linien));

  console.log('\n════ E: Alt+R ════');
  await leer(P);
  await P.keyboard.press('Alt+r'); await P.waitForTimeout(300);
  await oeffne(P);
  pruefe('E1 Alt+R aus dem Raster führt zum vorherigen Modus „Aus" zurück – die Einstellung zeigt es', (await modus(P)) === 'aus', String(await modus(P)));
  await schliesse(P);
  await P.keyboard.press('Alt+r'); await P.waitForTimeout(300);
  await oeffne(P);
  pruefe('E2 Alt+R noch einmal: wieder „Raster"', (await modus(P)) === 'raster', String(await modus(P)));
  await waehle(P, 'fang');
  await schliesse(P);

  console.log('\n════ F: Neuladen ════');
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  await oeffne(P);
  pruefe('F1 nach dem Neuladen steht weiter „Fanglinien"', (await modus(P)) === 'fang', String(await modus(P)));
  await waehle(P, 'aus');
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  await oeffne(P);
  pruefe('F2 … und „Aus" übersteht das Neuladen ebenso', (await modus(P)) === 'aus', String(await modus(P)));
  await schliesse(P);
  await ctx.close();
}

console.log('\n════ G: Migration gridSnap → Raster ════');
{
  const { ctx, P } = await seite({ vorlieben: { gridSnap: true } });
  await oeffne(P);
  pruefe('G1 ein Stand mit Raster-Fang an zeigt „Raster"', (await modus(P)) === 'raster', String(await modus(P)));
  await schliesse(P);
  const ra = await ziehN2(P, 47, 13);
  pruefe('G2 … und legt am Raster ab', amRaster(ra.p), JSON.stringify(ra.p));
  await leer(P);
  await P.keyboard.press('Alt+r'); await P.waitForTimeout(300);
  await oeffne(P);
  pruefe('G3 Alt+R führt zu „Fanglinien" (der Standard davor)', (await modus(P)) === 'fang', String(await modus(P)));
  await schliesse(P);
  await ctx.close();
}

console.log('\n════ H: Konfetti beim Erledigen ════');
async function haken(P) {
  await P.evaluate(() => {
    window.__konfetti = 0;
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'CANVAS') window.__konfetti += 1; })
      .observe(document.body, { childList: true });
  });
  const box = await P.locator('.react-flow__node[data-id="n3"] input[type=checkbox]').first().boundingBox();
  await P.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await P.waitForTimeout(1200);
  const gesetzt = (await knoten(P)).find((k) => k.id === 'n3').data.blocks[0].props?.checked;
  return { gesetzt, konfetti: await P.evaluate(() => window.__konfetti) };
}
{
  const { ctx, P } = await seite();
  const r = await haken(P);
  pruefe('H1 Standard (aus): der letzte Haken wirft kein Konfetti', r.gesetzt === true && r.konfetti === 0, JSON.stringify(r));
  await ctx.close();
}
{
  const { ctx, P } = await seite();
  await oeffne(P);
  await P.locator('.modal-row-check', { hasText: 'Konfetti beim Erledigen' }).locator('input[type=checkbox]').check();
  await P.waitForTimeout(300);
  pruefe('H2 der Schalter speichert konfetti = an', (await vorlieben(P)).konfetti === true);
  await schliesse(P);
  const r = await haken(P);
  pruefe('H3 eingeschaltet wirft der letzte Haken Konfetti', r.gesetzt === true && r.konfetti > 0, JSON.stringify(r));
  await ctx.close();
}

console.log('\n════ I: Klick-Zoom gibt es nicht mehr ════');
{
  // Alter Stand: Klick-Zoom an, Fokus aus – vorher flog die Ansicht zur angeklickten Karte
  const { ctx, P } = await seite({ vorlieben: { clickZoom: true, cardFocus: false }, extra: { clickZoom: true, cardFocus: false } });
  // weit herauszoomen: früher flog der Klick-Zoom unter 65 % Zoom zur Karte
  await leer(P);
  for (let i = 0; i < 4; i += 1) { await P.keyboard.press('-'); await P.waitForTimeout(250); }
  await P.waitForTimeout(600);
  const vorher = await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  const b = await P.locator('.react-flow__node[data-id="n2"] .card-grip').boundingBox();
  await P.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await P.waitForTimeout(900);
  const nachher = await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
  pruefe('I1 ein Klick auf eine Karte bewegt die Ansicht nicht', vorher === nachher, JSON.stringify({ vorher, nachher }));
  pruefe('I2 … auch weit herausgezoomt (unter 65 %)', (await zoom(P)) < 0.65, String(await zoom(P)));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} ok, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
