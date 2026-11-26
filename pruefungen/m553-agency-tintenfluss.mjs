// M553: Die Bewegung läuft durch die vier Pixi-Konturen.
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
  await seite.setContent('<div id="marke" style="width:480px;height:180px"></div>');
  await seite.addScriptTag({ content: modul.outputFiles[0].text });
  const folge = await seite.evaluate(async () => {
    const marke = document.querySelector('#marke');
    const uhr = window.AgencyLogo.wortmarkeBauen(marke);
    if (!uhr.isLoaded) await new Promise((fertig) => uhr.addEventListener('DOMLoaded', fertig));
    uhr.setSubframe(true);
    uhr.goToAndStop(0, true);
    const pfade = [...marke.querySelectorAll('svg path[fill][d]')]
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const konturen = () => pfade.map((p) => p.getAttribute('d'));
    const grund = konturen();
    const bilder = [2, 2.5, 6, 8, 10, 25, 0].map((bild) => {
      uhr.goToAndStop(bild, true);
      const pfadeImBild = konturen();
      return { bild, pfade: pfadeImBild, veraendert: pfadeImBild.map((d, i) => d !== grund[i]) };
    });
    uhr.destroy();
    return bilder;
  });

  for (const { bild, veraendert } of folge) {
    const t = [0, 3.003, 7.007, 9.009];
    assert.deepEqual(veraendert, t.map((beginn) => bild > beginn), `Die Buchstaben beginnen versetzt bei Bild ${bild}`);
  }
  assert.notEqual(folge[0].pfade[0], folge[1].pfade[0], 'Der Player zeichnet Zwischenzustände zwischen ganzen Bildern');
  console.log('M553: Die Bewegung erreicht p, i, x und i zeitversetzt und stufenlos.');
} finally {
  await browser.close();
}
