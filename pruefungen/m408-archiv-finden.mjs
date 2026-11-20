/**
 * M408 — Das Archiv wiederfinden.
 *
 * Gemeldet: „Wo finde ich das Archiv, wenn etwas archiviert wurde? Ich glaube, das ist weg?!"
 *
 * Ursache: Der Schalter „Archiv einblenden" stand nur am unteren Ende der Navigation – am Telefon gibt es sie
 * nicht, und der Hinweis beim Archivieren nannte nur Strg+Z.
 *
 *   A  Karte archivieren: Der Hinweis sagt, wo das Archiv ist, und bietet „Rückgängig".
 *   B  ⋯ Mehr → „Archiv einblenden (n)": die Karte ist wieder zu sehen (gedämpft), lässt sich zurückholen;
 *      „Archiv ausblenden" verbirgt wieder. Ohne Archiviertes steht der Eintrag nicht im Menü.
 *   C  Die Suche (Strg+K) kennt „Archiv einblenden".
 *   D  Am Telefon: derselbe Eintrag im Mehr-Menü.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m408-archiv-finden.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4724;
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
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const notiz = (id, x, text, mehr = {}) => ({ id, type: 'note', position: { x, y: 0 }, width: 260, height: 170, autoFit: false, ...mehr, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const auf = async (nodes, opt = {}, sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript(([n, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [nodes, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
const sichtbar = (P, id) => P.evaluate((k) => { const e = document.querySelector(`.react-flow__node[data-id="${k}"]`); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'; }, id);
const archiviert = (P, id) => P.evaluate((k) => !!JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === k)?.archived, id);
const mehrAuf = async (P, tippen = false) => { const k = P.locator('.dock button[aria-label="Mehr"]'); if (tippen) await k.tap(); else await k.click(); await P.waitForTimeout(300); };
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');

// ---------- A: archivieren ----------
console.log('A  Archivieren: der Hinweis nennt den Weg zum Archiv');
const V = await auf([notiz('a', 0, 'Bleibt'), notiz('b', 400, 'Wird archiviert')]);
const P = V.P;
{
  await mehrAuf(P);
  pruefe('A0 ohne Archiviertes steht „Archiv einblenden" nicht im Mehr-Menü', (await P.locator('[data-taste="dock-archiv"]').count()) === 0 && (await P.locator('.dock-menu-more').count()) === 1);
  await P.keyboard.press('Escape'); await P.mouse.click(1250, 700); await P.waitForTimeout(250);
  await P.locator('.react-flow__node[data-id="b"] .card-grip').click({ force: true }); await P.waitForTimeout(300);
  await P.locator('.sel-toolbar [data-taste="auswahl-mehr"]').click(); await P.waitForTimeout(300);
  await P.locator('.sel-more-menu button', { hasText: 'Archivieren' }).first().click(); await P.waitForTimeout(500);
  const t = await toast(P);
  pruefe('A1 die Karte ist archiviert und vom Board verschwunden', (await archiviert(P, 'b')) && !(await sichtbar(P, 'b')) && (await sichtbar(P, 'a')));
  pruefe('A2 der Hinweis sagt, wo sie wiederzufinden ist – und bietet „Rückgängig"', /^Karte archiviert\. Wiederfinden: Mehr → „Archiv einblenden"/.test(t) && /Rückgängig/.test(t), t);
}

// ---------- B: Mehr-Menü ----------
console.log('B  ⋯ Mehr → „Archiv einblenden"');
{
  await P.waitForTimeout(600);
  await mehrAuf(P);
  const eintrag = P.locator('[data-taste="dock-archiv"]');
  pruefe('B1 im Mehr-Menü steht jetzt „Archiv einblenden (1)"', (await eintrag.count()) === 1 && /^\s*Archiv einblenden \(1\)\s*$/.test(await eintrag.textContent()), await eintrag.textContent().catch(() => ''));
  await eintrag.click(); await P.waitForTimeout(500);
  const blass = await P.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="b"]'); return e ? { klasse: e.classList.contains('archived-card'), deckung: Number(getComputedStyle(e).opacity) } : null; });
  pruefe('B2 ein Klick blendet das Archiv ein: die Karte ist wieder da, gedämpft', (await sichtbar(P, 'b')) && !!blass && blass.klasse && blass.deckung < 0.8, blass);
  // zurückholen
  await P.locator('.react-flow__node[data-id="b"] .card-grip').click({ force: true }); await P.waitForTimeout(300);
  await P.locator('.sel-toolbar [data-taste="auswahl-mehr"]').click(); await P.waitForTimeout(300);
  const zurueck = P.locator('.sel-more-menu button', { hasText: /zurückholen/i }).first();
  pruefe('B3 an der archivierten Karte steht „zurückholen"', (await zurueck.count()) === 1, await P.evaluate(() => [...document.querySelectorAll('.sel-more-menu button')].map((b) => b.textContent.trim()).filter((x) => /rchiv/.test(x))));
  await zurueck.click(); await P.waitForTimeout(600);
  pruefe('B4 zurückgeholt: die Karte gehört wieder zum Board', !(await archiviert(P, 'b')) && (await sichtbar(P, 'b')) && /aus dem Archiv zurückgeholt/.test(await toast(P)), await toast(P));
  // wieder archivieren, Archiv ausblenden
  await P.locator('.react-flow__node[data-id="b"] .card-grip').click({ force: true }); await P.waitForTimeout(300);
  await P.locator('.sel-toolbar [data-taste="auswahl-mehr"]').click(); await P.waitForTimeout(300);
  await P.locator('.sel-more-menu button', { hasText: 'Archivieren' }).first().click(); await P.waitForTimeout(700);
  pruefe('B5 eingeblendet bleibt eine frisch archivierte Karte sichtbar (gedämpft)', (await archiviert(P, 'b')) && (await sichtbar(P, 'b')));
  await mehrAuf(P);
  pruefe('B6 der Eintrag heißt jetzt „Archiv ausblenden"', /^\s*Archiv ausblenden\s*$/.test(await eintrag.textContent()), await eintrag.textContent().catch(() => ''));
  await eintrag.click(); await P.waitForTimeout(500);
  pruefe('B7 ausgeblendet: die archivierte Karte ist wieder verborgen', !(await sichtbar(P, 'b')) && (await sichtbar(P, 'a')));
  // „Rückgängig" im Hinweis
  await P.locator('.react-flow__node[data-id="a"] .card-grip').click({ force: true }); await P.waitForTimeout(300);
  await P.locator('.sel-toolbar [data-taste="auswahl-mehr"]').click(); await P.waitForTimeout(300);
  await P.locator('.sel-more-menu button', { hasText: 'Archivieren' }).first().click(); await P.waitForTimeout(400);
  await P.locator('.toast button', { hasText: 'Rückgängig' }).click(); await P.waitForTimeout(600);
  pruefe('B8 „Rückgängig" im Hinweis holt die Karte sofort zurück', !(await archiviert(P, 'a')) && (await sichtbar(P, 'a')));
}

// ---------- C: Suche ----------
console.log('C  Die Suche kennt das Archiv');
{
  await P.keyboard.press('Escape'); await P.mouse.click(1250, 700); await P.waitForTimeout(250);
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box'); await P.waitForTimeout(250);
  await P.keyboard.type('archiv'); await P.waitForTimeout(500);
  const treffer = await P.evaluate(() => [...document.querySelectorAll('.search-backdrop button, .search-backdrop [role="option"], .search-backdrop li')].map((e) => e.textContent.trim()).filter((x) => /Archiv einblenden/.test(x)).length);
  pruefe('C1 „archiv" in der Suche bietet „Archiv einblenden" an', treffer >= 1, treffer);
  await P.keyboard.press('Enter'); await P.waitForTimeout(600);
  pruefe('C2 Enter blendet das Archiv ein', (await sichtbar(P, 'b')) && (await P.locator('.search-box').count()) === 0);
}
await V.ctx.close();

// ---------- D: Telefon ----------
console.log('D  Am Telefon');
{
  const T = await auf([notiz('a', 0, 'Bleibt'), notiz('b', 0, 'Im Archiv', { archived: true, position: { x: 0, y: 220 } })], { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const Q = T.P;
  pruefe('D0 die archivierte Karte ist nicht zu sehen', !(await sichtbar(Q, 'b')) && (await sichtbar(Q, 'a')));
  await mehrAuf(Q, true);
  const e = Q.locator('[data-taste="dock-archiv"]');
  const lage = await e.evaluate((el) => { const r = el.getBoundingClientRect(); return { imBild: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth, h: Math.round(r.height) }; }).catch(() => null);
  pruefe('D1 im Mehr-Menü steht „Archiv einblenden (1)" – ganz im Bild, mit dem Finger zu treffen', !!lage && lage.imBild && lage.h >= 40 && /Archiv einblenden \(1\)/.test(await e.textContent()), lage);
  await e.tap(); await Q.waitForTimeout(600);
  pruefe('D2 ein Tipp blendet die archivierte Karte ein', await sichtbar(Q, 'b'));
  await T.ctx.close();
}

// ---------- E: Texte ----------
console.log('E  Texte');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  const en = JSON.parse(lies('src/sprache/en.json'));
  pruefe('E1 englisch', en['Karte archiviert. Wiederfinden: Mehr → „Archiv einblenden".'] === 'Card archived. Find it again: More → “Show archive”.' && /^\{0\} cards archived/.test(en['{0} Karten archiviert. Wiederfinden: Mehr → „Archiv einblenden".'] ?? ''), en['Karte archiviert. Wiederfinden: Mehr → „Archiv einblenden".']);
  pruefe('E2 die Hilfe nennt M408 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M408)') && lies('src/components/HelpOverlayEn.tsx').includes('(M408)'));
  pruefe('E3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm408-archiv-finden: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
