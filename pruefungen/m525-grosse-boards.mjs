/**
 * M525 — Schwere Boards bleiben flüssig: Speichern ohne den ganzen Stand je Änderung, kein Neuzeichnen von
 * Unbeteiligtem beim Ziehen, Animationen geben dem Ziehen den Vortritt.
 *
 * Das Board ist dem gemeldeten nachgebaut (erfundene Inhalte, gleiche Gestalt): 31 Karten — 16 eigene Tools (HTML im
 * Gerätespeicher), 8 Bilder als animiertes SVG im Stand, 4 Ideabubbles, 2 Kanban, 1 Flüssige Schrift „lebendig" —,
 * 22 Verbindungen, 158 Striche. Alle Prüfpunkte zählen (Zeichen, Schreibvorgänge, Renders, Rechenschritte) statt
 * Zeiten zu messen: Sie fallen auf einer ausgelasteten Maschine gleich aus.
 *
 *   S  Speichern: Ziehen schreibt nicht mehr je Mausbewegung den ganzen Stand als JSON (vorher ≥ 1 Stand je
 *      Bewegung); reine Oberflächen-Änderungen schreiben gar nicht; der gespeicherte Text ist Zeichen für Zeichen der
 *      Stand (Prüfbetrieb: 0 Abweichungen nach Ziehen, Anlegen, Tippen, Löschen, Rückgängig); Verbergen der Seite und
 *      Neuladen schreiben sofort; ein zweites Fenster liest weiter nur mit.
 *   R  Renders: Beim Ziehen zeichnet der Inhalt der gezogenen Karte nicht je Mausbewegung neu, andere Karten gar
 *      nicht, und insgesamt höchstens ein Drittel so viele Komponenten wie vorher (Auswahl-Leiste, Kanban, Reiter).
 *   F  Flüssige Schrift „lebendig": rechnet im Leerlauf, hält während eines Karten-Zugs an, läuft danach weiter;
 *      außerhalb des Bildes rechnet sie nicht.
 *   T  Tools: Ziehen, Zoomen und Speichern laden kein laufendes Tool neu.
 */
// Läuft aus dem Repository: `node pruefungen/m525-grosse-boards.mjs` (alter Build zum Vergleich: PN_DIST=<ordner>)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5525;
const NUR = process.env.M525_NUR ?? 'SRFT';
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

/* ═══════════════════════ Das Board (erfunden, Gestalt wie gemeldet) ═══════════════════════ */
const zufall = (() => { let a = 525; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const WORTE = 'Werkstatt Bauteil Muster Karte Plan Runde Idee Schritt Frage Antwort Liste Notiz Termin Probe Entwurf'.split(' ');
const satz = (n) => Array.from({ length: n }, () => WORTE[Math.floor(zufall() * WORTE.length)]).join(' ');
/** Animiertes SVG (CSS-Keyframes), rund 60 KB — wie die Bilder des gemeldeten Boards */
const svgBild = (i) => {
  const teile = [];
  for (let k = 0; k < 520; k += 1) teile.push(`<path class="${k % 9 === 0 ? 'a' : k % 13 === 0 ? 'b' : ''}" fill="hsl(${(k * 7 + i * 40) % 360},60%,${40 + (k % 5) * 8}%)" d="M${(zufall() * 150).toFixed(1)} ${(zufall() * 150).toFixed(1)}l${(zufall() * 12).toFixed(2)} ${(zufall() * 6).toFixed(2)}l${(-zufall() * 9).toFixed(2)} ${(zufall() * 8).toFixed(2)}z"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><style>@keyframes f{0%{opacity:.4}50%{opacity:1}100%{opacity:.4}}@keyframes g{0%{transform:translateY(0)}50%{transform:translateY(-2px)}100%{transform:translateY(0)}}.a{animation:f 1.6s infinite}.b{animation:g 2.1s infinite}</style>${teile.join('')}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};
const toolHtml = (id) => `<!doctype html><html><head><meta charset="utf-8"><title>Tool</title><style>body{margin:0;background:#161616;color:#eee;font:14px sans-serif}canvas{width:100%;height:70%;display:block}</style></head><body><canvas id="c" width="500" height="260"></canvas><p id="z">0</p><script>(function(){var ID=${JSON.stringify(id)},c=document.getElementById('c'),x=c.getContext('2d'),n=0;try{parent.postMessage({__m525:ID,boot:1},'*');}catch(e){}function b(){n++;x.fillStyle='rgba(22,22,22,.3)';x.fillRect(0,0,500,260);for(var i=0;i<60;i++){x.fillStyle='hsl('+((i*9+n)%60+10)+',90%,55%)';x.fillRect(250+Math.cos(n/20+i)*i*3,130+Math.sin(n/17+i)*i,4,4);}requestAnimationFrame(b);}requestAnimationFrame(b);setInterval(function(){document.getElementById('z').textContent=String(n);try{localStorage.setItem('n',String(n));}catch(e){}},700);})();</script><!-- ${'x'.repeat(20000)} --></body></html>`;
function boardBauen() {
  const nodes = []; const html = {};
  const lege = (k, x, y) => { k.position = { x, y }; nodes.push(k); };
  // Tools: zwei große Reihen, dann ein Block kleinerer
  for (let i = 0; i < 16; i += 1) {
    const id = `h${i + 1}`; html[id] = toolHtml(id);
    const gross = i < 8;
    lege({ id, type: 'htmlapp', width: gross ? 1100 : 560, height: gross ? 690 : 520, autoFit: false, data: { name: `Werkzeug ${i + 1}`, size: html[id].length } }, gross ? 60 + (i % 4) * 1180 : 4800 + (i % 3) * 640, gross ? 700 + Math.floor(i / 4) * 780 : 700 + Math.floor((i - 8) / 3) * 600);
  }
  for (let i = 0; i < 8; i += 1) lege({ id: `i${i + 1}`, type: 'image', width: 520, height: 520, data: { src: svgBild(i), name: `bild${i + 1}.svg`, titel: `Bild ${i + 1}` } }, 60 + i * 600, 2400);
  for (let i = 0; i < 4; i += 1) {
    const ideen = i === 2 ? Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`id${k}`, { id: `id${k}`, text: satz(2), von: 'Anna', t: 1700000000000 + k }])) : {};
    lege({ id: `u${i + 1}`, type: 'bubbles', width: 560, height: i === 2 ? 520 : 400, autoFit: false, data: { title: `Ideen ${i + 1}`, frage: 'Wie könnten wir …?', ideen, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } }, 60 + i * 640, 3080);
  }
  lege({ id: 'k1', type: 'kanban', width: 1100, height: 560, autoFit: false, data: { title: 'Aufgaben', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: Array.from({ length: 60 }, (_, k) => ({ id: `t${k}`, text: satz(4), col: k % 3 })) } }, 60, 120);
  lege({ id: 'k2', type: 'kanban', width: 560, height: 400, autoFit: false, data: { title: 'Kleines Kanban', cols: ['Offen', 'Erledigt'], items: Array.from({ length: 12 }, (_, k) => ({ id: `s${k}`, text: satz(3), col: k % 2 })) } }, 1240, 120);
  lege({ id: 'fl', type: 'fluessig', width: 1500, height: 380, data: { text: 'Guten Morgen', zaeh: 'mittel', farbe: 'schrift', lebendig: true } }, 3230, 120);
  const kante = (i, s, t) => ({ id: `v${i}`, source: s, target: t, type: 'labeled', data: { label: '', kind: 'arrow' } });
  const edges = Array.from({ length: 22 }, (_, i) => kante(i, i < 8 ? `h${i + 1}` : `i${(i % 8) + 1}`, i < 8 ? `i${i + 1}` : `u${(i % 4) + 1}`));
  const drawings = Array.from({ length: 158 }, (_, i) => { const x = 60 + (i % 40) * 160; const y = 620 + Math.floor(i / 40) * 12; return { id: `st${i}`, tool: 'pen', color: '#b45309', width: 14, points: [[x, y], [x + 120, y]] }; });
  return { st: { boards: [{ id: 'b1', name: 'Werkstatt', comments: [], nodes, edges, drawings, bg: 'punkte' }, { id: 'b2', name: 'Ablage', comments: [], nodes: [], edges: [], drawings: [] }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Projekte', boardIds: ['b1', 'b2'] }] }], activeId: 'b1', view: 'board' }, html };
}
const { st: STAND, html: HTML } = boardBauen();
const STAND_ZEICHEN = JSON.stringify({ state: STAND, version: 5 }).length;

/* ═══════════════════════ Zähler im Fenster ═══════════════════════ */
const ZAEHLER = () => {
  if (window.top !== window) return;
  const z = { strZeichen: 0, strGross: 0, lsBoard: 0, renders: { an: false, gesamt: 0, je: {} }, rahmenLoad: 0, boots: 0 };
  window.__m525 = z;
  const S = JSON.stringify;
  JSON.stringify = function (...a) { const r = S.apply(this, a); if (typeof r === 'string') { z.strZeichen += r.length; if (r.length > 200000) z.strGross += 1; } return r; };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'pixinotes-board') z.lsBoard += 1; return set.call(this, k, v); };
  // Jede Funktionskomponente, die in einem Commit gerechnet hat — einer Karte zugeordnet, wenn sie in einer steckt
  const istKarte = (c) => typeof c.type !== 'string' && c.memoizedProps && typeof c.memoizedProps === 'object' && 'positionAbsoluteX' in c.memoizedProps && 'data' in c.memoizedProps;
  const besuchen = (f, karte) => {
    for (let c = f.child; c; c = c.sibling) {
      const neu = !c.alternate; let k = karte;
      if (!k && istKarte(c)) k = c.memoizedProps.id;
      if ((c.tag === 0 || c.tag === 11 || c.tag === 14 || c.tag === 15) && (neu || (c.flags & 1))) { z.renders.gesamt += 1; if (k) z.renders.je[k] = (z.renders.je[k] ?? 0) + 1; }
      if (!neu && c.child === c.alternate.child) continue;
      besuchen(c, k);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(_id, root) { if (!z.renders.an) return; const cur = root.current; if (cur.alternate && cur.child === cur.alternate.child) return; besuchen(cur, null); },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
  document.addEventListener('load', (e) => { if (e.target?.tagName === 'IFRAME') z.rahmenLoad += 1; }, true);
  window.addEventListener('message', (e) => { if (e.data && e.data.__m525 && e.data.boot) z.boots += 1; });
};

async function seite({ stand = STAND, html = HTML, ctx = null, pruefbetrieb = true } = {}) {
  ctx ??= await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript(ZAEHLER);
  await ctx.addInitScript(([st, pruef]) => {
    if (window.top !== window || localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-bildtext', 'aus');   // die Texterkennung schreibt sonst nebenher in den Stand
    if (pruef) localStorage.setItem('pixinotes-speicher-pruefen', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand, pruefbetrieb]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  if (html && Object.keys(html).length) {
    await P.evaluate((html) => new Promise((fertig, weh) => {
      const q = indexedDB.open('pixinotes-sync', 1);
      q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('kv')) q.result.createObjectStore('kv'); };
      q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); for (const [id, h] of Object.entries(html)) t.objectStore('kv').put(h, `happ:${id}`); t.oncomplete = () => fertig(true); t.onerror = () => weh(t.error); };
      q.onerror = () => weh(q.error);
    }), html);
    await P.reload({ waitUntil: 'networkidle' });
  }
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  await P.waitForTimeout(2500);
  return { ctx, P };
}
const warteBis = async (P, fn, ms = 15000) => { const ende = Date.now() + ms; for (;;) { if (await fn()) return true; if (Date.now() > ende) return false; await P.waitForTimeout(150); } };
const rahmen = (P, id) => P.evaluate((id) => { const e = document.querySelector(`.react-flow__node[data-id="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, id);
const gespeichert = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const lageVon = async (P, id) => { const n = (await gespeichert(P)).boards[0].nodes.find((k) => k.id === id); return n ? `${Math.round(n.position.x)},${Math.round(n.position.y)}` : ''; };
const zaehler = (P) => P.evaluate(() => JSON.parse(JSON.stringify(window.__m525)));
const speicher = (P) => P.evaluate(() => ({ ...(window.pixinotesSpeicher ?? {}) }));
const freierPunkt = (P) => P.evaluate(() => { for (let y = 120; y < innerHeight - 80; y += 30) for (let x = 200; x < innerWidth - 100; x += 30) { const e = document.elementFromPoint(x, y); if (e && e.classList.contains('react-flow__pane')) return { x, y }; } return null; });
/** Karte am oberen Rand greifen und `schritte` Mausbewegungen ziehen; `dabei` läuft mitten im Zug (Maus noch unten) */
async function ziehen(P, id, schritte, { dx = 3, dy = 2, dabei = null, pause = 25 } = {}) {
  const r = await rahmen(P, id);
  const gx = Math.max(10, r.x) + Math.min(8, r.w / 3); const gy = r.y + Math.min(5, r.h / 4);
  await P.mouse.move(gx, gy); await P.mouse.down();
  await P.mouse.move(gx + 2, gy + 2); await P.mouse.move(gx + 4, gy + 3); await P.waitForTimeout(150);   // der Zug hat begonnen
  const vor = dabei ? await dabei('anfang') : null;
  for (let i = 1; i <= schritte; i += 1) { await P.mouse.move(gx + 4 + i * dx, gy + 3 + i * dy); await P.waitForTimeout(pause); }
  const nach = dabei ? await dabei('ende') : null;
  await P.mouse.up(); await P.waitForTimeout(300);
  return { vor, nach };
}

/* ═══════════════════════ S: Speichern ═══════════════════════ */
if (NUR.includes('S')) {
  console.log(`\n════ S: Speichern (Stand ${(STAND_ZEICHEN / 1e6).toFixed(2)} Mio. Zeichen) ════`);
  // S1–S5 ohne Prüfbetrieb (so läuft die App bei Nutzern); S6–S11 danach im Prüfbetrieb (jedes Schreiben gegengeprüft)
  let { ctx, P } = await seite({ pruefbetrieb: false });
  const n0 = await P.locator('.react-flow__node').count();
  pruefe('S0 das Board steht: 31 Karten', n0 === 31, n0);
  const pruefbar = await P.evaluate(() => typeof window.pixinotesSpeicher === 'object');
  pruefe('S0b der Speicher zählt mit', pruefbar);
  // M536: Der Start schreibt einmal (M532: Bilder ziehen in die Ablage um, der Stand wird mit Verweisen neu geschrieben).
  // S1 gilt dem Ziehen — also erst messen, wenn der Start fertig geschrieben hat (kein großes Bild mehr im Text,
  // Zähler der Schreibvorgänge 1,5 s ruhig).
  await warteBis(P, async () => {
    const a = await P.evaluate(() => ({ g: window.pixinotesSpeicher?.geschrieben ?? 0, daten: /"data:[^"]{10000,}"/.test(localStorage.getItem('pixinotes-board') ?? '') }));
    await P.waitForTimeout(1500);
    const b = await P.evaluate(() => window.pixinotesSpeicher?.geschrieben ?? 0);
    return !a.daten && a.g === b;
  }, 30000);
  // M536: Versionen des Boards (M449) — die Version „Sitzung" sichert den Stand vor der ersten EIGENEN Änderung
  const versionen = () => P.evaluate(() => new Promise((ok) => {
    const q = indexedDB.open('pixinotes-sync', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => { const r = q.result.transaction('kv').objectStore('kv').get('ver-ix:b1'); r.onsuccess = () => ok((r.result ?? []).map((v) => v.grund)); };
  }));
  await P.waitForTimeout(2500);   // das Kanban sammelt rund 4,5 s nach dem Start von selbst ein (runDerived)
  const vorS1 = await versionen();
  pruefe('S0c was beim Start von selbst entsteht (Kanban sammelt ein), legt keine Version „Sitzung" an', !vorS1.includes('sitzung'), vorS1);
  // S1: 30 Mausbewegungen ziehen — wie viel JSON entsteht?
  await P.evaluate(() => { window.__m525.strZeichen = 0; window.__m525.strGross = 0; });
  const lage0 = await lageVon(P, 'k2');
  await ziehen(P, 'k2', 30);
  const z1 = await zaehler(P);
  console.log(`  (30 Mausbewegungen: ${(z1.strZeichen / 1e6).toFixed(2)} Mio. Zeichen JSON, davon ${z1.strGross} große Texte; ein Stand = ${(STAND_ZEICHEN / 1e6).toFixed(2)} Mio.)`);
  // (M536: dieser Zug ist die erste eigene Änderung — die Version „Sitzung" davor baute das ganze Board als JSON MITTEN
  // im Zug; auf einer ausgelasteten Maschine gemessen: 1,0 Stände. Sie entsteht jetzt nach dem Ablegen im Leerlauf.)
  pruefe('S1 Ziehen schreibt nicht je Mausbewegung den ganzen Stand als JSON (vorher ≥ 30 Stände, jetzt < 1)', z1.strZeichen < STAND_ZEICHEN, { zeichen: z1.strZeichen, staende: (z1.strZeichen / STAND_ZEICHEN).toFixed(1) });
  const da = await warteBis(P, async () => (await lageVon(P, 'k2')) !== lage0, 8000);
  pruefe('S2 die neue Lage steht kurz nach dem Ablegen im Speicher', da, `${lage0} → ${await lageVon(P, 'k2')}`);
  const sitzung = await warteBis(P, async () => (await versionen()).includes('sitzung'), 15000);
  pruefe('S2b die Version „Sitzung" (Stand vor dem Zug) entsteht trotzdem — nach dem Ablegen', sitzung, await versionen());
  // S3: reine Oberfläche — Einstellungen auf und zu, Hinweis: kein Schreiben des Boards
  await P.waitForTimeout(900);
  const w0 = (await zaehler(P)).lsBoard;
  await P.locator('[data-taste="einstellungen"]').click(); await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.keyboard.press('Escape'); await P.waitForTimeout(1200);
  const w1 = (await zaehler(P)).lsBoard;
  pruefe('S3 Einstellungen auf und zu schreibt das Board nicht (vorher: jedes Mal der ganze Stand)', w1 === w0, { vorher: w0, nachher: w1 });
  // S4: Seite wird verdeckt → sofort geschrieben (ohne die 400 ms abzuwarten)
  const lage1 = await lageVon(P, 'k2');
  await ziehen(P, 'k2', 6, { dx: -4, dy: 3 });
  const sofort = await P.evaluate((alt) => {
    const lage = () => { const n = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((k) => k.id === 'k2'); return `${Math.round(n.position.x)},${Math.round(n.position.y)}`; };
    const vorher = lage();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const nachher = lage();
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    return { vorher, nachher, alt };
  }, lage1);
  pruefe('S4 Verdecken der Seite schreibt sofort (kein Warten auf den gedrosselten Schreiber)', sofort.nachher !== sofort.alt, sofort);
  // S5: Neuladen unmittelbar nach einer Änderung
  await P.waitForTimeout(600);
  const lage2 = await lageVon(P, 'u1');
  await ziehen(P, 'u1', 5, { dx: 5, dy: -3 });
  await P.reload({ waitUntil: 'domcontentloaded' });
  await P.waitForSelector('.react-flow__node', { timeout: 30000 });
  const lage3 = await lageVon(P, 'u1');
  pruefe('S5 Neuladen direkt nach dem Ablegen verliert nichts', lage3 !== lage2, `${lage2} → ${lage3}`);
  await ctx.close();
  ({ ctx, P } = await seite({ pruefbetrieb: true }));
  // S6: Der gespeicherte Text ist der Stand — nach Ziehen, Anlegen, Tippen, Löschen, Rückgängig, Wiederholen
  const fp = await freierPunkt(P);
  const vorKarten = await P.locator('.react-flow__node').count();
  await P.mouse.dblclick(fp.x, fp.y);
  await P.waitForFunction(() => document.activeElement?.getAttribute('contenteditable') === 'true', null, { timeout: 8000 }).catch(() => {});
  await P.keyboard.insertText('Eine neue Notiz für M525');
  await P.waitForTimeout(700);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  const mitNotiz = await warteBis(P, async () => JSON.stringify((await gespeichert(P)).boards[0].nodes).includes('Eine neue Notiz für M525'), 8000);
  pruefe('S6 eine neue Notiz samt Text steht im Speicher', mitNotiz && (await P.locator('.react-flow__node').count()) === vorKarten + 1);
  await ziehen(P, 'k1', 8, { dx: 2, dy: 4 });
  await P.keyboard.press('Escape');
  const fp2 = await freierPunkt(P); await P.mouse.click(fp2.x, fp2.y); await P.waitForTimeout(200);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(700);
  await P.keyboard.press('Control+y'); await P.waitForTimeout(700);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(900);
  // eine Karte löschen: wählen und Entf
  const ru = await rahmen(P, 'u4'); await P.mouse.click(ru.x + ru.w / 2, ru.y + ru.h / 2); await P.waitForTimeout(300);
  await P.keyboard.press('Delete'); await P.waitForTimeout(900);
  const ohneU4 = await warteBis(P, async () => !(await gespeichert(P)).boards[0].nodes.some((k) => k.id === 'u4'), 8000);
  pruefe('S7 eine gelöschte Karte ist auch im Speicher weg', ohneU4);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(900);
  const wiederU4 = await warteBis(P, async () => (await gespeichert(P)).boards[0].nodes.some((k) => k.id === 'u4'), 8000);
  pruefe('S8 Rückgängig bringt sie in den Speicher zurück', wiederU4);
  const sp = await speicher(P);
  console.log(`  (Speicher: ${sp.vorgemerkt} vorgemerkt, ${sp.uebersprungen} übersprungen, ${sp.geschrieben} geschrieben, ${sp.abweichungen} Abweichungen)`);
  pruefe('S9 der mit Gedächtnis geschriebene Text wich nie vom Stand ab (jedes Schreiben gegengeprüft)', sp.abweichungen === 0 && sp.geschrieben >= 4, sp);
  // S10: zweites Fenster desselben Browsers liest nur mit und überschreibt nichts
  const zwei = await ctx.newPage();
  zwei.on('pageerror', (e) => fehler.push(e.message));
  await zwei.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await zwei.waitForSelector('.react-flow__node', { timeout: 30000 }); await zwei.waitForTimeout(1500);
  const lageK2 = await lageVon(P, 'k2');
  await ziehen(P, 'k2', 6, { dx: 5, dy: 2 });
  const erstesSchreibt = await warteBis(P, async () => (await lageVon(P, 'k2')) !== lageK2, 8000);
  await zwei.waitForTimeout(1500);
  const zweiSp = await zwei.evaluate(() => ({ ...(window.pixinotesSpeicher ?? {}) }));
  pruefe('S10 mit einem zweiten Fenster: das erste schreibt weiter, das zweite schreibt nie', erstesSchreibt && zweiSp.geschrieben === 0, { erstesSchreibt, zweiSp });
  const folgt = await warteBis(zwei, async () => (await zwei.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="k2"]'); return e ? e.style.transform : ''; })) !== '', 5000);
  pruefe('S11 das zweite Fenster zeigt das Board weiter an', folgt);
  await ctx.close();
}

/* ═══════════════════════ R: Renders beim Ziehen ═══════════════════════ */
if (NUR.includes('R')) {
  console.log('\n════ R: Was zeichnet beim Ziehen neu? ════');
  const { ctx, P } = await seite({ pruefbetrieb: false });
  pruefe('R0 der Zähler hängt an React', await P.evaluate(() => !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size));
  const SCHRITTE = 20;
  const messen = async (id) => {
    const r = await ziehen(P, id, SCHRITTE, { dabei: (wann) => P.evaluate((wann) => { const z = window.__m525.renders; if (wann === 'anfang') { z.gesamt = 0; z.je = {}; z.an = true; return null; } z.an = false; return { gesamt: z.gesamt, je: z.je }; }, wann) });
    return r.nach;
  };
  // das große Kanban ziehen (60 Tickets); das kleine Kanban und alle anderen Karten sind unbeteiligt
  const a = await messen('k1');
  const andere = Object.entries(a.je).filter(([id]) => id !== 'k1');
  console.log(`  (Kanban ziehen, ${SCHRITTE} Mausbewegungen: ${a.gesamt} Renders = ${(a.gesamt / SCHRITTE).toFixed(0)} je Bewegung; in der gezogenen Karte ${a.je.k1 ?? 0}; in anderen Karten ${andere.reduce((s, [, n]) => s + n, 0)} (${andere.map(([id, n]) => `${id}:${n}`).join(' ') || '–'}))`);
  pruefe('R1 der Inhalt der gezogenen Karte zeichnet nicht je Mausbewegung neu (vorher mehrfach je Bewegung)', (a.je.k1 ?? 0) <= SCHRITTE / 2, a.je.k1);
  pruefe('R2 keine andere Karte zeichnet beim Ziehen neu (vorher: jedes Kanban je Mausbewegung)', andere.length === 0, andere);
  pruefe('R3 je Mausbewegung höchstens 90 Komponenten (vorher rund 200: Auswahl-Leiste, Kanban, Reiter)', a.gesamt / SCHRITTE <= 90, a.gesamt / SCHRITTE);
  // Nach dem Ablegen ist die Leiste wieder aktuell und bedienbar: Duplizieren aus der Leiste wirkt
  await P.waitForTimeout(500);
  const leiste = await P.locator('.sel-toolbar').count();
  pruefe('R4 nach dem Ablegen steht die Auswahl-Leiste an der Karte', leiste >= 1, leiste);
  // Ein Bild ziehen: das kleine Kanban bleibt unberührt, danach zeigt es eine neue Aufgabe sofort
  const b = await messen('i3');
  pruefe('R5 ein Bild ziehen zeichnet kein Kanban neu', !b.je.k1 && !b.je.k2, b.je);
  await P.keyboard.press('Escape');
  await ctx.close();
}

/* ═══════════════════════ F: Flüssige Schrift ═══════════════════════ */
if (NUR.includes('F')) {
  console.log('\n════ F: Flüssige Schrift „lebendig" gibt dem Ziehen den Vortritt ════');
  const { ctx, P } = await seite({ pruefbetrieb: false });
  const fl = () => P.evaluate(() => ({ ...(window.pixinotesFluessig ?? {}) }));
  const laeuft = await warteBis(P, async () => ((await fl()).takte ?? 0) > 5, 20000);
  if (!laeuft) {
    console.log('  (übersprungen: keine WebGL2-Grafik in diesem Browser)');
  } else {
    const hatSchritte = typeof (await fl()).schritte === 'number';
    pruefe('F0 der Motor zählt Rechenschritte', hatSchritte);
    // Einmal mit dem Zeiger durch die Schrift fahren (weckt sie) und wieder hinaus: „lebendig" rechnet dann ohne
    // Berührung weiter — sie kommt von selbst nicht zur Ruhe.
    const rf = await rahmen(P, 'fl');
    for (let i = 0; i <= 10; i += 1) { await P.mouse.move(rf.x + rf.w * (0.2 + 0.06 * i), rf.y + rf.h / 2); await P.waitForTimeout(30); }
    const fpF = await freierPunkt(P); await P.mouse.move(fpF.x, fpF.y); await P.waitForTimeout(600);
    const s0 = (await fl()).schritte ?? (await fl()).takte; await P.waitForTimeout(1500);
    const s1 = (await fl()).schritte ?? (await fl()).takte;
    pruefe('F1 unberührt rechnet die lebendige Flüssigkeit weiter (sichtbar im Bild)', s1 > s0 + 3, { s0, s1 });
    // Der Zug zählt nur, wenn die Flüssigkeit währenddessen rechnen WOLLTE (Takte laufen) — sie kann sich zwischendurch
    // schlafen legen (Qualitätsregler tastet neu ab); dann wecken und noch einmal ziehen.
    const wecken = async () => { for (let i = 0; i <= 10; i += 1) { await P.mouse.move(rf.x + rf.w * (0.2 + 0.06 * i), rf.y + rf.h / 2); await P.waitForTimeout(30); } const f = await freierPunkt(P); await P.mouse.move(f.x, f.y); await P.waitForTimeout(400); };
    let r = null;
    for (let versuch = 0; versuch < 4; versuch += 1) {
      r = await ziehen(P, 'k2', 25, { pause: 40, dx: versuch % 2 ? -3 : 3, dabei: async () => { const f = await fl(); return { schritte: f.schritte ?? f.takte, takte: f.takte }; } });
      if (r.nach.takte - r.vor.takte > 5) break;
      await wecken();
    }
    console.log(`  (während des Zugs: ${r.nach.schritte - r.vor.schritte} Rechenschritte in ${r.nach.takte - r.vor.takte} Takten)`);
    pruefe('F2 während eine Karte gezogen wird, rechnet sie nicht, obwohl sie laufen will (vorher: jedes Bild)', r.nach.takte - r.vor.takte > 5 && r.nach.schritte - r.vor.schritte <= 1, { schritte: r.nach.schritte - r.vor.schritte, takte: r.nach.takte - r.vor.takte });
    // nach dem Ablegen ist sie nicht eingefroren: ein Zeiger über der Schrift bewegt sie wieder
    const s2 = (await fl()).schritte ?? 0;
    await wecken();
    const weiter = await warteBis(P, async () => ((await fl()).schritte ?? 0) > s2 + 5, 8000);
    pruefe('F3 nach dem Ablegen fließt sie weiter', weiter);
    // aus dem Bild schwenken: nichts rechnet mehr
    const fp = await freierPunkt(P); await P.keyboard.press('Escape'); await P.mouse.click(fp.x, fp.y); await P.mouse.move(fp.x, fp.y);
    for (let i = 0; i < 8; i += 1) { await P.mouse.wheel(0, -900); await P.waitForTimeout(80); }
    await P.waitForTimeout(1200);
    const draussen = await P.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="fl"]'); const r = e.getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth; });
    const s3 = (await fl()).schritte ?? 0; await P.waitForTimeout(1500); const s4 = (await fl()).schritte ?? 0;
    pruefe('F4 außerhalb des Bildes rechnet die Flüssigkeit nicht', draussen && s4 === s3, { draussen, s3, s4 });
  }
  await ctx.close();
}

/* ═══════════════════════ T: Tools ═══════════════════════ */
if (NUR.includes('T')) {
  console.log('\n════ T: Laufende Tools werden nicht neu geladen ════');
  const { ctx, P } = await seite({ pruefbetrieb: false });
  const bereit = await warteBis(P, () => P.evaluate(() => [...document.querySelectorAll('.happ-go')].filter((b) => !b.disabled).length >= 16), 20000);
  pruefe('T0 alle 16 Tools sind startbereit (Quelltext im Gerätespeicher)', bereit);
  // sechs Tools starten
  await P.evaluate(() => { [...document.querySelectorAll('.happ-go')].filter((b) => !b.disabled).slice(0, 6).forEach((b) => b.click()); });
  const gestartet = await warteBis(P, async () => (await zaehler(P)).boots >= 6, 30000);
  pruefe('T1 sechs Tools laufen', gestartet && (await P.locator('iframe.happ-frame').count()) === 6, await zaehler(P));
  await P.waitForTimeout(800);
  const vor = await zaehler(P);
  await ziehen(P, 'k2', 15);
  const laufend = await P.evaluate(() => document.querySelector('iframe.happ-frame')?.closest('.react-flow__node')?.getAttribute('data-id'));
  await ziehen(P, laufend, 15, { dx: 2, dy: 3 });
  await P.keyboard.press('Escape');
  const fp = await freierPunkt(P); await P.mouse.click(fp.x, fp.y); await P.mouse.move(fp.x, fp.y);
  await P.keyboard.down('Control'); for (let i = 0; i < 10; i += 1) { await P.mouse.wheel(0, i < 5 ? -80 : 80); await P.waitForTimeout(60); } await P.keyboard.up('Control');
  for (let i = 0; i < 6; i += 1) { await P.mouse.wheel(i < 3 ? 80 : -80, 40 * (i < 3 ? 1 : -1)); await P.waitForTimeout(60); }
  await P.waitForTimeout(1500);   // gedrosseltes Speichern läuft durch
  const nach = await zaehler(P);
  pruefe('T2 Ziehen (auch des Tools selbst), Zoomen, Schwenken und Speichern laden kein Tool neu', nach.boots === vor.boots && nach.rahmenLoad === vor.rahmenLoad && (await P.locator('iframe.happ-frame').count()) === 6, { vor: { boots: vor.boots, load: vor.rahmenLoad }, nach: { boots: nach.boots, load: nach.rahmenLoad } });
  await ctx.close();
}

await browser.close(); app.close();
if (fehler.length) { bad += 1; console.log(`  ✗ Seitenfehler: ${[...new Set(fehler)].slice(0, 4).join(' | ')}`); }
console.log(`\n${bad === 0 ? 'ALLES GRÜN' : 'ROT'} — ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad === 0 ? 0 : 1);
