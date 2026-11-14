/**
 * M370 — Leerer Start; ein geteilter Link zeigt nur das geteilte Board.
 *
 * Bisher lag beim ersten Start die Beispiel-Umgebung da (4 Bereiche, 18 Boards) — auch bei jemandem, der nur
 * einen geteilten Link geöffnet hatte: neben dem einen Board, um das es ging, stand eine fremde Welt.
 *
 *   A  Erster Start: ein leeres Board, Begrüßung, auf dem Board das Angebot „Beispiele laden"; bleibt nach Neuladen so.
 *   B  Begrüßung → „Beispiele laden": die Beispiel-Umgebung, ohne das leere Startboard.
 *   C  Leeres Board → „Beispiele laden": dasselbe.
 *   D  Wer schon etwas Eigenes hat und Beispiele holt (＋ Neu), behält sein Board.
 *   E  Geteilter Link (#b=) bei einem Fremden: nur das geteilte Board, keine Begrüßung.
 *   F  … bei jemandem mit eigenen Boards: das geteilte kommt dazu; ein benutztes Startboard bleibt.
 *   G  Kurzer Link (#l=) bei einem Fremden: nur das geteilte Board.
 *   H  Einladung ohne Konto (#e=) bei einem Fremden: nur das geteilte Board.
 *   I  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m370-leerer-start.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4588;
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

const START = '🏠 Mein Board';
const geteilt = { id: 'gx', name: 'Projektplan', edges: [], drawings: [], nodes: [
  { id: 'g1', type: 'note', width: 220, position: { x: 0, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Geteilte Notiz eins' }] } },
  { id: 'g2', type: 'note', width: 220, position: { x: 280, y: 0 }, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Geteilte Notiz zwei' }] } },
] };
const nutzlast = JSON.stringify({ app: 'pixinotes-board', version: 2, board: geteilt });
const hashB = `#b=${gzipSync(Buffer.from(nutzlast)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
const eigenes = (boards) => ({
  boards,
  spaces: [{ id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: boards.map((b) => b.id) }] }],
  activeId: boards[0].id, view: 'board',
});
const notiz = { id: 'e1', type: 'note', width: 200, position: { x: 0, y: 0 }, data: { color: 'green', blocks: [{ type: 'paragraph', content: 'Meins' }] } };

// ---------- Nachgebauter Server: nur, was ein Fremder ohne Konto erreicht ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const TOKEN_L = 'linktokenlinktokenlinktoken12';
const TOKEN_E = 'einladungstoken12345678';
async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(obj) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request(); const pfad = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    let b = {}; try { b = JSON.parse(req.postData() ?? '{}'); } catch { /* leer */ }
    if (pfad === '/rest/v1/rpc/link_lesen') return json(route, 200, b.p_token === TOKEN_L ? { name: 'Projektplan', board_url: `${SB_URL}/lager/board.json`, dateien: [], stand: 's1' } : null);
    if (pfad === '/lager/board.json') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: nutzlast });
    if (pfad === '/rest/v1/rpc/gast_lesen') return json(route, 200, b.p_token === TOKEN_E ? { board_id: 'gx', rolle: 'bearbeiten', besitzer: 'uid-anna', inhalt: JSON.stringify(geteilt), version: 3, dateien: [], kanal: 'k1', optionen: {} } : null);
    if (pfad === '/rest/v1/rpc/gast_stand') return json(route, 200, b.p_token === TOKEN_E ? { version: 3, rolle: 'bearbeiten', optionen: {} } : null);
    return json(route, 404, { message: 'nicht nachgebaut' });
  });
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
/** `stand`: null = allererster Besuch; sonst der gespeicherte Stand eines früheren Besuchs */
const geraet = async ({ stand = null, adresse = '' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await dienste(ctx);
  await ctx.addInitScript(({ st, konfig }) => {
    if (sessionStorage.getItem('pn-test')) return;
    sessionStorage.setItem('pn-test', '1');
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    if (st) {
      localStorage.setItem('pixinotes-onboarded', '1');
      localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    }
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
  const P = await ctx.newPage();
  P.fehler = [];
  P.on('pageerror', (e) => P.fehler.push(e.message));
  P.on('dialog', (d) => void d.accept());
  await P.goto(`http://localhost:${PORT}/${adresse}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2400);
  return P;
};
const lage = (P) => P.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state ?? {};
  return {
    boards: (s.boards ?? []).map((b) => `${b.name}:${b.nodes.length}`),
    bereiche: (s.spaces ?? []).map((sp) => sp.name),
    ansicht: s.view,
    leiste: [...document.querySelectorAll('.side-board-name')].filter((el) => el.getClientRects().length).map((el) => el.textContent.trim()),
    begruessung: !!document.querySelector('.onb'),
    angebot: !!document.querySelector('[data-taste="leer-beispiele"]'),
    karten: document.querySelectorAll('.react-flow__node').length,
  };
});

console.log('════ A: Erster Start ════');
{
  const P = await geraet();
  let z = await lage(P);
  pruefe('A1 genau ein Board, leer — keine Beispiel-Umgebung', z.boards.length === 1 && z.boards[0] === `${START}:0` && z.bereiche.length === 1, JSON.stringify(z));
  pruefe('A2 die Begrüßung erscheint und bietet „Beispiele laden" an', z.begruessung && await P.locator('[data-taste="onb-beispiele"]').innerText() === 'Beispiele laden');
  await P.locator('.onb-primary').click(); await P.waitForTimeout(400);
  z = await lage(P);
  pruefe('A3 „Loslegen": leeres Board mit Hinweisen und dem Angebot „Beispiele laden"', !z.begruessung && z.angebot && z.karten === 0 && z.leiste.length === 1, JSON.stringify(z));
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  z = await lage(P);
  pruefe('A4 nach dem Neuladen unverändert: ein leeres Board, keine Begrüßung mehr', z.boards.length === 1 && z.boards[0] === `${START}:0` && !z.begruessung, JSON.stringify(z));
  pruefe('A5 kein Fehler der Seite', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 200));
  await P.context().close();
}

console.log('════ B: Begrüßung → Beispiele laden ════');
{
  const P = await geraet();
  await P.locator('[data-taste="onb-beispiele"]').click(); await P.waitForTimeout(1200);
  const z = await lage(P);
  pruefe('B1 die Beispiel-Umgebung ist da: 4 Bereiche, 18 Boards', z.boards.length === 18 && z.bereiche.length === 4, JSON.stringify([z.boards.length, z.bereiche]));
  pruefe('B1b die Meldung nennt die wirklichen Zahlen', (await P.locator('.toast').innerText().catch(() => '')).includes('4 Bereiche, 18 Boards'));
  pruefe('B2 das leere Startboard ist nicht mehr dabei', !z.boards.some((b) => b.startsWith(START)));
  pruefe('B3 man landet in der Übersicht, ohne Fehler', z.ansicht === 'overview' && P.fehler.length === 0, JSON.stringify([z.ansicht, P.fehler]).slice(0, 200));
  await P.context().close();
}

console.log('════ C: Leeres Board → Beispiele laden ════');
{
  const P = await geraet();
  await P.locator('.onb-primary').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="leer-beispiele"]').click(); await P.waitForTimeout(1800);
  const z = await lage(P);
  pruefe('C1 18 Boards, das Startboard ist ersetzt', z.boards.length === 18 && !z.boards.some((b) => b.startsWith(START)), JSON.stringify(z.boards.length));
  await P.context().close();
}

console.log('════ D: Eigenes bleibt ════');
{
  const P = await geraet();
  await P.locator('.onb-primary').click(); await P.waitForTimeout(300);
  const r = await P.locator('.react-flow').boundingBox();
  await P.mouse.dblclick(r.x + r.width * 0.3, r.y + r.height * 0.3); await P.waitForTimeout(500);
  await P.keyboard.type('Mein erster Gedanke', { delay: 20 });
  await P.mouse.click(r.x + r.width * 0.8, r.y + r.height * 0.8); await P.waitForTimeout(1500);
  let z = await lage(P);
  pruefe('D1 mit der ersten Notiz verschwindet das Angebot auf dem Board', z.karten === 1 && !z.angebot && z.boards[0] === `${START}:1`, JSON.stringify(z));
  await P.locator('.tab-add').click(); await P.waitForTimeout(300);
  await P.locator('[role="menuitem"]', { hasText: 'Beispiel-Umgebung hinzufügen' }).click(); await P.waitForTimeout(1800);
  z = await lage(P);
  pruefe('D2 ＋ Neu → Beispiele: sie kommen dazu, das eigene Board bleibt (19 Boards, 5 Bereiche)', z.boards.length === 19 && z.boards.includes(`${START}:1`) && z.bereiche.length === 5, JSON.stringify([z.boards.length, z.bereiche.length]));
  await P.context().close();
}

console.log('════ E: Geteilter Link bei einem Fremden ════');
{
  const P = await geraet({ adresse: hashB });
  const z = await lage(P);
  pruefe('E1 nur das geteilte Board ist da', z.boards.length === 1 && z.boards[0] === 'Projektplan (geteilt):2', JSON.stringify(z.boards));
  pruefe('E2 in der Seitenleiste steht kein anderes Board', z.leiste.length === 1 && z.leiste[0].includes('Projektplan'), JSON.stringify(z.leiste));
  pruefe('E3 es ist offen (beide Karten zu sehen), ohne Begrüßung davor', z.karten === 2 && !z.begruessung && z.ansicht === 'board', JSON.stringify(z));
  pruefe('E4 kein Fehler der Seite', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 200));
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  const z2 = await lage(P);
  pruefe('E5 nach dem Neuladen weiterhin nur dieses Board', z2.boards.length === 1 && z2.boards[0] === 'Projektplan (geteilt):2', JSON.stringify(z2.boards));
  await P.context().close();
}

console.log('════ F: … bei jemandem mit eigenen Boards ════');
{
  const P = await geraet({ stand: eigenes([{ id: 'b1', name: 'Eigenes', nodes: [notiz], edges: [], drawings: [] }]), adresse: hashB });
  const z = await lage(P);
  pruefe('F1 eigenes Board bleibt, das geteilte kommt dazu', z.boards.length === 2 && z.boards.includes('Eigenes:1') && z.boards.includes('Projektplan (geteilt):2'), JSON.stringify(z.boards));
  await P.context().close();
  const Q = await geraet({ stand: eigenes([{ id: 'b1', name: START, nodes: [notiz], edges: [], drawings: [] }]), adresse: hashB });
  const y = await lage(Q);
  pruefe('F2 ein benutztes Startboard (mit Notiz) bleibt', y.boards.length === 2 && y.boards.includes(`${START}:1`), JSON.stringify(y.boards));
  await Q.context().close();
  const R = await geraet({ stand: eigenes([{ id: 'b1', name: 'Ideen', nodes: [], edges: [], drawings: [] }]), adresse: hashB });
  const x = await lage(R);
  pruefe('F3 ein umbenanntes leeres Board bleibt', x.boards.length === 2 && x.boards.includes('Ideen:0'), JSON.stringify(x.boards));
  await R.context().close();
  const S = await geraet({ stand: eigenes([{ id: 'b1', name: START, nodes: [], edges: [], drawings: [] }]), adresse: hashB });
  const w = await lage(S);
  pruefe('F4 wer früher schon einmal da war, aber nichts angelegt hat: nur das geteilte Board', w.boards.length === 1 && w.boards[0] === 'Projektplan (geteilt):2', JSON.stringify(w.boards));
  await S.context().close();
}

console.log('════ G: Kurzer Link (#l=) bei einem Fremden ════');
{
  const P = await geraet({ adresse: `#l=${TOKEN_L}` });
  const z = await lage(P);
  pruefe('G1 nur das geteilte Board, offen, ohne Begrüßung', z.boards.length === 1 && z.boards[0].startsWith('Projektplan') && z.boards[0].endsWith(':2') && z.karten === 2 && !z.begruessung, JSON.stringify(z));
  pruefe('G2 kein Fehler der Seite', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 200));
  await P.context().close();
}

console.log('════ H: Einladung ohne Konto (#e=) bei einem Fremden ════');
{
  const P = await geraet({ adresse: `#e=${TOKEN_E}` });
  await P.waitForTimeout(1200);
  const z = await lage(P);
  pruefe('H1 nur das geteilte Board', z.boards.length === 1 && z.boards[0] === 'Projektplan:2', JSON.stringify(z.boards));
  pruefe('H2 in der Seitenleiste steht kein anderes Board; keine Begrüßung', z.leiste.length === 1 && z.leiste[0].includes('Projektplan') && !z.begruessung, JSON.stringify(z.leiste));
  pruefe('H3 kein Fehler der Seite', P.fehler.length === 0, JSON.stringify(P.fehler).slice(0, 200));
  await P.context().close();
  const Q = await geraet({ stand: eigenes([{ id: 'b1', name: 'Eigenes', nodes: [notiz], edges: [], drawings: [] }]), adresse: `#e=${TOKEN_E}` });
  await Q.waitForTimeout(1200);
  const y = await lage(Q);
  pruefe('H4 mit eigenen Boards: das eigene bleibt, das geteilte kommt dazu', y.boards.length === 2 && y.boards.includes('Eigenes:1') && y.boards.includes('Projektplan:2'), JSON.stringify(y.boards));
  await Q.context().close();
}

console.log('════ I: Texte ════');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('I1 Hilfe nennt M370', quelle('src/components/HelpOverlay.tsx').includes('(M370)'));
pruefe('I2 docs/UMBAU.md führt M370', quelle('docs/UMBAU.md').includes('M370'));

await browser.close(); app.close();
console.log(`\nm370-leerer-start: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
