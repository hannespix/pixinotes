/**
 * M273 — „gantt bitte in miro abschauen wie das umgesetzt ist und das UI
 * entsprechend an professionellen bestehenden tools orientieren!"
 *
 * Geprüft werden die Muster, die professionelle Werkzeuge auszeichnen:
 *  · Kopfzeile klebt beim senkrechten Scrollen (Monate bleiben lesbar)
 *  · Namen stehen AM Balken, nicht nur in der Spalte
 *  · Zeilen-Bänder, Auswahl per Klick auf die Zeile
 *  · Datums-Fahne während des Ziehens
 *  · Doppelklick auf freie Fläche legt den Vorgang am Wunschtag an
 *  · Fortschritt als Füllung, sichtbare Griffe am ausgewählten Balken
 *  · Heute-Fahne
 */
// Läuft aus dem Repository: `node pruefungen/m273-gantt-ui.mjs`
// Voraussetzung: `npm run build` (die Reihe prüft den dist/-Stand) und ein
// Chromium — Pfad über die Umgebungsvariable PW_CHROMIUM, sonst der
// Standardpfad der Claude-Umgebung.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4494;
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

const heute = new Date();
const iso = (t) => {
  const d = new Date(heute.getTime() + t * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 14 Vorgänge, damit senkrecht gescrollt werden muss
const ROWS = Array.from({ length: 14 }, (_, i) => ({
  id: `r${i}`, name: i === 0 ? 'Kickoff Workshop' : `Vorgang ${i + 1}`,
  start: iso(i * 3 - 6), end: iso(i * 3 - 2),
  color: '#4f7cff', progress: i === 0 ? 50 : 0, who: i === 0 ? 'Anna Muster' : undefined,
}));

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addInitScript((rows) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  const nodes = [{ id: 'g1', type: 'gantt', position: { x: 40, y: 40 }, width: 980, height: 400,
    data: { title: 'Projektplan', rows, dayWidth: 24 } }];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
}, ROWS);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);

// ══ T1: Klebende Kopfzeile ═══════════════════════════════════════════
console.log('════ T1: Die Kopfzeile klebt ════');
{
  const vor = await P.evaluate(() => ({
    kopf: !!document.querySelector('.gantt-kopf'),
    grund: !!document.querySelector('.gantt-kopfgrund'),
    transform: document.querySelector('.gantt-kopf')?.getAttribute('transform'),
    spaltenkopf: document.querySelector('.gantt-labels-kopf')?.textContent.trim(),
  }));
  console.log('   ', JSON.stringify(vor));
  pruefe('T1a die Kopf-Gruppe mit Grundfläche existiert', vor.kopf && vor.grund);
  pruefe('T1b vor dem Scrollen steht sie bei 0', vor.transform === 'translate(0, 0)', vor.transform);
  pruefe('T1c die Namensspalte hat eine Kopfzelle „Vorgang"', vor.spaltenkopf === 'Vorgang', vor.spaltenkopf);

  await P.evaluate(() => { document.querySelector('.gantt-scroll').scrollTop = 120; });
  await P.waitForTimeout(500);
  const nach = await P.evaluate(() => ({
    // Der Container klemmt den Wert — verglichen wird mit dem ECHTEN Stand
    scrollTop: document.querySelector('.gantt-scroll').scrollTop,
    transform: document.querySelector('.gantt-kopf')?.getAttribute('transform'),
    // Steht die Kopfzeile optisch oben im Fenster? Monat-Text messen:
    monatOben: (() => {
      const scroll = document.querySelector('.gantt-scroll').getBoundingClientRect();
      const monat = document.querySelector('.gantt-kopf .gantt-month')?.getBoundingClientRect();
      return monat ? Math.round(monat.top - scroll.top) : null;
    })(),
  }));
  console.log('    nach Scroll 120:', JSON.stringify(nach));
  pruefe('T1d nach dem Scrollen fährt die Gruppe exakt mit', nach.scrollTop > 0 && nach.transform === `translate(0, ${nach.scrollTop})`, `${nach.transform} bei scrollTop ${nach.scrollTop}`);
  pruefe('T1e der Monatsname bleibt oben im Fenster sichtbar',
    nach.monatOben !== null && nach.monatOben >= 0 && nach.monatOben < 30, String(nach.monatOben));
  await P.evaluate(() => { document.querySelector('.gantt-scroll').scrollTop = 0; });
  await P.waitForTimeout(400);
}

// ══ T2: Namen am Balken, Fortschritt, Heute-Fahne ════════════════════
console.log('\n════ T2: Balken-Beschriftung & Co. ════');
{
  const info = await P.evaluate(() => {
    const labels = [...document.querySelectorAll('.gantt-barlabel')].map((t) => t.textContent);
    const innen = [...document.querySelectorAll('.gantt-barlabel.innen')].map((t) => t.textContent);
    const heutePille = [...document.querySelectorAll('.gantt-kopf text')].some((t) => t.textContent === 'Heute');
    // Fortschritt: Overlay in Balkenhöhe (15) statt 4-Punkte-Strich
    const overlays = [...document.querySelectorAll('.gantt-bar rect')].filter((r) =>
      r.getAttribute('fill')?.includes('rgba(0,0,0,.26)'));
    return { anzahl: labels.length, innen, heutePille,
      overlayHoehe: overlays[0] ? Number(overlays[0].getAttribute('height')) : null };
  });
  console.log('   ', JSON.stringify(info));
  pruefe('T2a jeder Vorgang trägt seinen Namen am Balken', info.anzahl >= 14, String(info.anzahl));
  pruefe('T2b Namen stehen im Balken, wenn sie hineinpassen — sonst daneben',
    info.innen.length >= 10 && info.anzahl > info.innen.length, `${info.innen.length} innen von ${info.anzahl}`);
  pruefe('T2c die Heute-Fahne ist da', info.heutePille);
  pruefe('T2d der Fortschritt füllt die volle Balkenhöhe', info.overlayHoehe === 15, String(info.overlayHoehe));
}

// ══ T3: Zeilen-Bänder + Auswahl per Zeilenklick ══════════════════════
console.log('\n════ T3: Zeilen-Bänder ════');
{
  const baender = await P.evaluate(() => document.querySelectorAll('.gantt-zeile').length);
  pruefe('T3a jede Zeile hat ihr Band', baender === 14, String(baender));
  // Klick auf ein Band (freie Fläche in Zeile 5) wählt den Vorgang aus
  await P.evaluate(() => {
    document.querySelectorAll('.gantt-zeile')[4].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await P.waitForTimeout(500);
  const sel = await P.evaluate(() => ({
    band: !!document.querySelector('.gantt-zeile.sel'),
    leiste: !!document.querySelector('.gantt-rowbar'),
    name: document.querySelector('.gantt-rowbar-name')?.textContent,
  }));
  console.log('   ', JSON.stringify(sel));
  pruefe('T3b Klick auf die Zeile wählt den Vorgang aus', sel.band && sel.leiste && sel.name === 'Vorgang 5', JSON.stringify(sel));
  const griffe = await P.evaluate(() => {
    // sichtbare weiße Griffleisten am ausgewählten Balken
    return [...document.querySelectorAll('.gantt-bar rect')].filter((r) =>
      r.getAttribute('fill') === '#fff' && Number(r.getAttribute('width')) === 3).length;
  });
  pruefe('T3c der ausgewählte Balken zeigt seine Zieh-Griffe', griffe === 2, String(griffe));
}

// ══ T4: Datums-Fahne beim Ziehen ═════════════════════════════════════
console.log('\n════ T4: Ziehen mit Datums-Fahne ════');
{
  const bar = await P.evaluate(() => {
    const r = [...document.querySelectorAll('.gantt-bar rect[data-row]')].find((x) => x.getAttribute('data-row') === 'r2');
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, start: r.getAttribute('data-start') };
  });
  await P.mouse.move(bar.x, bar.y);
  await P.mouse.down();
  await P.mouse.move(bar.x + 40, bar.y);
  await P.waitForTimeout(300);
  const fahne = await P.evaluate(() => document.querySelector('.gantt-dragtip')?.textContent ?? null);
  console.log('    Fahne beim Ziehen:', JSON.stringify(fahne));
  pruefe('T4a während des Ziehens zeigt eine Fahne die Daten', !!fahne && / – /.test(fahne) && /Tg\./.test(fahne), String(fahne));
  await P.mouse.up();
  await P.waitForTimeout(400);
  pruefe('T4b nach dem Loslassen verschwindet sie',
    await P.evaluate(() => !document.querySelector('.gantt-dragtip')));
  const nach = await P.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pixinotes-board')).state;
    return s.boards[0].nodes[0].data.rows.find((r) => r.id === 'r2').start;
  });
  pruefe('T4c der Vorgang wurde wirklich verschoben', nach !== bar.start, `${bar.start} → ${nach}`);
}

// ══ T5: Doppelklick legt einen Vorgang am Wunschtag an ═══════════════
console.log('\n════ T5: Doppelklick auf freie Fläche ════');
{
  const vorher = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.rows.length);
  // freie Fläche: Zeile 1 (dort liegt der Kickoff-Balken links), weit rechts
  await P.evaluate(() => {
    const svg = document.querySelector('.gantt-svg');
    const zeile = document.querySelectorAll('.gantt-zeile')[0];
    const b = zeile.getBoundingClientRect();
    const ev = new MouseEvent('dblclick', { bubbles: true, clientX: b.right - 60, clientY: b.top + b.height / 2 });
    zeile.dispatchEvent(ev);
    void svg;
  });
  await P.waitForTimeout(600);
  const nachher = await P.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.rows;
    return { anzahl: rows.length, letzter: rows[rows.length - 1] };
  });
  console.log('   ', JSON.stringify(nachher.letzter));
  pruefe('T5a der Doppelklick legt einen neuen Vorgang an', nachher.anzahl === vorher + 1, `${vorher} → ${nachher.anzahl}`);
  pruefe('T5b er beginnt am angeklickten Tag (nicht heute)',
    nachher.letzter.start > iso(20), `${nachher.letzter.start} (Klick lag weit rechts)`);
}

// ══ T6: ＋-Zeile in der Namensspalte ═════════════════════════════════
console.log('\n════ T6: ＋ Vorgang in der Spalte ════');
{
  const vorher = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.rows.length);
  await P.evaluate(() => document.querySelector('.gantt-addzeile')?.click());
  await P.waitForTimeout(500);
  const nachher = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.rows.length);
  pruefe('T6a „＋ Vorgang" unten in der Spalte legt eine Zeile an', nachher === vorher + 1, `${vorher} → ${nachher}`);
}

await P.screenshot({ path: `${SD}/m273-gantt.png` });
console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
