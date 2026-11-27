// M555: Die Pixi-Konturen folgen der originalen VAVE-Zeitachse im Lottie-Renderer.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

// public/vave-logo.json @ f0447dd67dd67f7b06e948faee2fb41fbdd35937.
const vorlage = [
  { zeit: [0, 15.0146484375], verschiebung: [[315.234, 350.251], [234.234, 350.251]] },
  { zeit: [3.003, 15.0146484375], verschiebung: [[329.135, 350.251], [335.235, 350.25]] },
  { zeit: [7.007, 18.017578125], verschiebung: [347.685, 350.25] },
  { zeit: [9.009, 22.0224609375], verschiebung: [[247.766, 350.224], [225.84, 350.225]] },
];
const asset = JSON.parse(await readFile(new URL('../src/assets/pixi-logo.json', import.meta.url), 'utf8'));
assert.deepEqual([asset.fr, asset.ip, asset.op], [30, 0, 26]);
assert.equal(asset.layers.length, vorlage.length);
function pruefeSchluessel(schluessel, zeit, name) {
  assert.deepEqual(schluessel.map(({ t }) => t), zeit, `${name}: originale Schlüsselzeiten`);
  assert.deepEqual(schluessel[0].o, { x: 0.333, y: 0 }, `${name}: ursprüngliche Anlaufkurve`);
  assert.deepEqual(schluessel[0].i, { x: 0.667, y: 1 }, `${name}: ursprüngliche Auslaufkurve`);
}
for (const [i, { zeit, verschiebung }] of vorlage.entries()) {
  const name = `Buchstabe ${i + 1}`;
  const elemente = asset.layers[i].shapes.flatMap(({ it }) => it);
  // Auch die wandernde Öffnung im p behält für ihre Form den Takt der Vorlage.
  const pfade = elemente.flatMap((e) => e.ty === 'gr' ? e.it : [e])
    .filter((e) => e.ty === 'sh' && e.ks.a === 1);
  assert.ok(pfade.length > 0, `${name}: animierte Kontur`);
  for (const pfad of pfade) pruefeSchluessel(pfad.ks.k, zeit, name);
  const { p } = elemente.find((e) => e.ty === 'tr');
  if (p.a === 1) {
    pruefeSchluessel(p.k, zeit, `${name}, Verschiebung`);
    assert.deepEqual(p.k.map(({ s }) => s), verschiebung, `${name}: originale bewegte Verschiebung`);
    assert.deepEqual([p.k[0].to, p.k[0].ti], [[0, 0], [0, 0]], `${name}: gerader Verschiebungsweg`);
  } else {
    assert.deepEqual(p.k, verschiebung, `${name}: originale feste Verschiebung`);
  }
}

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
  await seite.setContent('<div class="agency-pixi" style="width:120px;height:45px"><span class="agency-wortmarke-text">pixi</span></div>');
  await seite.addScriptTag({ content: modul.outputFiles[0].text });
  await seite.clock.install();
  await seite.evaluate(() => {
    Math.random = () => 1 / 3;
    window.aufraeumen = window.AgencyLogo.agencyBewegen(document.querySelector('.agency-pixi'));
  });
  const marke = seite.locator('.agency-pixi[data-animiert]');
  await marke.waitFor();
  const start = () => marke.locator('svg path[fill][d]').evaluateAll((pfade) => pfade.map((p) => p.getAttribute('d')));
  const bild = async () => {
    const wert = await marke.getAttribute('data-agency-frame');
    assert.ok(wert, 'Der Player meldet das aktuelle Bild');
    return Number(wert);
  };
  const original = await start();
  assert.equal(original.length, 4, 'Der Agency-Renderer zeichnet die vier Original-Ebenen der adaptierten Animation');
  assert.equal(await bild(), 0, 'Die Agenturmarke meldet Bild 0 beim Start');
  await seite.clock.runFor(3300);
  const mitte = await bild();
  assert.ok(mitte > 8 && mitte < 17 && !Number.isInteger(mitte), `Der Frame-Reporter meldet ein Zwischenbild, gemessen ${mitte}`);
  assert.notDeepEqual(await start(), original, 'Der Renderer zeichnet die gemeldete Bewegung');
  await seite.clock.runFor(2450);
  assert.equal(await bild(), 25, 'Der lange Zug hält in Bild 25');
  await seite.clock.runFor(6900);
  assert.equal(await bild(), 0, 'Der Rücklauf ist wieder bei Bild 0');
  // Lottie rundet die Koordinaten einer transformierten Untergruppe auf zwei
  // Stellen. Beim ersten Zeichnen kann derselbe Pfad noch volle Präzision haben.
  const aufHundertstel = (d) => d.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi,
    (zahl) => String(Math.round(Number(zahl) * 100) / 100));
  assert.deepEqual((await start()).map(aufHundertstel), original.map(aufHundertstel),
    'Der Rücklauf trifft alle Ausgangskonturen mit der Zeichenpräzision des Lottie-Renderers');
  await seite.evaluate(() => window.aufraeumen());
  assert.equal(await seite.locator('.agency-animation').count(), 0, 'Der Lottie-Player räumt seine Zeichenfläche auf');
  assert.equal(await seite.locator('.agency-wortmarke-text').textContent(), 'pixi', 'Der ruhende Text ist weiterhin vorhanden');
  console.log('M555: Originale VAVE-Zeitachse und Lottie-Bildfolge für „pixi“.');
} finally {
  await browser.close();
}
