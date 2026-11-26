// M554: „pixi“ bleibt während des Formwechsels auch in der Kopfleiste lesbar.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const phasen = [0, 2.5, 6, 8, 10, 12, 15, 18, 22, 25];
const stil = await readFile(new URL('../src/styles/91-design-agency.css', import.meta.url), 'utf8');
const modul = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/agencyLogo.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'AgencyLogo',
});
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
try {
  const seite = await browser.newPage({ deviceScaleFactor: 2 });
  await seite.setContent(`<!doctype html><html data-design="agency"><style>${stil}
    body { background: white; }
  </style><div class="logo"><span class="agency-wortmarke"><span class="agency-pixi" data-animiert><span class="agency-wortmarke-text">pixi</span><span class="agency-animation"></span></span></span></div>`);
  await seite.addScriptTag({ content: modul.outputFiles[0].text });
  await seite.evaluate(async () => {
    const marke = document.querySelector('.agency-animation');
    const uhr = window.AgencyLogo.wortmarkeBauen(marke);
    if (!uhr.isLoaded) await new Promise((fertig) => uhr.addEventListener('DOMLoaded', fertig));
    uhr.setSubframe(true);
    window.zeigeBild = (bild) => uhr.goToAndStop(bild, true);
  });
  const wort = seite.locator('.agency-pixi');
  for (const [breite, schrift] of [[820, 25], [390, 22]]) {
    await seite.setViewportSize({ width: breite, height: 180 });
    assert.equal(await wort.evaluate((e) => getComputedStyle(e).fontSize), `${schrift}px`);
    const bilder = [];
    for (const bild of [...phasen, 0]) {
      await seite.evaluate((position) => window.zeigeBild(position), bild);
      bilder.push(await wort.screenshot());
    }
    const stand = bilder[0];
    assert.ok(stand.equals(bilder.pop()), `${schrift}px: 0 → 25 → 0 kehrt pixelgenau zur Grundform zurück`);
    assert.ok(!stand.equals(bilder.at(-1)), `${schrift}px: Das volle Bild ist sichtbar anders als die Grundform`);

    const messungen = await seite.evaluate(async (pngs) => {
      async function maske(png) {
        const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
        const bild = await createImageBitmap(blob);
        const { width: breite, height: hoehe } = bild;
        const kontext = new OffscreenCanvas(breite, hoehe).getContext('2d');
        kontext.drawImage(bild, 0, 0);
        const rgba = kontext.getImageData(0, 0, breite, hoehe).data;
        const pixel = new Uint8Array(breite * hoehe);
        for (let i = 0; i < pixel.length; i++) pixel[i] = Number(rgba[4 * i] < 128);
        return { breite, hoehe, pixel };
      }

      function flaechen({ breite, hoehe, pixel }, farbe) {
        const besucht = new Uint8Array(pixel.length);
        const flaechen = [];
        for (let i = 0; i < pixel.length; i++) {
          if (besucht[i] || pixel[i] !== farbe) continue;
          const flaeche = [i];
          besucht[i] = 1;
          for (const p of flaeche) {
            const x = p % breite;
            const y = Math.floor(p / breite);
            for (const [dx, dy] of farbe ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
              : [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
              if (x + dx < 0 || x + dx >= breite || y + dy < 0 || y + dy >= hoehe) continue;
              const n = p + dy * breite + dx;
              if (besucht[n] || pixel[n] !== farbe) continue;
              besucht[n] = 1;
              flaeche.push(n);
            }
          }
          flaechen.push(flaeche);
        }
        return flaechen;
      }

      return Promise.all(pngs.map(async (png) => {
        const maskeImBild = await maske(png);
        const { breite, hoehe } = maskeImBild;
        const buchstaben = flaechen(maskeImBild, 1).filter((f) => f.length >= 2);
        const punze = flaechen(maskeImBild, 0).some((f) => f.length >= 2 && f.every((p) => {
          const x = p % breite;
          return x > 0 && x < breite / 3 && p >= breite && p < breite * (hoehe - 1);
        }));
        return { komponenten: buchstaben.length, punze };
      }));
    }, bilder.map((bild) => bild.toString('base64')));
    for (const [i, { komponenten, punze }] of messungen.entries()) {
      assert.equal(komponenten, 6, `${schrift}px, Bild ${phasen[i]}: Vier Buchstaben und zwei i-Punkte bleiben getrennt`);
      assert.ok(punze, `${schrift}px, Bild ${phasen[i]}: Die Öffnung des p bleibt sichtbar`);
    }
  }
  console.log('M554: Sechs lesbare Formen, offene p-Punze und pixelgenauer Rücklauf bei Leisten-Größe.');
} finally {
  await browser.close();
}
