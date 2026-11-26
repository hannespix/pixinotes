// M551: Die sichtbaren Konturen verteilen Gewicht wie bei vave.log. Die
// Zeitmessung liest die SVG-Uhr mit kontrolliertem Browser-Takt aus.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';

const PORT = 5551;
const HOST = '127.0.0.1';
const dist = process.env.PN_DIST ? pathToFileURL(path.resolve(process.env.PN_DIST) + path.sep) : new URL('../dist/', import.meta.url);
const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const datei = new URL(`./${(req.url ?? '/').split('?')[0].slice(1) || 'index.html'}`, dist);
    if (!datei.pathname.startsWith(dist.pathname)) { res.writeHead(404).end(); return; }
    const inhalt = await readFile(datei);
    res.writeHead(200, { 'Content-Type': mime[datei.pathname.split('.').at(-1)] ?? 'application/octet-stream' });
    res.end(inhalt);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((fertig) => server.listen(PORT, HOST, fertig));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
let ok = 0;
let fehler = 0;
function pruefe(name, erfuellt, werte = '') {
  if (erfuellt) { ok++; console.log(`  ✓ ${name}`); }
  else { fehler++; console.log(`  ✗ ${name} ${JSON.stringify(werte)}`); }
}

try {
  const seite = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', serviceWorkers: 'block' });
  await seite.clock.install();
  await seite.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ ui: { design: 'agency', theme: 'dark' }, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Studio', nodes: [], edges: [], drawings: [], comments: [] }],
      activeId: 'b0', view: 'board', navLinks: false,
    } }));
  });
  await seite.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'networkidle' });
  const svg = seite.locator('.agency-pixi svg');
  await svg.waitFor();
  const werte = [];
  for (let i = 0; i < 58; i++) {
    await seite.clock.runFor(250);
    werte.push(await svg.evaluate((element) => element.getCurrentTime()));
  }
  const anlauf = werte.findIndex((t) => t > 0.002);
  const gipfel = werte.findIndex((t) => t > 0.8199);
  const ruecklauf = werte.findIndex((t, i) => i > gipfel && t < 0.814);
  const ruhe = werte.findIndex((t, i) => i > ruecklauf && t === 0);
  pruefe('Der sichtbare Hinweg dauert mindestens 3,25 Sekunden', anlauf >= 0 && gipfel - anlauf >= 13, { anlauf, gipfel });
  pruefe('Der sichtbare Rückweg dauert mindestens 4,75 Sekunden', ruecklauf > gipfel && ruhe - ruecklauf >= 19, { ruecklauf, ruhe });

  const [grund, mitte, ende] = await svg.evaluate((element) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const pfade = [...element.querySelectorAll('path')];
    return [0, 0.41, 0.82].map((zeit) => {
      element.setCurrentTime(zeit);
      return pfade.map((pfad) => {
        const b = pfad.getBBox();
        const punkt = new DOMPoint();
        let tinte = 0;
        for (let y = b.y + 4; y < b.y + b.height; y += 8) {
          punkt.y = y;
          for (let x = b.x + 4; x < b.x + b.width; x += 8) {
            punkt.x = x;
            if (pfad.isPointInFill(punkt)) tinte++;
          }
        }
        return tinte;
      });
    });
  });
  pruefe('Das p baut schon in der Mitte mindestens die Hälfte mehr Tinte auf', mitte[0] / grund[0] >= 1.5, { grund, mitte });
  pruefe('Am Ende trägt p deutlich mehr Tinte, während x und das letzte i sichtbar schmaler werden',
    ende[0] / grund[0] >= 1.65 && ende[2] / grund[2] <= 0.82 && ende[3] / grund[3] <= 0.73, { grund, ende });

  const flaechen = await seite.evaluate(() => ({
    leinwand: getComputedStyle(document.querySelector('.react-flow')).backgroundColor,
    logo: getComputedStyle(document.querySelector('.logo')).backgroundColor,
    punkt: getComputedStyle(document.querySelector('.agency-trennpunkt')).backgroundColor,
  }));
  pruefe('Agency Dunkel zeigt Anthrazit auf der Leinwand und eine hellere Kopfleiste',
    flaechen.leinwand === 'rgb(40, 43, 37)' && flaechen.logo === 'rgb(48, 51, 44)', flaechen);
  pruefe('Der violette Punkt bleibt in Agency Dunkel deutlich markiert', flaechen.punkt === 'rgb(154, 107, 255)', flaechen);
} finally {
  await browser.close();
  server.close();
}
console.log(`M551: ${ok} bestanden, ${fehler} fehlgeschlagen`);
assert.equal(fehler, 0);
