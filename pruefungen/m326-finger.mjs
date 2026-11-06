/**
 * M326 — Finger-Gesten überall (Procreate).
 *
 *   A  Auswahlmodus: Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp =
 *      Wiederholen, zwei Finger halten = schnell zurück; in Textfeldern nicht.
 *   B  Quick-Pinch: schnelles Zusammenziehen passt alles ein, noch einmal
 *      bringt die vorherige Ansicht zurück.
 *   C  Vier-Finger-Tipp = Vollbild (im Testbrowser: Versuch samt Hinweis).
 *   D  Drei Finger nach unten: Auswahl duplizieren; ohne Auswahl ＋-Palette.
 *   E  Schalter in den Einstellungen: aus → keine Gesten.
 *   F  Im Zeichenmodus funktioniert der Zwei-Finger-Tipp weiterhin; ein
 *      Stift-Zug pausiert die Gesten.
 *   G  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m326-finger.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4548;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const stand = {
  boards: [{ id: 'b1', name: 'Werkstatt', edges: [], drawings: [], comments: [], nodes: [
    { id: 'n1', type: 'note', width: 300, height: 140, position: { x: -600, y: -400 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Milch Brot Butter' }] } },
    { id: 'n2', type: 'note', width: 240, height: 120, position: { x: -150, y: -400 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Kurze Idee' }] } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
async function seite(opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(({ st, gesten }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, handschriftAuto: false, ...(gesten === false ? { fingerGesten: false } : {}) }));
    localStorage.setItem('pixinotes-stift', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, gesten: opt.gesten });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1600);
  return { ctx, P };
}
const werkzeug = async (P, name) => {
  await P.locator('.dock [aria-label="Zeichnen"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu-draw button', { hasText: name }).click(); await P.waitForTimeout(250);
};
const zug = (P, punkte, o = {}) => P.evaluate(async ({ punkte, o }) => {
  const id = o.id ?? 7;
  const mk = (typ, [x, y], extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: 1, button: 0, ...extra });
  const start = document.elementFromPoint(punkte[0][0], punkte[0][1]) ?? document.body;
  start.dispatchEvent(mk('pointerdown', punkte[0]));
  for (const pt of punkte.slice(1)) { start.dispatchEvent(mk('pointermove', pt)); await new Promise((r) => setTimeout(r, 8)); }
  if (!o.offen) start.dispatchEvent(mk('pointerup', punkte[punkte.length - 1], { buttons: 0 }));
}, { punkte, o });
/** Finger-Geste: n Finger an `start`, optional zu `ziel` bewegen, nach `dauer` ms loslassen */
const geste = (P, start, o = {}) => P.evaluate(async ({ start, o }) => {
  const el = document.elementFromPoint(start[0][0], start[0][1]) ?? document.body;
  const touch = (i, [x, y]) => new Touch({ identifier: 200 + i, target: el, clientX: x, clientY: y, touchType: 'direct' });
  let ts = start.map((p, i) => touch(i, p));
  const ev = (typ, touches, changed) => new TouchEvent(typ, { bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: changed });
  el.dispatchEvent(ev('touchstart', ts, ts));
  if (o.ziel) {
    const schritte = o.schritte ?? 4;
    for (let s = 1; s <= schritte; s += 1) {
      ts = start.map((p, i) => touch(i, [p[0] + (o.ziel[i][0] - p[0]) * s / schritte, p[1] + (o.ziel[i][1] - p[1]) * s / schritte]));
      el.dispatchEvent(ev('touchmove', ts, ts));
      await new Promise((r) => setTimeout(r, o.takt ?? 20));
    }
  }
  await new Promise((r) => setTimeout(r, o.dauer ?? 80));
  el.dispatchEvent(ev('touchend', [], ts));
  return el.className?.baseVal ?? el.className;
}, { start, o });
const striche = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].drawings ?? []);
const knoten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const ausschnitt = (P) => P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
const warte = (P, ms = 700) => P.waitForTimeout(ms);
const frei = (P) => P.evaluate(() => { for (let y = 860; y > 120; y -= 40) for (let x = 120; x < 1400; x += 40) { if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return [x, y]; } return [700, 700]; });
const welle = (x0, y0) => Array.from({ length: 18 }, (_, i) => [x0 + i * 4, y0 + Math.sin(i / 1.7) * 10]);
/** Drei Striche als Verlauf anlegen, dann zurück in die Auswahl */
const drei = async (P) => {
  await werkzeug(P, 'Stift');
  const [fx, fy] = await frei(P);
  for (let k = 0; k < 3; k += 1) { await zug(P, welle(fx - 100 + k * 90, fy - 120), { id: 11 + k }); await warte(P, 250); }
  await P.keyboard.press('Escape'); await warte(P, 500);
};

// ══ A: Tipps im Auswahlmodus ════════════════════════════════════════
console.log('\n════ A: Zwei-/Drei-Finger-Tipp und Halten ════');
{
  const { ctx, P } = await seite();
  await drei(P);
  pruefe('A0 drei Striche, Auswahlmodus', (await striche(P)).length === 3 && (await P.locator('.draw-palette').count()) === 0);
  const [fx, fy] = await frei(P);
  await geste(P, [[fx, fy], [fx + 50, fy]]); await warte(P);
  pruefe('A1 Zwei-Finger-Tipp = Rückgängig (auch ohne Zeichenmodus)', (await striche(P)).length === 2 && /Rückgängig/.test(await toast(P)), JSON.stringify({ n: (await striche(P)).length, t: await toast(P) }));
  await geste(P, [[fx, fy], [fx + 50, fy], [fx + 100, fy]]); await warte(P);
  pruefe('A2 Drei-Finger-Tipp = Wiederholen', (await striche(P)).length === 3 && /Wiederholen/.test(await toast(P)), String((await striche(P)).length));
  await geste(P, [[fx, fy], [fx + 50, fy]], { dauer: 1100 }); await warte(P, 900);
  pruefe('A3 zwei Finger halten = schnell zurück (mehrere Schritte)', (await striche(P)).length <= 1 && /schnell zurück/.test(await toast(P)), JSON.stringify({ n: (await striche(P)).length, t: await toast(P) }));
  // Wiederholen bis alle drei wieder da sind
  await geste(P, [[fx, fy], [fx + 50, fy], [fx + 100, fy]], { dauer: 1100 }); await warte(P, 900);
  pruefe('A4 drei Finger halten = schnell vor', (await striche(P)).length === 3, String((await striche(P)).length));
  // In einem Textfeld gilt die Geste nicht
  const p = await P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="n1"] .bn-editor p').getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; });
  await geste(P, [[p[0], p[1]], [p[0] + 40, p[1]]]); await warte(P);
  pruefe('A5 im Textfeld einer Notiz löst der Zwei-Finger-Tipp nichts aus', (await striche(P)).length === 3);
  await ctx.close();
}

// ══ B: Quick-Pinch ══════════════════════════════════════════════════
console.log('\n════ B: Quick-Pinch = Alles einpassen ════');
{
  const { ctx, P } = await seite();
  const v0 = await ausschnitt(P);
  // Ansicht erst verschieben, damit „einpassen" etwas verändert
  await P.mouse.move(700, 700); await P.mouse.down(); await P.mouse.move(900, 800); await P.mouse.move(1000, 850); await P.mouse.up(); await warte(P, 400);
  const v1 = await ausschnitt(P);
  pruefe('B0 Ansicht verschoben', v1 !== v0);
  const [fx, fy] = await frei(P);
  await geste(P, [[fx - 100, fy], [fx + 100, fy]], { ziel: [[fx - 15, fy], [fx + 15, fy]], schritte: 3, takt: 15, dauer: 30 }); await warte(P, 900);
  const v2 = await ausschnitt(P);
  pruefe('B1 schnelles Zusammenziehen passt alles ein', /eingepasst/.test(await toast(P)) && v2 !== v1, JSON.stringify({ t: await toast(P), v1, v2 }));
  const [gx, gy] = await frei(P);
  await geste(P, [[gx - 100, gy], [gx + 100, gy]], { ziel: [[gx - 15, gy], [gx + 15, gy]], schritte: 3, takt: 15, dauer: 30 }); await warte(P, 900);
  pruefe('B2 noch einmal: zurück zur vorherigen Ansicht', /vorherigen Ansicht/.test(await toast(P)) && (await ausschnitt(P)) === v1, JSON.stringify({ t: await toast(P), v: await ausschnitt(P), v1 }));
  await ctx.close();
}

// ══ C: Vier-Finger-Tipp ═════════════════════════════════════════════
console.log('\n════ C: Vier-Finger-Tipp = Vollbild ════');
{
  const { ctx, P } = await seite();
  const [fx, fy] = await frei(P);
  await geste(P, [[fx, fy], [fx + 40, fy], [fx + 80, fy], [fx + 120, fy]]); await warte(P, 900);
  pruefe('C1 Vier-Finger-Tipp versucht Vollbild (Hinweis nennt Vollbild)', /Vollbild/.test(await toast(P)), await toast(P));
  await ctx.close();
}

// ══ D: Drei Finger nach unten ═══════════════════════════════════════
console.log('\n════ D: Drei Finger nach unten ════');
{
  const { ctx, P } = await seite();
  const r = await P.evaluate(() => { const b = document.querySelector('.react-flow__node[data-id="n2"] .card-body').getBoundingClientRect(); return [b.left + 6, b.bottom - 6]; });
  // Mit dem Stift wählen (ein Finger-/Maus-Tipp öffnet in dieser Touch-Umgebung das Blatt, M212)
  const cdp = await ctx.newCDPSession(P);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  await warte(P, 60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0], y: r[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await warte(P, 500);
  pruefe('D0 n2 ist ausgewählt (kein Blatt offen)', (await P.locator('.react-flow__node.selected[data-id="n2"]').count()) === 1 && (await P.locator('.focus-mode').count()) === 0);
  const [fx, fy] = await frei(P);
  const y0 = Math.max(200, fy - 200);
  await geste(P, [[fx, y0], [fx + 50, y0], [fx + 100, y0]], { ziel: [[fx, y0 + 140], [fx + 50, y0 + 140], [fx + 100, y0 + 140]], schritte: 5, takt: 30, dauer: 40 }); await warte(P, 800);
  pruefe('D1 mit Auswahl: drei Finger nach unten duplizieren die Karte', (await knoten(P)).length === 3 && /dupliziert/.test(await toast(P)), JSON.stringify({ n: (await knoten(P)).length, t: await toast(P) }));
  await P.keyboard.press('Escape'); await P.mouse.click(fx, fy); await warte(P, 400);
  pruefe('D1b nach dem Klick auf die Fläche ist nichts mehr gewählt', (await P.locator('.react-flow__node.selected').count()) === 0);
  await geste(P, [[fx, y0], [fx + 50, y0], [fx + 100, y0]], { ziel: [[fx, y0 + 140], [fx + 50, y0 + 140], [fx + 100, y0 + 140]], schritte: 5, takt: 30, dauer: 40 }); await warte(P, 600);
  pruefe('D2 ohne Auswahl öffnet die Geste die ＋-Palette', (await P.locator('.modul-palette').count()) === 1 && (await knoten(P)).length === 3);
  await P.screenshot({ path: path.join(SD, 'm326-palette.png') });
  await ctx.close();
}

// ══ E: Schalter ═════════════════════════════════════════════════════
console.log('\n════ E: Schalter ════');
{
  const { ctx, P } = await seite({ gesten: false });
  await drei(P);
  const [fx, fy] = await frei(P);
  await geste(P, [[fx, fy], [fx + 50, fy]]); await warte(P);
  pruefe('E1 ausgeschaltet: der Zwei-Finger-Tipp macht nichts', (await striche(P)).length === 3);
  await P.locator('[data-taste="einstellungen"]').click(); await warte(P, 300);
  const schalter = P.locator('[data-taste="finger-gesten"]');
  pruefe('E2 Darstellung zeigt „Finger-Gesten (wie Procreate)", hier aus', (await schalter.count()) === 1 && !(await schalter.isChecked()));
  await schalter.check(); await warte(P, 200);
  await P.keyboard.press('Escape'); await warte(P, 400);
  await geste(P, [[fx, fy], [fx + 50, fy]]); await warte(P);
  pruefe('E3 eingeschaltet wirkt die Geste sofort', (await striche(P)).length === 2);
  await ctx.close();
}

// ══ F: Zeichenmodus ═════════════════════════════════════════════════
console.log('\n════ F: Zeichenmodus ════');
{
  const { ctx, P } = await seite();
  await werkzeug(P, 'Stift');
  const [fx, fy] = await frei(P);
  await zug(P, welle(fx, fy - 150), { id: 31 }); await warte(P);
  await geste(P, [[fx, fy], [fx + 50, fy]]); await warte(P);
  pruefe('F1 im Zeichenmodus: Zwei-Finger-Tipp = Rückgängig', (await striche(P)).length === 0 && /Rückgängig/.test(await toast(P)));
  await warte(P, 3500); // Toast von F1 abklingen lassen
  // Während ein Stift-Zug läuft, pausieren die Finger-Gesten (nur der Form-Tipp bleibt)
  await zug(P, welle(fx, fy - 150), { id: 32, offen: true });
  await geste(P, [[fx + 200, fy], [fx + 250, fy]]); await warte(P, 300);
  pruefe('F2 während eines Stift-Zugs löst der Zwei-Finger-Tipp kein Rückgängig aus', !/Rückgängig \(Zwei/.test(await toast(P)) || (await toast(P)) === '', await toast(P));
  await P.evaluate(([x, y]) => { document.elementFromPoint(x, y)?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 32, pointerType: 'pen', clientX: x, clientY: y, buttons: 0 })); }, [fx + 68, fy - 150]);
  await warte(P, 600);
  await ctx.close();
}

// ══ H: Zeichnen mit Finger/Maus: zwei Finger zoomen, Mausrad geht durch ══
console.log('\n════ H: Ohne Stift-Gerät — zwei Finger zoomen, Mausrad zoomt ════');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript((st) => { localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, stiftZeichnet: true, handschriftAuto: false, wheelZoom: true })); localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st })); }, stand);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await warte(P, 1500);
  await werkzeug(P, 'Stift');
  pruefe('H0 ohne bekannten Stift nimmt die Ebene alle Zeiger an', (await P.evaluate(() => getComputedStyle(document.querySelector('.drawing-layer')).pointerEvents)) === 'auto');
  const v0 = await ausschnitt(P);
  const [fx, fy] = await frei(P);
  // Zwei Finger als Pointer-Ereignisse auf der Ebene: erst einer (würde zeichnen), dann der zweite, dann auseinander
  await P.evaluate(async ({ fx, fy }) => {
    const el = document.elementFromPoint(fx, fy) ?? document.body;
    const mk = (typ, id, x, y, extra = {}) => new PointerEvent(typ, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, pressure: 0.5, buttons: 1, button: 0, ...extra });
    el.dispatchEvent(mk('pointerdown', 1, fx - 40, fy));
    await new Promise((r) => setTimeout(r, 30));
    el.dispatchEvent(mk('pointerdown', 2, fx + 40, fy, { isPrimary: false }));
    for (let i = 1; i <= 8; i += 1) { el.dispatchEvent(mk('pointermove', 1, fx - 40 - i * 15, fy)); el.dispatchEvent(mk('pointermove', 2, fx + 40 + i * 15, fy, { isPrimary: false })); await new Promise((r) => setTimeout(r, 20)); }
    el.dispatchEvent(mk('pointerup', 1, fx - 160, fy, { buttons: 0 }));
    el.dispatchEvent(mk('pointerup', 2, fx + 160, fy, { buttons: 0, isPrimary: false }));
  }, { fx, fy });
  await warte(P, 600);
  const v1 = await ausschnitt(P);
  const z1 = Number(/scale\(([\d.]+)\)/.exec(v1)?.[1] ?? 0);
  pruefe('H1 zwei Finger auseinander zoomen die Fläche beim Zeichnen (kein Strich entsteht)', z1 > 1.5 && (await striche(P)).length === 0, JSON.stringify({ v0, v1, striche: (await striche(P)).length }));
  await P.mouse.move(fx, fy);
  await P.mouse.wheel(0, 400); await warte(P, 600);
  const z2 = Number(/scale\(([\d.]+)\)/.exec(await ausschnitt(P))?.[1] ?? 0);
  pruefe('H2 das Mausrad zoomt auch beim Zeichnen (Rad zoomt eingeschaltet)', z2 < z1, `${z1} → ${z2}`);
  await ctx.close();
}

// ══ G: Texte ════════════════════════════════════════════════════════
console.log('\n════ G: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt „Finger-Gesten wie in Procreate, überall (M326)"', js.includes('Finger-Gesten wie in Procreate, überall (M326)'));
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
