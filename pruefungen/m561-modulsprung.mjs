// M561: Der Klick im Baum zeigt und markiert das Modul in der freien Board-Fläche.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = 5561;
const DIST = path.resolve(process.env.PN_DIST ?? fileURLToPath(new URL('../dist', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ziel = path.resolve(DIST, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
  if (!ziel.startsWith(`${DIST}${path.sep}`)) { res.writeHead(404).end(); return; }
  try {
    const inhalt = await readFile(ziel);
    res.writeHead(200, { 'Content-Type': mime[path.extname(ziel)] ?? 'application/octet-stream' }).end(inhalt);
  } catch { res.writeHead(404).end(); }
});
await new Promise((fertig) => server.listen(PORT, '127.0.0.1', fertig));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });

const kanban = (id, title, x, y, width, height) => ({ id, type: 'kanban', position: { x, y }, width, height,
  data: { title, items: [{ id: `${id}-1`, text: 'Erster Schritt', col: 0 }] } });
const form = (id, text, x, y, width, height) => ({ id, type: 'shape', position: { x, y }, width, height,
  data: { shape: 'process', text, color: '#eef2ff' } });
const bretter = {
  boards: [
    { id: 'a', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [
      kanban('normal', 'Sitzungsplanung', 1900, 1050, 460, 270),
      form('klein', 'Kleine Markierung', -320, -100, 108, 62),
      kanban('gross', 'Großer Arbeitsplan', -3700, 460, 2000, 980),
    ] },
    { id: 'b', name: 'Abnahme', edges: [], drawings: [], comments: [], nodes: [
      kanban('anderes', 'Abnahmeübersicht', 2450, -1800, 530, 300),
      form('wechsel', 'Kontrollpunkt', -780, -120, 160, 90),
    ] },
  ],
  spaces: [{ id: 's', name: 'Räume', projects: [{ id: 'p', name: 'Projekt', boardIds: ['a', 'b'] }] }],
  activeId: 'a', view: 'board', cardFocus: true, navLinks: true,
};

async function seite({ mobil = false, anzeige = 1 } = {}) {
  const P = await browser.newPage({ viewport: mobil ? { width: 390, height: 760 } : { width: 1440, height: 900 },
    isMobile: mobil, hasTouch: mobil, locale: 'de-DE', serviceWorkers: 'block' });
  P.setDefaultTimeout(9000);
  await P.addInitScript(({ bretter, anzeige }) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ anzeige, navLinks: true, schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: bretter }));
  }, { bretter, anzeige });
  await P.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await P.locator('.react-flow__node[data-id="normal"]').waitFor();
  return P;
}

const knopf = (P, titel) => P.locator('.side-card', { hasText: titel });
const kartenKnoten = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`);
let bestanden = 0;
function pruefe(name, gut, messung = '') {
  assert.ok(gut, `${name}${messung ? ` ${JSON.stringify(messung)}` : ''}`);
  bestanden++;
  console.log(`  ✓ ${name}`);
}

async function landung(P, id, { min = 0.2, max = 2.2, zuGross = false } = {}) {
  const handle = await P.waitForFunction(({ id, min, max, zuGross }) => {
    const flaeche = document.querySelector('.board-wrap .react-flow');
    const karte = flaeche?.querySelector(`.react-flow__node[data-id="${id}"].selected`);
    if (!karte || document.querySelector('.app.focus-mode')) return null;
    const f = flaeche.getBoundingClientRect();
    const breite = Math.min(f.right, innerWidth) - f.left;
    let oben = f.top;
    for (const leiste of document.querySelectorAll('.topbar, .tabs:not(.spalte)')) {
      const r = leiste.getBoundingClientRect();
      if (r.width && r.right > f.left && r.left < f.right) oben = Math.max(oben, r.bottom);
    }
    const unten = Math.min(f.bottom, innerHeight, document.querySelector('.dock')?.getBoundingClientRect().top ?? Infinity);
    const r = karte.getBoundingClientRect();
    const zoom = new DOMMatrixReadOnly(getComputedStyle(flaeche.querySelector('.react-flow__viewport')).transform).a;
    if (zoom < min || zoom > max) return null;
    if (zuGross) {
      const titel = karte.querySelector('.kanban-title');
      if (!titel) return null;
      const bereich = document.createRange();
      bereich.selectNodeContents(titel);
      const t = bereich.getBoundingClientRect();
      const sichtbar = t.width > 0 && t.left >= f.left && t.right <= f.left + breite && t.top >= oben && t.bottom <= unten
        && titel.contains(document.elementFromPoint((t.left + t.right) / 2, (t.top + t.bottom) / 2));
      const amAnfang = r.left - f.left >= 4 && r.left - f.left < 36 && r.top >= oben
        && (r.height <= unten - oben || r.top - oben < 36);
      return r.width > breite && amAnfang && sichtbar ? { zoom, titel: t.width } : null;
    }
    const zentriert = Math.abs((r.left + r.right) / 2 - (f.left + breite / 2)) <= 12
      && Math.abs((r.top + r.bottom) / 2 - (oben + unten) / 2) <= 12;
    return zentriert && r.left >= f.left && r.right <= f.left + breite
      && r.top >= oben && r.bottom <= unten ? { zoom, width: r.width, height: r.height } : null;
  }, { id, min, max, zuGross });
  return handle.jsonValue();
}

try {
  const P = await seite();
  await P.locator('.react-flow__viewport').evaluate((element) => {
    const bilder = new Set();
    const beobachter = new MutationObserver(() => bilder.add(element.style.transform));
    beobachter.observe(element, { attributes: true, attributeFilter: ['style'] });
    window.flugZwischenschritte = () => { beobachter.disconnect(); return bilder.size; };
  });
  await knopf(P, 'Sitzungsplanung').click();
  pruefe('Ein Klick im Baum öffnet die Karte auf dem Board', await P.locator('.app.focus-mode').count() === 0);
  pruefe('Die ausgewählte Karte steht lesbar in der Mitte rechts neben der Spalte', !!await landung(P, 'normal', { min: 1.15 }));
  pruefe('Die Kamera fährt in sichtbaren Zwischenschritten zur Karte', await P.evaluate(() => window.flugZwischenschritte()) >= 3);

  await knopf(P, 'Kleine Markierung').click();
  const klein = await landung(P, 'klein', { min: 1.2, max: 2.2 });
  pruefe('Kleine Karten werden beim Sprung nicht übermäßig vergrößert', klein.width <= 240, klein);
  await knopf(P, 'Großer Arbeitsplan').click();
  pruefe('Ein übergroßes Modul beginnt rechts neben der Spalte mit lesbarem Titel', !!await landung(P, 'gross', { min: 0.89, zuGross: true }));

  await P.locator('.side-board', { has: P.getByRole('button', { name: 'Abnahme', exact: true }) }).locator('.side-board-arrow').click();
  await knopf(P, 'Abnahmeübersicht').click();
  await knopf(P, 'Kontrollpunkt').click();
  pruefe('Beim Board-Wechsel landet die Kamera beim zuletzt gewählten Modul', !!await landung(P, 'wechsel', { min: 1.2 }));
  await knopf(P, 'Abnahmeübersicht').click();
  pruefe('Ein weiterer Klick führt erneut zum gewünschten Modul', !!await landung(P, 'anderes', { min: 1.15 }));

  const vor = await kartenKnoten(P, 'anderes').boundingBox();
  await P.mouse.move(1375, 195);
  await P.mouse.down();
  await P.mouse.move(1110, 245, { steps: 7 });
  await P.mouse.up();
  const nach = await kartenKnoten(P, 'anderes').boundingBox();
  assert.ok(nach.x < vor.x - 120, 'Die Kamera wurde vor dem erneuten Klick verschoben');
  await knopf(P, 'Abnahmeübersicht').click();
  pruefe('Dieselbe Karte lässt sich nach manuellem Schwenken erneut ins Bild holen', !!await landung(P, 'anderes', { min: 1.15 }));

  await kartenKnoten(P, 'anderes').dblclick({ position: { x: 8, y: 8 } });
  await P.locator('.app.focus-mode').waitFor();
  pruefe('Ein Doppelklick auf dem Board öffnet weiterhin den Fokusmodus', await kartenKnoten(P, 'anderes').evaluate((e) => e.classList.contains('pn-focused')));
  await P.close();

  const mobil = await seite({ mobil: true });
  await mobil.locator('[data-taste="navigator"]').first().tap();
  await knopf(mobil, 'Sitzungsplanung').tap();
  pruefe('Mobil schließt der Baum und die Karte passt ins sichtbare Board', await mobil.locator('.nav-panel').count() === 0
    && !!await landung(mobil, 'normal', { max: 0.85 }));
  await mobil.locator('[data-taste="navigator"]').first().tap();
  await knopf(mobil, 'Großer Arbeitsplan').tap();
  pruefe('Auch mobil beginnt ein übergroßes Modul mit sichtbarem Titel', !!await landung(mobil, 'gross', { min: 0.71, zuGross: true }));
  await mobil.close();

  const zoom = await seite({ anzeige: 1.3 });
  await knopf(zoom, 'Sitzungsplanung').click();
  pruefe('Auch bei 130 % liegt das Modul mittig in der verbleibenden Fläche', !!await landung(zoom, 'normal', { min: 1.25 }));
  await knopf(zoom, 'Großer Arbeitsplan').click();
  pruefe('Bei 130 % wächst die lesbare Mindestgröße des großen Moduls mit', !!await landung(zoom, 'gross', { min: 1.16, zuGross: true }));
  await zoom.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`M561: ${bestanden} bestanden, 0 fehlgeschlagen`);
