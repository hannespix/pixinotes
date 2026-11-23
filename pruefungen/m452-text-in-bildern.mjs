/**
 * M452 — Text in Bildern finden (Texterkennung, lokal im Browser).
 *
 *   A  START: Ein frisches Board lädt keine Datei der Engine (weder den Nachlade-Teil `ocrEngine` noch etwas
 *      aus `ocr/`) — auch nicht nach einigen Sekunden Leerlauf.
 *   B  ERKENNEN: Ein Bild mit gezeichnetem Text (Canvas) liegt auf dem Board; im Leerlauf läuft die Erkennung,
 *      der Text landet an der Karte (gespeicherter Board-Stand). Alle Dateien kommen von der App selbst
 *      (`ocr/` neben ihr), kein fremder Server.
 *   C  SUCHEN: Strg+K findet ein Wort aus dem Bild und markiert den Treffer als „Treffer im Bild"; Enter
 *      fliegt zur Bild-Karte.
 *   D  NEU LADEN: Der Text bleibt; das Bild wird nicht noch einmal erkannt (keine Engine-Datei geladen).
 *   E  KOPIEREN: Bild markieren → ⋯ → „Text im Bild kopieren" legt den erkannten Text in die Zwischenablage.
 *   F  ABSCHALTEN: Einstellungen → Dienste → „Text in Bildern erkennen" aus; ein neues Bild wird dann nicht
 *      erkannt, die Engine nicht geladen.
 *   G  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m452-text-in-bildern.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5452;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const URL0 = `http://localhost:${PORT}/`;

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

// Ein Bild mit echtem Text — im Browser gezeichnet, als PNG-Daten-URL
const bildMitText = async (zeilen) => {
  const p = await browser.newPage();
  const src = await p.evaluate((z) => {
    const c = document.createElement('canvas'); c.width = 1100; c.height = 90 + z.length * 90;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111'; g.font = 'bold 56px sans-serif';
    z.forEach((t, i) => g.fillText(t, 40, 100 + i * 90));
    return c.toDataURL('image/png');
  }, zeilen);
  await p.close();
  return src;
};
const RECHNUNG = await bildMitText(['Rechnungsnummer 4711', 'Lieferung am Mittwoch']);
const ANDERES = await bildMitText(['Kundennummer 0815', 'Bitte zurückrufen']);

const auf = async (nodes, { aus = false } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL0 });
  await ctx.addInitScript(([nn, ausSchalten]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (ausSchalten) localStorage.setItem('pixinotes-bildtext', 'aus');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Belege', edges: [], drawings: [], nodes: nn, comments: [] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [nodes, aus]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const anfragen = [];
  P.on('request', (r) => anfragen.push(r.url()));
  await P.goto(URL0);
  await P.waitForSelector('.react-flow__node', { timeout: 20000 }).catch(() => {});
  return { ctx, P, anfragen };
};
const engineAnfragen = (a) => a.filter((u) => /ocrEngine|\/ocr\/|tesseract/i.test(u));
const gespeichert = (P, id) => P.evaluate((k) => {
  const st = JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state ?? {};
  const n = (st.boards ?? []).flatMap((b) => b.nodes).find((x) => x.id === k);
  return n ? { text: n.data.ocrText, am: n.data.ocrAm, fuer: n.data.ocrFuer } : null;
}, id);
const bis = async (fn, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((x) => setTimeout(x, 500)); } return null; };
const bild = (id, x, src, name) => ({ id, type: 'image', position: { x, y: 120 }, width: 420, data: { src, name } });

console.log('════ A: Start ohne Engine ════');
{
  const { ctx, P, anfragen } = await auf([{ id: 'n1', type: 'note', position: { x: 80, y: 80 }, width: 240, height: 120, data: { color: 'yellow', blocks: [] } }]);
  await P.waitForTimeout(7000);
  pruefe('A1 Start und Leerlauf ohne Bild: keine Datei der Texterkennung geladen', engineAnfragen(anfragen).length === 0, engineAnfragen(anfragen));
  const start = anfragen.filter((u) => u.endsWith('.js'));
  pruefe('A2 Die Start-Skripte enthalten die Engine nicht', start.length > 0 && !start.some((u) => /ocrEngine|tesseract/i.test(u)), start);
  await ctx.close();
}

console.log('════ B–E: erkennen, suchen, neu laden, kopieren ════');
{
  const { ctx, P, anfragen } = await auf([bild('rech', 80, RECHNUNG, 'Screenshot.png')]);
  await P.waitForTimeout(1500);
  pruefe('B1 Gleich nach dem Start ist die Engine noch nicht geladen (sie wartet auf den Leerlauf)', engineAnfragen(anfragen).length === 0, engineAnfragen(anfragen));
  const st = await bis(async () => { const s = await gespeichert(P, 'rech'); return s?.am ? s : null; });
  pruefe('B2 Im Leerlauf wird der Text erkannt und an der Karte gespeichert', !!st && /Rechnungsnummer/i.test(st.text ?? '') && /Mittwoch/i.test(st.text ?? ''), st);
  const fremd = anfragen.filter((u) => /^https?:/.test(u) && !u.startsWith(URL0));
  pruefe('B3 Worker, Kern und Sprachdaten kommen aus ocr/ neben der App – kein fremder Server', fremd.length === 0
    && anfragen.some((u) => u.endsWith('/ocr/worker.min.js')) && anfragen.some((u) => u.endsWith('/ocr/deu.traineddata.gz')), { fremd, ocr: engineAnfragen(anfragen) });

  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.type('Rechnungsnummer'); await P.waitForTimeout(500);
  const treffer = await P.evaluate(() => [...document.querySelectorAll('.search-hit')].map((h) => h.textContent));
  pruefe('C1 Strg+K findet ein Wort aus dem Bild – als „Treffer im Bild" markiert', treffer.some((t) => /Treffer im Bild/.test(t) && /Rechnungsnummer/.test(t)), treffer);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.type('Screenshot'); await P.waitForTimeout(400);
  const nachName = await P.evaluate(() => [...document.querySelectorAll('.search-hit')].map((h) => h.textContent));
  pruefe('C2 Ein Treffer im Namen trägt die Marke nicht', nachName.length > 0 && !nachName.some((t) => /Treffer im Bild/.test(t)), nachName);
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.type('Mittwoch'); await P.waitForTimeout(400);
  await P.keyboard.press('Enter'); await P.waitForTimeout(900);
  const gewaehlt = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="rech"]')?.classList.contains('selected') ?? false);
  pruefe('C3 Enter springt zur Bild-Karte', gewaehlt);

  // D: neu laden
  const vorher = anfragen.length;
  await P.reload(); await P.waitForSelector('.react-flow__node', { timeout: 20000 });
  await P.waitForTimeout(8000);
  const nach = await gespeichert(P, 'rech');
  pruefe('D1 Nach dem Neuladen ist der Text noch da', !!nach && nach.text === st?.text && nach.am === st?.am, nach);
  pruefe('D2 … und das Bild wird nicht noch einmal erkannt (keine Engine-Datei geladen)', engineAnfragen(anfragen.slice(vorher)).length === 0, engineAnfragen(anfragen.slice(vorher)));
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.type('Rechnungsnummer'); await P.waitForTimeout(400);
  const nochmal = await P.evaluate(() => [...document.querySelectorAll('.search-hit')].map((h) => h.textContent));
  pruefe('D3 … und die Suche findet ihn weiter', nochmal.some((t) => /Treffer im Bild/.test(t)), nochmal);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  // E: kopieren
  const box = await P.locator('.react-flow__node[data-id="rech"]').boundingBox();
  await P.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await P.waitForTimeout(500);
  await P.locator('button[aria-label="Mehr"]').first().click(); await P.waitForTimeout(400);
  const eintrag = P.locator('[data-taste="bild-text-kopieren"]');
  pruefe('E1 ⋯ bietet „Text im Bild kopieren"', (await eintrag.count()) === 1, await eintrag.count());
  await P.evaluate(() => navigator.clipboard.writeText('leer'));
  if (await eintrag.count()) { await eintrag.click(); await P.waitForTimeout(500); }
  const ablage = await P.evaluate(() => navigator.clipboard.readText());
  pruefe('E2 … und die Zwischenablage hält genau den erkannten Text', ablage === st?.text, { ablage, text: st?.text });
  const leiste = await P.evaluate(() => !!document.querySelector('.react-flow__node[data-id="rech"] [data-taste^="bild-text"]'));
  pruefe('E3 Auf dem Bild selbst steht kein zusätzlicher Knopf', !leiste);

  // F: über die Einstellungen abschalten
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
  await P.locator('button[title^="Einstellungen"]').first().click(); await P.waitForTimeout(600);
  await P.locator('.modal-tabs button, .settings-tabs button, button', { hasText: /^Dienste$/ }).first().click(); await P.waitForTimeout(400);
  const schalter = P.locator('[data-taste="bild-text-an"]');
  pruefe('F1 Einstellungen → Dienste hat den Schalter „Text in Bildern erkennen" (an)', (await schalter.count()) === 1 && await schalter.isChecked());
  if (await schalter.count()) await schalter.uncheck();
  const wert = await P.evaluate(() => localStorage.getItem('pixinotes-bildtext'));
  pruefe('F2 … ausgeschaltet bleibt er gespeichert', wert === 'aus', wert);
  await ctx.close();
}
{
  const { ctx, P, anfragen } = await auf([bild('kd', 80, ANDERES, 'Notiz.png')], { aus: true });
  await P.waitForTimeout(10000);
  const s = await gespeichert(P, 'kd');
  pruefe('F3 Abgeschaltet: ein neues Bild wird nicht erkannt, die Engine nicht geladen', !s?.am && engineAnfragen(anfragen).length === 0, { s, a: engineAnfragen(anfragen) });
  const box = await P.locator('.react-flow__node[data-id="kd"]').boundingBox();
  await P.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await P.waitForTimeout(500);
  await P.locator('button[aria-label="Mehr"]').first().click(); await P.waitForTimeout(400);
  const eintraege = await P.locator('[data-taste^="bild-text"]').count();
  pruefe('F4 … und ⋯ bietet keine Erkennung an', eintraege === 0, eintraege);
  await ctx.close();
}

console.log('════ G: Fehler ════');
pruefe('G1 Keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
