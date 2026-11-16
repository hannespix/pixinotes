/**
 * M393 — Ein Webtool im Vollbild gehört der ganze Schirm.
 *
 * Gemeldet: „Wenn ein Webtool im Vollbild läuft und präsentiert wird, sieht man oben trotzdem noch eine kleine
 * Webtool-Toolbar. Das sollte nicht so sein."
 *
 *   A  Vollbild der Karte (⋯ → Vollbild): Die Kopfleiste zieht sich nach oben zurück, das Tool füllt den Schirm.
 *      Am oberen Rand kommt sie wieder — mit einem Knopf „Vollbild verlassen" statt des ⋯ (dessen Menü im Vollbild
 *      nicht zu sehen wäre). Das Tool läuft dabei weiter, auch nach dem Verlassen.
 *   B  Präsentation: Eine Tool-Folie füllt den Schirm bis oben; die Kopfzeile kommt am oberen Rand, die Fußzeile
 *      zum Blättern bleibt. Auf anderen Folien steht die Kopfzeile wie gewohnt.
 *   C  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m393-tool-vollbild.mjs`
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
const PORT = 4709;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const TOOL = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<button id="oben" style="position:fixed;top:14px;left:20px">Zähler</button><span id="zahl" style="position:fixed;top:60px;left:20px">0</span>
<script>document.getElementById('oben').onclick=function(){var z=document.getElementById('zahl');z.textContent=String(+z.textContent+1);};</script></body></html>`;
const stand = {
  boards: [{ id: 'b1', name: 'Werkstatt', nodes: [
    { id: 'n1', type: 'note', position: { x: 40, y: 60 }, width: 260, height: 160, data: { title: 'Ablauf', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Erst die Notiz, dann das Tool.', styles: {} }] }] } },
    { id: 'h1', type: 'htmlapp', position: { x: 360, y: 60 }, width: 460, height: 380, data: { name: 'Rechner', size: TOOL.length } },
  ], edges: [], drawings: [], comments: [] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE' });
await ctx.addInitScript((s) => {
  try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }   // nicht im Tool selbst
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
}, stand);
const P = await ctx.newPage();
P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
// der Quelltext des Tools liegt in der Ablage des Geräts
await P.evaluate((html) => new Promise((fertig, weh) => {
  const q = indexedDB.open('pixinotes-sync', 1);
  q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('kv')) q.result.createObjectStore('kv'); };
  q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(html, 'happ:h1'); t.oncomplete = () => fertig(true); t.onerror = () => weh(t.error); };
  q.onerror = () => weh(q.error);
}), TOOL);
await P.reload({ waitUntil: 'networkidle' });
await P.waitForTimeout(2200);

const bis = async (f, ms = 6000) => { const ende = Date.now() + ms; for (;;) { if (await f()) return true; if (Date.now() > ende) return false; await P.waitForTimeout(120); } };
const kasten = (sel) => P.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { oben: Math.round(r.top), unten: Math.round(r.bottom), links: Math.round(r.left), rechts: Math.round(r.right), hoch: Math.round(r.height) }; }, sel);
const toolRahmen = () => P.frames().find((f) => f !== P.mainFrame() && f.parentFrame() === P.mainFrame());
const zahl = async () => { const f = toolRahmen(); return f ? Number(await f.locator('#zahl').textContent({ timeout: 3000 }).catch(() => '-1')) : -1; };
const vollbild = () => P.evaluate(() => !!document.fullscreenElement && document.fullscreenElement.classList.contains('happ-wrap'));

console.log('\n════ A: Vollbild der Karte ════');
{
  await P.locator('.react-flow__node[data-id="h1"] .happ-head').click({ position: { x: 12, y: 12 } });
  await P.waitForTimeout(300);
  await P.locator('.react-flow__node[data-id="h1"] .happ-startbtn, .react-flow__node[data-id="h1"] .happ-go').first().click();
  pruefe('A0 das Tool läuft in der Karte', await bis(async () => (await zahl()) === 0, 8000));
  await toolRahmen().locator('#oben').click(); await toolRahmen().locator('#oben').click();
  pruefe('A1 es lässt sich bedienen (Zähler 2)', (await zahl()) === 2, String(await zahl()));
  await P.locator('[data-hmbtn="h1"]').click(); await P.waitForTimeout(250);
  await P.locator('.happ-menu button', { hasText: 'Vollbild' }).first().click();
  pruefe('A2 die Karte ist im Vollbild', await bis(vollbild, 4000));
  await bis(async () => !!(await kasten('.happ-full .happ-head')), 2000);
  const gleich = await kasten('.happ-full .happ-head');
  pruefe('A3 beim Eintritt steht die Leiste einen Moment — man sieht, wo sie ist', !!gleich && gleich.oben >= -1, gleich);
  await P.mouse.move(700, 500);
  pruefe('A4 dann zieht sie sich nach oben zurück', await bis(async () => ((await kasten('.happ-full .happ-head'))?.unten ?? 9) <= 0, 4000), await kasten('.happ-full .happ-head'));
  const fl = await kasten('.happ-full .happ-frame');
  const hoehe = await P.evaluate(() => window.innerHeight);
  pruefe('A5 das Tool füllt den Schirm von ganz oben bis unten', !!fl && fl.oben <= 0 && fl.hoch >= hoehe - 1, { fl, hoehe });
  await P.screenshot({ path: path.join(SD, 'm393-a-vollbild.png') });
  pruefe('A6 knapp unter dem Rand gehört der Klick dem Tool', await P.evaluate(() => document.elementFromPoint(60, 24)?.classList.contains('happ-frame') === true));
  await P.mouse.click(60, 26); await P.waitForTimeout(200);
  pruefe('A7 das Tool läuft weiter und zählt (kein Neustart beim Wechsel)', (await zahl()) === 3, String(await zahl()));
  await P.mouse.move(700, 2); await P.mouse.move(701, 3);
  pruefe('A8 am oberen Rand kommt die Leiste', await bis(async () => ((await kasten('.happ-full .happ-head'))?.oben ?? -9) >= -1, 3000), await kasten('.happ-full .happ-head'));
  pruefe('A9 sie bietet „Vollbild verlassen" — kein ⋯, dessen Menü im Vollbild unsichtbar wäre',
    (await P.locator('.happ-full [data-taste="happ-vollbild-zu"]').count()) === 1 && (await P.locator('.happ-full [data-hmbtn]').count()) === 0);
  await P.screenshot({ path: path.join(SD, 'm393-a-leiste.png') });
  const k = await kasten('.happ-full .happ-head');
  await P.mouse.move(700, Math.max(4, k.unten - 8)); await P.waitForTimeout(600);
  pruefe('A10 solange der Zeiger auf ihr steht, bleibt sie', ((await kasten('.happ-full .happ-head'))?.oben ?? -9) >= -1);
  await P.mouse.move(700, 520);
  pruefe('A11 weg vom Rand zieht sie sich wieder zurück', await bis(async () => ((await kasten('.happ-full .happ-head'))?.unten ?? 9) <= 0, 4000));
  await P.mouse.move(700, 2); await P.mouse.move(702, 3);
  await bis(async () => ((await kasten('.happ-full .happ-head'))?.oben ?? -9) >= -1, 3000);
  await P.locator('[data-taste="happ-vollbild-zu"]').click();
  pruefe('A12 der Knopf führt zurück aufs Board', await bis(async () => !(await vollbild()), 4000));
  await P.waitForTimeout(400);
  const lage = await P.evaluate(() => { const h = document.querySelector('.react-flow__node[data-id="h1"] .happ-head'); return { art: getComputedStyle(h).position, dreh: getComputedStyle(h).transform, mehr: !!document.querySelector('[data-hmbtn="h1"]') }; });
  pruefe('A13 auf dem Board ist die Kopfleiste wieder die der Karte, mit ⋯', lage.art === 'static' && (lage.dreh === 'none' || lage.dreh === 'matrix(1, 0, 0, 1, 0, 0)') && lage.mehr, lage);
  pruefe('A14 und das Tool hat seinen Stand behalten', (await zahl()) === 3, String(await zahl()));
}

console.log('\n════ B: Tool als Folie ════');
{
  await P.keyboard.press('Escape'); await P.mouse.click(1100, 700); await P.waitForTimeout(300);
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click();
  pruefe('B0 die Präsentation ist offen', await bis(async () => (await P.locator('.presenter').count()) === 1, 4000));
  await P.waitForTimeout(500);
  const aufTool = async () => (await P.locator('.presenter-slide.app').count()) === 1;
  // erst eine gewöhnliche Folie: die Kopfzeile steht wie gewohnt
  if (await aufTool()) { await P.locator('[data-taste="vortrag-weiter"]').click(); await P.waitForTimeout(500); }
  const normal = await P.evaluate(() => { const h = document.querySelector('.presenter-head'); const r = h.getBoundingClientRect(); return { art: getComputedStyle(h).position, oben: Math.round(r.top), tool: !!document.querySelector('.presenter-slide.app') }; });
  pruefe('B1 auf einer gewöhnlichen Folie steht die Kopfzeile fest oben', !normal.tool && normal.art === 'static' && normal.oben === 0, normal);
  // zur Tool-Folie
  for (let i = 0; i < 3 && !(await aufTool()); i++) {
    const zurueck = P.locator('[data-taste="vortrag-zurueck"]');
    await ((await zurueck.getAttribute('aria-disabled')) === 'true' ? P.locator('[data-taste="vortrag-weiter"]') : zurueck).click();
    await P.waitForTimeout(400);
  }
  pruefe('B2 die Tool-Folie ist offen', await aufTool());
  const kopfGleich = await kasten('.presenter-head');
  pruefe('B3 beim Wechsel steht die Kopfzeile noch einen Moment', !!kopfGleich && kopfGleich.oben >= -1, kopfGleich);
  await P.mouse.move(700, 450);
  pruefe('B4 dann zieht sie sich zurück', await bis(async () => ((await kasten('.presenter-head'))?.unten ?? 9) <= 0, 5000), await kasten('.presenter-head'));
  const f = await kasten('.presenter-slide.app');
  const breit = await P.evaluate(() => window.innerWidth);
  pruefe('B5 das Tool füllt den Schirm: von ganz oben, von Rand zu Rand', !!f && f.oben <= 0 && f.links <= 0 && f.rechts >= breit - 1, { f, breit });
  const fuss = await kasten('.presenter-foot');
  pruefe('B6 die Fußzeile zum Blättern bleibt sichtbar und liegt unter dem Tool', !!fuss && fuss.oben >= f.unten - 1 && fuss.unten <= 900 && (await P.locator('[data-taste="vortrag-weiter"]').isVisible()), { fuss, f });
  pruefe('B7 das Tool läuft auf der Folie', await bis(async () => { const fr = P.frames().find((x) => x !== P.mainFrame()); return !!fr && (await fr.locator('#oben').count().catch(() => 0)) === 1; }, 8000));
  await P.screenshot({ path: path.join(SD, 'm393-b-folie.png') });
  await P.mouse.move(700, 2); await P.mouse.move(702, 3);
  pruefe('B8 am oberen Rand kommt die Kopfzeile', await bis(async () => ((await kasten('.presenter-head'))?.oben ?? -9) >= -1, 3000), await kasten('.presenter-head'));
  await P.screenshot({ path: path.join(SD, 'm393-b-kopf.png') });
  pruefe('B9 sie nennt Board und Folie, der Laser ist erreichbar', /Werkstatt/.test(await P.locator('.presenter-head').textContent()) && (await P.locator('[data-taste="vortrag-laser"]').isVisible()));
  await P.mouse.move(700, 450);
  pruefe('B9b weg vom Rand zieht sie sich wieder zurück', await bis(async () => ((await kasten('.presenter-head'))?.unten ?? 9) <= 0, 5000), await kasten('.presenter-head'));
  // mit der Tastatur erreichbar: Tab bis in die Kopfzeile holt sie hervor
  await P.locator('[data-taste="vortrag-weiter"]').focus();
  let drin = false;
  for (let i = 0; i < 12 && !drin; i++) { await P.keyboard.press('Shift+Tab'); drin = await P.evaluate(() => !!document.activeElement?.closest('.presenter-head')); }
  pruefe('B10 mit der Tastatur: steht der Fokus in der Kopfzeile, ist sie zu sehen', drin && await bis(async () => ((await kasten('.presenter-head'))?.oben ?? -9) >= -1, 2000), { drin, k: await kasten('.presenter-head') });
  await P.mouse.move(700, 2); await P.mouse.move(702, 3); await P.waitForTimeout(400);
  await P.locator('.presenter-head button[aria-label="Präsentation beenden"]').click();
  pruefe('B11 ✕ beendet die Präsentation', await bis(async () => (await P.locator('.presenter').count()) === 0, 3000));
}

console.log('\n════ C: Texte ════');
{
  const de = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
  const en = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf-8');
  pruefe('C1 die Hilfe nennt M393 — deutsch und englisch', de.includes('(M393)') && en.includes('(M393)'));
  pruefe('C2 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm393-tool-vollbild: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
