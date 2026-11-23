/**
 * M399 — Mehrere Karten auf einmal in Form bringen.
 *
 * Gewünscht: „Wenn mehrere Cards markiert sind, kann man bereits ein paar Anordnungs-Kommandos geben … Es soll auch
 * gleiche Höhe geben, Markierte in harmonisches Grid anordnen, kompakt packen etc. – alles, was man praktischerweise
 * brauchen könnte, wenn man mehrere Cards massenbearbeiten, platzieren, vergrößern, verkleinern, ins Grid … möchte."
 *
 *   A  Das Menü „Anordnen" zeigt vier Gruppen mit gezeichneten Symbolen.
 *   B  Ausrichten an alle sechs Kanten und Mitten.
 *   C  Verteilen, als Zeile, als Spalte.
 *   D  Gleiche Breite, Höhe, Größe; gemeinsam größer und kleiner.
 *   E  Raster, kompakt packen, aufräumen – nichts überlappt, die Reihenfolge bleibt lesbar.
 *   F  Ein Schritt je Befehl (Strg+Z), Meldung, Telefon, Englisch, Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m399-anordnen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium, devices } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4715;
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

const MASSE = [[220, 120], [260, 180], [180, 100], [240, 220], [200, 140], [300, 110], [190, 160]];
const ORTE = [[40, 30], [330, 90], [640, 10], [80, 300], [420, 350], [700, 270], [1010, 120]];
const karteSaat = (i, ort = ORTE[i], mass = MASSE[i]) => ({ id: `n${i}`, type: 'note', position: { x: ort[0], y: ort[1] }, width: mass[0], height: mass[1], autoFit: false,
  data: { color: 'yellow', blocks: [{ type: 'paragraph', content: [{ type: 'text', text: `Karte ${i + 1}`, styles: {} }] }] } });
const auf = async (nodes, opt = {}, sprache = '') => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, ...opt });
  await ctx.addInitScript(([n, sp]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    if (sp) localStorage.setItem('pixinotes-sprache', sp);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes: n }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
  }, [nodes, sprache]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1400);
  return { ctx, P };
};
/** Karten, wie der Speicher sie führt: Ort und gesetzte Größe */
const karten = async (P) => {
  await P.waitForTimeout(650);
  return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width, h: n.height, auto: n.autoFit })).sort((a, b) => a.id.localeCompare(b.id)));
};
const alleWaehlen = async (P, ids = null) => {
  await P.keyboard.press('Escape');
  if (!ids) { await P.locator('.react-flow__pane').click({ position: { x: 700, y: 760 } }); await P.keyboard.press('Control+a'); }
  else {
    await P.locator('.react-flow__pane').click({ position: { x: 700, y: 760 } });
    for (const [i, id] of ids.entries()) await P.locator(`.react-flow__node[data-id="${id}"]`).click({ modifiers: i ? ['Shift'] : [], position: { x: 30, y: 60 } });
  }
  await P.waitForTimeout(350);
};
const menue = async (P) => {
  if (await P.locator('.anordnen-menu').count()) return;
  await P.locator('[data-taste="auswahl-mehr"]').click(); await P.waitForTimeout(200);
  await P.locator('[data-taste="anordnen-auf"]').click(); await P.waitForTimeout(250);
};
const tun = async (P, op) => { await menue(P); await P.locator(`[data-anordnen="${op}"]`).click(); await P.waitForTimeout(350); };
const zurueck = async (P) => { await P.keyboard.press('Escape'); await P.keyboard.press('Control+z'); await P.waitForTimeout(350); };
const nah = (a, b, t = 1.5) => Math.abs(a - b) <= t;
const alleGleich = (werte, t = 1.5) => werte.every((v) => nah(v, werte[0], t));
/** Überlappen sich zwei Karten (mit Mindestabstand)? */
const ueberlappt = (ks, abstand = 0) => { for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const a = ks[i]; const b = ks[j];
  if (a.x < b.x + b.w + abstand - 1.5 && b.x < a.x + a.w + abstand - 1.5 && a.y < b.y + b.h + abstand - 1.5 && b.y < a.y + a.h + abstand - 1.5) return `${a.id}/${b.id}`; } return ''; };
const huelle = (ks) => { const l = Math.min(...ks.map((k) => k.x)); const o = Math.min(...ks.map((k) => k.y)); const r = Math.max(...ks.map((k) => k.x + k.w)); const u = Math.max(...ks.map((k) => k.y + k.h)); return { l, o, r, u, b: r - l, h: u - o }; };

const START = MASSE.map((_, i) => karteSaat(i));
const A = await auf(START);
const P = A.P;
const anfang = await karten(P);
const h0 = huelle(anfang);

// ---------- A: das Menü ----------
console.log('A  Das Menü');
{
  await alleWaehlen(P); await menue(P);
  const m = await P.evaluate(() => {
    const el = document.querySelector('.anordnen-menu'); if (!el) return null;
    return { titel: [...el.querySelectorAll('.sel-attr-title')].map((t) => t.textContent), knoepfe: [...el.querySelectorAll('[data-anordnen]')].map((b) => b.getAttribute('data-anordnen')),
      ohneBild: [...el.querySelectorAll('[data-anordnen]')].filter((b) => !b.querySelector('svg')).length, ohneNamen: [...el.querySelectorAll('.anordnen-knopf')].filter((b) => !b.title || b.title !== b.getAttribute('aria-label')).length,
      text: el.textContent, r: el.getBoundingClientRect().toJSON() };
  });
  pruefe('A1 vier Gruppen: Ausrichten, Verteilen, Größe, Anordnen', m?.titel.join('|') === 'Ausrichten|Verteilen|Größe|Anordnen', m?.titel);
  pruefe('A2 achtzehn Befehle zum Anordnen – dazu seit M400 „Schräg legen" und „Gerade richten", seit M445 „Nach Themen"', m?.knoepfe.join(',') === 'left,centerX,right,top,centerY,bottom,distH,distV,row,column,width,height,size,smaller,bigger,grid,pack,tidy,themen,schraeg,gerade', m?.knoepfe);
  pruefe('A3 jeder Befehl hat ein gezeichnetes Symbol und einen Namen (Tooltip = Name für Vorleser)', m?.ohneBild === 0 && m.ohneNamen === 0, m);
  pruefe('A4 kein Emoji und keine Pfeil-Zeichen im Menü', !/[\u{1F000}-\u{1FAFF}️⇤⤒⇹⇳⭤↔↕]/u.test(m?.text ?? 'x'), m?.text);
  pruefe('A5 das Menü liegt ganz im Bild', !!m && m.r.left >= 0 && m.r.right <= 1440 && m.r.top >= 0 && m.r.bottom <= 900, m?.r);
  await P.keyboard.press('Escape');
  await alleWaehlen(P, ['n0', 'n1']); await menue(P);
  const aus = await P.evaluate(() => [...document.querySelectorAll('.anordnen-menu [data-anordnen]')].filter((b) => b.disabled).map((b) => b.getAttribute('data-anordnen')));
  pruefe('A6 mit zwei Karten ist nur das Verteilen aus (braucht drei) – und „Gerade richten", solange nichts schräg liegt', aus.join(',') === 'distH,distV,gerade', aus);
  await P.keyboard.press('Escape');
}

// ---------- B: Ausrichten ----------
console.log('B  Ausrichten');
{
  const pruefung = { left: (k) => k.x, right: (k) => k.x + k.w, centerX: (k) => k.x + k.w / 2, top: (k) => k.y, bottom: (k) => k.y + k.h, centerY: (k) => k.y + k.h / 2 };
  const soll = { left: h0.l, right: h0.r, top: h0.o, bottom: h0.u,
    centerX: anfang.reduce((a, k) => a + k.x + k.w / 2, 0) / anfang.length, centerY: anfang.reduce((a, k) => a + k.y + k.h / 2, 0) / anfang.length };
  const namen = { left: 'links', right: 'rechts', centerX: 'waagerechte Mitte', top: 'oben', bottom: 'unten', centerY: 'senkrechte Mitte' };
  let n = 1;
  for (const op of ['left', 'centerX', 'right', 'top', 'centerY', 'bottom']) {
    await alleWaehlen(P); await tun(P, op);
    const ks = await karten(P);
    const werte = ks.map(pruefung[op]);
    const quer = ['left', 'right', 'centerX'].includes(op);
    const andere = ks.every((k, i) => (quer ? nah(k.y, anfang[i].y) : nah(k.x, anfang[i].x)) && nah(k.w, anfang[i].w) && nah(k.h, anfang[i].h));
    pruefe(`B${n++} ${namen[op]}: alle Karten an derselben Linie, die andere Richtung und die Größen bleiben`, alleGleich(werte) && nah(werte[0], soll[op], 2) && andere, { werte: werte.map(Math.round), soll: Math.round(soll[op]) });
    await zurueck(P);
  }
  const wieder = await karten(P);
  pruefe('B7 Strg+Z stellt jedes Mal den Stand davor her', wieder.every((k, i) => nah(k.x, anfang[i].x) && nah(k.y, anfang[i].y)), wieder.map((k) => [k.x, k.y]));
}

// ---------- C: Verteilen, Zeile, Spalte ----------
console.log('C  Verteilen, Zeile, Spalte');
{
  await alleWaehlen(P); await tun(P, 'distH');
  let ks = (await karten(P)).sort((a, b) => a.x - b.x);
  let luecken = ks.slice(1).map((k, i) => k.x - (ks[i].x + ks[i].w));
  pruefe('C1 horizontal verteilen: gleiche Lücken, die äußeren Karten bleiben stehen', alleGleich(luecken, 2) && nah(ks[0].x, h0.l) && nah(ks[ks.length - 1].x + ks[ks.length - 1].w, h0.r), luecken.map(Math.round));
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'distV');
  ks = (await karten(P)).sort((a, b) => a.y - b.y);
  luecken = ks.slice(1).map((k, i) => k.y - (ks[i].y + ks[i].h));
  pruefe('C2 vertikal verteilen: gleiche Lücken', alleGleich(luecken, 2) && nah(ks[0].y, h0.o), luecken.map(Math.round));
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'row');
  ks = (await karten(P)).sort((a, b) => a.x - b.x);
  luecken = ks.slice(1).map((k, i) => k.x - (ks[i].x + ks[i].w));
  const folge = [...anfang].sort((a, b) => a.x - b.x).map((k) => k.id).join(',');
  pruefe('C3 als Zeile: oben bündig, 24 Abstand, Reihenfolge von links nach rechts wie zuvor', alleGleich(ks.map((k) => k.y)) && nah(ks[0].y, h0.o) && luecken.every((l) => nah(l, 24)) && ks.map((k) => k.id).join(',') === folge, { luecken, folge: ks.map((k) => k.id) });
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'column');
  ks = (await karten(P)).sort((a, b) => a.y - b.y);
  luecken = ks.slice(1).map((k, i) => k.y - (ks[i].y + ks[i].h));
  const folgeY = [...anfang].sort((a, b) => a.y - b.y).map((k) => k.id).join(',');
  pruefe('C4 als Spalte: links bündig, 24 Abstand, Reihenfolge von oben nach unten wie zuvor', alleGleich(ks.map((k) => k.x)) && nah(ks[0].x, h0.l) && luecken.every((l) => nah(l, 24)) && ks.map((k) => k.id).join(',') === folgeY, { luecken, folge: ks.map((k) => k.id) });
  await zurueck(P);
}

// ---------- D: Größe ----------
console.log('D  Größe');
{
  const maxW = Math.max(...MASSE.map((m) => m[0])); const maxH = Math.max(...MASSE.map((m) => m[1]));
  await alleWaehlen(P); await tun(P, 'width');
  let ks = await karten(P);
  pruefe('D1 gleiche Breite: alle so breit wie die breiteste, Höhen bleiben', ks.every((k, i) => nah(k.w, maxW) && nah(k.h, anfang[i].h)), ks.map((k) => [k.w, k.h]));
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'height');
  ks = await karten(P);
  pruefe('D2 gleiche Höhe: alle so hoch wie die höchste, Breiten bleiben', ks.every((k, i) => nah(k.h, maxH) && nah(k.w, anfang[i].w)), ks.map((k) => [k.w, k.h]));
  pruefe('D3 … und die Höhe hält: die Auto-Größe ist bei diesen Karten aus', ks.filter((k, i) => !nah(anfang[i].h, maxH)).every((k) => k.auto === false), ks.map((k) => k.auto));
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'size');
  ks = await karten(P);
  pruefe('D4 gleiche Größe: Breite und Höhe wie die größten', ks.every((k) => nah(k.w, maxW) && nah(k.h, maxH)), ks.map((k) => [k.w, k.h]));
  pruefe('D5 … die Karten bleiben an ihrem Ort', ks.every((k, i) => nah(k.x, anfang[i].x) && nah(k.y, anfang[i].y)));
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'bigger');
  ks = await karten(P);
  pruefe('D6 größer: jede Karte wächst um 15 % um ihre eigene Mitte', ks.every((k, i) => nah(k.w, Math.round(anfang[i].w * 1.15)) && nah(k.h, Math.round(anfang[i].h * 1.15))
    && nah(k.x + k.w / 2, anfang[i].x + anfang[i].w / 2, 1) && nah(k.y + k.h / 2, anfang[i].y + anfang[i].h / 2, 1)), ks.map((k) => [k.w, k.h]));
  pruefe('D7 das Menü bleibt dabei offen – man klickt mehrmals', (await P.locator('.anordnen-menu').count()) === 1);
  await P.locator('[data-anordnen="bigger"]').click(); await P.waitForTimeout(400);
  const zwei = await karten(P);
  pruefe('D8 zweimal größer wächst weiter', zwei.every((k, i) => k.w > ks[i].w && k.h > ks[i].h), zwei.map((k) => [k.w, k.h]));
  await P.keyboard.press('Escape'); await P.keyboard.press('Control+z'); await P.waitForTimeout(350);
  const einsZurueck = await karten(P);
  pruefe('D9 jeder Klick ist ein eigener Rückgängig-Schritt', einsZurueck.every((k, i) => nah(k.w, ks[i].w) && nah(k.h, ks[i].h)), einsZurueck.map((k) => [k.w, k.h]));
  await P.keyboard.press('Control+z'); await P.waitForTimeout(350);
  await alleWaehlen(P); await tun(P, 'smaller');
  ks = await karten(P);
  pruefe('D10 kleiner: jede Karte schrumpft entsprechend', ks.every((k, i) => nah(k.w, Math.round(anfang[i].w / 1.15)) && nah(k.h, Math.round(anfang[i].h / 1.15))), ks.map((k) => [k.w, k.h]));
  await P.keyboard.press('Escape'); await P.keyboard.press('Control+z'); await P.waitForTimeout(350);
  const wieder = await karten(P);
  pruefe('D11 am Ende steht alles wie am Anfang', wieder.every((k, i) => nah(k.x, anfang[i].x) && nah(k.y, anfang[i].y) && nah(k.w, anfang[i].w) && nah(k.h, anfang[i].h)), wieder.map((k) => [k.x, k.y, k.w, k.h]));
}

// ---------- E: Raster, packen, aufräumen ----------
console.log('E  Raster, kompakt packen, aufräumen');
{
  await alleWaehlen(P); await tun(P, 'grid');
  let ks = await karten(P);
  const spaltenL = [...new Set(ks.map((k) => Math.round(k.x)))].sort((a, b) => a - b);
  const zeilenO = [...new Set(ks.map((k) => Math.round(k.y)))].sort((a, b) => a - b);
  pruefe('E1 Raster: die Karten stehen in Spalten und Zeilen (gemeinsame Kanten)', spaltenL.length >= 2 && spaltenL.length <= 4 && zeilenO.length === Math.ceil(ks.length / spaltenL.length), { spaltenL, zeilenO });
  pruefe('E2 … ohne Überlappen, mindestens 24 Abstand, links oben, wo die Auswahl lag', ueberlappt(ks, 24) === '' && nah(huelle(ks).l, h0.l) && nah(huelle(ks).o, h0.o), ueberlappt(ks, 24));
  const meldung = await P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  pruefe('E3 die Meldung nennt den Befehl und Strg+Z', /Raster – Strg\+Z macht es rückgängig/.test(meldung), meldung);
  // Lesereihenfolge: obere Reihe zuerst (n0, n1, n2 lagen oben)
  const ersteZeile = ks.filter((k) => Math.round(k.y) === zeilenO[0]).sort((a, b) => a.x - b.x).map((k) => k.id);
  pruefe('E4 die Reihenfolge folgt dem Lesen: was oben links lag, steht oben links', ersteZeile[0] === 'n0' && ersteZeile.every((id) => ['n0', 'n1', 'n2', 'n6'].includes(id)), ersteZeile);
  await tun(P, 'grid').catch(() => {});
  const nochmal = await P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  pruefe('E5 ein zweites Mal ändert nichts – und sagt das', /Die Karten stehen schon so\./.test(nochmal) && (await karten(P)).every((k, i) => nah(k.x, ks[i].x) && nah(k.y, ks[i].y)), nochmal);
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'pack');
  ks = await karten(P);
  const hp = huelle(ks);
  pruefe('E6 kompakt packen: nichts überlappt, überall mindestens 24 Abstand', ueberlappt(ks, 24) === '', ueberlappt(ks, 24));
  pruefe('E7 … und der Block ist deutlich kleiner als die verstreute Auswahl', hp.b * hp.h < h0.b * h0.h * 0.8 && nah(hp.l, h0.l) && nah(hp.o, h0.o), { vor: Math.round(h0.b * h0.h), nach: Math.round(hp.b * hp.h) });
  pruefe('E8 … die Größen bleiben', ks.every((k, i) => nah(k.w, anfang[i].w) && nah(k.h, anfang[i].h)));
  await zurueck(P);
  await alleWaehlen(P); await tun(P, 'tidy');
  ks = await karten(P);
  const zeilen = [...new Set(ks.map((k) => Math.round(k.y)))].sort((a, b) => a - b).map((y) => ks.filter((k) => Math.round(k.y) === y).sort((a, b) => a.x - b.x));
  const abstaende = zeilen.flatMap((z) => z.slice(1).map((k, i) => k.x - (z[i].x + z[i].w)));
  pruefe('E9 aufräumen: Zeilen bleiben Zeilen, darin überall 24 Abstand, nichts überlappt', zeilen.length === 2 && abstaende.every((a) => nah(a, 24)) && ueberlappt(ks, 24) === '', { zeilen: zeilen.map((z) => z.map((k) => k.id)), abstaende });
  pruefe('E10 … in der Reihenfolge von vorher', zeilen[0].map((k) => k.id).join(',') === 'n0,n1,n2,n6' && zeilen[1].map((k) => k.id).join(',') === 'n3,n4,n5', zeilen.map((z) => z.map((k) => k.id)));
  await zurueck(P);
  await A.ctx.close();
}
{
  // Sechs gleich große Karten, grob in zwei Reihen zu dreien gelegt: das Raster behält diese Aufteilung
  const grob = [[0, 0], [260, 14], [540, -8], [10, 210], [280, 196], [530, 220]].map((o, i) => karteSaat(i, [o[0] + 60, o[1] + 60], [200, 130]));
  const { ctx, P: Q } = await auf(grob);
  await alleWaehlen(Q); await tun(Q, 'grid');
  const ks = await karten(Q);
  const xs = [...new Set(ks.map((k) => Math.round(k.x)))].sort((a, b) => a - b); const ys = [...new Set(ks.map((k) => Math.round(k.y)))].sort((a, b) => a - b);
  pruefe('E11 eine grob gelegte 3 × 2-Anordnung wird ein sauberes 3 × 2-Raster', xs.length === 3 && ys.length === 2 && nah(xs[1] - xs[0], 224) && nah(xs[2] - xs[1], 224) && nah(ys[1] - ys[0], 154), { xs, ys });
  pruefe('E12 … jede Karte bleibt in ihrer Zeile und Spalte', ks.every((k, i) => Math.round(k.x) === xs[i % 3] && Math.round(k.y) === ys[Math.floor(i / 3)]), ks.map((k) => [k.id, k.x, k.y]));
  await ctx.close();
}

// ---------- F: Telefon, Englisch, Texte ----------
console.log('F  Telefon, Englisch, Texte');
{
  const klein = MASSE.slice(0, 3).map((_, i) => karteSaat(i, [20 + i * 40, 60 + i * 150], [150, 100]));
  const T = await auf(klein, { ...devices['Pixel 7'] });
  await T.P.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })); });
  await T.P.waitForTimeout(500);
  const mehr = T.P.locator('[data-taste="auswahl-mehr"]');
  if (await mehr.count()) {
    await mehr.tap(); await T.P.waitForTimeout(300);
    await T.P.locator('[data-taste="anordnen-auf"]').tap(); await T.P.waitForTimeout(350);
    const r = await T.P.evaluate(() => { const el = document.querySelector('.anordnen-menu'); const k = el?.querySelector('.anordnen-knopf'); return el ? { ...el.getBoundingClientRect().toJSON(), breit: innerWidth, hoch: innerHeight, knopf: k.getBoundingClientRect().width } : null; });
    pruefe('F1 am Telefon passt das Menü ins Bild, die Knöpfe sind fingergroß', !!r && r.left >= 0 && r.right <= r.breit && r.top >= 0 && r.bottom <= r.hoch && r.knopf >= 38, r);
    await T.P.locator('[data-anordnen="column"]').tap(); await T.P.waitForTimeout(400);
    const ks = await karten(T.P);
    pruefe('F2 … und der Befehl wirkt auch dort', alleGleich(ks.map((k) => k.x)) && ueberlappt(ks, 24) === '', ks.map((k) => [k.x, k.y]));
  } else { pruefe('F1 am Telefon passt das Menü ins Bild, die Knöpfe sind fingergroß', false, 'keine Auswahl-Leiste'); pruefe('F2 … und der Befehl wirkt auch dort', false); }
  await T.ctx.close();
  const E = await auf(START, {}, 'en');
  await alleWaehlen(E.P); await menue(E.P);
  const en = await E.P.evaluate(() => { const el = document.querySelector('.anordnen-menu'); return { text: el.textContent, titel: [...el.querySelectorAll('.anordnen-knopf')].map((b) => b.title) }; });
  pruefe('F3 das Menü ist englisch – Gruppen, Namen und Tooltips', /Align/.test(en.text) && /Distribute/.test(en.text) && /Size/.test(en.text) && /Grid/.test(en.text) && /Pack compactly/.test(en.text) && /Clean up/.test(en.text)
    && en.titel.includes('Same height') && en.titel.includes('Align right') && !en.titel.some((t) => /ausrichten|Gleiche|verteilen|Größer|Kleiner/.test(t)), en);
  await E.P.locator('[data-anordnen="height"]').click(); await E.P.waitForTimeout(350);
  const m = await E.P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  pruefe('F4 … die Meldung auch', /Same height – Ctrl\+Z undoes it/.test(m), m);
  await E.ctx.close();
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  pruefe('F5 die Hilfe nennt M399 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M399)') && lies('src/components/HelpOverlayEn.tsx').includes('(M399)'));
  pruefe('F6 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm399-anordnen: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
