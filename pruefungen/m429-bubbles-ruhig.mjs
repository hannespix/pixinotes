/**
 * M429 — Ideabubbles: ruhige Gruppen-Namen, Gruppen kommen zur Ruhe.
 *
 * Gemeldet: „Überschriften bei Ideabubbles springen manchmal schnell hin und her und beginnen in instabilen Positionen
 * manchmal zu flattern. Wirkt unsauber." — und: „Die Cluster stoßen sich auch in Ruheposition so stark voneinander ab,
 * dass es nie zur Ruhe kommt … ein stetiges Wabern. Bitte beruhigen."
 *
 *   A  Name gleitet statt zu springen: auch wenn eine Idee aus der Gruppe gezogen wird, nie mehr als ein paar Punkte je Bild.
 *   B  Auf der Bühne der Präsentation (groß) steht nach dem Einschwingen alles still — vorher kreisten die Gruppen endlos.
 *   C  Auf dem Board ebenso; nach einem Anstoß (Idee ziehen) wieder Ruhe.
 *   D  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m422-tropfen-am-rand.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4766;
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
const t = Date.now();
const ideen = {};
const liste = [['Deine Mudder hat auch ne Blase', 'g1'], ['Norbert', 'g1'], ['Ich mag Kekse', 'g1'], ['Vaterlandsliebeleidampfhochhausmuseum', 'g1'],
  ['Chuck Norris war hier', 'g2'], ['noi', 'g2'], ['Heeeey Ihringer :-)', 'g2'],
  ['Heyyy zurück', 'g3'], ['Kuchen', 'g3'], ['Apfel', 'g3'], ['Waterboarding', 'g3'], ['huch', 'g3'],
  ['blaaaaa', 'g4'], ['Moscow mule!', 'g4'], ['Theaterstück über Menopause', 'g4'], ['Blubb', 'g4']];
liste.forEach(([x, g], i) => { ideen['i' + i] = { text: x, von: 'g:' + (i % 5), name: 'Anna', t, g }; });
const gruppen = { g1: { name: 'Spielfilmvertreter', farbe: 0, t }, g2: { name: 'Humor', farbe: 1, t }, g3: { name: 'Begrüßungen', farbe: 2, t }, g4: { name: 'Alltagsaufnahmen', farbe: 3, t } };
const karte = (w, h) => ({ id: 'b1', type: 'bubbles', position: { x: 0, y: 0 }, width: w, height: h, data: { title: 'Ideen', frage: 'Wie könnten wir …?', ideen, stimmen: {}, gruppen, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } });

async function auf(w, h, geraet = devices['Pixel 7'], dunkel = true) {
  const ctx = await browser.newContext({ ...geraet, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { boards: [{ id: 'x', name: 'Colab Demo', edges: [], drawings: [], nodes: [karte(w, h)] }], spaces: [{ id: 's1', name: 'Misc', projects: [{ id: 'p1', name: 'Misc', boardIds: ['x'] }] }], activeId: 'x', view: 'board' });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(globalThis.WARTE ?? 6500);
  return { ctx, P };
}


const spurNamen = async (P, ms) => P.evaluate((dauer) => new Promise((ok) => {
  const spur = {}; const t0 = performance.now();
  const lauf = () => {
    const jetzt = performance.now();
    for (const n of document.querySelectorAll('.bub-ring-name')) {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(n.style.transform); if (!m) continue;
      (spur[n.dataset.gruppe] ??= []).push([+m[1], +m[2], jetzt]);
    }
    if (jetzt - t0 < dauer) requestAnimationFrame(lauf); else ok(spur);
  };
  requestAnimationFrame(lauf);
}), ms);
// M448: „je Bild" heißt je 60-Hz-Bild. Unter Last (mehrere Prüfungen und Agenten teilen sich die CPU) fallen
// Bilder aus, die Gruppen-Physik rechnet mit der verstrichenen Zeit weiter – zwischen zwei gezeichneten Bildern
// liegt dann der Weg von zwei oder drei. Der Sprung wird deshalb auf die Zahl der verstrichenen 16,7-ms-Bilder
// umgelegt; ein echter Sprung (Name wechselt den Platz in einem Bild) bleibt so groß wie vorher.
const groessterSprung = (spur) => Math.max(0, ...Object.values(spur).map((p) => { let m = 0; for (let i = 1; i < p.length; i++) m = Math.max(m, Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) / Math.max(1, Math.round((p[i][2] - p[i - 1][2]) / (1000 / 60)))); return m; }));
const bewegung = (P, ms, sel = '.bub-blase') => P.evaluate(([dauer, s]) => new Promise((ok) => {
  const lage = () => [...document.querySelectorAll(s)].map((b) => b.style.transform);
  let vor = lage(); let bewegt = 0; const t0 = performance.now();
  const lauf = () => { const jetzt = lage(); if (jetzt.some((x, i) => x !== vor[i])) bewegt++; vor = jetzt; if (performance.now() - t0 < dauer) requestAnimationFrame(lauf); else ok(bewegt); };
  requestAnimationFrame(lauf);
}), [ms, sel]);

console.log('\n════ A/C: Board ════');
{
  globalThis.WARTE = 200;
  const { ctx, P } = await auf(640, 440, { viewport: { width: 1440, height: 900 } });
  const frueh = await spurNamen(P, 5000);
  pruefe('A1 beim Einschwingen: kein Name springt (≤ 6 Punkte je Bild)', groessterSprung(frueh) <= 6, groessterSprung(frueh).toFixed(1));
  await P.waitForTimeout(2500);
  pruefe('C1 nach dem Einschwingen: Stillstand (Blasen und Namen)', (await bewegung(P, 2500)) === 0 && (await bewegung(P, 1500, '.bub-ring-name')) === 0);
  const b = await P.locator('.bub-blase').nth(2).boundingBox();
  const zugSpur = spurNamen(P, 4000);
  await P.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await P.mouse.down(); await P.mouse.move(b.x + 70, b.y + 50, { steps: 8 }); await P.mouse.up();
  const s = await zugSpur;
  pruefe('A2 Idee aus der Gruppe ziehen: Name gleitet (≤ 6 Punkte je Bild)', groessterSprung(s) <= 6, groessterSprung(s).toFixed(1));
  await P.waitForTimeout(5000);
  pruefe('C2 nach dem Anstoß wieder Stillstand', (await bewegung(P, 2000)) === 0);
  await ctx.close();
}
console.log('\n════ B: Präsentation ════');
{
  globalThis.WARTE = 1200;
  const { ctx, P } = await auf(640, 440, { viewport: { width: 1440, height: 900 } });
  await P.mouse.click(1300, 860); await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter .bub-buehne');
  await P.waitForTimeout(7000);
  const n = await bewegung(P, 3000);
  pruefe('B1 große Bühne: nach dem Einschwingen steht alles', n === 0, n);
  const lagen = await P.evaluate(() => { const r = [...document.querySelectorAll('.presenter .bub-blase')].map((b) => b.getBoundingClientRect()); let ueber = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i], c = r[j]; const d = Math.hypot(a.x + a.width / 2 - c.x - c.width / 2, a.y + a.height / 2 - c.y - c.height / 2); if (d < (a.width + c.width) / 2 - 3) ueber++; } return ueber; });
  pruefe('B2 und ohne Überlappung', lagen === 0, lagen);
  await P.screenshot({ path: `${SD}/m429-praesentation.png` });
  await ctx.close();
}
console.log('\n════ D ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('D1 Hilfe nennt M429', /M429/.test(hilfe));
  pruefe('D2 Umbau-Liste nennt M429', /M429/.test(umbau));
  pruefe('D3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}
await browser.close(); app.close();
console.log(`\nM429: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
