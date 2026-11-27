// M560: Das p fließt innen, während sein linker Stamm und die i-Punkte stehen.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const phasen = [0, 1, 2.5, 4, 6, 8, 9.5, 11, 12.5, 14, 15.5, 17, 19, 21, 23, 25, 0];
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
  const seite = await browser.newPage();
  await seite.setContent(`<!doctype html><html data-design="agency"><style>${stil}</style>
    <div class="logo"><span class="agency-wortmarke"><span class="agency-pixi" data-animiert>
    <span class="agency-wortmarke-text">pixi</span><span class="agency-animation"></span></span></span></div>`);
  await seite.addScriptTag({ content: modul.outputFiles[0].text });
  await seite.evaluate(async () => {
    const player = window.AgencyLogo.wortmarkeBauen(document.querySelector('.agency-animation'));
    if (!player.isLoaded) await new Promise((fertig) => player.addEventListener('DOMLoaded', fertig));
    player.setSubframe(true);
    window.zeigeBild = (bild) => player.goToAndStop(bild, true);
  });
  const wort = seite.locator('.agency-pixi');
  for (const [breite, schrift] of [[820, 25], [390, 22]]) {
    await seite.setViewportSize({ width: breite, height: 160 });
    assert.equal(await wort.evaluate((e) => getComputedStyle(e).fontSize), `${schrift}px`);
    const folge = await wort.evaluate((element, phasen) => {
      window.zeigeBild(0);
      const svg = element.querySelector('svg');
      const [p, i1, , i2] = Array.from(svg.querySelectorAll('path[fill][d]'))
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const probe = document.createElementNS(svg.namespaceURI, 'path');
      probe.setAttribute('visibility', 'hidden');
      svg.append(probe);
      const stamm = p.getBoundingClientRect();
      const hoehen = [0.12, 0.23, 0.34, 0.45, 0.56, 0.67, 0.78, 0.9].map((a) => stamm.top + a * stamm.height);

      function linkerRand(y, r, treffen) {
        for (let x = r.left; x <= r.right; x += 0.125) {
          if (!treffen(x, y)) continue;
          let aussen = x - 0.125;
          let innen = x;
          for (let schritt = 0; schritt < 8; schritt++) {
            const mitte = (aussen + innen) / 2;
            if (treffen(mitte, y)) innen = mitte;
            else aussen = mitte;
          }
          return innen;
        }
        return Infinity;
      }

      function teilpfade(pfad) {
        // Lottie zeichnet die Teilpfade mit einer gemeinsamen Gruppen-Transformation.
        const matrix = pfad.getScreenCTM();
        return pfad.getAttribute('d').match(/M[^M]*/g).map((d) => {
          probe.setAttribute('d', d);
          const r = probe.getBBox();
          const a = new DOMPoint(r.x, r.y).matrixTransform(matrix);
          const b = new DOMPoint(r.x + r.width, r.y + r.height).matrixTransform(matrix);
          return { d, matrix, rand: [a.x, a.y, b.x, b.y], breite: b.x - a.x };
        });
      }

      function oeffnung() {
        const [punze] = teilpfade(p).sort((a, b) => a.breite - b.breite);
        probe.setAttribute('d', punze.d);
        const laenge = probe.getTotalLength();
        const rand = Array.from({ length: 64 }, (_, i) => probe.getPointAtLength(laenge * i / 64).matrixTransform(punze.matrix));
        let doppelteFlaeche = 0;
        let summeX = 0;
        for (const [i, a] of rand.entries()) {
          const b = rand[(i + 1) % rand.length];
          const kreuz = a.x * b.y - b.x * a.y;
          doppelteFlaeche += kreuz;
          summeX += (a.x + b.x) * kreuz;
        }
        return { mitte: summeX / (3 * doppelteFlaeche), flaeche: Math.abs(doppelteFlaeche) / 2 };
      }

      const bilder = phasen.map((phase) => {
        window.zeigeBild(phase);
        const inverse = p.getScreenCTM().inverse();
        const treffen = (x, y) => p.isPointInFill(new DOMPoint(x, y).matrixTransform(inverse));
        const r = p.getBoundingClientRect();
        const punkte = [i1, i2].map((pfad) => teilpfade(pfad).sort((a, b) => a.rand[1] - b.rand[1])[0].rand);
        return { stamm: [...hoehen.map((y) => linkerRand(y, r, treffen)), r.bottom], punkte, punze: oeffnung() };
      });
      probe.remove();
      return bilder;
    }, phasen);

    const [start] = folge;
    const abweichung = (a, b) => Math.max(...a.map((x, i) => Math.abs(b[i] - x)));
    for (const [i, bild] of folge.entries()) {
      const meldung = `${schrift}px, Bild ${phasen[i]}`;
      const stammVersatz = abweichung(start.stamm, bild.stamm);
      assert.ok(stammVersatz <= 0.25, `${meldung}: Linker p-Stamm bleibt fest (Abweichung ${stammVersatz.toFixed(3)}px)`);
      assert.ok(bild.punkte.every((punkt, nr) => abweichung(start.punkte[nr], punkt) <= 0.25),
        `${meldung}: Beide i-Punkte bleiben innerhalb 0,25px`);
    }
    const frueh = Math.max(...folge.filter((_, i) => phasen[i] > 0 && phasen[i] <= 10).map((b) => b.punze.mitte));
    const spaet = folge[phasen.indexOf(25)].punze.mitte;
    assert.ok(frueh - start.punze.mitte >= 1 && frueh - spaet >= 0.4,
      `${schrift}px: Die Punze wandert erst nach rechts und dann nach links (${(frueh - start.punze.mitte).toFixed(2)}px hin, ${(frueh - spaet).toFixed(2)}px zurück)`);
    assert.ok(folge.some(({ punze }) => Math.abs(punze.flaeche / start.punze.flaeche - 1) >= 0.22),
      `${schrift}px: Die Punzenfläche verändert sich sichtbar`);
  }
  console.log('M560: Fester p-Stamm und feste i-Punkte bei sichtbarem Tintenfluss in der Punze.');
} finally {
  await browser.close();
}
