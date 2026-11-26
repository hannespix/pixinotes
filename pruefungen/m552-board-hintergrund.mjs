/** M552: Globales Board-Muster, bisherige Voreinstellung, Raster-Fang und mobile Auswahl. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';

const PORT = 5552;
const HOST = '127.0.0.1';
const DIST = process.env.PN_DIST ? pathToFileURL(path.resolve(process.env.PN_DIST) + path.sep) : new URL('../dist/', import.meta.url);
const TYPEN = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
const server = http.createServer(async (anfrage, antwort) => {
  try {
    const datei = new URL(`./${(anfrage.url ?? '/').split('?')[0].slice(1) || 'index.html'}`, DIST);
    if (!datei.pathname.startsWith(DIST.pathname)) { antwort.writeHead(404).end(); return; }
    const inhalt = await readFile(datei);
    antwort.writeHead(200, { 'Content-Type': TYPEN[datei.pathname.split('.').at(-1)] ?? 'application/octet-stream' });
    antwort.end(inhalt);
  } catch {
    antwort.writeHead(404).end();
  }
});
await new Promise((fertig) => server.listen(PORT, HOST, fertig));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
let bestanden = 0;
const pruefe = (name, erfuellt) => {
  assert.ok(erfuellt, name);
  bestanden += 1;
  console.log(`  ✓ ${name}`);
};

const stand = {
  boards: [
    { id: 'b1', name: 'Papier', nodes: [], edges: [], drawings: [], comments: [] },
    { id: 'b2', name: 'Blau', bg: 'blau', nodes: [], edges: [], drawings: [], comments: [] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false,
};
async function seite({ vorlieben = {}, mobil = false } = {}) {
  const P = await browser.newPage({
    viewport: mobil ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: mobil, isMobile: mobil, locale: 'de-DE', serviceWorkers: 'block',
  });
  P.setDefaultTimeout(6500);
  await P.addInitScript(({ st, v }) => {
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({
      schliff: 2, navLinks: false, ui: { theme: 'light', design: 'agency', accent: 'orange' }, ...v,
    }));
  }, { st: stand, v: vorlieben });
  await P.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'networkidle' });
  await P.locator('.board-wrap .react-flow').waitFor();
  return P;
}
const vorlieben = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen') ?? '{}'));
const gruppe = (P) => P.locator('[data-taste="board-muster"]');
const musterKnopf = (P, wert) => gruppe(P).locator(`[data-board-muster="${wert}"]`);
const gewaehlt = (P) => gruppe(P).locator('button[aria-pressed="true"]').getAttribute('data-board-muster');
const knopfePassen = (P) => gruppe(P).evaluate((e) => {
  const gruppe = e.getBoundingClientRect();
  const knopfe = [...e.querySelectorAll('button')];
  return knopfe.length === 4 && e.scrollWidth <= e.clientWidth + 1 && knopfe.every((knopf) => {
    const r = knopf.getBoundingClientRect();
    return r.width > 0 && r.height > 0
      && r.left >= Math.max(0, gruppe.left) - 1 && r.right <= Math.min(innerWidth, gruppe.right) + 1
      && r.top >= gruppe.top - 1 && r.bottom <= gruppe.bottom + 1;
  });
});
async function oeffne(P) {
  await P.locator('[data-taste="einstellungen"]').first().click();
  await gruppe(P).waitFor({ timeout: 4300 });
}
async function schliesse(P) {
  await P.locator('.modal-x').first().click();
  await gruppe(P).waitFor({ state: 'detached' });
}
async function form(P, variante) {
  const muster = P.locator('.board-wrap .react-flow__background');
  if (variante === 'clean') {
    await muster.waitFor({ state: 'detached' });
    return await muster.count() === 0;
  }
  const klasse = { dots: 'dots', linien: 'lines', kreuze: 'cross' }[variante];
  const tag = variante === 'dots' ? 'circle' : 'path';
  const element = muster.locator(`pattern ${tag}.react-flow__background-pattern.${klasse}`);
  await element.waitFor({ state: 'attached' });
  if (variante === 'dots') return true;
  const abstand = await element.evaluate((el) => {
    const viewport = el.closest('.react-flow').querySelector('.react-flow__viewport');
    const matrix = getComputedStyle(viewport).transform;
    const zoom = matrix === 'none' ? 1 : new DOMMatrixReadOnly(matrix).a;
    return Number(el.parentElement.getAttribute('width')) / zoom;
  });
  return Math.abs(abstand - (variante === 'linien' ? 20 : 26)) < 0.1;
}

try {
  const P = await seite();
  pruefe('A Alter Stand ohne Raster-Fang zeigt wie bisher Punkte', await form(P, 'dots'));
  await oeffne(P);
  const anordnung = await gruppe(P).evaluate((e) => {
    const zeile = e.closest('.modal-row');
    return {
      titel: zeile?.querySelector('span')?.textContent.trim(),
      nachDesign: !!zeile?.previousElementSibling?.querySelector('[data-taste="design"]'),
      abschnitt: zeile?.closest('section')?.querySelector('h3')?.textContent.trim(),
    };
  });
  pruefe('B Darstellung → Aussehen zeigt Board-Hintergrund direkt nach Design',
    anordnung.titel === 'Board-Hintergrund' && anordnung.nachDesign && anordnung.abschnitt === 'Aussehen');
  pruefe('B Die vier beschrifteten Wahlen zeigen Dots als aktuelle Wahl',
    (await gruppe(P).locator('button').allTextContents()).map((s) => s.trim()).join('/') === 'Clean/Dots/Linien/Kreuze'
    && await gewaehlt(P) === 'dots');
  for (const [variante, beschreibung] of [['linien', 'Linien im Abstand von 20'], ['kreuze', 'Kreuze im Abstand von 26'], ['dots', 'Punkte'], ['clean', 'Kein Muster-SVG']]) {
    await musterKnopf(P, variante).click();
    pruefe(`C ${beschreibung}, Wahl gesetzt und gespeichert`,
      await form(P, variante) && await gewaehlt(P) === variante && (await vorlieben(P)).boardMuster === variante);
  }
  await schliesse(P);
  await P.mouse.click(1370, 790);
  await P.keyboard.press('Alt+r');
  await P.waitForFunction(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen')).gridSnap === true);
  pruefe('D Alt+R schaltet Raster-Fang ein und Clean bleibt frei', await form(P, 'clean') && (await vorlieben(P)).boardMuster === 'clean');

  const blau = P.getByRole('tab', { name: /^Blau/ });
  await blau.click();
  const blauFlaeche = P.locator('.board-wrap.board-bg-blau .react-flow');
  await blauFlaeche.waitFor();
  pruefe('E Auf dem zweiten Board gilt Clean über der eigenen blauen Fläche',
    await form(P, 'clean') && await blauFlaeche.evaluate((el) => getComputedStyle(el).backgroundColor) === 'rgb(232, 240, 248)');
  await P.reload({ waitUntil: 'networkidle' });
  await blauFlaeche.waitFor();
  await oeffne(P);
  pruefe('E Clean und Raster-Fang überstehen das Neuladen',
    await form(P, 'clean') && await gewaehlt(P) === 'clean' && (await vorlieben(P)).gridSnap === true);
  await P.close();

  const mobil = await seite({ mobil: true, vorlieben: { gridSnap: true } });
  pruefe('F Alter Stand mit Raster-Fang zeigt wie bisher Linien', await form(mobil, 'linien'));
  await oeffne(mobil);
  pruefe('F Mobil passen bei 100 % alle vier Wahlen unbeschnitten in die Gruppe',
    await gewaehlt(mobil) === 'linien' && await knopfePassen(mobil));
  await musterKnopf(mobil, 'dots').tap();
  pruefe('F Mobil lassen sich Punkte bei aktivem Raster-Fang ausdrücklich wählen',
    await form(mobil, 'dots') && await gewaehlt(mobil) === 'dots' && (await vorlieben(mobil)).gridSnap === true
    && (await vorlieben(mobil)).boardMuster === 'dots');

  await mobil.getByRole('group', { name: 'Anzeigegröße' }).getByRole('button', { name: '175 %', exact: true }).tap();
  await mobil.waitForFunction(() => getComputedStyle(document.documentElement).zoom === '1.75');
  await gruppe(mobil).scrollIntoViewIfNeeded();
  pruefe('F Mobil passen bei 175 % alle vier Wahlen unbeschnitten in die Gruppe', await knopfePassen(mobil));
  await musterKnopf(mobil, 'kreuze').tap();
  pruefe('F Mobil lassen sich auch bei 175 % Kreuze wählen', await form(mobil, 'kreuze') && await gewaehlt(mobil) === 'kreuze');
  await mobil.close();

  const ungueltig = await seite({ vorlieben: { boardMuster: 'ungueltig', gridSnap: true } });
  await oeffne(ungueltig);
  pruefe('G Eine unbekannte Alt-Vorliebe fällt auf das bisherige Raster zurück',
    await form(ungueltig, 'linien') && await gewaehlt(ungueltig) === 'linien');
  await ungueltig.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`M552: ${bestanden} bestanden, 0 fehlgeschlagen.`);
