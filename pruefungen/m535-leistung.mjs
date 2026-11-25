/**
 * M535 — Leistung: ruhende Flüssigkeit, Standbild für animierte SVG-Bilder, Tools halten an, Diagramme abseits des
 * Board-Dokuments, Ablegen genau am Zeiger.
 *
 *   A  Flüssige Schrift: „lebendig" rechnet, solange die Maus woanders ist; steht die Maus gut 2 s still über der
 *      Karte, hält sie an (keine Rechenschritte, das Bild steht); die nächste Bewegung weckt sie sofort. Nach dem
 *      Neu-Abtasten (Größe geändert) schläft „lebendig" nicht ein (Nebenbefund aus M525).
 *   B  Animiertes SVG-Bild: im Ruhezustand bewegt es sich (Pixel); während eine Karte gezogen wird, steht es (Pixel
 *      gleich, nicht leer); nach dem Ablegen bewegt es sich wieder; außerhalb des Bildes zeigt es das Standbild, beim
 *      Hereinschwenken läuft es wieder. Ein nicht animiertes Bild bleibt unberührt.
 *   C  Tools: ein laufendes Tool hält an, wenn es eine Weile außerhalb des Bildes ist (hier auf 1,5 s gekürzt), sagt
 *      es auf der Karte und startet per Klick mit seinem gespeicherten Stand; eines im Bild läuft weiter; „Alle Tools
 *      anhalten" (Kontextmenü des Boards und ⋯ der Karte) hält alle an.
 *   D  Diagramme: Beim Öffnen eines Boards mit Diagrammen hängt mermaid nichts mehr ins Board-Dokument (nur einmal den
 *      unsichtbaren Rahmen); die Diagramme stehen, Beschriftungen passen in ihre Kästen; Klick auf einen Schritt
 *      bearbeitet wie bisher.
 *   E  Ablegen: Folgt das Loslassen ohne Bild Abstand auf die letzte Mausbewegung, liegt die Karte trotzdem am Zeiger.
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m535`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5535;
const laufe = (teil) => !process.env.NUR || [...teil].some((b) => process.env.NUR.includes(b));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const note = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 260, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const stand = (nodes) => ({
  boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false,
});
async function seite(nodes, opt = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`) && !u.href.startsWith('data:') && !u.href.startsWith('about:'), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript(([st, ms]) => {
    try { if (window !== window.top) return; } catch { return; }
    if (ms) window.__pnToolAnhaltenMs = ms;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand(nodes), opt.toolMs ?? 0]);
  const P = await ctx.newPage();
  const fehler = [];
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow', { state: 'visible', timeout: 30000 });
  if (nodes.length) await P.waitForSelector('.react-flow__node', { state: 'visible', timeout: 30000 });
  return { ctx, P, fehler };
}
const warteBis = async (P, fn, ms = 15000, arg) => P.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
const kasten = async (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
/** Ansicht so schwenken, dass die Karte mittig steht (Rad = schwenken) */
async function aufKarte(P, id, wo = [640, 400]) {
  for (let r = 0; r < 40; r++) {
    const b = await kasten(P, id);
    if (!b) return false;
    const dx = b.x + b.width / 2 - 640, dy = b.y + b.height / 2 - 400;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return true;
    await P.mouse.move(wo[0], wo[1]); await P.mouse.wheel(dx, dy); await P.waitForTimeout(80);
  }
  return false;
}
/** Ansicht um (dx, dy) Bildpunkte schwenken (Rad), danach Maus in eine ruhige Ecke */
async function schwenken(P, dx, dy, wo = [640, 400]) {
  await P.mouse.move(wo[0], wo[1]);
  const schritte = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 600));
  for (let i = 0; i < schritte; i++) { await P.mouse.wheel(dx / schritte, dy / schritte); await P.waitForTimeout(60); }
  await P.mouse.move(1270, 790);
}
const bildVon = (P, b) => P.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } });
const gleich = (a, b) => a.length === b.length && a.equals(b);

// ══ A: Flüssige Schrift ═════════════════════════════════════════════
console.log('\n════ A: Flüssige Schrift hält an, wenn die Maus still über ihr steht ════');
if (laufe('A')) {
  const fl = (id, text, x, y, extra = {}) => ({ id, type: 'fluessig', width: 440, height: 220, autoFit: false, position: { x, y }, data: { text, ...extra } });
  const { ctx, P, fehler } = await seite([fl('f1', 'Welle', 400, 260, { lebendig: true }), note('n1', 'Daneben', 0, 0)]);
  const flaeche = (id) => `[data-id="${id}"] canvas.fl-flaeche`;
  const da = await warteBis(P, (s) => !!document.querySelector(s)?.__fluessig, 30000, flaeche('f1'));
  pruefe('A0 die lebendige Schrift ist da (WebGL2)', da);
  const schritte = () => P.evaluate(() => window.pixinotesFluessig?.schritte ?? 0);
  const zustand = () => P.evaluate((s) => document.querySelector(s)?.__fluessig?.zustand(), flaeche('f1'));
  // Maus weg von der Karte: „lebendig" rechnet weiter
  await P.mouse.move(1270, 790);
  await P.waitForTimeout(800);
  let s0 = await schritte(); await P.waitForTimeout(1500); let s1 = await schritte();
  pruefe('A1 Maus woanders: „lebendig" rechnet weiter', s1 - s0 > 3, `${s0} → ${s1}`);
  // Maus über die Karte bewegen, dann stillhalten
  const b = await kasten(P, 'f1');
  const mx = b.x + b.width * 0.8, my = b.y + b.height * 0.85;
  for (let i = 0; i < 6; i++) { await P.mouse.move(mx - 30 + i * 6, my); await P.waitForTimeout(40); }
  const wach = await warteBis(P, (s) => document.querySelector(s)?.__fluessig?.willLaufen() === true, 3000, flaeche('f1'));
  pruefe('A2 die Bewegung über der Karte weckt sie', wach);
  const angehalten = await warteBis(P, (s) => document.querySelector(s)?.__fluessig?.zustand().angehalten === true, 8000, flaeche('f1'));
  pruefe('A3 nach gut 2 s Stillstand über der Karte hält sie an', angehalten, await zustand());
  await P.waitForTimeout(200);
  s0 = await schritte(); const t0 = await P.evaluate(() => window.pixinotesFluessig?.takte ?? 0);
  const bild0 = await bildVon(P, b);
  await P.waitForTimeout(1500);
  s1 = await schritte(); const t1 = await P.evaluate(() => window.pixinotesFluessig?.takte ?? 0);
  const bild1 = await bildVon(P, b);
  pruefe('A4 angehalten: keine Rechenschritte, kein Takt', s1 === s0 && t1 - t0 <= 1, `Schritte ${s0} → ${s1}, Takte ${t0} → ${t1}`);
  pruefe('A5 … und das Bild steht', gleich(bild0, bild1));
  await P.mouse.move(mx + 8, my - 4);
  const weiter = await warteBis(P, (a) => (window.pixinotesFluessig?.schritte ?? 0) > a, 1500, s1);
  pruefe('A6 die nächste Bewegung lässt sie sofort weiterfließen', weiter);
  // Neu-Abtasten (Größe geändert): „lebendig" darf nicht einschlafen
  await P.mouse.move(1270, 790);
  await P.evaluate((s) => { const f = document.querySelector(s).__fluessig; f.groesse(470, 230); }, flaeche('f1'));
  await P.waitForTimeout(300);
  const nach = await zustand();
  s0 = await schritte(); await P.waitForTimeout(1500); s1 = await schritte();
  pruefe('A7 nach dem Neu-Abtasten schläft „lebendig" nicht ein (rechnet ohne Berührung weiter)', nach?.ruht === false && s1 - s0 > 3, { nach, s0, s1 });
  pruefe('A8 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ B: Animierte SVG-Bilder ═════════════════════════════════════════
console.log('\n════ B: Animiertes SVG-Bild – Standbild beim Ziehen und außerhalb des Bildes ════');
if (laufe('B')) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><style>
    @keyframes wandern { from { transform: translateX(0) } to { transform: translateX(150px) } }
    @keyframes farbe { 0% { fill: #c0392b } 50% { fill: #2980b9 } 100% { fill: #27ae60 } }
    .k { animation: wandern 0.9s linear infinite alternate, farbe 1.3s linear infinite }</style>
    <rect width="240" height="160" fill="#f4f1ea"/><rect class="k" x="10" y="40" width="70" height="80" rx="8"/></svg>`;
  const ruhig = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#dfe8f1"/><circle cx="120" cy="80" r="50" fill="#555"/></svg>`;
  const SRC = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const SRC_RUHIG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ruhig)}`;
  const bild = (id, src, x, y) => ({ id, type: 'image', width: 240, height: 160, position: { x, y }, data: { src, name: `${id}.svg` } });
  const { ctx, P, fehler } = await seite([bild('i1', SRC, 420, 220), bild('i2', SRC_RUHIG, 720, 220), note('n1', 'Zum Ziehen', 60, 420)]);
  await warteBis(P, () => [...document.querySelectorAll('.image-card img')].every((i) => i.complete && i.naturalWidth > 0), 15000);
  await P.mouse.move(1270, 790);
  await P.waitForTimeout(400);
  const bi = await kasten(P, 'i1');
  const innen = { x: bi.x + 4, y: bi.y + 4, width: bi.width - 8, height: bi.height - 8 };
  const zweiBilder = async (ms = 350) => { const a = await bildVon(P, innen); await P.waitForTimeout(ms); return [a, await bildVon(P, innen)]; };
  let [a, c] = await zweiBilder();
  pruefe('B1 im Ruhezustand bewegt sich das Bild (zwei Aufnahmen verschieden)', !gleich(a, c));
  // Notiz greifen und ziehen – Maus bleibt gedrückt
  const bn = await kasten(P, 'n1');
  const gx = bn.x + 8, gy = bn.y + 5;
  await P.mouse.move(gx, gy); await P.mouse.down();
  await P.mouse.move(gx + 2, gy + 2); await P.mouse.move(gx + 4, gy + 3);
  for (let i = 1; i <= 8; i++) { await P.mouse.move(gx + i * 12, gy + i * 4); await P.waitForTimeout(30); }
  const imZug = await warteBis(P, (s) => { const i = document.querySelector('.react-flow__node[data-id="i1"] img'); return !!i && i.getAttribute('src') !== s && i.complete && i.currentSrc !== s; }, 5000, SRC);
  await P.waitForTimeout(250);
  [a, c] = await zweiBilder(500);
  const src = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="i1"] img').getAttribute('src'));
  pruefe('B2 während des Ziehens steht das Bild (zwei Aufnahmen gleich)', imZug && gleich(a, c));
  const nichtLeer = await P.evaluate(async (s) => {
    const i = new Image(); i.src = s; await i.decode();
    const c = document.createElement('canvas'); c.width = 240; c.height = 160; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, 240, 160).data; let dunkel = 0; for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] < 500) dunkel++;
    return dunkel;
  }, src);
  pruefe('B3 … und zeigt die Zeichnung (das Standbild ist nicht leer: der Kasten steht darin)', nichtLeer > 2000, String(nichtLeer));
  pruefe('B4 das nicht animierte Bild bleibt unberührt (gleiche Adresse)', await P.evaluate((s) => document.querySelector('.react-flow__node[data-id="i2"] img').getAttribute('src') === s, SRC_RUHIG));
  await P.mouse.move(gx + 120, gy + 40); await P.mouse.up();
  await warteBis(P, (s) => document.querySelector('.react-flow__node[data-id="i1"] img')?.getAttribute('src') === s, 3000, SRC);
  await P.waitForTimeout(300);
  [a, c] = await zweiBilder();
  pruefe('B5 nach dem Ablegen bewegt es sich wieder', !gleich(a, c));
  // Außerhalb des Bildes
  await schwenken(P, 0, 2600);
  const draussen = await warteBis(P, (s) => document.querySelector('.react-flow__node[data-id="i1"] img')?.getAttribute('src') !== s, 5000, SRC);
  pruefe('B6 außerhalb des Bildes zeigt es das Standbild', draussen);
  await schwenken(P, 0, -2600);
  await aufKarte(P, 'i1'); await P.mouse.move(1270, 790);
  const zurueck = await warteBis(P, (s) => document.querySelector('.react-flow__node[data-id="i1"] img')?.getAttribute('src') === s, 5000, SRC);
  await P.waitForTimeout(400);
  const bi2 = await kasten(P, 'i1');
  const innen2 = { x: bi2.x + 4, y: bi2.y + 4, width: bi2.width - 8, height: bi2.height - 8 };
  a = await bildVon(P, innen2); await P.waitForTimeout(350); c = await bildVon(P, innen2);
  pruefe('B7 wieder im Bild läuft es wie bisher', zurueck && !gleich(a, c));
  await P.screenshot({ path: path.join(SD, 'm535-b-bild.png') });
  pruefe('B8 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ C: Tools halten an ══════════════════════════════════════════════
console.log('\n════ C: Tools halten an (außerhalb des Bildes, „Alle Tools anhalten") ════');
if (laufe('C')) {
  const TOOL = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<button id="plus" style="position:fixed;top:14px;left:20px">Plus</button><span id="zahl" style="position:fixed;top:60px;left:20px">0</span>
<script>var z=document.getElementById('zahl');z.textContent=localStorage.getItem('zahl')||'0';
document.getElementById('plus').onclick=function(){z.textContent=String(+z.textContent+1);localStorage.setItem('zahl',z.textContent);};</script></body></html>`;
  const tool = (id, x, y) => ({ id, type: 'htmlapp', position: { x, y }, width: 380, height: 300, data: { name: `Zähler ${id}`, size: TOOL.length } });
  const { ctx, P, fehler } = await seite([tool('h1', 40, 80), tool('h2', 480, 80)], { toolMs: 1500 });
  await P.waitForLoadState('networkidle');
  await P.evaluate((html) => new Promise((fertig, weh) => {
    const q = indexedDB.open('pixinotes-sync', 1);
    q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('kv')) q.result.createObjectStore('kv'); };
    q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(html, 'happ:h1'); t.objectStore('kv').put(html, 'happ:h2'); t.oncomplete = () => fertig(true); t.onerror = () => weh(t.error); };
    q.onerror = () => weh(q.error);
  }), TOOL);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node[data-id="h2"] .happ-go:not([disabled])', { timeout: 15000 });
  const rahmenVon = async (id) => {
    const el = await P.$(`.react-flow__node[data-id="${id}"] iframe.happ-frame`);
    return el ? el.contentFrame() : null;
  };
  const zahl = async (id) => { const f = await rahmenVon(id); return f ? Number(await f.locator('#zahl').textContent({ timeout: 5000 }).catch(() => '-1')) : -1; };
  const laeuft = (id) => P.locator(`.react-flow__node[data-id="${id}"] iframe.happ-frame`).count().then((n) => n === 1);
  const starten = async (id) => {
    await P.locator(`.react-flow__node[data-id="${id}"] .happ-go`).click();
    await warteBis(P, (k) => !!document.querySelector(`.react-flow__node[data-id="${k}"] iframe.happ-frame`), 8000, id);
    const bis = Date.now() + 10000; while (Date.now() < bis && (await zahl(id)) < 0) await P.waitForTimeout(150);
  };
  await starten('h1'); await starten('h2');
  pruefe('C0 beide Tools laufen', (await laeuft('h1')) && (await laeuft('h2')));
  // in h1 zählen (Stand speichert das Tool selbst)
  await P.locator('.react-flow__node[data-id="h1"] .happ-head').click({ position: { x: 14, y: 12 } });
  const f1 = await rahmenVon('h1');
  await f1.locator('#plus').click(); await f1.locator('#plus').click(); await f1.locator('#plus').click();
  pruefe('C1 das Tool lässt sich bedienen (Zähler 3)', (await zahl('h1')) === 3, String(await zahl('h1')));
  await P.waitForTimeout(700);   // der Shim meldet den Stand nach 250 ms
  // h1 aus dem Bild schwenken, h2 bleibt (teilweise) im Bild
  await P.keyboard.press('Escape');
  // das Rad über leerer Fläche, nicht über einem Tool; so lange, bis h1 ganz links draußen liegt
  for (let r = 0; r < 20; r++) { const k = await kasten(P, 'h1'); if (k.x + k.width < -20) break; await schwenken(P, 200, 0, [640, 640]); }
  const b1 = await kasten(P, 'h1'); const b2 = await kasten(P, 'h2');
  pruefe('C2 h1 liegt außerhalb des Bildes, h2 im Bild', b1.x + b1.width < 0 && b2.x + b2.width > 0, { b1, b2 });
  const weg = await warteBis(P, () => !document.querySelector('.react-flow__node[data-id="h1"] iframe.happ-frame'), 10000);
  pruefe('C3 h1 hält nach einer Weile außerhalb des Bildes von selbst an', weg);
  await P.waitForTimeout(2200);
  pruefe('C4 h2 im Bild läuft weiter', await laeuft('h2'));
  await aufKarte(P, 'h1', [640, 640]); await P.mouse.move(1270, 790);
  const hinweis = await P.locator('.react-flow__node[data-id="h1"] .happ-poster p').textContent().catch(() => '');
  pruefe('C5 die Karte sagt, warum sie angehalten hat', /außerhalb des Bildes/.test(hinweis ?? ''), hinweis);
  pruefe('C6 zurück im Bild startet es nicht von selbst (Start per Klick)', !(await laeuft('h1')));
  await starten('h1');
  pruefe('C7 per Klick gestartet, mit dem gespeicherten Stand (Zähler 3)', (await zahl('h1')) === 3, String(await zahl('h1')));
  // Alle anhalten: Kontextmenü der Fläche
  await P.mouse.click(1000, 700, { button: 'right' });
  const eintrag = P.locator('[data-taste="tools-anhalten"]');
  pruefe('C8 das Kontextmenü des Boards bietet „Alle Tools anhalten"', await eintrag.isVisible().catch(() => false));
  await eintrag.click();
  const alleWeg = await warteBis(P, () => document.querySelectorAll('iframe.happ-frame').length === 0, 5000);
  pruefe('C9 … und hält alle Tools an', alleWeg);
  await P.mouse.click(1000, 700, { button: 'right' });
  pruefe('C10 ohne laufendes Tool fehlt der Eintrag', (await P.locator('[data-taste="tools-anhalten"]').count()) === 0);
  await P.keyboard.press('Escape');
  // ⋯ der Karte (zwei laufen)
  await starten('h1'); await starten('h2');
  await P.locator('[data-hmbtn="h2"]').click();
  const imMenue = P.locator('.happ-menu [data-taste="happ-alle-anhalten"]');
  pruefe('C11 das ⋯ eines laufenden Tools bietet „Alle Tools anhalten"', await imMenue.isVisible().catch(() => false));
  await imMenue.click();
  pruefe('C12 … und hält beide an', await warteBis(P, () => document.querySelectorAll('iframe.happ-frame').length === 0, 5000));
  await P.screenshot({ path: path.join(SD, 'm535-c-tools.png') });
  pruefe('C13 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

// ══ D: Diagramme abseits des Dokuments ══════════════════════════════
console.log('\n════ D: Diagramme zeichnen abseits des Board-Dokuments ════');
if (laufe('D')) {
  const CODES = [
    'flowchart TD\n  A[Start] --> B{Entscheidung}\n  B -->|Ja| C[Schritt mit langer Beschriftung]\n  B -->|Nein| D[Ende]',
    'sequenceDiagram\n  Alice->>Bob: Anfrage\n  Bob-->>Alice: Antwort',
    'pie showData\n  title Verteilung\n  "Vorbereitung" : 20\n  "Umsetzung" : 55',
    'flowchart LR\n  X[Eingang] --> Y[Prüfung der Unterlagen] --> Z[Ablage im Archiv]',
  ];
  const nodes = CODES.map((code, i) => ({ id: `m${i}`, type: 'mermaid', width: 420, height: 320, position: { x: (i % 2) * 460, y: Math.floor(i / 2) * 360 }, data: { code } }));
  for (let i = 0; i < 40; i++) nodes.push(note(`n${i}`, `Notiz ${i}`, 1000 + (i % 5) * 280, Math.floor(i / 5) * 140));
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`) && !u.href.startsWith('data:') && !u.href.startsWith('about:'), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((st) => {
    try { if (window !== window.top) return; } catch { return; }
    // Was mermaid ins Board-Dokument hängt, mitschreiben (vor dem ersten Diagramm)
    window.__eingehaengt = [];
    const los = () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__eingehaengt.push(`${n.nodeName}${n.id ? `#${n.id}` : ''}`); }).observe(document.body, { childList: true });
    if (document.body) los(); else document.addEventListener('DOMContentLoaded', los);
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand(nodes));
  const P = await ctx.newPage();
  const fehler = []; P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 200)); });
  await P.goto(`http://localhost:${PORT}/`);
  const alle = await warteBis(P, (n) => document.querySelectorAll('.mermaid-svg svg').length >= n, 90000, CODES.length);
  pruefe('D1 alle Diagramme stehen', alle);
  const eing = await P.evaluate(() => window.__eingehaengt.filter((n) => /mermaid|^DIV#d|^SVG|^svg|IFRAME/i.test(n)));
  pruefe('D2 mermaid hängt nichts ins Board-Dokument – nur einmal den unsichtbaren Rahmen', eing.length === 1 && eing[0] === 'IFRAME', eing.slice(0, 8).join(', '));
  const rahmen = await P.evaluate(() => { const f = document.querySelector('iframe[data-mermaid-werkstatt]'); if (!f) return null; const r = f.getBoundingClientRect(); return { sichtbar: getComputedStyle(f).visibility, rechts: r.right, aria: f.getAttribute('aria-hidden'), tab: f.tabIndex }; });
  pruefe('D3 der Rahmen ist unsichtbar, außerhalb des Bildes und nicht erreichbar (aria-hidden, kein Tab)', !!rahmen && rahmen.sichtbar === 'hidden' && rahmen.rechts <= 0 && rahmen.aria === 'true' && rahmen.tab === -1, rahmen);
  const ueber = await P.evaluate(() => [...document.querySelectorAll('.mermaid-svg foreignObject')].filter((fo) => { const d = fo.firstElementChild; return d && d.scrollWidth > Math.ceil(fo.getBBox().width) + 1; }).length);
  const fos = await P.evaluate(() => document.querySelectorAll('.mermaid-svg foreignObject').length);
  pruefe('D4 Beschriftungen passen in ihre Kästen (gemessen im Rahmen, gezeigt im Board)', fos > 4 && ueber === 0, { fos, ueber });
  await P.screenshot({ path: path.join(SD, 'm535-d-diagramme.png') });
  pruefe('D5 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
  // Bearbeiten im Diagramm wie bisher (eine Karte, groß genug zum Anklicken)
  const s2 = await seite([{ id: 'd1', type: 'mermaid', width: 420, height: 320, position: { x: 0, y: 0 }, data: { code: CODES[0] } }]);
  await warteBis(s2.P, () => document.querySelectorAll('.react-flow__node[data-id="d1"] .mermaid-svg g.node').length >= 4, 60000);
  await s2.P.locator('.react-flow__node[data-id="d1"]').click({ position: { x: 6, y: 6 } });
  const geklickt = await s2.P.locator('.react-flow__node[data-id="d1"] .mermaid-svg g.node', { hasText: 'Start' }).first().click({ timeout: 8000 }).then(() => true, () => false);
  const wahl = geklickt && await warteBis(s2.P, () => /A|Start/.test(document.querySelector('.mm-step-row .mm-sel-name')?.textContent ?? ''), 5000);
  pruefe('D6 Klick auf einen Schritt wählt ihn zum Bearbeiten wie bisher (Form, Farbe …)', wahl);
  pruefe('D7 auch dort hängt mermaid nur den Rahmen ein (kein Arbeits-Element im Dokument)', await s2.P.evaluate(() => !document.querySelector('body > div[id^="dpn-mermaid"]') && !!document.querySelector('iframe[data-mermaid-werkstatt]')));
  pruefe('D8 keine Seitenfehler', s2.fehler.length === 0, s2.fehler.join(' | '));
  await s2.ctx.close();
}

// ══ E: Ablegen genau am Zeiger ══════════════════════════════════════
console.log('\n════ E: Loslassen ohne letzte Bewegung – die Karte liegt am Zeiger ════');
if (laufe('E')) {
  const { ctx, P, fehler } = await seite([note('n1', 'Ziehen', 200, 200), note('n2', 'Weit weg', 900, 560)]);
  await P.waitForTimeout(400);
  const versuche = [];
  for (let r = 0; r < 3; r++) {
    const b = await kasten(P, 'n1');
    const gx = b.x + 8, gy = b.y + 5;
    await P.mouse.move(gx, gy); await P.mouse.down();
    await P.mouse.move(gx + 2, gy + 2); await P.mouse.move(gx + 4, gy + 3); await P.waitForTimeout(80);
    for (let i = 1; i <= 6; i++) { await P.mouse.move(gx + i * 10, gy + i * 6); await P.waitForTimeout(30); }
    const zx = gx + 260, zy = gy + 140;
    // Strg: frei ablegen (ohne Fanglinien, M344) – gemessen wird nur, ob die Lage vom Loslassen stammt
    await P.keyboard.down('Control');
    await Promise.all([P.mouse.move(zx, zy), P.mouse.up()]);
    await P.keyboard.up('Control');
    await P.waitForTimeout(600);
    const n = await kasten(P, 'n1');
    versuche.push(Math.round(Math.hypot(n.x + 8 - zx, n.y + 5 - zy)));
  }
  pruefe('E1 die Karte liegt dort, wo losgelassen wurde (Abstand höchstens 3 Punkte, drei Versuche; vorher 228)', versuche.every((d) => d <= 3), versuche.join(', '));
  // ein ganz normaler Zug (mit Bewegung bis zum Ziel) liegt ebenfalls am Zeiger
  const b = await kasten(P, 'n1');
  const gx = b.x + 8, gy = b.y + 5;
  await P.mouse.move(gx, gy); await P.mouse.down();
  await P.mouse.move(gx + 2, gy + 2); await P.mouse.move(gx + 4, gy + 3); await P.waitForTimeout(80);
  for (let i = 1; i <= 10; i++) { await P.mouse.move(gx - i * 15, gy - i * 8); await P.waitForTimeout(25); }
  await P.waitForTimeout(150); await P.mouse.up(); await P.waitForTimeout(600);
  const n = await kasten(P, 'n1');
  pruefe('E2 ein gewöhnlicher Zug liegt unverändert am Zeiger', Math.hypot(n.x + 8 - (gx - 150), n.y + 5 - (gy - 80)) <= 4, { n, ziel: [gx - 150, gy - 80] });
  await P.keyboard.press('Control+z'); await P.waitForTimeout(400);
  const z = await kasten(P, 'n1');
  pruefe('E3 Rückgängig nimmt den Zug als einen Schritt zurück', Math.hypot(z.x - b.x, z.y - b.y) <= 4, { z, b });
  pruefe('E4 keine Seitenfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\nm535: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
