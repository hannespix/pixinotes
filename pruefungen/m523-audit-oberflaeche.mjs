/**
 * M523 — Audit der Rahmen-Oberfläche: Fenster, Kürzel, Suche, Menüs, Einstellungen, Hilfe, Englisch, PWA.
 *
 *   A  Fenster übereinander: Esc schließt nur das oberste; was zuletzt aufgeht, liegt obenauf; Tab bleibt darin.
 *   B  Kürzel der Ansicht (Alt+G, Alt+U, Alt+W, Alt+T) wirken nicht hinter einem offenen Fenster.
 *   C  Aufgaben-Zentrale: öffnet sich auch aus der Übersicht; ein Sprung zur Karte (Suche, Baum) führt aus ihr heraus.
 *   D  Suche: Enter führt den Befehl bzw. das Board aus, wenn es keine Kartentreffer gibt; „Zur Übersicht" zeigt die
 *      Hierarchie.
 *   E  Menüs und Dialoge: Esc schließt „＋ Neu", die ⋯-Menüs, Recherche und „Karten teilen"; der Fokus kehrt zurück;
 *      das letzte Board wird nicht erst abgefragt und dann abgelehnt.
 *   F  PWA: Nach EINEM Besuch startet die App ohne Netz (Einstiegsdateien im Cache), nachgeladene Teile öffnen sich;
 *      die Teilnehmer-Seite bekommt ohne Netz nicht die App untergeschoben.
 *   G  Einstellungen: Ein Reiterwechsel beginnt oben; der gewählte Reiter ist als gewählt ausgezeichnet.
 *   H  Hilfe und Einführung stimmen mit der App überein (Fragezeichen statt Logo, „Anordnen & Hintergrund", Aufgaben
 *      in der Navigation); die englische Kürzel-Tabelle hat keine deutschen Reste.
 *   I  Kontrast: Bereichsnamen der Übersicht im Hellen ≥ 4,5:1 (klassisch und pix·el).
 *   K  Start mit beschädigtem Teilen-Link bzw. leerem Teilen-Ziel: ein Hinweis statt Schweigen.
 *   L  Hinweise aus M520: englische Reste (Zeiterfassung „Day", Frist „in 3 d", „no agenda item") und Zähl-Texte
 *      ohne Klammer-Endung („Karte(n)") im Quelltext.
 *   Z  Über die ganze Reihe: keine Fehler in der Konsole.
 */
// Läuft aus dem Repository: `node pruefungen/m523-audit-oberflaeche.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';
import { kontrastScan } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const PORT = 5523;
const BASIS = `http://localhost:${PORT}/pixinotes/`;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Wie GitHub Pages: die App liegt unter /pixinotes/; was es nicht gibt, ist 404 (kein Rückfall auf die App)
const app = http.createServer((q, r) => {
  const pfad = decodeURIComponent(q.url.split('?')[0]);
  if (!pfad.startsWith('/pixinotes/')) { r.writeHead(404); r.end(); return; }
  const rel = pfad.slice('/pixinotes/'.length);
  const f = join(DIST, rel === '' ? 'index.html' : rel);
  if (!existsSync(f)) { r.writeHead(404); r.end('nicht da'); return; }
  r.writeHead(200, { 'Content-Type': TYP[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => { if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); } };
const warteBis = async (P, fn, ms = 15000, arg) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
/** Bleibt der Zustand eine Weile so? (für „es passiert NICHTS") */
const bleibt = async (P, fn, ms = 900, arg) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (!(await P.evaluate(fn, arg))) return false; await P.waitForTimeout(120); } return true; };

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
/** Neue Seite; `beispiele` lädt die Beispiel-Umgebung und öffnet das Board „Schreibtisch" */
async function seite({ breite = 1440, hoehe = 900, beispiele = true, sprache = 'de' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe } });
  await ctx.addInitScript(([spr, bsp]) => {
    if (sessionStorage.getItem('__m523')) return;
    sessionStorage.setItem('__m523', '1');
    if (!bsp) localStorage.setItem('pixinotes-onboarded', '1');
    if (spr === 'en') localStorage.setItem('pixinotes-sprache', 'en');
  }, [sprache, beispiele]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(`pageerror: ${e.message.slice(0, 200)}`));
  P.on('console', (m) => { if (m.type() === 'error') fehler.push(`console.error: ${m.text().slice(0, 200)}`); });
  await P.goto(BASIS);
  if (beispiele) {
    await P.locator('[data-taste="onb-beispiele"]').click();
    await P.waitForSelector('.ov-mode', { timeout: 30000 });
    if (breite > 860) {
      await P.locator('.side-board-name', { hasText: 'Schreibtisch' }).first().click();
      await P.waitForSelector('.react-flow__node-note', { timeout: 30000 });
    }
  } else await P.waitForSelector('.dock', { timeout: 30000 });
  return { P, ctx };
}
const offen = (P) => P.evaluate(() => ({
  einst: !!document.querySelector('.modal[aria-label="Einstellungen"]'), hilfe: !!document.querySelector('.help-modal'),
  suche: !!document.querySelector('.search-box'), aufgaben: !!document.querySelector('.taskhub'), nav: !!document.querySelector('.nav-backdrop'),
  uebersicht: !!document.querySelector('.ov-mode'), board: !!document.querySelector('.dock'),
}));
/** Liegt die Mitte von `sel` wirklich obenauf (und nicht unter einem anderen Fenster)? */
const obenauf = (P, sel) => P.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return false;
  const r = el.getBoundingClientRect();
  // an mehreren Stellen messen: Mitte und die vier Viertelpunkte
  return [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].every(([fx, fy]) => {
    const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
    return !!t && el.contains(t);
  });
}, sel);
/** Ein Abschnitt für sich: Bricht er ab (ein erwartetes Fenster kommt nicht), zählt das als Fehler — die übrigen laufen weiter */
const teil = async (fn) => { try { await fn(); } catch (e) { bad += 1; console.log(`  ✗ Abschnitt abgebrochen: ${String(e.message).split('\n')[0].slice(0, 160)}`); for (const c of browser.contexts()) await c.close().catch(() => {}); } };
const fokusIn = (P, sel) => P.evaluate((s) => !!document.activeElement?.closest(s), sel);

// ══ A: Fenster übereinander ══════════════════════════════════════════════════════════════════════════════
console.log('\n════ A: Fenster übereinander ════');
await teil(async () => {
  const { P, ctx } = await seite();
  // A1: Aufgaben-Zentrale, darüber die Einstellungen
  await P.keyboard.press('Alt+t'); await P.waitForSelector('.taskhub');
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'));
  pruefe('A1 Aufgaben-Zentrale + Einstellungen: Esc schließt nur die Einstellungen', await bleibt(P, () => !!document.querySelector('.taskhub') && !document.querySelector('.modal[aria-label="Einstellungen"]')), JSON.stringify(await offen(P)));
  await P.evaluate(() => document.activeElement?.blur?.());
  await P.keyboard.press('Escape');
  pruefe('A2 … der zweite Druck schließt die Zentrale', await warteBis(P, () => !document.querySelector('.taskhub'), 5000));
  if (await P.locator('.taskhub').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(300); }

  // A3–A6: Einstellungen, darüber die Hilfe
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
  await P.keyboard.press('Alt+h'); await P.waitForSelector('.help-modal');
  await P.waitForTimeout(400);
  pruefe('A3 Hilfe über den Einstellungen geöffnet: sie liegt obenauf', await obenauf(P, '.help-modal'));
  for (let i = 0; i < 4; i++) await P.keyboard.press('Tab');
  pruefe('A4 Tab bleibt im obersten Fenster (Hilfe)', await fokusIn(P, '.help-modal'), await P.evaluate(() => document.activeElement?.className));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.help-modal'), 5000);
  pruefe('A5 Esc schließt nur die Hilfe, die Einstellungen bleiben', await bleibt(P, () => !document.querySelector('.help-modal') && !!document.querySelector('.modal[aria-label="Einstellungen"]')), JSON.stringify(await offen(P)));
  pruefe('A6 … und der Fokus steht wieder in den Einstellungen', await warteBis(P, () => !!document.activeElement?.closest('.modal[aria-label="Einstellungen"]'), 4000));

  // A7–A8: Einstellungen, darüber die Suche
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.waitForTimeout(400);
  pruefe('A7 Suche über den Einstellungen geöffnet: sie liegt obenauf', await obenauf(P, '.search-box input'));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.search-box'), 5000);
  pruefe('A8 Esc schließt nur die Suche', await bleibt(P, () => !document.querySelector('.search-box') && !!document.querySelector('.modal[aria-label="Einstellungen"]')), JSON.stringify(await offen(P)));
  await P.keyboard.press('Escape');
  pruefe('A9 … danach die Einstellungen', await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 5000));

  // A10: umgekehrt — Suche zuerst, Einstellungen darüber
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
  await P.waitForTimeout(300);
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 5000);
  pruefe('A10 Suche + Einstellungen: Esc schließt nur die Einstellungen', await bleibt(P, () => !!document.querySelector('.search-box') && !document.querySelector('.modal[aria-label="Einstellungen"]')), JSON.stringify(await offen(P)));
  await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.search-box'), 5000);

  // A11: Während der Präsentation geöffnete Einstellungen — Esc schließt erst sie, dann die Präsentation (kein Festhängen)
  await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter');
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape');
  const einstZu = await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 5000);
  const vortragNoch = await P.locator('.presenter').count();
  await P.keyboard.press('Escape');
  pruefe('A11 Einstellungen in der Präsentation: erstes Esc schließt sie, das zweite die Präsentation', einstZu && vortragNoch === 1 && await warteBis(P, () => !document.querySelector('.presenter'), 5000), `einst zu ${einstZu}, Vortrag ${vortragNoch}`);
  for (let i = 0; i < 2 && (await P.locator('.presenter, .modal-backdrop').count()); i++) { await P.keyboard.press('Escape'); await P.waitForTimeout(300); }

  // ══ B: Kürzel hinter einem Fenster ══
  console.log('\n════ B: Kürzel hinter einem offenen Fenster ════');
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
  await P.waitForTimeout(300);
  await P.keyboard.press('Alt+g');
  pruefe('B1 Alt+G wechselt die Ansicht nicht hinter den Einstellungen', await bleibt(P, () => !document.querySelector('.ov-mode') && !!document.querySelector('.dock')));
  await P.keyboard.press('Alt+u');
  pruefe('B2 Alt+U klappt die Spalte nicht weg', await bleibt(P, () => !!document.querySelector('.app.nav-links')));
  await P.keyboard.press('Alt+w');
  pruefe('B3 Alt+W öffnet nichts dahinter, der Fokus bleibt im Fenster', await bleibt(P, () => !document.querySelector('.nav-backdrop') && !document.querySelector('.search-box') && !!document.activeElement?.closest('.modal[aria-label="Einstellungen"]')), JSON.stringify(await offen(P)));
  await P.keyboard.press('Alt+t');
  await P.waitForTimeout(500);
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 5000);
  pruefe('B4 Alt+T öffnet die Aufgaben-Zentrale nicht hinter dem Fenster', await bleibt(P, () => !document.querySelector('.taskhub') && !!document.querySelector('.dock')), JSON.stringify(await offen(P)));
  // ohne Fenster wirken sie weiter
  await P.keyboard.press('Alt+g');
  pruefe('B5 ohne Fenster wechselt Alt+G weiter ins Netz', await warteBis(P, () => !!document.querySelector('.ov-mode'), 8000));
  await P.keyboard.press('Alt+g'); await P.waitForSelector('.dock');
  await ctx.close();
});

// ══ C: Aufgaben-Zentrale und Ansicht ═════════════════════════════════════════════════════════════════════
console.log('\n════ C: Aufgaben-Zentrale ════');
await teil(async () => {
  const { P, ctx } = await seite();
  // C1: aus der offenen Zentrale per Suche zu einer Karte
  await P.keyboard.press('Alt+t'); await P.waitForSelector('.taskhub');
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.insertText('Telefonnotiz');
  await P.waitForSelector('.search-hit');
  await P.keyboard.press('Enter');
  pruefe('C1 Suche → Treffer bei offener Zentrale: das Board mit der Karte ist zu sehen', await warteBis(P, () => !document.querySelector('.taskhub') && [...document.querySelectorAll('.react-flow__node')].some((n) => /Telefonnotiz/.test(n.textContent)), 10000), JSON.stringify(await offen(P)));
  // C2: Karte im Baum anklicken, während die Zentrale offen ist
  if (await P.locator('.focus-head').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(400); }
  await P.keyboard.press('Alt+t'); await P.waitForSelector('.taskhub');
  await P.locator('.tabs button', { hasText: 'Schnelle Notizen' }).first().click();
  pruefe('C2 Karte im Baum bei offener Zentrale: die Karte ist zu sehen', await warteBis(P, () => !document.querySelector('.taskhub') && !!document.querySelector('.react-flow__node'), 10000), JSON.stringify(await offen(P)));
  // C5: ein Board im Baum anklicken, während die Zentrale offen ist
  if (await P.locator('.focus-head').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(400); }
  await P.keyboard.press('Alt+t'); await P.waitForSelector('.taskhub');
  await P.locator('.side-board-name', { hasText: 'Aufgaben-Zentrale' }).first().click();
  pruefe('C5 Board im Baum bei offener Zentrale: das Board ist zu sehen', await warteBis(P, () => !document.querySelector('.taskhub') && !!document.querySelector('.dock') && /Aufgaben-Zentrale/.test(document.querySelector('.side-board.active')?.textContent ?? ''), 8000), JSON.stringify(await offen(P)));
  // C3/C4: aus der Übersicht
  if (await P.locator('.focus-head').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(400); }
  await P.locator('[data-taste="uebersicht"]').click(); await P.waitForSelector('.ov-mode');
  await P.keyboard.press('Alt+t');
  pruefe('C3 Alt+T in der Übersicht: die Aufgaben-Zentrale ist zu sehen', await warteBis(P, () => !!document.querySelector('.taskhub') && !document.querySelector('.ov-mode'), 8000), JSON.stringify(await offen(P)));
  await P.evaluate(() => document.activeElement?.blur?.()); await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.taskhub'), 5000);
  await P.locator('[data-taste="uebersicht"]').click(); await P.waitForSelector('.ov-mode');
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.insertText('aufgaben-zen');
  await P.locator('.search-cmd', { hasText: 'Alle offenen Aufgaben' }).first().click();
  pruefe('C4 Strg+K „Aufgaben-Zentrale" aus der Übersicht: sie ist zu sehen', await warteBis(P, () => !!document.querySelector('.taskhub') && !document.querySelector('.ov-mode'), 8000), JSON.stringify(await offen(P)));
  await ctx.close();
});

// ══ D: Suche ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ D: Suche ════');
await teil(async () => {
  const { P, ctx } = await seite();
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.insertText('einstellungen');
  await P.waitForSelector('.search-cmd');
  pruefe('D1 Befehl ohne Kartentreffer ist als die Zeile markiert, die Enter ausführt',
    (await P.locator('.search-hit').count()) === 0 && await P.evaluate(() => { const c = document.querySelector('.search-cmd'); return getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)'; }));
  await P.keyboard.press('Enter');
  pruefe('D2 Enter führt den Befehl aus (Einstellungen offen, Suche zu)', await warteBis(P, () => !!document.querySelector('.modal[aria-label="Einstellungen"]') && !document.querySelector('.search-box'), 6000), JSON.stringify(await offen(P)));
  await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 5000);
  // D3: ein leeres Board, das nur über seinen Namen zu finden ist
  await P.locator('button[aria-label="Neu"]').first().click();
  await P.locator('.neu-menu button', { hasText: 'Board' }).first().click();
  await P.waitForSelector('.side-board.active .side-board-name');
  await P.locator('.side-board.active .side-board-name').first().dblclick();
  await P.keyboard.press('Control+a'); await P.keyboard.insertText('Zzyzxweg'); await P.keyboard.press('Enter');
  await P.locator('.side-board-name', { hasText: 'Schreibtisch' }).first().click(); await P.waitForSelector('.react-flow__node-note');
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.insertText('Zzyzxweg'); await P.waitForSelector('.search-cmd');
  await P.keyboard.press('Enter');
  pruefe('D3 Enter öffnet das Board, wenn nur sein Name passt', await warteBis(P, () => !document.querySelector('.search-box') && /Zzyzxweg/.test(document.querySelector('.side-board.active')?.textContent ?? ''), 6000));
  // D4: mit Kartentreffern springt Enter wie bisher zur Karte
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.insertText('Telefonnotiz'); await P.waitForSelector('.search-hit');
  await P.keyboard.press('Enter');
  pruefe('D4 mit Kartentreffern springt Enter weiter zur Karte', await warteBis(P, () => /Schreibtisch/.test(document.querySelector('.side-board.active')?.textContent ?? '') && !document.querySelector('.search-box'), 8000));
  if (await P.locator('.focus-head').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(400); }
  // D5: „Zur Übersicht" zeigt die Hierarchie, auch wenn zuletzt das Netz zu sehen war
  await P.keyboard.press('Alt+g'); await P.waitForSelector('.ov-mode');
  await P.keyboard.press('Alt+g'); await P.waitForSelector('.dock');
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box');
  await P.keyboard.insertText('zur übersicht');
  await P.locator('.search-cmd', { hasText: 'Zur Übersicht' }).first().click();
  await P.waitForSelector('.ov-mode');
  pruefe('D5 „Zur Übersicht" zeigt Bereiche, Projekte und Boards (nicht das zuletzt gezeigte Netz)', await warteBis(P, () => document.querySelector('.ov-mode button.on')?.textContent === 'Hierarchie', 5000), await P.evaluate(() => document.querySelector('.ov-mode button.on')?.textContent));
  await ctx.close();
});

// ══ E: Menüs und Dialoge ═════════════════════════════════════════════════════════════════════════════════
console.log('\n════ E: Menüs und Dialoge ════');
await teil(async () => {
  const { P, ctx } = await seite();
  const neu = P.locator('button[aria-label="Neu"]').first();
  await neu.focus(); await P.keyboard.press('Enter'); await P.waitForSelector('.neu-menu');
  await P.keyboard.press('Escape');
  pruefe('E1 Esc schließt „＋ Neu"', await warteBis(P, () => !document.querySelector('.neu-menu'), 4000));
  pruefe('E2 … der Fokus steht wieder auf dem Knopf', await P.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Neu'));
  if (await P.locator('.neu-menu').count()) { await P.mouse.click(900, 500); await P.waitForTimeout(300); }
  for (const [nr, was, sel] of [['E3', 'Board', '.side-board.active .ebenen-menu-knopf'], ['E4', 'Projekt', '.side-proj-head .ebenen-menu-knopf'], ['E5', 'Bereich', '.side-space-head .ebenen-menu-knopf']]) {
    const k = P.locator(sel).first();
    await k.focus(); await P.keyboard.press('Enter'); await P.waitForSelector('.ebenen-menu[role="menu"]');
    await P.keyboard.press('Escape');
    const zu = await warteBis(P, () => !document.querySelector('.ebenen-menu'), 4000);
    pruefe(`${nr} Esc schließt das ⋯-Menü am ${was}, Fokus zurück auf ⋯`, zu && await P.evaluate(() => !!document.activeElement?.classList.contains('ebenen-menu-knopf')));
    if (!zu) { await P.mouse.click(900, 500); await P.waitForTimeout(300); }
  }
  // E6: Dock „+": Esc → Fokus auf dem Knopf
  await P.locator('.dock button[aria-label="Objekt hinzufügen"]').click(); await P.waitForSelector('.modul-palette');
  await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.modul-palette'), 4000);
  pruefe('E6 Modul-Palette: nach Esc steht der Fokus auf „Objekt hinzufügen" (nicht im Leeren)', await P.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Objekt hinzufügen'), await P.evaluate(() => document.activeElement?.tagName));
  // E7: Recherche-Dialog
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForSelector('.dock-menu-more');
  await P.locator('.dock-menu-more button[aria-label="KI-Assistent"]').click(); await P.waitForSelector('.dock-menu-ai');
  await P.locator('.dock-menu-ai button', { hasText: 'Recherche mit Quellen' }).click();
  await P.waitForSelector('[role="dialog"][aria-label="Recherche mit Quellen"]');
  await P.keyboard.press('Escape');
  pruefe('E7 Esc schließt den Recherche-Dialog', await warteBis(P, () => !document.querySelector('[role="dialog"][aria-label="Recherche mit Quellen"]'), 4000));
  if (await P.locator('[role="dialog"][aria-label="Recherche mit Quellen"]').count()) await P.locator('.modal-backdrop .modal-x, .modal-backdrop button[aria-label="Schließen"]').first().click();
  // E8: Karten teilen
  await P.locator('.react-flow__node-note').first().click({ position: { x: 30, y: 10 } });
  await P.waitForSelector('.sel-toolbar');
  await P.locator('.sel-toolbar button[aria-label="Teilen"]').click();
  await P.waitForSelector('.modal-backdrop .modal');
  await P.waitForTimeout(300);
  await P.keyboard.press('Escape');
  pruefe('E8 Esc schließt „Karten teilen"', await warteBis(P, () => !document.querySelector('.modal-backdrop'), 4000));
  if (await P.locator('.modal-backdrop').count()) await P.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } });
  await ctx.close();
});
await teil(async () => {
  // E9: Ausstülpung (schmal): Esc im ⋯-Menü schließt nur das Menü; E10: letztes Board
  const { P, ctx } = await seite({ breite: 700, hoehe: 800, beispiele: false });
  await P.locator('[data-taste="navigator"]').first().click(); await P.waitForSelector('.nav-panel');
  const k = P.locator('.nav-panel .side-board.active .ebenen-menu-knopf').first();
  await k.focus(); await P.keyboard.press('Enter'); await P.waitForSelector('.ebenen-menu[role="menu"]');
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.ebenen-menu'), 4000);
  pruefe('E9 Navigation als Ausstülpung: Esc schließt nur das ⋯-Menü, die Navigation bleibt', await bleibt(P, () => !document.querySelector('.ebenen-menu') && !!document.querySelector('.nav-panel')));
  if (await P.locator('.ebenen-menu').count()) { await P.mouse.click(650, 700); await P.waitForTimeout(300); }
  // E10: Das letzte Board löschen — keine Rückfrage, die danach doch abgelehnt wird
  const dialoge = [];
  P.on('dialog', (d) => { dialoge.push(d.message()); void d.accept(); });
  if (!(await P.locator('.nav-panel').count())) { await P.locator('[data-taste="navigator"]').first().click(); await P.waitForSelector('.nav-panel'); }
  await P.locator('.nav-panel .side-board.active .ebenen-menu-knopf').first().click({ force: true });
  await P.waitForSelector('.ebenen-menu[role="menu"]');
  await P.locator('.ebenen-menu button', { hasText: 'Löschen' }).first().click();
  const hinweis = await warteBis(P, () => /letzte Board bleibt/.test(document.querySelector('.toast.show')?.textContent ?? ''), 5000);
  pruefe('E10 Letztes Board löschen: gleich der Hinweis, keine Rückfrage davor', hinweis && dialoge.length === 0, JSON.stringify(dialoge));
  await ctx.close();
});

// ══ F: PWA ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ F: PWA – ohne Netz nach einem Besuch ════');
await teil(async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pixinotes-onboarded', '1'); } catch { /* egal */ } });
  const P = await ctx.newPage();
  const lokal = [];
  P.on('pageerror', (e) => lokal.push(e.message.slice(0, 160)));
  await P.goto(BASIS); await P.waitForSelector('.dock');
  await P.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Der Vorrat steht, sobald die Installation durch ist; die nachgeladenen Teile holt der Leerlauf (M446) – darauf warten
  const einstieg = await P.evaluate(() => [...document.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="modulepreload"]')].map((e) => e.src || e.href));
  const imCache = (urls) => P.evaluate(async (u) => { const c = await caches.open('pixinotes-v1'); const fehlt = []; for (const x of u) if (!(await c.match(x))) fehlt.push(x.split('/').pop()); return fehlt; }, urls);
  let fehlt = ['?'];
  for (let i = 0; i < 60 && fehlt.length; i++) { fehlt = await imCache(einstieg); if (fehlt.length) await P.waitForTimeout(500); }
  pruefe('F1 nach dem ersten Besuch liegt alles im Cache, was die Seite einbindet (Skript, Module, Stylesheets)', fehlt.length === 0, 'fehlt: ' + fehlt.slice(0, 6).join(', '));
  // Die nachgeladenen Teile holt der Leerlauf (M446) einige Sekunden nach dem Start. Warten, bis die Ansichten im Cache
  // liegen UND der Cache eine Weile nicht mehr wächst (jeder Teil zieht seine Abhängigkeiten nach).
  { let zahl = -1; let ruhig = 0;
    for (let i = 0; i < 120 && ruhig < 6; i++) {
      const k = await P.evaluate(async () => (await (await caches.open('pixinotes-v1')).keys()).map((r) => r.url));
      const da = ['Settings', 'HelpOverlay', 'SearchOverlay', 'TaskHub', 'Overview'].every((n) => k.some((u) => u.includes(`/assets/${n}-`)));
      ruhig = da && k.length === zahl ? ruhig + 1 : 0; zahl = k.length;
      await P.waitForTimeout(500);
    } }
  P.on('requestfailed', (r) => lokal.push(`nicht geladen: ${r.url().split('/').pop()}`));
  await ctx.setOffline(true);
  await P.reload().catch(() => {});
  pruefe('F2 ohne Netz neu geladen: die App startet (keine weiße Seite)', await warteBis(P, () => !!document.querySelector('.dock'), 15000), lokal.slice(0, 2).join(' | '));
  const auf = [];
  for (const [taste, sel] of [['Alt+e', '.modal[aria-label="Einstellungen"]'], ['Alt+h', '.help-modal'], ['Control+k', '.search-box'], ['Alt+t', '.taskhub']]) {
    await P.keyboard.press(taste);
    if (!(await warteBis(P, (s2) => !!document.querySelector(s2), 8000, sel))) auf.push(sel);
    // Der Esc-Zuhörer eines Fensters hängt erst nach dem ersten Bild (Effekt) — kurz warten, sonst verpufft die Taste
    await P.waitForTimeout(400);
    await P.evaluate(() => document.activeElement?.blur?.()); await P.keyboard.press('Escape');
    await warteBis(P, (s2) => !document.querySelector(s2), 4000, sel);
  }
  if (await P.locator('[data-taste="uebersicht"]').count()) await P.locator('[data-taste="uebersicht"]').click(); else auf.push('App-Rahmen (Darstellung abgestürzt)');
  if (!(await warteBis(P, () => !!document.querySelector('.ov-mode'), 8000))) auf.push('Übersicht');
  pruefe('F3 ohne Netz öffnen sich Einstellungen, Hilfe, Suche, Aufgaben-Zentrale und Übersicht', auf.length === 0, 'fehlt: ' + auf.join(', ') + ' · ' + lokal.slice(0, 6).join(' | '));
  // F4: Die Teilnehmer-Seite ist ohne Netz nicht die App
  const M = await ctx.newPage();
  const antwort = await M.goto(`${BASIS}mitmachen.html#x`, { timeout: 8000 }).catch(() => null);
  const istApp = antwort ? await M.evaluate(() => !!document.querySelector('#root') && /PixiNotes$/.test(document.title) && !document.querySelector('[data-mitmachen], .mm, main.mitmachen')).catch(() => false) : false;
  const appSeite = antwort ? (await antwort.text().catch(() => '')).includes('assets/index-') : false;
  pruefe('F4 mitmachen.html ohne Netz: nicht die App-Seite unter fremder Adresse', !antwort || !appSeite, `status ${antwort?.status()} istApp ${istApp}`);
  await M.close();
  await ctx.setOffline(false);
  // F5: mit Netz bleibt die Teilnehmer-Seite sie selbst, und sie überschreibt die gecachte App-Seite nicht
  const M2 = await ctx.newPage();
  const a2 = await M2.goto(`${BASIS}mitmachen.html#x`);
  const mmText = await a2.text();
  await M2.close();
  await ctx.setOffline(true);
  await P.goto(BASIS).catch(() => {});
  pruefe('F5 nach einem Besuch der Teilnehmer-Seite startet ohne Netz weiter die App', !mmText.includes('assets/index-') && await warteBis(P, () => !!document.querySelector('.topbar .logo'), 15000));
  await ctx.setOffline(false);
  await ctx.close();
});

// ══ G: Einstellungen ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ G: Einstellungen ════');
await teil(async () => {
  const { P, ctx } = await seite({ beispiele: false });
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"] .modal-body');
  await P.evaluate(() => { document.querySelector('.modal[aria-label="Einstellungen"] .modal-body').scrollTop = 500; });
  const gerollt = await P.evaluate(() => document.querySelector('.modal[aria-label="Einstellungen"] .modal-body').scrollTop);
  await P.locator('.modal-tabs button').nth(1).click();
  await P.waitForTimeout(400);
  const danach = await P.evaluate(() => document.querySelector('.modal[aria-label="Einstellungen"] .modal-body').scrollTop);
  pruefe('G1 Reiterwechsel beginnt oben (vorher blieb der Rollstand des vorigen Reiters)', gerollt > 200 && danach === 0, `${gerollt} → ${danach}`);
  const zustand = await P.evaluate(() => [...document.querySelectorAll('.modal-tabs button')].map((b) => b.getAttribute('aria-pressed')));
  pruefe('G2 der gewählte Reiter ist als gewählt ausgezeichnet (genau einer)', zustand.filter((z) => z === 'true').length === 1 && zustand[1] === 'true', JSON.stringify(zustand));
  await ctx.close();
});

// ══ H: Hilfe und Einführung ══════════════════════════════════════════════════════════════════════════════
console.log('\n════ H: Hilfe und Einführung ════');
await teil(async () => {
  // H1/H2: Einführung — wohin sie schickt, dorthin führt es auch
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(`pageerror: ${e.message.slice(0, 200)}`));
  await P.goto(BASIS); await P.waitForSelector('.onb');
  const fuss = await P.locator('.onb-foot').innerText();
  pruefe('H1 Einführung schickt für die Hilfe zum Fragezeichen (nicht mehr zum Logo)', /Fragezeichen/.test(fuss) && !/Logo/.test(fuss), fuss.slice(-90));
  await P.locator('.onb-primary').click(); await P.waitForSelector('.dock');
  await P.locator('[data-taste="hilfe"]').first().click();
  const hilfeAuf = await warteBis(P, () => !!document.querySelector('.help-modal'), 8000);
  await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.help-modal'), 4000);
  await P.locator('.logo').click();
  pruefe('H2 das Fragezeichen öffnet die Hilfe, das Logo die Übersicht', hilfeAuf && await warteBis(P, () => !!document.querySelector('.ov-mode') && !document.querySelector('.help-modal'), 6000));
  await P.locator('.side-board-name').first().click(); await P.waitForSelector('.dock');
  // H3: Was die Hilfe im Dock-Menü nennt, steht dort auch
  await P.keyboard.press('Alt+h'); await P.waitForSelector('.help-modal');
  const hilfe = await P.locator('.help-modal').evaluate((m) => [...m.querySelectorAll('#help-start li, #help-aufgaben li')].map((l) => l.textContent));
  const dockSatz = hilfe.find((t) => /^Dock ⋯ → „/.test(t)) ?? '';
  const genannt = /^Dock ⋯ → „([^"“”]+)["“”]/.exec(dockSatz)?.[1] ?? '';
  await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.help-modal'), 4000);
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForSelector('.dock-menu-more');
  const eintraege = (await P.locator('.dock-menu-more button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').replace(/ …$/, '').trim());
  await P.keyboard.press('Escape');
  pruefe('H3 der Eintrag, den die Hilfe im Dock-⋯ zum Aufräumen nennt, steht dort', !!genannt && eintraege.includes(genannt), `Hilfe nennt „${genannt}" · Menü: ${eintraege.join(' | ')}`);
  const aufgSatz = hilfe.find((t) => /sammelt alles boardübergreifend/.test(t)) ?? '';
  pruefe('H4 Aufgaben: die Hilfe nennt die Navigation (im Dock gibt es sie nicht)', /^Aufgaben in der Navigation/.test(aufgSatz) && (await P.locator('.tabs [data-taste="aufgaben"]').count()) > 0 && (await P.locator('.dock [data-taste="aufgaben"]').count()) === 0, aufgSatz.slice(0, 60));
  await ctx.close();
});
await teil(async () => {
  // H5/H6: Englisch — Kürzel-Tabelle ohne deutsche Reste
  const { P, ctx } = await seite({ beispiele: false, sprache: 'en' });
  await P.keyboard.press('Alt+h'); await P.waitForSelector('.help-modal .help-keys');
  const zeilen = await P.evaluate(() => [...document.querySelectorAll('.help-keys tr')].map((tr) => `${tr.children[0].textContent} ⇒ ${tr.children[1].textContent}`));
  const reste = zeilen.filter((z) => /Rechtsklick|wiederholen|rückgängig|[a-z]taste\b|Strg|Umschalt|Leertaste|Eingabe\b|Pfeil|Entf\b/.test(z));
  pruefe('H5 englische Kürzel-Tabelle ohne deutsche Reste', zeilen.length > 40 && reste.length === 0, reste.join(' || '));
  pruefe('H6 … mit „Right-click", „redo" und „Arrow key"', zeilen.some((z) => /^Right-click ⇒/.test(z)) && zeilen.some((z) => /^Ctrl\+Y ⇒ redo$/.test(z)) && zeilen.some((z) => /^Ctrl\+Arrow key ⇒/.test(z)));
  await ctx.close();
});

// ══ I: Kontrast ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ I: Kontrast der Bereichsnamen ════');
await teil(async () => {
  const { P, ctx } = await seite({ breite: 1440 });
  await P.emulateMedia({ colorScheme: 'light' });
  await P.locator('[data-taste="uebersicht"]').click(); await P.waitForSelector('.ovc-space-name');
  for (const [nr, design, knopf] of [['I1', 'klassisch', 'Klassisch'], ['I2', 'pix·el', 'pix']]) {
    await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal[aria-label="Einstellungen"]');
    await P.locator('.seg[aria-label="Erscheinungsbild"] button', { hasText: 'Hell' }).click();
    await P.locator('.seg[aria-label="Design"] button', { hasText: knopf }).click();
    await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.modal[aria-label="Einstellungen"]'), 4000);
    await P.waitForTimeout(400);
    const alle = (await kontrastScan(P, '.app', { grenze: 4.5, alle: true })).filter((t) => /ovc-space-name/.test(t.klasse));
    const schwach = alle.filter((t) => t.v < 4.5);
    pruefe(`${nr} Übersicht hell, ${design}: jeder Bereichsname ≥ 4,5:1`, alle.length >= 4 && schwach.length === 0, schwach.map((t) => `${t.text} ${t.v.toFixed(2)}`).join(', ') + ` (${alle.length} gemessen)`);
  }
  const farben = await P.evaluate(() => [...document.querySelectorAll('.ovc-space-name')].map((e) => getComputedStyle(e).color));
  pruefe('I3 die Bereiche behalten ihre eigene Farbe (vier verschiedene Töne)', new Set(farben).size >= 4, [...new Set(farben)].join(' '));
  await ctx.close();
});

// ══ K: Start mit Links ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n════ K: Start mit beschädigtem Link ════');
await teil(async () => {
  for (const [nr, anhang, muster, was] of [['K1', '#b=abcDEF123', /unvollständig oder beschädigt/, 'beschädigter Teilen-Link'], ['K2', '?geteilt=1', /nicht angekommen/, 'Teilen-Ziel ohne Inhalt']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('pixinotes-onboarded', '1'); } catch { /* egal */ }
      window.__hinweise = [];
      new MutationObserver(() => { const t = document.querySelector('.toast.show'); if (t?.textContent && !window.__hinweise.includes(t.textContent)) window.__hinweise.push(t.textContent); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    const P = await ctx.newPage();
    P.on('pageerror', (e) => fehler.push(`pageerror: ${e.message.slice(0, 200)}`));
    await P.goto(BASIS + anhang); await P.waitForSelector('.dock');
    const gesagt = await warteBis(P, (m) => window.__hinweise.some((h) => new RegExp(m).test(h)), 8000, muster.source);
    pruefe(`${nr} ${was}: die App sagt es und räumt die Adresse auf`, gesagt && await P.evaluate(() => !location.hash && !location.search), `${await P.evaluate(() => JSON.stringify(window.__hinweise))} ${P.url()}`);
    await ctx.close();
  }
});

// ══ L: Englische Reste und Zähl-Texte (Hinweise aus M520) ════════════════════════════════════════════════
console.log('\n════ L: Englisch und Zähl-Texte ════');
await teil(async () => {
  // Ein Board mit einer Protokoll-Reihe (zwei Beschlüsse: einer mit, einer ohne TOP)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('__m523')) return;
    sessionStorage.setItem('__m523', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-sprache', 'en');
    const tag = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const reihe = { title: 'Lenkungskreis', color: 'white', carryOpen: true, entries: [{ id: 'n1', date: tag, attendees: 'Anna Berg', blocks: [
      { id: 'h1', type: 'heading', props: { level: 3 }, content: 'TOP 1: Haushalt' }, { id: 'q1', type: 'paragraph', content: 'Die Zahlen liegen vor.' },
    ], decisions: [{ id: 'd1', text: 'Wir feiern im Hof.', top: 'h1', topText: 'TOP 1: Haushalt' }, { id: 'd2', text: 'Ohne Zuordnung.', top: '' }] }] };
    const state = { boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes: [{ id: 'm1', type: 'minutes', position: { x: 40, y: 40 }, width: 560, height: 760, data: reihe }] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(`pageerror: ${e.message.slice(0, 200)}`));
  await P.goto(BASIS); await P.waitForSelector('.react-flow__node-minutes select.pr-beschluss-top', { timeout: 30000 });
  await warteBis(P, () => [...document.querySelectorAll('select.pr-beschluss-top option')].length >= 2, 8000);
  const erste = await P.locator('select.pr-beschluss-top option:first-child').allInnerTexts();
  pruefe('L1 Protokoll englisch: der Eintrag „ohne TOP" ist übersetzt, die TOP-Texte des Nutzers bleiben', erste.length >= 2 && erste.every((t) => t === 'no agenda item') && (await P.locator('select.pr-beschluss-top option', { hasText: 'TOP 1: Haushalt' }).count()) >= 1, JSON.stringify(erste));
  // Zeiterfassung dazu: die vier Reiter
  await P.locator('.dock .dock-add-wrap button').first().click(); await P.waitForSelector('.modul-palette');
  await P.locator('.modul-kachel[data-modul="zeit"]').click();
  await P.waitForSelector('.time-views button');
  const reiter = await P.locator('.time-views button').allInnerTexts();
  pruefe('L2 Zeiterfassung englisch: Day · Week · Month · Year (nicht „day")', reiter.join('|') === 'Day|Week|Month|Year', reiter.join('|'));
  await ctx.close();
});
await teil(async () => {
  const { P, ctx } = await seite({ sprache: 'en' });
  await P.keyboard.press('Alt+t'); await P.waitForSelector('.taskhub');
  await P.waitForTimeout(400);
  await P.locator('.taskhub select').first().selectOption('all');
  await P.waitForSelector('.task-due');
  const fristen = [...new Set(await P.locator('.task-due').allInnerTexts())];
  pruefe('L3 Fristen englisch: „in 3 d" statt „in 3 T."', fristen.some((f) => /· in \d+ d$/.test(f)) && !fristen.some((f) => /T\.$|Tagen|heute|morgen|überfällig/.test(f)), fristen.slice(0, 6).join(' | '));
  await ctx.close();
});
{
  // L4: kein Zähl-Text mit Klammer-Endung mehr im Quelltext (M461: zahlWort) — Kommentare und die Hilfe ausgenommen
  const funde = [];
  const lauf = (dir) => { for (const n of readdirSync(dir)) { const f = join(dir, n); if (statSync(f).isDirectory()) { if (!/sprache$|mitmachen$/.test(f)) lauf(f); } else if (/\.tsx?$/.test(n) && !/^HelpOverlay/.test(n)) {
    readFileSync(f, 'utf8').split('\n').forEach((z, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(z)) return;
      const ohneKommentar = z.replace(/\s\/\/ .*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');
      if (/(^|[ >`'"„-])(?!String\(|Number\(|Array\(|Boolean\(|Symbol\(|Object\(|Error\()[A-ZÄÖÜ][a-zäöüß]{2,}\((e|n|en|er|s)\)[ .,:!?`'"<–-]/.test(ohneKommentar) || (/[A-ZÄÖÜ][a-zäöüß]{2,}\/[A-ZÄÖÜ][a-zäöüß]+e[n]?:/.test(ohneKommentar) && /\$\{/.test(ohneKommentar))) funde.push(`${path.relative(__repo, f)}:${i + 1}`);
    });
  } } };
  lauf(path.join(__repo, 'src'));
  pruefe('L4 kein Zähl-Text mit Klammer-Endung („${n} Karte(n)", „Eintrag/Einträge") im Quelltext', funde.length === 0, funde.join(', '));
}

// ══ Z: Konsole ═══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ Z: Konsole ════');
pruefe('Z1 keine Fehler in der Konsole über die ganze Reihe', fehler.length === 0, fehler.slice(0, 5).join(' | '));

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
