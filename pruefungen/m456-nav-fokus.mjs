/**
 * M456 — Navigation am Telefon barrierefrei (Befund B11 aus M447, docs/AUDIT.md §5).
 *
 *   A  Auslöser: aria-haspopup=dialog, aria-expanded folgt dem Zustand, aria-controls zeigt auf das Panel.
 *   B  Panel: role=dialog, aria-modal, Name; beim Öffnen steht der Fokus darin.
 *   C  Tab und Umschalt+Tab bleiben im Panel und laufen im Kreis.
 *   D  Hintergrund ist unerreichbar: inert, nicht anwählbar, nicht antippbar.
 *   E  Esc, ✕ und Tipp daneben schließen; der Fokus kehrt zum Auslöser zurück, der Hintergrund ist wieder frei.
 *   F  Ein Board wählen schließt und gibt den Hintergrund frei.
 *   G  Bewegung reduzieren: Panel und Abdunklung ohne Animation.
 *
 * Telefon aus playwright `devices` (Pixel 7). Gemessen wird Verhalten im gebauten Programm (dist/).
 */
// Läuft aus dem Repository: `node pruefungen/m456-nav-fokus.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5456;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const TELEFON = devices['Pixel 7'];

const note = (id, text, x, y) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const state = {
  boards: [
    { id: 'b1', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [note('n1', 'Antrag prüfen', 60, 60), note('n2', 'Telefonnotiz', 360, 60)] },
    { id: 'b2', name: 'Aufgaben', edges: [], drawings: [], comments: [], nodes: [note('n4', 'Wochenplan', 60, 60)] },
    { id: 'b3', name: 'Wissen', edges: [], drawings: [], comments: [], nodes: [] },
  ],
  spaces: [
    { id: 's1', name: 'Arbeitsplatz', projects: [
      { id: 'p1', name: 'Täglicher Einstieg', boardIds: ['b1', 'b2'] },
      { id: 'p2', name: 'Wissensbasis', boardIds: ['b3'] },
    ] },
  ],
  activeId: 'b1', view: 'board',
};
async function seite(extra = {}) {
  const ctx = await browser.newContext({ ...TELEFON, ...extra });
  await ctx.addInitScript((st) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, state);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
/** Der sichtbare Auslöser in der Kopfleiste (am Telefon der Weg-Knopf „Projekt › Board") */
const AUSLOESER = '.tabs [data-taste="navigator"]';
const zustand = (P) => P.evaluate((sel) => {
  const a = document.activeElement;
  const panel = document.querySelector('[role="dialog"][aria-label="Navigation"]');
  const knopf = document.querySelector(sel);
  return {
    offen: !!panel,
    imPanel: !!panel && panel.contains(a),
    aufKnopf: a === knopf,
    expanded: knopf?.getAttribute('aria-expanded'),
    rootInert: document.getElementById('root')?.inert === true,
  };
}, AUSLOESER);
const oeffnen = async (P) => {
  await P.focus(AUSLOESER);
  await P.keyboard.press('Enter');
  await P.waitForTimeout(400);
};

console.log('════ A/B: Auslöser und Panel ════');
{
  const { ctx, P } = await seite();
  const k = await P.evaluate((sel) => { const b = document.querySelector(sel); return b && { hp: b.getAttribute('aria-haspopup'), ex: b.getAttribute('aria-expanded'), ct: b.getAttribute('aria-controls') }; }, AUSLOESER);
  pruefe('A1 am Telefon steht ein Auslöser in der Kopfleiste', !!k, k);
  pruefe('A2 Auslöser: aria-haspopup=dialog, aria-expanded=false, aria-controls gesetzt', k?.hp === 'dialog' && k?.ex === 'false' && !!k?.ct, k);
  await oeffnen(P);
  const p = await P.evaluate((sel) => {
    const b = document.querySelector(sel);
    const ziel = document.getElementById(b.getAttribute('aria-controls'));
    return { ex: b.getAttribute('aria-expanded'), ziel: !!ziel, rolle: ziel?.getAttribute('role'), modal: ziel?.getAttribute('aria-modal'), name: ziel?.getAttribute('aria-label'), baum: !!ziel?.querySelector('.side-tree') };
  }, AUSLOESER);
  pruefe('A3 offen: aria-expanded=true, aria-controls zeigt auf das Panel mit dem Baum', p.ex === 'true' && p.ziel && p.baum, p);
  pruefe('B1 Panel: role=dialog, aria-modal=true, Name „Navigation"', p.rolle === 'dialog' && p.modal === 'true' && p.name === 'Navigation', p);
  const z = await zustand(P);
  pruefe('B2 beim Öffnen steht der Fokus im Panel', z.imPanel, z);

  console.log('════ C: Tab-Kreis ════');
  const lauf = async (taste, n) => {
    const spur = [];
    for (let i = 0; i < n; i += 1) {
      await P.keyboard.press(taste);
      spur.push(await P.evaluate(() => {
        const a = document.activeElement;
        const panel = document.querySelector('.nav-panel');
        if (!a) return { drin: false, id: '' };
        if (!a.dataset.m456) a.dataset.m456 = String(Math.random()).slice(2, 8);
        return { drin: !!panel && panel.contains(a), id: a.dataset.m456 };
      }));
    }
    return spur;
  };
  const vor = await lauf('Tab', 40);
  const idsVor = vor.map((s) => s.id);
  const einmaligVor = new Set(idsVor).size;
  pruefe('C1 Tab bleibt 40 Schritte lang im Panel', vor.every((s) => s.drin), vor.filter((s) => !s.drin).length);
  pruefe('C2 Tab läuft im Kreis (Ziele wiederholen sich)', einmaligVor >= 3 && einmaligVor < 40, einmaligVor);
  const rueck = await lauf('Shift+Tab', 40);
  pruefe('C3 Umschalt+Tab bleibt im Panel', rueck.every((s) => s.drin), rueck.filter((s) => !s.drin).length);
  pruefe('C4 Umschalt+Tab läuft dieselben Ziele rückwärts', rueck.map((s) => s.id).every((id) => idsVor.includes(id)));

  console.log('════ D: Hintergrund unerreichbar ════');
  const d = await P.evaluate((sel) => {
    const knopf = document.querySelector(sel);
    const r = knopf.getBoundingClientRect();
    const oben = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const vorher = document.activeElement;
    knopf.focus();
    const fokusGing = document.activeElement === knopf;
    vorher?.focus?.();
    return { rootInert: document.getElementById('root')?.inert === true, knopfInert: !!knopf.closest('[inert]'), fokusGing, obenIstKnopf: knopf.contains(oben) };
  }, AUSLOESER);
  pruefe('D1 der Hintergrund (#root) ist inert', d.rootInert && d.knopfInert, d);
  pruefe('D2 ein Knopf dahinter lässt sich nicht anwählen', !d.fokusGing, d);
  pruefe('D3 ein Tipp auf die Kopfleiste trifft nicht den Knopf dahinter', !d.obenIstKnopf, d);

  console.log('════ E: Schließen ════');
  await P.keyboard.press('Escape');
  await P.waitForTimeout(400);
  let e = await zustand(P);
  pruefe('E1 Esc schließt, der Fokus steht wieder auf dem Auslöser', !e.offen && e.aufKnopf, e);
  pruefe('E2 danach: aria-expanded=false, Hintergrund nicht mehr inert', e.expanded === 'false' && !e.rootInert, e);

  await oeffnen(P);
  await P.focus('.nav-panel .nav-x');
  await P.keyboard.press('Enter');
  await P.waitForTimeout(400);
  e = await zustand(P);
  pruefe('E3 ✕ schließt, der Fokus kehrt zum Auslöser zurück', !e.offen && e.aufKnopf && !e.rootInert, e);

  await oeffnen(P);
  const vp = TELEFON.viewport;
  await P.touchscreen.tap(vp.width / 2, 12);   // über dem Panel: die Abdunklung
  await P.waitForTimeout(400);
  e = await zustand(P);
  pruefe('E4 ein Tipp daneben schließt, der Hintergrund ist wieder frei', !e.offen && !e.rootInert, e);

  console.log('════ F: Board wählen ════');
  await oeffnen(P);
  await P.locator('.nav-panel .side-board', { hasText: 'Aufgaben' }).locator('.side-board-name').click();
  await P.waitForTimeout(700);
  e = await zustand(P);
  const aktiv = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId);
  pruefe('F1 ein Board wählen schließt, öffnet das Board und gibt den Hintergrund frei', !e.offen && !e.rootInert && aktiv === 'b2', { ...e, aktiv });
  await ctx.close();
}

console.log('════ G: Bewegung reduzieren ════');
{
  const { ctx, P } = await seite({ reducedMotion: 'reduce' });
  await oeffnen(P);
  const g = await P.evaluate(() => ['.nav-backdrop', '.nav-panel'].map((s) => {
    const cs = getComputedStyle(document.querySelector(s));
    return { s, a: cs.animationName, t: cs.transitionDuration };
  }));
  pruefe('G1 Panel und Abdunklung ohne Animation', g.every((x) => x.a === 'none' && x.t.split(',').every((d) => parseFloat(d) === 0)), g);
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
