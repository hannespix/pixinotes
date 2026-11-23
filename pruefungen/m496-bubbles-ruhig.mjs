/**
 * M496 — Ideabubbles ruhig auch auf langsamen Geräten.
 *
 * Befund (M484): m429 A1 („kein Gruppenname springt") war unter CPU-Mangel nur 7 von 10 grün. Ursache in der App:
 * Der Name glitt je BILD ein gutes Fünftel zu seinem Ziel, ohne Obergrenze — beim Einschwingen lief das Ziel den
 * hereinfliegenden Ideen nach, der Name sprang bis 25 Punkte je Bild (schon ohne Last; die Reihe sah es nur nicht,
 * weil ihre Messung erst nach dem Einschwingen begann). Die Physik rechnete einen Schritt je Bild: Bei 30 Bildern je
 * Sekunde liefen die Blasen halb so schnell, das Abklingen aber nach der Uhr.
 *
 * Gemessen wird unter CPU-Drosselung 1×, 4× und 6× (CDP `Emulation.setCPUThrottlingRate`), und zwar nach der Zeit der
 * Bilder: Ein MutationObserver schreibt jede neue Lage eines Namens bzw. einer Blase mit `document.timeline.currentTime`
 * mit (das ist der Zeitstempel des Bilds, den auch die App bekommt; der Observer läuft direkt nach ihrem Rückruf im
 * selben Bild), ein rAF-Rückruf die Zeitstempel aller Bilder. Ein Weg zählt so über genau das Bild-Intervall, in dem
 * ihn die App gerechnet hat — nicht über das Intervall des nächsten Bilds.
 *
 *   A  Namen: je 16,7 ms höchstens 6 Punkte (fällt ein Bild aus, anteilig mehr), auf jeder Stufe; gleicher Weg wie 1×.
 *   B  Blasen: gleicher Fortschritt je (Bild-)Zeit wie 1× und dieselbe Ruhelage; beides steht nach wenigen Sekunden.
 *   C  Idee aus der Gruppe ziehen bei 6×: der Name gleitet (höchstens 6 Punkte je 16,7 ms).
 *   D  Hilfe, Meilenstein-Datei, keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m496-bubbles-ruhig.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5496;
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

// dieselbe Bühne wie m429 (vier Gruppen, sechzehn Ideen)
const t = Date.now();
const ideen = {};
const liste = [['Deine Mudder hat auch ne Blase', 'g1'], ['Norbert', 'g1'], ['Ich mag Kekse', 'g1'], ['Vaterlandsliebeleidampfhochhausmuseum', 'g1'],
  ['Chuck Norris war hier', 'g2'], ['noi', 'g2'], ['Heeeey Ihringer :-)', 'g2'],
  ['Heyyy zurück', 'g3'], ['Kuchen', 'g3'], ['Apfel', 'g3'], ['Waterboarding', 'g3'], ['huch', 'g3'],
  ['blaaaaa', 'g4'], ['Moscow mule!', 'g4'], ['Theaterstück über Menopause', 'g4'], ['Blubb', 'g4']];
liste.forEach(([x, g], i) => { ideen['i' + i] = { text: x, von: 'g:' + (i % 5), name: 'Anna', t, g }; });
const gruppen = { g1: { name: 'Spielfilmvertreter', farbe: 0, t }, g2: { name: 'Humor', farbe: 1, t }, g3: { name: 'Begrüßungen', farbe: 2, t }, g4: { name: 'Alltagsaufnahmen', farbe: 3, t } };
const karte = { id: 'b1', type: 'bubbles', position: { x: 0, y: 0 }, width: 640, height: 440, data: { title: 'Ideen', frage: 'Wie könnten wir …?', ideen, stimmen: {}, gruppen, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } };

/** Seite mit gedrosselter CPU; die Spur läuft ab dem ersten Bild (vor der App) */
async function auf(rate) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme: 'dark' });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { boards: [{ id: 'x', name: 'Colab Demo', edges: [], drawings: [], nodes: [karte] }], spaces: [{ id: 's1', name: 'Misc', projects: [{ id: 'p1', name: 'Misc', boardIds: ['x'] }] }], activeId: 'x', view: 'board' });
  await ctx.addInitScript(() => {
    const s = { namen: {}, blasen: {}, bilder: [], an: true };
    window.__m496 = s;
    const lauf = (ts) => { if (s.an) s.bilder.push(ts); requestAnimationFrame(lauf); };
    requestAnimationFrame(lauf);
    const tr = /translate\(([-\d.]+)px, ([-\d.]+)px\)/;
    new MutationObserver((ms) => {
      if (!s.an) return;
      const T = document.timeline.currentTime;
      for (const m of ms) {
        const n = m.target; const cl = n.classList; if (!cl) continue;
        const mm = tr.exec(n.style.transform); if (!mm) continue;
        if (cl.contains('bub-ring-name')) (s.namen[n.dataset.gruppe] ??= []).push([+mm[1], +mm[2], T]);
        else if (cl.contains('bub-blase')) { const r = (parseFloat(n.style.width) || 0) / 2; (s.blasen[n.dataset.id] ??= []).push([+mm[1] + r, +mm[2] + r, T]); }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const cdp = await ctx.newCDPSession(P);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.bub-ring-name', { timeout: 30000 });
  return { ctx, P, cdp };
}
/** wartet, bis sich 1,5 s lang (Bildzeit) keine Blase und kein Name bewegt hat — höchstens 30 s */
const stillBis = async (P) => P.waitForFunction(() => {
  const s = window.__m496; let letzte = 0;
  for (const p of [...Object.values(s.namen), ...Object.values(s.blasen)]) if (p.length) letzte = Math.max(letzte, p.at(-1)[2]);
  return letzte > 0 && document.timeline.currentTime - letzte > 1500;
}, null, { timeout: 30000, polling: 250 });
const spurHolen = async (P) => P.evaluate(() => { const s = window.__m496; s.an = false; return JSON.parse(JSON.stringify(s)); });

/** Zeitstempel des Bilds vor T (die App hat die Lage zu T aus genau diesem Intervall gerechnet) */
const vorBildVon = (bilder) => (T) => { let lo = 0; let hi = bilder.length - 1; let r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (bilder[m] < T - 0.01) { r = bilder[m]; lo = m + 1; } else hi = m - 1; } return r; };
/** größter Weg je 16,7 ms: Weg einer Änderung geteilt durch die Bilder, die seit dem vorigen Bild vergangen sind */
const groessterSprung = (spuren, bilder, ab = -Infinity) => {
  const vorBild = vorBildVon(bilder); let max = 0; let wo = '';
  for (const [k, p] of Object.entries(spuren)) for (let i = 1; i < p.length; i++) {
    if (p[i][2] < ab) continue;
    const vb = vorBild(p[i][2]); const dt = vb == null ? 16.7 : p[i][2] - vb;
    const w = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) / Math.max(1, dt / 16.7);
    if (w > max) { max = w; wo = `${k} bei ${(p[i][2] - p[0][2]).toFixed(0)} ms, Bild ${dt.toFixed(0)} ms`; }
  }
  return { max, wo };
};
const wegLaenge = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
/** Uhr der App: Bild-Intervalle, jedes höchstens 100 ms (mehr holt sie nicht nach — dann Zeitlupe, mit Absicht) */
const appUhr = (bilder, T0) => { const u = [[T0, 0]]; let acc = 0; for (let i = 1; i < bilder.length; i++) { if (bilder[i] <= T0) continue; acc += Math.min(100, bilder[i] - Math.max(T0, bilder[i - 1])); u.push([bilder[i], acc]); } return u; };
/** Lage jeder Blase nach `ms` App-Zeit seit Beginn der Bewegung; Fortschritt = mittlerer Weg vom Start bis dorthin */
const fortschritt = (spur, ms) => {
  const alle = Object.values(spur.blasen); const T0 = Math.min(...alle.map((p) => p[0][2]));
  const uhr = appUhr(spur.bilder, T0); const Tbis = (uhr.find(([, a]) => a >= ms) ?? uhr.at(-1))[0];
  let s = 0; for (const p of alle) { const q = [...p].reverse().find((x) => x[2] <= Tbis) ?? p[0]; s += Math.hypot(q[0] - p[0][0], q[1] - p[0][1]); }
  return s / alle.length;
};
const endLage = (spur) => Object.fromEntries(Object.entries(spur.blasen).map(([k, p]) => [k, p.at(-1)]));
const ruheNach = (spur) => {
  const alle = [...Object.values(spur.namen), ...Object.values(spur.blasen)];
  return (Math.max(...alle.map((p) => p.at(-1)[2])) - Math.min(...alle.map((p) => p[0][2]))) / 1000;
};
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] ?? 0; };
const bildIntervall = (bilder) => median(bilder.slice(1).map((b, i) => b - bilder[i]));

const STUFEN = [1, 4, 6];
const laeufe = {};
console.log('\n════ A/B: Einschwingen unter CPU-Drosselung ════');
for (const rate of STUFEN) {
  const { ctx, P } = await auf(rate);
  await stillBis(P);
  const spur = await spurHolen(P);
  laeufe[rate] = spur;
  const s = groessterSprung(spur.namen, spur.bilder);
  const wege = Object.fromEntries(Object.entries(spur.namen).map(([g, p]) => [g, Math.round(wegLaenge(p))]));
  console.log(`  ${rate}×: Bild-Intervall Median ${bildIntervall(spur.bilder).toFixed(0)} ms, Namen größter Weg ${s.max.toFixed(1)} je 16,7 ms (${s.wo}), Wege ${JSON.stringify(wege)}, Ruhe nach ${ruheNach(spur).toFixed(1)} s`);
  pruefe(`A1 ${rate}×: kein Name springt (≤ 6 Punkte je 16,7 ms)`, s.max <= 6, s.max.toFixed(1) + ' · ' + s.wo);
  await ctx.close();
}
{
  const basis = laeufe[1];
  for (const rate of STUFEN.slice(1)) {
    const sp = laeufe[rate];
    const abw = Math.max(...Object.keys(basis.namen).map((g) => { const a = wegLaenge(basis.namen[g]); const b = wegLaenge(sp.namen[g] ?? []); return Math.abs(b - a) / Math.max(1, a); }));
    pruefe(`A2 ${rate}×: jeder Name legt denselben Weg zurück wie bei 1× (± 15 %)`, abw <= 0.15, `${(abw * 100).toFixed(0)} %`);
    const f1 = fortschritt(basis, 400); const fr = fortschritt(sp, 400);
    pruefe(`B1 ${rate}×: Blasen kommen in derselben Zeit gleich weit wie bei 1× (nach 400 ms: ${fr.toFixed(0)} statt ${f1.toFixed(0)} Punkte, ± 25 %)`, Math.abs(fr - f1) <= 0.25 * f1, { f1, fr });
    const e1 = endLage(basis); const er = endLage(sp);
    const abwLage = Math.max(...Object.keys(e1).map((k) => (er[k] ? Math.hypot(er[k][0] - e1[k][0], er[k][1] - e1[k][1]) : Infinity)));
    pruefe(`B2 ${rate}×: dieselbe Ruhelage wie bei 1× (jede Blase ≤ 12 Punkte daneben)`, abwLage <= 12, abwLage.toFixed(1));
    const sb = groessterSprung(sp.blasen, sp.bilder); const sb1 = groessterSprung(basis.blasen, basis.bilder);
    pruefe(`B3 ${rate}×: Blasen je 16,7 ms nicht weiter als bei 1× (${sb.max.toFixed(1)} gegen ${sb1.max.toFixed(1)} Punkte, + 25 %)`, sb.max <= sb1.max * 1.25 + 1, sb.wo);
  }
  for (const rate of STUFEN) pruefe(`B4 ${rate}×: nach dem Einschwingen steht alles (Ruhe nach ${ruheNach(laeufe[rate]).toFixed(1)} s ≤ 6 s)`, ruheNach(laeufe[rate]) <= 6);
}

console.log('\n════ C: Idee aus der Gruppe ziehen, 6× gedrosselt ════');
{
  const { ctx, P } = await auf(6);
  await stillBis(P);
  // neu messen ab dem Zug
  await P.evaluate(() => { const s = window.__m496; s.namen = {}; s.blasen = {}; s.bilder = []; });
  const b = await P.locator('.bub-blase').nth(2).boundingBox();
  await P.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await P.mouse.down();
  await P.mouse.move(b.x + 70, b.y + 50, { steps: 8 }); await P.mouse.up();
  await stillBis(P);
  const spur = await spurHolen(P);
  const s = groessterSprung(spur.namen, spur.bilder);
  console.log(`  Bild-Intervall Median ${bildIntervall(spur.bilder).toFixed(0)} ms, Namen größter Weg ${s.max.toFixed(1)} je 16,7 ms (${s.wo})`);
  pruefe('C1 der Name gleitet nach dem Zug (≤ 6 Punkte je 16,7 ms)', s.max <= 6, s.max.toFixed(1) + ' · ' + s.wo);
  pruefe('C2 und kommt wieder zur Ruhe', ruheNach(spur) <= 8, ruheNach(spur).toFixed(1));
  await ctx.close();
}

console.log('\n════ D ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('D1 Hilfe (de/en) nennt M496', /M496/.test(hilfe) && /M496/.test(hilfeEn));
  pruefe('D2 Meilenstein-Datei', existsSync(path.join(__repo, 'docs/meilensteine/M496-bubbles-ruhig.md')));
  pruefe('D3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}
await browser.close(); app.close();
console.log(`\nM496: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
