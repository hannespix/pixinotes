/**
 * M268 — „wenn man die anzeige in Pixinotes skaliert (zb 130%) dann kann man
 * nicht mehr sauber die Module mit verbindungspfeilen verbinden. die hitboxen
 * skalieren falsch!"
 *
 * Der Prüfgedanke: Was bei 100 % geht, muss bei 130 % und 175 % genauso gehen.
 * Deshalb läuft JEDER Fall bei allen drei Stufen und wird verglichen — nicht
 * gegen einen Wunschwert, sondern gegen das eigene Verhalten bei 100 %.
 */
// Läuft aus dem Repository: `node pruefungen/m268-anzeige.mjs`
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
const PORT = 4476;
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

async function seite(A) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((z) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false, anzeige: z }));
    const nodes = [
      { id: 'a', type: 'note', position: { x: 60, y: 100 }, width: 240, height: 140,
        data: { color: 'yellow', blocks: [{ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'A', styles: {} }], children: [] }] } },
      { id: 'b', type: 'note', position: { x: 520, y: 100 }, width: 240, height: 140,
        data: { color: 'blue', blocks: [{ id: 'b2', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'B', styles: {} }], children: [] }] } },
    ];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes, comments: [] }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: false, navLinks: false, anzeige: z } }));
  }, A);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2000);
  return { ctx, P };
}

/** Mitte eines Elements auf dem Schirm */
const mitte = (P, sel) => P.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}, sel);

const ergebnisse = {};

for (const A of [1, 1.3, 1.75]) {
  const stufe = `${Math.round(A * 100)} %`;
  console.log(`\n════════════ Anzeige ${stufe} ════════════`);
  const { ctx, P } = await seite(A);
  const e = {};

  // --- Grundlage: rechnet die Leinwand den Wurzel-Zoom heraus? ---
  const basis = await P.evaluate(() => {
    const r = document.querySelector('.react-flow__renderer');
    const vp = document.querySelector('.react-flow__viewport');
    const t = getComputedStyle(vp).transform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number) ?? [];
    return {
      wurzel: document.documentElement.style.zoom || '1',
      gegen: Number(getComputedStyle(r).zoom),
      boardZoom: t[0],
      kartenBreite: Math.round(document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect().width),
    };
  });
  console.log('   ', JSON.stringify(basis));
  pruefe(`[${stufe}] Leinwand gleicht den Anzeige-Zoom aus`,
    Math.abs(basis.gegen - 1 / A) < 0.01, JSON.stringify(basis));
  pruefe(`[${stufe}] der Board-Zoom trägt den Faktor (bis das Einpassen deckelt)`,
    basis.boardZoom <= A + 0.01 && basis.boardZoom >= Math.min(A, 1) - 0.01,
    `Board-Zoom ${basis.boardZoom} bei Faktor ${A}`);
  pruefe(`[${stufe}] die Karten sind mindestens so groß wie bei 100 %`,
    basis.kartenBreite >= 240 - 1, `${basis.kartenBreite} px`);

  // --- 1. Verbinden ---
  const pk = await P.evaluate(() => {
    const a = document.querySelector('.react-flow__node[data-id="a"]');
    const b = document.querySelector('.react-flow__node[data-id="b"]');
    const hs = [...a.querySelectorAll('.react-flow__handle')];
    const rechts = hs.sort((x, y) => y.getBoundingClientRect().left - x.getBoundingClientRect().left)[0];
    const r = rechts.getBoundingClientRect(); const br = b.getBoundingClientRect();
    return { von: [r.left + r.width / 2, r.top + r.height / 2], nach: [br.left + br.width / 2, br.top + br.height / 2] };
  });
  await P.mouse.move(pk.von[0], pk.von[1]);
  await P.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await P.mouse.move(pk.von[0] + ((pk.nach[0] - pk.von[0]) * i) / 12, pk.von[1] + ((pk.nach[1] - pk.von[1]) * i) / 12);
    await P.waitForTimeout(30);
  }
  await P.mouse.up();
  await P.waitForTimeout(600);
  e.kanten = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges.length);
  pruefe(`[${stufe}] zwei Karten lassen sich verbinden`, e.kanten === 1, `Kanten: ${e.kanten}`);

  // --- 2. Anfasser-Trefferfläche: liegt der Anfasser dort, wo er gezeichnet wird? ---
  e.treffer = await P.evaluate(() => {
    const a = document.querySelector('.react-flow__node[data-id="a"]');
    /* Nur die SICHTBAREN Punkte prüfen: React Flow legt zusätzlich eine
       kartenbreite Fangfläche an, deren Mitte naturgemäß auf der Karte liegt.
       Quell- und Zielanfasser liegen übereinander — getroffen werden muss
       also EIN Anfasser, nicht genau dieser. */
    const hs = [...a.querySelectorAll('.react-flow__handle')]
      .filter((h) => h.getBoundingClientRect().width <= 40);
    return hs.length > 0 && hs.every((h) => {
      const r = h.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!t?.closest?.('.react-flow__handle');
    });
  });
  pruefe(`[${stufe}] jeder Anfasser ist an seiner gezeichneten Stelle antippbar`, e.treffer);

  // --- 3. Karte ziehen: folgt sie der Maus 1:1? (Physik-Nachlauf wird gemessen,
  //        verglichen wird deshalb der WERT zwischen den Stufen) ---
  const vorZ = await P.evaluate(() => {
    const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top)];
  });
  await P.mouse.move(vorZ[0] + 15, vorZ[1] + 6);
  await P.mouse.down();
  for (let i = 1; i <= 10; i++) { await P.mouse.move(vorZ[0] + 15 + (300 * i) / 10, vorZ[1] + 6 + (120 * i) / 10); await P.waitForTimeout(25); }
  await P.mouse.up();
  await P.waitForTimeout(600);
  const nachZ = await P.evaluate(() => {
    const r = document.querySelector('.react-flow__node[data-id="b"]').getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top)];
  });
  e.ziehX = (nachZ[0] - vorZ[0]) / 300;
  e.ziehY = (nachZ[1] - vorZ[1]) / 120;
  console.log(`    Ziehen: Verhältnis ${e.ziehX.toFixed(3)} / ${e.ziehY.toFixed(3)}`);

  // --- 4. Doppelklick: wo landet die Notiz relativ zum Zeiger (in Board-Punkten)? ---
  await P.mouse.dblclick(1000, 660);
  await P.waitForTimeout(900);
  e.neu = await P.evaluate((z) => {
    const els = [...document.querySelectorAll('.react-flow__node')];
    const r = els[els.length - 1].getBoundingClientRect();
    const vp = document.querySelector('.react-flow__viewport');
    const t = getComputedStyle(vp).transform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number) ?? [];
    // Versatz in BOARD-Punkten — der muss über alle Stufen gleich sein
    return [Math.round((r.left - 1000) / t[0]), Math.round((r.top - 660) / t[0])];
  }, A);
  console.log(`    Doppelklick-Versatz in Board-Punkten: ${JSON.stringify(e.neu)}`);

  // --- 5. ⋯-Menü sitzt an seinem Knopf ---
  await P.locator('.react-flow__node[data-id="a"]').click({ position: { x: 4, y: 4 } });
  await P.waitForTimeout(500);
  await P.evaluate(() => {
    [...document.querySelectorAll('.sel-toolbar button')].find((x) => x.getAttribute('aria-label') === 'Mehr')?.click();
  });
  await P.waitForTimeout(600);
  e.menu = await P.evaluate(() => {
    const b = [...document.querySelectorAll('.sel-toolbar button')].find((x) => x.getAttribute('aria-label') === 'Mehr');
    const m = document.querySelector('.sel-more-menu');
    if (!b || !m) return null;
    const br = b.getBoundingClientRect(); const mr = m.getBoundingClientRect();
    // waagerecht: rechte Kanten nah beieinander · senkrecht: direkt über/unter dem Knopf
    const luecke = mr.top >= br.bottom ? mr.top - br.bottom : br.top - mr.bottom;
    return { dxRechts: Math.round(mr.right - br.right), luecke: Math.round(luecke),
      imBild: mr.left >= 0 && mr.top >= 0 && mr.right <= window.innerWidth && mr.bottom <= window.innerHeight };
  });
  console.log('    ⋯-Menü:', JSON.stringify(e.menu));
  pruefe(`[${stufe}] das ⋯-Menü liegt vollständig im Bild`, e.menu?.imBild === true, JSON.stringify(e.menu));
  pruefe(`[${stufe}] es sitzt direkt an seinem Knopf (Lücke < 60 px)`,
    Math.abs(e.menu?.luecke ?? 999) < 60, `${e.menu?.luecke} px`);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);

  // --- 6. Karten-Leiste: hängt sie über ihrer Karte UND wächst sie mit? ---
  e.leiste = await P.evaluate(() => {
    const t = document.querySelector('.sel-toolbar');
    const n = document.querySelector('.react-flow__node[data-id="a"]');
    if (!t || !n) return null;
    const tr = t.getBoundingClientRect(); const nr = n.getBoundingClientRect();
    return { hoehe: Math.round(tr.height), ueberKarte: Math.round(nr.top - tr.bottom),
      versatzMitte: Math.round((tr.left + tr.width / 2) - (nr.left + nr.width / 2)) };
  });
  console.log('    Karten-Leiste:', JSON.stringify(e.leiste));
  pruefe(`[${stufe}] die Karten-Leiste steht dicht über ihrer Karte`,
    Math.abs(e.leiste?.ueberKarte ?? 999) < 40, `${e.leiste?.ueberKarte} px`);
  pruefe(`[${stufe}] und ist waagerecht an der Karte ausgerichtet`,
    Math.abs(e.leiste?.versatzMitte ?? 999) < 60, `${e.leiste?.versatzMitte} px`);

  // --- 7. Zeichnen: landet der Strich unter dem Stift? ---
  await P.keyboard.press('Escape');
  await P.mouse.click(1200, 250);          // Auswahl lösen, damit das Dock frei ist
  await P.waitForTimeout(300);
  // Der Knopf öffnet nur das Flyout — das Werkzeug wählt man darin
  await P.locator('button[title^="Zeichnen"]').click();
  await P.waitForTimeout(500);
  await P.locator('.dock-menu-draw button', { hasText: 'Stift' }).first().click();
  await P.waitForTimeout(800);
  const gemalt = await P.evaluate(() => !!document.querySelector('.drawing-layer'));
  if (gemalt) {
    /* Erst warten, bis die Hinweis-Blase weg ist: Sie liegt unten mittig und
       fängt bei 175 % genau den Punkt ab, auf dem gezeichnet werden soll —
       das wäre ein Fehler des Tests, nicht der App. */
    const kandidaten = [[600, 700], [1150, 620], [1150, 300], [300, 700], [900, 250]];
    const start = await P.evaluate((liste) => {
      const frei = (p) => {
        const t = document.elementFromPoint(p[0], p[1]);
        return !!t && (t.classList.contains('drawing-layer') || !!t.closest('.drawing-layer'));
      };
      return liste.find(frei) ?? null;
    }, kandidaten);
    if (!start) { pruefe(`[${stufe}] freie Zeichenfläche gefunden`, false, 'alles verdeckt'); }
    if (!start) { await P.screenshot({ path: `${SD}/m268-${Math.round(A * 100)}.png` }); ergebnisse[stufe] = e; await ctx.close(); continue; }
    await P.mouse.move(start[0], start[1]);
    await P.mouse.down();
    for (let i = 1; i <= 8; i++) { await P.mouse.move(start[0] + i * 20, start[1] + i * 5); await P.waitForTimeout(25); }
    await P.mouse.up();
    await P.waitForTimeout(600);
    e.strich = await P.evaluate(() => {
      const p = document.querySelector('.drawing-layer path');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { start: [Math.round(r.left), Math.round(r.top)], breite: Math.round(r.width) };
    });
    console.log('    Strich:', JSON.stringify(e.strich));
    pruefe(`[${stufe}] der Strich beginnt dort, wo der Stift aufsetzte`,
      e.strich && Math.abs(e.strich.start[0] - start[0]) < 25 && Math.abs(e.strich.start[1] - start[1]) < 25,
      JSON.stringify(e.strich));
  } else {
    pruefe(`[${stufe}] Zeichenebene erreichbar`, false, 'Stift nicht gefunden');
  }

  await P.screenshot({ path: `${SD}/m268-${Math.round(A * 100)}.png` });
  ergebnisse[stufe] = e;
  await ctx.close();
}

// ════ Vergleich über die Stufen ════
console.log('\n════════════ Vergleich ════════════');
const stufen = Object.keys(ergebnisse);
const basis = ergebnisse['100 %'];
for (const s of stufen.slice(1)) {
  const e = ergebnisse[s];
  pruefe(`Ziehen verhält sich bei ${s} wie bei 100 %`,
    Math.abs(e.ziehX - basis.ziehX) < 0.08 && Math.abs(e.ziehY - basis.ziehY) < 0.08,
    `${e.ziehX.toFixed(3)}/${e.ziehY.toFixed(3)} gegen ${basis.ziehX.toFixed(3)}/${basis.ziehY.toFixed(3)}`);
  pruefe(`Doppelklick setzt die Notiz bei ${s} an dieselbe Board-Stelle`,
    Math.abs(e.neu[0] - basis.neu[0]) < 25 && Math.abs(e.neu[1] - basis.neu[1]) < 25,
    `${JSON.stringify(e.neu)} gegen ${JSON.stringify(basis.neu)}`);
}

// ════ T9: Die Einstellung im laufenden Betrieb umstellen ════
console.log('\n════════════ T9: Umschalten bei offenem Board ════════════');
{
  const { ctx, P } = await seite(1);
  const vor = await P.evaluate(() => {
    const n = document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect();
    const vp = document.querySelector('.react-flow__viewport');
    const t = getComputedStyle(vp).transform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number) ?? [];
    const r = document.querySelector('.react-flow').getBoundingClientRect();
    // Welcher Board-Punkt liegt in der Mitte des Ausschnitts?
    return { breite: Math.round(n.width), zoom: t[0],
      mitteFlow: [(r.width / 2 - t[4]) / t[0], (r.height / 2 - t[5]) / t[0]] };
  });
  // Einstellungen öffnen und 130 % wählen
  await P.locator('button[title^="Einstellungen"]').click();
  await P.waitForTimeout(700);
  await P.locator('.modal button', { hasText: 'Design' }).first().click();   // Reiter „Design"
  await P.waitForTimeout(600);
  await P.locator('.modal button', { hasText: '130 %' }).first().click();
  await P.waitForTimeout(900);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(900);
  const nach = await P.evaluate(() => {
    const n = document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect();
    const vp = document.querySelector('.react-flow__viewport');
    const t = getComputedStyle(vp).transform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number) ?? [];
    const r = document.querySelector('.react-flow').getBoundingClientRect();
    return { breite: Math.round(n.width), zoom: t[0], gegen: Number(getComputedStyle(document.querySelector('.react-flow__renderer')).zoom),
      mitteFlow: [(r.width / 2 - t[4]) / t[0], (r.height / 2 - t[5]) / t[0]] };
  });
  console.log('    vorher :', JSON.stringify(vor));
  console.log('    nachher:', JSON.stringify(nach));
  pruefe('T9a der Ausgleich greift sofort', Math.abs(nach.gegen - 1 / 1.3) < 0.01, String(nach.gegen));
  pruefe('T9b der Board-Zoom zieht mit', Math.abs(nach.zoom / vor.zoom - 1.3) < 0.05,
    `${vor.zoom} → ${nach.zoom}`);
  pruefe('T9c die Karten sind sofort größer', nach.breite > vor.breite * 1.2,
    `${vor.breite} → ${nach.breite}`);
  pruefe('T9d man schaut weiter auf dieselbe Stelle',
    Math.abs(nach.mitteFlow[0] - vor.mitteFlow[0]) < 12 && Math.abs(nach.mitteFlow[1] - vor.mitteFlow[1]) < 12,
    `${JSON.stringify(vor.mitteFlow.map(Math.round))} → ${JSON.stringify(nach.mitteFlow.map(Math.round))}`);

  // Und danach lässt sich immer noch verbinden
  const pk2 = await P.evaluate(() => {
    const a = document.querySelector('.react-flow__node[data-id="a"]');
    const b = document.querySelector('.react-flow__node[data-id="b"]');
    if (!a || !b) return null;
    const hs = [...a.querySelectorAll('.react-flow__handle')].filter((h) => h.getBoundingClientRect().width <= 40);
    const rechts = hs.sort((x, y) => y.getBoundingClientRect().left - x.getBoundingClientRect().left)[0];
    const r = rechts.getBoundingClientRect(); const br = b.getBoundingClientRect();
    return { von: [r.left + r.width / 2, r.top + r.height / 2], nach: [br.left + br.width / 2, br.top + br.height / 2] };
  });
  if (pk2) {
    await P.mouse.move(pk2.von[0], pk2.von[1]);
    await P.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await P.mouse.move(pk2.von[0] + ((pk2.nach[0] - pk2.von[0]) * i) / 12, pk2.von[1] + ((pk2.nach[1] - pk2.von[1]) * i) / 12);
      await P.waitForTimeout(30);
    }
    await P.mouse.up();
    await P.waitForTimeout(700);
  }
  pruefe('T9e nach dem Umschalten verbindet es weiterhin',
    (await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].edges.length)) === 1);
  await P.screenshot({ path: `${SD}/m268-umschalten.png` });
  await ctx.close();
}

// ════ T11: Die Karten-Leiste wegschieben (M243) bei skalierter Anzeige ════
console.log('\n════════════ T11: Leiste verschieben ════════════');
for (const A of [1, 1.75]) {
  const { ctx, P } = await seite(A);
  await P.locator('.react-flow__node[data-id="a"]').click({ position: { x: 4, y: 4 } });
  await P.waitForTimeout(600);
  const griff = await P.evaluate(() => {
    const g = document.querySelector('.sel-griff');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const t = document.querySelector('.sel-toolbar').getBoundingClientRect();
    return { punkt: [r.left + r.width / 2, r.top + r.height / 2], leiste: [Math.round(t.left), Math.round(t.top)] };
  });
  if (!griff) { pruefe(`[${Math.round(A * 100)} %] Anfasser der Leiste gefunden`, false); await ctx.close(); continue; }
  const dx = 140; const dy = -90;
  await P.mouse.move(griff.punkt[0], griff.punkt[1]);
  await P.mouse.down();
  for (let i = 1; i <= 10; i++) { await P.mouse.move(griff.punkt[0] + (dx * i) / 10, griff.punkt[1] + (dy * i) / 10); await P.waitForTimeout(30); }
  await P.mouse.up();
  await P.waitForTimeout(600);
  const nachher = await P.evaluate(() => {
    const t = document.querySelector('.sel-toolbar').getBoundingClientRect();
    return [Math.round(t.left), Math.round(t.top)];
  });
  const gx = nachher[0] - griff.leiste[0]; const gy = nachher[1] - griff.leiste[1];
  console.log(`    [${Math.round(A * 100)} %] Maus ${dx}/${dy} → Leiste ${gx}/${gy}`);
  pruefe(`[${Math.round(A * 100)} %] die Leiste folgt dem Finger eins zu eins`,
    Math.abs(gx - dx) < 14 && Math.abs(gy - dy) < 14, `${gx}/${gy} statt ${dx}/${dy}`);
  await ctx.close();
}

// ════ T10: Die Netz-Übersicht ════
console.log('\n════════════ T10: Netz-Übersicht bei 130 % ════════════');
{
  const { ctx, P } = await seite(1.3);
  await P.locator('button[title^="Übersicht"]').first().click();
  await P.waitForTimeout(1500);
  const ov = await P.evaluate(() => {
    const r = document.querySelector('.ov-canvas .react-flow__renderer');
    const n = document.querySelector('.ov-canvas .react-flow__node');
    if (!r || !n) return null;
    const nr = n.getBoundingClientRect();
    const t = document.elementFromPoint(nr.left + nr.width / 2, nr.top + nr.height / 2);
    return { gegen: Number(getComputedStyle(r).zoom), knoten: Math.round(nr.width),
      trifft: !!t?.closest?.('.react-flow__node') };
  });
  console.log('   ', JSON.stringify(ov));
  pruefe('T10a auch die Übersicht gleicht den Zoom aus', Math.abs((ov?.gegen ?? 0) - 1 / 1.3) < 0.01, JSON.stringify(ov));
  pruefe('T10b ihre Knoten sind dort anklickbar, wo sie gezeichnet werden', ov?.trifft === true, JSON.stringify(ov));
  await P.screenshot({ path: `${SD}/m268-uebersicht.png` });
  await ctx.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
