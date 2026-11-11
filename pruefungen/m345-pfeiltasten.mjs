/**
 * M345 — Pfeiltasten in allen Ansichten.
 *
 *   A  Navigationsbaum: F6 führt hinein, ↑ ↓ gehen weiter, ← → klappen zu/auf, Enter öffnet.
 *   B  F6 / Umschalt+F6 wechseln den Bereich.
 *   C  Leisten (Dock): ← →.   D  Menüs: ↓ führt hinein, ↑ ↓ Pos1 Ende; Palette als Raster.
 *   E  Übersicht (Kacheln) und F Netz: Pfeile wählen, Enter öffnet.
 *   G  Aufgaben-Zentrale: ↑ ↓, Enter, ←, Leertaste, Strg+Enter.
 *   H  Board: Pos1/Ende, Strg+Umschalt+Pfeil.   I  Präsentation: Pos1/Ende.   J  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m345-pfeiltasten.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4563;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const notiz = (id, x, y, text, extra = []) => ({ id, type: 'note', width: 280, height: 140, autoFit: false, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}a`, type: 'paragraph', content: text }, ...extra] } });
const haken = (id, text) => ({ id, type: 'checkListItem', props: { checked: false }, content: text });
const stand = () => ({
  boards: [
    { id: 'b1', name: 'Alpha', comments: [], edges: [], drawings: [], nodes: [
      notiz('n1', 0, 0, 'Erste', [haken('t1', 'Angebot schreiben'), haken('t2', 'Rechnung prüfen'), haken('t3', 'Termin machen')]),
      notiz('n2', 420, 0, 'Zweite'),
      notiz('n3', 0, 320, 'Dritte'),
      notiz('n4', 420, 320, 'Vierte'),
    ] },
    { id: 'b2', name: 'Beta', comments: [], edges: [], drawings: [], nodes: [notiz('m1', 0, 0, 'Beta-Karte')] },
    { id: 'b3', name: 'Gamma', comments: [], edges: [], drawings: [], nodes: [notiz('g1', 0, 0, 'Gamma-Karte')] },
    { id: 'b4', name: 'Delta', comments: [], edges: [], drawings: [], nodes: [notiz('d1', 0, 0, 'Delta-Karte')] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [
    { id: 'p1', name: 'Kunden', boardIds: ['b1', 'b2', 'b3'] },
    { id: 'p2', name: 'Intern', boardIds: ['b4'] },
  ] }],
  activeId: 'b1', view: 'board',
});
async function seite(navLinks = true) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st, navLinks }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand(), navLinks });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  return { ctx, P };
}
/** Was hat den Fokus? Klasse, Text, Bereich */
const fokus = (P) => P.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return { nichts: true, k: '', t: '' };
  const k = typeof a.className === 'string' ? a.className : a.className?.baseVal ?? '';
  return {
    k, t: (a.textContent ?? '').trim().slice(0, 40), id: a.dataset?.id ?? a.dataset?.board ?? a.dataset?.modul ?? '',
    baum: !!a.closest('.nav-tree'), kopf: !!a.closest('.tabs:not(.spalte), .top-actions'), flaeche: !!a.closest('.react-flow, .ov-graph'),
    unten: !!a.closest('.dock, .sel-toolbar'), menue: !!a.closest('.dock-menu, .ebenen-menu'), auf: a.getAttribute('aria-expanded'),
    label: a.getAttribute('aria-label') ?? '',
  };
});
const taste = async (P, t, n = 1) => { for (let i = 0; i < n; i += 1) { await P.keyboard.press(t); await P.waitForTimeout(110); } };
const zustand = async (P) => { await P.waitForTimeout(1300); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state); };
const gewaehlt = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id).sort());
const ansicht = (P) => P.evaluate(() => ({ ov: !!document.querySelector('.ov-graph-svg, .ov-canvas'), netz: !!document.querySelector('.ov-graph-svg'), tab: document.querySelector('.tab.active, .side-board.active .side-board-name')?.textContent?.trim() ?? '' }));

console.log('\n════ A: Navigationsbaum ════');
{
  const { ctx, P } = await seite(true);
  await taste(P, 'F6');
  let f = await fokus(P);
  pruefe('A1 F6 führt in den Baum, auf das aktive Board', f.baum && /side-board-name/.test(f.k) && f.t === 'Alpha', f);
  await taste(P, 'ArrowDown');
  f = await fokus(P);
  pruefe('A2 ↓ geht zur ersten Karte des Boards', /side-card/.test(f.k) && /Erste/.test(f.t), f);
  await taste(P, 'ArrowDown');
  const zweite = await fokus(P);
  await taste(P, 'ArrowLeft');
  f = await fokus(P);
  pruefe('A3 ← springt von der Karte zum Board', /Zweite/.test(zweite.t) && /side-board-name/.test(f.k) && f.t === 'Alpha', [zweite, f]);
  await taste(P, 'ArrowLeft');
  const zu = await P.evaluate(() => ({ karten: document.querySelectorAll('.nav-tree .side-card').length, f: document.activeElement.textContent.trim() }));
  await taste(P, 'ArrowRight');
  const auf = await P.evaluate(() => document.querySelectorAll('.nav-tree .side-card').length);
  pruefe('A4 ← klappt das Board zu, → wieder auf — der Fokus bleibt', zu.karten === 0 && zu.f === 'Alpha' && auf === 4, [zu, auf]);
  await taste(P, 'ArrowLeft'); await taste(P, 'ArrowDown');
  f = await fokus(P);
  await taste(P, 'Enter'); await P.waitForTimeout(500);
  const st = await zustand(P);
  pruefe('A5 ↓ zum nächsten Board, Enter öffnet es', f.t === 'Beta' && st.activeId === 'b2', [f, st.activeId]);
  await taste(P, 'F6', 4);   // einmal rundherum, zurück in den Baum
  await taste(P, 'End'); const ende = await fokus(P);
  await taste(P, 'Home'); const anfang = await fokus(P);
  pruefe('A6 Pos1 / Ende: erster und letzter Eintrag', ende.baum && anfang.baum && /side-tree-find/.test(anfang.k) && ende.t !== anfang.t, [anfang, ende]);
  await taste(P, 'ArrowDown');
  f = await fokus(P);
  await taste(P, 'ArrowLeft'); const pZu = await P.evaluate(() => document.querySelectorAll('.nav-tree .side-board').length);
  await taste(P, 'ArrowRight'); const pAuf = await P.evaluate(() => document.querySelectorAll('.nav-tree .side-board').length);
  pruefe('A7 Projekt: ← klappt zu, → klappt auf', /side-proj-name/.test(f.k) && pZu < pAuf, [f, pZu, pAuf]);
  await ctx.close();
}

console.log('\n════ B/C: Bereiche und Leisten ════');
{
  const { ctx, P } = await seite(true);
  const weg = [];
  for (let i = 0; i < 5; i += 1) { await taste(P, 'F6'); const f = await fokus(P); weg.push(f.baum ? 'baum' : f.kopf ? 'kopf' : f.flaeche ? 'flaeche' : f.unten ? 'unten' : '?'); }
  pruefe('B1 F6 geht Navigation → Kopfleiste → Fläche → Leiste unten → Navigation', weg.join(',') === 'baum,kopf,flaeche,unten,baum', weg.join(','));
  await taste(P, 'Shift+F6');
  let f = await fokus(P);
  pruefe('B2 Umschalt+F6 geht zurück', f.unten, f);
  const a = await fokus(P);
  await taste(P, 'ArrowRight'); const b = await fokus(P);
  await taste(P, 'ArrowRight'); const c = await fokus(P);
  await taste(P, 'ArrowLeft'); const d = await fokus(P);
  pruefe('C1 Dock: → geht zum nächsten Knopf, ← zurück', b.unten && c.unten && a.label !== b.label && b.label !== c.label && d.label === b.label, [a.label, b.label, c.label, d.label]);
  await taste(P, 'End'); const letzter = await fokus(P);
  await taste(P, 'Home'); const erster = await fokus(P);
  pruefe('C2 Pos1 / Ende in der Leiste', erster.label === a.label && letzter.label === 'Mehr', [erster.label, letzter.label]);

  console.log('\n════ D: Menüs ════');
  await taste(P, 'End'); await taste(P, 'Enter'); await P.waitForTimeout(250);
  const offen = await P.evaluate(() => !!document.querySelector('.dock-menu-more'));
  await taste(P, 'ArrowDown'); const m1 = await fokus(P);
  await taste(P, 'ArrowDown'); const m2 = await fokus(P);
  await taste(P, 'ArrowUp'); const m3 = await fokus(P);
  pruefe('D1 ↓ führt vom Knopf ins offene Menü, ↑ ↓ gehen weiter', offen && m1.menue && m2.menue && m1.t !== m2.t && m3.t === m1.t, [offen, m1.t, m2.t, m3.t]);
  await taste(P, 'End'); const mEnde = await fokus(P);
  await taste(P, 'ArrowDown'); const mRund = await fokus(P);
  pruefe('D2 Ende, dann ↓: läuft vorne weiter', mEnde.menue && mRund.menue && mEnde.t !== mRund.t, [mEnde.t, mRund.t]);
  await taste(P, 'Escape'); await P.waitForTimeout(200);
  // Modul-Palette: Raster
  await P.click('.dock button[aria-label="Objekt hinzufügen"]'); await P.waitForTimeout(350);
  await taste(P, 'ArrowDown'); const k1 = await fokus(P);
  await taste(P, 'ArrowRight'); const k2 = await fokus(P);
  await taste(P, 'ArrowDown'); const k3 = await fokus(P);
  await taste(P, 'ArrowLeft'); const k4 = await fokus(P);
  const lagen = await P.evaluate((ids) => ids.map((id) => { const r = document.querySelector(`.modul-kachel[data-modul="${id}"]`)?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.top)] : null; }), [k1.id, k2.id, k3.id, k4.id]);
  pruefe('D3 Palette: ↓ aus dem Suchfeld auf die erste Kachel, → daneben, ↓ darunter, ← zurück',
    /modul-kachel/.test(k1.k) && lagen.every(Boolean) && lagen[1][0] > lagen[0][0] && lagen[1][1] === lagen[0][1] && lagen[2][1] > lagen[1][1] && lagen[3][0] < lagen[2][0] && lagen[3][1] === lagen[2][1], [k1.id, k2.id, k3.id, k4.id, lagen]);
  const vorher = (await zustand(P)).boards[0].nodes.length;
  await taste(P, 'Enter'); await P.waitForTimeout(500);
  const nachher = (await zustand(P)).boards[0].nodes.length;
  pruefe('D4 Enter auf der Kachel legt das Modul an', nachher === vorher + 1, [vorher, nachher]);
  // Board-Menü im Baum
  await P.evaluate(() => { document.activeElement?.blur?.(); });
  const knopf = await P.$('.nav-tree .side-board.active .ebenen-menu-knopf');
  await knopf.focus(); await taste(P, 'Enter'); await P.waitForTimeout(250);
  await taste(P, 'ArrowDown'); const e1 = await fokus(P);
  await taste(P, 'ArrowDown'); const e2 = await fokus(P);
  pruefe('D5 Board-Menü im Baum: ↓ führt hinein und weiter', e1.menue && e2.menue && e1.t !== e2.t, [e1, e2]);
  await taste(P, 'Escape');
  await ctx.close();
}

console.log('\n════ E/F: Übersicht und Netz ════');
{
  const { ctx, P } = await seite(false);
  await taste(P, 'Alt+g'); await P.waitForTimeout(1500);
  let a = await ansicht(P);
  await taste(P, 'ArrowDown');
  let f = await fokus(P);
  pruefe('F1 Netz: der erste Pfeil setzt den Fokus auf „du bist hier"', a.netz && /ov-graph-node/.test(f.k) && /here/.test(f.k) && f.id === 'b1', [a, f]);
  const besucht = new Set([f.id]);
  for (const t of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) { await taste(P, t); besucht.add((await fokus(P)).id); }
  f = await fokus(P);
  pruefe('F2 Pfeile springen von Board zu Board', besucht.size >= 3 && /ov-graph-node/.test(f.k), [...besucht]);
  const ring = await P.evaluate(() => { const s = getComputedStyle(document.activeElement); return { o: s.outlineStyle, w: s.outlineWidth }; });
  pruefe('F3 das gewählte Board trägt einen sichtbaren Fokus-Rahmen', ring.o === 'solid' && parseFloat(ring.w) >= 2, ring);
  // gezielt auf ein anderes Board als das aktive, dann Enter
  let ziel = f.id;
  if (ziel === 'b1') { await taste(P, 'ArrowRight'); ziel = (await fokus(P)).id; if (ziel === 'b1') { await taste(P, 'ArrowLeft'); ziel = (await fokus(P)).id; } }
  await taste(P, 'Enter'); await P.waitForTimeout(700);
  let st = await zustand(P);
  pruefe('F4 Enter öffnet das Board', ziel !== 'b1' && st.activeId === ziel && st.view === 'board', [ziel, st.activeId, st.view]);

  // Kacheln
  await P.click('.tab-home'); await P.waitForTimeout(700);
  await P.evaluate(() => { [...document.querySelectorAll('.ov-mode button')].find((b) => b.textContent.trim() === 'Hierarchie')?.click(); });
  await P.waitForTimeout(1200);
  await P.evaluate(() => document.activeElement?.blur?.());
  await P.mouse.click(1380, 860); await P.waitForTimeout(200);
  await P.evaluate(() => document.activeElement?.blur?.());
  a = await ansicht(P);
  await taste(P, 'ArrowRight');
  f = await fokus(P);
  const hier = f.t;
  pruefe('E1 Kacheln: der erste Pfeil setzt den Fokus auf das aktive Board', a.ov && !a.netz && /react-flow__node-ovBoard/.test(f.k) && f.t.includes((st.boards.find((b) => b.id === st.activeId)).name), [a, f]);
  const lagenVor = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node-ovBoard')].map((n) => n.style.transform));
  const namen = new Set([f.t.slice(0, 5)]);
  for (const t of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowLeft']) { await taste(P, t); namen.add((await fokus(P)).t.slice(0, 5)); }
  const lagenNach = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node-ovBoard')].map((n) => n.style.transform));
  pruefe('E2 Pfeile springen von Kachel zu Kachel — keine Kachel wird dabei verschoben', namen.size >= 3 && JSON.stringify(lagenVor) === JSON.stringify(lagenNach), [...namen]);
  const rahmen = await P.evaluate(() => { const s = getComputedStyle(document.activeElement.querySelector('.ov-board')); return { o: s.outlineStyle, w: s.outlineWidth }; });
  pruefe('E3 die gewählte Kachel trägt einen sichtbaren Fokus-Rahmen', rahmen.o === 'solid' && parseFloat(rahmen.w) >= 2, rahmen);
  f = await fokus(P);
  const name = f.t;
  await taste(P, 'Enter'); await P.waitForTimeout(700);
  st = await zustand(P);
  const offenes = st.boards.find((b) => b.id === st.activeId).name;
  pruefe('E4 Enter öffnet das Board der Kachel', st.view === 'board' && name.startsWith(offenes), [name, offenes, st.view, hier]);
  await ctx.close();
}

console.log('\n════ G: Aufgaben-Zentrale ════');
{
  const { ctx, P } = await seite(false);
  await taste(P, 'Alt+t'); await P.waitForTimeout(700);
  await P.evaluate(() => document.activeElement?.blur?.());
  await taste(P, 'ArrowDown');
  let f = await fokus(P);
  pruefe('G1 ↓ setzt den Fokus in die Liste', /th-group-head|task-main/.test(f.k), f);
  if (/th-group-head/.test(f.k)) await taste(P, 'ArrowDown');
  f = await fokus(P);
  const erste = f.t;
  await taste(P, 'ArrowDown'); const zweite = (await fokus(P)).t;
  await taste(P, 'ArrowUp'); const wieder = (await fokus(P)).t;
  pruefe('G2 ↑ ↓ gehen von Aufgabe zu Aufgabe', /task-main/.test(f.k) && erste !== zweite && wieder === erste, [erste, zweite, wieder]);
  await taste(P, 'Enter'); const auf = await P.evaluate(() => ({ e: document.activeElement.getAttribute('aria-expanded'), w: !!document.activeElement.closest('.task-row').querySelector('.task-tools') }));
  await taste(P, 'ArrowLeft'); const zu = await P.evaluate(() => document.activeElement.getAttribute('aria-expanded'));
  await taste(P, 'ArrowRight'); const auf2 = await P.evaluate(() => document.activeElement.getAttribute('aria-expanded'));
  await taste(P, 'ArrowLeft');
  pruefe('G3 Enter und → klappen die Werkzeuge auf, ← zu', auf.e === 'true' && auf.w && zu === 'false' && auf2 === 'true', [auf, zu, auf2]);
  const ring = await P.evaluate(() => { const s = getComputedStyle(document.activeElement); return { o: s.outlineStyle, w: s.outlineWidth }; });
  pruefe('G4 die Zeile trägt einen sichtbaren Fokus-Rahmen', ring.o === 'solid' && parseFloat(ring.w) >= 2, ring);
  const zahl = () => P.evaluate(() => document.querySelectorAll('.taskhub-list ul:not(.th-done) .task-main').length);
  const v = await zahl();
  await taste(P, ' '); await P.waitForTimeout(500);
  const n = await zahl();
  f = await fokus(P);
  const st = await zustand(P);
  const erledigt = JSON.stringify(st.boards[0].nodes[0].data.blocks).match(/"checked":true/g)?.length ?? 0;
  pruefe('G5 Leertaste erledigt die Aufgabe, der Fokus geht zur nächsten', n === v - 1 && erledigt === 1 && /task-main/.test(f.k), [v, n, erledigt, f]);
  await taste(P, 'ArrowUp', 6);
  f = await fokus(P);
  pruefe('G6 ↑ über die erste Zeile hinaus führt in die Filterleiste', /th-chip/.test(f.k), f);
  await taste(P, 'ArrowRight'); const chip2 = await fokus(P);
  await taste(P, 'ArrowDown'); const zurueck = await fokus(P);
  pruefe('G7 Filter: → geht weiter, ↓ zurück in die Liste', /th-chip/.test(chip2.k) && chip2.t !== f.t && /th-group-head|task-main/.test(zurueck.k), [chip2, zurueck]);
  if (/th-group-head/.test(zurueck.k)) await taste(P, 'ArrowDown');
  await taste(P, 'Control+Enter'); await P.waitForTimeout(900);
  const nach = await P.evaluate(() => ({ hub: !!document.querySelector('.taskhub'), fokusKarte: !!document.querySelector('.app.focus-mode'), gew: [...document.querySelectorAll('.react-flow__node.selected')].map((x) => x.dataset.id) }));
  pruefe('G8 Strg+Enter springt zur Karte der Aufgabe', !nach.hub && (nach.fokusKarte || nach.gew.includes('n1')), nach);
  await ctx.close();
}

console.log('\n════ H/I/J: Board, Präsentation, Texte ════');
{
  const { ctx, P } = await seite(false);
  await P.mouse.click(1380, 860); await P.waitForTimeout(200);
  await P.keyboard.press('f'); await P.waitForTimeout(700);
  await taste(P, 'End'); const letzte = await gewaehlt(P);
  await taste(P, 'Home'); const erste = await gewaehlt(P);
  pruefe('H1 Pos1 / Ende wählen die erste und letzte Karte', erste.join() === 'n1' && letzte.join() === 'n4', [erste, letzte]);
  await taste(P, 'Control+Shift+ArrowRight'); const zwei = await gewaehlt(P);
  await taste(P, 'Control+Shift+ArrowDown'); const drei = await gewaehlt(P);
  pruefe('H2 Strg+Umschalt+Pfeil erweitert die Auswahl', zwei.join() === 'n1,n2' && drei.join() === 'n1,n2,n4', [zwei, drei]);
  await taste(P, 'Control+ArrowLeft'); const eins = await gewaehlt(P);
  pruefe('H3 Strg+Pfeil ohne Umschalt wählt wieder genau eine', eins.length === 1, eins);
  await P.mouse.click(1380, 860); await P.waitForTimeout(200);
  await taste(P, 'Alt+p'); await P.waitForTimeout(900);
  const zaehler = () => P.evaluate(() => document.querySelector('.presenter-count')?.textContent?.trim() ?? '');
  const z0 = await zaehler();
  await taste(P, 'End'); const z1 = await zaehler();
  await taste(P, 'Home'); const z2 = await zaehler();
  const gesamt = z0.split('/')[1]?.trim();
  pruefe('I1 Präsentation: Ende zeigt die letzte Folie, Pos1 die erste', !!gesamt && Number(gesamt) > 1 && z1 === `${gesamt} / ${gesamt}` && z2 === `1 / ${gesamt}`, [z0, z1, z2]);
  await taste(P, 'Escape'); await P.waitForTimeout(500);
  await taste(P, 'Alt+h'); await P.waitForTimeout(700);
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('J1 Hilfe nennt F6, die Pfeiltasten und den Eintrag M345', js.includes('(M345)') && js.includes('in Menüs, Leisten und Listen weitergehen') && js.includes('zum nächsten Bereich: Navigation'));
  const nav = await P.$$('.help-nav button');
  if (nav.length > 1) {
    await nav[0].focus(); await taste(P, 'ArrowDown');
    const f = await fokus(P);
    const zweiter = await P.evaluate(() => document.querySelectorAll('.help-nav button')[1].textContent.trim().slice(0, 40));
    pruefe('J2 Hilfe-Navigation: ↓ geht zum nächsten Abschnitt', f.t === zweiter, [f.t, zweiter]);
  } else pruefe('J2 Hilfe-Navigation vorhanden', false, nav.length);
  await ctx.close();
}

await browser.close(); app.close();
console.log(`\nm345-pfeiltasten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
