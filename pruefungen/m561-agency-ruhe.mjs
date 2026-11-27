// M561: Ruhende Agency-Wortmarke, Systemzeiger und Zugang zur Übersicht.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dist = path.resolve(process.env.PN_DIST ?? fileURLToPath(new URL('../dist/', import.meta.url)));
const typ = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer(async (anfrage, antwort) => {
  try {
    const name = decodeURIComponent(new URL(anfrage.url, 'http://127.0.0.1').pathname);
    const datei = path.resolve(dist, `.${name === '/' ? '/index.html' : name}`);
    if (datei === dist || !datei.startsWith(dist + path.sep)) { antwort.writeHead(404).end(); return; }
    const inhalt = await readFile(datei);
    antwort.writeHead(200, { 'Content-Type': typ[path.extname(datei)] ?? 'application/octet-stream' });
    antwort.end(inhalt);
  } catch {
    antwort.writeHead(404).end();
  }
});
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
await new Promise((fertig) => server.listen(0, '127.0.0.1', fertig));
const adresse = `http://127.0.0.1:${server.address().port}/`;

let bestanden = 0;
let fehlgeschlagen = 0;
function pruefe(name, ok) {
  if (ok) bestanden++;
  else fehlgeschlagen++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
}

async function oeffnen({ theme = 'light', touch = false, design = 'agency', lesbar = false } = {}) {
  const seite = await browser.newPage({ viewport: { width: touch ? 390 : 1280, height: 800 },
    colorScheme: theme, isMobile: touch, hasTouch: touch, serviceWorkers: 'block',
    reducedMotion: lesbar ? 'reduce' : 'no-preference', locale: 'de-DE' });
  await seite.addInitScript(({ theme, design, lesbar }) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ ui: { design, theme }, navLinks: false, lesbareSchrift: lesbar }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Studio', nodes: [], edges: [], drawings: [], comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', navLinks: false,
    } }));
  }, { theme, design, lesbar });
  const anfragen = [];
  seite.on('request', (anfrage) => anfragen.push(anfrage.url()));
  await seite.goto(adresse, { waitUntil: 'networkidle' });
  const logo = seite.getByRole('button', { name: 'PixiNotes – zur Übersicht' });
  await logo.waitFor();
  return { seite, logo, anfragen };
}

function erscheinung(logo) {
  return logo.evaluate((knopf) => {
    const marke = knopf.querySelector('.agency-wortmarke');
    const pixi = marke.querySelector('.agency-pixi');
    const notes = marke.querySelector('.agency-notes');
    return { pixi: pixi.textContent, notes: notes.textContent, schrift: getComputedStyle(pixi).fontFamily,
      sichtbar: [pixi, notes].every((e) => getComputedStyle(e).visibility === 'visible' && e.getClientRects().length > 0),
      punkt: getComputedStyle(marke.querySelector('.agency-trennpunkt')).backgroundColor,
      ruhe: !marke.querySelector('svg, [data-agency-frame]') && marke.getAnimations({ subtree: true }).length === 0 };
  });
}

try {
  const { seite, logo, anfragen } = await oeffnen();
  const hell = await erscheinung(logo);
  pruefe('Agency zeigt pixi · notes in Readex Pro mit violettem Punkt',
    hell.pixi === 'pixi' && hell.notes === 'notes' && hell.sichtbar && /Readex/.test(hell.schrift) && hell.punkt === 'rgb(100, 29, 255)');
  await logo.hover();
  pruefe('Wortmarke steht im Leerlauf und beim Zeigen still', hell.ruhe && (await erscheinung(logo)).ruhe);
  const hilfe = seite.locator('.topbar [data-taste="hilfe"]');
  await hilfe.hover();
  pruefe('Die Leiste zeigt den nativen Handzeiger', await hilfe.evaluate((e) => getComputedStyle(e).cursor === 'pointer')
    && await seite.locator('.agency-zeiger').count() === 0);
  pruefe('Agency lädt keine Logo-Animation', !anfragen.some((url) => /\/assets\/(?:agencyLogo|lottie)/i.test(url)));

  await seite.locator('.tab-name').first().dblclick();
  const feld = seite.locator('.tab input').first();
  await feld.hover();
  pruefe('Beim Umbenennen eines Boards bleibt der native Textzeiger', await feld.evaluate((e) => getComputedStyle(e).cursor === 'text'));
  await seite.keyboard.press('Escape');
  await seite.keyboard.press('Tab');
  await logo.focus();
  pruefe('Die Wortmarke hat sichtbaren Tastaturfokus', await logo.evaluate((e) => e.matches(':focus-visible')
    && getComputedStyle(e).outlineStyle === 'solid'));
  await seite.keyboard.press('Enter');
  await seite.waitForFunction(() => document.querySelector('.logo')?.getAttribute('aria-current') === 'page');
  pruefe('Enter öffnet die Übersicht mit der Wortmarke als aktueller Seite', await logo.getAttribute('aria-current') === 'page');
  pruefe('Die aktive Übersicht zeigt die ruhige Wortmarke ohne Unterstrich',
    await logo.evaluate((e) => getComputedStyle(e, '::before').content === 'none'));
  await seite.close();

  const dunkel = await oeffnen({ theme: 'dark', touch: true });
  const mobil = await erscheinung(dunkel.logo);
  pruefe('Auf Touch in Dunkel bleibt die vollständige Wortmarke sichtbar', mobil.sichtbar && mobil.ruhe
    && mobil.punkt === 'rgb(154, 107, 255)' && (await dunkel.logo.boundingBox()).width < 135);
  pruefe('In Agency Dunkel steht die hellere Wortmarkenfläche auf Anthrazit', await dunkel.logo.evaluate((e) =>
    getComputedStyle(e).backgroundColor === 'rgb(48, 51, 44)'
    && getComputedStyle(document.querySelector('.react-flow')).backgroundColor === 'rgb(40, 43, 37)'));
  await dunkel.logo.tap();
  await dunkel.seite.waitForFunction(() => document.querySelector('.logo')?.getAttribute('aria-current') === 'page');
  pruefe('Der erste Tipp öffnet die Übersicht', await dunkel.logo.getAttribute('aria-current') === 'page');
  await dunkel.seite.close();

  const lesbar = await oeffnen({ lesbar: true });
  const ruhig = await erscheinung(lesbar.logo);
  pruefe('Mit „Besser lesbar“ und reduzierter Bewegung bleibt der Text in Atkinson lesbar',
    ruhig.sichtbar && ruhig.ruhe && /Atkinson/.test(ruhig.schrift));
  await lesbar.seite.close();

  const pixel = await oeffnen({ design: 'pixel' });
  pruefe('pix·el zeigt seinen eigenen Schriftzug', await pixel.logo.innerHTML() === 'Pixi<span>Notes</span>');
  await pixel.seite.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`M561 Agency: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
assert.equal(fehlgeschlagen, 0);
