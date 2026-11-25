/**
 * M538 — Schlussrunde nach dem Audit: die letzten offenen Punkte aus M529, M530, M532 und M533, als Verhalten gemessen.
 *
 *   D  Strg+D im Karten-Fokus legt keine Kopie unsichtbar hinter die offene Karte, sondern sagt, wie es geht; ohne
 *      Fokus dupliziert Strg+D wie bisher.
 *   A  Verwaiste Einträge der Geräte-Ablage (M532): erst nach der Schonfrist gelöscht, nie, solange Rückgängig, eine
 *      Rettungskopie oder ein anderes Bild sie nennt.
 *   B  Ein anderes Fenster räumt auf, während hier Rückgängig das Bild noch kennt: Nach Strg+Z liegt der Inhalt wieder
 *      in der Ablage, das Bild ist nach dem Neuladen da.
 *   F  Speicherformat: Eine Fassung, die eine neuere Marke findet, schreibt nichts und sagt es.
 *   R  Ein Stand von außen (WebDAV) mit Verweisen statt Bildern (eine ältere App-Fassung): Die Bilder bleiben, der
 *      nächste Upload trägt wieder die ganzen Bilder.
 *
 * Läuft aus dem Repository: `node pruefungen/m538-schlussrunde.mjs [D A B F R]` (gegen einen anderen Build: PN_DIST=…)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = Number(process.env.M538_PORT ?? 5538);
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
const stand = (nodes, edges = [], drawings = []) => ({
  boards: [{ id: 'b1', name: 'Erstes', comments: [], edges, drawings, nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});

async function seite(st) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    localStorage.setItem('pixinotes-stapel-gelernt', '1');
  }, { st });
  // Hinweise mitschreiben (kurze Toasts nicht hinterher abfragen, M484)
  await ctx.addInitScript(() => {
    window.__hinweise = [];
    new MutationObserver(() => { const t = document.querySelector('.toast.show'); const s = t?.textContent?.trim(); if (s && window.__hinweise[window.__hinweise.length - 1] !== s) window.__hinweise.push(s); })
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(1200);
  return { ctx, P };
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
const kasten = (P, sel) => P.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
const karte = (P, id) => kasten(P, `.react-flow__node[data-id="${id}"]`);
const griff = (P, id) => P.evaluate((id) => { const g = document.querySelector(`.react-flow__node[data-id="${id}"] .card-grip`); const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
const warteBis = async (P, fn, arg, ms = 8000) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
const waehle = async (P, id) => { const g = await griff(P, id); await P.mouse.click(g[0], g[1]); return warteBis(P, (id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains('selected'), id); };
const hinweise = (P) => P.evaluate(() => window.__hinweise.slice());
const fokusAuf = async (P, id) => {
  const r = await karte(P, id); await P.mouse.dblclick(r.cx, r.cy);
  await P.waitForSelector('.focus-head'); await P.waitForTimeout(900);
};

/* ═══════════════════════ D: Strg+D im Karten-Fokus ═══════════════════════ */
if (will('D')) {
  console.log('\n════ D: Strg+D im Karten-Fokus ════');
  const { ctx, P } = await seite(stand([nz('a', 0, 0), nz('b', 400, 0, 'sky')]));
  await fokusAuf(P, 'a');
  // Der Tastatur-Fokus liegt mal im Text, mal auf der Karte — beides prüfen
  await P.evaluate(() => (document.activeElement)?.blur?.());
  await P.keyboard.press('Control+d');
  await warteBis(P, () => window.__hinweise.some((h) => /nicht dupliziert/.test(h)));
  pruefe('D1 Strg+D im Fokus sagt, dass die offene Karte nicht dupliziert wird', (await hinweise(P)).some((h) => /nicht dupliziert.*Esc/.test(h)), await hinweise(P));
  let b = await standRuhig(P, 3000);
  pruefe('D2 … und legt keine Kopie hinter die offene Karte', b.nodes.length === 2, b.nodes.map((n) => n.id));
  const imText = await P.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="a"] [contenteditable="true"]'); if (!e) return false; e.focus(); return document.activeElement === e; });
  if (imText) {
    await P.keyboard.press('Control+d');
    b = await standRuhig(P, 3000);
    pruefe('D3 … auch nicht, wenn der Schreib-Cursor im Text steht', b.nodes.length === 2, b.nodes.map((n) => n.id));
  } else pruefe('D3 Schreib-Cursor im Text der offenen Notiz', false, 'kein Textfeld');
  pruefe('D4 die Karte bleibt offen', await P.evaluate(() => !!document.querySelector('.focus-head')));
  // Der Knopf „Duplizieren" der Auswahl-Leiste an der offenen Karte: genauso
  await P.evaluate(() => { window.__hinweise.length = 0; });
  const knopf = P.locator('.sel-toolbar button[title^="Duplizieren"], .sel-toolbar button[aria-label^="Duplizieren"]').first();
  if (await knopf.count()) {
    await knopf.click();
    await warteBis(P, () => window.__hinweise.some((h) => /nicht dupliziert/.test(h)));
    b = await standRuhig(P, 3000);
    pruefe('D4b der Knopf „Duplizieren" an der offenen Karte legt ebenfalls nichts dahinter', b.nodes.length === 2 && (await hinweise(P)).some((h) => /nicht dupliziert/.test(h)), { n: b.nodes.map((n) => n.id), h: await hinweise(P) });
  } else pruefe('D4b Knopf „Duplizieren" an der offenen Karte gefunden', false, 'kein Knopf');
  for (let i = 0; i < 4 && await P.evaluate(() => !!document.querySelector('.focus-head')); i += 1) { await P.keyboard.press('Escape'); await P.waitForTimeout(400); }
  await warteBis(P, () => !document.querySelector('.focus-head'));
  await P.waitForTimeout(700);
  await waehle(P, 'b');
  await P.keyboard.press('Control+d');
  b = await standBis(P, (b) => b.nodes.length === 3);
  pruefe('D5 ohne Fokus dupliziert Strg+D die gewählte Karte wie bisher', b.nodes.length === 3, b.nodes.map((n) => n.id));
  await ctx.close();
}

/* ═══════════════════════ gemeinsam für A, B, F, R ═══════════════════════ */
/** Eine große SVG-Grafik als data-URL (über der Grenze von 10 000 Zeichen — sie geht in die Geräte-Ablage, M532) */
const grossesBild = (farbe) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="${farbe}"/><!--${'x'.repeat(12000)}--></svg>`);
const bildKarte = (id, x, y, farbe) => ({ id, type: 'image', width: 300, height: 150, position: { x, y }, data: { src: grossesBild(farbe), name: `${id}.svg` } });
const roherStand = (P) => P.evaluate(() => localStorage.getItem('pixinotes-board') ?? '');
const verweiseIm = (text) => [...text.matchAll(/"(pixinotes-ablage:[0-9a-z-]+)"/g)].map((m) => m[1]);
const ablageSchluessel = (P) => P.evaluate(() => new Promise((ok) => {
  const r = indexedDB.open('pixinotes-sync', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const t = r.result.transaction('kv', 'readonly').objectStore('kv').getAllKeys(); t.onsuccess = () => { ok(t.result.filter((k) => typeof k === 'string' && k.startsWith('pixinotes-ablage:'))); r.result.close(); }; t.onerror = () => ok([]); };
  r.onerror = () => ok([]);
}));
const waisen = (P) => P.evaluate(() => new Promise((ok) => {
  const r = indexedDB.open('pixinotes-sync', 1);
  r.onsuccess = () => { const t = r.result.transaction('kv', 'readonly').objectStore('kv').get('pixinotes-ablage-waisen'); t.onsuccess = () => { ok(t.result ?? {}); r.result.close(); }; t.onerror = () => ok({}); };
  r.onerror = () => ok({});
}));
const bildGeladen = (P, id) => P.evaluate((id) => { const i = document.querySelector(`.react-flow__node[data-id="${id}"] img`); return !!i && i.complete && i.naturalWidth > 0 && /^data:/.test(i.getAttribute('src') ?? ''); }, id);
const aufraeumen = (P, plusTage = 0) => P.evaluate((ms) => window.pixinotesAblageAufraeumen(Date.now() + ms), plusTage * 24 * 3600_000);
/** Eine Bild-Karte wählen (Klick in die Mitte) und löschen */
const bildLoeschen = async (P, id) => {
  const r = await karte(P, id); await P.mouse.click(r.cx, r.cy);
  await warteBis(P, (id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains('selected'), id, 5000);
  await P.keyboard.press('Delete');
  return warteBis(P, (id) => !document.querySelector(`.react-flow__node[data-id="${id}"]`), id, 5000);
};
const aufraeumenBereit = (P) => warteBis(P, () => typeof window.pixinotesAblageAufraeumen === 'function', null, 20000);
const TAG = 24 * 3600_000;

/* ═══════════════════════ A: verwaiste Ablage-Einträge ═══════════════════════ */
if (will('A')) {
  console.log('\n════ A: verwaiste Einträge der Geräte-Ablage aufräumen ════');
  const { ctx, P } = await seite(stand([bildKarte('img1', 0, 0, '#3b82f6'), bildKarte('img2', 400, 0, '#16a34a'), nz('n1', 0, 300)]));
  await warteBis(P, () => (localStorage.getItem('pixinotes-board')?.match(/"pixinotes-ablage:/g) ?? []).length === 2, null, 20000);
  const [v1, v2] = verweiseIm(await roherStand(P));
  pruefe('A1 beide Bilder liegen in der Ablage, der Stand trägt nur Verweise', !!v1 && !!v2 && (await ablageSchluessel(P)).includes(v1) && (await ablageSchluessel(P)).includes(v2), await ablageSchluessel(P));
  await bildLoeschen(P, 'img1');
  await warteBis(P, (v) => !(localStorage.getItem('pixinotes-board') ?? '').includes(v), v1, 10000);
  pruefe('A2 Bild gelöscht: der Stand nennt seinen Verweis nicht mehr', !(await roherStand(P)).includes(v1));
  pruefe('A3 das Aufräumen ist geladen (eine Minute nach dem Start läuft es von selbst)', await aufraeumenBereit(P));
  let e = await aufraeumen(P, 30);
  pruefe('A4 solange Rückgängig das Bild kennt, bleibt es — nicht einmal vorgemerkt', e.geloescht.length === 0 && (await ablageSchluessel(P)).includes(v1) && !(v1 in await waisen(P)), { e, w: await waisen(P) });
  // Neu laden: kein Rückgängig mehr
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await aufraeumenBereit(P);
  e = await aufraeumen(P, 0);
  pruefe('A5 nach dem Neuladen: verwaist, aber erst vorgemerkt (Schonfrist), nichts gelöscht', e.geloescht.length === 0 && (await ablageSchluessel(P)).includes(v1) && (v1 in await waisen(P)) && !(v2 in await waisen(P)), { e, w: await waisen(P) });
  e = await aufraeumen(P, 6);
  pruefe('A6 sechs Tage später: noch da', e.geloescht.length === 0 && (await ablageSchluessel(P)).includes(v1), e);
  e = await aufraeumen(P, 8);
  pruefe('A7 nach der Schonfrist (acht Tage): gelöscht', e.geloescht.length === 1 && e.geloescht[0] === v1 && !(await ablageSchluessel(P)).includes(v1), e);
  pruefe('A8 … das andere Bild bleibt in der Ablage und wird nicht vorgemerkt', (await ablageSchluessel(P)).includes(v2) && !(v2 in await waisen(P)));
  pruefe('A9 nach dem Neuladen zeigt das andere Bild sein Bild (aus der Ablage)', await warteBis(P, () => { const i = document.querySelector('.react-flow__node[data-id="img2"] img'); return !!i && i.naturalWidth > 0; }, null, 10000));
  // Ein Verweis, den nur noch eine Rettungskopie nennt (M529), bleibt — auch lange verwaist
  await bildLoeschen(P, 'img2');
  await warteBis(P, (v) => !(localStorage.getItem('pixinotes-board') ?? '').includes(v), v2, 10000);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await aufraeumenBereit(P);
  await P.evaluate((v) => sessionStorage.setItem('pixinotes-rettung', `{"kaputt":"${v}"`), v2);
  await aufraeumen(P, 0);
  e = await aufraeumen(P, 30);
  pruefe('A10 nennt nur noch eine Rettungskopie den Verweis, bleibt der Inhalt (auch nach 30 Tagen)', e.geloescht.length === 0 && (await ablageSchluessel(P)).includes(v2), e);
  await P.evaluate(() => sessionStorage.removeItem('pixinotes-rettung'));
  e = await aufraeumen(P, 31);
  pruefe('A11 ohne die Rettungskopie beginnt die Schonfrist erst jetzt (nur vorgemerkt)', e.geloescht.length === 0 && (v2 in await waisen(P)), e);
  await ctx.close();
}

/* ═══════════════════════ B: ein anderes Fenster hält das Bild noch im Rückgängig-Verlauf ═══════════════════════ */
if (will('B')) {
  console.log('\n════ B: anderes Fenster, Bild nur noch im Rückgängig-Verlauf ════');
  const { ctx, P } = await seite(stand([bildKarte('img1', 0, 0, '#dc2626'), nz('n1', 0, 300)]));
  await warteBis(P, () => /"pixinotes-ablage:/.test(localStorage.getItem('pixinotes-board') ?? ''), null, 20000);
  const [v1] = verweiseIm(await roherStand(P));
  await bildLoeschen(P, 'img1');
  await warteBis(P, (v) => !(localStorage.getItem('pixinotes-board') ?? '').includes(v), v1, 10000);
  // Ein zweites Fenster (Mitleser) räumt auf — es sieht das Bild nirgends
  const P2 = await ctx.newPage();
  P2.on('pageerror', (e) => fehler.push(e.message));
  await P2.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P2.waitForSelector('.react-flow__node', { timeout: 30000 });
  await aufraeumenBereit(P2);
  await aufraeumen(P2, 0);
  const e = await aufraeumen(P2, 8);
  pruefe('B1 das zweite Fenster löscht den Eintrag (es kennt das Bild nicht)', e.geloescht.includes(v1) && !(await ablageSchluessel(P)).includes(v1), e);
  // Im ersten Fenster: Rückgängig holt das Bild zurück — es muss wieder in die Ablage, nicht als Verweis ohne Inhalt
  await P.bringToFront();
  await P.mouse.click(1415, 780);
  await P.keyboard.press('Control+z');
  await warteBis(P, () => !!document.querySelector('.react-flow__node[data-id="img1"]'), null, 8000);
  const wieder = await warteBis(P, async () => true, null, 1);
  void wieder;
  const zurueck = await (async () => { const bis = Date.now() + 15000; while (Date.now() < bis) { if ((await ablageSchluessel(P)).includes(v1) && (await roherStand(P)).includes(v1)) return true; await P.waitForTimeout(250); } return false; })();
  pruefe('B2 nach Rückgängig liegt der Inhalt wieder in der Ablage, bevor der Stand ihn nennt', zurueck, { ablage: (await ablageSchluessel(P)).includes(v1), stand: (await roherStand(P)).includes(v1) });
  await P2.close();
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node[data-id="img1"]', { timeout: 30000 });
  pruefe('B3 nach dem Neuladen ist das Bild da', await warteBis(P, () => { const i = document.querySelector('.react-flow__node[data-id="img1"] img'); return !!i && i.naturalWidth > 0; }, null, 10000));
  await ctx.close();
}

/* ═══════════════════════ F: Speicherformat — eine zu alte Fassung schreibt nicht ═══════════════════════ */
if (will('F')) {
  console.log('\n════ F: Speicherformat ════');
  {
    const { ctx, P } = await seite(stand([nz('n1', 0, 0)]));
    pruefe('F1 die App trägt ihr Speicherformat ein (2)', await P.evaluate(() => localStorage.getItem('pixinotes-speicherformat')) === '2');
    await ctx.close();
  }
  {
    // Eine NEUERE Fassung hat hier gespeichert (Format 3): diese darf nichts schreiben
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
    await ctx.addInitScript((st) => {
      if (sessionStorage.getItem('x-init')) return;
      sessionStorage.setItem('x-init', '1');
      localStorage.setItem('pixinotes-onboarded', '1');
      localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
      localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
      localStorage.setItem('pixinotes-speicherformat', '3');
    }, stand([nz('n1', 0, 0), nz('n2', 400, 0)]));
    const P = await ctx.newPage();
    P.on('pageerror', (e) => fehler.push(e.message));
    await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await P.waitForSelector('.react-flow__node', { timeout: 30000 });
    const vorher = await roherStand(P);
    pruefe('F2 ein Band sagt: neuere Fassung, dieses Fenster speichert nichts — mit „Neu laden"', await warteBis(P, () => /neuere Fassung/.test(document.querySelector('[data-taste="zu-alt"]')?.textContent ?? ''), null, 8000));
    await waehle(P, 'n2');
    await P.keyboard.press('Delete');
    await warteBis(P, () => !document.querySelector('.react-flow__node[data-id="n2"]'), null, 5000);
    await P.waitForTimeout(2500);   // bewiesen werden soll, dass NICHTS geschrieben wird (erst nach dem Löschen)
    pruefe('F3 eine Änderung wird nicht gespeichert (der Stand der neueren Fassung bleibt unberührt)', (await roherStand(P)) === vorher);
    pruefe('F4 die Marke bleibt auf 3 (nicht heruntergesetzt)', await P.evaluate(() => localStorage.getItem('pixinotes-speicherformat')) === '3');
    await ctx.close();
  }
}

/* ═══════════════════════ R: Verweise von außen (ältere App-Fassung) werden repariert ═══════════════════════ */
if (will('R')) {
  console.log('\n════ R: Stand von außen mit Verweisen statt Bildern (WebDAV) ════');
  const DAV = Number(process.env.M538_DAV ?? 7538);
  const dav = { body: null, n: 0, etag: null };
  const srv = http.createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': q.headers.origin ?? '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match', 'Access-Control-Expose-Headers': 'ETag' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); r.end(); return; }
    if (q.method === 'GET') { if (!dav.body) { r.writeHead(404, cors); r.end(); return; } r.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: dav.etag }); r.end(dav.body); return; }
    if (q.method === 'PUT') {
      let txt = ''; q.on('data', (c) => { txt += c; }); q.on('end', () => {
        const wenn = q.headers['if-match'];
        if (wenn && wenn !== dav.etag) { r.writeHead(412, cors); r.end(); return; }
        dav.body = txt; dav.etag = `"v${++dav.n}"`; r.writeHead(204, { ...cors, ETag: dav.etag }); r.end();
      }); return;
    }
    r.writeHead(405, cors); r.end();
  });
  await new Promise((x) => srv.listen(DAV, x));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript(({ st, dav }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-webdav', JSON.stringify({ url: `http://localhost:${dav}/ordner`, user: 'u', secret: 'p', auto: true }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand([bildKarte('img1', 0, 0, '#7c3aed'), bildKarte('img3', 400, 0, '#ea580c'), nz('n1', 0, 300)]), dav: DAV });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  const warte = async (fn, ms = 30000) => { const e = Date.now() + ms; while (Date.now() < e) { if (await fn()) return true; await P.waitForTimeout(250); } return fn(); };
  await warte(() => !!dav.body && dav.body.includes('img3'));
  await warteBis(P, () => (localStorage.getItem('pixinotes-board')?.match(/"pixinotes-ablage:/g) ?? []).length === 2, null, 20000);
  const roh = await roherStand(P);
  const verweisVon = (id) => { const s = JSON.parse(roh).state; return s.boards[0].nodes.find((n) => n.id === id)?.data.src; };
  const v1 = verweisVon('img1');
  pruefe('R1 Aufbau: das Bild liegt hier in der Ablage, auf dem Server steht das ganze Bild', /^pixinotes-ablage:/.test(v1 ?? '') && !!dav.body && JSON.parse(dav.body).boards[0].nodes.find((n) => n.id === 'img1')?.data.src.startsWith('data:'), v1);
  // So schriebe eine ältere App-Fassung (vor M532), die den gespeicherten Stand mit Verweisen gelesen hat
  const p = JSON.parse(dav.body);
  const b = p.boards[0];
  b.nodes.find((n) => n.id === 'img1').data.src = v1;                                         // Verweis, Inhalt liegt hier
  b.nodes.find((n) => n.id === 'img3').data.src = 'pixinotes-ablage:zz-zz-12345';              // Verweis, Inhalt liegt nirgends
  b.nodes.find((n) => n.id === 'n1').data.blocks = [{ id: 'n1t', type: 'paragraph', content: 'Vom alten Tab' }];
  p.savedAt = new Date(Date.now() + 1000).toISOString();
  dav.body = JSON.stringify(p); dav.etag = `"v${++dav.n}"`;
  // Abgleich anstoßen (Fenster wird wieder sichtbar)
  await P.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  const da = await warte(() => P.evaluate(() => /Vom alten Tab/.test(document.querySelector('.react-flow__node[data-id="n1"]')?.textContent ?? '')), 45000);
  pruefe('R2 der fremde Stand kam an (die Notiz zeigt den neuen Text)', da);
  await P.waitForTimeout(1500);
  pruefe('R3 das Bild mit Verweis zeigt sein Bild (aus der Ablage dieses Geräts eingesetzt)', await bildGeladen(P, 'img1'), await P.evaluate(() => document.querySelector('.react-flow__node[data-id="img1"] img')?.getAttribute('src')?.slice(0, 40) ?? 'kein img'));
  pruefe('R4 das Bild, dessen Inhalt nirgends liegt, behält die hiesige Fassung', await bildGeladen(P, 'img3'), await P.evaluate(() => document.querySelector('.react-flow__node[data-id="img3"] img')?.getAttribute('src')?.slice(0, 40) ?? 'kein img'));
  const repariert = await warte(() => { const q = JSON.parse(dav.body).boards[0].nodes; return q.find((n) => n.id === 'img1')?.data.src.startsWith('data:') && q.find((n) => n.id === 'img3')?.data.src.startsWith('data:') && JSON.stringify(q).includes('Vom alten Tab'); }, 30000);
  pruefe('R5 der nächste Upload trägt wieder die ganzen Bilder (kein Verweis, kein leeres Bild)', repariert, JSON.parse(dav.body).boards[0].nodes.map((n) => [n.id, String(n.data.src ?? '').slice(0, 30)]));
  await ctx.close();
  srv.close();
}

await browser.close();
app.close();
if (fehler.length) { bad += 1; console.log('  ✗ Fehler auf der Seite:', fehler.slice(0, 5)); } else console.log('\n  ✓ keine Fehler auf der Seite');
console.log(`\n${ok} ✓, ${bad} ✗`);
process.exit(bad ? 1 : 0);
