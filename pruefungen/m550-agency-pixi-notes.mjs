// M550: Auf einem Touch-Gerät ohne Maus atmet „pixi“ selbstständig. Punkt, Zusatz
// und Klickfläche stehen fest. Am Ende der Pause folgt der nächste Zug.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';

const PORT = 5550;
const HOST = '127.0.0.1';
const dist = process.env.PN_DIST ? pathToFileURL(path.resolve(process.env.PN_DIST) + path.sep) : new URL('../dist/', import.meta.url);
const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const datei = new URL(`./${(req.url ?? '/').split('?')[0].slice(1) || 'index.html'}`, dist);
    if (!datei.pathname.startsWith(dist.pathname)) { res.writeHead(404).end(); return; }
    const inhalt = await readFile(datei);
    res.writeHead(200, { 'Content-Type': mime[datei.pathname.split('.').at(-1)] ?? 'application/octet-stream' });
    res.end(inhalt);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((fertig) => server.listen(PORT, HOST, fertig));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
let ok = 0;
let fehler = 0;
function pruefe(name, erfuellt) {
  if (erfuellt) { ok++; console.log(`  ✓ ${name}`); }
  else { fehler++; console.log(`  ✗ ${name}`); }
}

try {
  const seite = await browser.newPage({
    viewport: { width: 390, height: 800 }, colorScheme: 'dark', isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
  await seite.clock.install();
  await seite.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ ui: { design: 'agency', theme: 'dark' }, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Studio', nodes: [], edges: [], drawings: [], comments: [] }],
      activeId: 'b0', view: 'board', navLinks: false,
    } }));
  });
  await seite.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'networkidle' });
  const knopf = seite.locator('.logo');
  const wortmarke = knopf.locator('.agency-pixi[data-agency-frame]');
  await wortmarke.locator('svg path[d]').first().waitFor();
  await seite.evaluate(() => document.fonts.ready);
  const anfang = await knopf.evaluate((el) => {
    const punkt = el.querySelector('.agency-trennpunkt');
    const notes = el.querySelector('.agency-notes');
    if (!punkt || !notes) return null;
    const farbprobe = document.createElement('span');
    farbprobe.hidden = true;
    farbprobe.style.backgroundColor = 'var(--accent)';
    el.append(farbprobe);
    const akzent = getComputedStyle(farbprobe).backgroundColor;
    farbprobe.remove();
    const form = punkt.getBoundingClientRect();
    return { pixi: el.querySelector('.agency-wortmarke-text').textContent, notes: notes.textContent,
      farbe: getComputedStyle(punkt).backgroundColor, akzent, punkt: [form.x, form.y, form.width, form.height] };
  });
  pruefe('Die Wortmarke zeigt pixi und notes mit rundem Trennpunkt in der Akzentfarbe',
    anfang?.pixi === 'pixi' && anfang.notes === 'notes'
    && anfang.farbe === anfang.akzent && anfang.farbe !== 'rgba(0, 0, 0, 0)'
    && anfang.punkt[2] > 2 && anfang.punkt[2] === anfang.punkt[3]);
  const box = await knopf.boundingBox();
  const notizBox = anfang && await knopf.locator('.agency-notes').boundingBox();
  const werte = [];
  // Der erste Zug dauert mit Ruhephasen und Timing-Variation bis zu 17,04 Sekunden.
  for (let vergangen = 0; vergangen < 21_600; vergangen += 400) {
    await seite.clock.runFor(400);
    werte.push(await wortmarke.evaluate((el) => Number(el.dataset.agencyFrame) / 25));
  }
  const hoch = werte.findIndex((t) => t > 0.78);
  const ruhend = hoch < 0 ? -1 : werte.findIndex((t, i) => i > hoch && t === 0 && werte[i + 1] === 0);
  pruefe('Touch: Die Wortmarke verändert sich ohne Zeiger und kehrt in ihre Ruheform zurück', hoch >= 0 && ruhend > hoch);
  pruefe('Nach der Ruhephase beginnt selbstständig eine weitere Bewegung',
    ruhend >= 0 && werte.slice(ruhend + 2).some((t) => t > 0.03));
  pruefe('Punkt, notes und Klickfläche stehen beim Atmen fest', !!anfang
    && JSON.stringify(box) === JSON.stringify(await knopf.boundingBox())
    && JSON.stringify(notizBox) === JSON.stringify(await knopf.locator('.agency-notes').boundingBox())
    && JSON.stringify(anfang.punkt) === JSON.stringify(await knopf.locator('.agency-trennpunkt').evaluate((e) => {
      const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    })));
  await knopf.tap();
  await seite.waitForFunction(() => document.querySelector('.logo')?.getAttribute('aria-current') === 'page');
  pruefe('Der erste Tipp öffnet die Übersicht und zeigt keinen Mauszeiger', !(await seite.locator('.agency-zeiger').isVisible()));
} finally {
  await browser.close();
  server.close();
}
console.log(`M550: ${ok} bestanden, ${fehler} fehlgeschlagen`);
assert.equal(fehler, 0);
