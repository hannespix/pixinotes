// M551 prüft die Geschwindigkeit der Lottie-Bewegung mit kontrolliertem
// Browser-Takt und die dunkle Palette. Die Bildfolge prüft M554.
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
    // Die Tests messen die Grundzeiten ohne die Variation von Faktor 0,9 bis 1,2.
    Math.random = () => 1 / 3;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ ui: { design: 'agency', theme: 'dark' }, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Studio', nodes: [], edges: [], drawings: [], comments: [] }],
      activeId: 'b0', view: 'board', navLinks: false,
    } }));
  });
  await seite.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'networkidle' });
  const wortmarke = seite.locator('.agency-pixi[data-agency-frame]');
  await wortmarke.locator('svg path[d]').first().waitFor();
  const werte = [];
  for (let i = 0; i < 58; i++) {
    await seite.clock.runFor(250);
    werte.push(await wortmarke.evaluate((element) => Number(element.dataset.agencyFrame) / 25));
  }
  const anlauf = werte.findIndex((t) => t > 0.0025);
  const gipfel = werte.findIndex((t) => t === 1);
  const ruecklauf = werte.findIndex((t, i) => i > gipfel && t < 0.993);
  const ruhe = werte.findIndex((t, i) => i > ruecklauf && t === 0);
  pruefe('Der sichtbare Hinweg dauert mindestens 3,25 Sekunden', anlauf >= 0 && gipfel - anlauf >= 13, { anlauf, gipfel });
  pruefe('Der sichtbare Rückweg dauert mindestens 4,75 Sekunden', ruecklauf > gipfel && ruhe - ruecklauf >= 19, { ruecklauf, ruhe });

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
