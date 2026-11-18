/**
 * M389 — UI-Audit: was die Durchsicht der Oberfläche gefunden hat, bleibt behoben.
 *
 *   A  Farben: Weiße Schrift steht auf --accent-fill (≥ 4,5:1) — in allen fünf Akzentfarben; Akzent als Schrift
 *      ist im Dunkeln hell genug; aktive Reiter, Start-Knopf und rechtliche Verweise sind lesbar.
 *   B  Fenster: Der Fokus geht beim Öffnen hinein, Tab läuft im Kreis, Esc gibt ihn zurück. Knöpfe behalten nach
 *      dem Überfahren ihren Namen. Fokus-Leiste: Zeichen und Wort nebeneinander. Punkte der Präsentation treffbar.
 *   C  Tablet (Finger): Das Kartenmenü im Fokus bleibt im Bild und unter der Kopfzeile; Tippziele ≥ 40.
 *   D  Telefon: Die Übersicht ist lesbar (zwei Kacheln je Zeile, an die Breite angepasst), eine Kachel öffnet ihr Board.
 *   E  Diagramme: Die Mindmap ist ohne Farbschema vollständig sichtbar, ein Diagramm passt ganz in seine Karte;
 *      im Beispielprojekt liegt das Kanban im Rahmen.
 *   F  Aufgeräumt: tote CSS-Klassen sind weg, die Sammel-Regeln stehen noch. Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m389-ui-audit.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4701;
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
const fehler = [];

/** Kontrast zweier Farben; im Browser gerechnet, damit jede CSS-Schreibweise gilt. */
const kontrastFn = () => {
  window.__farbe = (s) => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  window.__hell = (c) => { const k = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
  window.__kontrast = (a, b) => { const x = window.__hell(window.__farbe(a)); const y = window.__hell(window.__farbe(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
};
const neu = async (opt, thema = 'light') => {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, locale: 'de-DE', colorScheme: thema, ...opt });
  await ctx.addInitScript(kontrastFn);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(700);
  return { ctx, P };
};
/** Beispiel-Umgebung laden und ein Board öffnen */
const insBoard = async (P, name, beruehrung = false) => {
  const knopf = P.locator('[data-taste="onb-beispiele"]');
  if (await knopf.count()) { if (beruehrung) await knopf.tap(); else await knopf.click(); await P.waitForTimeout(1300); }
  await P.evaluate((n) => { const j = JSON.parse(localStorage.getItem('pixinotes-board')); const b = j.state.boards.find((x) => x.name.includes(n)); j.state.view = 'board'; j.state.activeId = b.id; localStorage.setItem('pixinotes-board', JSON.stringify(j)); }, name);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
};

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Farben ════');
{
  const { ctx, P } = await neu({ viewport: { width: 1440, height: 900 } });
  const start = await P.evaluate(() => { const b = document.querySelector('.onb-primary'); const cs = getComputedStyle(b); return window.__kontrast(cs.color, cs.backgroundColor); });
  pruefe('A1 der Start-Knopf „Loslegen": weiße Schrift mit ≥ 4,5:1', start >= 4.5, start.toFixed(2));
  await insBoard(P, 'Schreibtisch');
  const akzente = await P.evaluate(() => {
    const aus = {};
    for (const a of ['blau', 'gruen', 'violett', 'orange', 'rosa']) {
      document.documentElement.dataset.accent = a;
      const cs = getComputedStyle(document.documentElement);
      aus[a] = { fuell: window.__kontrast('#fff', cs.getPropertyValue('--accent-fill').trim()), schrift: window.__kontrast(cs.getPropertyValue('--accent-strong').trim(), cs.getPropertyValue('--surface').trim()) };
    }
    document.documentElement.dataset.accent = 'blau';
    return aus;
  });
  pruefe('A2 --accent-fill trägt Weiß in allen fünf Akzentfarben (≥ 4,5:1)', Object.values(akzente).every((v) => v.fuell >= 4.5), JSON.stringify(akzente));
  pruefe('A3 hell: Akzent als Schrift (--accent-strong) auf Flächen ≥ 4,5:1', Object.values(akzente).every((v) => v.schrift >= 4.5), JSON.stringify(akzente));
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal-tabs');
  const reiter = await P.evaluate(() => { const b = document.querySelector('.modal-tabs button.on'); const cs = getComputedStyle(b); return window.__kontrast(cs.color, cs.backgroundColor); });
  pruefe('A4 der aktive Reiter der Einstellungen ist lesbar (≥ 4,5:1)', reiter >= 4.5, reiter.toFixed(2));
  await P.keyboard.press('Escape');
  await ctx.close();
  const d = await neu({ viewport: { width: 1440, height: 900 } }, 'dark');
  await insBoard(d.P, 'Schreibtisch');
  const dunkel = await d.P.evaluate(() => {
    const aus = {};
    for (const a of ['blau', 'gruen', 'violett', 'orange', 'rosa']) {
      document.documentElement.dataset.accent = a;
      const cs = getComputedStyle(document.documentElement);
      aus[a] = { schrift: window.__kontrast(cs.getPropertyValue('--accent-strong').trim(), cs.getPropertyValue('--surface-2').trim()), fuell: window.__kontrast('#fff', cs.getPropertyValue('--accent-fill').trim()) };
    }
    document.documentElement.dataset.accent = 'blau';
    const l = document.querySelector('.legal-corner .link-btn'); const lc = getComputedStyle(l);
    return { aus, thema: document.documentElement.dataset.theme, recht: window.__kontrast(lc.color, getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), deckung: getComputedStyle(document.querySelector('.legal-corner')).opacity };
  });
  pruefe('A5 dunkel: Akzent als Schrift auch auf getönten Flächen ≥ 4,5:1 – in allen fünf Farben', dunkel.thema === 'dark' && Object.values(dunkel.aus).every((v) => v.schrift >= 4.5 && v.fuell >= 4.5), JSON.stringify(dunkel.aus));
  pruefe('A6 dunkel: „Impressum · Datenschutz" steht mit voller Deckung und ≥ 4,5:1 da', dunkel.recht >= 4.5 && dunkel.deckung === '1', JSON.stringify([dunkel.recht, dunkel.deckung]));
  await d.ctx.close();
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Fenster, Namen, Leisten ════');
{
  const { ctx, P } = await neu({ viewport: { width: 1440, height: 900 } });
  await insBoard(P, 'Schreibtisch');
  const zahnrad = P.locator('[data-taste="einstellungen"]').first();
  await zahnrad.focus(); await P.keyboard.press('Enter'); await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(250);
  pruefe('B1 Fenster geöffnet: Der Fokus liegt im Fenster (nicht mehr auf dem Knopf dahinter)', await P.evaluate(() => !!document.activeElement?.closest('.modal-backdrop')), await P.evaluate(() => document.activeElement?.className ?? ''));
  let drin = true; const stationen = new Set();
  for (let i = 0; i < 45; i++) { await P.keyboard.press('Tab'); const s = await P.evaluate(() => [!!document.activeElement?.closest('.modal-backdrop'), (document.activeElement?.textContent ?? '').slice(0, 20) + '|' + (document.activeElement?.getAttribute('aria-label') ?? '')]); if (!s[0]) drin = false; stationen.add(s[1]); }
  pruefe('B2 Tab läuft im Fenster im Kreis – 45 Schritte, nie dahinter, mehr als fünf Stationen', drin && stationen.size > 5, stationen.size);
  for (let i = 0; i < 3; i++) await P.keyboard.press('Shift+Tab');
  pruefe('B3 … rückwärts ebenso', await P.evaluate(() => !!document.activeElement?.closest('.modal-backdrop')));
  await P.keyboard.press('Escape'); await P.waitForTimeout(350);
  pruefe('B4 Esc schließt, und der Fokus kehrt auf den Knopf zurück, der das Fenster geöffnet hat', (await P.locator('.modal-tabs').count()) === 0 && await P.evaluate(() => document.activeElement?.getAttribute('data-taste') === 'einstellungen'), await P.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? ''));
  // Suche hat ihr eigenes Feld — das bleibt angewählt
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box'); await P.waitForTimeout(250);
  pruefe('B5 die Suche behält ihr Eingabefeld (eigener Fokus geht vor)', await P.evaluate(() => document.activeElement?.tagName === 'INPUT' && !!document.activeElement.closest('.search-backdrop')));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  // Namen nach dem Überfahren
  const g = await P.evaluate(() => { const r = document.querySelector('.react-flow__node-note').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 6]; });
  await P.mouse.click(g[0], g[1]); await P.waitForSelector('.sel-toolbar');
  const muell = P.locator('.sel-toolbar button.danger');
  await muell.hover(); await P.waitForTimeout(700);
  const name = await muell.evaluate((el) => ({ label: el.getAttribute('aria-label'), title: el.getAttribute('title'), tip: el.dataset.tip }));
  pruefe('B6 „Löschen" behält nach dem Überfahren seinen Namen (title wandert in die Sprechblase, aria-label bleibt)', name.label === 'Löschen' && !name.title && /Löschen/.test(name.tip ?? ''), JSON.stringify(name));
  // Fokus-Leiste
  await P.keyboard.press('Alt+f'); await P.waitForSelector('.focus-nav'); await P.waitForTimeout(700);
  const akt = await P.evaluate(() => { const b = [...document.querySelectorAll('.focus-nav .focus-act')].find((x) => /Präsentieren/.test(x.textContent)); const s = b.querySelector('svg').getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(b); const t = [...r.getClientRects()].filter((q) => q.width > 20).pop(); return { svgMitte: s.top + s.height / 2, textMitte: t.top + t.height / 2, svgRechts: s.right, textLinks: t.left, rand: getComputedStyle(b).borderTopStyle }; });
  pruefe('B7 Fokus-Leiste „▶ Präsentieren": Zeichen und Wort stehen nebeneinander auf einer Linie', Math.abs(akt.svgMitte - akt.textMitte) < 4 && akt.svgRechts <= akt.textLinks + 1 && akt.rand === 'solid', JSON.stringify(akt));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400); await P.keyboard.press('Escape');
  // Präsentation
  await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter-dots button'); await P.waitForTimeout(500);
  const punkt = await P.evaluate(() => { const b = document.querySelector('.presenter-dots button'); const r = b.getBoundingClientRect(); const v = getComputedStyle(b, '::before'); return { w: r.width, h: r.height, bild: v.width, name: b.getAttribute('aria-label') ?? b.getAttribute('title') ?? b.dataset.tip }; });
  pruefe('B8 Punkte der Präsentation: 9 Punkte zu sehen, mindestens 24 × 32 zu treffen', punkt.w >= 24 && punkt.h >= 32 && punkt.bild === '9px', JSON.stringify(punkt));
  await P.locator('.presenter-dots button').nth(2).click(); await P.waitForTimeout(400);
  pruefe('B9 … und ein Klick springt auf die Folie', /3\s*\/\s*\d+/.test(await P.locator('.presenter-head').innerText()), await P.locator('.presenter-head').innerText());
  await P.keyboard.press('Escape');
  await ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Tablet ════');
{
  const { ctx, P } = await neu({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  await insBoard(P, 'Schreibtisch', true);
  const g = await P.evaluate(() => { const k = [...document.querySelectorAll('.react-flow__node-note')].find((n) => /Willkommen/.test(n.textContent)); const r = k.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 8]; });
  await P.touchscreen.tap(g[0], g[1]); await P.waitForSelector('.focus-head'); await P.waitForTimeout(900);
  await P.locator('.sel-toolbar button[aria-label*="Mehr"], .sel-toolbar button[aria-label*="Weitere"]').first().tap(); await P.waitForSelector('.sel-menu-fixed'); await P.waitForTimeout(350);
  const m = await P.evaluate(() => { const r = document.querySelector('.sel-menu-fixed').getBoundingClientRect(); const k = document.querySelector('.focus-head').getBoundingClientRect(); const erster = document.querySelector('.sel-menu-fixed button').getBoundingClientRect(); const oben = document.elementFromPoint(erster.left + 20, erster.top + erster.height / 2); return { top: r.top, bottom: r.bottom, kopf: k.bottom, vh: innerHeight, ersterFrei: !!oben?.closest('.sel-menu-fixed') }; });
  pruefe('C1 Kartenmenü im Fokus: ganz im Bild, unter der Kopfzeile, der erste Eintrag ist antippbar', m.top >= m.kopf && m.bottom <= m.vh && m.ersterFrei, JSON.stringify(m));
  const farbe = await P.evaluate(() => { const r = document.querySelector('.sel-menu-fixed .sel-farbe').getBoundingClientRect(); return [r.width, r.height]; });
  pruefe('C2 Farbpunkte im Menü: am Finger mindestens 36 Punkte', farbe[0] >= 36 && farbe[1] >= 36, farbe.join('×'));
  await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await P.waitForTimeout(500);
  await P.locator('[data-taste="navigator"]').first().tap().catch(() => {}); await P.waitForTimeout(600);
  const ziele = await P.evaluate(() => { const m = (q) => [...document.querySelectorAll(q)].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }); return { menue: Math.min(...m('.ebenen-menu-knopf')), pfeil: Math.min(...m('.side-board-arrow')), zahl: m('.ebenen-menu-knopf').length }; });
  pruefe('C3 Navigation: „⋮" und Aufklapp-Pfeile mindestens 40 Punkte', ziele.zahl > 0 && ziele.menue >= 40 && ziele.pfeil >= 40, JSON.stringify(ziele));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.locator('[data-taste="einstellungen"]').first().tap(); await P.waitForSelector('.modal-x');
  const x = await P.evaluate(() => { const r = document.querySelector('.modal-x').getBoundingClientRect(); return [r.width, r.height]; });
  pruefe('C4 das Schließen-Kreuz der Fenster: am Finger 44 Punkte', x[0] >= 44 && x[1] >= 44, x.join('×'));
  await ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Telefon ════');
{
  const { ctx, P } = await neu({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await P.locator('[data-taste="onb-beispiele"]').tap(); await P.waitForTimeout(1300);
  await P.evaluate(() => { const j = JSON.parse(localStorage.getItem('pixinotes-board')); j.state.view = 'overview'; localStorage.setItem('pixinotes-board', JSON.stringify(j)); });
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  const ov = await P.evaluate(() => {
    const k = [...document.querySelectorAll('.react-flow__node-ovBoard')].map((e) => e.getBoundingClientRect());
    const b = [...document.querySelectorAll('.react-flow__node-ovSpace')].map((e) => e.getBoundingClientRect());
    const ersteZeile = k.filter((r) => Math.abs(r.top - k[0].top) < 4).length;
    const kopf = document.querySelector('.ov-mode').getBoundingClientRect().bottom;
    return { kachel: k[0].width, ersteZeile, bereichLinks: b[0].left, bereichRechts: b[0].right, bereichOben: b[0].top, kopf, vw: innerWidth, schrift: parseFloat(getComputedStyle(document.querySelector('.ov-board-name')).fontSize) * (k[0].width / 200) };
  });
  pruefe('D1 Übersicht am Telefon: Kacheln mindestens 120 Punkte breit, zwei je Zeile', ov.kachel >= 120 && ov.ersteZeile === 2, JSON.stringify(ov));
  pruefe('D2 … der Bereich füllt die Breite, ragt nicht hinaus und beginnt unter den Leisten', ov.bereichLinks >= 0 && ov.bereichRechts <= ov.vw + 1 && ov.bereichRechts - ov.bereichLinks > ov.vw * 0.85 && ov.bereichOben >= ov.kopf, JSON.stringify(ov));
  pruefe('D3 … Board-Namen sind lesbar (≥ 9 Punkte auf dem Schirm)', ov.schrift >= 9, ov.schrift.toFixed(1));
  const ziel = await P.evaluate(() => { const e = [...document.querySelectorAll('.react-flow__node-ovBoard')].find((x) => /Aufgaben-Zentrale/.test(x.textContent)); const m = e.querySelector('.ov-mini-karte').getBoundingClientRect(); return [m.left + m.width / 2, m.top + m.height / 2]; });
  await P.touchscreen.tap(ziel[0], ziel[1]); await P.waitForTimeout(1200);
  pruefe('D4 ein Tipp auf die Kachel – auch mitten auf die Vorschau – öffnet das BOARD, nicht blind eine Karte im Fokus', await P.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixinotes-board')).state; return s.view === 'board' && /Aufgaben-Zentrale/.test(s.boards.find((b) => b.id === s.activeId).name) && !document.querySelector('.focus-head'); }));
  const reiter = await P.evaluate(() => [...document.querySelectorAll('.tab-home, .tab-add')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  pruefe('D5 „Übersicht" und „Neu" in der Kopfzeile: mindestens 40 Punkte', reiter.length >= 2 && Math.min(...reiter) >= 40, reiter.join());
  pruefe('D6 nichts ragt seitlich aus dem Bild', await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Diagramme und Beispiele ════');
{
  const { ctx, P } = await neu({ viewport: { width: 1440, height: 900 } });
  await insBoard(P, 'Prozesse & Mindmap');
  await P.waitForSelector('.mermaid-svg svg g.mindmap-node', { timeout: 15000 }); await P.waitForTimeout(500);
  const mm = await P.evaluate(() => {
    const karte = [...document.querySelectorAll('.mermaid-svg')].find((e) => e.querySelector('g.mindmap-node'));
    const grund = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const kanten = [...karte.querySelectorAll('path[class*="section-edge-"]')].map((p) => window.__kontrast(getComputedStyle(p).stroke, grund));
    const knoten = [...karte.querySelectorAll('g.mindmap-node')].map((g) => { const f = g.querySelector('rect, path, circle, polygon'); return f ? window.__kontrast(getComputedStyle(f).stroke, grund) : 0; });
    return { schlicht: karte.classList.contains('mm-schlicht'), kanten: kanten.length, kMin: Math.min(...kanten), knoten: knoten.length, nMin: Math.min(...knoten) };
  });
  pruefe('E1 Mindmap ohne Farbschema: jeder Ast und jeder Kasten hebt sich vom Board-Grund ab (≥ 3:1)', mm.schlicht && mm.kanten >= 8 && mm.kMin >= 3 && mm.knoten >= 9 && mm.nMin >= 3, JSON.stringify(mm));
  await insBoard(P, 'Beispielprojekt');
  await P.waitForSelector('.mermaid-svg svg', { timeout: 15000 }); await P.waitForTimeout(800);
  const pr = await P.evaluate(() => {
    const svg = document.querySelector('.mermaid-card .mermaid-svg svg').getBoundingClientRect();
    const fl = document.querySelector('.mermaid-card .mermaid-preview'); const f = fl.getBoundingClientRect();
    const rahmen = document.querySelector('.react-flow__node-frame').getBoundingClientRect();
    const kanban = document.querySelector('.react-flow__node-kanban').getBoundingClientRect();
    return { passt: svg.top >= f.top - 1 && svg.bottom <= f.bottom + 1 && svg.left >= f.left - 1 && svg.right <= f.right + 1, rollt: fl.scrollHeight > fl.clientHeight + 2, imRahmen: kanban.top >= rahmen.top && kanban.bottom <= rahmen.bottom && kanban.left >= rahmen.left && kanban.right <= rahmen.right, k: [kanban.top, kanban.bottom], r: [rahmen.top, rahmen.bottom] };
  });
  pruefe('E2 ein hohes Ablaufdiagramm passt ganz in seine Karte – nichts abgeschnitten, nichts zu rollen', pr.passt && !pr.rollt, JSON.stringify(pr));
  pruefe('E3 Beispielprojekt: Das Kanban liegt (mit den übernommenen Aufgaben) im Rahmen „Umsetzung"', pr.imRahmen, JSON.stringify(pr));
  await ctx.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Aufgeräumt, Texte ════');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
const css = quelle('src/index.css');
const tot = ['about-menu', 'tab-picker-liste', 'card-x', 'dock-tasks', 'side-board-pen', 'mm-pop-wrap', 'legal-link', 'sel-badge'];
pruefe('F1 tote Klassen stehen nicht mehr im Stylesheet', tot.every((k) => !new RegExp(`\\.${k}(?![\\w-])`).test(css)), tot.filter((k) => new RegExp(`\\.${k}(?![\\w-])`).test(css)).join());
pruefe('F2 die Sammel-Regeln, in denen sie standen, gelten weiter (Griffe bei weitem Zoom unsichtbar)', /\[data-weit\] \.react-flow__node :is\(\.card-grip, \.color-dot, \.note-farben, \.fit-hint\)/.test(css) && /html\[data-alles-zeigen\] :is\(\.react-flow__resize-control, \.pn-handle, \.card-grip/.test(css));
pruefe('F3 Hilfe nennt M389 – deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M389)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M389)'));
pruefe('F4 docs/AUDIT.md führt die UI-Funde; docs/UMBAU.md nennt M389', /## 2 · UI-Audit \(M389\)\s+\S/.test(quelle('docs/AUDIT.md')) && quelle('docs/AUDIT.md').includes('U1') && quelle('docs/UMBAU.md').includes('M389'));
pruefe('F5 keine Fehler der Seite', fehler.length === 0, fehler.join(' | '));

await browser.close(); app.close();
console.log(`\nm389-ui-audit: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
