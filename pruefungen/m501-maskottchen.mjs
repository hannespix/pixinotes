/**
 * M501 — Pixi, das Maskottchen, als Karte (Figur aus pix-el).
 *
 *   A  Aus der Palette anlegen (Suchwort „maskottchen"): rahmenlose Karte, Figur im Pixelraster (Vielfaches von 48 px).
 *   B  Die Augen folgen dem Zeiger über das ganze Board: links, rechts, oben, unten (Lage der Augen gemessen).
 *   C  Touch: Pixi schaut zum letzten Berührpunkt.
 *   D  Klick auf Pixi löst eine Reaktion aus.
 *   E  Gesten: kitzeln → kichern, schnelle Kreise → schwindelig, plötzlich nah → erschrecken.
 *   F  Beschleunigte Uhr (10 Minuten): mindestens 12 verschiedene Animationen, keine zweimal hintereinander; nebenbei ein
 *      Kontaktbogen aller erreichten Zustände.
 *   G  Schlafen: nach langer Ruhe gähnen → einschlafen → schlafen (Zzz); ferne Bewegung weckt nicht, Nähe weckt.
 *   H  „Bewegung reduzieren": nur Blinzeln, keine Sprünge; die Augen folgen trotzdem.
 *   I  Leistung: kein requestAnimationFrame ohne Bewegung, außerhalb des Sichtfelds oder bei verdecktem Tab.
 *   J  Ziehen einer Karte bleibt flüssig, nichts wird in Pixi ein- oder ausgehängt.
 *   K  Optionen (Name, Farbe, Schlafen erlauben) überstehen das Neuladen.
 *   L  Hell und dunkel: Bildschirmfotos; fremde Farbe (url(…)) wird nicht übernommen.
 */
// Läuft aus dem Repository: `node pruefungen/m501-maskottchen.mjs`  (PN_BILDER=<ordner> kopiert die Bilder zusätzlich dorthin)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5501;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const bild = (name) => {
  const p = path.join(SD, name);
  if (process.env.PN_BILDER) { try { mkdirSync(process.env.PN_BILDER, { recursive: true }); } catch { /* egal */ } }
  return { p, kopie: () => { if (process.env.PN_BILDER) copyFileSync(p, path.join(process.env.PN_BILDER, name)); } };
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

const ZUSTAND = (nodes, extra = {}) => ({ version: 5, state: { boards: [{ id: 'b1', name: 'Büro', edges: [], drawings: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, ...extra } });
const PIXI = (id, x, y, data = {}, w = 192) => ({ id, type: 'pixi', position: { x, y }, width: w, height: w, autoFit: false, data });

/** Neue Seite mit vorgegebenem Board. `uhr`: beschleunigte Uhr (Playwright clock) */
async function seite(nodes, { uhr = false, dunkel = false, reduziert = false, touch = false, raf = false } = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, reducedMotion: reduziert ? 'reduce' : 'no-preference', colorScheme: dunkel ? 'dark' : 'light', hasTouch: touch });
  await ctx.addInitScript(([st, dunkel, raf]) => {
    if (raf) {
      // Jeder requestAnimationFrame aus dem Pixi-Teil (Chunk „PixiCard-…") wird gezählt
      const orig = window.requestAnimationFrame.bind(window);
      window.__pixiRaf = 0;
      window.requestAnimationFrame = (cb) => { if (/PixiCard/.test(new Error().stack ?? '')) window.__pixiRaf += 1; return orig(cb); };
    }
    try { if (window !== window.top || localStorage.getItem('pixinotes-board')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false, ...(dunkel ? { theme: 'dark' } : {}) }));
    localStorage.setItem('pixinotes-board', JSON.stringify(st));
  }, [ZUSTAND(nodes), dunkel, raf]);
  if (uhr) await ctx.clock.install();
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  if (nodes.some((n) => n.type === 'pixi')) await P.waitForSelector('.react-flow__node-pixi .pixi', { timeout: 30000 });
  else await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(800);
  return { ctx, P };
}
const warteBis = async (P, fn, ms = 8000, takt = 120) => {
  const ende = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) return null; await P.waitForTimeout(takt); }
};
/** Lage der Figur und ihrer Augen (Bildschirm), dazu der Augen-Versatz im 32er-Raster relativ zum Körper */
const lage = (P, id) => P.evaluate((id) => {
  const p = document.querySelector(id ? `.react-flow__node[data-id="${id}"] .pixi` : '.react-flow__node-pixi .pixi');
  const s = p.querySelector('svg').getBoundingClientRect();
  const e = s.width / 48;
  const f = p.querySelector('.pixi-fill').getBoundingClientRect();   // Körper (Raster x 4…28, y 6…24)
  const a = p.querySelector('.pixi-anker').getBoundingClientRect();  // Augen (Raster x 8…24, y 10…14)
  return {
    cx: s.left + 24 * e, cy: s.top + 28 * e, augeX: s.left + 24 * e, augeY: s.top + 28 * e, e, breite: s.width,
    dx: Math.round((a.left + a.width / 2 - (f.left + f.width / 2)) / e),
    dy: Math.round((a.top + a.height / 2 - (f.top + 6 * e)) / e),
    anim: p.dataset.anim, schlaf: p.dataset.schlaf, ruht: p.hasAttribute('data-ruht'),
  };
}, id);
/** Alle Wechsel von data-anim mitschreiben (auch mehrere im selben Takt der Uhr) */
const mitschreiben = (P) => P.evaluate(() => {
  window.__anims = [];
  const ob = new MutationObserver((rs) => { for (const r of rs) window.__anims.push(r.target.getAttribute('data-anim')); });
  for (const p of document.querySelectorAll('.pixi')) ob.observe(p, { attributes: true, attributeFilter: ['data-anim'] });
  window.__animOb = ob;
});
const geschrieben = (P) => P.evaluate(() => { for (const r of window.__animOb.takeRecords()) window.__anims.push(r.target.getAttribute('data-anim')); return window.__anims.slice(); });

/* ═══════════════════════ A–E, I, K: ein Board mit einem Pixi ═══════════════════════ */
console.log('A  Anlegen aus der Palette');
{
  const { ctx, P } = await seite([{ id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 260, data: { color: 'yellow', blocks: [] } }], { raf: true });
  await P.locator('.dock .dock-add-wrap').nth(0).locator('button').first().click(); await P.waitForTimeout(400);
  await P.fill('.modul-suche input', 'maskottchen'); await P.waitForTimeout(200);
  pruefe('A1 die Palette findet „Pixi" über das Suchwort', await P.locator('.modul-kachel[data-modul="pixi"]').count() === 1);
  await P.locator('.modul-kachel[data-modul="pixi"]').click();
  const da = await warteBis(P, () => P.locator('.react-flow__node-pixi .pixi svg').count(), 15000);
  pruefe('A2 eine Pixi-Karte liegt auf dem Board', !!da);
  await P.mouse.click(40, 840); await P.waitForTimeout(500);
  const a = await P.evaluate(() => {
    const n = document.querySelector('.react-flow__node-pixi');
    const s = n.querySelector('.pixi-svg');
    return { schatten: getComputedStyle(n).boxShadow, rand: getComputedStyle(n.querySelector('.card-body')).backgroundColor, breite: Number(s.getAttribute('width')), label: s.getAttribute('aria-label'), crisp: s.getAttribute('shape-rendering') };
  });
  pruefe('A3 rahmenlos (kein Schatten, keine Fläche)', a.schatten === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(a.rand), a);
  pruefe('A4 Figur im Pixelraster: Kantenlänge ein Vielfaches von 48 px, crispEdges', a.breite % 48 === 0 && a.breite >= 96 && a.crisp === 'crispEdges', a);
  pruefe('A5 Bildbeschreibung für Screenreader', a.label === 'Pixi, das Maskottchen', a.label);
  const id = await P.evaluate(() => document.querySelector('.react-flow__node-pixi').dataset.id);

  console.log('B  Die Augen folgen dem Zeiger');
  const l0 = await lage(P, id);
  const richtungen = [
    ['links', l0.augeX - 420, l0.augeY, (b) => b.dx === -2 && b.dy === 0],
    ['rechts', l0.augeX + 420, l0.augeY, (b) => b.dx === 2 && b.dy === 0],
    ['oben', l0.augeX, Math.max(20, l0.augeY - 330), (b) => b.dy === -2 && b.dx === 0],
    ['unten', l0.augeX, Math.min(845, l0.augeY + 330), (b) => b.dy === 2 && b.dx === 0],
  ];
  for (const [name, x, y, passt] of richtungen) {
    await P.mouse.move(x, y, { steps: 6 });
    let k = 0;
    const b = await warteBis(P, async () => { k += 1; await P.mouse.move(x + (k % 2), y); const v = await lage(P, id); return passt(v) ? v : null; }, 9000, 150);
    pruefe(`B ${name}: Augen wandern zum Zeiger`, !!b, b ?? await lage(P, id));
  }
  // nah dran: geradeaus
  await P.mouse.move(l0.augeX + 2, l0.augeY + 2, { steps: 8 });
  let kn = 0;
  // die Lage jedes Mal frisch messen: nach dem Anlegen fliegt die Ansicht noch zur neuen Karte
  const nah = await warteBis(P, async () => { kn += 1; const j = await lage(P, id); await P.mouse.move(j.augeX + 2 + (kn % 2), j.augeY + 2); const v = await lage(P, id); return v.dx === 0 && v.dy === 0 ? v : null; }, 9000, 150);
  pruefe('B5 ganz nah schaut Pixi geradeaus', !!nah, await lage(P, id));

  console.log('D  Klick löst eine Reaktion aus');
  Object.assign(l0, await lage(P, id));
  await P.mouse.move(l0.cx, l0.cy + l0.e * 4, { steps: 4 }); await P.waitForTimeout(1400);
  await mitschreiben(P);
  await P.mouse.click(l0.cx, l0.cy + l0.e * 4);
  const reaktion = await warteBis(P, async () => (await geschrieben(P)).find((a) => ['herzchen', 'freudensprung', 'winken', 'kichern', 'aufwachen'].includes(a)), 3000, 60);
  pruefe('D1 Klick → Herzchen, Freudensprung, Winken oder Kichern', !!reaktion, await geschrieben(P));
  await P.mouse.click(l0.cx, l0.cy + l0.e * 4); await P.waitForTimeout(400);
  const zwei = (await geschrieben(P)).filter((a) => ['herzchen', 'freudensprung', 'winken', 'kichern'].includes(a));
  pruefe('D2 zweiter Klick → eine andere Reaktion', zwei.length >= 2 && zwei[zwei.length - 1] !== zwei[zwei.length - 2], zwei);

  console.log('E  Gesten');
  await P.waitForTimeout(2200);
  await P.evaluate(() => { window.__anims.length = 0; });
  for (let i = 0; i < 14; i++) await P.mouse.move(l0.cx + (i % 2 ? 34 : -34), l0.cy + l0.e * 4, { steps: 3 });
  const kichert = await warteBis(P, async () => (await geschrieben(P)).includes('kichern'), 2500, 60);
  pruefe('E1 kitzeln (schnell hin und her über Pixi) → kichern', !!kichert, await geschrieben(P));
  await P.waitForTimeout(1800);
  await P.evaluate(() => { window.__anims.length = 0; });
  const rad = l0.breite * 1.05;
  for (let i = 0; i <= 3 * 36; i++) {
    const w = (i / 36) * Math.PI * 2;
    await P.mouse.move(l0.augeX + Math.cos(w) * rad, Math.max(5, Math.min(855, l0.augeY + Math.sin(w) * rad)));
  }
  const schwindel = await warteBis(P, async () => (await geschrieben(P)).includes('schwindelig'), 2500, 60);
  pruefe('E2 schnelle Kreise um Pixi → schwindelig (Spiralaugen)', !!schwindel && await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node-pixi .pixi-a-spirale')).display) !== 'none', await geschrieben(P));
  await P.mouse.move(30, 840, { steps: 6 }); await P.waitForTimeout(3300);
  await P.evaluate(() => { window.__anims.length = 0; });
  await P.mouse.move(40, 830); await P.mouse.move(l0.augeX, l0.augeY + l0.e * 2, { steps: 2 });
  const schreck = await warteBis(P, async () => (await geschrieben(P)).includes('erschrecken'), 2500, 60);
  pruefe('E3 plötzlich ganz nah → erschrecken', !!schreck, await geschrieben(P));

  console.log('I  Leistung: requestAnimationFrame nur bei Bewegung und nur sichtbar');
  await P.waitForTimeout(1200);
  const r0 = await P.evaluate(() => window.__pixiRaf);
  for (let i = 0; i < 12; i++) { await P.mouse.move(200 + i * 30, 700); await P.waitForTimeout(20); }
  const r1 = await P.evaluate(() => window.__pixiRaf);
  pruefe('I1 Bewegung → Pixi rechnet je Bild (rAF)', r1 > r0, { r0, r1 });
  await P.waitForTimeout(1500);
  const r2 = await P.evaluate(() => window.__pixiRaf);
  await P.waitForTimeout(1500);
  pruefe('I2 ohne Bewegung: kein einziger rAF (keine Dauerschleife)', (await P.evaluate(() => window.__pixiRaf)) === r2, { r2 });
  // aus dem Bild schieben
  await P.mouse.move(640, 760);
  for (let i = 0; i < 6; i++) { await P.mouse.wheel(0, 900); await P.waitForTimeout(60); }
  const weg = await warteBis(P, () => P.evaluate(() => { const p = document.querySelector('.react-flow__node-pixi .pixi'); return !p || p.hasAttribute('data-ruht'); }), 6000);
  pruefe('I3 außerhalb des Sichtfelds ruht Pixi (data-ruht, CSS steht)', !!weg);
  const r3 = await P.evaluate(() => window.__pixiRaf);
  for (let i = 0; i < 12; i++) { await P.mouse.move(200 + i * 30, 600 - i * 10); await P.waitForTimeout(20); }
  await P.waitForTimeout(300);
  pruefe('I4 außerhalb: Bewegung löst keinen rAF aus', (await P.evaluate(() => window.__pixiRaf)) === r3, { r3, jetzt: await P.evaluate(() => window.__pixiRaf) });
  for (let i = 0; i < 6; i++) { await P.mouse.wheel(0, -900); await P.waitForTimeout(60); }
  const zurueck = await warteBis(P, () => P.evaluate(() => { const p = document.querySelector('.react-flow__node-pixi .pixi'); return p && !p.hasAttribute('data-ruht'); }), 6000);
  pruefe('I5 wieder im Bild: Pixi lebt weiter', !!zurueck);
  await P.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await P.waitForTimeout(200);
  const r4 = await P.evaluate(() => window.__pixiRaf);
  for (let i = 0; i < 12; i++) { await P.mouse.move(300 + i * 25, 650); await P.waitForTimeout(20); }
  await P.waitForTimeout(300);
  pruefe('I6 verdeckter Tab: Pixi ruht, kein rAF', (await P.evaluate(() => window.__pixiRaf)) === r4 && await P.evaluate(() => document.querySelector('.react-flow__node-pixi .pixi').hasAttribute('data-ruht')));
  await P.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await P.waitForTimeout(200);

  console.log('K  Optionen überstehen das Neuladen');
  const lk = await lage(P, id);
  await P.mouse.click(lk.cx, lk.cy + lk.e * 4); await P.waitForTimeout(500);
  await P.locator('.react-flow__node-pixi .pixi-titel').dblclick();
  await P.keyboard.insertText('Pixel'); await P.keyboard.press('Enter'); await P.waitForTimeout(200);
  await P.locator('.react-flow__node-pixi .pixi-farbe[aria-label="Rosa"]').click();
  await P.locator('.react-flow__node-pixi .pixi-schlaf').click();
  const gespeichert = await warteBis(P, () => P.evaluate((id) => {
    const n = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((k) => k.id === id);
    return n.data.name === 'Pixel' && n.data.farbe === '#f7cfd9' && n.data.schlafen === false ? n.data : null;
  }, id), 8000);
  pruefe('K1 Name, Farbe und „bleibt wach" stehen im Board', !!gespeichert, gespeichert);
  await P.waitForTimeout(800);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node-pixi .pixi svg', { timeout: 20000 });
  await P.waitForTimeout(600);
  const nach = await P.evaluate(() => {
    const n = document.querySelector('.react-flow__node-pixi');
    return { koerper: getComputedStyle(n.querySelector('.pixi-fill')).fill, label: n.querySelector('.pixi-svg').getAttribute('aria-label'), name: n.querySelector('.pixi-titel')?.textContent, schlaf: n.querySelector('.pixi-schlaf')?.getAttribute('aria-pressed') };
  });
  pruefe('K2 nach dem Neuladen: rosa Körper, Name, Schlafen aus', nach.koerper === 'rgb(247, 207, 217)' && nach.label === 'Pixi „Pixel“, das Maskottchen' && nach.name === 'Pixel' && nach.schlaf === 'false', nach);
  pruefe('K3 im Board steht nur die Einstellung, kein Zustand (Blick, Animation)', await P.evaluate((id) => {
    const n = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((k) => k.id === id);
    return Object.keys(n.data).sort().join(',') === 'farbe,name,schlafen';
  }, id));
  const tools = await P.evaluate(() => {
    document.querySelector('.react-flow__pane')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return null;
  });
  void tools;
  await P.mouse.click(40, 840); await P.mouse.move(60, 845); await P.waitForTimeout(600);
  pruefe('K4 in Ruhe sind die Einstellungen ausgeblendet (M421)', await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node-pixi .pixi-tools')).opacity) === '0');
  await ctx.close();
}

/* ═══════════════════════ C: Touch ═══════════════════════ */
console.log('C  Touch: Pixi schaut zum Berührpunkt');
{
  const { ctx, P } = await seite([PIXI('t1', 300, 200)], { touch: true });
  const l = await lage(P);
  for (const [name, x, y, passt] of [['links', 80, l.augeY, (b) => b.dx === -2], ['rechts', 1220, l.augeY, (b) => b.dx === 2]]) {
    let ergebnis = null;
    for (let i = 0; i < 6 && !ergebnis; i++) {
      await P.touchscreen.tap(x, y + i);
      ergebnis = await warteBis(P, async () => { const v = await lage(P); return passt(v) ? v : null; }, 1500, 100);
    }
    pruefe(`C ${name}: Pixi schaut zum letzten Tipp`, !!ergebnis, await lage(P));
  }
  await ctx.close();
}

/* ═══════════════════════ F + G: beschleunigte Uhr ═══════════════════════ */
console.log('F  Beschleunigte Uhr: abwechslungsreich, nie zweimal dasselbe');
const BOGEN = [];
{
  const { ctx, P } = await seite([PIXI('u1', 300, 200, { schlafen: false }, 240)], { uhr: true });
  await P.mouse.move(1240, 840);
  await mitschreiben(P);
  /** Kontaktbogen: jeden neuen Zustand einmal fotografieren (die Uhr steht dabei; die CSS-Bewegung läuft echt weiter) */
  const gesehen = new Set();
  const foto = async () => {
    const a = await P.evaluate(() => document.querySelector('.pixi').dataset.anim);
    if (!a || gesehen.has(a)) return;
    gesehen.add(a);
    const d = await P.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pixi')).getPropertyValue('--pixi-d')) || 1000);
    await P.waitForTimeout(Math.min(1100, Math.max(140, d * 0.45)));
    const png = await P.locator('.react-flow__node-pixi .pixi').screenshot();
    BOGEN.push({ name: a, png: png.toString('base64') });
  };
  for (let t = 0; t < 600_000; t += 400) { await ctx.clock.runFor(400); if (gesehen.size < 13) await foto(); }
  const folge = (await geschrieben(P)).filter(Boolean);
  const verschieden = new Set(folge);
  const doppelt = folge.filter((a, i) => i > 0 && a === folge[i - 1]);
  console.log(`  (${folge.length} Animationen in 10 Minuten: ${[...verschieden].join(', ')})`);
  pruefe('F1 mindestens 12 verschiedene Animationen', verschieden.size >= 12, [...verschieden]);
  pruefe('F2 keine Animation zweimal hintereinander', doppelt.length === 0, doppelt);
  pruefe('F3 ohne „Schlafen erlauben" schläft Pixi nie ein', !folge.includes('schlafen') && !folge.includes('einschlafen'));
  pruefe('F4 Pausen dazwischen (nicht pausenlos)', folge.length >= 50 && folge.length <= 200, folge.length);

  console.log('G  Schlafen und Aufwachen');
  const l = await lage(P);
  await P.mouse.click(l.cx, l.cy + l.e * 4); await ctx.clock.runFor(50); await P.waitForTimeout(300);
  await P.locator('.pixi-schlaf').click(); await ctx.clock.runFor(50); await P.waitForTimeout(300);
  pruefe('G0 „Schlafen erlauben" ist an', await P.locator('.pixi-schlaf').getAttribute('aria-pressed') === 'true');
  await P.mouse.move(1240, 840, { steps: 4 }); await ctx.clock.runFor(50);
  await P.mouse.click(1240, 840); await ctx.clock.runFor(50);   // Auswahl weg, Zeiger weit weg
  for (let t = 0; t < 75_000; t += 500) { await ctx.clock.runFor(500); await foto(); }
  const s = await lage(P);
  const folgeG = (await geschrieben(P)).filter(Boolean);
  pruefe('G1 nach langer Ruhe: gähnen → einschlafen → schlafen', s.anim === 'schlafen' && s.schlaf === 'schlaeft' && folgeG.includes('einschlafen'), { s, ende: folgeG.slice(-4) });
  pruefe('G2 im Schlaf steigen Zzz auf', await P.evaluate(() => getComputedStyle(document.querySelector('.pixi-e-z1')).display) === 'inline');
  for (let i = 0; i < 10; i++) { await P.mouse.move(1100 + i * 10, 820); await ctx.clock.runFor(40); }
  await P.waitForTimeout(200);
  pruefe('G3 Bewegung weit weg weckt nicht', (await lage(P)).anim === 'schlafen');
  await P.mouse.move(l.augeX + l.breite * 0.6, l.augeY + 20, { steps: 10 }); await ctx.clock.runFor(60);
  await P.waitForTimeout(100);
  const wach = await lage(P);
  await foto();
  pruefe('G4 Zeiger kommt nah → aufwachen', wach.anim === 'aufwachen' && wach.schlaf === 'wach', wach);
  // Reaktionen für den Kontaktbogen
  await ctx.clock.runFor(1500);
  await P.mouse.click(l.cx, l.cy + l.e * 4); await ctx.clock.runFor(30); await foto();
  await ctx.clock.runFor(2500);
  for (let i = 0; i < 14; i++) { await P.mouse.move(l.cx + (i % 2 ? 40 : -40), l.cy + l.e * 4, { steps: 3 }); await ctx.clock.runFor(16); }
  await foto();
  await ctx.clock.runFor(3000);
  for (let i = 0; i <= 3 * 36; i++) { const w = (i / 36) * Math.PI * 2; await P.mouse.move(l.augeX + Math.cos(w) * 300, Math.max(5, Math.min(855, l.augeY + Math.sin(w) * 300))); if (i % 4 === 0) await ctx.clock.runFor(16); }
  await ctx.clock.runFor(16); await foto();
  await ctx.clock.runFor(3500);
  await P.mouse.move(20, 20); await ctx.clock.runFor(16); await P.mouse.move(24, 24);
  await P.mouse.move(l.augeX, l.augeY + 10, { steps: 2 }); await ctx.clock.runFor(16); await foto();
  pruefe('F5 Kontaktbogen: mindestens 12 Zustände fotografiert', BOGEN.length >= 12, BOGEN.map((b) => b.name));
  await ctx.close();
}
{
  // Kontaktbogen als ein PNG-Raster
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const P = await ctx.newPage();
  await P.setContent(`<body style="margin:0;background:#f6f7f9;font:13px system-ui"><div style="display:grid;grid-template-columns:repeat(5,230px);gap:6px;padding:10px">${BOGEN.map((b) => `<figure style="margin:0;background:#fff;text-align:center;padding:4px"><img src="data:image/png;base64,${b.png}" style="width:220px;height:220px;image-rendering:pixelated"><figcaption>${b.name}</figcaption></figure>`).join('')}</div></body>`);
  const b = bild('m501-kontaktbogen.png');
  await P.screenshot({ path: b.p, fullPage: true }); b.kopie();
  await ctx.close();
}

/* ═══════════════════════ H: Bewegung reduzieren ═══════════════════════ */
console.log('H  Bewegung reduzieren');
{
  const { ctx, P } = await seite([PIXI('r1', 300, 200)], { uhr: true, reduziert: true });
  await P.mouse.move(1240, 840);
  await mitschreiben(P);
  await ctx.clock.runFor(300_000);
  const l = await lage(P);
  await P.mouse.click(l.cx, l.cy + l.e * 4); await ctx.clock.runFor(50);
  const folge = (await geschrieben(P)).filter(Boolean);
  pruefe('H1 nur Blinzeln (auch nach Klick), kein Schlafen', folge.length > 10 && folge.every((a) => a === 'blinzeln' || a === 'doppelblinzeln'), [...new Set(folge)]);
  pruefe('H2 der Körper steht still (keine CSS-Bewegung)', await P.evaluate(() => getComputedStyle(document.querySelector('.pixi-koerper')).animationName) === 'none');
  await P.mouse.move(20, l.augeY, { steps: 5 }); await ctx.clock.runFor(60); await P.waitForTimeout(100);
  await ctx.clock.runFor(2000); await P.mouse.move(21, l.augeY); await ctx.clock.runFor(60);
  pruefe('H3 die Augen folgen trotzdem', (await lage(P)).dx === -2, await lage(P));
  await ctx.close();
}

/* ═══════════════════════ J: Ziehen bleibt flüssig ═══════════════════════ */
console.log('J  Ziehen einer Karte mit vier Pixis daneben');
{
  const FORM = { id: 'f1', type: 'shape', position: { x: 0, y: 0 }, width: 180, height: 90, data: { shape: 'process', text: 'Schritt' } };
  const zug = async (nodes) => {
    const { ctx, P } = await seite(nodes);
    const r = await P.evaluate(() => { const b = document.querySelector('.react-flow__node[data-id="f1"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await P.evaluate(() => {
      window.__dom = 0;
      new MutationObserver((rs) => { for (const m of rs) if (m.type === 'childList' && (m.target.closest?.('.pixi'))) window.__dom += 1; })
        .observe(document.body, { childList: true, subtree: true });
    });
    await P.mouse.move(r.x, r.y); await P.mouse.down();
    await P.mouse.move(r.x + 4, r.y + 4, { steps: 2 }); await P.waitForTimeout(200);
    const takt = P.evaluate(() => new Promise((res) => { const z = []; let l = performance.now(); let k = 0; const f = (t) => { z.push(t - l); l = t; if (++k < 80) requestAnimationFrame(f); else res(z); }; requestAnimationFrame(f); }));
    for (let i = 1; i <= 45; i++) { await P.mouse.move(r.x + i * 12, r.y + Math.sin(i / 5) * 160); await P.waitForTimeout(16); }
    const z = (await takt).slice(3).sort((a, b) => a - b);
    await P.mouse.up();
    const dom = await P.evaluate(() => window.__dom);
    await ctx.close();
    return { median: z[Math.floor(z.length / 2)], p90: z[Math.floor(z.length * 0.9)], dom };
  };
  const ohne = await zug([FORM]);
  const mit = await zug([FORM, PIXI('a', -400, -300), PIXI('b', 500, -300), PIXI('c', -400, 250), PIXI('d', 500, 250)]);
  console.log(`  (Bildzeit Median ohne Pixi ${ohne.median.toFixed(1)} ms, mit vier Pixis ${mit.median.toFixed(1)} ms · 90 %: ${ohne.p90.toFixed(1)} / ${mit.p90.toFixed(1)} ms)`);
  pruefe('J1 Bildzeit beim Ziehen bleibt im Rahmen (Median höchstens +6 ms)', mit.median <= Math.max(ohne.median + 6, 22), { ohne, mit });
  pruefe('J2 kein Ein- oder Aushängen in Pixi während des Zugs (M491)', mit.dom === 0, mit.dom);
}

/* ═══════════════════════ L: Hell, dunkel, Fremdes ═══════════════════════ */
console.log('L  Hell und dunkel');
for (const dunkel of [false, true]) {
  const { ctx, P } = await seite([
    PIXI('h1', -260, 0), PIXI('h2', 0, 0, { farbe: '#cfe3f7', name: 'Blau' }), PIXI('h3', 260, 0, { farbe: '#ffe9a6' }),
    PIXI('h4', 520, 0, { farbe: 'url(https://example.org/x.png)' }),
    { id: 'n2', type: 'note', position: { x: -260, y: 260 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Pixi wohnt hier.' }] } },
  ], { dunkel });
  await P.mouse.move(640, 700); await P.waitForTimeout(900);
  const b = bild(`m501-${dunkel ? 'dunkel' : 'hell'}.png`);
  await P.screenshot({ path: b.p }); b.kopie();
  const fremd = await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="h4"] .pixi-fill')).fill);
  const standard = await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="h1"] .pixi-fill')).fill);
  pruefe(`L${dunkel ? 2 : 1} ${dunkel ? 'dunkel' : 'hell'}: fremde Farbe (url) fällt auf die Standardfarbe zurück`, fremd === standard, { fremd, standard });
  if (dunkel) {
    const arm = await P.evaluate(() => getComputedStyle(document.querySelector('.pixi-arm path')).fill);
    pruefe('L3 dunkel: Arme und Effekte hell (stehen auf dem dunklen Grund)', arm === 'rgb(212, 239, 120)', arm);
  }
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler);
await browser.close();
app.close();
console.log(`\n${ok} ✓ · ${bad} ✗`);
process.exit(bad ? 1 : 0);
