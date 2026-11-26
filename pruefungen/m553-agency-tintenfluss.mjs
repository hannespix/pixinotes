// M553: Die Tinte wandert im p von links nach rechts, seit M554 über der festen Kontur.
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
  const { frueh, spaet } = await seite.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const marke = document.querySelector('#marke');
    const aufraeumen = window.AgencyLogo.agencyBewegen(marke);
    const svg = marke.querySelector('svg');
    const kontur = svg.querySelector('g[data-grundschrift] path');
    const p = svg.querySelector('g[data-tinte] path');
    const dauer = parseFloat(p.querySelector('animate').getAttribute('dur')) / 1000;
    const { x, y, width, height } = kontur.getBBox();
    const mitte = x + width / 2;
    const punkt = new DOMPoint();

    function ueberschuss(lage) {
      svg.setCurrentTime(lage * dauer);
      let links = 0;
      let rechts = 0;
      for (punkt.y = y; punkt.y < y + height; punkt.y += 5) {
        for (punkt.x = x; punkt.x < x + width; punkt.x += 5) {
          if (!p.isPointInFill(punkt) || kontur.isPointInFill(punkt)) continue;
          if (punkt.x < mitte) links++;
          else rechts++;
        }
      }
      return { links, rechts };
    }

    const messung = { frueh: ueberschuss(0.17), spaet: ueberschuss(0.5) };
    aufraeumen();
    return messung;
  });

  assert.ok(frueh.links > frueh.rechts * 1.5 && frueh.links > 80,
    `Das p sammelt zuerst links zusätzliche Tinte. ${JSON.stringify(frueh)}`);
  assert.ok(spaet.rechts > spaet.links * 1.5 && spaet.rechts > 80 && spaet.links < frueh.links,
    `Die zusätzliche Tinte wandert anschließend nach rechts. ${JSON.stringify({ frueh, spaet })}`);
  console.log('M553: Die Tinte im p wandert sichtbar von links nach rechts.');
} finally {
  await browser.close();
}
