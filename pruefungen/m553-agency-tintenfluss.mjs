// M553: Die Tinte wandert innerhalb des p von einer Seite zur anderen.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const modul = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/agencyLogo.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'AgencyLogo',
});
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
try {
  const seite = await browser.newPage();
  await seite.setContent('<span id="marke">pixi</span>');
  await seite.addScriptTag({ content: modul.outputFiles[0].text });
  const { grund, links, rechts } = await seite.evaluate(() => {
    // Die echte SVG-Animation im Stand gezielt auf drei Phasen setzen.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const marke = document.querySelector('#marke');
    const aufraeumen = window.AgencyLogo.agencyBewegen(marke);
    const svg = marke.querySelector('svg');
    const p = svg.querySelector('path');
    const dauer = parseFloat(p.querySelector('animate').getAttribute('dur')) / 1000;
    const { x, y, width, height } = p.getBBox();
    const mitte = x + width / 2;
    const punkt = new DOMPoint();

    function tinte(lage) {
      svg.setCurrentTime(lage * dauer);
      let links = 0;
      let rechts = 0;
      for (punkt.y = y + height * 0.15; punkt.y < y + height * 0.72; punkt.y += 5) {
        for (punkt.x = x - 100; punkt.x < x + width + 100; punkt.x += 5) {
          if (p.isPointInFill(punkt)) {
            if (punkt.x < mitte) links++;
            else rechts++;
          }
        }
      }
      return { links, rechts };
    }

    const messung = { grund: tinte(0), links: tinte(0.18), rechts: tinte(0.49) };
    aufraeumen();
    return messung;
  });

  assert.ok(links.links > grund.links * 1.18 && links.rechts < grund.rechts * 0.94,
    `Das p sammelt zuerst links Tinte. ${JSON.stringify({ grund, links })}`);
  assert.ok(rechts.rechts > grund.rechts * 1.24 && rechts.links < links.links * 0.95,
    `Die Tinte wandert danach auf die rechte Seite des p. ${JSON.stringify({ links, rechts })}`);
  console.log('M553: Die Tinte im p wandert sichtbar von links nach rechts.');
} finally {
  await browser.close();
}
