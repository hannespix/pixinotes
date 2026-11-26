// M554: Die schlanke Grundschrift bleibt fest, während Tinte entlang ihrer Kontur wandert.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const dauer = 0.82;
const phasen = [0, 0.04, 0.08, 0.12, 0.17, 0.21, 0.26, 0.31, 0.36, 0.4, 0.45, 0.5, 0.55, 0.6, 0.66, 0.72, 0.8, 0.88, 0.94, 1];
const modul = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/agencyLogo.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'AgencyLogo',
});
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
try {
  const seite = await browser.newPage({ viewport: { width: 820, height: 680 } });
  await seite.setContent(`<!doctype html><style>
    body { background: white; color: black; }
    svg { display: block; width: 720px; height: auto; }
  </style><span id="marke">pixi</span>`);
  await seite.addScriptTag({ content: modul.outputFiles[0].text });
  await seite.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    window.AgencyLogo.agencyBewegen(document.querySelector('#marke'));
  });
  const svg = seite.locator('#marke svg');
  const grund = svg.locator('g[data-grundschrift]');
  const tinte = svg.locator('g[data-tinte]');
  assert.equal(await grund.locator(':scope > path').count(), 4, 'Vier feste Buchstabenpfade in der Grundschrift');
  assert.equal(await tinte.locator(':scope > path').count(), 4, 'Vier getrennte Tintenpfade über der Grundschrift');
  assert.deepEqual(await svg.locator('animate[attributeName="d"]').evaluateAll(
    (elemente) => elemente.map((e) => e.getAttribute('dur')),
  ), Array(4).fill('820ms'), 'Nur die vier Tintenpfade nutzen die gemeinsame SVG-Uhr');
  assert.equal(await grund.locator('animate, animateTransform, animateMotion, set').count(), 0,
    'Die Grundschrift hat keine SVG-Animation');
  const farben = await svg.evaluate((e) => {
    const marke = e.parentElement;
    marke.style.color = 'rgb(86, 51, 134)';
    const farben = [...e.querySelectorAll('path')].map((pfad) => getComputedStyle(pfad).fill);
    marke.style.removeProperty('color');
    return farben;
  });
  assert.deepEqual(farben, Array(8).fill('rgb(86, 51, 134)'), 'Tinte und Grundschrift erben dieselbe Textfarbe');

  const geometrie = () => grund.locator(':scope > path').evaluateAll((pfade) => pfade.map((pfad) => {
    const { x, y, width, height } = pfad.getBBox();
    return { x, y, width, height, d: pfad.getAttribute('d'), laenge: pfad.getTotalLength() };
  }));
  const basis = await geometrie();
  const stammAnteil = await grund.locator(':scope > path').first().evaluate((p) => {
    const { x, y, width, height } = p.getBBox();
    const punkt = new DOMPoint(x, y + height * 0.9);
    let stamm = 0;
    const schritt = 0.25;
    for (; punkt.x <= x + width; punkt.x += schritt) {
      if (p.isPointInFill(punkt)) stamm += schritt;
    }
    return stamm / width;
  });
  assert.ok(stammAnteil > 0 && stammAnteil <= 0.2,
    `Der Stamm des p belegt höchstens ein Fünftel seiner Breite, gemessen ${stammAnteil.toFixed(3)}`);

  const sichtfeld = await svg.evaluate((e) => {
    const { x, y, width, height } = e.viewBox.baseVal;
    return { x, y, width, height };
  });
  const zumBild = (phase) => svg.evaluate((e, zeit) => e.setCurrentTime(zeit), phase * dauer);
  const tinteAus = await seite.addStyleTag({ content: 'g[data-tinte] { display: none !important; }' });
  const grundbild = await svg.screenshot();
  for (const phase of [0.17, 0.31, 0.5, 0.72, 1]) {
    await zumBild(phase);
    assert.ok(grundbild.equals(await svg.screenshot()), `Die Grundschrift bleibt bei ${phase} pixelgleich`);
  }
  await tinteAus.evaluate((e) => e.remove());
  const bilder = [];
  for (const phase of phasen) {
    await zumBild(phase);
    assert.deepEqual(await geometrie(), basis, `Unveränderte Buchstabengeometrie bei ${phase}`);
    const bild = await svg.screenshot();
    if (phase === 0 || phase === 1) {
      assert.ok(grundbild.equals(bild), `Bei ${phase} ist allein die Grundschrift sichtbar`);
    }
    bilder.push(bild.toString('base64'));
  }

  const messung = await seite.evaluate(async ({ grundbild, bilder, basis, sichtfeld }) => {
    async function maske(png) {
      const bild = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const { width: breite, height: hoehe } = bild;
      const kontext = new OffscreenCanvas(breite, hoehe).getContext('2d');
      kontext.drawImage(bild, 0, 0);
      const rgba = kontext.getImageData(0, 0, breite, hoehe).data;
      const pixel = new Uint8Array(breite * hoehe);
      for (let i = 0; i < pixel.length; i++) pixel[i] = Number(rgba[4 * i] < 128);
      return { breite, hoehe, pixel, rgba };
    }

    function flaechen({ breite, hoehe, pixel }, farbe) {
      const besucht = new Uint8Array(pixel.length);
      const zusammen = [];
      for (let i = 0; i < pixel.length; i++) {
        if (besucht[i] || pixel[i] !== farbe) continue;
        const flaeche = [i];
        besucht[i] = 1;
        for (const p of flaeche) {
          const x = p % breite;
          const y = Math.floor(p / breite);
          const nachbarn = [x > 0 ? p - 1 : -1, x + 1 < breite ? p + 1 : -1,
            y > 0 ? p - breite : -1, y + 1 < hoehe ? p + breite : -1];
          for (const n of nachbarn) {
            if (n < 0 || besucht[n] || pixel[n] !== farbe) continue;
            besucht[n] = 1;
            flaeche.push(n);
          }
        }
        if (flaeche.length >= 3) zusammen.push(flaeche);
      }
      return zusammen;
    }

    const stand = await maske(grundbild);
    const { breite, hoehe, pixel } = stand;
    const px = (x) => (x - sichtfeld.x) * breite / sichtfeld.width;
    const py = (y) => (y - sichtfeld.y) * hoehe / sichtfeld.height;
    const p = basis[0];
    const mitteP = Math.floor(py(p.y + p.height * 0.35)) * breite + Math.floor(px(p.x + p.width * 0.54));
    const punze = flaechen(stand, 0).find((flaeche) => flaeche.includes(mitteP));
    if (!punze || punze.includes(0)) return { punzeOffen: false };
    let links = breite; let rechts = 0; let oben = hoehe; let unten = 0;
    for (const n of punze) {
      links = Math.min(links, n % breite);
      rechts = Math.max(rechts, n % breite);
      oben = Math.min(oben, Math.floor(n / breite));
      unten = Math.max(unten, Math.floor(n / breite));
    }
    // Die Grenzen zwischen den Buchstaben liegen in der Mitte ihrer Zwischenräume.
    const grenzen = basis.slice(1).map(({ x }, i) => px((x + basis[i].x + basis[i].width) / 2));
    const film = [];
    for (const bild of bilder) {
      const bildmaske = await maske(bild);
      const gemalt = bildmaske.pixel;
      const buchstaben = [0, 0, 0, 0];
      let fehlt = 0;
      for (let i = 0; i < pixel.length; i++) {
        // Knapp halbgedeckte Kantenpixel können durch SVG-Kantenglättung die Schwelle wechseln.
        if (stand.rgba[4 * i] < 80 && !gemalt[i]) fehlt++;
        if (pixel[i] || !gemalt[i]) continue;
        const x = i % breite;
        buchstaben[grenzen.filter((grenze) => x > grenze).length]++;
      }
      const lage = { links: 0, oben: 0, rechts: 0, unten: 0 };
      let punzeGefuellt = 0;
      for (const n of punze) {
        if (!gemalt[n]) continue;
        punzeGefuellt++;
        const dx = (2 * (n % breite) - links - rechts) / (rechts - links);
        const dy = (2 * Math.floor(n / breite) - oben - unten) / (unten - oben);
        const seite = Math.abs(dx) >= Math.abs(dy)
          ? (dx < 0 ? 'links' : 'rechts')
          : (dy < 0 ? 'oben' : 'unten');
        lage[seite]++;
      }
      const zusammen = flaechen(bildmaske, 1);
      film.push({ fehlt, buchstaben, lage, punzeAnteil: 1 - punzeGefuellt / punze.length,
        komponenten: zusammen.length, abgeloest: zusammen.some((flaeche) => !flaeche.some((n) => pixel[n])) });
    }
    return { punzeOffen: true, film };
  }, { grundbild: grundbild.toString('base64'), bilder, basis, sichtfeld });

  assert.ok(messung.punzeOffen, 'Das p hat in Ruhe eine offene Punze');
  for (const [i, bild] of messung.film.entries()) {
    assert.equal(bild.fehlt, 0, `Kein Grundpixel verschwindet bei ${phasen[i]}`);
    assert.equal(bild.abgeloest, false, `Keine vom Buchstaben gelöste Tinte bei ${phasen[i]}`);
    assert.equal(bild.komponenten, 6, `Vier Buchstaben und zwei i-Punkte bleiben getrennt bei ${phasen[i]}`);
    assert.ok(bild.punzeAnteil >= 0.45, `Die Öffnung des p bleibt bei ${phasen[i]} sichtbar`);
  }
  const { lage } = messung.film[phasen.indexOf(0.31)];
  assert.ok(lage.oben > Math.max(35, lage.links, lage.rechts, lage.unten),
    `Die Tinte wächst zwischen den Seiten an der oberen Innenkante des p, gemessen ${JSON.stringify(lage)}`);
  const beginn = basis.map((_, i) => messung.film.findIndex(({ buchstaben }) => buchstaben[i] >= 24));
  assert.ok(beginn.every((b, i) => b >= 0 && (i === 0 || b > beginn[i - 1])),
    `Die Tintenbewegung beginnt zeitversetzt von links nach rechts, gemessen ${beginn.map((i) => phasen[i])}`);
  console.log('M554: Feste schlanke Grundschrift, zusammenhängende Tinte und versetzte Konturbewegung.');
} finally {
  await browser.close();
}
