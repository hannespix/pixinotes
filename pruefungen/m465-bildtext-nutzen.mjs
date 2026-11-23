/**
 * M465 — Text in Bildern nutzen: Gehirn und anklickbare Angaben.
 *
 *   A  ANGABEN: Ein Bild, dessen erkannter Text (M452) eine Rufnummer, eine E-Mail-Adresse, eine Web-Adresse ohne
 *      Schema („www.…") und eine Frist („bis 15.12.2026") enthält. In Ruhe steht unter dem Bild nichts; markiert
 *      erscheinen Chips mit tel:, mailto: und https:-Verweis (neuer Tab), dazu die Frist. Die Chips liegen sichtbar
 *      unter dem Bild und verändern die Karte nicht.
 *   B  FRIST: Vor dem Klick steht die Frist NICHT in der Aufgaben-Zentrale. Klick auf die Frist lädt eine .ics; Klick
 *      auf „als Aufgabe" legt ein Ticket mit Frist und Verweis aufs Bild an (neues Kanban unter dem Bild), es steht
 *      danach in der Zentrale; ein zweiter Klick legt es nicht doppelt an; Strg+Z nimmt es in einem Schritt zurück.
 *   C  GEHIRN: Ein Bild ohne erkannten Text wird zuerst nur mit dem Namen eingebettet; sobald die echte
 *      Texterkennung (tesseract.js aus dist/ocr/) fertig ist, bettet das Gehirn es mit dem Bildtext neu ein.
 *      Strg+K findet das Bild dann über die Bedeutung („Buchhaltung" → Rechnung). Ein Bild in einem vom Gehirn
 *      ausgeschlossenen Bereich (M220) wird nie eingebettet, auch nicht sein Bildtext.
 *   D  Keine Seitenfehler.
 *
 * Für A und B ist der erkannte Text vorgegeben (data.ocrText + passender Fingerabdruck ocrFuer): Ob Tesseract eine
 * Rufnummer mit Bindestrich oder eine Mail-Adresse Zeichen für Zeichen richtig liest, prüft diese Reihe nicht – sie
 * prüft, was PixiNotes aus dem erkannten Text macht. C nutzt die echte Erkennung (wie m452).
 * Die Einbettungen (Ollama /api/embed) gibt die Reihe per page.route vor (Muster m445).
 */
// Läuft aus dem Repository: `node pruefungen/m465-bildtext-nutzen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5465;
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
/** Fingerabdruck wie lib/textInBildern.ts (streuwert) — damit der vorgegebene Text als „zum Bild gehörig" gilt */
const streuwert = (s) => {
  let h = 5381;
  const schritt = Math.max(1, Math.floor(s.length / 4096));
  for (let i = 0; i < s.length; i += schritt) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length.toString(36)}-${h.toString(36)}`;
};

const ZEILEN = ['Stadtwerke Kundenservice', 'Tel. 0761 208-1356', 'info@stadtwerke-beispiel.de', 'www.stadtwerke-beispiel.de/antrag', 'Abgabe bis 15.12.2026'];
const PLAKAT = await bildMitText(ZEILEN);
const RECHNUNG = await bildMitText(['Rechnungsnummer 4711', 'Lieferung am Mittwoch']);
const GEHEIM = await bildMitText(['Geheimprojekt Kolibri']);

const bild = (id, x, src, name, ocr) => ({ id, type: 'image', position: { x, y: 140 }, width: 420,
  data: { src, name, ...(ocr != null ? { ocrText: ocr, ocrAm: 1, ocrFuer: streuwert(src) } : {}) } });

const auf = async (boards, { gehirn = false, aus = [] } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(([bb, mitGehirn, offen]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: bb.map((b) => ({ id: b.id, name: b.name, edges: [], drawings: [], nodes: b.nodes, comments: [] })),
      spaces: bb.map((b) => ({ id: `s-${b.id}`, name: b.name, projects: [{ id: `p-${b.id}`, name: 'P', boardIds: [b.id] }] })),
      activeId: bb[0].id, view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      brainOffSpaces: offen,
      ...(mitGehirn ? { ai: { provider: 'ollama', model: '', apiKey: '', baseUrl: 'http://localhost:11434' }, brain: { on: true, provider: 'ollama', embedModel: 'nomic-embed-text' } } : {}),
    } }));
  }, [boards, gehirn, aus]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const einbettungen = [];
  if (gehirn) {
    await P.route('**/api/embed', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      einbettungen.push(...body.input);
      // Rechnungs-Inhalte und die Frage nach „Buchhaltung" zeigen in dieselbe Richtung, alles andere woandershin
      const vek = body.input.map((t) => (/Rechnung|Buchhaltung/i.test(t) ? [1, 0.02, 0] : [0, 0.1, 1]));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ embeddings: vek }) });
    });
  }
  await P.goto(URL0);
  await P.waitForSelector('.react-flow__node', { timeout: 20000 }).catch(() => {});
  await P.waitForTimeout(800);
  return { ctx, P, einbettungen };
};
const stand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state ?? {});
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const bis = async (fn, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((x) => setTimeout(x, 500)); } return null; };
const zentrale = async (P) => {
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-box', { state: 'visible' });
  await P.keyboard.type('Aufgaben-Zentrale'); await P.waitForTimeout(250);
  await P.locator('.search-cmds .search-cmd', { hasText: 'Aufgaben-Zentrale' }).first().click();
  await P.waitForSelector('.taskhub-head', { timeout: 10000 }).catch(() => {});
  await P.waitForTimeout(300);
  const text = await P.evaluate(() => document.querySelector('.taskhub')?.textContent ?? '');
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  return text;
};

console.log('════ A: Angaben aus dem Bildtext ════');
{
  const { ctx, P } = await auf([{ id: 'b1', name: 'Post', nodes: [bild('plakat', 120, PLAKAT, 'Aushang.png', ZEILEN.join('\n'))] }]);
  const knoten = P.locator('.react-flow__node[data-id="plakat"]');
  pruefe('A1 In Ruhe steht unter dem Bild nichts zusätzlich (keine Chips)', (await P.locator('.bildtext-chips').count()) === 0);
  const vorher = await knoten.boundingBox();
  await knoten.click({ position: { x: 200, y: 60 } }); await P.waitForTimeout(500);
  const chips = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="plakat"] .bildtext-chips a')].map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: a.textContent.trim() })));
  const tel = chips.find((c) => c.href?.startsWith('tel:'));
  const mail = chips.find((c) => c.href?.startsWith('mailto:'));
  const web = chips.find((c) => /^https?:/.test(c.href ?? ''));
  pruefe('A2 Markiert: Rufnummer als tel:-Verweis (international)', tel?.href === 'tel:+497612081356', chips);
  pruefe('A3 … E-Mail-Adresse als mailto:', mail?.href === 'mailto:info@stadtwerke-beispiel.de', chips);
  pruefe('A4 … Web-Adresse ohne Schema als https:-Verweis im neuen Tab, ohne Verweiser', web?.href === 'https://www.stadtwerke-beispiel.de/antrag' && web?.target === '_blank' && /noopener/.test(web?.rel ?? '') && /noreferrer/.test(web?.rel ?? ''), web);
  const frist = P.locator('.react-flow__node[data-id="plakat"] .bildtext-chips button.due-chip:not(.bildtext-aufgabe)');
  pruefe('A5 … und die Frist als Chip (15.12.)', (await frist.count()) === 1 && /15\.12\./.test(await frist.first().textContent()), await frist.count());
  const lage = await P.evaluate(() => {
    const n = document.querySelector('.react-flow__node[data-id="plakat"]');
    const c = n?.querySelector('.bildtext-chips');
    const img = n?.querySelector('img');
    if (!c || !img) return null;
    const rc = c.getBoundingClientRect(); const ri = img.getBoundingClientRect();
    return { unter: rc.top >= ri.bottom - 1, hoch: rc.height, deck: Number(getComputedStyle(c).opacity) };
  });
  pruefe('A6 Die Chips stehen sichtbar unter dem Bild', !!lage && lage.unter && lage.hoch > 8 && lage.deck > 0.9, lage);
  const nachher = await knoten.boundingBox();
  pruefe('A7 Die Karte behält ihre Maße (Chips liegen außerhalb)', Math.abs(nachher.height - vorher.height) < 2 && Math.abs(nachher.width - vorher.width) < 2, { vorher, nachher });
  pruefe('A8 Kein Knopf von M452 auf dem Bild (dort nur ⋯-Menü)', (await P.locator('.react-flow__node[data-id="plakat"] [data-taste^="bild-text"]').count()) === 0);

  console.log('════ B: Frist → Kalender, Aufgabe ════');
  const vorKlick = await zentrale(P);
  pruefe('B1 Vor dem Klick steht die Frist aus dem Bild NICHT in der Aufgaben-Zentrale', !/Abgabe bis 15\.12\.2026/.test(vorKlick), vorKlick.slice(0, 300));
  await knoten.click({ position: { x: 200, y: 60 } }); await P.waitForTimeout(400);
  const [dl] = await Promise.all([
    P.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    frist.first().click(),
  ]);
  let ics = '';
  if (dl) { const p = await dl.path(); ics = p ? readFileSync(p, 'utf8') : ''; }
  pruefe('B2 Klick auf die Frist lädt einen Kalendereintrag für den 15.12.2026', !!dl && /\.ics$/.test(dl.suggestedFilename()) && /DTSTART;VALUE=DATE:20261215/.test(ics), { name: dl?.suggestedFilename(), ics: ics.slice(0, 200) });
  await knoten.click({ position: { x: 200, y: 60 } }); await P.waitForTimeout(400);
  await P.locator('[data-taste="bildtext-aufgabe"]').first().click(); await P.waitForTimeout(700);
  const s1 = await stand(P);
  const kanbans = s1.boards[0].nodes.filter((n) => n.type === 'kanban');
  const item = kanbans[0]?.data.items?.[0];
  pruefe('B3 „als Aufgabe" legt ein Ticket mit Frist und Verweis aufs Bild an', kanbans.length === 1 && item?.due === '2026-12-15' && /Abgabe bis 15\.12\.2026/.test(item?.text ?? '') && item?.links?.[0]?.nodeId === 'plakat', { kanbans: kanbans.map((k) => k.data) });
  const bildN = s1.boards[0].nodes.find((n) => n.id === 'plakat');
  pruefe('B4 … das neue Kanban liegt unter dem Bild', !!kanbans[0] && kanbans[0].position.y > bildN.position.y + 100, kanbans[0]?.position);
  pruefe('B5 … die Meldung sagt es', /Aufgabe .*angelegt/.test(await toast(P)), await toast(P));
  await knoten.click({ position: { x: 200, y: 60 } }); await P.waitForTimeout(400);
  await P.locator('[data-taste="bildtext-aufgabe"]').first().click(); await P.waitForTimeout(600);
  const s2 = await stand(P);
  pruefe('B6 Ein zweiter Klick legt die Aufgabe nicht doppelt an', s2.boards[0].nodes.filter((n) => n.type === 'kanban').flatMap((k) => k.data.items).length === 1);
  const nachKlick = await zentrale(P);
  pruefe('B7 Jetzt steht die Aufgabe in der Aufgaben-Zentrale', /Abgabe bis 15\.12\.2026/.test(nachKlick), nachKlick.slice(0, 300));
  await P.locator('.react-flow__pane').click({ position: { x: 1300, y: 800 } }); await P.waitForTimeout(300);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(700);
  const s3 = await stand(P);
  pruefe('B8 Strg+Z nimmt Aufgabe und neues Kanban in einem Schritt zurück', s3.boards[0].nodes.filter((n) => n.type === 'kanban').length === 0 && s3.boards[0].nodes.some((n) => n.id === 'plakat'));
  await P.locator('.react-flow__pane').click({ position: { x: 1300, y: 800 } }); await P.waitForTimeout(400);
  pruefe('B9 Nicht markiert: keine Chips mehr', (await P.locator('.bildtext-chips').count()) === 0);
  await ctx.close();
}

console.log('════ C: Gehirn liest den Bildtext ════');
{
  const { ctx, P, einbettungen } = await auf([
    { id: 'b1', name: 'Belege', nodes: [bild('rech', 120, RECHNUNG, 'Screenshot.png')] },
    { id: 'b2', name: 'Privat', nodes: [bild('geheim', 120, GEHEIM, 'Privat.png', 'Geheimprojekt Kolibri Rechnung')] },
  ], { gehirn: true, aus: ['s-b2'] });
  const erst = await bis(async () => einbettungen.find((t) => /Screenshot\.png/.test(t)), 20000);
  pruefe('C1 Zuerst wird das Bild nur mit seinem Namen eingebettet (noch kein Bildtext)', !!erst && !/Text im Bild/.test(erst), einbettungen);
  const ocr = await bis(async () => { const s = await stand(P); const n = s.boards?.[0]?.nodes.find((x) => x.id === 'rech'); return n?.data.ocrAm ? n.data.ocrText : null; });
  pruefe('C2 Die Texterkennung liest das Bild (M452)', /Rechnungsnummer/i.test(ocr ?? ''), ocr);
  const t0 = Date.now();
  const neu = await bis(async () => einbettungen.find((t) => /Screenshot\.png/.test(t) && /Text im Bild:.*Rechnungsnummer/is.test(t)), 15000);
  pruefe('C3 Sobald der Text erkannt ist, bettet das Gehirn das Bild mit dem Bildtext neu ein (zügig, nicht erst nach 12 s)', !!neu && Date.now() - t0 < 9000, { neu, ms: Date.now() - t0 });
  pruefe('C4 Ein Bild im ausgeschlossenen Bereich wird nie eingebettet – auch sein Bildtext nicht', !einbettungen.some((t) => /Geheimprojekt|Privat\.png/.test(t)), einbettungen);
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.type('Buchhaltung');
  await P.waitForSelector('.search-sem .search-hit', { timeout: 8000 }).catch(() => {});
  const sem = await P.evaluate(() => [...document.querySelectorAll('.search-sem .search-hit')].map((h) => h.textContent));
  pruefe('C5 Strg+K findet das Bild über die Bedeutung („Buchhaltung" → Rechnung im Bild)', sem.some((t) => /Screenshot\.png/.test(t)) && !sem.some((t) => /Privat/.test(t)), sem);
  await P.locator('.search-sem .search-hit', { hasText: 'Screenshot.png' }).first().click().catch(() => {});
  await P.waitForTimeout(900);
  const gew = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="rech"]')?.classList.contains('selected') ?? false);
  pruefe('C6 Klick auf den Treffer springt zur Bild-Karte', gew);
  await ctx.close();
}

console.log('════ D: Fehler ════');
pruefe('D1 Keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
