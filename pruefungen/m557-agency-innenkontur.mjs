// M557: Weiche Übergänge in p und x bei verankerten i-Punkten.
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
  const messungen = await seite.evaluate(async () => {
    const marke = document.querySelector('#marke');
    const player = window.AgencyLogo.wortmarkeBauen(marke);
    if (!player.isLoaded) await new Promise((fertig) => player.addEventListener('DOMLoaded', fertig));
    player.setSubframe(true);
    player.goToAndStop(0, true);
    const [p, i, x, letztesI] = [...marke.querySelectorAll('svg path[fill][d]')]
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    const punkt = new DOMPoint();
    function maske(pfad) {
      const { x, y, width, height } = pfad.getBBox();
      return (u, v) => {
        punkt.x = x + u * width;
        punkt.y = y + v * height;
        return pfad.isPointInFill(punkt);
      };
    }

    function grenze(istTinte, innen, aussen) {
      for (let schritt = 0; schritt < 12; schritt++) {
        const mitte = (innen + aussen) / 2;
        if (istTinte(mitte)) innen = mitte;
        else aussen = mitte;
      }
      return (innen + aussen) / 2;
    }

    function ersteTinte(istTinte) {
      if (istTinte(0)) return 0;
      for (let schritt = 1; schritt <= 100; schritt++) {
        const stelle = schritt / 100;
        if (istTinte(stelle)) return grenze(istTinte, stelle, (schritt - 1) / 100);
      }
      return NaN;
    }

    function lichterSchnitt(istTinte) {
      const aufloesung = 200;
      let letzteTinte = -1;
      let von = 0;
      let bis = 0;
      for (let stelle = 0; stelle <= aufloesung; stelle++) {
        if (!istTinte(stelle / aufloesung)) continue;
        if (letzteTinte !== -1 && stelle - letzteTinte > bis - von) {
          von = letzteTinte;
          bis = stelle;
        }
        letzteTinte = stelle;
      }
      return { mitte: (von + bis) / (2 * aufloesung), weite: (bis - von - 1) / aufloesung };
    }

    function pPunze(istTinte) {
      const waagerecht = lichterSchnitt((u) => istTinte(u, 0.34));
      const senkrecht = lichterSchnitt((v) => istTinte(waagerecht.mitte, v));
      const { x, y, width, height } = p.getBBox();
      // Die Lottie-Transformation des Buchstabens gehört zur sichtbaren Verschiebung.
      const mitte = new DOMPoint(x + width * waagerecht.mitte, y + height * senkrecht.mitte)
        .matrixTransform(p.getScreenCTM());
      return { breite: waagerecht.weite, hoehe: senkrecht.weite, x: mitte.x, y: mitte.y };
    }

    function rundung(tiefe) {
      // Die tiefste Stelle zwischen zwei Armen liegt nahe deren Mitte.
      let scheitel = 0.5;
      let maximum = 0;
      const messen = (quer) => {
        const wert = tiefe(quer);
        if (wert > maximum) { maximum = wert; scheitel = quer; }
      };
      for (let schritt = 30; schritt <= 70; schritt++) messen(schritt / 100);
      const grob = scheitel;
      for (let schritt = -20; schritt <= 20; schritt++) messen(grob + schritt / 2000);
      const abfall = (abstand) => maximum - (tiefe(scheitel - abstand) + tiefe(scheitel + abstand)) / 2;
      // Eine weiche Rundung flacht am Scheitel ab. Eine Kerbe bleibt dort steil.
      const fern = abfall(0.04);
      return { tiefe: maximum, fern, anteil: abfall(0.008) / fern };
    }

    const xRundungen = () => {
      const istTinte = maske(x);
      return [
        (u) => ersteTinte((v) => istTinte(u, v)),
        (u) => ersteTinte((v) => istTinte(u, 1 - v)),
        (v) => ersteTinte((u) => istTinte(u, v)),
        (v) => ersteTinte((u) => istTinte(1 - u, v)),
      ].map(rundung);
    };

    const bilder = [0, 2.5, 6, 8, 10, 12, 15, 18, 22, 25].map((bild) => {
      player.goToAndStop(bild, true);
      const istTinte = maske(p);
      return { bild, punze: pPunze(istTinte), punkte: [i, letztesI].map((pfad) => pfad.getBoundingClientRect().top),
        x: [0, 12, 25].includes(bild) ? xRundungen() : null };
    });

    // Rechts neben dem Stamm die Unterkante des p-Bauchs von unten ertasten.
    const istTinte = maske(p);
    const stamm = grenze((u) => istTinte(u, 0.9), 0.12, 1);
    const schulter = [0.004, 0.025, 0.06].map((abstand) =>
      1 - ersteTinte((v) => istTinte(stamm + abstand, 1 - v)));
    player.destroy();
    return { bilder, schulter };
  });

  const { bilder, schulter: [nah, mitte, fern] } = messungen;
  assert.ok(bilder.every(({ punze }) => punze.breite >= 0.25 && punze.hoehe >= 0.25),
    'Die p-Punze bleibt während des Zugs offen');
  const [start] = bilder;
  const gipfel = bilder.at(-1);
  const rechts = gipfel.punze.x - start.punze.x;
  const oben = start.punze.y - gipfel.punze.y;
  assert.ok(rechts > 3 && oben > 3,
    `Die p-Punze wandert in der vergrößerten Wortmarke nach rechts und oben (${rechts.toFixed(2)} px, ${oben.toFixed(2)} px)`);
  const gefaelleAmStamm = (nah - mitte) / (0.025 - 0.004);
  const gefaelleAmBauch = (mitte - fern) / (0.06 - 0.025);
  assert.ok(nah - mitte > 0.03 && mitte - fern > 0.02 && gefaelleAmStamm > 1.6 * gefaelleAmBauch,
    `Der p-Bauch schließt mit abflachender Rundung am Stamm an (${messungen.schulter.join(', ')})`);
  for (const { bild, punkte, x } of bilder) {
    assert.ok(punkte.every((punkt, i) => Math.abs(punkt - start.punkte[i]) < 0.25),
      `Bild ${bild}: Die Oberkanten beider i-Punkte halten ihre Höhe (${punkte.join(', ')})`);
    if (!x) continue;
    const grenzwert = bild === 0 ? 0.17 : 0.11;
    assert.ok(x.every(({ tiefe, fern, anteil }) => tiefe > 0.23 && fern > 0.002 && anteil >= 0 && anteil < grenzwert),
      `Bild ${bild}: Alle vier Innenrundungen des x flachen am Scheitel ab (${x.map(({ anteil }) => anteil.toFixed(3)).join(', ')})`);
  }
  console.log('M557: Wandernde p-Punze, weiche Anschlüsse und feste i-Punkthöhe.');
} finally {
  await browser.close();
}
