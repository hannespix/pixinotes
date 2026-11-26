// M556: Der Formwechsel bleibt bei 25 px klar sichtbar. Das p nimmt Tinte auf,
// während x und das zweite i gegenüber der Grundform schmaler werden.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

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
  const seite = await browser.newPage({ viewport: { width: 820, height: 200 }, deviceScaleFactor: 4 });
  await seite.setContent(`<!doctype html><html data-design="agency"><style>${stil}
    body { background: white; --ink: black; --surface: white; }
  </style><div class="logo"><span class="agency-wortmarke"><span class="agency-pixi" data-animiert><span class="agency-wortmarke-text">pixi</span><span class="agency-animation"></span></span></span></div>`);
  await seite.addScriptTag({ content: modul.outputFiles[0].text });
  const anzahl = await seite.evaluate(async () => {
    const marke = document.querySelector('.agency-animation');
    const player = window.AgencyLogo.wortmarkeBauen(marke);
    if (!player.isLoaded) await new Promise((fertig) => player.addEventListener('DOMLoaded', fertig));
    player.setSubframe(true);
    player.goToAndStop(0, true);
    const pfade = [...marke.querySelectorAll('svg path[fill][d]')]
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    window.zeigeBuchstabe = ({ index, bild }) => {
      player.goToAndStop(bild, true);
      pfade.forEach((pfad, i) => { pfad.style.visibility = i === index ? 'visible' : 'hidden'; });
    };
    return pfade.length;
  });
  assert.equal(anzahl, 4, 'Die vier Buchstaben haben getrennte Lottie-Pfade');
  const wort = seite.locator('.agency-pixi');
  assert.equal(await wort.evaluate((e) => getComputedStyle(e).fontSize), '25px');

  async function tinte(index, bild) {
    await seite.evaluate((probe) => window.zeigeBuchstabe(probe), { index, bild });
    const png = await wort.screenshot();
    return seite.evaluate(async (b64) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bild = await createImageBitmap(blob);
      const ctx = new OffscreenCanvas(bild.width, bild.height).getContext('2d');
      ctx.drawImage(bild, 0, 0);
      const rgba = ctx.getImageData(0, 0, bild.width, bild.height).data;
      // Grautöne an den geglätteten Kanten zählen nur anteilig zur Tintenfläche.
      let deckung = 0;
      for (let i = 0; i < rgba.length; i += 4) deckung += 255 - rgba[i];
      return deckung / 255;
    }, png.toString('base64'));
  }

  const erwartungen = [
    { buchstabe: 'p', index: 0, min: 1.92, max: 2.17 },
    { buchstabe: 'x', index: 2, min: 0.60, max: 0.71 },
    { buchstabe: 'zweites i', index: 3, min: 0.48, max: 0.60 },
  ];
  const ergebnisse = [];
  for (const { buchstabe, index, min, max } of erwartungen) {
    const ruhe = await tinte(index, 0);
    const gipfel = await tinte(index, 25);
    assert.ok(ruhe > 0 && gipfel > 0, `${buchstabe} ist in beiden Bildern sichtbar`);
    const verhaeltnis = gipfel / ruhe;
    ergebnisse.push({ buchstabe, verhaeltnis, erfuellt: verhaeltnis >= min && verhaeltnis <= max });
  }
  const werte = ergebnisse.map(({ buchstabe, verhaeltnis }) => `${buchstabe} ${verhaeltnis.toFixed(3)}`).join(', ');
  assert.ok(ergebnisse.every(({ erfuellt }) => erfuellt), `Tintenfläche von Gipfel zu Grundform außerhalb der Erwartung (${werte})`);
  console.log(`M556: Kräftigerer Formwechsel bei 25 px (${werte}).`);
} finally {
  await browser.close();
}
