/**
 * M449 — Board-Versionen: frühere Stände ansehen und wiederherstellen.
 *
 *   A  Ohne Änderung keine Version; die erste Änderung sichert den Stand davor, Verlassen den Stand danach.
 *      Der Dialog steht im Mehr-Menü, im ⋯ des Boards und in der Suche (Strg+K).
 *   B  Wiederherstellen: erst nach Bestätigung, danach stimmt der Inhalt (auch ein großes eingebettetes Feld),
 *      Strg+Z nimmt es zurück.
 *   C  Als Kopie: neues Board mit dem Stand, das Original bleibt.
 *   D  Ausdünnen: letzte Stunde alles, bis 24 h eine je Stunde, älter eine je Tag, höchstens 50.
 *   E  Größe: eine große Zeichenkette liegt über alle Stände nur einmal im Speicher.
 *   F  Texte (englisch, Hilfe), keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m449-board-versionen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5449;
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

const GROSS = 'Langer Text '.repeat(3000);
const notiz = (id, x, text, mehr = {}) => ({ id, type: 'note', position: { x, y: 0 }, width: 260, height: 170, autoFit: false, ...mehr, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] } });
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([a, b, c]) => {
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], nodes: [a, b] }, { id: 'b2', name: 'Zweites', edges: [], drawings: [], nodes: [c] }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1', 'b2'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
}, [notiz('a', 0, GROSS), notiz('b', 400, 'Wird gelöscht'), notiz('c', 0, 'Anderes Board')]);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(3200);

const zustand = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const karten = async (id) => ((await zustand()).boards.find((b) => b.id === id)?.nodes ?? []).map((n) => n.id).sort().join(',');
const idb = (fn, arg) => P.evaluate(([f, a]) => new Promise((ok, nein) => {
  const r = indexedDB.open('pixinotes-sync', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onerror = () => nein(r.error);
  r.onsuccess = () => {
    const db = r.result;
    // eslint-disable-next-line no-new-func
    new Function('db', 'arg', 'ok', f)(db, a, ok);
  };
}), [fn, arg]);
const schluessel = () => idb("const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => ok(q.result.map(String));");
const setze = (k, v) => idb("const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(arg[1], arg[0]); tx.oncomplete = () => ok(true);", [k, v]);
const toast = () => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const liste = () => P.evaluate(() => [...document.querySelectorAll('[data-taste="version"]')].map((e) => ({ karten: Number(e.dataset.karten), grund: e.dataset.grund, text: e.textContent })));
const zu = async () => { await P.keyboard.press('Escape'); await P.waitForTimeout(250); };
const mehrAuf = async () => { await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(300); };
const tab = async (name) => { await P.locator('.tab', { hasText: name }).first().click(); await P.waitForTimeout(700); };

// ---------- A ----------
console.log('A  Stände entstehen von selbst');
{
  pruefe('A0 ohne Änderung noch keine Version im Speicher', !(await schluessel()).some((k) => k.startsWith('ver-ix:')));
  await mehrAuf();
  pruefe('A1 ⋯ Mehr bietet „Versionen …"', (await P.locator('[data-taste="dock-versionen"]').count()) === 1);
  await P.locator('[data-taste="dock-versionen"]').click(); await P.waitForTimeout(500);
  pruefe('A2 der Dialog sagt, dass es noch keine Versionen gibt', (await P.locator('[data-taste="versionen-leer"]').count()) === 1);
  await zu();
  // Karte b löschen
  await P.locator('.react-flow__node[data-id="b"] .card-grip').click({ force: true }); await P.waitForTimeout(250);
  await P.keyboard.press('Delete'); await P.waitForTimeout(500);
  pruefe('A3 Karte b ist gelöscht', (await karten('b1')) === 'a', await karten('b1'));
  await tab('Zweites');
  await tab('Test');
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box'); await P.waitForTimeout(250);
  await P.keyboard.type('versionen'); await P.waitForTimeout(400);
  const treffer = await P.evaluate(() => [...document.querySelectorAll('.search-backdrop button, .search-backdrop [role="option"], .search-backdrop li')].filter((e) => /Versionen/.test(e.textContent)).length);
  pruefe('A4 die Suche kennt „Versionen"', treffer >= 1, treffer);
  await P.locator('.search-cmd', { hasText: 'Versionen' }).first().click(); await P.waitForTimeout(700);
  pruefe('A5 der Befehl öffnet den Dialog', (await P.locator('[data-taste="versionen-dialog"]').count()) === 1);
  const l = await liste();
  pruefe('A6 zwei Stände: nach dem Verlassen (1 Karte) und vor der ersten Änderung (2 Karten)',
    l.length === 2 && l[0].karten === 1 && l[0].grund === 'verlassen' && l[1].karten === 2 && l[1].grund === 'sitzung', l);
}

// ---------- B ----------
console.log('B  Wiederherstellen');
{
  await P.locator('[data-taste="version"]').nth(1).click(); await P.waitForTimeout(500);
  const teile = Number(await P.locator('[data-taste="versionen-skizze"]').getAttribute('data-teile'));
  pruefe('B1 die Vorschau zeigt zwei Karten', teile === 2, teile);
  pruefe('B2 und sagt, was zurückkäme', /1 kämen zurück/.test(await P.locator('[data-taste="versionen-zahlen"]').textContent()));
  await P.locator('[data-taste="version-wiederherstellen"]').click(); await P.waitForTimeout(300);
  pruefe('B3 nichts geschieht ohne Bestätigung', (await karten('b1')) === 'a' && (await P.locator('[data-taste="version-ersetzen-ja"]').count()) === 1);
  await P.locator('[data-taste="version-ersetzen-ja"]').click(); await P.waitForTimeout(900);
  const st = await zustand();
  const a = st.boards.find((b) => b.id === 'b1').nodes.find((n) => n.id === 'a');
  pruefe('B4 das Board hat wieder beide Karten – samt großem Feld', (await karten('b1')) === 'a,b' && a?.data?.blocks?.[0]?.content?.[0]?.text === GROSS, await karten('b1'));
  pruefe('B5 Karte b ist auf der Fläche zu sehen', (await P.locator('.react-flow__node[data-id="b"]').count()) === 1);
  pruefe('B6 der Hinweis nennt Strg+Z', /Strg\+Z/.test(await toast()), await toast());
  await P.mouse.click(1250, 700); await P.waitForTimeout(200);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(700);
  pruefe('B7 Strg+Z nimmt das Wiederherstellen zurück', (await karten('b1')) === 'a', await karten('b1'));
  await P.keyboard.press('Control+y'); await P.waitForTimeout(700);
  pruefe('B8 Strg+Y stellt wieder her', (await karten('b1')) === 'a,b', await karten('b1'));
}

// ---------- C ----------
console.log('C  Als Kopie öffnen');
{
  // b wieder löschen, damit Original und Stand sich unterscheiden
  await P.locator('.react-flow__node[data-id="b"] .card-grip').click({ force: true }); await P.waitForTimeout(250);
  await P.keyboard.press('Delete'); await P.waitForTimeout(500);
  // Diesmal über das ⋯ des Boards in der Übersicht
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box'); await P.keyboard.type('übersicht'); await P.waitForTimeout(400);
  await P.locator('.search-cmd', { hasText: 'Zur Übersicht' }).first().click(); await P.waitForTimeout(1500);
  const kachel = P.locator('.ov-board', { hasText: 'Test' }).first();
  await kachel.hover(); await P.waitForTimeout(200);
  await kachel.locator('.ebenen-menu-knopf').click({ force: true }); await P.waitForTimeout(300);
  pruefe('C0 das ⋯ des Boards bietet „Versionen …"', (await P.locator('[data-taste="board-versionen"]').count()) === 1);
  await P.locator('[data-taste="board-versionen"]').click(); await P.waitForTimeout(700);
  const l = await liste();
  const i = l.findIndex((v) => v.karten === 2);
  await P.locator('[data-taste="version"]').nth(i).click(); await P.waitForTimeout(500);
  await P.locator('[data-taste="version-kopie"]').click(); await P.waitForTimeout(900);
  const st = await zustand();
  const kopie = st.boards.find((b) => /^Test \(Stand /.test(b.name));
  pruefe('C1 ein neues Board „Test (Stand …)" mit beiden Karten (frische Kennungen) ist offen',
    !!kopie && kopie.nodes.length === 2 && !kopie.nodes.some((n) => n.id === 'a' || n.id === 'b') && st.activeId === kopie.id, st.boards.map((b) => b.name));
  pruefe('C2 das Original bleibt bei einer Karte', (await karten('b1')) === 'a');
  pruefe('C3 die Kopie liegt im selben Projekt', st.spaces[0].projects[0].boardIds.includes(kopie?.id));
}

// ---------- D ----------
console.log('D  Ausdünnen');
{
  const jetzt = Date.now();
  const H = 3600_000, T = 24 * H;
  const v = (at, i) => ({ id: `alt-${i}`, boardId: 'b2', at, grund: 'automatisch', name: 'Zweites', karten: 1, pfeile: 0, sig: `alt${i}`, bytes: 100, blobs: [], anhaenge: [] });
  const alt = [];
  for (let i = 0; i < 5; i++) alt.push(v(jetzt - (5 + i * 10) * 60_000, alt.length));        // letzte Stunde: alle bleiben
  for (let i = 0; i < 8; i++) alt.push(v(jetzt - 2 * H - i * 15 * 60_000, alt.length));      // 2–3,75 h: je Stunde einer
  for (let d = 2; d < 5; d++) for (let k = 0; k < 3; k++) alt.push(v(jetzt - d * T - k * H, alt.length)); // 3 Tage, je 3
  await setze('ver-ix:b2', alt.sort((a, b) => a.at - b.at));
  await tab('Zweites');
  await mehrAuf();
  await P.locator('[data-taste="dock-versionen"]').click(); await P.waitForTimeout(600);
  await P.locator('[data-taste="version-sichern"]').click(); await P.waitForTimeout(900);
  pruefe('D1 „Stand jetzt sichern" bestätigt', /Stand gesichert/.test(await toast()), await toast());
  const ix = await idb("const q = db.transaction('kv').objectStore('kv').get('ver-ix:b2'); q.onsuccess = () => ok(q.result);");
  const jung = ix.filter((x) => jetzt - x.at < H);
  const stunde = ix.filter((x) => jetzt - x.at >= H && jetzt - x.at < T);
  const tage = ix.filter((x) => jetzt - x.at >= T);
  const stunden = new Set(stunde.map((x) => Math.floor(x.at / H)));
  const tagSet = new Set(tage.map((x) => new Date(x.at).toDateString()));
  pruefe('D2 die letzte Stunde bleibt vollständig (5 + der neue)', jung.length === 6, jung.length);
  pruefe('D3 bis 24 h höchstens einer je Stunde', stunde.length === stunden.size && stunde.length >= 2 && stunde.length <= 3, stunde.length);
  pruefe('D4 älter: einer je Tag', tage.length === 3 && tagSet.size === 3, tage.length);
  pruefe('D5 der Dialog listet dieselbe Zahl', (await liste()).length === ix.length, [(await liste()).length, ix.length]);
  await zu();
  // Obergrenze: 80 Stände in der letzten Stunde → nach dem nächsten Sichern 50
  const viele = [];
  for (let i = 0; i < 80; i++) viele.push(v(jetzt - 50 * 60_000 + i * 30_000, 100 + i));
  await setze('ver-ix:b2', viele);
  await P.locator('.react-flow__node[data-id="c"] .card-grip').click({ force: true }); await P.waitForTimeout(250);
  await P.keyboard.press('Delete'); await P.waitForTimeout(400);
  await mehrAuf();
  await P.locator('[data-taste="dock-versionen"]').click(); await P.waitForTimeout(500);
  await P.locator('[data-taste="version-sichern"]').click(); await P.waitForTimeout(900);
  const l = await liste();
  pruefe('D6 höchstens 50 Stände, der neueste (leeres Board) vorn', l.length === 50 && l[0].karten === 0 && l[0].grund === 'manuell', [l.length, l[0]]);
  await zu();
}

// ---------- E ----------
console.log('E  Größe');
{
  const keys = await schluessel();
  const staende = keys.filter((k) => k.startsWith('ver:b1-')).length;
  const blobs = keys.filter((k) => k.startsWith('ver-blob:')).length;
  pruefe('E1 mehrere Stände von „Test", das große Feld liegt nur einmal im Speicher', staende >= 2 && blobs === 1, { staende, blobs });
  const lsGross = await P.evaluate(() => (localStorage.getItem('pixinotes-board') ?? '').length);
  pruefe('E2 die Versionen liegen nicht im localStorage', !(await P.evaluate(() => Object.keys(localStorage).some((k) => /ver/.test(k) && k !== 'pixinotes-version'))) && lsGross < 400_000, lsGross);
}

// ---------- F ----------
console.log('F  Texte');
{
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  const en = JSON.parse(lies('src/sprache/en.json'));
  pruefe('F1 englisch', !!en['Versionen …'] && !!en['Stand jetzt sichern'] && !!en['Als Kopie öffnen'] && !!en['Ja, wiederherstellen'], en['Versionen …']);
  pruefe('F2 die Hilfe nennt M449 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M449)') && lies('src/components/HelpOverlayEn.tsx').includes('(M449)'));
  pruefe('F3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm449-board-versionen: ${ok} bestanden, ${bad} fehlgeschlagen`);
await ctx.close();
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
