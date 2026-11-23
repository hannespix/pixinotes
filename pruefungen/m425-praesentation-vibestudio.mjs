/**
 * M425 — Präsentationen mit Vibe Studio direkt auf dem Board.
 *
 * Gewünscht: „Können wir das Präsentationstool Vibe Studio irgendwie als Modul in PixiNotes integrieren? Dass man
 * quasi Vibe-Studio-Präsentationen direkt auf dem PixiNotes-Whiteboard erstellen kann?"
 *
 *   A  Modul-Palette: Kachel „Präsentation" (Gruppe Ablauf), die Suche findet sie über „folien" und „vibe".
 *   B  Ein Klick legt eine App-Karte an (16 : 9 mit Platz für den Editor), die gleich läuft — kein ▶ nötig.
 *   C  In der Karte läuft Vibe Studio: leere Titelfolie „Neue Präsentation", „Bearbeiten" öffnet den Editor.
 *   D  Ein bearbeiteter Text bleibt an der Karte gespeichert — nach dem Neuladen und erneuten Start ist er noch da.
 *   E  Vollbild aus der Folie heraus nur für Vibe Studio (allow=fullscreen); andere eigene Apps bleiben ohne.
 *   F  Die Vorlage kommt neben der App; fehlt sie dort, von der veröffentlichten Seite; fehlt beides: ein Hinweis.
 *   G  Hilfe und Umbau-Liste.
 */
// Läuft aus dem Repository: `node pruefungen/m425-praesentation-vibestudio.mjs`
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
const PORT = 4763;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0].slice(1)));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const VORLAGE = readFileSync(path.join(DIST, 'vorlagen', 'vibestudio.html'), 'utf8');
const KARTEN = [
  { id: 'n1', type: 'note', position: { x: -400, y: 0 }, width: 260, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Ideen' }] } },
  { id: 'h1', type: 'htmlapp', position: { x: -400, y: 300 }, width: 400, height: 300, data: { name: 'Rechner', size: 40 } },
];
const auf = async (ctx) => {
  const P = await ctx.newPage();
  P.on('pageerror', (er) => fehler.push(er.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return P;
};
const kontext = async (opt = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opt });
  await ctx.addInitScript((n) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false } }));
  }, KARTEN);
  return ctx;
};
const paletteAuf = async (P) => {
  if (!(await P.locator('.modul-palette').count())) { await P.locator('.dock .dock-add-wrap').nth(0).locator('button').first().click(); await P.waitForTimeout(400); }
};
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const vibeRahmen = (P) => P.frames().find((f) => f !== P.mainFrame() && f.url().startsWith('about:srcdoc'));
// M448: 20 s statt 8 s – unter Last (parallele Prüfungen, nachgeladene Module seit M446) brauchte der Editor
// im Rahmen gelegentlich länger; gewartet wird weiter nur, bis „#edit" da ist
const warteRahmen = async (P, ms = 20000) => {
  for (let t = 0; t < ms; t += 250) {
    const f = vibeRahmen(P);
    if (f && await f.locator('#edit').count().catch(() => 0)) return f;
    await P.waitForTimeout(250);
  }
  return null;
};

// ══ A/B/C: Kachel, Karte, Editor ══
console.log('\n════ A–C: Kachel, Karte, Editor ════');
const ctx = await kontext();
const P = await auf(ctx);
let neuId = null;
{
  await paletteAuf(P);
  const kachel = P.locator('.modul-kachel[data-modul="praesentation"]');
  const gruppe = await kachel.evaluate((el) => el.closest('.modul-gruppe, [data-gruppe]')?.querySelector('.dock-menu-label, .modul-gruppe-name')?.textContent?.trim() ?? el.closest('section, div')?.previousElementSibling?.textContent?.trim() ?? '').catch(() => '');
  pruefe('A1 Kachel „Präsentation" in der Palette', (await kachel.count()) === 1 && (await kachel.textContent()).includes('Präsentation'), gruppe);
  const reihe = await P.evaluate(() => ['praesentation', 'diagramm'].map((id) => Math.round(document.querySelector(`.modul-kachel[data-modul="${id}"]`).getBoundingClientRect().top)));
  pruefe('A1b steht in der Reihe von „Ablauf" (keine Kachel allein in einer Zeile)', reihe[0] === reihe[1], reihe);
  pruefe('A2 Hinweis nennt Vibe Studio', /Vibe Studio/.test((await kachel.getAttribute('title')) ?? ''));
  for (const w of ['folien', 'vibe']) {
    await P.fill('.modul-suche input', w); await P.waitForTimeout(200);
    const namen = await P.locator('.modul-kachel').allTextContents();
    pruefe(`A3 Suche „${w}" findet die Präsentation`, namen.some((n) => n.includes('Präsentation')), namen.join(', '));
  }
  await P.fill('.modul-suche input', ''); await P.waitForTimeout(150);

  const vorher = (await knoten(P)).length;
  await P.locator('.modul-kachel[data-modul="praesentation"]').click();
  await P.waitForTimeout(1500);
  const nodes = await knoten(P);
  const neu = nodes.find((n) => n.type === 'htmlapp' && n.data?.vorlage === 'vibestudio');
  neuId = neu?.id ?? null;
  pruefe('B1 neue App-Karte mit Vibe-Studio-Vorlage', nodes.length === vorher + 1 && !!neu, nodes.map((n) => n.type).join(','));
  pruefe('B2 Format 800 × 520, Name „Präsentation"', neu?.width === 800 && neu?.height === 520 && neu?.data?.name === 'Präsentation', [neu?.width, neu?.height, neu?.data?.name]);
  const f = await warteRahmen(P);
  pruefe('B3 läuft sofort (ohne ▶)', !!f && (await P.locator(`.react-flow__node[data-id="${neuId}"] iframe.happ-frame`).count()) === 1);
  pruefe('B4 die vorhandene eigene App bleibt angehalten (kein Autostart für alle)', (await P.locator('.react-flow__node[data-id="h1"] iframe').count()) === 0);
  const titel = f ? (await f.locator('.chapter-title h1').first().textContent())?.trim() : null;
  pruefe('C1 leere Titelfolie „Neue Präsentation", Signatur ohne fremden Namen', titel === 'Neue Präsentation' && !(await f.content()).includes('Hannes Pix <span>'), titel);
  pruefe('C2 kein toter Link „Alle Vorträge"', f ? !(await f.locator('#decks').isVisible()) : false);

  // Karte auswählen (sonst gehören Klicks dem Board), dann Bearbeiten
  const k = await P.locator(`.react-flow__node[data-id="${neuId}"]`).boundingBox();
  await P.mouse.click(k.x + 60, k.y + 12); await P.waitForTimeout(300);
  await f.locator('#edit').click({ force: true }); await P.waitForTimeout(900);
  pruefe('C3 „Bearbeiten" öffnet den Editor (Präsentieren, + Text, HTML speichern)',
    await f.locator('#editor-present').isVisible() && await f.locator('#editor-add').isVisible(), '');
  await P.screenshot({ path: `${SD}/m425-a-editor.png` });

  // D: Titel bearbeiten
  const h1 = f.locator('.chapter-title h1').first();
  await h1.click(); await P.waitForTimeout(200);
  await f.evaluate(() => {
    const el = document.querySelector('.chapter-title h1');
    const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await P.keyboard.type('Quartalsbericht');
  await f.locator('.reveal').first().click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  await P.waitForTimeout(2500);
  const gespeichert = await P.evaluate(async (id) => {
    const db = await new Promise((ok2, nein) => { const r = indexedDB.open('pixinotes-sync'); r.onsuccess = () => ok2(r.result); r.onerror = () => nein(r.error); });
    const v = await new Promise((ok2) => { const q = db.transaction('kv').objectStore('kv').get(`happ-state:${id}`); q.onsuccess = () => ok2(q.result); q.onerror = () => ok2(null); });
    return v ? JSON.stringify(v) : '';
  }, neuId);
  pruefe('D1 Entwurf liegt im Speicherstand der Karte', gespeichert.includes('Quartalsbericht'), gespeichert.slice(0, 160));
}
// E: Vollbild-Erlaubnis
{
  const allow = await P.locator(`.react-flow__node[data-id="${neuId}"] iframe.happ-frame`).getAttribute('allow');
  pruefe('E1 Vibe-Studio-Karte darf Vollbild', allow === 'fullscreen', String(allow));
}
// D2: Neuladen → Start → Text noch da
{
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  pruefe('D2 nach dem Neuladen nicht von selbst gestartet (wie jede eigene App)', (await P.locator(`.react-flow__node[data-id="${neuId}"] iframe`).count()) === 0);
  const startKnopf = P.locator(`.react-flow__node[data-id="${neuId}"] .happ-startbtn`);
  await startKnopf.waitFor({ state: 'visible' });
  await P.waitForFunction((id) => !document.querySelector(`.react-flow__node[data-id="${id}"] .happ-startbtn`)?.disabled, neuId, { timeout: 8000 }).catch(() => {});
  await startKnopf.click();
  const f = await warteRahmen(P, 15000);
  const titel = f ? (await f.locator('.chapter-title h1').first().textContent())?.trim() : null;
  pruefe('D3 der bearbeitete Titel ist wieder da', titel === 'Quartalsbericht', titel);
  // andere App zum Vergleich starten (Inhalt fehlt hier → bleibt aus) — die Erlaubnis hängt an der Vorlage
  const html = await P.locator(`.react-flow__node[data-id="${neuId}"] iframe.happ-frame`).getAttribute('allow');
  pruefe('E2 auch nach dem Neuladen mit Vollbild-Erlaubnis', html === 'fullscreen');
  // Vollbild aus der Folie heraus (Knopf unten rechts) — die Folie füllt den Bildschirm, Esc kehrt zurück
  await P.mouse.click((await P.locator(`.react-flow__node[data-id="${neuId}"]`).boundingBox()).x + 60, (await P.locator(`.react-flow__node[data-id="${neuId}"]`).boundingBox()).y + 12);
  // Die Karte ist auf dem Board gezoomt: Die Lage des Knopfs im Rahmen auf den Bildschirm umrechnen
  const kb = await P.locator(`.react-flow__node[data-id="${neuId}"] iframe.happ-frame`).boundingBox();
  await P.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await P.mouse.move(kb.x + kb.width - 40, kb.y + kb.height - 30); await P.waitForTimeout(400);
  const innen = await f.evaluate(() => { const r = document.querySelector('#fullscreen').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: innerWidth }; });
  const mass = kb.width / innen.w;
  await P.mouse.click(kb.x + innen.x * mass, kb.y + innen.y * mass); await P.waitForTimeout(700);
  const voll = await P.evaluate(() => document.fullscreenElement?.tagName ?? null);
  pruefe('E4 Vollbild-Knopf der Folie bringt die Präsentation ins Vollbild', voll === 'IFRAME', String(voll));
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
  await P.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await P.waitForTimeout(300);
}
await ctx.close();
// E3: eine gewöhnliche eigene App ohne Vollbild-Erlaubnis
{
  const c = await kontext();
  const Q = await auf(c);
  await Q.evaluate(async () => {
    const db = await new Promise((ok2, nein) => { const r = indexedDB.open('pixinotes-sync'); r.onsuccess = () => ok2(r.result); r.onerror = () => nein(r.error); });
    await new Promise((ok2) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put('<!doctype html><p>Rechner</p>', 'happ:h1'); tx.oncomplete = ok2; });
  });
  await Q.reload({ waitUntil: 'networkidle' }); await Q.waitForTimeout(1400);
  await Q.locator('.react-flow__node[data-id="h1"] .happ-startbtn').click(); await Q.waitForTimeout(700);
  const allow = await Q.locator('.react-flow__node[data-id="h1"] iframe.happ-frame').getAttribute('allow').catch(() => 'fehlt');
  pruefe('E3 gewöhnliche eigene App: kein Vollbild aus dem Rahmen', allow === null, String(allow));
  await c.close();
}

// ══ F: Herkunft der Vorlage ══
console.log('\n════ F: Vorlage ════');
{
  const c = await kontext();
  let vonSeite = 0;
  await c.route('**/vorlagen/vibestudio.html', (r) => {
    if (r.request().url().startsWith('https://hannespix.github.io/')) { vonSeite += 1; return r.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: VORLAGE }); }
    return r.fulfill({ status: 404, body: 'fehlt' });
  });
  const Q = await auf(c);
  await paletteAuf(Q);
  await Q.locator('.modul-kachel[data-modul="praesentation"]').click(); await Q.waitForTimeout(1500);
  const n = (await knoten(Q)).filter((k) => k.data?.vorlage === 'vibestudio').length;
  pruefe('F1 fehlt die Vorlage neben der App, kommt sie von der veröffentlichten Seite', n === 1 && vonSeite === 1, `karten=${n} seite=${vonSeite}`);
  await c.close();
}
{
  const c = await kontext();
  await c.route('**/vorlagen/vibestudio.html', (r) => r.abort());
  const Q = await auf(c);
  await paletteAuf(Q);
  await Q.locator('.modul-kachel[data-modul="praesentation"]').click(); await Q.waitForTimeout(1200);
  const n = (await knoten(Q)).filter((k) => k.data?.vorlage === 'vibestudio').length;
  const toast = await Q.locator('.toast, [role="status"]').allTextContents();
  pruefe('F2 ganz ohne Vorlage: keine leere Karte, dafür ein Hinweis', n === 0 && toast.join(' ').includes('nicht erreichbar'), toast.join(' | '));
  await c.close();
}

// ══ G: Hilfe, Umbau ══
console.log('\n════ G: Hilfe, Umbau ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const umbau = readFileSync(path.join(__repo, 'docs/UMBAU.md'), 'utf8');
  pruefe('G1 Hilfe nennt M425', /M425/.test(hilfe));
  pruefe('G2 Umbau-Liste nennt M425', /M425/.test(umbau));
  pruefe('G3 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}

await browser.close();
app.close();
console.log(`\nM425: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
