/**
 * M491 — 60 Bilder je Sekunde beim Ziehen mit vielen Verbindungen.
 *
 *   L  Leistung: 200 Karten mit 100 Verbindungen gegen dieselben Karten ohne Verbindung (im Wechsel, je drei Läufe,
 *      der beste zählt — die Prüf-Maschine ist oft ausgelastet, der Abstand zum Board ohne Kanten schwankt kaum).
 *      Median der Bildzeit ≤ 20 ms (auf einer vollen Maschine: höchstens ein Viertelbild über dem Board ohne
 *      Verbindungen), Maus → Bild höchstens 15 ms über dem Board ohne Verbindungen.
 *   T  Trace (Thread-Zeit, unabhängig von fremder Last): Chromium ordnet die Ebenen nicht mehr in jedem Bild neu ein
 *      (Layerize), und keine Stil-Rechnung über das ganze Dokument (`:has()` nach Ein-/Aushängen der Fanglinien).
 *      M539: auch das Nachladen nach dem Start hängt im Zug nichts in den Kopf (T3).
 *   S  Schatten: im Ruhezustand wie vorher; im Zug ist der Schatten der bewegten Kante weg (und rastert nicht neu),
 *      nach dem Ablegen ist er an der neuen Stelle zurück; zurückgezogen sieht das Board Bild für Bild aus wie vorher.
 *   B  Bedienung: die leere Beschriftung („+" in der Mitte einer Verbindung) ist nach dem Zug wieder da und liegt oben;
 *      der feste Rahmen einer Kante im Zug fängt nie einen Klick.
 */
// Läuft aus dem Repository: `node pruefungen/m491-kanten-60fps.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { cpuAnteil, ruhigeMaschine, bildGrenze, lastText } from '../werkzeug/maschinen-last.mjs';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5491;
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
// nur einzelne Abschnitte (Fehlersuche): M491_NUR=SB node pruefungen/m491-kanten-60fps.mjs
const NUR = process.env.M491_NUR ?? 'LTSB';

const nz = (id, x, y, farbe = 'yellow') => ({ id, type: 'note', width: 200, height: 120, autoFit: false, position: { x, y }, data: { color: farbe, blocks: [{ id: id + 't', type: 'paragraph', content: id }] } });
const kante = (id, source, target) => ({ id, source, target, type: 'labeled', data: { label: '', kind: 'arrow' } });
const board = (nodes, edges) => ({
  boards: [{ id: 'b1', name: 'Viele Verbindungen', comments: [], edges, drawings: [], nodes }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board',
});
// wie M486: 200 Karten im Raster 20 × 10, 100 Verbindungen (Nachbarn, schräg in die nächste und übernächste Reihe)
const VIELE = (kanten = 100) => {
  const nodes = []; const edges = [];
  for (let i = 0; i < 200; i += 1) nodes.push(nz(`k${i}`, (i % 20) * 230, Math.floor(i / 20) * 150, i % 3 ? 'yellow' : 'sky'));
  for (let i = 0; i < kanten; i += 1) {
    const s = 2 * i; const t = (s + 1 + 20 * (i % 3)) % 200;
    edges.push(kante(`v${i}`, `k${s}`, `k${t}`));
  }
  return board(nodes, edges);
};
// klein: drei Karten, zwei Verbindungen — a wird gezogen, b und c bleiben
const KLEIN = () => board([nz('a', 0, 0), nz('b', 420, 40, 'sky'), nz('c', 0, 320, 'green')], [kante('w1', 'a', 'b'), kante('w2', 'c', 'b')]);

async function seite(st, { dunkel = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  // M507: PN_DESIGN=pixel fährt dieselbe Reihe im Design „pix·el" (Pixel-Rahmen aus harten Schatten)
  await ctx.addInitScript(([st, dunkel, design]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false, ...(dunkel ? { theme: 'dark' } : {}),
      ...(design ? { ui: { theme: dunkel ? 'dark' : 'light', accent: 'blau', design } } : {}) }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [st, dunkel, process.env.PN_DESIGN ?? '']);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P };
}
const rahmen = (P, id) => P.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, id);
const med = (a) => a[Math.floor(a.length / 2)] ?? Infinity;

/* ═══════════════════════ Leistung ═══════════════════════ */
/** Ein Zug über das volle Board wie in M486: Bildzeit (Abstand der Animations-Rückrufe) und Maus → Bild. */
async function messen(kanten, { trace = false } = {}) {
  const { ctx, P } = await seite(VIELE(kanten));
  const r42 = await rahmen(P, 'k42');
  const g = [r42.cx, r42.cy];
  await P.evaluate(() => {
    const el = document.querySelector('.react-flow__node[data-id="k42"]');
    const lat = []; let t0 = 0;
    window.__pnLatenz = lat;
    window.addEventListener('pointermove', (e) => { if (!t0) t0 = e.timeStamp; }, true);
    new MutationObserver(() => { if (!t0) return; const t = t0; t0 = 0; requestAnimationFrame(() => lat.push(performance.now() - t)); })
      .observe(el, { attributes: true, attributeFilter: ['style'] });
  });
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + 3, g[1] + 3, { steps: 2 }); await P.mouse.move(g[0] + 6, g[1] + 6, { steps: 2 });
  await P.waitForTimeout(300);
  let cdp = null;
  if (trace) {
    cdp = await ctx.newCDPSession(P);
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink', transferMode: 'ReturnAsStream' });
  }
  await P.evaluate(() => { window.__pnLatenz.length = 0; });
  const takt = P.evaluate(() => new Promise((res) => { const z = []; let l = performance.now(); let k = 0; const f = (t) => { z.push(t - l); l = t; if (++k < 90) requestAnimationFrame(f); else res(z); }; requestAnimationFrame(f); }));
  for (let i = 1; i <= 50; i += 1) { await P.mouse.move(g[0] + i * 14, g[1] + Math.sin(i / 4) * 120); await P.waitForTimeout(16); }
  const zt = (await takt).slice(3).sort((x, y) => x - y);
  const lat = (await P.evaluate(() => window.__pnLatenz.slice())).sort((x, y) => x - y);
  let spur = null;
  if (cdp) {
    const fertig = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
    await cdp.send('Tracing.end');
    const { stream } = await fertig;
    let s = ''; for (;;) { const c = await cdp.send('IO.read', { handle: stream }); s += c.data; if (c.eof) break; }
    spur = auswerten(JSON.parse(s));
  }
  await P.mouse.up(); await P.waitForTimeout(600);
  await ctx.close();
  const m = { bild: med(zt), latenz: med(lat), n: lat.length, spur };
  console.log(`  (${kanten} Verbindungen: Bildzeit Median ${m.bild.toFixed(1)} ms · Maus → Bild ${m.latenz.toFixed(1)} ms aus ${m.n}${spur ? ` · Layerize je Bild ${spur.layerize.toFixed(2)} ms · Stil über > 1000 Elemente: ${spur.gross}` : ''})`);
  return m;
}
/** Aus einem Chromium-Trace: Thread-Zeit (tdur) des Layerize je Bild (Median) und Stil-Rechnungen über > 1000 Elemente */
function auswerten(t) {
  const ev = t.traceEvents ?? t;
  const namen = {}; for (const e of ev) if (e.name === 'thread_name') namen[`${e.pid}:${e.tid}`] = e.args.name;
  const zahl = {}; for (const e of ev) { const k = `${e.pid}:${e.tid}`; if (namen[k] === 'CrRendererMain') zahl[k] = (zahl[k] ?? 0) + 1; }
  const haupt = Object.entries(zahl).sort((a, b) => b[1] - a[1])[0]?.[0];
  const auf = (e) => `${e.pid}:${e.tid}` === haupt && e.ph === 'X';
  const lz = ev.filter((e) => auf(e) && e.name === 'Layerize').map((e) => (e.tdur ?? e.dur) / 1000).sort((a, b) => a - b);
  const gross = ev.filter((e) => auf(e) && e.name === 'UpdateLayoutTree' && (e.args?.elementCount ?? 0) > 1000).length;
  return { layerize: med(lz), bilder: lz.length, gross };
}

if (NUR.includes('L')) {
  console.log('\n════ L: 200 Karten, 100 Verbindungen (Vergleich: dieselben Karten ohne Verbindung) ════');
  // M518: Bildzeit und Verzögerung sind ZEIT-Messungen – unter fremder Last (mehrere Agenten, 4 Kerne) hielt das
  // Board ohne Verbindungen noch 16,7 ms, das mit 100 Verbindungen fiel auf 33,3 ms (jedes zweite Bild), obwohl
  // die App nicht langsamer rechnete: in fünf Läufen unter Last fünfmal rot, allein grün. Darum misst jeder Lauf
  // die Maschine mit (werkzeug/maschinen-last.mjs): vorher kurz auf einen ruhigen Moment warten, danach den Anteil
  // der freien Rechenzeit festhalten. War die Maschine ruhig, gelten 20 ms und 15 ms unverändert; nur für einen
  // Lauf auf nachweislich ausgelasteter Maschine werden sie auf den gemessenen Anteil umgerechnet (ganze Bilder).
  const lauf = async (kanten) => { const vor = await ruhigeMaschine(6000); const m = await messen(kanten); return { ...m, anteil: Math.min(vor, await cpuAnteil()) }; };
  const ohne = []; const mit = [];
  for (let i = 0; i < 3; i += 1) { ohne.push(await lauf(0)); mit.push(await lauf(100)); }
  const best = (l) => ({ bild: Math.min(...l.map((m) => m.bild)), latenz: Math.min(...l.map((m) => m.latenz)), n: Math.max(...l.map((m) => m.n)) });
  const o = best(ohne); const m = best(mit);
  const ruhigste = Math.max(...mit.map((x) => x.anteil));
  console.log(`  (bester Lauf — ohne: ${o.bild.toFixed(1)} ms / ${o.latenz.toFixed(1)} ms · mit 100 Verbindungen: ${m.bild.toFixed(1)} ms / ${m.latenz.toFixed(1)} ms · ${lastText(ruhigste)})`);
  // Ziel: 60 Bilder je Sekunde wie ohne Verbindungen. Ist die Maschine so voll, dass schon das Board ohne
  // Verbindungen keine 60 schafft, gilt: höchstens ein Viertelbild darüber.
  const l1 = mit.some((x) => x.bild <= Math.max(bildGrenze(20, x.anteil), o.bild + 4));
  const l2 = mit.some((x) => x.n >= 10 && x.latenz <= o.latenz + bildGrenze(15, x.anteil));
  const zahlen = { ohne: [o.bild, o.latenz], mit: mit.map((x) => ({ bild: x.bild, latenz: x.latenz, n: x.n, anteil: Number(x.anteil.toFixed(2)) })) };
  pruefe('L1 Median der Bildzeit mit 100 Verbindungen ≤ 20 ms (bzw. ≤ Board ohne Verbindungen + 4 ms)', l1, zahlen);
  pruefe('L2 Maus → Bild mit 100 Verbindungen höchstens 15 ms über dem Board ohne Verbindungen', l2, zahlen);
}

if (NUR.includes('T')) {
  console.log('\n════ T: was der Browser je Bild tut (Trace, Thread-Zeit) ════');
  const ohne = await messen(0, { trace: true });
  const mit = await messen(100, { trace: true });
  // vorher: 6–7 ms je Bild mit Verbindungen (jede Kante, die der Karte folgt, änderte die Ausdehnung ihres
  // Mal-Abschnitts), ohne Verbindungen unter 1 ms
  pruefe('T1 Layerize je Bild (Median) mit 100 Verbindungen höchstens 1,5 ms über dem Board ohne Verbindungen', mit.spur.layerize <= ohne.spur.layerize + 1.5, { mit: mit.spur, ohne: ohne.spur });
  // vorher: 36 Mal auf 50 Mausbewegungen je 7 000–8 400 Elemente (Fanglinien ein- und ausgehängt → `:has()`)
  pruefe('T2 im Zug keine Stil-Rechnung über das ganze Dokument (höchstens eine, beim ersten Platz für eine Fanglinie)', mit.spur.gross <= 1 && ohne.spur.gross <= 1, { mit: mit.spur.gross, ohne: ohne.spur.gross });

  // M539: Was die App nach dem Start von selbst nachlädt (4 s nach dem Laden: Vorladen, Zurück-Taste, Texterkennung),
  // hängt `<link rel="modulepreload">` in den Kopf — mitten im Zug rechnete Chromium dafür den Stil des ganzen
  // Dokuments neu (T2 rot seit M534). Ein Zug über diesen Zeitpunkt: im Zug kommt nichts in den Kopf, danach schon.
  let t3 = null;
  for (let v = 0; v < 3 && !t3; v += 1) {
    const { ctx, P } = await seite(VIELE(0));
    await P.evaluate(() => {
      window.__pnKopf = [];
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__pnKopf.push([performance.now(), n.nodeName, (n.href ?? n.textContent ?? '').slice(-60)]); })
        .observe(document.head, { childList: true });
    });
    const r = await rahmen(P, 'k42');
    const start = await P.evaluate(() => performance.now());
    if (start > 3300) { await ctx.close(); continue; }   // Start unter Last zu langsam: der Zeitpunkt läge vor dem Zug
    // Der Druck selbst darf holen, was er braucht (z. B. lib/stricheLoesen) — gezählt wird ab dem laufenden Zug
    await P.mouse.move(r.cx, r.cy); await P.mouse.down();
    await P.mouse.move(r.cx + 3, r.cy + 3, { steps: 2 }); await P.mouse.move(r.cx + 6, r.cy + 6, { steps: 2 });
    await P.waitForTimeout(150);
    const ab = await P.evaluate(() => performance.now());
    for (let i = 1; await P.evaluate(() => performance.now()) < 6500; i += 1) { await P.mouse.move(r.cx + (i % 40) * 6, r.cy + Math.sin(i / 5) * 60); await P.waitForTimeout(40); }
    const bis = await P.evaluate(() => performance.now());
    await P.mouse.up();
    await P.waitForTimeout(4000);
    const k = await P.evaluate(() => window.__pnKopf.slice());
    t3 = { zugAb: Math.round(ab), zugBis: Math.round(bis), imZug: k.filter(([t]) => t > ab && t < bis).length, was: k.filter(([t]) => t > ab && t < bis).slice(0, 4).map((x) => [Math.round(x[0]), x[1], x[2]]), danach: k.filter(([t]) => t >= bis).length };
    await ctx.close();
  }
  pruefe('T3 im Zug hängt das Nachladen nach dem Start nichts in den Kopf, nach dem Ablegen kommt es', !!t3 && t3.imZug === 0 && t3.danach > 0, t3 ?? 'Start dreimal zu langsam');
}

/* ═══════════════════════ Schatten ═══════════════════════ */
/** Bildpunkte zweier Bildschirmfotos (PNG) im Browser vergleichen: Anteil abweichender Punkte */
async function abweichung(P, a, b) {
  return P.evaluate(async ([a, b]) => {
    const lade = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${s}`; });
    const [ia, ib] = await Promise.all([lade(a), lade(b)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d');
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 12) n += 1;
    return n / (da.length / 4);
  }, [a.toString('base64'), b.toString('base64')]);
}
const schattenVon = (P, id) => P.evaluate((id) => {
  const p = document.querySelector(`.pn-schatten-ebene .pn-kante-schatten[data-kante="${id}"]`);
  if (!p) return null;
  return { d: p.getAttribute('d'), deckung: Number(getComputedStyle(p).strokeOpacity), sichtbar: getComputedStyle(p).display !== 'none' };
}, id);
const kantePfad = (P, id) => P.evaluate((id) => document.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`)?.getAttribute('d') ?? '', id);
/** Erster und letzter Punkt eines Pfads (M x,y … L x,y) */
const enden = (d) => { const z = (d.match(/-?[\d.]+/g) ?? []).map(Number); return [z[0], z[1], z[z.length - 2], z[z.length - 1]]; };

for (const dunkel of NUR.includes('S') ? [false, true] : []) {
  console.log(`\n════ S: Schatten im Zug und danach (${dunkel ? 'dunkel' : 'hell'}) ════`);
  const { ctx, P } = await seite(KLEIN(), { dunkel });
  // die Fläche ohne Kopfleiste (dort wechseln Rückgängig/Wiederholen ihren Zustand) und ohne Dock
  const clip = { x: 0, y: 80, width: 1440, height: 720 };
  const vorher = await P.screenshot({ clip });
  const s0 = await schattenVon(P, 'w1');
  pruefe(`S0 ruhend: Schatten unter der Verbindung, voll sichtbar (${dunkel ? 'dunkel' : 'hell'})`, !!s0 && s0.sichtbar && s0.deckung === 1, s0);
  const a = await rahmen(P, 'a');
  await P.mouse.move(a.cx, a.cy); await P.mouse.down();
  await P.mouse.move(a.cx + 4, a.cy + 4, { steps: 2 });
  await P.keyboard.down('Control');   // frei ablegen (ohne Fanglinien) — so führt der Rückweg genau zurück
  for (let i = 1; i <= 12; i += 1) { await P.mouse.move(a.cx + 4 + i * 6, a.cy + 4 + i * 9); await P.waitForTimeout(20); }
  await P.waitForTimeout(250);
  const imZug = await schattenVon(P, 'w1');
  const fern = await schattenVon(P, 'w2');
  pruefe('S1 im Zug: der Schatten der bewegten Kante ist ausgeblendet und rührt sich nicht (kein Neurastern)', imZug.deckung === 0 && imZug.d === s0.d, imZug);
  pruefe('S2 im Zug: Schatten der ruhenden Kante unverändert sichtbar', fern.deckung === 1, fern);
  await P.mouse.up(); await P.keyboard.up('Control');
  await P.waitForTimeout(1400);
  const danach = await schattenVon(P, 'w1');
  const linie = await kantePfad(P, 'w1');
  const [sx, sy, tx, ty] = enden(danach.d); const [lx, ly, mx, my] = enden(linie);
  pruefe('S3 nach dem Ablegen: Schatten zurück, voll sichtbar und an der neuen Stelle (Enden an der Linie)', danach.deckung === 1 && danach.d !== s0.d && Math.hypot(sx - lx, sy - ly) < 1 && Math.hypot(tx - mx, ty - my) < 1, { danach, linie });
  // Zurückziehen an genau dieselbe Stelle: das Board steht wieder wie vorher — Bild für Bild (auch der weiche Schatten)
  const a2 = await rahmen(P, 'a');
  await P.mouse.move(a2.cx, a2.cy); await P.mouse.down();
  await P.mouse.move(a2.cx - 4, a2.cy - 4, { steps: 2 });
  await P.keyboard.down('Control');
  for (let i = 1; i <= 12; i += 1) { await P.mouse.move(a2.cx - 4 - i * 6, a2.cy - 4 - i * 9); await P.waitForTimeout(20); }
  // React Flow schluckt beim Anfassen ein paar Punkte (Zieh-Schwelle) — genauso viel wie beim Hinweg
  const schluck = [76 - (a2.cx - a.cx), 112 - (a2.cy - a.cy)];
  await P.mouse.move(a.cx - schluck[0], a.cy - schluck[1], { steps: 3 }); await P.waitForTimeout(150);
  await P.mouse.up(); await P.keyboard.up('Control'); await P.waitForTimeout(300);
  await P.mouse.click(1300, 760); await P.waitForTimeout(1400);
  const lage = await rahmen(P, 'a');
  pruefe('S4a die Karte steht wieder an derselben Stelle', Math.abs(lage.x - a.x) < 0.5 && Math.abs(lage.y - a.y) < 0.5, { lage, a });
  const zurueck = await P.screenshot({ clip });
  const abw = await abweichung(P, vorher, zurueck);
  console.log(`  (abweichende Bildpunkte nach Hin- und Zurückziehen: ${(abw * 100).toFixed(3)} %)`);
  pruefe('S4 nach Hin- und Zurückziehen sieht das Board aus wie vorher (Schatten weich wie im Ruhezustand)', abw < 0.0005, { abw });
  await ctx.close();
}

/* ═══════════════════════ Bedienung ═══════════════════════ */
if (NUR.includes('B')) {
  console.log('\n════ B: Beschriftung und Rahmen ════');
  const { ctx, P } = await seite(KLEIN());
  const plus = async () => P.evaluate(() => {
    const e = document.querySelector('.edge-label[data-edge-id="w1"]'); if (!e) return null;
    const r = e.getBoundingClientRect(); const t = e.querySelector('.edge-label-text')?.getBoundingClientRect();
    return { x: t ? t.left + t.width / 2 : 0, y: t ? t.top + t.height / 2 : 0, da: getComputedStyle(e).display !== 'none' && r.width > 0 };
  });
  const p0 = await plus();
  pruefe('B0 ruhend: die (unsichtbare) Beschriftungsstelle der Verbindung ist da', p0?.da === true, p0);
  const a = await rahmen(P, 'a');
  await P.mouse.move(a.cx, a.cy); await P.mouse.down();
  for (let i = 1; i <= 8; i += 1) { await P.mouse.move(a.cx + i * 5, a.cy + i * 6); await P.waitForTimeout(20); }
  const imZug = await plus();
  pruefe('B1 im Zug ist die leere Beschriftung aus dem Bild (sie war die eigene Ebene, die jedes Bild neu eingeordnet wurde)', imZug?.da === false, imZug);
  // Der feste Rahmen der Kante (durchsichtig, riesig) fängt im Zug keinen Treffer
  const treffer = await P.evaluate(() => { const e = document.elementFromPoint(1300, 820); return e ? (e.closest('.react-flow__edge') ? 'kante' : e.className?.baseVal ?? e.className) : null; });
  pruefe('B2 im Zug: ein Punkt weit weg von jeder Linie trifft keine Verbindung', treffer !== 'kante', treffer);
  await P.mouse.up(); await P.waitForTimeout(900);
  const p1 = await plus();
  pruefe('B3 nach dem Ablegen ist die Beschriftungsstelle wieder da', p1?.da === true, p1);
  const ziel = await P.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [p1.x, p1.y]);
  pruefe('B4 … und liegt wieder oben (ein Klick dort trifft die Beschriftung, nicht die Fläche)', ziel === 'edge-label-text', ziel);
  const ruhendTreffer = await P.evaluate(() => { const e = document.elementFromPoint(1300, 820); return e?.closest('.react-flow__edge') ? 'kante' : 'frei'; });
  pruefe('B5 ruhend: derselbe Punkt trifft ebenfalls keine Verbindung', ruhendTreffer === 'frei', ruhendTreffer);
  await ctx.close();
}

pruefe('keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
console.log('\n════ D: Doku ════');
{
  pruefe('D1 Meilenstein-Datei liegt vor', existsSync(path.join(__repo, 'docs/meilensteine/M491-kanten-60fps.md')));
}
await browser.close(); app.close();
console.log(`\nM491: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
