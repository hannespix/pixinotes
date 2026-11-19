/**
 * M402 — Zoom in der Präsentation, und das Pfeil-Menü über den Karten.
 *
 * Gemeldet: „Pfeil-Einstellungsmenü bei Verbindungen von Cards liegt auf der Z-Ebene unter den Cards … im
 * Präsentationsmodus soll in Inhalte auch ein- und rausgezoomt werden können."
 *
 *   A  Das Menü der ausgewählten Verbindung liegt über jeder Karte – auch über einer, die später angefasst wurde.
 *   B  Präsentation: Strg + Mausrad zoomt den Inhalt um den Zeiger; + / − / 0; die Anzeige oben setzt zurück.
 *   C  Hineingezoomt rollt die Folie, herausgezoomt steht der Inhalt mittig ohne Rollbalken; die nächste Folie
 *      beginnt wieder bei 100 %; im Text getippt wird nicht gezoomt.
 *   D  Zwei Finger kneifen zoomt; ein Strich mit dem Stift bleibt am Inhalt, gleich bei welcher Stufe.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m402-folien-zoom.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4718;
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

const notiz = (id, x, y, zeilen, mehr = {}) => ({ id, type: 'note', position: { x, y }, width: 260, height: 170, autoFit: false, ...mehr,
  data: { color: 'yellow', blocks: zeilen.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] })) } });
const auf = async (board, opt = {}, sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript(([b, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b1', name: 'Test', edges: [], drawings: [], ...b }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
  }, [board, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
};
const nah = (a, b, t = 2) => Math.abs(a - b) <= t;

// ---------- A: Pfeil-Menü über den Karten ----------
console.log('A  Das Menü der Verbindung liegt über den Karten');
{
  // „c" liegt unter der Mitte der Verbindung a→b und wurde zuletzt angefasst (hoher z-index)
  const { ctx, P } = await auf({ nodes: [notiz('a', 0, 0, ['A']), notiz('b', 700, 0, ['B']), notiz('c', 330, 60, ['C liegt unter der Mitte'], { zIndex: 60 })],
    edges: [{ id: 'e1', source: 'a', target: 'b', type: 'labeled' }] });
  // die Verbindung nahe an „a" anklicken (dort liegt keine Karte darüber)
  const pfad = await P.evaluate(() => { const p = document.querySelector('.react-flow__edge-path'); const l = p.getTotalLength(); const q = p.getPointAtLength(l * 0.12); const m = p.getScreenCTM(); return { x: q.x * m.a + m.e, y: q.y * m.d + m.f }; });
  await P.mouse.click(pfad.x, pfad.y); await P.waitForTimeout(400);
  const m = await P.evaluate(() => {
    const o = document.querySelector('.edge-opts'); if (!o) return null;
    const r = o.getBoundingClientRect(); const karte = document.querySelector('.react-flow__node[data-id="c"]').getBoundingClientRect();
    const ueberlappt = r.bottom > karte.top + 4 && r.left < karte.right && r.right > karte.left;
    const punkt = { x: r.left + r.width / 2, y: r.bottom - 5 };
    const t = document.elementFromPoint(punkt.x, punkt.y);
    const chip = document.querySelector('.edge-label.selected'); const cr = chip?.getBoundingClientRect();
    const tc = cr && document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
    return { ueberlappt, oben: !!t?.closest('.edge-opts'), treffer: t?.className?.toString().slice(0, 40), z: getComputedStyle(o).zIndex, karteZ: getComputedStyle(document.querySelector('.react-flow__node[data-id="c"]')).zIndex, chipOben: !!tc?.closest('.edge-label') };
  });
  pruefe('A1 die Verbindung ist ausgewählt, ihr Menü steht da und überlappt die Karte darunter', !!m && m.ueberlappt, m);
  pruefe('A2 das Menü liegt über der Karte: der Klick trifft das Menü, nicht die Karte', !!m && m.oben && Number(m.z) > Number(m.karteZ), m);
  pruefe('A3 … ebenso der Namens-Chip der ausgewählten Verbindung', !!m && m.chipOben, m);
  // und es lässt sich dort bedienen: eine Farbe wählen
  const punkt = await P.evaluate(() => { const d = [...document.querySelectorAll('.edge-opts .edge-color-dot')].at(-1); const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await P.mouse.click(punkt.x, punkt.y); await P.waitForTimeout(700);
  const farbe = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges[0].data?.color ?? null);
  pruefe('A4 ein Klick auf eine Farbe im Menü kommt an', typeof farbe === 'string' && farbe.length > 0, farbe);
  await ctx.close();
}

// ---------- B: Zoom mit Rad und Tasten ----------
console.log('B  Präsentation: zoomen mit Strg + Rad und Tasten');
const lang = Array.from({ length: 6 }, (_, i) => `Zeile ${i + 1} der ersten Folie`);
const V = await auf({ nodes: [notiz('n1', 0, 0, lang), notiz('n2', 400, 0, ['Zweite Folie'])] });
const P = V.P;
const lage = () => P.evaluate(() => {
  const f = document.querySelector('.presenter-slide'); const k = f?.firstElementChild; if (!f || !k) return null;
  const r = k.getBoundingClientRect(); const fr = f.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(k).transform);
  return { zoom: Math.round(m.a * 1000) / 1000, chip: document.querySelector('[data-taste="folie-zoom"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '', l: r.left, t: r.top, w: r.width, h: r.height,
    f: { l: fr.left, t: fr.top, w: fr.width, h: fr.height }, rollX: f.scrollWidth > f.clientWidth + 1, rollY: f.scrollHeight > f.clientHeight + 1, sl: f.scrollLeft, st: f.scrollTop,
    ueberX: getComputedStyle(f).overflowX, ueberY: getComputedStyle(f).overflowY, gezoomt: f.classList.contains('gezoomt') };
});
{
  await P.keyboard.press('Escape'); await P.mouse.click(1200, 760); await P.waitForTimeout(250);
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click();
  await P.waitForSelector('.presenter', { timeout: 5000 }); await P.waitForTimeout(800);
  const a = await lage();
  pruefe('B1 die Folie beginnt bei 100 % – ohne Zoom-Anzeige', a?.zoom === 1 && a.chip === '' && !a.gezoomt, a);
  // Strg + Rad über dem Inhalt
  await P.mouse.move(a.l + a.w * 0.5, a.t + a.h * 0.5);
  await P.keyboard.down('Control');
  for (let i = 0; i < 4; i++) { await P.mouse.wheel(0, -100); await P.waitForTimeout(60); }
  await P.keyboard.up('Control'); await P.waitForTimeout(300);
  const b = await lage();
  pruefe('B2 Strg + Rad vergrößert den Inhalt', !!b && b.zoom > 1.6 && b.zoom < 3.2 && nah(b.w, a.w * b.zoom, 3), b);
  // Ist der Inhalt größer als die Folie, bleibt beim Weiterzoomen die Stelle unter dem Zeiger stehen
  const zeiger = { x: b.f.l + b.f.w * 0.35, y: b.f.t + b.f.h * 0.45 };
  const rel = { x: (zeiger.x - b.l) / b.w, y: (zeiger.y - b.t) / b.h };
  await P.mouse.move(zeiger.x, zeiger.y);
  await P.keyboard.down('Control');
  for (let i = 0; i < 2; i++) { await P.mouse.wheel(0, -100); await P.waitForTimeout(60); }
  await P.keyboard.up('Control'); await P.waitForTimeout(300);
  const b2 = await lage();
  pruefe('B3 beim Weiterzoomen bleibt die Stelle unter dem Zeiger stehen', !!b2 && b2.zoom > b.zoom && nah(b2.l + b2.w * rel.x, zeiger.x, 6) && nah(b2.t + b2.h * rel.y, zeiger.y, 6), { soll: zeiger, ist: b2 && { x: b2.l + b2.w * rel.x, y: b2.t + b2.h * rel.y } });
  pruefe('B4 oben steht die Stufe', new RegExp(`^${Math.round(b2.zoom * 100)} %$`).test(b2.chip), b2?.chip);
  pruefe('B5 die Folie selbst bleibt an ihrem Platz und so groß wie zuvor', !!b2 && nah(b2.f.l, a.f.l, 1) && nah(b2.f.w, a.f.w, 1) && nah(b2.f.h, a.f.h, 1), b2?.f);
  // M403: Die Anzeige öffnet die Schnellauswahl – die gewählte Darstellung führt zurück
  await P.locator('[data-taste="folie-zoom"]').click(); await P.waitForTimeout(200);
  await P.locator('[data-taste="folie-ansicht"][aria-checked="true"]').click(); await P.waitForTimeout(350);
  const c = await lage();
  pruefe('B6 die Anzeige öffnet die Auswahl, die gewählte Darstellung stellt 100 % wieder her', c?.zoom === 1 && c.chip === '' && nah(c.l, a.l, 1) && nah(c.t, a.t, 1) && nah(c.w, a.w, 1), c);
  // Tasten (der Fokus liegt nicht im Text)
  await P.locator('.presenter-count').click(); await P.waitForTimeout(100);
  await P.keyboard.press('+'); await P.keyboard.press('+'); await P.waitForTimeout(250);
  const d = await lage();
  pruefe('B7 zweimal „+" ergibt 156 %', d?.chip === '156 %' && nah(d.zoom, 1.5625, 0.01), d);
  await P.keyboard.press('0'); await P.waitForTimeout(200);
  pruefe('B8 „0" stellt 100 % wieder her', (await lage())?.zoom === 1);
}

// ---------- C: rollen, verkleinern, nächste Folie, tippen ----------
console.log('C  Rollen, verkleinern, nächste Folie');
{
  const a = await lage();
  for (let i = 0; i < 6; i++) await P.keyboard.press('+');
  await P.waitForTimeout(300);
  const gross = await lage();
  pruefe('C1 weit hineingezoomt ist der Inhalt größer als die Folie – sie rollt', !!gross && gross.zoom > 3 && (gross.rollX || gross.rollY) && (gross.w > gross.f.w || gross.h > gross.f.h), gross);
  pruefe('C2 … und der Inhalt beginnt nicht links oder oben außerhalb (alles bleibt erreichbar)', !!gross && gross.l + gross.sl >= gross.f.l - 1 && gross.t + gross.st >= gross.f.t - 1, { l: gross?.l, sl: gross?.sl, fl: gross?.f.l });
  for (let i = 0; i < 12; i++) await P.keyboard.press('+');
  await P.waitForTimeout(200);
  pruefe('C3 mehr als 500 % gibt es nicht', (await lage())?.chip === '500 %', (await lage())?.chip);
  await P.keyboard.press('0'); await P.waitForTimeout(150);
  await P.keyboard.press('-'); await P.keyboard.press('-'); await P.waitForTimeout(300);
  const klein = await lage();
  pruefe('C4 zweimal „−" ergibt 64 %', klein?.chip === '64 %' && nah(klein.zoom, 0.64, 0.01), klein);
  pruefe('C5 verkleinert bleibt der Inhalt um seine Mitte stehen, ohne Rollbalken', !!klein && nah(klein.l + klein.w / 2, a.l + a.w / 2, 3) && nah(klein.t + klein.h / 2, a.t + a.h / 2, 3) && klein.ueberX === 'hidden' && klein.ueberY === 'hidden', klein);
  for (let i = 0; i < 12; i++) await P.keyboard.press('-');
  await P.waitForTimeout(200);
  pruefe('C6 weniger als 40 % gibt es nicht', (await lage())?.chip === '40 %', (await lage())?.chip);
  // nächste Folie beginnt bei 100 %
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(500);
  const zwei = await lage();
  pruefe('C7 die nächste Folie beginnt wieder bei 100 %', zwei?.zoom === 1 && zwei.chip === '' && !zwei.gezoomt && /2 \/ 2/.test(await P.locator('.presenter-count').textContent()), zwei);
  await P.keyboard.press('ArrowLeft'); await P.waitForTimeout(500);
  pruefe('C8 … und zurück auf der ersten ebenso', (await lage())?.zoom === 1);
  // im Text getippt wird geschrieben, nicht gezoomt
  await P.locator('.presenter-slide [contenteditable="true"]').first().click(); await P.waitForTimeout(250);
  await P.keyboard.type('+-0'); await P.waitForTimeout(350);
  const text = await P.evaluate(() => document.querySelector('.presenter-slide')?.textContent ?? '');
  pruefe('C9 im Text getippte „+ − 0" landen im Text – gezoomt wird nicht', (await lage())?.zoom === 1 && text.includes('+-0'), text.slice(0, 80));
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);
}

// ---------- D: zwei Finger, Stift ----------
console.log('D  Zwei Finger kneifen, der Stift bleibt am Inhalt');
{
  const a = await lage();
  const mitte = { x: a.l + a.w / 2, y: a.t + a.h / 2 };
  const kneifen = (ab, zu) => P.evaluate(([m, d0, d1]) => {
    const el = document.querySelector('.presenter-slide');
    const mk = (i, x, y) => new Touch({ identifier: i, target: el, clientX: x, clientY: y, touchType: 'direct' });
    const paar = (d) => [mk(1, m.x - d / 2, m.y), mk(2, m.x + d / 2, m.y)];
    const los = (typ, t, c) => el.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true, composed: true, touches: t, targetTouches: t, changedTouches: c }));
    los('touchstart', paar(d0), paar(d0));
    for (let i = 1; i <= 8; i++) { const d = d0 + ((d1 - d0) * i) / 8; los('touchmove', paar(d), paar(d)); }
    los('touchend', [], paar(d1));
  }, [mitte, ab, zu]);
  await kneifen(120, 240); await P.waitForTimeout(300);
  const b = await lage();
  pruefe('D1 zwei Finger auseinander: der Inhalt wird doppelt so groß', !!b && nah(b.zoom, 2, 0.12), b);
  pruefe('D2 … um die Mitte zwischen den Fingern', !!b && nah(b.l + b.w / 2, mitte.x, 8) && nah(b.t + b.h / 2, mitte.y, 8), { mitte, ist: b && { x: b.l + b.w / 2, y: b.t + b.h / 2 } });
  // Stift: ein Strich quer über die Mitte des gezoomten Inhalts
  await P.keyboard.press('p'); await P.waitForTimeout(300);
  const z = await lage();
  const y = Math.min(z.t + z.h * 0.5, z.f.t + z.f.h - 40);
  const x0 = Math.max(z.l + z.w * 0.4, z.f.l + 20); const x1 = Math.min(z.l + z.w * 0.6, z.f.l + z.f.w - 20);
  await P.mouse.move(x0, y); await P.mouse.down(); await P.mouse.move((x0 + x1) / 2, y, { steps: 5 }); await P.mouse.move(x1, y, { steps: 5 }); await P.mouse.up();
  await P.waitForTimeout(900);
  const strich = await P.evaluate(() => (JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []).at(-1) ?? null);
  const soll = [((x0 - z.l) / z.w) * 1000, ((x1 - z.l) / z.w) * 1000];
  const xs = (strich?.points ?? []).map((p) => p[0]);
  pruefe('D3 der Strich wird in Einheiten des Inhalts gespeichert – unabhängig von der Zoomstufe', !!strich && strich.seite === -1 && nah(Math.min(...xs), soll[0], 12) && nah(Math.max(...xs), soll[1], 12), { soll, ist: [Math.min(...xs), Math.max(...xs)] });
  const rel = async () => P.evaluate(() => { const k = document.querySelector('.presenter-slide').firstElementChild.getBoundingClientRect(); const p = [...document.querySelectorAll('.folien-stift svg path')].at(-1)?.getBoundingClientRect(); return p ? [(p.left - k.left) / k.width, (p.right - k.left) / k.width] : null; });
  const beiZwei = await rel();
  await P.keyboard.press('Escape'); await P.waitForTimeout(200);     // Stift weglegen
  await P.locator('[data-taste="folie-zoom"]').click(); await P.waitForTimeout(200);
  await P.locator('[data-taste="folie-ansicht"][aria-checked="true"]').click(); await P.waitForTimeout(500);
  const beiEins = await rel();
  pruefe('D4 zurück bei 100 % sitzt der Strich an derselben Stelle des Inhalts', !!beiZwei && !!beiEins && nah(beiZwei[0], beiEins[0], 0.02) && nah(beiZwei[1], beiEins[1], 0.02) && (await lage())?.zoom === 1, { beiZwei, beiEins });
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
}
await V.ctx.close();

// ---------- E: Texte ----------
console.log('E  Texte');
{
  const E = await auf({ nodes: [notiz('n1', 0, 0, ['One'])] }, {}, 'en');
  await E.P.keyboard.press('Escape'); await E.P.mouse.click(1200, 760); await E.P.waitForTimeout(250);
  await E.P.evaluate(() => 0);
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  const en = JSON.parse(lies('src/sprache/en.json'));
  pruefe('E1 Hinweis und Anzeige sind übersetzt', en['Folien sind direkt editierbar · Strg+Rad zoomt'] === 'Slides can be edited directly · Ctrl+wheel zooms' && en['Darstellung der Folien'] === 'Slide view');
  await E.ctx.close();
  pruefe('E2 die Hilfe nennt M402 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M402)') && lies('src/components/HelpOverlayEn.tsx').includes('(M402)'));
  pruefe('E3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm402-folien-zoom: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
