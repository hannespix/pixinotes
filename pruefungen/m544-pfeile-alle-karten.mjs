/**
 * M544 — Pfeile lassen sich von jeder Kartenart aus ziehen.
 *
 * Rückmeldung des Besitzers: „warum lassen sich manche module nicht mit pfeilen verknüpfen? bug?"
 *
 * Ursachen:
 *  1. Nachgeladene Karten (Kanban, Diagramm, Tabelle, Gantt, Kalender, Wochenplan, Protokoll, Zeiterfassung, Form,
 *     HTML-Tool, Bubbles, Kontakt, flüssige Schrift, Pixi): Erst steht ein Platzhalter ohne Anschlusspunkte da, React
 *     Flow merkt sich „keine Anschlusspunkte" und misst nur bei einer Größenänderung neu. Die fertige Karte hat dieselbe
 *     Größe — von ihr ließ sich kein Pfeil ziehen (Pfeile ZU ihr gingen).
 *  2. Rahmen und flüssige Schrift sind innen für den Zeiger durchlässig: Auf dem Weg vom Inhalt zum Anschlusspunkt am
 *     Rand verließ man die Karte, der Punkt verschwand und war nicht zu greifen.
 *
 * Gemessen wird Verhalten: Board mit einer Notiz und einer Karte der Art; Zeiger auf die Karte, zum rechten
 * Anschlusspunkt, kurz ruhen (150 ms, wie ein Mensch), drücken, zur Notiz ziehen, loslassen → eine Verbindung mehr im
 * gespeicherten Stand. „Ruhige" Karten (Bild, Pixi: Anschlusspunkte erst an der gewählten Karte, gewollt) werden vorher
 * gewählt. Dazu je Art die Gegenrichtung (Notiz → Karte; beim Rahmen auch losgelassen auf seinem Titel).
 *  3. Rahmen hatten kein Ganzkarten-Ziel: Ein Pfeil zu einem Rahmen zählte nur auf einem der vier Punkte.
 */
// Läuft aus dem Repository: `node pruefungen/m544-pfeile-alle-karten.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = Number(process.env.M544_PORT ?? 5544);
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  let f = path.join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const DATEN = {
  note: { blocks: [{ id: 'x', type: 'paragraph', content: 'Hallo' }] }, image: { src: PNG, name: 'p.png' },
  mermaid: { code: 'graph TD; A-->B' }, htmlapp: { html: '<p>Hi</p>' }, fluessig: { text: 'Welle' }, frame: { name: 'R' },
  shape: { form: 'rect' }, email: { subject: 'Hallo', from: 'a@b.c', body: 'x' }, kontakt: { name: 'Max' },
};
const TYPEN = (process.env.TYPEN ?? 'note,email,image,file,kanban,portal,shape,mermaid,gantt,calendar,frame,week,sheet,minutes,time,htmlapp,bubbles,kontakt,fluessig,pixi').split(',');
const RUHIG = new Set(['image', 'pixi']);

async function versuch(typ, richtung, aufTitel = false) {
  const nodes = [
    { id: 'q', type: 'note', width: 260, position: { x: 0, y: 0 }, data: DATEN.note },
    { id: 'z', type: typ, width: 320, height: 240, position: { x: 600, y: 0 }, data: DATEN[typ] ?? {} },
  ];
  const st = { boards: [{ id: 'b1', name: 'B', edges: [], drawings: [], comments: [], nodes }], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false };
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route((u) => !u.href.startsWith(`http://localhost:${PORT}`), (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((s) => {
    try { if (window !== window.top) return; } catch { return; }
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, st);
  const P = await ctx.newPage();
  const fehler = []; P.on('pageerror', (e) => fehler.push(e.message.slice(0, 120)));
  await P.goto(`http://localhost:${PORT}/`);
  await P.waitForSelector('.react-flow__node[data-id="z"]', { timeout: 30000 });
  await P.waitForTimeout(2500);   // nachgeladene Karte da, Anfangs-Messungen vorbei
  const kanten = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board') || '{}')?.state?.boards?.[0]?.edges?.length ?? -1);
  const [vonId, nachId] = richtung === 'aus' ? ['z', 'q'] : ['q', 'z'];
  const von = P.locator(`.react-flow__node[data-id="${vonId}"]`);
  const vb = await von.boundingBox();
  if (vonId === 'z' && RUHIG.has(typ)) { await P.mouse.click(vb.x + vb.width - 30, vb.y + vb.height - 20); await P.waitForTimeout(300); }
  await P.mouse.move(vb.x + vb.width / 2, vb.y + 20); await P.waitForTimeout(400);
  const hb = await von.locator('.react-flow__handle-right.pn-handle').first().boundingBox().catch(() => null);
  // Rahmen: losgelassen in der (sonst durchklickbaren) Fläche oder auf dem Titel über dem Rahmen
  const zielSel = aufTitel ? `.react-flow__node[data-id="z"] .frame-head` : `.react-flow__node[data-id="${nachId}"]`;
  const zb = await P.locator(zielSel).first().boundingBox();
  const k0 = await kanten();
  if (hb && zb) {
    const hx = hb.x + hb.width / 2; const hy = hb.y + hb.height / 2;
    await P.mouse.move(hx, hy, { steps: 4 }); await P.waitForTimeout(150);
    await P.mouse.down();
    const tx = zb.x + zb.width / 2; const ty = zb.y + zb.height / 2;
    for (let i = 1; i <= 12; i++) { await P.mouse.move(hx + (tx - hx) * i / 12, hy + (ty - hy) * i / 12); await P.waitForTimeout(20); }
    await P.mouse.up(); await P.waitForTimeout(900);
  }
  const k1 = await kanten();
  await ctx.close();
  return { neu: k1 - k0, anschluss: !!hb, fehler };
}

console.log('\n════ Pfeil von jeder Kartenart zur Notiz und zurück ════');
for (const typ of TYPEN) {
  const aus = await versuch(typ, 'aus');
  pruefe(`${typ}: Pfeil von der Karte aus`, aus.neu === 1 && !aus.fehler.length, aus);
  if (typ === 'note') continue;
  const hin = await versuch(typ, 'hin');
  pruefe(`${typ}: Pfeil zur Karte hin`, hin.neu === 1 && !hin.fehler.length, hin);
  if (typ === 'frame') {
    const titel = await versuch(typ, 'hin', true);
    pruefe('frame: Pfeil zum Rahmen, losgelassen auf seinem Titel', titel.neu === 1 && !titel.fehler.length, titel);
  }
}

await browser.close();
app.close();
console.log(`\nm544-pfeile-alle-karten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
