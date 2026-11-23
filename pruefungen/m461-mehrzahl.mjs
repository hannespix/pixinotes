/**
 * M461 — Einzahl und Mehrzahl stimmen, auf Deutsch und auf Englisch.
 *
 * Gemeldet (M455): In der Hierarchie-Ansicht der Übersicht stand in englischer Oberfläche „1 cards" — der
 * Quelltext schrieb `${n} Karten`, auf Deutsch also „1 Karten". Jetzt laufen Zähl-Texte über zahlWort()
 * (lib/sprache.ts, Intl.PluralRules in der Sprache der Oberfläche).
 *
 *   A  Der Helfer selbst: 0/1/2/5 auf Deutsch und Englisch, gleiche Formen („Rahmen"), Tausender.
 *   B  Sichtbare Stellen mit 1 und 2, je Sprache: Übersicht (Hierarchie, Board-Kachel), Suche (Board-Treffer),
 *      Aufgaben-Zentrale (Kopfzeile), Kanban-Spaltenzähler (Beschriftung), Ideen-Blasen (Zähler).
 *   C  Englisch ohne Lücken: kein Zähl-Text blieb deutsch.
 *
 * Läuft aus dem Repository: node pruefungen/m461-mehrzahl.mjs   (PN_DIST=… für einen anderen Bau)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5461;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, decodeURIComponent(q.url.split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.setHeader('content-type', TYP[path.extname(f)] ?? 'application/octet-stream');
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

// ---------- Vorrat: n Karten auf „Zaehlbrett", davon ein Kanban mit n offenen Tickets; ein Ideen-Board mit n Ideen ----------
const heute = new Date().toISOString().slice(0, 10);
const stand = (n, view, mode = 'hierarchie') => {
  const kanbans = Array.from({ length: n }, (_, i) => ({
    id: `k${i + 1}`, type: 'kanban', width: 520, position: { x: i * 600, y: 0 },
    data: { title: `Liste ${i + 1}`, cols: ['Offen', 'Erledigt'], items: i === 0 ? Array.from({ length: n }, (_, j) => ({ id: `t${j + 1}`, text: `Aufgabe ${j + 1}`, col: 0, due: heute })) : [] },
  }));
  const ideen = Object.fromEntries(Array.from({ length: n }, (_, j) => [`i${j + 1}`, { text: `Einfall ${j + 1}`, von: 'k:x', t: 1 }]));
  const boards = [
    { id: 'zb', name: 'Zaehlbrett', nodes: kanbans, edges: [] },
    { id: 'ib', name: 'Blasenbrett', nodes: [{ id: 'b1', type: 'bubbles', width: 680, height: 540, position: { x: 0, y: 0 }, data: { title: 'Ideen', frage: '', ideen, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } }], edges: [] },
  ];
  return { boards, activeId: 'zb', view, overviewMode: mode, spaces: [{ id: 's1', name: 'Bereich', projects: [{ id: 'p1', name: 'Projekt', boardIds: boards.map((b) => b.id) }] }] };
};

async function seite(n, sprache, view = 'board', aktiv = 'zb') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const st = { ...stand(n, view), activeId: aktiv };
  await ctx.addInitScript(({ st, sprache }) => {
    if (sessionStorage.getItem('pn-test-bereit')) return;
    sessionStorage.setItem('pn-test-bereit', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-sprache', sprache);
  }, { st, sprache });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1400);
  return { ctx, P };
}
const text = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);
const luecken = (P) => P.evaluate(() => window.__pnSprachLuecken?.() ?? []);

// ══ A: Helfer ═══════════════════════════════════════════════════════
console.log('\n════ A: zahlWort direkt ════');
for (const sprache of ['de', 'en']) {
  const { ctx, P } = await seite(1, sprache);
  const r = await P.evaluate(() => {
    const z = window.__pnZahlWort;
    return z ? [0, 1, 2, 5].map((n) => z(n, 'Karte', 'Karten')).concat([z(1, 'Rahmen', 'Rahmen'), z(2, 'Rahmen', 'Rahmen'), z(1234, 'Aufgabe', 'Aufgaben'), z(1, 'Board', 'Boards')]) : null;
  });
  const soll = sprache === 'de'
    ? ['0 Karten', '1 Karte', '2 Karten', '5 Karten', '1 Rahmen', '2 Rahmen', '1.234 Aufgaben', '1 Board']
    : ['0 cards', '1 card', '2 cards', '5 cards', '1 frame', '2 frames', '1,234 tasks', '1 board'];
  pruefe(`A ${sprache}: 0/1/2/5, gleiche Formen, Tausender`, JSON.stringify(r) === JSON.stringify(soll), JSON.stringify(r));
  if (sprache === 'en') pruefe('A en: der Helfer hinterlässt keine Lücke', !(await luecken(P)).some((l) => /\{n\}/.test(l)), JSON.stringify(await luecken(P)));
  await ctx.close();
}

// ══ B: sichtbare Stellen ════════════════════════════════════════════
const W = {
  de: { karte: ['1 Karte', '2 Karten'], aufgabe: ['1 Aufgabe angezeigt', '2 Aufgaben angezeigt'], ticket: ['1 Ticket', '2 Tickets'], idee: ['1 Idee', '2 Ideen'], suche: ['1 Karte · Board öffnen', '2 Karten · Board öffnen'] },
  en: { karte: ['1 card', '2 cards'], aufgabe: ['1 task shown', '2 tasks shown'], ticket: ['1 ticket', '2 tickets'], idee: ['1 idea', '2 ideas'], suche: ['1 card · open board', '2 cards · open board'] },
};
const alleLuecken = new Set();
for (const sprache of ['de', 'en']) {
  console.log(`\n════ B: sichtbare Stellen (${sprache}) ════`);
  for (const n of [1, 2]) {
    const w = (k) => W[sprache][k][n - 1];
    const falsch = (k) => W[sprache][k][2 - n];   // die jeweils andere Form
    // B1 Übersicht, Hierarchie: Kachel des Boards
    {
      const { ctx, P } = await seite(n, sprache, 'overview');
      const meta = await P.evaluate(() => [...document.querySelectorAll('.ov-board-meta')].map((e) => ({ t: e.textContent.trim(), board: e.parentElement?.querySelector('.ov-board-name')?.textContent ?? '' })));
      const zb = meta.find((m) => /Zaehlbrett/.test(m.board))?.t ?? '';
      pruefe(`B1 ${sprache} n=${n}: Übersicht (Hierarchie) zeigt „${w('karte')}"`, zb.startsWith(w('karte')) && !zb.startsWith(falsch('karte') + ' ') && !/\b1 (Karten|cards)\b/.test(zb), JSON.stringify(meta));
      for (const l of await luecken(P)) alleLuecken.add(l);
      await ctx.close();
    }
    // B2–B4 auf dem Board: Kanban-Spaltenzähler, Suche, Aufgaben-Zentrale
    {
      const { ctx, P } = await seite(n, sprache);
      const titel = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="k1"] .kanban-count')?.getAttribute('title') ?? '');
      pruefe(`B2 ${sprache} n=${n}: Kanban-Spaltenzähler „${w('ticket')}"`, titel.startsWith(w('ticket') + ' ') && !/Ticket\(s\)|ticket\(s\)/.test(titel), titel);
      await P.keyboard.press('Control+k');
      await P.waitForTimeout(400);
      await P.keyboard.type('Zaehlbrett');
      await P.waitForTimeout(600);
      const treffer = await text(P, '.hit-snippet');
      pruefe(`B3 ${sprache} n=${n}: Suche nennt „${w('suche')}"`, treffer.includes(w('suche')), JSON.stringify(treffer));
      await P.keyboard.press('Escape');
      await P.waitForTimeout(300);
      await P.keyboard.press('Alt+t');
      await P.waitForTimeout(1200);
      const kopf = (await text(P, '.taskhub-meta'))[0] ?? '';
      pruefe(`B4 ${sprache} n=${n}: Aufgaben-Zentrale „${w('aufgabe')}"`, kopf.startsWith(w('aufgabe')), kopf);
      for (const l of await luecken(P)) alleLuecken.add(l);
      await ctx.close();
    }
    // B5 Ideen-Blasen
    {
      const { ctx, P } = await seite(n, sprache, 'board', 'ib');
      const zahl = (await text(P, '[data-taste="bub-zahl"]'))[0] ?? '';
      pruefe(`B5 ${sprache} n=${n}: Ideen-Blasen „${w('idee')}"`, zahl.startsWith(w('idee')) && !zahl.startsWith(falsch('idee')), zahl);
      for (const l of await luecken(P)) alleLuecken.add(l);
      await ctx.close();
    }
  }
}

// ══ C: keine Lücken in den Zähl-Texten ══════════════════════════════
console.log('\n════ C: Englisch ohne Lücken ════');
const zaehl = [...alleLuecken].filter((l) => /\d/.test(l) && /(Karte|Aufgabe|Ticket|Idee|Board|\{n\})/.test(l));
pruefe('C1 kein Zähl-Text blieb deutsch', zaehl.length === 0, JSON.stringify(zaehl));
const quelle = ['src/lib/boardStats.ts', 'src/components/Overview.tsx', 'src/components/SearchOverlay.tsx'].map((f) => readFileSync(path.join(__repo, f), 'utf-8')).join('\n');
pruefe('C2 im Quelltext der geprüften Stellen kein `${n} Karten` mehr', !/\$\{[^}]{1,60}\} Karten\b/.test(quelle));

console.log(`\n  m461-mehrzahl: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
