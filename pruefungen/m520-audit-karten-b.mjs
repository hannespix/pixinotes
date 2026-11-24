/**
 * M520 — Bugfixing-Audit, Karten B: Kanban, Zeitplan, Rechen-Tabelle, Kalender, Wochenplan, Zeiterfassung,
 * Protokoll, Ideabubbles (Mitmachen per QR). Was das Audit gefunden hat, bleibt behoben.
 *
 *   A  Rechnen (ohne Browser): Textvergleich in Formeln ohne Rücksicht auf Groß/Klein; Stichproben von Hand.
 *   B  Zeiterfassung: Kalenderwoche in Jahren, die an einem Freitag beginnen (2027: KW 1 statt KW 2); Hinweise
 *      der Ansichts-Knöpfe.
 *   C  Zeitplan: Tage, Wochenenden und Monate stehen auch westlich von Greenwich unter den Balken; Ziehen zurück
 *      an den Ausgangspunkt; Fortschritt 30 % steht im Feld; dunkelste Palettenfarbe im Dunkeln sichtbar.
 *   D  Rechen-Tabelle: Zelle öffnen und verlassen legt keinen Rückgängig-Schritt an; die 27. Spalte meldet sich.
 *   E  Kalender: Ansicht wechseln bleibt beim gezeigten Zeitraum.
 *   F  Wochenplan: Ein Block vor Raster-Beginn ragt nicht über das Raster hinaus.
 *   G  Protokoll: Ein geleertes Datumsfeld lässt die Sitzung, wie sie ist.
 *   H  Kanban: Spalte löschen meldet sich und lässt sich im Hinweis zurücknehmen.
 *   I  Ideabubbles: Die Kopie einer Karte mit laufender Mitmach-Runde hat keine Runde; Abstimm-Zeile der
 *      Teilnehmer-Seite (Raster: Text links, − Zahl ＋ rechts) — das Verhalten am Telefon prüft m513 F5.
 *   J  Board nur zum Lesen: Kalender blättern, Sitzung wechseln, Ansicht der Zeiterfassung, Skala des Zeitplans,
 *      Tabelle sortieren gehen (lokal) — der Inhalt bleibt geschützt, im Speicher ändert sich nichts.
 *   K  Englisch: Punkte im Ergebnis der Ideabubbles; Meilenstein-Datei.
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m520`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage', 'm520');
mkdirSync(BILDER, { recursive: true });
const PORT = 5520;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
async function warteBis(fn, ms = 12000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { try { if (await fn()) return true; } catch { /* weiter */ } await new Promise((x) => setTimeout(x, 150)); }
  try { return !!(await fn()); } catch { return false; }
}

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Rechnen ════');
{
  const einstieg = path.join(BILDER, 'm520-einstieg.ts');
  writeFileSync(einstieg, `export { rechneBlatt, zeigeWert } from ${JSON.stringify(path.join(__repo, 'src', 'lib', 'formel'))};\n`);
  const aus = path.join(BILDER, 'm520-buendel.mjs');
  await build({ entryPoints: [einstieg], bundle: true, format: 'esm', platform: 'node', outfile: aus, logLevel: 'silent' });
  const m = await import(pathToFileURL(aus).href);
  const r = (zellen) => { const w = m.rechneBlatt(zellen); return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, m.zeigeWert(v)])); };
  const a = r({ A1: 'Offen', A2: 'erledigt', B1: '=WENN(A1="offen";1;0)', B2: '=A2="ERLEDIGT"', B3: '="ja"<>"Ja"', B4: '="b">"A"', B5: '=A1="Offen "' });
  pruefe('A1 Text vergleicht ohne Rücksicht auf Groß/Klein (wie Excel): =WENN(A1="offen";…) findet „Offen"', a.B1 === '1' && a.B2 === 'WAHR' && a.B3 === 'FALSCH' && a.B4 === 'WAHR' && a.B5 === 'FALSCH', a);
  // Stichproben, von Hand nachgerechnet
  const b = r({ A1: '1.234,50', A2: '89,90', A3: '=SUMME(A1:A2)', A4: '=A3*19%', A5: '=RUNDEN(A3*1,19;2)', A6: '=MITTELWERT(A1:A2)', B1: '=A1/0', B2: '=B3', B3: '=B2', B4: '=WENN(A2>100;"viel";"wenig")', B5: '=10-2-3', B6: '=2^3^2', C1: '10', C2: '=C1=10' });
  pruefe('A2 Stichproben: Summe 1.324,4 · 19 % = 251,636 · brutto 1.576,04 · Mittelwert 662,2 · #DIV/0! · #ZYKLUS! · 10−2−3 = 5 · 2^3^2 = 64',
    b.A3 === '1.324,4' && b.A4 === '251,636' && b.A5 === '1.576,04' && b.A6 === '662,2' && b.B1 === '#DIV/0!' && b.B2 === '#ZYKLUS!' && b.B4 === 'wenig' && b.B5 === '5' && b.B6 === '64' && b.C2 === 'WAHR', b);
}

// ══ Browser ═════════════════════════════════════════════════════════
const app = http.createServer((q, r) => {
  const p = q.url.split('?')[0].split('#')[0];
  let f = path.join(DIST, p === '/' ? 'index.html' : p.slice(1));
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const brett = (id, name, nodes, extra = {}) => ({ id, name, nodes, edges: [], drawings: [], comments: [], ...extra });
const standMit = (boards, extra = {}) => ({ boards, spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: boards.map((b) => b.id) }] }], activeId: boards[0].id, view: 'board', ...extra });
/** Neues Profil mit vorgegebenem Stand; opt.zeit = feste Uhr (nur wo die Zeit selbst geprüft wird) */
const profil = async (st, opt = {}) => {
  const ctx = await browser.newContext({ viewport: opt.vp ?? { width: 1500, height: 950 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: opt.tz ?? 'Europe/Berlin' });
  await ctx.addInitScript(({ st, ls }) => {
    if (localStorage.getItem('pixinotes-board') || sessionStorage.getItem('x-init')) return;
    sessionStorage.setItem('x-init', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st, ls: opt.ls ?? {} });
  const P = await ctx.newPage();
  if (opt.zeit) await P.clock.setFixedTime(new Date(opt.zeit));
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message.slice(0, 300)); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 20000 });
  /** Der gespeicherte Stand — erst lesen, wenn er eine Weile gleich bleibt (der Speicher schreibt verzögert) */
  const zustand = async () => {
    let vor = null;
    for (let i = 0; i < 40; i += 1) {
      await P.waitForTimeout(350);
      const jetzt = await P.evaluate(() => localStorage.getItem('pixinotes-board'));
      if (jetzt === vor) break;
      vor = jetzt;
    }
    return JSON.parse(vor ?? 'null')?.state ?? null;
  };
  const karte = async (id) => { const s = await zustand(); return s.boards.find((b) => b.id === s.activeId).nodes.find((n) => n.id === id); };
  const knoten = (id) => P.locator(`.react-flow__node[data-id="${id}"]`);
  const waehlen = async (id, x = 40, y = 12) => { await knoten(id).click({ position: { x, y } }); await P.waitForSelector(`.react-flow__node[data-id="${id}"].selected`); };
  const frei = async () => { await P.keyboard.press('Escape'); await P.mouse.click(1470, 520); await P.waitForFunction(() => !document.querySelector('.react-flow__node.selected')).catch(() => {}); };
  /** Kurze Hinweise mitschreiben (statt hinterher abfragen) */
  await P.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => { const t = document.querySelector('.toast.show')?.textContent; if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const toasts = () => P.evaluate(() => window.__toasts);
  return { ctx, P, zustand, karte, knoten, waehlen, frei, toasts };
};
const undoAn = (P) => P.evaluate(() => !document.querySelector('[data-taste="rueckgaengig"]').disabled);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Zeiterfassung ════');
{
  const zeit = { id: 'ti', type: 'time', width: 520, height: 420, position: { x: 80, y: 80 }, data: { title: 'Zeiterfassung', view: 'woche', segs: [{ id: 's1', date: '2027-01-05', start: 480, end: 720, kind: 'arbeit' }] } };
  const kw = async (tag) => {
    const h = await profil(standMit([brett('b1', 'Zeit', [zeit])]), { zeit: `${tag}T10:00:00+01:00` });
    const text = await h.knoten('ti').locator('.time-nav b').first().innerText();
    const titel = await h.knoten('ti').locator('.time-views button').evaluateAll((bs) => bs.map((b) => b.title || b.getAttribute('aria-label') || ''));
    await h.ctx.close();
    return { text, titel };
  };
  const a = await kw('2027-01-06'); const b = await kw('2026-12-31'); const c = await kw('2027-12-29'); const d = await kw('2028-01-05'); const e = await kw('2027-06-16');
  // 2027 beginnt an einem Freitag: 4.–10. Januar ist KW 1 (vorher: KW 2 — und so das ganze Jahr um eins zu hoch)
  pruefe('B1 Woche vom 4. Januar 2027 ist KW 1 (das Jahr beginnt an einem Freitag)', /^KW 1 ·/.test(a.text) && /04\.01\./.test(a.text), a.text);
  pruefe('B2 Jahreswechsel: 31.12.2026 liegt in KW 53, 29.12.2027 in KW 52, 5.1.2028 in KW 1, 16.6.2027 in KW 24', /^KW 53 ·/.test(b.text) && /^KW 52 ·/.test(c.text) && /^KW 1 ·/.test(d.text) && /^KW 24 ·/.test(e.text), [b.text, c.text, d.text, e.text]);
  pruefe('B3 Hinweise der Ansichts-Knöpfe sind Wörter (nicht „Wochees-Ansicht")', JSON.stringify(a.titel) === JSON.stringify(['Tagesansicht', 'Wochenansicht', 'Monatsansicht', 'Jahresansicht']), a.titel);
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Zeitplan ════');
const gantt = (extra = {}) => ({ id: 'ga', type: 'gantt', width: 760, height: 300, position: { x: 80, y: 80 }, data: { title: 'Zeitplan', dayWidth: 24, rows: [
  { id: 'r1', name: 'Phase 1', start: '2026-11-24', end: '2026-11-30', color: '#4f7cff', progress: 30 },
  { id: 'r2', name: 'Phase 2', start: '2026-12-01', end: '2026-12-07', color: '#3fa564', dep: 'r1' },
  { id: 'r6', name: 'Farbe sechs', start: '2026-11-25', end: '2026-12-02', color: '#2b2a27' },
], ...extra } });
{
  // Honolulu (UTC−10) und New York (UTC−5): Der 24.11. ist ein Dienstag, der 28./29. das Wochenende, der 1.12. Monatsanfang
  for (const tz of ['America/New_York', 'Pacific/Honolulu', 'Europe/Berlin', 'Pacific/Auckland']) {
    const h = await profil(standMit([brett('b1', 'Plan', [gantt()])]), { tz, zeit: '2026-11-24T20:00:00Z' });
    const info = await h.P.evaluate(() => {
      const svg = document.querySelector('.gantt-svg');
      const balken = svg.querySelector('rect[data-row="r1"]'); const b2 = svg.querySelector('rect[data-row="r2"]');
      const x0 = Number(balken.getAttribute('x')); const x2 = Number(b2.getAttribute('x'));
      const tage = [...svg.querySelectorAll('.gantt-kopf text.gantt-day')].map((t) => [Number(t.getAttribute('x')), t.textContent]);
      const ueber = (x) => tage.find(([tx]) => tx > x && tx < x + 24)?.[1] ?? null;
      const wochenende = [...svg.querySelectorAll('rect[fill="rgba(0,0,0,.045)"]')].map((r) => Number(r.getAttribute('x')));
      const dez = [...svg.querySelectorAll('.gantt-kopf g > line')].map((l) => Number(l.getAttribute('x1')));
      // Spalte des 28.11. (Samstag) = Balkenanfang (24.) + 4 Tage
      return { ueberStart2: ueber(x2 - 1), sa: wochenende.some((x) => Math.abs(x - (x0 - 1 + 4 * 24)) < 1), so: wochenende.some((x) => Math.abs(x - (x0 - 1 + 5 * 24)) < 1), di: wochenende.some((x) => Math.abs(x - (x0 - 1)) < 1), monatAm1: dez.some((x) => Math.abs(x - (x2 - 1)) < 1) };
    });
    pruefe(`C1 ${tz}: über dem Balken ab 1.12. steht „1", Samstag/Sonntag sind getönt (nicht der Dienstag), die Monatslinie liegt am 1.`, info.ueberStart2 === '1' && info.sa && info.so && !info.di && info.monatAm1, info);
    await h.ctx.close();
  }
  const h = await profil(standMit([brett('b1', 'Plan', [gantt()])]));
  const P = h.P;
  const r1 = P.locator('rect[data-row="r1"]');
  await r1.click();
  await P.waitForSelector('.gantt-rowbar');
  const feld = await P.evaluate(() => { const s = document.querySelector('.gantt-rowbar select'); return s.options[s.selectedIndex]?.textContent; });
  pruefe('C2 Fortschritt 30 % (so beginnt jeder neue Zeitplan) steht im Feld — nicht „0%"', feld === '30%', feld);
  // Ziehen: zwei Tage nach rechts, dann zurück an den Ausgangspunkt — der Vorgang steht wieder am 24.11.
  const b = await r1.boundingBox(); const mx = b.x + b.width / 2; const my = b.y + b.height / 2; const tag = b.width / 7;
  await P.mouse.move(mx, my); await P.mouse.down();
  await P.mouse.move(mx + tag * 2.1, my, { steps: 6 });
  const unterwegs = await warteBis(async () => (await r1.getAttribute('data-start')) === '2026-11-26', 4000);
  await P.mouse.move(mx, my, { steps: 6 });
  const zurueck = await warteBis(async () => (await r1.getAttribute('data-start')) === '2026-11-24', 3000);
  await P.mouse.up();
  pruefe('C3 Ziehen und zurück an den Ausgangspunkt: Der Vorgang steht wieder am 24.11. (nicht einen Tag daneben)', unterwegs && zurueck && (await h.karte('ga')).data.rows[0].start === '2026-11-24', [unterwegs, await r1.getAttribute('data-start')]);
  await h.ctx.close();

  // Dunkel: die sechste Palettenfarbe (#2b2a27) hebt sich von der Fläche ab — gemessen an den Bildpunkten
  const d = await profil(standMit([brett('b1', 'Plan', [gantt()])], { ui: { theme: 'dark', accent: 'blau' } }));
  await d.P.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const kontrast = await d.P.evaluate(async () => {
    const r = document.querySelector('rect[data-row="r6"]').getBoundingClientRect();
    return { x: r.left + r.width * 0.7, y: r.top + r.height / 2, gx: r.left + r.width * 0.7, gy: r.bottom + 5 };
  });
  const bild = await d.P.screenshot({ path: path.join(BILDER, 'zeitplan-dunkel.png') });
  const farbe = await d.P.evaluate(async ({ b64, p }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const lum = ([r, gg, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
    const a = g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data; const u = g.getImageData(Math.round(p.gx), Math.round(p.gy), 1, 1).data;
    const l1 = lum(a); const l2 = lum(u);
    return { balken: [...a].slice(0, 3), grund: [...u].slice(0, 3), k: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) };
  }, { b64: bild.toString('base64'), p: kontrast });
  pruefe('C4 Dunkel: Der Balken in der dunkelsten Palettenfarbe hebt sich ab (≥ 2:1 zur Fläche; vorher 1,1:1)', farbe.k >= 2, farbe);
  pruefe('C5 … gespeichert bleibt die gewählte Farbe', (await d.karte('ga')).data.rows[2].color === '#2b2a27');
  await d.ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Rechen-Tabelle ════');
const tabelle = () => ({ id: 'sh', type: 'sheet', width: 520, height: 340, position: { x: 80, y: 80 }, data: { title: 'Tabelle', cols: 4, rows: 6, cells: { A1: 'Posten', B1: 'Betrag', A2: 'Miete', B2: '1.234,50', A3: 'Strom', B3: '89,90', A4: 'Wasser', B4: '40' } } });
{
  const h = await profil(standMit([brett('b1', 'Tabelle', [tabelle()])]));
  const P = h.P; const zelle = (a) => h.knoten('sh').locator(`td[data-zelle="${a}"]`);
  await zelle('C3').click(); await P.waitForSelector('.sheet-eingabe');
  await zelle('D5').click(); await P.waitForFunction(() => document.querySelector('.sheet-eingabe')?.closest('td')?.dataset.zelle === 'D5');
  await P.keyboard.press('Escape'); await P.waitForFunction(() => !document.querySelector('.sheet-eingabe'));
  pruefe('D1 Zelle öffnen und ohne Änderung verlassen: kein Rückgängig-Schritt (Strg+Z bliebe sonst wirkungslos)', !(await undoAn(P)));
  await zelle('C2').click(); await P.waitForSelector('.sheet-eingabe'); await P.keyboard.type('=B2+B3'); await P.keyboard.press('Enter');
  await warteBis(async () => (await zelle('C2').innerText()).trim() === '1.324,4', 4000);
  pruefe('D2 eine echte Eingabe rechnet (1.234,50 + 89,90 = 1.324,4) und ist ein Schritt', (await zelle('C2').innerText()).trim() === '1.324,4' && await undoAn(P), await zelle('C2').innerText());
  await h.ctx.close();
  // 26 Spalten (A bis Z) sind die Grenze: Der Knopf sagt es, statt nichts zu tun
  const t26 = tabelle(); t26.data.cols = 25;
  const g = await profil(standMit([brett('b1', 'Tabelle', [t26])]));
  await g.waehlen('sh', 30, 12);
  const anhaengen = async () => { await g.knoten('sh').locator('.sheet-tools button[aria-haspopup]').last().click(); await g.P.getByRole('menuitem', { name: 'Spalte anhängen' }).click(); };
  await anhaengen();
  await warteBis(async () => (await g.knoten('sh').locator('thead th.sheet-kopf').count()) === 26, 4000);
  await anhaengen();
  const gesagt = await warteBis(async () => (await g.toasts()).some((x) => /26 Spalten/.test(x)), 4000);
  pruefe('D3 „Spalte anhängen" bei 26 Spalten: ein Hinweis statt eines Knopfs ohne Wirkung', gesagt && (await g.knoten('sh').locator('thead th.sheet-kopf').count()) === 26, await g.toasts());
  await g.ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Kalender ════');
{
  const kal = { id: 'ca', type: 'calendar', width: 520, height: 420, position: { x: 80, y: 80 }, data: { month: '2027-03' } };
  const h = await profil(standMit([brett('b1', 'Kalender', [kal])]), { zeit: '2026-11-24T10:00:00+01:00' });
  const P = h.P; const K = h.knoten('ca'); const titel = () => K.locator('.cal-title').innerText();
  const knopf = (wort) => K.locator('.cal-nav button', { hasText: wort }).first();
  await h.waehlen('ca', 16, 14);   // links am Titel — rechts liegen die Knöpfe zum Blättern
  await knopf('Woche').click();
  pruefe('E1 Monat März 2027 → Woche: die Woche des 1. März 2027 (nicht die heutige)', await warteBis(async () => (await titel()) === '1.3. – 7.3.2027', 4000), await titel());
  for (let i = 0; i < 44; i += 1) await K.locator('.cal-nav button[aria-label="Weiter"]').click();
  await warteBis(async () => /2028$/.test(await titel()), 4000);
  const woche = await titel();
  await knopf('Jahr').click();
  pruefe('E2 Woche im Januar 2028 → Jahr: 2028 (vorher das Jahr des zuletzt gezeigten Monats)', /2028$/.test(woche) && await warteBis(async () => (await titel()) === '2028', 4000), [woche, await titel()]);
  await knopf('Monat').click();
  pruefe('E3 … → Monat: Januar 2028', await warteBis(async () => (await titel()) === 'Januar 2028', 4000), await titel());
  await K.locator('.cal-nav button', { hasText: 'heute' }).click();
  await warteBis(async () => (await titel()) === 'November 2026', 4000);
  await knopf('Woche').click();
  await warteBis(async () => (await titel()) === '23.11. – 29.11.2026', 4000);
  const d = (await h.karte('ca')).data;
  pruefe('E4 Im laufenden Monat → Woche: die heutige Woche, ohne sie festzuschreiben (sie wandert mit dem Datum)', (await titel()) === '23.11. – 29.11.2026' && d.anchor === undefined && d.view === 'week', [await titel(), d]);
  await h.ctx.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Wochenplan ════');
{
  const woche = { id: 'we', type: 'week', width: 620, height: 440, position: { x: 80, y: 80 }, data: { title: 'Wochenplan', days: 5, from: 600, to: 960, entries: [
    { id: 'w1', day: 0, start: 540, dur: 90, text: 'Beginnt vor dem Raster' }, { id: 'w2', day: 1, start: 480, dur: 60, text: 'Ganz davor' },
    { id: 'w3', day: 2, start: 930, dur: 120, text: 'Endet nach dem Raster' }, { id: 'w4', day: 3, start: 660, dur: 60, text: 'Mittendrin' }] } };
  const h = await profil(standMit([brett('b1', 'Woche', [woche])]));
  const lage = await h.P.evaluate(() => {
    const g = document.querySelector('.week-grid').getBoundingClientRect();
    return [...document.querySelectorAll('.week-entry')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.querySelector('.week-entry-text').textContent, oben: Math.round(r.top - g.top), unten: Math.round(g.bottom - r.bottom), h: Math.round(r.height) }; });
  });
  const von = (t) => lage.find((l) => l.text === t);
  pruefe('F1 Block 9:00–10:30 bei Raster ab 10:00: beginnt an der Oberkante des Rasters (vorher 53 px darüber, quer über Titel und Wochentag)', von('Beginnt vor dem Raster')?.oben >= 0 && von('Beginnt vor dem Raster')?.h > 10, lage);
  pruefe('F2 ein Block ganz vor dem Raster wird nicht gezeichnet; einer mittendrin unverändert; einer über das Ende hinaus endet an der Unterkante', !von('Ganz davor') && von('Mittendrin')?.oben > 20 && von('Endet nach dem Raster')?.unten >= 0, lage);
  await h.P.screenshot({ path: path.join(BILDER, 'wochenplan-raster.png') });
  await h.ctx.close();
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Protokoll ════');
const t = (s) => [{ type: 'text', text: s, styles: {} }];
const protokoll = () => ({ id: 'mi', type: 'minutes', width: 520, height: 520, position: { x: 80, y: 60 }, data: { title: 'Jour Fixe', color: 'white', agenda: [], rhythm: 'woche', carryOpen: true, current: 'e2', entries: [
  { id: 'e1', date: '2026-11-10', attendees: 'Anna Berg', blocks: [{ id: 'p1', type: 'paragraph', props: {}, content: t('Erste Sitzung'), children: [] }], decisions: [] },
  { id: 'e2', date: '2026-11-17', attendees: 'Anna Berg', blocks: [{ id: 'p2', type: 'paragraph', props: {}, content: t('Zweite Sitzung'), children: [] }], decisions: [] }] } });
{
  const h = await profil(standMit([brett('b1', 'Protokoll', [protokoll()])]));
  const M = h.knoten('mi');
  await h.waehlen('mi', 30, 12);
  await M.locator('.pr-datum').fill('');
  await h.P.waitForTimeout(300);
  const reiter = await M.locator('.pr-tag').allInnerTexts();
  pruefe('G1 Datumsfeld geleert: Die Sitzung behält ihr Datum (vorher hieß sie „—" und rutschte ans Ende)', (await h.karte('mi')).data.entries.find((e) => e.id === 'e2').date === '2026-11-17' && !reiter.includes('—'), reiter);
  await M.locator('.pr-datum').fill('2026-11-18');
  pruefe('G2 ein neues Datum gilt', await warteBis(async () => (await M.locator('.pr-tag[aria-selected="true"]').innerText()) === '18.11.', 4000));
  await h.ctx.close();
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: Kanban ════');
{
  const kb = { id: 'kb', type: 'kanban', width: 600, height: 400, position: { x: 80, y: 80 }, data: { title: 'Aufgaben', cols: ['To Do', 'In Arbeit', 'Erledigt'], wip: [null, 3, null], items: [
    { id: 't1', text: 'Angebot', col: 0 }, { id: 't2', text: 'Rechnung', col: 1 }, { id: 't3', text: 'Mahnung', col: 1 }, { id: 't4', text: 'Altes', col: 2 }] } };
  const h = await profil(standMit([brett('b1', 'Kanban', [kb])]));
  const P = h.P; const K = h.knoten('kb');
  await h.waehlen('kb', 30, 12);
  const spalte = K.locator('.kanban-col').nth(1);
  await spalte.hover();
  await spalte.locator('.kanban-col-x:not(.kanban-col-archiv)').click();
  await warteBis(async () => (await K.locator('.kanban-col').count()) === 2, 4000);
  const hinweis = (await h.toasts()).at(-1) ?? '';
  const nach = (await h.karte('kb')).data;
  pruefe('H1 Spalte löschen sagt, was geschah: „Spalte „In Arbeit" gelöscht – 2 Tickets nach „To Do" verschoben."', /Spalte „In Arbeit" gelöscht – 2 Tickets nach „To Do" verschoben\./.test(hinweis) && JSON.stringify(nach.cols) === '["To Do","Erledigt"]' && nach.items.filter((i) => i.col === 0).length === 3, [hinweis, nach.cols]);
  const zurueck = P.locator('.toast.show button', { hasText: 'Rückgängig' });
  pruefe('H2 … mit „Rückgängig" im Hinweis', (await zurueck.count()) === 1);
  if (await zurueck.count()) await zurueck.click();
  await warteBis(async () => (await K.locator('.kanban-col').count()) === 3, 4000);
  const wieder = (await h.karte('kb')).data;
  pruefe('H3 „Rückgängig" stellt Spalte, Tickets und WIP-Limit wieder her', JSON.stringify(wieder.cols) === '["To Do","In Arbeit","Erledigt"]' && JSON.stringify(wieder.items.map((i) => i.col)) === '[0,1,1,2]' && JSON.stringify(wieder.wip) === '[null,3,null]', wieder);
  await h.ctx.close();
}

// ══ I ═══════════════════════════════════════════════════════════════
console.log('\n════ I: Ideabubbles / Mitmachen ════');
const bubbles = (id, mitmachen, x = 80) => ({ id, type: 'bubbles', width: 520, height: 420, position: { x, y: 80 }, data: { title: id === 'bu' ? 'Ideen' : 'Ältere Runde', frage: 'Was verbessern wir?', ideen: { i1: { text: 'Mehr Pausen', von: 'g:x', t: 1 }, i2: { text: 'Obst', von: 'g:x', t: 2 } }, stimmen: { 'i1|g:x': { n: 2, t: 3 } }, gruppen: {}, abstimmung: { phase: 'fertig', punkte: 3, t: 4 }, regeln: { zu: true, t: 4 }, mitmachen } });
{
  const st = standMit([brett('b1', 'Ideen', [
    bubbles('bu', { token: 'tokenAAAAAAAAAAAAA', k: 'abdruckAAAAAAAAAAAAAAA', an: true, t: 1, karte: 'bu' }),
    bubbles('alt', { token: 'tokenBBBBBBBBBBBBB', k: 'abdruckBBBBBBBBBBBBBBB', an: true, t: 1 }, 700),
  ])]);
  const h = await profil(st);
  const P = h.P;
  await P.waitForSelector('.react-flow__node[data-id="bu"] [data-taste="bub-mit-stand"]');
  pruefe('I1 Karte mit laufender Runde zeigt ihren Zustand — auch eine Runde von vor M520 (ohne Kennung der Karte)', (await P.locator('[data-taste="bub-mit-stand"]').count()) === 2);
  await h.waehlen('bu', 200, 10);
  await P.keyboard.press('Control+d');
  await warteBis(async () => (await P.locator('.react-flow__node.react-flow__node-bubbles').count()) === 3, 6000);
  const kopie = await P.evaluate(() => [...document.querySelectorAll('.react-flow__node-bubbles')].map((n) => ({ id: n.dataset.id, stand: !!n.querySelector('[data-taste="bub-mit-stand"]') })));
  const neu = kopie.find((k) => k.id !== 'bu' && k.id !== 'alt');
  pruefe('I2 Die Kopie hat keine Runde (vorher: derselbe Code — wer ihn scannte, schrieb in die Ur-Karte)', !!neu && !neu.stand && kopie.find((k) => k.id === 'bu').stand, kopie);
  await h.ctx.close();

  // Teilnehmer-Seite: Stylesheet und Seite sind gebaut; die Abstimm-Zeile ist ein Raster (Verhalten: m513 F5)
  const seite = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const T = await seite.newPage();
  await T.goto(`http://localhost:${PORT}/mitmachen.html`, { waitUntil: 'networkidle' });
  const zeile = await T.evaluate(() => {
    const z = document.createElement('div'); z.className = 'mit-liste';
    z.innerHTML = '<div class="mit-idee-zeile wahl"><span class="mit-text">Ein längerer Vorschlag, der am Telefon umbricht</span><span class="mit-meta"><span>Anna</span></span><span class="mit-stimmen"><button class="mit-knopf rund">−</button><b class="mit-meine">2</b><button class="mit-knopf rund haupt">＋</button></span></div>';
    document.querySelector('.mit').append(z);
    const t0 = z.querySelector('.mit-text').getBoundingClientRect(); const s = z.querySelector('.mit-stimmen').getBoundingClientRect(); const k = z.querySelector('.mit-knopf').getBoundingClientRect();
    return { daneben: s.left >= t0.right - 1 && s.top < t0.bottom && s.bottom > t0.top, imBild: s.right <= window.innerWidth, knopf: Math.round(k.width), text: Math.round(t0.width) };
  });
  pruefe('I3 Teilnehmer-Seite (390 px): − Zahl ＋ stehen neben dem Text, Tastfläche ≥ 44 px, der Text behält Platz', zeile.daneben && zeile.imBild && zeile.knopf >= 44 && zeile.text >= 150, zeile);
  await seite.close();
}

// ══ J ═══════════════════════════════════════════════════════════════
console.log('\n════ J: Board nur zum Lesen ════');
{
  const karten = [
    { id: 'ca', type: 'calendar', width: 430, height: 360, position: { x: 40, y: 60 }, data: { month: '2026-11' } },
    { ...protokoll(), position: { x: 500, y: 60 }, width: 440, height: 420 },
    { id: 'ti', type: 'time', width: 460, height: 380, position: { x: 980, y: 60 }, data: { title: 'Zeiterfassung', segs: [{ id: 's1', date: '2026-11-24', start: 480, end: 720, kind: 'arbeit' }] } },
    { ...gantt(), position: { x: 40, y: 500 }, width: 640, height: 260 },
    { ...tabelle(), position: { x: 720, y: 500 } },
  ];
  const st = standMit([brett('b1', 'Geteilt', karten, { geteiltRolle: 'lesen', geteiltVon: 'u-fremd', geteiltName: 'Ada' })]);
  const h = await profil(st, { zeit: '2026-11-24T10:00:00+01:00' });
  const P = h.P;
  const vorher = JSON.stringify((await h.zustand()).boards[0].nodes.map((n) => n.data));
  // Kalender blättern
  await h.waehlen('ca', 16, 14);   // links am Titel — rechts liegen die Knöpfe zum Blättern
  await h.knoten('ca').locator('.cal-nav button[aria-label="Weiter"]').click();
  pruefe('J1 Kalender: „Weiter" blättert zum Dezember 2026 (vorher: nichts, nur der Hinweis „nur zum Lesen")', await warteBis(async () => (await h.knoten('ca').locator('.cal-title').innerText()) === 'Dezember 2026', 4000), await h.knoten('ca').locator('.cal-title').innerText());
  // Protokoll: ältere Sitzung öffnen
  await h.waehlen('mi', 30, 12);
  await h.knoten('mi').locator('.pr-tag', { hasText: '10.11.' }).click();
  pruefe('J2 Protokoll: die ältere Sitzung lässt sich öffnen', await warteBis(async () => /Erste Sitzung/.test(await h.knoten('mi').innerText()), 5000));
  // Zeiterfassung: Wochenansicht
  await h.waehlen('ti', 30, 12);
  await h.knoten('ti').locator('.time-views button', { hasText: 'Woche' }).click();
  pruefe('J3 Zeiterfassung: Wochenansicht (KW 48, Summe 4:00 h)', await warteBis(async () => /^KW 48 ·/.test(await h.knoten('ti').locator('.time-nav b').first().innerText()), 4000) && /4:00 h/.test(await h.knoten('ti').locator('.time-sums').innerText()));
  // Zeitplan: Skala Monate
  await h.waehlen('ga', 30, 12);
  await h.knoten('ga').locator('.gantt-tools button[aria-haspopup]').last().click();
  await P.locator('[data-skala="monate"]').click();
  pruefe('J4 Zeitplan: Zeit-Skala „Monate" greift (Tageszahlen weichen, Monate rücken zusammen)', await warteBis(async () => (await P.locator('.gantt-kopf text.gantt-month').count()) >= 3, 5000), await P.locator('.gantt-kopf text.gantt-month').allInnerTexts());
  // Tabelle: Filter an, absteigend nach B sortieren
  await h.waehlen('sh', 30, 12);
  await h.knoten('sh').locator('.sheet-tools button[aria-haspopup]').last().click();
  await P.locator('[data-taste="sheet-filter-an"]').click();
  await P.locator('[data-taste="sheet-filter"][data-spalte="B"]').click();
  await P.locator('[data-taste="sheet-sort-auf"]').click();
  const folge = () => P.evaluate(() => [...document.querySelectorAll('.react-flow__node[data-id="sh"] tbody tr')].map((r) => r.dataset.zeile).slice(0, 4).join(','));
  pruefe('J5 Tabelle: aufsteigend nach Betrag sortiert (40 · 89,90 · 1.234,50 → Zeilen 4, 3, 2)', await warteBis(async () => (await folge()) === '1,4,3,2', 5000), await folge());
  await P.keyboard.press('Escape');
  // Inhalt bleibt geschützt
  await h.knoten('sh').locator('td[data-zelle="C2"]').click();
  await P.waitForSelector('.sheet-eingabe'); await P.keyboard.type('99'); await P.keyboard.press('Enter');
  await h.knoten('ti').locator('.time-kind', { hasText: 'Arbeit' }).click();
  await P.waitForTimeout(400);
  const nachher = JSON.stringify((await h.zustand()).boards[0].nodes.map((n) => n.data));
  pruefe('J6 Der Inhalt bleibt geschützt, und im Speicher ändert sich nichts (die Ansicht gilt nur auf diesem Gerät)', nachher === vorher && (await h.knoten('sh').locator('td[data-zelle="C2"]').innerText()).trim() === '');
  await P.screenshot({ path: path.join(BILDER, 'nur-lesen.png') });
  await h.ctx.close();
}

// ══ K ═══════════════════════════════════════════════════════════════
console.log('\n════ K: Englisch, Texte ════');
{
  const h = await profil(standMit([brett('b1', 'Ideen', [bubbles('bu', undefined)])]), { ls: { 'pixinotes-sprache': 'en' } });
  await h.P.waitForSelector('.react-flow__node[data-id="bu"] [data-taste="bub-punkte"]');
  const text = await h.knoten('bu').innerText();
  pruefe('K1 Englisch: Das Ergebnis der Ideabubbles nennt „2 votes" (vorher „2 Punkte")', /2 votes/.test(text) && !/Punkte/.test(text), text.replace(/\s+/g, ' ').slice(0, 200));
  await h.ctx.close();
  const doku = readdirSync(path.join(__repo, 'docs', 'meilensteine')).find((f) => /^M520-/.test(f));
  pruefe('K2 Meilenstein-Datei M520 mit Befundliste', !!doku && /\| Nr\b/.test(readFileSync(path.join(__repo, 'docs', 'meilensteine', doku), 'utf8')));
}

pruefe('Keine Fehler in der Seite', fehler.length === 0, fehler.slice(0, 3).join(' | '));
await browser.close();
app.close();
console.log(`\nM520: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
