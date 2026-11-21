/**
 * M412 — Kopfleiste aus einem Guss.
 *
 * Gewünscht: „Kann man die obere Leiste harmonischer bekommen? Bei Klick auf PixiNotes fände ich es besser, man
 * kommt zur Übersicht anstatt zur Hilfe. Maximiere die Harmonie und das Design-Erlebnis: User-Experience,
 * Zugänglichkeit, Lesbarkeit, moderner Look, Responsiveness – alles sauber, clean, schick, modern."
 *
 * Gemessen vorher: Logo 36, Aktionen 38, Reiter 42 Punkte hoch, einen Punkt versetzt; am Tablet berührte die
 * Aktionsleiste die Reiter; in den Reitern ein sichtbarer Rollbalken und ein Schatten, der immer dastand.
 *
 *   A  Maße: eine Höhe, eine Oberkante, eine Luft – am Rechner, am Tablet (zweite Zeile), am Telefon; nichts
 *      berührt sich, nichts ragt aus dem Bild (auch bei 320 Punkten).
 *   B  Das Logo führt zur Übersicht (und zeigt, dass man dort ist); die Hilfe hat genau einen Knopf – in der
 *      Aktionsleiste, bei offener Spalte an deren Fuß; kein Haus-Symbol mehr neben dem Logo.
 *   C  Reiter: kein Rollbalken; ein weicher Rand, wo es weitergeht; das Mausrad rollt seitwärts; der aktive
 *      Reiter bleibt stehen; sein Schatten erscheint erst, wenn etwas dahinter vorbeizieht.
 *   D  Tastatur und Vorleser: Reiter sind Reiter (tablist/tab), Pfeile wandern, Eingabe öffnet, der Fokus ist zu sehen.
 *   E  Finger: alles in der Kopfzeile ist mindestens 40 Punkte hoch.
 */
// Läuft aus dem Repository: `node pruefungen/m412-kopfleiste.mjs`
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
const PORT = 4728;
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

const note = (id, x) => ({ id, type: 'note', position: { x, y: 120 }, width: 240, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: `Notiz ${id}` }] } });
const boards = (zahl) => Array.from({ length: zahl }, (_, i) => ({ id: `b${i + 1}`, name: ['VAVE (geteilt)', 'Vave Präsentation', 'Angebot Müller', 'Rechnungen 2026', 'Ideen'][i] ?? `Weiteres Board ${i + 1}`, edges: [], drawings: [], nodes: Array.from({ length: (i * 3) % 7 }, (_, k) => note(`b${i + 1}n${k}`, k * 280)) }));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const auf = async ({ breite = 1440, hoehe = 900, touch = false, zahl = 5, spalte = false, dunkel = false, aktiv = 'b2' } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: breite, height: hoehe }, hasTouch: touch, isMobile: touch && breite < 500, colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([bb, spalte, aktiv]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: bb, spaces: [{ id: 's1', name: 'Arbeitsplatz', projects: [{ id: 'p1', name: 'Freelance', boardIds: bb.map((b) => b.id) }] }], activeId: aktiv, view: 'board', navLinks: spalte, cardFocus: false, clickZoom: false, physicsEnabled: false } }));
  }, [boards(zahl), spalte, aktiv]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  if (dunkel) { await P.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await P.waitForTimeout(200); }
  return { ctx, P };
};
/** Lage der drei Flächen (gerundet): [links, oben, rechts, unten] */
const flaechen = (P) => P.evaluate(() => Object.fromEntries(['logo', 'top-actions', 'tabs'].map((k) => { const r = document.querySelector(`.${k}`).getBoundingClientRect(); return [k, [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]]; })));
const hoch = (f) => f[3] - f[1];
const ansicht = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.view);

// ---------- A ----------
console.log('A  Maße: eine Höhe, eine Linie, eine Luft');
{
  const { ctx, P } = await auf();
  const f = await flaechen(P);
  pruefe('A1 Rechner: Logo, Aktionen und Reiter sind gleich hoch (40) und stehen auf einer Linie', hoch(f.logo) === 40 && hoch(f['top-actions']) === 40 && hoch(f.tabs) === 40 && f.logo[1] === f['top-actions'][1] && f.logo[1] === f.tabs[1], f);
  pruefe('A2 … mit derselben Luft dazwischen (8 Punkte)', f['top-actions'][0] - f.logo[2] === 8 && f.tabs[0] - f['top-actions'][2] === 8, { a: f['top-actions'][0] - f.logo[2], b: f.tabs[0] - f['top-actions'][2] });
  const knoepfe = await P.evaluate(() => [...document.querySelectorAll('.top-actions button, .tab-add, .tabs .tab, .tabs .tab-nav')].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)));
  pruefe('A3 alles, was man darin drückt, hat EINE Höhe (32)', knoepfe.length >= 9 && knoepfe.every((h) => h === 32), knoepfe.join());
  await P.screenshot({ path: path.join(SD, 'm412-rechner.png'), clip: { x: 0, y: 0, width: 1440, height: 110 } });
  await ctx.close();
}
{
  const { ctx, P } = await auf({ dunkel: true });
  const f = await flaechen(P);
  const farben = await P.evaluate(() => ['.logo', '.top-actions', '.tabs'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor));
  pruefe('A4 dunkel: dieselben Maße, alle drei Flächen in derselben Farbe', hoch(f.logo) === 40 && hoch(f.tabs) === 40 && new Set(farben).size === 1, { f, farben });
  await P.screenshot({ path: path.join(SD, 'm412-dunkel.png'), clip: { x: 0, y: 0, width: 1440, height: 110 } });
  await ctx.close();
}
{
  const { ctx, P } = await auf({ breite: 820, hoehe: 1000, touch: true });
  const f = await flaechen(P);
  pruefe('A5 Tablet: 44 Punkte hoch; die Reiter stehen als zweite Zeile mit 8 Punkten Luft darunter (vorher berührten sie die Aktionen)', hoch(f.logo) === 44 && hoch(f['top-actions']) === 44 && hoch(f.tabs) === 44 && f.tabs[1] - f.logo[3] === 8 && f.tabs[0] === f.logo[0], f);
  await ctx.close();
}
for (const breite of [390, 320]) {
  const { ctx, P } = await auf({ breite, hoehe: 780, touch: true });
  const f = await flaechen(P);
  const rand = await P.evaluate(() => ({ seite: document.documentElement.scrollWidth, fenster: innerWidth }));
  pruefe(`A6 Telefon ${breite}: gleiche Höhe, linke Kanten bündig, Luft zwischen den Zeilen, nichts ragt hinaus`, hoch(f.logo) === 44 && hoch(f['top-actions']) === 44 && hoch(f.tabs) === 44 && f.tabs[0] === f.logo[0] && f.tabs[1] - f.logo[3] >= 6 && f['top-actions'][2] <= breite - 4 && f.tabs[2] <= breite - 4 && rand.seite <= rand.fenster + 1, { f, rand });
  if (breite === 390) await P.screenshot({ path: path.join(SD, 'm412-telefon.png'), clip: { x: 0, y: 0, width: 390, height: 120 } });
  await ctx.close();
}

// ---------- B ----------
console.log('B  Logo → Übersicht; die Hilfe hat einen Knopf');
{
  const { ctx, P } = await auf();
  pruefe('B1 neben dem Logo steht kein Haus-Symbol mehr; das Logo sagt, wohin es führt', (await P.locator('.tabs .tab-home').count()) === 0 && /Übersicht/.test((await P.locator('.logo').getAttribute('aria-label')) ?? '') && /Übersicht/.test((await P.locator('.logo').getAttribute('title')) ?? (await P.locator('.logo').getAttribute('data-tooltip')) ?? 'Übersicht'));
  await P.locator('.logo').click(); await P.waitForTimeout(1300);
  const strich = await P.evaluate(() => { const c = getComputedStyle(document.querySelector('.logo'), '::before'); return { da: c.content !== 'none', hoch: c.height }; });
  pruefe('B2 ein Klick auf „PixiNotes" öffnet die Übersicht – nicht die Hilfe', (await ansicht(P)) === 'overview' && (await P.locator('.help-modal').count()) === 0);
  pruefe('B3 in der Übersicht trägt das Logo einen feinen Strich und sagt es dem Vorleser', strich.da && strich.hoch === '2px' && (await P.locator('.logo').getAttribute('aria-current')) === 'page', strich);
  await P.locator('.tabs .tab').first().click(); await P.waitForTimeout(1300);
  pruefe('B4 ein Reiter führt zurück aufs Board; der Strich ist weg', (await ansicht(P)) === 'board' && (await P.locator('.logo').getAttribute('aria-current')) === null);
  pruefe('B5 die Hilfe hat genau einen Knopf – in der Aktionsleiste', (await P.locator('[data-taste="hilfe"]').count()) === 1 && (await P.locator('.top-actions [data-taste="hilfe"]').count()) === 1);
  await P.locator('[data-taste="hilfe"]').click(); await P.waitForTimeout(600);
  pruefe('B6 … und er öffnet sie', (await P.locator('.help-modal').count()) === 1);
  await P.keyboard.press('Escape');
  await ctx.close();
}
{
  const { ctx, P } = await auf({ spalte: true });
  const f = await flaechen(P);
  const kopf = await P.evaluate(() => { const t = document.querySelector('.topbar'); return { hoch: Math.round(t.getBoundingClientRect().height) }; });
  pruefe('B7 offene Spalte: die Kopfzeile bleibt eine Zeile (40), Logo und Aktionen füllen die Spaltenbreite', kopf.hoch === 40 && hoch(f.logo) === 40 && hoch(f['top-actions']) === 40 && Math.abs(f['top-actions'][2] - f.tabs[2]) <= 1 && f.logo[0] === f.tabs[0], { kopf, f });
  pruefe('B8 … die Hilfe sitzt dort am Fuß der Spalte (ein Knopf), „Übersicht" ist die erste Zeile der Liste', (await P.locator('[data-taste="hilfe"]').count()) === 1 && (await P.locator('.tabs.spalte .tabs-foot [data-taste="hilfe"]').count()) === 1 && (await P.locator('.tabs.spalte .tab-home').count()) === 1);
  await P.locator('[data-taste="hilfe"]').click(); await P.waitForTimeout(600);
  pruefe('B9 … und öffnet sie', (await P.locator('.help-modal').count()) === 1);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.locator('.logo').click(); await P.waitForTimeout(1200);
  pruefe('B10 auch dort führt das Logo zur Übersicht', (await ansicht(P)) === 'overview');
  await ctx.close();
}

// ---------- C ----------
console.log('C  Reiter: ruhig, ohne Rollbalken');
{
  const { ctx, P } = await auf({ breite: 1100, zahl: 16, aktiv: 'b1' });
  const reihe = () => P.evaluate(() => { const e = document.querySelector('.tabs-scroll'); const c = getComputedStyle(e); const a = e.querySelector('.tab.active'); const ar = a.getBoundingClientRect(); const er = e.getBoundingClientRect();
    return { links: e.scrollLeft, breit: e.scrollWidth, sichtbar: e.clientWidth, balken: e.offsetHeight - e.clientHeight, art: c.scrollbarWidth, maske: (c.maskImage || c.webkitMaskImage || 'none') !== 'none', klassen: e.className, aktivDrin: ar.left >= er.left - 1 && ar.right <= er.right + 1, schatten: getComputedStyle(a, '::after').content !== 'none' }; });
  const r0 = await reihe();
  pruefe('C1 sechzehn Boards: die Reihe läuft über – ohne Rollbalken', r0.breit > r0.sichtbar + 100 && r0.balken === 0 && r0.art === 'none', r0);
  pruefe('C2 ein weicher Rand rechts zeigt, dass es weitergeht; links noch nicht', r0.maske && /mehr-rechts/.test(r0.klassen) && !/gerollt/.test(r0.klassen), r0);
  pruefe('C3 der Schatten am aktiven Reiter steht nicht da, solange nichts dahinter liegt', !r0.schatten, r0);
  const b = await P.locator('.tabs-scroll').boundingBox();
  await P.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 3; i++) { await P.mouse.wheel(0, 120); await P.waitForTimeout(120); }
  await P.waitForTimeout(300);
  const r1 = await reihe();
  pruefe('C4 das Mausrad rollt die Reiter seitwärts; das Board bewegt sich nicht', r1.links >= 200 && (await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform)) === (await P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform)), r1.links);
  pruefe('C5 der aktive Reiter bleibt stehen – jetzt mit Schatten, weil andere dahinter vorbeiziehen', r1.aktivDrin && r1.schatten && /gerollt/.test(r1.klassen), r1);
  await P.evaluate(() => { const e = document.querySelector('.tabs-scroll'); e.scrollLeft = e.scrollWidth; }); await P.waitForTimeout(300);
  const r2 = await reihe();
  pruefe('C6 am Ende der Reihe verschwindet der weiche Rand', !r2.maske && !/mehr-rechts/.test(r2.klassen), r2);
  const zaehler = await P.evaluate(() => { const z = document.querySelector('.tab:not(.active) .tab-count'); const c = getComputedStyle(z); return { bg: c.backgroundColor, text: z.textContent }; });
  const krume = await P.evaluate(() => getComputedStyle(document.querySelector('.tab-nav')).backgroundColor);
  pruefe('C7 Kartenzahl und Brotkrume ohne graue Kästen', /rgba\(0, 0, 0, 0\)|transparent/.test(zaehler.bg) && /rgba\(0, 0, 0, 0\)|transparent/.test(krume), { zaehler, krume });
  await P.screenshot({ path: path.join(SD, 'm412-reiter.png'), clip: { x: 0, y: 0, width: 1100, height: 110 } });
  await ctx.close();
}

// ---------- D ----------
console.log('D  Tastatur und Vorleser');
{
  const { ctx, P } = await auf();
  const rollen = await P.evaluate(() => ({ liste: document.querySelector('.tabs-scroll').getAttribute('role'), name: document.querySelector('.tabs-scroll').getAttribute('aria-label'), reiter: [...document.querySelectorAll('.tabs-scroll .tab')].map((t) => `${t.getAttribute('role')}:${t.getAttribute('aria-selected')}:${t.tabIndex}`), leiste: document.querySelector('.top-actions').getAttribute('role') }));
  pruefe('D1 Reiter sind als Reiter ausgezeichnet; genau der aktive ist gewählt und im Tab-Weg', rollen.liste === 'tablist' && !!rollen.name && rollen.reiter.join() === 'tab:false:-1,tab:true:0,tab:false:-1,tab:false:-1,tab:false:-1' && rollen.leiste === 'toolbar', rollen);
  await P.locator('.tabs-scroll .tab.active').focus();
  const ring = await P.evaluate(() => { const c = getComputedStyle(document.activeElement); return `${c.outlineStyle} ${c.outlineWidth}`; });
  pruefe('D2 der Fokus ist zu sehen (Ring in der Akzentfarbe)', ring === 'solid 2px', ring);
  await P.keyboard.press('ArrowRight'); await P.waitForTimeout(150);
  const naechster = await P.evaluate(() => document.activeElement?.textContent ?? '');
  pruefe('D3 Pfeil rechts wandert zum Nachbarn – ohne schon zu wechseln', /Angebot Müller/.test(naechster) && (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId)) === 'b2', naechster);
  await P.keyboard.press('Enter'); await P.waitForTimeout(1300);
  pruefe('D4 Eingabe öffnet das Board', (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId)) === 'b3');
  await P.locator('.logo').focus();
  const logoRing = await P.evaluate(() => { const c = getComputedStyle(document.activeElement); return `${c.outlineStyle} ${c.outlineWidth}`; });
  await P.keyboard.press('Enter'); await P.waitForTimeout(1200);
  pruefe('D5 auch das Logo: Fokus sichtbar, Eingabe führt zur Übersicht', logoRing === 'solid 2px' && (await ansicht(P)) === 'overview', logoRing);
  await ctx.close();
}

// ---------- E ----------
console.log('E  Finger');
{
  const { ctx, P } = await auf({ breite: 390, hoehe: 780, touch: true });
  const ziele = await P.evaluate(() => [...document.querySelectorAll('.logo, .top-actions button, .tab-add, .tabs .tab-nav')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.className.split(' ')[0], Math.round(r.width), Math.round(r.height)]; }));
  pruefe('E1 Telefon: alles in der Kopfzeile ist mindestens 40 Punkte hoch und 36 breit', ziele.length >= 7 && ziele.every(([, w, h]) => h >= 40 && w >= 36), ziele);
  await P.touchscreen.tap(40, 30); await P.waitForTimeout(1300);
  pruefe('E2 ein Tipp auf das Logo öffnet die Übersicht', (await ansicht(P)) === 'overview');
  await ctx.close();
}
pruefe('E3 keine Fehler in der Seite', fehler.length === 0, fehler.slice(0, 3));

await browser.close(); app.close();
console.log(`\nM412: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
