/**
 * M540 — Flüssige Schrift läuft auf jedem Bildschirm gleich schnell (60, 144, 240 Hz).
 *
 * Ursache: Die Physik rechnet in festen Schritten von 1/120 s und verwarf den Rest jedes Bildes. Auf einem
 * 144-Hz-Schirm dauert ein Bild 6,9 ms — weniger als ein Schritt (8,3 ms). Dann rechnete fast kein Bild einen Schritt:
 * Zeitlupe, ruckelig. Jetzt wandert der Rest ins nächste Bild.
 *
 * Gemessen wird Verhalten: Der Bildtakt des Browsers wird vor dem Start der App ersetzt (requestAnimationFrame mit
 * 60, 144 oder 240 Bildern je Sekunde). Gezählt werden Physik-Schritte je Sekunde (Zähler `pixinotesFluessig.physik`)
 * und Pixel der Fläche über die Zeit.
 *
 *   A  60 Hz: rund 120 Schritte je Sekunde, die Schrift bewegt sich.
 *   B  144 Hz: ebenso viele Schritte je Sekunde wie bei 60 Hz (vorher fast keine), die Schrift bewegt sich.
 *   C  240 Hz: ebenso.
 *   D  Unruhiger Takt (Bilder abwechselnd 5 und 9 ms): ebenso.
 */
// Läuft aus dem Repository: `node pruefungen/m540-fluessig-bildrate.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = Number(process.env.M540_PORT ?? 5540);
const laufe = (teil) => !process.env.NUR || [...teil].some((b) => process.env.NUR.includes(b));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  let f = path.join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const fl = (id, text, x, y, extra = {}) => ({ id, type: 'fluessig', width: 440, height: 220, autoFit: false, position: { x, y }, data: { text, ...extra } });
const stand = (nodes) => ({
  boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false,
});

/** Seite mit ersetztem Bildtakt: `abstaende` = Bildabstände in ms, reihum */
async function seite(abstaende) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(([st, ab]) => {
    try { if (window !== window.top) return; } catch { return; }
    // Bildtakt des Schirms nachbauen: alle Rückrufe eines Bildes laufen mit demselben Zeitstempel, wie im Browser.
    // Der Zeitstempel ist eine eigene Uhr, die je Bild GENAU den bestellten Abstand weiterläuft — setTimeout allein
    // trifft 6,9 ms im Headless-Browser nicht (die Bilder kämen später, der Fehler bliebe unsichtbar). Gewartet wird so,
    // dass die eigene Uhr der echten folgt; `window.__uhr` zählt die Zeit, die die Bilder abdecken.
    let warte = new Map(); let id = 0; let i = 0; let geplant = false; let uhr = 0;
    window.__uhr = 0;
    const bild = () => {
      geplant = false;
      const schritt = ab[i++ % ab.length];
      uhr = uhr ? uhr + schritt : performance.now(); window.__uhr += schritt;
      const liste = warte; warte = new Map();
      for (const cb of liste.values()) { try { cb(uhr); } catch (e) { setTimeout(() => { throw e; }); } }
      if (warte.size) plane();
    };
    const plane = () => {
      if (geplant) return; geplant = true;
      const naechste = uhr ? uhr + ab[i % ab.length] : performance.now();
      setTimeout(bild, Math.max(0, naechste - performance.now()));
    };
    window.requestAnimationFrame = (cb) => { id += 1; warte.set(id, cb); plane(); return id; };
    window.cancelAnimationFrame = (n) => { warte.delete(n); };
    window.__bilder = 0; const zaehl = () => { window.__bilder++; requestAnimationFrame(zaehl); }; requestAnimationFrame(zaehl);
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand([fl('f1', 'Welle', 300, 220, { lebendig: true })]), abstaende]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow__node-fluessig', { state: 'visible', timeout: 30000 });
  await P.mouse.move(5, 790);
  await P.waitForFunction(() => !!document.querySelector('canvas.fl-flaeche')?.__fluessig?.zustand().teilchen, null, { timeout: 30000, polling: 50 });
  return { ctx, P, fehler };
}
const abbild = (P) => P.evaluate(() => {
  const c = document.querySelector('canvas.fl-flaeche');
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const bild = [];
  for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) bild.push(d[(y * c.width + x) * 4 + 3] > 128 ? 1 : 0);
  return bild;
});
const unterschied = (a, b) => { if (!a || !b) return -1; let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++; return n; };

/** Physik-Schritte je Sekunde, Bilder je Sekunde und größte Pixel-Änderung über `ms` */
async function messen(P, ms = 2500) {
  const z = () => P.evaluate(() => ({ p: window.pixinotesFluessig?.physik ?? 0, b: window.__bilder, t: window.__uhr }));
  const a = await z(); const bild0 = await abbild(P); let bewegt = 0;
  for (let i = 0; i < 4; i++) { await P.waitForTimeout(ms / 4); bewegt = Math.max(bewegt, unterschied(bild0, await abbild(P))); }
  const b = await z(); const s = (b.t - a.t) / 1000;
  // Gemessen gegen die Zeit, die die Bilder abdecken (eigene Uhr), nicht gegen die Wanduhr
  return { schritteJeS: Math.round((b.p - a.p) / s), bilderJeS: Math.round((b.b - a.b) / s), bewegt };
}

const faelle = [
  { teil: 'A', name: '60 Hz', ab: [1000 / 60] },
  { teil: 'B', name: '144 Hz', ab: [1000 / 144] },
  { teil: 'C', name: '240 Hz', ab: [1000 / 240] },
  { teil: 'D', name: 'unruhiger Takt (5 / 9 ms)', ab: [5, 9] },
];
const ergebnisse = {};
for (const f of faelle) {
  if (!laufe(f.teil)) continue;
  console.log(`\n════ ${f.teil}: ${f.name} ════`);
  const { ctx, P, fehler } = await seite(f.ab);
  await P.waitForTimeout(1500);   // Zusammensetzen abwarten
  const m = await messen(P);
  ergebnisse[f.teil] = m;
  // Erwartet: 120 Schritte je Sekunde Bildzeit (feste Schritte von 1/120 s)
  pruefe(`${f.teil}1 Bilder kommen (eigene Uhr)`, m.bilderJeS > 30, m);
  pruefe(`${f.teil}2 rund 120 Physik-Schritte je Sekunde (110–130)`, m.schritteJeS >= 110 && m.schritteJeS <= 130, m);
  pruefe(`${f.teil}3 die Schrift bewegt sich sichtbar`, m.bewegt > 3, m);
  pruefe(`${f.teil}4 keine Seitenfehler`, fehler.length === 0, fehler);
  await ctx.close();
}
if (ergebnisse.A && ergebnisse.B) {
  const q = ergebnisse.B.schritteJeS / Math.max(1, ergebnisse.A.schritteJeS);
  pruefe('E1 144 Hz rechnet so schnell wie 60 Hz (Verhältnis 0,9–1,1)', q >= 0.9 && q <= 1.1, { q: +q.toFixed(2) });
}
if (ergebnisse.A && ergebnisse.C) {
  const q = ergebnisse.C.schritteJeS / Math.max(1, ergebnisse.A.schritteJeS);
  pruefe('E2 240 Hz rechnet so schnell wie 60 Hz (Verhältnis 0,9–1,1)', q >= 0.9 && q <= 1.1, { q: +q.toFixed(2) });
}

await browser.close();
app.close();
console.log(`\nm540-fluessig-bildrate: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
