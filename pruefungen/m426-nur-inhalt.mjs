/**
 * M426 — „Nur Inhalt": Vollbild ohne Bedienung in Präsentation und Karten-Fokus.
 *
 * Gewünscht: „Im Präsentations- und im Fokus-Modus bitte auch ein Vollbild anbieten, welches alle UI-Elemente
 * ausblendet, für die perfekte Präsentation. Vielleicht wäre da auch ein einfacher passender Tastatur-Shortcut
 * praktisch. Also 100 % Content ohne Rahmen, Menüs etc.!"
 *
 *   A  Präsentation: Knopf „Nur Inhalt" und Taste F — keine Kopf- und Fußzeile, die Folie randlos über den ganzen
 *      Schirm; Pfeiltasten blättern weiter; Esc kehrt zur Bedienung zurück, die Präsentation bleibt offen.
 *   B  Karten-Fokus: Knopf und Taste F — keine Leisten, keine anderen Karten, kein Raster, kein Auswahlrahmen, keine
 *      Modul-Knöpfe; die Karte füllt den Schirm (eine Seite berührt den Rand); Vollbild des Browsers; Esc zurück,
 *      der Fokus bleibt offen; F schaltet hin und her.
 *   C  Beim Schreiben ist F ein Buchstabe.
 *   D  Rückweg ohne Tastatur: Die Kante oben zeigt beim Überfahren „Bedienung einblenden".
 *   E  Der Zeiger verschwindet, solange er ruht.
 *   F  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m426-nur-inhalt.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4764;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const KARTEN = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Quartal' }, { type: 'paragraph', content: 'Umsatz wächst' }] } },
  { id: 'k1', type: 'kanban', position: { x: 400, y: 0 }, width: 420, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße', col: 1 }] } },
];
const KANTEN = [{ id: 'e1', source: 'n1', target: 'k1', type: 'floating', data: {} }];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(([n, e]) => {
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: e, drawings: [], nodes: n }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false } }));
}, [KARTEN, KANTEN]);
const P = await ctx.newPage();
P.on('pageerror', (er) => fehler.push(er.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);
const sichtbar = (sel) => P.evaluate((s) => [...document.querySelectorAll(s)].some((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; }), sel);
const rein = () => P.evaluate(() => document.documentElement.dataset.rein ?? null);
const fokusAuf = async (id) => {
  const k = await P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  await P.mouse.click(k.x + Math.min(150, k.width / 2), k.y + 14); await P.waitForTimeout(250);
  await P.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => el.focus());
  await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
};

// ══ B: Karten-Fokus ══
console.log('\n════ B: Karten-Fokus ════');
await fokusAuf('k1');
pruefe('B0 Fokus offen, Knopf „Nur Inhalt" in der Kopfzeile', (await P.locator('.focus-head').count()) === 1 && (await P.locator('[data-taste="fokus-rein"]').count()) === 1);
await P.locator('[data-taste="fokus-rein"]').click(); await P.waitForTimeout(1300);
pruefe('B1 Knopf schaltet „Nur Inhalt" ein', (await rein()) === 'fokus');
pruefe('B2 keine Kopf- und Fußleiste', !(await sichtbar('.focus-head')) && !(await sichtbar('.focus-nav')));
pruefe('B3 keine anderen Karten, Pfeile, Raster', !(await sichtbar('.react-flow__node[data-id="n1"]')) && !(await sichtbar('.react-flow__edges')) && !(await sichtbar('.react-flow__background')));
pruefe('B4 keine Auswahl-Leiste, kein Auswahlrahmen, keine Griffe', !(await sichtbar('.sel-toolbar, .sel-toolbar-dock')) && !(await sichtbar('.react-flow__resize-control'))
  && await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="k1"]')).outlineStyle === 'none'));
pruefe('B5 keine Modul-Knöpfe (Neues Ticket, Suche, Menü)', !(await sichtbar('.react-flow__node[data-id="k1"] :is(.kanban-add, .kanban-addcol)')));
const karte = await P.locator('.react-flow__node[data-id="k1"]').boundingBox();
pruefe('B6 die Karte füllt den Schirm (eine Seite am Rand)', Math.abs(karte.width - 1440) < 3 || Math.abs(karte.height - 900) < 3, karte);
pruefe('B7 mittig', Math.abs(karte.x + karte.width / 2 - 720) < 4 && Math.abs(karte.y + karte.height / 2 - 450) < 4, karte);
pruefe('B8 Vollbild des Browsers', await P.evaluate(() => !!document.fullscreenElement));
await P.screenshot({ path: `${SD}/m426-b-fokus.png` });
await P.keyboard.press('Escape'); await P.waitForTimeout(900);
pruefe('B9 Esc: Bedienung wieder da, Fokus bleibt offen, Vollbild beendet', (await rein()) === null && await sichtbar('.focus-head') && await sichtbar('.focus-nav') && await P.evaluate(() => !document.fullscreenElement));
const zurueck = await P.locator('.react-flow__node[data-id="k1"]').boundingBox();
pruefe('B10 die Karte steht wieder zwischen den Leisten', zurueck.y >= 52 && zurueck.width < karte.width, zurueck);
await P.keyboard.press('f'); await P.waitForTimeout(900);
pruefe('B11 Taste F schaltet ein …', (await rein()) === 'fokus');
await P.keyboard.press('f'); await P.waitForTimeout(900);
pruefe('B12 … und wieder aus', (await rein()) === null && (await P.locator('.focus-head').count()) === 1);
await P.locator('[data-taste="fokus-ansicht"]').click(); await P.waitForTimeout(250);
await P.locator('[data-taste="fokus-rein-wahl"]').click(); await P.waitForTimeout(800);
pruefe('B13 auch als Eintrag im Menü „Darstellung"', (await rein()) === 'fokus');
await P.keyboard.press('Escape'); await P.waitForTimeout(800);

// ══ D/E: Rückweg, Zeiger ══
console.log('\n════ D/E: Rückweg, Zeiger ════');
await P.mouse.move(720, 500); await P.keyboard.press('f'); await P.waitForTimeout(500);
pruefe('D0 nach dem Einschalten steht der Rückweg kurz da', await sichtbar('[data-taste="rein-aus"]'));
await P.waitForTimeout(2500);
pruefe('D1 der Knopf oben verschwindet nach dem Einschalten', !(await sichtbar('[data-taste="rein-aus"]')));
await P.mouse.move(720, 400); await P.waitForTimeout(2300);
pruefe('E1 ruhender Zeiger ist ausgeblendet', await P.evaluate(() => 'reinRuhe' in document.documentElement.dataset && getComputedStyle(document.body).cursor === 'none'));
await P.mouse.move(700, 300); await P.waitForTimeout(100);
pruefe('E2 bewegt: wieder da', await P.evaluate(() => !('reinRuhe' in document.documentElement.dataset)));
await P.mouse.move(720, 6); await P.waitForTimeout(450);
pruefe('D2 Kante oben: „Bedienung einblenden" erscheint', await sichtbar('[data-taste="rein-aus"]'));
await P.locator('[data-taste="rein-aus"]').click(); await P.waitForTimeout(800);
pruefe('D3 ein Klick darauf: Bedienung wieder da', (await rein()) === null && await sichtbar('.focus-head'));
await P.keyboard.press('Escape'); await P.waitForTimeout(800);

// ══ C: Schreiben ══
console.log('\n════ C: Schreiben ════');
await fokusAuf('n1');
await P.locator('.react-flow__node[data-id="n1"] .bn-editor').click(); await P.keyboard.press('End'); await P.waitForTimeout(150);
await P.keyboard.type(' fff'); await P.waitForTimeout(400);
pruefe('C1 F im Text ist ein Buchstabe', (await rein()) === null && /fff/.test(await P.locator('.react-flow__node[data-id="n1"] .bn-editor').textContent()));
await P.keyboard.press('Escape'); await P.waitForTimeout(300);
if (await P.locator('.focus-head').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(700); }
if (await P.locator('.focus-head').count()) { await P.locator('.focus-x').click(); await P.waitForTimeout(700); }

// ══ A: Präsentation ══
console.log('\n════ A: Präsentation ════');
await P.mouse.click(1300, 820); await P.waitForTimeout(250);
await P.keyboard.press('Alt+p');
await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(900);
pruefe('A0 Knopf „Nur Inhalt" in der Kopfzeile', (await P.locator('[data-taste="vortrag-rein"]').count()) === 1);
const zaehler = async () => (await P.locator('.presenter-count').textContent()).replace(/\s+/g, ' ').trim();
const vorher = await zaehler();
await P.keyboard.press('f'); await P.waitForTimeout(900);
pruefe('A1 F: „Nur Inhalt"', (await rein()) === 'vortrag' && (await P.locator('.presenter.rein').count()) === 1);
pruefe('A2 keine Kopf- und Fußzeile', !(await sichtbar('.presenter-head')) && !(await sichtbar('.presenter-foot')));
const folie = await P.locator('.presenter-slide').boundingBox();
pruefe('A3 die Folie randlos über den ganzen Schirm', folie.x === 0 && folie.y === 0 && Math.abs(folie.width - 1440) < 1 && Math.abs(folie.height - 900) < 1, folie);
pruefe('A4 ohne Schatten und Rundung', await P.evaluate(() => { const cs = getComputedStyle(document.querySelector('.presenter-slide')); return cs.boxShadow === 'none' && parseFloat(cs.borderTopLeftRadius) === 0; }));
await P.screenshot({ path: `${SD}/m426-a-vortrag.png` });
await P.keyboard.press('ArrowRight'); await P.waitForTimeout(700);
pruefe('A5 → blättert weiter', (await zaehler()) !== vorher && (await rein()) === 'vortrag', [vorher, await zaehler()]);
await P.keyboard.press('Escape'); await P.waitForTimeout(700);
pruefe('A6 Esc: Bedienung zurück, Präsentation bleibt offen', (await rein()) === null && (await P.locator('.presenter').count()) === 1 && await sichtbar('.presenter-head') && await sichtbar('.presenter-foot'));
await P.locator('[data-taste="vortrag-rein"]').click(); await P.waitForTimeout(700);
pruefe('A7 der Knopf schaltet ebenso ein', (await rein()) === 'vortrag');
await P.keyboard.press('f'); await P.waitForTimeout(500);
await P.locator('[data-taste="folie-zoom"]').click(); await P.waitForTimeout(250);
await P.locator('[data-taste="folie-rein"]').click(); await P.waitForTimeout(600);
pruefe('A7b auch als Eintrag im Menü „Darstellung"', (await rein()) === 'vortrag');
await P.keyboard.press('f'); await P.waitForTimeout(500);
await P.keyboard.press('Escape'); await P.waitForTimeout(700);
pruefe('A8 F aus, dann Esc: beendet die Präsentation wie bisher', (await P.locator('.presenter').count()) === 0 && (await rein()) === null);

// ══ F: Hilfe, Umbau ══
console.log('\n════ F: Hilfe, Umbau ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('F1 Hilfe nennt M426', /M426/.test(hilfe));
  pruefe('F2 Umbau-Liste nennt M426', /M426/.test(umbau));
  pruefe('F3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}
await browser.close();
app.close();
console.log(`\nM426: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
