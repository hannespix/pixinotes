// M549: Die Agency-Wortmarke steht vor dem Laden der Bewegung. In der Kopfleiste reagiert
// der Agency-Zeiger auf Mausziele und lässt dem Board seine Werkzeuge.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { chromium } from 'playwright-core';

const PORT = 5549;
const HOST = '127.0.0.1';
const dist = new URL('../dist/', import.meta.url);
const typen = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
const server = http.createServer(async (anfrage, antwort) => {
  try {
    const datei = new URL(`./${(anfrage.url ?? '/').split('?')[0].slice(1) || 'index.html'}`, dist);
    if (!datei.pathname.startsWith(dist.pathname)) { antwort.writeHead(404).end(); return; }
    const inhalt = await readFile(datei);
    antwort.writeHead(200, { 'Content-Type': typen[datei.pathname.split('.').at(-1)] ?? 'application/octet-stream' });
    antwort.end(inhalt);
  } catch {
    antwort.writeHead(404).end();
  }
});
await new Promise((fertig) => server.listen(PORT, HOST, fertig));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
let fehler = 0;
const pruefe = (name, erfuellt) => {
  try { assert.ok(erfuellt); console.log(`  ✓ ${name}`); }
  catch { fehler += 1; console.log(`  ✗ ${name}`); }
};

try {
  for (const [breite, thema] of [[390, 'dark'], [1280, 'light']]) {
    const seite = await browser.newPage({ viewport: { width: breite, height: 800 }, colorScheme: thema, serviceWorkers: 'block' });
    await seite.addInitScript((theme) => {
      localStorage.setItem('pixinotes-onboarded', '1');
      sessionStorage.setItem('pixinotes-hint-shown', '1');
      localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ ui: { design: 'agency', theme } }));
      localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
        boards: [{ id: 'b0', name: 'Studio', nodes: [], edges: [], drawings: [], comments: [] }],
        activeId: 'b0', view: 'board', cardFocus: false, navLinks: false,
      } }));
    }, thema);
    let blockiert = false;
    await seite.route(/\/assets\/agencyLogo-[^/]+\.js$/, (route) => {
      blockiert = true;
      return route.abort();
    });
    await seite.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'networkidle' });
    const knopf = seite.getByRole('button', { name: /PixiNotes – zur Übersicht/ });
    await knopf.waitFor();

    const marke = await knopf.evaluate((el) => {
      const pixi = el.querySelector('.agency-wortmarke-text');
      const notes = el.querySelector('.agency-notes');
      const punkt = el.querySelector('.agency-trennpunkt');
      if (!pixi || !notes || !punkt) return null;
      const stil = getComputedStyle(pixi);
      const { width, height } = punkt.getBoundingClientRect();
      return {
        pixi: pixi.textContent, notes: notes.textContent,
        sichtbar: stil.visibility === 'visible' && getComputedStyle(notes).visibility === 'visible',
        punkt: width > 0 && height > 0 ? getComputedStyle(punkt).backgroundColor : '',
        schrift: stil.fontFamily, breite: el.offsetWidth,
      };
    });
    const violett = thema === 'dark' ? 'rgb(154, 107, 255)' : 'rgb(100, 29, 255)';
    pruefe(`${breite}px: pixi · notes mit violettem Punkt steht auch bei ausgefallenem Animationsmodul`,
      blockiert && marke?.pixi === 'pixi' && marke.notes === 'notes' && marke.sichtbar && marke.punkt === violett);
    pruefe(`${breite}px: Die Wortmarke steht in Readex Pro und passt in die Kopfleiste`,
      marke?.schrift.includes('PN Readex') && marke.breite < 135);

    await knopf.focus();
    await seite.keyboard.press('Enter');
    await seite.waitForFunction(() => document.querySelector('.logo')?.getAttribute('aria-current') === 'page');
    const aktiv = await knopf.evaluate((el) => ({ linie: getComputedStyle(el, '::before').content,
      fokus: el.matches(':focus-visible') && getComputedStyle(el).outlineStyle === 'solid' }));
    pruefe(`${breite}px: Enter öffnet die Übersicht mit sichtbarem Tastaturfokus`, aktiv.fokus);
    pruefe(`${breite}px: Die aktive Übersicht unterstreicht die Marke nicht`, aktiv.linie === 'none');
    await seite.close();
  }

  const seite = await browser.newPage({ viewport: { width: 1600, height: 950 }, serviceWorkers: 'block' });
  await seite.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ anzeige: 1.3, navLinks: false, ui: { design: 'agency' } }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Studio', nodes: [], edges: [], drawings: [], comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false,
    } }));
  });
  await seite.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'networkidle' });
  const ziel = seite.locator('.logo');
  const zeiger = seite.locator('.agency-zeiger');
  await ziel.hover();
  const sichtbar = await zeiger.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
  const position = sichtbar && await zeiger.evaluate((el) => {
    const ring = el.getBoundingClientRect();
    const knopf = document.querySelector('.logo');
    const rect = knopf.getBoundingClientRect();
    return document.documentElement.style.zoom === '1.3'
      && Math.abs(ring.x + ring.width / 2 - rect.x - rect.width / 2) < 2
      && Math.abs(ring.y + ring.height / 2 - rect.y - rect.height / 2) < 2
      && getComputedStyle(knopf).cursor === 'none';
  });
  pruefe('Der Agency-Zeiger reagiert bei 130 % exakt am Mauspunkt und lässt Klicks durch',
    position && await zeiger.evaluate((el) => getComputedStyle(el).pointerEvents === 'none' && el.classList.contains('aktiv')));
  await seite.mouse.move(870, 530);
  pruefe('Über dem Board übernimmt der normale Werkzeugzeiger', !(await zeiger.isVisible()));
  await seite.locator('.tab-name').dblclick();
  const feld = seite.locator('input.tab-name');
  await feld.hover();
  pruefe('Beim Umbenennen eines Tabs bleibt der Textzeiger', !(await zeiger.isVisible())
    && await feld.evaluate((el) => getComputedStyle(el).cursor !== 'none'));
  await seite.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`M549: ${11 - fehler} bestanden, ${fehler} fehlgeschlagen`);
process.exitCode = fehler ? 1 : 0;
