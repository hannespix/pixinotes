/**
 * M530 — Board, Rahmen und Präsentation: die offenen Punkte aus M514, M521 und M523, als Verhalten gemessen.
 *
 *   A  Strg+V im Karten-Fokus: Text und Bild gehen in die offene Notiz (ans Ende ihres Texts), es entsteht keine
 *      Karte hinter ihr; bei einer anderen Karte (Bild) ein Hinweis, und nichts passiert. Ohne Fokus wie bisher.
 *   B  Strg+D am Rahmen: Rahmen samt Inhalt (auch archiviertem), Verbindungen zwischen den Karten kommen mit, der
 *      Rahmenpfeil nicht doppelt; ein Strg+Z nimmt alles zurück. Ein Rahmen allein lässt sich über sein Menü
 *      duplizieren und mit Inhalt auf ein anderes Board verschieben.
 *   C  Rahmen-Reise: Beendet per Alt+Umschalt+P bei offener Aufgaben-Zentrale → danach die Ansicht von VOR der Reise
 *      (vorher: Ausschnitt des letzten Rahmens), Oberfläche wieder da; F passt den aktuellen Rahmen ein (nicht das
 *      ganze Board); 0 im Karten-Fokus passt die Karte wieder ein (vorher 100 %, die Karte halb im Bild).
 *   D  Reihenfolge der Ausgänge: An einem Rahmen mit zwei Rahmenpfeilen legt das Rahmen-Menü fest, welcher Ausgang
 *      zuerst drankommt — die Reise folgt, die Nummernmarken folgen, Strg+Z nimmt es zurück.
 *   E  Esc mit Stift in der Hand und offenem Fenster schließt erst das Fenster; das zweite Esc legt den Stift weg.
 *   F  Präsentation: Strg+K, Esc schließt nur die Suche; das nächste Esc die Präsentation.
 *   G  Esc-Stapel: Bild-Export und „Per Link teilen" unter der Hilfe — Esc schließt erst die Hilfe.
 *   H  Board löschen: keine Browser-Rückfrage, sondern ein Hinweis mit „Rückgängig"; das Board kommt mit Inhalt an
 *      seine Stelle zurück. Das letzte sichtbare Board bleibt.
 */
// Läuft aus dem Repository: `node pruefungen/m530-board-praesentation.mjs [A B …]` (gegen einen anderen Build: PN_DIST=…)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5530;
const NUR = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());
const will = (x) => NUR.length === 0 || NUR.includes(x);
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

const nz = (id, x, y, farbe = 'yellow', w = 200, h = 120) => ({ id, type: 'note', width: w, height: h, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
const fr = (id, x, y, w, h, name = id) => ({ id, type: 'frame', width: w, height: h, position: { x, y }, data: { name } });
const kt = (id, s, t, kind = 'arrow') => ({ id, source: s, target: t, type: 'labeled', data: { label: '', kind } });
const stand = (nodes, edges = [], drawings = []) => ({
  boards: [{ id: 'b1', name: 'Erstes', comments: [], edges, drawings, nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});

async function seite(st, { navLinks = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript(({ st, navLinks }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-stapel-gelernt', '1');
  }, { st, navLinks });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const dialoge = [];
  P.on('dialog', (d) => { dialoge.push(d.message()); void d.accept(); });
  // Hinweise mitschreiben (kurze Toasts nicht hinterher abfragen, M484)
  await ctx.addInitScript(() => {
    window.__hinweise = [];
    new MutationObserver(() => { const t = document.querySelector('.toast.show'); const s = t?.textContent?.trim(); if (s && window.__hinweise[window.__hinweise.length - 1] !== s) window.__hinweise.push(s); })
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1200);
  return { ctx, P, dialoge };
}
const alleBoards = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards);
const brett = async (P, id = 'b1') => (await alleBoards(P)).find((b) => b.id === id);
const standBis = async (P, bed, ms = 9000, id = 'b1') => {
  const bis = Date.now() + ms; let b = await brett(P, id);
  while (!bed(b) && Date.now() < bis) { await P.waitForTimeout(150); b = await brett(P, id); }
  return b;
};
const standRuhig = async (P, ms = 6000) => {
  let alt = JSON.stringify(await alleBoards(P)); const bis = Date.now() + ms;
  for (let gleich = 0; gleich < 5 && Date.now() < bis;) { await P.waitForTimeout(200); const neu = JSON.stringify(await alleBoards(P)); gleich = neu === alt ? gleich + 1 : 0; alt = neu; }
  return JSON.parse(alt).find((b) => b.id === 'b1');
};
const kasten = (P, sel) => P.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
const karte = (P, id) => kasten(P, `.react-flow__node[data-id="${id}"]`);
const ansicht = (P) => P.evaluate(() => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? ''); return m ? { x: +m[1], y: +m[2], zoom: +m[3] } : null; });
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`) ?? document.querySelector(`.react-flow__node[data-id="${id}"] .frame-head`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const leer = (P) => P.mouse.click(1415, 780).then(() => P.waitForTimeout(250));
const warteBis = async (P, fn, arg, ms = 8000) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const waehle = async (P, id) => { const g = await griff(P, id); await P.mouse.click(g[0], g[1]); return warteBis(P, (id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains('selected'), id); };
const nah = (a, b, t = 1.5) => Math.abs(a - b) <= t;
const gleicheAnsicht = (a, b, t = 2) => !!a && !!b && nah(a.x, b.x, t) && nah(a.y, b.y, t) && nah(a.zoom, b.zoom, 0.01);
const ansichtBis = async (P, v0, ms = 8000) => { const bis = Date.now() + ms; let v = await ansicht(P); while (Date.now() < bis && !gleicheAnsicht(v, v0)) { await P.waitForTimeout(150); v = await ansicht(P); } return v; };
const hinweise = (P) => P.evaluate(() => window.__hinweise.slice());
/** Einfügen wie Strg+V: ein paste-Ereignis am Element mit dem Fokus (der Weg, den der Browser nimmt) */
const einfuegen = (P, text, bild = false) => P.evaluate(([text, bild]) => {
  const dt = new DataTransfer();
  if (text) dt.setData('text/plain', text);
  if (bild) {
    // 1×1 rotes PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], 'bildschirm.png', { type: 'image/png' }));
  }
  const ziel = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  ziel.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [text, bild]);
const fokusAuf = async (P, id) => {
  const r = await karte(P, id); await P.mouse.dblclick(r.cx, r.cy);
  await P.waitForSelector('.focus-head'); await P.waitForTimeout(900);
};
const reiseGelandet = async (P) => { await warteBis(P, () => !!document.querySelector('.rahmen-reise-leiste') && !document.querySelector('[data-reise-flug]'), null, 12000); await P.waitForTimeout(500); };
const reiseZahl = (P) => P.evaluate(() => document.querySelector('[data-taste="reise-zahl"]')?.textContent?.trim() ?? '');
const reiseTitel = (P) => P.evaluate(() => document.querySelector('.rr-titel')?.textContent?.trim() ?? '');
const rahmenMenue = async (P, id) => {
  await waehle(P, id);
  await P.waitForSelector('.sel-toolbar button[title^="Rahmen:"]');
  await P.click('.sel-toolbar button[title^="Rahmen:"]');
  await P.waitForSelector('.sel-frame-menu');
};

/* ═══════════════════════ A: Strg+V im Karten-Fokus ═══════════════════════ */
if (will('A')) {
  console.log('\n════ A: Strg+V im Karten-Fokus ════');
  const SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#3b82f6"/></svg>');
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 400, 0, 'sky'), { id: 'img', type: 'image', width: 300, height: 150, position: { x: 0, y: 300 }, data: { src: SVG, name: 'bild.svg' } }]));
  await fokusAuf(P, 'a');
  await P.evaluate(() => (document.activeElement)?.blur?.());
  await einfuegen(P, 'Aus der Zwischenablage');
  let b = await standBis(P, (b) => JSON.stringify(b.nodes.find((n) => n.id === 'a')?.data.blocks ?? '').includes('Aus der Zwischenablage'));
  pruefe('A1 im Fokus einer Notiz landet eingefügter Text in der Notiz', JSON.stringify(b.nodes.find((n) => n.id === 'a')?.data.blocks ?? '').includes('Aus der Zwischenablage'), b.nodes.find((n) => n.id === 'a')?.data.blocks);
  pruefe('A2 … am Ende, der alte Text bleibt davor', /"a".*Aus der Zwischenablage/.test(JSON.stringify(b.nodes.find((n) => n.id === 'a')?.data.blocks)), JSON.stringify(b.nodes.find((n) => n.id === 'a')?.data.blocks).slice(0, 400));
  b = await standRuhig(P, 3000);
  pruefe('A3 … und es entsteht keine Karte hinter der offenen', b.nodes.length === 3, b.nodes.map((n) => n.id));
  await P.evaluate(() => (document.activeElement)?.blur?.());
  await einfuegen(P, '', true);
  b = await standBis(P, (b) => JSON.stringify(b.nodes.find((n) => n.id === 'a')?.data.blocks ?? '').includes('"image"'));
  pruefe('A4 ein Bild aus der Zwischenablage geht als Bild in die offene Notiz', JSON.stringify(b.nodes.find((n) => n.id === 'a')?.data.blocks ?? '').includes('"image"'));
  b = await standRuhig(P, 3000);
  pruefe('A5 … ohne Bild-Karte dahinter', b.nodes.length === 3, b.nodes.map((n) => n.id));
  pruefe('A5b … der Schreib-Cursor steht danach in der Notiz', await P.evaluate(() => !!document.activeElement?.closest?.('.react-flow__node[data-id="a"]')));
  if (process.env.M530_LAUT) await P.screenshot({ path: '/tmp/claude-0/-home-user/8324834f-7a3e-5ea9-817c-d2ce94780763/scratchpad/m530/a5.png' });
  // Esc: Bild-Leiste, Text, Fokus — der Reihe nach
  for (let i = 0; i < 4 && await P.evaluate(() => !!document.querySelector('.focus-head')); i += 1) { await P.keyboard.press('Escape'); await P.waitForTimeout(400); }
  await warteBis(P, () => !document.querySelector('.focus-head'));
  await P.waitForTimeout(700);
  // Eine Karte, die nichts annimmt
  await fokusAuf(P, 'img');
  await P.evaluate(() => (document.activeElement)?.blur?.());
  if (process.env.M530_LAUT) console.log('vorher', await P.evaluate(() => ({ akt: document.activeElement?.className, fok: document.querySelector('.pn-focused')?.getAttribute('data-id') })));
  await einfuegen(P, 'Hinter dem Bild');
  await warteBis(P, () => window.__hinweise.some((h) => /nichts einfügen/.test(h)));
  if (process.env.M530_LAUT) console.log(await P.evaluate(() => ({ fenster: [...document.querySelectorAll('.modal-backdrop, .ticket-modal-backdrop, .pdf-backdrop, .search-backdrop, .onb-backdrop, .lookup-backdrop, .presenter, .qr-blende.gross')].map((e) => e.className), akt: document.activeElement?.className, toast: document.querySelector('.toast')?.outerHTML?.slice(0, 300) })));
  pruefe('A6 im Fokus eines Bilds sagt ein Hinweis, dass dort nichts eingefügt wird', (await hinweise(P)).some((h) => /nichts einfügen/.test(h)), await hinweise(P));
  b = await standRuhig(P, 3000);
  pruefe('A7 … und es entsteht keine Notiz hinter der offenen Karte', b.nodes.length === 3, b.nodes.map((n) => n.id));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.focus-head'));
  await P.waitForTimeout(700); await leer(P);
  await einfuegen(P, 'Auf der Flaeche');
  b = await standBis(P, (b) => b.nodes.length === 4);
  pruefe('A8 ohne Fokus wird eingefügter Text wie bisher zur Notiz auf dem Board', b.nodes.length === 4, b.nodes.length);
  await ctx.close();
}

/* ═══════════════════════ B: Rahmen duplizieren und verschieben ═══════════════════════ */
if (will('B')) {
  console.log('\n════ B: Rahmen samt Inhalt duplizieren und verschieben ════');
  const st = stand([fr('F', 0, 0, 700, 420, 'Rahmen'), nz('a', 40, 60), nz('c', 360, 60, 'sky'), { ...nz('arch', 40, 260, 'green'), archived: true }, fr('G', 900, 0, 400, 300, 'Zweiter'), nz('x', 950, 60, 'pink')],
    [kt('ac', 'a', 'c'), kt('FG', 'F', 'G')]);
  st.boards.push({ id: 'b2', name: 'Zielboard', comments: [], edges: [], drawings: [], nodes: [nz('z1', 0, 0)] });
  st.spaces[0].projects[0].boardIds.push('b2');
  const { ctx, P } = await seite(st);
  await waehle(P, 'F');
  await P.keyboard.press('Control+d');
  let b = await standBis(P, (b) => b.nodes.length >= 10);
  const neu = b.nodes.filter((n) => !['F', 'a', 'c', 'arch', 'G', 'x'].includes(n.id));
  const kopieF = neu.find((n) => n.type === 'frame');
  pruefe('B1 Strg+D am gewählten Rahmen kopiert den Rahmen samt Inhalt', !!kopieF && neu.length === 4 && neu.filter((n) => n.type === 'note').length === 3, neu.map((n) => `${n.type}:${n.id}`));
  pruefe('B2 … die archivierte Karte darin auch (archiviert)', neu.some((n) => n.archived && n.data.blocks?.[0]?.content === 'arch'));
  const neuIds = new Set(neu.map((n) => n.id));
  const neueKanten = b.edges.filter((e) => neuIds.has(e.source) || neuIds.has(e.target));
  pruefe('B3 … die Verbindung zwischen den Karten kommt mit', neueKanten.some((e) => neuIds.has(e.source) && neuIds.has(e.target)), neueKanten);
  pruefe('B4 … der Rahmenpfeil nicht doppelt', b.edges.filter((e) => e.target === 'G' || e.source === kopieF?.id).length === 1, b.edges);
  pruefe('B5 … die Kopie liegt versetzt, die Karten bleiben in ihrem Rahmen', !!kopieF && kopieF.position.x === 30 && kopieF.position.y === 30
    && neu.filter((n) => n.type === 'note').every((n) => n.position.x > kopieF.position.x && n.position.x < kopieF.position.x + 700));
  await P.keyboard.press('Control+z');
  b = await standBis(P, (b) => b.nodes.length === 6);
  pruefe('B6 ein Strg+Z nimmt die ganze Kopie zurück', b.nodes.length === 6 && b.edges.length === 2, { n: b.nodes.length, e: b.edges.length });
  // Rahmen allein: Menü → Duplizieren und In Board verschieben
  await leer(P);
  await rahmenMenue(P, 'G');
  pruefe('B7 im Rahmen-Menü eines Rahmens allein stehen Duplizieren und Verschieben', await P.evaluate(() => !!document.querySelector('[data-taste="rahmen-duplizieren"]') && !!document.querySelector('[data-taste="rahmen-verschieben"]')));
  await P.click('[data-taste="rahmen-duplizieren"]');
  b = await standBis(P, (b) => b.nodes.length === 8);
  pruefe('B8 „Duplizieren" im Rahmen-Menü kopiert Rahmen und Karte', b.nodes.length === 8 && b.nodes.filter((n) => n.type === 'frame').length === 3, b.nodes.map((n) => n.id));
  await P.keyboard.press('Control+z');
  await standBis(P, (b) => b.nodes.length === 6);
  await leer(P);
  await rahmenMenue(P, 'G');
  await P.click('[data-taste="rahmen-verschieben"]');
  await warteBis(P, () => [...document.querySelectorAll('button[title]')].some((x) => / › Zielboard$/.test(x.title)));
  await P.evaluate(() => [...document.querySelectorAll('button[title]')].find((x) => / › Zielboard$/.test(x.title))?.click());
  const bis = Date.now() + 8000; let s = await alleBoards(P);
  while (Date.now() < bis && !s[1].nodes.some((n) => n.id === 'G')) { await P.waitForTimeout(150); s = await alleBoards(P); }
  pruefe('B9 der Rahmen allein zieht mit seinem Inhalt auf das andere Board', s[1].nodes.some((n) => n.id === 'G') && s[1].nodes.some((n) => n.id === 'x') && !s[0].nodes.some((n) => n.id === 'G' || n.id === 'x'),
    s.map((bb) => bb.nodes.map((n) => n.id)));
  await ctx.close();
}

/* ═══════════════════════ C: Rahmen-Reise und Zoom-Tasten ═══════════════════════ */
if (will('C')) {
  console.log('\n════ C: Rahmen-Reise — Ende bei offener Zentrale, F, 0 im Fokus ════');
  const { ctx, P } = await seite(stand([fr('F1', 0, 0, 500, 320, 'Eins'), nz('a', 40, 60), fr('F2', 700, 0, 500, 320, 'Zwei'), nz('b', 740, 60), nz('c', 0, 500)]));
  const v0 = await ansicht(P);
  await P.keyboard.press('Alt+Shift+P'); await reiseGelandet(P);
  await P.keyboard.press('Alt+t');
  await warteBis(P, () => !document.querySelector('.react-flow__viewport'));
  await P.keyboard.press('Alt+Shift+P');                 // Reise beenden, während die Zentrale offen ist
  await P.waitForTimeout(400);
  await P.keyboard.press('Alt+t');
  await P.waitForSelector('.react-flow__node');
  const v = await ansichtBis(P, v0);
  pruefe('C1 Reise per Kürzel bei offener Aufgaben-Zentrale beendet: danach die Ansicht von vor der Reise', gleicheAnsicht(v, v0), { v0, v });
  pruefe('C2 … die Oberfläche ist wieder da, keine Reise-Leiste', await P.evaluate(() => !('nurBoard' in document.documentElement.dataset) && !document.querySelector('.rahmen-reise-leiste')));
  // F in der Reise
  await P.keyboard.press('Alt+Shift+P'); await reiseGelandet(P);
  const vRahmen = await ansicht(P);
  await P.mouse.move(700, 450);
  await P.mouse.wheel(0, 300);                           // weggeschwenkt
  await P.waitForTimeout(500);
  const vWeg = await ansicht(P);
  await P.keyboard.press('f');
  await P.waitForTimeout(200);
  const vF = await ansichtBis(P, vRahmen, 6000);
  pruefe('C3 F in der Reise passt den aktuellen Rahmen ein (nicht das ganze Board)', !gleicheAnsicht(vWeg, vRahmen) && gleicheAnsicht(vF, vRahmen, 3), { vRahmen, vWeg, vF });
  pruefe('C4 … und die Reise läuft weiter', (await reiseZahl(P)) === '1 / 2', await reiseZahl(P));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.rahmen-reise-leiste'));
  await P.waitForTimeout(800);
  // 0 im Karten-Fokus
  await fokusAuf(P, 'c');
  await P.evaluate(() => (document.activeElement)?.blur?.());
  const vFokus = await ansicht(P);
  await P.keyboard.press('+'); await P.waitForTimeout(250); await P.keyboard.press('+'); await P.waitForTimeout(600);
  const vGross = await ansicht(P);
  await P.keyboard.press('0');
  await P.waitForTimeout(200);
  const vNull = await ansichtBis(P, vFokus, 6000);
  pruefe('C5 0 im Karten-Fokus passt die Karte wieder ein (wie beim Öffnen), statt 100 %', !gleicheAnsicht(vGross, vFokus) && gleicheAnsicht(vNull, vFokus, 3), { vFokus, vGross, vNull });
  pruefe('C6 … der Fokus bleibt offen', await P.evaluate(() => !!document.querySelector('.focus-head')));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.focus-head'));
  await P.waitForTimeout(700);
  await P.keyboard.press('+'); await P.waitForTimeout(400);
  await P.keyboard.press('0'); await P.waitForTimeout(600);
  pruefe('C7 ohne Fokus stellt 0 weiter 100 % ein', nah((await ansicht(P)).zoom, 1, 0.02), await ansicht(P));
  await ctx.close();
}

/* ═══════════════════════ D: Reihenfolge der Ausgänge ═══════════════════════ */
if (will('D')) {
  console.log('\n════ D: Reihenfolge an einer Verzweigung der Rahmenpfeile ════');
  // A verzweigt zu B (zuerst gezogen) und C
  const { ctx, P } = await seite(stand([fr('A', 0, 0, 400, 260, 'Anfang'), fr('B', 600, 0, 400, 260, 'Bach'), fr('C', 0, 500, 400, 260, 'Chor')],
    [kt('AB', 'A', 'B'), kt('AC', 'A', 'C')]));
  const zweiter = async () => {
    await P.keyboard.press('Alt+Shift+P'); await reiseGelandet(P);
    await P.keyboard.press('ArrowRight'); await reiseGelandet(P);
    const t = await reiseTitel(P);
    await P.keyboard.press('Escape'); await warteBis(P, () => !document.querySelector('.rahmen-reise-leiste')); await P.waitForTimeout(700);
    return t;
  };
  await waehle(P, 'A');
  pruefe('D1 ohne Festlegung folgt die Reise dem zuerst gezogenen Pfeil (Bach)', (await zweiter()) === 'Bach');
  await leer(P);
  await rahmenMenue(P, 'A');
  const liste = await P.evaluate(() => [...document.querySelectorAll('[data-taste="ausgang-vor"]')].map((b) => b.textContent.trim()));
  pruefe('D2 das Rahmen-Menü zeigt die Reihenfolge der Ausgänge', liste.length === 2 && /1\.\s*Bach/.test(liste[0]) && /2\.\s*Chor/.test(liste[1]), liste);
  await P.evaluate(() => document.querySelectorAll('[data-taste="ausgang-vor"]')[1].click());
  const b = await standBis(P, (b) => b.edges.find((e) => e.id === 'AC')?.data.folge === 0);
  pruefe('D3 „nach vorn" legt die Reihenfolge am Pfeil fest', b.edges.find((e) => e.id === 'AC')?.data.folge === 0 && b.edges.find((e) => e.id === 'AB')?.data.folge === 1, b.edges);
  await P.keyboard.press('Escape'); await leer(P);
  await waehle(P, 'A');
  pruefe('D4 die Reise nimmt jetzt zuerst Chor', (await zweiter()) === 'Chor');
  const marken = await P.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-reise-nr]')].map((e) => [e.closest('[data-id]')?.getAttribute('data-id') ?? e.getAttribute('data-id') ?? '?', e.getAttribute('data-reise-nr')])));
  const nrText = await P.evaluate(() => [...document.querySelectorAll('.rahmenpfeil-nr')].map((e) => e.textContent.trim()).sort().join(','));
  pruefe('D5 die Nummernmarken folgen (2 am Pfeil zu Chor, „–" am Abzweig)', nrText === '–,2' || nrText === '2,–', { nrText, marken });
  await leer(P);
  await P.keyboard.press('Control+z');
  await standBis(P, (b) => b.edges.find((e) => e.id === 'AC')?.data.folge === undefined);
  await waehle(P, 'A');
  pruefe('D6 Strg+Z nimmt die Reihenfolge zurück', (await zweiter()) === 'Bach');
  await ctx.close();
}

/* ═══════════════════════ E: Esc mit Stift in der Hand ═══════════════════════ */
if (will('E')) {
  console.log('\n════ E: Esc mit Stift und offenem Fenster ════');
  const { ctx, P } = await seite(stand([nz('a', 0, 0)]));
  const stiftAn = () => P.evaluate(() => { const l = document.querySelector('svg.drawing-layer'); return !!l && getComputedStyle(l).pointerEvents === 'auto'; });
  await leer(P);
  await P.keyboard.press('p');
  await warteBis(P, () => { const l = document.querySelector('svg.drawing-layer'); return !!l && getComputedStyle(l).pointerEvents === 'auto'; });
  pruefe('E1 P nimmt den Stift', await stiftAn());
  await P.keyboard.press('Alt+h');
  await P.waitForSelector('.help-modal');
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(600);
  pruefe('E2 erstes Esc schließt die Hilfe', await P.evaluate(() => !document.querySelector('.help-modal')));
  pruefe('E3 … der Stift bleibt in der Hand', await stiftAn());
  await P.keyboard.press('Escape');
  await warteBis(P, () => { const l = document.querySelector('svg.drawing-layer'); return !l || getComputedStyle(l).pointerEvents !== 'auto'; });
  pruefe('E4 das zweite Esc legt den Stift weg', !(await stiftAn()));
  await ctx.close();
}

/* ═══════════════════════ F: Suche in der Präsentation ═══════════════════════ */
if (will('F')) {
  console.log('\n════ F: Strg+K in der Präsentation ════');
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 400, 0, 'sky')]));
  await leer(P);
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter'); await P.waitForTimeout(600);
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-backdrop'); await P.waitForTimeout(400);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(700);
  pruefe('F1 Esc schließt die Suche', await P.evaluate(() => !document.querySelector('.search-backdrop')));
  pruefe('F2 … die Präsentation bleibt offen', await P.evaluate(() => !!document.querySelector('.presenter')));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.presenter'));
  pruefe('F3 das nächste Esc beendet die Präsentation', await P.evaluate(() => !document.querySelector('.presenter')));
  // Der Fokus steht nicht im Suchfeld (Klick in die Trefferliste, Tab weiter): Esc ging bisher an beide
  await leer(P);
  await P.keyboard.press('Alt+p');
  await P.waitForSelector('.presenter'); await P.waitForTimeout(600);
  await P.keyboard.press('Control+k');
  await P.waitForSelector('.search-backdrop'); await P.waitForTimeout(400);
  await P.evaluate(() => (document.activeElement)?.blur?.());
  await P.keyboard.press('Escape');
  await P.waitForTimeout(700);
  pruefe('F4 Fokus außerhalb des Suchfelds: Esc schließt nur die Suche, die Präsentation bleibt',
    await P.evaluate(() => !document.querySelector('.search-backdrop') && !!document.querySelector('.presenter')));
  await P.keyboard.press('Escape');
  await warteBis(P, () => !document.querySelector('.presenter'));
  await ctx.close();
}

/* ═══════════════════════ G: Esc-Stapel ═══════════════════════ */
if (will('G')) {
  console.log('\n════ G: Esc gehört dem obersten Fenster ════');
  const { ctx, P } = await seite(stand([nz('a', 0, 0)]), { navLinks: true });
  const helpOffen = () => P.evaluate(() => !!document.querySelector('.help-modal'));
  // Bild-Export, darüber die Hilfe
  await leer(P);
  await P.evaluate(() => document.querySelector('.dock button[aria-label="Mehr"]')?.click());
  await warteBis(P, () => !!document.querySelector('button[aria-label="Als Bild exportieren"]'));
  await P.click('button[aria-label="Als Bild exportieren"]');
  await P.waitForSelector('.modal-backdrop');
  await P.keyboard.press('Alt+h');
  await warteBis(P, () => !!document.querySelector('.help-modal'));
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape'); await P.waitForTimeout(600);
  pruefe('G1 Bild-Export unter der Hilfe: Esc schließt nur die Hilfe', !(await helpOffen()) && await P.evaluate(() => [...document.querySelectorAll('.modal-backdrop')].some((m) => /Bild/.test(m.textContent))));
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
  pruefe('G2 … das zweite Esc den Bild-Export', await P.evaluate(() => !document.querySelector('.modal-backdrop')));
  // Per Link teilen, darüber die Hilfe
  await P.evaluate(() => document.querySelector('.side-board.active .ebenen-menu-knopf')?.click());
  const linkDa = await warteBis(P, () => !!document.querySelector('[data-taste="board-link"]'), null, 4000);
  if (linkDa) {
    await P.click('[data-taste="board-link"]');
    await P.waitForSelector('.modal-backdrop');
    await P.keyboard.press('Alt+h');
    await warteBis(P, () => !!document.querySelector('.help-modal'));
    await P.waitForTimeout(400);
    await P.keyboard.press('Escape'); await P.waitForTimeout(600);
    pruefe('G3 „Per Link teilen" unter der Hilfe: Esc schließt nur die Hilfe', !(await helpOffen()) && await P.evaluate(() => !!document.querySelector('.modal-backdrop')));
    await P.keyboard.press('Escape'); await P.waitForTimeout(500);
    pruefe('G4 … das zweite Esc den Link-Dialog', await P.evaluate(() => !document.querySelector('.modal-backdrop')));
  } else pruefe('G3 Board-Menü mit „Per Link teilen" erreichbar', false);
  await ctx.close();
}

/* ═══════════════════════ H: Board löschen mit Rückgängig ═══════════════════════ */
if (will('H')) {
  console.log('\n════ H: Board löschen — Hinweis mit Rückgängig statt Browser-Rückfrage ════');
  const st = stand([nz('a', 0, 0), nz('b', 400, 0, 'sky')], [kt('ab', 'a', 'b')]);
  st.boards.push({ id: 'b2', name: 'Zweites', comments: [], edges: [], drawings: [], nodes: [nz('z1', 0, 0)] });
  st.boards.push({ id: 'b3', name: 'Drittes', comments: [], edges: [], drawings: [], nodes: [] });
  st.spaces[0].projects[0].boardIds.push('b2', 'b3');
  const { ctx, P, dialoge } = await seite(st, { navLinks: true });
  const loeschen = async (name) => {
    await P.evaluate((name) => {
      const z = [...document.querySelectorAll('.side-board')].find((e) => e.querySelector('.side-board-name')?.textContent === name);
      z?.querySelector('.ebenen-menu-knopf')?.click();
    }, name);
    await warteBis(P, () => [...document.querySelectorAll('[role="menuitem"]')].some((b) => /Löschen/.test(b.textContent)), null, 4000);
    await P.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Löschen/.test(b.textContent))?.click());
  };
  await loeschen('Erstes');
  const s1 = await standBisAlle(P, (bs) => !bs.some((b) => b.id === 'b1'));
  pruefe('H1 Board „Erstes" ist gelöscht — ohne Browser-Rückfrage', !s1.some((b) => b.id === 'b1') && dialoge.length === 0, { boards: s1.map((b) => b.id), dialoge });
  await warteBis(P, () => /Erstes.*gelöscht/.test(document.querySelector('.toast.show')?.textContent ?? '') && !!document.querySelector('.toast.show .toast-undo'));
  pruefe('H2 der Hinweis nennt das Board und bietet „Rückgängig"', await P.evaluate(() => /Erstes.*gelöscht/.test(document.querySelector('.toast.show')?.textContent ?? '') && !!document.querySelector('.toast.show .toast-undo')));
  await P.click('.toast.show .toast-undo');
  const s2 = await standBisAlle(P, (bs) => bs.some((b) => b.id === 'b1'));
  const zurueck = s2.find((b) => b.id === 'b1');
  pruefe('H3 „Rückgängig" holt das Board mit Inhalt und Verbindung zurück', !!zurueck && zurueck.nodes.length === 2 && zurueck.edges.length === 1, zurueck);
  const hier = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
  pruefe('H4 … an seine Stelle im Projekt, wieder offen', hier.spaces[0].projects[0].boardIds.join(',') === 'b1,b2,b3' && hier.activeId === 'b1', { ids: hier.spaces[0].projects[0].boardIds, aktiv: hier.activeId });
  await P.waitForSelector('.react-flow__node[data-id="a"]');
  pruefe('H5 die Karten stehen wieder auf der Fläche', await P.locator('.react-flow__node').count() === 2);
  await ctx.close();
}

async function standBisAlle(P, bed, ms = 9000) {
  const bis = Date.now() + ms; let b = await alleBoards(P);
  while (!bed(b) && Date.now() < bis) { await P.waitForTimeout(150); b = await alleBoards(P); }
  return b;
}

await browser.close();
app.close();
if (fehler.length) { bad += 1; console.log('  ✗ Fehler auf der Seite:', fehler.slice(0, 5)); } else console.log('\n  ✓ keine Fehler auf der Seite');
console.log(`\n${ok} ✓, ${bad} ✗`);
process.exit(bad ? 1 : 0);
