/**
 * M346 — Scrollbalken der Notiz auf dem Board; aufgeräumter Zoom-Modus.
 *
 *   A  Board: Der Balken steht an jeder überlaufenden Notiz (ohne Zeiger), ist in jeder Zoomstufe
 *      breit und hoch genug, lässt sich ziehen — auch im weiten Zoom, ohne die Karte zu verschieben;
 *      über der gewählten Notiz rollt dort das Rad.
 *   B  Fokus: Die Notiz mit fester Höhe zeigt ihren ganzen Text; Nachbarn unter der vergrößerten
 *      Karte sind ausgeblendet; danach ist alles wie vorher.
 *   C  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m346-rollbalken-fokus.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4564;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const abs = (id, n) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, type: 'paragraph', content: `Zeile ${i + 1} — ein etwas längerer Satz, damit die Notiz wirklich überläuft.` }));
const nz = (id, x, y, h, n, farbe = 'yellow') => ({ id, type: 'note', width: 300, ...(h ? { height: h, autoFit: false } : {}), position: { x, y }, data: { color: farbe, blocks: abs(id, n) } });
const stand = (nah = false) => ({
  boards: [{ id: 'b1', name: 'Lang', comments: [], edges: [], drawings: [], nodes: [
    nz('n1', 0, 0, 220, 90), nz('n2', 320, 0, 220, 3, 'sky'), nz('n3', 0, 240, 200, 3, 'green'),
    nz('n5', 320, 240, 200, 4, 'white'), nz('n6', 1500, 0, 220, 3, 'pink'), nz('n7', -900, 0, 220, 3, 'pink'),
  ].filter((n) => !nah || !['n6', 'n7'].includes(n.id)) }],
  spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
});
async function seite(nah = false) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand(nah) });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await P.waitForTimeout(1800);
  return { ctx, P };
}
const karte = (P, id) => P.evaluate((id) => {
  const n = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  const s = n.querySelector('.card-shell'); const k = n.querySelector('.card-body'); const d = n.querySelector('.note-daumen'); const sp = n.querySelector('.note-spur');
  const r = n.getBoundingClientRect(); const dr = d?.getBoundingClientRect(); const cs = d ? getComputedStyle(d) : null;
  return {
    rollt: s.hasAttribute('data-rollt'), st: Math.round(k.scrollTop), sh: k.scrollHeight, ch: k.clientHeight, lh: n.offsetHeight,
    r: [r.left, r.top, r.width, r.height].map(Math.round), deckkraft: Number(getComputedStyle(n).opacity), weg: n.hasAttribute('data-fokus-weg'),
    daumen: d && dr ? { o: Number(cs.opacity), sicht: getComputedStyle(sp).visibility, anzeige: getComputedStyle(sp).display, w: Math.round(dr.width * 10) / 10, h: Math.round(dr.height), x: dr.left + dr.width / 2, y: dr.top + dr.height / 2 } : null,
    weit: !!n.closest('[data-weit]'), tf: n.style.transform,
  };
}, id);
const zoom = (P) => P.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1));
const kamera = (P) => P.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
/** Mit Strg+Rad auf (ungefähr) diese Zoomstufe — in kleinen Schritten, dann ruhen lassen */
const zoomAuf = async (P, ziel) => {
  await P.mouse.move(1200, 600);
  for (let i = 0; i < 80; i += 1) {
    const z = await zoom(P);
    if (Math.abs(z - ziel) / ziel < 0.04) break;
    await P.keyboard.down('Control'); await P.mouse.wheel(0, z > ziel ? 6 : -6); await P.keyboard.up('Control'); await P.waitForTimeout(40);
  }
  await P.waitForTimeout(450);
  return zoom(P);
};
const leer = (P) => P.mouse.click(1240, 640).then(() => P.waitForTimeout(250));
const ziehen = async (P, x, y, dy) => { await P.mouse.move(x, y); await P.mouse.down(); await P.mouse.move(x, y + dy / 2, { steps: 4 }); await P.mouse.move(x, y + dy, { steps: 4 }); await P.mouse.up(); await P.waitForTimeout(300); };

console.log('\n════ A: Scrollbalken auf dem Board ════');
{
  const { ctx, P } = await seite(true);   // nur die vier nahen Karten: Einpassen ergibt 100 %
  await P.mouse.move(1240, 640); await P.waitForTimeout(300);
  let k1 = await karte(P, 'n1'); const k2 = await karte(P, 'n2');
  pruefe('A1 die überlaufende Notiz zeigt den Balken, ohne dass der Zeiger auf ihr steht', (await zoom(P)) > 0.9 && k1.rollt && k1.daumen.anzeige === 'block' && k1.daumen.o >= 0.5, k1);
  pruefe('A2 eine Notiz ohne Überlauf hat keinen', !k2.rollt && k2.daumen.anzeige === 'none', k2);
  await ziehen(P, k1.daumen.x, k1.daumen.y, 60);
  let nach = await karte(P, 'n1');
  pruefe('A3 der Balken lässt sich ziehen — der Text rollt, die Karte bleibt', nach.st > 100 && nach.tf === k1.tf, [nach.st, nach.tf, k1.tf]);

  // mittlerer Zoom
  await leer(P);
  const z1 = await zoomAuf(P, 0.6); k1 = await karte(P, 'n1');
  pruefe('A4 herausgezoomt (nicht weit) bleibt der Balken greifbar: mindestens 8 × 24 Bildpunkte', z1 < 0.7 && !k1.weit && k1.daumen.w >= 8 && k1.daumen.h >= 24, [z1, k1.daumen]);

  // weiter Zoom
  const z2 = await zoomAuf(P, 0.3); k1 = await karte(P, 'n1');
  pruefe('A5 im weiten Zoom ist der Balken da und groß genug', z2 < 0.45 && k1.weit && k1.daumen.sicht === 'visible' && k1.daumen.o >= 0.5 && k1.daumen.w >= 8 && k1.daumen.h >= 24, [z2, k1.daumen, k1.weit]);
  const vorSt = k1.st;
  await ziehen(P, k1.daumen.x, k1.daumen.y, vorSt > 300 ? -14 : 14);
  nach = await karte(P, 'n1');
  pruefe('A6 im weiten Zoom rollt der Zug am Balken den Text und verschiebt die Karte nicht', Math.abs(nach.st - vorSt) > 60 && nach.tf === k1.tf, [vorSt, nach.st, nach.tf, k1.tf]);
  // Rad: ungewählt bleibt der Text stehen, gewählt rollt er
  await leer(P);
  const mitteX = nach.r[0] + nach.r[2] / 2 - 10; const mitteY = nach.r[1] + nach.r[3] / 2;
  await P.evaluate(() => { document.querySelector('.react-flow__node[data-id="n1"] .card-body').scrollTop = 0; }); await P.waitForTimeout(200);
  const kamVor = await kamera(P);
  await P.mouse.move(mitteX, mitteY); await P.mouse.wheel(0, 240); await P.waitForTimeout(400);
  const ungewaehlt = await karte(P, 'n1'); const kamNach = await kamera(P);
  const jetzt = await karte(P, 'n1');
  await P.mouse.click(jetzt.r[0] + jetzt.r[2] / 2 - 10, jetzt.r[1] + jetzt.r[3] / 2); await P.waitForTimeout(350);
  const gew = await P.evaluate(() => document.querySelector('.react-flow__node[data-id="n1"]').classList.contains('selected'));
  const k = await karte(P, 'n1');
  await P.mouse.move(k.r[0] + k.r[2] / 2 - 10, k.r[1] + k.r[3] / 2); await P.mouse.wheel(0, 240); await P.waitForTimeout(400);
  const gewaehlt = await karte(P, 'n1');
  pruefe('A7 weiter Zoom: über der ungewählten Notiz bewegt das Rad das Board, über der gewählten den Text',
    ungewaehlt.st === 0 && kamNach !== kamVor && gew && gewaehlt.st > 100 && gewaehlt.tf === k.tf, [ungewaehlt.st, kamVor !== kamNach, gew, gewaehlt.st]);
  await ctx.close();
}

console.log('\n════ B: Zoom-Modus (Fokus) ════');
{
  const { ctx, P } = await seite();
  const vor = {}; for (const id of ['n1', 'n2', 'n3', 'n5', 'n6', 'n7']) vor[id] = await karte(P, id);
  await P.mouse.click(vor.n1.r[0] + vor.n1.r[2] / 2, vor.n1.r[1] + Math.min(8, vor.n1.r[3] / 5)); await P.waitForTimeout(300);
  await P.keyboard.press('Alt+f'); await P.waitForTimeout(1600);
  const f = {}; for (const id of ['n1', 'n2', 'n3', 'n5', 'n6', 'n7']) f[id] = await karte(P, id);
  pruefe('B1 die Notiz mit fester Höhe zeigt im Fokus ihren ganzen Text (kein innerer Überlauf)', f.n1.lh > 600 && f.n1.sh - f.n1.ch <= 4 && !f.n1.rollt, f.n1);
  pruefe('B2 Nachbarn, die unter der vergrößerten Karte lägen, sind ausgeblendet', ['n2', 'n3', 'n5'].every((id) => f[id].weg && f[id].deckkraft === 0), [f.n2, f.n3, f.n5].map((x) => [x.weg, x.deckkraft]));
  pruefe('B3 entfernte Karten bleiben als abgedunkelte Umgebung', ['n6', 'n7'].every((id) => !f[id].weg && f[id].deckkraft > 0.1 && f[id].deckkraft < 0.4), [f.n6.deckkraft, f.n7.deckkraft, f.n6.weg, f.n7.weg]);
  const schnitt = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  const sichtbarDrauf = ['n2', 'n3', 'n5', 'n6', 'n7'].filter((id) => f[id].deckkraft > 0 && schnitt(f[id].r, f.n1.r));
  pruefe('B4 keine sichtbare Karte überlappt die Karte im Fokus', sichtbarDrauf.length === 0, sichtbarDrauf);
  const kam = await kamera(P);
  await P.mouse.move(640, 400); await P.mouse.wheel(0, 300); await P.waitForTimeout(500);
  pruefe('B5 das Rad rollt die Kamera über den langen Text', (await kamera(P)) !== kam, kam);
  const balken = () => P.evaluate(() => { const s = document.querySelector('.fokus-spur'); const d = s?.firstElementChild; const r = d?.getBoundingClientRect(); return { an: !!s && getComputedStyle(s).display === 'block', x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0, top: r ? Math.round(r.top) : 0, h: r ? Math.round(r.height) : 0 }; });
  const b1 = await balken();
  pruefe('B5b der Fokus zeigt einen Scrollbalken, der Stand ist nach dem Rollen nicht mehr oben', b1.an && b1.h >= 40 && b1.top > 70, b1);
  const kam2 = await kamera(P);
  await ziehen(P, b1.x, b1.y, 120);
  const b2 = await balken();
  pruefe('B5c der Balken lässt sich ziehen — die Kamera rollt mit', (await kamera(P)) !== kam2 && b2.top > b1.top + 60, [b1.top, b2.top]);
  const fokusNoch = await P.evaluate(() => !!document.querySelector('.app.focus-mode'));
  pruefe('B5d der Zug am Balken schließt den Fokus nicht', fokusNoch);
  await P.keyboard.press('Escape'); await P.waitForTimeout(1200);
  const b3 = await balken();
  pruefe('B5e außerhalb des Fokus ist der Balken weg', !b3.an, b3);
  const z = {}; for (const id of ['n1', 'n2', 'n3', 'n5']) z[id] = await karte(P, id);
  pruefe('B6 nach dem Fokus: Höhe, Überlauf und Nachbarn wie vorher', z.n1.lh === vor.n1.lh && z.n1.rollt && ['n2', 'n3', 'n5'].every((id) => !z[id].weg && z[id].deckkraft === 1), [z.n1.lh, vor.n1.lh, z.n1.rollt, z.n2.weg, z.n2.deckkraft]);
  const st = await P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'n1'));
  pruefe('B7 die gespeicherte Höhe der Notiz ist unverändert', st.height === 220, st.height);
  // kurze Notiz mit fester Höhe: im Fokus nicht kleiner als auf dem Board
  await leer(P);
  const k3 = await karte(P, 'n3');
  await P.mouse.click(k3.r[0] + k3.r[2] / 2, k3.r[1] + Math.min(8, k3.r[3] / 5)); await P.waitForTimeout(300);
  await P.keyboard.press('Alt+f'); await P.waitForTimeout(1500);
  const f3 = await karte(P, 'n3');
  pruefe('B8 eine kurze Notiz wird im Fokus nicht kleiner als auf dem Board', f3.lh >= 200, f3.lh);
  pruefe('B9 passt die Karte ganz ins Bild, gibt es keinen Balken', !(await balken()).an);
  await ctx.close();
}

console.log('\n════ C: Texte ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('C1 „Was ist neu" nennt M346', js.includes('(M346)') && js.includes('Scrollbalken immer da'));

await browser.close(); app.close();
console.log(`\nm346-rollbalken-fokus: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
