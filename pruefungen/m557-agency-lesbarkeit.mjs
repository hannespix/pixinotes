// M557: Zweitschrift, ausgewählte Segmente und Tastaturfokus in Agency.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { kontrastScan } from '../werkzeug/kontrast-pruefen.mjs';

const DIST = process.env.PN_DIST ?? fileURLToPath(new URL('../dist/', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const PORT = 5557;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer(async (anfrage, antwort) => {
  const url = new URL(anfrage.url, `http://localhost:${PORT}`);
  const datei = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
  try {
    const inhalt = await readFile(datei);
    antwort.writeHead(200, { 'Content-Type': TYP[path.extname(datei)] ?? 'application/octet-stream' });
    antwort.end(inhalt);
  } catch {
    antwort.writeHead(404).end();
  }
});

function kontrast(a, b) {
  function leuchtdichte(farbe) {
    const zahlen = farbe.match(/\d+/g).map((v) => Number(v) / 255);
    return [.2126, .7152, .0722].reduce((summe, gewicht, i) => {
      const c = zahlen[i];
      return summe + gewicht * (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    }, 0);
  }
  const [dunkler, heller] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => x - y);
  return (heller + .05) / (dunkler + .05);
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
await new Promise((fertig) => server.listen(PORT, fertig));
const fehler = [];
try {
  for (const theme of ['light', 'dark']) {
    const seite = await browser.newPage({ viewport: { width: 1220, height: 900 }, locale: 'de-DE', colorScheme: theme });
    await seite.addInitScript((theme) => {
      localStorage.setItem('pixinotes-onboarded', '1');
      sessionStorage.setItem('pixinotes-hint-shown', '1');
      localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, ui: { design: 'agency', theme } }));
    }, theme);
    await seite.goto(`http://localhost:${PORT}/`);
    await seite.locator('[data-taste="einstellungen"]').first().click();
    await seite.getByRole('group', { name: 'Design', exact: true }).waitFor();
    await seite.waitForFunction(() => ['.modal-backdrop', '.modal'].every((sel) =>
      getComputedStyle(document.querySelector(sel)).opacity === '1'));

    const hinweise = () => kontrastScan(seite, '.modal-section', { alle: true });
    const werte = async () => {
      const texte = await hinweise();
      const finde = (text) => texte.find((t) => t.text.startsWith(text))?.v ?? 0;
      return { titel: finde('Aussehen'), hinweis: finde('„System" folgt'), segment: finde('Klassisch') };
    };
    const normal = await werte();
    const aktiv = seite.getByRole('button', { name: 'Agency', exact: true });
    const segment = await aktiv.evaluate((e) => getComputedStyle(e.parentElement).backgroundColor);
    const ring = async () => {
      const farbe = await aktiv.evaluate((e) => getComputedStyle(e).boxShadow.split(/,(?![^()]*\))/)
        .find((schatten) => /inset/.test(schatten))?.match(/rgb\([^)]*\)/)?.[0] ?? null);
      return farbe ? kontrast(farbe, segment) : 0;
    };
    const auswahl = await ring();
    await aktiv.hover();
    const hover = await ring();
    await seite.getByRole('button', { name: 'pix·el', exact: true }).focus();
    await seite.keyboard.press('Tab');
    const fokus = await aktiv.evaluate((e) => {
      const s = getComputedStyle(e);
      return { sichtbar: e.matches(':focus-visible'), breite: parseFloat(s.outlineWidth), farbe: s.outlineColor };
    });
    const fokusKontrast = kontrast(fokus.farbe, segment);
    await seite.getByLabel('Besser lesbar').check();
    await seite.waitForSelector('html[data-kontrast="hoch"][data-lesbar="an"]');
    await seite.locator('.modal-body').evaluate((e) => { e.scrollTop = 0; });
    const hoch = await werte();
    console.log(`${theme}: ${JSON.stringify({ normal, auswahl, hover, fokusKontrast, hoch })}`);
    const grenze = theme === 'light' ? { titel: 7, hinweis: 7, segment: 6.5 } : { titel: 8, hinweis: 8, segment: 8.5 };
    for (const [name, minimum] of Object.entries(grenze)) {
      if (normal[name] < minimum) fehler.push(`${theme} ${name} ≥ ${minimum}:1 (gemessen ${normal[name]}:1)`);
    }
    if (auswahl < 3 || hover < 3) fehler.push(`${theme}: Auswahlkante auch unter der Maus ≥ 3:1`);
    if (!fokus.sichtbar || fokus.breite < 2 || fokusKontrast < 3) fehler.push(`${theme}: Sichtbarer Tastaturfokus ≥ 3:1`);
    if (hoch.hinweis <= normal.hinweis || hoch.segment <= normal.segment) fehler.push(`${theme}: „Besser lesbar“ verstärkt die Zweitschrift weiter`);
    await seite.close();
  }
  assert.deepEqual(fehler, []);
} finally {
  await browser.close();
  server.close();
}
